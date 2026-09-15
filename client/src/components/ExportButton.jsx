import { Download } from 'lucide-react';

// Triggers the download via a real <a download> element (not a same-tab
// navigation), so download/redirect-blocker extensions don't interfere.
export default function ExportButton({ href, ready, label = 'Export CSV' }) {
  const download = () => {
    if (!href || !ready) return;
    const a = document.createElement('a');
    a.href = href;
    a.setAttribute('download', '');
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    // Keep the anchor briefly — removing it synchronously can cancel the
    // download before the browser has started it.
    setTimeout(() => a.remove(), 2000);
  };

  return (
    <button
      onClick={download}
      disabled={!ready}
      title={ready ? 'Download as CSV' : 'Available once the run completes'}
      className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      <Download size={15} /> {label}
    </button>
  );
}
