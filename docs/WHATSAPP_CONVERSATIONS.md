# Two-way WhatsApp conversations

Customers reply to the package updates Laawol sends from one shared number
(+1 347-559-6214, WABA 992521863149970). Before this, nothing received those
replies. Decided with the owner on 2026-10-28; built on branch
`feature/whatsapp-two-way`.

## Decisions (owner-approved)

1. The business whose package it is answers. Laawol (platform admins with the
   `support` capability) sees **every** conversation. Unmatched numbers go to
   Laawol's inbox.
2. A number known to several businesses goes to the one that messaged it most
   recently. If none did in 30 days, the customer is asked to pick
   ("Reply 1 for Nensona, 2 for Keren"). Staff can hand a conversation to
   another business (one that knows the customer) or to Laawol.
3. Automatic replies: on the first message of a conversation (new, or
   reopened from Done), and when the business is closed (package-request
   opening hours). They include the tracking link and use the customer's
   language.
4. Files go both ways: photos, documents, video, and voice notes, including
   voice notes recorded in the console or app. Received files are copied to
   Storage and deleted after 12 months; text is kept.
5. Conversations live in **Support**, with a WhatsApp badge. Each package in
   Shipping gets a **Message customer** button, and a conversation shows that
   customer's packages.
6. **Everyone at the business** can read and answer. No permission is needed.
7. Phone notifications go to the owner (unless switched off) and to staff who
   turn on **WhatsApp messages** in their notification settings (off by
   default).
8. Replies are signed `*Mamadou (Nensona):*`. Staff can set a short display
   name; Laawol replies are signed `Name (Laawol)`.
9. Outside WhatsApp's 24-hour window, a staff message waits. The customer gets
   the template `message_waiting_2lang` (at most once per 24 hours), and the
   waiting messages go out when the customer writes.
10. Laawol pays Meta for now. Templates are counted per business per month in
    `whatsappTemplateCounts`.
11. The customer sees the conversation in WhatsApp only. It never appears in
    the customer's Laawol app.
12. Laawol admins can read, leave private notes, and reply as Laawol.
13. STOP / ARRÊT pauses every template to that number, from every business.
    START turns them back on. Login codes and staff invites still go. The
    conversation shows **Stopped updates**.
14. Each customer has one thread per business. Staff mark it **Done**; any new
    customer message reopens it as needing a reply.
15. Delivery ticks (sent / delivered / read / failed) appear in conversations
    **and** on each package's update history. Failed updates are flagged in
    the Waiting list and on containers.
16. Launch: one week in `laawol_only` mode, where every conversation goes to
    Laawol and records which business it belongs to. Then switch to
    `businesses` after a heads-up to Nensona and Keren.

## Data

### Conversation: `supportCases/wa_{inbox}_{digits}`
`inbox` is the business id, or `laawol`. It is a Support case, so the existing
Support panel, messages and attachments work unchanged.

| Field | Meaning |
|---|---|
| `caseType` | `"whatsapp"` (also `channel: "whatsapp"`) |
| `inbox` | business id or `laawol` |
| `businessId`, `businessName` | owner business; `""` / "Laawol" for Laawol's inbox |
| `suggestedBusinessId`, `suggestedBusinessName` | launch week: whose it would be |
| `whatsappPhone`, `customerPhone` | E.164, e.g. `+224621000001` |
| `customerName`, `subject`, `relatedLabel` | WhatsApp profile name (or number) |
| `whatsappState` | `needs_reply` \| `waiting_customer` \| `done` \| `choosing` (asked which business) |
| `status` | Support status mirror: `waiting_for_business` / `waiting_for_customer` / `resolved` |
| `whatsappLang` | `fr` \| `en` |
| `lastMessage`, `lastMessageAt`, `lastMessageSenderRole` | list preview |
| `lastCustomerMessageAtMs` | start of the 24-hour window (0 = closed) |
| `unreadCount` | customer messages since staff last replied |
| `updatesStopped` | the customer sent STOP |
| `escalationStatus` | `escalated` for Laawol's inbox (it appears in the existing admin Support list), else `business_first` |
| `handedTo` | set on a conversation that was handed over (it is then `done`) |
| `customerUid` | always `""`, so the customer's app never sees it |

### Messages: `supportCases/{id}/messages/{id}`
Same shape as Support messages (`senderRole`, `senderName`, `content`,
`messageType` text|image|voice|video|file|system, `metadata`, `createdAt`),
plus:

