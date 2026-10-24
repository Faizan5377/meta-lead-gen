// The streaming enricher: what makes "150 leads" mean 150 leads.
//
// It runs while the harvest is still going, so it has to answer two questions
// the batch version never faced: when is the queue empty rather than finished,
// and when has the run got what it asked for. Getting the second one wrong
// costs real money — a credit spent past the target buys a lead that is then
// thrown away.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startEnrichment } from '../src/enrich/phase.js';

const person = (email, position = 'Owner') => ({
  email, first_name: 'A', last_name: 'B', position, confidence: 90,
});

// A queue the test can top up mid-flight, the way the harvest does.
function queue(leads = []) {
  const items = leads.slice();
  return {
    push: (l) => items.push(l),
    next: () => items.shift() || null,
    get length() { return items.length; },
  };
}

const lead = (i) => ({ business_name: `Biz ${i}`, website: `https://biz${i}.com` });

// Every domain returns a usable owner unless the test says otherwise.
const alwaysFinds = async (domain) => ({
  charged: true, people: [person(`owner@${domain}`)],
});

describe('startEnrichment', () => {
  it('stops the moment the target is reached, without paying for one more', async () => {
    const q = queue(Array.from({ length: 20 }, (_, i) => lead(i)));
    const kept = [];

    const stream = startEnrichment({
      apiKey: 'k', lookup: alwaysFinds, concurrency: 3,
      nextLead: q.next,
      capacity: () => 5 - kept.length,
      onKept: (l) => kept.push(l),
    });
    stream.harvestFinished();
    await stream.promise;

    assert.equal(kept.length, 5);
    // Three workers were running; without the in-flight check they would have
    // charged for two leads past the target.
    assert.equal(stream.creditsUsed, 5);
    // …and the rest of the queue is untouched, still available to a later run.
    assert.equal(q.length, 15);
  });

  it('keeps digging while leads fail, because a failure is not a lead', async () => {
    // Nine in ten domains have nobody senior enough — the live rate.
    let n = 0;
    const lookup = async (domain) => {
      n++;
      return n % 10 === 0
        ? { charged: true, people: [person(`owner@${domain}`)] }
        : { charged: true, people: [person(`intern@${domain}`, 'Intern')] };
    };
    const q = queue(Array.from({ length: 100 }, (_, i) => lead(i)));
    const kept = [];
    const dropped = [];

    const stream = startEnrichment({
      apiKey: 'k', lookup, concurrency: 1,
      nextLead: q.next,
      capacity: () => 3 - kept.length,
      onKept: (l) => kept.push(l),
      onDropped: (l, reason) => dropped.push(reason),
    });
    stream.harvestFinished();
    await stream.promise;

    assert.equal(kept.length, 3);
    assert.equal(dropped.length, 27);   // it worked through 30 to find 3
  });

  it('waits for the harvest rather than treating an empty queue as finished', async () => {
    const q = queue();
    const kept = [];

    const stream = startEnrichment({
      apiKey: 'k', lookup: alwaysFinds, concurrency: 2,
      nextLead: q.next,
      capacity: () => 2 - kept.length,
      onKept: (l) => kept.push(l),
    });

    // The queue is empty at the start — exactly the state at the moment a run
    // begins, when the harvest has produced nothing yet.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(kept.length, 0);

    q.push(lead(1));
    q.push(lead(2));
    stream.harvestFinished();
    await stream.promise;

    assert.equal(kept.length, 2);
  });

  it('ends when the credit cap is spent, and says so', async () => {
    const q = queue(Array.from({ length: 50 }, (_, i) => lead(i)));
    const kept = [];

    const stream = startEnrichment({
      apiKey: 'k', lookup: alwaysFinds, concurrency: 1, maxCredits: 4,
      nextLead: q.next,
      capacity: () => 100 - kept.length,       // far more than it can afford
      onKept: (l) => kept.push(l),
    });
    stream.harvestFinished();
    await stream.promise;

    assert.equal(kept.length, 4);
    assert.equal(stream.exhausted, true);
    assert.equal(stream.creditsUsed, 4);
  });

  it('stops on a stop(), leaving the rest of the queue alone', async () => {
    const q = queue(Array.from({ length: 30 }, (_, i) => lead(i)));
    const kept = [];

    const stream = startEnrichment({
      apiKey: 'k',
      lookup: async (d) => {
        await new Promise((r) => setTimeout(r, 5));
        return { charged: true, people: [person(`owner@${d}`)] };
      },
      concurrency: 1,
      nextLead: q.next,
      capacity: () => 100 - kept.length,
      onKept: (l) => kept.push(l),
    });

    await new Promise((r) => setTimeout(r, 20));
    stream.stop();
    await stream.promise;

    assert.ok(kept.length > 0 && kept.length < 30, `stopped mid-queue, kept ${kept.length}`);
  });
});
