# Security

The threat model is mundane and specific: a guest with a phone, a photograph of a QR
sticker, a browser dev-tools console, and time.

## The QR token

The printed code encodes one thing: `WEB_URL/t/<token>`, where the token is 32 random
bytes rendered URL-safe.

- There is no table number, branch id or restaurant name in the URL. Nothing to
  increment, nothing to guess, nothing that identifies the venue to someone who has not
  scanned it.
- 256 bits of entropy makes enumeration infeasible, and scans are rate-limited at 30 per
  minute per IP anyway.
- Tokens are **capability credentials**, so they are stored as-is rather than hashed —
  the admin console must be able to re-render and reprint a code. What protects them is
  entropy plus revocability, not secrecy at rest.
- Regenerating deactivates the previous row inside the same transaction. A code still
  stuck on a table stops resolving the instant a manager presses the button, and the
  guest is told the code is no longer active rather than being shown a generic error.

## Table sessions

The guest's credential is a JWT holding an opaque session id, a device id and a token
version — no table number, nothing meaningful to tamper with.

On every request the middleware re-reads the session and checks, in this order:

1. It exists.
2. It is not `BLOCKED` or `CLOSED`.
3. It has not expired.
4. The token version still matches (closing a session bumps it, so old devices are
   locked out immediately).
5. The device row exists and is not blocked.

Only then are the table, branch and restaurant taken **from the database row**, never
from the request. A guest cannot point themselves at another table because there is no
input that would let them.

## Location

Verified per device rather than per session, so that the first person to verify does not
silently authorise anyone who later gets the QR token — a forwarded link, a photo of the
sticker.

GPS accuracy widens the radius by up to 150 m so honest drift is not punished, but a very
poor reading cannot buy unlimited slack. Twelve failed attempts block that device.

Location is treated as **one anti-abuse signal, not the security boundary**. The token,
the server-side session, authorisation and rate limits are what actually protect a table.
The demo-mode "simulate" shortcut is force-disabled whenever `NODE_ENV=production`,
regardless of what `.env` says.

## Money

Every price, discount, tax figure and total is computed on the server from database rows,
by the same `priceOrder` function the client uses for its optimistic preview. Amounts in
a request body are ignored entirely — an integration test asserts exactly that by posting
`basePrice: 1, unitPrice: 1, total: 1` and checking the stored order is the real price.

Modifier rules (required groups, minimum and maximum selections, unavailable options) are
enforced server-side too, so a client cannot construct a cheaper valid-looking cart.

## Idempotency and duplicates

- A retried request carrying the same `idempotencyKey` returns the original order. The
  guarantee is a unique index on `(sessionId, idempotencyKey)`, not application logic.
- A genuinely new request that happens to be identical within two minutes is caught by a
  cart fingerprint and answered with `DUPLICATE_ORDER`, which the UI turns into an
  explicit "order it again?" confirmation.
- Payments carry their own unique idempotency key.

## Authentication and authorisation

- Passwords: bcrypt, cost 12. Sign-in always runs a comparison even for an unknown
  email, so response timing does not reveal which accounts exist.
- Access tokens are short-lived (15 minutes by default); refresh tokens rotate on use,
  are stored hashed, and reuse of a spent token revokes the whole family and writes an
  audit entry.
- Changing a password or deactivating an account revokes every refresh token, signing
  that person out everywhere.
- **RBAC is enforced on the server for every request.** The role is re-read from the
  database on each call, so a demotion takes effect on the next request rather than when
  the token expires. Client-side hiding of navigation is a courtesy; an E2E test signs in
  as the kitchen and asserts the API returns 403 for analytics, employees and audit.
- Branch scoping is checked separately from role: `resolveBranchId` refuses any branch
  the member is not assigned to, so a manager of one branch cannot read another's orders.
- Privilege escalation is blocked explicitly: only an owner can mint another owner, and
  nobody may edit an account at or above their own rank. A restaurant must always keep at
  least one active owner.

## Rate limits

| Surface | Limit |
| --- | --- |
| Sign-in | 10 per 15 min per IP + email, successful attempts not counted |
| QR scans | 30 per minute per IP |
| Order placement | 10 per minute per session |
| Service requests | 8 per minute per session |
| Other guest traffic | 240 per minute per session |
| Staff writes | 180 per minute |
| Everything | 600 per minute |

## Audit log

Sign-in and sign-out, refresh-token reuse, menu and price changes, availability changes,
stock movements, order and payment status changes, role changes, QR regeneration, table
status changes and session lifecycle — each with actor, entity, metadata, a hashed IP and
a user agent. Readable only with `audit:view`.

## Transport and headers

Helmet sets HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and a CSP of
`default-src 'none'` — the API serves only JSON, PDFs and PNGs, never HTML, so nothing
looser is needed.

CORS allows the configured `WEB_URL`; outside production any loopback origin is accepted
so dev servers can move ports. An unexpected origin is refused by withholding the CORS
headers rather than by throwing, so a misconfigured client sees a CORS error rather than
a 500.

## Privacy

Guests are anonymous by default — no account, no email, no phone. An optional nickname is
the only personal field. IP addresses are stored only as HMAC-SHA256 digests, enough to
rate-limit and correlate abuse without retaining the address itself. Logs redact
`authorization`, `cookie`, passwords, refresh tokens, and card fields.

## What is deliberately not claimed

- The bundled payment provider is simulated. It contacts no card network and moves no
  money; receipts say so explicitly.
- No penetration test has been performed.
- There is no rate limit on socket connections beyond the handshake authentication.
- Secrets are read from the environment; there is no integration with a secret manager.
