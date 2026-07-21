# Ad Library Harvester

A headless tool that mines the **Meta Ad Library** and turns it into a clean, deduplicated list of **unique businesses** — each enriched with follower counts, Facebook contact details (email / phone / website), and a best-effort owner/founder lookup — streamed live into a modern dashboard and exportable as a single CSV.

It is a **general-purpose** harvester: give it any keyword and any combination of Meta's own filters, and it captures every advertiser it can find, **one row per business**. There are no niche presets or scoring modes — it works the same for real estate, dentists, ecommerce, coaches, or anything else.

---

## What it does

The moment you press **Start**, four phases run automatically, in sequence:

1. **Harvest** — drives a headless Chromium over the Ad Library and intercepts Meta's internal GraphQL feed (far more robust than scraping the visible page). It captures **one unique ad per business** — the *longest continuously running* one — up to your target (default **5,000**). It keeps scrolling until the target is reached or the feed genuinely runs out of ads. It never opens a browser window.
2. **De-dupe across searches** — every business is stored in a local SQLite database. On future searches, ads/businesses you already captured are **skipped automatically**, so you only ever see new results.
3. **Facebook contacts** — visits each business's Facebook page and scrapes email, phone, and website.
4. **Owner lookup** — best-effort web search (Google, with a Bing fallback) for the owner / founder / CEO.

Every phase is wrapped so a failure is logged and streamed but **never crashes the run**. The **Export** button stays disabled until all four phases finish.

### What you get per business

Followers · advertiser category · country · active status · ad start date & days running · CTA · media format · ad copy · destination link · Facebook page link · ad-snapshot link · email · phone · website · owner name & title · library id · numeric page id.

---

## Filters (mirrors the Meta Ad Library)

The filter bar reproduces the Ad Library's own filters and their dynamic behavior:

- **Keyword** + **match type** — broad (any order) or exact phrase
- **Countries** — multi-select, or *All countries* (alphabetically ordered)
- **Ad category** — All ads · Issues/elections/politics · Properties · Employment · Financial products. The last three are legally-restricted transparency categories that only exist in the **US & Canada**, so they are automatically greyed out for other countries — exactly as Meta does.
- **Active status** · **Media type** · **Platforms** · **Languages** · **Ad-delivery date range**
- **Target** — how many unique businesses to collect before stopping

Every filter has an **ⓘ** marker that explains what it does on hover.

---

## Quick start

**Requirements:** Node.js **22.5+** (for the built-in `node:sqlite`) and macOS / Linux / WSL.

```bash
# 1. Backend
cd server
npm install
npx playwright install chromium
cp .env.example .env        # optional — sensible defaults work out of the box

# 2. Frontend
cd ../client
npm install
```

Run the two services in separate terminals:

```bash
# Terminal 1 — backend (http://127.0.0.1:8787)
cd server && npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd client && npm run dev
```

Open **http://localhost:5173**. The scraper runs **headless** — no browser window opens.

> **No database setup needed.** On first launch the backend automatically creates
> `server/data/leads.db` (folder, file, and tables) — so a fresh clone just needs
> `npm install` then `npm run dev`. The database file is gitignored, so every user
> starts with their own empty database. This requires **Node 22.5+** for the
> built-in `node:sqlite`; on older Node the app still runs, just without
> cross-session dedup (persistence is skipped, never a crash).

---

## How to use it

1. **Enter a keyword** (e.g. `real estate`, `dentist`, `fitness coaching`) and **pick one or more countries**. These two fields are all you need to start.
2. **(Optional) refine with filters** — click **Filters** to expand ad category, active status, media type, platforms, languages, and a start-date range. Hover any **ⓘ** to see what a filter does.
3. **Set a target** — the number of unique businesses to collect (default 5,000). The harvester stops early only if the Ad Library genuinely runs out of matching ads.
4. **Press “Start scraping.”** The dashboard comes alive:
   - **Metric cards** at the top count businesses, followers, owners found, and email/phone/website — with rolling animated numbers that stay exactly in sync with the table.
   - A **Harvest → Contacts → Owners → Done** stepper shows live progress bars for each phase.
   - **Rows stream into the table** as businesses are found, then fill in with contacts and owners as enrichment completes.
   - The **Run status** panel in the sidebar shows the current phase and how many businesses were kept vs. skipped (already in your database).
