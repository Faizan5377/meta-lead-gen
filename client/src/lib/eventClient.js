// SSE reducer. The `businesses` array is the single source of truth for the
// table AND every metric (metrics are derived from it in the UI, never from
// separate counters). run_started / run_finished / __snapshot__ REPLACE the
// array from the server's authoritative snapshot so any dropped live event
// self-heals. Live events patch the array in place for immediate feedback.

export const initialState = {
  runId: null,
  status: 'idle',        // idle | running | finished | stopped | error
  phase: 'idle',         // idle | harvesting | contacts | google | done
  filters: null,
  target: 0,
  counts: { rawSeen: 0, kept: 0, contactsDone: 0, googleDone: 0, skippedKnown: 0 },
  phaseInfo: { contacts: { done: 0, total: 0 }, google: { done: 0, total: 0 } },
  businesses: [],
  index: {},             // business_key -> array index
  errors: [],
  notices: [],           // e.g. "no ads for keyword X" — informational
  currentKeyword: null,
  ticker: null,
  dbStats: null,
  exportReady: false,
};

function reindex(businesses) {
  const index = {};
  businesses.forEach((b, i) => { index[b.business_key ?? b.library_id] = i; });
  return index;
}

function fromSnapshot(state, snap) {
  if (!snap) return state;
  const businesses = Array.isArray(snap.businesses) ? snap.businesses : state.businesses;
  return {
    ...state,
    // Without this the Export/Refresh buttons have no run to act on.
    runId: snap.id ?? state.runId,
    status: snap.status ?? state.status,
    phase: snap.phase ?? state.phase,
    filters: snap.filters ?? state.filters,
    target: snap.target ?? state.target,
    counts: snap.counts ?? state.counts,
    businesses,
    index: reindex(businesses),
    exportReady: !!snap.exportReady,
  };
}

export function reducer(state, ev) {
  switch (ev.type) {
    case 'run_started':
      return { ...fromSnapshot(state, ev.snapshot), status: 'running', phase: 'harvesting', ticker: 'Starting…', errors: [] };

    case 'phase_started': {
      const phaseInfo = { ...state.phaseInfo };
      if (ev.phase === 'contacts') phaseInfo.contacts = { done: 0, total: ev.total || 0 };
      if (ev.phase === 'google') phaseInfo.google = { done: 0, total: ev.total || 0 };
      return { ...state, phase: ev.phase, phaseInfo, ticker: phaseLabel(ev.phase) };
    }

    case 'phase_done':
      return { ...state, ticker: `${phaseLabel(ev.phase)} — done` };

    case 'harvest_progress':
      return {
        ...state,
        currentKeyword: ev.keyword ?? state.currentKeyword,
        counts: { ...state.counts, rawSeen: ev.rawSeen, kept: ev.kept, skippedKnown: ev.skippedKnown ?? state.counts.skippedKnown },
        ticker: `Harvesting${ev.keyword ? ` “${ev.keyword}”` : ''}${ev.country ? ` · ${ev.country}` : ''} — ${ev.kept} kept, ${ev.skippedKnown || 0} skipped`,
      };

    case 'business_added': {
      const key = ev.business.business_key ?? ev.business.library_id;
      if (state.index[key] != null) return { ...state, counts: ev.counts || state.counts };
      const businesses = state.businesses.concat(ev.business);
      return {
        ...state,
        businesses,
        index: { ...state.index, [key]: businesses.length - 1 },
        counts: ev.counts || state.counts,
        ticker: `Found "${ev.business.page_name || '—'}"`,
      };
    }

    case 'business_updated': {
      const key = ev.business.business_key ?? ev.business.library_id;
      const i = state.index[key];
      if (i == null) return state;
      const businesses = state.businesses.slice();
      businesses[i] = { ...businesses[i], ...ev.business };
      return { ...state, businesses, counts: ev.counts || state.counts };
    }

    case 'business_enriched': {
      const i = state.index[ev.business_key];
      const phaseInfo = { ...state.phaseInfo, contacts: { done: ev.done ?? state.phaseInfo.contacts.done, total: ev.total ?? state.phaseInfo.contacts.total } };
      const counts = { ...state.counts, contactsDone: ev.done ?? state.counts.contactsDone };
      if (i == null) return { ...state, phaseInfo, counts };
      const businesses = state.businesses.slice();
      businesses[i] = { ...businesses[i], ...ev.patch };
      return { ...state, businesses, phaseInfo, counts };
    }

    case 'business_owner': {
      const i = state.index[ev.business_key];
      const phaseInfo = { ...state.phaseInfo, google: { done: ev.done ?? state.phaseInfo.google.done, total: ev.total ?? state.phaseInfo.google.total } };
      const counts = { ...state.counts, googleDone: ev.done ?? state.counts.googleDone };
      if (i == null) return { ...state, phaseInfo, counts };
      const businesses = state.businesses.slice();
      businesses[i] = { ...businesses[i], ...ev.patch };
      return { ...state, businesses, phaseInfo, counts };
    }

    case 'contact_progress':
      return { ...state, ticker: `Contacts ${ev.done}/${ev.total} — ${ev.current || ''}` };

    case 'google_progress':
      return { ...state, ticker: `Owner lookup ${ev.done}/${ev.total} — ${ev.current || ''}` };

    case 'error':
      return { ...state, errors: state.errors.concat([{ scope: ev.scope, message: ev.message, ts: ev.ts }]).slice(-200) };

    // A keyword with no matching ads — informational, not a failure.
    case 'notice':
      return { ...state, notices: (state.notices || []).concat([{ scope: ev.scope, message: ev.message, ts: ev.ts }]).slice(-100) };

    case 'run_finished':
      return {
        ...fromSnapshot(state, ev.snapshot),
        status: ev.status || 'finished',
        phase: 'done',
        counts: ev.counts || state.counts,
        dbStats: ev.dbStats || state.dbStats,
        exportReady: true,
        ticker: ev.status === 'stopped' ? 'Stopped' : ev.status === 'error' ? `Error: ${ev.message || ''}` : 'Complete',
      };

    case '__snapshot__':
      return { ...fromSnapshot(state, ev.snapshot), ticker: 'Refreshed' };

    default:
      return state;
  }
}

function phaseLabel(p) {
  return { harvesting: 'Harvesting ads', contacts: 'Fetching Facebook contacts', google: 'Finding owners on Google', done: 'Done' }[p] || p;
}

export function subscribeToRun(runId, onEvent) {
  const es = new EventSource(`/api/runs/${runId}/events`);
  const handler = (e) => { try { onEvent(JSON.parse(e.data)); } catch {} };
  const types = [
    'run_started', 'phase_started', 'phase_done', 'harvest_progress',
    'business_added', 'business_updated', 'business_enriched', 'business_owner',
    'contact_progress', 'google_progress', 'error', 'notice', 'run_finished',
  ];
  for (const t of types) es.addEventListener(t, handler);
  es.onerror = () => {/* EventSource auto-retries */};
  return () => es.close();
}
