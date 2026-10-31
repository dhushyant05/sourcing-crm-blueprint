import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/common.dart';
import 'chat_screen.dart';
import 'quotation_screen.dart';
import 'shipping_screen.dart';
import 'sourcing_form_screen.dart';

class _Detail {
  _Detail(this.lead, this.requests, this.timeline);
  final Lead lead;
  final List<SourcingRequest> requests;
  final List<TimelineEvent> timeline;
}

class LeadDetailScreen extends StatefulWidget {
  const LeadDetailScreen({super.key, required this.leadId});
  final String leadId;
  @override
  State<LeadDetailScreen> createState() => _LeadDetailScreenState();
}

class _LeadDetailScreenState extends State<LeadDetailScreen> {
  late Future<_Detail> _f;

  @override
  void initState() {
    super.initState();
    _f = _load();
  }

  Future<_Detail> _load() async {
    final repo = context.read<Session>().repo;
    final lead = await repo.lead(widget.leadId);
    if (lead == null) throw Exception('Lead not found');
    return _Detail(lead, await repo.sourcingRequests(leadId: lead.id), await repo.timeline(lead));
  }

  void _reload() => setState(() => _f = _load());

  Future<void> _assign(Lead l) async {
    final c = TextEditingController(text: l.assignedChinaAgent);
    final agent = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Assign to China agent'),
        content: TextField(controller: c, decoration: const InputDecoration(labelText: 'Agent name')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Assign')),
        ],
      ),
    );
    if (agent == null || agent.isEmpty || !mounted) return;
    final r = await context.read<Session>().repo.assignToChina(l.id, agent);
    if (mounted) showWriteResult(context, r, 'Assignment');
    _reload();
  }

  Future<void> _close(Lead l, bool won) async {
    final c = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(won ? 'Close as won' : 'Close as lost'),
        content: TextField(controller: c, decoration: const InputDecoration(labelText: 'Win/loss reason')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Close lead')),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    final r = await context.read<Session>().repo.updateLead(l.id, {'status': won ? 'WON' : 'LOST', 'winLossReason': reason});
    if (mounted) showWriteResult(context, r, 'Lead');
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final p = s.perms;
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Lead')),
      body: AsyncView<_Detail>(
        future: _f,
        onRetry: _reload,
        builder: (c, d) {
          final l = d.lead;
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView(padding: const EdgeInsets.all(16), children: [
              Row(children: [
                Expanded(child: Text(p.canSeeCustomerDetails ? (l.clientName ?? l.name) : (l.productInterest ?? 'Lead'),
                    style: t.textTheme.headlineSmall)),
                StatusChip(l.status),
              ]),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(children: [
                    if (p.canSeeCustomerDetails) ...[
                      InfoRow('Contact', l.contactPhone),
                      InfoRow('Email', l.contactEmail),
                      InfoRow('Source', pretty(l.sourceChannel)),
                    ],
                    InfoRow('Product', l.productInterest),
                    InfoRow('Quantity', l.quantity?.toStringAsFixed(0)),
                    if (p.canSeeClientPricing && l.targetPrice != null)
                      InfoRow('Target price', '${l.targetPrice!.toStringAsFixed(2)} ${l.targetCurrency ?? ''}'),
                    InfoRow('Office', pretty(l.assignedOffice)),
                    InfoRow('China agent', l.assignedChinaAgent),
                    if (l.winLossReason != null) InfoRow('Win/loss reason', l.winLossReason),
                  ]),
                ),
              ),
              Wrap(spacing: 8, runSpacing: 8, children: [
                if (p.canCreateLead && l.status == 'NEW')
                  FilledButton.tonalIcon(onPressed: () => _assign(l), icon: const Icon(Icons.forward), label: const Text('Assign to China')),
                if (p.canCreateSourcingRequest)
                  FilledButton.tonalIcon(
                    icon: const Icon(Icons.add_task),
                    label: const Text('Sourcing request'),
                    onPressed: () async {
                      await Navigator.push(c, MaterialPageRoute(builder: (_) => SourcingFormScreen(lead: l)));
                      _reload();
                    },
                  ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.local_shipping_outlined),
                  label: const Text('Shipping'),
                  onPressed: () => Navigator.push(c, MaterialPageRoute(builder: (_) => ShippingScreen(leadId: l.id))),
                ),
                if (p.canCreateLead && !['WON', 'LOST'].contains(l.status)) ...[
                  OutlinedButton(onPressed: () => _close(l, true), child: const Text('Close won')),
                  OutlinedButton(onPressed: () => _close(l, false), child: const Text('Close lost')),
                ],
              ]),
              const SizedBox(height: 20),
              Text('Sourcing requests', style: t.textTheme.titleMedium),
              if (d.requests.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('None yet')),
              ...d.requests.map((r) => Card(
                    child: ListTile(
                      title: Text(r.productDescription ?? r.name),
                      subtitle: Text('Samples: ${pretty(r.sampleStatus)}'
                          '${r.deadline != null ? ' · due ${dateFmt.format(r.deadline!)}' : ''}'),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        IconButton(
                          tooltip: 'Chat thread',
                          icon: const Icon(Icons.chat_bubble_outline),
                          onPressed: () => Navigator.push(c, MaterialPageRoute(builder: (_) => ChatScreen(request: r))),
                        ),
                        const Icon(Icons.chevron_right),
                      ]),
                      onTap: () async {
                        await Navigator.push(c, MaterialPageRoute(builder: (_) => QuotationScreen(lead: l, request: r)));
                        _reload();
                      },
                    ),
                  )),
              const SizedBox(height: 20),
              Text('Timeline', style: t.textTheme.titleMedium),
              ...d.timeline.map((e) => ListTile(
                    dense: true,
                    leading: Icon(switch (e.kind) {
                      'lead' => Icons.person_add_alt,
                      'sourcing' => Icons.search,
                      'quote' => Icons.receipt_long,
                      'approval' => Icons.thumb_up_alt_outlined,
                      _ => Icons.local_shipping_outlined,
                    }),
                    title: Text(e.title),
                    subtitle: Text('${dateFmt.format(e.at.toLocal())}  ${e.subtitle}'),
                  )),
            ]),
          );
        },
      ),
    );
  }
}
