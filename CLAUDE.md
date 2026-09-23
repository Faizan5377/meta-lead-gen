# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Two lead scrapers behind one UI:

1. **Meta Ad Library** — harvests unique advertisers and filters them to the searched niche.
2. **Google Maps** — harvests local businesses with contact details and filters them on lead quality.

Both save each search as an "execution" in a shared Supabase library, so repeat searches only return new leads. See [README.md](README.md) for the product description.

**Scope note:** owner lookup, Hunter.io and contact scraping were removed. Don't reintroduce third-party enrichment.

## Commands

Two independent npm packages — no workspace tooling, no root `package.json`.

```bash
cd server && npm install && npx playwright install chromium
cp .env.example .env          # add Supabase credentials
npm run supabase:setup        # DDL; --check to verify only
npm run dev                   # :8787
npm test                      # unit tests: relevance gate, target ceiling, Maps quality + viewport maths

cd client && npm install && npm run dev    # :5173, proxies /api
```

**Node version matters**: scripts pass `--experimental-sqlite`, which Node 20 *rejects outright* (`bad option`). `.nvmrc` pins 22. If `npm run dev` dies instantly, that's why.

Diagnostics that avoid a full run:

```bash
npm run relevance:check -- plumbing US 30     # what the niche gate keeps/drops, with reasons
npm run probe:feed -- plumbing US             # dump a raw GraphQL node to /tmp/feed-node.json
node scripts/probe-sweep.js Plumbers "Dallas TX"   # Maps: how many NEW places the area sweep adds
```

There is **no linter**.

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

### Google Maps: `server/src/maps/`

Same shape as the Ad Library scraper — drive the real UI headlessly, read the internal JSON feed, never the DOM — with its own orchestrator, library table and SSE stream. Scrolling the results rail is the pagination mechanism.

Three things here are counter-intuitive enough to have each caused a bug:

**1. Responses are bracketed at BOTH ends, and page 2 onward is double-wrapped.** The first page is a bare array behind `)]}'`. Every page that scrolling fetches arrives as `{"c":0,"d":")]}'\n[[…]"}/*""*/` — the real payload is a *string* in `d`, with its own prefix, and a **trailing** `/*""*/`. Miss either and `JSON.parse` throws on the whole body: the first page parsed and every later page silently yielded nothing, costing ~100 of every 120 results. `parseBody` in [parser.js](server/src/maps/parser.js) strips both ends and recurses into `d`.

**2. Review counts are not in the feed.** The rating is; the count only exists on the rail's accessibility label (`"4.9 stars 905 Reviews"`). The two join on **feature id**, read from each card's href — never on position. The rail also renders *after* places have already streamed out, so a fast run finishes with an empty rail; `harvestQuery` polls for up to 12s until the rail covers what it emitted, then `onReviewCounts` patches the kept places and emits a corrected snapshot.

**3. Google caps ONE search at ~120 results**, however far you scroll. That is a hard ceiling on the query, not on the scraper — a target of 100 behind a strict quality gate finished at 9. So `harvest()` runs **three passes**, each entered only while `needsMore()`:

1. the searches as typed;
2. **ask differently** — `relatedTerms()` hands back the categories Google gave the businesses this search turned up, each a fresh search with its own ~120. Cheapest per new lead, and on-niche by construction;
3. **ask elsewhere** — `readViewport` reads the `/@lat,lng,zoomz` Maps rewrites into the URL, `gridAround` returns neighbouring viewports **nearest first**, and each is re-searched with its own ~120 (Maps ranks by proximity to that centre).

`expandRing` is a *ceiling, not a plan*: the target is re-checked before every cell, so a wide setting costs nothing on an easy search. Overlapping cells return the same business repeatedly — `run.seen` dedups before any counter moves.

**`noteCategory` deliberately learns from REJECTED places too.** A plumber with 12 reviews is still a plumber; learning only from survivors starves the learner exactly when a strict gate makes pass 2 matter. Only a rejection in `OFF_NICHE` (name/category exclusions) disqualifies a place from teaching. As in the Ad Library: primary category only, and two businesses before a category counts.

