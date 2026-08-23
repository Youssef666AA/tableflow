# The customer flow

## From a printed sticker to a placed order

```
  printed QR                    server                              guest device
  ──────────                    ──────                              ────────────
  /t/<256-bit token>  ────────▶ resolve token
                                  ├─ unknown?    → 404 QR_INVALID
                                  ├─ revoked?    → 410 QR_REVOKED
                                  ├─ table out of service? → 410
                                  └─ branch inactive?      → 409 RESTAURANT_CLOSED
                                       │
                                       ▼
                                reuse or open a TableSession
                                       │
                                register this device
                                       │
                                sign a session JWT  ──────────────▶ stored per QR token
                                       │
                                requiresLocation? ────────────────▶ /verify
                                       │                                │
                                       │◀─── coordinates + accuracy ────┘
                                  haversine vs branch radius
                                       ├─ outside → 403 LOCATION_OUT_OF_RANGE
                                       └─ inside  → device verified, session ACTIVE
                                                            │
                                                            ▼
                                                     menu → cart → order
```

The URL contains **only** a random token. There is no `/table/3`, nothing to increment,
and nothing that identifies the restaurant to someone who has not scanned the code.

## Table sessions

A session is the visit, not the device. When a second guest at the same table scans the
code, they join the existing session — so both people's orders land on one bill and both
see the same running total.

| State | Meaning |
| --- | --- |
| `CREATED` | Opened, nothing verified yet |
| `LOCATION_PENDING` | Waiting for a device to prove it is at the restaurant |
| `ACTIVE` | Orders and service requests allowed |
| `PAUSED` | Held by staff |
| `EXPIRED` | Past its TTL; swept by a background job |
| `CLOSED` | Settled and released; the table is marked for cleaning |
| `BLOCKED` | Stopped by staff after abuse |

The TTL (default three hours) extends automatically whenever an order is placed, so a
long dinner never expires under the guests.

### Why verification is per device, not per session

Sharing a session is what makes one bill possible, but it must not mean that the first
person to verify silently authorises anyone who later gets hold of the QR token — a
photo of the sticker, a link forwarded to a friend at home.

So each phone gets a `SessionDevice` row and proves for itself that it is at the
restaurant. The session becomes `ACTIVE` when any device verifies; an unverified device
in an active session can still browse the menu but is refused at checkout with
`LOCATION_REQUIRED`.

### Handling location honestly

Every failure mode has its own screen and its own way forward:

| Situation | What the guest sees |
| --- | --- |
| Permission denied | How to allow it, and that staff can vouch for them |
| Position unavailable | A suggestion to move near a window, and retry |
| Timeout | That it usually works on a second attempt |
| Genuinely too far | The measured distance and the allowed radius |
| Too many failures | That the device is blocked and staff can help |

GPS accuracy widens the allowed radius by up to 150 m, so honest drift is not punished,
but a very poor reading cannot buy unlimited slack. `allowStaffLocationOverride` lets a
waiter confirm a table from their own device. In demo mode a *simulate* button exists;
`DEMO_MODE` is force-disabled whenever `NODE_ENV=production`.

Location is an anti-abuse signal, not the security boundary. The token, the server-side
session, the authorisation checks and the rate limits are what actually protect a table.

## Ordering

The cart lives in the browser (per session id, so a reload or a locked phone does not
lose it), but its **price does not**. Every change re-quotes against
`POST /customer/cart/quote`, which runs the same pricing engine the order will use.

At checkout the server:

1. Confirms the session is active and belongs to that table.
2. Confirms the branch is open.
3. Checks the session is not over its concurrent-order limit.
4. Fingerprints the cart and refuses an identical order placed in the last two minutes
   unless the guest confirms.
5. Reprices everything from database rows.
6. Allocates an order number, writes the order, deducts stock, extends the session,
   recomputes the table's status and writes an audit entry — in one transaction.
7. Broadcasts to the branch and to the guest's session.

### Retries and duplicates — two different problems

They are often conflated; TableFlow treats them separately.

- **The same request arriving twice** (a double tap, a retried fetch) carries the same
  `idempotencyKey`. The unique index on `(sessionId, idempotencyKey)` means the second
  one returns the first order untouched.
- **A genuinely new request that happens to look identical** carries a different key.
  That is caught by the cart fingerprint and answered with `DUPLICATE_ORDER`, which the
  UI turns into *"You just ordered this. Order it again?"*

And when the network fails mid-request, the client does not guess. It asks the server
what happened — showing *"Checking order status…"* — and only offers a retry once it
knows the order is not there.

## After the order

- **Live tracking**: `Received → Preparing → Ready → Delivered`, each dot backed by a
  timestamp the API actually recorded, advanced by socket events.
- **Service requests**: water, napkins, cutlery, condiments, call waiter, request bill.
  Tapping twice folds into the existing open request rather than queueing two jobs.
- **The bill**: every non-cancelled order on the session, with an equal-split calculator
  whose shares always sum exactly to the total.
- **Payment**: pay now with the simulated card provider, or ask staff to take cash or
  card at the table.
- **Receipt**: an immutable snapshot rendered as a PDF, with simulated payments labelled
  as such.
- **Review**: only offered once an order on that session has actually been served, so
  every rating comes from a real visit.
