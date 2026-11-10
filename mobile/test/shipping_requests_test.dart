import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/api/server_client.dart';
import 'package:source_easy/data/offline/offline_queue.dart';
import 'package:source_easy/data/models/models.dart';
import 'package:source_easy/data/repository.dart';
import 'package:source_easy/l10n/gen/app_localizations.dart';
import 'package:source_easy/services/session.dart';
import 'package:source_easy/ui/screens/lead_detail_screen.dart';
import 'package:source_easy/ui/screens/notifications_screen.dart';
import 'package:source_easy/ui/screens/shipping_requests_screen.dart';
import 'package:source_easy/ui/screens/shipping_screen.dart';
import 'package:sqflite/sqflite.dart';

class _NoDb implements Database {
  @override
  dynamic noSuchMethod(Invocation i) => super.noSuchMethod(i);
}

/// Exactly the server's China allowlist DTO (see server/test/china-shipping.test.ts).
Map<String, dynamic> _china({String status = 'ACCEPTED', String kind = 'FREIGHT_ONLY', bool canUpdate = true}) => {
  'id': 'sr1', 'ref': 'SH-2611-0001', 'kind': kind, 'status': status, 'goods': 'Brass lamps', 'quantity': 400, 'unit': 'pcs', 'packages': 20, 'weightKg': 350, 'cbm': 2.5,
  'pickupContact': 'Mr Li', 'pickupPhone': '+86 139', 'pickupAddress': 'No 5 Market Rd', 'pickupCity': 'Yiwu', 'readyDate': '2026-11-25', 'mode': 'SEA', 'incoterm': 'FOB',
  'destCity': 'Chennai', 'carrier': null, 'tracking': null, 'container': null, 'etd': null, 'eta': null, 'stage': 'PENDING', 'shipmentRef': null,
  'updatedAt': '2026-11-08T08:00:00Z', 'canUpdate': canUpdate,
};

