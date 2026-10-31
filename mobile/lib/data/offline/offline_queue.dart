import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../api/twenty_client.dart';

/// A queued write, replayed in FIFO order when connectivity returns.
class PendingOp {
  PendingOp({this.id, required this.kind, required this.object, this.recordId,
      required this.payload, required this.clientRef, this.attempts = 0, this.lastError, DateTime? createdAt})
      : createdAt = createdAt ?? DateTime.now();
  final int? id;
  final String kind; // create | update
  final String object; // Twenty singular name, e.g. "lead"
  final String? recordId; // for updates
  final Map<String, dynamic> payload;
  final String clientRef; // idempotency key stored in the record's clientRef field
  final int attempts;
  final String? lastError;
  final DateTime createdAt;

  Map<String, Object?> toRow() => {
        'kind': kind, 'object': object, 'record_id': recordId, 'payload': jsonEncode(payload),
        'client_ref': clientRef, 'attempts': attempts, 'last_error': lastError,
        'created_at': createdAt.toIso8601String(),
      };

  static PendingOp fromRow(Map<String, Object?> r) => PendingOp(
        id: r['id'] as int,
        kind: r['kind'] as String,
        object: r['object'] as String,
        recordId: r['record_id'] as String?,
        payload: jsonDecode(r['payload'] as String) as Map<String, dynamic>,
        clientRef: r['client_ref'] as String,
        attempts: r['attempts'] as int,
        lastError: r['last_error'] as String?,
        createdAt: DateTime.parse(r['created_at'] as String),
      );
}

/// SQLite-backed offline store: a write queue plus a read cache of the last
/// fetched lists so screens still render offline.
class LocalStore {
  LocalStore(this.db);
  final Database db;
  static const maxAttempts = 8;

  static Future<LocalStore> open(String path, {DatabaseFactory? factory}) async {
    final f = factory ?? databaseFactory;
    final db = await f.openDatabase(path,
        options: OpenDatabaseOptions(version: 1, onCreate: (db, _) async {
          await db.execute('''CREATE TABLE pending_ops(
            id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, object TEXT NOT NULL,
            record_id TEXT, payload TEXT NOT NULL, client_ref TEXT NOT NULL UNIQUE,
            attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL)''');
          await db.execute('CREATE TABLE cache(key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)');
        }));
    return LocalStore(db);
  }

  // ---- queue ----
  Future<int> enqueue(PendingOp op) =>
      db.insert('pending_ops', op.toRow(), conflictAlgorithm: ConflictAlgorithm.ignore);

  Future<List<PendingOp>> pending() async =>
      (await db.query('pending_ops', orderBy: 'id ASC')).map(PendingOp.fromRow).toList();

  Future<int> pendingCount() async =>
      Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM pending_ops')) ?? 0;

  Future<void> remove(int id) => db.delete('pending_ops', where: 'id = ?', whereArgs: [id]);

  Future<void> markFailed(int id, String error) => db.rawUpdate(
      'UPDATE pending_ops SET attempts = attempts + 1, last_error = ? WHERE id = ?', [error, id]);

  // ---- cache ----
  Future<void> putCache(String key, Object json) => db.insert(
      'cache', {'key': key, 'json': jsonEncode(json), 'updated_at': DateTime.now().toIso8601String()},
      conflictAlgorithm: ConflictAlgorithm.replace);

  Future<dynamic> getCache(String key) async {
    final r = await db.query('cache', where: 'key = ?', whereArgs: [key]);
    return r.isEmpty ? null : jsonDecode(r.first['json'] as String);
  }
}

typedef OpExecutor = Future<void> Function(PendingOp op);

class SyncResult {
  SyncResult(this.synced, this.failed, this.remaining);
  final int synced, failed, remaining;
}

/// Replays queued writes. Stops at the first offline error (keeps order);
/// server-side rejections are retried up to [LocalStore.maxAttempts] then kept
/// for manual review (visible in Settings).
class SyncEngine {
  SyncEngine(this.store, this.execute);
  final LocalStore store;
  final OpExecutor execute;
  bool _running = false;

  Future<SyncResult> run() async {
    if (_running) return SyncResult(0, 0, await store.pendingCount());
    _running = true;
    var synced = 0, failed = 0;
    try {
      for (final op in await store.pending()) {
        if (op.attempts >= LocalStore.maxAttempts) continue;
        try {
          await execute(op);
          await store.remove(op.id!);
          synced++;
        } on OfflineException {
          break;
        } catch (e) {
          await store.markFailed(op.id!, e.toString());
          failed++;
        }
      }
    } finally {
      _running = false;
    }
    return SyncResult(synced, failed, await store.pendingCount());
  }
}
