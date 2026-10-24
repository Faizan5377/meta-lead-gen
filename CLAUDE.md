# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Two lead scrapers behind one UI:

1. **Meta Ad Library** — harvests unique advertisers and filters them to the searched niche.
2. **Google Maps** — harvests local businesses with contact details and filters them on lead quality.

Both save each search as an "execution" in a shared Supabase library, so repeat searches only return new leads. See [README.md](README.md) for the product description.

**Scope note:** both scrapers end in the same Hunter.io decision-maker lookup and export the same 13 columns. A lead with nobody to email is dropped, not exported blank.

## Commands

Two independent npm packages — no workspace tooling, no root `package.json`.

```bash
cd server && npm install && npx playwright install chromium
cp .env.example .env          # add Supabase credentials
npm run supabase:setup        # DDL; --check to verify only
npm run dev                   # :8787
npm test                      # unit tests: relevance, target ceiling, Maps quality/viewport, verification gate + niche census

cd client && npm install && npm run dev    # :5173, proxies /api
```

**Node version matters**: scripts pass `--experimental-sqlite`, which Node 20 *rejects outright* (`bad option`). `.nvmrc` pins 22. If `npm run dev` dies instantly, that's why.

Diagnostics that avoid a full run:

```bash
npm run relevance:check -- plumbing US 30     # what the niche gate keeps/drops, with reasons
npm run probe:feed -- plumbing US             # dump a raw GraphQL node to /tmp/feed-node.json
node scripts/probe-sweep.js Plumbers "Dallas TX"   # Maps: how many NEW places the area sweep adds
node scripts/probe-place.js "Some Business Name"   # where Maps hides a place's full-week hours
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

### Google Maps verification of Ad Library leads

`server/src/verify/`. Optional per run (`verifyOnMaps`), and it changes the shape of the pipeline, so read this before touching the orchestrator.

**Why it exists.** Keyword relevance cannot separate a trade from the businesses that sell to it. Measured on a live "HVAC" run: Lincoln Tech scored **79**, HVAC-Plumber SEO Webmasters **85**, United HVAC Motors **84**, while genuine contractors like Bourque Heating and Cooling scored **45**. Suppliers, trade schools and marketing agencies talk about a trade constantly; a local contractor's ad copy is short and generic. **Raising `minRelevance` makes this worse, not better** — it drops the contractors and keeps the suppliers. Don't "fix" relevance by raising the threshold.

Google already draws the line: contractors are filed as `HVAC contractor`, the others as `Technical school`, `Motor supplier`, `Marketing agency`. So:

1. **`verify/niche.js`** runs one ordinary Maps search for the keyword before the harvest and takes a census of the categories that come back. Nothing about any trade is hardcoded — searching "plumber" learns plumbing categories. A category needs **two** businesses, same rule as relevance.js. Sample size is 120 for a reason: a live HVAC census gave `hvac contractor` 105, `air conditioning contractor` 8, `heating contractor` 4 — at a 60 sample the last one never reaches two votes and furnace-led contractors are silently dropped.
2. **`maps/place.js`** looks one business up. **The rail payload carries only TODAY's hours; the place panel carries the full week and the review count.** Verified live:
   - `/search?tbm=map` → `[64][i][1][203][0]` → one day
   - `/maps/preview/place` → `[6][203][0]` → seven days, and `[4][8]` is the review count

   So a 24-hour check must reach the place panel — `lookupPlace` clicks the top card when Maps stops on the rail. `findPlaceRecord` matches on **shape** (feature id at `[10]`, name at `[11]`) because the record's root moves between payloads.
3. **`verify/gate.js`** is pure and unit-tested: the hours rule, the advertiser↔listing join, the niche test. A wrong join attaches someone else's rating to your lead, so a match must be **evidenced** — shared domain (95), exact name after stripping legal noise (85), or ≥0.8 token overlap (70) — and the evidence is stored on the lead as `maps_match`.

### The target is the FINISHED list, not the raw harvest

**Ad Library:** 150 means 150 leads that are verified on Maps *and* carry a decision maker — however many ads that takes. The measured funnel is ~9 harvested advertisers per finished lead, so a target of 150 scans a few thousand ads.

This is why verification and the Hunter lookup run **concurrently with the harvest** rather than after it (`startVerification` + `startEnrichment`, both kicked off in `harvestPhase`). A gate that can reject has to be able to tell the harvest to keep digging; run afterwards, it could only ever shrink the list below what was asked for. The sequence at the end is strict — harvest drains into verification, verification drains into contacts — because each stage feeds the next:

```
harvest() ends → verifier.harvestFinished() → await verifier.promise
               → contacts.harvestFinished() → await contacts.promise
               → noteFinished() → reportShortfall()
