import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../models/models.dart';
import 'server_client.dart' show OfflineException, ApiException;

/// Chatwoot REST client (agent API). Each user stores their own Chatwoot
/// personal access token (Profile settings -> Access token) in the app.
/// Conversations live in an internal "API" inbox and carry the Source Easy
/// sourcing request ID as the custom attribute `sourcing_request_id`.
class ChatwootClient {
  ChatwootClient({required this.baseUrl, required this.accountId, required this.inboxId,
      required this.accessToken, http.Client? httpClient})
      : _http = httpClient ?? http.Client();

  final String baseUrl;
  final int accountId, inboxId;
  final String accessToken;
  final http.Client _http;

  Uri _u(String path) =>
      Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}/api/v1/accounts/$accountId$path');

  Future<dynamic> _send(String method, String path, [Map<String, dynamic>? body]) async {
    final req = http.Request(method, _u(path))
      ..headers.addAll({'api_access_token': accessToken, 'Content-Type': 'application/json'});
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
    if (res.statusCode >= 400) throw ApiException('Chatwoot ${res.statusCode}: ${res.body}', statusCode: res.statusCode);
    return res.body.isEmpty ? null : jsonDecode(res.body);
  }

  String conversationUrl(int id) =>
      '${baseUrl.replaceAll(RegExp(r'/+$'), '')}/app/accounts/$accountId/conversations/$id';

  /// Finds the conversation for a sourcing request by custom attribute.
  Future<int?> findConversation(String sourcingRequestId) async {
    final res = await _send('POST', '/conversations/filter', {
      'payload': [
        {'attribute_key': 'sourcing_request_id', 'filter_operator': 'equal_to',
         'values': [sourcingRequestId], 'query_operator': null, 'custom_attribute_type': 'conversation_attribute'}
      ]
    });
    final list = (res?['payload'] as List?) ?? const [];
    return list.isEmpty ? null : (list.first['id'] as num).toInt();
  }

  /// Creates an internal thread tagged with the sourcing request ID.
  Future<int> createConversation({required String sourcingRequestId, required String title}) async {
    final contact = await _send('POST', '/contacts', {
      'name': 'SR $title', 'identifier': 'sr-$sourcingRequestId', 'inbox_id': inboxId,
    });
    final payload = contact['payload'] as Map<String, dynamic>;
    final contactId = (payload['contact']?['id'] ?? payload['id']) as num;
    final sourceId = (payload['contact_inbox']?['source_id'] ??
        (payload['contact']?['contact_inboxes'] as List?)?.first['source_id']) as String?;
    final conv = await _send('POST', '/conversations', {
      'inbox_id': inboxId,
      'contact_id': contactId.toInt(),
      'source_id': ?sourceId,
      'custom_attributes': {'sourcing_request_id': sourcingRequestId},
      'additional_attributes': {'source_easy_title': title},
    });
    final id = (conv['id'] as num).toInt();
    await _send('POST', '/conversations/$id/labels', {'labels': ['source-easy']});
    return id;
  }

  Future<List<ChatMessage>> messages(int conversationId) async {
    final res = await _send('GET', '/conversations/$conversationId/messages');
    final list = (res?['payload'] as List?) ?? const [];
    return list
        .where((m) => (m['content'] as String?)?.isNotEmpty ?? false)
        .map((m) => ChatMessage(
              id: (m['id'] as num).toInt(),
              content: m['content'] as String,
              // message_type: 0 incoming, 1 outgoing, 2 activity
              outgoing: m['message_type'] == 1,
              sender: (m['sender']?['name'] as String?) ?? 'System',
              at: DateTime.fromMillisecondsSinceEpoch(((m['created_at'] as num).toInt()) * 1000),
            ))
        .toList();
  }

  Future<void> sendMessage(int conversationId, String content) =>
      _send('POST', '/conversations/$conversationId/messages',
          {'content': content, 'message_type': 'outgoing', 'private': false});
}
