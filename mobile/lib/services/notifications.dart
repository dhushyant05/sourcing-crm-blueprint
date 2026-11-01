import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../data/models/models.dart';
import '../data/repository.dart';

/// Polls the server's notification inbox while the app is open/resumed and raises a local
/// Android notification for items that arrived since the last poll. No background worker.
class NotificationCenter extends ChangeNotifier {
  NotificationCenter(this._repo, {this.interval = const Duration(seconds: 60), MethodChannel? channel})
      : _ch = channel ?? const MethodChannel('sourceeasy/notify');
  final SourceEasyRepository _repo;
  final Duration interval;
  final MethodChannel _ch;
  Timer? _t;
  Set<String>? _seen;
  List<AppNotification> items = [];
  int unread = 0;
  /// Builds the system-notification text (localised by the caller).
  String Function(AppNotification)? describe;
  String title = 'Source Easy';

  void start() {
    _t?.cancel();
    _t = Timer.periodic(interval, (_) => poll());
    poll();
  }

  void stop() { _t?.cancel(); _t = null; }

  Future<void> requestPermission() async { try { await _ch.invokeMethod('requestPermission'); } catch (_) {} }

  Future<void> poll() async {
    try {
      final r = await _repo.notifications();
      final fresh = _seen == null ? const <AppNotification>[] : r.items.where((n) => !n.read && !_seen!.contains(n.id)).toList();
      _seen = {...?_seen, ...r.items.map((n) => n.id)};
      items = r.items; unread = r.unread;
      notifyListeners();
      for (final n in fresh.take(3)) {
        try {
          await _ch.invokeMethod('show', {'id': n.id.hashCode & 0x7fffffff, 'title': title, 'body': describe?.call(n) ?? (n.leadRef ?? ''), 'channel': title});
        } catch (_) {}
      }
    } catch (_) {/* offline: keep last state */}
  }

  Future<void> markRead([String? id]) async {
    try { await _repo.markNotificationRead(id); } catch (_) {}
    await poll();
  }

  @override
  void dispose() { stop(); super.dispose(); }
}
