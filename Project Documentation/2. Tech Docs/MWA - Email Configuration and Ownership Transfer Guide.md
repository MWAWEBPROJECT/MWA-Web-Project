> **Ownership milestone completed — 3 November 2026.** Firebase/Google Cloud and GitHub are now MWA-controlled; Sajjad retains developer access. See [MWA Project - Ownership Transfer Completion Record - 2026-11-03.md](<MWA Project - Ownership Transfer Completion Record - 2026-11-03.md>) for verified owners, roles, billing, security cleanup and remaining items. Earlier migration/pending statements below are historical and superseded by that record.

# MWA — Email Configuration and Ownership Transfer

Prepared 29 October 2026, Australia/Sydney.

This is a setup and handover guide. No ownership, billing or mailbox-authorisation changes were performed while preparing it.

## Confirmed current setup

| Item | Current value |
|---|---|
| Firebase / Google Cloud project | `project-7a4fb531-414f-4ade-88e` |
| Current parent organisation | `muhammadiwelfare.org.au` (`180131276413`) — transferred and verified 3 November 2026 |
| Website | https://mwa-community-web.web.app |
| Enquiry dashboard | https://mwa-community-web.web.app/enquiries/ |
| Repository | https://github.com/MWAWEBPROJECT/MWA-Web-Project |
| Enquiry sender and reply mailbox | `admin@muhammadiwelfare.org.au` — dedicated Google sign-in |
| Team notification recipient | `info@muhammadiwelfare.org.au` |
| Current email activation status | Mailbox connected; user confirmed enquiry email round trip working |

The user has confirmed access to the MWA Google Workspace Admin console. Workspace administration, Google Cloud IAM permissions and the website's Admin Team list are three separate access controls. Having one does not automatically grant the other two.

## Recommended order

First establish MWA-controlled Google Cloud access and create the mailbox OAuth client there. Connect and test email. Then transfer the existing application project, billing, repository and operational documents. This avoids waiting for a full project migration before enabling enquiries, while ensuring the mailbox client is MWA-owned from the outset.

The mailbox OAuth project can be separate from the application Firebase project. It holds the Google connection configuration, not another copy of the website or database. Keep existing website Google sign-in settings unchanged.

## Part A — Connect email

### 1. Check the MWA organisation

Sign into https://admin.google.com with an authorised MWA Workspace administrator and confirm you can manage the `muhammadiwelfare.org.au` domain. Then open https://console.cloud.google.com using an MWA-managed identity.

Open the project/organisation selector. Identify the organisation associated with MWA's Workspace domain. If it is absent, or creating a project is denied, have the Cloud organisation administrator grant the appropriate Cloud permissions. Do not select `sajjadzaheer-org` for the new MWA-owned mailbox project. Workspace administrator access alone is not proof of Cloud project-creation permission.

### 2. Create a dedicated mailbox integration project

In Google Cloud, choose the MWA organisation and create a project named `MWA Mail Integration` (the project ID must be unique; accept a suitable generated ID). Confirm the selected organisation/location is MWA. Do not create another Firebase database or hosting site for this project.

Under **APIs & Services → Library**, find **Gmail API** and enable it in this new project. Gmail API was enabled in the existing application project during implementation, but a separate OAuth project needs its own API enablement.

### 3. Configure the consent screen

Open **Google Auth Platform → Branding**, then **Get started** if needed. Suggested values:

| Field | Value |
|---|---|
| App name | MWA Enquiries Mailbox |
| User support email | Select the available MWA-managed address, preferably admin@muhammadiwelfare.org.au |
| Audience | Internal, for the MWA Workspace organisation |
| Developer/contact email | An MWA-controlled address monitored by the administrators |

Review and accept Google's applicable terms yourself. Internal applies to authorising the mailbox; visitors can still submit the public contact form without Google sign-in. Do not change the audience of the existing website authentication project.

If Internal is unavailable, confirm the project belongs to MWA's organisation before proceeding. External Testing is not a permanent configuration: its Gmail refresh token normally expires after seven days. External production use may require verification or an applicable exception and Workspace approval. See [consent setup](https://developers.google.com/workspace/guides/configure-oauth-consent), [token expiration](https://developers.google.com/identity/protocols/oauth2) and [restricted-scope exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

### 4. Set the requested Gmail permissions

