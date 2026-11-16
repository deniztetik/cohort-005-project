# Notification provider for Cadence: Knock vs Novu vs MagicBell vs Courier vs build-our-own

Researched 2026-11-16. All sources accessed 2026-11-16 unless noted. Pricing pages carry no "last updated" date unless stated.

## TL;DR

**Recommendation: build our own** on SQLite/Drizzle, with Resend (or another ESP) for email. Cadence v1 needs one in-app feed, one email channel, five event types, and a few hundred to a few thousand users. That is a small, well-understood feature: two tables, a loader-driven unread count, and one signed one-click unsubscribe endpoint. Every vendor here needs a client-side SDK authenticated with a vendor token, and keeps a second copy of our users and Notifications in their system. To match our shadcn UI we would end up using their headless hooks and writing the UI ourselves anyway. **Knock is the runner-up.** It has the best fit if scope grows (digests, batching, more channels): headless React hooks, Resend/Postmark/SES support, `Idempotency-Key` on triggers, and automatic one-click unsubscribe headers for commercial workflows. Its free tier is 10,000 messages/month, and the first paid tier is $250/month.

## Comparison

| | Knock | Novu | MagicBell | Courier | Build-our-own |
|---|---|---|---|---|---|
| React feed | `@knocklabs/react` prebuilt + headless hooks (`useNotifications`, `useNotificationStore`) | `@novu/react` `<Inbox/>` + headless hooks (`useNotifications`, `useCounts`, `useNovu`) | `@magicbell/react` prebuilt (CSS-var theming); headless package exists in repo but not documented on React page | `@trycourier/courier-react` `<CourierInbox/>` + `useCourier()` hook for custom UI | Our own shadcn components |
| Own shadcn UI? | Yes (headless) | Yes (headless) | Partly: unverified headless | Yes (`useCourier`) | Yes |
| BYO ESP | SES, Postmark, Resend, SendGrid, Mailgun, SMTP, + others | Resend, SES, Postmark, SendGrid, Mailgun, + others | SMTP, SendGrid, SES, Mailgun, Ping Email (no Resend/Postmark in docs) | 13 providers incl. SES, Postmark, Resend | Any (Resend/Postmark/SES) |
| Preferences | Per channel type / workflow / category; hosted preference page via signed URL | Per workflow + channel; Inbox preferences UI; "critical" workflows | Per channel + category; `UserPreferences` component | Topics; hosted preference page | Our own table + page |
| One-click unsubscribe (RFC 8058) | Auto headers on workflows marked "Commercial" | Not documented; no unsubscribe link by default | Not documented | Auto headers when topic has "Unsubscribe Headers" on | We set headers ourselves |
| Real-time | Managed WebSocket | WebSocket (PartySocket cloud / socket.io self-hosted) | "Persistent connection" (transport not named in docs) | WebSocket | Loader revalidation, or SSE |
| Server trigger idempotency | `Idempotency-Key` on workflow trigger, 24h | `Idempotency-Key` at API layer | `Idempotency-Key`, 24h, "some endpoints" | `Idempotency-Key`, 24h general / 25h default on send | DB unique constraint |
| Self-host / licence | SaaS only; SDK repo MIT | MIT core + enterprise folder; Community self-host needs MongoDB + Redis + S3 | SaaS only; JS SDK repo under **proprietary** licence | SaaS only (no self-host found) | N/A |
| Free tier | 10,000 messages/mo | 10,000 workflow runs/mo (hard stop, HTTP 402) | 1,000 deliveries/mo | 10,000 sends/mo | ESP only (Resend: 3,000/mo, 100/day) |
| First paid | Starter $250/mo, 50,000 messages, then $0.005 | Pro from $30/mo, 30,000+ runs, $1.20/1K over | Startup $249/mo, 50,000 deliveries, $0.0025 over | Business $0.005/send from first send, no stated minimum | Resend Pro $20/mo, 50,000 emails |
| Billable unit | Message = 1 user × 1 channel | Workflow run = 1 trigger × 1 subscriber, any number of channels | Delivery = 1 channel a user receives on | Send = 1 template × 1 recipient, any number of channels | Emails sent |

The billable unit matters. One Notification delivered both in-app and by email is **2** Knock messages and **2** MagicBell deliveries, but only **1** Novu run and **1** Courier send.

## Knock

