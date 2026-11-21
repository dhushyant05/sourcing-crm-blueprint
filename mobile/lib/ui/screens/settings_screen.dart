import 'dart:async';
import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';
import '../widgets/language_switch.dart';
import '../widgets/profile.dart';
import '../update_dialog.dart';
import 'unlock_screen.dart';
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
        const ProfileTile(),
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
        const QuickUnlockSettings(),
        if (p.canDownloadBackups)
          ListTile(
            leading: Icon(Icons.backup_outlined),
            title: Text(context.l10n.backups),
            subtitle: Text(context.l10n.openTheBackupBrowserOnThe),
          ),
        const Divider(),
        ListTile(key: const Key('sign-out'), leading: Icon(Icons.logout), title: Text(context.l10n.signOut), onTap: () {
          // Instant: leave Settings, drop the session (UI switches to login now); storage wipe + SSE teardown finish in the background.
          final ses = context.read<Session>();
          Navigator.of(context).popUntil((r) => r.isFirst);
          unawaited(ses.signOut());
        }),
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
          builder: (c, snap) => AboutListTile(applicationName: 'Source Easy', applicationLegalese: 'Source Easy — ${c.l10n.tagline}\nsourceeasy.in', applicationIcon: Image.asset('assets/brand/mark.png', height: 48), applicationVersion: snap.hasData ? '${snap.data!.version} (${snap.data!.buildNumber})' : '', icon: const Icon(Icons.info_outline)),
        ),
      ]),
    );
  }
}
