import 'dart:async';
import 'dart:ui' show Locale;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../core/roles.dart';
import '../data/api/chatwoot_client.dart';
import '../data/api/server_client.dart';
import '../data/offline/offline_queue.dart';
import '../data/repository.dart';

/// Server settings entered on the login screen. Tokens are kept in the
/// Android Keystore-backed secure storage, never in source.
class AppConfig {
  AppConfig({this.serverUrl = 'https://sourceeasy.in', this.chatwootUrl = 'https://chat.sourceeasy.in',
      this.chatwootAccountId = 1, this.chatwootInboxId = 1, this.chatwootToken = ''});
  String serverUrl, chatwootUrl, chatwootToken;
  int chatwootAccountId, chatwootInboxId;
}

class Session extends ChangeNotifier {
  Session({FlutterSecureStorage? storage}) : _secure = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _secure;

  AppConfig config = AppConfig();
  String? email, displayName;
  Role role = Role.indiaStaff;
  /// Per-user feature grants from /api/me (null until the first successful fetch; cached for offline).
  Set<String>? granted;
  String? userId, avatarUrl;
  Permissions get perms => Permissions(role, granted);
  bool get signedIn => _repo != null;
  bool online = true;
  int pendingOps = 0;
  bool restoring = true;

  /// UI language: `en` or `zh-CN`. Saved on this device; also saved to the account when signed in.
  String? language;
  Locale? get locale => switch (language) { 'zh-CN' => const Locale('zh'), 'en' => const Locale('en'), _ => null };

  Future<void> setLanguage(String code) async {
    language = code;
    await _secure.write(key: 'language', value: code);
    notifyListeners();
    try { await _api?.setLanguage(code); } catch (_) {} // best effort; device choice already saved
  }

  ServerClient? _api;
  SourceEasyRepository? _repo;
  LocalStore? _store;
  SyncEngine? _sync;
  StreamSubscription? _conn;

  SourceEasyRepository get repo => _repo!;
  ChatwootClient? get chat => config.chatwootToken.isEmpty
      ? null
      : ChatwootClient(baseUrl: config.chatwootUrl, accountId: config.chatwootAccountId,
          inboxId: config.chatwootInboxId, accessToken: config.chatwootToken);

  Future<void> _loadConfig() async {
    final m = await _secure.readAll();
    config = AppConfig(
      serverUrl: m['serverUrl'] ?? config.serverUrl,
      chatwootUrl: m['chatwootUrl'] ?? config.chatwootUrl,
      chatwootAccountId: int.tryParse(m['chatwootAccountId'] ?? '') ?? 1,
      chatwootInboxId: int.tryParse(m['chatwootInboxId'] ?? '') ?? 1,
      chatwootToken: m['chatwootToken'] ?? '',
    );
    language = m['language'];
  }

  Future<void> saveConfig() async {
    await _secure.write(key: 'serverUrl', value: config.serverUrl);
    await _secure.write(key: 'chatwootUrl', value: config.chatwootUrl);
    await _secure.write(key: 'chatwootAccountId', value: '${config.chatwootAccountId}');
    await _secure.write(key: 'chatwootInboxId', value: '${config.chatwootInboxId}');
    await _secure.write(key: 'chatwootToken', value: config.chatwootToken);
    notifyListeners();
  }

  /// Restore a previous session on app start (works offline using cached role).
  Future<void> restore() async {
    try {
      await _loadConfig();
      final token = await _secure.read(key: 'token');
      if (token != null) {
        email = await _secure.read(key: 'email');
        displayName = await _secure.read(key: 'name');
        role = Role.fromCode(await _secure.read(key: 'role'));
        final g = await _secure.read(key: 'perms');
        if (g != null) granted = g.isEmpty ? <String>{} : g.split(',').toSet();
        userId = await _secure.read(key: 'userId');
        await _start(token);
      }
    } finally {
      restoring = false;
      notifyListeners();
    }
  }

