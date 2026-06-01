// Per-keyword session orchestrator. Owns the Playwright page, drives both
// scraping passes, computes company_total_ads live, and emits events.

import { config } from './config.js';
import { bus } from './eventStream.js';
import { enrichAdvertiserByLibraryId, getContext, scrapeKeyword } from './scraper/engine.js';
import { scoreLead } from './scorer.js';
import { store } from './store.js';

export async function runSession(sessionId) {
  const session = store.get(sessionId);
  if (!session) return;
  session.status = 'running';
  bus.emit(sessionId, {
    type: 'session_started',
    sessionId,
    location: session.location,
    locationCode: session.locationCode,
    adType: session.adType,
    adTypeLabel: session.adTypeLabel,
    mode: session.mode,
    maxCards: session.maxCards,
    keywords: session.keywords,
  });

  const ctx = await getContext();
  const page = await ctx.newPage();

  try {
    for (let i = 0; i < session.keywords.length; i++) {
      if (session.cancelRequested) break;
      const keyword = session.keywords[i];
      session.currentKeywordIndex = i;
      session.currentKeyword = keyword;

      bus.emit(sessionId, {
        type: 'keyword_started',
        index: i,
        total: session.keywords.length,
        keyword,
      });

      // Pass A — discover
      let libraryIds = [];
      try {
        libraryIds = await scrapeKeyword({
          page,
          country: session.locationCode,
          keyword,
          adType: session.adType,
          location: session.location,
          locationCode: session.locationCode,
          onLeadDiscovered: (lead) => {
            store.addLead(session, lead);
            updateCompanyCount(sessionId, session, lead.page_slug);
            bus.emit(sessionId, { type: 'lead_discovered', keyword, lead });
          },
          onProgress: (p) => {
            bus.emit(sessionId, { type: 'scroll_progress', keyword, ...p });
          },
          shouldStop: () => session.cancelRequested,
          maxCards: session.maxCards,
        });
      } catch (err) {
        session.errors.push({ scope: 'keyword', keyword, message: err.message });
        bus.emit(sessionId, {
          type: 'error', scope: 'keyword', keyword, message: err.message, recoverable: true,
        });
      }

      bus.emit(sessionId, {
        type: 'keyword_pass_a_done',
        keyword,
        leadsDiscovered: libraryIds.length,
      });

      if (session.cancelRequested) break;

      // Pass B — enrich one card per unique advertiser, fan out to siblings.
      const slugs = new Set();
      for (const id of libraryIds) {
        const lead = session.leadsByLibraryId.get(id);
        if (!lead) continue;
        // Re-score with whatever data we already have (so cards stream colored).
        applyScore(sessionId, session, lead);
        if (lead.page_slug && !slugs.has(lead.page_slug) && !session.enrichedPageSlugs.has(lead.page_slug)) {
          slugs.add(lead.page_slug);
        }
      }

      const slugQueue = Array.from(slugs);
      const workers = Math.min(config.enrichConcurrency, Math.max(1, slugQueue.length));
      const workerPromises = [];
      for (let w = 0; w < workers; w++) {
        workerPromises.push((async () => {
          const workerPage = w === 0 ? page : await ctx.newPage();
          try {
            while (slugQueue.length) {
              if (session.cancelRequested) return;
              const slug = slugQueue.shift();
              const ids = session.adsByPageSlug.get(slug);
              if (!ids?.length) continue;
              const sampleId = ids[0];
              try {
                const patch = await enrichAdvertiserByLibraryId(workerPage, sampleId);
                session.enrichedPageSlugs.add(slug);
                const patched = store.patchLeadsByPageSlug(session, slug, patch);
                for (const lead of patched) {
                  bus.emit(sessionId, {
                    type: 'lead_enriched', library_id: lead.library_id, page_slug: slug, patch,
                  });
                  applyScore(sessionId, session, lead);
                }
              } catch (err) {
                session.errors.push({ scope: 'enrichment', slug, message: err.message });
                bus.emit(sessionId, {
                  type: 'error', scope: 'enrichment', page_slug: slug, message: err.message, recoverable: true,
                });
              }
            }
          } finally {
            if (w > 0) try { await workerPage.close(); } catch {}
          }
        })());
      }
      await Promise.all(workerPromises);

      bus.emit(sessionId, {
        type: 'keyword_finished',
        keyword,
        totalLeads: libraryIds.length,
      });
    }

    session.status = session.cancelRequested ? 'stopped' : 'finished';
    session.finishedAt = new Date().toISOString();
    bus.emit(sessionId, {
      type: session.cancelRequested ? 'session_stopped' : 'session_finished',
      totalLeads: session.leads.length,
      tierCounts: store.tierCounts(session),
    });
  } catch (err) {
    session.status = 'error';
    session.errors.push({ scope: 'session', message: err.message });
    bus.emit(sessionId, { type: 'error', scope: 'session', message: err.message, recoverable: false });
  } finally {
    try { await page.close(); } catch {}
  }
}

function updateCompanyCount(sessionId, session, pageSlug) {
  if (!pageSlug) return;
  const ids = session.adsByPageSlug.get(pageSlug) || [];
  const count = ids.length;
  const patched = store.patchLeadsByPageSlug(session, pageSlug, { company_total_ads: count });
  bus.emit(sessionId, { type: 'company_count_updated', page_slug: pageSlug, company_total_ads: count });
  // Re-score because company_total_ads contributes to the score.
  for (const lead of patched) applyScore(sessionId, session, lead);
}

function applyScore(sessionId, session, lead) {
  try {
    // Re-score on every relevant update (enrichment, company_total_ads). Cheap
    // to recompute; uses the session's mode (leadgen | ecom).
    const result = scoreLead(lead, session.mode);
    session.scoresByPageSlug.set(lead.page_slug, result);
    const patch = {
      relevance_score: result.score,
      relevance_tier: result.tier,
      relevance_reasons: result.reasons,
      is_lead_gen_ad: result.is_lead_gen_ad,
      search_match: result.search_match,
      relevance_status: result.relevance_status,
    };
    Object.assign(lead, patch);
    bus.emit(sessionId, {
      type: 'lead_scored',
      library_id: lead.library_id,
      page_slug: lead.page_slug,
      patch,
    });
  } catch (err) {
    lead.relevance_status = 'failed';
    lead.relevance_tier = 'cool';
    session.errors.push({ scope: 'scoring', library_id: lead.library_id, message: err.message });
  }
}

export function stopSession(sessionId) {
  const session = store.get(sessionId);
  if (!session) return false;
  session.cancelRequested = true;
  session.stoppedAt = new Date().toISOString();
  return true;
}
