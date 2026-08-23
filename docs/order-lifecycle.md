# Order lifecycle

## The state machine

```
                    ┌──────────────────────────────┐
                    ▼                              │
  PENDING ──▶ ACCEPTED ──▶ PREPARING ──▶ READY ──▶ OUT_FOR_DELIVERY_TO_TABLE
     │            │            │           │                    │
     │            │            │           └────────────────────┤
     │            │            │                                ▼
     │            │            │                            DELIVERED
     │            │            │                                │
     │            │            │                                ▼
     │            │            │                            COMPLETED
     ▼            ▼            ▼
  REJECTED    CANCELLED    CANCELLED
```

`PENDING` may also go straight to `PREPARING` when a branch has `autoAcceptOrders` on.
Terminal states accept nothing. A transition to itself is not a transition. Anything not
in the table is refused with `INVALID_TRANSITION` and a message naming both states.

The table lives in `packages/shared/src/state-machines.ts` and is enforced in
`updateOrderStatus`, so the rule is identical whether the change comes from the kitchen
display, the waiter's floor, the orders table or the API directly.

## Who may move it

| Transition | Permission | Typically |
| --- | --- | --- |
| → `ACCEPTED` / `PREPARING` / `READY` | `kitchen:update` | Kitchen display |
| → `DELIVERED` | `orders:update_status` | Waiter |
| → `COMPLETED` | `orders:update_status`, or automatically on payment | Waiter / cashier |
| → `CANCELLED` / `REJECTED` | `orders:cancel` | Manager, or kitchen rejecting |

Cancelling releases money and stock, so it needs a stricter permission than moving an
order forward. A waiter can serve but not cancel.

## What each transition does

Every status change, in one transaction:

1. Validates the transition.
2. Confirms the caller is scoped to that order's branch.
3. Stamps the matching timestamp (`acceptedAt`, `startedAt`, `readyAt`, `deliveredAt`,
   `completedAt`, `cancelledAt`).
4. Writes an `OrderStatusEvent` with actor and reason — the order's full history.
5. Brings the order's items into line (`QUEUED → PREPARING → READY → SERVED`).
6. Moves stock when relevant: cancelling returns ingredients; completing deducts them if
   the branch is configured to deduct on completion rather than on placement.
7. Recomputes the table's derived status.
8. Writes an audit entry.

Then, after the commit, it broadcasts to the branch and to the guest's session, and —
for `READY` — notifies waiters specifically.

## Per-item progress

With kitchen stations enabled, a ticket's lines are routed to Pizza, Grill, Drinks and
so on. Staff can advance a single line, and the order's own status is *derived* from its
lines: once every line is ready the order becomes `READY`; as soon as one is in progress
it becomes `PREPARING`. The derived move is written as a status event with the reason
"Derived from kitchen item progress", so the history stays honest about what happened.

## What the guest sees

The internal machine has nine states; the guest sees four.

| Internal | Guest |
| --- | --- |
| `PENDING`, `ACCEPTED` | Received |
| `PREPARING` | Preparing |
| `READY`, `OUT_FOR_DELIVERY_TO_TABLE` | Ready |
| `DELIVERED`, `COMPLETED` | Delivered |
| `CANCELLED`, `REJECTED` | Cancelled, with the reason |

The guest is not shown kitchen internals, station assignments or staff names.

## Timing and the SLA

`receivedAt → startedAt → readyAt → deliveredAt` are all recorded, which is what lets the
kitchen display run a truthful timer that survives a refresh, and what analytics measures
"time to ready" and "cook time" from.

Each branch sets `kitchenSlaMinutes`. A ticket is neutral below 75% of its target, amber
past that, and red once over. A background job flags orders past the SLA and notifies the
kitchen and managers, de-duplicated to at most one warning per order per ten minutes.

## Stock

`deductStockOn` is per branch:

- `ORDER_CREATED` (default) — ingredients are deducted when the order is placed, so the
  kitchen never starts a dish it cannot finish.
- `ORDER_COMPLETED` — deducted when the order completes, closer to a pure sales ledger.

Either way the deduction runs inside the order's transaction. If an ingredient would go
negative and the branch does not allow it, the whole order is refused with
`INSUFFICIENT_STOCK` naming the ingredient and what is left. Cancelling an order that
already consumed stock writes `RETURN` movements, guarded so a double cancellation
cannot return the same ingredients twice.

## Payment and closing

The bill covers every non-cancelled order on the session. Payments accumulate; when the
paid total reaches the bill total the API links the orders to the settling payment,
completes anything still `DELIVERED`, and issues an immutable receipt snapshot.

Closing a session refuses while money is owed unless a manager explicitly forces it. On
close it completes delivered orders, cancels open requests, bumps the session token
version so old devices cannot keep using it, and marks the table for cleaning. The table
returns to `AVAILABLE` when someone clears it.
