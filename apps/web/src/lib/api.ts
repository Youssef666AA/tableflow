/**
 * The single HTTP client for the whole app.
 *
 * Two credential kinds live side by side — a staff access token (refreshed
 * transparently) and a customer table-session token — and a request declares
 * which one it needs. Nothing else in the app touches fetch directly.
 */

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'GONE'
  | 'RATE_LIMITED'
  | 'UNPROCESSABLE'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE'
  | 'QR_INVALID'
  | 'QR_REVOKED'
  | 'SESSION_EXPIRED'
  | 'SESSION_CLOSED'
  | 'SESSION_BLOCKED'
  | 'LOCATION_REQUIRED'
  | 'LOCATION_OUT_OF_RANGE'
  | 'RESTAURANT_CLOSED'
  | 'ITEM_UNAVAILABLE'
  | 'ORDER_LIMIT_REACHED'
  | 'DUPLICATE_ORDER'
  | 'INVALID_TRANSITION'
  | 'INSUFFICIENT_STOCK'
  | 'ALREADY_PAID'
  | 'DEMO_DISABLED'
  | 'NETWORK';

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  details: unknown;

  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Field-level issues from a validation failure, ready to feed into a form. */
  get fieldIssues(): FieldIssue[] {
    return Array.isArray(this.details) ? (this.details as FieldIssue[]) : [];
  }

  get isOffline(): boolean {
    return this.code === 'NETWORK';
  }
}

/* --------------------------------------------------------------- storage */

const STAFF_ACCESS_KEY = 'tf.staff.access';
const STAFF_REFRESH_KEY = 'tf.staff.refresh';
const SESSION_TOKEN_PREFIX = 'tf.session.';
const DEVICE_KEY = 'tf.device';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private-mode browsers can refuse storage; the app still works for one page view.
  }
}

/**
 * Staff tokens use tab-isolated sessionStorage so developers and operators can
 * open different roles (e.g. Owner in Tab 1, Waiter in Tab 2, Kitchen in Tab 3)
 * simultaneously in the same browser without tabs overwriting each other.
 */
function readStaff(key: string): string | null {
  try {
    const sessionVal = window.sessionStorage.getItem(key);
    if (sessionVal) return sessionVal;

    // Migrate from legacy localStorage if present, then clear from localStorage
    const localVal = window.localStorage.getItem(key);
    if (localVal) {
      window.sessionStorage.setItem(key, localVal);
      window.localStorage.removeItem(key);
      return localVal;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStaff(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
      window.localStorage.removeItem(key);
    }
  } catch {
    // Private-mode browsers can refuse storage; the app still works for one page view.
  }
}

export const staffTokens = {
  access: () => readStaff(STAFF_ACCESS_KEY),
  refresh: () => readStaff(STAFF_REFRESH_KEY),
  set(accessToken: string, refreshToken: string) {
    writeStaff(STAFF_ACCESS_KEY, accessToken);
    writeStaff(STAFF_REFRESH_KEY, refreshToken);
  },
  clear() {
    writeStaff(STAFF_ACCESS_KEY, null);
    writeStaff(STAFF_REFRESH_KEY, null);
  },
};

export const sessionTokens = {
  get: (qrToken: string) => read(SESSION_TOKEN_PREFIX + qrToken),
  set: (qrToken: string, sessionToken: string) => write(SESSION_TOKEN_PREFIX + qrToken, sessionToken),
  clear: (qrToken: string) => write(SESSION_TOKEN_PREFIX + qrToken, null),
};

/** A stable per-browser identifier so a reload rejoins the same table session. */
export function deviceKey(): string {
  const existing = read(DEVICE_KEY);
  if (existing) return existing;
  const generated =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  write(DEVICE_KEY, generated);
  return generated;
}

/* --------------------------------------------------------------- request */

export type Credential = 'none' | 'staff' | { session: string };

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  credential?: Credential;
  signal?: AbortSignal;
  /** Set to read a binary payload (PDF, PNG) instead of JSON. */
  blob?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;
const unauthorizedListeners = new Set<() => void>();

export function onStaffUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/**
 * Codes that mean the table session itself is gone. They are never a page-level
 * failure: whichever screen the guest happens to be on, the answer is the same —
 * hand control back to the session shell, which either opens a fresh session or
 * explains why it cannot. Handling them per page produced dead ends like a bill
 * screen saying "Something went wrong" with a Retry button that could never work.
 */
export const SESSION_LIFECYCLE_CODES = [
  'SESSION_EXPIRED',
  'SESSION_CLOSED',
  'SESSION_BLOCKED',
  'QR_INVALID',
  'QR_REVOKED',
] as const satisfies readonly ApiErrorCode[];

export function isSessionLifecycleError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (SESSION_LIFECYCLE_CODES as readonly string[]).includes(error.code)
  );
}

