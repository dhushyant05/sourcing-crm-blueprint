// Copies each table header's text onto its column's cells as data-label, so the phone card layout
// (index.css, table.rtable) can show "QTY  5,000" rows. Re-runs on any DOM change, incl. language switch.
function label(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>('table.rtable').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent?.trim() ?? '');
    t.querySelectorAll('tbody tr').forEach((r) => [...r.children].forEach((c, i) => {
      const l = heads[i] ?? '';
      if (c.getAttribute('data-label') !== l) c.setAttribute('data-label', l);
    }));
  });
}
export function startTableLabels() {
  let q = false;
  new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(() => { q = false; label(document); }); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
}
