// Unit tests for the pure enrichment logic — name/title extraction, ranking,
// Hunter result selection and domain matching. No network, no browser.
//
//   node --experimental-sqlite --test test/

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bestCandidate, businessTokens, CEILING_CORROBORATED, CEILING_SINGLE_SOURCE,
  cleanName, harvestCandidates, isPlausibleName, mentionsBusiness,
  normalizeTitle, ownerFromBusinessName, scoreToConfidence, titleRank,
} from '../src/enrich/personNames.js';
import { domainFromWebsite, pickDomain, pickOwnerEmail } from '../src/enrich/ownerResolver.js';

describe('titleRank', () => {
  it('ranks ownership above other executive roles', () => {
    assert.ok(titleRank('Owner') > titleRank('Founder'));
    assert.ok(titleRank('Founder') > titleRank('CEO'));
    assert.ok(titleRank('CEO') > titleRank('Managing Director'));
    assert.ok(titleRank('President') > titleRank('Director'));
    assert.equal(titleRank(''), 0);
  });
});

describe('cleanName', () => {
  it('strips a role or honorific from either end', () => {
    assert.equal(cleanName('CEO Hayley Sessa'), 'Hayley Sessa');
    assert.equal(cleanName('Hayley Sessa Founder'), 'Hayley Sessa');
    assert.equal(cleanName('Dr. Jane Doe'), 'Jane Doe');
    assert.equal(cleanName('Founder Jane Doe'), 'Jane Doe');
  });
  it('leaves a clean name alone', () => {
    assert.equal(cleanName('Jason Fried'), 'Jason Fried');
    assert.equal(cleanName("Sean O'Brien"), "Sean O'Brien");
  });
});

describe('isPlausibleName', () => {
  it('accepts real names', () => {
    for (const n of ['Jason Fried', "Sean O'Brien", 'Maria del Carmen Ruiz', 'Jean-Luc Picard']) {
      assert.ok(isPlausibleName(n), `expected ${n} to be plausible`);
    }
  });
  it('rejects contractions swept in from prose', () => {
    // Regression: "I'm Jason Fried, CEO of Basecamp" yielded "I'm Jason Fried".
    for (const n of ["I'm Jason Fried", "It's Dave Lee", "We're Tom Hall"]) {
      assert.ok(!isPlausibleName(n), `expected ${n} to be rejected`);
    }
  });
  it('does not fuse two people across a sentence boundary', () => {
    // Regression: "Ernest Kim. Zach Gordon" was matched as one person.
    assert.ok(!isPlausibleName('Ernest Kim. Zach Gordon'));
    const c = harvestCandidates('Ernest Kim. Zach Gordon - CEO', 'Tracxn');
    assert.equal(bestCandidate(c).name, 'Zach Gordon');
  });
  it('still allows initials and apostrophe surnames', () => {
    assert.ok(isPlausibleName('J. R. Hartley'));
    assert.ok(isPlausibleName("Sean O'Brien"));
    assert.ok(isPlausibleName("Marco D'Angelo"));
  });
  it('rejects organisations and UI chrome', () => {
    for (const n of ['Smile Dental', 'Acme Marketing Group', 'Read More', 'Our Team',
                     'Privacy Policy', 'United States', 'New York', 'Chief Executive',
                     'ACME CORP', 'Jane']) {
      assert.ok(!isPlausibleName(n), `expected ${n} to be rejected`);
    }
  });
  it("rejects the business's own name echoed back", () => {
    assert.ok(!isPlausibleName('Perry Homes', 'Perry Homes'));
    assert.ok(!isPlausibleName('Bright Smile', 'Bright Smile Dental'));
    // A real person at that business is still fine.
    assert.ok(isPlausibleName('Laura Perry', 'Perry Homes'));
  });
});

