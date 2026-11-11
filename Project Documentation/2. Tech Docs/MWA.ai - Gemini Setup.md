# MWA.ai — Gemini setup and activation

Status: deployed on 11 November 2026. User confirmed their normal browser receives an answer and an Open Niaz donation form button for the Niaz donation request. Canonical release/acceptance status is in the Codex and Copilot Handover.


## Activation configuration — 11 November 2026

- Model: `gemini-3.5-flash-lite`, global endpoint. Six actual non-sensitive model checks passed: Niaz donation, Niaz sponsorship, booking, Will Form, anonymous donations sign-in continuation, permitted-admin donations navigation. Admin case uses synthetic module context, not real donor records or a real sign-in session.
- Runtime: existing `178942309467-compute@developer.gserviceaccount.com`, explicitly pinned in mwaAiChat. No new service account or developer impersonation grant.
- Additional role: project custom role `mwaAiInference` containing **only** `aiplatform.endpoints.predict`, bound to that runtime. Existing Firestore permissions unchanged. Because the runtime is shared, this inference permission also applies to other functions using it; revisit dedicated identity isolation with a separately reviewed IAM plan.
- The original proposal to create a dedicated runtime with Vertex AI User/Datastore User and a developer act-as binding was rejected by automatic approval review as broader than the general setup approval. None of that rejected command ran. The narrower inference-only alternative succeeded.
- TTL ACTIVE for `_mwaAiUsage.expiresAt`; usage counters expire after 48 hours, with asynchronous deletion.
- Runtime env: MWA_AI_ENABLED=true, MWA_AI_MODEL=gemini-3.5-flash-lite, MWA_AI_LOCATION=global. Website/.env.local: VITE_MWA_AI_ENABLED=true; existing App Check key retained. Environment files stay Git-ignored. No API key used.
- Supported-model reference: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite (GA; documented retirement 21 July 2027 or later). Verify again before model changes.

## Site-wide scope

The three form examples below are examples only. The catalogue covers the main public sections, named resources, donation funds, appearance, social updates and every live admin permission. A coverage test fails when a new live admin permission has no entry. When adding or renaming a public feature, update mwa-ai-catalog.json and verify its destination; this is not automatic crawling. Planned modules have no actionable link.

For protected tasks, unsigned-in users receive a sign-in button carrying an exact allowlisted return destination. After authentication, the existing module guard enforces access. Signed-in users without access receive guidance to contact the Super Admin. This does not grant permissions or send private records to Gemini.

## User experience

“I want to donate for Niaz” offers Open Niaz donation form, with the Niaz fund selected. “Sponsor Niaz for my event/majlis” opens sponsorship programme selection. “Book an event” opens the booking modal and its existing verification step. Ambiguous requests ask whether the user means money, sponsorship or venue booking. The assistant guides; the user enters details and submits. Live event selection, document ingestion and record-changing agent tools are not implemented.

## Cloud preparation

Use project `project-7a4fb531-414f-4ade-88e` in MWA Google Cloud (not the separate mail-integration project).

