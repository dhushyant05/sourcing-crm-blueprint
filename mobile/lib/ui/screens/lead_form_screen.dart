import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';
import '../widgets/common.dart';

/// Step 1: India agent creates a lead.
class LeadFormScreen extends StatefulWidget {
  const LeadFormScreen({super.key});
  @override
  State<LeadFormScreen> createState() => _LeadFormScreenState();
}

class _LeadFormScreenState extends State<LeadFormScreen> {
  final _form = GlobalKey<FormState>();
  final _client = TextEditingController(), _phone = TextEditingController(), _email = TextEditingController();
  final _product = TextEditingController(), _qty = TextEditingController(), _price = TextEditingController();
  String _channel = 'PHONE';
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
        sourceChannel: _channel,
      );
      if (!mounted) return;
      showWriteResult(context, r, 'Lead');
      Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _req(String? v) => v == null || v.trim().isEmpty ? 'Required' : null;

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: const Text('New lead')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          TextFormField(controller: _client, decoration: const InputDecoration(labelText: 'Client name *'), validator: _req),
          gap,
          TextFormField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
          gap,
          TextFormField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
          gap,
          TextFormField(controller: _product, decoration: const InputDecoration(labelText: 'Product interest *'), validator: _req),
          gap,
          Row(children: [
            Expanded(child: TextFormField(controller: _qty, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Quantity'))),
            const SizedBox(width: 12),
            Expanded(child: TextFormField(controller: _price, keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Target price (₹/unit)'))),
          ]),
          gap,
          DropdownButtonFormField<String>(
            initialValue: _channel,
            decoration: const InputDecoration(labelText: 'Source channel'),
            items: const ['WALK_IN', 'REFERRAL', 'PHONE', 'WHATSAPP', 'EXHIBITION', 'WEBSITE', 'OTHER']
                .map((c) => DropdownMenuItem(value: c, child: Text(pretty(c)))).toList(),
            onChanged: (v) => setState(() => _channel = v!),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(onPressed: _busy ? null : _save, icon: const Icon(Icons.save), label: const Text('Save lead')),
        ]),
      ),
    );
  }
}
