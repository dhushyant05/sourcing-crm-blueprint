import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'greetings.dart';
import 'push.dart';

/// Signed-in state. The only credential kept on the phone is the customer portal token, in encrypted storage under
/// this app's own package (never shared with the staff app). Signing out clears it and every cached customer data at once.
class Session extends ChangeNotifier {
  Session(this.api, this.store, {this.clearFiles, this.push}) {
    api.onAuthError = () => unawaited(signOut(reason: 'Your session ended. Please sign in again.'));
  }
  final PortalApi api;
  final KeyValue store;
  /// Deletes downloaded customer documents (PDFs, files) from the app cache on sign-out.
  final Future<void> Function()? clearFiles;
  /// Optional customer push (FCM). Null or not configured → the app runs without it.
  final PushService? push;
  static const tokenKey = 'portal.token';
  Json? me;
  bool restoring = true;
  String? notice;
  bool get signedIn => api.token != null && me != null;
  bool get mustChangePassword => me?['mustChangePassword'] == true;

  Future<void> restore() async {
    try {
      final t = await store.read(tokenKey);
      if (t != null) {
        api.token = t;
        me = await api.me();
      }
    } on PortalError catch (e) {
      if (e.status == 401 || e.status == 403) await _clear();
    } catch (_) {
      // offline: keep the token; screens show their own errors and retry
      if (api.token != null) me ??= {'name': '', 'mustChangePassword': false};
    } finally {
      restoring = false;
      notifyListeners();
    }
  }

  Future<void> signIn(String phone, String password) async {
    final j = await api.login(phone.trim(), password);
    await store.write(tokenKey, api.token!);
    me = {...?(j['customer'] as Json?)};
    try { me = await api.me(); } catch (_) {}
    notice = null;
    notifyListeners();
  }

  Future<void> changePassword(String current, String next) async {
    me = await api.changePassword(current, next);
    await store.write(tokenKey, api.token!); // the server issues a new token after a password change
    notifyListeners();
  }

  Future<void> _clear() async {
    api.token = null;
    me = null;
    await store.delete(tokenKey);
    await GreetingCache(store).clear();
    try { await clearFiles?.call(); } catch (_) {}
  }

  /// Immediate: credentials and cached data are removed before anything else happens.
  bool _signingOut = false;
  Future<void> signOut({String? reason}) async {
    if (_signingOut || (api.token == null && me == null)) return;
    _signingOut = true; // a 401 from the calls below must not re-enter signOut
    try {
      try { await push?.signOut(api); } catch (_) {} // unregister this phone while the token may still be valid
      if (reason == null) { try { await api.logout().timeout(const Duration(seconds: 8)); } catch (_) {} } // user-initiated: revoke on the server too
      await _clear();
    } finally { _signingOut = false; }
    notice = reason;
    notifyListeners();
  }
}
