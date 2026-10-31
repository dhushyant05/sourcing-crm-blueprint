import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/currency.dart';
import '../../core/roles.dart';
import '../../data/models/models.dart';
import '../../services/quote_pdf.dart';
import '../../services/session.dart';
import '../widgets/common.dart';
import 'approval_screen.dart';

/// Step 5/6: quotations for a sourcing request with RMB/USD/INR toggle.
/// China sees raw supplier cost; India sees INR + client price and shares the PDF.
class QuotationScreen extends StatefulWidget {
  const QuotationScreen({super.key, required this.lead, required this.request});
  final Lead lead;
  final SourcingRequest request;
  @override
  State<QuotationScreen> createState() => _QuotationScreenState();
}

class _QuotationScreenState extends State<QuotationScreen> {
  late Future<(List<Quotation>, RateTable, List<Supplier>)> _f;
  String? _currency;

  @override
  void initState() {
    super.initState();
    _f = _load();
  }

  Future<(List<Quotation>, RateTable, List<Supplier>)> _load() async {
    final repo = context.read<Session>().repo;
    return (
      await repo.quotations(sourcingRequestId: widget.request.id),
      await repo.rates(),
      await repo.suppliers(sourcingRequestId: widget.request.id),
    );
  }

  void _reload() => setState(() => _f = _load());

  double get _qty => widget.request.quantity ?? widget.lead.quantity ?? 1;

