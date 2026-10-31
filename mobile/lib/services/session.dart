import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../core/roles.dart';
import '../data/api/chatwoot_client.dart';
import '../data/api/twenty_auth.dart';
import '../data/api/twenty_client.dart';
import '../data/offline/offline_queue.dart';
import '../data/repository.dart';

/// Server settings entered on the login screen. Tokens are kept in the
/// Android Keystore-backed secure storage, never in source.
class AppConfig {
  AppConfig({this.twentyUrl = 'https://sourceec.in', this.chatwootUrl = 'https://chat.sourceec.in',
      this.chatwootAccountId = 1, this.chatwootInboxId = 1, this.chatwootToken = ''});
  String twentyUrl, chatwootUrl, chatwootToken;
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

  TwentyClient? _api;
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
      twentyUrl: m['twentyUrl'] ?? config.twentyUrl,
      chatwootUrl: m['chatwootUrl'] ?? config.chatwootUrl,
      chatwootAccountId: int.tryParse(m['chatwootAccountId'] ?? '') ?? 1,
      chatwootInboxId: int.tryParse(m['chatwootInboxId'] ?? '') ?? 1,
      chatwootToken: m['chatwootToken'] ?? '',
    );
  }

  Future<void> saveConfig() async {
    await _secure.write(key: 'twentyUrl', value: config.twentyUrl);
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

  Future<void> signIn(String email, String password) async {
    await saveConfig();
    final api = TwentyClient(baseUrl: config.twentyUrl);
    final auth = TwentyAuth(api);
    final token = await auth.signIn(email, password);
    api.token = token;
    final me = await auth.currentUser();
    this.email = me.email;
    displayName = me.name.isEmpty ? me.email : me.name;
    await _start(token);
    final code = await repo.roleCodeFor(me.email);
    if (code == null) {
      await signOut();
      throw ApiException('No Source Easy role is set for ${me.email}. Ask your office admin to add you under Team Members.');
    }
    role = Role.fromCode(code);
    _rebuildRepo();
    await _secure.write(key: 'token', value: token);
    await _secure.write(key: 'email', value: me.email);
    await _secure.write(key: 'name', value: displayName);
    await _secure.write(key: 'role', value: role.code);
    notifyListeners();
  }

  Future<void> _start(String token) async {
    _api = TwentyClient(baseUrl: config.twentyUrl, token: token);
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
