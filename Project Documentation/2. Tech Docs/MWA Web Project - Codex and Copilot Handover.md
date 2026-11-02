> **MANDATORY MAINTENANCE INSTRUCTION — CODEX AND GITHUB COPILOT**
> Read this handover before changing the MWA project. After every code, configuration, database-rule, deployment, integration or documentation change, update this same file before handing work back to the user. Record what changed, why, affected files, checks and results, deployment/Git status, outstanding work and the next action. Update it even when work is incomplete or blocked, so another assistant can resume without this chat. Never mark planned work as implemented or an attempted deployment as successful. Keep credentials, donor/customer records and private email contents out of this file. Commit the handover with the associated changes when committing is authorised. Both assistants must preserve these instructions and maintain a single authoritative handover rather than separate competing copies.

# MWA Web Project — Codex / Copilot handover

Last updated: **2 November 2026, Australia/Sydney** by Codex.
Latest application commit verified locally: **b181630** (already pushed to origin/main).
Current task: optional recurring-donation preview controls. Production build and browser checks passed; website-only deployment completed and public HTML verified. Stripe remains disconnected. Do not recursively change this document just to insert its own commit hash.

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
- Member Login/general membership administration and Stripe donations are not completed integrations. Do not describe them as live payment/member systems.
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

**Stripe donations — sandbox created by user; checkout backend and credentials are not connected.** User has Developer access. The donation preview now supports an unchecked recurring opt-in beneath the default one-off donation. Cards, Apple Pay and Google Pay will be through Stripe; no separate Amazon Pay integration requested. Proposed architecture: amount/frequency chosen on MWA website, Stripe-hosted Checkout, Firebase backend and verified webhooks. Use an isolated sandbox first. Do not change keys/settings used by the existing official website.

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
