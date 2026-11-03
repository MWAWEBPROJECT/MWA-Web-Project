> **Ownership milestone completed — 3 November 2026.** Firebase/Google Cloud and GitHub are now MWA-controlled; Sajjad retains developer access. See [MWA Project - Ownership Transfer Completion Record - 2026-11-03.md](<MWA Project - Ownership Transfer Completion Record - 2026-11-03.md>) for verified owners, roles, billing, security cleanup and remaining items. Earlier migration/pending statements below are historical and superseded by that record.

> Historical repository guide. For current state and assistant handover, read [MWA Web Project - Codex and Copilot Handover.md](<MWA Web Project - Codex and Copilot Handover.md>). Contact enquiries are live, prayer times are not labelled demonstration, and the public calendar now opens through the main website.

# MWA Web Project

The Muhammadi Welfare Association website and central Events & Bookings Calendar share one Firebase project, one admin identity system, and one appearance library.

- [Community website](https://mwa-community-web.web.app)
- [Admin Login](https://mwa-community-web.web.app/admin-login)
- [Website CMS](https://mwa-community-web.web.app/cms)
- [Calendar with the website's sign-in session](https://mwa-community-web.web.app/calendar/)
- [Key Islamic Events](https://mwa-community-web.web.app/islamic-events/)
- [Existing calendar address](https://eventscalendar.muhammadiwelfare.org.au)

## Repository ownership

Canonical remote: `https://github.com/MWAWEBPROJECT/MWA-Web-Project.git`. MWA account `MWAWEBPROJECT` owns the existing public repository; `SAJ0786` has write access without repository administration. Transfer preserved repository ID and history. Local commits are not automatically pushed by a transfer. See the shared handover for current release/publication state.

## Source folders

`Website/` contains the new community website, CMS function, shared colour palettes, appearance library and multi-site hosting configuration. `Centralised Calendar/` contains the existing React calendar and its booking services, rules and functions. The calendar imports the appearance library from its sibling Website folder. Keep these folder names when cloning.

Member Login and the website's donation/contact/membership forms remain prototype demonstrations. Admin Login reuses the existing calendar admin accounts. The prayer timetable remains a sample. The website programme panels and calendar use confirmed live MWA Programs.

## Local development and publishing

Use Node.js 22 with dependencies installed for the same processor architecture as Node. Windows ARM users should keep their Node and installed native build-tool architectures consistent.

Install dependencies in both folders with `npm ci`. Copy `Website/.env.example` to `Website/.env.local` and `Centralised Calendar/.env.example` to `Centralised Calendar/.env`, using the Firebase web configuration for project `project-7a4fb531-414f-4ade-88e`. Environment files are deliberately excluded from Git.

From Website, `npm run dev` starts the website. `npm run build` builds the website, its mounted calendar and the standalone calendar. `npm run deploy` publishes only the two hosting targets. For CMS deployments, first run `npm --prefix functions ci`, then `firebase deploy --only functions:mwa-website --project project-7a4fb531-414f-4ade-88e`. Existing booking backend deployments remain separate; do not run an unrestricted Firebase deploy.

Publishing website content also publishes shared appearance defaults. Visitors may choose a local palette or light/dark/system setting, or reset to website defaults. Website admin sign-in is shared with `/calendar/` on the same origin; browsers keep sessions on the older calendar domain separate.

## Verification

The current source snapshot includes the existing calendar improvements that were already present locally, followed by the website/appearance integration. All 48 calendar utility checks and five CMS validation checks pass. Production bundles were built and deployed; public calendar access, anonymous CMS write rejection, the admin entry, shared visitor preferences, and 320px/390px layouts were checked. Actual Google account sign-in requires verification by the account holder.

Previous website code, calendar appearance backups, project documents, secure documents, local settings, dependency folders and build outputs remain local and are excluded from this repository. See each application's README and calendar docs for implementation details.

The website header provides Home, shared appearance controls, and session-aware Admin Login / Admin Sign out. Its Admin Console presents 12 modules with icons; Events & Bookings Hub, Calendar Management, Tools & Automation, and Website CMS are live. Key Islamic Events is a separate website page. The calendar remains beneath the shared website header, with booking functionality preserved.

Public booking policy: guests and non-admin accounts may create only **Events Booking** requests. Signed-in approved admins may create any active booking type, including Events Booking. This is enforced by the booking form and both server submission routes (`submitBooking` and `POST /v1/events`), using the stored department record. Existing bookings and public calendar visibility are unchanged.


### Public website refresh — 28 October 2026

The public header has matched Home/member/admin controls, icon navigation, a compact Appearance button, and a separate donation strip. Public navigation uses What’s on; Events & Booking and Admin Console links appear only for approved admins. The footer uses community and verified social account links; CMS remains hidden unless authorised. School, Venue Booking and the new CMS-editable Tutoring panel share a keyboard/swipe carousel. Prayer timetable demonstration labels were removed at MWA’s request; the existing CMS-managed times were not recalculated by this release.

Tools & Automation → Social posts provides persistent hide/restore controls for the website’s existing selected Facebook posts. GET/PUT `/api/social-moderation` requires the existing approved-admin session; PUT also validates origin and content type. Hidden post IDs are stored in `calendarSettings/socialModeration` and changes and verified actors are written atomically to the audit log. Website visitors receive the visibility changes through the shared settings watcher. No live post visibility was changed during release testing.

Facebook, Instagram, TikTok, YouTube and Linktree profile links are configured, but automatic social ingestion is not connected. Provider app setup/account authorisation (and an Instagram professional account) remains necessary before replacing selected posts with automatic feeds. Future ingestion must retain stable canonical post identities and apply the same visibility list. Gallery upload storage has not been provisioned; Cloudflare R2 is the proposed low-cost object store, with Cloudinary or existing hosting as alternatives.
