import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../core/currency.dart';
import '../../core/roles.dart';
import '../../data/models/models.dart';
import '../../services/quote_pdf.dart';
import '../../services/session.dart';
import '../widgets/common.dart';
import '../widgets/currency_picker.dart';
import 'approval_screen.dart';

/// Step 5/6: quotations for a sourcing request. Each amount stays in the
/// currency it was entered in (USD, RMB or INR) — no conversion anywhere.
/// China sees supplier cost; India sees only its own client price and shares the PDF.
class QuotationScreen extends StatefulWidget {
  const QuotationScreen({super.key, required this.lead, required this.request});
  final Lead lead;
  final SourcingRequest request;
  @override
  State<QuotationScreen> createState() => _QuotationScreenState();
}

class _QuotationScreenState extends State<QuotationScreen> {
  late Future<(List<Quotation>, List<Supplier>)> _f;

  @override
  void initState() {
    super.initState();
    _f = _load();
  }

  Future<(List<Quotation>, List<Supplier>)> _load() async {
    final s = context.read<Session>();
    final repo = s.repo;
    return (
      await repo.quotations(sourcingRequestId: widget.request.id),
      s.perms.canSeeSupplierDetails ? await repo.suppliers(sourcingRequestId: widget.request.id) : <Supplier>[],
    );
  }

  void _reload() => setState(() => _f = _load());

  double get _qty => widget.request.quantity ?? widget.lead.quantity ?? 1;

  Future<void> _addQuotation(List<Supplier> suppliers) async {
    final unit = TextEditingController();
    var cur = 'CNY';
    String? supplierId = suppliers.isEmpty ? null : suppliers.first.id;
    final valid = DateTime.now().add(const Duration(days: 15));
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => StatefulBuilder(
        builder: (d, set) => AlertDialog(
          title: Text(context.l10n.newQuotation),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            if (suppliers.isNotEmpty)
              DropdownButtonFormField<String>(
                initialValue: supplierId,
                decoration: InputDecoration(labelText: context.l10n.supplier),
                items: suppliers.map((s) => DropdownMenuItem(value: s.id, child: Text(s.name))).toList(),
                onChanged: (v) => supplierId = v,
              ),
            const SizedBox(height: 12),
            TextField(key: const Key('unit-cost'), controller: unit, keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: context.l10n.unitCost, prefixText: '${currencySymbol(cur)} ')),
            const SizedBox(height: 12),
            CurrencyPicker(value: cur, onChanged: (v) => set(() => cur = v)),
            const SizedBox(height: 8),
            Text(context.l10n.qtyValidUntil(_qty.toStringAsFixed(0), dateFmt.format(valid))),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: Text(context.l10n.cancel)),
            FilledButton(onPressed: () => Navigator.pop(d, true), child: Text(context.l10n.save)),
          ],
        ),
      ),
    );
    final cost = double.tryParse(unit.text);
    if (ok != true || cost == null || !mounted) return;
    final repo = context.read<Session>().repo;
    final r = await repo.createQuotation(sourcingRequestId: widget.request.id, supplierId: supplierId,
        unitCost: cost, quantity: _qty, currency: cur, validUntil: valid);
    await repo.updateLead(widget.lead.id, {'status': 'QUOTED'});
    if (mounted) showWriteResult(context, r, context.l10n.quotation);
    _reload();
  }

  Future<void> _setClientPrice(Quotation q) async {
    final c = TextEditingController(text: q.clientUnitPrice?.toStringAsFixed(2));
    var cur = q.clientCurrency ?? 'INR';
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => StatefulBuilder(
        builder: (d, set) => AlertDialog(
          title: Text(context.l10n.clientPricePerUnit),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(key: const Key('client-price'), controller: c, autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(prefixText: '${currencySymbol(cur)} ')),
            const SizedBox(height: 12),
            CurrencyPicker(value: cur, onChanged: (v) => set(() => cur = v)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: Text(context.l10n.cancel)),
            FilledButton(onPressed: () => Navigator.pop(d, true), child: Text(context.l10n.save)),
          ],
        ),
      ),
    );
    final v = double.tryParse(c.text);
    if (ok != true || v == null || !mounted) return;
    final r = await context.read<Session>().repo.setClientPrice(q.id, v, cur);
    if (mounted) showWriteResult(context, r, context.l10n.clientPrice);
    _reload();
  }

  Future<void> _share(Quotation q) async {
    if (q.clientUnitPrice == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.l10n.setTheClientPriceFirst)));
      return;
    }
    await QuotePdf.share(QuoteData(
      quoteNo: '${widget.lead.id.substring(0, 6).toUpperCase()}-${q.id.substring(0, 4).toUpperCase()}',
      clientName: widget.lead.clientName ?? widget.lead.name,
      product: widget.request.productDescription ?? widget.request.name,
      quantity: _qty,
      unitPrice: q.clientUnitPrice!,
      currency: q.clientCurrency ?? 'INR',
      validUntil: q.validityDate,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<Session>().perms;
    return Scaffold(
      appBar: AppBar(title: Text(widget.request.productDescription ?? context.l10n.quotations)),
      body: AsyncView<(List<Quotation>, List<Supplier>)>(
        future: _f,
        onRetry: _reload,
        builder: (c, data) {
          final (quotes, suppliers) = data;
          return Scaffold(
            floatingActionButton: p.canCreateQuotation
                ? FloatingActionButton.extended(
                    onPressed: () => _addQuotation(suppliers), icon: Icon(Icons.add), label: Text(context.l10n.quotation))
                : null,
            body: ListView(padding: const EdgeInsets.all(16), children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(context.l10n.amountsAreShownInTheCurrency,
                    style: Theme.of(c).textTheme.bodySmall),
              ),
              if (p.canSeeSupplierDetails && suppliers.isNotEmpty) ...[
                Text(context.l10n.suppliers, style: Theme.of(c).textTheme.titleSmall),
                ...suppliers.map((s) => ListTile(dense: true, leading: const Icon(Icons.factory_outlined),
                    title: Text(s.name), subtitle: Text([s.phone, if (s.wechatId != null) 'WeChat ${s.wechatId}'].whereType<String>().join(' · ')))),
              ],
              if (quotes.isEmpty) Padding(padding: EdgeInsets.all(24), child: Center(child: Text(context.l10n.noQuotationsYet))),
              ...quotes.map((q) => QuoteCard(
                    q: q, qty: _qty, perms: p,
                    onClientPrice: () => _setClientPrice(q),
                    onShare: () => _share(q),
                    onApproval: () async {
                      await Navigator.push(c, MaterialPageRoute(builder: (_) => ApprovalScreen(lead: widget.lead, quotation: q)));
                      _reload();
                    },
                  )),
              const SizedBox(height: 80),
            ]),
          );
        },
      ),
    );
  }
}

