// Verify harvested advertisers against Google Maps, while the harvest runs.
//
// This is deliberately NOT a phase that waits for the harvest to finish. The
// run promises "200 means 200 verified leads", and a verification that can
// reject has to be able to tell the harvest to keep digging — so the two run
// side by side: the harvest pushes candidates, these workers confirm or drop
// them, and `counts.kept` (confirmed only) is what the harvest's stop condition
// reads. A run that keeps 200 may well check 2,000.

import { config } from '../config.js';
import { lookupPlace } from '../maps/place.js';
import { jitter } from '../scraper/humanize.js';
import { newPage } from '../scraper/engine.js';
import { store } from '../store.js';
import { ALL_DAYS, isAllDay, judgeVerified, matchPlace } from './gate.js';

// What the lead gains from Google. Prefixed so it can never collide with the
// Ad Library's own fields — the rating here is the Maps rating, not Meta's.
function attach(business, place, match, rules) {
  business.maps_name = place.name || null;
  business.maps_category = place.category || null;
  business.maps_rating = place.rating ?? null;
  business.maps_reviews = place.review_count ?? null;
  business.maps_hours = formatHours(place.hours);
  business.maps_open_24h = place.hours ? is24(place.hours, rules) : null;
  business.maps_address = place.address || null;
  business.maps_phone = place.phone || null;
  business.maps_website = place.website || null;
  business.maps_url = place.maps_url || null;
  business.maps_cid_url = place.cid_url || null;
  business.maps_match = match?.how || null;
  business.maps_match_confidence = match?.confidence ?? null;
}

// One readable line, because this ends up in a CSV a human reads: a nested
// object would export as "[object Object]".
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function formatHours(hours) {
  if (!hours || !Object.keys(hours).length) return null;
  return DAY_ORDER.filter((d) => d in hours)
    .map((d) => `${d.slice(0, 3)} ${hours[d]}`)
    .join(' · ');
}

// Judged on the SAME days the run required, or the flag contradicts the gate:
// a firm kept under a Mon-Fri rule but closed on Sunday would be filed as "not
// 24 hours" in the very list its 24-hour rule admitted it to.
function is24(hours, rules) {
  const days = (rules?.require24h ? rules.hoursDays : ALL_DAYS).filter((d) => d in hours);
  return days.length > 0 && days.every((d) => isAllDay(hours[d]));
}

const regionOf = (filters) => {
  const c = (filters.countries || []).find((x) => x && x !== 'ALL') || 'US';
  return String(c).toLowerCase();
};

async function verifyOne(page, run, business, { rules, region, emit }) {
  const ad = {
    name: business.page_name,
    domain: business.display_domain || business.link_url || '',
  };

  let place = null;
  try {
    place = await lookupPlace(page, { query: ad.name, language: 'en', region });
  } catch (err) {
    run.errors.push({ scope: 'verify', business: ad.name, message: err.message, ts: new Date().toISOString() });
  }

  const match = place ? matchPlace(ad, place) : null;
  const verdict = judgeVerified(ad, place, match, rules);
  run.counts.verifiedDone++;

  // Re-check the target here, not just at admission: several workers can be
  // mid-flight when the last slot is filled, and the run must never return 201.
  if (verdict.keep && store.recount(run) < run.target) {
    attach(business, place, match, rules);
    business.verify_status = 'kept';
    business.verify_reason = null;
    store.recount(run);
    emit({ type: 'business_verified', business, counts: run.counts });
    return true;
  }

  const reason = verdict.keep ? 'target already met' : verdict.reason;
  store.dropCandidate(run, business, reason);
  emit({
    type: 'business_unverified',
    page_name: ad.name, reason, counts: run.counts,
  });
  return false;
}

// Start the workers. The caller tells us when the harvest has stopped producing
// candidates; until then an empty queue means "wait", not "finished".
export function startVerification(run, { emit }) {
  const rules = run.filters.verify;
  const region = regionOf(run.filters);
  let harvestDone = false;
  let stopped = false;

  const nextPending = () => run.businesses.find((b) => b.verify_status === 'pending');
  const outOfChecks = () => run.counts.verifiedDone >= config.verify.maxChecks;

  async function worker() {
    const page = await newPage();
    try {
      while (!stopped && !run.cancelRequested && !outOfChecks()) {
        if (store.recount(run) >= run.target) break;
        const business = nextPending();
        if (!business) {
          if (harvestDone) break;
          await jitter(400, 800);          // harvest still running — wait for work
          continue;
        }
        business.verify_status = 'checking';
        await verifyOne(page, run, business, { rules, region, emit });
      }
    } finally {
      try { await page.close(); } catch { /* the run matters more than the page */ }
    }
  }

  const workers = Array.from({ length: Math.max(1, config.verify.concurrency) }, () =>
    worker().catch((err) => {
      run.errors.push({ scope: 'verify', message: err.message, ts: new Date().toISOString() });
    }));

  return {
    promise: Promise.all(workers),
    harvestFinished() { harvestDone = true; },
    stop() { stopped = true; },
    ranOutOfChecks: outOfChecks,
  };
}
