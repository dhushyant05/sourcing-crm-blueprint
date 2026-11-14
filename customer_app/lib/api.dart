import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Server for the customer app. Only https is accepted (a plain-http URL is allowed for local debug builds only).
const portalBaseUrl = String.fromEnvironment('PORTAL_URL', defaultValue: 'https://sourceeasy.in');

class PortalError implements Exception {
  PortalError(this.message, this.status, [this.code]);
  final String message;
  final int status;
  final String? code;
  @override
  String toString() => message;
}

/// Small persistent key/value store (backed by Android Keystore-encrypted storage in the app; in-memory in tests).
abstract class KeyValue {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class MemoryKeyValue implements KeyValue {
  final Map<String, String> data = {};
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
  @override
  Future<void> delete(String key) async => data.remove(key);
}

typedef Json = Map<String, dynamic>;

/// Client for the customer portal API (/api/portal/* only). It never talks to staff endpoints and holds only the
/// customer portal token.
class PortalApi {
  PortalApi({http.Client? client, String baseUrl = portalBaseUrl, bool allowInsecure = false})
      : _client = client ?? http.Client(),
        base = Uri.parse(baseUrl) {
    if (base.scheme != 'https' && !allowInsecure) throw ArgumentError('The customer app only talks to an https server');
  }
  final http.Client _client;
  final Uri base;
  String? token;
  /// Called on 401 (expired / revoked token) so the app signs out immediately.
  void Function()? onAuthError;

  Uri _u(String path, [Map<String, String>? q]) {
    if (!path.startsWith('/api/portal/')) throw ArgumentError('Only /api/portal/* is allowed');
    return base.replace(path: path, queryParameters: q);
  }

  Uri _pub(String path, [Map<String, String>? q]) {
    if (!path.startsWith('/api/public/catalog/')) throw ArgumentError('Only public catalog paths are allowed');
    return base.replace(path: path, queryParameters: q);
  }

  Future<Json> _public(String method, String path, {Object? body, Map<String, String>? query}) async {
    final req = http.Request(method, _pub(path, query))..headers.addAll({'accept': 'application/json', if (token != null) ..._auth});
    if (body != null) { req.headers['content-type'] = 'application/json'; req.body = jsonEncode(body); }
    final r = await http.Response.fromStream(await _client.send(req).timeout(const Duration(seconds: 30)));
    return _handle(r);
  }

  Future<Json> catalogStatus() async => await _public('GET', '/api/public/catalog/status');
  Future<List<Json>> catalogCategories() async => ((await _public('GET', '/api/public/catalog/categories'))['data'] as List).cast<Json>();
  Future<Json> catalogProducts({String? q, String? category, String sort = 'trending', int window = 7}) async =>
      await _public('GET', '/api/public/catalog/products', query: {
        if (q != null && q.isNotEmpty) 'q': q,
        if (category != null) 'category': category,
        'sort': sort,
        'window': '$window',
        'limit': '48',
      });
  Future<Json> catalogProduct(String slug) async => (await _public('GET', '/api/public/catalog/products/${_e(slug)}'))['data'] as Json;
  Future<List<Json>> catalogRelated(String slug) async =>
      ((await _public('GET', '/api/public/catalog/products/${_e(slug)}/related'))['data'] as List? ?? []).cast<Json>();
  Future<List<String>> favoriteIds() async => ((await call('GET', '/api/portal/catalog/favorites/ids'))['data'] as List? ?? []).map((e) => '$e').toList();
  Future<List<Json>> favoriteList() async => ((await call('GET', '/api/portal/catalog/favorites'))['data'] as List? ?? []).cast<Json>();
  Future<void> favoriteAdd(String productId) async { await call('PUT', '/api/portal/catalog/favorites/${_e(productId)}'); }
  Future<void> favoriteRemove(String productId) async { await call('DELETE', '/api/portal/catalog/favorites/${_e(productId)}'); }
  Future<List<Json>> catalogBanners() async => ((await _public('GET', '/api/public/catalog/banners'))['data'] as List).cast<Json>();
  Future<List<Json>> catalogGreetings() async => ((await _public('GET', '/api/public/greetings'))['data'] as List? ?? []).cast<Json>();
  Future<Json> catalogEnquire(String id, Json body) async {
    if (token != null) {
      try { return await call('POST', '/api/portal/catalog/enquire', body: {'productId': id, ...body}); } catch (_) {}
    }
    return _public('POST', '/api/public/catalog/products/${_e(id)}/enquire', body: body);
  }

  Map<String, String> get _auth => {if (token != null) 'authorization': 'Bearer $token'};

