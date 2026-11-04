import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:source_easy/data/api/server_client.dart';
import 'package:source_easy/services/quick_unlock.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('PIN is stored hashed, checks right/wrong, and 5 wrong PINs wipe quick unlock', () async {
    const st = FlutterSecureStorage();
    final q = QuickUnlock(st);
    expect(QuickUnlock.validPin('12'), isFalse);
    expect(QuickUnlock.validPin('1234567'), isFalse);
    expect(QuickUnlock.validPin('12a4'), isFalse);
    await q.setPin('4821');
    final all = await st.readAll();
    expect(all.values.any((v) => v.contains('4821')), isFalse);
    await q.load();
    expect(q.pinSet, isTrue);
    expect(await q.check('4821'), isTrue);
    for (var i = 1; i <= 4; i++) { expect(await q.check('0000'), isFalse); expect(q.attemptsLeft, 5 - i); }
    expect(await q.check('4821'), isTrue); // a right PIN resets the counter
    for (var i = 0; i < 5; i++) { await q.check('0000'); }
    expect(q.lockedOut, isTrue);
    await q.load();
    expect(q.pinSet, isFalse);
    expect(await q.check('4821'), isFalse);
  });

  test('ServerClient refreshes once on 401 and retries the call', () async {
    var tokenSeen = <String?>[];
    final c = MockClient((r) async {
      tokenSeen.add(r.headers['Authorization']);
      return r.headers['Authorization'] == 'Bearer new' ? http.Response(jsonEncode({'ok': true}), 200) : http.Response(jsonEncode({'error': 'Session expired'}), 401);
    });
    final api = ServerClient(baseUrl: 'https://x', token: 'old', httpClient: c);
    var refreshes = 0;
    api.onUnauthorized = () async { refreshes++; api.token = 'new'; return true; };
    expect(await api.send('GET', '/api/me'), {'ok': true});
    expect(refreshes, 1);
    expect(tokenSeen, ['Bearer old', 'Bearer new']);
    // refresh fails -> the 401 surfaces, no loop
    api.token = 'bad'; api.onUnauthorized = () async { refreshes++; return false; };
    await expectLater(api.send('GET', '/api/me'), throwsA(isA<ApiException>().having((e) => e.isAuth, 'isAuth', true)));
    expect(refreshes, 2);
  });
}
