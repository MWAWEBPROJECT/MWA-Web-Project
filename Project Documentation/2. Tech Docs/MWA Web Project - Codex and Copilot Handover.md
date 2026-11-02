> **MANDATORY MAINTENANCE INSTRUCTION — CODEX AND GITHUB COPILOT**
> Read this handover before changing the MWA project. After every code, configuration, database-rule, deployment, integration or documentation change, update this same file before handing work back to the user. Record what changed, why, affected files, checks and results, deployment/Git status, outstanding work and the next action. Update it even when work is incomplete or blocked, so another assistant can resume without this chat. Never mark planned work as implemented or an attempted deployment as successful. Keep credentials, donor/customer records and private email contents out of this file. Commit the handover with the associated changes when committing is authorised. Both assistants must preserve these instructions and maintain a single authoritative handover rather than separate competing copies.

# MWA Web Project — Codex / Copilot handover

Last updated: **2 November 2026, Australia/Sydney** by Codex.
Latest application commit verified locally: **4e75f9b** (already pushed to origin/main).
Current task completed: sandbox Stripe Checkout connected and deployed, including optional recurring schedules and test email processing. Browser one-off and recurring setup tests passed; all live payments remain disabled. Do not recursively change this document just to insert its own commit hash.

## Start here

1. Read this file, the root AGENTS.md and .github/copilot-instructions.md.
2. Inspect `git status --short` and recent commits; preserve other people's uncommitted work.
3. Use the canonical repository below. Do not edit the archived website or the assistant scratch workspace as though it were production source.
4. Read the relevant source and detailed guide. Older guides contain historical statements; this handover records the current baseline, but verify against code and current deployment before acting.
5. Complete the requested work, run appropriate checks, update this handover and report what is saved, committed, pushed and deployed separately.

## Repository, local folders and deployment

| Item | Value |
|---|---|
| Canonical repository | `C:/Users/sajja/OneDrive - SIZA Family/1. Professional/AI Apps/MWA` |
| Website source | `Website/` |
| Calendar source and booking backend | `Centralised Calendar/` |
| Technical documentation | `Project Documentation/2. Tech Docs/` |
| Git remote | https://github.com/SAJ0786/MWA-Web-Project.git |
| Branch | `main` |
| Public website | https://refreshed.muhammadiwelfare.org.au/ |
| Hosting alias | https://mwa-community-web.web.app |
| Firebase project | `project-7a4fb531-414f-4ade-88e` |
| Functions region | `australia-southeast1` |
| Calendar functions codebase | default; deploy from `Centralised Calendar/` |
| Website functions codebase | `mwa-website`; deploy from `Website/` |
| Legacy Firebase calendar hosting | `project-7a4fb531-414f-4ade-88e.web.app`; redirects to main website |
| Scratch workspace, not canonical code | `C:/Users/sajja/OneDrive/Archieved/Documents/ChatGPT/MWA Project` |

The old eventscalendar custom domain was previously observed inactive/NXDOMAIN. Do not restore it as a separate application without a new request. Keep website and calendar under the same origin for shared sign-in. Previous website code remains isolated in `Website Previous 2026-10-27 124306/` and is not the active application.

The handover and assistant instruction files are tracked in Git. Other technical documents remain local unless explicitly included; do not broadly remove the repository's document/credential ignore rules.

## Current implemented behaviour

