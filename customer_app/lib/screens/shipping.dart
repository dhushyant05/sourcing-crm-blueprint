import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../widgets.dart';
import 'requests.dart' show SectionTitle, declineDialog, kv;
import '../workflow.dart';

class ShippingTile extends StatelessWidget {
  const ShippingTile(this.r, {super.key, required this.onTap});
  final Json r;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(child: ListTile(
        key: Key('sr-${r['id']}'), onTap: onTap, leading: const Icon(Icons.local_shipping_outlined),
        title: Text('${r['goods']}', maxLines: 2, overflow: TextOverflow.ellipsis),
        subtitle: Text(['${r['reference']}', r['kind'] == 'SOURCED' ? 'Sourced order ${r['leadReference'] ?? ''}' : 'Freight only', if (r['destCity'] != null) 'to ${r['destCity']}'].join(' · ')),
        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
          Pill(srStatus[srShown(r)] ?? srShown(r)),
          if (r['quoteWaiting'] == true) const Padding(padding: EdgeInsets.only(top: 4), child: Pill('Quote waiting', color: accent)),
          if (r['canReply'] == true) const Padding(padding: EdgeInsets.only(top: 4), child: Pill('Info needed', color: accent)),
        ]),
      ));
}

class ShippingDetailScreen extends StatefulWidget {
  const ShippingDetailScreen({super.key, required this.api, required this.id, required this.changes});
  final PortalApi api;
  final String id;
  final Stream<String> changes;
  @override
  State<ShippingDetailScreen> createState() => _ShippingDetailScreenState();
}

