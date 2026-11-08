import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'screens/auth.dart';
import 'screens/home.dart';
import 'session.dart';
import 'widgets.dart';

/// Android Keystore-backed storage, private to this app's package (in.sourceeasy.customer).
class SecureKeyValue implements KeyValue {
  const SecureKeyValue([this._s = const FlutterSecureStorage()]);
  final FlutterSecureStorage _s;
  @override
  Future<String?> read(String key) => _s.read(key: key);
  @override
  Future<void> write(String key, String value) => _s.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _s.delete(key: key);
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session(PortalApi(), const SecureKeyValue())..restore();
  runApp(CustomerApp(session: session));
}

class CustomerApp extends StatelessWidget {
  const CustomerApp({super.key, required this.session, this.live = true});
  final Session session;
  final bool live;
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Source Easy Customer',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: brand), useMaterial3: true),
        home: ListenableBuilder(listenable: session, builder: (context, _) {
          if (session.restoring) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          if (!session.signedIn) return LoginScreen(key: const Key('login'), session: session);
          if (session.mustChangePassword) return ChangePasswordScreen(key: const Key('forced-pw'), session: session, forced: true);
          return HomeScreen(key: ValueKey('home-${session.api.token.hashCode}'), session: session, live: live);
        }),
      );
}
