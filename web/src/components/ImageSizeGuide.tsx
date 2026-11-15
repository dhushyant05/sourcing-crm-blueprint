/** Staff-facing recommended image sizes, derived from how the live site displays the artwork. */
export function ImageSizeGuide({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <aside className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-ink-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-ink-100" data-testid={testId ?? 'image-size-guide'}>
      <h2 className="font-semibold text-ink-900 dark:text-white">{title}</h2>
      <div className="mt-2 space-y-2 leading-relaxed">{children}</div>
    </aside>
  );
}
