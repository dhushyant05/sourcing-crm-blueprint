import 'dart:convert';

import 'api.dart';

/// Home-screen greetings (APP surface). Rules shared with the website:
/// - only what the server returns is shown (it never sends drafts, unpublished or expired greetings);
/// - the cached copy is used for at most [maxAge] and every greeting is dropped once its end time passes, even offline;
/// - closing a greeting hides that version; a re-published (new version) greeting shows again.
class GreetingCache {
  GreetingCache(this.store, {DateTime Function()? now}) : _now = now ?? DateTime.now;
  final KeyValue store;
  final DateTime Function() _now;
  static const feedKey = 'greet.feed', dismissKey = 'greet.dismissed';
  static const maxAge = Duration(hours: 1);

  Future<void> save(List<Json> feed) => store.write(feedKey, jsonEncode({'at': _now().toUtc().toIso8601String(), 'data': feed}));

  Future<List<Json>> cached() async {
    try {
      final c = jsonDecode(await store.read(feedKey) ?? 'null');
      if (c is! Map) return [];
      final at = DateTime.parse(c['at'] as String);
      if (_now().difference(at) > maxAge) return [];
      return (c['data'] as List).cast<Json>();
    } catch (_) {
      return [];
    }
  }

  Future<Set<String>> dismissed() async {
    try { return {...(jsonDecode(await store.read(dismissKey) ?? '[]') as List).cast<String>()}; } catch (_) { return {}; }
  }

  Future<void> dismiss(Json g) async {
    final d = (await dismissed()).where((k) => !k.startsWith('${g['id']}:')).toList()..add('${g['id']}:${g['version']}');
    await store.write(dismissKey, jsonEncode(d.length > 50 ? d.sublist(d.length - 50) : d));
  }

  bool current(Json g) {
    final now = _now();
    final s = DateTime.tryParse('${g['startsAt']}'), e = DateTime.tryParse('${g['endsAt']}');
    return s != null && e != null && !s.isAfter(now) && e.isAfter(now);
  }

  /// The greeting to show now, or null.
  Future<Json?> pick(List<Json> feed) async {
    final d = await dismissed();
    final live = feed.where((g) => current(g) && !d.contains('${g['id']}:${g['version']}')).toList()
      ..sort((a, b) => ((b['priority'] as num?) ?? 0).compareTo((a['priority'] as num?) ?? 0));
    return live.isEmpty ? null : live.first;
  }

  Future<void> clear() async { await store.delete(feedKey); await store.delete(dismissKey); }
}

/// Links in greetings must stay inside the app / site.
String? safeLinkPath(String? p) => p != null && p.startsWith('/') && !p.startsWith('//') ? p : null;
