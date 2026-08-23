import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { acquireSocket, releaseSocket, subscribeConnectionState, type ConnectionState } from './socket';

/** Keeps a live socket for as long as the component is mounted. */
export function useSocket(kind: 'staff' | 'customer', token: string | null | undefined): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }
    const instance = acquireSocket(kind, token);
    setSocket(instance);
    return () => {
      releaseSocket(kind, token);
      setSocket(null);
    };
  }, [kind, token]);

  return socket;
}

export function useConnectionState(
  kind: 'staff' | 'customer',
  token: string | null | undefined,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!token) return;
    return subscribeConnectionState(kind, token, setState);
  }, [kind, token]);

  return token ? state : 'disconnected';
}

/**
 * Binds socket events to handlers without re-subscribing on every render.
 * `events` is read from a ref, so inline handlers are safe.
 */
export function useSocketEvents(
  socket: Socket | null,
  events: Record<string, (payload: unknown) => void>,
): void {
  const ref = useRef(events);
  ref.current = events;

  const names = useMemo(() => Object.keys(events).sort().join(','), [events]);

  useEffect(() => {
    if (!socket) return;
    const list = names ? names.split(',') : [];
    const bound = list.map((name) => {
      const handler = (payload: unknown) => ref.current[name]?.(payload);
      socket.on(name, handler);
      return { name, handler };
    });
    return () => {
      bound.forEach(({ name, handler }) => socket.off(name, handler));
    };
  }, [socket, names]);
}

/** Invalidates React Query keys whenever any of the given socket events fire. */
export function useRealtimeInvalidation(
  socket: Socket | null,
  eventNames: string[],
  queryKeys: unknown[][],
): void {
  const client = useQueryClient();
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  const joined = eventNames.join(',');

  useEffect(() => {
    if (!socket) return;
    const handler = () => {
      keysRef.current.forEach((key) => void client.invalidateQueries({ queryKey: key }));
    };
    const names = joined ? joined.split(',') : [];
    names.forEach((name) => socket.on(name, handler));
    return () => names.forEach((name) => socket.off(name, handler));
  }, [socket, joined, client]);
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Ticks once a second — used by the kitchen timers and session clocks. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });

  const update = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage may be unavailable; in-memory state still works for this visit.
    }
  };

  return [value, update];
}