```

- `counts.kept` **is** the target: `store.keptBusinesses(run)` filtered to verified + contactable. The harvest's `shouldStop` reads it, which is the whole mechanism.
- `counts.harvested` is now a diagnostic — candidates admitted, cumulative, never decremented. Its ceiling is `run.candidateCeiling` (`target × config.candidatesPerLead`, floor 500, capped by `maxCandidates`), the rail that ends a niche which will not convert.
- Four things can stop the harvest: the target, that ceiling, the Hunter credit cap, and `verify.maxChecks`. **Whichever one fires, `reportShortfall` names it** — "finished with 94 of 150" is indistinguishable from a bug unless the run says which wall it hit.
- `library.note()` happens only in `noteFinished()`, after every gate. Noting a candidate earlier would hide it from all future runs even when Google or Hunter rejects it.
- `store.keptBusinesses(run)` / `maps.keptPlaces(run)` are the only honest views of a run. Never read `run.businesses` or `run.places` directly — they hold candidates, and the CSV is exactly where an unenriched one must not appear.
- The client mirrors this: rows arrive `_pending` and the table shows only finished ones, so what is on screen is what an export would contain. The server decides (`pending:` on `business_added` / `business_verified` / `contact_found`), never the client.

**Google Maps:** unchanged — its target still counts places collected, and it still uses the batch `enrichLeads()` as a closing phase.

### One lead shape, both scrapers

[leadSchema.js](server/src/leadSchema.js) is the whole export: 13 columns, identical whichever scraper found the lead. Before this, the Ad Library exported 38 columns and Maps 24, sharing only `country` and `maps_url` — two lists that could not be stacked.

**The headers are load-bearing.** They are exactly what the Ventix Outreach importer (`outreach/leads.py` in `/Users/faizan/Ventix/Enricher`) auto-detects, so a CSV from here loads into a campaign with no column mapping: `Business Name`→company, `Website`→domain, `First Name`/`Last Name`, `Position`, `Owner Email`→email, `Owner Phone`/`Business Phone`→phone. Renaming one silently breaks that hand-off; `test/leadSchema.test.js` guards it.

`Designation` (Owner / CEO / President / Vice President) is the normalized rung you filter on; `Position` is Hunter's exact title (*"Co-Founder & President"*) and is what `{{position}}` renders in a template. Both are kept on purpose.

### Hunter.io: one decision maker per business

`server/src/enrich/`. Ported from the Python enricher, and the pipeline's last and most expensive gate.

- **[hierarchy.js](server/src/enrich/hierarchy.js)** picks exactly ONE person: Owner → CEO → President → VP, and **null** when nobody reaches that bar — which drops the lead. Emailing every contact at a domain is how a sending domain gets burned. Watch the two traps the tests pin down: "Vice President" contains "President" (so tier 3 excludes it explicitly, and tier 4 must then also catch "Deputy President"), and "Executive Assistant to the CEO" must never read as a CEO.
- **[hunter.js](server/src/enrich/hunter.js)** holds the API client. `CreditBudget.reserve()` takes a credit **before** the call and tracks `inFlight`: Hunter bills per search that returns people, several workers run at once, and counting only on the way out lets a run overshoot its cap by however many searches were in flight. `cleanDomain` rejects social links — 19% of Ad Library leads point at `fb.me` or `api.whatsapp.com`, and searching those spends a credit to be told about Meta's staff.
- **401 ≠ 429.** Invalid key and exhausted account both stop the run; reporting the wrong one sends you hunting a problem you don't have.

Credits are the binding constraint, not runtime: a Starter plan is 2,000 searches a month, and 10,000 leads at a ~60% hit rate needs ~6,000. `npm run hunter:account` prints the balance. Every run takes a `hunterMaxCredits` cap and reports honestly when it hits it.

`enrich/phase.js` exposes the same rules two ways: `createEnricher()` holds the dedup + hierarchy + budget logic, `enrichLeads()` wraps it for a finite list (Maps), and `startEnrichment()` wraps it in workers that consume leads while the Ad Library harvest is still running.

**Apollo goes here.** That split is provider-shaped on purpose: phone lookup and email re-verification become extra steps over the same leads, filling `owner_phone`, without the pipeline changing shape.

### Filtering on the ad's button (CTA)

`cta_text` was always in the feed; `CTA_ACTIONS` in filters.js just makes it filterable. It is Meta's own button vocabulary, the same kind of platform taxonomy as `MEDIA_TYPES` — not niche words.

The `group` field earns its keep: the button says what the ad is **for**. In a live HVAC run, "Apply now" was almost entirely contractors recruiting technicians and trade schools selling courses, while "Book now" and "Get quote" were businesses chasing customers. It is often a sharper filter than the keyword.

### The harvest ceiling is still hard

Asking for 3 once returned 15. Three independent guards now:

1. `drain()` in engine.js re-checks `shouldStop` **after every record**, stopping mid-buffer. Meta's feed arrives a page at a time.
2. `store.considerAd` refuses new **candidates** past `counts.harvested >= run.candidateCeiling`.
3. The last slots are the expensive ones, so `startEnrichment` holds a worker back when the leads already in flight could fill the target (`inFlight >= capacity()`). Without it, five concurrent workers overshoot by four paid credits whose leads then have to be thrown away. A worker that stands down is not lost — the in-flight ones re-enter the loop when they finish, so the tail never stalls.

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
| New verification rule | [verify/gate.js](server/src/verify/gate.js) (`judgeVerified` + `normalizeVerifyFilters`) → [test/verify-gate.test.js](server/test/verify-gate.test.js) → `verify` block in [FilterPanel.jsx](client/src/components/FilterPanel.jsx) |
| New Maps field on a lead | [maps/parser.js](server/src/maps/parser.js) field map → `attach()` in [verify/phase.js](server/src/verify/phase.js) → `BUSINESS_COLUMNS` in [db.js](server/src/db.js) → `toRow` in [library.js](server/src/library.js) → [sql/schema.sql](server/sql/schema.sql) → `COLUMNS`/`HEADERS` in [exporter.js](server/src/exporter.js) → `COLS` **and the matching `<td>`** in [ResultsTable.jsx](client/src/components/ResultsTable.jsx) |
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
