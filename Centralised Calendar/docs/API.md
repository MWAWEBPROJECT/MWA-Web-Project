# REST API (`/v1`)

Versioned HTTP endpoints served by the `api` Cloud Function, mounted at `/v1/*` via
Hosting rewrites once deployed (`https://<your-domain>/v1/...`). This is the MVP surface
described in the brief's "API-first" requirement — it is deliberately small; see
**Known limitations** below.

All request/response bodies are JSON. Dates are ISO 8601 UTC strings.

## Authentication

Public endpoints need no auth. Admin-only actions require a Firebase **ID token** (not
the API key) in the `Authorization: Bearer <idToken>` header, for a user whose
`users/{uid}.role == "admin"`. Obtain an ID token client-side via
`firebase.auth().currentUser.getIdToken()` after signing in.

## `GET /v1/events`

Query params: `from`, `to` (ISO date/time, inclusive bounds on `startAt`), `venue`
(venueId), `department` (departmentId), `status` (admin only — ignored for guests).

- **Unauthenticated / non-admin callers** get a **sanitized projection** (never the raw
  document). Only `confirmed` and `pending` bookings are returned (`rejected`/`cancelled`
  are hidden). `confirmed` + `visibility=public` events are returned in full minus
  `contactName`/`contactEmail`/`contactPhone`/`notes`; **private** confirmed events are
  masked (`title: "Private"`) and **pending** events are masked (`title: "Unconfirmed
  booking"`) regardless of visibility. A masked item contains only `id`, `status`,
  `startAt`, `endAt`, `venueId`, `venueName`, `dateBasis`, `hijri`, `title`, `masked: true`
  — no department, contact, notes, visibility or conflict data. Full example:
  ```json
  { "events": [{
      "id": "evt_123", "title": "Diwali Community Night",
      "departmentId": "eo", "departmentName": "Event Organisers",
      "venueId": "main-hall", "venueName": "Main Hall",
      "startAt": "2026-10-12T06:00:00.000Z", "endAt": "2026-10-12T10:00:00.000Z",
      "status": "confirmed", "visibility": "public", "dateBasis": "gregorian",
      "hijri": { "day": 1, "month": 5, "monthName": "Jumada al-Awwal", "year": 1448 }
  }] }
  ```
  A masked item looks like `{ "id": "evt_9", "status": "pending", "title": "Unconfirmed booking", "masked": true, "venueId": "main-hall", "venueName": "Main Hall", "startAt": "...", "endAt": "...", "hijri": { ... } }`.
- **Authenticated admins** get the full document for every matching event (any status/
  visibility), including contact details and `hasConflict`/`conflictWith`.

## `POST /v1/events`

Public (or admin, with an `Authorization: Bearer <token>`) — submits a booking request.

Public and non-admin callers may submit only the active **Events Booking** type.
The server looks up `departmentId` in Firestore; a caller-supplied type name or admin flag cannot bypass this policy. Approved admins may submit any active booking type, including Events Booking. Other public types return `403` before any booking or email is created. The `submitBooking` callable enforces the same policy.
Body: `title`, `departmentId`, `venueId`, `startAt`, `endAt`, `contactName`,
`contactEmail`, optional `contactPhone`, `notes`, `dateBasis` (`"g"`/`"h"`), `hijriDate`,
optional `visibility` (`"public"`/`"private"`).

- `201 { "id": "...", "status": "pending", "hasConflict": false }` — **always created as
  Pending**; an overlap at the same venue is flagged in `hasConflict`/`conflictWith` but
  **never rejected**, per the brief's conflict-handling requirement. Overlap detection
  honours each venue's `bufferHours` (applied only after an *existing* booking's end —
  see docs/DATA_MODEL.md); the buffer never blocks the incoming submission itself.
