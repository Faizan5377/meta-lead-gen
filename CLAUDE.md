# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Ad Library Harvester" — mines the Meta Ad Library for advertisers, dedupes to **one row per business** (its longest continuously running ad), enriches each with Facebook contact details and a best-effort owner lookup, streams progress live over SSE, and exports one CSV. See [README.md](README.md) for the product-level description and the full filter/env tables.

## Commands

Two independent npm packages — no workspace tooling, no root `package.json`. Install and run each separately.

```bash
# Backend — requires Node 22.5+ (built-in node:sqlite)
cd server
npm install
npx playwright install chromium     # one-time
cp .env.example .env                # optional; defaults work
npm run dev                         # node --experimental-sqlite --watch, :8787
npm start                           # no --watch

# Frontend
cd client
npm install
npm run dev                         # Vite :5173, proxies /api -> 127.0.0.1:8787
npm run build
```

`npm test` covers the **pure enrichment logic only** (name extraction, scoring, Hunter result selection) — there is no test for the scraper, the API, or the client, and **no linter/formatter**. Don't invent `npm run lint`.

Two live diagnostics avoid needing a full harvest to test enrichment:

```bash
npm run hunter:check           # Hunter account + free credit gate; spends nothing
npm run hunter:check -- --spend acme.com
npm run search:check           # which SERP providers are live + quota; spends nothing
npm run search:check -- --live "\"Acme\" owner founder"
npm run owner:check            # the whole owner chain against sample businesses
npm run owner:check -- "Business Name" US https://site.com
```

When testing the owner chain repeatedly, **the scraped engines will start blocking your IP** — results degrade to `blocked` and look like a code regression. They aren't. Configure a SERP API key, or wait it out.

**Node version matters**: the scripts pass `--experimental-sqlite`, which Node 20 *rejects outright* (`bad option`). An `.nvmrc` pins 22. If `npm run dev` dies instantly, that's why — check `node --version` before debugging anything else.

Verify end-to-end changes by running both services and driving a small-`target` harvest, or by hitting the API directly:

```bash
curl -s localhost:8787/api/filters | head -c 400
RUN=$(curl -s -XPOST localhost:8787/api/runs -H 'content-type: application/json' \
  -d '{"keywords":["dentist"],"countries":["US"],"target":5}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["runId"])')
curl -s -XPOST localhost:8787/api/runs/$RUN/start
curl -N  localhost:8787/api/runs/$RUN/events      # watch the SSE stream
```

To watch the browser during a scrape, set `HEADFUL=true` in `server/.env`. `server/data/leads.db` is gitignored and auto-created on first launch.

## Architecture

`client` (Vite/React/Tailwind) → REST + SSE → `server` (Fastify) → Playwright Chromium → `node:sqlite`.

**Request flow:** `POST /api/runs` normalizes+validates filters and creates an in-memory run → client subscribes to `GET /api/runs/:id/events` → `POST .../start` fires `runPipeline` → orchestrator drives harvest → contacts → owners, emitting typed events → `GET .../export` streams the CSV once the run has ended.

### The GraphQL feed is the only data source

[server/src/scraper/engine.js](server/src/scraper/engine.js) navigates to an Ad Library search URL and attaches a Playwright `response` listener that intercepts `/api/graphql` bodies; [feedParser.js](server/src/scraper/feedParser.js) turns them into normalized ad records. **There is no DOM-scraping fallback** — scrolling exists only to make Meta stream the next feed page. If a field stops extracting, start in `feedParser.js` (`normalizeFeedAd`), not in page selectors. Response bodies are parsed defensively (`for(;;);` anti-JSON prefix, concatenated JSON lines), and `findEdges` falls back to a BFS for any `*_connection.edges` if Meta moves the node.

Each `collated_results` group ("22 ads use this creative") contributes exactly one representative record, so the harvest is unique ads rather than collapsed bundles.

### One search URL per (keyword × country)

Meta has no OR syntax — a comma-joined query is treated as one literal phrase and matches nothing. So `harvest()` loops keywords × countries and merges into one deduped stream, and [urlBuilder.js](server/src/urlBuilder.js) builds one country per URL. `normalizeFilters` splits on `,;\n` for the same reason. A keyword with no ads emits scope `no_results`, which the orchestrator downgrades to a `notice` event, not an `error`.

### Three distinct dedup layers — don't conflate them

1. `rawSeen` Set in `engine.js` — `library_id`, within one run.
2. `store.considerAd` in [store.js](server/src/store.js) — `business_key`, within one run. It checks **this run before the DB on purpose**: a business resurfacing under another keyword must be allowed through so the extra keyword gets recorded, and businesses added this run are already persisted.
3. `db.memSeenAds` / `memSeenPages` in [db.js](server/src/db.js) — cross-run persistence, warmed from SQLite at boot. This is what makes repeat searches return only *new* advertisers.

