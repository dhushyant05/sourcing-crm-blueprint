import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../l10n/web_strings.dart';
import '../../services/session.dart';
import '../widgets/live_refresh.dart';

/// Shipping requests on Android, matching the web (same server routes, same EN / 中文 strings).
///  - China: accepted requests' booking details only (server allowlist: pickup, cargo, routing city, booking fields; never customer
///    identity, destination contact, notes, files or prices). China sets Booked / In transit for freight-only requests after the
///    customer accepted a freight quote; India takes over from arrival. Sourced requests are booked on the Shipping board.
///  - India: the request list (customer, status, SLA) and, once China marked it in transit, arrival → delivery stages.
///    Freight quotes, needs-info and assignment stay on the web.
const srStages = ['BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const _chinaStages = ['BOOKED', 'IN_TRANSIT'];
final _ymd = RegExp(r'^\d{4}-\d{2}-\d{2}$');

String _dash(Object? v) => v == null || '$v'.isEmpty ? '—' : '$v';
String _when(Object? v) {
  final t = v == null ? null : DateTime.tryParse('$v');
  return t == null ? '—' : '${DateFormat('d MMM, HH:mm').format(t.toUtc().add(const Duration(hours: 5, minutes: 30)))} IST';
}
String _st(BuildContext c, Object? s) { final k = 'sr.st.$s', v = tw(c, k); return v == k ? _dash(s) : v; }

Widget _row(BuildContext c, String k, Object? v) => Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
  SizedBox(width: 120, child: Text(k, style: Theme.of(c).textTheme.bodySmall?.copyWith(color: Theme.of(c).colorScheme.onSurfaceVariant))),
  Expanded(child: Text(_dash(v), style: Theme.of(c).textTheme.bodySmall)),
]));
Widget _head(BuildContext c, String t) => Padding(padding: const EdgeInsets.only(top: 10, bottom: 4), child: Text(t.toUpperCase(), style: Theme.of(c).textTheme.labelSmall));

/// Booking fields editor shared by China (BOOKED/IN_TRANSIT) and India (ARRIVED onward).
class _StageForm extends StatefulWidget {
  const _StageForm({super.key, required this.r, required this.stages, required this.fields, required this.save});
  final Map<String, dynamic> r;
  final List<String> stages;
  final List<String> fields;
  final Future<Map<String, dynamic>> Function(Map<String, dynamic> body) save;
  @override
  State<_StageForm> createState() => _StageFormState();
}

