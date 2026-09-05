// Owner resolution for one business, cheapest and most reliable source first.
//
//   1. Hunter.io   — authoritative, but credit-metered, so it is reached through
//                    two FREE calls that decide whether a credit is worth it.
//   2. Search      — Google's index (via Startpage) + Bing's + Brave, with
//                    LinkedIn profile titles parsed structurally.
//   3. Own website — the About/Team page, discovered from the site's real nav.
//
// The chain stops at the first CONFIDENT answer; a weak answer is kept but the
// next source still runs to try to beat it. Nothing here throws — every business
// comes back with a status.

import { config } from '../config.js';
import { hunter } from './hunter.js';
import { titleRank } from './personNames.js';
import { searchOwner } from './searchOwner.js';
import { ownerFromWebsite } from './websiteOwner.js';

const LOOKUP_BUDGET_MS = 40000;   // wall clock per business, all sources
// Stop the chain at or above this. Set ABOVE the single-source search ceiling
// (65) on purpose, so a search-only answer still goes on to check the company's
// own website and either corroborates or gets beaten.
const CONFIDENT = 70;

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Host without the public suffix: "smiledentalstudio.co.za" -> "smiledentalstudio"
function hostSlug(domain) {
  const host = String(domain || '').replace(/^www\./, '');
  const parts = host.split('.');
  if (parts.length <= 1) return slugify(host);
  // Drop a two-part suffix (.co.za, .com.au) or a single one (.com).
  const drop = parts.length > 2 && parts[parts.length - 2].length <= 3 ? 2 : 1;
  return slugify(parts.slice(0, Math.max(1, parts.length - drop)).join(''));
}

export function domainFromWebsite(website) {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
    // Skip aggregators/social hosts — they are never the business's own domain.
    if (/(facebook|instagram|linktr\.ee|linktree|wa\.me|whatsapp|youtube|tiktok|twitter|x\.com|google\.|goo\.gl|bit\.ly|linkedin)\./.test(host + '.')) return null;
    if (!host.includes('.')) return null;
    return host;
  } catch {
    return null;
  }
}

// Pick a domain for a business name from Hunter's free domain-finder.
// Deliberately strict: a wrong domain produces a wrong owner, which is worse
// than no owner at all. We require the domain slug to match the business slug.
export function pickDomain(candidates, businessName, countryCode) {
  const want = slugify(businessName);
  if (!want || want.length < 4 || !Array.isArray(candidates)) return null;

  const matches = candidates.filter((c) => {
    const slug = hostSlug(c.domain);
    return slug === want || (slug.length >= 6 && want.startsWith(slug)) || (want.length >= 6 && slug.startsWith(want));
  });
  if (!matches.length) return null;

  const cc = String(countryCode || '').toLowerCase();
  const score = (c) => {
    const d = String(c.domain).toLowerCase();
    // Cap the email-count contribution: it is weak evidence of *identity*, and
    // a busy .com must not outrank the country domain of a local business.
    let s = Math.min(10, Number(c.email_count) || 0);
    if (hostSlug(d) === want) s += 10;
    if (cc && d.endsWith(`.${cc}`)) s += 14;         // local business, local TLD
    if (/\.(com|net|org)$/.test(d)) s += 6;
    return s;
  };
  const best = matches.slice().sort((a, b) => score(b) - score(a))[0];
  return best?.domain || null;
}

// Rank Hunter's email objects and return the most owner-like person.
export function pickOwnerEmail(emails) {
  if (!Array.isArray(emails) || !emails.length) return null;

  const people = emails.filter((e) => e && e.first_name && e.last_name);
  if (!people.length) return null;

  const score = (e) => {
    let s = titleRank(e.position || e.position_raw || '') * 10;
    if (e.decision_maker) s += 15;
    if (e.seniority === 'executive') s += 12;
    if (e.department === 'executive') s += 8;
    if (e.type === 'personal') s += 4;
    s += Math.round((Number(e.confidence) || 0) / 10);
    return s;
  };

  const ranked = people.slice().sort((a, b) => score(b) - score(a));
  const top = ranked[0];
  // A person with no recognisable role isn't evidence of ownership.
  if (titleRank(top.position || top.position_raw || '') <= 1 && !top.decision_maker) return null;
  return top;
}

// Confidence for a Hunter answer: its own email confidence, lifted by how
// strongly the job title implies ownership.
function hunterConfidence(email) {
  const base = Number(email.confidence) || 50;
  const bonus = titleRank(email.position || email.position_raw || '') * 3;
  return Math.max(20, Math.min(99, Math.round(base * 0.7 + bonus)));
}

