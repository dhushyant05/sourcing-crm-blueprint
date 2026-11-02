import 'package:flutter/material.dart';

import '../../l10n/codes.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../widgets/common.dart';
import '../widgets/delete_lead.dart' show tDel;
import 'lead_detail_screen.dart';

const pipelineStages = ['NEW', 'ASSIGNED', 'SOURCING', 'QUOTED', 'APPROVED', 'SHIPPING', 'DELIVERED', 'WON', 'COMPLETED', 'LOST'];
/// Closed = delivered/completed, lost or closed permanently: never counted as open.
const closedStatuses = ['COMPLETED', 'LOST', 'CLOSED', 'DELIVERED'];
bool isOpenLead(Lead l) => !closedStatuses.contains(l.status);

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
    _ses = context.read<Session>()..lastChange.addListener(_onChange);
  }

  late final Session _ses;
  void _onChange() { final c = _ses.lastChange.value; if (mounted && c != null && c['type'] == 'lead') _reload(); }
  @override
  void dispose() { _ses.lastChange.removeListener(_onChange); super.dispose(); }

  void _showList(String title, List<Lead> list) {
    showModalBottomSheet(context: context, isScrollControlled: true, builder: (c) => SafeArea(
      child: ConstrainedBox(constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.7),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(key: const Key('dash-list'), title: Text('$title (${list.length})', style: Theme.of(c).textTheme.titleMedium)),
          if (list.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Text(tDel(c, 'No leads', '暂无线索'))),
          Flexible(child: ListView(shrinkWrap: true, children: [
            for (final l in list) ListTile(key: Key('dash-item-${l.id}'),
              title: Text(l.leadRef ?? l.name), subtitle: Text(l.productInterest ?? l.name, maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: Text(codeLabel(c, l.status)),
              onTap: () { Navigator.pop(c); Navigator.push(context, MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: l.id))); }),
          ])),
        ]))));
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
            final active = leads.where(isOpenLead).length;
            final done = leads.where((l) => l.status == 'COMPLETED' || l.status == 'DELIVERED').toList();
            return ListView(padding: const EdgeInsets.all(16), children: [
              Text(context.l10n.helloName(s.displayName ?? ''), style: t.textTheme.titleLarge),
              Text(s.role.label, style: t.textTheme.bodyMedium),
              const SizedBox(height: 16),
              Row(children: [
                _Kpi(context.l10n.kpiActiveLeads, '$active', Icons.trending_up,
                    onTap: () => _showList(context.l10n.kpiActiveLeads, leads.where(isOpenLead).toList())),
                _Kpi(codeLabel(context, 'COMPLETED'), '${done.length}', Icons.task_alt,
                    onTap: () => _showList(codeLabel(context, 'COMPLETED'), done)),
                _Kpi(context.l10n.kpiPendingSync, '${s.pendingOps}', Icons.sync),
              ]),
              const SizedBox(height: 24),
              Text(context.l10n.pipeline, style: t.textTheme.titleMedium),
              const SizedBox(height: 8),
              ...pipelineStages.where((st) => !closedStatuses.contains(st)).map((st) {
                final n = counts[st]!;
                final frac = leads.isEmpty ? 0.0 : n / leads.length;
                return InkWell(key: Key('stage-$st'), onTap: () => _showList(codeLabel(context, st), leads.where((l) => l.status == st).toList()), child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(children: [
                    SizedBox(width: 90, child: Text(codeLabel(context, st))),
                    Expanded(child: LinearProgressIndicator(value: frac, minHeight: 10,
                        borderRadius: BorderRadius.circular(5), color: statusColor(context, st))),
                    SizedBox(width: 36, child: Text('$n', textAlign: TextAlign.end)),
                  ]),
                ));
              }),
            ]);
          },
        ),
      ),
    );
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi(this.label, this.value, this.icon, {this.onTap});
  final String label, value;
  final IconData icon;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Card(clipBehavior: Clip.antiAlias,
          child: InkWell(onTap: onTap, child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(icon, color: Theme.of(context).colorScheme.primary),
              const SizedBox(height: 8),
              Text(value, style: Theme.of(context).textTheme.headlineSmall),
              Text(label, style: Theme.of(context).textTheme.bodySmall),
            ]),
          )),
        ),
      );
}
