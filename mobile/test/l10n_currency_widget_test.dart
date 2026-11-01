import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/models/models.dart';
import 'package:source_easy/l10n/l10n.dart';
import 'package:source_easy/services/quote_pdf.dart';
import 'package:source_easy/ui/screens/quotation_screen.dart';
import 'package:source_easy/ui/widgets/currency_picker.dart';

Widget _app(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

final _q = Quotation.fromJson({'id': 'q1', 'name': 'Bottle quote', 'unitCost': 14.12, 'totalCost': 7060.0,
    'currency': 'CNY', 'clientUnitPrice': 3.5, 'clientCurrency': 'USD'});

void main() {
  testWidgets('currency picker offers USD, RMB and INR', (t) async {
    String v = 'CNY';
    await t.pumpWidget(_app(StatefulBuilder(builder: (c, set) => CurrencyPicker(value: v, onChanged: (x) => set(() => v = x)))));
    expect(find.text(r'$ USD'), findsOneWidget);
    expect(find.text('¥ RMB'), findsOneWidget);
    expect(find.text('₹ INR'), findsOneWidget);
    await t.tap(find.text('₹ INR'));
    await t.pump();
    expect(v, 'INR');
  });

  testWidgets('India card shows client price in its own currency, never supplier cost', (t) async {
    await t.pumpWidget(_app(QuoteCard(q: _q, qty: 500, perms: const Permissions(Role.indiaStaff),
        onClientPrice: () {}, onShare: () {}, onApproval: () {})));
    expect(find.text(r'$3.50 USD'), findsOneWidget);
    expect(find.textContaining('¥'), findsNothing);
    expect(find.text('Supplier cost/unit'), findsNothing);
  });

  testWidgets('China card shows RMB supplier cost unconverted, no client price', (t) async {
    await t.pumpWidget(_app(QuoteCard(q: _q, qty: 500, perms: const Permissions(Role.chinaStaff),
        onClientPrice: () {}, onShare: () {}, onApproval: () {}), locale: const Locale('zh')));
    expect(find.text('¥14.12 RMB'), findsOneWidget);
    expect(find.text('供应商单位成本'), findsOneWidget);
    expect(find.textContaining(r'$'), findsNothing);
  });

  test('PDF embeds Noto Sans so ₹ and ¥ render', () async {
    TestWidgetsFlutterBinding.ensureInitialized();
    for (final c in ['INR', 'CNY', 'USD']) {
      final bytes = await QuotePdf.build(QuoteData(quoteNo: 'X', clientName: 'Acme', product: 'P',
          quantity: 2, unitPrice: 10, currency: c));
      expect(String.fromCharCodes(bytes).contains('NotoSans'), isTrue);
    }
  });
}
