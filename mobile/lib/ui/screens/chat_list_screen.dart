import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../widgets/common.dart';
import 'chat_screen.dart';

/// Personal and team inboxes: only conversations this person takes part in (or is granted).
class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});
  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  late Future<_InboxData> _f;
  String? _inboxId;

  @override
  void initState() {
    super.initState();
    _f = _load();
  }

  Future<_InboxData> _load() async {
    final repo = context.read<Session>().repo;
    final enabled = await repo.chatEnabled();
    if (!enabled) return _InboxData(enabled: false, inboxes: const [], threads: const []);
    final inboxes = await repo.chatInboxes();
    final personal = inboxes.cast<Map<String, dynamic>?>().firstWhere(
          (i) => i?['kind'] == 'PERSONAL',
          orElse: () => inboxes.isNotEmpty ? inboxes.first : null,
        );
    final id = _inboxId ?? (personal?['id'] as String?);
    _inboxId = id;
    final threads = id == null ? <Map<String, dynamic>>[] : await repo.inboxConversations(id);
    return _InboxData(enabled: true, inboxes: inboxes, threads: threads);
  }

  void _reload() => setState(() => _f = _load());

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.indiaChinaChat), actions: const [LanguageSwitch()]),
      body: RefreshIndicator(
        onRefresh: () async => _reload(),
        child: AsyncView<_InboxData>(
          future: _f,
          onRetry: _reload,
          builder: (c, data) {
            if (!data.enabled) {
              return ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(l.chatUnavailable, textAlign: TextAlign.center))]);
            }
            return ListView(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Text(l.myInbox, style: Theme.of(c).textTheme.titleSmall),
              ),
              ...data.inboxes.where((i) => i['kind'] == 'PERSONAL').map((i) => _inboxTile(c, l, i, personal: true)),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Text(l.teamInboxes, style: Theme.of(c).textTheme.titleSmall),
              ),
              ...data.inboxes.where((i) => i['kind'] == 'TEAM').map((i) => _inboxTile(c, l, i)),
              const Divider(),
              if (data.threads.isEmpty)
                Padding(padding: const EdgeInsets.all(24), child: Text(l.noLeads, textAlign: TextAlign.center))
              else
                ...data.threads.map((th) {
                  final unread = (th['unread'] as num?)?.toInt() ?? 0;
                  return ListTile(
                    leading: const Icon(Icons.forum_outlined),
                    title: Text([th['leadRef'], th['product']].whereType<String>().where((s) => s.isNotEmpty).join(' · ')),
                    subtitle: (th['lastBody'] as String?) != null ? Text('${th['lastBody']}', maxLines: 1, overflow: TextOverflow.ellipsis) : null,
                    trailing: unread > 0
                        ? CircleAvatar(radius: 10, backgroundColor: Colors.red, child: Text('$unread', style: const TextStyle(color: Colors.white, fontSize: 10)))
                        : const Icon(Icons.chevron_right),
                    onTap: () async {
                      // Customer support and supplier email threads have no lead; they are answered in the web app.
                      if (th['leadId'] is! String) {
                        ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(l.chatOpenOnWeb)));
                        return;
                      }
                      await Navigator.push(
                        c,
                        MaterialPageRoute(
                          builder: (_) => ChatScreen(
                            leadId: th['leadId'] as String,
                            leadRef: th['leadRef'] as String?,
                            title: th['product'] as String?,
                          ),
                        ),
                      );
                      _reload();
                    },
                  );
                }),
            ]);
          },
        ),
      ),
    );
  }

  Widget _inboxTile(BuildContext c, AppLocalizations l, Map<String, dynamic> i, {bool personal = false}) {
    final id = i['id'] as String? ?? '';
    final unread = (i['unread'] as num?)?.toInt() ?? 0;
    final selected = id == _inboxId;
    return ListTile(
      selected: selected,
      leading: Icon(personal ? Icons.inbox_outlined : Icons.groups_outlined),
      title: Text(personal ? l.myInbox : (i['name'] as String? ?? '')),
      trailing: unread > 0
          ? CircleAvatar(radius: 10, backgroundColor: Colors.red, child: Text('$unread', style: const TextStyle(color: Colors.white, fontSize: 10)))
          : null,
      onTap: () {
        setState(() {
          _inboxId = id;
          _f = _load();
        });
      },
    );
  }
}

class _InboxData {
  _InboxData({required this.enabled, required this.inboxes, required this.threads});
  final bool enabled;
  final List<Map<String, dynamic>> inboxes, threads;
}
