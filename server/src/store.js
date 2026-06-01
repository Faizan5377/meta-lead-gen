import { randomUUID } from 'node:crypto';

class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create({ location, locationCode, keywords, adType, adTypeLabel, mode, maxCards }) {
    const id = randomUUID();
    const session = {
      id,
      createdAt: new Date().toISOString(),
      location,
      locationCode,
      keywords: keywords.slice(),
      adType,
      adTypeLabel,
      mode: mode === 'ecom' ? 'ecom' : 'leadgen',
      maxCards: maxCards || 200,
      status: 'idle', // idle | running | finished | stopped | error
      currentKeywordIndex: -1,
      currentKeyword: null,
      leads: [],                 // ordered array of leads (per-ad rows)
      leadsByLibraryId: new Map(),
      adsByPageSlug: new Map(),  // page_slug -> library_ids[]
      scoresByPageSlug: new Map(), // cached relevance result
      enrichedPageSlugs: new Set(),
      cancelRequested: false,
      stoppedAt: null,
      finishedAt: null,
      errors: [],
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id);
  }

  addLead(session, lead) {
    session.leads.push(lead);
    session.leadsByLibraryId.set(lead.library_id, lead);
    if (lead.page_slug) {
      const arr = session.adsByPageSlug.get(lead.page_slug) || [];
      arr.push(lead.library_id);
      session.adsByPageSlug.set(lead.page_slug, arr);
    }
  }

  patchLead(session, libraryId, patch) {
    const lead = session.leadsByLibraryId.get(libraryId);
    if (!lead) return null;
    Object.assign(lead, patch);
    return lead;
  }

  patchLeadsByPageSlug(session, pageSlug, patch) {
    const ids = session.adsByPageSlug.get(pageSlug) || [];
    const patched = [];
    for (const id of ids) {
      const lead = session.leadsByLibraryId.get(id);
      if (lead) {
        Object.assign(lead, patch);
        patched.push(lead);
      }
    }
    return patched;
  }

  tierCounts(session) {
    const c = { hot: 0, warm: 0, cool: 0, cold: 0, pending: 0 };
    for (const l of session.leads) {
      if (!l.relevance_tier) c.pending++;
      else c[l.relevance_tier] = (c[l.relevance_tier] || 0) + 1;
    }
    return c;
  }
}

export const store = new SessionStore();
