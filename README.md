# Lead Harvester

Two headless lead scrapers behind one interface:

- **Meta Ad Library** — a clean, deduplicated list of **unique advertisers**, each with how long its ad has been running, how many ads it's running, the platforms it runs on, follower counts, and a direct link to open the ad.
- **Google Maps** — local businesses with phone, website, rating, review count, hours and coordinates, filtered on lead quality Google itself won't filter on.

Every search is saved as an **execution** in a shared Supabase library, so running the same search again only ever returns leads you don't already have.

---

## What it does

Press **Start** and three phases run in sequence:

1. **Harvest** — drives a headless Chromium over the Ad Library and intercepts Meta's internal GraphQL feed (far more robust than scraping the visible page). It captures **one ad per advertiser** — the longest continuously running one — and keeps scrolling until your target is reached or the feed genuinely runs out.
2. **Advertiser details** *(optional)* — opens each advertiser's "About the advertiser" panel for the Instagram handle and follower count, which the feed doesn't carry. Off by default because it costs a page load per advertiser.
3. **Save** — writes the execution to the shared library in one batch.

### Niche relevance — the part that matters

Meta's keyword search is loose. Searching **"plumbing"** genuinely returns a cholesterol supplement, a drain-hair gadget and washing-machine tablets alongside actual plumbers.

Every harvested ad is therefore scored against your niche and the weak ones are dropped **before they use up your target**, so you still get exactly the number you asked for — all of them relevant.

Two rules make this work for any niche:

- **Nothing about any vertical is hardcoded.** There is no list of "plumbing words". Scoring uses only your keyword, the ad's own text and destination, and **Meta's own page-category taxonomy**.
- **The niche is learned as the run proceeds.** A broad keyword like "home services" rarely appears verbatim in a plumber's ad copy. Ads that *do* match teach the gate which page categories belong to this niche ("Plumbing Service", "Appliance Repair"), and later ads are then accepted on category alone — but only after two independent advertisers corroborate that category.

You can widen the niche with your own related terms per run. That's data you supply, never code.

A live sample of 30 ads for "plumbing" kept 20 genuine plumbing/HVAC businesses and dropped a cholesterol community, a jewellery brand, a book and an auto service.

### What you get per advertiser

Business name · **direct ad URL** · Facebook page · days running · started date · active status · **number of ads running** · **platforms** (Facebook / Instagram / Messenger / Threads / Audience Network) · **Facebook followers** · Instagram followers & handle (optional) · page categories · country · matched keyword(s) · relevance score & reason · headline · ad copy · CTA · destination URL · domain · media format · image/video URL · library id · page id.

---

## Filters

The filter bar reproduces the Ad Library's own filters and their conditional behaviour:

- **Keywords** — add as many as you like. Each is searched **separately** and merged, because Meta has no OR syntax (`dentist, plumber` as one query matches nothing).
- **Countries** — multi-select, or *All countries*
- **Ad category** — All ads · Issues/elections/politics · Properties · Employment · Financial products. The last three only exist in the **US & Canada**, so they're greyed out elsewhere, exactly as Meta does. Changing country to one where your chosen category isn't legal resets it to "All ads".
- **Match type** · **Active status** · **Media type** · **Platforms** · **Languages** · **Impressions by date** range
- **Sort by** — Impressions high-to-low, or Most recent (the only two Meta offers)
- **Target** — how many advertisers to collect. **Hard ceiling of 2,500**, and a run returns *exactly* that many, never more. Fewer only when the Ad Library genuinely runs out.

Media type is disabled for the issues/elections/politics category, which Meta doesn't apply it to.

---

## The library

The **Ad Library** page lists every search you've run as a collapsible **execution**, newest first. Each is auto-named so repeats are unmistakable:

```
plumbing · US · #1
plumbing · US · #2      ← same search, later run, clearly separate
roofing · US/CA · #1
```

Each execution shows when it ran, how many ads it collected, how many were filtered as off-niche, and how many were skipped because you already had them. Expand one to browse its ads, or export just that execution as CSV. You can rename executions, and deleting one frees its advertisers to be collected again.

---

## Google Maps

