// Live integration test against a real Source Easy server (skipped unless SE_LIVE_URL is set).
// Env: SE_LIVE_URL, SE_ADMIN_EMAIL, SOURCEEASY_ADMIN_PW, optional SE_INDIA_EMAIL/SE_CHINA_EMAIL + SE_STAFF_PW.
import 'dart:async';
import 'dart:convert';
import 'dart:ffi';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/api/server_client.dart';
import 'package:source_easy/data/offline/offline_queue.dart';
import 'package:source_easy/data/repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:sqlite3/open.dart' as sqlite_open;

final env = Platform.environment;
final base = env['SE_LIVE_URL'];

Future<SourceEasyRepository> repoFor(String email, String pw) async {
  final api = ServerClient(baseUrl: base!);
  final s = await api.login(email, pw);
  api.token = s.token;
  final me = (await api.send('GET', '/api/me') as Map)['data'] as Map? ?? {};
  final granted = (me['permissions'] as List?)?.cast<String>().toSet();
  final store = await LocalStore.open(inMemoryDatabasePath, factory: databaseFactoryFfiNoIsolate);
  return SourceEasyRepository(api: api, store: store, perms: Permissions(Role.fromCode(s.role), granted));
}

void main() {
  if (Platform.isLinux) {
    sqlite_open.open.overrideFor(sqlite_open.OperatingSystem.linux, () {
      try { return DynamicLibrary.open('libsqlite3.so'); } catch (_) { return DynamicLibrary.open('libsqlite3.so.0'); }
    });
  }
  sqfliteFfiInit();
  final skip = base == null ? 'SE_LIVE_URL not set' : null;

  final users = <String, (String?, String?)>{
    'super admin': (env['SE_ADMIN_EMAIL'], env['SOURCEEASY_ADMIN_PW']),
    'india staff': (env['SE_INDIA_EMAIL'], env['SE_STAFF_PW']),
    'china staff': (env['SE_CHINA_EMAIL'], env['SE_STAFF_PW']),
  };
  for (final u in users.entries) {
    test('${u.key}: every lead in the list opens (detail, sourcing, shipping, quotes, timeline)', () async {
      final (email, pw) = u.value;
      if (email == null || pw == null) return markTestSkipped('no creds');
      final r = await repoFor(email, pw);
      final leads = await r.leads();
      for (final l in leads.take(25)) {
        final d = await r.lead(l.id);
        expect(d, isNotNull, reason: l.leadRef);
        await r.sourcingRequests(leadId: l.id);
        await r.shippingOrders(leadId: l.id);
        if (r.perms.canViewQuotes) await r.leadQuotes(l.id);
        await r.timeline(d!);
        await r.leadTimeline(l.id);
      }
      final n = await r.notifications();
      expect(n.unread, greaterThanOrEqualTo(0));
      final sh = await r.shippingOrders();
      expect(sh, isA<List>());
    }, skip: skip, timeout: const Timeout(Duration(minutes: 3)));
  }

  test('super admin: SSE delivers a notification for a new enquiry', () async {
    final r = await repoFor(env['SE_ADMIN_EMAIL']!, env['SOURCEEASY_ADMIN_PW']!);
    final got = Completer<String>(), hello = Completer<void>();
    final sub = r.notificationStream().listen((e) { if (env['SE_DEBUG'] != null) print('EV item=${e.item?.product} unread=${e.unread} change=${e.change?['type']}');
      if (!hello.isCompleted) hello.complete();
      if (e.item != null && e.item!.product == 'qa-sse-probe' && !got.isCompleted) got.complete(e.item!.leadId);
    }, onError: (Object e) { if (!got.isCompleted) got.completeError(e); });
    await hello.future.timeout(const Duration(seconds: 15));
    await http.post(Uri.parse('$base/api/public/enquiry'), headers: {'content-type': 'application/json'},
        body: jsonEncode({'name': 'QA SSE ${DateTime.now().millisecondsSinceEpoch}', 'phone': '9000000001', 'product': 'qa-sse-probe', 'qty': '1'}));
    final leadId = await got.future.timeout(const Duration(seconds: 20));
    unawaited(sub.cancel()); // an open SSE generator only finishes cancelling on its next chunk
    expect(leadId, isNotEmpty);
    await r.deleteLead(leadId, force: true);
  }, skip: skip ?? (env['SE_ADMIN_EMAIL'] == null ? 'no admin' : null), timeout: const Timeout(Duration(minutes: 1)));
}
