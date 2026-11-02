import 'package:flutter/material.dart';

/// Two-or-more equal-width tabs that never overflow: labels shrink to fit
/// (EN and 中文) and stay centred, with the count shown as a pill.
class SegTabs<T> extends StatelessWidget {
  const SegTabs({super.key, required this.items, required this.value, required this.onChanged});
  final List<(T, String, int?)> items;
  final T value;
  final ValueChanged<T> onChanged;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        for (final (v, label, n) in items)
          Expanded(child: GestureDetector(
            onTap: () => onChanged(v),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              height: 40,
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                color: v == value ? cs.surface : Colors.transparent,
                borderRadius: BorderRadius.circular(10),
                boxShadow: v == value ? [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 4, offset: const Offset(0, 1))] : null,
              ),
              child: FittedBox(fit: BoxFit.scaleDown, child: Row(mainAxisSize: MainAxisSize.min, children: [
                Text(label, maxLines: 1, style: TextStyle(fontWeight: FontWeight.w600, color: v == value ? cs.primary : cs.onSurfaceVariant)),
                if (n != null) ...[
                  const SizedBox(width: 6),
                  Container(padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                      decoration: BoxDecoration(color: v == value ? cs.primary : cs.outlineVariant, borderRadius: BorderRadius.circular(999)),
                      child: Text('$n', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: v == value ? cs.onPrimary : cs.onSurface))),
                ],
              ])),
            ),
          )),
      ]),
    );
  }
}
