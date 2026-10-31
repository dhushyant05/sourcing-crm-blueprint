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
  bool get isAuth => statusCode == 401 || message.contains('UNAUTHENTICATED');
  @override
  String toString() => message;
}

/// Thin GraphQL client for Twenty. `/graphql` is the workspace data API,
/// `/metadata` is the schema API.
class TwentyClient {
  TwentyClient({required this.baseUrl, this.token, http.Client? httpClient})
      : _http = httpClient ?? http.Client();

  final String baseUrl;
  String? token;
  final http.Client _http;

  Future<Map<String, dynamic>> query(String document,
      {Map<String, dynamic>? variables, String endpoint = '/graphql'}) async {
    final uri = Uri.parse(baseUrl.replaceAll(RegExp(r'/+$'), '') + endpoint);
    http.Response res;
    try {
      res = await _http
          .post(uri,
              headers: {
                'Content-Type': 'application/json',
                if (token != null) 'Authorization': 'Bearer $token',
              },
              body: jsonEncode({'query': document, 'variables': variables ?? {}}))
          .timeout(const Duration(seconds: 20));
    } on SocketException catch (e) {
      throw OfflineException(e);
    } on TimeoutException catch (e) {
      throw OfflineException(e);
    } on http.ClientException catch (e) {
      throw OfflineException(e);
    }
    if (res.statusCode == 401) throw ApiException('Session expired', statusCode: 401);
    if (res.statusCode >= 500) throw OfflineException('HTTP ${res.statusCode}');
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final errors = body['errors'] as List?;
    if (errors != null && errors.isNotEmpty) {
      final first = errors.first as Map<String, dynamic>;
      final code = (first['extensions'] as Map?)?['code'];
      throw ApiException('${first['message']}${code != null ? ' ($code)' : ''}',
          statusCode: res.statusCode);
    }
    return (body['data'] as Map<String, dynamic>?) ?? {};
  }

  /// Helper to pull `edges[].node` out of a connection.
  static List<Map<String, dynamic>> nodes(Map<String, dynamic> data, String key) {
    final conn = data[key] as Map<String, dynamic>?;
    final edges = (conn?['edges'] as List?) ?? const [];
    return edges.map((e) => (e as Map<String, dynamic>)['node'] as Map<String, dynamic>).toList();
  }

  // ---- Generic CRUD against Twenty's auto-generated schema ----

  static String _cap(String s) => s[0].toUpperCase() + s.substring(1);

  Future<List<Map<String, dynamic>>> findMany(String plural, String fields,
      {Map<String, dynamic>? filter, Map<String, dynamic>? orderBy, int first = 100}) async {
    final singular = plural.endsWith('s') ? plural.substring(0, plural.length - 1) : plural;
    final t = _cap(singular);
    final doc = '''query(\$filter: ${t}FilterInput, \$orderBy: [${t}OrderByInput], \$first: Int) {
      $plural(filter: \$filter, orderBy: \$orderBy, first: \$first) { edges { node { $fields } } } }''';
    final data = await query(doc, variables: {
      'filter': ?filter,
      'orderBy': orderBy != null ? [orderBy] : [{'createdAt': 'DescNullsLast'}],
      'first': first,
    });
    return nodes(data, plural);
  }

  Future<Map<String, dynamic>> create(String singular, Map<String, dynamic> data, String fields) async {
    final t = _cap(singular);
    final res = await query('mutation(\$data: ${t}CreateInput!) { create$t(data: \$data) { $fields } }',
        variables: {'data': data});
    return res['create$t'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> update(String singular, String id, Map<String, dynamic> data, String fields) async {
    final t = _cap(singular);
    final res = await query(
        'mutation(\$id: UUID!, \$data: ${t}UpdateInput!) { update$t(id: \$id, data: \$data) { $fields } }',
        variables: {'id': id, 'data': data});
    return res['update$t'] as Map<String, dynamic>;
  }
}
