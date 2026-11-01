import 'package:flutter/material.dart';

import '../../l10n/codes.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/currency_picker.dart';
import '../widgets/common.dart';

/// Step 3: China creates a sourcing request for a lead and logs suppliers.
class SourcingFormScreen extends StatefulWidget {
  const SourcingFormScreen({super.key, required this.lead});
  final Lead lead;
  @override
  State<SourcingFormScreen> createState() => _SourcingFormScreenState();
}

class _SourcingFormScreenState extends State<SourcingFormScreen> {
  final _form = GlobalKey<FormState>();
  late final _product = TextEditingController(text: widget.lead.productInterest);
  late final _qty = TextEditingController(text: widget.lead.quantity?.toStringAsFixed(0));
  final _price = TextEditingController();
  final _suppliers = TextEditingController();
  String _currency = 'CNY', _sample = 'NOT_REQUESTED';
  DateTime? _deadline;
  bool _busy = false;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final s = context.read<Session>();
    try {
      final r = await s.repo.createSourcingRequest(
        leadId: widget.lead.id,
        product: _product.text.trim(),
        quantity: double.tryParse(_qty.text),
        targetPrice: double.tryParse(_price.text),
        currency: _currency,
        deadline: _deadline,
        agent: s.displayName,
        sampleStatus: _sample,
      );
      final srId = r.record?['id'] as String?;
      if (srId != null) {
        for (final name in _suppliers.text.split('\n').map((e) => e.trim()).where((e) => e.isNotEmpty)) {
          await s.repo.createSupplier(srId, name);
        }
      }
      await s.repo.updateLead(widget.lead.id, {'status': 'SOURCING'});
      await s.refreshPending();
      if (!mounted) return;
      showWriteResult(context, r, context.l10n.sourcingRequest);
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.sourcingRequest)),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          TextFormField(controller: _product, maxLines: 3, decoration: InputDecoration(labelText: context.l10n.productDescription),
              validator: (v) => v == null || v.trim().isEmpty ? context.l10n.required : null),
          gap,
          Row(children: [
            Expanded(child: TextFormField(controller: _qty, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: context.l10n.quantity))),
            const SizedBox(width: 12),
            Expanded(child: TextFormField(controller: _price, keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: context.l10n.targetPriceUnit))),
          ]),
          gap,
          CurrencyPicker(value: _currency, onChanged: (v) => setState(() => _currency = v)),
          gap,
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.event),
            title: Text(_deadline == null ? context.l10n.setDeadline : 'Deadline: ${dateFmt.format(_deadline!)}'),
            onTap: () async {
              final d = await showDatePicker(context: context, firstDate: DateTime.now(),
                  lastDate: DateTime.now().add(const Duration(days: 365)), initialDate: DateTime.now().add(const Duration(days: 7)));
              if (d != null) setState(() => _deadline = d);
            },
          ),
          DropdownButtonFormField<String>(
            initialValue: _sample,
            decoration: InputDecoration(labelText: context.l10n.sampleStatus),
            items: const ['NOT_REQUESTED', 'REQUESTED', 'RECEIVED', 'APPROVED', 'REJECTED']
                .map((c) => DropdownMenuItem(value: c, child: Text(codeLabel(context, c)))).toList(),
            onChanged: (v) => setState(() => _sample = v!),
          ),
          gap,
          TextFormField(controller: _suppliers, maxLines: 4,
              decoration: InputDecoration(labelText: context.l10n.supplierNamesOnePerLine, alignLabelWithHint: true)),
          const SizedBox(height: 24),
          FilledButton.icon(onPressed: _busy ? null : _save, icon: Icon(Icons.send), label: Text(context.l10n.createRequest)),
        ]),
      ),
    );
  }
}