Under **Google Auth Platform → Data Access**, add/select these scopes where the console provides scope configuration:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
```

Read-only access lets the worker retrieve replies; send access lets it email visitors and notify info. The code imports only messages associated with tracked enquiries, although the Google permission itself covers the mailbox. This integration does not need domain-wide delegation, an SMTP password or a service-account JSON key.

### 5. Create a Web application OAuth client

Open **Google Auth Platform → Clients → Create client**. In some console layouts this is **APIs & Services → Credentials → Create credentials → OAuth client ID**.

Choose **Web application**, named `MWA Enquiries Dashboard`. Under **Authorised redirect URIs**, add exactly:

```
https://mwa-community-web.web.app/api/enquiries/oauth/callback
```

The callback is a server endpoint. No JavaScript origin is required by this server-side flow. Do not substitute the home page or add a trailing slash to the callback.

Create the client and download its JSON configuration while the secret is available. The dashboard expects the downloaded Web application client JSON containing a `web` object and the callback in `redirect_uris`. An API key or service-account JSON will not work. Store the file securely; do not commit it to Git or put it in general shared Tech Docs. See [Google's credential instructions](https://developers.google.com/workspace/guides/create-credentials) and [server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

### 6. Approve access in Workspace if required

In https://admin.google.com open **Security → Access and data control → API controls → Manage App Access**. Menu wording can vary. Add/configure the app using its full OAuth client ID. Apply access to the admin mailbox's appropriate organisational unit/group and permit the two requested Gmail scopes using the most limited available policy that works. Broad trust for unrelated apps is not required.

If existing Workspace policy already permits this internal app, additional approval may be unnecessary. If Google says the administrator blocked access, resolve the app policy here rather than changing the website login. [Workspace app access guidance](https://knowledge.workspace.google.com/admin/apps/control-which-third-party-and-internal-apps-access-google-workspace-data).

### 7. Connect from the MWA dashboard

1. Open https://mwa-community-web.web.app/admin-login and sign in as `admin@muhammadiwelfare.org.au`.
2. Open **Contact & Enquiries → Mailbox connection**.
3. Select the OAuth client JSON using the file chooser. Wait for the configured state.
4. Select **Connect admin mailbox with Google**.
5. Choose exactly `admin@muhammadiwelfare.org.au`, and approve both Gmail permissions.
6. After Google returns you to the website, open **Mailbox connection** again and verify **Connected**. Allow a few minutes for **Last incoming sync** to update.

The application only allows this owner email to configure the connection. Other listed admins can handle enquiries after connection. No connection to the info mailbox is required: it only receives notification emails. Ordinary members have no enquiry access.

### 8. Test the complete conversation

Use a separate email address you control as the visitor; do not use the admin mailbox as the test visitor because self-sent messages are excluded to prevent loops.

1. Submit the website Contact Us form and note its reference.
2. Check that the dashboard has the thread and info receives the notification.
3. Open the notification button. Confirm authentication is required and it opens the intended thread.
4. Reply from the dashboard. Check delivery status and confirm the visitor receives the response from admin.
5. Reply from the visitor's email. Confirm it appears in the same dashboard thread and info receives another notification.
6. Mark Resolved, then send another visitor reply: it should reopen.
7. Mark Spam, then send another reply: it should remain suppressed without notifying info.

The worker runs approximately every two minutes; the open dashboard refreshes every 30 seconds. Email acceptance by Gmail does not guarantee inbox placement. Check spam folders when testing. Incoming attachments stay in Gmail; the dashboard lists their filenames.

### Common setup problems

| Symptom | Check |
|---|---|
| `redirect_uri_mismatch` | The exact callback above must be in this client's authorised redirect URIs and downloaded JSON. |
| Internal option missing / `org_internal` | Project organisation and the Google account's Workspace organisation must match the intended MWA setup. |
| App blocked | Review Workspace API controls for this client ID and the admin account. |
| Connection returns failed | Correct mailbox, both requested scopes, valid Web client JSON and a fresh connection attempt from the dashboard. |
| Connection expires after a week | Check for External Testing; use a suitable organisation/production configuration. |
| Replies queued | Check Connected, Last incoming sync and mailbox errors; allow a scheduled run. |
| Email accepted but not received | Check recipient/spam/quota issues in Gmail; the dashboard does not parse delivery bounces. |

The older calendar SMTP notification configuration is separate. Connecting this enquiry mailbox does not automatically replace the calendar's existing SMTP secrets or notification functions. Review those separately during handover; no passwords should be stored in the technical documentation.

## Part B — Transfer full project ownership to MWA

### 1. Establish the destination accounts

Choose MWA-managed Google identities for two responsible technical administrators, a finance/billing contact, and a GitHub organisation controlled by MWA. Use named accounts and appropriate recovery/MFA arrangements; the mail-sending account does not need to be everyone's shared Cloud administrator account.

Identify the MWA Google Cloud organisation ID and its billing account. Verify the selected organisation belongs to MWA rather than assuming it from an email address. Adding an MWA project Owner grants access but does not remove the existing parent organisation's control. The current parent is `sajjadzaheer-org`, so this is an organisation-to-organisation transfer.

### 2. Prepare the handover

Record the project ID, both hosting sites, functions and scheduler jobs, service accounts and IAM bindings, Firebase Auth settings, Firestore rules/indexes, secrets inventory (names only), OAuth clients, custom domains and any external services. Make a database backup/export and preserve code and deployment configuration in MWA-controlled storage.

Check destination organisation policies before moving. In particular, public web/API invocation, permitted IAM domains, deployment permissions and service accounts must still support the existing application. Record any inherited source permissions that need replacement. Plan a controlled validation window; do not promise a zero-risk move.

### 3. Grant and validate MWA access

Have the current project administrator add authorised MWA technical administrators through **Google Cloud → IAM & Admin → IAM**, with the roles appropriate to their responsibilities. Verify they can open the existing project in Firebase and Cloud consoles. This is a staging step, not the complete ownership transfer. Keep working source administrator access until destination access and deployment have been tested.

### 4. Move the existing Cloud/Firebase project

Use the existing project `project-7a4fb531-414f-4ade-88e`; do not rebuild it under a new Firebase project ID merely to change ownership. Firebase and Google Cloud share the project and resource hierarchy. [Firebase project relationship](https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project).

The migration operator needs permissions on both organisations. Current Google guidance lists Project IAM Admin on the project, Project Mover on its source parent, and Project Creator on a destination organisation (or Project Mover on a destination folder). Organisation Policy administrators must allow the required source export and destination import. Use Google's current migration checklist rather than broad blanket role grants.

After prerequisites and move analysis are complete, move the project using the Cloud resource management interface or the documented CLI operation, with the verified MWA organisation ID. No command should be run with a guessed destination. Recheck the parent after the move. [Migration procedure](https://docs.cloud.google.com/resource-manager/docs/perform-migration) and [project migration overview](https://docs.cloud.google.com/resource-manager/docs/project-migration).

Keeping the same project should preserve its existing resources and identifiers, including hosting addresses; there is no planned copy of booking data or user accounts. Inherited policies can nevertheless affect operation and must be tested. Recheck any Internal OAuth clients belonging to the moved project because their organisation audience may change. A mailbox client created directly under MWA in Part A avoids moving that client's organisation later.

### 5. Transfer billing separately

In Cloud Billing, link the application project to MWA's authorised billing account and verify payment responsibility and billing permissions. Moving a project between organisations does not automatically change its billing account. Keep billing enabled throughout, because the deployed functions depend on the project's paid-service configuration. Set MWA billing contacts and budget alerts; alerts are notifications rather than automatic spending caps. [Billing after migration](https://docs.cloud.google.com/resource-manager/docs/perform-migration).

### 6. Transfer the GitHub repository

Create or select an MWA-controlled GitHub organisation. From `SAJ0786/MWA-Web-Project`, open **Settings → General → Danger Zone → Transfer ownership**, select the verified MWA organisation, and complete GitHub's confirmation process. The operator needs repository admin rights and permission to create repositories in the destination; the destination cannot already contain a conflicting repository.

Then update local Git remotes and review collaborators, Actions permissions, deployment credentials, webhooks and branch policies. Git history transfers, and GitHub normally redirects the previous repository URL. Existing secrets/deploy keys can remain associated, so review them rather than assuming the transfer removed personal access. [GitHub transfer instructions](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository).

### 7. Hand over other assets

| Asset | Handover action |
|---|---|
| Domain registration and DNS | Confirm registrar/hosting ownership, renewals, recovery contacts and MWA access. Existing DNS records should remain unless a separate domain change is planned. |
| Existing WordPress/cPanel website | Treat its hosting, credentials, backups and billing separately from Firebase. |
| Google Workspace | Confirm mailbox ownership, super-admin recovery and organisation app approvals. |
| Project documentation and files | Copy the project documentation, source assets and operating notes to an MWA-owned shared drive. The current OneDrive location is not proof of MWA-controlled storage. |
| Email/service secrets | Inventory existing calendar SMTP and other integrations; replace personal credentials with MWA-controlled credentials as appropriate, and validate each dependent service. |
| Other connected platforms | If used, transfer Analytics/Search Console, gallery storage, social integrations and automation accounts to MWA-controlled administrators. |

### 8. Validate, then remove unneeded personal control

Test public website and calendar, public booking submission, approved-admin login, CMS publishing, shared appearance, Hijri dates, enquiry submission/reply loop and scheduled jobs. Confirm an MWA-controlled administrator can deploy a harmless change and access operational logs. Review cross-project integrations and support contacts.

Only after successful checks should MWA remove temporary migration permissions and unneeded personal IAM/repository access, or retain an explicitly agreed developer role. Keep at least two authorised MWA administrators with verified recovery access.

## Information needed before an actual transfer

- MWA Cloud organisation ID and authorised migration administrator.
- MWA technical administrator identities and billing account/contact.
- MWA GitHub organisation name.
- MWA-controlled document storage location.
- Current registrar/DNS/hosting account owners.
- Decision on whether Sajjad retains developer access after handover.

No passwords, client secrets or private keys are needed in chat. Owner sign-in, OAuth consent and billing confirmation should be completed by the authorised account holders.

## Custom website address and JSON upload (29 October 2026)

The API now accepts the verified hosting domain `https://refreshed.muhammadiwelfare.org.au` as well as the Firebase website addresses. The file selector retains the selected JSON and displays upload success or failure beside it. A disabled Connect button means the server has not yet confirmed a saved configuration.

Google OAuth still uses the callback registered in this guide at `mwa-community-web.web.app`. Starting Connect from the custom domain therefore first opens the Firebase website's Mailbox connection screen. Sign in there as the owner if prompted, then click Connect again. The saved configuration is shared; no second upload is required. Keeping the OAuth start and callback on the same host preserves the secure state cookie. Once connected, admins can use the custom domain normally.
