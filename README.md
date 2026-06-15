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
- **Private pipeline** — save opportunities locally and move them through Sourced, Meeting,
  Diligence and IC.
- **Investment memo export** — generate a structured Markdown memo from any founder, listing or
  company card.
- **Founder outreach** — open a real 1:1 Hi conversation when the app is connected to a verified
  Hi identity.

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
| Listing context | `hi.agent-listings.get` |
| Founder conversation | `hi.pairings.contact_owner` |

## Add to Hirey Hub

This repository includes a [`hirey-app.json`](hirey-app.json) manifest. Tell a Hi agent:

> add `github.com/justfadeaway/hirey-vc` to the Hirey Hub

## Investment disclaimer

Hirey VC is a workflow and discovery tool. It does not provide investment advice, verify founder
claims, recommend securities, or replace legal, financial, technical or commercial diligence.

## License

MIT
