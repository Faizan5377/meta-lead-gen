// Pluggable SERP providers for owner lookup.
//
// Scraping search engines is the most fragile part of this pipeline: free
// engines serve consent walls and CAPTCHAs to headless browsers and throttle by
// IP. A real SERP API removes all of that — JSON in, JSON out, no parsing, no
// blocking. So API providers are tried FIRST and the scraped engines in
// searchOwner.js become the last-resort fallback.
//
// Every provider is optional. With no keys configured this module reports
// "unavailable" and the caller silently falls back to scraping, so the app
// behaves exactly as before.
//
// Adding a provider: append to PROVIDERS with a `request()` that returns
// { results: [{title, url, snippet}], answer? }. Everything else — quota,
// caching, retries, normalisation — is handled here.

import { config } from '../config.js';
import { db } from '../db.js';

const TIMEOUT_MS = 12000;
const CACHE_DAYS = 14;
const MAX_ATTEMPTS = 2;

// Status codes worth another try; 401/402/429 are terminal for the process.
const RETRYABLE = new Set([408, 500, 502, 503, 504]);

const monthKey = () => new Date().toISOString().slice(0, 7); // YYYY-MM

// ── Provider definitions ────────────────────────────────────────────────────
const PROVIDERS = [
  {
    name: 'serper',
    index: 'google',           // Google's index — the best answers for this task
    key: () => config.serp.serperKey,
    async request(key, query, limit) {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: Math.min(20, limit) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { status: res.status, error: await errText(res) };
      const j = await res.json();
      return {
        status: 200,
        data: {
          results: (j.organic || []).map((r) => ({
            title: r.title || '', url: r.link || '', snippet: r.snippet || '',
          })),
          // Google's answer box / knowledge panel often states the founder
          // outright, which is the single most valuable string we can get.
          answer: j.answerBox?.answer || j.answerBox?.snippet || j.knowledgeGraph?.description || null,
        },
      };
    },
  },
  {
    name: 'tavily',
    index: 'tavily',
    key: () => config.serp.tavilyKey,
    async request(key, query, limit) {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          max_results: Math.min(20, limit),
          search_depth: 'basic',   // 1 credit; 'advanced' costs 2
          include_answer: 'basic', // a direct answer when Tavily can produce one
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { status: res.status, error: await errText(res) };
      const j = await res.json();
      return {
        status: 200,
        data: {
          results: (j.results || []).map((r) => ({
            title: r.title || '', url: r.url || '', snippet: r.content || '',
          })),
          answer: typeof j.answer === 'string' ? j.answer : null,
        },
      };
    },
  },
];

async function errText(res) {
  try {
    const t = await res.text();
    return t.slice(0, 200);
  } catch { return `HTTP ${res.status}`; }
}

class SerpRegistry {
  constructor() {
    this.state = new Map(); // name -> { spent, exhausted, lastError }
  }

  #st(name) {
    if (!this.state.has(name)) this.state.set(name, { spent: 0, exhausted: false, lastError: null });
    return this.state.get(name);
  }

  // Providers that have a key and haven't hit their quota.
  available() {
    return PROVIDERS.filter((p) => {
      if (!p.key()) return false;
      const s = this.#st(p.name);
      if (s.exhausted) return false;
      return this.#monthSpent(p.name) < config.serp.maxPerMonth;
    });
  }

  configured() {
    return PROVIDERS.filter((p) => !!p.key()).map((p) => p.name);
  }

  #monthSpent(name) {
    const stored = db.cacheGet(`serpquota:${name}:${monthKey()}`, 0);
    return Number(stored?.count) || 0;
  }

  #charge(name) {
    const s = this.#st(name);
    s.spent++;
    const k = `serpquota:${name}:${monthKey()}`;
    const cur = Number(db.cacheGet(k, 0)?.count) || 0;
    db.cacheSet(k, { count: cur + 1 });
  }

  state_() {
    return PROVIDERS.map((p) => ({
      name: p.name,
      index: p.index,
      configured: !!p.key(),
      exhausted: this.#st(p.name).exhausted,
      spentThisRun: this.#st(p.name).spent,
      spentThisMonth: this.#monthSpent(p.name),
      cap: config.serp.maxPerMonth,
      lastError: this.#st(p.name).lastError,
    }));
  }

  // Run one query against the first provider that answers.
  // Returns { provider, results, answer, cached } or null when none can serve.
  async search(query, { limit = 10 } = {}) {
    if (!config.serp.enabled) return null;

    for (const p of this.available()) {
      // A cached SERP is free — check before spending anything.
      const cacheKey = `serp:${p.name}:${limit}:${query}`;
      const hit = db.cacheGet(cacheKey, CACHE_DAYS * 86400000);
      if (hit !== undefined && hit) {
        return { provider: p.name, ...hit, cached: true };
      }

      const s = this.#st(p.name);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let out;
        try {
          out = await p.request(p.key(), query, limit);
        } catch (err) {
          s.lastError = err.name === 'TimeoutError' ? 'timeout' : err.message;
          if (attempt < MAX_ATTEMPTS) { await sleep(400 * attempt); continue; }
          break;
        }

        if (out.status === 200) {
          this.#charge(p.name);
          const payload = { results: out.data.results || [], answer: out.data.answer || null };
          db.cacheSet(cacheKey, payload);
          return { provider: p.name, ...payload, cached: false };
        }

        s.lastError = out.error || `HTTP ${out.status}`;
        // Out of credits / bad key / rate limited: stop using this provider.
        if ([401, 402, 403, 429].includes(out.status)) {
          s.exhausted = true;
          console.warn(`[serp] ${p.name} disabled for this process (HTTP ${out.status}: ${s.lastError})`);
          break;
        }
        if (!RETRYABLE.has(out.status) || attempt === MAX_ATTEMPTS) break;
        await sleep(400 * attempt);
      }
      // This provider failed — fall through to the next one.
    }
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const serp = new SerpRegistry();
export const SERP_PROVIDER_NAMES = PROVIDERS.map((p) => p.name);