1. Enable `aiplatform.googleapis.com` using an account authorised to enable services. Review billing and configure an appropriate Cloud Billing budget alert; alerts do not stop spending.
2. Choose a currently supported Gemini text model with GenerateContent and JSON structured output in the selected region. Validate with a short non-sensitive test. Do not default to retired Gemini 2.5 Flash-Lite (retirement documented as 20 October 2026). Model remains mandatory configuration, not a hardcoded obsolete fallback.
3. Use a dedicated runtime service account where practical; grant Vertex AI User (`roles/aiplatform.user`) and only the Firestore access required for CMS/module-grant reads and `_mwaAiUsage` transaction writes. Set that service account on `mwaAiChat` before deployment if using a dedicated identity. The current function declaration uses the project's default runtime identity until configured; identify it rather than assuming the developer login is the runtime identity. Do not download service-account JSON keys or put credentials into browser code. Existing Firebase Admin Application Default Credentials obtain an OAuth access token.
4. Configure Firestore TTL for collection group `_mwaAiUsage`, field `expiresAt`. Counts contain UTC date, totals, timestamps and a day-scoped address hash; they contain no chat text/raw IP. TTL deletion is asynchronous. Existing rules implicitly deny this unmatched collection to all web clients.
5. Set server environment in Website/functions/.env.project-7a4fb531-414f-4ade-88e: `MWA_AI_ENABLED=true`, `MWA_AI_MODEL=<verified-supported-model>`, `MWA_AI_LOCATION=global` (or a supported region). Cloud Functions supplies GCLOUD_PROJECT. Using global does not guarantee processing stays in Australia; agree regional requirements before enabling. No API key is required.
6. Set `VITE_MWA_AI_ENABLED=true` in Website/.env.local. Keep the existing App Check Enterprise site-key configuration. Verify the actual web app/domain is registered in Firebase App Check; `mwaAiChat` always enforces App Check. Do not weaken enforcement to make testing pass.
7. Rebuild Website (`npm run build`), deploy `functions:mwa-website:mwaAiChat` and `hosting:website` from Website. No Calendar backend deployment is required; embedded Calendar navigation changes are in the Website build. Deploy backend first. Do not deploy other functions just because the export shares index.js.
8. Test from the real registered website browser using non-sensitive questions: Niaz donation, event sponsorship, ambiguous “sponsor my event”, venue booking, resources, unavailable task. Confirm anonymous users receive sign-in continuation buttons rather than direct protected module buttons, permitted admins see only their assigned modules, and sign-out clears the chat. Verify direct-form navigation does not submit or skip verification. Check failure/limit handling and mobile keyboard/layout. Then record source/release identifiers in the shared handover.

## Limits and privacy

Application limits: 30 requests per network address per UTC day, 4 seconds between requests, 500 requests project-wide per UTC day, 1,000-character questions, eight prior messages each at most 2,000 characters, 2,048 maximum output tokens. Failed provider requests count toward the cap. Shared networks share the visitor cap. These bounds do not constitute a precise dollar budget, and Cloud Function/Firestore costs are separate. Adjust through reviewed source changes.

Conversations stay in page memory and are cleared on navigation/reload/account or module-grant changes. Our app writes only usage counters, not transcripts. Google receives submitted messages and supplied public content; review Google Cloud data governance/logging settings before activation. Private enquiries, payments, member details and registration responses are never fetched for the assistant. Prompts and generated text are still probabilistic: monitor useful task completion without collecting private chat transcripts by default.

## Verification and rollback

Local: `node --test Website/functions/mwa-ai.test.js`; browser driver C:/Users/sajja/AppData/Local/Temp/mwa-ai-browser.cjs; build Website. Local mocks verify mechanics, not Gemini's intent quality.

To stop provider usage, set MWA_AI_ENABLED=false and redeploy the single callable. To hide the launcher, remove/disable VITE_MWA_AI_ENABLED, rebuild and deploy Website Hosting. Existing forms continue to work. Do not delete operational booking/donation records or disable their functions.

## Official references

- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-multimodal
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite

Model availability, pricing and IAM setup must be verified at activation time.


## Initial limitations and review backlog — approved 11 November 2026

User explicitly requested recording these restrictions for later review. Activation/deployment/push and non-sensitive provider tests are now authorised. Final activation status is in the canonical handover.

