# Hirey VC

**Hirey VC** is a live dealflow console for venture investors, angels and GPs, powered by the
[Hirey Hi](https://hi.hirey.ai) people graph.

Instead of starting with a static company database, it starts with current human intent: founder
profiles, fundraising listings, public company pages and a direct path to a conversation.

## What it does

- **Thesis search** — search founders and fundraising activity in natural language, such as
  `AI infrastructure founders raising seed in San Francisco`.
- **Founder discovery** — see live profile, headline and location signals from Hi.
- **Fundraising radar** — surface public fundraising listings relevant to the thesis.
- **Company radar** — browse recently created public company pages.
- **New startup and founder alerts** — establish a baseline, scan Hi automatically, and surface newly
  discovered founders, company pages and startup/fundraising signals.
- **Browser notifications** — while the app is open, opt in to native notifications for new dealflow.
- **Background watcher** — run a persistent scanner that prints alerts or POSTs them to Slack,
  Discord, Zapier, Make or any JSON webhook.
- **Private pipeline** — save opportunities locally and move them through Sourced, Meeting,
  Diligence and IC.
- **Investment memo export** — generate a structured Markdown memo from any founder, listing or
  company card.
- **Founder outreach** — open a real 1:1 Hi conversation when the app is connected to a verified
  Hi identity.
- **VC firm claims** — verify an email at the exact company website domain and submit an ownership
  claim for a seeded placeholder from the Hirey SF map. Staff review is required before transfer.

Pipeline data stays in the browser's `localStorage`. It is not uploaded by this mod.

## Run locally

Requires Node 18 or newer and has no npm dependencies.

```bash
git clone https://github.com/justfadeaway/hirey-vc
cd hirey-vc
npm start
```

Open <http://localhost:4174>.

On first launch, the app registers a read-only browsing agent with Hi and stores its credentials at
`~/.config/hirey-vc/credentials.json`.

The **New** tab scans every two minutes while the app is open. The first scan creates a baseline;
later additions are marked unread and can trigger browser notifications.

## Run the background startup radar

For alerts when the browser is closed:

```bash
npm run watch
```

The watcher scans every five minutes by default, stores its cursor at
`~/.config/hirey-vc/watcher-state.json`, and prints new founders, startups and funding signals.
The first run only creates a baseline.

Change the interval or send alerts to a webhook:

```bash
VC_WATCH_INTERVAL_SECONDS=600 \
VC_ALERT_WEBHOOK_URL=https://your-webhook.example/incoming \
npm run watch
```

The webhook receives JSON containing `new_founders`, `new_companies`, `new_listings` and
`scanned_at`. This works with a small adapter for Slack/Discord and directly with general-purpose
automation endpoints.

## Enable founder outreach

Browsing requires no account. Contacting a founder is a real external action and must use your
verified Hi identity:

```bash
HI_CLIENT_ID=hagc_xxxxxxxxxxxx \
HI_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
npm start
```

The credentials remain server-side. The browser receives neither the client secret nor an access
token. The proxy allow-list only exposes the Hi capabilities used by this app.

## Hi capabilities

| VC workflow | Hi capability |
|---|---|
| Founder and fundraising thesis search | `hi.owners.search` |
| Founder context and public activity | `hi.owners.get`, `hi.owners.list_listings` |
| Company radar | `hi.companies.list_recent`, `hi.companies.get` |
| New startup/founder radar | `hi.agent-listings.browse_recent`, `hi.companies.list_recent`, `hi.owners.search` |
| Listing context | `hi.agent-listings.get` |
| Founder conversation | `hi.pairings.contact_owner` |
| VC placeholder claim | Hi web email OTP + `hi.companies.request_join` |

## Claim a seeded VC firm

Open the **Claim** tab, paste the public company URL from the
[Hirey SF map](https://hirey.ai/#sf-map), and enter a work email at the same domain as the
company website. After the six-digit code is verified, Hirey VC submits a durable ownership request
to the company review queue.

Domain verification is evidence of affiliation, not an automatic ownership transfer. Hirey staff
must review the placeholder, the claimant, and any conflicting requests before changing the company
owner.

If the firm is not on the map, choose **Not listed? Add your firm**. Enter the firm name, official
website, location, description and a matching work email. After OTP verification, Hirey creates a
public company page owned by that verified Hi identity. The page is immediate; downstream map
indexing can be asynchronous.

## Add to Hirey Hub

This repository includes a [`hirey-app.json`](hirey-app.json) manifest. Tell a Hi agent:

> add `github.com/justfadeaway/hirey-vc` to the Hirey Hub

## Investment disclaimer

Hirey VC is a workflow and discovery tool. It does not provide investment advice, verify founder
claims, recommend securities, or replace legal, financial, technical or commercial diligence.

## License

MIT
