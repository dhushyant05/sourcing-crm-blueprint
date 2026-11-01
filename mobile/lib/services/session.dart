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
  AppConfig({this.serverUrl = 'https://sourceec.in', this.chatwootUrl = 'https://chat.sourceec.in',
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
  Permissions get perms => Permissions(role);
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
  }

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
    for (final k in ['token', 'email', 'name', 'role']) {
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
