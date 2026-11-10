import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../widgets.dart';
import '../workflow.dart';

class RequestTile extends StatelessWidget {
  const RequestTile(this.r, {super.key, required this.onTap});
  final Json r;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(child: ListTile(
        key: Key('req-${r['id']}'), onTap: onTap,
        title: Text('${r['product'] ?? 'Request'}', maxLines: 2, overflow: TextOverflow.ellipsis),
        subtitle: Text([r['reference'], if (r['quantity'] != null) '${r['quantity']} ${r['unit'] ?? ''}', when(r['createdAt'])].whereType<Object>().join(' · ')),
        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
          Pill(r['closed'] == true ? 'Closed' : stageLabel(r['stage'])),
          if ((r['quotesWaiting'] ?? 0) > 0) const Padding(padding: EdgeInsets.only(top: 4), child: Pill('Quote waiting', color: accent)),
        ]),
      ));
}

class Progress extends StatelessWidget {
  const Progress(this.r, {super.key, this.compact = false});
  final Json r;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    if (r['workflow'] is Map) return WorkflowTracker(r['workflow'] as Json, compact: compact);
    final i = (r['stageIndex'] as num?)?.toInt() ?? 0, closed = r['closed'] == true;
    return Wrap(spacing: 6, runSpacing: 6, children: [
      for (var k = 0; k < stages.length; k++)
        Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(20), color: closed ? Colors.black12 : k < i ? brand.withValues(alpha: .15) : k == i ? brand : Colors.black.withValues(alpha: .04)),
            child: Text(stages[k].$2, style: TextStyle(fontSize: 12, color: closed ? Colors.black38 : k == i ? Colors.white : k < i ? brand : Colors.black38))),
    ]);
  }
}

class RequestDetailScreen extends StatefulWidget {
  const RequestDetailScreen({super.key, required this.api, required this.id, required this.changes});
  final PortalApi api;
  final String id;
  final Stream<String> changes;
  @override
  State<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends State<RequestDetailScreen> {
  Json? _r;
  String? _err;
  List<String> _reasons = reasons.keys.toList();
  StreamSubscription<String>? _sub;
  @override
  void initState() {
    super.initState();
    _load();
    widget.api.reasons().then((r) { if (mounted && r.isNotEmpty) setState(() => _reasons = r); }).catchError((_) {});
    _sub = widget.changes.listen((id) { if (id == widget.id) _load(); });
  }

  @override
  void dispose() { _sub?.cancel(); super.dispose(); }
  Future<void> _load() async {
    try { final r = await widget.api.request(widget.id); if (mounted) setState(() { _r = r; _err = null; }); }
    on PortalError catch (e) { if (mounted) setState(() => _err = e.status == 404 ? 'This request is not available.' : e.message); }
    catch (_) { if (mounted) setState(() => _err = 'Could not reach Source Easy.'); }
  }

  @override
  Widget build(BuildContext context) {
    final r = _r;
    return Scaffold(
      appBar: AppBar(title: Text(r?['reference'] as String? ?? 'Request')),
      body: r == null ? (_err != null ? ErrorRetry(_err!, _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [
              Text('${r['product']}', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Progress(r),
              const SizedBox(height: 12),
              _kv('Quantity', r['quantity'] != null ? '${r['quantity']} ${r['unit'] ?? ''}' : null),
              _kv('Target price', r['targetPrice'] is Map ? money(r['targetPrice']['amount'], r['targetPrice']['currency']) : null),
              _kv('Delivery city', r['deliveryCity']),
              _kv('Notes', r['message']),
              _kv('Sent', when(r['createdAt'])),
              if ((r['files'] as List?)?.isNotEmpty == true) ...[
                const _H('Your photos and videos'),
                for (final f in r['files'] as List) ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.attach_file), title: Text('${f['name']}'),
                    onTap: () => openFile(context, widget.api, '/api/portal/requests/${Uri.encodeComponent(widget.id)}/files/${Uri.encodeComponent('${f['id']}')}', '${f['name']}', '${f['mime']}')),
              ],
              if ((r['quotes'] as List?)?.isNotEmpty == true) ...[
                const _H('Quotes'),
                for (final q in (r['quotes'] as List).reversed) QuoteCard(q: q as Json, api: widget.api, reasons: _reasons, onChanged: (x) => setState(() => _r = x)),
              ],
              if ((r['orders'] as List?)?.isNotEmpty == true) ...[
                const _H('Orders'),
                for (final o in r['orders'] as List) OrderCard(o as Json),
              ],
              if ((r['timeline'] as List?)?.isNotEmpty == true) ...[const _H('Updates'), Timeline(r['timeline'] as List)],
            ])),
    );
  }
}

