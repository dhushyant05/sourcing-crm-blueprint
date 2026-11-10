import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../l10n/web_strings.dart';
import '../../services/session.dart';
import '../widgets/live_refresh.dart';
import '../widgets/seg_tabs.dart';
import 'lead_detail_screen.dart';
import 'shipping_requests_screen.dart';

/// Shipping — same as the web Shipping page: one shipment per order, Active/Closed tabs, stage filter chips with counts,
/// search, a progress bar per shipment, China part (booking/transit details, Mark shipped) and India part (customs/delivery,
/// unlocked once shipped). Fields and edit rights follow the role (server enforces the same rules and strips private fields).
const shipStages = ['PENDING', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const chinaShip = ['PENDING', 'BOOKED'], indiaShip = ['IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const _modes = ['', 'AIR', 'SEA', 'EXPRESS', 'ROAD'], _terms = ['', 'EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'DOOR'];

String _d(Object? v) {
  final t = v == null ? null : DateTime.tryParse('$v');
  return t == null ? '—' : DateFormat('d MMM yyyy').format(t.toLocal());
}

class ShippingScreen extends StatefulWidget {
  const ShippingScreen({super.key, this.leadId});
  final String? leadId;
  @override
  State<ShippingScreen> createState() => _ShippingScreenState();
}

class _ShippingScreenState extends State<ShippingScreen> with LiveRefresh {
  @override
  Set<String> get liveTypes => const {'order', 'shipment', 'shipping'};
  @override
  String? get liveLeadId => widget.leadId;
  @override
  void liveRefresh() => _load();

  List<Map<String, dynamic>>? _all;
  List<Map<String, dynamic>>? _srs;
  String? _err;
  bool _closed = false;
  String _filter = '', _q = '';
  static const _srOpen = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'QUOTED', 'ACCEPTED'];

  @override
  void initState() { super.initState(); _load(); startLive(); }
  @override
  void dispose() { stopLive(); super.dispose(); }

  Future<void> _load() async {
    final repo = context.read<Session>().repo;
    final india = context.read<Session>().perms.canHandleShippingRequests && widget.leadId == null;
    String? err;
    List<Map<String, dynamic>>? all = _all, srs = _srs;
    try {
      final r = await repo.shipments();
      all = r.where((s) => widget.leadId == null || s['leadId'] == widget.leadId).toList();
    } catch (e) { err = '$e'; all ??= []; }
    if (india) { try { srs = await repo.shippingRequests(); } catch (_) { srs ??= []; } }
    if (mounted) setState(() { _all = all; if (india) _srs = srs; _err = err; });
  }

  void _replace(Map<String, dynamic> n) => setState(() => _all = _all?.map((x) => x['id'] == n['id'] ? n : x).toList());

  @override
  Widget build(BuildContext context) {
    final all = _all, pool = all?.where((s) => (s['closed'] == true) == _closed).toList();
    final nC = all?.where((s) => s['closed'] == true).length ?? 0;
    final rows = pool?.where((s) => (_filter.isEmpty || s['status'] == _filter) && (_q.isEmpty ||
        ['ref', 'leadRef', 'product', 'customer', 'supplier', 'tracking', 'container'].map((k) => '${s[k] ?? ''}').join(' ').toLowerCase().contains(_q))).toList();
    final session = context.read<Session>(), cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(tw(context, 'shipping.title')), actions: [
        // Shipping requests: India gets the request list, China the booking view of accepted requests (server enforces both).
        if (context.read<Session>().perms.canHandleShippingRequests) IconButton(key: const Key('open-sr'), tooltip: tw(context, 'sr.title'), icon: const Icon(Icons.assignment_outlined),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const IndiaShippingRequestsScreen()))),
        if (const {'CHINA_ADMIN', 'CHINA_STAFF', 'SUPER_ADMIN'}.contains(context.read<Session>().role.code)) IconButton(key: const Key('open-csr'), tooltip: tw(context, 'csr.title'), icon: const Icon(Icons.sailing_outlined),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChinaShippingRequestsScreen()))),
      ]),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
        Text(tw(context, 'shipping.subtitle'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
        if (session.perms.canHandleShippingRequests && widget.leadId == null) ...[
          const SizedBox(height: 8),
          _SrOnShipping(all: _srs, open: _srOpen, onOpenList: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const IndiaShippingRequestsScreen())).then((_) => _load()),
            onOpen: (id) => Navigator.push(context, MaterialPageRoute(builder: (_) => IndiaShippingRequestDetail(id: id))).then((_) => _load())),
        ],
        const SizedBox(height: 8),
        SegTabs<bool>(key: const Key('ship-tabs'), value: _closed, onChanged: (v) => setState(() => _closed = v),
            items: [(false, tw(context, 'closedOrder.active'), (all?.length ?? 0) - nC), (true, tw(context, 'closedOrder.closed'), nC)]),
        const SizedBox(height: 8),
        TextField(key: const Key('ship-search'), decoration: InputDecoration(prefixIcon: const Icon(Icons.search), isDense: true, filled: true,
            hintText: 'SE / ${tw(context, 'shipping.tracking')} / ${tw(context, 'orders.customer')}', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none)),
          onChanged: (v) => setState(() => _q = v.trim().toLowerCase())),
        const SizedBox(height: 8),
        SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
          for (final x in ['', ...shipStages]) Padding(padding: const EdgeInsets.only(right: 6), child: ChoiceChip(
            key: Key('ship-f-${x.isEmpty ? 'all' : x}'), selected: _filter == x, onSelected: (_) => setState(() => _filter = x),
            label: Text('${x.isEmpty ? tw(context, 'ship.all') : tw(context, 'ship.st.$x')}${pool != null ? ' (${pool.where((s) => x.isEmpty || s['status'] == x).length})' : ''}'))),
        ])),
        const SizedBox(height: 8),
        if (_err != null) Text(_err!, style: TextStyle(color: cs.error)),
        if (rows == null) const LinearProgressIndicator()
        else if (rows.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Column(children: [
          Icon(Icons.local_shipping_outlined, size: 40, color: cs.outline), const SizedBox(height: 8),
          Text(tw(context, 'shipping.none'), style: Theme.of(context).textTheme.titleMedium),
          Text(tw(context, 'shipping.noneHint'), textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall)]))
        else for (final s in rows) ShipCard(key: Key('ship-${s['id']}-${s['updatedAt']}'), s: s, onChanged: _replace),
      ])),
    );
  }
}

