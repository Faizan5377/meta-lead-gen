// Pick the ONE person at a business worth emailing.
//
// Hunter hands back every decision maker it knows about. Emailing all of them
// is how a domain gets burned, so this chooses a single contact by seniority:
//
//   Owner  →  CEO  →  President  →  Vice President
//
// and returns nothing at all when none of those exist. "Nothing" is a real
// answer here: a lead with no reachable decision maker is dropped rather than
// filled with an office manager's address.

const TITLE = (p) => String(p?.position ?? '').trim();

// Never the right person, whatever else their title says. Checked first so
// "Executive Assistant to the CEO" can't be read as a CEO.
const EXCLUDE = /\b(assistant|secretary|receptionist|intern|coordinator|apprentice)\b|\bto the\b/i;

// Ordered, most senior first. `not` guards a title that would otherwise match
// a more senior tier by accident.
export const TIERS = [
  {
    tier: 1,
    label: 'Owner',
    re: /\b(owner|co-?owner|proprietor|principal|founder|co-?founder|managing (partner|director|member))\b/i,
  },
  {
    tier: 2,
    label: 'CEO',
    re: /\b(ceo|c\.e\.o|chief executive(\s+officer)?)\b/i,
  },
  {
    // "Vice President" contains "President", so it must be excluded explicitly
    // or every VP would be promoted a tier.
    tier: 3,
    label: 'President',
    re: /\bpresident\b/i,
    not: /\b(vice|vp|deputy|assistant)\b/i,
  },
  {
    // "Deputy President" is excluded from tier 3 above, so it has to be caught
    // here or it falls through the ladder and the lead is dropped.
    tier: 4,
    label: 'Vice President',
    re: /\b(vice\s*president|deputy\s*president|vp|evp|svp)\b/i,
  },
];

// Which rung of the ladder a job title sits on, or null for "not senior enough".
export function rank(position) {
  const title = String(position ?? '').trim();
  if (!title || EXCLUDE.test(title)) return null;
  for (const t of TIERS) {
    if (t.re.test(title) && !(t.not && t.not.test(title))) {
      return { tier: t.tier, label: t.label };
    }
  }
  return null;
}

const words = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');

// In a small business the surname is usually in the name over the door —
// "Bourque" at "Bourque Heating & Cooling" is the owner, not a namesake.
function namedAfterTheBusiness(person, businessName) {
  const last = String(person?.last_name ?? '').toLowerCase().trim();
  if (last.length < 3) return false;
  return words(businessName).split(' ').includes(last);
}

// Returns { email, first_name, last_name, position, confidence, tier, tier_label }
// or null when nobody senior enough was found.
export function pickDecisionMaker(people = [], businessName = '') {
  const ranked = [];
  for (const p of people) {
    if (!p?.email) continue;
    const r = rank(TITLE(p));
    if (r) ranked.push({ ...p, ...r });
  }
  if (!ranked.length) return null;

  ranked.sort((a, b) =>
    a.tier - b.tier                                                   // seniority first
    || Number(namedAfterTheBusiness(b, businessName))
       - Number(namedAfterTheBusiness(a, businessName))               // then the family name
    || (b.confidence ?? 0) - (a.confidence ?? 0)                      // then Hunter's confidence
    || String(a.email).localeCompare(String(b.email)));               // stable for equal candidates

  const best = ranked[0];
  return {
    email: best.email,
    first_name: best.first_name || '',
    last_name: best.last_name || '',
    position: TITLE(best),
    confidence: best.confidence ?? null,
    tier: best.tier,
    tier_label: best.label,
  };
}
