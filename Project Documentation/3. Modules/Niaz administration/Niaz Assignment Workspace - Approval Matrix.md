# Niaz Assignment Workspace — approval brief

**Status:** Proposed for review. This two-list workspace is not implemented. The event-card sponsor search is a separate first-step change.

## Purpose

Give the Niaz Coordinator one workspace to find a public MWA programme and an active Sponsor Directory contact, assign sponsorship, and review an existing assignment. Both sides may support multi-selection, but a save has exactly one side with one selected item.

## Interaction matrix

| Selection | Allowed | Result after Save |
|---|---|---|
| One event + one sponsor | Yes | One approved assignment for that event. |
| One event + several sponsors | Yes | Several assignments for that event; roles become joint unless the coordinator resolves an existing sole sponsor. |
| Several events + one sponsor | Yes | One assignment per event, each shown in a result list. |
| Several events + several sponsors | No | Save stays disabled; coordinator narrows one side to one item. |
| No event or no sponsor | No | Save stays disabled. |
| Already assigned pair | No duplicate | Open that assignment for editing instead. |

## Screen and data matrix

| Area | Proposed behaviour | Source / rule |
|---|---|---|
| Event list | Search title or date; filter month, sponsorship status and audience; select rows with checkboxes. Show title, Gregorian/Hijri date, current sponsors and status. | Only eligible confirmed public MWA programmes from the shared calendar. No private bookings. |
| Sponsor list | Search name, email or mobile; filter Active; select rows with checkboxes. Show name and safe contact summary. | Sponsor Directory; inactive contacts cannot be newly assigned. Contact data stays in admin view. |
| Selection header | Show selected counts and the permitted mode: “1 event → many sponsors” or “1 sponsor → many events”. | Reject many-to-many before a write. Clear each side independently. |
| Assignment settings | Event-only sponsorship by default. Show role, type, additional offers/requests and internal notes before save. | Permanent sponsorship requires a calendar series and explicit selection. No payment is inferred. |
| Existing assignments | Selecting an event displays its approved sponsors, roles and type. Selecting a sponsor displays assigned events. Open one assignment to edit or remove it. | Use current assignment IDs and revisions; preserve audit/history. |
| Conflict review | Preview duplicate pairs, sole/joint conflicts, inactive contacts, changed/cancelled events and stale records. | Do not silently replace a sponsor. Adding a second sponsor requires an explicit joint-sponsorship decision. |
| Save result | Show created, unchanged, skipped and failed rows with reasons, then refresh both lists. | Admin/coordinator assignments are approved immediately; no EOI review queue. Multi-event saves must identify partial success so a retry cannot duplicate records. |
| Access and audit | Niaz management permission required to assign/edit; Niaz read-only permission can view. | All writes use server-side checks and log actor, event, sponsor, prior/new role and time. |
| Mobile | Two switchable tabs, Events and Sponsors, with a persistent selection summary and Save action. | Same rules and result detail as desktop side-by-side lists. |

## Decisions requested before implementation

1. Should a multi-event assignment be limited to **25 events per save**, and a single-event assignment to **25 sponsors per save**, with further selections handled in another operation?
2. When an event has a sole sponsor, should adding another sponsor require a confirmation that changes the existing role to **joint**? Recommended: yes.
3. Should the default assignment type be **This event only**, with Permanent available only when the event belongs to a stable series? Recommended: yes.
4. Should editing a permanent commitment from this workspace affect only the selected occurrence, leaving future-year commitment changes in Recurring Commitments? Recommended: yes.

After approval, implement this as a Niaz Administration workspace using the existing Sponsor Directory, shared programme calendar, Niaz assignment/coverage records and permission checks. Do not copy legacy `events.niazSponsor` into new assignments automatically.
