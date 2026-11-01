import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../l10n/l10n.dart';
import '../../services/session.dart';
import 'lead_attachments.dart';
import 'media_picker.dart';
import 'se_codes.dart';
import '../screens/customer_quote_screen.dart';

const quoteCurrencies = [('USD', r'$', 'USD'), ('CNY', '¥', 'RMB'), ('INR', '₹', 'INR')];
String quoteMoney(double? n, String? c) {
  if (n == null) return '—';
  final cur = quoteCurrencies.where((x) => x.$1 == c).firstOrNull;
  final v = n == n.roundToDouble() ? n.toStringAsFixed(0) : n.toString();
  return '${cur?.$2 ?? ''}$v ${cur?.$3 ?? c ?? ''}';
}

/// Supplier quotes on a lead. China adds/edits (with supplier + media); India sees product/price/media and adds its INR selling price.
class LeadQuotesSection extends StatefulWidget {
  const LeadQuotesSection({super.key, required this.leadId, this.initial, this.lead});
  final String leadId;
  final Lead? lead;
  final List<LeadQuote>? initial; // for tests/screenshots
  @override
  State<LeadQuotesSection> createState() => _LeadQuotesSectionState();
}

class _LeadQuotesSectionState extends State<LeadQuotesSection> {
  List<LeadQuote>? _list;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) { _list = widget.initial; } else { _load(); }
  }

  Future<void> _load() async {
    try {
      final l = await context.read<Session>().repo.leadQuotes(widget.leadId);
      if (mounted) setState(() { _list = l; _failed = false; });
    } catch (_) {
      if (mounted) setState(() { _list ??= []; _failed = true; });
    }
  }

  Future<void> _edit([LeadQuote? q]) async {
    final r = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => QuoteFormScreen(leadId: widget.leadId, quote: q)));
    if (r == true) await _load();
  }

  Future<void> _delete(LeadQuote q) async {
    final l = context.l10n;
    final ok = await showDialog<bool>(context: context, builder: (d) => AlertDialog(title: Text(l.lqDeleteQ(q.product)), actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: Text(l.delete)),
        ]));
    if (ok != true || !mounted) return;
    try { await context.read<Session>().repo.deleteLeadQuote(q.id); await _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); }
  }

  Future<void> _sell(LeadQuote q) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => CustomerQuoteScreen(quote: q, lead: widget.lead)));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, t = Theme.of(context), p = context.watch<Session>().perms;
    final china = p.canCreateQuotation, india = p.canSeeClientPricing;
    final list = _list;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text('${l.lqTitle}${list != null && list.isNotEmpty ? ' · ${list.length}' : ''}', style: t.textTheme.titleSmall)),
        if (china) FilledButton.tonalIcon(key: const Key('quote-add'), onPressed: () => _edit(), icon: const Icon(Icons.add), label: Text(l.lqAdd)),
      ]),
      if (_failed) Text(l.lqLoadFail, style: TextStyle(color: t.colorScheme.error)),
      if (list == null) const Padding(padding: EdgeInsets.all(8), child: LinearProgressIndicator())
      else if (list.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(china ? l.lqNoneChina : l.lqNone, style: t.textTheme.bodySmall))
      else ...[for (var i = 0; i < list.length; i++) _card(list[i], i, china, india)],
      if (china && list != null && list.isNotEmpty) Text(l.lqReturnHint, style: t.textTheme.bodySmall),
    ]);
  }

  Widget _card(LeadQuote q, int i, bool china, bool india) {
    final l = context.l10n, t = Theme.of(context);
    Widget kv(String k, String? v) => Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: t.textTheme.labelSmall?.copyWith(color: t.hintColor)), Text(v == null || v.isEmpty ? '—' : v, style: t.textTheme.bodySmall)]));
    return Card(key: Key('quote-${q.id}'), margin: const EdgeInsets.symmetric(vertical: 6), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Text(q.label ?? 'Q${i + 1}', style: t.textTheme.labelSmall?.copyWith(color: t.hintColor)), const SizedBox(width: 6), QuoteStatusChip(q.status)]),
          Text(q.product, style: t.textTheme.titleSmall),
          Text('${quoteMoney(q.unitPrice, q.currency)} / ${l.lqUnit}', style: t.textTheme.titleMedium?.copyWith(color: t.colorScheme.primary, fontWeight: FontWeight.w600)),
        ])),
        if (q.canEdit) ...[
          IconButton(tooltip: l.lqEdit, onPressed: () => _edit(q), icon: const Icon(Icons.edit_outlined)),
          IconButton(tooltip: l.delete, onPressed: () => _delete(q), icon: const Icon(Icons.delete_outline)),
        ],
      ]),
      const SizedBox(height: 6),
      Row(children: [kv(l.lqMoq, q.moq), kv(l.lqLeadTime, q.leadTime), kv(l.lqValidity, q.validity)]),
      if (q.shipCost != null || q.shipTerm != null || q.shipMode != null || q.shipPort != null || q.shipTransit != null) Padding(padding: const EdgeInsets.only(top: 6),
          child: Text('${l.shipTitle}: ${[if (q.shipCost != null) quoteMoney(q.shipCost, q.shipCurrency ?? q.currency), if (q.shipTerm != null) seCode(l, 'term', q.shipTerm), if (q.shipMode != null) seCode(l, 'mode', q.shipMode), q.shipPort, q.shipTransit].whereType<String>().where((x) => x.isNotEmpty).join(' · ')}', key: const Key('quote-ship'), style: t.textTheme.bodySmall)),
      if ((q.notes ?? '').isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(q.notes!, style: t.textTheme.bodySmall)),
      if (china && q.supplier != null) Container(
        margin: const EdgeInsets.only(top: 8), padding: const EdgeInsets.all(8), width: double.infinity,
        decoration: BoxDecoration(color: Colors.amber.withValues(alpha: .15), borderRadius: BorderRadius.circular(8)),
        child: Text([
          '${l.lqSupplier}: ${q.supplier!.name}', q.supplier!.contact, q.supplier!.phone, if (q.supplier!.wechat != null) 'WeChat ${q.supplier!.wechat}', q.supplier!.city, '(${l.lqChinaOnly})'
        ].whereType<String>().where((s) => s.isNotEmpty).join(' · '), style: t.textTheme.bodySmall),
      ),
      if (china && q.createdByName != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(l.lqBy(q.createdByName!), style: t.textTheme.labelSmall?.copyWith(color: t.hintColor))),
      if (q.files.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: QuoteFilesStrip(quote: q)),
      if (india) Container(
        margin: const EdgeInsets.only(top: 8), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: t.colorScheme.primaryContainer.withValues(alpha: .4), borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          Expanded(child: Text('${l.lqSellPrice}: ${q.clientPrice != null ? quoteMoney(q.clientPrice, q.clientCurrency ?? 'INR') : '—'}${q.cqTotals != null ? ' · ${l.cqTotal} ${inr(q.cqTotals!['total'] as num?)}' : ''}', style: t.textTheme.bodySmall)),
          TextButton(key: Key('sell-${q.id}'), onPressed: () => _sell(q), child: Text(l.cqPrepare)),
        ]),
      ),
    ])));
  }
}

