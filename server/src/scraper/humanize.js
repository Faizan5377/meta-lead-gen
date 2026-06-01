export const jitter = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

export async function humanScroll(page, distance = 1200) {
  const d = distance + Math.floor(Math.random() * 400 - 200);
  await page.evaluate(d => window.scrollBy({ top: d, behavior: 'smooth' }), d);
  await jitter(450, 1100);
}

export async function maybeHover(page, locator, p = 0.25) {
  if (Math.random() < p) {
    try { await locator.hover({ timeout: 800 }); } catch {}
    await jitter(150, 400);
  }
}
