import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../l10n/l10n.dart';
import '../../services/session.dart';
import 'lead_detail_screen.dart';

String _inr(dynamic n) => n == null ? '—' : '₹${(n as num).round()}';
String _date(dynamic s) => s == null ? '—' : '$s'.split('T').first;

/// India-side customer directory (customers.view). China never sees it; the server enforces the same.
class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});
  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  late Future<List<Map<String, dynamic>>> _f = context.read<Session>().repo.customers();
  String _q = '';
  void _reload() => setState(() => _f = context.read<Session>().repo.customers());

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, edit = context.read<Session>().perms.canEditCustomers;
    return Scaffold(
      appBar: AppBar(title: Text(l.customers)),
      floatingActionButton: edit ? FloatingActionButton(key: const Key('customer-add'), onPressed: () async {
        if (await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const CustomerFormScreen())) == true) _reload();
      }, child: const Icon(Icons.add)) : null,
      body: FutureBuilder<List<Map<String, dynamic>>>(future: _f, builder: (c, s) {
        if (s.hasError) return Center(child: Text('${s.error}'));
        if (!s.hasData) return const Center(child: CircularProgressIndicator());
        final q = _q.toLowerCase();
        final rows = s.data!.where((x) => q.isEmpty || ['name', 'company', 'phone', 'email', 'city'].any((k) => '${x[k] ?? ''}'.toLowerCase().contains(q))).toList();
        return RefreshIndicator(onRefresh: () async => _reload(), child: ListView(children: [
          Padding(padding: const EdgeInsets.all(12), child: TextField(decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.search, border: const OutlineInputBorder(), isDense: true), onChanged: (v) => setState(() => _q = v))),
          if (rows.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(l.custNone))),
          ...rows.map((x) => ListTile(
            leading: CircleAvatar(child: Text('${x['name'] ?? '?'}'.characters.first.toUpperCase())),
            title: Text('${x['name']}'),
            subtitle: Text([if (x['company'] != null && x['company'] != x['name']) x['company'], x['phone'], x['city'], l.custStats(x['leads'] as int? ?? 0, x['quotes'] as int? ?? 0, x['orders'] as int? ?? 0)].whereType<Object>().join(' · ')),
            trailing: (x['paymentPending'] as int? ?? 0) > 0 ? Chip(label: Text(l.custPending(x['paymentPending'] as int)), backgroundColor: Colors.amber.shade100, visualDensity: VisualDensity.compact) : null,
            onTap: () async { await Navigator.push(context, MaterialPageRoute(builder: (_) => CustomerDetailScreen(id: x['id'] as String))); _reload(); },
          )),
        ]));
      }),
    );
  }
}

class CustomerDetailScreen extends StatefulWidget {
  const CustomerDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends State<CustomerDetailScreen> {
  late Future<Map<String, dynamic>> _f = context.read<Session>().repo.customer(widget.id);
  @override
  Widget build(BuildContext context) {
    final l = context.l10n, edit = context.read<Session>().perms.canEditCustomers;
    return FutureBuilder<Map<String, dynamic>>(future: _f, builder: (c, s) {
      final d = s.data;
      List<Map<String, dynamic>> rows(String k) => ((d?[k] as List?) ?? []).cast<Map<String, dynamic>>();
      Widget sec(String title, List<Map<String, dynamic>> r, String Function(Map<String, dynamic>) line, String Function(Map<String, dynamic>) sub) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text('$title (${r.length})', style: Theme.of(c).textTheme.titleSmall)),
        if (r.isEmpty) const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Text('—')),
        ...r.map((x) => ListTile(dense: true, title: Text(line(x)), subtitle: Text(sub(x)), trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: (x['leadId'] ?? x['id']) as String))))),
      ]);
      return Scaffold(
        appBar: AppBar(title: Text('${d?['name'] ?? ''}'), actions: [
          if (edit && d != null) IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () async {
            if (await Navigator.push<bool>(c, MaterialPageRoute(builder: (_) => CustomerFormScreen(initial: d))) == true) setState(() => _f = context.read<Session>().repo.customer(widget.id));
          }),
        ]),
        body: s.hasError ? Center(child: Text('${s.error}')) : d == null ? const Center(child: CircularProgressIndicator()) : ListView(key: const Key('customer-detail'), children: [
          for (final k in ['company', 'phone', 'whatsapp', 'email', 'city', 'state', 'country', 'gst', 'address', 'notes'])
            if (d[k] != null && '${d[k]}'.isNotEmpty) ListTile(dense: true, title: Text('${d[k]}'), subtitle: Text(_label(l, k))),
          if ((d['tags'] as List?)?.isNotEmpty ?? false) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Wrap(spacing: 6, children: [for (final t in d['tags'] as List) Chip(label: Text('$t'))])),
          Padding(padding: const EdgeInsets.all(16), child: Row(children: [
            for (final (k, v) in [(l.custTotal, d['orderTotal']), (l.custPaid, d['paid']), (l.custDue, d['due'])])
              Expanded(child: Card(child: Padding(padding: const EdgeInsets.all(8), child: Column(children: [Text(k, style: Theme.of(c).textTheme.bodySmall), Text(_inr(v), style: const TextStyle(fontWeight: FontWeight.w600))])))),
          ])),
          sec(l.leads, rows('leads'), (x) => '${x['leadRef'] ?? '—'} · ${x['product'] ?? '—'}', (x) => '${x['status']} · ${_date(x['createdAt'])}${x['ownerName'] != null ? ' · ${x['ownerName']}' : ''}'),
          sec(l.quotesTab, rows('quotes'), (x) => '${x['leadRef']} · ${x['product']}', (x) => '${x['status']}${x['total'] != null ? ' · ${_inr(x['total'])}' : ''}'),
          sec(l.ordersTab, rows('orders'), (x) => '${x['leadRef']} · ${x['product']}', (x) => '${x['qty']} · ${x['paymentStatus']}${x['total'] != null ? ' · ${_inr(x['total'])}' : ''}'),
          sec(l.shipping, rows('shipments'), (x) => '${x['ref']} · ${x['leadRef']}', (x) => '${x['status']}${x['eta'] != null ? ' · ETA ${x['eta']}' : ''}'),
          const SizedBox(height: 24),
        ]),
      );
    });
  }
}