class _StageFormState extends State<_StageForm> {
  late String status = widget.stages.first;
  late final Map<String, TextEditingController> c = {for (final k in widget.fields) k: TextEditingController(text: '${widget.r[k] ?? ''}')};
  bool busy = false;
  String? msg;
  @override
  void dispose() { for (final x in c.values) { x.dispose(); } super.dispose(); }
  Future<void> _save() async {
    final body = <String, dynamic>{};
    for (final k in widget.fields) {
      final v = c[k]!.text.trim();
      if ((k == 'etd' || k == 'eta' || k == 'deliveredAt') && v.isNotEmpty && !_ymd.hasMatch(v)) { setState(() => msg = '$k: YYYY-MM-DD'); return; }
      if (v != '${widget.r[k] ?? ''}') body[k] = v;
    }
    if (status != widget.r['status']) body['status'] = status;
    setState(() { busy = true; msg = null; });
    try { await widget.save(body); if (mounted) setState(() => msg = tw(context, 'csr.saved')); }
    catch (e) { if (mounted) setState(() => msg = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    DropdownButtonFormField<String>(key: const Key('sr-stage'), initialValue: status, decoration: InputDecoration(labelText: tw(context, 'sr.stage'), isDense: true),
        items: [for (final s in widget.stages) DropdownMenuItem(value: s, child: Text(_st(context, s)))], onChanged: (v) => setState(() => status = v ?? status)),
    for (final k in widget.fields) TextField(key: Key('sr-$k'), controller: c[k], decoration: InputDecoration(isDense: true,
        labelText: k == 'etd' ? 'ETD (YYYY-MM-DD)' : k == 'eta' ? 'ETA (YYYY-MM-DD)' : k == 'deliveredAt' ? '${tw(context, 'ship.deliveredAt')} (YYYY-MM-DD)' : tw(context, 'sr.$k'))),
    const SizedBox(height: 8),
    FilledButton(key: const Key('sr-save'), onPressed: busy ? null : _save, child: Text(tw(context, 'sr.save'))),
    if (msg != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(msg!, style: Theme.of(context).textTheme.bodySmall)),
  ]);
}

// ---------------- China ----------------
class ChinaShippingRequestsScreen extends StatefulWidget {
  const ChinaShippingRequestsScreen({super.key, this.openId});
  final String? openId;
  @override
  State<ChinaShippingRequestsScreen> createState() => _ChinaState();
}

class _ChinaState extends State<ChinaShippingRequestsScreen> with LiveRefresh {
  @override
  Set<String> get liveTypes => const {'shipping', 'shipment'};
  @override
  void liveRefresh() => _load();
  List<Map<String, dynamic>>? _all;
  String? _err;
  late String? _open = widget.openId;
  @override
  void initState() { super.initState(); _load(); startLive(); }
  @override
  void dispose() { stopLive(); super.dispose(); }
  Future<void> _load() async {
    try { final r = await context.read<Session>().repo.chinaShippingRequests(); if (mounted) setState(() { _all = r; _err = null; }); }
    catch (e) { if (mounted) setState(() { _all ??= []; _err = '$e'; }); }
  }
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme, all = _all, canEdit = context.read<Session>().perms.can('orders.production');
    return Scaffold(
      appBar: AppBar(title: Text(tw(context, 'csr.title'))),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
        Text(tw(context, 'csr.hint'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
        if (_err != null) Text(_err!, style: TextStyle(color: cs.error)),
        if (all == null) const LinearProgressIndicator()
        else if (all.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(tw(context, 'csr.none'))))
        else for (final r in all) Card(key: Key('csr-${r['ref']}'), child: ExpansionTile(
          initiallyExpanded: r['id'] == _open, onExpansionChanged: (o) => _open = o ? r['id'] as String : null,
          title: Text('${r['ref']} · ${r['goods']}'),
          subtitle: Text('${tw(context, 'sr.kind.${r['kind']}')} · ${_dash(r['pickupCity'])} → ${_dash(r['destCity'])} · ${_st(context, r['status'])}'),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12), expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _head(context, tw(context, 'csr.pickup')),
            _row(context, tw(context, 'csr.contact'), r['pickupContact']), _row(context, tw(context, 'csr.phone'), r['pickupPhone']),
            _row(context, tw(context, 'csr.address'), r['pickupAddress']), _row(context, tw(context, 'csr.city'), r['pickupCity']),
            _row(context, tw(context, 'csr.ready'), r['readyDate']),
            _head(context, tw(context, 'csr.cargo')),
            _row(context, tw(context, 'csr.qty'), r['quantity'] == null ? null : '${r['quantity']} ${r['unit'] ?? ''}'),
            _row(context, tw(context, 'csr.packages'), r['packages']), _row(context, tw(context, 'csr.weight'), r['weightKg']), _row(context, 'CBM', r['cbm']),
            _row(context, tw(context, 'csr.mode'), [r['mode'], r['incoterm']].where((x) => x != null).join(' · ')), _row(context, tw(context, 'csr.dest'), r['destCity']),
            _head(context, tw(context, 'csr.booking')),
            if (r['kind'] == 'SOURCED') ...[
              _row(context, tw(context, 'csr.shipment'), r['shipmentRef']), _row(context, tw(context, 'sr.stage'), tw(context, 'ship.st.${r['stage']}')),
              Text(tw(context, 'csr.sourced'), style: Theme.of(context).textTheme.bodySmall),
            ] else if (r['canUpdate'] == true && canEdit) ...[
              _StageForm(key: Key('csr-form-${r['id']}-${r['updatedAt']}'), r: r,
                  stages: r['status'] == 'ACCEPTED' ? _chinaStages : _chinaStages.sublist(_chinaStages.indexOf('${r['status']}')),
                  fields: const ['carrier', 'tracking', 'container', 'etd', 'eta'],
                  save: (b) async { final n = await context.read<Session>().repo.chinaSrStage(r['id'] as String, b);
                    if (mounted) setState(() => _all = _all?.map((x) => x['id'] == n['id'] ? n : x).toList()); return n; }),
              Text(tw(context, 'csr.handover'), style: Theme.of(context).textTheme.bodySmall),
            ] else ...[
              _row(context, tw(context, 'sr.carrier'), r['carrier']), _row(context, tw(context, 'sr.tracking'), r['tracking']),
              _row(context, tw(context, 'sr.container'), r['container']), _row(context, 'ETD', r['etd']), _row(context, 'ETA', r['eta']),
              if (r['canUpdate'] != true) Text(tw(context, 'csr.indiaOwns'), style: Theme.of(context).textTheme.bodySmall),
            ],
          ],
        )),
      ])),
    );
  }
}

