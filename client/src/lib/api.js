async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text || path}`);
  }
  return res.json();
}

export const api = {
  health: () => req('/api/health'),
  locations: () => req('/api/locations'),
  adCategories: () => req('/api/ad-categories'),
  presets: () => req('/api/keyword-presets'),
  createSession: (payload) => req('/api/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  startSession: (id) => req(`/api/sessions/${id}/start`, { method: 'POST' }),
  stopSession: (id) => req(`/api/sessions/${id}/stop`, { method: 'POST' }),
  getSession: (id) => req(`/api/sessions/${id}`),
  enrichContacts: (id) => req(`/api/sessions/${id}/enrich-contacts`, { method: 'POST' }),
  stopContacts: (id) => req(`/api/sessions/${id}/stop-contacts`, { method: 'POST' }),
  exportUrl: (id, mode, scope) => `/api/sessions/${id}/export?mode=${mode}&scope=${scope}`,
};
