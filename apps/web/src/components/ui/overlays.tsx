import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, IconButton } from './primitives';

/* --------------------------------------------------------------- helpers */

function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onEscape]);
}

function Backdrop({ onClick }: { onClick?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClick}
      className="fixed inset-0 z-40 bg-ink/35 backdrop-blur-[2px]"
      aria-hidden
    />
  );
}

/* ------------------------------------------------------------ BottomSheet */

/**
 * The customer app's primary overlay. Full-height on a phone, comfortably
 * centred on larger screens, with a real drag-to-dismiss handle.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
}) {
  useLockBodyScroll(open);
  useEscape(open, onClose);

  const heights = {
    sm: 'max-h-[55vh]',
    md: 'max-h-[85vh]',
    lg: 'max-h-[92vh]',
    full: 'h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[92vh] sm:rounded-t-2xl',
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <Backdrop onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340, mass: 0.8 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-2xl bg-surface shadow-overlay',
              'mx-auto w-full sm:max-w-lg',
              heights[size],
            )}
          >
            <div className="flex shrink-0 justify-center pb-1 pt-3">
              <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            </div>

            {(title || description) && (
              <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-1">
                <div className="min-w-0">
                  {title && <h2 className="text-lg font-semibold leading-tight text-ink">{title}</h2>}
                  {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
                </div>
                <IconButton label="Close" size="sm" onClick={onClose}>
                  <X className="size-4" />
                </IconButton>
              </div>
            )}

            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>

            {footer && (
              <div className="shrink-0 border-t border-line bg-surface px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4">
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------------------------------------------------------------- Dialog */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissible?: boolean;
}) {
  useLockBodyScroll(open);
  useEscape(open && dismissible, onClose);

  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <Backdrop onClick={dismissible ? onClose : undefined} />
          <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-overlay sm:rounded-xl',
                widths[size],
              )}
            >
              {(title || dismissible) && (
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    {title && <h2 className="text-base font-semibold leading-tight text-ink">{title}</h2>}
                    {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
                  </div>
                  {dismissible && (
                    <IconButton label="Close" size="sm" onClick={onClose}>
                      <X className="size-4" />
                    </IconButton>
                  )}
                </div>
              )}
              {children && <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>}
              {footer && <div className="shrink-0 border-t border-line bg-surface-sunken/60 px-5 py-4">{footer}</div>}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------- SidePanel */

/** The management console's editing surface — a right-hand drawer. */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  useLockBodyScroll(open);
  useEscape(open, onClose);

  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl' };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <Backdrop onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 34, stiffness: 320 }}
            className={cn(
              'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-overlay',
              widths[width],
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                {title && <h2 className="text-base font-semibold leading-tight text-ink">{title}</h2>}
                {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
              </div>
              <IconButton label="Close" size="sm" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
            {footer && <div className="shrink-0 border-t border-line bg-surface-sunken/60 px-6 py-4">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* --------------------------------------------------------- ConfirmDialog */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      dismissible={!loading}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">{message}</p>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Toasts */

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_ICONS: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const TOAST_TONES: Record<ToastTone, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-info',
  warning: 'text-warning',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback<ToastContextValue['push']>(
    (toast) => {
      const id = Math.random().toString(36).slice(2);
      const duration = toast.duration ?? (toast.tone === 'error' ? 6000 : 4000);
      setToasts((current) => [...current.slice(-3), { ...toast, id, duration }]);
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => clearTimeout(timer));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ tone: 'success', title, description }),
      error: (title, description) => push({ tone: 'error', title, description }),
      info: (title, description) => push({ tone: 'info', title, description }),
      warning: (title, description) => push({ tone: 'warning', title, description }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:items-end sm:pr-6">
          <AnimatePresence initial={false}>
            {toasts.map((toast) => {
              const Icon = TOAST_ICONS[toast.tone];
              return (
                <motion.div
                  key={toast.id}
                  layout
                  initial={{ opacity: 0, y: -14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.97 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-overlay"
                  role="status"
                >
                  <Icon className={cn('mt-0.5 size-[1.125rem] shrink-0', TOAST_TONES[toast.tone])} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug text-ink">{toast.title}</p>
                    {toast.description && (
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{toast.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => dismiss(toast.id)}
                    aria-label="Dismiss"
                    className="-mr-1 -mt-1 rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
