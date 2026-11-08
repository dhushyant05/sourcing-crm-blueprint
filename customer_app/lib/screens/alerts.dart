import 'package:flutter/material.dart';

import '../api.dart';
import '../widgets.dart';

/// Notification preferences. Push needs the customer Firebase project, which is not set up yet, so this app does not
/// register for push and says so honestly.
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key, required this.api});
  final PortalApi api;
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
          subtitle: const Text('Not available yet in this version of the app. Your choice is saved. Open the app to see the latest updates.', key: Key('push-status'))),
    ]);
  }
}
