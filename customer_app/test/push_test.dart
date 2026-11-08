import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:source_easy_customer/api.dart';
import 'package:source_easy_customer/push.dart';
import 'package:source_easy_customer/session.dart';

class FakePush implements PushBackend {
  FakePush({this.configured = true, this.allowed = true, this.token = 'fcm-1'});
  bool configured, allowed;
  String? token;
  int deleted = 0;
  final shown = <PushMessage>[];
  final refresh = StreamController<String>.broadcast(), fg = StreamController<PushMessage>.broadcast(), opened = StreamController<PushMessage>.broadcast();
  PushMessage? initial;
  @override Future<bool> init() async => configured;
  @override Future<bool> requestPermission() async => allowed;
  @override Future<String?> getToken() async => token;
  @override Future<void> deleteToken() async => deleted++;
  @override Stream<String> get onTokenRefresh => refresh.stream;
  @override Stream<PushMessage> get onForeground => fg.stream;
  @override Stream<PushMessage> get onOpened => opened.stream;
  @override Future<PushMessage?> initialMessage() async => initial;
  @override Future<void> show(PushMessage m) async => shown.add(m);
}

/// Records device calls; [status] lets a test fail them.
(PortalApi, List<String>) apiWith({int status = 204}) {
  final calls = <String>[];
  final api = PortalApi(baseUrl: 'https://x.test', client: MockClient((r) async {
    calls.add('${r.method} ${r.url.path} ${r.body.isEmpty ? '' : (jsonDecode(r.body) as Map)['token']}'.trim());
    return http.Response(r.url.path.endsWith('/me') ? '{"data":{"name":"A"}}' : '', status);
  }))..token = 'portal-token';
  return (api, calls);
}

Future<void> tick() => Future<void>.delayed(Duration.zero);

void main() {
  test('without a Firebase config: honest disabled status, no network calls', () async {
    final (api, calls) = apiWith();
    final p = PushService(FakePush(configured: false));
    expect(await p.start(api), PushStatus.notConfigured);
    expect(p.label, contains('not switched on'));
    expect(calls, isEmpty);
    await p.signOut(api);
    expect(calls, isEmpty);
  });

  test('permission denied: nothing registered', () async {
    final (api, calls) = apiWith();
    final p = PushService(FakePush(allowed: false));
    expect(await p.start(api), PushStatus.permissionDenied);
    expect(calls, isEmpty);
    expect(p.label, contains('blocked'));
  });

  test('registers, rotates (new first, then old removed), sign-out unregisters and deletes the token', () async {
    final (api, calls) = apiWith();
    final f = FakePush();
    final p = PushService(f);
    expect(await p.start(api), PushStatus.registered);
    expect(calls, ['POST /api/portal/me/devices fcm-1']);
    f.refresh.add('fcm-2'); await tick(); await tick();
    expect(calls.sublist(1), ['POST /api/portal/me/devices fcm-2', 'DELETE /api/portal/me/devices fcm-1']);
    await p.signOut(api);
    expect(calls.last, 'DELETE /api/portal/me/devices fcm-2');
    expect(f.deleted, 1);
    f.refresh.add('fcm-3'); await tick();
    expect(calls.where((c) => c.contains('fcm-3')), isEmpty); // listeners stopped
  });

  test('registration failure is reported, not thrown', () async {
    final (api, _) = apiWith(status: 500);
    final p = PushService(FakePush());
    expect(await p.start(api), PushStatus.failed);
  });

  test('foreground messages are shown; taps open only well-formed references', () async {
    final (api, _) = apiWith();
    final f = FakePush()..initial = const PushMessage(data: {'reference': 'SH-2611-0004'});
    final p = PushService(f);
    final opened = <String>[];
    p.onOpen = opened.add;
    await p.start(api);
    expect(opened, ['SH-2611-0004']);
    f.fg.add(const PushMessage(title: 'Quote ready', body: 'b', data: {'reference': 'SE-2611-0001'})); await tick();
    expect(f.shown.single.title, 'Quote ready');
    for (final r in ['SE-2611-0001', '../../x', 'https://evil.test', 'SE-2611-0001; drop']) { f.opened.add(PushMessage(data: {'reference': r})); }
    await tick();
    expect(opened, ['SH-2611-0004', 'SE-2611-0001']);
  });

  test('session sign-out unregisters this phone before the token is cleared', () async {
    final (api, calls) = apiWith();
    final f = FakePush();
    final s = Session(api, MemoryKeyValue(), push: PushService(f));
    s.me = {'name': 'A'};
    await s.push!.start(api);
    await s.signOut();
    expect(calls.last, 'DELETE /api/portal/me/devices fcm-1');
    expect(api.token, isNull);
  });

  test('a 401 for a replaced token (after a password change) does not sign out', () async {
    var n = 0;
    final api = PortalApi(baseUrl: 'https://x.test', client: MockClient((r) async { n++; return http.Response('{}', 401); }))..token = 'old';
    var ended = 0; api.onAuthError = () => ended++;
    final f = api.me();
    api.token = 'new'; // password changed while the request was in flight
    await expectLater(f, throwsA(isA<PortalError>()));
    expect(ended, 0);
    await expectLater(api.me(), throwsA(isA<PortalError>()));
    expect(ended, 1); expect(n, 2);
  });
}
