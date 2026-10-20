// Choosing the one person to email.
//
// Every lead in the export carries exactly one address, chosen here, so a
// mistake in this file is a mistake in every outreach campaign that follows:
// the wrong seniority, or worse, an assistant's inbox.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickDecisionMaker, rank } from '../src/enrich/hierarchy.js';

const person = (position, extra = {}) => ({
  email: `${(extra.last_name || position).replace(/\W/g, '').toLowerCase()}@acme.com`,
  first_name: 'A', last_name: 'B', position, confidence: 80, ...extra,
});

describe('rank', () => {
  it('places the four seniorities in order', () => {
    assert.equal(rank('Owner').tier, 1);
    assert.equal(rank('Chief Executive Officer').tier, 2);
    assert.equal(rank('President').tier, 3);
    assert.equal(rank('Vice President of Operations').tier, 4);
  });

  it('does not promote a VP to President', () => {
    // "Vice President" contains "President" — the single easiest bug here.
    assert.equal(rank('Vice President').tier, 4);
    assert.equal(rank('VP').tier, 4);
    assert.equal(rank('SVP, Sales').tier, 4);
    assert.equal(rank('Deputy President').tier, 4);
  });

  it('reads the senior half of a combined title', () => {
    assert.equal(rank('President & CEO').tier, 2);
    assert.equal(rank('Owner / President').tier, 1);
    assert.equal(rank('Founder and CEO').tier, 1);
  });

  it('refuses anyone who only works near the decision maker', () => {
    for (const t of ['Executive Assistant to the CEO', 'Assistant to the Owner',
      'Office Coordinator', 'Receptionist', 'Secretary to the President']) {
      assert.equal(rank(t), null, t);
    }
  });

  it('refuses titles below the bar entirely', () => {
    for (const t of ['Office Manager', 'Service Technician', 'Marketing Manager',
      'Dispatcher', 'Sales Representative', '', null, undefined]) {
      assert.equal(rank(t), null, String(t));
    }
  });

  it('handles the shapes Hunter actually returns', () => {
    assert.equal(rank('co-owner').tier, 1);
    assert.equal(rank('CO-FOUNDER').tier, 1);
    assert.equal(rank('c.e.o.').tier, 2);
    assert.equal(rank('  Owner  ').tier, 1);
  });
});

describe('pickDecisionMaker', () => {
  it('returns exactly one person, the most senior', () => {
    const got = pickDecisionMaker([
      person('Vice President'), person('Owner'), person('CEO'), person('President'),
    ]);
    assert.equal(got.position, 'Owner');
    assert.equal(got.tier, 1);
  });

  it('falls down the ladder when the senior roles are absent', () => {
    assert.equal(pickDecisionMaker([person('Vice President'), person('President')]).position, 'President');
    assert.equal(pickDecisionMaker([person('Vice President')]).position, 'Vice President');
  });

  it('returns null when nobody qualifies — the lead gets dropped', () => {
    assert.equal(pickDecisionMaker([person('Office Manager'), person('Technician')]), null);
    assert.equal(pickDecisionMaker([]), null);
    assert.equal(pickDecisionMaker(), null);
  });

  it('ignores a person with no email, however senior', () => {
    const got = pickDecisionMaker([
      { ...person('Owner'), email: '' },
      person('CEO'),
    ]);
    assert.equal(got.tier, 2);
  });

  it('prefers the family the business is named after', () => {
    // Both are owners; "Bourque" is the name over the door.
    const got = pickDecisionMaker([
      person('Owner', { last_name: 'Smith', confidence: 95 }),
      person('Owner', { last_name: 'Bourque', confidence: 70 }),
    ], 'Bourque Heating & Cooling');
    assert.equal(got.last_name, 'Bourque');
  });

  it('otherwise breaks a tie on Hunter confidence', () => {
    const got = pickDecisionMaker([
      person('Owner', { last_name: 'Smith', confidence: 60 }),
      person('Owner', { last_name: 'Jones', confidence: 92 }),
    ], 'Acme Plumbing');
    assert.equal(got.confidence, 92);
  });

  it('never lets the family-name rule outrank seniority', () => {
    const got = pickDecisionMaker([
      person('Vice President', { last_name: 'Bourque' }),
      person('Owner', { last_name: 'Smith' }),
    ], 'Bourque Heating');
    assert.equal(got.tier, 1);
    assert.equal(got.last_name, 'Smith');
  });

  it('carries through everything the export needs', () => {
    const got = pickDecisionMaker([
      person('Founder', { first_name: 'Dan', last_name: 'Pike', confidence: 88 }),
    ], 'Pike Plumbing');
    assert.deepEqual(got, {
      email: 'pike@acme.com', first_name: 'Dan', last_name: 'Pike',
      position: 'Founder', confidence: 88, tier: 1, tier_label: 'Owner',
    });
  });
});
