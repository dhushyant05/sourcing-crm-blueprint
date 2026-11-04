import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:source_easy/services/session.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('signOut clears the session and never throws, even if secure storage fails', () async {
    final s = Session()..userId = 'u1';
    var notified = 0;
    s.addListener(() => notified++);
    await s.signOut(); // no secure-storage plugin in tests -> every delete throws
    expect(s.signedIn, isFalse);
    expect(s.userId, isNull);
    expect(notified, greaterThan(0));
  });

  testWidgets('sign-out from a pushed screen pops back to the root', (t) async {
    final key = GlobalKey<NavigatorState>();
    final s = Session();
    Session.onSignedOut = () => key.currentState?.popUntil((r) => r.isFirst); // same hook main.dart installs
    await t.pumpWidget(ChangeNotifierProvider.value(value: s, child: MaterialApp(navigatorKey: key, home: const Text('login'))));
    key.currentState!.push(MaterialPageRoute(builder: (_) => const Scaffold(body: Text('settings'))));
    await t.pump(); await t.pump(const Duration(milliseconds: 500));
    expect(find.text('settings'), findsOneWidget);
    s.signOut(); // not awaited: the UI must switch without waiting on storage/server
    await t.pump(); await t.pump(const Duration(milliseconds: 500));
    expect(find.text('settings'), findsNothing);
    expect(find.text('login'), findsOneWidget);
  });
}