`business_key` prefers numeric `page_id`, falling back to `slug:` then `name:`.

### "Longest-running ad wins" lives in `isLongerRunning`

Priority: still-active beats inactive → earliest `start_date` → higher `days_running` → later `end_date`. When a better ad displaces the kept one, `mergeKeptAd` copies ad/creative fields but **preserves enrichment fields and the accumulated `keywords` array** — enrichment can already have run.

### Run state is in-memory; only businesses are persisted

`store.runs` is a `Map` that dies with the process — restarting the server loses runs and their exports. SQLite stores businesses and seen ads, not runs. The client keeps the last `runId` in `localStorage` (`adharvester:lastRunId`) and re-fetches the snapshot on load, discarding it only on a genuine 404.

### SSE contract — adding an event type touches three places

[eventStream.js](server/src/eventStream.js) buffers up to 5000 events per run so a late subscriber replays the whole run. The client uses `EventSource` with **per-name listeners**, so a new server event needs:

1. an `emit(...)` in [orchestrator.js](server/src/orchestrator.js),
2. a `case` in the reducer in [client/src/lib/eventClient.js](client/src/lib/eventClient.js),
3. its name added to the `types` array in `subscribeToRun` — **omit this and the event is silently dropped.**

`run_started` / `run_finished` / `__snapshot__` carry a full server snapshot that **replaces** `businesses`, so any dropped live event self-heals. Live events patch in place via the `business_key → index` map.

### Metrics are derived, never counted

`App.jsx` computes the metric cards from `state.businesses` in a `useMemo`. This is deliberate — the on-screen numbers must always equal the table rows. Don't add parallel counters for display.

### Failure philosophy: a run never crashes

Every phase is wrapped; per-item failures are pushed to `run.errors` and emitted as `recoverable`. Enrichment functions return a status (`enriched` / `not_found` / `blocked` / `failed` / `skipped`) instead of throwing. Export is allowed once status is `finished`, `stopped`, **or `error`**, so a partial failure never traps collected data. If `node:sqlite` is unavailable, `db.ok` goes false and everything runs in memory — persistence is skipped, never a crash.

### Browser lifecycle

One cached Chromium browser + context shared across runs, health-checked in `getContext()`. **Always open pages with `newPage()`** — it relaunches once on a dead handle; calling `ctx.newPage()` directly reintroduces the "Target page, context or browser has been closed" bug that used to require a server restart. Images, media, and fonts are aborted at the route layer (their URLs already come from the feed JSON), which is what keeps thousand-ad harvests fast and memory-stable.

### Enrichment specifics

- **Contacts** ([contactScraper.js](server/src/scraper/contactScraper.js)) — hits the page's `about_contact_and_basic_info` tab, dismisses the login modal, then parses **label-anchored**: on that page the value sits on the line *before* its label ("Email address", "Mobile", "Website").
- **Owners** ([enrich/ownerResolver.js](server/src/enrich/ownerResolver.js)) — chains Hunter.io → search engines → the company's own website, stopping at the first *confident* answer. 40s hard budget per business so one stubborn lookup can't stall the phase (and with it the Export button).

### Hunter.io: paid calls are gated behind free ones

[enrich/hunter.js](server/src/enrich/hunter.js). Credits are metered monthly while a harvest can surface thousands of businesses, so the order is deliberate and **must not be shortcut**:

1. `domain-finder` (**free**) — business name → domain, when Facebook gave no website.
2. `email-count` (**free**) — does Hunter know an *executive* here? If not, a credit is guaranteed wasted, so we never spend one.
3. `domain-search` (**1 credit**) — only after step 2 says yes.

Three further guards: `HUNTER_MAX_CREDITS_PER_RUN`, a `HUNTER_MIN_CREDITS_RESERVE` floor, and a persistent `api_cache` table so a domain is never paid for twice across runs. **`db.clear()` deliberately keeps `api_cache`** — those rows cost real money and say nothing about which businesses were harvested.

Hunter's 429 means three different things and the body is the only way to tell: `restricted_account` is an account-level block that disables Hunter outright (retrying never clears it); a plain 429 on a *paid* call means credits are gone; a 429 on a *free* call is a burst limit and **must not** disable the paid path. Getting this wrong disables Hunter for a whole run over a hiccup — it already happened once.

`pickDomain` is strict on purpose: a wrong domain produces a wrong owner, which is worse than no owner. It requires the domain slug to match the business name and prefers the country TLD.

### Owner accuracy: the failure mode is a confident wrong answer

Two guards exist because both failures were observed live, and both have regression tests:

- **Association** — a candidate scraped from search text only counts if the business is named within ~260 characters (`requireAssociation`). Without it, a page mentioning any "Owner" produced a confident wrong name. The company's own website is exempt: being on their domain *is* the association.
- **Confidence ceilings** ([personNames.js](server/src/enrich/personNames.js)) — business names are not unique ("Basecamp" is many companies), so a search-derived answer caps at **65**, corroborated at **80**, and only Hunter (which resolves via a domain) goes higher. Don't raise these to make results look better; `not_found` is the honest answer.

