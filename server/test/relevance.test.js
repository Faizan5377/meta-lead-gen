// The relevance gate, exercised with REAL ads observed in the Ad Library for a
// "plumbing" search — which returned a cholesterol supplement, a drain-hair
// gadget and a washing-machine tablet alongside actual plumbers.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRelevanceGate, stem, tokenize } from '../src/relevance.js';

const gate = (kw, extra = []) => createRelevanceGate({ keywords: kw, extraTerms: extra, minScore: 40 });

// Verbatim from the Ad Library.
const CURLYS = {
  page_name: "Curly's Plumbing Inc.",
  page_categories: ['Plumbing Service'],
  body_text: 'Locally owned & operated since 1997. Plumbing, residential, commercial & new construction',
  display_domain: null,
};
const ALL_SEASONS = {
  page_name: 'All Seasons Air Conditioning, Plumbing & Heating Inc',
  page_categories: ['Appliance Repair', 'Public Utility', 'Business'],
  body_text: '{{product.brand}}',
  display_domain: 'www.AllSeasonsComfort.com',
};
const CHOLESTEROL = {
  page_name: 'Cholesterol Wellness Hub',
  page_categories: ['Health & Wellness Website'],
  body_text: 'The first time I gave a man CPR, I was holding a 3/8 inch copper elbow joint in my left hand.',
  display_domain: 'alevia.com',
};
const EVERYTHING_ENVY = {
  page_name: 'Everything Envy',
  page_categories: ['Digital creator'],
  body_text: 'Hair in the drain? Not today. This little gadget catches all the stray strands before they turn into a clogged nightmare. Fits most shower drains.',
  display_domain: 'urlgeni.us',
};
const UPROOT = {
  page_name: 'Uproot Clean',
  page_categories: ['Product/service'],
  body_text: 'You can\'t see it, but your washer could be hiding dangerous bacteria, mold and buildup. Uproot Washing Machine Cleaner Tabs.',
  display_domain: 'order.uprootclean.com',
};

describe('stem / tokenize', () => {
  it('collapses word forms so plumber matches plumbing', () => {
    assert.equal(stem('plumbing'), stem('plumber'));
    assert.equal(stem('plumbing'), stem('plumbers'));
    assert.equal(stem('dentist'), stem('dentists'));
  });
  it('drops stopwords and generic trade words', () => {
    assert.deepEqual(tokenize('the best local plumbing service'), ['plumb']);
  });
});

describe('plumbing search', () => {
  it('keeps real plumbers', () => {
    const g = gate(['plumbing']);
    assert.equal(g.evaluate(CURLYS).decision, 'keep');
    assert.equal(g.evaluate(ALL_SEASONS).decision, 'keep');
  });

  it('drops the ads Meta wrongly returned', () => {
    const g = gate(['plumbing']);
    for (const [name, ad] of [['cholesterol', CHOLESTEROL], ['drain gadget', EVERYTHING_ENVY], ['washer tabs', UPROOT]]) {
      const r = g.evaluate(ad);
      assert.equal(r.decision, 'drop', `${name} should be dropped (scored ${r.score}: ${r.reason})`);
    }
  });

  it('scores a plumber far above an unrelated ad', () => {
    const g = gate(['plumbing']);
    assert.ok(g.score(CURLYS).score > g.score(CHOLESTEROL).score + 40);
  });
});

describe('learned niche categories', () => {
  // "home services" never appears in a plumber's copy, so text matching alone
  // would reject them. Ads that DO match teach the gate which categories belong
  // to the niche, and later ads ride on that.
  // The keyword here is "remodeling", which does NOT appear in the category
  // "Contractor" — so the only way these pass is the learned bridge.
  const remodelerA = {
    page_name: 'Apex Remodeling', page_categories: ['Contractor'],
    body_text: 'Kitchen and bath remodeling, remodeling done right, remodeling since 1998.',
  };
  const remodelerB = {
    page_name: 'Craft Remodeling Co', page_categories: ['Contractor'],
    body_text: 'Full home remodeling, remodeling experts, remodeling quotes free.',
  };
  const quiet = {
    page_name: 'Bayside Build', page_categories: ['Contractor'],
    body_text: 'Same-day estimates, upfront pricing, book online today.',
  };

  it('bridges a keyword to a category that never names it', () => {
    const g = gate(['remodeling']);
    assert.equal(g.evaluate(quiet).decision, 'drop', 'unlearned category must not pass yet');

    g.evaluate(remodelerA);
    g.evaluate(remodelerB);          // two confident ads establish "contractor"

    const after = g.evaluate(quiet);
    assert.equal(after.decision, 'keep');
    assert.match(after.reason, /niche-category:contractor/);
  });

  it('requires corroboration before a category can vouch alone', () => {
    const g = gate(['remodeling']);
    g.evaluate(remodelerA);          // only ONE sighting of "contractor"
    assert.equal(g.evaluate(quiet).decision, 'drop');
  });

  it('never self-reinforces from a category-only match', () => {
    const g = gate(['remodeling']);
    g.evaluate(remodelerA);
    g.evaluate(remodelerB);
    const before = JSON.stringify(g.profile());
    // Passes only via the learned "contractor" bridge — so "Nail Salon" riding
    // along on the same ad must NOT be learned as an in-niche category.
    g.evaluate({ page_name: 'C', page_categories: ['Contractor', 'Nail Salon'], body_text: 'unrelated' });
    assert.equal(JSON.stringify(g.profile()), before);
  });
});

describe('user-supplied niche context', () => {
  it('widens the niche with extra terms, as data not code', () => {
    const narrow = gate(['plumbing']);
    assert.equal(narrow.evaluate(UPROOT).decision, 'drop');

    const widened = gate(['plumbing'], ['washing machine', 'appliance']);
    assert.equal(widened.evaluate(UPROOT).decision, 'keep');
  });
});

describe('degenerate input', () => {
  it('keeps everything when there is no niche to check', () => {
    const g = gate([]);
    assert.equal(g.evaluate(CHOLESTEROL).decision, 'keep');
  });
  it('survives ads with missing fields', () => {
    const g = gate(['plumbing']);
    assert.equal(g.evaluate({}).decision, 'drop');
    assert.equal(g.evaluate({ page_categories: null, page_name: null }).decision, 'drop');
  });
});
