import 'package:flutter/material.dart';
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
                ? 'Offline — changes are queued (${s.pendingOps} pending)'
                : '${s.pendingOps} change(s) waiting to sync'),
            leading: Icon(s.online ? Icons.sync : Icons.cloud_off),
            actions: [TextButton(onPressed: s.syncNow, child: const Text('Sync now'))],
          ),
        Expanded(child: IndexedStack(index: _i, children: _pages)),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        onDestinationSelected: (i) => setState(() => _i = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashboard'),
          NavigationDestination(icon: Icon(Icons.people_outline), selectedIcon: Icon(Icons.people), label: 'Leads'),
          NavigationDestination(icon: Icon(Icons.local_shipping_outlined), selectedIcon: Icon(Icons.local_shipping), label: 'Shipping'),
          NavigationDestination(icon: Icon(Icons.chat_bubble_outline), selectedIcon: Icon(Icons.chat_bubble), label: 'Chat'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}