/// Thumbnails of a quote's supplier photos/videos/docs, fetched with the staff token.
class QuoteFilesStrip extends StatefulWidget {
  const QuoteFilesStrip({super.key, required this.quote});
  final LeadQuote quote;
  @override
  State<QuoteFilesStrip> createState() => _QuoteFilesStripState();
}

class _QuoteFilesStripState extends State<QuoteFilesStrip> {
  final _bytes = <String, Uint8List>{};
  @override
  void initState() {
    super.initState();
    _thumbs();
  }

  Future<void> _thumbs() async {
    final imgs = widget.quote.files.where((a) => a.isImage).toList();
    if (imgs.isEmpty) return;
    final repo = context.read<Session>().repo;
    for (final a in imgs) {
      try { final b = Uint8List.fromList(await repo.quoteFileBytes(widget.quote.id, a)); if (mounted) setState(() => _bytes[a.id] = b); } catch (_) {}
    }
  }

  Future<void> _open(LeadAttachment a) async {
    final repo = context.read<Session>().repo;
    if (a.isVideo) {
      final s = repo.quoteFileStream(widget.quote.id, a);
      await Navigator.push(context, MaterialPageRoute(builder: (_) => VideoViewer(a: a, uri: s.uri, headers: s.headers)));
      return;
    }
    final b = _bytes[a.id] ??= Uint8List.fromList(await repo.quoteFileBytes(widget.quote.id, a));
    if (!mounted) return;
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ImageViewer(a: a, bytes: b, onShare: () async {})));
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Wrap(spacing: 6, runSpacing: 6, children: [
      for (final a in widget.quote.files)
        InkWell(
          onTap: () => _open(a),
          child: Container(
            width: 84, height: 84, clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), color: t.colorScheme.surfaceContainerHighest),
            child: _bytes[a.id] != null
                ? Image.memory(_bytes[a.id]!, fit: BoxFit.cover)
                : Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(a.isVideo ? Icons.play_circle_outline : a.mime.contains('pdf') ? Icons.picture_as_pdf_outlined : a.isImage ? Icons.image_outlined : Icons.description_outlined),
                    Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: t.textTheme.labelSmall)),
                  ]),
          ),
        ),
    ]);
  }
}

