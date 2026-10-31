import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';

/// Native chat over Chatwoot's REST API, tied to a sourcing request.
/// Polls every 10 s while open (FCM push for replies is a TODO).
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.request});
  final SourcingRequest request;
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  List<ChatMessage> _msgs = [];
  int? _conv;
  String? _error;
  bool _loading = true, _sending = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _conv = widget.request.chatwootConversationId;
    _init();
  }

  Future<void> _init() async {
    final s = context.read<Session>();
    final chat = s.chat;
    if (chat == null) {
      setState(() { _error = 'Set your Chatwoot token in Settings'; _loading = false; });
      return;
    }
    try {
      _conv ??= await chat.findConversation(widget.request.id);
      if (_conv == null) {
        _conv = await chat.createConversation(sourcingRequestId: widget.request.id,
            title: widget.request.productDescription ?? widget.request.name);
        await s.repo.linkChat(widget.request.id, _conv!, chat.conversationUrl(_conv!));
      }
      await _refresh();
      _poll = Timer.periodic(const Duration(seconds: 10), (_) => _refresh());
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refresh() async {
    final chat = context.read<Session>().chat;
    if (chat == null || _conv == null) return;
    try {
      final m = await chat.messages(_conv!);
      if (mounted) setState(() { _msgs = m; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _conv == null) return;
    setState(() => _sending = true);
    try {
      await context.read<Session>().chat!.sendMessage(_conv!, text);
      _input.clear();
      await _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Not sent: $e')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<Session>().displayName;
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(widget.request.productDescription ?? 'Chat'), bottom: PreferredSize(
          preferredSize: const Size.fromHeight(18),
          child: Text('Sourcing request ${widget.request.id.substring(0, 8)}', style: Theme.of(context).textTheme.bodySmall))),
      body: Column(children: [
        if (_error != null) MaterialBanner(content: Text(_error!), actions: [TextButton(onPressed: _refresh, child: const Text('Retry'))]),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.all(12),
                  itemCount: _msgs.length,
                  itemBuilder: (c, i) {
                    final m = _msgs[_msgs.length - 1 - i];
                    final mine = m.sender == me;
                    return Align(
                      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.symmetric(vertical: 4),
                        padding: const EdgeInsets.all(10),
                        constraints: BoxConstraints(maxWidth: MediaQuery.of(c).size.width * .75),
                        decoration: BoxDecoration(
                          color: mine ? cs.primaryContainer : cs.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          if (!mine) Text(m.sender, style: TextStyle(fontWeight: FontWeight.bold, color: cs.primary, fontSize: 12)),
                          Text(m.content),
                          Text(DateFormat('dd MMM HH:mm').format(m.at), style: Theme.of(c).textTheme.labelSmall),
                        ]),
                      ),
                    );
                  },
                ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
            child: Row(children: [
              Expanded(child: TextField(controller: _input, minLines: 1, maxLines: 4,
                  decoration: const InputDecoration(hintText: 'Message', isDense: true), onSubmitted: (_) => _send())),
              const SizedBox(width: 8),
              IconButton.filled(onPressed: _sending ? null : _send, icon: const Icon(Icons.send)),
            ]),
          ),
        ),
      ]),
    );
  }
}
