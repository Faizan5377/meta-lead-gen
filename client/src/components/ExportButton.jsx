import { Download } from 'lucide-react';
import { api } from '../lib/api.js';

// Single export. Disabled the entire time a run is in progress; enabled only
// once the pipeline is fully done (exportReady from the server).
export default function ExportButton({ runId, ready }) {
  // Trigger the download via a real <a download> element (not a same-tab
  // navigation), so download/redirect-blocker extensions don't interfere.
  const download = () => {
    if (!runId || !ready) return;
    const a = document.createElement('a');
    a.href = api.exportUrl(runId);
    a.setAttribute('download', '');
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    // Keep the anchor around for a moment — removing it synchronously can
    // cancel the download before the browser has started it.
    setTimeout(() => a.remove(), 2000);
  };
  return (
    <button
      onClick={download}
      disabled={!ready}
      title={ready ? 'Download all businesses as CSV' : 'Available once the run completes'}
      className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      <Download size={15} /> Export CSV
    </button>
  );
}
