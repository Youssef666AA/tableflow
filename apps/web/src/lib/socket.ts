import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './api';

/**
 * One socket per client kind. Components subscribe to events; the connection
 * itself is managed here so a re-render never tears it down.
 */

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface Handle {
  socket: Socket;
  refCount: number;
}

const handles = new Map<string, Handle>();
const stateListeners = new Map<string, Set<(state: ConnectionState) => void>>();

function notify(key: string, state: ConnectionState) {
  stateListeners.get(key)?.forEach((listener) => listener(state));
}

function keyFor(kind: 'staff' | 'customer', token: string) {
  return `${kind}:${token.slice(-24)}`;
}

export function acquireSocket(kind: 'staff' | 'customer', token: string): Socket {
  const key = keyFor(kind, token);
  const existing = handles.get(key);
  if (existing) {
    existing.refCount += 1;
    return existing.socket;
  }

  const socket = io(API_BASE || window.location.origin, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { kind, token },
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 6000,
    withCredentials: true,
  });

  socket.on('connect', () => notify(key, 'connected'));
  socket.on('disconnect', () => notify(key, 'disconnected'));
  socket.on('connect_error', () => notify(key, 'disconnected'));
  socket.io.on('reconnect_attempt', () => notify(key, 'connecting'));

  handles.set(key, { socket, refCount: 1 });
  return socket;
}

export function releaseSocket(kind: 'staff' | 'customer', token: string): void {
  const key = keyFor(kind, token);
  const handle = handles.get(key);
  if (!handle) return;

  handle.refCount -= 1;
  if (handle.refCount <= 0) {
    handle.socket.removeAllListeners();
    handle.socket.disconnect();
    handles.delete(key);
    stateListeners.delete(key);
  }
}

export function subscribeConnectionState(
  kind: 'staff' | 'customer',
  token: string,
  listener: (state: ConnectionState) => void,
): () => void {
  const key = keyFor(kind, token);
  const set = stateListeners.get(key) ?? new Set();
  set.add(listener);
  stateListeners.set(key, set);

  const handle = handles.get(key);
  listener(handle?.socket.connected ? 'connected' : 'connecting');

  return () => {
    set.delete(listener);
  };
}