- Website: responsive MWA branding/logo and front-building photograph; shared palettes, light/dark/system modes and bounded text-size settings. Calendar inherits website defaults, with visitor overrides. Prayer timetable is presented as operational, not demonstration content. The sun indicator follows Kemps Creek rather than an endless animation. Preserve the common Hijri date source in Calendar Management.
- Public header: Events & Booking is visible to signed-out users; it opens the public calendar. Admin Console is session-aware. Home always returns to the first view.
- Live admin modules: Events & Bookings Hub, Contact & Enquiries, Calendar Management, Tools & Automation, Website CMS. Other module cards are placeholders. Module IDs and labels live in the shared catalog copies in both functions folders; keep them consistent with rules and frontend.
- Member Login/general membership administration are incomplete. Stripe donations run in sandbox only; do not describe them as a live fundraising system.
- Calendar: public submissions can create only Events Booking requests; authorised Events & Bookings admins can use all permitted booking types. Preserve venue buffers, whole-site conflicts, recurring bookings, public/private projections, PDF templates and notification behaviour.
- Calendar Management: shared Gregorian/Hijri reference calendar and monthly Hijri adjustments. Community programmes calendar shows MWA programmes. Do not duplicate Hijri settings per module.
- Appearance fixes: current-date number uses the contrasting on-primary colour; Add Team Member text is white; access editor expands beneath the selected member.
- Admin Team: only verified owner `admin@muhammadiwelfare.org.au` may add/remove members or edit module access and expiry. Other permitted Tools & Automation users can view the list. Existing users lacking explicit module selections retain all 13 baseline selections; new users start with none. Owner has protected full indefinite access. Expiry is inclusive through the chosen Sydney date, ending at next midnight. Backend functions and Firestore rules enforce access, not just UI controls.
- Sign-out: clears local admin state, removes the embedded workspace, broadcasts to other tabs and returns Home. Audit recording does not block logout. Admin Team independently checks the active owner session and clears editing on access loss.
- CMS: approved users with website-cms permission can persist website content and appearance changes.
- Contact & Enquiries: public form creates threads; Events booking mail is a separate system. Enquiry notices go to info@muhammadiwelfare.org.au, dashboard replies use the connected admin Google Workspace mailbox, and customer email replies return to threads. Access is restricted to authorised admin-team members with enquiries permission; resolved/spam states supported. User confirmed mailbox connection and round trip working. Filtering clears a selection no longer in the left pane.
- Social profile links are configured. Tools & Automation can hide/restore selected posts. Automatic social feed ingestion is NOT completed; provider authorisation remains outstanding. Gallery upload storage is NOT provisioned; Cloudflare R2 was discussed, not implemented.

## Booking approval email — latest design

New public booking submissions email Events@muhammadiwelfare.org.au and copy admin@muhammadiwelfare.org.au. Approve/Reject links use `/booking-response`. The user explicitly selected **no sign-in, one confirmation click**.

- Random 256-bit bearer token; only its SHA-256 hash is stored in server-only `_bookingEmailActions` documents.
- Expires after 48 hours, scoped to one booking revision, consumed atomically with the decision.
- GET displays a confirmation page and never changes a booking. POST confirms the action. Do not replace this with approval on GET: email scanners follow links.
- Approval rechecks conflicts inside the transaction. Conflicting submission emails show disabled approval and active rejection. Stale, expired, removed, already-decided and consumed requests are rejected safely.
- Approved requests send the existing requester email plus ICS. Rejections send the existing decision email. The page reports SMTP send failure rather than claiming delivery. SMTP acceptance is not proof of inbox delivery.
- Audit records honestly identify an email-link action, not a signed-in individual. Anyone with the link can act; do not put tokens in docs or forward them outside the intended team.
- Previously delivered emails retain their old authenticated links. Only new submissions get the new links. Arbitrary incoming free-text emails do not create bookings.

Main files: `Centralised Calendar/functions/emailBookingLink.js`, `bookingEmailDecision.js` (older authenticated action), `notifications.js`, `index.js`; hosting rewrite in `Website/firebase.json`.

## Recent releases and evidence

| Commit | Change |
|---|---|
| 4f66748 | Module-scoped admin access, expiry and initial authenticated email decision flow |
| 3f18acf | White Add Team Member text |
| dd827b4 | Inline access editor beneath member row |
| 70c772f | Immediate workspace clearing and Home redirect on logout |
| a834bd8 | Public Events & Booking menu link |
| b181630 | Admin Team render crash fix, contrasting today date, single-use no-sign-in approval links |

