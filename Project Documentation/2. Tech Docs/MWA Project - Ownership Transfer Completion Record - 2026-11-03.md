# MWA project — ownership transfer completion record

**Major project milestone: COMPLETED on 3 November 2026 (Australia/Sydney).**

## Maintenance instruction for Codex and GitHub Copilot

Read this record together with the shared handover before changing ownership, billing or developer access. After any such change, update this record and the shared handover with the verified result, date, outstanding work and Git/deployment status. Preserve historical evidence; never present a planned action as completed. Do not store credentials or customer data here.

## Outcome and scope

The existing Firebase/Google Cloud project and existing GitHub repository are now under MWA control. Sajjad retains development access rather than ownership. This was a transfer of existing resources, not a replacement application or database migration. The mailbox integration project remained separate and unchanged. Domain registration, Stripe and other external-provider ownership were outside this transfer.

| Asset | Before | Verified after |
|---|---|---|
| Cloud organisation | sajjadzaheer-org (`809473382158`) | muhammadiwelfare.org.au (`180131276413`) |
| Firebase project | `project-7a4fb531-414f-4ade-88e` | Same ID; project number `178942309467`; ACTIVE |
| Direct project Owner | MWA admin and Sajjad | `admin@muhammadiwelfare.org.au` only |
| Cloud billing account | Previous shared account; identifier excluded from this public record | `01AC51-93E02A-C0A8F6`, MWA organisation, AUD, open; billing enabled |
| GitHub repository | SAJ0786/MWA-Web-Project | [MWAWEBPROJECT/MWA-Web-Project](https://github.com/MWAWEBPROJECT/MWA-Web-Project) |
| GitHub repository ID / visibility | `1400819702` / public | Same ID and public visibility |
| Sajjad GitHub access | Owner through SAJ0786 | Write collaborator; push allowed; admin and maintain false |

MWAWEBPROJECT is an MWA-controlled **personal GitHub account**, not a GitHub organisation. The payment card was not changed: the user expressly accepted retaining their existing personal card. MWA billing-account ownership must not be confused with having an MWA corporate payment card.

## Final cloud access

- MWA admin: sole direct project Owner, permanent MWA Organisation Administrator and destination Billing Account Administrator.
- Sajjad (developer): project roles `roles/firebase.developAdmin`, `roles/cloudbuild.builds.editor`, `roles/cloudscheduler.admin`, `roles/serviceusage.serviceUsageConsumer`, `roles/secretmanager.viewer`.
- Sajjad has `roles/iam.serviceAccountUser` only on the existing runtime/build account `178942309467-compute@developer.gserviceaccount.com`.
- No project-IAM administration or MWA billing-administration role was granted to Sajjad. New API, secret and IAM provisioning remains an MWA-admin responsibility.
- Development roles permit substantial Firebase resource administration. Deploying code as the runtime service account inherently permits that code to use the runtime's data/secret permissions; this is not read-only source access.
- Website Admin Team module permissions, Cloud IAM and Google Workspace permissions remain separate controls.

## Preserved services and security

The website remains https://refreshed.muhammadiwelfare.org.au/ with alias https://mwa-community-web.web.app. Calendar remains under `/calendar/`; the legacy default Hosting site redirects to the main website. Functions remain in `australia-southeast1`. Existing project resources, database and source history were retained. `mwa-mail-integration`, unrelated projects and the old shared billing account were untouched.

Six source security constraints were preserved as direct project policies:

| Constraint | Retained setting |
|---|---|
| compute.restrictProtocolForwardingCreationForTypes | INTERNAL only |
| compute.setNewProjectDefaultToZonalDNSOnly | Enforced |
| iam.automaticIamGrantsForDefaultServiceAccounts | Enforced; prevents automatic broad grants |
| iam.disableServiceAccountKeyCreation | Enforced |
| iam.disableServiceAccountKeyUpload | Enforced |
| storage.uniformBucketLevelAccess | Enforced |

Both temporary migration import/export policies and all three temporary IAM grants were removed and verified absent. Permanent MWA Organisation Administrator access remains. No full IAM/credential backup was written to disk. The user confirmed no paid Marketplace subscriptions; only Firebase/Google Cloud services. Optional Consumer Procurement API enablement was rejected and was not performed.

## Verification evidence and limits

At transfer completion:

- Project parent and enabled destination billing link read back correctly.
- All 33 functions remained ACTIVE and all four scheduler jobs ENABLED.
- All six retained constraints were present; temporary grants and policies were absent.
- All 14 tested development permissions and scoped runtime `actAs` passed.
- After IAM propagation, Sajjad lacked `resourcemanager.projects.setIamPolicy`, `resourcemanager.projects.delete`, `resourcemanager.projects.move`, `resourcemanager.projects.createBillingAssignment` and direct `secretmanager.versions.access`.
- Firebase CLI as Sajjad listed both Hosting sites. Website, calendar and public donation-events endpoint returned 200; unsigned donation-admin endpoint returned 401.
- GitHub stable repository ID resolved to the new owner; collaborator write access was verified. Remote main remained `1f3e7034558e8f4e7218f8f85792b1debdff6bc0`, matching pre-transfer history. Canonical `origin` was updated and `git ls-remote` succeeded.

These were ownership, permission and service checks. No application redeployment was performed as part of the transfer, and no real booking, payment or email was generated. Authenticated application workflows were not comprehensively retested. Separate application releases are documented in the shared handover.

## Local repository and remaining actions

Canonical repository: `C:/Users/sajja/OneDrive - SIZA Family/1. Professional/AI Apps/MWA`.

Clone/remote: `https://github.com/MWAWEBPROJECT/MWA-Web-Project.git`.

At the start of documentation consolidation, local HEAD was `7119c6a` (following `9063c44`); the worktree was clean before documentation edits. The ownership transfer itself did not publish those commits. After explicit user authorisation at 17:15 Sydney, both application commits were pushed successfully and remote main was verified at `7119c6a8fd5af518177cebfd2fd1fa68b301519b`. At 17:22 the user authorised publishing the remaining ownership documentation as well. This publication does not change application deployments, ownership or Cloud access.

- Keep future pushes pointed at the new owner. Do not recreate the old repository path, which would break transfer redirects.
- Other local clones were not inspected; update their remotes when encountered.
- GitHub Apps/Codex/Copilot connector access may require authorisation by MWAWEBPROJECT; this was not reconfigured or verified.
- Review external-provider ownership separately when requested. This record does not certify a Stripe, domain-registrar or other-provider transfer.
- Change the payment method later if MWA wants a corporate card. No card replacement is pending as a prerequisite to this completed transfer.

## Related records

- [Shared Codex / Copilot handover](<MWA Web Project - Codex and Copilot Handover.md>) — authoritative application and operational state.
- [Execution plan and checkpoints](<MWA Ownership Transfer - Execution Plan.md>) — historical sequence; earlier pending statements are superseded by this completion record.
- [Email configuration and ownership guide](<MWA - Email Configuration and Ownership Transfer Guide.md>) — setup reference.
- [Repository guide](<MWA Web Project - Repository Guide.md>).
