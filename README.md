# Meta Ad Library — Lead Engine

A real-time tool that mines the **Meta Ad Library** and turns the firehose of running ads into a clean, **ICP-scored list of qualified leads** — streamed live into a premium dashboard and exportable as CSV.

It runs in **two modes**:

- **Lead-gen leads** — finds businesses that close deals on calls (real estate, mortgage, home services, insurance, legal, coaching). Built for selling appointment-setting / voice-AI / lead-qualification services to them. Pure ecommerce is treated as a *negative* signal.
- **Ecom brands** — finds Shopify-style ecommerce brands actively running ads (fashion, beauty, home, etc.).

No database. No API keys. No LLM. All scoring is **deterministic and rules-based**, so every result is explainable and reproducible.

---

## Why this exists

A raw Ad Library search returns thousands of ads — most of them junk for any given sales motion: one-off boosted posts, random individuals, pure e-commerce, link-in-bio spam. This tool applies the signals that actually separate a *real, sellable lead* from noise:

- **Page-level signals** — advertiser category, follower count, whether they have a real linked website.
- **Ad-behaviour signals** — how many ads they run, how long ads have been live, how many creative variants (a brand testing vs. a one-off).
- **Destination signals** — is the click going to a real landing page, a WhatsApp/lead-form funnel, a link-in-bio aggregator, a bare social profile, or a Shopify store?

Each advertiser gets a **0–100 relevance score** and a tier — **Hot / Warm / Cool / Cold** — with the reasons attached, so you can trust (and audit) the ranking.

---

## What you get per lead

| Field | Source |
|---|---|
| Relevance score + tier + reasons | computed |
| Page name, partner, page link | ad card |
| Advertiser category (niche) | "About the advertiser" drawer |
| Active ads for that advertiser | grouped live across results |
| Days running / start date | ad card |
| Creative variants | ad card |
| Platforms (FB / IG / Messenger / Audience Network) | ad card |
| FB + IG follower counts | "About the advertiser" drawer |
| Display domain + decoded destination URL | ad card (tracking params stripped) |
| CTA + headline + ad-text snippet | ad card |
| Ad snapshot permalink | built from Library ID |

---

## Quick start

**Requirements:** Node.js 18+ and macOS/Linux/WSL.

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

Open **http://localhost:5173**. The frontend proxies `/api/*` to the backend, so that's the only URL you need.

A Chromium window opens while scraping (visible by default so you can watch it work and spot any login wall). Flip `HEADFUL=false` in `server/.env` once you trust a run.

---

## How to use it to its full potential

### 1. Pick the right mode
- Selling a service to businesses that take sales calls → **Lead-gen leads**.
- Prospecting ecommerce brands → **Ecom brands**.

The mode swaps the entire scoring dictionary, so the same search returns very different rankings.

### 2. Choose location + ad category wisely
- The **location** drives Meta's `country` filter. For real-estate work, target the markets your buyers are in (US, CA, UK, AU, UAE, Saudi, Egypt are all in the picker).
- **Ad category** matters: Meta only supports **Properties / Financial / Employment** categories in the **US and Canada**. The picker greys these out automatically for other countries (Meta silently breaks the search otherwise). Use **All ads** everywhere else — the scorer still does the filtering from the ad copy and advertiser category.
  - For US/CA real-estate searches, **Properties** dramatically cuts noise.
  - For US/CA mortgage searches, use **Financial products and services**.

### 3. Use the curated keyword presets
Open **Browse curated presets** under the keyword box. Presets are grouped by intent and tier and match the active mode:
- **Lead-gen:** real-estate core, cash buyers / investors, mortgage, MENA real estate, adjacent high-ticket verticals (solar, roofing, insurance, legal, dental, funding, coaching).
- **Ecom:** fashion & apparel, beauty & skincare, home & lifestyle.

Click "Add all" on a tier, or cherry-pick individual keywords. Keyword order = scrape order (drag/reorder with the arrows).

### 4. Set the ad cap
**Max ads to scan per keyword** (100 / 200 / 500, or a custom value up to 500). Higher = more coverage but longer runs. 200 is a good default; bump to 500 for thorough sweeps of competitive keywords.

### 5. Read the results live
- Rows stream in as they're discovered; follower/category cells shimmer, then fill when enrichment completes.
- The **Relevance** column is the first column — sort by it (default) and work top-down.
- **Tier filter chips** above the table; **Cold is hidden by default**. Hover any relevance badge to see *why* it scored that way.
- Mission-control bar shows live counts: ads found, enriched, companies, and Hot/Warm/Cool/Cold breakdown.

### 6. Export
Hit **Export leads** → choose:
- **Scope:** Hot + Warm (default, outreach-ready) / All scored / Everything.
- **Rows:** one row per ad, or one row per company (deduped, with total ad count + matched keywords).

