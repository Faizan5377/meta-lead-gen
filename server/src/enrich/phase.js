// Turn leads into contactable leads, or drop them.
//
// Shared by both scrapers, because a lead from the Ad Library and a lead from
// Maps are the same shape by the time they reach here (leadSchema.js).
//
// The rule the whole feature rests on: a lead with no decision maker is not a
// lead. It is dropped, not exported blank — a list where half the rows have no
// one to email is worse than a shorter list, because you only find out which
// is which after you have paid for it.
//
// Two ways to drive it, one body of rules:
//
//   enrichLeads()      a finite list, enriched and returned. Used by the Maps
//                      scraper, whose target counts places collected.
//   startEnrichment()  workers that keep consuming leads while the harvest is
//                      still running. The Ad Library needs this: its target
//                      counts FINISHED leads, so the harvest cannot know when
//                      to stop until enrichment says the number is reached.
//
// Apollo slots in beside this later: phone lookup and email re-verification
// become extra steps over the same leads without the pipeline changing shape.

import { config } from '../config.js';
import { withDecisionMaker } from '../leadSchema.js';
import { jitter } from '../scraper/humanize.js';
import { pickDecisionMaker } from './hierarchy.js';
import { CreditBudget, HunterError, cleanDomain, decisionMakers } from './hunter.js';

export const DROP = {
  DUPLICATE_DOMAIN: 'same company as a lead already in this list',
  DUPLICATE_EMAIL: 'same decision maker as a lead already in this list',
  NO_WEBSITE: 'no usable website',
  NO_PEOPLE: 'Hunter found nobody at this domain',
  NO_DECISION_MAKER: 'nobody senior enough (no owner, CEO, president or VP)',
  OUT_OF_CREDITS: 'credit limit reached before this lead was checked',
  ERROR: 'lookup failed',
};

// The rules, independent of how leads are fed in.
//
// Returns { ok, reason } per lead and mutates the lead in place on success —
// these objects are the live run's records, and the export, the save and the
// UI all hold the same references.
export function createEnricher({
  apiKey = config.hunter.apiKey,
  maxCredits = config.hunter.defaultMaxCredits,
  known,                      // { emails, domains } collected in earlier runs
  lookup = decisionMakers,    // injectable, so the rules are testable without Hunter
} = {}) {
  const budget = new CreditBudget(maxCredits);

  // Franchise networks put one company behind many Facebook pages — a live
  // export had ~20 "Service Experts" locations and a dozen "Aire Serv of …",
  // every one a separate advertiser pointing at a single domain. Each passes
  // business-level dedup, then Hunter returns the SAME person for all of them.
  // Claiming the domain before the search removes the duplicates AND stops
  // paying a credit per copy.
  const claimedDomains = new Set(known?.domains || []);
  const claimedEmails = new Set(known?.emails || []);
  let fatal = null;

  async function enrich(lead) {
    if (fatal) return { ok: false, reason: fatal.message, fatal: true };

    const domain = cleanDomain(lead.website);
    // Checked before a credit is touched: a fifth of Ad Library leads point at
    // fb.me, a marketplace or a directory, and searching those buys nothing.
    if (!domain) return { ok: false, reason: DROP.NO_WEBSITE };

    if (claimedDomains.has(domain)) return { ok: false, reason: DROP.DUPLICATE_DOMAIN };
    claimedDomains.add(domain);

    if (!budget.reserve()) return { ok: false, reason: DROP.OUT_OF_CREDITS };

    let charged = false;
    try {
      const res = await lookup(domain, { apiKey });
      charged = res.charged;

      if (!res.people.length) return { ok: false, reason: DROP.NO_PEOPLE };

      const person = pickDecisionMaker(res.people, lead.business_name);
      if (!person) return { ok: false, reason: DROP.NO_DECISION_MAKER };

      const email = String(person.email).toLowerCase();
      // Different domains can still reach one person (acquired brands).
      if (claimedEmails.has(email)) return { ok: false, reason: DROP.DUPLICATE_EMAIL };
      claimedEmails.add(email);

      Object.assign(lead, withDecisionMaker({}, person));
      return { ok: true };
    } catch (err) {
      // An exhausted account or a bad key ends everything; one bad domain does not.
      if (err instanceof HunterError && err.fatal) fatal = err;
      return { ok: false, reason: `${DROP.ERROR}: ${err.message}`, fatal: !!fatal };
    } finally {
      budget.release(charged);
    }
  }

  return {
    enrich,
    budget,
    get creditsUsed() { return budget.used; },
    get exhausted() { return budget.exhausted; },
    get fatal() { return fatal; },
  };
}

