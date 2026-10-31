import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/api/twenty_client.dart';
import 'package:source_easy/data/offline/offline_queue.dart';
import 'package:source_easy/data/repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:sqlite3/open.dart' as sqlite_open;
import 'dart:ffi';
import 'dart:io';

void main() {
  // Many Linux hosts ship only libsqlite3.so.0 (no -dev symlink).
  if (Platform.isLinux) {
    sqlite_open.open.overrideFor(sqlite_open.OperatingSystem.linux, () {
      try {
        return DynamicLibrary.open('libsqlite3.so');
      } catch (_) {
        return DynamicLibrary.open('libsqlite3.so.0');
      }
    });
  }
  sqfliteFfiInit();
  late LocalStore store;
  var online = false;
  var existingRef = false;
  final calls = <Map<String, dynamic>>[];

  final mock = MockClient((req) async {
    if (!online) throw http.ClientException('no network');
    final body = jsonDecode(req.body) as Map<String, dynamic>;
    calls.add(body);
    final q = body['query'] as String;
    if (q.contains('createLead')) {
      return http.Response(
        jsonEncode({
          'data': {
            'createLead': {'id': 'L1'},
          },
        }),
        200,
      );
    }
    if (q.contains('leads(')) {
      final isRefCheck = jsonEncode(body['variables']).contains('clientRef');
      final edges = isRefCheck
          ? (existingRef
                ? [
                    {
                      'node': {'id': 'L9'},
                    },
                  ]
                : [])
          : [
              {
                'node': {'id': 'L0', 'name': 'Cached', 'status': 'NEW'},
              },
            ];
      return http.Response(
        jsonEncode({
          'data': {
            'leads': {'edges': edges},
          },
        }),
        200,
      );
    }
    return http.Response(jsonEncode({'data': {}}), 200);
  });

  SourceEasyRepository repo() => SourceEasyRepository(
    api: TwentyClient(baseUrl: 'https://x', token: 't', httpClient: mock),
    store: store,
    perms: const Permissions(Role.indiaStaff),
  );

  setUp(() async {
    store = await LocalStore.open(
      '${Directory.systemTemp.createTempSync('se').path}/t.db',
      factory: databaseFactoryFfiNoIsolate,
    );
    calls.clear();
    online = false;
    existingRef = false;
  });

  test(
    'offline write is queued, shown as pending, then replayed on sync',
    () async {
      final r = repo();
      final res = await r.createLead(
        clientName: 'Acme',
        productInterest: 'Bottles',
        quantity: 500,
      );
      expect(res.queued, isTrue);
      expect(await store.pendingCount(), 1);

      online = true; // back online: pending item listed (flagged) ahead of server rows
      final leads = await r.leads();
      expect(leads.first.pendingSync, isTrue);
      expect(leads.first.clientName, 'Acme');

      final result = await SyncEngine(store, r.replay).run();
      expect(result.synced, 1);
      expect(await store.pendingCount(), 0);
      final create = calls.lastWhere(
        (c) => (c['query'] as String).contains('createLead'),
      );
      expect(jsonEncode(create['variables']), contains('Acme'));
      expect(jsonEncode(create['variables']), contains('clientRef'));
    },
  );

  test('sync while still offline keeps everything queued', () async {
    final r = repo();
    await r.createLead(clientName: 'A', productInterest: 'x');
    await r.createLead(clientName: 'B', productInterest: 'y');
    final res = await SyncEngine(store, r.replay).run();
    expect(res.synced, 0);
    expect(res.remaining, 2);
  });

  test('reads fall back to cache when offline', () async {
    online = true;
    final r = repo();
    expect((await r.leads()).single.name, 'Cached');
    online = false;
    expect((await r.leads()).single.name, 'Cached');
  });

  test(
    'replay is idempotent: skips create when clientRef already exists',
    () async {
      final r = repo();
      await r.createLead(clientName: 'A', productInterest: 'x');
      online = true;
      existingRef = true;
      final res = await SyncEngine(store, r.replay).run();
      expect(res.synced, 1);
      expect(
        calls.where((c) => (c['query'] as String).contains('createLead')),
        isEmpty,
      );
    },
  );
}
