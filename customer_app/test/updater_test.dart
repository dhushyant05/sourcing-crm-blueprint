import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:source_easy_customer/api.dart';
import 'package:source_easy_customer/format.dart';
import 'package:source_easy_customer/session.dart';
import 'package:source_easy_customer/updater.dart';
import 'package:source_easy_customer/widgets.dart' show safeName;

void main() {
  final apk = utf8.encode('PK fake apk bytes');
  final good = sha256.convert(apk).toString();
  late Directory tmp;
  setUp(() => tmp = Directory.systemTemp.createTempSync('upd'));
  tearDown(() => tmp.deleteSync(recursive: true));
  Updater mk(Map<String, dynamic>? manifest, {int installed = 1, List<int>? body, int status = 200, String url = 'https://sourceeasy.in/download/customer/version.json'}) => Updater(
      manifestUrl: url, installedBuild: () async => installed, cacheDir: () async => tmp,
      client: MockClient((r) async => r.url.path.endsWith('version.json') ? (manifest == null ? http.Response('', 404) : http.Response(jsonEncode(manifest), 200)) : http.Response.bytes(body ?? apk, status)));

  test('newer build offered; same/older ignored; nothing published is quiet', () async {
    final m = {'version': '1.0.1', 'build': 2, 'sha256': good, 'url': '/download/source-easy-customer.apk'};
    final i = await mk(m).check();
    expect(i!.build, 2); expect(i.apkUrl.toString(), 'https://sourceeasy.in/download/source-easy-customer.apk');
    expect(await mk(m, installed: 2).check(), isNull);
    expect(await mk(null).check(), isNull);
    expect(mk({...m, 'minBuild': 2}).check().then((x) => x!.isForcedFor(1)), completion(isTrue));
  });
  test('manifest must be https, same host, with a sha256', () async {
    final m = {'version': '1', 'build': 2, 'sha256': good};
    await expectLater(mk(m, url: 'http://sourceeasy.in/download/customer/version.json').check(), throwsA(isA<UpdateError>()));
    await expectLater(mk({...m, 'url': 'https://evil.test/x.apk'}).check(), throwsA(isA<UpdateError>()));
    await expectLater(mk({...m, 'url': 'http://sourceeasy.in/x.apk'}).check(), throwsA(isA<UpdateError>()));
    await expectLater(mk({'version': '1', 'build': 2}).check(), throwsA(isA<UpdateError>().having((e) => e.code, 'code', 'no_checksum')));
    expect(await mk({'version': '1', 'build': 2}).maybeCheck(), isNull); // auto-check stays silent
  });
  test('download verifies size and sha256 and keeps only a good file in cache/updates', () async {
    final u = mk({'version': '1', 'build': 2, 'sha256': good, 'size': apk.length});
    final f = await u.download((await u.check())!);
    expect(f.parent.path, '${tmp.path}/updates'); expect(f.readAsBytesSync(), apk);
    final bad = mk({'version': '1', 'build': 2, 'sha256': good}, body: utf8.encode('tampered'));
    await expectLater(bad.download((await bad.check())!), throwsA(isA<UpdateError>().having((e) => e.code, 'code', 'checksum')));
    expect(Directory('${tmp.path}/updates').listSync(), isEmpty);
    final short = mk({'version': '1', 'build': 2, 'sha256': good, 'size': apk.length + 5});
    await expectLater(short.download((await short.check())!), throwsA(isA<UpdateError>().having((e) => e.code, 'code', 'size')));
  });
  test('throttle: one automatic check per window', () async {
    var n = 0;
    final u = Updater(manifestUrl: 'https://sourceeasy.in/v.json', installedBuild: () async => 1, cacheDir: () async => tmp, client: MockClient((r) async { n++; return http.Response('', 404); }));
    final t = DateTime(2026, 11, 8, 10);
    await u.maybeCheck(now: t); await u.maybeCheck(now: t.add(const Duration(hours: 1))); await u.maybeCheck(now: t.add(const Duration(hours: 7)));
    expect(n, 2);
  });
  test('sign-out deletes downloaded documents', () async {
    var cleared = 0;
    final s = Session(PortalApi(baseUrl: 'https://x.test', client: MockClient((r) async => http.Response('{}', 401))), MemoryKeyValue(), clearFiles: () async => cleared++);
    s.api.token = 't'; s.me = {'name': 'A'};
    await expectLater(s.api.me(), throwsA(isA<PortalError>())); // 401 → automatic sign-out
    await Future<void>.delayed(Duration.zero);
    expect(cleared, 1); expect(s.api.token, isNull);
  });
  test('safe file names and IST dates', () {
    expect(safeName('../../etc/passwd'), '.._.._etc_passwd'.replaceAll(RegExp(r'^\.+'), ''));
    expect(safeName('..'), 'file'); expect(safeName(''), 'file'); expect(safeName('Quote SE-1.pdf'), 'Quote_SE-1.pdf');
    expect(day('2026-12-01'), '01 Dec 2026');
    expect(day('2026-11-30T20:00:00Z'), '01 Dec 2026'); // 01:30 IST next day
    expect(isYmd('2026-12-01'), isTrue); expect(isYmd('2026-13-01'), isFalse); expect(isYmd('01-12-2026'), isFalse); expect(isYmd('2026-02-30'), isFalse);
  });
}
