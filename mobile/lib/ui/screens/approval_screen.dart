import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/common.dart';

/// Step 6/7: India logs the client's yes/no; on approval a shipping order is created.
class ApprovalScreen extends StatefulWidget {
  const ApprovalScreen({super.key, required this.lead, required this.quotation});
  final Lead lead;
  final Quotation quotation;
  @override
  State<ApprovalScreen> createState() => _ApprovalScreenState();
}

class _ApprovalScreenState extends State<ApprovalScreen> {
  final _notes = TextEditingController();
  late Future<List<ClientApproval>> _f;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _f = context.read<Session>().repo.approvals(quotationId: widget.quotation.id);
  }

  Future<void> _decide(bool approved) async {
    setState(() => _busy = true);
    final s = context.read<Session>();
    try {
      final r = await s.repo.recordApproval(
        quotationId: widget.quotation.id,
        approved: approved,
        approver: widget.lead.clientName ?? 'Client',
        notes: '${_notes.text.trim()} (logged by ${s.displayName})'.trim(),
        leadId: widget.lead.id,
      );
      if (approved) {
        await s.repo.createShippingOrder(leadId: widget.lead.id, quotationId: widget.quotation.id);
        await s.repo.updateLead(widget.lead.id, {'status': 'SHIPPING'});
      }
      await s.refreshPending();
      if (!mounted) return;
      showWriteResult(context, r, approved ? 'Approval' : 'Rejection');
      Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<Session>().perms;
    return Scaffold(
      appBar: AppBar(title: const Text('Client approval')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(widget.lead.clientName ?? widget.lead.name, style: Theme.of(context).textTheme.titleLarge),
        Text(widget.quotation.name),
        const SizedBox(height: 16),
        AsyncView<List<ClientApproval>>(
          future: _f,
          builder: (c, list) => Column(
            children: list
                .map((a) => ListTile(
                      leading: StatusChip(a.status),
                      title: Text(a.approver ?? ''),
                      subtitle: Text('${a.decidedAt != null ? dateFmt.format(a.decidedAt!.toLocal()) : ''} ${a.notes ?? ''}'),
                    ))
                .toList(),
          ),
        ),
        if (p.canRecordApproval) ...[
          const SizedBox(height: 16),
          TextField(controller: _notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Notes from client')),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
                onPressed: _busy ? null : () => _decide(false),
                icon: const Icon(Icons.close),
                label: const Text('Reject'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton.icon(
                onPressed: _busy ? null : () => _decide(true),
                icon: const Icon(Icons.check),
                label: const Text('Accept'),
              ),
            ),
          ]),
        ],
      ]),
    );
  }
}
