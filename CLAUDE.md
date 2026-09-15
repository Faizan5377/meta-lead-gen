# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Meta Ad Library scraper. It harvests unique advertisers, filters them to the searched niche, and saves each search as an "execution" in a shared Supabase library so repeat searches only return new advertisers. See [README.md](README.md) for the product description.

**Scope note:** owner lookup, Hunter.io and contact scraping were removed. This is an Ad Library scraper only — don't reintroduce third-party enrichment.

## Commands

Two independent npm packages — no workspace tooling, no root `package.json`.

```bash
cd server && npm install && npx playwright install chromium
cp .env.example .env          # add Supabase credentials
npm run supabase:setup        # DDL; --check to verify only
npm run dev                   # :8787
npm test                      # relevance gate unit tests

cd client && npm install && npm run dev    # :5173, proxies /api
```

**Node version matters**: scripts pass `--experimental-sqlite`, which Node 20 *rejects outright* (`bad option`). `.nvmrc` pins 22. If `npm run dev` dies instantly, that's why.

Diagnostics that avoid a full run:

```bash
npm run relevance:check -- plumbing US 30     # what the niche gate keeps/drops, with reasons
npm run probe:feed -- plumbing US             # dump a raw GraphQL node to /tmp/feed-node.json
```

There is **no linter**. `npm test` covers `relevance.js` only.

## Architecture

`client` (Vite/React) → REST + SSE → `server` (Fastify) → Playwright Chromium → Supabase (+ SQLite mirror).

**Pipeline:** harvest → (optional) advertiser details → save. `POST /api/runs` normalizes filters and names the run → client subscribes to SSE → `/start` runs the pipeline → results save in ONE batch at the end, including when the run is stopped or errors.

### The GraphQL feed is the only data source

[engine.js](server/src/scraper/engine.js) intercepts `/api/graphql` responses; [feedParser.js](server/src/scraper/feedParser.js) normalizes them. **There is no DOM-scraping fallback** — scrolling exists only to make Meta stream the next page. If a field stops extracting, start in `feedParser.js`, not in selectors.

Confirmed available free in the feed (verified with `probe:feed`): `publisher_platform`, `page_like_count` (Facebook followers), `page_categories`, `collation_count` (ads running), `start_date`, `ad_archive_id`, full creative. **Instagram followers are NOT in the feed** — they only exist in the "About the advertiser" panel, which is why that enrichment is opt-in and costs a page load per advertiser.

### Niche relevance is the core differentiator

[relevance.js](server/src/relevance.js). Meta's search is loose — "plumbing" returns cholesterol supplements. Two rules, both deliberate and **not to be traded away**:

1. **No vertical is hardcoded.** No "plumbing words" list. Scoring uses the keyword, the ad's own text/destination, and Meta's page-category taxonomy. An earlier iteration of this project drifted into hardcoded word lists and the user rejected it — don't go back.
2. **The niche is learned per run.** Ads matching the keyword directly teach which page categories belong to the niche; later ads pass on category alone. That's what makes a broad keyword like "home services" reach a plumber whose copy never says it.

Guards that matter:
- Only the **primary** category is learned. Learning secondary ones bled the niche (plumbers carry "Construction" second, which let a homebuilder through).
- A learned category needs **two** corroborating advertisers before it can vouch alone.
- A category-only pass never teaches, or it self-reinforces.
- Rejected ads **don't consume the target**, which is how you still get exactly N relevant results.

### The run target is a hard ceiling

Two independent guards, because this was a real bug (asking for 3 returned 15):

1. `drain()` in engine.js re-checks `shouldStop` **after every record**, stopping mid-buffer. Meta's feed arrives a page at a time.
2. `store.considerAd` refuses new businesses past the target.

Guard 2 deliberately allows **updates** to businesses already kept (extra keyword, longer-running ad). `MAX_TARGET` (2500) is enforced in `normalizeFilters`.

### Library: Supabase with a real SQLite fallback

[library.js](server/src/library.js) is the only storage interface. Supabase is the source of truth; SQLite is a mirror AND a working fallback — if Supabase is unreachable the run continues locally rather than failing, and `mode` tells the UI which is live.

Dedup is a **memory hit, not a network call**: every known id is warmed into a Set at boot. Saving is **one batched round-trip at the end** of a run, not per-ad.

`seen_ads` records ads we processed but rejected, so later runs don't re-evaluate them.

### Executions, not a flat list

The Library page is organised around runs. Each is auto-named `"<keywords> · <countries> · #<seq>"`, where seq counts prior runs of the same search — so repeating a keyword is visibly a separate execution. Deleting an execution removes its ads and frees those advertisers to be collected again.

### SSE contract — adding an event touches three places

1. an `emit(...)` in [orchestrator.js](server/src/orchestrator.js),
2. a `case` in the reducer in [eventClient.js](client/src/lib/eventClient.js),
3. its name in the `types` array in `subscribeToRun` — **omit this and the event is silently dropped** (EventSource listens per event name).

`run_started` / `run_finished` / `__snapshot__` carry a full snapshot that **replaces** `businesses`, so dropped events self-heal. Metrics are derived from `state.businesses` in a `useMemo` — never add parallel counters for display.

### Failure philosophy

Every phase is wrapped; per-item failures are pushed to `run.errors` and emitted as `recoverable`. Results save even when a run is stopped or errors. Export is allowed on `finished`, `stopped`, **or `error`**.

## Where to make common changes

| Change | Files |
|---|---|
| New Meta filter | [filters.js](server/src/filters.js) (options + `FILTER_HELP` + `FILTER_META` + `normalizeFilters` + `conditional`), [urlBuilder.js](server/src/urlBuilder.js), [FilterPanel.jsx](client/src/components/FilterPanel.jsx) |
| New ad field | `feedParser.js` → `BUSINESS_COLUMNS` in [db.js](server/src/db.js) → the `keep` list in `mergeKeptAd` ([store.js](server/src/store.js)), or a displacing ad **wipes it** → `toRow` in [library.js](server/src/library.js) → [sql/schema.sql](server/sql/schema.sql) (+ `supabase:setup`) → `COLUMNS`/`HEADERS` in [exporter.js](server/src/exporter.js) → `ResultsTable.jsx` |
| Relevance tuning | [relevance.js](server/src/relevance.js) weights + [test/relevance.test.js](server/test/relevance.test.js) |

Conditional filter rules live **on the server** (`FILTER_META.conditional`) so they're defined once, not duplicated in the client.

## Conventions

- ESM throughout, plain JavaScript — no TypeScript, no server build step.
- SQLite columns are all `TEXT`; Supabase uses real `text[]`/`integer`/`boolean`. `toRow` in library.js is the boundary.
- CSV contract is load-bearing: UTF-8 BOM, CRLF, every field collapsed to one line, `'` prefixed to values Excel reads as formulas.
- Scraping is human-paced — go through `jitter()`/`humanScroll()` in [humanize.js](server/src/scraper/humanize.js).
- Tailwind `brand` palette (forest green) in [tailwind.config.js](client/tailwind.config.js); use `brand-*`, not hex.
- Meta's ToS prohibit scraping; keep it headless and paced.