class QuoteCard extends StatelessWidget {
  const QuoteCard({super.key, required this.q, required this.qty,
      required this.perms, required this.onClientPrice, required this.onShare, required this.onApproval});
  final Quotation q;
  final double qty;
  final Permissions perms;
  final VoidCallback onClientPrice, onShare, onApproval;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final cp = q.clientUnitPrice, cc = q.clientCurrency ?? 'INR';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(q.name, style: t.textTheme.titleMedium),
          const SizedBox(height: 8),
          if (perms.canSeeRawSupplierCost) ...[
            InfoRow(context.l10n.supplierCostUnit, formatMoneyCode(q.unitCost, q.currency)),
            InfoRow(context.l10n.supplierTotal, formatMoneyCode(q.totalCost ?? q.unitCost * qty, q.currency)),
          ],
          if (perms.canSeeClientPricing) ...[
            InfoRow(context.l10n.clientPriceUnit, cp == null ? null : formatMoneyCode(cp, cc)),
            if (cp != null) InfoRow(context.l10n.clientTotal, formatMoneyCode(cp * qty, cc)),
          ],
          if (q.validityDate != null) InfoRow(context.l10n.validUntil, dateFmt.format(q.validityDate!)),
          if (perms.canGenerateClientQuote)
            Wrap(spacing: 8, children: [
              TextButton.icon(onPressed: onClientPrice, icon: Icon(Icons.edit), label: Text(context.l10n.clientPrice)),
              FilledButton.tonalIcon(onPressed: onShare, icon: Icon(Icons.share), label: Text(context.l10n.pdfToWhatsApp)),
              OutlinedButton.icon(onPressed: onApproval, icon: Icon(Icons.how_to_vote_outlined), label: Text(context.l10n.approval)),
            ]),
        ]),
      ),
    );
  }
}