The Admin Team blank-page regression was a self-referencing `const canEdit=canEdit...` initializer. It now uses `canManage && session.isOwner`. Production builds alone did not catch this runtime issue; retain the owner/read-only render regression checks.

Latest deployment verification (1 November 2026): both `bookingEmailAction` and `submitBooking` ACTIVE with source hash `817a75f08c325234dd8df471e36639070d0f9404`; hosted `/booking-response` returned the expected invalid-link page without sign-in; deployed calendar assets contained the inline editor and today-contrast changes. No real booking was changed and no live test email was sent during verification.

Latest targeted checks: 2 Admin Team render checks plus 9 email action/decision checks passed. Earlier baseline: 116 calendar backend tests and 19 website/Firestore emulator checks passed before the newest token-link additions. These are dated evidence, not a claim that every possible test was rerun for every change.

## Pending work / next assistant action

**Stripe donations — sandbox Checkout is now connected; see latest checkpoint below. Live payments are NOT enabled.** User has Developer access. The donation preview now supports an unchecked recurring opt-in beneath the default one-off donation. Cards, Apple Pay and Google Pay will be through Stripe; no separate Amazon Pay integration requested. Proposed architecture: amount/frequency chosen on MWA website, Stripe-hosted Checkout, Firebase backend and verified webhooks. Use an isolated sandbox first. Do not change keys/settings used by the existing official website.

Confirmed 2 November: retain current website settings (AUD, five existing funds, suggested $25/$50/$100/$250 and existing amount limits). One-off donation stays default. Donor may explicitly opt into an additional recurring donation BEFORE Stripe checkout, with a separate amount, frequency and first payment date, all explicitly entered/selected. Proposed UI frequencies: weekly, fortnightly, monthly, yearly. The chosen fund applies to both. Never silently copy the one-off amount or preselect recurring consent. First date may be today or a future Sydney date; if today, future Stripe checkout must clearly disclose both charges due today. Preview does not create charges or authorisation. Remaining: securely configure sandbox credentials, build checkout/webhooks and explicit schedule/consent handling, confirm finance/support addresses and receipt wording. Obtain credentials through direct secret-manager entry, NEVER chat or Git. Then implement sandbox integration, provide the exact webhook URL/events, test and separately agree live activation. Finance retains account verification/bank/payout responsibilities. Never imply all donations are tax-deductible without finance-approved wording.

Donation notification requirement confirmed 2 November (NOT implemented yet): after Stripe verifies the one-off payment, email a receipt confirming that payment and, only if recurring setup actually succeeded, its separate amount/frequency/first date. Describe future instalments as scheduled, never already paid. If recurring setup fails, report the one-off success separately and offer setup recovery without duplicating the one-off charge. Send an email reminder two days before each scheduled recurring charge, including the first when lead time allows. If the first date is within two days, the initial confirmation supplies the immediate notice; do not promise a reminder in the past. Stop/recalculate reminders after cancellation or schedule changes; use Sydney dates and idempotent event/reminder handling. Each successful recurring charge gets its own receipt; failed charges get a failure notice. Sandbox email testing must not contact real donors inadvertently.

Other backlog: automatic social ingestion/provider connections, gallery storage/uploads, future admin modules (Niaz, volunteers, members, maintenance, expenses, donations, social media, speakers/reciters), and organisation-owned account transfer if requested. These are not authorisation to implement every backlog item now.

## Build, checks and release reference

Use Node 22 with matching native dependency architecture. This Windows ARM machine previously used x64 Node at:
`C:/Users/sajja/OneDrive/Archieved/Documents/ChatGPT/MWA Project/mwa-build-runtime/node-v22.23.4-win-x64`
Check availability before relying on that machine-specific path. Canonical source is outside the assistant scratch writable root; use the approved escalation workflow when required rather than editing another copy.

