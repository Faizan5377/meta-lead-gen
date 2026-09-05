// Live Hunter.io diagnostic — verifies the key, shows the credit balance, and
// walks the exact gating chain the owner phase uses, printing what each step
// decides and whether it costs a credit.
//
//   npm run hunter:check                  # account + the free gate on samples
//   npm run hunter:check -- acme.com      # one domain, end to end
//   npm run hunter:check -- --spend acme.com   # allow the paid domain-search
//
// Without --spend it stops before any paid call, so it is safe to run freely.

import { db } from '../src/db.js';
import { hunter } from '../src/enrich/hunter.js';
import { pickOwnerEmail } from '../src/enrich/ownerResolver.js';

const args = process.argv.slice(2);
const spend = args.includes('--spend');
const domains = args.filter((a) => !a.startsWith('--'));

const pad = (s, n) => String(s).padEnd(n);

await db.init();

console.log('\n── Hunter account ──────────────────────────────────────────');
const state = await hunter.preflight();
if (!state.enabled) {
  console.error('Hunter is disabled or the key was rejected. Check HUNTER_API_KEY in server/.env');
  process.exit(1);
}
console.log(`plan            ${state.plan}`);
console.log(`credits left    ${state.creditsRemaining}`);
console.log(`resets          ${state.resetDate}`);
console.log(`per-run budget  ${state.budget}   reserve ${state.reserve}`);

const targets = domains.length ? domains : ['basecamp.com', 'stripe.com'];

for (const domain of targets) {
  console.log(`\n── ${domain} ───────────────────────────────────────────────`);

  // FREE gate.
  const count = await hunter.emailCount(domain);
  if (!count.ok) {
    console.log(`email-count     FAILED (${count.error})`);
    continue;
  }
  const total = Number(count.data?.total) || 0;
  const execs = (count.data?.seniority?.executive || 0) + (count.data?.department?.executive || 0);
  console.log(`email-count     ${total} emails, ${execs} executive signals   [free]`);

  if (total === 0 || execs === 0) {
    console.log('decision        SKIP — no executive here, a credit would be wasted');
    continue;
  }
  if (!spend) {
    console.log('decision        WOULD SPEND 1 credit (re-run with --spend to do it)');
    continue;
  }
  if (!hunter.canSpend()) {
    console.log('decision        BLOCKED by budget/reserve — would fall back to scraping');
    continue;
  }

  // PAID call.
  const res = await hunter.domainSearch(domain, { decisionMaker: true, limit: 10 });
  if (!res.ok) {
    console.log(`domain-search   FAILED (${res.error})`);
    continue;
  }
  const emails = res.data?.emails || [];
  console.log(`domain-search   ${emails.length} decision makers${res.cached ? ' [cached, free]' : ' [1 credit]'}`);
  for (const e of emails.slice(0, 6)) {
    console.log(`  ${pad(`${e.first_name || ''} ${e.last_name || ''}`.trim() || '(no name)', 24)} ${pad(e.position || '—', 26)} ${pad(e.seniority || '—', 10)} conf ${e.confidence}`);
  }
  const owner = pickOwnerEmail(emails);
  console.log(`resolved owner  ${owner ? `${owner.first_name} ${owner.last_name} — ${owner.position} <${owner.value}>` : 'none (no leadership role found)'}`);
}

console.log(`\ncredits spent this check: ${hunter.spentThisRun}\n`);
