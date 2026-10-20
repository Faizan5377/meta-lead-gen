// Hunter.io Domain Search — find the decision maker behind a website.
//
// Ported from the Ventix Enricher (enricher.py), keeping the two things that
// version got right and that are easy to lose in a rewrite:
//
//   1. Credits are RESERVED before a search runs. Hunter charges one credit per
//      search that returns people, and several workers are in flight at once —
//      counting only on the way out lets a run overshoot its cap by however
//      many searches were running. `inFlight` is the fix.
//   2. 401 and 429 mean different things. An invalid key and an exhausted
//      account both stop the run, but telling the user the wrong one sends
//      them hunting for a problem they don't have.

import { config } from '../config.js';

const BASE = 'https://api.hunter.io/v2';

export class HunterError extends Error {
  constructor(message, { fatal = false } = {}) {
    super(message);
    this.fatal = fatal;          // fatal = stop the whole run, not just this lead
  }
}

// A website, domain, or email -> the bare hostname Hunter wants.
//
// Returns '' for anything that is not a plausible company domain, which is the
// important half: the Ad Library is full of fb.me and api.whatsapp.com links,
// and searching those burns a credit to be told about Meta's staff.
const SOCIAL = new Set([
  'facebook.com', 'fb.me', 'fb.com', 'm.me', 'instagram.com', 'linkedin.com',
  'api.whatsapp.com', 'wa.me', 'whatsapp.com', 'youtube.com', 'tiktok.com',
  'x.com', 'twitter.com', 'linktr.ee', 'bit.ly', 'goo.gl', 'google.com',
  'sites.google.com', 'business.site', 'wixsite.com', 'typeform.com',
]);

export function cleanDomain(value) {
  let v = String(value ?? '').trim();
  if (!v || v.toLowerCase() === 'nan' || v.toLowerCase() === 'null') return '';
  if (v.includes('@')) v = v.split('@').pop();
  if (!v.includes('://')) v = `http://${v}`;
  let host;
  try {
    host = new URL(v).hostname.toLowerCase();
  } catch {
    return '';                                   // "[link removed]" and friends
  }
  if (host.startsWith('www.')) host = host.slice(4);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return '';
  // A social or shortener link is not a company domain, and Hunter would
  // happily charge a credit to tell us about Facebook.
  if (SOCIAL.has(host)) return '';
  const base = host.split('.').slice(-2).join('.');
  return SOCIAL.has(base) ? '' : host;
}

export async function account(apiKey = config.hunter.apiKey) {
  if (!apiKey) throw new HunterError('No Hunter API key configured (HUNTER_API_KEY).', { fatal: true });
  const res = await fetch(`${BASE}/account?api_key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new HunterError(`Hunter account check failed (${res.status}).`, { fatal: true });
  const d = (await res.json()).data || {};
  const s = d.requests?.searches || {};
  return {
    email: d.email, plan: d.plan_name,
    used: s.used ?? null, available: s.available ?? null,
    remaining: s.available != null && s.used != null ? s.available - s.used : null,
    resetDate: d.reset_date || null,
  };
}

// Tracks spend for one run and refuses to start a search that would exceed it.
export class CreditBudget {
  constructor(limit) {
    this.limit = Number.isFinite(limit) && limit > 0 ? limit : Infinity;
    this.used = 0;
    this.inFlight = 0;
    this.exhausted = false;
  }

  // Hold a credit before the call. Counting on the way out instead would let
  // every in-flight search overshoot the cap.
  reserve() {
    if (this.used + this.inFlight >= this.limit) {
      if (this.inFlight === 0) this.exhausted = true;   // truly spent, not just held
      return false;
    }
    this.inFlight++;
    return true;
  }

  // `charged` is whether Hunter actually billed — a search finding nobody is free.
  release(charged) {
    this.inFlight--;
    if (charged) this.used++;
    if (this.used >= this.limit) this.exhausted = true;
  }

  get remaining() { return this.limit === Infinity ? Infinity : Math.max(0, this.limit - this.used); }
}

async function call(endpoint, params, apiKey) {
  const qs = new URLSearchParams({ ...params, api_key: apiKey });
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BASE}/${endpoint}?${qs}`);

    if (res.status === 403) {                           // rate limited — back off
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      continue;
    }
    if (res.status === 404 || res.status === 451) return null;   // nothing / opted out
    if (res.status === 401) {
      throw new HunterError('Hunter rejected the API key.', { fatal: true });
    }
    if (res.status === 429) {
      throw new HunterError('Hunter account is out of search credits.', { fatal: true });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.errors?.[0]?.details || `HTTP ${res.status}`;
      throw new HunterError(`Hunter error: ${detail}`);
    }
    return (await res.json()).data;
  }
  throw new HunterError('Hunter stayed rate limited after 5 attempts.');
}

// Everyone Hunter considers a decision maker at this domain.
// Returns { people, charged } — `charged` says whether a credit was spent.
export async function decisionMakers(domain, { apiKey = config.hunter.apiKey } = {}) {
  const data = await call('domain-search', {
    domain,
    decision_maker: 'true',
    type: 'personal',          // personal addresses, not info@ / sales@
    limit: '10',
  }, apiKey);

  const emails = data?.emails || [];
  const people = emails
    .filter((e) => e.value)
    .map((e) => ({
      email: e.value,
      first_name: (e.first_name || '').trim(),
      last_name: (e.last_name || '').trim(),
      position: (e.position || '').trim(),
      confidence: e.confidence ?? null,
    }));
  // Hunter bills for a search that returns people; an empty one is free.
  return { people, charged: emails.length > 0 };
}