// ── Batch: a finite list ────────────────────────────────────────────────────

async function pool(items, size, work) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.max(1, size) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await work(item);
    }
  }));
}

export async function enrichLeads(leads, {
  concurrency = config.hunter.concurrency,
  shouldStop, onLead, onDrop, onProgress, onError, ...rules
} = {}) {
  const enricher = createEnricher(rules);
  const kept = [];
  const dropped = [];
  let done = 0;

  await pool(leads, concurrency, async (lead) => {
    if (enricher.fatal || shouldStop?.()) return;
    const res = await enricher.enrich(lead);
    if (res.ok) {
      kept.push(lead);
      onLead?.(lead);
    } else {
      dropped.push({ lead, reason: res.reason });
      onDrop?.(lead, res.reason);
      if (res.fatal) onError?.({ scope: 'hunter', business: lead.business_name, message: res.reason });
    }
    done++;
    onProgress?.({ done, total: leads.length, kept: kept.length, creditsUsed: enricher.creditsUsed });
  });

  if (enricher.fatal) onError?.({ scope: 'hunter', message: enricher.fatal.message, fatal: true });

  return {
    kept,
    dropped,
    creditsUsed: enricher.creditsUsed,
    stoppedEarly: !!enricher.fatal || enricher.exhausted,
    fatal: enricher.fatal?.message || null,
  };
}

// ── Streaming: alongside a running harvest ──────────────────────────────────
//
// `nextLead` hands back the next lead ready for enrichment, or null when there
// is nothing queued yet. An empty queue means "wait" until the caller says the
// harvest has finished producing.
//
// `capacity` is how many more finished leads the run still wants. Workers hold
// back when the leads already in flight could fill it, because a credit spent
// past the target buys a lead that has to be thrown away.

export function startEnrichment({
  nextLead, capacity, onKept, onDropped, onProgress, onError,
  concurrency = config.hunter.concurrency,
  cancelled,                    // () => true when the user stopped the run
  ...rules
}) {
  const enricher = createEnricher(rules);
  let harvestDone = false;
  let stopped = false;
  let inFlight = 0;

  const wanted = () => (capacity ? capacity() : Infinity);

  async function worker() {
    while (!stopped && !cancelled?.() && !enricher.fatal) {
      // The credit cap ends the whole run, not just this lead: with no credits
      // left, no further candidate can ever be finished.
      if (enricher.exhausted) break;

      const want = wanted();
      if (want <= 0) break;                      // the run has what it asked for
      if (inFlight >= want) {
        // The leads already in flight could fill the last slots. Starting
        // another would spend a credit on a lead the run has to throw away, so
        // this worker stands down and lets them finish — and they do keep
        // going: a worker that finishes re-enters this loop with inFlight back
        // below `want`, so the tail of the run never stalls.
        if (harvestDone) break;
        await jitter(300, 600);
        continue;
      }

      const lead = nextLead();
      if (!lead) {
        if (harvestDone && inFlight === 0) break;
        await jitter(400, 800);
        continue;
      }

      inFlight++;
      try {
        const res = await enricher.enrich(lead);
        if (res.ok) onKept?.(lead);
        else onDropped?.(lead, res.reason);
        onProgress?.({ creditsUsed: enricher.creditsUsed });
      } finally {
        inFlight--;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () =>
    worker().catch((err) => onError?.({ scope: 'hunter', message: err.message })));

  return {
    promise: Promise.all(workers),
    harvestFinished() { harvestDone = true; },
    stop() { stopped = true; },
    get creditsUsed() { return enricher.creditsUsed; },
    get exhausted() { return enricher.exhausted; },
    get fatal() { return enricher.fatal?.message || null; },
  };
}