describe('harvestCandidates', () => {
  it('reads a LinkedIn-style result title', () => {
    const c = harvestCandidates('Jane Doe - Founder - Bright Smile Dental | LinkedIn', 'Bright Smile Dental');
    assert.ok(c.length > 0);
    assert.equal(c[0].name, 'Jane Doe');
    assert.equal(c[0].title, 'Founder');
  });
  it('reads a direct answer sentence', () => {
    const c = harvestCandidates('The owner of Bright Smile Dental is Jane Doe.', 'Bright Smile Dental');
    assert.equal(bestCandidate(c).name, 'Jane Doe');
  });
  it('reads "founded by"', () => {
    const c = harvestCandidates('The practice was founded by Michael Chen in 2011.', 'Bright Smile');
    assert.equal(bestCandidate(c).name, 'Michael Chen');
  });
  it('reads a "Title: Name" line', () => {
    const c = harvestCandidates('Owner: Sarah Williams', 'Acme');
    assert.equal(bestCandidate(c).name, 'Sarah Williams');
    assert.equal(bestCandidate(c).title, 'Owner');
  });
  it('does not invent a name from navigation text', () => {
    const c = harvestCandidates('Home About Us Our Team Contact Privacy Policy', 'Acme');
    assert.equal(bestCandidate(c), null);
  });
});

describe('association guard', () => {
  // Regression: a live run returned "Sara Willis (Owner)" for Basecamp at 95%
  // confidence, scraped from text that never mentioned Basecamp at all. A
  // confidently wrong owner is worse than no owner, so search-sourced
  // candidates must be named alongside the business.
  it('drops a person the text never links to the business', () => {
    const text = 'Sara Willis is the owner of a bakery in Leeds. Unrelated sidebar content.';
    assert.equal(harvestCandidates(text, 'Basecamp', 0, { requireAssociation: true }).length, 0);
  });

  it('keeps a person named alongside the business', () => {
    const text = 'Basecamp was founded by Jason Fried in 1999.';
    const c = harvestCandidates(text, 'Basecamp', 0, { requireAssociation: true });
    assert.equal(bestCandidate(c).name, 'Jason Fried');
  });

  it('still extracts without the guard, for the company\'s own website', () => {
    const text = 'Our founder is Jason Fried.';
    assert.ok(harvestCandidates(text, 'Basecamp', 0).length > 0);
    assert.equal(harvestCandidates(text, 'Basecamp', 0, { requireAssociation: true }).length, 0);
  });

  it('needs two distinctive words for a multi-word business name', () => {
    assert.ok(mentionsBusiness('welcome to bright smile dental', businessTokens('Bright Smile Dental')));
    // "smile" alone must not vouch for "Bright Smile Dental".
    assert.ok(!mentionsBusiness('a nice smile matters', businessTokens('Bright Smile Dental')));
  });

  it('ignores generic words when deciding what is distinctive', () => {
    assert.deepEqual(businessTokens('The Dental Studio Group'), []);
    assert.deepEqual(businessTokens('Basecamp'), ['basecamp']);
  });
});

describe('owner named in the business name', () => {
  it('reads a Dr. prefix page name', () => {
    // Live Ad Library advertiser that previously returned nothing.
    assert.equal(ownerFromBusinessName('Dr. Josh Parker Orthodontist').name, 'Josh Parker');
    assert.equal(ownerFromBusinessName('Dr. Josh Parker Orthodontist').title, 'Doctor');
  });
  it('reads a credential-suffixed page name', () => {
    assert.equal(ownerFromBusinessName('Joshua M. Millsaps, DDS, PA').name, 'Joshua M. Millsaps');
  });
  it('does not turn an ordinary business name into a person', () => {
    for (const n of ['Willo Cleans', 'Knight Pediatric Dentistry', 'Great Lakes Dental',
                     'Streamline Dental Implants', 'Seaside Dental']) {
      assert.equal(ownerFromBusinessName(n), null, `${n} should not yield a person`);
    }
  });
});

describe('junk tokens swept into names', () => {
  it('rejects odd internal capitals', () => {
    // Live regression: "Winters AKa" was returned as an owner.
    assert.ok(!isPlausibleName('Winters AKa'));
    assert.ok(!isPlausibleName('John SmileNow'));
  });
  it('still accepts genuine internal capitals', () => {
    for (const n of ['Ronald McDonald', 'Cathy MacLeod', "Sean O'Brien", "Marco D'Angelo"]) {
      assert.ok(isPlausibleName(n), `${n} should be accepted`);
    }
  });
  it('trims a layout word rather than discarding the whole name', () => {
    // Live regression: "Seth Senestraro Above" — the owner is real, only the
    // trailing layout word is junk, so trim it instead of losing the lead.
    assert.equal(cleanName('Seth Senestraro Above'), 'Seth Senestraro');
    assert.ok(isPlausibleName(cleanName('Seth Senestraro Above')));
    const c = harvestCandidates('Dr. Seth Senestraro Above', 'Senestraro Family Orthodontics');
    assert.equal(bestCandidate(c).name, 'Seth Senestraro');
  });
  it('never trims below two tokens', () => {
    assert.equal(cleanName('Read More'), 'Read More');   // stays invalid, not emptied
  });
  it('rejects positional words appended to a name', () => {
    // Live regression: "Seth Senestraro Above".
    assert.ok(!isPlausibleName('Seth Senestraro Above'));
    assert.ok(isPlausibleName('Seth Senestraro'));
  });
});