A run that still finishes short calls `adviseOnShortfall`, which names the filter that dropped the most and what to change. Finishing at 9 of 100 with no explanation is indistinguishable from a bug.

Field indices for the place record are documented at the top of [parser.js](server/src/maps/parser.js) — verified against live data, so start there when a field stops extracting.

Unlike the Ad Library, Maps has **no SQLite mirror**: [maps/library.js](server/src/maps/library.js) is Supabase plus a warmed in-memory id set, so without credentials dedup is per-process only.

### Lead quality is a gate, not a search filter

[quality.js](server/src/maps/quality.js) is pure and unit-tested. Google offers no filters, so everything is applied after the fact: phone/website as **tri-state** (`any` / `required` / `none` — "none" is how you find businesses with no website), rating and review **ranges** (an upper bound is what finds smaller, more receptive businesses), name and category exclusions, unrated-ok, open-now.

Two rules:
- **Rejects never consume the target** — same guarantee as the niche gate, so tightening filters makes results better, not fewer.
- **Every rejection carries a reason.** `place_rejected` emits it and the UI tallies them, because a gate that silently eats 80% of a list is untrustworthy. Defaults must let everything through.

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

The Maps stream is the same contract in [maps/orchestrator.js](server/src/maps/orchestrator.js) and [mapsClient.js](client/src/lib/mapsClient.js) (`places`, `places_patched`).

### Failure philosophy

Every phase is wrapped; per-item failures are pushed to `run.errors` and emitted as `recoverable`. Results save even when a run is stopped or errors. Export is allowed on `finished`, `stopped`, **or `error`**.

## Where to make common changes

| Change | Files |
|---|---|
| New Meta filter | [filters.js](server/src/filters.js) (options + `FILTER_HELP` + `FILTER_META` + `normalizeFilters` + `conditional`), [urlBuilder.js](server/src/urlBuilder.js), [FilterPanel.jsx](client/src/components/FilterPanel.jsx) |
| New ad field | `feedParser.js` → `BUSINESS_COLUMNS` in [db.js](server/src/db.js) → the `keep` list in `mergeKeptAd` ([store.js](server/src/store.js)), or a displacing ad **wipes it** → `toRow` in [library.js](server/src/library.js) → [sql/schema.sql](server/sql/schema.sql) (+ `supabase:setup`) → `COLUMNS`/`HEADERS` in [exporter.js](server/src/exporter.js) → `ResultsTable.jsx` |
| Relevance tuning | [relevance.js](server/src/relevance.js) weights + [test/relevance.test.js](server/test/relevance.test.js) |
| New Maps place field | field map at the top of [maps/parser.js](server/src/maps/parser.js) → `normalizePlace` → `toRow` in [maps/library.js](server/src/maps/library.js) → [sql/schema.sql](server/sql/schema.sql) (+ `supabase:setup`) → `PLACE_COLUMNS`/`PLACE_HEADERS` in [exporter.js](server/src/exporter.js) → `PlacesTable` in [MapsPage.jsx](client/src/pages/MapsPage.jsx) |
| New lead-quality filter | `DEFAULT_QUALITY` + `normalizeQuality` + `judge` + `isActive` in [maps/quality.js](server/src/maps/quality.js) → [test/quality.test.js](server/test/quality.test.js) → `DEFAULTS.quality` + `QualityPanel` + `countActiveQuality` in [MapsPage.jsx](client/src/pages/MapsPage.jsx) |

Conditional filter rules live **on the server** (`FILTER_META.conditional`) so they're defined once, not duplicated in the client.

## Conventions

- ESM throughout, plain JavaScript — no TypeScript, no server build step.
- SQLite columns are all `TEXT`; Supabase uses real `text[]`/`integer`/`boolean`. `toRow` in library.js is the boundary.
- CSV contract is load-bearing: UTF-8 BOM, CRLF, every field collapsed to one line, `'` prefixed to values Excel reads as formulas.
- Scraping is human-paced — go through `jitter()`/`humanScroll()` in [humanize.js](server/src/scraper/humanize.js).
- Tailwind `brand` palette (forest green) in [tailwind.config.js](client/tailwind.config.js); use `brand-*`, not hex.
- Meta's ToS prohibit scraping; keep it headless and paced.