The second tab is a **Google Maps scraper** — the same idea applied to local businesses. Type a business type and a place, and every result comes back with its phone, website, rating, review count, category, opening hours, address and coordinates, plus a direct Maps link and the CID link that opens its Google Business Profile.

It reads Google's own internal JSON rather than the visible page, so it survives restyling. Results are deduplicated against the same shared library, so repeat searches only return businesses you don't already have.

### Lead quality — filters Google doesn't offer

Google gives you no filters at all. These are applied to every result, and **anything filtered out never uses up your target** — so tightening them makes your list better, not shorter:

- **Phone / Website** — *Any*, *Must have*, or *Must NOT have*. "No website" is the strongest prospect list there is if you sell websites.
- **Rating between** — a range, not just a floor. Looking for businesses with a reputation problem you can fix? `3.0 – 4.2`.
- **Reviews between** — an upper bound finds smaller, less established businesses, usually far more receptive than a chain with 20,000 reviews.
- **Exclude names** — the quickest way to strip national chains out of a local list.
- **Only these / Exclude categories** — Google mixes adjacent trades into one search; this pins results to the trade you actually want.
- **Keep unrated places** · **Only open right now**

Every rejection is counted with its reason, and the run shows you which gate did the damage — so a short list is never a mystery.

### Getting the number you asked for

Google caps **one search at roughly 120 results**, however far you scroll. That's a limit on the query, not on the scraper — which is why a target of 100 behind strict filters can finish in single figures. With **"Widen the search"** on (the default), a run that's still short does two more things automatically:

1. **Asks differently.** The categories Google itself gave the leads that passed — "Drainage service", "Water heater installer" — become fresh searches, each with its own ~120 results, and on-niche by construction because they were learned from leads *your* filters accepted. Nothing about any trade is hardcoded.
2. **Asks elsewhere.** The same search is re-run over neighbouring parts of the map, **nearest first**. Each viewport returns its own ~120, ranked by proximity to that centre.

"How far out" is a **ceiling, not a plan** — the sweep stops the moment your target is met, so a generous setting costs nothing on an easy search. If a run still finishes short, it tells you exactly which lever to pull: loosen the filter that dropped the most, search further out, or add more search terms.

---

## Quick start

**Requirements:** Node.js **22.5+** and macOS / Linux / WSL. An `.nvmrc` is included — run `nvm use`, since Node 20 rejects the `--experimental-sqlite` flag the scripts pass.

```bash
# 1. Backend
cd server
npm install
npx playwright install chromium
cp .env.example .env        # add your Supabase credentials
npm run supabase:setup      # creates the tables
npm test                    # unit tests for the relevance gate

# 2. Frontend
cd ../client
npm install
```

Run the two services in separate terminals:

```bash
cd server && npm run dev    # http://127.0.0.1:8787
cd client && npm run dev    # http://localhost:5173
```

The scraper runs **headless** — no browser window opens.

---

## Supabase

Supabase is the shared library: every run reads it to skip advertisers you already have, and writes new ones back. That's what makes repeat searches return only new results, across machines rather than just one laptop.

Storage is tiny — roughly 2–3 KB per ad, so the 500 MB free tier holds well over 100,000 ads. No files are stored; image and video fields are URLs only (the scraper blocks media downloads, which is what keeps it fast).

If Supabase is unreachable — no credentials, project paused, network down — the app **keeps working against the local SQLite library** instead of failing the run, and the UI says which store is live.

---

