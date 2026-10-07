// The verification gate.
//
// These tests encode the two decisions that cost real money if they go wrong:
// which businesses count as "open 24 hours", and when an Ad Library advertiser
// may be joined to a Google Maps listing. A wrong join attaches someone else's
// rating and hours to your lead, which is worse than no data at all.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_VERIFY, WEEKDAYS, isAllDay, judgeHours, judgeVerified,
  matchPlace, matchesNiche, normalizeDomain, normalizeName, normalizeVerifyFilters,
} from '../src/verify/gate.js';

const week = (spans) => Object.fromEntries(
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map((d, i) => [d, spans[i]]),
);
const ALWAYS = 'Open 24 hours';
const OFFICE = '8 AM–5 PM';

describe('isAllDay', () => {
  it('matches Google’s own wording, not the length of the span', () => {
    assert.equal(isAllDay('Open 24 hours'), true);
    assert.equal(isAllDay('open 24 hours'), true);
    assert.equal(isAllDay('12 AM–11:59 PM'), false);   // looks round-the-clock, isn't
    assert.equal(isAllDay('8 AM–5 PM'), false);
    assert.equal(isAllDay('Closed'), false);
    assert.equal(isAllDay(null), false);
  });
});

describe('judgeHours', () => {
  it('does nothing unless 24 hours was asked for', () => {
    assert.equal(judgeHours(null, DEFAULT_VERIFY).keep, true);
    assert.equal(judgeHours(week(Array(7).fill(OFFICE)), DEFAULT_VERIFY).keep, true);
  });

  it('keeps a business open round the clock Monday to Friday', () => {
    const hours = week([ALWAYS, ALWAYS, ALWAYS, ALWAYS, ALWAYS, 'Closed', 'Closed']);
    assert.equal(judgeHours(hours, { require24h: true, days: WEEKDAYS }).keep, true);
  });

  it('drops a business that is only 24 hours at the weekend', () => {
    const hours = week([OFFICE, OFFICE, OFFICE, OFFICE, OFFICE, ALWAYS, ALWAYS]);
    const v = judgeHours(hours, { require24h: true, days: WEEKDAYS });
    assert.equal(v.keep, false);
    assert.match(v.reason, /Monday is 8 AM–5 PM, not 24 hours/);
  });

  it('drops a business that closes on one weekday', () => {
    const hours = week([ALWAYS, ALWAYS, OFFICE, ALWAYS, ALWAYS, ALWAYS, ALWAYS]);
    assert.match(judgeHours(hours, { require24h: true }).reason, /Wednesday/);
  });

  it('refuses to vouch for days Google never reported', () => {
    // Today-only hours from the results rail must never pass as a full week.
    const v = judgeHours({ Wednesday: ALWAYS }, { require24h: true });
    assert.equal(v.keep, false);
    assert.match(v.reason, /hours missing for Monday, Tuesday, Thursday, Friday/);
  });

  it('says so when there are no hours at all', () => {
    assert.match(judgeHours(null, { require24h: true }).reason, /no hours listed/);
    assert.match(judgeHours({}, { require24h: true }).reason, /no hours listed/);
  });
});

describe('matchPlace', () => {
  const place = {
    name: 'Bourque Heating & Cooling',
    website_domain: 'www.bourqueheatingandcooling.com',
  };

  it('trusts a shared domain above everything else', () => {
    const m = matchPlace({ name: 'Totally Different Ltd', domain: 'bourqueheatingandcooling.com' }, place);
    assert.deepEqual([m.ok, m.how], [true, 'domain']);
  });

  it('matches on the name once the legal noise is stripped', () => {
    const m = matchPlace({ name: 'Bourque Heating and Cooling, LLC', domain: '' }, place);
    assert.equal(m.ok, true);
    assert.equal(m.how, 'exact name');
  });

  it('refuses a join on one shared trade word', () => {
    // "Air", "Comfort" and "Services" are in half the trade — a shared one is
    // a coincidence, and a wrong join is worse than no data.
    const m = matchPlace({ name: 'Elite Comfort Air Services', domain: '' },
      { name: 'Precision Comfort Systems', website_domain: 'precision.com' });
    assert.equal(m.ok, false);
    assert.equal(m.how, 'no match');
  });

  it('is not fooled by an advertiser with no website', () => {
    // fb.me destinations are common in the Ad Library and carry no signal.
    const m = matchPlace({ name: 'Bourque Heating & Cooling', domain: 'fb.me' }, place);
    assert.equal(m.how, 'exact name');       // fell through to the name, as it should
  });

  it('normalizes domains and names consistently', () => {
    assert.equal(normalizeDomain('https://WWW.Acme.com/careers?x=1'), 'acme.com');
    assert.equal(normalizeDomain('not-a-domain'), '');
    assert.equal(normalizeName('Acme Heating & Cooling, Inc.'), 'acme heating cooling');
  });
});