- `visibility` defaults to `public` for an unauthenticated (public) submission and to
  `private` for an authenticated admin submission if not explicitly given — see
  docs/DATA_MODEL.md's visibility decision. A pending booking is shown publicly only as a masked
  "Unconfirmed booking" item regardless of this flag.
- `400` for missing fields / invalid time range. `404` if `venueId`/`departmentId` don't
  exist.

## `PATCH /v1/events/:id/status`

Admin only. Body: `{ "status": "confirmed" | "rejected" | "cancelled", "visibility"?: "public"|"private", "note"?: string }`.
Confirming an event re-checks for conflicts. `visibility` only changes if explicitly
given; otherwise the booking's existing visibility (set at submission, or by a prior
admin edit) is preserved unchanged — see docs/DATA_MODEL.md's visibility decision. Writes
an audit log entry and best-effort emails the requester.

## `PATCH /v1/events/:id` (via the `updateBooking` callable from the app)

Admin only. General edit of a booking's core fields, including `visibility`
(`"public"`/`"private"`) — an admin may change visibility at any time, independent of
status. Every visibility change is recorded in the audit log.

## Callables (admin only, not exposed under `/v1`)

- `createRecurringBooking` — body: `title`, `departmentId`, `venueId`, `contactName`,
  `contactEmail`, optional `contactPhone`/`notes`, `status` (`confirmed` default | `pending`),
  `visibility` (default `private`), and `recurrence`:
  `{ basis: "gregorian"|"hijri", startDate | hijriStart{day,month,year}, startTime, endTime,
  frequency: "day"|"week"|"month"|"year", repeatEvery (1-100), endMode: "count"|"date",
  count, endDate }`. Expanded server-side in Australia/Sydney civil time (DST-safe). Limits:
  at most 370 occurrences, a 1-year horizon (yearly: 5 occurrences). Overlaps (venue
  `bufferHours` aware) are flagged per occurrence, never blocked. Returns
  `{ seriesId, created, conflicts, status }`.
- `updateBooking` accepts `scope`: `single` (default) | `future` | `all`. For `future`/`all`
  shared fields and the time of day are applied to each occurrence (each keeps its own date);
  changing the date is only allowed for `single`.
- `deleteBooking` `{ eventId, scope }` — hard delete of one occurrence, this and following, or
  the whole series; one audit entry per deleted booking.

### Admin team callables

- `syncAdminAccess` `{}` — any signed-in user; called by the app after every sign-in. Returns
  `{ admin: true, owner }` when the verified email is on `adminAllowlist` (or migrates an existing
  console admin onto it; the owner is always granted), otherwise
  `{ admin: false, reason: "not-listed" | "unverified-email" | "no-email" | "password-disabled" }`
  and the app signs the user out. An owner Google sign-in sets `calendarSettings/auth.passwordLoginDisabled`.
  Audited (`admin.signin` / `admin.migrated` / `admin.signin_denied` / `admin.password_login_disabled`).
- `addAdminEmail` `{ email }` — owner only; adds a normalised email to the list (`already-exists` if present).
- `removeAdminEmail` `{ email }` — owner only; deletes the entry, sets matching `users` docs to
  `role: "revoked"` and revokes refresh tokens. The owner cannot be removed.

Once password login is disabled, every admin callable and `/v1` admin endpoint rejects ID tokens whose
`sign_in_provider` is `password`.

## `GET /v1/availability?venue=<id>&date=<YYYY-MM-DD>`

