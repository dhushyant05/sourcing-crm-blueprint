import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';

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
    _url = TextEditingController(text: context.read<Session>().config.twentyUrl);
  }

  Future<void> _submit() async {
    final s = context.read<Session>();
    setState(() { _busy = true; _error = null; });
    s.config.twentyUrl = _url.text.trim();
    try {
      await s.signIn(_email.text.trim(), _pw.text);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: AutofillGroup(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Icon(Icons.hub, size: 64, color: t.colorScheme.primary),
                const SizedBox(height: 8),
                Text('Source Easy', textAlign: TextAlign.center, style: t.textTheme.headlineMedium),
                Text('India ⇄ China sourcing', textAlign: TextAlign.center, style: t.textTheme.bodyMedium),
                const SizedBox(height: 32),
                TextField(controller: _email, keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email], decoration: const InputDecoration(labelText: 'Email')),
                const SizedBox(height: 12),
                TextField(controller: _pw, obscureText: true, autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(labelText: 'Password'), onSubmitted: (_) => _submit()),
                TextButton(onPressed: () => setState(() => _advanced = !_advanced),
                    child: Text(_advanced ? 'Hide server' : 'Server settings')),
                if (_advanced)
                  TextField(controller: _url, keyboardType: TextInputType.url,
                      decoration: const InputDecoration(labelText: 'Source Easy server URL')),
                if (_error != null)
                  Padding(padding: const EdgeInsets.only(top: 12),
                      child: Text(_error!, style: TextStyle(color: t.colorScheme.error))),
                const SizedBox(height: 20),
                FilledButton(onPressed: _busy ? null : _submit,
                    child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Sign in')),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
