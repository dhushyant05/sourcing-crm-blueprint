import 'package:flutter/material.dart';

import 'api.dart';
import 'format.dart';
import 'widgets.dart';

/// Customer-visible progress tracker (English only). Uses the server `workflow` allowlist.
class WorkflowTracker extends StatelessWidget {
  const WorkflowTracker(this.flow, {super.key, this.compact = false});
  final Json? flow;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final steps = (flow?['steps'] as List?)?.cast<Json>() ?? const [];
    if (steps.isEmpty) return const SizedBox.shrink();
    final outcome = flow?['outcome'] as String?;
    final label = outcome == 'cancelled' ? 'Cancelled' : outcome == 'rejected' ? 'Declined' : null;
    if (compact) {
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (label != null) Padding(padding: const EdgeInsets.only(bottom: 6), child: Pill(label, color: Colors.red)),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final s in steps)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                color: s['state'] == 'done' ? brand.withValues(alpha: .15) : s['state'] == 'current' ? brand : Colors.black.withValues(alpha: .04),
              ),
              child: Text('${s['label']}', style: TextStyle(fontSize: 12, color: s['state'] == 'current' ? Colors.white : s['state'] == 'done' ? brand : Colors.black38)),
            ),
        ]),
      ]);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (label != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Pill(label, color: Colors.red)),
      for (var i = 0; i < steps.length; i++)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Column(children: [
            Container(
              width: 24, height: 24, alignment: Alignment.center,
              decoration: BoxDecoration(shape: BoxShape.circle, color: steps[i]['state'] == 'upcoming' ? Colors.black12 : brand),
              child: Text(steps[i]['state'] == 'done' ? '✓' : '${i + 1}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
            ),
            if (i < steps.length - 1) Container(width: 2, height: 28, color: steps[i]['state'] == 'done' ? brand : Colors.black12),
          ]),
          const SizedBox(width: 10),
          Expanded(child: Padding(padding: const EdgeInsets.only(top: 2, bottom: 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${steps[i]['label']}', style: TextStyle(fontWeight: FontWeight.w600, color: steps[i]['state'] == 'upcoming' ? Colors.black38 : Colors.black87)),
            if (steps[i]['at'] != null && steps[i]['state'] == 'done') Text(day(steps[i]['at']), style: const TextStyle(fontSize: 12, color: Colors.black54)),
            if (steps[i]['state'] == 'current' && label == null) const Text('Current', style: TextStyle(fontSize: 12, color: brand)),
          ]))),
        ]),
    ]);
  }
}
