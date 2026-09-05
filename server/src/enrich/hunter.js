// Hunter.io API v2 client.
//
// Credit scarcity shapes this entire module. A Starter plan has a small monthly
// search allowance while one Ad Library harvest can surface thousands of
// businesses, so every PAID call is gated behind a FREE one:
//
//   domain-finder  (free)      business name -> candidate domains + email counts
//   email-count    (free)      domain        -> how many executives Hunter knows
//   domain-search  (1 credit)  domain        -> decision maker name/title/email
//
// We only spend a credit on a domain that email-count says actually has an
// executive, and every response is cached (memory + SQLite) so the same domain
// is never paid for twice — across runs included.
//
// Nothing here throws. Every method resolves to { ok, data, error, status } and
// the caller degrades to scraping.

import { config } from '../config.js';
import { db } from '../db.js';

const BASE = 'https://api.hunter.io/v2';

// Documented limits: 15 req/s and 500 req/min for search endpoints (10/s for
// the verifier). We stay far under both — enrichment concurrency is 2-3 — but a
// min-interval gate makes bursts impossible regardless of how it's called.
const MIN_INTERVAL_MS = 120;
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 15000;

// Hunter's error envelope: { errors: [{ id, code, details }] }.
function errorMessage(body, status) {
  const first = body?.errors?.[0];
  if (first?.details) return first.details;
  if (first?.id) return first.id;
  return `HTTP ${status}`;
}

// 429 = monthly usage exhausted, 403 = per-second rate limit. Only the latter is
// worth retrying; a spent quota will not recover within a run.
const RETRYABLE = new Set([403, 408, 500, 502, 503, 504]);

class HunterClient {
  constructor() {
    this.apiKey = config.hunter.apiKey;
    this.enabled = config.hunter.enabled && !!this.apiKey;

    this.mem = new Map();          // request key -> parsed payload
    this.lastCallAt = 0;
    this.chain = Promise.resolve(); // serializes the min-interval gate

    // Budget, refreshed by preflight() at the start of each run.
    this.creditsRemaining = null;   // null = unknown until preflight
    this.spentThisRun = 0;
    this.budget = config.hunter.maxCreditsPerRun;
    this.reserve = config.hunter.minCreditsReserve;
    this.quotaExhausted = false;    // set on a 429 so we stop trying
    this.disabledReason = null;     // 'restricted_account' | 'bad_key' | null
    this.account = null;
  }

  // ── budget ────────────────────────────────────────────────────────────────
  resetRunBudget() {
    this.spentThisRun = 0;
    this.quotaExhausted = false;
  }

  // Can we afford one more paid call?
  canSpend() {
    if (!this.enabled || this.quotaExhausted) return false;
    if (this.spentThisRun >= this.budget) return false;
    if (this.creditsRemaining != null && this.creditsRemaining <= this.reserve) return false;
    return true;
  }

  budgetState() {
    return {
      enabled: this.enabled,
      creditsRemaining: this.creditsRemaining,
      spentThisRun: this.spentThisRun,
      budget: this.budget,
      reserve: this.reserve,
      quotaExhausted: this.quotaExhausted,
      disabledReason: this.disabledReason,
      plan: this.account?.plan_name || null,
      resetDate: this.account?.reset_date || null,
    };
  }

  // Read the live credit balance so a run never starts blind. Free call.
  async preflight() {
    this.resetRunBudget();
    if (!this.enabled) return this.budgetState();
    const res = await this.#request('/account', {}, { paid: false, cache: false });
    if (res.ok) {
      this.account = res.data;
      const searches = res.data?.requests?.searches;
      const credits = res.data?.requests?.credits;
      const remaining = searches?.remaining ?? credits?.remaining;
      this.creditsRemaining = Number.isFinite(Number(remaining)) ? Number(remaining) : null;
      if (this.creditsRemaining != null && this.creditsRemaining <= this.reserve) {
        console.warn(`[hunter] only ${this.creditsRemaining} credits left (reserve ${this.reserve}) — paid lookups disabled, falling back to scraping`);
      } else {
        console.log(`[hunter] ${this.account?.plan_name} plan · ${this.creditsRemaining} credits remaining · run budget ${this.budget}`);
      }
    } else {
      // A bad key or an unreachable API must not stop the run.
      console.warn(`[hunter] preflight failed — paid lookups disabled (${res.error})`);
      this.enabled = false;
    }
    return this.budgetState();
  }

