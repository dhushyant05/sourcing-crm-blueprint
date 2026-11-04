import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../l10n/l10n.dart';
import '../../services/session.dart';

/// 4–6 digit PIN field shared by the unlock and set-PIN screens.
class PinField extends StatelessWidget {
  const PinField({super.key, required this.controller, required this.label, this.onSubmitted, this.error, this.autofocus = false});
  final TextEditingController controller;
  final String label;
  final String? error;
  final bool autofocus;
  final ValueChanged<String>? onSubmitted;
  @override
  Widget build(BuildContext context) => TextField(
        controller: controller, autofocus: autofocus, obscureText: true, maxLength: 6, keyboardType: TextInputType.number,
        textAlign: TextAlign.center, style: const TextStyle(fontSize: 28, letterSpacing: 12),
        decoration: InputDecoration(labelText: label, errorText: error, counterText: ''),
        onSubmitted: onSubmitted,
      );
}

/// Shown on app open (and after 5+ min in background) when a PIN is set.
class UnlockScreen extends StatefulWidget {
  const UnlockScreen({super.key});
  @override
  State<UnlockScreen> createState() => _UnlockScreenState();
}

class _UnlockScreenState extends State<UnlockScreen> {
  final _pin = TextEditingController();
  String? _err;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bio());
  }

  Future<void> _bio() async {
    final s = context.read<Session>();
    if (s.unlock.bioOn) await s.unlockWithBio(context.l10n.quBioReason);
  }

  Future<void> _submit() async {
    final s = context.read<Session>(), l = context.l10n;
    if (_busy || _pin.text.length < 4) return;
    setState(() => _busy = true);
    final ok = await s.unlockWithPin(_pin.text);
    if (!mounted) return;
    if (!ok) {
      _pin.clear();
      if (s.unlock.lockedOut || !s.signedIn) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(l.quLockedOut)));
      } else {
        setState(() => _err = l.quWrongPin('${s.unlock.attemptsLeft}'));
      }
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>(), l = context.l10n, t = Theme.of(context);
    return Scaffold(
      body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(28), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Image.asset('assets/brand/mark.png', height: 72),
        const SizedBox(height: 16),
        Text(s.displayName ?? s.email ?? '', textAlign: TextAlign.center, style: t.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(l.quUnlockTitle, textAlign: TextAlign.center, style: t.textTheme.headlineSmall),
        const SizedBox(height: 20),
        PinField(key: const Key('unlock-pin'), controller: _pin, label: 'PIN', error: _err, autofocus: !s.unlock.bioOn, onSubmitted: (_) => _submit()),
        const SizedBox(height: 12),
        FilledButton(key: const Key('unlock-go'), onPressed: _busy ? null : _submit, child: const Icon(Icons.lock_open)),
        if (s.unlock.bioOn) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(key: const Key('unlock-bio'), onPressed: _bio, icon: const Icon(Icons.fingerprint), label: Text(l.quUseFingerprint)),
        ],
        const SizedBox(height: 16),
        TextButton(key: const Key('unlock-password'), onPressed: () => unawaited(s.usePassword()), child: Text(l.quUsePassword)),
      ])))),
    );
  }
}

/// Create or change the PIN. [offer] = shown once right after a password sign-in (has "Not now").
class SetPinScreen extends StatefulWidget {
  const SetPinScreen({super.key, this.offer = false});
  final bool offer;
  @override
  State<SetPinScreen> createState() => _SetPinScreenState();
}

class _SetPinScreenState extends State<SetPinScreen> {
  final _a = TextEditingController(), _b = TextEditingController();
  String? _err;
  bool _bio = false, _bioAvail = false;

  @override
  void initState() {
    super.initState();
    context.read<Session>().unlock.bioAvailable().then((v) { if (mounted) setState(() { _bioAvail = v; _bio = v; }); });
  }

  Future<void> _save() async {
    final l = context.l10n, s = context.read<Session>();
    if (!RegExp(r'^\d{4,6}$').hasMatch(_a.text)) return setState(() => _err = l.quPinInvalid);
    if (_a.text != _b.text) return setState(() => _err = l.quPinMismatch);
    await s.setPin(_a.text);
    if (_bioAvail) await s.setBio(_bio);
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(l.quPinSaved)));
    if (!widget.offer) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, t = Theme.of(context);
    return Scaffold(
      appBar: widget.offer ? null : AppBar(title: Text(l.quSetPinTitle)),
      body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(28), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Icon(Icons.pin_outlined, size: 56, color: t.colorScheme.primary),
        const SizedBox(height: 12),
        if (widget.offer) Text(l.quSetPinTitle, textAlign: TextAlign.center, style: t.textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(l.quSetPinBody, textAlign: TextAlign.center, style: t.textTheme.bodyMedium),
        const SizedBox(height: 20),
        PinField(key: const Key('pin-new'), controller: _a, label: l.quEnterNewPin, autofocus: true),
        const SizedBox(height: 8),
        PinField(key: const Key('pin-confirm'), controller: _b, label: l.quConfirmPin, error: _err, onSubmitted: (_) => _save()),
        if (_bioAvail) SwitchListTile(key: const Key('pin-bio'), contentPadding: EdgeInsets.zero, secondary: const Icon(Icons.fingerprint),
            title: Text(l.quBioToggle), value: _bio, onChanged: (v) => setState(() => _bio = v)),
        const SizedBox(height: 12),
        FilledButton(key: const Key('pin-save'), onPressed: _save, child: Text(l.quSave)),
        if (widget.offer) TextButton(key: const Key('pin-skip'), onPressed: () => context.read<Session>().skipPinOffer(), child: Text(l.quNotNow)),
      ])))),
    );
  }
}

/// Settings section: enable/disable PIN, change PIN, fingerprint toggle.
class QuickUnlockSettings extends StatelessWidget {
  const QuickUnlockSettings({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>(), l = context.l10n, u = s.unlock;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: Text(l.quSection, style: Theme.of(context).textTheme.titleSmall)),
      SwitchListTile(key: const Key('qu-pin'), secondary: const Icon(Icons.pin_outlined), title: Text(l.quPinOn), subtitle: Text(l.quPinOnSub), value: u.pinSet,
          onChanged: (v) => v ? Navigator.push(context, MaterialPageRoute(builder: (_) => const SetPinScreen())) : s.disablePin()),
      if (u.pinSet) ListTile(key: const Key('qu-change'), leading: const Icon(Icons.edit_outlined), title: Text(l.quChangePin),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SetPinScreen()))),
      if (u.pinSet) FutureBuilder<bool>(future: u.bioAvailable(), builder: (c, snap) => SwitchListTile(key: const Key('qu-bio'),
          secondary: const Icon(Icons.fingerprint), title: Text(l.quBioToggle),
          subtitle: snap.data == false ? Text(l.quBioUnavailable) : null,
          value: u.bioOn, onChanged: snap.data == true ? (v) => s.setBio(v) : null)),
    ]);
  }
}
