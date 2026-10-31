import 'package:flutter_test/flutter_test.dart';
import 'package:source_easy/core/currency.dart';
import 'package:source_easy/data/models/models.dart';
import 'package:source_easy/data/repository.dart';
import 'package:source_easy/ui/screens/quotation_screen.dart' show quoteAmounts;

void main() {
  const rates = RateTable(cnyToInr: 12, usdToInr: 84, usdToCny: 7.1);

  test('converts via INR and direct USD/CNY', () {
    expect(rates.convert(10, 'CNY', 'INR'), 120);
    expect(rates.convert(1, 'USD', 'INR'), 84);
    expect(rates.convert(1, 'USD', 'CNY'), 7.1);
    expect(rates.convert(84, 'INR', 'USD'), closeTo(1, 1e-9));
    expect(rates.convert(5, 'USD', 'USD'), 5);
  });

  test('RMB label and INR formatting', () {
    expect(currencyLabel('CNY'), 'RMB');
    expect(formatMoney(123456.5, 'INR'), '₹1,23,456.50');
  });

  test(
    'latest rate wins; manual override wins same day; defaults otherwise',
    () {
      final d = DateTime(2026, 10, 31);
      final t = SourceEasyRepository.rateTableFrom([
        ExchangeRate(
          id: '1',
          pair: 'CNY_INR',
          rate: 11.5,
          effectiveDate: DateTime(2026, 10, 1),
        ),
        ExchangeRate(
          id: '2',
          pair: 'CNY_INR',
          rate: 11.9,
          effectiveDate: d,
          source: 'API',
        ),
        ExchangeRate(
          id: '3',
          pair: 'CNY_INR',
          rate: 12.1,
          effectiveDate: d,
          manual: true,
        ),
      ]);
      expect(t.cnyToInr, 12.1);
      expect(t.usdToInr, 84.0);
    },
  );

  test(
    'quote amounts: raw cost toggles, INR uses snapshotted rate, India-redacted uses INR total',
    () {
      final china = Quotation(
        id: 'q',
        name: 'Q',
        unitCost: 10,
        currency: 'CNY',
        totalCost: 1000,
        exchangeRateUsed: 11.5,
      );
      expect(quoteAmounts(china, rates, 'CNY', 100).total, 1000);
      expect(quoteAmounts(china, rates, 'INR', 100).unit, 115);
      expect(
        quoteAmounts(china, rates, 'USD', 100).unit,
        closeTo(10 / 7.1, 1e-9),
      );
      final india = Quotation(
        id: 'q',
        name: 'Q',
        unitCost: 0,
        currency: 'CNY',
        inrEquivalent: 11500,
      );
      final a = quoteAmounts(india, rates, 'INR', 100);
      expect(a.unit, 115);
      expect(a.total, 11500);
    },
  );
}
