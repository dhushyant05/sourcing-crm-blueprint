import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../services/session.dart';
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

class _HomeShellState extends State<HomeShell> {
  int _i = 0;
  static const _pages = [DashboardScreen(), LeadsScreen(), ShippingScreen(), ChatListScreen(), SettingsScreen()];

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return Scaffold(
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
          NavigationDestination(icon: const Icon(Icons.local_shipping_outlined), selectedIcon: const Icon(Icons.local_shipping), label: context.l10n.shipping),
          NavigationDestination(icon: const Icon(Icons.chat_bubble_outline), selectedIcon: const Icon(Icons.chat_bubble), label: context.l10n.chat),
          NavigationDestination(icon: const Icon(Icons.settings_outlined), selectedIcon: const Icon(Icons.settings), label: context.l10n.settings),
        ],
      ),
    );
  }
}