class ShipCard extends StatefulWidget {
  const ShipCard({super.key, required this.s, required this.onChanged});
  final Map<String, dynamic> s;
  final ValueChanged<Map<String, dynamic>> onChanged;
  @override
  State<ShipCard> createState() => _ShipCardState();
}

class _ShipCardState extends State<ShipCard> {
  static const _ckeys = ['mode', 'incoterm', 'port', 'transit', 'carrier', 'tracking', 'container', 'etd', 'eta'];
  late final Map<String, String> f = {
    for (final k in ['status', ..._ckeys, 'customsNote', 'deliveredAt']) k: '${widget.s[k] ?? ''}'.split('T').first,
  }..['status'] = '${widget.s['status'] ?? 'PENDING'}';
  late final Map<String, TextEditingController> _c = {for (final k in ['port', 'transit', 'carrier', 'tracking', 'container', 'customsNote']) k: TextEditingController(text: f[k])};
  bool busy = false;
  String? msg;

  @override
  void dispose() { for (final c in _c.values) { c.dispose(); } super.dispose(); }

  String _st(String v) => tw(context, 'ship.st.$v');
  String _v(String k) => _c[k]?.text.trim() ?? f[k] ?? '';

  Future<void> _save(List<String> keys, [String? status]) async {
    setState(() { busy = true; msg = null; });
    try {
      final b = <String, dynamic>{for (final k in keys) k: _v(k).isEmpty ? null : _v(k), 'status': ?status};
      final n = await context.read<Session>().repo.patchShipment('${widget.s['id']}', b);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tw(context, 'orders.saved'))));
      widget.onChanged(n);
    } catch (e) { if (mounted) setState(() => msg = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }

  Widget _sel(String k, List<String> opts, String label, String Function(String) fmt) => DropdownButtonFormField<String>(
        key: Key('s-$k'), initialValue: opts.contains(f[k]) ? f[k] : opts.first, isExpanded: true,
        decoration: InputDecoration(labelText: label, isDense: true, border: const OutlineInputBorder()),
        items: [for (final v in opts) DropdownMenuItem(value: v, child: Text(v.isEmpty ? '—' : fmt(v), overflow: TextOverflow.ellipsis))],
        onChanged: (v) => setState(() => f[k] = v ?? ''));
  Widget _inp(String k, String label) => TextField(key: Key('s-$k'), controller: _c[k], decoration: InputDecoration(labelText: label, isDense: true, border: const OutlineInputBorder()), onChanged: (_) => setState(() {}));
  Widget _date(String k, String label) => InkWell(key: Key('s-$k'), onTap: () async {
        final cur = DateTime.tryParse(f[k] ?? '');
        final d = await showDatePicker(context: context, initialDate: cur ?? DateTime.now(), firstDate: DateTime(2023), lastDate: DateTime(2035));
        if (d != null) setState(() => f[k] = DateFormat('yyyy-MM-dd').format(d));
      }, child: InputDecorator(decoration: InputDecoration(labelText: label, isDense: true, border: const OutlineInputBorder(),
          suffixIcon: (f[k] ?? '').isEmpty ? const Icon(Icons.event, size: 18) : IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => setState(() => f[k] = ''))),
        child: Text((f[k] ?? '').isEmpty ? '—' : _d(f[k]))));
  Widget _grid(List<Widget> xs) => LayoutBuilder(builder: (_, c) {
        final w = (c.maxWidth - 8) / 2;
        return Wrap(spacing: 8, runSpacing: 8, children: [for (final x in xs) SizedBox(width: w, child: x)]);
      });
  Widget _part(String title, List<Widget> kids) => Container(margin: const EdgeInsets.only(top: 12), padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(border: Border.all(color: Theme.of(context).colorScheme.outlineVariant), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title.toUpperCase(), style: Theme.of(context).textTheme.labelSmall?.copyWith(color: Theme.of(context).colorScheme.outline, letterSpacing: .6)),
        const SizedBox(height: 8), ...kids]));

  @override
  Widget build(BuildContext context) {
    final s = widget.s, ses = context.watch<Session>(), role = ses.role.name, perms = ses.perms;
    final sa = role == 'superAdmin', china = role.startsWith('china') || sa, india = role.startsWith('india') || sa;
    final t = Theme.of(context), cs = t.colorScheme, status = '${s['status'] ?? 'PENDING'}';
    final cur = shipStages.indexOf(status), shipped = cur >= shipStages.indexOf('IN_TRANSIT'), closed = s['closed'] == true;
    final canShip = (_v('tracking').isNotEmpty || _v('container').isNotEmpty) && (f['etd'] ?? '').isNotEmpty;
    final canEdit = perms.can('orders.production');
    String o(String k) => '${s[k] ?? ''}'.isEmpty ? '—' : '${s[k]}';
    Widget kv(String k, String v) => Text.rich(TextSpan(children: [TextSpan(text: '$k: '), TextSpan(text: v, style: const TextStyle(fontWeight: FontWeight.w600))]), style: t.textTheme.bodySmall);
    final qty = s['qty'];
    return Card(key: const Key('ship-card'), margin: const EdgeInsets.only(bottom: 10), child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
        InkWell(key: const Key('ship-open'), onTap: s['leadId'] == null ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: '${s['leadId']}'))),
          child: Text(o('ref'), style: TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700, color: cs.primary, decoration: TextDecoration.underline))),
        if (s['leadRef'] != null) Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1), decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(6)), child: Text('${s['leadRef']}', style: t.textTheme.labelSmall)),
        Text(o('product'), style: const TextStyle(fontWeight: FontWeight.w600)),
        if (qty != null) Text('× ${NumberFormat.decimalPattern('en_IN').format(qty)}', style: t.textTheme.bodySmall),
        Container(key: const Key('ship-status'), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: cs.primaryContainer, borderRadius: BorderRadius.circular(20)),
          child: Text(_st(status), style: t.textTheme.labelSmall?.copyWith(color: cs.onPrimaryContainer))),
        if (closed) Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: Colors.green.withValues(alpha: .15), borderRadius: BorderRadius.circular(20)), child: Text('✓ ${tw(context, 'status.COMPLETED')}', style: t.textTheme.labelSmall)),
        if (closed && s['paymentPending'] == true) Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: Colors.amber.withValues(alpha: .2), borderRadius: BorderRadius.circular(20)), child: Text(tw(context, 'closedOrder.payPending'), style: t.textTheme.labelSmall)),
      ]),
      Padding(padding: const EdgeInsets.only(top: 2), child: Text(tw(context, 'shipping.updated', {'d': _d(s['updatedAt'])}), style: t.textTheme.labelSmall?.copyWith(color: cs.outline))),
      const SizedBox(height: 10),
      Semantics(label: tw(context, 'shipping.progress'), child: Row(key: const Key('ship-progress'), children: [
        for (var i = 1; i < shipStages.length; i++) Expanded(child: Tooltip(message: _st(shipStages[i]), child: Container(height: 6, margin: const EdgeInsets.symmetric(horizontal: 1.5),
            decoration: BoxDecoration(color: i <= cur ? cs.primary : cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(3))))),
      ])),
      const SizedBox(height: 10),
      Wrap(spacing: 14, runSpacing: 4, children: [
        if (s.containsKey('customer')) kv(tw(context, 'orders.customer'), '${o('customer')}${s['deliveryCity'] != null ? ' · ${s['deliveryCity']}' : ''}'),
        if (s.containsKey('supplier')) kv(tw(context, 'orders.supplier'), o('supplier')),
        kv(tw(context, 'ship.mode'), '${s['mode'] != null ? tw(context, 'ship.m.${s['mode']}') : '—'} · ${o('incoterm')}'),
        kv(tw(context, 'ship.port'), '${o('port')} · ${tw(context, 'ship.transit')}: ${o('transit')}'),
        kv(tw(context, 'shipping.carrier'), o('carrier')),
        kv(tw(context, 'shipping.tracking'), '${o('tracking')}${s['container'] != null ? ' · ${s['container']}' : ''}'),
        kv('ETD', '${_d(s['etd'])} · ETA ${_d(s['eta'])}'),
        if (s['deliveredAt'] != null) kv(tw(context, 'ship.deliveredAt'), _d(s['deliveredAt'])),
        if ('${s['customsNote'] ?? ''}'.isNotEmpty) kv(tw(context, 'ship.customsNote'), '${s['customsNote']}'),
      ]),
      if (closed) Container(key: const Key('s-closed'), margin: const EdgeInsets.only(top: 12), padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.green.withValues(alpha: .08), borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('🔒 ${tw(context, 'closedOrder.locked')}', style: t.textTheme.bodySmall),
          if (s['paymentPending'] == true) Text(tw(context, 'closedOrder.payHint'), style: t.textTheme.bodySmall?.copyWith(color: Colors.amber.shade800)),
          Align(alignment: Alignment.centerRight, child: sa
            ? OutlinedButton.icon(key: const Key('s-closed-reopen'), icon: const Icon(Icons.replay, size: 16), label: Text(tw(context, 'closedOrder.reopen')), onPressed: busy ? null : () async {
                final m = ScaffoldMessenger.of(context), repo = context.read<Session>().repo;
                final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(content: Text(tw(context, 'closedOrder.reopenConfirm')),
                    actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(MaterialLocalizations.of(c).cancelButtonLabel)), FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tw(context, 'closedOrder.reopen')))]));
                if (ok != true) return;
                try { await repo.reopenLead('${s['leadId']}', 'INDIA'); final r = await repo.shipments(); final n = r.where((x) => x['id'] == s['id']); if (n.isNotEmpty) widget.onChanged(n.first); }
                catch (e) { m.showSnackBar(SnackBar(content: Text('$e'))); }
              })
            : Text(tw(context, 'lost.onlySa'), style: t.textTheme.labelSmall)),
        ])),
      if (!closed && china && canEdit) _part(tw(context, 'ship.chinaPart'), [
        _grid([
          if (!shipped) _sel('status', chinaShip, tw(context, 'shipping.stage'), _st),
          _sel('mode', _modes, tw(context, 'ship.mode'), (v) => tw(context, 'ship.m.$v')),
          _sel('incoterm', _terms, tw(context, 'ship.incoterm'), (v) => v),
          _inp('port', tw(context, 'ship.port')), _inp('transit', tw(context, 'ship.transit')),
          _inp('carrier', tw(context, 'shipping.carrier')), _inp('tracking', tw(context, 'shipping.tracking')),
          _inp('container', tw(context, 'orders.container')), _date('etd', 'ETD'), _date('eta', 'ETA'),
        ]),
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          OutlinedButton(key: const Key('s-save-china'), onPressed: busy ? null : () => _save(_ckeys, !shipped && chinaShip.contains(f['status']) && f['status'] != status ? f['status'] : null), child: Text(tw(context, 'orders.save'))),
          if (!shipped) FilledButton.icon(key: const Key('s-mark-shipped'), icon: const Icon(Icons.local_shipping, size: 18), onPressed: busy || !canShip ? null : () => _save(_ckeys, 'IN_TRANSIT'), label: Text(tw(context, 'ship.markShipped'))),
          if (!shipped && !canShip) Text(tw(context, 'ship.needForShip'), style: t.textTheme.bodySmall?.copyWith(color: Colors.amber.shade800)),
          if (shipped) Text('✓ ${tw(context, 'ship.shippedNote')}', key: const Key('s-shipped'), style: t.textTheme.bodySmall?.copyWith(color: Colors.green.shade700)),
        ]),
      ]),
      if (!closed && india && canEdit) _part(tw(context, 'ship.indiaPart'), !shipped
        ? [Text('🔒 ${tw(context, 'ship.indiaLocked')}', key: const Key('s-india-locked'), style: t.textTheme.bodySmall)]
        : [
            _grid([
              _sel('status', indiaShip.contains(f['status']) ? indiaShip : [f['status']!, ...indiaShip], tw(context, 'shipping.stage'), _st),
              _date('deliveredAt', tw(context, 'ship.deliveredAt')),
            ]),
            const SizedBox(height: 8),
            _inp('customsNote', tw(context, 'ship.customsNote')),
            const SizedBox(height: 8),
            FilledButton(key: const Key('s-save-india'), onPressed: busy ? null : () => _save(['customsNote', 'deliveredAt'], indiaShip.contains(f['status']) && f['status'] != status ? f['status'] : null), child: Text(tw(context, 'orders.save'))),
          ]),
      if (busy) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
      if (msg != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(msg!, style: t.textTheme.bodySmall?.copyWith(color: cs.error))),
    ])));
  }
}


