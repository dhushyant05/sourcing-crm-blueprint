import 'package:flutter_test/flutter_test.dart';
import 'package:source_easy/core/currency.dart';
import 'package:source_easy/data/models/models.dart';

void main() {
  test('three currencies, RMB stored as CNY', () {
    expect(kCurrencies, ['USD', 'CNY', 'INR']);
    expect(currencyLabel('CNY'), 'RMB');
    expect(currencyLabel('USD'), 'USD');
  });

  test('amounts are formatted in their own currency, never converted', () {
    expect(formatMoney(1234.5, 'USD'), r'$1,234.50');
    expect(formatMoney(1234.5, 'CNY'), '¥1,234.50');
    expect(formatMoney(123456.5, 'INR'), '₹1,23,456.50');
    expect(formatMoneyCode(14.12, 'CNY'), '¥14.12 RMB');
  });

  test('quotation keeps supplier and client currencies separately', () {
    final q = Quotation.fromJson({
      'id': 'q1', 'name': 'Q', 'unitCost': 14.12,
      'currency': 'CNY', 'clientUnitPrice': 3.5, 'clientCurrency': 'USD',
    });
    expect(q.currency, 'CNY');
    expect(q.clientUnitPrice, 3.5);
    expect(q.clientCurrency, 'USD');
  });

  test('India field list never asks for supplier cost', () {
    expect(Quotation.gqlFieldsIndia.contains('unitCost'), isFalse);
    expect(Quotation.gqlFieldsIndia.contains('supplier'), isFalse);
    expect(Quotation.gqlFieldsIndia.contains('clientCurrency'), isTrue);
  });
}
