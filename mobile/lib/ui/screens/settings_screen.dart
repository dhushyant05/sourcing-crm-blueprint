import 'package:flutter/material.dart';

import '../../l10n/codes.dart';
import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../update_dialog.dart';
import 'package:package_info_plus/package_info_plus.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final p = s.perms;
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.settings), actions: const [LanguageSwitch()]),
      body: ListView(children: [
        ListTile(leading: const Icon(Icons.person), title: Text(s.displayName ?? ''), subtitle: Text('${s.email} · ${codeLabel(context, s.role.code)}')),
        ListTile(leading: Icon(Icons.translate), title: Text(context.l10n.language), trailing: LanguageSwitch()),
        ListTile(leading: Icon(Icons.payments_outlined), title: Text(context.l10n.currencies),
            subtitle: Text(context.l10n.usdRMBAndINREveryAmount)),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.sync),
          title: Text(context.l10n.offlineQueue),
          subtitle: Text(context.l10n.pendingChanges('${s.pendingOps}')),
          trailing: TextButton(
            onPressed: () async {
              final r = await s.syncNow();
              if (r != null && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.l10n.syncedSummary('${r.synced}', '${r.failed}', '${r.remaining}'))));
              }
            },
            child: Text(context.l10n.syncNow),
          ),
        ),
        ListTile(
          leading: const Icon(Icons.chat_outlined),
          title: Text(context.l10n.chatwootConnection),
          subtitle: Text(s.config.chatwootToken.isEmpty ? context.l10n.notConfigured : '${s.config.chatwootUrl} · account ${s.config.chatwootAccountId}'),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatwootSettingsScreen())),
        ),
        if (p.canDownloadBackups)
          ListTile(
            leading: Icon(Icons.backup_outlined),
            title: Text(context.l10n.backups),
            subtitle: Text(context.l10n.openTheBackupBrowserOnThe),
          ),
        const Divider(),
        ListTile(leading: Icon(Icons.logout), title: Text(context.l10n.signOut), onTap: s.signOut),
        FutureBuilder<PackageInfo>(
          future: PackageInfo.fromPlatform(),
          builder: (c, snap) => ListTile(
            key: const Key('check-updates'),
            leading: const Icon(Icons.system_update),
            title: Text(context.l10n.updateCheck),
            subtitle: snap.hasData ? Text(context.l10n.updateInstalled(snap.data!.version, snap.data!.buildNumber)) : null,
            onTap: () => checkForUpdatesManually(context),
          ),
        ),
        FutureBuilder<PackageInfo>(
          future: PackageInfo.fromPlatform(),
          builder: (c, snap) => AboutListTile(applicationName: 'Source Easy', applicationVersion: snap.hasData ? '${snap.data!.version} (${snap.data!.buildNumber})' : '', icon: const Icon(Icons.info_outline)),
        ),
      ]),
    );
  }
}

class ChatwootSettingsScreen extends StatefulWidget {
  const ChatwootSettingsScreen({super.key});
  @override
  State<ChatwootSettingsScreen> createState() => _ChatwootSettingsScreenState();
}

class _ChatwootSettingsScreenState extends State<ChatwootSettingsScreen> {
  late final cfg = context.read<Session>().config;
  late final _url = TextEditingController(text: cfg.chatwootUrl);
  late final _acct = TextEditingController(text: '${cfg.chatwootAccountId}');
  late final _inbox = TextEditingController(text: '${cfg.chatwootInboxId}');
  late final _token = TextEditingController(text: cfg.chatwootToken);

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.chatwoot)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _url, decoration: InputDecoration(labelText: context.l10n.chatwootURL)),
        gap,
        TextField(controller: _acct, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: context.l10n.accountID)),
        gap,
        TextField(controller: _inbox, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: context.l10n.internalAPIInboxID)),
        gap,
        TextField(controller: _token, obscureText: true,
            decoration: InputDecoration(labelText: context.l10n.yourAccessToken, helperText: context.l10n.chatwootProfileSettingsAccessToken)),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: () async {
            cfg
              ..chatwootUrl = _url.text.trim()
              ..chatwootAccountId = int.tryParse(_acct.text) ?? 1
              ..chatwootInboxId = int.tryParse(_inbox.text) ?? 1
              ..chatwootToken = _token.text.trim();
            await context.read<Session>().saveConfig();
            if (context.mounted) Navigator.pop(context);
          },
          child: Text(context.l10n.save),
        ),
      ]),
    );
  }
}