From `Website/`:
```powershell
npm run build
node website/admin-team-render.test.mjs
node --test '../Centralised Calendar/functions/emailBookingLink.test.js' '../Centralised Calendar/functions/bookingEmailDecision.test.js'
firebase deploy --only hosting:website,hosting:calendar --project project-7a4fb531-414f-4ade-88e --non-interactive
```
The build produces website `dist/` and embedded `dist/calendar-app/`. Legacy calendar hosting uses `calendar-redirect/`, not another full app. Do not pass a relative calendar outDir carelessly: it resolves against the calendar Vite root.

From `Centralised Calendar/`, choose only relevant backend targets, for example:
```powershell
node --test functions/*.test.js
firebase deploy --only functions:bookingEmailAction,functions:submitBooking --project project-7a4fb531-414f-4ade-88e --non-interactive
```
For website API changes, from `Website/`:
```powershell
node --test functions/*.test.js
firebase deploy --only functions:mwa-website:websiteCmsApi --project project-7a4fb531-414f-4ade-88e --non-interactive
```
Emulator-dependent tests require the Firestore emulator; skipped tests are not passed tests. For permission changes run the relevant rules/emulator checks, including `Website/website/module-access-rules.test.mjs`. Inspect current config before using older emulator commands. Deploy rules from the calendar folder only when changed. Avoid unrestricted Firebase deployment and do not upgrade dependencies incidentally.

After deployment, inspect completion output and live behaviour. A vanished terminal session does not prove success; verify remote function state/assets. Test without modifying real bookings, admin permissions or sending live messages unless the user specifically authorises that test. No secrets in logs or screenshots.

## File map and detailed documentation

- `Website/website/firebase-bridge.jsx`: shared website session, sign-in/out and module mounting.
- `Website/website/calendar-shell.js`: embedded calendar and query forwarding.
- `Website/shared/appearance.js`, `module-access.js`: shared presentation and frontend permissions.
- `Centralised Calendar/src/contexts/AuthContext.jsx`: session and module permission state.
- `Centralised Calendar/src/components/AdminTeam.jsx`, `AdminAccessEditor.jsx`: team UI.
- `Centralised Calendar/functions/moduleAccess.js`, `teamPermissions.js`, `firestore.rules`: server/rules permission enforcement.
- `Website/functions/index.js`, `enquiries-api.js`: CMS, social moderation and enquiry API.
- `Admin Access and Booking Email Actions.md`: detailed current access/email design; later sections supersede the original authenticated-email design.
- `Contact & Enquiries - Detailed Setup Guide.md`: mailbox implementation/setup.
- `MWA - Email Configuration and Ownership Transfer Guide.md`: account migration guidance; not evidence migration occurred.
- Older architecture/workflow files describe plans as well as implemented functionality. Verify each against code.

## Update record — append a concise entry after each task

| Date (Sydney) | Assistant | Change / checks | Git / deployment | Next action |
|---|---|---|---|---|
| 2026-11-02 | Codex | Consolidated current state, recent fixes, Stripe backlog and shared maintenance instructions; checked source, Git status and document links | Documentation-only; included with “Maintain shared Codex and Copilot project handover”; no application deployment | Await Stripe setup choices from user; maintain this file for every subsequent change |

For future entries include blockers and unsaved/uncommitted work explicitly. Keep the current-state sections accurate, not just an ever-growing log. If another assistant made changes, reconcile its entry rather than overwriting it. A local AGENTS.md in the scratch workspace also routes Codex to this canonical handover; it is machine-local, not part of the application repository. Instructions guide assistants when working; this is not an unattended file watcher or a guarantee that an assistant with disabled custom instructions will follow them.

| 2026-11-02 | Codex | User confirmed sandbox created; added explicit recurring opt-in, separate amount/frequency/first-date controls to donation preview, preserving current funds and one-off defaults | Build and browser checks passed: default one-off, separate $50/$20 monthly amounts, 1 December start date and required-date validation. Hosting deployed and live HTML verified; no payment credentials or checkout backend connected | Connect Stripe sandbox securely; implement verified payment confirmation and two-day reminder emails |


### Stripe setup checkpoint — 2 November 2026

