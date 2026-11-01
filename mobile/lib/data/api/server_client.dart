import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Thrown when the device cannot reach the server; the offline queue handles these.
class OfflineException implements Exception {
  OfflineException(this.cause);
  final Object cause;
  @override
  String toString() => 'Offline: $cause';
}

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  bool get isAuth => statusCode == 401;
  @override
  String toString() => message;
}

/// Client for the Source Easy server (`server/`). Twenty is never called directly: the server holds
/// the Twenty API key and strips records/fields per role. The `fields` arguments are kept so the
/// repository reads the same, but the server decides what comes back.
class ServerClient {
  ServerClient({required this.baseUrl, this.token, http.Client? httpClient})
      : _http = httpClient ?? http.Client();

  final String baseUrl;
  String? token;
  final http.Client _http;

  Uri _uri(String path, [Map<String, String>? q]) =>
      Uri.parse(baseUrl.replaceAll(RegExp(r'/+$'), '') + path).replace(queryParameters: (q == null || q.isEmpty) ? null : q);

  Future<dynamic> send(String method, String path, {Object? body, Map<String, String>? query}) async {
    final req = http.Request(method, _uri(path, query))
      ..headers.addAll({
        'Accept': 'application/json',
        if (body != null) 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      });
    if (body != null) req.body = jsonEncode(body);
    http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 20)));
    } on SocketException catch (e) {
      throw OfflineException(e);
    } on TimeoutException catch (e) {
      throw OfflineException(e);
    } on http.ClientException catch (e) {
      throw OfflineException(e);
    }
    if (res.statusCode >= 500 && res.statusCode != 502) throw OfflineException('HTTP ${res.statusCode}');
    final j = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw ApiException((j is Map ? j['error'] : null)?.toString() ?? 'HTTP ${res.statusCode}', statusCode: res.statusCode);
    }
    return j;
  }

  Future<({String token, String email, String name, String role})> login(String email, String password) async {
    final j = await send('POST', '/api/auth/login', body: {'email': email, 'password': password}) as Map<String, dynamic>;
    final u = j['user'] as Map<String, dynamic>;
    return (token: j['token'] as String, email: u['email'] as String, name: u['name'] as String, role: u['role'] as String);
  }

  static String _plural(String singular) => '${singular}s';

  /// `filter` uses the `{'field': {'eq': value}}` shape; only `eq` is supported (the server whitelists fields).
  Future<List<Map<String, dynamic>>> findMany(String plural, String fields,
      {Map<String, dynamic>? filter, Map<String, dynamic>? orderBy, int first = 100}) async {
    final f = <String, String>{
      for (final e in (filter ?? const {}).entries) e.key: '${(e.value as Map)['eq']}',
    };
    if (f.length == 1 && f.containsKey('id')) {
      try {
        final j = await send('GET', '/api/records/$plural/${Uri.encodeComponent(f['id']!)}') as Map<String, dynamic>;
        return [j['data'] as Map<String, dynamic>];
      } on ApiException catch (e) {
        if (e.statusCode == 404) return [];
        rethrow;
      }
    }
    final j = await send('GET', '/api/records/$plural', query: f) as Map<String, dynamic>;
    final rows = (j['data'] as List).cast<Map<String, dynamic>>();
    rows.sort((a, b) => '${b['createdAt'] ?? ''}'.compareTo('${a['createdAt'] ?? ''}'));
    return rows.take(first).toList();
  }

  Future<Map<String, dynamic>> create(String singular, Map<String, dynamic> data, String fields) async =>
      (await send('POST', '/api/records/${_plural(singular)}', body: data) as Map<String, dynamic>)['data'] as Map<String, dynamic>;

  Future<Map<String, dynamic>> update(String singular, String id, Map<String, dynamic> data, String fields) async =>
      (await send('PATCH', '/api/records/${_plural(singular)}/$id', body: data) as Map<String, dynamic>)['data'] as Map<String, dynamic>;
}
