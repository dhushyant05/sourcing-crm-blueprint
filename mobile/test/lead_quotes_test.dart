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
import 'package:source_easy/ui/widgets/lead_quotes.dart';

Map<String, dynamic> _q({bool china = true}) => {
      'id': 'q1', 'leadId': 'L1', 'product': 'SB-500 steel bottle 500ml', 'unitPrice': 12.5, 'currency': 'CNY', 'moq': '1000 pcs', 'leadTime': '15 days', 'validity': '30 days',
      'notes': 'FOB Ningbo, logo print included',
      if (china) ...{'supplierId': 's1', 'supplier': {'id': 's1', 'name': 'Ningbo Steelware Co.', 'contact': 'Mr Wang', 'phone': '+86 138 0000 0000', 'wechat': 'nb_steel', 'city': 'Ningbo'}, 'createdByName': 'Li Wei', 'canEdit': true},
      if (!china) ...{'label': 'SE-2611-0008-Q1', 'clientPrice': 210, 'clientCurrency': 'INR', 'clientNotes': 'Incl. GST'},
      'files': [
        {'id': 'f1', 'name': china ? 'catalog.pdf' : 'SE-2611-0008-Q1-1.pdf', 'mime': 'application/pdf', 'size': 120000},
        {'id': 'f2', 'name': china ? 'factory.mp4' : 'SE-2611-0008-Q1-2.mp4', 'mime': 'video/mp4', 'size': 4200000},
      ],
    };

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
  testWidgets('China sees supplier + edit; India sees no supplier and its INR price', (t) async {
    await _fonts();
    await t.binding.setSurfaceSize(const Size(400, 720));
    await t.pumpWidget(_app(Role.chinaStaff, Scaffold(appBar: AppBar(title: const Text('SE-2611-0008')), body: ListView(padding: const EdgeInsets.all(16), children: [LeadQuotesSection(leadId: 'L1', initial: [LeadQuote.fromJson(_q())])]))));
    await t.pumpAndSettle();
    expect(find.textContaining('Ningbo Steelware'), findsOneWidget);
    expect(find.textContaining('¥12.5 RMB'), findsOneWidget);
    expect(find.byKey(const Key('quote-add')), findsOneWidget);
    expect(find.byIcon(Icons.edit_outlined), findsOneWidget);
    if (shot) await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-quote.png'));

    await t.pumpWidget(_app(Role.indiaStaff, Scaffold(appBar: AppBar(title: const Text('SE-2611-0008')), body: ListView(padding: const EdgeInsets.all(16), children: [LeadQuotesSection(key: const Key('india'), leadId: 'L1', initial: [LeadQuote.fromJson(_q(china: false))])]))));
    await t.pumpAndSettle();
    expect(find.textContaining('Ningbo Steelware'), findsNothing);
    expect(find.textContaining('WeChat'), findsNothing);
    expect(find.byKey(const Key('quote-add')), findsNothing);
    expect(find.textContaining('₹210 INR'), findsOneWidget);
    if (shot) await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-quote-india.png'));
  });

  testWidgets('add-quote form (ZH) with inline new supplier', (t) async {
    await _fonts();
    await t.binding.setSurfaceSize(const Size(400, 900));
    await t.pumpWidget(_app(Role.chinaStaff, QuoteFormScreen(leadId: 'L1', suppliers: [QuoteSupplier(id: 's1', name: 'Ningbo Steelware Co.', city: 'Ningbo')]), locale: const Locale('zh')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('qf-supplier')));
    await t.pumpAndSettle();
    await t.tap(find.text('+ 新建供应商').last);
    await t.pumpAndSettle();
    expect(find.byKey(const Key('qf-sName')), findsOneWidget);
    await t.enterText(find.byKey(const Key('qf-sName')), '义乌五金厂');
    await t.enterText(find.byKey(const Key('qf-product')), 'SB-500 保温杯');
    await t.enterText(find.byKey(const Key('qf-unitPrice')), '12.5');
    await t.pumpAndSettle();
    if (shot) await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-quote-form.png'));
  });
}
