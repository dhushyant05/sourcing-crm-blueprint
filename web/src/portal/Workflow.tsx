import type { PortalFlow } from './api';

const day = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null);
const OUTCOME: Record<string, string> = { cancelled: 'Cancelled', rejected: 'Declined' };

/** Customer-visible progress tracker (English only). Maps server workflow steps; never invents internal stages. */
export function WorkflowTracker({ flow, compact }: { flow?: PortalFlow | null; compact?: boolean }) {
  if (!flow?.steps?.length) return null;
  const outcome = flow.outcome ? OUTCOME[flow.outcome] : null;
  return (
    <div data-testid="portal-workflow" className={compact ? '' : 'rounded-2xl border border-ink-100 bg-white p-4 shadow-sm'}>
      {outcome && <p data-testid="portal-workflow-outcome" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">{outcome}</p>}
      <ol className={compact ? 'flex flex-wrap gap-1.5' : 'space-y-0'} aria-label="Progress">
        {flow.steps.map((s, i) => (
          <li key={s.key} className={compact
            ? `rounded-full px-2.5 py-1 text-xs font-medium ${s.state === 'done' ? 'bg-brand-100 text-brand-700' : s.state === 'current' ? 'bg-brand-600 text-white' : 'bg-ink-50 text-ink-400'}`
            : 'relative flex gap-3 pb-4 last:pb-0'}
            aria-current={s.state === 'current' ? 'step' : undefined}>
            {!compact && (
              <>
                <span className="flex flex-col items-center">
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${s.state === 'done' ? 'bg-brand-600 text-white' : s.state === 'current' ? 'bg-brand-600 text-white ring-4 ring-brand-100' : 'bg-ink-100 text-ink-400'}`}>{s.state === 'done' ? '✓' : i + 1}</span>
                  {i < flow.steps.length - 1 && <span className={`w-0.5 flex-1 ${s.state === 'done' ? 'bg-brand-400' : 'bg-ink-100'}`} />}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className={`block text-sm font-medium ${s.state === 'upcoming' ? 'text-ink-400' : 'text-ink-900'}`}>{s.label}</span>
                  {s.at && s.state === 'done' && <span className="block text-xs text-ink-500">{day(s.at)}</span>}
                  {s.state === 'current' && !outcome && <span className="block text-xs text-brand-700">Current</span>}
                </span>
              </>
            )}
            {compact && s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
