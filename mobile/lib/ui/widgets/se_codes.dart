import 'package:flutter/material.dart';
import '../../l10n/gen/app_localizations.dart';

String _camel(String g, String k) => g + k.split('_').map((w) => w.isEmpty ? '' : w[0] + w.substring(1).toLowerCase()).join();

/// EN/ZH labels for quote status, Incoterms, modes, order statuses.
String seCode(AppLocalizations l, String group, String? code) {
  if (code == null || code.isEmpty) return '—';
  final m = <String, String>{
    'qsDRAFT': l.qsDRAFT, 'qsSENT': l.qsSENT, 'qsACCEPTED': l.qsACCEPTED, 'qsREJECTED': l.qsREJECTED,
    'prodNew': l.prodNew, 'prodDepositPaid': l.prodDepositPaid, 'prodInProduction': l.prodInProduction, 'prodReady': l.prodReady, 'prodShipped': l.prodShipped,
    'indNone': l.indNone, 'indInTransit': l.indInTransit, 'indCustoms': l.indCustoms, 'indDelivered': l.indDelivered,
    'payPending': l.payPending, 'payPartial': l.payPartial, 'payPaid': l.payPaid,
    'termExw': l.termExw, 'termFob': l.termFob, 'termCif': l.termCif, 'termCfr': l.termCfr, 'termDdp': l.termDdp, 'termDap': l.termDap, 'termDoor': l.termDoor,
    'modeAir': l.modeAir, 'modeSea': l.modeSea, 'modeExpress': l.modeExpress, 'modeRoad': l.modeRoad,
  };
  return m[group == 'qs' ? 'qs$code' : _camel(group, code)] ?? code;
}

const incoterms = ['EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'DOOR'];
const shipModes = ['AIR', 'SEA', 'EXPRESS', 'ROAD'];

String inr(num? n) => n == null ? '—' : '₹ ${n.toStringAsFixed(2)}';

class QuoteStatusChip extends StatelessWidget {
  const QuoteStatusChip(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final c = switch (status) { 'ACCEPTED' => Colors.green, 'REJECTED' => Colors.red, 'SENT' => Colors.blue, _ => Colors.grey };
    return Container(key: const Key('quote-status'), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: c.withValues(alpha: .15), borderRadius: BorderRadius.circular(12)),
        child: Text(seCode(l, 'qs', status), style: TextStyle(fontSize: 11, color: c.shade800, fontWeight: FontWeight.w600)));
  }
}

Widget seDropdown(String key, String label, String value, List<String> opts, String Function(String) text, ValueChanged<String> on, {bool allowEmpty = true}) =>
    Padding(padding: const EdgeInsets.only(bottom: 10), child: DropdownButtonFormField<String>(
      key: Key(key), initialValue: value, isExpanded: true,
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true),
      items: [if (allowEmpty) const DropdownMenuItem(value: '', child: Text('—')), for (final o in opts) DropdownMenuItem(value: o, child: Text(text(o)))],
      onChanged: (v) => on(v ?? ''),
    ));