describe('matchesNiche', () => {
  const niche = ['hvac contractor', 'heating contractor', 'air conditioning contractor'];

  it('keeps the trade', () => {
    assert.equal(matchesNiche({ category: 'HVAC contractor', categories: ['HVAC contractor'] }, niche), true);
  });

  it('drops the businesses that sell to, and train, the trade', () => {
    // Every one of these scored 56-85 on keyword relevance in a live run.
    for (const category of ['Technical school', 'Motor supplier', 'Marketing agency',
      'Corporate office', 'Carpet cleaning service', 'Industrial equipment supplier']) {
      assert.equal(matchesNiche({ category, categories: [category] }, niche), false, category);
    }
  });

  it('allows everything when no niche was worked out', () => {
    assert.equal(matchesNiche({ category: 'Technical school' }, []), true);
  });

  it('drops a listing with no category when a niche is set', () => {
    assert.equal(matchesNiche({ category: null, categories: [] }, niche), false);
  });
});

describe('judgeVerified', () => {
  const ad = { name: 'Bourque Heating & Cooling', domain: 'bourqueheatingandcooling.com' };
  const place = {
    name: 'Bourque Heating & Cooling', website_domain: 'bourqueheatingandcooling.com',
    category: 'HVAC contractor', categories: ['HVAC contractor'],
    rating: 4.7, review_count: 92, hours: week(Array(7).fill(ALWAYS)),
  };
  const rules = normalizeVerifyFilters({ require24h: true, niche: 'hvac contractor', minReviews: 50 });
  const verdict = (p) => judgeVerified(ad, p, matchPlace(ad, p || {}), rules);

  it('keeps a lead that clears every gate', () => {
    assert.equal(verdict(place).keep, true);
  });

  it('rejects, with a reason, at the first gate that fails', () => {
    assert.match(verdict(null).reason, /not found on Google Maps/);
    assert.match(verdict({ ...place, category: 'Technical school', categories: ['Technical school'] }).reason,
      /not in the niche/);
    assert.match(verdict({ ...place, hours: week(Array(7).fill(OFFICE)) }).reason, /not 24 hours/);
    assert.match(verdict({ ...place, review_count: 3 }).reason, /3 reviews < 50/);
  });

  it('will not accept a listing it cannot tie to the advertiser', () => {
    const other = { ...place, name: 'Someone Else Plumbing', website_domain: 'elsewhere.com' };
    assert.match(judgeVerified(ad, other, matchPlace(ad, other), rules).reason, /no confident/);
  });
});

describe('normalizeVerifyFilters', () => {
  it('defaults to weekdays and keeps a chosen subset in week order', () => {
    assert.deepEqual(normalizeVerifyFilters({}).hoursDays, WEEKDAYS);
    assert.deepEqual(
      normalizeVerifyFilters({ hoursDays: ['Sunday', 'Monday'] }).hoursDays,
      ['Monday', 'Sunday'],
    );
  });

  it('clamps the numbers and lowercases the niche', () => {
    const v = normalizeVerifyFilters({ minRating: 9, minReviews: -5, niche: 'HVAC Contractor, Plumber' });
    assert.equal(v.minRating, 5);
    assert.equal(v.minReviews, 0);
    assert.deepEqual(v.niche, ['hvac contractor', 'plumber']);
  });
});

// Regression: a lead kept under a Mon-Fri rule was being labelled "not 24
// hours" because the flag was judged on all seven days. The list contradicted
// its own filter.
describe('the 24h flag agrees with the rule that admitted the lead', () => {
  const weekdayOnly = {
    Monday: ALWAYS, Tuesday: ALWAYS, Wednesday: ALWAYS, Thursday: ALWAYS,
    Friday: ALWAYS, Saturday: 'Closed', Sunday: 'Closed',
  };

  it('is kept by the weekday rule', () => {
    assert.equal(judgeHours(weekdayOnly, { require24h: true, days: WEEKDAYS }).keep, true);
  });

  it('and every required day really is round-the-clock', () => {
    // What the flag must agree with: all the days the rule asked about.
    assert.ok(WEEKDAYS.every((d) => isAllDay(weekdayOnly[d])));
    // …while the naive all-seven-days reading says no, which was the bug.
    assert.ok(!Object.values(weekdayOnly).every(isAllDay));
  });
});