void main() {
  late List<Map<String, dynamic>> list;
  final posts = <String, Map<String, dynamic>>{};
  Session session(Role role, {Set<String>? granted, List<Map<String, dynamic>> shipments = const []}) {
    final mock = MockClient((req) async {
      final path = req.url.path;
      if (req.method == 'POST') {
        final b = (jsonDecode(req.body) as Map).cast<String, dynamic>(); posts[path] = b;
        Map<String, dynamic> n = {...list.first, ...b};
        if (path.endsWith('/assign')) n = {...n, 'assignedTo': 'me', 'assignedToName': 'Me', 'status': n['status'] == 'SUBMITTED' ? 'UNDER_REVIEW' : n['status']};
        else n = {...n, 'status': b['status'] ?? list.first['status']};
        if (list.isNotEmpty) list[0] = n;
        return http.Response(jsonEncode({'data': n}), 200);
      }
      if (path == '/api/shipments') return http.Response(jsonEncode({'data': shipments}), 200);
      if (path.endsWith('/api/shipping-requests') || path == '/api/shipping-requests') return http.Response(jsonEncode({'data': list}), 200);
      if (list.isNotEmpty && path.endsWith(list.first['id'])) return http.Response(jsonEncode({'data': list.first}), 200);
      return http.Response(jsonEncode({'data': list}), 200);
    });
    return Session()..role = role..debugRepo = SourceEasyRepository(api: ServerClient(baseUrl: 'http://x', httpClient: mock), store: LocalStore(_NoDb()), perms: Permissions(role, granted));
  }
  Widget app(Session s, Widget home, {Locale locale = const Locale('en')}) => ChangeNotifierProvider.value(value: s,
      child: MaterialApp(locale: locale, supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate], home: home));

  testWidgets('China: booking details (no customer fields), BOOKED/IN_TRANSIT only, saves via the China route', (t) async {
    list = [_china()]; posts.clear();
    await t.pumpWidget(app(session(Role.chinaStaff), const ChinaShippingRequestsScreen(openId: 'sr1')));
    await t.pumpAndSettle();
    expect(find.text('SH-2611-0001 · Brass lamps'), findsOneWidget);
    expect(find.text('No 5 Market Rd'), findsOneWidget);
    expect(find.text('Mr Li'), findsOneWidget);
    await t.tap(find.byKey(const Key('sr-stage'))); await t.pumpAndSettle();
    expect(find.text('Arrived'), findsNothing); // India's stages are never offered to China
    await t.tap(find.text('Booked').last); await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('sr-carrier')), 'COSCO');
    await t.enterText(find.byKey(const Key('sr-etd')), 'soon');
    await t.ensureVisible(find.byKey(const Key('sr-save'))); await t.tap(find.byKey(const Key('sr-save'))); await t.pumpAndSettle();
    expect(posts, isEmpty); // invalid date never sent
    await t.enterText(find.byKey(const Key('sr-etd')), '2026-11-28');
    await t.tap(find.byKey(const Key('sr-save'))); await t.pumpAndSettle();
    expect(posts['/api/china/shipping-requests/sr1/stage'], {'carrier': 'COSCO', 'etd': '2026-11-28', 'status': 'BOOKED'});
    await t.pumpWidget(const SizedBox()); await t.pump(const Duration(seconds: 1));
  });

  testWidgets('China: after India takes over the request is read-only; sourced points to the Shipping board (中文)', (t) async {
    list = [_china(status: 'ARRIVED', canUpdate: false), {..._china(kind: 'SOURCED', canUpdate: false), 'id': 'sr2', 'ref': 'SH-2611-0002', 'shipmentRef': 'SE-2611-0009-S1'}];
    await t.pumpWidget(app(session(Role.chinaAdmin), const ChinaShippingRequestsScreen(), locale: const Locale('zh')));
    await t.pumpAndSettle();
    expect(find.text('运输请求 — 订舱'), findsOneWidget);
    await t.tap(find.textContaining('SH-2611-0001')); await t.pumpAndSettle();
    expect(find.byKey(const Key('sr-save')), findsNothing);
    expect(find.text('该货运现由印度团队处理。'), findsOneWidget);
    await t.tap(find.textContaining('SH-2611-0001')); await t.pumpAndSettle(); // collapse
    await t.tap(find.textContaining('SH-2611-0002')); await t.pumpAndSettle();
    expect(find.text('采购订单：请在下方的货运看板订舱。'), findsOneWidget);
    await t.pumpWidget(const SizedBox()); await t.pump(const Duration(seconds: 1));
  });

  test('notification deep links: ready-to-book → China view, request kinds → India view, others → lead', () {
    AppNotification n(String kind) => AppNotification.fromJson({'id': 'n', 'leadId': 'sr1', 'leadRef': 'SH-2611-0001', 'kind': kind, 'office': 'CHINA', 'read': false});
    expect(notifTarget(n('SHIP_READY')), isA<ChinaShippingRequestsScreen>());
    expect((notifTarget(n('SHIP_READY')) as ChinaShippingRequestsScreen).openId, 'sr1');
    for (final k in ['SHIP_REQUEST', 'SHIP_REQUEST_UPDATE', 'SHIP_SLA_WARN', 'SHIP_SLA_BREACH']) { expect(notifTarget(n(k)), isA<IndiaShippingRequestsScreen>()); }
    expect(notifTarget(n('ASSIGNED')), isA<LeadDetailScreen>());
  });

  Map<String, dynamic> _indiaSr() => {
    'id': 'sr1', 'ref': 'SH-2611-0004', 'kind': 'FREIGHT_ONLY', 'status': 'SUBMITTED', 'goods': 'LED', 'assignedTo': null, 'assignedToName': null,
    'customer': {'id': 'c1', 'name': 'Asha', 'company': 'Asha Traders'}, 'pickupCity': 'Yiwu', 'destCity': 'Chennai', 'createdAt': '2026-11-10T21:31:25.911Z',
  };

  testWidgets('India staff without customers.view still see a portal request on Shipping and can claim it', (t) async {
    list = [_indiaSr()]; posts.clear();
    // Default India staff grants do not include customers.view — that used to hide the Shipping Requests entry.
    final grants = {'quotes.view', 'quotes.customer', 'prices.inr', 'orders.create', 'orders.production', 'orders.payment', 'leads.all'};
    final s = session(Role.indiaStaff, granted: grants);
    await t.pumpWidget(app(s, const ShippingScreen()));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('open-sr')), findsOneWidget);
    expect(find.byKey(const Key('sr-on-shipping')), findsOneWidget);
    expect(find.byKey(const Key('sr-ship-SH-2611-0004')), findsOneWidget);
    expect(find.textContaining('SH-2611-0004'), findsWidgets);
    await t.tap(find.byKey(const Key('sr-ship-SH-2611-0004'))); await t.pumpAndSettle();
    expect(find.byKey(const Key('sr-claim')), findsOneWidget);
    await t.tap(find.byKey(const Key('sr-claim'))); await t.pumpAndSettle();
    expect(posts['/api/shipping-requests/sr1/assign'], {});
    expect(find.text('Unclaimed'), findsNothing);
    await t.pumpWidget(const SizedBox()); await t.pump(const Duration(seconds: 1));
  });
}
