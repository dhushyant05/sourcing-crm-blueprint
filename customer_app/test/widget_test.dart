import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:source_easy_customer/api.dart';
import 'package:source_easy_customer/main.dart';
import 'package:source_easy_customer/screens/shipping.dart';
import 'package:source_easy_customer/session.dart';

import 'fake_server.dart';

void main() {
  testWidgets('temporary password → forced change → home with greeting, quote accept, order value; sign-out clears everything', (t) async {
    final s = FakeServer()..requests.add(quoteRequest())
      ..greetings = [{'id': 'G1', 'version': 2, 'layout': 'FESTIVE', 'theme': 'GOLD', 'heading': 'Happy Diwali', 'message': 'Warm wishes', 'alt': null, 'link': null,
        'imageDesktop': null, 'imageMobile': null, 'dismissible': true, 'startsAt': DateTime.now().subtract(const Duration(hours: 1)).toUtc().toIso8601String(),
        'endsAt': DateTime.now().add(const Duration(days: 1)).toUtc().toIso8601String(), 'priority': 1}];
    final kv = MemoryKeyValue();
    final session = Session(PortalApi(baseUrl: 'https://x.test', client: s.client), kv);
    await session.restore();
    await t.pumpWidget(CustomerApp(session: session, live: false));
    await t.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    await t.tap(find.text('Sign in'));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('login')), findsOneWidget);

    await t.enterText(find.byKey(const Key('login-phone')), '9876543210');
    await t.enterText(find.byKey(const Key('login-password')), 'bad');
    await t.tap(find.byKey(const Key('login-submit')));
    await t.pumpAndSettle();
    expect(find.text('Invalid mobile number or password'), findsOneWidget);

    await t.enterText(find.byKey(const Key('login-password')), 'temp-pass-1');
    await t.tap(find.byKey(const Key('login-submit')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('forced-hint')), findsOneWidget);
    await t.enterText(find.byKey(const Key('pw-current')), 'temp-pass-1');
    await t.enterText(find.byKey(const Key('pw-new')), 'my-own-pass');
    await t.enterText(find.byKey(const Key('pw-again')), 'my-own-pass');
    await t.tap(find.byKey(const Key('pw-save')));
    await t.pumpAndSettle();

    await t.tap(find.text('Requests'));
    await t.pumpAndSettle();
    expect(find.text('Brass lamps'), findsOneWidget);
    expect(find.text('Happy Diwali'), findsOneWidget);
    await t.tap(find.byKey(const Key('greeting-close')));
    await t.pumpAndSettle();
    expect(find.text('Happy Diwali'), findsNothing);

    await t.tap(find.byKey(const Key('req-L1')));
    await t.pumpAndSettle();
    expect(find.text('Order value ₹60,000'), findsOneWidget);
    expect(find.text('500 units · Partly paid'), findsOneWidget);
    await t.scrollUntilVisible(find.text('Request received'), 200); // customer-safe timeline
    await t.scrollUntilVisible(find.byKey(const Key('quote-accept')), -200);
    await t.tap(find.byKey(const Key('quote-accept')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('quote-accept-confirm')));
    await t.pumpAndSettle();
    expect(find.text('Accepted'), findsOneWidget);
    expect(s.calls, contains('POST /api/portal/quotes/Q1/accept'));
    await t.pageBack();
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('account-menu')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('sign-out')));
    await t.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    expect(kv.data, isEmpty);
    expect(s.calls.where((c) => !c.split(' ')[1].startsWith('/api/portal/') && !c.split(' ')[1].startsWith('/api/public/')), isEmpty);
  });

  testWidgets('freight quote: PDF button, booking gate and accept confirmation are visible', (t) async {
    final s = FakeServer()..mustChange = false..ships.add(freightShip());
    final api = PortalApi(baseUrl: 'https://x.test', client: s.client);
    await api.login('9876543210', 'temp-pass-1');
    await t.pumpWidget(MaterialApp(home: ShippingDetailScreen(api: api, id: 'S1', changes: const Stream.empty())));
    await t.pumpAndSettle();
    expect(find.text('Freight quote ready'), findsOneWidget);
    await t.scrollUntilVisible(find.byKey(const Key('fq-accept')), 200);
    expect(find.byKey(const Key('booking-gate')), findsOneWidget);
    expect(find.byKey(const Key('fq-pdf')), findsOneWidget);
    expect(find.text('₹41,500'), findsOneWidget);
    await t.tap(find.byKey(const Key('fq-accept')));
    await t.pumpAndSettle();
    expect(find.textContaining('Source Easy will then book the shipment'), findsOneWidget);
  });

  for (final stale in [false, true]) {
    testWidgets('freight accept echoes the shown version/amount/currency${stale ? '; stale 409 refetches the new price' : ''}', (t) async {
      final s = FakeServer()..mustChange = false..ships.add(freightShip())..fqStale = stale;
      final api = PortalApi(baseUrl: 'https://x.test', client: s.client);
      await api.login('9876543210', 'temp-pass-1');
      await t.pumpWidget(MaterialApp(home: Scaffold(body: ShippingDetailScreen(api: api, id: 'S1', changes: const Stream.empty()))));
      await t.pumpAndSettle();
      await t.scrollUntilVisible(find.byKey(const Key('fq-accept')), 200);
      await t.tap(find.byKey(const Key('fq-accept'))); await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('fq-accept-confirm'))); await t.pumpAndSettle();
      expect(s.fqAccepts, [{'version': 1, 'amount': 41500, 'currency': 'INR'}]);
      final gets = s.calls.where((c) => c == 'GET /api/portal/shipping-requests/S1').length;
      if (stale) {
        expect(gets, greaterThanOrEqualTo(2)); // reloaded after the 409
        expect(find.text('₹48,000'), findsOneWidget); expect(find.text('₹41,500'), findsNothing);
        expect((s.ships.first['freightQuotes'] as List).first['status'], isNot('ACCEPTED'));
      } else {
        expect((s.ships.first['freightQuotes'] as List).first['status'], 'ACCEPTED');
      }
    });
  }
}
