// What a Maps target counts, now that it counts the same thing the Ad Library
// target does: FINISHED leads.
//
// It used to mean "collect 100 places", with the Hunter lookup bolted on at the
// end — which could only ever shrink the result below the number asked for. A
// run that asked for 100 and delivered 11 was behaving exactly as designed, and
// that is the design that changed.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../src/config.js';
import { createRun, getRun, keptPlaces } from '../src/maps/orchestrator.js';

const filters = (over = {}) => ({
  queries: ['plumber'], locations: ['Dallas TX'], target: 10,
  quality: {}, autoExpand: true, expandRing: 2, ...over,
});

const place = (i) => ({ feature_id: `f${i}`, place_id: `p${i}`, name: `Biz ${i}` });

describe('a Maps run counts finished leads', () => {
  it('gives itself room to check far more places than the target', () => {
    const run = createRun(filters({ target: 10 }));
    // Hunter rejects most places, so the search must be free to work through
    // many more than it keeps — the ceiling is a rail, not the target.
    assert.equal(run.candidateCeiling, Math.max(500, 10 * config.candidatesPerLead));
    assert.ok(run.candidateCeiling > run.target * 10);
  });

  it('caps the ceiling so a niche that never converts still ends', () => {
    const run = createRun(filters({ target: config.maxCandidates }));
    assert.equal(run.candidateCeiling, config.maxCandidates);
  });

  it('counts nothing until a place has someone to email', () => {
    const run = createRun(filters());
    run.contactsRequired = true;
    run.places.push(place(1), place(2));

    assert.equal(keptPlaces(run).length, 0, 'two candidates, no leads');

    run.places[0].owner_email = 'ann@biz1.com';
    assert.deepEqual(keptPlaces(run).map((p) => p.feature_id), ['f1']);
  });

  it('counts every place when the contact lookup is switched off', () => {
    // No Hunter key, or enrichWithHunter false: the places ARE the result, and
    // filtering them on an email nobody went looking for would empty the run.
    const run = createRun(filters());
    run.places.push(place(1), place(2));
    assert.equal(keptPlaces(run).length, 2);
  });

  it('is retrievable by id, with the run registered on creation', () => {
    const run = createRun(filters());
    assert.equal(getRun(run.id), run);
    assert.equal(run.counts.kept, 0);
    assert.equal(run.counts.harvested, 0);
  });
});
