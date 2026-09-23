async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch {}
    throw new Error(`${res.status}: ${msg || path}`);
  }
  return res.json();
}

// Drop empty values so the URL only carries filters that are actually set.
export function toQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' ) continue;
    if (Array.isArray(v)) { if (v.length) qs.set(k, v.join(',')); continue; }
    qs.set(k, String(v));
  }
  return qs.toString();
}

export const api = {
  health: () => req('/api/health'),
  filters: () => req('/api/filters'),

  // Runs
  createRun: (filters) => req('/api/runs', { method: 'POST', body: JSON.stringify(filters) }),
  startRun: (id) => req(`/api/runs/${id}/start`, { method: 'POST' }),
  stopRun: (id) => req(`/api/runs/${id}/stop`, { method: 'POST' }),
  getRun: (id) => req(`/api/runs/${id}`),
  runExportUrl: (id) => `/api/runs/${id}/export`,

  // Library — organised by execution
  libraryStats: () => req('/api/library/stats'),
  libraryRuns: (search) => req(`/api/library/runs?${toQuery({ search })}`),
  runAds: (id) => req(`/api/library/runs/${id}/ads`),
  renameRun: (id, name) => req(`/api/library/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteRun: (id) => req(`/api/library/runs/${id}`, { method: 'DELETE' }),
  runExportUrlLibrary: (id) => `/api/library/runs/${id}/export`,
  clearLibrary: () => req('/api/library/clear', { method: 'POST' }),
};

// ── Google Maps ─────────────────────────────────────────────────────────────
Object.assign(api, {
  mapsLimits: () => req('/api/maps/limits'),
  createMapsRun: (filters) => req('/api/maps/runs', { method: 'POST', body: JSON.stringify(filters) }),
  startMapsRun: (id) => req(`/api/maps/runs/${id}/start`, { method: 'POST' }),
  stopMapsRun: (id) => req(`/api/maps/runs/${id}/stop`, { method: 'POST' }),
  mapsRun: (id) => req(`/api/maps/runs/${id}`),
  mapsRunExportUrl: (id) => `/api/maps/runs/${id}/export`,

  mapsStats: () => req('/api/maps/library/stats'),
  mapsLibraryRuns: (search) => req(`/api/maps/library/runs?${toQuery({ search })}`),
  mapsRunPlaces: (id) => req(`/api/maps/library/runs/${id}/places`),
  renameMapsRun: (id, name) => req(`/api/maps/library/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteMapsRun: (id) => req(`/api/maps/library/runs/${id}`, { method: 'DELETE' }),
  mapsLibraryExportUrl: (id) => `/api/maps/library/runs/${id}/export`,
});
