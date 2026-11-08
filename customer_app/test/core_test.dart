import 'package:flutter_test/flutter_test.dart';
import 'package:source_easy_customer/api.dart';
import 'package:source_easy_customer/greetings.dart';
import 'package:source_easy_customer/session.dart';

import 'fake_server.dart';

Map<String, dynamic> g(String id, {int v = 1, int prio = 0, required DateTime start, required DateTime end}) =>
    {'id': id, 'version': v, 'priority': prio, 'layout': 'FESTIVE', 'theme': 'GOLD', 'heading': 'Hi', 'startsAt': start.toUtc().toIso8601String(), 'endsAt': end.toUtc().toIso8601String(), 'dismissible': true};

void main() {
  group('api', () {
    test('https only, portal paths only', () {
      expect(() => PortalApi(baseUrl: 'http://sourceeasy.in'), throwsArgumentError);
      final api = PortalApi(baseUrl: 'https://x.test', client: FakeServer().client);
      expect(() => api.call('GET', '/api/leads'), throwsArgumentError);
      expect(() => api.bytes('https://evil.test/x'), throwsArgumentError);
    });
    test('login, 401 ends the session', () async {
      final s = FakeServer();
      final api = PortalApi(baseUrl: 'https://x.test', client: s.client);
      await expectLater(api.login('9876543210', 'wrong'), throwsA(isA<PortalError>().having((e) => e.status, 'status', 401)));
      await api.login('9876543210', 'temp-pass-1');
      expect(api.token, 'tok1');
      var ended = false; api.onAuthError = () => ended = true;
      s.validToken = 'rotated';
      await expectLater(api.me(), throwsA(isA<PortalError>()));
      expect(ended, isTrue);
      expect(s.calls.every((c) => c.split(' ')[1].startsWith('/api/portal/')), isTrue);
    });
    test('SSE parsing', () {
      expect(parseSse('event: change\ndata: {"id":"L1"}'), ('change', '{"id":"L1"}'));
      expect(parseSse(': keep-alive'), isNull);
    });
    test('upload limits match the server', () {
      expect(UploadFile('/a', 'a.jpg', 1000).problem, isNull);
      expect(UploadFile('/a', 'a.svg', 10).problem, contains('only photos'));
      expect(UploadFile('/a', 'a.jpg', 11 * 1024 * 1024).problem, contains('too large'));
      expect(UploadFile('/a', 'v.mp4', 90 * 1024 * 1024).problem, isNull);
      expect(UploadFile('/a', 'v.mp4', 101 * 1024 * 1024).problem, contains('too large'));
    });
  });

  group('greetings', () {
    final t0 = DateTime.utc(2026, 11, 7, 6);
    test('priority, expiry (even from cache), per-version dismissal', () async {
      var now = t0;
      final kv = MemoryKeyValue();
      final c = GreetingCache(kv, now: () => now);
      final feed = [g('a', prio: 1, start: t0.subtract(const Duration(hours: 1)), end: t0.add(const Duration(minutes: 30))),
        g('b', prio: 5, start: t0.subtract(const Duration(hours: 1)), end: t0.add(const Duration(minutes: 10))),
        g('future', prio: 9, start: t0.add(const Duration(hours: 1)), end: t0.add(const Duration(hours: 2)))];
      await c.save(feed);
      expect((await c.pick(await c.cached()))?['id'], 'b');
      now = t0.add(const Duration(minutes: 11)); // b expired: dropped without asking the server
      expect((await c.pick(await c.cached()))?['id'], 'a');
      await c.dismiss(feed[0]);
      expect(await c.pick(feed), isNull);
      final republished = {...feed[0], 'version': 2};
      expect((await c.pick([republished]))?['id'], 'a'); // a new version shows again
      now = t0.add(const Duration(hours: 2)); // cache older than an hour is ignored
      expect(await c.cached(), isEmpty);
      expect(safeLinkPath('//evil.test'), isNull);
      expect(safeLinkPath('https://evil.test'), isNull);
      expect(safeLinkPath('/portal'), '/portal');
    });
  });

  group('session', () {
    test('sign-out clears the token and cached data immediately; a revoked token on restore is wiped', () async {
      final s = FakeServer()..mustChange = false;
      final kv = MemoryKeyValue();
      final session = Session(PortalApi(baseUrl: 'https://x.test', client: s.client), kv);
      await session.signIn('9876543210', 'temp-pass-1');
      expect(kv.data[Session.tokenKey], 'tok1');
      await GreetingCache(kv).save([{'id': 'x'}]);
      await session.signOut();
      expect(kv.data, isEmpty);
      expect(session.api.token, isNull);
      expect(session.signedIn, isFalse);

      kv.data[Session.tokenKey] = 'stale';
      final again = Session(PortalApi(baseUrl: 'https://x.test', client: s.client), kv);
      await again.restore();
      expect(again.signedIn, isFalse);
      expect(kv.data.containsKey(Session.tokenKey), isFalse);
    });
    test('forced temporary-password change stores the new token', () async {
      final s = FakeServer();
      final kv = MemoryKeyValue();
      final session = Session(PortalApi(baseUrl: 'https://x.test', client: s.client), kv);
      await session.signIn('9876543210', 'temp-pass-1');
      expect(session.mustChangePassword, isTrue);
      await expectLater(session.api.requests(), throwsA(isA<PortalError>().having((e) => e.code, 'code', 'password_change')));
      await session.changePassword('temp-pass-1', 'my-own-pass');
      expect(session.mustChangePassword, isFalse);
      expect(kv.data[Session.tokenKey], 'tok2');
      expect(await session.api.requests(), isEmpty);
    });
  });
}
