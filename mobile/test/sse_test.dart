import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:source_easy/data/api/server_client.dart';

void main() {
  test('parses the SSE notification stream and sends the JWT as a header', () async {
    final srv = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    String? auth;
    srv.listen((r) async {
      auth = r.headers.value('authorization');
      r.response.headers.contentType = ContentType('text', 'event-stream');
      r.response.write('retry: 3000\n\n: ping\n\nevent: hello\ndata: {"unread":2}\n\n');
      r.response.write('event: notification\ndata: {"notification":{"id":"n1","leadId":"L1","leadRef":"SE-1","kind":"ASSIGNED"},"unread":3}\n\n');
      await r.response.close();
    });
    final c = ServerClient(baseUrl: 'http://127.0.0.1:${srv.port}', token: 'tok');
    final evs = await c.sse('/api/notifications/stream').toList();
    expect(auth, 'Bearer tok');
    expect(evs.map((e) => e.event), ['hello', 'notification']);
    expect(evs[1].data['unread'], 3);
    await srv.close(force: true);
  });
}
