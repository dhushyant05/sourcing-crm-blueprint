import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../widgets/common.dart';
import 'chat_screen.dart';
import 'internal_chat_screen.dart';

/// Channels, direct messages, then personal and team inboxes.
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
    if (!enabled) {
      return _InboxData(enabled: false, inboxes: const [], threads: const [], channels: const [], dms: const []);
    }
    final inboxes = await repo.chatInboxes();
    final personal = inboxes.cast<Map<String, dynamic>?>().firstWhere(
          (i) => i?['kind'] == 'PERSONAL',
          orElse: () => inboxes.isNotEmpty ? inboxes.first : null,
        );
    final id = _inboxId ?? (personal?['id'] as String?);
    _inboxId = id;
    final threads = id == null ? <Map<String, dynamic>>[] : await repo.inboxConversations(id);
    var channels = <Map<String, dynamic>>[];
    var dms = <Map<String, dynamic>>[];
    try {
      final internal = await repo.internalChat();
      channels = ((internal['channels'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      dms = ((internal['dms'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    } catch (_) {}
    return _InboxData(enabled: true, inboxes: inboxes, threads: threads, channels: channels, dms: dms);
  }

  void _reload() => setState(() => _f = _load());

  Future<void> _openInternal(BuildContext c, Map<String, dynamic> item) async {
    await Navigator.push(
      c,
      MaterialPageRoute(
        builder: (_) => InternalChatScreen(
          conversationId: item['id'] as String,
          title: (item['title'] as String?) ?? (item['leadRef'] as String?),
        ),
      ),
    );
    _reload();
  }

  Future<void> _newDm(BuildContext c) async {
    final l = c.l10n;
    final repo = c.read<Session>().repo;
    List<Map<String, dynamic>> people = const [];
    try {
      people = await repo.chatDirectory();
    } catch (e) {
      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text('$e')));
      return;
    }
    if (!c.mounted) return;
    final picked = <String>{};
    final go = await showDialog<bool>(
      context: c,
      builder: (d) => StatefulBuilder(
        builder: (d, setD) => AlertDialog(
          title: Text(l.newMessage),
          content: SizedBox(
            width: 360,
            height: 360,
            child: ListView(
              children: [
                for (final p in people)
                  CheckboxListTile(
                    dense: true,
                    value: picked.contains(p['id']),
                    title: Text((p['name'] as String?) ?? ''),
                    subtitle: Text((p['role'] as String?) ?? ''),
                    onChanged: (v) => setD(() {
                      final id = p['id'] as String;
                      if (v == true) {
                        picked.add(id);
                      } else {
                        picked.remove(id);
                      }
                    }),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: Text(l.cancel)),
            TextButton(onPressed: picked.isEmpty ? null : () => Navigator.pop(d, true), child: Text(l.startChat)),
          ],
        ),
      ),
    );
    if (go != true || picked.isEmpty || !c.mounted) return;
    try {
      final conv = await repo.openDm(picked.toList());
      if (!c.mounted) return;
      await Navigator.push(
        c,
        MaterialPageRoute(
          builder: (_) => InternalChatScreen(
            conversationId: conv['id'] as String,
            title: (conv['title'] as String?) ?? (conv['leadRef'] as String?),
          ),
        ),
      );
      _reload();
    } catch (e) {
      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

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
                child: Text(l.channels, style: Theme.of(c).textTheme.titleSmall),
              ),
              if (data.channels.isEmpty)
                Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), child: Text(l.noChannels, style: Theme.of(c).textTheme.bodySmall))
              else
                ...data.channels.map((ch) => _internalTile(c, ch, Icons.tag)),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
                child: Row(children: [
                  Expanded(child: Text(l.directMessages, style: Theme.of(c).textTheme.titleSmall)),
                  IconButton(tooltip: l.newMessage, onPressed: () => _newDm(c), icon: const Icon(Icons.add)),
                ]),
              ),
              if (data.dms.isEmpty)
                Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), child: Text(l.noDirectMessages, style: Theme.of(c).textTheme.bodySmall))
              else
                ...data.dms.map((dm) => _internalTile(c, dm, Icons.forum_outlined)),
              const Divider(),
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
                  final kind = th['kind'] as String?;
                  final title = kind == 'CHANNEL' || kind == 'DM'
                      ? (th['title'] as String? ?? th['leadRef'] as String? ?? '')
                      : [th['leadRef'], th['product']].whereType<String>().where((s) => s.isNotEmpty).join(' · ');
                  return ListTile(
                    leading: const Icon(Icons.forum_outlined),
                    title: Text(title),
                    subtitle: (th['lastBody'] as String?) != null ? Text('${th['lastBody']}', maxLines: 1, overflow: TextOverflow.ellipsis) : null,
                    trailing: unread > 0
                        ? CircleAvatar(radius: 10, backgroundColor: Colors.red, child: Text('$unread', style: const TextStyle(color: Colors.white, fontSize: 10)))
                        : const Icon(Icons.chevron_right),
                    onTap: () async {
                      if (kind == 'CHANNEL' || kind == 'DM') {
                        await _openInternal(c, th);
                        return;
                      }
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

  Widget _internalTile(BuildContext c, Map<String, dynamic> item, IconData icon) {
    final unread = (item['unread'] as num?)?.toInt() ?? 0;
    return ListTile(
      leading: Icon(icon),
      title: Text((item['title'] as String?) ?? ''),
      subtitle: (item['lastBody'] as String?) != null ? Text('${item['lastBody']}', maxLines: 1, overflow: TextOverflow.ellipsis) : null,
      trailing: unread > 0
          ? CircleAvatar(radius: 10, backgroundColor: Colors.red, child: Text('$unread', style: const TextStyle(color: Colors.white, fontSize: 10)))
          : const Icon(Icons.chevron_right),
      onTap: () => _openInternal(c, item),
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
  _InboxData({required this.enabled, required this.inboxes, required this.threads, required this.channels, required this.dms});
  final bool enabled;
  final List<Map<String, dynamic>> inboxes, threads, channels, dms;
}