5. **Stop any time** with the red **Stop** button — whatever has been collected is kept.
6. **Export** — when every phase finishes, the green **Export CSV** button activates. One click downloads every business from the run, with all its data, as a single UTF-8 CSV.
7. **Start fresh whenever you like** — the **trash icon** next to the “N in DB” badge clears the local database (with a confirmation) so previously-found businesses are no longer skipped.

> **Tip:** because businesses are deduplicated against the database, you can run the same keyword repeatedly over time and only ever get *new* advertisers each run.

---

## Configuration (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Backend port |
| `HEADFUL` | `false` | Set `true` to watch the browser (debugging only) |
| `TARGET_ADS` | `5000` | Default harvest target (the UI overrides this per search) |
| `MAX_RUN_MS` | `2700000` | Safety ceiling for a whole harvest (45 min) |
| `STABLE_SCROLLS_TO_STOP` | `5` | Stop after N scrolls that surface no new ads |
| `SCROLL_SETTLE_MS` | `2200` | Pause after each scroll so the next feed page loads |
| `ENRICH_CONCURRENCY` | `3` | Parallel pages for contact / owner enrichment |
| `GOOGLE_ENRICH` | `true` | Toggle the automatic owner-lookup phase |
| `DB_PATH` | `server/data/leads.db` | SQLite database location |
| `STORAGE_STATE` | — | Optional Playwright session JSON for logged-in scraping |

---

## Architecture

```
server/  (Node + Fastify + Playwright + node:sqlite, Server-Sent Events)
  src/
    index.js             REST + SSE endpoints
    config.js            .env loader
    filters.js           Full Meta filter definitions, help text + validation
    urlBuilder.js        Ad Library search-URL builder
    db.js                SQLite: seen_ads + businesses (dedup + persistence)
    store.js             Run state + "one longest-running ad per business"
    orchestrator.js      Harvest → contacts → owner pipeline (auto, resilient)
    exporter.js          Single CSV export
    scraper/
      engine.js          Headless GraphQL-feed harvester
      feedParser.js      GraphQL node → normalized ad record
      contactScraper.js  Facebook page → email / phone / website
      googleEnrichment.js  Best-effort owner / founder lookup (Google + Bing)
      parsers.js         followers / dates / link-decode helpers
      humanize.js        jittered delays + human-like scrolling

client/  (Vite + React + Tailwind + Radix + lucide-react)
  src/
    App.jsx              Sidebar + dashboard layout
    lib/                 api client, SSE reducer, formatters
    components/          FilterPanel, Select, MultiSelect, InfoTip,
                         MetricsBar, AnimatedNumber (odometer), ProgressPanel,
                         ResultsTable, ExportButton, ClearDbButton
```

**Data flow:** the UI creates a run → subscribes to its SSE stream → the orchestrator drives the headless browser through harvest + enrichment, persisting to SQLite and fanning typed events out → metrics and rows update live, and the single CSV export unlocks once everything is done. Metrics are derived from the live business array, so the on-screen numbers always equal the table rows.

**API endpoints**

| Method & path | Purpose |
|---|---|
| `GET /api/filters` | All Meta filter definitions + help text |
| `GET /api/db/stats` · `POST /api/db/clear` | Database size · wipe it |
| `POST /api/runs` | Create a run from a filter set |
| `POST /api/runs/:id/start` · `/stop` | Begin / cancel the pipeline |
| `GET /api/runs/:id` | Snapshot (for refresh / late subscribers) |
| `GET /api/runs/:id/events` | Live SSE stream |
| `GET /api/runs/:id/export` | Single CSV (only after the run is done) |

---

## Notes & caveats

- Meta's Terms prohibit scraping; this tool is for research/educational use. It runs headless and human-paced.
- The owner lookup is inherently unreliable — search engines throw consent walls and CAPTCHAs, and many small businesses publish no owner data. It fills what it can and marks the rest `not_found` / `blocked`, never blocking the run.
- Meta changes its internals frequently. Selectors are anchored on the GraphQL feed rather than page markup; if a field stops extracting, start in `server/src/scraper/feedParser.js`.
- Results and the dedup database persist in `server/data/leads.db`. Delete it (or use the in-app trash button) to start completely fresh.
