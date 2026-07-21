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

export const api = {
  health: () => req('/api/health'),
  filters: () => req('/api/filters'),
  dbStats: () => req('/api/db/stats'),
  clearDb: () => req('/api/db/clear', { method: 'POST' }),
  createRun: (filters) => req('/api/runs', { method: 'POST', body: JSON.stringify(filters) }),
  startRun: (id) => req(`/api/runs/${id}/start`, { method: 'POST' }),
  stopRun: (id) => req(`/api/runs/${id}/stop`, { method: 'POST' }),
  getRun: (id) => req(`/api/runs/${id}`),
  exportUrl: (id) => `/api/runs/${id}/export`,
};