/// Add / edit a supplier quote (China side).
class QuoteFormScreen extends StatefulWidget {
  const QuoteFormScreen({super.key, required this.leadId, this.quote, this.suppliers});
  final String leadId;
  final LeadQuote? quote;
  final List<QuoteSupplier>? suppliers; // for tests
  @override
  State<QuoteFormScreen> createState() => _QuoteFormScreenState();
}

class _QuoteFormScreenState extends State<QuoteFormScreen> {
  late final _c = {
    for (final k in ['product', 'unitPrice', 'moq', 'leadTime', 'validity', 'notes', 'shipCost', 'shipPort', 'shipTransit', 'sName', 'sContact', 'sPhone', 'sWechat', 'sCity']) k: TextEditingController(),
  };
  List<QuoteSupplier> _sups = [];
  String _sup = '', _cur = 'USD', _shipCur = 'USD', _term = '', _mode = '';
  final _paths = <String>[];
  bool _busy = false;
  String? _err;
  List<LeadAttachment> _existing = [];

  @override
  void initState() {
    super.initState();
    final q = widget.quote;
    if (q != null) {
      _c['product']!.text = q.product; _c['unitPrice']!.text = q.unitPrice.toString(); _c['moq']!.text = q.moq ?? '';
      _c['leadTime']!.text = q.leadTime ?? ''; _c['validity']!.text = q.validity ?? ''; _c['notes']!.text = q.notes ?? '';
      _sup = q.supplierId ?? ''; _cur = q.currency; _existing = q.files;
      _c['shipCost']!.text = q.shipCost?.toString() ?? ''; _c['shipPort']!.text = q.shipPort ?? ''; _c['shipTransit']!.text = q.shipTransit ?? '';
      _shipCur = q.shipCurrency ?? q.currency; _term = q.shipTerm ?? ''; _mode = q.shipMode ?? '';
    }
    if (widget.suppliers != null) { _sups = widget.suppliers!; } else {
      context.read<Session>().repo.quoteSuppliers().then((s) { if (mounted) setState(() => _sups = s); }).catchError((_) {});
    }
  }

