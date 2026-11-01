import 'package:flutter/material.dart';

import '../../l10n/codes.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';
import '../widgets/currency_picker.dart';
import '../widgets/common.dart';
import '../widgets/media_picker.dart';

/// Step 1: India agent creates a lead.
class LeadFormScreen extends StatefulWidget {
  const LeadFormScreen({super.key});
  @override
  State<LeadFormScreen> createState() => _LeadFormScreenState();
}

class _LeadFormScreenState extends State<LeadFormScreen> {
  final _form = GlobalKey<FormState>();
  final _client = TextEditingController(), _phone = TextEditingController(), _email = TextEditingController();
  final _summary = TextEditingController();
  final _media = <String>[];
  final _product = TextEditingController(), _qty = TextEditingController(), _price = TextEditingController();
  String _channel = 'PHONE', _currency = 'INR';
  bool _busy = false;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final repo = context.read<Session>().repo;
    try {
      final r = await repo.createLead(
        clientName: _client.text.trim(),
        phone: _phone.text.trim(),
        email: _email.text.trim(),
        productInterest: _product.text.trim(),
        quantity: double.tryParse(_qty.text),
        targetPrice: double.tryParse(_price.text),
        targetCurrency: _currency,
        sourceChannel: _channel,
        summary: _summary.text.trim(),
      );
      if (!mounted) return;
      showWriteResult(context, r, context.l10n.lead);
      final id = r.record?['id'] as String?;
      if (_media.isNotEmpty) {
        final m = ScaffoldMessenger.of(context);
        final l = context.l10n;
        if (id == null) {
          m.showSnackBar(SnackBar(content: Text(l.uploadNeedsOnline)));
        } else {
          m.showSnackBar(SnackBar(content: Text(l.uploadingFiles(_media.length))));
          final up = await repo.uploadAttachments(id, List.of(_media));
          m.showSnackBar(SnackBar(content: Text(l.uploadedFiles(up.length))));
        }
      }
      if (!mounted) return;
      Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _req(String? v) => v == null || v.trim().isEmpty ? context.l10n.required : null;

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.newLead)),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          TextFormField(controller: _client, decoration: InputDecoration(labelText: context.l10n.clientName), validator: _req),
          gap,
          TextFormField(controller: _phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: context.l10n.phone)),
          gap,
          TextFormField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: context.l10n.email)),
          gap,
          TextFormField(controller: _product, decoration: InputDecoration(labelText: context.l10n.productInterest), validator: _req),
          gap,
          TextFormField(controller: _summary, minLines: 2, maxLines: 6,
              decoration: InputDecoration(labelText: context.l10n.summary, hintText: context.l10n.summaryHint, alignLabelWithHint: true)),
          gap,
          OutlinedButton.icon(
            icon: const Icon(Icons.add_a_photo_outlined),
            label: Text(context.l10n.mediaTitle),
            onPressed: () async {
              final p = await pickMedia(context);
              if (p.isNotEmpty) setState(() => _media.addAll(p));
            },
          ),
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(context.l10n.mediaHint, style: Theme.of(context).textTheme.bodySmall)),
          if (_media.isNotEmpty) PendingMedia(paths: _media, onRemove: (p) => setState(() => _media.remove(p))),
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
          DropdownButtonFormField<String>(
            initialValue: _channel,
            decoration: InputDecoration(labelText: context.l10n.sourceChannel),
            items: const ['WALK_IN', 'REFERRAL', 'PHONE', 'WHATSAPP', 'EXHIBITION', 'WEBSITE', 'OTHER']
                .map((c) => DropdownMenuItem(value: c, child: Text(codeLabel(context, c)))).toList(),
            onChanged: (v) => setState(() => _channel = v!),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(onPressed: _busy ? null : _save, icon: Icon(Icons.save), label: Text(context.l10n.saveLead)),
        ]),
      ),
    );
  }
}