// ---------------- India ----------------
class IndiaShippingRequestsScreen extends StatefulWidget {
  const IndiaShippingRequestsScreen({super.key, this.openId});
  final String? openId;
  @override
  State<IndiaShippingRequestsScreen> createState() => _IndiaState();
}

class _IndiaState extends State<IndiaShippingRequestsScreen> with LiveRefresh {
  @override
  Set<String> get liveTypes => const {'shipping'};
  @override
  void liveRefresh() => _load();
  List<Map<String, dynamic>>? _all;
  String? _err;
  bool _closed = false;
  static const _open = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'QUOTED', 'ACCEPTED', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY'];
  @override
  void initState() {
    super.initState(); _load(); startLive();
    final id = widget.openId;
    if (id != null) WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _detail(id); });
  }
  @override
  void dispose() { stopLive(); super.dispose(); }
  Future<void> _load() async {
    try { final r = await context.read<Session>().repo.shippingRequests(); if (mounted) setState(() { _all = r; _err = null; }); }
    catch (e) { if (mounted) setState(() { _all ??= []; _err = '$e'; }); }
  }
  void _detail(String id) => Navigator.push(context, MaterialPageRoute(builder: (_) => IndiaShippingRequestDetail(id: id))).then((_) => _load());
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final rows = _all?.where((r) => _closed != _open.contains(r['status'])).toList();
    return Scaffold(
      appBar: AppBar(title: Text(tw(context, 'sr.title')), actions: [
        IconButton(key: const Key('sr-closed'), tooltip: tw(context, 'sr.showClosed'), icon: Icon(_closed ? Icons.inventory_2 : Icons.inventory_2_outlined), onPressed: () => setState(() => _closed = !_closed)),
      ]),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
        if (_err != null) Text(_err!, style: TextStyle(color: cs.error)),
        if (rows == null) const LinearProgressIndicator()
        else if (rows.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(tw(context, 'sr.none'))))
        else for (final r in rows) Card(child: ListTile(key: Key('sr-${r['ref']}'), onTap: () => _detail(r['id'] as String),
          title: Text('${r['ref']} · ${r['goods']}'),
          subtitle: Text('${_dash((r['customer'] as Map?)?['company'] ?? (r['customer'] as Map?)?['name'])} · ${_st(context, r['status'])}'
              '${r['assignedToName'] != null ? ' · ${r['assignedToName']}' : ' · ${tw(context, 'sr.unclaimed')}'}'),
          trailing: (r['sla'] as Map?) == null ? null : Text((r['sla'] as Map)['breached'] == true ? tw(context, 'sr.slaBreached') : tw(context, 'sr.slaDue', {'at': _when((r['sla'] as Map)['dueAt'])}),
              style: TextStyle(fontSize: 11, color: (r['sla'] as Map)['breached'] == true ? cs.error : (r['sla'] as Map)['warned'] == true ? Colors.orange.shade800 : cs.onSurfaceVariant)),
        )),
      ])),
    );
  }
}

class IndiaShippingRequestDetail extends StatefulWidget {
  const IndiaShippingRequestDetail({super.key, required this.id});
  final String id;
  @override
  State<IndiaShippingRequestDetail> createState() => _IndiaDetailState();
}

