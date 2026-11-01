import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:intl/intl.dart';

import '../../data/api/server_client.dart';
import '../../data/repository.dart';

final dateFmt = DateFormat('dd MMM yyyy');

String pretty(String? code) =>
    code == null ? '—' : code.split('_').map((w) => w.isEmpty ? w : w[0] + w.substring(1).toLowerCase()).join(' ');

Color statusColor(BuildContext c, String status) {
  final cs = Theme.of(c).colorScheme;
  return switch (status) {
    'WON' || 'DELIVERED' || 'APPROVED' || 'CLEARED' => Colors.green,
    'LOST' || 'REJECTED' || 'HELD' => cs.error,
    'NEW' || 'PENDING' => cs.tertiary,
    _ => cs.primary,
  };
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) {
    final col = statusColor(context, status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: col.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)),
      child: Text(pretty(status), style: TextStyle(color: col, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

/// FutureBuilder with loading / error / retry handling.
class AsyncView<T> extends StatelessWidget {
  const AsyncView({super.key, required this.future, required this.builder, this.onRetry});
  final Future<T> future;
  final Widget Function(BuildContext, T) builder;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
        future: future,
        builder: (c, s) {
          if (s.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (s.hasError) {
            final offline = s.error is OfflineException;
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(offline ? Icons.cloud_off : Icons.error_outline, size: 40),
                  const SizedBox(height: 8),
                  Text(offline ? context.l10n.offlineAndNothingCachedYet : '${s.error}', textAlign: TextAlign.center),
                  if (onRetry != null) TextButton(onPressed: onRetry, child: Text(context.l10n.retry)),
                ]),
              ),
            );
          }
          return builder(c, s.data as T);
        },
      );
}

void showWriteResult(BuildContext context, WriteResult r, String what) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(r.queued ? '$what saved offline — will sync when online' : '$what saved')));
}

class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key});
  final String label;
  final String? value;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 130, child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(child: Text(value == null || value!.isEmpty ? '—' : value!)),
        ]),
      );
}