Public. Returns the busy windows (pending + confirmed bookings) for that venue on that
calendar day, for building an availability view without exposing booking details. These
are the raw booked windows (not extended by the venue's `bufferHours`) — it's an
informational display feed, not the conflict-detection rule used by `hasConflict`:
```json
{ "venue": "main-hall", "date": "2026-10-12", "busy": [{ "start": "...", "end": "...", "status": "confirmed" }] }
```

## `GET /ical`

Public live iCal feed (`text/calendar`) of confirmed events (public ones in full, private ones as
`Private`) and pending ones as `Unconfirmed booking` with `STATUS:TENTATIVE` — no contact,
notes or department data. Subscribe to it from Google Calendar/Outlook. Served by the `icalFeed` function, not under `/v1`.

## Known limitations (MVP)

- No webhooks yet (brief lists them as a near-term follow-on, not MVP-blocking).
- No API-key auth for server-to-server integrations — only Firebase ID tokens for admins.
- No pagination on `GET /v1/events` — fine at MVP data volumes, revisit before it grows.
- No OpenAPI/Swagger document yet; this file is the canonical contract for now.

## Callables added (batch A–H)

| Callable | Caller | Purpose |
|---|---|---|
| `checkSlotConflicts {venueId,startAt,endAt,excludeId?}` | public | `{hasConflict,count}` only; admins also get `conflicts[]` (id,title,status,startAt,endAt,departmentName,contactName,visibility) |
| `previewRecurringBooking` | admin | Same input as `createRecurringBooking`; returns `{count,conflicts,occurrences[]}` without writing |
| `importBookings {rows,dryRun}` | admin | Validates (max 500 rows) and, when `dryRun` is false, writes; returns counts, row errors, warnings |
| `recomputeAllConflicts` | admin | Repairs stored `hasConflict`/`conflictWith` for all venues |

`deleteBooking` now keeps bookings that have already started (single: rejected; series scopes: only upcoming occurrences deleted, `kept` returned).

> importBookings row dates: DD/MM/YYYY (Gregorian or Hijri per the row's `Date Basis` = Gregorian|Hijri, default Gregorian). Hijri rows are stored with `dateBasis: hijri` and `hijriDate`.

Public `submitBooking` and unauthenticated `POST /v1/events` requests must start at least six hours after the current instant (configurable in `functions/calendarPolicy.json`). The server checks the resolved Gregorian start instant after applying the current Hijri adjustment and rejects earlier starts with `failed-precondition`; admins are exempt.

## MWA Programs fields, prayer-time scheduling and admin-only extras

"Departments" are shown as **Booking Type** in the UI, Excel and CSV; the stored field names (`departmentId`, `departmentName`, `departments` collection) are unchanged for API compatibility.

Booking create/update payloads (`submitBooking`, `updateBooking`, `createRecurringBooking`, `POST /v1/events`) accept:

| Field | Type | Notes |
|---|---|---|
| `speakerName` | string ≤ 200 | Optional; shown publicly for confirmed public events |
| `programDetails` | string ≤ 2000 | Optional; shown publicly for confirmed public events |
| `startPrayer` / `endPrayer` | `{key, offset}` or `null` | `key` ∈ `fajr`, `zohrain`, `asr`, `maghreb`, `isha`; `offset` minutes −360…360. Only with `timeMode: "custom"`. The server **recomputes** the start/end instant from prayer times at 81-89 Clifton Ave, Kemps Creek (Jafari method) on the booking's civil date, so client times are not trusted. `null` = fixed time. |

`updateProgramExtras {eventId, patch}` — **admin only**. `patch` may contain `reciters` (`[{name, role, notes}]`), `volunteers` (`[{name, phone, duty}]`) or `expenses` (`[{description, amount ≥ 0, paidBy, notes}]`); lists are capped at 50 entries and each entry gets a stable `id`. Niaz sponsors are managed through approved Niaz assignments and cannot be written as an event extra. Writes audit action `program_extras_updated`. These event-extra fields are **never** included in public projections (`getPublicEvents`, `GET /v1/events` for guests, iCal).

Excel import columns add `Start Type`/`End Type` (`Fixed`|`Variable`), `Start Prayer`/`End Prayer`, `Start Offset`/`End Offset`, `Speaker Name` and `Program Details`. For a `Variable` side the time column is ignored and the prayer (plus optional offset) is used. The legacy `Department` header is still accepted as `Booking Type`.
