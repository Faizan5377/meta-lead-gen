// SSE reducer for Google Maps runs.
//
// Same contract as the ad-library reducer: `places` is the single source of
// truth for the table AND the metrics, and snapshot-bearing events REPLACE the
// array so any dropped live event self-heals.

export const mapsInitialState = {
  runId: null,
  name: null,
  status: 'idle',      // idle | running | finished | stopped | error
  phase: 'idle',       // idle | searching | saving | done
  filters: null,
  target: 0,
  counts: { found: 0, kept: 0, skippedKnown: 0, skippedNoPhone: 0 },
  places: [],
  index: {},           // feature_id -> position
  errors: [],
  notices: [],
  ticker: null,
  saveResult: null,
  exportReady: false,
};

const reindex = (places) => {
  const ix = {};
  places.forEach((p, i) => { ix[p.feature_id] = i; });
  return ix;
};

function fromSnapshot(state, snap) {
  if (!snap) return state;
  const places = Array.isArray(snap.places) ? snap.places : state.places;
  return {
    ...state,
    runId: snap.id ?? state.runId,
    name: snap.name ?? state.name,
    status: snap.status ?? state.status,
    phase: snap.phase ?? state.phase,
    filters: snap.filters ?? state.filters,
    target: snap.target ?? state.target,
    counts: snap.counts ?? state.counts,
    places,
    index: reindex(places),
    exportReady: !!snap.exportReady,
  };
}

export function mapsReducer(state, ev) {
  switch (ev.type) {
    case 'run_started':
      return { ...fromSnapshot(state, ev.snapshot), status: 'running', phase: 'searching', ticker: 'Starting…', errors: [], notices: [] };

    case 'phase_started':
      return { ...state, phase: ev.phase, ticker: ev.phase === 'saving' ? 'Saving to library…' : 'Searching Google Maps…' };

    case 'phase_done':
      return {
        ...state,
        saveResult: ev.phase === 'saving' ? { saved: ev.saved, remote: ev.remote } : state.saveResult,
      };

    case 'search_progress':
      return {
        ...state,
        counts: { ...state.counts, found: ev.found, kept: ev.kept, skippedKnown: ev.skippedKnown },
        ticker: `Searching “${ev.query}” — ${ev.kept}/${ev.target} collected`,
      };

    case 'place_added': {
      const id = ev.place.feature_id;
      if (state.index[id] != null) return { ...state, counts: ev.counts || state.counts };
      const places = state.places.concat(ev.place);
      return {
        ...state, places,
        index: { ...state.index, [id]: places.length - 1 },
        counts: ev.counts || state.counts,
        ticker: `Found “${ev.place.name}”`,
      };
    }

    case 'place_rejected':
      return { ...state, counts: ev.counts || state.counts };

    // Review counts arrive after the rail finishes rendering, so the server
    // sends a corrected snapshot rather than us losing them.
    case 'places_patched':
      return fromSnapshot(state, ev.snapshot);

    case 'error':
      return { ...state, errors: state.errors.concat([{ scope: ev.scope, message: ev.message }]).slice(-100) };

    case 'notice':
      return { ...state, notices: state.notices.concat([{ scope: ev.scope, message: ev.message }]).slice(-50) };

    case 'run_finished':
      return {
        ...fromSnapshot(state, ev.snapshot),
        status: ev.status || 'finished',
        phase: 'done',
        counts: ev.counts || state.counts,
        saveResult: ev.saveResult || state.saveResult,
        exportReady: true,
        ticker: ev.status === 'stopped' ? 'Stopped' : ev.status === 'error' ? `Error: ${ev.message || ''}` : 'Complete',
      };

    case '__snapshot__':
      return fromSnapshot(state, ev.snapshot);

    case '__reset__':
      return { ...mapsInitialState };

    default:
      return state;
  }
}

export function subscribeToMapsRun(runId, onEvent) {
  const es = new EventSource(`/api/maps/runs/${runId}/events`);
  const handler = (e) => { try { onEvent(JSON.parse(e.data)); } catch {} };
  // EventSource listens per event NAME — every type the server emits must be
  // listed here or it is silently dropped.
  const types = [
    'run_started', 'phase_started', 'phase_done', 'search_progress',
    'place_added', 'place_rejected', 'places_patched',
    'error', 'notice', 'run_finished',
  ];
  for (const t of types) es.addEventListener(t, handler);
  es.onerror = () => {/* EventSource auto-retries */};
  return () => es.close();
}