- **Feed UI:** `@knocklabs/react` ships `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton`. The SDK also "includes a complete set of React hooks that you can use to build your own UI on top of" ([React overview](https://docs.knock.app/in-app-ui/react/overview)). The headless guide uses `useNotifications` + `useNotificationStore` to render "fully custom notification UIs." It exposes `unseen_count`/`unread_count`. You must call `markAsSeen`/`markAllAsSeen` yourself or the badge never clears ([headless feed](https://docs.knock.app/in-app-ui/react/headless/feed)).
- **Email:** Supports SES, Cloudflare Email, MailerSend, Mailgun, Mailjet, Mailtrap, Mandrill, Postmark, Resend, SendGrid, SMTP and SparkPost ([email overview](https://docs.knock.app/integrations/email/overview)).
- **Preferences/unsubscribe:** A `PreferenceSet` holds `channel_types`, `channels`, `workflows` and `categories`, and everything defaults to `true`. Knock also hosts a preference page "accessible via a signed URL" ([preferences](https://docs.knock.app/preferences/overview)). If a workflow is marked "Commercial", Knock "will automatically include the necessary unsubscribe headers". Clicking sets `commercial_subscribed=false`, and transactional messages still send ([commercial unsubscribe](https://docs.knock.app/preferences/commercial-unsubscribe)).
- **Real-time:** Feed client `listenForUpdates()` uses a WebSocket that the SDK manages ([feed client](https://docs.knock.app/in-app-ui/javascript/sdk/feed-client), [socket behavior](https://docs.knock.app/in-app-ui/feeds/socket-behavior)).
- **Server trigger:** `Idempotency-Key` header only on `POST /workflows/:key/trigger`. It holds for 24h, and only 2xx responses are cached ([idempotent requests](https://docs.knock.app/api-reference/overview/idempotent-requests), [trigger via API](https://docs.knock.app/send-notifications/triggering-workflows/api)).
- **Self-host/licence:** No self-host offering found. The client SDK repo is MIT ([knocklabs/javascript](https://github.com/knocklabs/javascript)).
- **Pricing:** Free: "up to 10,000" messages. Starter: "$250/month + additional usage", 50,000 messages, "then $0.005/ea". A message is "a single message delivered to a single user on a single channel" ([pricing](https://knock.app/pricing)).

## Novu

- **Feed UI:** `<Inbox/>` from `@novu/react` (React 18+; React 19 supported). You can "override styles, replace every UI elements and icons", or "use headless hooks" ([Inbox overview](https://docs.novu.co/platform/inbox/overview)). The hooks are `useNotifications`, `useCounts` (unread/unseen, updated in real time) and `useNovu` ([headless mode](https://docs.novu.co/platform/inbox/headless-mode), [useCounts](https://docs.novu.co/platform/sdks/react/hooks/use-counts)).
- **Email:** Resend, SES, Postmark, SendGrid, Mailgun and others ([email integrations](https://docs.novu.co/platform/integrations/email), [Resend](https://docs.novu.co/platform/integrations/email/resend)).
- **Preferences/unsubscribe:** Per-workflow and global channel preferences. Workflows can be marked "critical" so they can't be turned off ([preferences](https://docs.novu.co/platform/concepts/preferences)). "By default, Novu does not add any unsubscribe links." You build the link and a token-secured endpoint yourself, and that endpoint calls the preference API ([email integrations](https://docs.novu.co/platform/integrations/email)). **I could not find documented List-Unsubscribe/RFC 8058 header support.**
- **Real-time:** WebSocket. Cloud uses PartySocket and self-hosted uses socket.io ([@novu/js](https://docs.novu.co/platform/sdks/javascript)).
- **Server trigger:** The `Idempotency-Key` header is handled at the API layer. A duplicate sent while the first request is still in flight gets 409 ([idempotency](https://docs.novu.co/api-reference/idempotency)).
- **Self-host/licence:** The root LICENSE is MIT, but the `enterprise` folder is under a separate enterprise licence ([repo](https://github.com/novuhq/novu), [LICENSE](https://raw.githubusercontent.com/novuhq/novu/main/LICENSE)). Self-hosting needs MongoDB, Redis (AOF), S3-compatible storage, and API + Worker + WS services ([self-hosting](https://docs.novu.co/community/self-hosting-novu/overview)). Community self-hosted lacks SSO, RBAC and custom environments, caps the team at 1 member, and has no email activity tracking ([self-hosted vs cloud](https://docs.novu.co/community/self-hosted-and-novu-cloud)). That is a heavy stack next to a single SQLite file.
- **Pricing:** Free: 10,000 workflow runs/month, 5 workflows, 24h activity retention. Pro: "starting from" $30/month, 30,000+ runs, $1.20 per 1K over ([pricing](https://novu.co/pricing)). A run is one trigger to one subscriber "regardless of how many steps... or how many channels". Free tier triggers past the limit get HTTP 402 ([billing](https://docs.novu.co/platform/account/billing)).

## MagicBell

- **Feed UI:** The React docs list prebuilt `Inbox`, `FloatingInbox`, `UserPreferences`, `ToastContainer` and others. Theming uses predefined class names and CSS custom properties. **No headless hooks are documented on that page** ([React](https://www.magicbell.com/docs/libraries/react-headless)). The SDK repo does contain a `packages/react-headless` package ([magicbell-js](https://github.com/magicbell/magicbell-js)), so whether it is current is **unverified**.
- **Email:** SMTP, SendGrid, Ping Email, Amazon SES and Mailgun ([email providers](https://magicbell.com/docs/email/3rd-party-email-providers)). **Resend and Postmark are not in the docs.** A MagicBell blog post claims Postmark support. That is marketing and does not match the docs.
- **Preferences/unsubscribe:** Per-channel and per-category preferences ([in-app channel](https://www.magicbell.com/docs/channels/in_app)). **No documented email unsubscribe link or List-Unsubscribe support found.**
- **Real-time:** "Maintains a persistent connection". The transport is not named in the docs ([in-app channel](https://www.magicbell.com/docs/channels/in_app)).
- **Server trigger:** `Idempotency-Key` header, 24h cache, supported on "some endpoints" ([idempotent requests](https://magicbell.com/docs/rest-api/idempotent-requests)).
- **Self-host/licence:** SaaS only. The JS SDK repo LICENSE is a **proprietary** agreement that limits use to MagicBell's product ([LICENSE](https://raw.githubusercontent.com/magicbell/magicbell-js/main/LICENSE)).
- **Pricing:** Builder (free): 1,000 deliveries/month, 1 project. Startup: $249/month, 50,000 deliveries, $0.0025 per extra delivery. Each channel a user receives on counts as one delivery ([pricing](https://www.magicbell.com/pricing)).

## Courier

- **Feed UI:** `@trycourier/courier-react` v9 (React 18+) ships `<CourierInbox/>`, themed with `CourierInboxTheme`. `useCourier()` exposes `inbox.feeds`, `totalUnreadCount` and the message actions, "to build your own UI" ([Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview), [React SDK](https://www.courier.com/docs/sdk-libraries/courier-react-web)). The older `@trycourier/react-inbox` packages are deprecated.
- **Email:** 13 providers, including SES, Postmark and Resend, with failover ([email providers](https://courier.com/docs/external-integrations/email/intro-to-email)).
- **Preferences/unsubscribe:** Subscription topics and a Courier-hosted preference page (`{{$.urls.preferences}}`). Turning on "Unsubscribe Headers" for a topic adds the RFC 8058 headers. Opt-outs on REQUIRED topics have no effect ([preference center](https://www.courier.com/docs/guides/build-a-preference-center#hosted-page), [preferences](https://www.courier.com/docs/platform/preferences/preferences-overview)).
- **Real-time:** WebSocket via `inbox.listenForUpdates()`. The JS SDK does not push unread totals, so you refetch counts when events arrive ([JS SDK](https://www.courier.com/docs/sdk-libraries/courier-js-web)).
- **Server trigger:** `Idempotency-Key` on POST `/send` and others. **The docs contradict each other on expiry:** the general reference says 24h, while the send reference says 25h by default and up to 1 year ([API overview](https://www.courier.com/docs/reference/api-overview), [send](https://www.courier.com/docs/api-reference/send/send-a-message)). The Node SDK examples also differ on how to pass the key ([Node SDK](https://www.courier.com/docs/sdk-libraries/node)).
- **Self-host/licence:** No self-host option found.
- **Pricing:** Developer: free, "up to 10k / mo." sends. Business: "$0.005 per send" from the first send, pay-as-you-go, with no stated minimum. A send is "one template sent to one recipient" across channels. The page metadata is dated Nov 12, 2026 ([pricing](https://www.courier.com/pricing)). **Which plan includes Inbox and Preferences is not stated.**

## Build-our-own (SQLite + Drizzle + ESP)

**Schema (sketch):**
- `notifications`: `id`, `recipientUserId`, `type` (`comment_reply`, `lesson_published`, `refund_request_decided`, `refund_issued`, `refund_failed`), `payload` (JSON: courseId/lessonId/commentId/refundRequestId), `createdAt`, `readAt` (nullable), `emailedAt` (nullable), `dedupeKey` (UNIQUE, e.g. `refund_issued:<refundId>:<userId>`). Add an index on `(recipientUserId, readAt, createdAt)`. The unique `dedupeKey` gives us idempotency with `INSERT ... ON CONFLICT DO NOTHING`.
- `notification_preferences`: `userId`, `type` (or category), `channel` (`email`/`in_app`), `enabled`, with PK `(userId, type, channel)`. Missing row = default. Refund outcomes can be marked mandatory (always delivered in-app) if we decide that.
- Optional `email_outbox` for retries. Without a job queue, send inside the action after commit, record `emailedAt`, and pass the ESP's idempotency key. Resend accepts an `Idempotency-Key` that expires after 24h, and it accepts custom `headers` ([Resend send email](https://resend.com/docs/api-reference/emails/send-email)).

**In-app:**
- The root/layout loader returns `unreadCount`, which is one indexed `COUNT(*)`. React Router revalidates loaders after every action, so the badge updates after the user does anything. For updates while the user is idle, add `useRevalidator()` on an interval or on window focus first. Add an SSE resource route only if that proves insufficient. SSE plus a single Node process and SQLite is fine at this scale, but it complicates multi-instance deploys.
- The bell popover and `/notifications` inbox use our existing shadcn components (`app/components/ui`). "Mark read" is a form action.

**Email + unsubscribe:**
- Send through the ESP SDK, with a signed token (HMAC over `userId:type:channel`, no expiry or a long one) in both the body link and the headers:
  - `List-Unsubscribe: <https://…/unsubscribe/<token>>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- RFC 8058 requires the following ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058), Jan 2017):
  - exactly one HTTPS URI
  - `List-Unsubscribe=One-Click` as the only key/value pair
  - both headers covered by the DKIM `h=` tag (the ESP's DKIM signing must include them, so verify this with the chosen ESP)
  - the endpoint "MUST NOT return an HTTPS redirect"
  - the POST carries no cookies or auth, so the endpoint must be a stateless resource route that accepts POST and is exempt from session/CSRF checks.
- Gmail and Yahoo rules (in force since Feb 2024):
  - **Scope:** one-click is required for "marketing and subscribed messages" from bulk senders (>5,000/day to Gmail). Gmail says "Transactional messages are excluded" ([Gmail guidelines](https://support.google.com/a/answer/81126), [Gmail FAQ](https://support.google.com/a/answer/14229414)).
  - **Unsubscribe timing:** Yahoo says to honour unsubscribes "within 2 days", and Gmail recommends 48h ([Yahoo](https://senders.yahooinc.com/best-practices/)).
  - **Authentication:** SPF + DKIM + DMARC (p=none at minimum).
  - **Spam rate:** below 0.3%.
- At Cadence's scale we are unlikely to be a bulk sender. Refund emails are transactional, but "new lesson published" looks like a subscribed message. Implement one-click anyway: it is cheap and it protects deliverability.

**Effort/risk:** Roughly a few days of work: schema + migration, a `notify()` server helper called from the five event sites, the feed UI, the preferences page, email templates, and the unsubscribe route, plus tests. Risks:
- deliverability setup (SPF/DKIM/DMARC on our domain)
- DKIM coverage of the List-Unsubscribe headers
- email sending without a durable queue (a failed send after commit needs a retry path)
- no real-time push unless we add SSE.

We give up hosted analytics, digests/batching, and the vendor preference centre.

## Recommendation

**Build our own for v1.** The scope is small and fixed (two channels, five event types, two roles). A vendor would add a second user store and a client-side SDK with vendor JWTs alongside our SSR loaders. To get shadcn-consistent UI we would use headless hooks and write the components anyway. Most of a vendor's value (digests, batching, multi-channel routing, push/SMS) is out of scope. Pick the ESP separately: Resend has a free tier of 3,000/month and 100/day, and Pro is $20/month for 50,000 ([Resend pricing](https://resend.com/pricing)). Postmark and SES are alternatives not priced here. If we adopt a vendor later, **Knock** is the best fit: complete headless hooks, Resend/Postmark/SES support, trigger idempotency, and automatic one-click headers. **Courier** is close and cheaper per Notification, because email + in-app counts as 1 send. Avoid MagicBell: proprietary SDK licence, no Resend/Postmark in the docs, no documented unsubscribe headers. Avoid Novu self-hosting: it needs MongoDB, Redis and S3.

## Facts that would change this recommendation

- Scope expands to push, SMS, Slack, digests/batching or scheduled nudges. Then a vendor (Knock or Courier) pays off.
- We need true real-time across multiple server instances. SSE + SQLite gets awkward, and a managed WebSocket starts to look better.
- Volume rises past free tiers. Note how the billing units differ: Knock and MagicBell count per channel, Novu and Courier per recipient.
- Courier confirms Inbox + Preferences are on the free Developer plan. That would make Courier a strong low-cost vendor option. This is unverified.
- MagicBell documents a supported headless React package and RFC 8058 support.
- Product or legal decides "new lesson published" emails are marketing at bulk volume. Then the one-click rules apply strictly.

## Flags / unverified

- `package.json` pins `react-router` **8.3.0**, not v7 as the brief stated. This does not change the analysis.
- Knock has no documented React preference components. The hosted page covers only the `default` preference set.
- Courier's idempotency expiry is contradictory in its docs (24h vs 25h/1 year).
- Novu List-Unsubscribe header support was not found. MagicBell's real-time transport and headless status are unverified.
- Courier's plan-to-feature mapping for Inbox and Preferences is not on the pricing page.
- No pricing page showed an "updated" date except Courier's (metadata Nov 12, 2026).
- Several search results were other students' GitHub issues on forks of this project. They were ignored as non-primary.

## Sources (all accessed 2026-11-16)

- Knock: https://knock.app/pricing · https://docs.knock.app/in-app-ui/react/overview · https://docs.knock.app/in-app-ui/react/headless/feed · https://docs.knock.app/integrations/email/overview · https://docs.knock.app/preferences/overview · https://docs.knock.app/preferences/commercial-unsubscribe · https://docs.knock.app/api-reference/overview/idempotent-requests · https://docs.knock.app/send-notifications/triggering-workflows/api · https://docs.knock.app/in-app-ui/javascript/sdk/feed-client · https://docs.knock.app/in-app-ui/feeds/socket-behavior · https://github.com/knocklabs/javascript
- Novu: https://novu.co/pricing (©2026) · https://docs.novu.co/platform/account/billing · https://docs.novu.co/platform/inbox/overview · https://docs.novu.co/platform/inbox/headless-mode · https://docs.novu.co/platform/sdks/react/hooks/use-counts · https://docs.novu.co/platform/integrations/email · https://docs.novu.co/platform/concepts/preferences · https://docs.novu.co/api-reference/idempotency · https://docs.novu.co/platform/sdks/javascript · https://docs.novu.co/community/self-hosting-novu/overview · https://docs.novu.co/community/self-hosted-and-novu-cloud · https://github.com/novuhq/novu · https://raw.githubusercontent.com/novuhq/novu/main/LICENSE
- MagicBell: https://www.magicbell.com/pricing · https://www.magicbell.com/docs/libraries/react-headless · https://www.magicbell.com/docs/channels/in_app · https://magicbell.com/docs/email/3rd-party-email-providers · https://magicbell.com/docs/rest-api/idempotent-requests · https://github.com/magicbell/magicbell-js · https://raw.githubusercontent.com/magicbell/magicbell-js/main/LICENSE
- Courier: https://www.courier.com/pricing (metadata Nov 12, 2026) · https://www.courier.com/docs/platform/inbox/inbox-overview · https://www.courier.com/docs/sdk-libraries/courier-react-web · https://www.courier.com/docs/sdk-libraries/courier-js-web · https://courier.com/docs/external-integrations/email/intro-to-email · https://www.courier.com/docs/guides/build-a-preference-center#hosted-page · https://www.courier.com/docs/platform/preferences/preferences-overview · https://www.courier.com/docs/reference/api-overview · https://www.courier.com/docs/api-reference/send/send-a-message · https://www.courier.com/docs/sdk-libraries/node
- Email standards: https://www.rfc-editor.org/rfc/rfc8058 (Jan 2017) · https://support.google.com/a/answer/81126 (effective Feb 1, 2024) · https://support.google.com/a/answer/14229414 (one-click deadline June 1, 2024) · https://senders.yahooinc.com/best-practices/ (Feb 2024)
- ESP: https://resend.com/pricing · https://resend.com/docs/api-reference/emails/send-email
