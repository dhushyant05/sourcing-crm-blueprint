import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../widgets/common.dart';
import 'chat_screen.dart';

/// Chat tab: one Chatwoot thread per sourcing request.
class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});
  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  late Future<List<SourcingRequest>> _f;
  @override
  void initState() {
    super.initState();
    _f = context.read<Session>().repo.sourcingRequests();
  }

  void _reload() => setState(() => _f = context.read<Session>().repo.sourcingRequests());

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.indiaChinaChat), actions: const [LanguageSwitch()]),
      body: s.chat == null
          ? Center(child: Padding(padding: EdgeInsets.all(24),
              child: Text(context.l10n.addYourChatwootAccessTokenIn, textAlign: TextAlign.center)))
          : RefreshIndicator(
              onRefresh: () async => _reload(),
              child: AsyncView<List<SourcingRequest>>(
                future: _f,
                onRetry: _reload,
                builder: (c, list) => ListView(
                  children: list
                      .map((r) => ListTile(
                            leading: Icon(r.chatwootConversationId != null ? Icons.forum : Icons.add_comment_outlined),
                            title: Text(r.productDescription ?? r.name),
                            subtitle: Text(r.chatwootConversationId != null ? 'Thread #${r.chatwootConversationId}' : context.l10n.noThreadYet),
                            trailing: r.status != null ? StatusChip(r.status!) : null,
                            onTap: () async {
                              await Navigator.push(c, MaterialPageRoute(builder: (_) => ChatScreen(request: r)));
                              _reload();
                            },
                          ))
                      .toList(),
                ),
              ),
            ),
    );
  }
}
