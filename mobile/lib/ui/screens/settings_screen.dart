import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/common.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final p = s.perms;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(children: [
        ListTile(leading: const Icon(Icons.person), title: Text(s.displayName ?? ''), subtitle: Text('${s.email} · ${s.role.label}')),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.sync),
          title: const Text('Offline queue'),
          subtitle: Text('${s.pendingOps} pending change(s)'),
          trailing: TextButton(
            onPressed: () async {
              final r = await s.syncNow();
              if (r != null && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Synced ${r.synced}, failed ${r.failed}, remaining ${r.remaining}')));
              }
            },
            child: const Text('Sync now'),
          ),
        ),
        ListTile(
          leading: const Icon(Icons.chat_outlined),
          title: const Text('Chatwoot connection'),
          subtitle: Text(s.config.chatwootToken.isEmpty ? 'Not configured' : '${s.config.chatwootUrl} · account ${s.config.chatwootAccountId}'),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatwootSettingsScreen())),
        ),
        if (p.canSetExchangeRate)
          ListTile(
            leading: const Icon(Icons.currency_exchange),
            title: const Text('Exchange rates'),
            subtitle: const Text('Set RMB/USD → INR (admin)'),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ExchangeRatesScreen())),
          ),
        if (p.canDownloadBackups)
          const ListTile(
            leading: Icon(Icons.backup_outlined),
            title: Text('Backups'),
            subtitle: Text('Open the backup browser on the storage server in a browser to download dumps. Restores are CLI-only.'),
          ),
        const Divider(),
        ListTile(leading: const Icon(Icons.logout), title: const Text('Sign out'), onTap: s.signOut),
        const AboutListTile(applicationName: 'Source Easy', applicationVersion: '1.0.0', icon: Icon(Icons.info_outline)),
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
      appBar: AppBar(title: const Text('Chatwoot')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _url, decoration: const InputDecoration(labelText: 'Chatwoot URL')),
        gap,
        TextField(controller: _acct, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Account ID')),
        gap,
        TextField(controller: _inbox, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Internal API inbox ID')),
        gap,
        TextField(controller: _token, obscureText: true,
            decoration: const InputDecoration(labelText: 'Your access token', helperText: 'Chatwoot → Profile settings → Access token')),
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
          child: const Text('Save'),
        ),
      ]),
    );
  }
}

class ExchangeRatesScreen extends StatefulWidget {
  const ExchangeRatesScreen({super.key});
  @override
  State<ExchangeRatesScreen> createState() => _ExchangeRatesScreenState();
}

class _ExchangeRatesScreenState extends State<ExchangeRatesScreen> {
  late Future<List<ExchangeRate>> _f;
  @override
  void initState() {
    super.initState();
    _f = context.read<Session>().repo.rateHistory();
  }

  Future<void> _set(String pair) async {
    final c = TextEditingController();
    final v = await showDialog<double>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('Set ${pair.replaceAll('_', ' → ').replaceAll('CNY', 'RMB')}'),
        content: TextField(controller: c, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Rate', helperText: 'Manual override, effective today')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, double.tryParse(c.text)), child: const Text('Save')),
        ],
      ),
    );
    if (v == null || v <= 0 || !mounted) return;
    final s = context.read<Session>();
    final r = await s.repo.setRate(pair, v, s.displayName ?? s.email ?? 'admin');
    if (!mounted) return;
    showWriteResult(context, r, 'Rate');
    setState(() => _f = s.repo.rateHistory());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Exchange rates')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Wrap(spacing: 8, children: [
          for (final pair in const ['CNY_INR', 'USD_INR', 'USD_CNY'])
            FilledButton.tonal(onPressed: () => _set(pair), child: Text(pair.replaceAll('_', '→').replaceAll('CNY', 'RMB'))),
        ]),
        const SizedBox(height: 16),
        Text('History', style: Theme.of(context).textTheme.titleMedium),
        AsyncView<List<ExchangeRate>>(
          future: _f,
          builder: (c, list) => Column(
            children: list
                .map((r) => ListTile(
                      title: Text('${r.pair.replaceAll('_', ' → ').replaceAll('CNY', 'RMB')}  ${r.rate}'),
                      subtitle: Text('${r.effectiveDate != null ? dateFmt.format(r.effectiveDate!) : ''} · ${pretty(r.source)} · ${r.setBy ?? ''}'),
                      trailing: r.manual ? const Chip(label: Text('Override')) : null,
                    ))
                .toList(),
          ),
        ),
      ]),
    );
  }
}
