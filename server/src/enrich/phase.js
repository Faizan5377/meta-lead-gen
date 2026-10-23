// Turn leads into contactable leads, or drop them.
//
// One phase, shared by both scrapers, because a lead from the Ad Library and a
// lead from Maps are the same shape by the time they reach here (leadSchema.js).
//
// The rule the whole feature rests on: a lead with no decision maker is not a
// lead. It is dropped, not exported blank — a list where half the rows have no
// one to email is worse than a shorter list, because you only find out which
// is which after you have paid for it.
//
// Apollo slots in beside this later: `providers` is a chain, so phone lookup
// and email re-verification become extra steps over the same leads without the
// pipeline changing shape.

import { config } from '../config.js';
import { withDecisionMaker } from '../leadSchema.js';
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

// Run `work` over `items` with a fixed number of workers.
async function pool(items, size, work) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, size) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(workers);
}

/**
 * @param leads  leads in leadSchema shape, each with a `website`
 * @returns { kept, dropped, creditsUsed, stoppedEarly }
 */
export async function enrichLeads(leads, {
  apiKey = config.hunter.apiKey,
  maxCredits = config.hunter.defaultMaxCredits,
  concurrency = config.hunter.concurrency,
  known,       // { emails, domains } already collected in earlier runs
  lookup = decisionMakers,   // injectable so the dedup rules can be tested without Hunter
  shouldStop,
  onLead,      // (lead)            — enriched and kept
  onDrop,      // (lead, reason)    — removed from the run
  onProgress,  // ({ done, total, kept, creditsUsed })
  onError,
} = {}) {
  const budget = new CreditBudget(maxCredits);
  const kept = [];
  const dropped = [];
  let done = 0;
  let fatal = null;

  // Franchise networks put one company behind many Facebook pages — a live
  // export had ~20 "Service Experts" locations and a dozen "Aire Serv of …",
  // every one a separate advertiser pointing at a single domain. Each passes
  // business-level dedup, then Hunter returns the SAME person for all of them.
  // Claiming the domain before the search both removes those duplicates and
  // stops paying a credit per copy.
  const claimedDomains = new Set(known?.domains || []);
  const claimedEmails = new Set(known?.emails || []);

  const drop = (lead, reason) => {
    dropped.push({ lead, reason });
    onDrop?.(lead, reason);
  };

  await pool(leads, concurrency, async (lead) => {
    if (fatal || shouldStop?.()) return;

    const domain = cleanDomain(lead.website);
    // Checked before a credit is touched: ~19% of Ad Library leads point at
    // fb.me or api.whatsapp.com, and searching those buys nothing.
    if (!domain) {
      drop(lead, DROP.NO_WEBSITE);
      done++;
      return;
    }

    // One lead per company. Checked before the credit is reserved, so a
    // twenty-location franchise costs one search rather than twenty.
    if (claimedDomains.has(domain)) {
      drop(lead, DROP.DUPLICATE_DOMAIN);
      done++;
      return;
    }
    claimedDomains.add(domain);

    if (!budget.reserve()) {
      drop(lead, DROP.OUT_OF_CREDITS);
      done++;
      return;
    }

    let charged = false;
    try {
      const res = await lookup(domain, { apiKey });
      charged = res.charged;

      if (!res.people.length) {
        drop(lead, DROP.NO_PEOPLE);
      } else {
        const person = pickDecisionMaker(res.people, lead.business_name);
        if (!person) {
          drop(lead, DROP.NO_DECISION_MAKER);
        } else if (claimedEmails.has(String(person.email).toLowerCase())) {
          // Different domains can still reach one person (acquired brands).
          drop(lead, DROP.DUPLICATE_EMAIL);
        } else {
          claimedEmails.add(String(person.email).toLowerCase());
          // Patched in place: these objects are the live run's records, and
          // the export, the save and the UI all hold the same references.
          Object.assign(lead, withDecisionMaker({}, person));
          kept.push(lead);
          onLead?.(lead);
        }
      }
    } catch (err) {
      // An exhausted account or a bad key ends the phase; one bad domain does not.
      if (err instanceof HunterError && err.fatal) fatal = err;
      onError?.({ scope: 'hunter', business: lead.business_name, message: err.message });
      drop(lead, `${DROP.ERROR}: ${err.message}`);
    } finally {
      budget.release(charged);
      done++;
      onProgress?.({ done, total: leads.length, kept: kept.length, creditsUsed: budget.used });
    }
  });

  if (fatal) onError?.({ scope: 'hunter', message: fatal.message, fatal: true });

  return {
    kept,
    dropped,
    creditsUsed: budget.used,
    stoppedEarly: !!fatal || budget.exhausted,
    fatal: fatal?.message || null,
  };
}