  Future<void> _save() async {
    final l = context.l10n;
    final price = double.tryParse(_c['unitPrice']!.text.trim());
    if (_c['product']!.text.trim().isEmpty) return setState(() => _err = l.lqErrProduct);
    if (price == null || price < 0) return setState(() => _err = l.lqErrPrice);
    if (_sup == '__new' && _c['sName']!.text.trim().isEmpty) return setState(() => _err = l.lqErrSupplier);
    final body = <String, dynamic>{
      'product': _c['product']!.text.trim(), 'unitPrice': price, 'currency': _cur, 'moq': _c['moq']!.text.trim(), 'leadTime': _c['leadTime']!.text.trim(),
      'validity': _c['validity']!.text.trim(), 'notes': _c['notes']!.text.trim(),
      'shipCost': _c['shipCost']!.text.trim().isEmpty ? null : _c['shipCost']!.text.trim(), 'shipCurrency': _shipCur, 'shipTerm': _term.isEmpty ? null : _term,
      'shipMode': _mode.isEmpty ? null : _mode, 'shipPort': _c['shipPort']!.text.trim(), 'shipTransit': _c['shipTransit']!.text.trim(),
      if (_sup == '__new') 'newSupplier': {'name': _c['sName']!.text.trim(), 'contact': _c['sContact']!.text.trim(), 'phone': _c['sPhone']!.text.trim(), 'wechat': _c['sWechat']!.text.trim(), 'city': _c['sCity']!.text.trim()}
      else 'supplierId': _sup.isEmpty ? null : _sup,
    };
    setState(() { _busy = true; _err = null; });
    final repo = context.read<Session>().repo;
    try {
      var q = widget.quote == null ? await repo.createLeadQuote(widget.leadId, body) : await repo.updateLeadQuote(widget.quote!.id, body);
      if (_paths.isNotEmpty) q = await repo.uploadQuoteFiles(q.id, _paths);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _err = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeExisting(LeadAttachment a) async {
    try { await context.read<Session>().repo.deleteQuoteFile(widget.quote!.id, a.id); setState(() => _existing = _existing.where((x) => x.id != a.id).toList()); }
    catch (e) { setState(() => _err = '$e'); }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, t = Theme.of(context);
    Widget f(String k, String label, {String? hint, TextInputType? kb, int lines = 1}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextField(key: Key('qf-$k'), controller: _c[k], keyboardType: kb, maxLines: lines, decoration: InputDecoration(labelText: label, hintText: hint, border: const OutlineInputBorder(), isDense: true)));
    return Scaffold(
      appBar: AppBar(title: Text(widget.quote == null ? l.lqAdd : l.lqEdit)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        DropdownButtonFormField<String>(
          key: const Key('qf-supplier'), initialValue: _sups.any((s) => s.id == _sup) || _sup == '__new' || _sup.isEmpty ? _sup : '',
          isExpanded: true,
          decoration: InputDecoration(labelText: '${l.lqSupplier} (${l.lqChinaOnly})', border: const OutlineInputBorder(), isDense: true),
          items: [
            DropdownMenuItem(value: '', child: Text(l.lqNoSupplier)),
            for (final s in _sups) DropdownMenuItem(value: s.id, child: Text(s.city == null || s.city!.isEmpty ? s.name : '${s.name} · ${s.city}')),
            DropdownMenuItem(value: '__new', child: Text('+ ${l.lqNewSupplier}')),
          ],
          onChanged: (v) => setState(() => _sup = v ?? ''),
        ),
        const SizedBox(height: 10),
        if (_sup == '__new') Container(
          padding: const EdgeInsets.fromLTRB(10, 10, 10, 0), margin: const EdgeInsets.only(bottom: 10),
          decoration: BoxDecoration(color: Colors.amber.withValues(alpha: .12), borderRadius: BorderRadius.circular(8)),
          child: Column(children: [f('sName', l.lqSupName), f('sContact', l.lqSupContact), f('sPhone', l.lqSupPhone, kb: TextInputType.phone), f('sWechat', 'WeChat'), f('sCity', l.lqSupCity)]),
        ),
        f('product', l.lqProduct, hint: l.lqProductPh),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: f('unitPrice', l.lqUnitPrice, kb: const TextInputType.numberWithOptions(decimal: true))),
          const SizedBox(width: 8),
          SizedBox(width: 120, child: DropdownButtonFormField<String>(
            key: const Key('qf-currency'), initialValue: _cur,
            decoration: InputDecoration(labelText: l.lqCurrency, border: const OutlineInputBorder(), isDense: true),
            items: [for (final c in quoteCurrencies) DropdownMenuItem(value: c.$1, child: Text('${c.$2} ${c.$3}'))],
            onChanged: (v) => setState(() => _cur = v ?? 'USD'),
          )),
        ]),
        Row(children: [
          Expanded(child: f('moq', l.lqMoq, hint: '1000 pcs')), const SizedBox(width: 8),
          Expanded(child: f('leadTime', l.lqLeadTime, hint: '15 days')), const SizedBox(width: 8),
          Expanded(child: f('validity', l.lqValidity, hint: '30 days')),
        ]),
        Text(l.shipTitle, style: t.textTheme.titleSmall), const SizedBox(height: 6),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: f('shipCost', l.shipCost, kb: const TextInputType.numberWithOptions(decimal: true))), const SizedBox(width: 8),
          SizedBox(width: 120, child: DropdownButtonFormField<String>(key: const Key('qf-shipCurrency'), initialValue: _shipCur,
            decoration: InputDecoration(labelText: l.lqCurrency, border: const OutlineInputBorder(), isDense: true),
            items: [for (final c in quoteCurrencies) DropdownMenuItem(value: c.$1, child: Text('${c.$2} ${c.$3}'))], onChanged: (v) => setState(() => _shipCur = v ?? 'USD'))),
        ]),
        Row(children: [
          Expanded(child: seDropdown('qf-term', l.shipTerm, _term, incoterms, (o) => seCode(l, 'term', o), (v) => setState(() => _term = v))), const SizedBox(width: 8),
          Expanded(child: seDropdown('qf-mode', l.shipMode, _mode, shipModes, (o) => seCode(l, 'mode', o), (v) => setState(() => _mode = v))),
        ]),
        Row(children: [Expanded(child: f('shipPort', l.shipPort, hint: 'Ningbo')), const SizedBox(width: 8), Expanded(child: f('shipTransit', l.shipTransit, hint: '20 days'))]),
        f('notes', l.lqNotes, lines: 3),
        Text(l.lqMedia, style: t.textTheme.titleSmall),
        const SizedBox(height: 6),
        for (final a in _existing) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.attach_file), title: Text(a.name), subtitle: Text(fileSize(a.size)),
            trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => _removeExisting(a))),
        for (final p in _paths) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.upload_file), title: Text(p.split('/').last),
            trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _paths.remove(p)))),
        Align(alignment: Alignment.centerLeft, child: OutlinedButton.icon(key: const Key('qf-media'), onPressed: () async {
          final ps = await pickMedia(context);
          if (ps.isNotEmpty) setState(() => _paths.addAll(ps));
        }, icon: const Icon(Icons.add_a_photo_outlined), label: Text(l.lqAddMedia))),
        if (_err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err!, style: TextStyle(color: t.colorScheme.error))),
        const SizedBox(height: 16),
        FilledButton(key: const Key('qf-save'), onPressed: _busy ? null : _save, child: _busy ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.save)),
      ]),
    );
  }
}
