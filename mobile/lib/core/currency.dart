import 'package:intl/intl.dart';

/// Supported currencies. RMB is stored with ISO code CNY.
const kCurrencies = ['CNY', 'USD', 'INR'];

String currencyLabel(String code) => code == 'CNY' ? 'RMB' : code;

/// Admin-set rates. All rates are expressed as "1 unit of X = n INR",
/// plus an optional direct USD->CNY rate.
class RateTable {
  const RateTable({required this.cnyToInr, required this.usdToInr, this.usdToCny});
  final double cnyToInr;
  final double usdToInr;
  final double? usdToCny;

  double toInr(String code) => switch (code) {
        'INR' => 1,
        'CNY' => cnyToInr,
        'USD' => usdToInr,
        _ => throw ArgumentError('Unsupported currency $code'),
      };

  /// Convert [amount] in [from] to [to].
  double convert(double amount, String from, String to) {
    if (from == to) return amount;
    if (from == 'USD' && to == 'CNY' && usdToCny != null) return amount * usdToCny!;
    if (from == 'CNY' && to == 'USD' && usdToCny != null) return amount / usdToCny!;
    return amount * toInr(from) / toInr(to);
  }
}

String formatMoney(double amount, String code) {
  final symbol = switch (code) { 'CNY' => '¥', 'USD' => r'$', 'INR' => '₹', _ => '' };
  final locale = code == 'INR' ? 'en_IN' : 'en_US';
  return NumberFormat.currency(locale: locale, symbol: symbol, decimalDigits: 2).format(amount);
}