- User confirmed sandbox MWA WEB PROJECT, key saved successfully, test notification address admin@muhammadiwelfare.org.au. Secret value was never displayed or saved to source. Sandbox prefix checked and read requests to customers, prices and subscription_schedules returned HTTP 200. No payment/customer was created and no mail sent. Write permissions remain unverified.
- Added pinned stripe 23.1.0 SDK (API 2026-10-28.endive) and bootstrap stripeSandboxWebhook, routed at /api/donations/stripe-webhook. This is deliberately NOT a payment handler: GET returns 405; every POST returns 503 until signed-event processing is implemented. It does not store/acknowledge events or change donations.
- Historical bootstrap checkpoint: STRIPE_SANDBOX_WEBHOOK_SECRET was still required (now saved; see receiver checkpoint below). Never fabricate a placeholder secret or return success for unprocessed payments. Configure Snapshot events on the sandbox account, then bind the secret and implement verified raw-body processing/idempotent checkout, schedules and notifications before accepting payments. Existing donation preview stays unchanged.
- Syntax checks and git diff --check passed. Named function stripeSandboxWebhook and website Hosting deployed successfully. Verified the custom-domain route returns GET 405 and POST 503 with the expected JSON. No financial actions or emails triggered. Changes included in the sandbox bootstrap commit; push recorded by the release operation. Detailed instructions: Stripe - Sandbox Setup Guide.md in this folder.

| 2026-11-02 | Codex | Verified stored sandbox key via three read-only Stripe calls; added locked webhook bootstrap, routing and SDK; saved local Stripe setup guide | Function and website routing deployed, public 405/503 verified; included in sandbox bootstrap commit | User saves webhook signing secret; implement verified payment processing before enabling checkout |


### Signed webhook receiver checkpoint — 2 November 2026

- User saved STRIPE_SANDBOX_WEBHOOK_SECRET; securely confirmed whsec_ format without displaying it. Bound it only to stripeSandboxWebhook via Firebase defineSecret.
- Replaced bootstrap with raw-body Stripe SDK verification and sandbox-only event validation. Supported events are atomically stored under server-only _stripeSandboxEvents/{eventId}; duplicates do not reset status. ACK occurs after durable storage; storage errors return 503 for Stripe retry. Unsupported signed events are ignored. Never log secrets or event bodies.
- This is an intake queue ONLY: status pending, full snapshot retained as JSON string. No worker exists yet; do not enable checkout or describe event receipt as donation fulfilment. Future worker must validate MWA session metadata/account, retrieve current Stripe state, handle out-of-order events, and deduplicate financial/mail actions independently of delivery IDs. Process queued events before accepting donations. Existing default-deny rules do not expose this collection.
- Files: Website/functions/stripe-sandbox.js, stripe-webhook.js, stripe-webhook.test.js. Twelve tests passed (valid, wrong/missing/expired signatures, live-mode rejection, method/configuration, malformed snapshot, unsupported event, storage retry and atomic duplicate handling). Corrected SDK method binding after initial test failure; rerun all 12 passed.
- Named webhook function deployed successfully. Public unsigned request returned 400; a locally signed unsupported configuration probe returned 200/ignored, proving runtime secret binding without storing events, creating payments or sending email. No genuine Stripe-origin event or real Firestore queue write was exercised by this probe. Genuine Stripe-origin delivery still needs checking; local test signatures alone do not prove the saved secret belongs to the configured Stripe destination.

| 2026-11-02 | Codex | Bound saved webhook secret; signed sandbox intake with atomic deduplication; 12 tests passed; public unsigned 400 and synthetic signed 200/ignored verified | Receiver deployed; changes committed and pushed with this handover | Confirm genuine Stripe delivery, then implement checkout, queue worker, schedules and notifications; payments still disabled |


### Sandbox Checkout checkpoint — 2 November 2026

