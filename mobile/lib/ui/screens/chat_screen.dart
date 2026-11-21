import 'dart:async';

import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';

/// India↔China chat for a lead, via the Source Easy API.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.leadId, this.leadRef, this.title, this.suggestedQuoteId});
  final String leadId;
  final String? leadRef, title, suggestedQuoteId;
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  List<ChatMessage> _msgs = [];
  List<ChatQuoteOption> _quotes = [];
  String? _quoteId, _error;
  bool _loading = true, _sending = false, _enabled = true;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _quoteId = widget.suggestedQuoteId;
    _init();
  }

  Future<void> _init() async {
    try {
      final repo = context.read<Session>().repo;
      if (!await repo.chatEnabled()) {
        setState(() { _enabled = false; _loading = false; });
        return;
      }
      await _refresh(open: true);
      _poll = Timer.periodic(const Duration(seconds: 10), (_) => _refresh());
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refresh({bool open = false}) async {
    final s = context.read<Session>();
    try {
      final d = await s.repo.leadChat(widget.leadId, open: open || _msgs.isNotEmpty);
      final quotes = ((d['quotes'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => ChatQuoteOption.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      final msgs = ((d['messages'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e), me: s.displayName))
          .toList();
      if (!mounted) return;
      setState(() {
        _msgs = msgs;
        _quotes = quotes;
        _quoteId ??= widget.suggestedQuoteId ?? (d['suggestedQuoteId'] as String?) ?? (quotes.isNotEmpty ? quotes.first.id : null);
        _error = null;
        _enabled = d['enabled'] != false;
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      await context.read<Session>().repo.sendLeadChat(widget.leadId, text);
      _input.clear();
      await _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.l10n.notSent('$e'))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _attach() async {
    setState(() => _sending = true);
    try {
      await context.read<Session>().repo.attachQuoteReference(widget.leadId, quoteId: _quoteId);
      await _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.l10n.notSent('$e'))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<Session>().displayName;
    final cs = Theme.of(context).colorScheme;
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title ?? widget.leadRef ?? l.chat),
        bottom: widget.leadRef == null
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(18),
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(widget.leadRef!, style: Theme.of(context).textTheme.bodySmall),
                ),
              ),
      ),
      body: Column(children: [
        if (_error != null) MaterialBanner(content: Text(_error!), actions: [TextButton(onPressed: _refresh, child: Text(l.retry))]),
        if (!_enabled && !_loading)
          Expanded(child: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(l.chatUnavailable, textAlign: TextAlign.center))))
        else ...[
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
                            if (m.isQuoteRef)
                              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(m.quoteLabel!, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w600)),
                                if ((m.quoteProduct ?? '').isNotEmpty) Text(m.quoteProduct!),
                                if ((m.quoteMoq ?? '').isNotEmpty) Text('MOQ ${m.quoteMoq}'),
                                if ((m.quoteCarton ?? '').isNotEmpty) Text(m.quoteCarton!),
                              ])
                            else
                              Text(m.content),
                            Text(DateFormat('dd MMM HH:mm').format(m.at.toLocal()), style: Theme.of(c).textTheme.labelSmall),
                          ]),
                        ),
                      );
                    },
                  ),
          ),
          if (_quotes.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
              child: Row(children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: const Key('chat-quote-picker'),
                    initialValue: _quotes.any((q) => q.id == _quoteId) ? _quoteId : (_quotes.isNotEmpty ? _quotes.first.id : null),
                    isExpanded: true,
                    decoration: InputDecoration(labelText: l.quoteToAttach, isDense: true),
                    items: [
                      for (final q in _quotes)
                        DropdownMenuItem(value: q.id, child: Text([q.label, q.product].where((s) => s != null && s.isNotEmpty).join(' · '))),
                    ],
                    onChanged: (v) => setState(() => _quoteId = v),
                  ),
                ),
                const SizedBox(width: 8),
                TextButton.icon(onPressed: _sending ? null : _attach, icon: const Icon(Icons.attach_file), label: Text(l.attachQuoteReference)),
              ]),
            ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Row(children: [
                Expanded(
                    child: TextField(
                        controller: _input,
                        minLines: 1,
                        maxLines: 4,
                        decoration: InputDecoration(hintText: l.message, isDense: true),
                        onSubmitted: (_) => _send())),
                const SizedBox(width: 8),
                IconButton.filled(onPressed: _sending ? null : _send, icon: const Icon(Icons.send)),
              ]),
            ),
          ),
        ],
      ]),
    );
  }
}
