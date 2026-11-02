// ignore_for_file: deprecated_member_use
import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

/// Firebase Cloud Messaging. Fully optional: without android/app/google-services.json, Firebase init fails
/// and the app keeps using the SSE stream + polling (with the bell) instead.
/// Foreground messages are ignored because the SSE stream already raises the same notification.
class Push {
  static String? token;
  static bool _ready = false;
  static StreamSubscription<String>? _sub;

  /// Returns the device token (or null when push isn't configured). [register] is called with each new token.
  static Future<String?> init(Future<void> Function(String token) register) async {
    try {
      if (!_ready) { await Firebase.initializeApp(); _ready = true; }
      final m = FirebaseMessaging.instance;
      await m.requestPermission();
      token = await m.getToken();
      if (token != null) await register(token!);
      await _sub?.cancel();
      _sub = m.onTokenRefresh.listen((t) { token = t; unawaited(register(t).catchError((_) {})); });
      return token;
    } catch (_) {
      return null; // not configured (no google-services.json) or no Play services
    }
  }

  static Future<void> stop() async { await _sub?.cancel(); _sub = null; }
}