String _label(AppLocalizations l, String k) => switch (k) {
      'company' => l.custCompany, 'phone' => l.phone, 'whatsapp' => 'WhatsApp', 'email' => l.email, 'city' => l.custCity, 'state' => l.custState,
      'country' => l.custCountry, 'gst' => l.custGst, 'address' => l.custAddress, 'notes' => l.custNotes, 'tags' => l.custTags, _ => l.custName,
    };

class CustomerFormScreen extends StatefulWidget {
  const CustomerFormScreen({super.key, this.initial});
  final Map<String, dynamic>? initial;
  @override
  State<CustomerFormScreen> createState() => _CustomerFormScreenState();
}

class _CustomerFormScreenState extends State<CustomerFormScreen> {
  static const _keys = ['name', 'company', 'phone', 'whatsapp', 'email', 'city', 'state', 'country', 'gst', 'tags', 'address', 'notes'];
  late final Map<String, TextEditingController> _c = {
    for (final k in _keys) k: TextEditingController(text: k == 'tags' ? ((widget.initial?['tags'] as List?) ?? []).join(', ') : '${widget.initial?[k] ?? (k == 'country' && widget.initial == null ? 'India' : '')}'),
  };
  bool _busy = false;
  String? _err;
  Future<void> _save() async {
    final l = context.l10n;
    if (_c['name']!.text.trim().isEmpty && _c['company']!.text.trim().isEmpty) return setState(() => _err = l.custNameRequired);
    setState(() { _busy = true; _err = null; });
    final b = <String, dynamic>{for (final k in _keys) k: k == 'tags' ? _c[k]!.text.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList() : (_c[k]!.text.trim().isEmpty ? null : _c[k]!.text.trim())};
    b['name'] ??= b['company'];
    try { await context.read<Session>().repo.saveCustomer(b, widget.initial?['id'] as String?); if (mounted) Navigator.pop(context, true); }
    catch (e) { if (mounted) setState(() { _busy = false; _err = '$e'; }); }
  }
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(widget.initial == null ? l.custAdd : l.custEdit), actions: [TextButton(key: const Key('customer-save'), onPressed: _busy ? null : _save, child: Text(l.save))]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        for (final k in _keys) Padding(padding: const EdgeInsets.only(bottom: 12), child: TextField(controller: _c[k], maxLines: k == 'address' || k == 'notes' ? 3 : 1,
            keyboardType: k == 'phone' || k == 'whatsapp' ? TextInputType.phone : k == 'email' ? TextInputType.emailAddress : null,
            decoration: InputDecoration(labelText: _label(l, k), border: const OutlineInputBorder(), isDense: true))),
        if (_err != null) Text(_err!, style: const TextStyle(color: Colors.red)),
      ]),
    );
  }
}
