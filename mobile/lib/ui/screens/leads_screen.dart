import 'package:flutter/material.dart';
import '../widgets/lead_workflow.dart';

import '../../l10n/codes.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../widgets/common.dart';
import 'dashboard_screen.dart' show pipelineStages, isOpenLead;
import 'lead_detail_screen.dart';
import 'lead_form_screen.dart';
import '../widgets/delete_lead.dart';

class LeadsScreen extends StatefulWidget {
  const LeadsScreen({super.key});
  @override
  State<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends State<LeadsScreen> {
  String? _office, _status;
  bool _mine = false;
  bool _unassigned = false;
  int? _unCount;
  String _q = '';
  late Future<List<Lead>> _f;

  @override
  void initState() {
    super.initState();
    _load();
    _ses = context.read<Session>()..lastChange.addListener(_onChange);
  }

  late final Session _ses;
  final Map<String, String?> _sel = {};
  void _onChange() {
    final c = _ses.lastChange.value;
    if (mounted && c != null && c['type'] == 'lead') { if (c['deleted'] == true) _sel.remove(c['id']); _reload(); }
  }

  @override
  void dispose() { _ses.lastChange.removeListener(_onChange); super.dispose(); }

  Future<void> _bulkDelete() async {
    final list = _sel.entries.map((e) => (id: e.key, ref: e.value)).toList();
    if (await confirmDeleteLeads(context, list)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tDel(context, '${list.length} leads deleted', '已删除 ${list.length} 条线索'))));
      setState(_sel.clear); _reload();
    }
  }

  void _load() => _f = context.read<Session>().repo.leads(office: _office, status: _status, mine: _mine);
  void _reload() => setState(_load);

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final showCustomer = s.perms.canSeeCustomerDetails;
    return Scaffold(
      appBar: _sel.isNotEmpty
          ? AppBar(
              key: const Key('bulk-bar'),
              leading: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(_sel.clear)),
              title: Text(tDel(context, '${_sel.length} selected', '已选 ${_sel.length} 条')),
              actions: [TextButton.icon(key: const Key('bulk-delete'), icon: Icon(Icons.delete_outline, color: Colors.red.shade700),
                  label: Text(tDel(context, 'Delete ${_sel.length} selected', '删除所选 ${_sel.length} 条'), style: TextStyle(color: Colors.red.shade700)),
                  onPressed: _bulkDelete)])
          : AppBar(title: Text(context.l10n.leads), actions: const [LanguageSwitch()]),
      floatingActionButton: s.perms.canCreateLead
          ? FloatingActionButton.extended(
              icon: const Icon(Icons.add),
              label: Text(context.l10n.newLead),
              onPressed: () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => const LeadFormScreen()));
                await s.refreshPending();
                _reload();
              })
          : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: TextField(
            key: const Key('lead-search'),
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: context.l10n.searchRef, isDense: true, border: const OutlineInputBorder()),
            onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(children: [
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: FilterChip(key: const Key('filter-mine'), avatar: const Icon(Icons.person_outline, size: 16), label: Text(context.l10n.assignedToMe), selected: _mine,
                  onSelected: (v) { _mine = v; _reload(); }),
            ),
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: FilterChip(key: const Key('filter-unassigned'), avatar: const Icon(Icons.person_search_outlined, size: 16),
                  label: Text(_unCount == null ? context.l10n.ownerFilterLabel : context.l10n.ownerFilter(_unCount!)), selected: _unassigned,
                  onSelected: (v) => setState(() => _unassigned = v)),
            ),
            for (final o in const ['INDIA', 'CHINA'])
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: FilterChip(label: Text(codeLabel(context, o)), selected: _office == o,
                    onSelected: (v) { _office = v ? o : null; _reload(); }),
              ),
            const VerticalDivider(),
            PopupMenuButton<String?>(
              initialValue: _status,
              onSelected: (v) { _status = v; _reload(); },
              itemBuilder: (_) => [PopupMenuItem(value: null, child: Text(context.l10n.allStatuses)),
                ...pipelineStages.map((st) => PopupMenuItem(value: st, child: Text(codeLabel(context, st))))],
              child: Chip(avatar: const Icon(Icons.filter_list, size: 18), label: Text(_status == null ? context.l10n.status : codeLabel(context, _status))),
            ),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async => _reload(),
            child: AsyncView<List<Lead>>(
              future: _f,
              onRetry: _reload,
              builder: (c, all) {
                final un = all.where((l) => l.unassignedIndia).length;
                if (un != _unCount) WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) setState(() => _unCount = un); });
                final leads = all.where((l) => (!_unassigned || l.unassignedIndia) && (_status != null || isOpenLead(l)) && (_q.isEmpty || [l.leadRef, if (showCustomer) l.clientName, l.productInterest, l.name]
                    .whereType<String>().any((v) => v.toLowerCase().contains(_q)))).toList();
                return leads.isEmpty
                  ? ListView(children: [SizedBox(height: 120), Center(child: Text(context.l10n.noLeads))])
                  : ListView.separated(
                      itemCount: leads.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (c, i) {
                        final l = leads[i];
                        final picked = _sel.containsKey(l.id);
                        return ListTile(
                          selected: picked,
                          onLongPress: s.perms.canBulkDeleteLeads && !l.pendingSync
                              ? () => setState(() => picked ? _sel.remove(l.id) : _sel[l.id] = l.leadRef) : null,
                          leading: picked ? const CircleAvatar(child: Icon(Icons.check)) : CircleAvatar(child: Text((showCustomer ? (l.clientName ?? l.name) : (l.productInterest ?? '?')).characters.first.toUpperCase())),
                          title: Text(showCustomer ? (l.clientName ?? l.name) : (l.productInterest ?? l.name)),
                          subtitle: Text([
                            l.leadRef,
                            if (showCustomer) l.productInterest,
                            if (l.quantity != null) 'Qty ${l.quantity!.toStringAsFixed(0)}',
                            if (l.pendingSync) 'not synced',
                          ].whereType<String>().join(' · ')),
                          trailing: l.unassignedIndia ? Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [StatusChip(l.status), const SizedBox(height: 2), const UnassignedBadge()]) : StatusChip(l.status),
                          onTap: l.pendingSync
                              ? null
                              : _sel.isNotEmpty ? () => setState(() => picked ? _sel.remove(l.id) : _sel[l.id] = l.leadRef) : () async {
                                  await Navigator.push(c, MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: l.id)));
                                  _reload();
                                },
                        );
                      });
              },
            ),
          ),
        ),
      ]),
    );
  }
}
