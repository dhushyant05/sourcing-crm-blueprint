import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../data/models/models.dart';
import '../../l10n/l10n.dart';
import '../../services/session.dart';
import '../widgets/se_codes.dart';

/// India: prepare the INR customer quote → branded PDF (server) → share via WhatsApp/email/link → accepted/rejected → order.
class CustomerQuoteScreen extends StatefulWidget {
  const CustomerQuoteScreen({super.key, required this.quote, this.lead});
  final LeadQuote quote;
  final Lead? lead;
  @override
  State<CustomerQuoteScreen> createState() => _CustomerQuoteScreenState();
}

class _CustomerQuoteScreenState extends State<CustomerQuoteScreen> {
  late LeadQuote q = widget.quote;
  late final Map<String, TextEditingController> _c;
  String _term = '', _mode = '';
  bool _busy = false;
  String? _err;

  @override
  void initState() {
    super.initState();
    final cq = q.cq ?? {};
    String s(String k, [Object? d]) => (cq[k] ?? d ?? '').toString();
    _c = {
      'qty': TextEditingController(text: s('qty', widget.lead?.quantity?.toStringAsFixed(0))), 'unitPrice': TextEditingController(text: s('unitPrice', q.clientPrice)),
      'gstPct': TextEditingController(text: s('gstPct', 18)), 'shipCost': TextEditingController(text: s('shipCost')), 'port': TextEditingController(text: s('port')),
      'transit': TextEditingController(text: s('transit')), 'otherCharges': TextEditingController(text: s('otherCharges')), 'otherLabel': TextEditingController(text: s('otherLabel')),
      'validity': TextEditingController(text: s('validity', q.validity)), 'terms': TextEditingController(text: s('terms')),
    };
    _term = s('shipTerm'); _mode = s('shipMode', q.shipMode);
    if (!incoterms.contains(_term)) _term = '';
    if (!shipModes.contains(_mode)) _mode = '';
  }

  double _n(String k) => double.tryParse(_c[k]!.text.replaceAll(',', '').trim()) ?? 0;

  Future<void> _run(Future<void> Function() f) async {
    setState(() { _busy = true; _err = null; });
    try { await f(); } catch (e) { if (mounted) setState(() => _err = '$e'); } finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _save() async {
    if (_n('qty') <= 0 || _c['unitPrice']!.text.trim().isEmpty) return setState(() => _err = context.l10n.cqErr);
    final repo = context.read<Session>().repo;
    await _run(() async {
      final b = {for (final e in _c.entries) e.key: e.value.text.trim(), 'shipTerm': _term.isEmpty ? null : _term, 'shipMode': _mode.isEmpty ? null : _mode};
      var nq = await repo.saveCustomerQuote(q.id, b);
      nq = await repo.quotePdf(nq.id);
      setState(() => q = nq);
    });
  }

  String get _url => context.read<Session>().repo.absoluteUrl(q.pdfUrl!);
  String get _msg {
    final ref = q.label ?? q.leadRef ?? '';
    return 'Hello ${widget.lead?.contactName ?? widget.lead?.clientName ?? ''}, here is the Source Easy quotation $ref for ${q.product}: $_url\n— Source Easy · Sourcing made easy · sourceeasy.in';
  }

  Future<void> _share(String how) async {
    final phone = (widget.lead?.contactPhone ?? '').replaceAll(RegExp(r'\D'), '');
    final wa = 'https://wa.me/${phone.length == 10 ? '91$phone' : phone}?text=${Uri.encodeComponent(_msg)}';
    final text = how == 'wa' ? wa : how == 'mail' ? 'mailto:${widget.lead?.contactEmail ?? ''}?subject=${Uri.encodeComponent('Quotation ${q.label ?? ''} – ${q.product}')}&body=${Uri.encodeComponent(_msg)}' : _msg;
    await SharePlus.instance.share(ShareParams(text: text, subject: 'Quotation ${q.label ?? ''}'));
    if (q.status == 'DRAFT' && mounted) await _status('SENT');
  }

  Future<void> _status(String s, [String? reason]) async {
    final repo = context.read<Session>().repo;
    await _run(() async { final nq = await repo.setQuoteStatus(q.id, s, reason); setState(() => q = nq); });
  }

  Future<void> _reject() async {
    final l = context.l10n, c = TextEditingController();
    final r = await showDialog<String>(context: context, builder: (d) => AlertDialog(title: Text(l.cqReject),
        content: TextField(key: const Key('cq-reason'), controller: c, decoration: InputDecoration(labelText: l.cqReason)),
        actions: [TextButton(onPressed: () => Navigator.pop(d), child: Text(l.cancel)), FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: Text(l.save))]));
    if (r != null && r.isNotEmpty) await _status('REJECTED', r);
  }