class _ShippingDetailScreenState extends State<ShippingDetailScreen> {
  Json? _r;
  String? _err;
  bool _busy = false;
  List<String> _reasons = reasons.keys.toList();
  final _reply = TextEditingController();
  List<UploadFile> _files = [];
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
    try { final r = await widget.api.shipping(widget.id); if (mounted) setState(() { _r = r; _err = null; }); }
    on PortalError catch (e) { if (mounted) setState(() => _err = e.status == 404 ? 'This shipping request is not available.' : e.message); }
    catch (_) { if (mounted) setState(() => _err = 'Could not reach Source Easy.'); }
  }

  Future<void> _run(Future<Json> Function() f, [String? ok]) async {
    setState(() => _busy = true);
    try { final r = await f(); if (mounted) { setState(() => _r = r); if (ok != null) toast(context, ok); } }
    on PortalError catch (e) { if (mounted) toast(context, e.message); if (e.status == 409) unawaited(_load()); }
    catch (_) { if (mounted) toast(context, 'Could not reach Source Easy.'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final r = _r;
    if (r == null) return Scaffold(appBar: AppBar(title: const Text('Shipping request')), body: _err != null ? ErrorRetry(_err!, _load) : const Center(child: CircularProgressIndicator()));
    final t = r['tracking'] as Json?, fqs = (r['freightQuotes'] as List?)?.cast<Json>() ?? const [];
    return Scaffold(
      appBar: AppBar(title: Text('${r['reference']}')),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [Expanded(child: Text('${r['goods']}', style: Theme.of(context).textTheme.titleLarge)), Pill(srStatus[srShown(r)] ?? srShown(r))]),
        const SizedBox(height: 12),
        WorkflowTracker(r['workflow'] is Map ? r['workflow'] as Json : null),
        const SizedBox(height: 8),
        kv('Type', r['kind'] == 'SOURCED' ? 'Sourced order ${r['leadReference'] ?? ''}' : 'Freight only'),
        kv('Quantity', r['quantity'] != null ? '${r['quantity']} ${r['unit'] ?? ''}' : null),
        kv('Packages', r['packages']), kv('Weight', r['weightKg'] != null ? '${r['weightKg']} kg' : null), kv('Volume', r['cbm'] != null ? '${r['cbm']} CBM' : null),
        kv('Pickup', [r['pickupAddress'], r['pickupCity']].whereType<String>().join(', ')),
        kv('Shipper', [r['shipperName'], r['shipperPhone']].whereType<String>().join(' · ')),
        kv('Deliver to', [r['destAddress'], r['destCity'], r['destPincode']].whereType<String>().join(', ')),
        kv('Mode', modes.firstWhere((m) => m.$1 == r['mode'], orElse: () => ('', '')).$2), kv('Ready on', r['readyDate'] != null ? day(r['readyDate']) : null), kv('Your note', r['customerNote']),
        if (r['canReply'] == true) Card(color: const Color(0xFFFFF7ED), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Source Easy needs more information', style: TextStyle(fontWeight: FontWeight.w600)),
          if (r['question'] != null) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text('“${r['question']}”')),
          TextField(key: const Key('sr-reply-text'), controller: _reply, maxLines: 3, decoration: const InputDecoration(hintText: 'Your answer', border: OutlineInputBorder())),
          MediaPicker(files: _files, onChanged: (f) => setState(() => _files = f)),
          FilledButton(key: const Key('sr-reply-send'), onPressed: _busy ? null : () {
            if (_reply.text.trim().isEmpty && _files.isEmpty) return toast(context, 'Write a reply or attach a file.');
            _run(() async { final x = await widget.api.replyShipping(widget.id, _reply.text.trim(), _files); _reply.clear(); _files = []; return x; }, 'Reply sent');
          }, child: const Text('Send reply')),
        ]))),
        if (fqs.isNotEmpty) ...[
          const SectionTitle('Freight quotes'),
          const Text('Source Easy books the shipment only after you accept a freight quote.', key: Key('booking-gate'), style: TextStyle(color: Colors.black54)),
          for (final q in fqs.reversed) _freightCard(q),
        ],
        if (t != null) ...[
          const SectionTitle('Tracking'),
          kv('Stage', srStatus[t['stage']] ?? t['stage']), kv('Shipment', t['shipmentRef']), kv('Carrier', t['carrier']), kv('Tracking no.', t['tracking']), kv('Container', t['container']),
          kv('ETD', t['etd'] != null ? day(t['etd']) : null), kv('ETA', t['eta'] != null ? day(t['eta']) : null), kv('Delivered', t['deliveredAt'] != null ? when(t['deliveredAt']) : null),
        ],
        if ((r['files'] as List?)?.isNotEmpty == true) ...[
          const SectionTitle('Files'),
          for (final f in r['files'] as List) ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.attach_file), title: Text('${f['name']}'),
              onTap: () => openFile(context, widget.api, '/api/portal/shipping-requests/${Uri.encodeComponent(widget.id)}/files/${Uri.encodeComponent('${f['id']}')}', '${f['name']}', '${f['mime']}')),
        ],
        if ((r['timeline'] as List?)?.isNotEmpty == true) ...[const SectionTitle('Updates'), Timeline(r['timeline'] as List)],
        if (r['canCancel'] == true) Padding(padding: const EdgeInsets.only(top: 16), child: OutlinedButton(key: const Key('sr-cancel'), onPressed: _busy ? null : () async {
          final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: const Text('Cancel this request?'), actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep it')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Cancel request'))]));
          if (ok == true) await _run(() => widget.api.cancelShipping(widget.id), 'Request cancelled');
        }, child: const Text('Cancel request'))),
      ])),
    );
  }

  Widget _freightCard(Json q) => Card(key: Key('fq-${q['id']}'), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Expanded(child: Text('${q['label']}', style: const TextStyle(fontFamily: 'monospace', fontSize: 12))), Pill(fqStatus(q['status']), color: q['status'] == 'SENT' ? accent : brand)]),
        Text(inr(q['amount']), style: Theme.of(context).textTheme.titleLarge),
        Text([modes.firstWhere((m) => m.$1 == q['mode'], orElse: () => ('', '')).$2, q['incoterm'], if (q['transit'] != null) 'Transit ${q['transit']}', if (q['validUntil'] != null) 'Valid until ${day(q['validUntil'])}']
            .whereType<String>().where((s) => s.isNotEmpty).join(' · '), style: const TextStyle(color: Colors.black54)),
        if (q['note'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('${q['note']}')),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          OutlinedButton.icon(key: const Key('fq-pdf'), onPressed: () => openPdf(context, widget.api, '/api/portal/freight-quotes/${Uri.encodeComponent('${q['id']}')}/pdf', '${q['label']}'),
              icon: const Icon(Icons.picture_as_pdf_outlined), label: const Text('Freight quote PDF')),
          if (q['canDecide'] == true) ...[
            FilledButton(key: const Key('fq-accept'), onPressed: _busy ? null : () async {
              final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: const Text('Accept freight quote?'),
                  content: Text('Accept ${q['label']} for ${inr(q['amount'])}? Source Easy will then book the shipment.'),
                  actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(key: const Key('fq-accept-confirm'), onPressed: () => Navigator.pop(c, true), child: const Text('Yes, accept'))]));
              if (ok == true) await _run(() => widget.api.acceptFreight(q), 'Freight quote accepted');
            }, child: const Text('Accept')),
            OutlinedButton(key: const Key('fq-reject'), onPressed: _busy ? null : () async {
              final d = await declineDialog(context, _reasons);
              if (d != null) await _run(() => widget.api.rejectFreight('${q['id']}', d.$1, d.$2), 'Freight quote declined');
            }, child: const Text('Decline')),
          ],
        ]),
      ])));
}

class NewShippingScreen extends StatefulWidget {
  const NewShippingScreen({super.key, required this.api});
  final PortalApi api;
  @override
  State<NewShippingScreen> createState() => _NewShippingScreenState();
}

class _NewShippingScreenState extends State<NewShippingScreen> {
  String _kind = 'FREIGHT_ONLY', _mode = '';
  String? _order;
  List<Json>? _orders;
  List<UploadFile> _files = [];
  bool _busy = false;
  String? _err;
  final _c = {for (final k in ['goods', 'quantity', 'packages', 'weightKg', 'cbm', 'shipperName', 'shipperPhone', 'pickupAddress', 'pickupCity', 'destAddress', 'destCity', 'destPincode', 'readyDate', 'customerNote']) k: TextEditingController()};
  @override
  void initState() {
    super.initState();
    widget.api.shippableOrders().then((o) { if (mounted) setState(() => _orders = o); }).catchError((_) { if (mounted) setState(() => _orders = []); });
  }

