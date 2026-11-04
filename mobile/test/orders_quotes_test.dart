import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/models/models.dart';
import 'package:source_easy/l10n/gen/app_localizations.dart';
import 'package:source_easy/services/session.dart';
import 'package:source_easy/ui/screens/customer_quote_screen.dart';
import 'package:source_easy/ui/screens/orders_screen.dart';
import 'package:source_easy/ui/screens/quotes_screen.dart';

Future<void> _fonts() async {
  await (FontLoader('Inter')..addFont(rootBundle.load('assets/fonts/NotoSans-Regular.ttf'))).load();
  await (FontLoader('NotoSC')..addFont(rootBundle.load('assets/fonts/NotoSansSC-GB2312.ttf'))).load();
  final icons = File('/home/box/sdk/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (icons.existsSync()) await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
}

Widget _app(Role role, Widget home, {Locale locale = const Locale('en')}) => ChangeNotifierProvider.value(
      value: Session()..role = role,
      child: MaterialApp(
        debugShowCheckedModeBanner: false, locale: locale,
        theme: ThemeData(useMaterial3: true, fontFamily: 'Inter', fontFamilyFallback: const ['NotoSC'], colorSchemeSeed: const Color(0xFF1E6BFF)),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: home,
      ),
    );

void main() {
  final shot = Platform.environment['SHOT'] != null;
  final cq = {'id': 'q1', 'leadId': 'L1', 'label': 'SE-2611-0008-Q1', 'leadRef': 'SE-2611-0008', 'product': 'SB-500 steel bottle 500ml', 'unitPrice': 12.5, 'currency': 'CNY',
    'moq': '1000 pcs', 'leadTime': '15 days', 'validity': '30 days', 'status': 'SENT', 'sentAt': '2026-11-01T10:00:00Z', 'clientPrice': 210, 'clientCurrency': 'INR',
    'shipCost': 800, 'shipCurrency': 'CNY', 'shipTerm': 'FOB', 'shipMode': 'SEA', 'shipPort': 'Ningbo', 'shipTransit': '20 days', 'leadStatus': 'QUOTED', 'assignedToName': 'Priya',
    'cq': {'qty': 1000, 'unitPrice': 210, 'gstPct': 18, 'shipCost': 15000, 'shipTerm': 'CIF', 'shipMode': 'SEA', 'port': 'Chennai', 'transit': '25 days', 'otherCharges': 0, 'validity': '15 days', 'terms': '50% advance'},
    'cqTotals': {'subtotal': 210000, 'taxable': 225000, 'gst': 40500, 'total': 265500}, 'pdfUrl': '/api/public/cq/x.pdf'};
  testWidgets('India customer quote screen with shipping + INR totals (EN)', (t) async {
    await _fonts();
    await t.binding.setSurfaceSize(const Size(400, 1100));
    await t.pumpWidget(_app(Role.indiaAdmin, CustomerQuoteScreen(quote: LeadQuote.fromJson(cq))));
    await t.pumpAndSettle();
    expect(find.text('₹ 265500.00'), findsOneWidget);
    expect(find.byKey(const Key('cq-accept')), findsOneWidget);
    if (shot) await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-customer-quote.png'));
  });
  testWidgets('All quotes list (ZH, China: no INR) and orders (China)', (t) async {
    await _fonts();
    await t.binding.setSurfaceSize(const Size(400, 720));
    final china = Map<String, dynamic>.from(cq)..remove('clientPrice')..remove('cq')..remove('cqTotals')..['supplier'] = {'id': 's1', 'name': 'Ningbo Steelware Co.'};
    await t.pumpWidget(_app(Role.chinaStaff, QuotesScreen(initial: [LeadQuote.fromJson(china)]), locale: const Locale('zh')));
    await t.pumpAndSettle();
    expect(find.textContaining('Ningbo Steelware'), findsOneWidget);
    expect(find.textContaining('₹'), findsNothing);
    if (shot) await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-quotes-zh.png'));
    await t.pumpWidget(_app(Role.chinaStaff, OrdersScreen(initial: [SeOrder({'id': 'o1', 'leadId': 'L1', 'leadRef': 'SE-2611-0008', 'product': 'SB-500 steel bottle 500ml', 'qty': 1000,
      'production': 'IN_PRODUCTION', 'indiaStatus': 'NONE', 'supplier': {'name': 'Ningbo Steelware Co.'}, 'unitPrice': 12.5, 'currency': 'CNY', 'updatedAt': 'x'})])));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('o-save-china')), findsOneWidget);
    expect(find.byKey(const Key('o-save-india')), findsNothing);
    if (shot) await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-orders-china.png'));
  });
}
