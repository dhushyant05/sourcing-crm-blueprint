import 'package:flutter/material.dart';

import '../api.dart';
import '../push.dart';
import '../widgets.dart';

/// Notification preferences. App notifications work only in a build that includes the customer Firebase config;
/// otherwise the screen says so honestly.
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key, required this.api, this.push});
  final PortalApi api;
  final PushService? push;
  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  Json? _p;
  String? _err;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final p = await widget.api.notificationPrefs(); if (mounted) setState(() { _p = p; _err = null; }); }
    catch (e) { if (mounted) setState(() => _err = e is PortalError ? e.message : 'Could not reach Source Easy.'); }
  }

  Future<void> _set({bool? email, bool? push}) async {
    try { final p = await widget.api.setNotificationPrefs(email: email, push: push); if (mounted) setState(() => _p = p); }
    catch (e) { if (mounted) toast(context, e is PortalError ? e.message : 'Could not save'); }
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    if (p == null) return _err != null ? ErrorRetry(_err!, _load) : const Center(child: CircularProgressIndicator());
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text('Alerts', style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 8),
      const Text('We tell you when a quote is ready, an order is confirmed, or a shipment moves. Messages never include passwords.'),
      const SizedBox(height: 12),
      SwitchListTile(key: const Key('pref-email'), value: p['email'] == true, onChanged: (v) => _set(email: v), title: const Text('Email updates'),
          subtitle: Text(p['emailAvailable'] == true ? 'Sent to the email on your account.' : 'Email updates are not switched on yet. Your choice is saved for when they are.')),
      SwitchListTile(key: const Key('pref-push'), value: p['push'] == true, onChanged: (v) => _set(push: v), title: const Text('App notifications'),
          subtitle: ListenableBuilder(listenable: widget.push ?? ValueNotifier(0), builder: (_, _) => Text(
              widget.push?.label ?? 'App notifications are not switched on yet for this app. Your choice is saved; open the app to see the latest updates.', key: const Key('push-status')))),
    ]);
  }
}