  // ── transport ─────────────────────────────────────────────────────────────
  #cacheKey(path, params) {
    const clean = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `hunter:${path}?${clean}`;
  }

  // Serialize calls through a min-interval gate.
  #throttle() {
    const run = async () => {
      const wait = Math.max(0, this.lastCallAt + MIN_INTERVAL_MS - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  async #request(path, params, { paid = true, cache = true } = {}) {
    if (!this.enabled) return { ok: false, error: 'hunter disabled', status: 0 };

    const key = this.#cacheKey(path, params);

    if (cache) {
      if (this.mem.has(key)) return { ok: true, data: this.mem.get(key), cached: true, status: 200 };
      const stored = db.cacheGet(key, config.hunter.cacheDays * 86400000);
      if (stored !== undefined) {
        this.mem.set(key, stored);
        return { ok: true, data: stored, cached: true, status: 200 };
      }
    }

    // Budget is checked here, after the cache — a cached answer is free.
    if (paid && !this.canSpend()) {
      return { ok: false, error: 'credit budget exhausted', status: 0, budgetBlocked: true };
    }

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const url = `${BASE}${path}?${qs.toString()}`;

    let lastError = 'unknown error';
    let lastStatus = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.#throttle();
      let res;
      try {
        res = await fetch(url, {
          headers: { 'X-API-KEY': this.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        lastError = err.name === 'TimeoutError' ? 'request timed out' : err.message;
        lastStatus = 0;
        if (attempt < MAX_ATTEMPTS) { await backoff(attempt); continue; }
        break;
      }

      lastStatus = res.status;
      const body = await res.json().catch(() => null);

      if (res.ok) {
        // A 202 from the verifier means "still working" — treat as no answer
        // rather than a failure, and don't cache it.
        if (res.status === 202) return { ok: false, error: 'verification pending', status: 202 };
        const data = body?.data ?? null;
        if (paid) this.#chargeCredit();
        if (cache && data !== null) {
          this.mem.set(key, data);
          db.cacheSet(key, data);
        }
        return { ok: true, data, status: res.status };
      }

      lastError = errorMessage(body, res.status);

      if (res.status === 429) {
        // Hunter returns 429 for three different situations. `restricted_account`
        // is an account-level block (billing/abuse review) that no amount of
        // retrying or waiting will clear, and it affects free endpoints too — so
        // it disables Hunter outright rather than being mistaken for a credit
        // problem. The run continues on the scrape-only path.
        if (body?.errors?.[0]?.id === 'restricted_account') {
          this.enabled = false;
          this.disabledReason = 'restricted_account';
          console.warn('[hunter] account is restricted by Hunter (not a credit issue) — log in at hunter.io to resolve. Falling back to search + website owner lookup.');
          return { ok: false, error: lastError, status: 429, restricted: true };
        }
        // Otherwise 429 is either a spent allowance or a transient burst limit,
        // and the body can't tell them apart — back off and retry before giving up.
        if (attempt < MAX_ATTEMPTS) { await backoff(attempt + 2); continue; }
        // A FREE endpoint hitting 429 says nothing about the credit balance —
        // condemning the paid path on it would disable Hunter for the whole run
        // over a rate-limit hiccup.
        if (!paid) return { ok: false, error: lastError, status: 429 };
        this.quotaExhausted = true;
        console.warn('[hunter] credit allowance exhausted — switching to scrape-only owner lookup');
        return { ok: false, error: lastError, status: 429, quotaExhausted: true };
      }
      if (res.status === 401) {
        this.enabled = false;
        this.disabledReason = 'bad_key';
        console.warn(`[hunter] API key rejected — disabling Hunter for this process (${lastError})`);
        return { ok: false, error: lastError, status: 401 };
      }
      // 404 = nothing known about this domain/email. A normal, cacheable "no".
      if (res.status === 404) {
        if (paid) this.#chargeCredit();
        if (cache) { this.mem.set(key, null); db.cacheSet(key, null); }
        return { ok: true, data: null, status: 404 };
      }
      if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) break;
      await backoff(attempt);
    }

    return { ok: false, error: lastError, status: lastStatus };
  }

  #chargeCredit() {
    this.spentThisRun++;
    if (this.creditsRemaining != null) {
      this.creditsRemaining = Math.max(0, this.creditsRemaining - 1);
    }
  }

  // ── free endpoints ────────────────────────────────────────────────────────

  // Business name -> candidate domains, each with an email_count. Free, and the
  // only way to get a domain for a business whose Facebook page lists no site.
  async domainFinder(company) {
    if (!company) return { ok: false, error: 'no company name', status: 0 };
    const res = await this.#request('/domain-finder', { company }, { paid: false });
    return res;
  }

  // How many emails/executives Hunter holds for a domain. Free — this is the
  // gate that decides whether a paid domain-search is worth a credit.
  async emailCount(domain) {
    if (!domain) return { ok: false, error: 'no domain', status: 0 };
    return this.#request('/email-count', { domain }, { paid: false });
  }

  // ── paid endpoints ────────────────────────────────────────────────────────

  // The money call: decision makers for a domain.
  async domainSearch(domain, { limit = 10, decisionMaker, seniority, department, type } = {}) {
    if (!domain) return { ok: false, error: 'no domain', status: 0 };
    return this.#request('/domain-search', {
      domain,
      limit,
      decision_maker: decisionMaker ? 'true' : undefined,
      seniority,
      department,
      type,
    });
  }

  async companyEnrichment(domain) {
    if (!domain) return { ok: false, error: 'no domain', status: 0 };
    return this.#request('/companies/find', { domain });
  }

  async personEnrichment(email) {
    if (!email) return { ok: false, error: 'no email', status: 0 };
    return this.#request('/people/find', { email });
  }
}

function backoff(attempt) {
  const ms = 400 * 2 ** (attempt - 1) + Math.random() * 250;
  return new Promise((r) => setTimeout(r, ms));
}

export const hunter = new HunterClient();