  /// A 401 / revoke only ends the session if it is about the token in use now (not one replaced by a password change).
  void _authFailed(String? used) { if (used != null && used == token) onAuthError?.call(); }

  Future<Json> _handle(http.Response r, [String? used]) async {
    Json j;
    try {
      final d = jsonDecode(utf8.decode(r.bodyBytes));
      j = d is Map<String, dynamic> ? d : <String, dynamic>{};
    } catch (_) {
      j = {};
    }
    if (r.statusCode == 401 && used != null) {
      _authFailed(used);
      throw PortalError(j['error'] as String? ?? 'Please sign in again', 401);
    }
    if (r.statusCode >= 400) throw PortalError(j['error'] as String? ?? 'Something went wrong (${r.statusCode})', r.statusCode, j['code'] as String?);
    return j;
  }

  Future<Json> call(String method, String path, {Object? body, Map<String, String>? query}) async {
    final used = token;
    final req = http.Request(method, _u(path, query))..headers.addAll({..._auth, 'accept': 'application/json'});
    if (body != null) {
      req.headers['content-type'] = 'application/json';
      req.body = jsonEncode(body);
    }
    final r = await http.Response.fromStream(await _client.send(req).timeout(const Duration(seconds: 30)));
    return _handle(r, used);
  }

  /// Multipart upload (photos / videos). Files are given as (name, bytes).
  Future<Json> multipart(String path, Map<String, String> fields, List<UploadFile> files) async {
    final used = token;
    final req = http.MultipartRequest('POST', _u(path))..headers.addAll(_auth)..fields.addAll(fields);
    for (final f in files) {
      req.files.add(await http.MultipartFile.fromPath('files', f.path, filename: f.name));
    }
    final r = await http.Response.fromStream(await _client.send(req).timeout(const Duration(minutes: 5)));
    return _handle(r, used);
  }

  /// Authenticated binary download (quote PDF, own file, greeting image). Never a public link.
  Future<List<int>> bytes(String path) async {
    final used = token;
    final r = await _client.get(_u(path), headers: _auth).timeout(const Duration(seconds: 60));
    if (r.statusCode == 401 && used != null) {
      _authFailed(used);
      throw PortalError('Please sign in again', 401);
    }
    if (r.statusCode != 200) throw PortalError('Could not download the file', r.statusCode);
    return r.bodyBytes;
  }

  Future<Json> login(String phone, String password) async {
    final r = await _client.post(_u('/api/portal/auth/login'), headers: {'content-type': 'application/json'}, body: jsonEncode({'phone': phone, 'password': password})).timeout(const Duration(seconds: 30));
    if (r.statusCode != 200) {
      String msg = 'Sign-in failed';
      try { msg = (jsonDecode(r.body) as Map)['error'] as String? ?? msg; } catch (_) {}
      throw PortalError(msg, r.statusCode);
    }
    final j = jsonDecode(r.body) as Json;
    token = j['token'] as String?;
    return j;
  }

  Future<Json> me() async => (await call('GET', '/api/portal/me'))['data'] as Json;
  Future<Json> changePassword(String current, String next) async {
    final j = await call('POST', '/api/portal/me/password', body: {'currentPassword': current, 'newPassword': next});
    token = j['token'] as String? ?? token;
    return j['data'] as Json;
  }

  Future<List<Json>> _list(String path, [Map<String, String>? q]) async => ((await call('GET', path, query: q))['data'] as List).cast<Json>();
  Future<Json> _data(String m, String path, [Object? body]) async => (await call(m, path, body: body))['data'] as Json;
  String _e(String s) => Uri.encodeComponent(s);