CSV is UTF-8 with a BOM so it opens cleanly in Excel/Sheets.

### Tips for the best lead quality
- **Run focused batches** (10–20 keywords) rather than everything at once — sequential scraping is human-paced and Meta rate-limits aggressive runs.
- **Lead-gen mode rewards** advertisers with 5+ active ads, ads running 30+ days, a real landing page, and a matching advertiser category. Those are your hottest leads.
- **The "company" export mode** is best for outreach lists — one row per business with their total active-ad count as a buying-intent signal.

---

## Configuration (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Backend port |
| `HEADFUL` | `true` | Show the Chromium window while scraping |
| `SLOW_MO_MS` | `0` | Extra slow-mo per action (debugging) |
| `MAX_CARDS_PER_KEYWORD` | `200` | Default ad cap (UI overrides per search) |
| `MAX_SCROLL_MS` | `180000` | Hard ceiling per keyword (3 min) |
| `STABLE_SCROLLS_TO_STOP` | `2` | Exit after N scrolls that yield no new ads |
| `SCROLL_SETTLE_MS` | `2500` | Pause after every scroll so lazy-loaded ads render |
| `NO_NEW_ADS_GRACE_MS` | `8000` | If a scroll shows no new ads, wait this long and re-check before giving up |
| `ENRICH_CONCURRENCY` | `2` | Parallel "See ad details" drawers |
| `STORAGE_STATE` | — | Optional path to a Playwright session JSON for logged-in scraping |

---

## Architecture

```
server/  (Node + Fastify + Playwright, Server-Sent Events)
  src/
    index.js            REST + SSE endpoints
    config.js           .env loader
    locations.js        Canonical Meta country list + 5 ad categories
    keywords.js         Tiered keyword presets (lead-gen + ecom)
    urlBuilder.js        Ad Library search URL builder
    store.js            In-memory session state (no DB)
    eventStream.js      SSE bus with per-session buffer
    scraper/
      engine.js         Playwright discover + enrich passes
      parsers.js        followers / dates / link-decode / page-slug
      humanize.js       jittered delays + human-like scrolling
    scorer.js           Rules-based scorer (lead-gen + ecom dictionaries)
    orchestrator.js     Per-keyword sequencing, scoring, event fan-out
    csvExporter.js      Per-ad and per-company CSV (tier-aware)

client/  (Vite + React + Tailwind + Framer Motion)
  src/
    App.jsx
    lib/                api client, SSE reducer, formatters
    components/         SetupPanel, LocationAutocomplete, AdCategorySelect,
                        KeywordChips, StatusBar, ResultsTable, RelevanceBadge,
                        ExportButton, ThemeToggle
```

**Flow:** the UI creates a session → subscribes to its SSE stream → the orchestrator drives Playwright through each keyword (discover ads, then enrich one advertiser per page and fan the data out to all their ads) → every advertiser is scored once and patched across their rows → results stream into the table and can be exported at any time.

---

## How scoring works (rules, not magic)

Each lead runs through three layers in the active mode's dictionary (`server/src/scorer.js`):

1. **Hard excludes** → immediate *Cold*: non-business pages (Personal Blog, Public Figure, Community), and — in ecom mode — destinations that aren't a real store (WhatsApp, Linktree, Google Forms, bare social profiles).
2. **Weighted ICP matching** → advertiser category, page-name tokens, domain tokens, ad-copy patterns, and CTA/intent signals each contribute points.
3. **Behavioural boosts** → active-ad count, ad age, creative variants, multi-platform spread, follower count, video creative.

Final score is clamped to 0–100 and mapped to a tier. The dictionaries are plain arrays — edit them to tune the ICP as you learn from real runs.

| Score | Tier | Meaning |
|---|---|---|
| 81–100 | Hot | Direct ICP fit — prioritise |
| 61–80 | Warm | Strong fit — second priority |
| 31–60 | Cool | Review before contacting |
| 0–30 | Cold | Off-ICP — hidden by default |

---

## Notes & caveats

- Meta's Terms prohibit scraping; this tool is for research/educational use. Keep request volume modest and human-paced (the scraper already jitters and rate-limits itself).
- Meta changes its DOM frequently. Selectors are anchored on stable text/aria (`Library ID:`, `About the advertiser`, `See ad details`) rather than obfuscated class names. If a field stops extracting, start in `server/src/scraper/engine.js`.
- Properties / Financial / Employment ad categories only exist in the US and Canada — use **All ads** elsewhere.
- Some advertisers hide follower data; those rows keep `enrichment_status: failed` but are still scored from the data available.
- Results live in memory only and are gone when the server restarts — export what you want to keep.
