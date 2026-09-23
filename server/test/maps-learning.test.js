// Learned search terms.
//
// The cheapest way past Google's ~120-per-search cap is to ask differently,
// using the categories Google itself gave the businesses this search turned up.
// The rules mirror the Ad Library's niche gate: nothing about any trade is
// hardcoded, only the PRIMARY category is learned, and one business is not
// evidence.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { learnedCategories, noteCategory } from '../src/maps/orchestrator.js';

const newRun = () => ({ categories: new Map() });

// Feed places through the learner the way a run does.
function learn(pairs) {
  const run = newRun();
  for (const [category, verdict] of pairs) {
    noteCategory(run, { category }, verdict || { keep: true });
  }
  return run;
}

const rejected = (reason) => ({ keep: false, reason });

describe('learnedCategories', () => {
  it('needs two businesses before a category earns its own search', () => {
    const run = learn([['Plumber'], ['Plumber'], ['Water heater installer']]);
    assert.deepEqual(learnedCategories(run), ['Plumber']);
  });

  it('orders by how common the category is', () => {
    const run = learn([['Drainage service'], ['Plumber'], ['Plumber'], ['Plumber'], ['Drainage service']]);
    assert.deepEqual(learnedCategories(run), ['Plumber', 'Drainage service']);
  });

  it('caps the list, so a broad search cannot fan out forever', () => {
    const pairs = [];
    for (let i = 0; i < 20; i++) pairs.push([`Trade ${i}`], [`Trade ${i}`]);
    assert.equal(learnedCategories(learn(pairs)).length, 6);
    assert.equal(learnedCategories(learn(pairs), 2).length, 2);
  });

  it('survives missing categories and an empty run', () => {
    assert.deepEqual(learnedCategories(learn([[null], [''], ['  '], [undefined]])), []);
    assert.deepEqual(learnedCategories(newRun()), []);
  });
});

describe('what is allowed to teach', () => {
  it('learns from businesses the quality gate rejected', () => {
    // A plumber with 12 reviews is still a plumber. Learning only from the
    // survivors starves the learner exactly when a strict gate makes it matter.
    const run = learn([
      ['Plumber', rejected('12 reviews < 100')],
      ['Plumber', rejected('no website')],
    ]);
    assert.deepEqual(learnedCategories(run), ['Plumber']);
  });

  it('refuses to learn from the wrong KIND of business', () => {
    const run = learn([
      ['Hardware store', rejected('category excluded')],
      ['Hardware store', rejected('category excluded')],
      ['Electrician', rejected('category not in list')],
      ['Electrician', rejected('category not in list')],
      ['Roto-Rooter', rejected('name excluded')],
      ['Roto-Rooter', rejected('name excluded')],
    ]);
    assert.deepEqual(learnedCategories(run), []);
  });

  it('ignores secondary categories entirely — that is where niche drift lives', () => {
    // A plumber also carries "Contractor"; learning it would pull in roofers.
    const run = newRun();
    for (let i = 0; i < 2; i++) {
      noteCategory(run, { category: 'Plumber', categories: ['Plumber', 'Contractor'] });
    }
    assert.deepEqual(learnedCategories(run), ['Plumber']);
  });
});