export interface SessionLostEvent {
  /** The token the failing request used, so a stale listener can ignore it. */
  sessionToken: string;
  error: ApiError;
}

const sessionLostListeners = new Set<(event: SessionLostEvent) => void>();

/** Fires whenever any customer request is refused because the session ended. */
export function onCustomerSessionLost(listener: (event: SessionLostEvent) => void): () => void {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
}

async function refreshStaffSession(): Promise<boolean> {
  const refreshToken = staffTokens.refresh();
  if (!refreshToken) return false;

  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        staffTokens.clear();
        return false;
      }
      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      staffTokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function toError(response: Response): Promise<ApiError> {
  let payload: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return new ApiError(
    (payload?.error?.code as ApiErrorCode) ?? 'INTERNAL',
    payload?.error?.message ?? 'Something went wrong. Please try again.',
    response.status,
    payload?.error?.details,
  );
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, credential = 'none', signal, blob = false } = options;

  const send = async (retrying = false): Promise<T> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (credential === 'staff') {
      const token = staffTokens.access();
      if (token) headers.Authorization = `Bearer ${token}`;
    } else if (typeof credential === 'object') {
      headers.Authorization = `Bearer ${credential.session}`;
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new ApiError(
        'NETWORK',
        "We're having trouble connecting. Please check your connection.",
        0,
      );
    }

    if (response.status === 401 && credential === 'staff' && !retrying) {
      const refreshed = await refreshStaffSession();
      if (refreshed) return send(true);
      staffTokens.clear();
      unauthorizedListeners.forEach((listener) => listener());
    }

    if (!response.ok) {
      const error = await toError(response);
      // A dead table session is a whole-app condition, not this call's problem.
      if (typeof credential === 'object' && isSessionLifecycleError(error)) {
        const event: SessionLostEvent = { sessionToken: credential.session, error };
        sessionLostListeners.forEach((listener) => listener(event));
      }
      throw error;
    }
    if (response.status === 204) return undefined as T;
    if (blob) return (await response.blob()) as T;
    return (await response.json()) as T;
  };

  return send();
}

export const api = {
  get: <T>(path: string, credential: Credential = 'staff', signal?: AbortSignal) =>
    request<T>(path, { credential, signal }),
  post: <T>(path: string, body?: unknown, credential: Credential = 'staff') =>
    request<T>(path, { method: 'POST', body, credential }),
  put: <T>(path: string, body?: unknown, credential: Credential = 'staff') =>
    request<T>(path, { method: 'PUT', body, credential }),
  patch: <T>(path: string, body?: unknown, credential: Credential = 'staff') =>
    request<T>(path, { method: 'PATCH', body, credential }),
  del: <T>(path: string, credential: Credential = 'staff') =>
    request<T>(path, { method: 'DELETE', credential }),
  blob: (path: string, credential: Credential = 'staff') =>
    request<Blob>(path, { credential, blob: true }),
};

/** Downloads a protected file (receipt PDF, QR sheet) through the authorised client. */
export async function downloadFile(path: string, filename: string, credential: Credential = 'staff') {
  const blob = await api.blob(path, credential);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Fetches an image behind auth and returns an object URL for <img src>. */
export async function authorizedImageUrl(path: string, credential: Credential = 'staff') {
  const blob = await api.blob(path, credential);
  return URL.createObjectURL(blob);
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