| Area | Initial implementation | Revisit later |
| --- | --- | --- |
| Site-wide use | 500 reserved requests per UTC day across all users | Review actual usage and cost before increasing; not a currency cap |
| Visitor limit | 30 per network/IP per UTC day, with 4 seconds between requests | Shared home/office/mobile networks share the quota; consider privacy-preserving signed-in quotas |
| Day boundary | UTC midnight, 11am Sydney during daylight saving and 10am during standard time | Change deliberately if Sydney-midnight reset is preferred |
| Failed requests | Provider failures consume a reserved request | Consider selective refunds without allowing retry abuse |
| Question size | 1,000 characters | Review user needs before increasing |
| Conversation context | Last eight messages, each up to 2,000 characters | Longer context or summarisation after privacy/cost review |
| Model output | 2,048 output-token ceiling and 2,000-character accepted answer; concise-answer instruction | Measure truncation and adjust if needed |
| Availability | Two function instances, ten concurrent requests each; 25s provider / 40s function timeout | Monitor latency and demand; temporary failures show fallback guidance |
| Knowledge | Curated public facts and 62 navigation/task entries; all live admin permissions covered | Add new public pages/features to the catalogue as they launch; not automatic crawling |
| Live information | Guides to live pages for prayer times, events and donation records | Add narrowly scoped verified lookups only if required; never guess values |
| Documents | Locates resource links, does not read PDF/document contents | Approved document ingestion with versioning and citations |
| Actions | Opens forms/modules; never submits, approves, cancels or makes payments | Separate confirmed-action design and audit trails if later authorised |
| Permissions | Anonymous protected requests go to login with allowlisted return target; signed-in unassigned users get access guidance | Extend event-scoped volunteer routing only within existing assignments |
| Chat retention | Page-memory only; clears on navigation/reload/sign-out/access changes | Optional opt-in continuity after retention/privacy review |
| Provider processing | Messages and selected public context sent to Gemini; no private records fetched | Review provider governance and regional residency; global endpoint is not Australia-only |
| Abuse | App Check, bounded inputs, transactional usage limits; no arbitrary tools or URLs | Monitor attacks; App Check is not a guarantee that every caller is human |
| Usage storage | Hashed daily network identifier and counts; expiresAt after 48h | TTL deletion is asynchronous; verify policy enabled |
| Financial data | Donation module is currently sandbox; assistant does not change this | Update catalogue when a separately authorised live-payment release happens |
| Model maintenance | Verify current supported model at activation | Review retirement dates, response quality and pricing periodically |

Limits are currently source constants in Website/functions/mwa-ai.js; activation/model/location are environment settings. Frontend visibility is VITE_MWA_AI_ENABLED. No control panel for these limits exists yet. Rebuild/redeploy the affected component after any change, and update the canonical handover.


## Deployment acceptance and browser attestation

Released function: mwaAiChat, ACTIVE revision mwaaichat-00001-qav. Source implementation c0782ec; guest-session follow-up 847ed97. Final Hosting served 71/71 files identical to the tested enabled build, with main/Niaz/admin/embedded-calendar route checks returning 200. 20/20 focused regression tests passed; six direct Gemini model checks passed. Google rejected the automated Chromium browser's App Check exchange (403 App attestation failed), and the callable correctly returned 401 with no token. This does not prove normal users are blocked or that the runtime-to-Gemini path has passed. A human-browser smoke check was requested and remains pending in this checkpoint.

Read-only configuration check confirms the web app's Enterprise App Check key matches the build, TTL 3600 seconds, and refreshed.muhammadiwelfare.org.au / mwa-community-web.web.app / muhammadiwelfare.org.au are allowed domains; no testing override exists. No App Check enforcement change or debug-token bypass was made. If normal users report verification failures, investigate their browser/provider assessment before any security policy change. UI now gives refresh/browser-verification guidance, while Contact MWA remains available.

Initial auth readiness no longer clears an anonymous chat; actual uid/admin/module changes still clear it. Automated regression covers startup, permission order stability, permission removal, account switching and sign-out. Normal signed-in admin access and private record viewing are not claimed tested by the synthetic model-context check.


### User-confirmed normal-browser check — 11 November 2026

User confirmed “Yes, it answers and shows the button” for “I want to donate for Niaz.” This supersedes the pending human-browser status above for that response/button check. It does not confirm clicking the link, making a payment, or a real admin sign-in continuation. Historical automated Chromium attestation failure is not reclassified as success. No security settings changed for this confirmation. Initial limitations and future review backlog remain in force.


### Public programme answers and navigation fixes — 11 November 2026

MWA.ai can now request a server-generated list for today, this week or next week. Weeks are Monday–Sunday in Australia/Sydney. Queries use existing events with a 201-document bound, return at most eight confirmed MWA Programs entries, exclude explicit private/masked entries, and expose only titles/times. Results are formatted on the server and not sent to Gemini. Larger results link to the public calendar; individual event deep links and arbitrary/historical date-range searches remain future work. Query failures show an unavailable message, never an invented empty schedule. Other live data (prayer times, private donations etc.) remains navigation-only. This supersedes the earlier blanket navigation-only statement for these three public programme periods only.

Corrected the client link guard rejecting URLs containing r; safe admin-login continuations are now visible. Donation deep-link layout stabilisation, UTF-8 copy fixes and supplied helper avatar added. Actual human sign-in continuation remains an acceptance check; no private data/actions used for testing.