class _H extends StatelessWidget {
  const _H(this.t);
  final String t;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 20, bottom: 8), child: Text(t, style: Theme.of(context).textTheme.titleMedium));
}

Widget _kv(String k, Object? v) => v == null || '$v'.isEmpty ? const SizedBox.shrink()
    : Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 120, child: Text(k, style: const TextStyle(color: Colors.black54))), Expanded(child: Text('$v'))]));
Widget kv(String k, Object? v) => _kv(k, v);
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.t, {super.key});
  final String t;
  @override
  Widget build(BuildContext context) => _H(t);
}

class OrderCard extends StatelessWidget {
  const OrderCard(this.o, {super.key});
  final Json o;
  @override
  Widget build(BuildContext context) {
    final s = o['shipment'] as Json?;
    return Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${o['product']}', style: const TextStyle(fontWeight: FontWeight.w600)),
      Text('Order value ${money(o['value'], o['currency'])}', key: Key('order-value-${o['id']}')),
      Text('${o['qty']} units · ${payment[o['paymentStatus']] ?? o['paymentStatus']}'),
      if (s != null) ...[
        const SizedBox(height: 6),
        Text('Shipment ${s['reference'] ?? ''}: ${srStatus[s['status']] ?? s['status']}'),
        if (s['tracking'] != null) Text('Tracking ${s['tracking']}'),
        if (s['eta'] != null) Text('ETA ${day(s['eta'])}'),
      ],
    ])));
  }
}

/// Published customer quote: PDF, accept (with confirmation) or decline with a reason.
class QuoteCard extends StatefulWidget {
  const QuoteCard({super.key, required this.q, required this.api, required this.reasons, required this.onChanged});
  final Json q;
  final PortalApi api;
  final List<String> reasons;
  final ValueChanged<Json> onChanged;
  @override
  State<QuoteCard> createState() => _QuoteCardState();
}

class _QuoteCardState extends State<QuoteCard> {
  bool _busy = false;
  Future<void> _run(Future<Json> Function() f) async {
    setState(() => _busy = true);
    try { widget.onChanged(await f()); } on PortalError catch (e) { if (mounted) toast(context, e.message); } finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final q = widget.q;
    final status = switch (q['status']) { 'ACCEPTED' => 'Accepted', 'REJECTED' => 'Declined', _ => 'Waiting for you' };
    return Card(key: Key('quote-${q['id']}'), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [Expanded(child: Text('${q['label']}', style: const TextStyle(fontFamily: 'monospace', fontSize: 12))), Pill(status, color: q['status'] == 'SENT' ? accent : brand)]),
      const SizedBox(height: 4),
      Text(money(q['total'], q['currency']), style: Theme.of(context).textTheme.titleLarge),
      Text([if (q['qty'] != null) '${q['qty']} × ${money(q['unitPrice'], q['currency'])}', if (q['moq'] != null) 'MOQ ${q['moq']}', if (q['leadTime'] != null) 'Lead time ${q['leadTime']}', if (q['validity'] != null) 'Valid ${q['validity']}'].join(' · '),
          style: const TextStyle(color: Colors.black54)),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        OutlinedButton.icon(onPressed: () => openPdf(context, widget.api, '${q['pdfUrl']}', '${q['label']}'), icon: const Icon(Icons.picture_as_pdf_outlined), label: const Text('Quote PDF')),
        if (q['canDecide'] == true) ...[
          FilledButton(key: const Key('quote-accept'), onPressed: _busy ? null : () async {
            final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: const Text('Accept quote?'),
                content: Text('Accept ${q['label']} for ${money(q['total'], q['currency'])}? Source Easy will contact you to confirm the order.'),
                actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(key: const Key('quote-accept-confirm'), onPressed: () => Navigator.pop(c, true), child: const Text('Yes, accept'))]));
            if (ok == true) await _run(() => widget.api.acceptQuote('${q['id']}'));
          }, child: const Text('Accept')),
          OutlinedButton(key: const Key('quote-reject'), onPressed: _busy ? null : () async {
            final d = await declineDialog(context, widget.reasons);
            if (d != null) await _run(() => widget.api.rejectQuote('${q['id']}', d.$1, d.$2));
          }, child: const Text('Decline')),
        ],
      ]),
    ])));
  }
}

