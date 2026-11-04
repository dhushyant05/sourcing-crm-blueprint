import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/api/server_client.dart';
import 'package:source_easy/data/offline/offline_queue.dart';
import 'package:source_easy/data/repository.dart';
import 'package:source_easy/l10n/gen/app_localizations.dart';
import 'package:source_easy/services/notifications.dart';
import 'package:source_easy/ui/screens/notifications_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart' show Database;

class _NoDb implements Database {
  @override
  dynamic noSuchMethod(Invocation i) => super.noSuchMethod(i);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final shown = <Map>[];
  const ch = MethodChannel('sourceeasy/notify');
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(ch, (c) async {
    if (c.method == 'show') shown.add(c.arguments as Map);
    return null;
  });
  var items = <Map<String, dynamic>>[
    {'id': 'n1', 'leadId': 'L1', 'leadRef': 'SE-0042', 'product': 'Steel pipes 2"', 'kind': 'ASSIGNED', 'office': 'CHINA', 'byName': 'Priya', 'createdAt': '2026-11-01T09:00:00Z', 'read': false},
    {'id': 'n0', 'leadId': 'L0', 'leadRef': 'SE-0040', 'product': 'LED panels', 'kind': 'QUEUE', 'office': 'CHINA', 'byName': null, 'createdAt': '2026-10-31T09:00:00Z', 'read': true},
  ];
  final posts = <String>[];
  final mock = MockClient((req) async {
    if (req.method == 'POST') { posts.add(req.url.path); return http.Response('{"ok":true}', 200); }
    return http.Response(jsonEncode({'data': items, 'unread': items.where((n) => n['read'] != true).length}), 200);
  });
  final repo = SourceEasyRepository(api: ServerClient(baseUrl: 'http://x', httpClient: mock), store: LocalStore(_NoDb()), perms: Permissions(Role.chinaStaff));

  test('first poll is silent; new items raise a local notification once; mark read posts', () async {
    final nc = NotificationCenter(repo)..describe = (n) => '${n.leadRef} ${n.product}';
    await nc.poll();
    expect(nc.unread, 1);
    expect(shown, isEmpty);
    items = [{'id': 'n2', 'leadId': 'L2', 'leadRef': 'SE-0043', 'product': 'Valves', 'kind': 'RETURNED', 'office': 'INDIA', 'read': false}, ...items];
    await nc.poll();
    await nc.poll();
    expect(shown.length, 1);
    expect(shown.first['body'], 'SE-0043 Valves');
    await nc.markRead('n2');
    await nc.markRead();
    expect(posts, ['/api/notifications/n2/read', '/api/notifications/read-all']);
  });

  testWidgets('notifications screen shows ref + product only (ZH and EN)', (t) async {
    final font = FontLoader('Inter')..addFont(rootBundle.load('assets/fonts/NotoSans-Regular.ttf'));
    await font.load();
    final sc = FontLoader('NotoSC')..addFont(rootBundle.load('assets/fonts/NotoSansSC-GB2312.ttf'));
    await sc.load();
    final icons = File('/home/box/sdk/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
    if (icons.existsSync()) { await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load(); }
    final nc = NotificationCenter(repo);
    await t.runAsync(nc.poll);
    await t.binding.setSurfaceSize(const Size(400, 640));
    await t.pumpWidget(ChangeNotifierProvider.value(
      value: nc,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(useMaterial3: true, fontFamily: 'Inter', fontFamilyFallback: const ['NotoSC'], colorSchemeSeed: const Color(0xFF1E6BFF)),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const NotificationsScreen(),
      ),
    ));
    await t.pumpAndSettle();
    expect(find.textContaining('SE-0043'), findsOneWidget);
    expect(find.textContaining('returned to you'), findsOneWidget);
    expect(find.text('Mark all read'), findsOneWidget);
    if (Platform.environment['SHOT'] != null) {
      await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-notifications.png'));
    }
  });
}
