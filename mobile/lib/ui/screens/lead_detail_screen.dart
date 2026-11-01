import 'package:flutter/material.dart';

import '../../l10n/codes.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../core/currency.dart';
import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/common.dart';
import '../widgets/lead_attachments.dart';
import '../widgets/lead_quotes.dart';
import '../widgets/lead_workflow.dart';
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
    return _Detail(lead, await repo.sourcingRequests(leadId: lead.id), const []);
  }

  void _reload() => setState(() => _f = _load());

  /// Hand [l] to [office]: pick a member, the office queue, or (China→India) the raiser by default.
  Future<void> _assign(Lead l, String office) async {
    final repo = context.read<Session>().repo;
    final returning = office == 'INDIA' && l.owner == 'CHINA';
    List<StaffLite> staff;
    try { staff = await repo.staff(office); } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); return; }
    if (!mounted) return;
    const def = '__default__';
    String pick = returning ? def : '';
    final officeName = codeLabel(context, office);
    final chosen = await showDialog<String>(
      context: context,
      builder: (d) => StatefulBuilder(builder: (d, set) => AlertDialog(
        title: Text(office != l.owner ? (office == 'CHINA' ? context.l10n.sendToChina : context.l10n.returnToIndia) : context.l10n.reassign),
        content: DropdownButtonFormField<String>(
          key: const Key('assign-picker'),
          initialValue: pick, isExpanded: true,
          decoration: InputDecoration(labelText: '${context.l10n.teamMember} · $officeName'),
          items: [
            if (returning) DropdownMenuItem(value: def, child: Text(l.raisedByName != null ? context.l10n.raiserDefault(l.raisedByName!) : context.l10n.officeQueue(officeName))),
            DropdownMenuItem(value: '', child: Text(context.l10n.officeQueue(officeName))),
            for (final m in staff) DropdownMenuItem(value: m.id, child: Text(m.name)),
          ],
          onChanged: (v) => set(() => pick = v ?? ''),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: Text(context.l10n.cancel)),
          FilledButton(key: const Key('assign-confirm'), onPressed: () => Navigator.pop(d, pick), child: Text(context.l10n.assign)),
        ],
      )),
    );
    if (chosen == null || !mounted) return;
    try {
      final r = await repo.assignLead(l.id, office, assignedTo: chosen.isEmpty || chosen == def ? null : chosen, useDefault: chosen == def);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.l10n.handedTo(r.assignedToName ?? context.l10n.officeQueue(officeName)))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
    _reload();
  }

  Future<void> _editSummary(Lead l) async {
    final c = TextEditingController(text: l.summary);
    final v = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(context.l10n.editSummary),
        content: TextField(controller: c, minLines: 3, maxLines: 8, decoration: InputDecoration(hintText: context.l10n.summaryHint)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: Text(context.l10n.cancel)),
          FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: Text(context.l10n.save)),
        ],
      ),
    );
    if (v == null || !mounted) return;
    final r = await context.read<Session>().repo.updateLead(l.id, {'summary': v});
    if (mounted) showWriteResult(context, r, context.l10n.summary);
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
              if (l.leadRef != null || l.priority || l.sla != null) Padding(padding: const EdgeInsets.only(top: 6), child: Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                if (l.leadRef != null) RefTag(l.leadRef!), if (l.priority) const PriorityBadge(), if (l.sla != null) SlaChip(l.sla!)])),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(children: [
                    if (p.canSeeCustomerDetails) ...[
                      if (l.contactName != null) InfoRow(context.l10n.contactPerson, l.contactName),
                      InfoRow(context.l10n.contact, l.contactPhone),
                      InfoRow(context.l10n.email, l.contactEmail),
                      InfoRow(context.l10n.source, codeLabel(context, l.sourceChannel)),
                      if (l.deliveryCity != null) InfoRow(context.l10n.deliveryCity, l.deliveryCity),
                    ],
                    InfoRow(context.l10n.leadRef, l.leadRef ?? '—'),
                    InfoRow(context.l10n.product, l.productInterest),
                    InfoRow(context.l10n.quantity, l.quantity == null ? null : '${l.quantity!.toStringAsFixed(0)} ${l.unit ?? ''}'.trim()),
                    if (l.referenceUrl != null) InfoRow(context.l10n.referenceLink, l.referenceUrl),
                    if (p.canSeeClientPricing && l.targetPrice != null)
                      InfoRow(context.l10n.targetPrice, formatMoneyCode(l.targetPrice!, l.targetCurrency ?? 'INR')),
                    InfoRow(context.l10n.office, codeLabel(context, l.assignedOffice)),
                    InfoRow(context.l10n.raisedBy, l.raisedByName ?? '—'),
                    InfoRow(context.l10n.assignedTo, l.assignedToName ?? context.l10n.officeQueue(codeLabel(context, l.owner))),
                    if (l.assignedChinaAgent != null) InfoRow(context.l10n.chinaAgent, l.assignedChinaAgent),
                    if (l.winLossReason != null) InfoRow(context.l10n.winLossReason, l.winLossReason),
                  ]),
                ),
              ),
              if (p.canSeeCustomerDetails && l.enquiryMessage != null)
                Card(child: ListTile(title: Text(context.l10n.enquiryMessage), subtitle: Text(l.enquiryMessage!))),
              Card(
                child: ListTile(
                  key: const Key('lead-summary'),
                  title: Text(context.l10n.summary),
                  subtitle: Text((l.summary ?? '').isEmpty ? context.l10n.noSummary : l.summary!),
                  trailing: p.canCreateLead
                      ? IconButton(tooltip: context.l10n.editSummary, icon: const Icon(Icons.edit_outlined), onPressed: () => _editSummary(l))
                      : null,
                ),
              ),
              const SizedBox(height: 8),
              LeadAttachments(leadId: l.id, canEdit: p.canCreateLead),
              const SizedBox(height: 12),
              LeadQuotesSection(key: ValueKey('quotes-${l.id}'), leadId: l.id, lead: l),
              const SizedBox(height: 12),
              RejectionCard(key: ValueKey('rej-${l.id}-${l.status}'), lead: l, onLead: (_) => _reload()),
              LostActions(key: ValueKey('lost-${l.id}-${l.status}'), lead: l, onLead: (_) => _reload(),
                  openLead: (n) => Navigator.pushReplacement(c, MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: n.id)))),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                if (p.canSeeCustomerDetails && l.owner != 'CHINA' && !['WON', 'LOST'].contains(l.status))
                  FilledButton.tonalIcon(key: const Key('send-china'), onPressed: () => _assign(l, 'CHINA'), icon: const Icon(Icons.forward), label: Text(context.l10n.sendToChina)),
                if (!p.canSeeCustomerDetails && l.owner == 'CHINA' && l.assignedOffice == 'CHINA')
                  FilledButton.tonalIcon(key: const Key('return-india'), onPressed: () => _assign(l, 'INDIA'), icon: const Icon(Icons.reply), label: Text(context.l10n.returnToIndia)),
                if (s.role.isAdmin && (s.role.office == null || s.role.office!.name.toUpperCase() == l.owner))
                  OutlinedButton.icon(key: const Key('reassign'), onPressed: () => _assign(l, l.owner), icon: const Icon(Icons.swap_horiz), label: Text(context.l10n.reassign)),
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
                      title: Text([r.leadRef, r.productDescription ?? r.name].whereType<String>().join(' · ')),
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
              LeadWorkflow(key: ValueKey('wf-${l.id}-${l.status}-${l.assignedTo}-${l.owner}'), lead: l),
            ]),
          );
        },
      ),
    );
  }
}
