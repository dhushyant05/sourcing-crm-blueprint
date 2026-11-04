import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../l10n/l10n.dart';
import '../../services/session.dart';
import '../widgets/lead_quotes.dart' show quoteMoney;
import '../widgets/se_codes.dart';
import 'lead_detail_screen.dart';

/// Every quote across all leads (server role-filters: China sees no customer/INR, India no supplier).
class QuotesScreen extends StatefulWidget {
  const QuotesScreen({super.key, this.initial});
  final List<LeadQuote>? initial;
  @override
  State<QuotesScreen> createState() => _QuotesScreenState();
}

class _QuotesScreenState extends State<QuotesScreen> {
  List<LeadQuote>? _list;
  String _status = '';
  bool _mine = false;
  String? _err;
  @override
  void initState() { super.initState(); if (widget.initial != null) { _list = widget.initial; } else { _load(); } }
  Future<void> _load() async {
    try { final r = await context.read<Session>().repo.allQuotes(status: _status.isEmpty ? null : _status, mine: _mine); if (mounted) setState(() { _list = r; _err = null; }); }
    catch (e) { if (mounted) setState(() { _list ??= []; _err = '$e'; }); }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, t = Theme.of(context), p = context.watch<Session>().perms;
    final list = _list;
    return Scaffold(
      appBar: AppBar(title: Text(l.qlTitle)),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
        SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
          for (final s in ['', 'DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']) Padding(padding: const EdgeInsets.only(right: 6), child: ChoiceChip(
              label: Text(s.isEmpty ? l.qlAll : seCode(l, 'qs', s)), selected: _status == s, onSelected: (_) { setState(() => _status = s); _load(); })),
          FilterChip(key: const Key('ql-mine'), label: Text(l.qlMine), selected: _mine, onSelected: (v) { setState(() => _mine = v); _load(); }),
        ])),
        if (_err != null) Text(_err!, style: TextStyle(color: t.colorScheme.error)),
        if (list == null) const LinearProgressIndicator()
        else if (list.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(l.qlNone)))
        else for (final q in list) Card(key: Key('qrow-${q.id}'), child: ListTile(
          onTap: q.leadId == null ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: q.leadId!))).then((_) => _load()),
          title: Row(children: [Expanded(child: Text('${q.leadRef ?? ''} · ${q.product}', maxLines: 1, overflow: TextOverflow.ellipsis)), QuoteStatusChip(q.status)]),
          subtitle: Text([
            quoteMoney(q.unitPrice, q.currency),
            if (p.canSeeClientPricing && q.clientPrice != null) inr(q.clientPrice),
            if (p.canSeeSupplierDetails && q.supplier != null) q.supplier!.name,
            if (q.moq != null) 'MOQ ${q.moq}', if (q.leadTime != null) q.leadTime!, if (q.validity != null) q.validity!,
            if (q.leadStatus != null) q.leadStatus!, if (q.assignedToName != null) '→ ${q.assignedToName}',
          ].join(' · ')),
        )),
      ])),
    );
  }
}
