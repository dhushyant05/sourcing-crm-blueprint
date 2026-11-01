import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../l10n/l10n.dart';
import '../../services/session.dart';
import '../widgets/lead_quotes.dart' show quoteMoney;
import '../widgets/se_codes.dart';
import '../../core/roles.dart';
import '../../l10n/web_strings.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, this.initial});
  final List<SeOrder>? initial;
  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  List<SeOrder>? _list;
  String? _err;
  @override
  void initState() { super.initState(); if (widget.initial != null) { _list = widget.initial; } else { _load(); } }
  Future<void> _load() async {
    try { final r = await context.read<Session>().repo.orders(); if (mounted) setState(() { _list = r; _err = null; }); }
    catch (e) { if (mounted) setState(() { _list ??= []; _err = '$e'; }); }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, list = _list;
    return Scaffold(
      appBar: AppBar(title: Text(l.orTitle)),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
        if (_err != null) Text(_err!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        if (list == null) const LinearProgressIndicator()
        else if (list.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(l.orNone)))
        else for (final o in list) _OrderCard(key: Key('order-${o.id}-${o.j['updatedAt']}'), o: o, onSaved: _load),
      ])),
    );
  }
}

class _OrderCard extends StatefulWidget {
  const _OrderCard({super.key, required this.o, required this.onSaved});
  final SeOrder o;
  final VoidCallback onSaved;
  @override
  State<_OrderCard> createState() => _OrderCardState();
}

class _OrderCardState extends State<_OrderCard> {
  late String prod = widget.o.production, ind = widget.o.indiaStatus, pay = widget.o.paymentStatus ?? 'PENDING';
  late final c = {for (final k in ['tracking', 'container', 'etd', 'eta', 'advance', 'expectedShip']) k: TextEditingController(text: '${widget.o.j[k] ?? ''}')};
  bool busy = false;

  /// Shipping and payment are separate PATCHes, each only with its own permission and only changed fields,
  /// so a user with shipping-only (or payment-only) rights can save (matches the web app).
  Future<void> _saveIndia(bool shipped, Permissions perms, String? Function(String) nn) async {
    final o = widget.o, l = context.l10n, m = ScaffoldMessenger.of(context), repo = context.read<Session>().repo;
    final now = <String, dynamic>{'indiaStatus': ind, 'expectedShip': nn('expectedShip'), 'paymentStatus': pay, 'advance': nn('advance') == null ? null : num.tryParse(nn('advance')!)};
    final was = <String, dynamic>{'indiaStatus': o.indiaStatus, 'expectedShip': o.j['expectedShip'], 'paymentStatus': o.paymentStatus ?? 'PENDING', 'advance': o.j['advance']};
    Map<String, dynamic> pick(List<String> ks) => {for (final k in ks) if ('${now[k] ?? ''}' != '${was[k] ?? ''}') k: now[k]};
    final ship = perms.canEditShipping ? pick(shipped ? ['indiaStatus', 'expectedShip'] : ['expectedShip']) : <String, dynamic>{};
    final payB = perms.canEditPayment ? pick(['paymentStatus', 'advance']) : <String, dynamic>{};
    setState(() => busy = true);
    try {
      if (ship.isNotEmpty) await repo.updateOrder(o.id, ship);
      if (payB.isNotEmpty) await repo.updateOrder(o.id, payB);
      m.showSnackBar(SnackBar(content: Text(l.orSaved))); widget.onSaved();
    } catch (e) { m.showSnackBar(SnackBar(content: Text('$e'))); } finally { if (mounted) setState(() => busy = false); }
  }