  Future<void> _send() async {
    if (_kind == 'SOURCED' && _order == null) return setState(() => _err = 'Choose the order to ship.');
    if (_kind == 'FREIGHT_ONLY' && _c['goods']!.text.trim().isEmpty) return setState(() => _err = 'Describe the goods.');
    final ready = _c['readyDate']!.text.trim();
    if (ready.isNotEmpty && !isYmd(ready)) return setState(() => _err = 'Enter the ready date as YYYY-MM-DD, for example 2026-12-01.');
    setState(() { _busy = true; _err = null; });
    try {
      final r = await widget.api.createShipping({'kind': _kind, if (_order != null && _kind == 'SOURCED') 'orderId': _order!, if (_mode.isNotEmpty) 'mode': _mode,
        for (final e in _c.entries) if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim()}, _files);
      if (mounted) Navigator.pop(context, r);
    } on PortalError catch (e) { setState(() => _err = e.message); }
    catch (_) { setState(() => _err = 'Could not send. Check your connection and try again.'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  Widget _f(String k, String label, {TextInputType? type}) => Padding(padding: const EdgeInsets.only(bottom: 12),
      child: TextField(key: Key('ns-$k'), controller: _c[k], keyboardType: type, decoration: InputDecoration(labelText: label, border: const OutlineInputBorder())));
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('New shipping request')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          SegmentedButton<String>(segments: const [ButtonSegment(value: 'FREIGHT_ONLY', label: Text('My own goods')), ButtonSegment(value: 'SOURCED', label: Text('A Source Easy order'))],
              selected: {_kind}, onSelectionChanged: (s) => setState(() => _kind = s.first)),
          const SizedBox(height: 12),
          if (_kind == 'SOURCED') ...[
            if (_orders == null) const LinearProgressIndicator()
            else if (_orders!.isEmpty) const Text('You have no orders that can be shipped yet.', key: Key('ns-no-orders'))
            else DropdownButtonFormField<String>(key: const Key('ns-order'), initialValue: _order, decoration: const InputDecoration(labelText: 'Order to ship', border: OutlineInputBorder()),
                items: [for (final o in _orders!) DropdownMenuItem(value: '${o['id']}', child: Text('${o['leadReference'] ?? ''} · ${o['product']} × ${o['qty']}', overflow: TextOverflow.ellipsis))],
                onChanged: (v) => setState(() => _order = v)),
            const SizedBox(height: 12),
          ] else _f('goods', 'Goods to ship *'),
          _f('quantity', 'Quantity', type: TextInputType.number), _f('packages', 'Number of packages', type: TextInputType.number),
          _f('weightKg', 'Weight (kg)', type: const TextInputType.numberWithOptions(decimal: true)), _f('cbm', 'Volume (CBM)', type: const TextInputType.numberWithOptions(decimal: true)),
          if (_kind == 'FREIGHT_ONLY') ...[_f('shipperName', 'Shipper / supplier name'), _f('shipperPhone', 'Shipper phone', type: TextInputType.phone), _f('pickupAddress', 'Pickup address in China'), _f('pickupCity', 'Pickup city')],
          _f('destAddress', 'Delivery address'), _f('destCity', 'Delivery city'), _f('destPincode', 'PIN code', type: TextInputType.number),
          DropdownButtonFormField<String>(initialValue: _mode, decoration: const InputDecoration(labelText: 'Preferred mode', border: OutlineInputBorder()),
              items: [for (final m in modes) DropdownMenuItem(value: m.$1, child: Text(m.$2))], onChanged: (v) => setState(() => _mode = v ?? '')),
          const SizedBox(height: 12),
          Padding(padding: const EdgeInsets.only(bottom: 12), child: TextField(key: const Key('ns-readyDate'), controller: _c['readyDate'], keyboardType: TextInputType.datetime,
              decoration: InputDecoration(labelText: 'Goods ready on (YYYY-MM-DD)', border: const OutlineInputBorder(), suffixIcon: IconButton(tooltip: 'Pick a date', icon: const Icon(Icons.calendar_today), onPressed: () async {
                final now = DateTime.now();
                final d = await showDatePicker(context: context, firstDate: DateTime(now.year - 1), lastDate: DateTime(now.year + 2), initialDate: now);
                if (d != null) _c['readyDate']!.text = '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
              })))), _f('customerNote', 'Notes'),
          const Text('Photos, packing list or invoice photos (up to 5)'),
          MediaPicker(files: _files, onChanged: (f) => setState(() => _files = f)),
          if (_err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err!, key: const Key('ns-error'), style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 12),
          FilledButton.icon(key: const Key('ns-send'), onPressed: _busy ? null : _send, icon: const Icon(Icons.send), label: Text(_busy ? 'Sending…' : 'Send request'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52))),
        ]),
      );
}