## Configuration (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Backend port |
| `HEADFUL` | `false` | Set `true` to watch the browser (debugging only) |
| `MAX_TARGET` | `2500` | Hard ceiling on ads per run |
| `MAX_RUN_MS` | `5400000` | Safety ceiling for a whole harvest (90 min) |
| `STABLE_SCROLLS_TO_STOP` | `5` | Stop after N scrolls that surface no new ads |
| `SCROLL_SETTLE_MS` | `2200` | Pause after each scroll so the next feed page loads |
| `ENRICH_CONCURRENCY` | `3` | Parallel pages for advertiser-detail enrichment |
| `RELEVANCE_ENABLED` | `true` | The niche gate |
| `RELEVANCE_MIN_SCORE` | `40` | Score an ad must reach to be kept |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | — | Shared library |
| `SUPABASE_DB_PASSWORD` | — | Only needed by `supabase:setup` (DDL) |
| `DB_PATH` | `server/data/leads.db` | Local fallback library |
| `STORAGE_STATE` | — | Optional Playwright session JSON |
| `MAPS_MAX_TARGET` / `MAPS_DEFAULT_TARGET` | `2500` / `100` | Maps run size |
| `MAPS_STABLE_SCROLLS` | `6` | Stop a Maps search after N scrolls that surface nothing new |
| `MAPS_SCROLL_SETTLE_MS` | `1600` | Pause after each rail scroll |
| `MAPS_MAX_QUERY_MS` / `MAPS_MAX_RUN_MS` | 10 min / 60 min | Safety ceilings per search and per run |

---

## Architecture

```
server/  (Node + Fastify + Playwright + Supabase, Server-Sent Events)
  src/
    index.js             REST + SSE endpoints
    config.js            .env loader
    filters.js           Meta filter definitions, help text + validation
    urlBuilder.js        Ad Library search-URL builder
    relevance.js         Niche gate — scoring + per-run category learning
    library.js           Shared library: Supabase, with SQLite fallback
    db.js                Local SQLite mirror
    store.js             Run state + "one longest-running ad per advertiser"
    orchestrator.js      Harvest → enrich → save pipeline
    exporter.js          CSV export (per run, or per execution)
    scraper/
      engine.js          Headless GraphQL-feed harvester
      feedParser.js      GraphQL node → normalized ad record
      advertiserScraper.js  "About the advertiser" → Instagram followers
      parsers.js         dates / link-decode helpers
      humanize.js        jittered delays + human-like scrolling
    maps/
      engine.js          Maps harvester: search → learned terms → area sweep
      parser.js          Maps' internal JSON → normalized place record
      quality.js         Lead-quality gate (pure, unit-tested)
      orchestrator.js    Harvest → save pipeline
      library.js         Shared places library
  sql/schema.sql         Supabase tables + indexes
  scripts/               supabase-setup · relevance-check · probe-feed · probe-sweep · shoot-ui
  test/                  relevance gate · target ceiling · lead quality · viewport maths

client/  (Vite + React + Tailwind)
  src/
    App.jsx              Shell + navigation + theme
    pages/               ScraperPage · LibraryPage · MapsPage · MapsLibraryPage
    lib/                 api client, SSE reducers, formatters
    components/          FilterPanel, ResultsTable, MetricsBar, ProgressPanel…
```

**API**

| Method & path | Purpose |
|---|---|
| `GET /api/filters` | Filter definitions + conditional rules |
| `POST /api/runs` · `/:id/start` · `/:id/stop` | Create / run / cancel |
| `GET /api/runs/:id` · `/:id/events` · `/:id/export` | Snapshot · SSE · CSV |
| `GET /api/library/runs` | Every execution |
| `GET /api/library/runs/:id/ads` · `/export` | One execution's ads · CSV |
| `PATCH`/`DELETE /api/library/runs/:id` | Rename / delete an execution |
| `GET /api/library/stats` | Library size + which store is live |

Google Maps mirrors the same shape under `/api/maps/…` — `limits`, `runs` (+ `start` · `stop` · `events` · `export`), and `library/runs` (+ `places` · `export` · rename · delete) · `library/stats`.

---

## Diagnostics

```bash
npm run relevance:check -- plumbing US 30      # what the niche gate keeps vs drops, and why
npm run relevance:check -- "home services" US 30
npm run probe:feed -- plumbing US              # dump a raw GraphQL node
npm run supabase:setup -- --check              # verify tables exist
```

---

## Notes & caveats

- Meta's Terms prohibit scraping; this tool is for research/educational use. It runs headless and human-paced.
- Meta changes its internals frequently. Selectors are anchored on the GraphQL feed rather than page markup; if a field stops extracting, start in `server/src/scraper/feedParser.js`.
- Instagram follower counts require the optional enrichment phase — the feed only carries Facebook followers.
