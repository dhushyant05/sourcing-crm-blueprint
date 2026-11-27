import 'package:flutter/material.dart';

import '../api.dart';

/// Customer support chat for signed-in accounts and (with a stored visitor cookie) guests.
class SupportChatScreen extends StatefulWidget {
  const SupportChatScreen({
    super.key,
    required this.api,
    required this.signedIn,
    this.productId,
    this.productSlug,
    this.productTitle,
    this.source = 'app',
  });
  final PortalApi api;
  final bool signedIn;
  final String? productId, productSlug, productTitle, source;
  @override
  State<SupportChatScreen> createState() => _SupportChatScreenState();
}

class _SupportChatScreenState extends State<SupportChatScreen> {
  Json? _desk, _conv;
  List<Json> _history = [];
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _draft = TextEditingController();
  bool _consent = false;
  bool _busy = false;
  String? _err;
  bool _list = false;

  @override
  void initState() {
    super.initState();
    if (widget.productTitle != null) _draft.text = "I'd like to ask about ${widget.productTitle}";
    _boot();
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _draft.dispose();
    super.dispose();
  }

  Future<void> _boot() async {
    try {
      _desk = await widget.api.supportStatus(portal: widget.signedIn);
      if (widget.signedIn) {
        _history = await widget.api.portalSupportConversations();
        if (_history.length == 1) {
          _conv = await widget.api.portalSupportConversation('${_history.first['id']}');
        } else if (_history.isNotEmpty) {
          _list = true;
        }
      } else {
        _conv = await widget.api.guestConversation();
      }
      if (mounted) setState(() {});
    } on PortalError catch (e) {
      if (mounted) setState(() => _err = e.message);
    } catch (_) {
      if (mounted) setState(() => _err = 'Could not reach support right now.');
    }
  }

  Map<String, dynamic> get _product => {
        if (widget.productId != null) 'productId': widget.productId,
        if (widget.productSlug != null) 'productSlug': widget.productSlug,
        if (widget.productTitle != null) 'productTitle': widget.productTitle,
        'source': widget.source ?? 'app',
      };

