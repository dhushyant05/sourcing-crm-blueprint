import 'package:flutter/material.dart';

import '../../core/currency.dart';

/// USD / RMB / INR picker used on every price entry form. The amount is
/// saved in exactly this currency — nothing is converted.
class CurrencyPicker extends StatelessWidget {
  const CurrencyPicker({super.key, required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => SegmentedButton<String>(
        key: const Key('currency-picker'),
        showSelectedIcon: false,
        segments: [
          for (final c in kCurrencies) ButtonSegment(value: c, label: Text('${currencySymbol(c)} ${currencyLabel(c)}')),
        ],
        selected: {value},
        onSelectionChanged: (v) => onChanged(v.first),
      );
}