describe('directory-page contamination', () => {
  // These are VERBATIM snippets from a live Serper query for "Knight Pediatric
  // Dentistry". Directory pages list many businesses, so each names a real
  // person who runs a DIFFERENT practice. A character-window association let
  // all three through; sentence scoping must reject them.
  const BIZ = 'Knight Pediatric Dentistry';

  it('rejects a founder belonging to a neighbouring listing', () => {
    const s = "Everyone let's wish our founder Candace a very happy birthday! Not only does she work 2 jobs, but ... Knight Pediatric Dentistry. Follow.";
    assert.equal(harvestCandidates(s, BIZ, 0, { requireAssociation: true }).length, 0);
  });

  it('rejects a "founded by" from an adjacent business', () => {
    const s = 'Knight Pediatric Dentistry - Kids Dentist near me - Centuria, Wisconsin. Smiles Inc was founded by Dr. Freeman Rosenblum.';
    const names = harvestCandidates(s, BIZ, 0, { requireAssociation: true }).map((c) => c.name);
    assert.ok(!names.includes('Freeman Rosenblum'), `leaked: ${names}`);
  });

  it('rejects an unrelated CEO on a jobs listing', () => {
    const s = 'Knight Pediatric Dentistry. Registered Dental Assistant. Saint Paul, MN. $28.00. CEO Jennifer DeCubellis.';
    const names = harvestCandidates(s, BIZ, 0, { requireAssociation: true }).map((c) => c.name);
    assert.ok(!names.includes('Jennifer DeCubellis'), `leaked: ${names}`);
  });

  it('still accepts the real owner named in the same sentence', () => {
    const s = 'At Knight Pediatric Dentistry, the practice was founded by Robert Knight in 2009.';
    assert.equal(bestCandidate(harvestCandidates(s, BIZ, 0, { requireAssociation: true })).name, 'Robert Knight');
  });

  it('parses the surname-first directory format', () => {
    // Live Superpages result — this was the actual practice owner.
    const c = harvestCandidates('10. Knight, David James, DDS', BIZ);
    assert.equal(bestCandidate(c).name, 'David James Knight');
  });
});

describe('professional practices', () => {
  // Real Ad Library data: dental/medical/legal practices almost never print
  // "Owner" — they print "Dr. X", and the practice often carries their surname.
  it('reads a doctor as the practice owner', () => {
    const c = harvestCandidates('Meet Dr. Joshua Millsaps, serving Hickory since 2005.', 'Millsaps Dentistry');
    assert.equal(bestCandidate(c).name, 'Joshua Millsaps');
  });

  it('ranks the eponymous practitioner above an unrelated named role', () => {
    const text = 'Dr. Joshua Millsaps leads the team. Office manager: Karen Blake.';
    const best = bestCandidate(harvestCandidates(text, 'Millsaps Dentistry'));
    assert.equal(best.name, 'Joshua Millsaps');
  });

  it('does not fire the eponym bonus for an unrelated practice', () => {
    const withEponym = bestCandidate(harvestCandidates('Dr. Joshua Millsaps', 'Millsaps Dentistry'));
    const without = bestCandidate(harvestCandidates('Dr. Joshua Millsaps', 'Seaside Dental'));
    assert.ok(withEponym.score > without.score);
  });
});

