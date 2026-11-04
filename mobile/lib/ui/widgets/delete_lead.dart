import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/api/server_client.dart';
import '../../services/session.dart';

String _t(BuildContext c, String en, String zh) => Localizations.localeOf(c).languageCode == 'zh' ? zh : en;

/// Confirm-and-delete for one lead (type its SE ref) or many (type the count).
/// Returns true when deleted. On an order in progress, super admin may "Delete anyway".
Future<bool> confirmDeleteLeads(BuildContext context, List<({String id, String? ref})> leads) async {
  final r = await showDialog<bool>(context: context, builder: (_) => _DeleteLeadDialog(leads));
  return r == true;
}

class _DeleteLeadDialog extends StatefulWidget {
  const _DeleteLeadDialog(this.leads);
  final List<({String id, String? ref})> leads;
  @override
  State<_DeleteLeadDialog> createState() => _DeleteLeadDialogState();
}

class _DeleteLeadDialogState extends State<_DeleteLeadDialog> {
  final _c = TextEditingController();
  bool _busy = false, _blocked = false;
  String? _err;

  bool get _one => widget.leads.length == 1;
  String get _expect => _one ? (widget.leads.first.ref ?? 'DELETE') : '${widget.leads.length}';

  Future<void> _go({bool force = false}) async {
    final s = context.read<Session>();
    setState(() { _busy = true; _err = null; });
    try {
      if (_one) {
        await s.repo.deleteLead(widget.leads.first.id, force: force);
      } else {
        final r = await s.repo.bulkDeleteLeads(widget.leads.map((e) => e.id).toList(), force: force);
        final failed = (r['failed'] as List?) ?? const [];
        if (failed.isNotEmpty) {
          final inProg = failed.any((f) => f is Map && f['code'] == 'ORDER_IN_PROGRESS');
          setState(() { _busy = false; _blocked = inProg; _err = inProg ? null : '${failed.length} failed'; });
          return;
        }
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      setState(() { _busy = false; if (e.statusCode == 409) { _blocked = true; } else { _err = e.message; } });
    } catch (e) {
      setState(() { _busy = false; _err = '$e'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final sa = context.read<Session>().perms.isSuperAdmin;
    final ok = _c.text.trim().toUpperCase() == _expect.toUpperCase();
    final red = Colors.red.shade700;
    return AlertDialog(
      key: const Key('delete-lead-dialog'),
      title: Text(_one ? _t(context, 'Delete lead $_expect?', '删除线索 $_expect？') : _t(context, 'Delete $_expect leads?', '删除 $_expect 条线索？')),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(_t(context, 'This permanently removes the lead with its quotes, orders, shipments, files and notifications. This cannot be undone.',
            '将永久删除该线索及其报价、订单、发货、文件和通知，且无法恢复。')),
        const SizedBox(height: 12),
        Text(_one ? _t(context, 'Type $_expect to confirm', '输入 $_expect 以确认') : _t(context, 'Type $_expect to confirm', '输入 $_expect 以确认'),
            style: const TextStyle(fontWeight: FontWeight.w600)),
        TextField(key: const Key('delete-confirm-input'), controller: _c, autofocus: true, onChanged: (_) => setState(() {})),
        if (_blocked) Container(
          key: const Key('delete-blocked'),
          margin: const EdgeInsets.only(top: 12), padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: Colors.amber.shade50, border: Border.all(color: Colors.amber.shade300), borderRadius: BorderRadius.circular(8)),
          child: Text(sa
              ? _t(context, 'An order is in progress. Deleting will also remove the active order. Super admin can delete anyway.', '有订单正在进行中。删除将同时移除该订单。超级管理员仍可强制删除。')
              : _t(context, 'An order is in progress. Only a super admin can delete this lead.', '有订单正在进行中，只有超级管理员可以删除此线索。')),
        ),
        if (_err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err!, style: TextStyle(color: red))),
      ]),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context, false), child: Text(_t(context, 'Cancel', '取消'))),
        if (_blocked && sa)
          FilledButton(key: const Key('delete-force'), style: FilledButton.styleFrom(backgroundColor: red),
              onPressed: _busy || !ok ? null : () => _go(force: true), child: Text(_t(context, 'Delete anyway', '仍然删除')))
        else
          FilledButton(key: const Key('delete-confirm'), style: FilledButton.styleFrom(backgroundColor: red),
              onPressed: _busy || !ok || _blocked ? null : _go, child: Text(_t(context, 'Delete', '删除'))),
      ],
    );
  }
}

String tDel(BuildContext c, String en, String zh) => _t(c, en, zh);