  Future<void> _start() async {
    setState(() { _busy = true; _err = null; });
    try {
      if (widget.signedIn) {
        _conv = await widget.api.startPortalSupport({
          'message': _draft.text.trim(),
          ..._product,
          if (_list) 'new': true,
        });
        _history = await widget.api.portalSupportConversations();
        _list = false;
        _draft.clear();
      } else {
        if (!_consent) { setState(() { _err = 'Please agree to be contacted about this conversation.'; _busy = false; }); return; }
        final data = await widget.api.startGuestSupport({
          'name': _name.text.trim(),
          'email': _email.text.trim(),
          'phone': _phone.text.trim(),
          'consent': true,
          'message': _draft.text.trim(),
          'challenge': _desk?['challenge'],
          ..._product,
        });
        if (data['ok'] == true && data['id'] == null) {
          _draft.clear();
        } else {
          _conv = data;
          _draft.clear();
        }
      }
    } on PortalError catch (e) {
      _err = e.message;
    } catch (_) {
      _err = 'Could not start the chat.';
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _send() async {
    final text = _draft.text.trim();
    if (text.isEmpty || _conv == null) return;
    setState(() { _busy = true; _err = null; });
    try {
      if (widget.signedIn) {
        await widget.api.sendPortalSupport('${_conv!['id']}', text);
        _conv = await widget.api.portalSupportConversation('${_conv!['id']}');
      } else {
        await widget.api.sendGuestSupport(text);
        _conv = await widget.api.guestConversation();
      }
      _draft.clear();
    } on PortalError catch (e) {
      _err = e.message;
    } catch (_) {
      _err = 'Could not send the message.';
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _openHistory(Json c) async {
    try {
      final d = await widget.api.portalSupportConversation('${c['id']}');
      if (mounted) setState(() { _conv = d; _list = false; });
    } on PortalError catch (e) {
      if (mounted) setState(() => _err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final online = _desk?['online'] == true;
    final msgs = ((_conv?['messages'] as List?) ?? []).cast<Json>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat with Source Easy'),
        leading: _list || (_conv != null && widget.signedIn && _history.length > 1 && !_list)
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () {
                  if (_conv != null && !_list && widget.signedIn) {
                    setState(() { _conv = null; _list = _history.isNotEmpty; });
                  } else {
                    Navigator.pop(context);
                  }
                },
              )
            : null,
        actions: [
          if (widget.signedIn && _conv != null)
            TextButton(onPressed: () => setState(() { _conv = null; _list = false; _draft.text = widget.productTitle != null ? "I'd like to ask about ${widget.productTitle}" : ''; }), child: const Text('New')),
        ],
      ),
      body: Column(children: [
        Container(
          width: double.infinity,
          color: online ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(online ? 'Online · ${_desk?['message'] ?? 'We usually reply within 2 hours.'}' : (_desk?['message'] as String? ?? "We're away right now. Leave a message and we'll reply within 1 business day.")),
        ),
        if (widget.productTitle != null || _conv?['productTitle'] != null)
          Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), child: Align(alignment: Alignment.centerLeft, child: Text('About: ${widget.productTitle ?? _conv?['productTitle']}', style: const TextStyle(fontWeight: FontWeight.w600)))),
        if (_err != null) Padding(padding: const EdgeInsets.all(12), child: Text(_err!, style: const TextStyle(color: Color(0xFFBE123C)))),
        if (_list) Expanded(child: ListView(children: [
          for (final c in _history)
            ListTile(
              title: Text('${c['productTitle'] ?? 'Support chat'}'),
              subtitle: Text('${c['lastBody'] ?? ''}'),
              onTap: () => _openHistory(c),
            ),
        ]))
        else if (_conv != null) Expanded(child: ListView(padding: const EdgeInsets.all(16), children: [
          for (final m in msgs)
            Align(
              alignment: (m['authorKind'] == 'guest' || m['authorKind'] == 'customer') ? Alignment.centerRight : Alignment.centerLeft,
              child: Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                constraints: const BoxConstraints(maxWidth: 320),
                decoration: BoxDecoration(
                  color: (m['authorKind'] == 'guest' || m['authorKind'] == 'customer') ? const Color(0xFF0E7490) : const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text('${m['content'] ?? ''}', style: TextStyle(color: (m['authorKind'] == 'guest' || m['authorKind'] == 'customer') ? Colors.white : const Color(0xFF0F172A))),
              ),
            ),
          if (_conv?['convertedLeadRef'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('We opened sourcing request ${_conv!['convertedLeadRef']} for you.', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12))),
        ]))
        else if (widget.signedIn) Expanded(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Message the Source Easy team. Your chat history stays with your account.'),
          const SizedBox(height: 12),
          TextField(controller: _draft, decoration: const InputDecoration(labelText: 'Message'), maxLines: 4),
          const SizedBox(height: 12),
          FilledButton(onPressed: _busy ? null : _start, child: Text(_busy ? 'Sending…' : 'Start chat')),
        ])))
        else Expanded(child: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('Tell us how to reach you and we’ll pick up the conversation here.'),
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Name')),
          TextField(controller: _phone, decoration: const InputDecoration(labelText: 'Phone'), keyboardType: TextInputType.phone),
          TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email'), keyboardType: TextInputType.emailAddress),
          const Padding(padding: EdgeInsets.only(top: 4, bottom: 8), child: Text('Enter a phone number or email — one is enough.', style: TextStyle(fontSize: 12))),
          TextField(controller: _draft, decoration: const InputDecoration(labelText: 'Message'), maxLines: 3),
          CheckboxListTile(contentPadding: EdgeInsets.zero, value: _consent, onChanged: (v) => setState(() => _consent = v ?? false), title: const Text('I agree to be contacted about this conversation.')),
          FilledButton(onPressed: _busy ? null : _start, child: Text(_busy ? 'Starting…' : 'Start chat')),
        ])),
        if (_conv != null) SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(12, 0, 12, 12), child: Row(children: [
          Expanded(child: TextField(controller: _draft, decoration: const InputDecoration(hintText: 'Write a message…'), minLines: 1, maxLines: 4, onSubmitted: (_) => _send())),
          IconButton(onPressed: _busy ? null : _send, icon: const Icon(Icons.send)),
        ]))),
      ]),
    );
  }
}