- User explicitly requested connecting Checkout after clarifying sandbox payments move no money. Existing funds, AUD, amount bounds and unchecked recurring opt-in preserved. New frontend module routes to hosted Stripe test Checkout; separate amount/frequency/date and an additional explicit confirmation before saving the card off-session. No live keys accepted. Test email fixed to admin@muhammadiwelfare.org.au; return screen reports server-verified status, not URL success alone.
- Server validates exact cents, allowed funds/frequencies, boolean consent, first Sydney date today through 366 days. First future charge uses 09:00 Sydney with DST; same-day start is immediate after one-off verification. Session creation uses immutable request UUID/data hash, Stripe idempotency and 10/hour IP-hashed rate limit. Private donation/event/mail/limit collections remain default-denied to clients. Status reference is opaque UUID and returns no personal data.
- New functions donationSandboxApi and donationSandboxWorker (every 2 minutes, lease lock). Worker verifies session metadata/amount/currency/test mode using Stripe API, schedules additional recurring price and SubscriptionSchedule only after payment, and uses idempotency keys. Schedule releases into continuing subscription after one interval. Recurring failure records needs_attention and sends one-off success with honest setup warning; no automatic duplicate one-off payment. Reconcile failed setup manually before retry; do not blindly reset attempt timestamps after Stripe's idempotency retention window.
- Emails use connected admin Gmail token, dedicated private outbox and deterministic Message-ID sent-mail check before retries; all messages go to designated admin test mailbox. Confirmation after one-off, recurring invoice receipts/failure notices, reminders two Sydney days before first/subsequent payments. Cancellation/changed next dates suppress queued reminders. Mail/network ambiguity can still require manual reconciliation; no exactly-once external email guarantee. Future live donation recipient handling is intentionally not enabled.
- Stripe API 2026-10-28.endive rejected payment_method_types. Adapted to excluded_payment_method_types for all current non-card enum entries plus wallet_options.link.display=never. Apple/Google wallets remain Stripe-controlled; actual visibility depends on account/device support. Preserve this list when upgrading SDK/API. Actual Checkout create+expire with recurring-consent parameters succeeded. Test customer/price/future schedule create+cancel succeeded; no payment method or charge used in those checks. Configuration-check fixtures are sandbox-only.
- Targeted tests: 26 passed; production website + embedded calendar build passed. donationSandboxApi, donationSandboxWorker and website Hosting deployed. Browser opened actual Sandbox Checkout. First simulated $50 one-off completed, genuine signed Stripe event processed and confirmation outbox status sent (Gmail accepted). No real money charged. Second browser test paid $1 once and scheduled $2 monthly starting 1 December 2026; page showed paid/scheduled and confirmation mail status sent. Cancelled only that assistant-created future sandbox schedule afterwards, so it will not generate ongoing test payments/emails. Both genuine Checkout completion events reached the receiver. No real money moved. Two-day delivery and future recurring invoice receipts remain implemented but not time-advanced end-to-end tested; wallet UI was visible (Apple Pay) but wallets were not charged/tested.
- New files: functions/donations.js, donations-runtime.js, donations-worker.js, donations.test.js; website/donations.js. index.js exports new runtime; firebase.json routes /api/donations/** after the specific webhook route; website/index.html replaces preview CTA with explicit sandbox checkout.

| 2026-11-02 | Codex | Connected hosted Sandbox Checkout, validation/idempotency, verified payment worker, separate recurring schedule, admin-only test mail outbox and reminders. 26 unit tests; production build; two browser payment/setup round trips and Gmail accepted sends verified | API, worker and website deployed successfully; changes committed/pushed with handover | User may test with Stripe test cards. Before live release complete reminder/time-clock and invoice-failure testing, real donor email support, operations/admin reconciliation and finance approval |

Operational limits: sandbox mail recipient is deliberately fixed, cancellation is via Stripe/admin (no donor portal), failed recurring setup needs manual reconciliation, reminder/email delivery is not guaranteed during outages, and no time-clock end-to-end test has been completed. Do not claim production-ready fundraising. Long-lived sandbox rate-limit documents currently have expiry metadata but no automatic TTL policy provisioned; provision cleanup before scale/live release. Historical sections above describe earlier preview/bootstrap milestones; this checkpoint supersedes them.