  Future<void> _order() async {
    final repo = context.read<Session>().repo, l = context.l10n;
    await _run(() async {
      await repo.createOrder(q.id, {'qty': q.cq?['qty'], 'agreedPrice': q.cq?['unitPrice'], 'paymentStatus': 'PENDING'});
      final nq = (await repo.leadQuotes(q.leadId ?? widget.lead?.id ?? '')).where((x) => x.id == q.id).firstOrNull;
      if (nq != null) setState(() => q = nq);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.cqOrderCreated)));
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, t = Theme.of(context);
    final decided = q.status == 'ACCEPTED' || q.status == 'REJECTED';
    Widget f(String k, String label, {TextInputType kb = const TextInputType.numberWithOptions(decimal: true), int lines = 1}) => Padding(padding: const EdgeInsets.only(bottom: 10),
        child: TextField(key: Key('cq-$k'), controller: _c[k], keyboardType: kb, maxLines: lines, enabled: !decided, onChanged: (_) => setState(() {}),
            decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true)));
    final sub = _n('qty') * _n('unitPrice'), taxable = sub + _n('shipCost') + _n('otherCharges'), gst = taxable * _n('gstPct') / 100;
    return Scaffold(
      appBar: AppBar(title: Text('${l.cqTitle} · ${q.label ?? ''}')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [Expanded(child: Text(q.product, style: t.textTheme.titleMedium)), QuoteStatusChip(q.status)]),
        if (q.sentAt != null) Text('${l.qsSENT}: ${q.sentAt!.substring(0, 10)}', style: t.textTheme.bodySmall),
        if (q.rejectReason != null) Text('${l.qsREJECTED}: ${q.rejectReason}', style: t.textTheme.bodySmall),
        const SizedBox(height: 12),
        Row(children: [Expanded(child: f('unitPrice', l.cqUnit)), const SizedBox(width: 8), Expanded(child: f('qty', l.cqQty)), const SizedBox(width: 8), SizedBox(width: 80, child: f('gstPct', l.cqGst))]),
        Text(l.shipTitle, style: t.textTheme.titleSmall), const SizedBox(height: 6),
        f('shipCost', l.shipCostInr),
        Row(children: [
          Expanded(child: seDropdown('cq-term', l.shipTerm, _term, incoterms, (o) => seCode(l, 'term', o), (v) => setState(() => _term = v))), const SizedBox(width: 8),
          Expanded(child: seDropdown('cq-mode', l.shipMode, _mode, shipModes, (o) => seCode(l, 'mode', o), (v) => setState(() => _mode = v))),
        ]),
        Row(children: [Expanded(child: f('port', l.shipPort, kb: TextInputType.text)), const SizedBox(width: 8), Expanded(child: f('transit', l.shipTransit, kb: TextInputType.text))]),
        Row(children: [Expanded(child: f('otherCharges', l.cqOther)), const SizedBox(width: 8), Expanded(child: f('otherLabel', l.cqOtherLabel, kb: TextInputType.text))]),
        f('validity', l.cqValidity, kb: TextInputType.text), f('terms', l.cqTerms, kb: TextInputType.multiline, lines: 3),
        Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
          for (final r in [(l.cqSubtotal, sub), (l.shipCost, _n('shipCost')), (l.cqOther, _n('otherCharges')), ('${l.cqGstAmt} ${_n('gstPct')}%', gst)])
            Row(children: [Expanded(child: Text(r.$1)), Text(inr(r.$2))]),
          const Divider(),
          Row(children: [Expanded(child: Text(l.cqTotal, style: const TextStyle(fontWeight: FontWeight.bold))), Text(inr(taxable + gst), key: const Key('cq-total'), style: TextStyle(fontWeight: FontWeight.bold, color: t.colorScheme.primary))]),
        ]))),
        if (_err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err!, style: TextStyle(color: t.colorScheme.error))),
        const SizedBox(height: 12),
        if (!decided) FilledButton.icon(key: const Key('cq-generate'), onPressed: _busy ? null : _save, icon: const Icon(Icons.picture_as_pdf_outlined), label: Text(l.cqGenerate)),
        if (q.pdfUrl != null && !decided) Wrap(spacing: 8, children: [
          OutlinedButton.icon(key: const Key('cq-wa'), onPressed: () => _share('wa'), icon: const Icon(Icons.chat_outlined), label: Text(l.cqWhatsapp)),
          OutlinedButton.icon(key: const Key('cq-mail'), onPressed: () => _share('mail'), icon: const Icon(Icons.mail_outline), label: Text(l.cqEmail)),
          OutlinedButton.icon(key: const Key('cq-share'), onPressed: () => _share('link'), icon: const Icon(Icons.share_outlined), label: Text(l.cqShare)),
          if (q.status == 'DRAFT') TextButton(onPressed: _busy ? null : () => _status('SENT'), child: Text(l.cqMarkSent)),
        ]),
        if (q.status == 'SENT') Wrap(spacing: 8, children: [
          FilledButton(key: const Key('cq-accept'), onPressed: _busy ? null : () => _status('ACCEPTED'), child: Text(l.cqAccept)),
          OutlinedButton(key: const Key('cq-reject'), onPressed: _busy ? null : _reject, child: Text(l.cqReject)),
        ]),
        if (q.status == 'ACCEPTED' && q.orderId == null) FilledButton.icon(key: const Key('cq-order'), onPressed: _busy ? null : _order, icon: const Icon(Icons.inventory_2_outlined), label: Text(l.cqCreateOrder)),
        if (q.orderId != null) ListTile(leading: const Icon(Icons.inventory_2_outlined), title: Text(l.cqOrderCreated)),
      ]),
    );
  }
}