/// Reason picker for declining a quote; OTHER needs a written reason.
Future<(String, String)?> declineDialog(BuildContext context, List<String> codes) {
  var code = codes.isNotEmpty ? codes.first : 'OTHER';
  final why = TextEditingController();
  return showDialog<(String, String)>(context: context, builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
        title: const Text('Decline quote'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(initialValue: code, items: [for (final r in codes) DropdownMenuItem(value: r, child: Text(reasons[r] ?? r))], onChanged: (v) => set(() => code = v ?? code)),
          TextField(controller: why, maxLength: 500, decoration: InputDecoration(hintText: code == 'OTHER' ? 'Tell us why (required)' : 'Anything else? (optional)')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
          FilledButton(onPressed: () { if (code == 'OTHER' && why.text.trim().isEmpty) return; Navigator.pop(c, (code, why.text.trim())); }, child: const Text('Decline'))],
      )));
}

class NewRequestScreen extends StatefulWidget {
  const NewRequestScreen({super.key, required this.api});
  final PortalApi api;
  @override
  State<NewRequestScreen> createState() => _NewRequestScreenState();
}

class _NewRequestScreenState extends State<NewRequestScreen> {
  final _c = {for (final k in ['product', 'quantity', 'targetPrice', 'deliveryCity', 'referenceUrl', 'message']) k: TextEditingController()};
  String _unit = 'pcs', _cur = 'INR';
  List<UploadFile> _files = [];
  bool _busy = false;
  String? _err;
  Future<void> _send() async {
    if (_c['product']!.text.trim().isEmpty) return setState(() => _err = 'Describe the product you need');
    final ref = _c['referenceUrl']!.text.trim();
    if (ref.isNotEmpty && !RegExp(r'^https?://\S+$', caseSensitive: false).hasMatch(ref)) return setState(() => _err = 'Reference link must start with http:// or https://');
    setState(() { _busy = true; _err = null; });
    try {
      final r = await widget.api.createRequest({for (final e in _c.entries) if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim(), 'unit': _unit, 'currency': _cur}, _files);
      if (mounted) Navigator.pop(context, r);
    } on PortalError catch (e) { setState(() => _err = e.message); }
    catch (_) { setState(() => _err = 'Could not send. Check your connection and try again.'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  InputDecoration _d(String l) => InputDecoration(labelText: l, border: const OutlineInputBorder());
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('New sourcing request')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          TextField(key: const Key('new-product'), controller: _c['product'], maxLines: 3, maxLength: 1000, decoration: _d('What do you need? *')),
          Row(children: [
            Expanded(child: TextField(controller: _c['quantity'], keyboardType: TextInputType.number, decoration: _d('Quantity'))), const SizedBox(width: 8),
            DropdownButton<String>(value: _unit, items: [for (final u in units) DropdownMenuItem(value: u, child: Text(u))], onChanged: (v) => setState(() => _unit = v ?? _unit)),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(controller: _c['targetPrice'], keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: _d('Target price per unit'))), const SizedBox(width: 8),
            DropdownButton<String>(value: _cur, items: const [DropdownMenuItem(value: 'INR', child: Text('INR')), DropdownMenuItem(value: 'USD', child: Text('USD')), DropdownMenuItem(value: 'CNY', child: Text('CNY'))], onChanged: (v) => setState(() => _cur = v ?? _cur)),
          ]),
          const SizedBox(height: 12),
          TextField(controller: _c['deliveryCity'], decoration: _d('Delivery city')),
          const SizedBox(height: 12),
          TextField(controller: _c['referenceUrl'], keyboardType: TextInputType.url, decoration: _d('Reference link (optional)')),
          const SizedBox(height: 12),
          TextField(controller: _c['message'], maxLines: 3, maxLength: 2000, decoration: _d('Notes')),
          const SizedBox(height: 4),
          const Text('Photos or videos of the product (up to 5)'),
          MediaPicker(files: _files, onChanged: (f) => setState(() => _files = f)),
          if (_err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err!, key: const Key('new-error'), style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 12),
          FilledButton.icon(key: const Key('new-send'), onPressed: _busy ? null : _send, icon: const Icon(Icons.send), label: Text(_busy ? 'Sending…' : 'Send request'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52))),
        ]),
      );
}
