// Viewport maths for the area sweep.
//
// Google caps one Maps search at ~120 results, so reaching a target of 100 after
// quality filtering depends on re-running the search over neighbouring
// viewports. If these two functions are wrong the sweep either searches the
// same spot repeatedly or lands in the sea.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gridAround, readViewport } from '../src/maps/engine.js';

describe('readViewport', () => {
  it('reads the centre Maps settled on', () => {
    assert.deepEqual(
      readViewport('https://www.google.com/maps/search/Plumbers+in+Dallas/@32.7766642,-96.7969879,11z?hl=en'),
      { lat: 32.7766642, lng: -96.7969879, zoom: 11 },
    );
  });

  it('is null before Maps has rewritten the URL', () => {
    assert.equal(readViewport('https://www.google.com/maps/search/Plumbers?hl=en'), null);
    assert.equal(readViewport(''), null);
  });
});

describe('gridAround', () => {
  const centre = { lat: 32.7767, lng: -96.797, zoom: 12 };

  it('covers the ring but never re-searches the centre', () => {
    const cells = gridAround(centre, 1);
    assert.equal(cells.length, 8);                       // 3x3 minus the centre
    assert.equal(cells.filter((c) => c.lat === centre.lat && c.lng === centre.lng).length, 0);
  });

  it('grows the ring on request', () => {
    assert.equal(gridAround(centre, 2).length, 24);      // 5x5 - 1
    assert.equal(gridAround(centre, 3).length, 48);      // 7x7 - 1
  });

  it('zooms in so each cell searches its own area', () => {
    for (const c of gridAround(centre, 1)) assert.equal(c.zoom, 13);
    // …but never past street level, where results get too sparse to be useful.
    for (const c of gridAround({ ...centre, zoom: 14 }, 1)) assert.equal(c.zoom, 14);
  });

  it('spaces a city-level sweep about 10 km apart, and widens as you zoom out', () => {
    const tight = gridAround(centre, 1).map((c) => c.lat);
    assert.ok(Math.min(...tight) < centre.lat && Math.max(...tight) > centre.lat);
    assert.equal(Number(Math.max(...tight).toFixed(4)), Number((centre.lat + 0.09).toFixed(4)));

    // Zoomed out one step, each cell has to cover twice the ground.
    const wide = gridAround({ ...centre, zoom: 11 }, 1).map((c) => c.lat);
    assert.equal(Number(Math.max(...wide).toFixed(4)), Number((centre.lat + 0.18).toFixed(4)));
  });

  it('orders cells nearest first, so a wide ring can stop early', () => {
    const cells = gridAround(centre, 2);
    const dist = cells.map((c) => Math.hypot(c.lat - centre.lat, c.lng - centre.lng));
    for (let i = 1; i < dist.length; i++) {
      assert.ok(dist[i] >= dist[i - 1] - 1e-9, `cell ${i} is closer than cell ${i - 1}`);
    }
    // The first four are the direct neighbours, not a far corner.
    assert.equal(new Set(dist.slice(0, 4).map((d) => d.toFixed(4))).size, 1);
    // The scratch sort key must not leak into the URL builder's input.
    assert.deepEqual(Object.keys(cells[0]).sort(), ['lat', 'lng', 'zoom']);
  });

  it('produces coordinates Google will accept', () => {
    for (const c of gridAround(centre, 3)) {
      assert.ok(Number.isFinite(c.lat) && c.lat >= -90 && c.lat <= 90);
      assert.ok(Number.isFinite(c.lng) && c.lng >= -180 && c.lng <= 180);
      assert.equal(String(c.lat).split('.')[1]?.length <= 6, true);
    }
  });
});
