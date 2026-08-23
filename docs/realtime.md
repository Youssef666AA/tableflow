# Realtime

## Why Socket.IO

The product's value depends on two screens agreeing within a second: the kitchen sees an
order the moment a guest places it, and the guest sees "Preparing" the moment the chef
presses start. Polling at that cadence is wasteful and still feels late.

Socket.IO was chosen over raw WebSockets for its automatic reconnection with backoff and
its transparent fallback to long-polling on networks that block upgrades — which is the
situation on plenty of restaurant guest Wi-Fi.

## Authentication

The socket handshake carries the same credential as the HTTP API:

```ts
io(origin, { auth: { kind: 'staff' | 'customer', token } })
```

The server verifies it **before** the connection is accepted:

- **Staff** — the access token is verified, then the membership is re-read from the
  database. A revoked or deactivated member is refused even with a token that has not
  expired yet.
- **Customer** — the session token is verified, then the session is re-read: it must
  exist, match the token's version, and not be closed, expired or blocked.

There is no such thing as an unauthenticated socket, and nothing in the handshake payload
is trusted beyond the token itself.

## Rooms

| Room | Members | Carries |
| --- | --- | --- |
| `restaurant:{id}` | every staff member | restaurant-wide notices |
| `branch:{id}` | staff scoped to that branch | orders, tables, requests, payments, stock alerts |
| `branch:{id}:role:{ROLE}` | one role in one branch | role-specific nudges ("order ready" to waiters) |
| `session:{id}` | the guests at one table | that table's orders, requests and payments |
| `user:{id}` | one person | personal notifications |

A guest joins exactly one room: their own session. There is no room they could join to
observe another table, and no event that carries another table's data.

## Events

| Event | Emitted when |
| --- | --- |
| `order:created` | an order is placed |
| `order:updated` | any status change, including per-item progress |
| `service_request:created` / `:updated` | a request is raised or handled |
| `table:updated` | a table's derived status changes |
| `session:updated` | a session starts, is verified, or closes |
| `payment:updated` | a payment succeeds or fails |
| `inventory:alert` | stock crosses a threshold |
| `menu:updated` | a product or its availability changes |
| `review:created` | a guest leaves a review |
| `notification:new` | a notification is created |

Staff and guests receive **different payloads for the same event**. `serializeOrder` is
for staff; `serializeOrderForCustomer` strips kitchen notes, station assignments, staff
names and internal ids. That filtering happens on the server, not in the client.

## Ordering guarantee

A service computes its change, commits the transaction, and only then emits. There is no
path where an event is broadcast for a change that was rolled back.

```ts
const outcome = await prisma.$transaction(async (tx) => { /* … */ });
// ---- committed ----
emitToBranch(outcome.order.branchId, REALTIME_EVENTS.ORDER_CREATED, serialized);
emitToSession(outcome.order.sessionId, REALTIME_EVENTS.ORDER_CREATED, forCustomer);
```

## What the client does with an event

Events **invalidate** TanStack Query keys rather than patching caches:

```ts
useRealtimeInvalidation(socket, ['order:created', 'order:updated'], [['kitchen', branchId]]);
```

This is deliberate. Patching a cache from a stream means a client that missed events
while disconnected stays wrong until something forces a refetch. Invalidating means a
reconnect converges on the server's truth. The extra request costs little; being quietly
wrong on a kitchen display costs a lot.

Polling remains as a slow backstop — 30 s on the kitchen, 45–90 s elsewhere — so a dead
socket degrades to "a bit late" rather than "frozen".

## Connection state is shown, not hidden

`useConnectionState` drives a visible indicator: a quiet "Live" dot when connected, an
amber "Reconnecting…" while retrying, and a red "Connection lost" when down. The kitchen
display shows it prominently, because a chef needs to know whether an empty board means
no orders or a broken connection.

The guest app additionally watches `navigator.onLine` and refuses to send an order while
offline rather than letting it fail silently.

## Scaling beyond one process

Today a single API process owns the socket server, which is right for one venue. Running
several replicas needs a Socket.IO adapter (Redis is already a dependency) so that a room
spans processes. The emit helpers in `realtime/index.ts` are the only place that would
change; no service or component knows how a room is implemented.
