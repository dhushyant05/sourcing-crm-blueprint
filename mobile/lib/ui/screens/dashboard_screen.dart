import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../widgets/common.dart';

const pipelineStages = ['NEW', 'ASSIGNED', 'SOURCING', 'QUOTED', 'APPROVED', 'SHIPPING', 'DELIVERED', 'WON', 'LOST'];

Map<String, int> pipelineCounts(List<Lead> leads) {
  final m = {for (final s in pipelineStages) s: 0};
  for (final l in leads) {
    m[l.status] = (m[l.status] ?? 0) + 1;
  }
  return m;
}

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});
  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late Future<List<Lead>> _f;
  @override
  void initState() {
    super.initState();
    _f = context.read<Session>().repo.leads();
  }

  void _reload() => setState(() => _f = context.read<Session>().repo.leads());

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.dashboard), actions: const [LanguageSwitch()]),
      body: RefreshIndicator(
        onRefresh: () async => _reload(),
        child: AsyncView<List<Lead>>(
          future: _f,
          onRetry: _reload,
          builder: (c, leads) {
            final counts = pipelineCounts(leads);
            final active = leads.where((l) => !['WON', 'LOST', 'DELIVERED'].contains(l.status)).length;
            return ListView(padding: const EdgeInsets.all(16), children: [
              Text(context.l10n.helloName(s.displayName ?? ''), style: t.textTheme.titleLarge),
              Text(s.role.label, style: t.textTheme.bodyMedium),
              const SizedBox(height: 16),
              Row(children: [
                _Kpi('Active leads', '$active', Icons.trending_up),
                _Kpi('Won', '${counts['WON']}', Icons.emoji_events_outlined),
                _Kpi('Pending sync', '${s.pendingOps}', Icons.sync),
              ]),
              const SizedBox(height: 24),
              Text(context.l10n.pipeline, style: t.textTheme.titleMedium),
              const SizedBox(height: 8),
              ...pipelineStages.map((st) {
                final n = counts[st]!;
                final frac = leads.isEmpty ? 0.0 : n / leads.length;
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(children: [
                    SizedBox(width: 90, child: Text(pretty(st))),
                    Expanded(child: LinearProgressIndicator(value: frac, minHeight: 10,
                        borderRadius: BorderRadius.circular(5), color: statusColor(context, st))),
                    SizedBox(width: 36, child: Text('$n', textAlign: TextAlign.end)),
                  ]),
                );
              }),
            ]);
          },
        ),
      ),
    );
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi(this.label, this.value, this.icon);
  final String label, value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(icon, color: Theme.of(context).colorScheme.primary),
              const SizedBox(height: 8),
              Text(value, style: Theme.of(context).textTheme.headlineSmall),
              Text(label, style: Theme.of(context).textTheme.bodySmall),
            ]),
          ),
        ),
      );
}
