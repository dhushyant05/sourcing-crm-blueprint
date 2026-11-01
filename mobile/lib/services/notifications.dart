import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../data/models/models.dart';
import '../data/repository.dart';

/// Real-time notifications while the app is in the foreground: an SSE stream from the server, with a
/// 15 s poll as the fallback. New items update the badge and raise a system notification with the bell sound.
/// No background worker (stopped when the app is paused).
class NotificationCenter extends ChangeNotifier {
  NotificationCenter(this._repo, {this.interval = const Duration(seconds: 15), this.live = true, MethodChannel? channel})
      : _ch = channel ?? const MethodChannel('sourceeasy/notify');
  final SourceEasyRepository _repo;
  final Duration interval;
  final bool live;
  StreamSubscription? _sub;
  bool _running = false;
  int _backoff = 2;
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
    _running = true;
    poll();
    if (live) _connect();
  }

  void _connect() {
    _sub?.cancel();
    if (!_running) return;
    final opened = DateTime.now();
    _sub = _repo.notificationStream().listen((e) {
      _backoff = 2;
      unread = e.unread;
      final n = e.item;
      if (n != null && !(_seen?.contains(n.id) ?? false)) {
        (_seen ??= {}).add(n.id);
        items = [n, ...items.where((x) => x.id != n.id)].take(50).toList();
        _alert(n);
      }
      notifyListeners();
    }, onError: (_) => _retry(opened), onDone: () => _retry(opened), cancelOnError: true);
  }

  void _retry(DateTime opened) {
    if (!_running) return;
    if (DateTime.now().difference(opened).inSeconds > 30) _backoff = 2;
    final d = _backoff; _backoff = (_backoff * 2).clamp(2, 30);
    Timer(Duration(seconds: d), () { if (_running) { poll(); _connect(); } });
  }

  Future<void> _alert(AppNotification n) async {
    try {
      await _ch.invokeMethod('show', {'id': n.id.hashCode & 0x7fffffff, 'title': title, 'body': describe?.call(n) ?? (n.leadRef ?? ''), 'channel': title});
    } catch (_) {}
  }

  void stop() { _running = false; _t?.cancel(); _t = null; _sub?.cancel(); _sub = null; }

  Future<void> requestPermission() async { try { await _ch.invokeMethod('requestPermission'); } catch (_) {} }

  Future<void> poll() async {
    try {
      final r = await _repo.notifications();
      final fresh = _seen == null ? const <AppNotification>[] : r.items.where((n) => !n.read && !_seen!.contains(n.id)).toList();
      _seen = {...?_seen, ...r.items.map((n) => n.id)};
      items = r.items; unread = r.unread;
      notifyListeners();
      for (final n in fresh.take(3)) { await _alert(n); }
    } catch (_) {/* offline: keep last state */}
  }

  Future<void> markRead([String? id]) async {
    try { await _repo.markNotificationRead(id); } catch (_) {}
    await poll();
  }

  @override
  void dispose() { stop(); super.dispose(); }
}
