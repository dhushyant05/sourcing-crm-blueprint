// ignore_for_file: deprecated_member_use
import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'api.dart';

/// A push message as the app sees it. The server sends only {template, reference} as data (no internal details).
class PushMessage {
  const PushMessage({this.title, this.body, this.data = const {}});
  final String? title, body;
  final Map<String, String> data;
  String? get reference { final r = data['reference']; return r != null && RegExp(r'^[A-Z]{2}-\d{4}-\d{3,6}$').hasMatch(r) ? r : null; }
}

/// What the app needs from FCM (faked in tests).
abstract class PushBackend {
  /// Initialises Firebase. False when the app was built without a customer Firebase config (google-services.json).
  Future<bool> init();
  Future<bool> requestPermission();
  Future<String?> getToken();
  Future<void> deleteToken();
  Stream<String> get onTokenRefresh;
  Stream<PushMessage> get onForeground;
  Stream<PushMessage> get onOpened;
  Future<PushMessage?> initialMessage();
  /// Shows a foreground message on the app's notification channel (default sound).
  Future<void> show(PushMessage m);
}

/// Background entrypoint (FCM requires a top-level function). Notification messages are drawn by the system;
/// nothing is stored or fetched here.
@pragma('vm:entry-point')
Future<void> customerPushBackground(RemoteMessage m) async {}

PushMessage _fromRemote(RemoteMessage m) => PushMessage(title: m.notification?.title, body: m.notification?.body, data: {for (final e in m.data.entries) e.key: '${e.value}'});

class FirebasePushBackend implements PushBackend {
  static const _native = MethodChannel('sourceeasy.customer/notify');
  @override
  Future<bool> init() async {
    try {
      await Firebase.initializeApp(); // reads the customer project's google-services values; throws when absent
      FirebaseMessaging.onBackgroundMessage(customerPushBackground);
      return true;
    } catch (_) {
      return false;
    }
  }

  FirebaseMessaging get _m => FirebaseMessaging.instance;
  @override
  Future<bool> requestPermission() async {
    try { await _native.invokeMethod('requestPermission'); } catch (_) {}
    final s = await _m.requestPermission();
    return s.authorizationStatus == AuthorizationStatus.authorized || s.authorizationStatus == AuthorizationStatus.provisional;
  }
  @override
  Future<String?> getToken() => _m.getToken();
  @override
  Future<void> deleteToken() => _m.deleteToken();
  @override
  Stream<String> get onTokenRefresh => _m.onTokenRefresh;
  @override
  Stream<PushMessage> get onForeground => FirebaseMessaging.onMessage.map(_fromRemote);
  @override
  Stream<PushMessage> get onOpened => FirebaseMessaging.onMessageOpenedApp.map(_fromRemote);
  @override
  Future<PushMessage?> initialMessage() async { final m = await _m.getInitialMessage(); return m == null ? null : _fromRemote(m); }
  @override
  Future<void> show(PushMessage m) async {
    try { await _native.invokeMethod('show', {'title': m.title ?? 'Source Easy', 'body': m.body ?? '', 'reference': m.reference}); } catch (_) {}
  }
}

enum PushStatus { notConfigured, permissionDenied, noToken, registered, failed, off }

/// Customer push: optional, gated on a real Firebase config. Registers this device's token with
/// /api/portal/me/devices, re-registers on rotation, and unregisters on sign-out.
class PushService extends ChangeNotifier {
  PushService(this.backend);
  final PushBackend backend;
  PushStatus status = PushStatus.off;
  String? _token;
  bool? _configured;
  final _subs = <StreamSubscription<Object?>>[];
  /// Called when the customer taps a notification (or a foreground one arrives) with a validated reference.
  void Function(String reference)? onOpen;
  final _foreground = StreamController<PushMessage>.broadcast();
  Stream<PushMessage> get foreground => _foreground.stream;

  bool get configured => _configured == true;

  Future<PushStatus> start(PortalApi api) async {
    await stop();
    _configured ??= await backend.init();
    if (!configured) return _set(PushStatus.notConfigured);
    try {
      if (!await backend.requestPermission()) return _set(PushStatus.permissionDenied);
      final t = await backend.getToken();
      if (t == null) return _set(PushStatus.noToken);
      await api.registerDevice(t);
      _token = t;
      _subs.add(backend.onTokenRefresh.listen((n) async {
        final old = _token; _token = n;
        try { await api.registerDevice(n); if (old != null && old != n) await api.unregisterDevice(old); } catch (_) {}
      }));
      _subs.add(backend.onForeground.listen((m) { unawaited(backend.show(m)); _foreground.add(m); }));
      _subs.add(backend.onOpened.listen((m) { final r = m.reference; if (r != null) onOpen?.call(r); }));
      final first = await backend.initialMessage();
      if (first?.reference != null) onOpen?.call(first!.reference!);
      return _set(PushStatus.registered);
    } catch (_) {
      return _set(PushStatus.failed);
    }
  }

  /// Sign-out: tell the server to forget this device first (while the token is still valid), then drop it locally.
  Future<void> signOut(PortalApi api) async {
    final t = _token;
    await stop();
    if (t != null) {
      try { await api.unregisterDevice(t); } catch (_) {}
      try { await backend.deleteToken(); } catch (_) {}
    }
    _token = null;
    _set(configured ? PushStatus.off : PushStatus.notConfigured);
  }

  Future<void> stop() async { for (final s in _subs) { await s.cancel(); } _subs.clear(); }

  PushStatus _set(PushStatus s) { status = s; notifyListeners(); return s; }

  String get label => switch (status) {
        PushStatus.notConfigured => 'App notifications are not switched on yet for this app. Your choice is saved; open the app to see the latest updates.',
        PushStatus.permissionDenied => 'Notifications are blocked for this app. Allow them in your phone settings to get updates.',
        PushStatus.registered => 'This phone gets notifications for your quotes, orders and shipments.',
        PushStatus.noToken || PushStatus.failed => 'Could not set up notifications on this phone right now. We will try again next time you open the app.',
        PushStatus.off => 'Notifications start after you sign in.',
      };
}