// ── Step 1: Hunter.io ───────────────────────────────────────────────────────
async function fromHunter(biz, countryCode, log) {
  if (!hunter.enabled) return { result: null, domain: null };

  // a) A domain from the Facebook page costs nothing.
  let domain = domainFromWebsite(biz.contact_website);
  let domainSource = domain ? 'facebook' : null;

  // b) Otherwise ask Hunter's FREE domain-finder.
  if (!domain && biz.page_name) {
    const found = await hunter.domainFinder(biz.page_name);
    if (found.ok) {
      domain = pickDomain(found.data, biz.page_name, countryCode);
      if (domain) domainSource = 'hunter:domain-finder';
    }
  }
  if (!domain) return { result: null, domain: null };

  // c) FREE gate — does Hunter know any executive here? If not, a credit is
  //    guaranteed to be wasted, so we never spend one.
  const count = await hunter.emailCount(domain);
  if (count.ok && count.data) {
    const execs = (count.data.seniority?.executive || 0) + (count.data.department?.executive || 0);
    const total = Number(count.data.total) || 0;
    if (total === 0) {
      log?.(`hunter: ${domain} has no emails — skipping paid lookup`);
      return { result: null, domain, domainSource };
    }
    if (execs === 0) {
      log?.(`hunter: ${domain} has ${total} emails but no executives — skipping paid lookup`);
      return { result: null, domain, domainSource };
    }
  }

  if (!hunter.canSpend()) {
    const why = !hunter.enabled
      ? `unavailable (${hunter.disabledReason || 'no key'})`
      : hunter.quotaExhausted ? 'credits exhausted' : 'run budget reached';
    log?.(`hunter: ${why} — using scrape fallback`);
    return { result: null, domain, domainSource, budgetBlocked: true };
  }

  // d) The one paid call: decision makers for this domain.
  const res = await hunter.domainSearch(domain, { decisionMaker: true, limit: 10 });
  if (!res.ok || !res.data) return { result: null, domain, domainSource };

  const emails = res.data.emails || [];
  const owner = pickOwnerEmail(emails);
  const backfill = {
    // Any personal email is better than nothing if Facebook gave us none.
    email: emails.find((e) => e.type === 'personal')?.value || emails[0]?.value || null,
    phone: emails.find((e) => e.phone_number)?.phone_number || null,
    organization: res.data.organization || null,
  };

  if (!owner) return { result: null, domain, domainSource, backfill };

  return {
    domain,
    domainSource,
    backfill,
    result: {
      name: `${owner.first_name} ${owner.last_name}`.replace(/\s+/g, ' ').trim(),
      title: owner.position || owner.position_raw || null,
      email: owner.value || null,
      linkedin: owner.linkedin ? `https://www.linkedin.com/in/${String(owner.linkedin).replace(/^.*linkedin\.com\/in\//, '').replace(/\/$/, '')}` : null,
      phone: owner.phone_number || null,
      confidence: hunterConfidence(owner),
      source: 'hunter',
    },
  };
}

// ── The chain ───────────────────────────────────────────────────────────────
// `page` is a Playwright page owned by the caller's worker pool.
export async function resolveOwner(page, biz, { countryCode, countryName, log } = {}) {
  const businessName = (biz.page_name || '').trim();
  if (!businessName) return { owner_status: 'skipped' };

  const deadline = Date.now() + LOOKUP_BUDGET_MS;
  let best = null;
  let domain = null;
  let domainSource = null;
  let backfill = null;
  let searchBlocked = false;

  try {
    // 1. Hunter.io
    try {
      const h = await fromHunter(biz, countryCode, log);
      domain = h.domain;
      domainSource = h.domainSource;
      backfill = h.backfill;
      if (h.result) best = h.result;
    } catch (err) {
      log?.(`hunter failed: ${err.message}`);
    }

    // 2. Search engines
    if ((!best || best.confidence < CONFIDENT) && config.ownerSearchEnabled && Date.now() < deadline) {
      try {
        const s = await searchOwner(page, {
          businessName,
          location: countryName || '',
          deadline: Math.min(deadline, Date.now() + 25000),
        });
        if (s?.blocked) searchBlocked = true;
        if (s?.name && (!best || (s.confidence || 0) > (best.confidence || 0))) {
          best = { name: s.name, title: s.title, confidence: s.confidence, source: s.source, email: null, linkedin: null, phone: null };
        }
      } catch (err) {
        log?.(`search failed: ${err.message}`);
      }
    }

    // 3. The company's own website
    const site = biz.contact_website || (domain ? `https://${domain}` : null);
    if ((!best || best.confidence < CONFIDENT) && site && Date.now() < deadline) {
      try {
        const w = await ownerFromWebsite(page, site, businessName, deadline);
        if (w?.name && (!best || (w.confidence || 0) > (best.confidence || 0))) {
          best = { name: w.name, title: w.title, confidence: w.confidence, source: w.source, email: null, linkedin: null, phone: null };
        }
      } catch (err) {
        log?.(`website failed: ${err.message}`);
      }
    }
  } catch (err) {
    return { owner_status: 'failed', owner_error: err.message };
  }

  const patch = {
    company_domain: domain || null,
    company_domain_source: domainSource || null,
  };

  // Backfill contact details Hunter found that Facebook didn't have.
  if (backfill?.email && !biz.contact_email) {
    patch.contact_email = backfill.email;
    patch.email_source = 'hunter';
  }
  if (backfill?.phone && !biz.contact_phone) patch.contact_phone = backfill.phone;
  if (domain && !biz.contact_website) patch.contact_website = `https://${domain}`;

  if (!best?.name) {
    patch.owner_status = searchBlocked && !domain ? 'blocked' : 'not_found';
    return patch;
  }

  return {
    ...patch,
    owner_name: best.name,
    owner_title: best.title || null,
    owner_email: best.email || null,
    owner_linkedin: best.linkedin || null,
    owner_phone: best.phone || null,
    owner_confidence: best.confidence ?? null,
    owner_source: best.source,
    owner_status: 'enriched',
  };
}