describe('bestCandidate', () => {
  it('prefers the stronger role', () => {
    const best = bestCandidate([
      { name: 'Amy Stone', title: 'Director', weight: 6 },
      { name: 'Bob Reed', title: 'Owner', weight: 6 },
    ]);
    assert.equal(best.name, 'Bob Reed');
  });
  it('rewards corroboration across independent sources', () => {
    const best = bestCandidate([
      { name: 'Amy Stone', title: 'Founder', weight: 8, source: 'startpage' },
      { name: 'Amy Stone', title: 'Founder', weight: 8, source: 'brave' },
      { name: 'Bob Reed', title: 'Founder', weight: 12, source: 'ecosia' },
    ]);
    assert.equal(best.name, 'Amy Stone');
    assert.equal(best.sources.length, 2);
  });
});

describe('scoreToConfidence', () => {
  // Business names are not unique, so a search-text answer is an inference and
  // must never be reported as near-certain.
  it('caps a single-source answer well below certainty', () => {
    assert.ok(scoreToConfidence(999, { sources: 1 }) <= CEILING_SINGLE_SOURCE);
    assert.equal(scoreToConfidence(999, { sources: 1 }), CEILING_SINGLE_SOURCE);
  });
  it('allows corroborated answers higher, but still not certain', () => {
    assert.equal(scoreToConfidence(999, { sources: 3 }), CEILING_CORROBORATED);
    assert.ok(CEILING_CORROBORATED < 100);
  });
  it('scales with the score at the low end', () => {
    assert.ok(scoreToConfidence(10) < scoreToConfidence(25));
  });
});

describe('normalizeTitle', () => {
  it('canonicalises common variants', () => {
    assert.equal(normalizeTitle('co-founder'), 'Co-Founder');
    assert.equal(normalizeTitle('ceo'), 'CEO');
    assert.equal(normalizeTitle('Chief Executive Officer'), 'CEO');
    assert.equal(normalizeTitle('owner'), 'Owner');
  });
});

describe('domainFromWebsite', () => {
  it('extracts a bare hostname', () => {
    assert.equal(domainFromWebsite('https://www.acmedental.com/about'), 'acmedental.com');
  });
  it('ignores social and shortener hosts', () => {
    for (const u of ['https://facebook.com/acme', 'https://linktr.ee/acme',
                     'https://wa.me/123', 'https://bit.ly/xyz', 'https://www.instagram.com/acme']) {
      assert.equal(domainFromWebsite(u), null, `expected ${u} to be ignored`);
    }
  });
  it('survives junk input', () => {
    assert.equal(domainFromWebsite(''), null);
    assert.equal(domainFromWebsite('not a url'), null);
  });
});

describe('pickDomain', () => {
  const cands = [
    { domain: 'smiledentalstudio.nl', email_count: 1 },
    { domain: 'smiledentalstudio.com', email_count: 4 },
    { domain: 'someotherclinic.com', email_count: 90 },
  ];
  it('matches on the business name, not on popularity', () => {
    assert.equal(pickDomain(cands, 'Smile Dental Studio', 'US'), 'smiledentalstudio.com');
  });
  it('prefers the local TLD for a local business', () => {
    assert.equal(pickDomain(cands, 'Smile Dental Studio', 'NL'), 'smiledentalstudio.nl');
  });
  it('returns null rather than guessing when nothing matches', () => {
    assert.equal(pickDomain(cands, 'Completely Different Name', 'US'), null);
    assert.equal(pickDomain([], 'Smile Dental Studio', 'US'), null);
    assert.equal(pickDomain(null, 'Smile Dental Studio', 'US'), null);
  });
});

describe('pickOwnerEmail', () => {
  it('picks the founder over the CTO', () => {
    const owner = pickOwnerEmail([
      { first_name: 'David', last_name: 'H', position: 'CTO', seniority: 'executive', department: 'it', decision_maker: true, confidence: 85 },
      { first_name: 'Jason', last_name: 'Fried', position: 'Founder', seniority: 'executive', department: 'executive', decision_maker: true, confidence: 85 },
    ]);
    assert.equal(owner.first_name, 'Jason');
  });
  it('ignores generic mailboxes with no person attached', () => {
    assert.equal(pickOwnerEmail([{ value: 'info@acme.com', type: 'generic' }]), null);
    assert.equal(pickOwnerEmail([]), null);
    assert.equal(pickOwnerEmail(null), null);
  });
  it('returns null when nobody holds a leadership role', () => {
    assert.equal(pickOwnerEmail([
      { first_name: 'Sam', last_name: 'Lee', position: 'Support Agent', confidence: 90 },
    ]), null);
  });
});