  /// Signs in against the Source Easy server; the role comes from the server's user record.
  Future<void> signIn(String email, String password) async {
    await saveConfig();
    final me = await ServerClient(baseUrl: config.serverUrl).login(email, password);
    this.email = me.email;
    displayName = me.name.isEmpty ? me.email : me.name;
    role = Role.fromCode(me.role);
    if (language == null && (me.language == 'en' || me.language == 'zh-CN')) {
      language = me.language;
      await _secure.write(key: 'language', value: language);
    }
    await _start(me.token);
    _rebuildRepo();
    await _secure.write(key: 'token', value: me.token);
    await _secure.write(key: 'email', value: me.email);
    await _secure.write(key: 'name', value: displayName);
    await _secure.write(key: 'role', value: role.code);
    notifyListeners();
  }

  Future<void> _start(String token) async {
    _api = ServerClient(baseUrl: config.serverUrl, token: token);
    _store ??= await LocalStore.open(p.join(await getDatabasesPath(), 'source_easy.db'));
    _rebuildRepo();
    _conn ??= Connectivity().onConnectivityChanged.listen((r) {
      final was = online;
      online = !r.contains(ConnectivityResult.none);
      if (online && !was) syncNow();
      notifyListeners();
    });
    unawaited(syncNow());
    unawaited(refreshMe());
  }

  /// Re-reads /api/me: role, permissions and profile picture. Called on start and live when an admin
  /// changes this user's permissions (SSE `change` {type:'perms'}).
  Future<void> refreshMe() async {
    final api = _api; if (api == null) return;
    try {
      final j = await api.send('GET', '/api/me') as Map<String, dynamic>;
      final m = (j['data'] is Map ? j['data'] : j) as Map<String, dynamic>;
      userId = m['id']?.toString();
      if (m['role'] is String) role = Role.fromCode(m['role'] as String);
      if (m['name'] is String && (m['name'] as String).isNotEmpty) displayName = m['name'] as String;
      avatarUrl = m['avatarUrl'] as String?;
      if (m['permissions'] is List) granted = (m['permissions'] as List).map((e) => '$e').toSet();
      _rebuildRepo();
      await _secure.write(key: 'perms', value: granted?.join(',') ?? '');
      await _secure.write(key: 'role', value: role.code);
      if (userId != null) await _secure.write(key: 'userId', value: userId);
      notifyListeners();
    } catch (_) {/* offline: keep cached */}
  }

  /// Live change from the server stream; refreshes /api/me when it is about this user's permissions.
  void onServerChange(Map<String, dynamic> c) {
    if (c['type'] == 'perms' && (c['id'] == null || c['id'] == userId)) unawaited(refreshMe());
  }

  Future<void> changePassword(String current, String next) async {
    final j = await _api!.send('POST', '/api/me/password', body: {'currentPassword': current, 'newPassword': next}) as Map<String, dynamic>;
    final t = j['token'] as String?;
    if (t != null) { _api!.token = t; await _secure.write(key: 'token', value: t); }
  }

  Future<void> setAvatar(String? path) async {
    if (path == null) { await _api!.send('DELETE', '/api/me/avatar'); } else { await _api!.upload('/api/me/avatar', [path], field: 'file'); }
    await refreshMe();
  }

  /// Authenticated bytes of a server path (e.g. the avatar URL).
  Future<List<int>> bytes(String path) => _api!.getBytes(path);

  void _rebuildRepo() {
    _repo = SourceEasyRepository(api: _api!, store: _store!, perms: perms);
    _sync = SyncEngine(_store!, _repo!.replay);
  }

  Future<SyncResult?> syncNow() async {
    if (_sync == null) return null;
    final r = await _sync!.run();
    pendingOps = r.remaining;
    notifyListeners();
    return r;
  }

  Future<void> refreshPending() async {
    pendingOps = await _store?.pendingCount() ?? 0;
    notifyListeners();
  }

  Future<void> signOut() async {
    granted = null; userId = null; avatarUrl = null;
    for (final k in ['token', 'email', 'name', 'role', 'perms', 'userId']) {
      await _secure.delete(key: k);
    }
    _repo = null;
    _api = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _conn?.cancel();
    super.dispose();
  }
}
