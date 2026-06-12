// SSE reducer + subscription helper. Single source of truth for client state
// during a run. We track every lead by library_id and patch in place as
// enrichment / scoring / company_count events arrive.

export const initialState = {
  status: 'idle', // idle | running | finished | stopped | error
  sessionId: null,
  location: null,
  locationCode: null,
  adType: null,
  adTypeLabel: null,
  keywords: [],
  currentKeywordIndex: -1,
  currentKeyword: null,
  perKeywordDiscovered: {},
  perKeywordEnriched: {},
  totalEnriched: 0,
  totalCompanies: 0,
  totalFailed: 0,
  cardsFound: 0,
  scrolls: 0,
  phase: 'idle', // idle | discovering | enriching
  enrichTotal: 0,
  enrichDone: 0,
  enrichCurrent: null,
  contactRunning: false,
  contactTotal: 0,
  contactDone: 0,
  contactCurrent: null,
  contactEnrichedCount: 0,
  ticker: null,
  leads: [],
  leadIndex: new Map(), // library_id -> index in leads
  tierCounts: { hot: 0, warm: 0, cool: 0, cold: 0, pending: 0 },
  errors: [],
};

export function reducer(state, ev) {
  switch (ev.type) {
    case 'session_started': {
      return {
        ...state,
        status: 'running',
        sessionId: ev.sessionId,
        location: ev.location,
        locationCode: ev.locationCode,
        adType: ev.adType,
        adTypeLabel: ev.adTypeLabel,
        keywords: ev.keywords,
        phase: 'discovering',
        ticker: 'Starting session…',
      };
    }
    case 'keyword_started': {
      return {
        ...state,
        currentKeywordIndex: ev.index,
        currentKeyword: ev.keyword,
        phase: 'discovering',
        enrichTotal: 0,
        enrichDone: 0,
        enrichCurrent: null,
        ticker: `Keyword ${ev.index + 1} of ${ev.total} — "${ev.keyword}"`,
      };
    }
    case 'scroll_progress': {
      return {
        ...state,
        cardsFound: ev.cardsFound,
        scrolls: (state.scrolls || 0) + 1,
        phase: 'discovering',
        ticker: `Scrolling "${ev.keyword}" — ${ev.cardsFound} ads loaded`,
      };
    }
    case 'enrich_started': {
      return { ...state, phase: 'enriching', enrichTotal: ev.total, enrichDone: 0, enrichCurrent: null };
    }
    case 'enrich_progress': {
      return {
        ...state,
        phase: 'enriching',
        enrichTotal: ev.total,
        enrichDone: ev.done,
        enrichCurrent: ev.current,
        ticker: `Enriching ${ev.done}/${ev.total} — ${ev.current}`,
      };
    }
    case 'lead_discovered': {
      const newLeads = state.leads.slice();
      const idx = newLeads.length;
      newLeads.push(ev.lead);
      const idxMap = new Map(state.leadIndex);
      idxMap.set(ev.lead.library_id, idx);
      const perKw = { ...state.perKeywordDiscovered, [ev.keyword]: (state.perKeywordDiscovered[ev.keyword] || 0) + 1 };
      const companies = new Set();
      for (const l of newLeads) if (l.page_slug) companies.add(l.page_slug);
      const tier = updateTierCounts(state.tierCounts, null, null);
      return {
        ...state,
        leads: newLeads,
        leadIndex: idxMap,
        perKeywordDiscovered: perKw,
        cardsFound: state.cardsFound + 1,
        totalCompanies: companies.size,
        tierCounts: { ...tier, pending: tier.pending + 1 },
        ticker: `Discovered "${ev.lead.page_name || '—'}" — ${idx + 1} ads so far`,
      };
    }
    case 'lead_enriched': {
      const i = state.leadIndex.get(ev.library_id);
      if (i == null) return state;
      const newLeads = state.leads.slice();
      newLeads[i] = { ...newLeads[i], ...ev.patch };
      const enrichedNow = newLeads.filter(l => l.enrichment_status === 'enriched').length;
      const failedNow = newLeads.filter(l => l.enrichment_status === 'failed').length;
      return {
        ...state,
        leads: newLeads,
        totalEnriched: enrichedNow,
        totalFailed: failedNow,
        ticker: `Enriched "${newLeads[i].page_name || '—'}" — ${enrichedNow}/${newLeads.length}`,
      };
    }
    case 'lead_scored': {
      const i = state.leadIndex.get(ev.library_id);
      if (i == null) return state;
      const newLeads = state.leads.slice();
      const prevTier = newLeads[i].relevance_tier;
      newLeads[i] = { ...newLeads[i], ...ev.patch };
      const nextTier = ev.patch.relevance_tier;
      const tierCounts = updateTierCounts(state.tierCounts, prevTier, nextTier);
      return { ...state, leads: newLeads, tierCounts };
    }
    case 'company_count_updated': {
      const newLeads = state.leads.map(l =>
        l.page_slug === ev.page_slug ? { ...l, company_total_ads: ev.company_total_ads } : l
      );
      return { ...state, leads: newLeads };
    }
    case 'keyword_pass_a_done': {
      return { ...state, ticker: `"${ev.keyword}" — ${ev.leadsDiscovered} ads loaded, enriching…` };
    }
    case 'keyword_finished': {
      const perKw = { ...state.perKeywordEnriched, [ev.keyword]: ev.totalLeads };
      return { ...state, perKeywordEnriched: perKw, ticker: `Finished "${ev.keyword}" — ${ev.totalLeads} ads` };
    }
    case 'session_finished': {
      return {
        ...state,
        status: 'finished',
        ticker: `Session complete — ${ev.totalLeads} leads`,
        tierCounts: { ...state.tierCounts, ...(ev.tierCounts || {}) },
      };
    }
    case 'session_stopped': {
      return { ...state, status: 'stopped', ticker: 'Stopped' };
    }
    case 'contact_started': {
      return { ...state, contactRunning: true, contactTotal: ev.total, contactDone: 0, contactCurrent: null,
        ticker: `Fetching Facebook contacts for ${ev.total} businesses…` };
    }
    case 'contact_progress': {
      return { ...state, contactRunning: true, contactTotal: ev.total, contactDone: ev.done, contactCurrent: ev.current,
        ticker: `Contacts ${ev.done}/${ev.total} — ${ev.current}` };
    }
    case 'lead_contact': {
      // Fan the contact patch out to every ad from this advertiser.
      const newLeads = state.leads.map(l =>
        l.page_slug === ev.page_slug ? { ...l, ...ev.patch } : l
      );
      return { ...state, leads: newLeads };
    }
    case 'contact_finished': {
      return { ...state, contactRunning: false, contactCurrent: null, contactEnrichedCount: ev.enriched,
        ticker: `Contacts done — ${ev.enriched} businesses with email/phone/website` };
    }
    case 'error': {
      const errs = state.errors.concat([{ scope: ev.scope, message: ev.message, ts: ev.ts }]).slice(-50);
      return { ...state, errors: errs };
    }
    // Manual refresh — rebuild lead state from a full session snapshot pulled
    // via REST. Lets the operator force an instant sync if SSE lags.
    case '__snapshot__': {
      const s = ev.session;
      if (!s || !Array.isArray(s.leads)) return state;
      const leadIndex = new Map();
      s.leads.forEach((l, i) => leadIndex.set(l.library_id, i));
      const companies = new Set(s.leads.map(l => l.page_slug).filter(Boolean));
      const tierCounts = { hot: 0, warm: 0, cool: 0, cold: 0, pending: 0 };
      for (const l of s.leads) {
        if (!l.relevance_tier) tierCounts.pending++;
        else tierCounts[l.relevance_tier] = (tierCounts[l.relevance_tier] || 0) + 1;
      }
      return {
        ...state,
        status: s.status || state.status,
        leads: s.leads,
        leadIndex,
        cardsFound: s.leads.length,
        totalCompanies: companies.size,
        totalEnriched: s.leads.filter(l => l.enrichment_status === 'enriched').length,
        totalFailed: s.leads.filter(l => l.enrichment_status === 'failed').length,
        tierCounts,
        ticker: 'Refreshed from server',
      };
    }
    default:
      return state;
  }
}

function updateTierCounts(counts, prev, next) {
  const c = { ...counts };
  if (prev) c[prev] = Math.max(0, (c[prev] || 0) - 1);
  else c.pending = Math.max(0, (c.pending || 0) - (next ? 1 : 0));
  if (next) c[next] = (c[next] || 0) + 1;
  return c;
}

export function subscribeToSession(sessionId, onEvent) {
  const es = new EventSource(`/api/sessions/${sessionId}/events`);
  const handler = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch {}
  };
  const types = [
    'session_started', 'keyword_started', 'scroll_progress', 'lead_discovered',
    'lead_enriched', 'lead_scored', 'company_count_updated',
    'enrich_started', 'enrich_progress',
    'contact_started', 'contact_progress', 'lead_contact', 'contact_finished',
    'keyword_pass_a_done', 'keyword_finished', 'session_finished',
    'session_stopped', 'error',
  ];
  for (const t of types) es.addEventListener(t, handler);
  es.onerror = () => {/* EventSource auto-retries */};
  return () => es.close();
}
