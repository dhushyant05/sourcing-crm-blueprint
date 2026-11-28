import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../l10n/l10n.dart';
import '../../services/session.dart';

/// Channel or direct-message thread, via conversation id (not lead id).
class InternalChatScreen extends StatefulWidget {
  const InternalChatScreen({super.key, required this.conversationId, this.title});
  final String conversationId;
  final String? title;
  @override
  State<InternalChatScreen> createState() => _InternalChatScreenState();
}

bool looksSensitive(String text) {
  final t = text.trim();
  if (t.isEmpty) return false;
  if (RegExp(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', caseSensitive: false).hasMatch(t)) return true;
  if (RegExp(r'(?:USD|INR|RMB|CNY|Rs\.?|₹|\$|¥)\s*\d[\d,]*(?:\.\d+)?', caseSensitive: false).hasMatch(t)) return true;
  if (RegExp(r'\d[\d,]*(?:\.\d+)?\s*(?:USD|INR|RMB|CNY|yuan|rupees?)', caseSensitive: false).hasMatch(t)) return true;
  if (RegExp(r'(?:\+\d{1,4}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d[\d\s\-()]{6,}\d').hasMatch(t) &&
      RegExp(r'\d{6,}').hasMatch(t.replaceAll(RegExp(r'\D'), ''))) { return true; }
  return false;
}

class _InternalChatScreenState extends State<InternalChatScreen> {
  final _input = TextEditingController();
  final _quoteQ = TextEditingController();
  List<ChatMessage> _msgs = [];
  List<ChatQuoteOption> _quotes = [];
  List<Map<String, dynamic>> _members = [];
  String? _quoteId, _error, _title;
  bool _loading = true, _sending = false, _mixed = false, _canLeave = false, _warn = false, _pickingQuote = false;

  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _title = widget.title;
    _refresh();
    _poll = Timer.periodic(const Duration(seconds: 8), (_) => _refresh());
  }

  Future<void> _refresh() async {
    final s = context.read<Session>();
    try {
      final d = await s.repo.conversation(widget.conversationId);
      final msgs = ((d['messages'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e), me: s.displayName))
          .toList();
      if (!mounted) return;
      setState(() {
        _msgs = msgs;
        _members = ((d['members'] as List?) ?? (d['participants'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _mixed = d['mixed'] == true;
        _canLeave = d['canLeave'] == true;
        _title = (d['title'] as String?) ?? _title;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _loading = false; });
    }
  }

  List<String> _mentionIds(String text) {
    final ids = <String>[];
    for (final m in _members) {
      final name = (m['name'] as String?) ?? '';
      final id = (m['userId'] as String?) ?? (m['id'] as String?) ?? '';
      if (name.isEmpty || id.isEmpty) continue;
      if (RegExp('@${RegExp.escape(name)}\\b').hasMatch(text)) ids.add(id);
    }
    return ids;
  }

  Future<void> _send({bool anyway = false}) async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    if (_mixed && looksSensitive(text) && !anyway) {
      setState(() => _warn = true);
      return;
    }
    setState(() { _sending = true; _warn = false; });
    try {
      await context.read<Session>().repo.sendConversationMessage(widget.conversationId, text, mentionIds: _mentionIds(text));
      _input.clear();
      await _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.l10n.notSent('$e'))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _searchQuotes(String q) async {
    if (q.trim().isEmpty) {
      setState(() => _quotes = []);
      return;
    }
    try {
      final rows = await context.read<Session>().repo.quoteOptions(q.trim());
      if (!mounted) return;
      setState(() => _quotes = rows.map(ChatQuoteOption.fromJson).where((x) => x.id.isNotEmpty).toList());
    } catch (_) {}
  }

  Future<void> _attach() async {
    final id = _quoteId;
    if (id == null || id.isEmpty) return;
    setState(() => _sending = true);
    try {
      await context.read<Session>().repo.attachConversationQuote(widget.conversationId, id);
      setState(() { _pickingQuote = false; _quotes = []; _quoteQ.clear(); });
      await _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.l10n.notSent('$e'))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _leave() async {
    try {
      await context.read<Session>().repo.leaveConversation(widget.conversationId);
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    _quoteQ.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<Session>().displayName;
    final cs = Theme.of(context).colorScheme;
    final l = context.l10n;
    final memberNames = _members.map((m) => (m['name'] as String?) ?? '').where((s) => s.isNotEmpty).join(', ');
    return Scaffold(
      appBar: AppBar(
        title: Text(_title ?? l.chat),
        actions: [
          if (_canLeave) TextButton(onPressed: _leave, child: Text(l.leaveChannel)),
        ],
        bottom: memberNames.isEmpty
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(20),
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 6, left: 16, right: 16),
                  child: Text(memberNames, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall),
                ),
              ),
      ),
      body: Column(children: [
        if (_error != null) MaterialBanner(content: Text(_error!), actions: [TextButton(onPressed: _refresh, child: Text(l.retry))]),
        if (_mixed)
          Material(
            color: cs.tertiaryContainer,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(l.mixedChannelWarning, style: Theme.of(context).textTheme.bodySmall),
            ),
          ),
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
        if (_pickingQuote)
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
            child: Column(children: [
              TextField(
                controller: _quoteQ,
                decoration: InputDecoration(hintText: l.searchQuotes, isDense: true, suffixIcon: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _pickingQuote = false))),
                onChanged: _searchQuotes,
              ),
              if (_quotes.isNotEmpty)
                SizedBox(
                  height: 120,
                  child: ListView(
                    children: [
                      for (final q in _quotes)
                        ListTile(
                          dense: true,
                          selected: q.id == _quoteId,
                          title: Text([q.label, q.product].where((s) => s != null && s.isNotEmpty).join(' · ')),
                          onTap: () => setState(() => _quoteId = q.id),
                        ),
                    ],
                  ),
                ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(onPressed: _sending || _quoteId == null ? null : _attach, icon: const Icon(Icons.attach_file), label: Text(l.attachQuoteReference)),
              ),
            ]),
          ),
        if (_warn)
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
            child: Row(children: [
              Expanded(child: Text(l.sensitiveMixedWarning, style: Theme.of(context).textTheme.bodySmall)),
              TextButton(onPressed: () => _send(anyway: true), child: Text(l.sendAnyway)),
              TextButton(onPressed: () => setState(() => _warn = false), child: Text(l.cancel)),
            ]),
          ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
            child: Row(children: [
              IconButton(tooltip: l.attachQuoteReference, onPressed: () => setState(() => _pickingQuote = !_pickingQuote), icon: const Icon(Icons.request_quote_outlined)),
              Expanded(
                  child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 4,
                      decoration: InputDecoration(hintText: l.message, isDense: true),
                      onChanged: (_) { if (_warn) setState(() => _warn = false); },
                      onSubmitted: (_) => _send())),
              const SizedBox(width: 8),
              IconButton.filled(onPressed: _sending ? null : _send, icon: const Icon(Icons.send)),
            ]),
          ),
        ),
      ]),
    );
  }
}
