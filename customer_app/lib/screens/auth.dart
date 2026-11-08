import 'package:flutter/material.dart';

import '../api.dart';
import '../session.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session});
  final Session session;
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController(), _pw = TextEditingController();
  bool _busy = false, _hide = true;
  String? _err;
  Future<void> _go() async {
    if (_phone.text.trim().isEmpty || _pw.text.isEmpty) return setState(() => _err = 'Enter your mobile number and password');
    setState(() { _busy = true; _err = null; });
    try {
      await widget.session.signIn(_phone.text, _pw.text);
      _pw.clear();
    } on PortalError catch (e) {
      setState(() => _err = e.message);
    } catch (_) {
      setState(() => _err = 'Could not reach Source Easy. Check your connection.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 420), child: AutofillGroup(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Image.asset('assets/brand/lockup.png', height: 96, semanticLabel: 'Source Easy'),
          const SizedBox(height: 8),
          const Text('Customer app', textAlign: TextAlign.center, style: TextStyle(fontSize: 16, color: Colors.black54)),
          const SizedBox(height: 24),
          if (widget.session.notice != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(widget.session.notice!, key: const Key('session-notice'), style: const TextStyle(color: Colors.black87))),
          TextField(key: const Key('login-phone'), controller: _phone, keyboardType: TextInputType.phone, autofillHints: const [AutofillHints.telephoneNumber], decoration: const InputDecoration(labelText: 'Mobile number', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(key: const Key('login-password'), controller: _pw, obscureText: _hide, autofillHints: const [AutofillHints.password], onSubmitted: (_) => _go(),
              decoration: InputDecoration(labelText: 'Password', border: const OutlineInputBorder(), suffixIcon: IconButton(tooltip: _hide ? 'Show password' : 'Hide password', icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined), onPressed: () => setState(() => _hide = !_hide)))),
          if (_err != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_err!, key: const Key('login-error'), style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 16),
          FilledButton(key: const Key('login-submit'), onPressed: _busy ? null : _go, style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)), child: Text(_busy ? 'Signing in…' : 'Sign in')),
          const SizedBox(height: 16),
          const Text('No login yet? Ask for one on the enquiry form at sourceeasy.in, or contact your Source Easy manager.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: Colors.black54)),
        ])))))),
      );
}

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key, required this.session, required this.forced});
  final Session session;
  final bool forced;
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _cur = TextEditingController(), _new = TextEditingController(), _again = TextEditingController();
  bool _busy = false;
  String? _err;
  Future<void> _go() async {
    if (_new.text.length < 8) return setState(() => _err = 'Use at least 8 characters');
    if (_new.text != _again.text) return setState(() => _err = 'The new passwords do not match');
    setState(() { _busy = true; _err = null; });
    try {
      await widget.session.changePassword(_cur.text, _new.text);
      if (!widget.forced && mounted) { Navigator.of(context).pop(); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Password saved.'))); }
    } on PortalError catch (e) {
      setState(() => _err = e.message);
    } catch (_) {
      setState(() => _err = 'Could not reach Source Easy. Check your connection.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Change password'), automaticallyImplyLeading: !widget.forced,
            actions: [if (widget.forced) TextButton(onPressed: () => widget.session.signOut(), child: const Text('Sign out'))]),
        body: ListView(padding: const EdgeInsets.all(24), children: [
          if (widget.forced) const Padding(padding: EdgeInsets.only(bottom: 16), child: Text('You signed in with a temporary password. Choose your own password to continue.', key: Key('forced-hint'))),
          TextField(key: const Key('pw-current'), controller: _cur, obscureText: true, decoration: InputDecoration(labelText: widget.forced ? 'Temporary password' : 'Current password', border: const OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(key: const Key('pw-new'), controller: _new, obscureText: true, decoration: const InputDecoration(labelText: 'New password (at least 8 characters)', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(key: const Key('pw-again'), controller: _again, obscureText: true, decoration: const InputDecoration(labelText: 'New password again', border: OutlineInputBorder())),
          if (_err != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_err!, key: const Key('pw-error'), style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 16),
          FilledButton(key: const Key('pw-save'), onPressed: _busy ? null : _go, style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)), child: const Text('Save password')),
        ]),
      );
}
