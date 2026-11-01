import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import 'package:provider/provider.dart';

import '../core/roles.dart';
import '../services/notifications.dart';
import '../services/session.dart';
import 'screens/notifications_screen.dart';
import 'screens/chat_list_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/leads_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/shipping_screen.dart';
import 'screens/quotes_screen.dart';
import 'screens/orders_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _i = 0;
  static const _pages = [DashboardScreen(), LeadsScreen(), QuotesScreen(), OrdersScreen(), NotificationsScreen(), MoreScreen()];
  late final NotificationCenter _nc;

  @override
  void initState() {
    super.initState();
    final ses = context.read<Session>();
    _nc = NotificationCenter(ses.repo)..onChange = ses.onServerChange;
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
    // Privacy: China users' system notifications show only the SE reference + product.
    final china = s.role.office == Office.china;
    _nc.describe = china ? (n) => [n.leadRef ?? '', n.product ?? ''].where((x) => x.isNotEmpty).join(' · ') : (n) => notifText(context, n);
    _nc.title = context.l10n.newLeadNotif;
    // Per-user permissions: hide the Quotes tab when /api/me does not grant quotes.view (updates live).
    final showQ = s.perms.canViewQuotes;
    final pages = showQ ? _pages : [..._pages.take(2), ..._pages.skip(3)];
    final idx = _i.clamp(0, pages.length - 1);
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
        Expanded(child: IndexedStack(index: idx, children: pages)),
      ]),
      bottomNavigationBar: NavigationBar(
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        selectedIndex: idx,
        onDestinationSelected: (i) => setState(() => _i = i),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.dashboard_outlined), selectedIcon: const Icon(Icons.dashboard), label: context.l10n.dashboard),
          NavigationDestination(icon: const Icon(Icons.people_outline), selectedIcon: const Icon(Icons.people), label: context.l10n.leads),
          if (showQ) NavigationDestination(key: const Key('nav-quotes'), icon: const Icon(Icons.request_quote_outlined), selectedIcon: const Icon(Icons.request_quote), label: context.l10n.quotesTab),
          NavigationDestination(key: const Key('nav-orders'), icon: const Icon(Icons.inventory_2_outlined), selectedIcon: const Icon(Icons.inventory_2), label: context.l10n.ordersTab),
          NavigationDestination(key: const Key('nav-notifications'),
              icon: Badge(isLabelVisible: nc.unread > 0, label: Text('${nc.unread}'), child: const Icon(Icons.notifications_outlined)),
              selectedIcon: Badge(isLabelVisible: nc.unread > 0, label: Text('${nc.unread}'), child: const Icon(Icons.notifications)),
              label: context.l10n.notifications),
          NavigationDestination(icon: const Icon(Icons.more_horiz), label: context.l10n.more),
        ],
      ),
    ); }));
  }
}

/// Shipping, Chat and Settings moved here to make room for Quotes and Orders.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    Widget tile(IconData i, String t, Widget page) => ListTile(leading: Icon(i), title: Text(t), trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => page)));
    return Scaffold(appBar: AppBar(title: Text(l.more)), body: ListView(children: [
      tile(Icons.local_shipping_outlined, l.shipping, const ShippingScreen()),
      tile(Icons.chat_bubble_outline, l.chat, const ChatListScreen()),
      tile(Icons.settings_outlined, l.settings, const SettingsScreen()),
    ]));
  }
}