  Future<List<Json>> requests() => _list('/api/portal/requests');
  Future<Json> request(String id) => _data('GET', '/api/portal/requests/${_e(id)}');
  Future<Json> createRequest(Map<String, String> fields, List<UploadFile> files) async => (await multipart('/api/portal/requests', fields, files))['data'] as Json;
  Future<Json> acceptQuote(String qid) => _data('POST', '/api/portal/quotes/${_e(qid)}/accept', {});
  Future<Json> rejectQuote(String qid, String code, String reason) => _data('POST', '/api/portal/quotes/${_e(qid)}/reject', {'reasonCode': code, 'reason': reason});
  Future<List<String>> reasons() async => ((await call('GET', '/api/portal/reject-reasons'))['data'] as List).cast<String>();
  Future<List<Json>> shippingList() => _list('/api/portal/shipping-requests');
  Future<Json> shipping(String id) => _data('GET', '/api/portal/shipping-requests/${_e(id)}');
  Future<Json> createShipping(Map<String, String> fields, List<UploadFile> files) async => (await multipart('/api/portal/shipping-requests', fields, files))['data'] as Json;
  Future<Json> replyShipping(String id, String message, List<UploadFile> files) async =>
      (await multipart('/api/portal/shipping-requests/${_e(id)}/reply', {'message': message}, files))['data'] as Json;
  Future<Json> cancelShipping(String id) => _data('POST', '/api/portal/shipping-requests/${_e(id)}/cancel', {});
  Future<List<Json>> shippableOrders() => _list('/api/portal/shippable-orders');
  /// Echo what the customer was shown; the server refuses with 409 `stale` if the quote changed since.
  Future<Json> acceptFreight(Json q) => _data('POST', '/api/portal/freight-quotes/${_e('${q['id']}')}/accept', {'version': q['version'], 'amount': q['amount'], 'currency': q['currency']});
  Future<Json> rejectFreight(String qid, String code, String reason) => _data('POST', '/api/portal/freight-quotes/${_e(qid)}/reject', {'reasonCode': code, 'reason': reason});
  Future<List<Json>> greetings() => _list('/api/portal/greetings', {'surface': 'APP'});
  Future<Json> notificationPrefs() => _data('GET', '/api/portal/me/notifications');
  Future<Json> setNotificationPrefs({bool? email, bool? push}) => _data('PUT', '/api/portal/me/notifications', {if (email != null) 'email': email, if (push != null) 'push': push});

  Future<void> registerDevice(String token) async { await call('POST', '/api/portal/me/devices', body: {'token': token, 'platform': 'android'}); }
  /// Server-side sign-out: revokes this login's sessions so a copied token stops working.
  Future<void> logout() async { await call('POST', '/api/portal/me/logout'); }
  Future<void> unregisterDevice(String token) async { await call('DELETE', '/api/portal/me/devices', body: {'token': token}); }

  /// Live "something changed" events for this customer's own requests (SSE). Completes when the stream ends.
  /// `revoked` (login disabled / password reset) signs the app out.
  Future<void> stream(void Function(String id, String type) onChange, {required Future<void> cancel}) async {
    final used = token;
    final req = http.Request('GET', _u('/api/portal/stream'))..headers.addAll({..._auth, 'accept': 'text/event-stream', 'cache-control': 'no-cache'});
    final res = await _client.send(req).timeout(const Duration(seconds: 30));
    if (res.statusCode == 401) {
      _authFailed(used);
      return;
    }
    if (res.statusCode != 200) return;
    final done = Completer<void>();
    late StreamSubscription<String> sub;
    var buf = '';
    sub = res.stream.transform(utf8.decoder).listen((chunk) {
      buf += chunk;
      int i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        final block = buf.substring(0, i);
        buf = buf.substring(i + 2);
        final ev = parseSse(block);
        if (ev == null) continue;
        if (ev.$1 == 'revoked') {
          _authFailed(used);
          sub.cancel();
          if (!done.isCompleted) done.complete();
          return;
        }
        if (ev.$1 == 'change') {
          try {
            final d = jsonDecode(ev.$2) as Json;
            onChange('${d['id']}', '${d['type'] ?? ''}');
          } catch (_) {}
        }
      }
    }, onDone: () { if (!done.isCompleted) done.complete(); }, onError: (_) { if (!done.isCompleted) done.complete(); });
    unawaited(cancel.then((_) { sub.cancel(); if (!done.isCompleted) done.complete(); }));
    return done.future;
  }
}

/// Parses one SSE block into (event, data). Comments / keep-alives return null.
(String, String)? parseSse(String block) {
  var ev = '', data = '';
  for (final line in block.split('\n')) {
    if (line.startsWith('event:')) ev = line.substring(6).trim();
    if (line.startsWith('data:')) data += line.substring(5).trim();
  }
  return ev.isEmpty ? null : (ev, data);
}

class UploadFile {
  UploadFile(this.path, this.name, this.size);
  final String path, name;
  final int size;
  static const photoMax = 10 * 1024 * 1024, videoMax = 100 * 1024 * 1024, maxFiles = 5;
  static const photoExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'], videoExt = ['mp4', 'm4v', 'mov', '3gp', 'webm', 'mkv'];
  String get ext => name.contains('.') ? name.split('.').last.toLowerCase() : '';
  bool get isVideo => videoExt.contains(ext);
  /// Same limits the server enforces (it checks the content too); returns a message or null.
  String? get problem {
    if (!photoExt.contains(ext) && !isVideo) return '$name: only photos or videos can be attached';
    if (size > (isVideo ? videoMax : photoMax)) return '$name is too large (max ${isVideo ? 100 : 10} MB)';
    return null;
  }
}
