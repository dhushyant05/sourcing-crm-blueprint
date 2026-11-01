import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../widgets/common.dart';
import 'dashboard_screen.dart' show pipelineStages;
import 'lead_detail_screen.dart';
import 'lead_form_screen.dart';

class LeadsScreen extends StatefulWidget {
  const LeadsScreen({super.key});
  @override
  State<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends State<LeadsScreen> {
  String? _office, _status;
  late Future<List<Lead>> _f;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() => _f = context.read<Session>().repo.leads(office: _office, status: _status);
  void _reload() => setState(_load);

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final showCustomer = s.perms.canSeeCustomerDetails;
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.leads), actions: const [LanguageSwitch()]),
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
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(children: [
            for (final o in const ['INDIA', 'CHINA'])
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: FilterChip(label: Text(pretty(o)), selected: _office == o,
                    onSelected: (v) { _office = v ? o : null; _reload(); }),
              ),
            const VerticalDivider(),
            PopupMenuButton<String?>(
              initialValue: _status,
              onSelected: (v) { _status = v; _reload(); },
              itemBuilder: (_) => [PopupMenuItem(value: null, child: Text(context.l10n.allStatuses)),
                ...pipelineStages.map((st) => PopupMenuItem(value: st, child: Text(pretty(st))))],
              child: Chip(avatar: const Icon(Icons.filter_list, size: 18), label: Text(_status == null ? context.l10n.status : pretty(_status))),
            ),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async => _reload(),
            child: AsyncView<List<Lead>>(
              future: _f,
              onRetry: _reload,
              builder: (c, leads) => leads.isEmpty
                  ? ListView(children: [SizedBox(height: 120), Center(child: Text(context.l10n.noLeads))])
                  : ListView.separated(
                      itemCount: leads.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (c, i) {
                        final l = leads[i];
                        return ListTile(
                          leading: CircleAvatar(child: Text((showCustomer ? (l.clientName ?? l.name) : (l.productInterest ?? '?')).characters.first.toUpperCase())),
                          title: Text(showCustomer ? (l.clientName ?? l.name) : (l.productInterest ?? l.name)),
                          subtitle: Text([
                            if (showCustomer) l.productInterest,
                            if (l.quantity != null) 'Qty ${l.quantity!.toStringAsFixed(0)}',
                            if (l.pendingSync) 'not synced',
                          ].whereType<String>().join(' · ')),
                          trailing: StatusChip(l.status),
                          onTap: l.pendingSync
                              ? null
                              : () async {
                                  await Navigator.push(c, MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: l.id)));
                                  _reload();
                                },
                        );
                      }),
            ),
          ),
        ),
      ]),
    );
  }
}
