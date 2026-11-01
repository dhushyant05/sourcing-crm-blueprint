import 'package:flutter/material.dart';

import '../../l10n/codes.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../core/currency.dart';
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
        title: Text(context.l10n.assignToChinaAgent),
        content: TextField(controller: c, decoration: InputDecoration(labelText: context.l10n.agentName)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: Text(context.l10n.cancel)),
          FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: Text(context.l10n.assign)),
        ],
      ),
    );
    if (agent == null || agent.isEmpty || !mounted) return;
    final r = await context.read<Session>().repo.assignToChina(l.id, agent);
    if (mounted) showWriteResult(context, r, context.l10n.assignment);
    _reload();
  }

  Future<void> _close(Lead l, bool won) async {
    final c = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(won ? context.l10n.closeAsWon : context.l10n.closeAsLost),
        content: TextField(controller: c, decoration: InputDecoration(labelText: context.l10n.winLossReason)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: Text(context.l10n.cancel)),
          FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: Text(context.l10n.closeLead)),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    final r = await context.read<Session>().repo.updateLead(l.id, {'status': won ? 'WON' : 'LOST', 'winLossReason': reason});
    if (mounted) showWriteResult(context, r, context.l10n.lead);
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final p = s.perms;
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.lead)),
      body: AsyncView<_Detail>(
        future: _f,
        onRetry: _reload,
        builder: (c, d) {
          final l = d.lead;
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView(padding: const EdgeInsets.all(16), children: [
              Row(children: [
                Expanded(child: Text(p.canSeeCustomerDetails ? (l.clientName ?? l.name) : (l.productInterest ?? context.l10n.lead),
                    style: t.textTheme.headlineSmall)),
                StatusChip(l.status),
              ]),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(children: [
                    if (p.canSeeCustomerDetails) ...[
                      InfoRow(context.l10n.contact, l.contactPhone),
                      InfoRow(context.l10n.email, l.contactEmail),
                      InfoRow(context.l10n.source, codeLabel(context, l.sourceChannel)),
                    ],
                    InfoRow(context.l10n.product, l.productInterest),
                    InfoRow(context.l10n.quantity, l.quantity?.toStringAsFixed(0)),
                    if (p.canSeeClientPricing && l.targetPrice != null)
                      InfoRow(context.l10n.targetPrice, formatMoneyCode(l.targetPrice!, l.targetCurrency ?? 'INR')),
                    InfoRow(context.l10n.office, codeLabel(context, l.assignedOffice)),
                    InfoRow(context.l10n.chinaAgent, l.assignedChinaAgent),
                    if (l.winLossReason != null) InfoRow(context.l10n.winLossReason, l.winLossReason),
                  ]),
                ),
              ),
              Wrap(spacing: 8, runSpacing: 8, children: [
                if (p.canCreateLead && l.status == 'NEW')
                  FilledButton.tonalIcon(onPressed: () => _assign(l), icon: Icon(Icons.forward), label: Text(context.l10n.assignToChina)),
                if (p.canCreateSourcingRequest)
                  FilledButton.tonalIcon(
                    icon: const Icon(Icons.add_task),
                    label: Text(context.l10n.sourcingRequest),
                    onPressed: () async {
                      await Navigator.push(c, MaterialPageRoute(builder: (_) => SourcingFormScreen(lead: l)));
                      _reload();
                    },
                  ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.local_shipping_outlined),
                  label: Text(context.l10n.shipping),
                  onPressed: () => Navigator.push(c, MaterialPageRoute(builder: (_) => ShippingScreen(leadId: l.id))),
                ),
                if (p.canCreateLead && !['WON', 'LOST'].contains(l.status)) ...[
                  OutlinedButton(onPressed: () => _close(l, true), child: Text(context.l10n.closeWon)),
                  OutlinedButton(onPressed: () => _close(l, false), child: Text(context.l10n.closeLost)),
                ],
              ]),
              const SizedBox(height: 20),
              Text(context.l10n.sourcingRequests, style: t.textTheme.titleMedium),
              if (d.requests.isEmpty) Padding(padding: EdgeInsets.all(8), child: Text(context.l10n.noneYet)),
              ...d.requests.map((r) => Card(
                    child: ListTile(
                      title: Text(r.productDescription ?? r.name),
                      subtitle: Text(context.l10n.samplesStatus(codeLabel(context, r.sampleStatus)) +
                          (r.deadline != null ? ' · ${context.l10n.deadlineOn(dateFmt.format(r.deadline!))}' : '')),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        IconButton(
                          tooltip: context.l10n.chatThread,
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
              Text(context.l10n.timeline, style: t.textTheme.titleMedium),
              ...d.timeline.map((e) => ListTile(
                    dense: true,
                    leading: Icon(switch (e.kind) {
                      'lead' => Icons.person_add_alt,
                      'sourcing' => Icons.search,
                      'quote' => Icons.receipt_long,
                      'approval' => Icons.thumb_up_alt_outlined,
                      _ => Icons.local_shipping_outlined,
                    }),
                    title: Text(_tlTitle(context, e)),
                    subtitle: Text('${dateFmt.format(e.at.toLocal())}  ${e.kind == 'lead' ? context.l10n.tlOffice(codeLabel(context, e.code)) : e.subtitle}'),
                  )),
            ]),
          );
        },
      ),
    );
  }
}

String _tlTitle(BuildContext context, TimelineEvent e) {
  final l = context.l10n;
  return switch (e.kind) {
    'lead' => l.tlLeadCreated,
    'sourcing' => l.sourcingRequest,
    'quote' => l.quotation,
    'approval' => '${l.client} · ${codeLabel(context, e.code)}',
    'shipping' => '${l.shipping} · ${codeLabel(context, e.code)}',
    _ => e.title,
  };
}
