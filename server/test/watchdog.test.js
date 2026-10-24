// The guard that stops a wedged browser call stranding a whole run.
//
// Written after a live run froze for seven hours: the harvest hung inside
// Playwright, so the 90-minute ceiling inside its loop never ran, the drain
// phases behind it read their empty queues as "wait for more", and 90 finished
// leads sat in memory unsaved because savePhase comes after the harvest.
//
// The distinction it has to get right is stuck vs. slow. Cutting off a slow
// phase would throw away a drain that was working perfectly.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { settledOrStalled } from '../src/watchdog.js';

// A clock the test drives, so a 15-minute stall takes no real time.
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    advance: (ms) => { t += ms; },
  };
}

const MINUTE = 60 * 1000;

describe('settledOrStalled', () => {
  it('reports success when the work finishes', async () => {
    const clock = fakeClock();
    const ok = await settledOrStalled(Promise.resolve('done'), {
      progress: () => 0, ...clock,
    });
    assert.equal(ok, true);
  });

  it('treats a rejection as finished — the caller owns the error', async () => {
    const clock = fakeClock();
    const work = Promise.reject(new Error('harvest blew up'));
    work.catch(() => {});            // the caller's own handler
    const ok = await settledOrStalled(work, { progress: () => 0, ...clock });
    assert.equal(ok, true);
  });

  it('gives up on a phase whose counter never moves', async () => {
    const clock = fakeClock();
    const ok = await settledOrStalled(new Promise(() => {}), {   // never settles
      progress: () => 7526,          // frozen, exactly as the live run was
      stallMs: 15 * MINUTE,
      pollMs: MINUTE,
      ...clock,
    });
    assert.equal(ok, false);
  });

  it('does NOT give up on a slow phase that is still moving', async () => {
    const clock = fakeClock();
    let verified = 0;
    let work;
    const promise = new Promise((resolve) => { work = resolve; });

    // One lookup every poll for an hour — four times the stall window, and
    // every bit of it legitimate work.
    const ok = await settledOrStalled(promise, {
      progress: () => {
        verified++;
        if (verified > 60) work();   // the drain completes
        return verified;
      },
      stallMs: 15 * MINUTE,
      pollMs: MINUTE,
      ...clock,
    });

    assert.equal(ok, true);
    assert.ok(verified > 60, `ran for ${verified} polls without being cut off`);
  });

  it('restarts the clock on movement, so a pause is not a stall', async () => {
    const clock = fakeClock();
    let n = 0;
    let polls = 0;
    const ok = await settledOrStalled(new Promise(() => {}), {
      progress: () => {
        polls++;
        // Fourteen minutes of silence, one lead, then silence again. The first
        // pause must not count toward the second.
        if (polls === 15) n++;
        return n;
      },
      stallMs: 15 * MINUTE,
      pollMs: MINUTE,
      ...clock,
    });

    assert.equal(ok, false);
    // Had the clock not reset, it would have quit at poll 15 instead of 30.
    assert.ok(polls >= 29, `gave up after ${polls} polls`);
  });

  it('abandons at once when the user presses Stop', async () => {
    const clock = fakeClock();
    let moved = 0;
    const ok = await settledOrStalled(new Promise(() => {}), {
      progress: () => moved++,          // moving, so the stall window never fires
      abandonWhen: () => true,
      stallMs: 15 * MINUTE,
      pollMs: MINUTE,
      ...clock,
    });
    assert.equal(ok, false);
    // A live run was stopped and sat there regardless: Stop has to be read
    // without waiting out the stall window first.
    assert.equal(clock.now(), 0, 'should not have slept before honouring Stop');
  });

  it('checks before sleeping, so a finished phase is not held up', async () => {
    const clock = fakeClock();
    await settledOrStalled(Promise.resolve(), { progress: () => 0, pollMs: 5 * MINUTE, ...clock });
    assert.equal(clock.now(), 0, 'should not have slept at all');
  });
});
