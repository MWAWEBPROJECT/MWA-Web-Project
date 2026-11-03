> **Ownership milestone completed — 3 November 2026.** Firebase/Google Cloud and GitHub are now MWA-controlled; Sajjad retains developer access. See [MWA Project - Ownership Transfer Completion Record - 2026-11-03.md](<MWA Project - Ownership Transfer Completion Record - 2026-11-03.md>) for verified owners, roles, billing, security cleanup and remaining items. Earlier migration/pending statements below are historical and superseded by that record.

# MWA ownership transfer — exact execution scope

Prepared 3 November 2026 (Australia/Sydney). Approved and executed: organisation move, billing relink and developer-role replacement. Final permission checks passed; Cloud transfer complete.

## Verified destination
- Existing Firebase project: project-7a4fb531-414f-4ade-88e.
- Source organisation: sajjadzaheer-org (809473382158).
- Destination: muhammadiwelfare.org.au (180131276413).
- Existing Mail Integration project: mwa-mail-integration, already in MWA.
- Destination billing account: 01AC51-93E02A-C0A8F6, open/AUD, under MWA, admin@muhammadiwelfare.org.au has Billing Account Administrator.
- Current source billing account is shared by other personal projects. Relink only this Firebase project, never move the shared billing account. User approves keeping their existing card. No card details will be changed.

## Approved IAM grants — already applied
MWA admin now has permanent Organisation Administrator on MWA. Temporary migration grants expire 3 November 2026 at 20:37:07 Sydney (09:37:07 UTC): policy administrator for MWA admin on MWA, policy administrator for Sajjad on source, project mover for MWA admin on source. Remove these temporary bindings after completion even if they have not yet expired. Both current project Owners remain unchanged.

## Approved policy changes — applied
The project currently has no direct organisation-policy overrides. Preserve the following inherited source settings directly on this project before moving, so migration does not remove existing security restrictions:

| Constraint | Preserved setting |
|---|---|
| compute.restrictProtocolForwardingCreationForTypes | Allow INTERNAL only |
| compute.setNewProjectDefaultToZonalDNSOnly | Enforced |
| iam.automaticIamGrantsForDefaultServiceAccounts | Enforced (prevents automatic broad grants) |
| iam.disableServiceAccountKeyCreation | Enforced |
| iam.disableServiceAccountKeyUpload | Enforced |
| storage.uniformBucketLevelAccess | Enforced |

Temporarily set resourcemanager.allowedExportDestinations on source to allow only under:organizations/180131276413, and resourcemanager.allowedImportSources on MWA to allow only under:organizations/809473382158. Remove these newly created migration policies immediately after the move. They authorise the migration path; they do not themselves move any project. Do not migrate any unrelated project.
No full IAM snapshot needs to be written to disk; retain only non-secret configuration/role summaries needed for the handover.

## Execution and access checks
1. Verify all prerequisites and any pending operations, liens, marketplace dependencies and effective policies before the move. Current MWA effective policies allow IAM member domains, resource locations, Cloud Run ingress and services; no conflicting custom organisation policy was found.
2. Apply the approved bounded policies, move the same project to MWA, and verify parent. Preserve resource identifiers, existing runtime service accounts, deployed application versions and data.
3. Relink only this project to the existing MWA billing account and verify billing enabled.
4. Assign Sajjad suitable project-scoped development/deployment permissions and scoped runtime-service-account usage; verify required permissions. Remove personal Owner only after MWA control and development access work. Do not give Sajjad destination organisation administrator or billing administrator.
5. Check website/public APIs, deployed services and scheduled jobs; identify any workflows requiring user verification rather than sending real bookings/donations/emails. Do not deploy local uncommitted code just to test permissions.
6. Remove temporary policies/grants, verify final IAM/organisation/billing, and update shared handover.

## Outside this Cloud transfer
GitHub remains under SAJ0786; moving it requires an identified MWA GitHub account/organisation. Domain registrar, Stripe ownership, external storage and any other providers require separate inventory and confirmed MWA destinations. Do not describe those as transferred by the Firebase move.

## Execution results
The project parent and billing link are verified as MWA. Six project security policies retained. Temporary allowlists/grants removed. MWA admin is the sole direct project Owner; Sajjad has development roles and scoped runtime actAs. All development permission checks passed. After IAM propagation, negative tests confirmed Sajjad no longer has project IAM management, project delete/move, billing reassignment or direct secret-value access. Website/calendar/public API respond successfully and unsigned admin API returns 401. No application redeployment or payment-card change. GitHub transfer awaits an MWA destination. See the shared handover for exact roles and current checks.

Final check: no temporary migration grants/policies remain; all six security constraints and MWA billing enabled verified. GitHub destination is not created yet (confirmed by user); source-code transfer remains pending. No application code was deployed or changed.

GitHub follow-up, 3 November: destination MWAWEBPROJECT now exists. Transfer of repository ID 1400819702 requested successfully (HTTP 202); awaiting receiving-account acceptance. Keep origin unchanged until new ownership is verified. Local unpublished application work is preserved and not pushed.

Completed: GitHub repository ID 1400819702 now belongs to MWAWEBPROJECT at https://github.com/MWAWEBPROJECT/MWA-Web-Project. SAJ0786 has write collaborator access without admin. Main history verified unchanged, canonical origin updated, local unpublished work preserved. This supersedes the pending GitHub steps above.
