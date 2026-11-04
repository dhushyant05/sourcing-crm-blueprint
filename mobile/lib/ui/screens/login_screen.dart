import 'package:flutter/services.dart';
import '../../l10n/web_strings.dart';
import 'package:flutter/material.dart';
import '../widgets/version_label.dart';

import '../../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';
import '../widgets/language_switch.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _pw = TextEditingController();
  late final TextEditingController _url;
  bool _busy = false, _advanced = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: context.read<Session>().config.serverUrl);
  }

  Future<void> _submit() async {
    final s = context.read<Session>();
    setState(() { _busy = true; _error = null; });
    s.config.serverUrl = _url.text.trim();
    try {
      await s.signIn(_email.text.trim(), _pw.text);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openHome() => const MethodChannel('sourceeasy/installer').invokeMethod('openUrl', {'url': 'https://sourceeasy.in/'}).catchError((_) => null);

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(actions: const [LanguageSwitch()]),
      bottomNavigationBar: const SafeArea(child: VersionLabel()),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: AutofillGroup(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                // Logo opens the public homepage in the browser (same native channel the updater uses).
                InkWell(key: const Key('login-logo'), borderRadius: BorderRadius.circular(16), onTap: _openHome,
                    child: Image.asset('assets/brand/lockup.png', height: 150, semanticLabel: 'Source Easy')),
                Text(context.l10n.tagline, key: const Key('brand-tagline'), textAlign: TextAlign.center, style: t.textTheme.titleMedium?.copyWith(color: t.colorScheme.primary, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Text(context.l10n.indiaChinaSourcing, textAlign: TextAlign.center, style: t.textTheme.bodyMedium),
                Center(child: TextButton.icon(key: const Key('login-back-home'), onPressed: _openHome, icon: const Icon(Icons.home_outlined, size: 18), label: Text(tw(context, 'login.backHome')))),
                const SizedBox(height: 16),
                if (context.watch<Session>().sessionExpired) Padding(padding: const EdgeInsets.only(bottom: 12),
                    child: Text(context.l10n.quSessionExpired, key: const Key('login-expired'), textAlign: TextAlign.center, style: TextStyle(color: t.colorScheme.error))),
                TextField(controller: _email, keyboardType: TextInputType.emailAddress,
                    autofillHints: [AutofillHints.email], decoration: InputDecoration(labelText: context.l10n.email)),
                const SizedBox(height: 12),
                TextField(controller: _pw, obscureText: true, autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(labelText: context.l10n.password), onSubmitted: (_) => _submit()),
                TextButton(onPressed: () => setState(() => _advanced = !_advanced),
                    child: Text(_advanced ? context.l10n.hideServer : context.l10n.serverSettings)),
                if (_advanced)
                  TextField(controller: _url, keyboardType: TextInputType.url,
                      decoration: InputDecoration(labelText: context.l10n.sourceEasyServerURL)),
                if (_error != null)
                  Padding(padding: const EdgeInsets.only(top: 12),
                      child: Text(_error!, style: TextStyle(color: t.colorScheme.error))),
                const SizedBox(height: 20),
                FilledButton(onPressed: _busy ? null : _submit,
                    child: _busy ? SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(context.l10n.signIn)),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