/// Open shipping requests (SH-…) on the Shipping page so a portal-created request is visible here, not only in a notification.
class _SrOnShipping extends StatelessWidget {
  const _SrOnShipping({required this.all, required this.open, required this.onOpenList, required this.onOpen});
  final List<Map<String, dynamic>>? all;
  final List<String> open;
  final VoidCallback onOpenList;
  final void Function(String id) onOpen;
  @override
  Widget build(BuildContext context) {
    final rows = all?.where((r) => open.contains('${r['status']}')).toList();
    final n = rows?.length ?? 0;
    return Card(key: const Key('sr-on-shipping'), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      ListTile(
        leading: const Icon(Icons.assignment_outlined),
        title: Text(tw(context, 'sr.title')),
        subtitle: Text(n == 0 ? tw(context, 'sr.none') : '$n ${tw(context, 'sr.title')}'),
        trailing: const Icon(Icons.chevron_right),
        onTap: onOpenList,
      ),
      if (rows != null) for (final r in rows.take(8)) ListTile(
        key: Key('sr-ship-${r['ref']}'),
        dense: true,
        title: Text('${r['ref']} · ${r['goods']}'),
        subtitle: Text('${r['assignedToName'] ?? tw(context, 'sr.unclaimed')} · ${r['status']}'),
        onTap: () => onOpen(r['id'] as String),
      ),
    ]));
  }
}
