import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/api/server_client.dart';
import 'package:source_easy/data/offline/offline_queue.dart';
import 'package:source_easy/data/repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:sqlite3/open.dart' as sqlite_open;
import 'dart:ffi';
import 'dart:io';

// Regression (0.3.4): lead detail failed with "Unknown object" because sourcingRequests/shippingOrders were
// retired by the Postgres API. Legacy lists must read as empty and shipments must come from /api/shipments.
void main() {
  if (Platform.isLinux) {
    sqlite_open.open.overrideFor(sqlite_open.OperatingSystem.linux, () {
      try { return DynamicLibrary.open('libsqlite3.so'); } catch (_) { return DynamicLibrary.open('libsqlite3.so.0'); }
    });
  }
  sqfliteFfiInit();
  final mock = MockClient((req) async {
    final p = req.url.path;
    if (p == '/api/records/leads/L1') return http.Response(jsonEncode({'data': {'id': 'L1', 'name': 'x', 'leadRef': 'SE-1', 'status': 'NEW', 'rejection': {'count': 0}}}), 200);
    if (p == '/api/shipments') {
      return http.Response(jsonEncode({'data': [
        {'id': 'S1', 'leadId': 'L1', 'ref': 'SE-1-S1', 'carrier': 'Maersk', 'tracking': 'T1', 'status': 'DELIVERED', 'etd': '2026-11-02', 'closed': true},
        {'id': 'S2', 'leadId': 'L2', 'ref': 'SE-2-S1', 'status': 'BOOKED'},
      ]}), 200);
    }
    if (p.startsWith('/api/records/')) return http.Response(jsonEncode({'error': 'Unknown object'}), 404);
    return http.Response('{}', 404);
  });
  test('lead detail data loads when legacy record types are gone', () async {
    final store = await LocalStore.open(inMemoryDatabasePath, factory: databaseFactoryFfiNoIsolate);
    final r = SourceEasyRepository(api: ServerClient(baseUrl: 'http://x', httpClient: mock), store: store, perms: const Permissions(Role.superAdmin));
    final l = await r.lead('L1');
    expect(l?.leadRef, 'SE-1');
    expect(await r.sourcingRequests(leadId: 'L1'), isEmpty);
    final sh = await r.shippingOrders(leadId: 'L1');
    expect(sh.single.forwarder, 'Maersk');
    expect(sh.single.shipmentStatus, 'DELIVERED');
    expect(sh.single.name, 'SE-1-S1');
  });
}