  Future<void> _addQuotation(RateTable rates, List<Supplier> suppliers) async {
    final unit = TextEditingController();
    var cur = 'CNY';
    String? supplierId = suppliers.isEmpty ? null : suppliers.first.id;
    DateTime valid = DateTime.now().add(const Duration(days: 15));
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => StatefulBuilder(
        builder: (d, set) => AlertDialog(
          title: const Text('New quotation'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            if (suppliers.isNotEmpty)
              DropdownButtonFormField<String>(
                initialValue: supplierId,
                decoration: const InputDecoration(labelText: 'Supplier'),
                items: suppliers.map((s) => DropdownMenuItem(value: s.id, child: Text(s.name))).toList(),
                onChanged: (v) => supplierId = v,
              ),
            const SizedBox(height: 12),
            TextField(controller: unit, keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Unit cost')),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [ButtonSegment(value: 'CNY', label: Text('RMB')), ButtonSegment(value: 'USD', label: Text('USD'))],
              selected: {cur},
              onSelectionChanged: (v) => set(() => cur = v.first),
            ),
            const SizedBox(height: 8),
            Text('Qty ${_qty.toStringAsFixed(0)} · valid until ${dateFmt.format(valid)}'),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Save')),
          ],
        ),
      ),
    );
    final cost = double.tryParse(unit.text);
    if (ok != true || cost == null || !mounted) return;
    final repo = context.read<Session>().repo;
    final r = await repo.createQuotation(sourcingRequestId: widget.request.id, supplierId: supplierId,
        unitCost: cost, quantity: _qty, currency: cur, rates: rates, validUntil: valid);
    await repo.updateLead(widget.lead.id, {'status': 'QUOTED'});
    if (mounted) showWriteResult(context, r, 'Quotation');
    _reload();
  }

  Future<void> _setClientPrice(Quotation q) async {
    final c = TextEditingController(text: q.clientUnitPriceInr?.toStringAsFixed(2));
    final v = await showDialog<double>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Client price (₹ per unit)'),
        content: TextField(controller: c, keyboardType: const TextInputType.numberWithOptions(decimal: true)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, double.tryParse(c.text)), child: const Text('Save')),
        ],
      ),
    );
    if (v == null || !mounted) return;
    final r = await context.read<Session>().repo.setClientPrice(q.id, v);
    if (mounted) showWriteResult(context, r, 'Client price');
    _reload();
  }

  Future<void> _share(Quotation q) async {
    if (q.clientUnitPriceInr == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Set the client price first')));
      return;
    }
    await QuotePdf.share(QuoteData(
      quoteNo: '${widget.lead.id.substring(0, 6).toUpperCase()}-${q.id.substring(0, 4).toUpperCase()}',
      clientName: widget.lead.clientName ?? widget.lead.name,
      product: widget.request.productDescription ?? widget.request.name,
      quantity: _qty,
      unitPrice: q.clientUnitPriceInr!,
      currency: 'INR',
      validUntil: q.validityDate,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<Session>().perms;
    final options = p.quoteCurrencies;
    _currency ??= options.contains('INR') ? 'INR' : options.first;
    return Scaffold(
      appBar: AppBar(title: Text(widget.request.productDescription ?? 'Quotations')),
      body: AsyncView<(List<Quotation>, RateTable, List<Supplier>)>(
        future: _f,
        onRetry: _reload,
        builder: (c, data) {
          final (quotes, rates, suppliers) = data;
          return Scaffold(
            floatingActionButton: p.canCreateQuotation
                ? FloatingActionButton.extended(
                    onPressed: () => _addQuotation(rates, suppliers), icon: const Icon(Icons.add), label: const Text('Quotation'))
                : null,
            body: ListView(padding: const EdgeInsets.all(16), children: [
              if (options.length > 1)
                SegmentedButton<String>(
                  segments: options.map((o) => ButtonSegment(value: o, label: Text(currencyLabel(o)))).toList(),
                  selected: {_currency!},
                  onSelectionChanged: (v) => setState(() => _currency = v.first),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text('Rates: 1 RMB = ₹${rates.cnyToInr.toStringAsFixed(2)} · 1 USD = ₹${rates.usdToInr.toStringAsFixed(2)} (admin set)',
                    style: Theme.of(c).textTheme.bodySmall),
              ),
              if (p.canSeeSupplierDetails && suppliers.isNotEmpty) ...[
                Text('Suppliers', style: Theme.of(c).textTheme.titleSmall),
                ...suppliers.map((s) => ListTile(dense: true, leading: const Icon(Icons.factory_outlined),
                    title: Text(s.name), subtitle: Text([s.phone, if (s.wechatId != null) 'WeChat ${s.wechatId}'].whereType<String>().join(' · ')))),
              ],
              if (quotes.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No quotations yet'))),
              ...quotes.map((q) => _QuoteCard(
                    q: q, rates: rates, currency: _currency!, qty: _qty, perms: p,
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

/// Unit and total for display, converted into [target].
/// India (no raw cost) uses the stored INR snapshot.
({double unit, double total}) quoteAmounts(Quotation q, RateTable rates, String target, double qty) {
  if (q.unitCost > 0) {
    final unit = target == 'INR' && q.exchangeRateUsed != null && q.currency != 'INR'
        ? q.unitCost * q.exchangeRateUsed!
        : rates.convert(q.unitCost, q.currency, target);
    return (unit: unit, total: unit * qty);
  }
  final totalInr = q.inrEquivalent ?? 0;
  return (unit: qty == 0 ? 0 : totalInr / qty, total: totalInr);
}

class _QuoteCard extends StatelessWidget {
  const _QuoteCard({required this.q, required this.rates, required this.currency, required this.qty,
      required this.perms, required this.onClientPrice, required this.onShare, required this.onApproval});
  final Quotation q;
  final RateTable rates;
  final String currency;
  final double qty;
  final Permissions perms;
  final VoidCallback onClientPrice, onShare, onApproval;

  @override
  Widget build(BuildContext context) {
    final a = quoteAmounts(q, rates, currency, qty);
    final t = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(q.name, style: t.textTheme.titleMedium)),
            Text('quoted in ${currencyLabel(q.currency)}', style: t.textTheme.bodySmall),
          ]),
          const SizedBox(height: 8),
          InfoRow(perms.canSeeRawSupplierCost ? 'Unit cost' : 'Landed cost/unit', formatMoney(a.unit, currency)),
          InfoRow('Total', formatMoney(a.total, currency)),
          if (q.exchangeRateUsed != null) InfoRow('Rate used', '1 ${currencyLabel(q.currency)} = ₹${q.exchangeRateUsed!.toStringAsFixed(4)}'),
          if (perms.canSeeClientPricing) ...[
            InfoRow('Client price/unit', q.clientUnitPriceInr == null ? null : formatMoney(q.clientUnitPriceInr!, 'INR')),
            if (q.clientUnitPriceInr != null && a.unit > 0 && currency == 'INR')
              InfoRow('Margin', '${(((q.clientUnitPriceInr! - a.unit) / q.clientUnitPriceInr!) * 100).toStringAsFixed(1)}%'),
          ],
          if (q.validityDate != null) InfoRow('Valid until', dateFmt.format(q.validityDate!)),
          if (perms.canGenerateClientQuote)
            Wrap(spacing: 8, children: [
              TextButton.icon(onPressed: onClientPrice, icon: const Icon(Icons.edit), label: const Text('Client price')),
              FilledButton.tonalIcon(onPressed: onShare, icon: const Icon(Icons.share), label: const Text('PDF to WhatsApp')),
              OutlinedButton.icon(onPressed: onApproval, icon: const Icon(Icons.how_to_vote_outlined), label: const Text('Approval')),
            ]),
        ]),
      ),
    );
  }
}
