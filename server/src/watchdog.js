// For a promise that cannot be trusted to finish.
//
// Every long phase here drives a real browser over a real network, and both
// can wedge: a page that never fires domcontentloaded, a scroll that never
// settles, a socket that neither delivers nor closes. The run-length ceiling
// inside the harvest loop is no help then, because the loop is blocked BEFORE
// it reaches the check — a live run sat on identical counts for seven hours
// with the whole pipeline queued behind it, holding 90 finished leads it could
// not save, and `stopRun` could not free it either because that only sets a
// flag the blocked loop never reads.
//
// A fixed deadline is the wrong instrument. A legitimate drain of a thousand
// candidates takes an hour, and cutting that off throws away work that was
// going fine. What separates a stuck phase from a merely slow one is movement,
// so movement is what this watches.

// Resolves true when `work` settles — including when it rejects, since the
// caller owns the error — and false when `progress()` has not moved for
// `stallMs`. It never cancels anything: a wedged promise cannot be cancelled,
// only abandoned, which is the caller's decision to make.
export async function settledOrStalled(work, {
  progress,                        // () => a value that changes while the phase works
  abandonWhen = () => false,       // () => true to stop waiting now (the user pressed Stop)
  stallMs = 15 * 60 * 1000,
  pollMs = 15 * 1000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  let done = false;
  // Attached before the first await so a rejection can never surface as an
  // unhandled one; the caller keeps its own catch for the error itself.
  work.then(() => { done = true; }, () => { done = true; });
  await Promise.resolve();         // let an already-settled promise register

  let last = progress();
  let movedAt = now();

  while (!done) {
    if (abandonWhen()) return false;
    await sleep(pollMs);
    if (done) break;
    // Checked before the stall window, because a user who pressed Stop should
    // not wait fifteen minutes to find out whether the phase was stuck.
    if (abandonWhen()) return false;

    const current = progress();
    if (current !== last) {
      last = current;
      movedAt = now();
      continue;
    }
    if (now() - movedAt >= stallMs) return false;
  }
  return true;
}