- `metadata.channel: "whatsapp"`
- `metadata.whatsapp`: `{direction: "in"|"out", wamid, status, error,
  stopped?}`. `status` is one of `sent` \| `delivered` \| `read` \| `failed` \|
  `waiting_for_reply` (held outside the window).
- `metadata.auto: true`: an automatic reply. It has `senderRole: "system"` and
  should be labelled "Automatic reply".
- `metadata.note: true`: a private note or a system note (handed over,
  customer chose). It is **never** sent to the customer.
- Files: `metadata.fileUrl`, `filePath`, `mimeType`, `fileName`, `fileSize`,
  `caption`. When deleted after 12 months: `metadata.mediaDeleted: true`.
- `metadata.whatsappLabel`: the signature used, e.g. "Mamadou (Nensona)".

### Package update ticks: `containerUpdates/{id}`
New fields: `deliveryStatus` (`delivered` \| `read` \| `failed`),
`deliveryStatusAtMs`, `deliveryError`, `deliveryErrorCode`. A failure is also
merged into the line's `lastCustomerUpdate` as `status: "failed"`, which the
Waiting list and containers already show.

### Server-only collections
These are denied to every client by the rules:
- `whatsappContacts/{e164}`
- `whatsappStops/{e164}`
- `whatsappInbound/{wamid}`
- `whatsappMessages/{wamid}`
- `whatsappMedia/{id}`
- `whatsappTemplateCounts/{inbox}_{yyyy-mm}`: `{businessId, month, count, byTemplate}`
- `appConfig/whatsappInbox`: `{mode: "laawol_only" | "businesses"}`

## Client queries (rules allow these)
- **Business, everyone:** `supportCases where businessId == X and caseType ==
  "whatsapp" orderBy updatedAt desc` (index exists).
- **Business with the Support permission:** the existing
  `where businessId == X orderBy updatedAt desc` also returns WhatsApp threads.
- **Laawol admin, every WhatsApp thread:** `where caseType == "whatsapp"
  orderBy updatedAt desc` (index exists). Laawol's own inbox is also in the
  existing escalated list.
- **Messages:** `supportCases/{id}/messages orderBy createdAt` (as today).

## Callables
- **Write in a thread:** use the existing `sendSupportMessage({caseId,
  content})` and, for files, upload to `support_cases/{caseId}/{uid}/...` then
  call `uploadSupportAttachmentMetadata`. For a WhatsApp case, the server
  relays it to the customer and returns `delivery`: `sent` \| `waiting` (held
  outside the window; the template was sent) \| `stopped` \| `failed`.
  - **Voice notes:** WhatsApp plays only `audio/ogg` (opus), `audio/mpeg`,
    `audio/mp4`, `audio/aac`, `audio/amr`. Anything else, such as webm, goes
    out as a document. Clients should record ogg/opus or mp4/aac.
- **Everything else:** `whatsappConversation({action, ...})`:
  - `open {phone, name}`: from a package's **Message customer**; returns
    `{caseId}` (business = the caller's; admins may pass `businessId`)
  - `done {caseId}` / `reopen {caseId}`
  - `note {caseId, text}`: private, never sent
  - `handoff {caseId, to, note?}`: `to` is a business id or `laawol`. Staff may
    pick only Laawol or a business that knows the customer; returns the new
    `{caseId}`
  - `packages {caseId}`: returns `{packages: [{id, trackingCode, kind,
    description, containerId, containerStatus, destination, role}]}`
  - `setDisplayName {name}`: sets `users/{uid}.chatDisplayName`
  - `mode {}` / `setMode {mode}`: admin only
- **Notification preference key:** `whatsappMessages`. Push data is
  `{type: "whatsapp_message", caseId, businessId}`.

## Meta setup (one time)
1. The owner sets the secret `WHATSAPP_APP_SECRET`: Meta app "Laawol"
   (1850257899484218) → Settings → Basic → App secret.
2. In the Meta app's WhatsApp → Configuration:
   - Callback URL: `https://us-central1-laawol-a855a.cloudfunctions.net/whatsappWebhook`
   - Verify token: `verifyTokenFor(secret)` (whatsapp_inbox.js)
   - Subscribe to the `messages` field.
3. Subscribe the app to the WABA: `POST /992521863149970/subscribed_apps`.
4. Submit the template `message_waiting_2lang` (Utility, language `en`):
   - EN: "Hello {{1}}, {{2}} has a message for you about your shipment {{3}}.
     Reply to this message to read it."
   - FR: "Bonjour, {{4}} a un message pour vous concernant votre envoi
     {{5}}. Répondez à ce message pour le lire."
