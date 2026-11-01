import 'package:intl/intl.dart';

/// Supported currencies. RMB is stored with ISO code CNY.
/// Amounts are always stored and shown in the currency they were entered in — never converted.
const kCurrencies = ['USD', 'CNY', 'INR'];

String currencyLabel(String code) => code == 'CNY' ? 'RMB' : code;

String currencySymbol(String code) => switch (code) { 'CNY' => '¥', 'USD' => r'$', 'INR' => '₹', _ => '' };

String formatMoney(double amount, String code) {
  final locale = code == 'INR' ? 'en_IN' : 'en_US';
  return NumberFormat.currency(locale: locale, symbol: currencySymbol(code), decimalDigits: 2).format(amount);
}

/// "¥14.12 RMB" — symbol plus code, so ¥ is never ambiguous.
String formatMoneyCode(double amount, String code) => '${formatMoney(amount, code)} ${currencyLabel(code)}';
