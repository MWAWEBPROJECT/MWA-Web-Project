# Event merge: implementation matrix

Status: bounded atomic merge deployed on 22 November 2026. Larger merges remain blocked pending a staged migration path.

## Admin workflow

1. Select two overlapping MWA programme bookings on the same day. The server checks the pair again before saving.
2. Choose the booking ID to keep. Enter the combined public title and review its time, venue, audience, speaker and programme details.
3. Review each source's volunteers, reciters, expenses and Niaz sponsorship assignments side by side. Explicitly select what belongs to the surviving programme; unselected operational items are discarded after confirmation.
4. Review event-specific Niaz donations individually. Choose whether each allocation moves to the surviving programme or remains historical without an active event allocation. Preserve every completed payment transaction and its original donor designation in immutable finance history.
5. Transfer existing registration forms, submitted responses, response indexes and event-scoped viewer grants to the surviving event automatically. Their content and submission timestamps remain unchanged.
6. Review pending Niaz EOIs, recurring commitments and event coverage before confirmation. The merge must not silently approve a pending offer or create a new annual commitment.
7. Show a final before/after summary with the retained booking ID, combined title, transferred and discarded counts, and a separate confirmation of permanent deletion of the superseded booking and discarded operational entries.

## Storage decisions

| Data | Merge rule | Retention |
| --- | --- | --- |
| Surviving `events/{id}` | Update title and selected programme fields; keep chosen ID | Keep |
| Superseded `events/{id}` | Remove after all dependencies are reconciled | Delete |
| Booking audit | Record actor, both IDs, decisions and before/after digest | Keep |
| Volunteers, reciters, event expenses | Select individual entries to carry across | Delete unselected operational entries |
| Niaz sponsorships and coverage | Select assignments, rekey to surviving event, resolve duplicates and coverage | Preserve audit; delete unselected active assignments |
| Event Niaz donations | Admin chooses allocation transfer or historical unallocated state | Always retain payment/receipt history |
| Registration forms and responses | Move event references and derived indexes | Always retain submitted responses |
| Event response viewer grants | Move event scope and revalidate allowed forms | Keep valid grants; revoke incompatible grants |
| Recurring series | Keep future recurrence of each source separate; merge one occurrence only | Keep series history |

## Safety gates

- Server checks current permissions for Events & Bookings and each affected admin module. If the actor cannot review a dependency, block the merge with a count and module name.
- Preview carries source revisions or document update timestamps. Save rejects stale reviews and concurrent edits.
- Current release performs the complete merge in one Firestore transaction and rejects more than 320 linked documents or 450 planned writes without changing records. A recoverable, idempotent staged migration is still required for larger merges; do not remove the limit until that path is tested.
- Current atomic transaction conflicts with concurrent event/form writes and rechecks the event at donation checkout creation. A future staged migration must explicitly lock both events and their linked submissions while chunks are moved.
- Check actual venue/time compatibility and third-party clashes after choosing the surviving slot. The merge is not a general conflict override.
- Preserve financial and response audit provenance even when their active event link moves. Never send a cancellation email for the removed booking as though the programme were cancelled. Send a merge notice only after final state is committed and notification policy is defined.

## Implementation dependencies

Calendar: `events`, `auditLog`, conflict refresh and public projection. Website: `registrationForms` and child `responses`, `_registrationInsights`, `_responseViewers`, `niazEOIs`, `niazSponsorships`, `niazEventCoverage`, `niazProgrammeSeries`, `_niazSandboxLedger`, `_niazSandboxAssociations`, `_stripeSandboxDonations`, donation reconciliation and reporting. These paths use event IDs directly and must be updated or intentionally retained as historical provenance.