class _IndiaDetailState extends State<IndiaShippingRequestDetail> {
  Map<String, dynamic>? r;
  String? err;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final x = await context.read<Session>().repo.shippingRequest(widget.id); if (mounted) setState(() { r = x; err = null; }); }
    catch (e) { if (mounted) setState(() => err = '$e'); }
  }
  @override
  Widget build(BuildContext context) {
    final r = this.r, s = context.read<Session>();
    final sa = s.perms.isSuperAdmin, st = '${r?['status']}';
    final ci = srStages.indexOf(st);
    // India moves ARRIVED onward once China marked it in transit (server rule); the super admin may do every stage.
    final stages = r == null || r['kind'] != 'FREIGHT_ONLY' || !s.perms.can('orders.production') ? const <String>[]
        : sa ? (st == 'ACCEPTED' ? srStages : ci >= 0 && ci < srStages.length - 1 ? srStages.sublist(ci) : const <String>[])
        : ci >= srStages.indexOf('IN_TRANSIT') && ci < srStages.length - 1 ? srStages.sublist(ci).where((x) => x == st || srStages.indexOf(x) >= srStages.indexOf('ARRIVED')).toList() : const <String>[];
    final cust = r?['customer'] as Map?, sla = r?['sla'] as Map?, p = r?['progress'] as Map?;
    return Scaffold(
      appBar: AppBar(title: Text(r == null ? tw(context, 'sr.title') : '${r['ref']}')),
      body: r == null ? Center(child: err == null ? const CircularProgressIndicator() : Text(err!))
          : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [
              Text('${r['goods']}', style: Theme.of(context).textTheme.titleMedium),
              _row(context, tw(context, 'sr.stage'), _st(context, st)),
              _row(context, tw(context, 'orders.customer'), cust == null ? null : [cust['company'], cust['name'], cust['phone']].where((x) => x != null).join(' · ')),
              _row(context, tw(context, 'sr.col.owner'), r['assignedToName'] ?? tw(context, 'sr.unclaimed')),
              if (sla != null) _row(context, tw(context, 'sr.col.sla'), sla['breached'] == true ? tw(context, 'sr.slaBreached') : tw(context, 'sr.slaDue', {'at': _when(sla['dueAt'])})),
              _head(context, tw(context, 'csr.pickup')),
              _row(context, tw(context, 'csr.contact'), r['shipperName']), _row(context, tw(context, 'csr.phone'), r['shipperPhone']),
              _row(context, tw(context, 'csr.address'), r['pickupAddress']), _row(context, tw(context, 'csr.city'), r['pickupCity']), _row(context, tw(context, 'csr.ready'), r['readyDate']),
              _head(context, tw(context, 'csr.cargo')),
              _row(context, tw(context, 'csr.qty'), r['quantity'] == null ? null : '${r['quantity']} ${r['unit'] ?? ''}'),
              _row(context, tw(context, 'csr.packages'), r['packages']), _row(context, tw(context, 'csr.weight'), r['weightKg']), _row(context, 'CBM', r['cbm']),
              _row(context, tw(context, 'csr.dest'), [r['destAddress'], r['destCity'], r['destPincode']].where((x) => x != null).join(', ')),
              if (p != null) ...[
                _head(context, tw(context, 'csr.booking')),
                _row(context, tw(context, 'sr.carrier'), p['carrier']), _row(context, tw(context, 'sr.tracking'), p['tracking']),
                _row(context, tw(context, 'sr.container'), p['container']), _row(context, 'ETD', p['etd']), _row(context, 'ETA', p['eta']),
              ],
              const SizedBox(height: 8),
              if (r['kind'] == 'FREIGHT_ONLY' && !sa && (st == 'ACCEPTED' || st == 'BOOKED')) Text(tw(context, 'sr.chinaBooks'), key: const Key('sr-china-books'), style: Theme.of(context).textTheme.bodySmall),
              if (r['kind'] == 'SOURCED' && st == 'ACCEPTED') Text(tw(context, 'sr.sourcedTrack'), style: Theme.of(context).textTheme.bodySmall),
              if (stages.isNotEmpty) _StageForm(key: Key('sr-form-${r['updatedAt']}'), r: r, stages: stages,
                  fields: const ['carrier', 'tracking', 'container', 'etd', 'eta', 'deliveredAt'],
                  save: (b) async { final n = await s.repo.srStage(widget.id, b); if (mounted) setState(() => this.r = n); return n; }),
              const SizedBox(height: 8),
              Text(tDelHint(context), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ])),
    );
  }
}

String tDelHint(BuildContext c) => Localizations.localeOf(c).languageCode == 'zh' ? '运费报价、补充信息和分配请在网页端处理。' : 'Freight quotes, info requests and assignment are on the web app.';