`NAME` is case-sensitive by design. **Never add the `i` flag to a pattern that embeds it** — it makes the leading `[A-Z]` case-insensitive and the match runs on into trailing lowercase words ("Michael Chen in 2011"). Only a single-letter initial may carry a period, otherwise a name fuses across sentence boundaries ("Ernest Kim. Zach Gordon").

Owner-operated practices rarely print "Owner", so `Dr. <Name>` is recognised and scored much higher when the business carries that surname ("Millsaps Dentistry" → "Dr. Joshua Millsaps").

### Search: SERP APIs first, scraping as fallback

[searchOwner.js](server/src/enrich/searchOwner.js) runs two phases. **Phase 1** uses the pluggable SERP APIs in [serp.js](server/src/enrich/serp.js) (Serper → Google's index, Tavily), which return JSON and never hit a CAPTCHA. **Phase 2** scrapes engines only when no provider is configured or all are exhausted: Google, Bing and DuckDuckGo's JS app all wall a headless browser, so the scraped path reaches those indexes via **Startpage → Google** and **Ecosia → Bing**, plus Brave, DuckDuckGo's no-JS `html.` endpoint and Mojeek.

Adding a provider = one entry in `PROVIDERS` with a `request()` returning `{results: [{title, url, snippet}], answer?}`; quota, caching, retries and normalisation are handled by the registry. Responses cache in `api_cache` for 14 days and each provider has a monthly cap counted in SQLite, so a free tier can't silently become a bill. **Both providers are optional** — with no keys the module reports unavailable and behaviour is unchanged.

A provider's `answer` (Google's answer box, Tavily's synthesised answer) is the highest-value string available and is weighted accordingly. LinkedIn result titles are machine-generated and parsed structurally. When scraping snippets, only accept a *small* enclosing block — a bare `div` ancestor can be most of the page, letting one result's text vouch for another's link.

### The run target is a hard ceiling

Two independent guards, because this was a real bug (asking for 3 returned 15):

1. `drain()` in [engine.js](server/src/scraper/engine.js) re-checks `shouldStop` **after every record**, stopping mid-buffer. Meta's feed arrives a page at a time, so draining a whole page before re-checking is what overshot.
2. `store.considerAd` refuses to add a *new* business once `run.businesses.length >= run.target` and returns `{status:'skipped', atTarget:true}`.

Guard 2 deliberately allows **updates** to businesses already kept (an extra keyword, a longer-running ad) — only new additions are capped. Covered by [test/store.test.js](server/test/store.test.js).

- Naming drift: the `GOOGLE_ENRICH` env var is the legacy name for `OWNER_ENRICH` and is still honoured. The `google_status` column was renamed `owner_status`; old databases keep the dead column harmlessly.

## Where to make common changes

| Change | Files |
|---|---|
| New Meta filter | [filters.js](server/src/filters.js) (option list + `FILTER_HELP` + `FILTER_META` + `normalizeFilters`), [urlBuilder.js](server/src/urlBuilder.js), [FilterPanel.jsx](client/src/components/FilterPanel.jsx) |
| New business field | `feedParser.js` (extract) → `BUSINESS_COLUMNS` in `db.js` (auto-`ALTER`s existing DBs via `#migrate`) → the `keep` list in `mergeKeptAd` ([store.js](server/src/store.js)), or a better ad displacing the kept one **wipes it** → `COLUMNS` + `HEADERS` in [exporter.js](server/src/exporter.js) → `ResultsTable.jsx` |
| Owner-lookup logic | [enrich/](server/src/enrich/) — `ownerResolver.js` for the chain, `personNames.js` for extraction/scoring (pure, unit-tested) |
| New tuning knob | [config.js](server/src/config.js) + `.env.example` + the README env table |
| CSV output | [exporter.js](server/src/exporter.js) only |

## Conventions

- ESM throughout (`"type": "module"`), plain JavaScript — no TypeScript, no build step on the server.
- All SQLite columns are `TEXT`; `serialize()` joins arrays with `'; '` and booleans become `'1'`/`'0'`.
- The CSV contract is deliberate and load-bearing: UTF-8 BOM, CRLF, every field collapsed to a single line, `'` prefixed to values Excel would read as a formula. One business is always exactly one spreadsheet row.
- Scraping is human-paced by design — go through `jitter()` / `humanScroll()` in [humanize.js](server/src/scraper/humanize.js) rather than bare `waitForTimeout`.
- Tailwind's `brand` palette (forest green) is defined in [client/tailwind.config.js](client/tailwind.config.js); use `brand-*` rather than hardcoded hex.
- Meta's ToS prohibit scraping; this is a research/educational tool. Keep it headless and paced, and don't add credential-based or authenticated-scale scraping.
