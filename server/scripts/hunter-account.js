// What's left in the Hunter budget. One search credit is spent per domain that
// returns people, so this is the real ceiling on a run's size.
//
//   npm run hunter:account

import '../src/config.js';
import { account } from '../src/enrich/hunter.js';

try {
  const a = await account();
  const pct = a.available ? Math.round((100 * a.used) / a.available) : 0;
  console.log(`plan       ${a.plan}  (${a.email})`);
  console.log(`searches   ${a.used} of ${a.available} used (${pct}%)`);
  console.log(`remaining  ${a.remaining}   resets ${a.resetDate}`);
  if (a.remaining != null) {
    console.log(`\nAt roughly a 60% hit rate that is about ${Math.round(a.remaining / 0.6)} domains.`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
