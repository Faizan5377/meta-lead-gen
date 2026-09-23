// Advice when a run finishes short.
//
// Google's supply for one search is finite, so stopping short is not a failure
// — but finishing at 9 of 100 with no explanation is indistinguishable from a
// bug. The notice has to name the lever worth pulling, and it must be the one
// that actually cost the most.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adviseOnShortfall } from '../src/maps/orchestrator.js';

const run = ({ kept = 9, filtered = 0, known = 0, reasons = {}, filters = {} } = {}) => ({
  id: 'test-run', target: 100,
  counts: { found: kept + filtered + known, kept, skippedKnown: known, skippedFiltered: filtered },
  rejectReasons: new Map(Object.entries(reasons)),
  filters: { autoExpand: true, expandRing: 2, ...filters },
  errors: [],
});

// The notice is pushed onto the run as well as emitted, so read it back there.
function advise(r) {
  adviseOnShortfall(r);
  return r.errors.at(-1);
}

describe('adviseOnShortfall', () => {
  it('always says where it got to, and files itself as a notice not an error', () => {
    const note = advise(run({ kept: 9 }));
    assert.match(note.message, /finished with 9 of 100/);
    assert.equal(note.kind, 'notice');
    assert.equal(note.scope, 'shortfall');
  });

  it('names the filter that cost the most, not just the total', () => {
    const note = advise(run({
      kept: 9,
      filtered: 300,
      reasons: { 'N reviews < N': 240, 'no website': 45, 'rating N < N': 15 },
    }));
    assert.match(note.message, /300 were dropped/);
    assert.match(note.message, /reviews < N/);
    assert.match(note.message, /\(240\)/);
    // The runner-up must not be the one blamed.
    assert.ok(!/mostly “no website”/.test(note.message));
  });

  it('stays quiet about filters that barely fired', () => {
    const note = advise(run({ kept: 40, filtered: 3, reasons: { 'no phone': 3 } }));
    assert.ok(!/dropped by your quality gates/.test(note.message));
  });

  it('mentions the library only when it really ate the results', () => {
    assert.match(advise(run({ kept: 5, known: 80 })).message, /80 were already in your library/);
    assert.ok(!/already in your library/.test(advise(run({ kept: 50, known: 2 })).message));
  });

  it('points at widening first when widening is switched off', () => {
    const note = advise(run({ filters: { autoExpand: false } }));
    assert.match(note.message, /widen the search/i);
  });

  it('suggests going further out while there is further to go', () => {
    assert.match(advise(run({ filters: { expandRing: 1 } })).message, /further out/);
    // At the widest setting, geography is exhausted — more terms is all that's left.
    const widest = advise(run({ filters: { expandRing: 3 } })).message;
    assert.ok(!/further out/.test(widest));
    assert.match(widest, /more search terms/);
  });
});
