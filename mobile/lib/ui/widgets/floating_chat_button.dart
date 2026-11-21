import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../l10n/l10n.dart';
import '../../services/session.dart';
import '../screens/chat_list_screen.dart';

/// Bottom-right chat FAB for staff main screens. Opens the inbox as a sheet.
class FloatingChatButton extends StatefulWidget {
  const FloatingChatButton({super.key});
  @override
  State<FloatingChatButton> createState() => _FloatingChatButtonState();
}

class _FloatingChatButtonState extends State<FloatingChatButton> {
  int _unread = 0;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    _poll = Timer.periodic(const Duration(seconds: 20), (_) => _refresh());
  }

  Future<void> _refresh() async {
    if (!mounted) return;
    final s = context.read<Session>();
    if (!s.perms.canChat) return;
    try {
      final boxes = await s.repo.chatInboxes();
      final personal = boxes.cast<Map<String, dynamic>?>().firstWhere(
            (i) => i?['kind'] == 'PERSONAL',
            orElse: () => boxes.isNotEmpty ? boxes.first : null,
          );
      final n = (personal?['unread'] as num?)?.toInt() ?? 0;
      if (mounted) setState(() => _unread = n);
    } catch (_) {}
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  void _open() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (c) => SizedBox(
        height: MediaQuery.of(c).size.height * 0.92,
        child: const ChatListScreen(),
      ),
    ).whenComplete(_refresh);
  }

  @override
  Widget build(BuildContext context) {
    if (!context.watch<Session>().perms.canChat) return const SizedBox.shrink();
    final l = context.l10n;
    return FloatingActionButton(
      heroTag: 'staff-chat-fab',
      tooltip: l.openChat,
      onPressed: _open,
      child: Badge(
        isLabelVisible: _unread > 0,
        label: Text(_unread > 99 ? '99+' : '$_unread'),
        child: const Icon(Icons.chat_bubble_outline),
      ),
    );
  }
}
