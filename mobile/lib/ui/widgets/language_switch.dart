import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';

/// EN | 中文 switch. Saved on the device and (when signed in) on the account.
class LanguageSwitch extends StatelessWidget {
  const LanguageSwitch({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final current = s.language ?? (Localizations.localeOf(context).languageCode == 'zh' ? 'zh-CN' : 'en');
    return PopupMenuButton<String>(
      key: const Key('lang-switch'),
      tooltip: 'Language / 语言',
      initialValue: current,
      onSelected: s.setLanguage,
      itemBuilder: (_) => const [
        PopupMenuItem(value: 'en', child: Text('English')),
        PopupMenuItem(value: 'zh-CN', child: Text('简体中文')),
      ],
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.translate, size: 20),
          const SizedBox(width: 4),
          Text(current == 'zh-CN' ? '中文' : 'EN'),
        ]),
      ),
    );
  }
}
