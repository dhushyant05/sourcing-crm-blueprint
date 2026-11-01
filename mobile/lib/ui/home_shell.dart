import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../services/notifications.dart';
import '../services/session.dart';
import 'screens/notifications_screen.dart';
import 'screens/chat_list_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/leads_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/shipping_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _i = 0;
  static const _pages = [DashboardScreen(), LeadsScreen(), NotificationsScreen(), ShippingScreen(), ChatListScreen(), SettingsScreen()];
  late final NotificationCenter _nc;

  @override
  void initState() {
    super.initState();
    _nc = NotificationCenter(context.read<Session>().repo);
    WidgetsBinding.instance.addObserver(this);
    _nc.start();
    _nc.requestPermission();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState st) {
    if (st == AppLifecycleState.resumed) { _nc.start(); } else if (st == AppLifecycleState.paused) { _nc.stop(); }
  }

  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); _nc.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    _nc.describe = (n) => notifText(context, n);
    _nc.title = context.l10n.newLeadNotif;
    return ChangeNotifierProvider.value(value: _nc, child: Builder(builder: (context) { final nc = context.watch<NotificationCenter>(); return Scaffold(
      body: Column(children: [
        if (!s.online || s.pendingOps > 0)
          MaterialBanner(
            content: Text(!s.online
                ? context.l10n.offlineQueued('${s.pendingOps}')
                : context.l10n.waitingToSync('${s.pendingOps}')),
            leading: Icon(s.online ? Icons.sync : Icons.cloud_off),
            actions: [TextButton(onPressed: s.syncNow, child: Text(context.l10n.syncNow))],
          ),
        Expanded(child: IndexedStack(index: _i, children: _pages)),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        onDestinationSelected: (i) => setState(() => _i = i),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.dashboard_outlined), selectedIcon: const Icon(Icons.dashboard), label: context.l10n.dashboard),
          NavigationDestination(icon: const Icon(Icons.people_outline), selectedIcon: const Icon(Icons.people), label: context.l10n.leads),
          NavigationDestination(key: const Key('nav-notifications'),
              icon: Badge(isLabelVisible: nc.unread > 0, label: Text('${nc.unread}'), child: const Icon(Icons.notifications_outlined)),
              selectedIcon: Badge(isLabelVisible: nc.unread > 0, label: Text('${nc.unread}'), child: const Icon(Icons.notifications)),
              label: context.l10n.notifications),
          NavigationDestination(icon: const Icon(Icons.local_shipping_outlined), selectedIcon: const Icon(Icons.local_shipping), label: context.l10n.shipping),
          NavigationDestination(icon: const Icon(Icons.chat_bubble_outline), selectedIcon: const Icon(Icons.chat_bubble), label: context.l10n.chat),
          NavigationDestination(icon: const Icon(Icons.settings_outlined), selectedIcon: const Icon(Icons.settings), label: context.l10n.settings),
        ],
      ),
    ); }));
  }
}
