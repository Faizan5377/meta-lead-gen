// Hunter plumbing: what counts as a searchable domain, and how credits are held.
//
// Both of these cost real money when they're wrong. 19% of the Meta leads in
// the local library have a social link where a website should be — searching
// those would spend a credit to be told about Meta's own staff.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CreditBudget, cleanDomain } from '../src/enrich/hunter.js';

describe('cleanDomain', () => {
  it('reduces a website to the bare host', () => {
    assert.equal(cleanDomain('https://WWW.Acme-HVAC.com/careers?x=1'), 'acme-hvac.com');
    assert.equal(cleanDomain('acme.com'), 'acme.com');
    assert.equal(cleanDomain('info@acme.com'), 'acme.com');
    assert.equal(cleanDomain('service.acme.co.uk'), 'service.acme.co.uk');
  });

  it('rejects the social links the Ad Library is full of', () => {
    for (const v of ['fb.me', 'http://fb.me/', 'facebook.com', 'www.facebook.com',
      'https://api.whatsapp.com/send', 'instagram.com/someone', 'm.me/page',
      'https://linktr.ee/x', 'bit.ly/abc']) {
      assert.equal(cleanDomain(v), '', v);
    }
  });

  it('rejects the marketplace that produced an Amazon employee as "owner"', () => {
    // A live run returned chandrakantpatil@amazon.com for "Hose Bib Buddy",
    // an Amazon product ad. Searching a marketplace spends a credit to be told
    // about somebody else's staff.
    for (const v of ['https://www.amazon.com/Hose-Bib-Buddy/dp/B087J3LKYD',
      'amazon.com', 'amzn.to/3abc', 'ebay.com', 'etsy.com/shop/x', 'walmart.com',
      'homedepot.com', 'alibaba.com']) {
      assert.equal(cleanDomain(v), '', v);
    }
  });

  it('rejects directories and aggregators, which are never the business', () => {
    for (const v of ['angi.com', 'thumbtack.com', 'yelp.com/biz/x', 'houzz.com',
      'homeadvisor.com', 'bbb.org', 'yellowpages.com']) {
      assert.equal(cleanDomain(v), '', v);
    }
  });

  it('rejects site builders and form hosts', () => {
    for (const v of ['acme.myshopify.com', 'something.wixsite.com', 'typeform.com',
      'book.housecallpro.com', 'calendly.com/x']) {
      assert.equal(cleanDomain(v), '', v);
    }
  });

  it('still accepts an ordinary company site', () => {
    assert.equal(cleanDomain('https://bourqueheating.com/contact'), 'bourqueheating.com');
    assert.equal(cleanDomain('service.acme-hvac.co.uk'), 'service.acme-hvac.co.uk');
  });

  it('rejects junk rather than guessing', () => {
    for (const v of ['[link removed]', '', null, undefined, 'nan', 'not-a-domain', 'NULL']) {
      assert.equal(cleanDomain(v), '', String(v));
    }
  });
});

describe('CreditBudget', () => {
  it('holds a credit before the search, so parallel workers cannot overshoot', () => {
    const b = new CreditBudget(2);
    // Three workers try to start at once; only two may.
    assert.equal(b.reserve(), true);
    assert.equal(b.reserve(), true);
    assert.equal(b.reserve(), false);
    assert.equal(b.inFlight, 2);
  });

  it('only charges for searches that found people', () => {
    const b = new CreditBudget(10);
    b.reserve(); b.release(true);
    b.reserve(); b.release(false);      // found nobody — Hunter does not bill
    assert.equal(b.used, 1);
    assert.equal(b.remaining, 9);
  });

  it('frees the hold when a search finds nobody, so the cap is not wasted', () => {
    const b = new CreditBudget(1);
    b.reserve();
    assert.equal(b.reserve(), false);   // the one credit is held
    b.release(false);                   // …and handed back
    assert.equal(b.reserve(), true);
  });

  it('reports exhaustion only once the credits are really spent', () => {
    const b = new CreditBudget(1);
    b.reserve();
    b.reserve();                        // refused, but a search is still in flight
    assert.equal(b.exhausted, false);   // not yet — that one may find nobody
    b.release(true);
    assert.equal(b.exhausted, true);
  });

  it('treats a missing limit as no limit', () => {
    for (const l of [undefined, null, 0, -5, NaN]) {
      const b = new CreditBudget(l);
      assert.equal(b.limit, Infinity, String(l));
      assert.equal(b.reserve(), true);
    }
  });
});