  Future<void> _save(Map<String, dynamic> b) async {
    final l = context.l10n, m = ScaffoldMessenger.of(context);
    setState(() => busy = true);
    try { await context.read<Session>().repo.updateOrder(widget.o.id, b); m.showSnackBar(SnackBar(content: Text(l.orSaved))); widget.onSaved(); }
    catch (e) { m.showSnackBar(SnackBar(content: Text('$e'))); } finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, t = Theme.of(context), role = context.watch<Session>().role.name;
    final sa = role == 'superAdmin', china = role.startsWith('china') || sa, india = role.startsWith('india') || sa, o = widget.o;
    final perms = context.watch<Session>().perms, shipped = o.production == 'SHIPPED';
    const prodOpts = ['NEW', 'DEPOSIT_PAID', 'IN_PRODUCTION', 'READY'], indOpts = ['IN_TRANSIT', 'CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED'];
    final canShip = (c['tracking']!.text.trim().isNotEmpty || c['container']!.text.trim().isNotEmpty) && c['etd']!.text.trim().isNotEmpty;
    String? nn(String k) => c[k]!.text.trim().isEmpty ? null : c[k]!.text.trim();
    Widget f(String k, String label) => Padding(padding: const EdgeInsets.only(bottom: 8), child: TextField(key: Key('o-$k'), controller: c[k], onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: label, isDense: true, border: const OutlineInputBorder())));
    return Card(margin: const EdgeInsets.symmetric(vertical: 6), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${o.leadRef ?? ''} · ${o.product} × ${o.qty.toStringAsFixed(0)}', style: t.textTheme.titleSmall),
      Text([
        if (o.customer != null) '${l.orCustomer}: ${o.customer}', if (o.total != null) '${l.orTotal}: ${inr(o.total)}',
        if (o.supplierName != null) '${l.orSupplier}: ${o.supplierName}', if (o.unitPrice != null) '${l.orCost}: ${quoteMoney(o.unitPrice, o.currency)}',
        '${l.orProduction}: ${seCode(l, 'prod', o.production)}', '${l.orShipment}: ${seCode(l, 'ind', o.indiaStatus)}',
        if (o.tracking != null) '${l.orTracking}: ${o.tracking}', if (o.etd != null) 'ETD ${o.etd}', if (o.eta != null) 'ETA ${o.eta}',
      ].join(' · '), style: t.textTheme.bodySmall),
      if (china && perms.canEditShipping) ...[const Divider(),
        Text(tw(context, 'orders.chinaPart'), style: t.textTheme.labelSmall),
        if (!shipped) seDropdown('o-production', l.orProduction, prodOpts.contains(prod) ? prod : 'NEW', prodOpts, (x) => tw(context, 'orders.prod.$x'), (v) => setState(() => prod = v), allowEmpty: false),
        f('tracking', l.orTracking), f('container', l.orContainer), Row(children: [Expanded(child: f('etd', l.orEtd)), const SizedBox(width: 8), Expanded(child: f('eta', l.orEta))]),
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          FilledButton.tonal(key: const Key('o-save-china'), onPressed: busy ? null : () => _save({if (!shipped) 'production': prod, 'tracking': nn('tracking'), 'container': nn('container'), 'etd': nn('etd'), 'eta': nn('eta')}), child: Text(l.save)),
          if (!shipped) FilledButton(key: const Key('o-mark-shipped'), onPressed: busy || !canShip ? null : () => _save({'production': 'SHIPPED', 'tracking': nn('tracking'), 'container': nn('container'), 'etd': nn('etd'), 'eta': nn('eta')}), child: Text(tw(context, 'ship.markShipped'))),
          if (!shipped && !canShip) Text(tw(context, 'ship.needForShip'), style: const TextStyle(color: Colors.orange, fontSize: 12)),
          if (shipped) Text('✓ ${tw(context, 'ship.shippedNote')}', key: const Key('o-shipped'), style: const TextStyle(color: Colors.green, fontSize: 12)),
        ])],
      if (india && (perms.canEditPayment || perms.canEditShipping)) ...[const Divider(),
        Text(tw(context, 'orders.indiaPart'), style: t.textTheme.labelSmall),
        if (perms.canEditShipping) shipped
            ? seDropdown('o-india', l.orShipment, ind, indOpts.contains(ind) ? indOpts : [ind, ...indOpts], (x) => tw(context, 'orders.ind.$x'), (v) => setState(() => ind = v), allowEmpty: false)
            : Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(tw(context, 'ship.indiaLocked'), key: const Key('o-india-locked'), style: t.textTheme.bodySmall)),
        if (perms.canEditPayment) seDropdown('o-pay', l.orPayment, pay, const ['PENDING', 'PARTIAL', 'PAID'], (x) => tw(context, 'orders.pay.$x'), (v) => setState(() => pay = v), allowEmpty: false),
        Row(children: [if (perms.canEditPayment) Expanded(child: f('advance', l.orAdvance)), if (perms.canEditPayment && perms.canEditShipping) const SizedBox(width: 8), if (perms.canEditShipping) Expanded(child: f('expectedShip', l.orExpectedShip))]),
        FilledButton.tonal(key: const Key('o-save-india'), onPressed: busy ? null : () => _saveIndia(shipped, perms, nn), child: Text(l.save))],
    ])));
  }
}
