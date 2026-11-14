import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

import 'api.dart';
import 'screens/auth.dart';
import 'screens/home.dart';
import 'screens/marketplace.dart';
import 'push.dart';
import 'session.dart';
import 'updater.dart';
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
  // Release builds only accept https; a debug build may point PORTAL_URL at a local http server for QA.
  final session = Session(PortalApi(allowInsecure: !kReleaseMode), const SecureKeyValue(), clearFiles: clearDownloads, push: PushService(FirebasePushBackend()))..restore();
  runApp(CustomerApp(session: session, updater: Platform.isAndroid ? Updater() : null));
}

/// Removes documents downloaded for viewing (app cache pdf/ and files/).
Future<void> clearDownloads() async {
  final t = (await getTemporaryDirectory()).path;
  for (final d in ['pdf', 'files']) {
    final dir = Directory('$t/$d');
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  }
}

class CustomerApp extends StatelessWidget {
  const CustomerApp({super.key, required this.session, this.live = true, this.updater});
  final Session session;
  final Updater? updater;
  final bool live;
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Source Easy Customer',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: brand), useMaterial3: true),
        home: ListenableBuilder(listenable: session, builder: (context, _) {
          if (session.restoring) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          if (!session.signedIn) return _GuestShell(session: session);
          if (session.mustChangePassword) return ChangePasswordScreen(key: const Key('forced-pw'), session: session, forced: true);
          return UpdateGate(updater: updater, child: HomeScreen(key: ValueKey('home-${session.api.token.hashCode}'), session: session, live: live));
        }),
      );
}


class _GuestShell extends StatelessWidget {
  const _GuestShell({required this.session});
  final Session session;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Row(children: [Image.asset('assets/brand/mark.png', height: 28), const SizedBox(width: 8), const Text('Source Easy')])),
        body: MarketplaceTab(api: session.api, onSignIn: () {
          Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LoginScreen(key: const Key('login'), session: session)));
        }),
      );
}
