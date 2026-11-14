import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api.dart';
import '../greetings.dart';
import '../session.dart';
import '../widgets.dart';
import 'alerts.dart';
import 'auth.dart';
import 'requests.dart';
import 'shipping.dart';
import 'marketplace.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.session, this.live = true});
  final Session session;
  /// Live updates (SSE); off in widget tests.
  final bool live;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  PortalApi get api => widget.session.api;
  int _tab = 0;
  List<Json>? _reqs, _ships;
  String? _err;
  final _changes = StreamController<String>.broadcast();
  Completer<void>? _stop;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
    if (widget.live) _liveLoop();
    final push = widget.session.push;
    if (push != null) {
      push.onOpen = _openReference;
      _pushSub = push.foreground.listen((_) => _refresh());
      unawaited(push.start(api));
    }
  }

  StreamSubscription<Object?>? _pushSub;

  /// Notification tap: opens the record only if it is in this customer's own lists (the server checks again).
  Future<void> _openReference(String ref) async {
    if (_reqs == null || _ships == null) await _refresh();
    if (!mounted) return;
    final r = (_reqs ?? []).where((x) => x['reference'] == ref).firstOrNull;
    final s = (_ships ?? []).where((x) => x['reference'] == ref).firstOrNull;
    if (r != null) { setState(() => _tab = 1); await _open(RequestDetailScreen(api: api, id: '${r['id']}', changes: _changes.stream)); }
    else if (s != null) { setState(() => _tab = 2); await _open(ShippingDetailScreen(api: api, id: '${s['id']}', changes: _changes.stream)); }
  }

  @override
  void dispose() {
    _disposed = true;
    _pushSub?.cancel();
    if (widget.session.push?.onOpen == _openReference) widget.session.push?.onOpen = null;
    _stop?.complete();
    _changes.close();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) { if (s == AppLifecycleState.resumed) _refresh(); }

  Future<void> _liveLoop() async {
    while (!_disposed && api.token != null) {
      _stop = Completer<void>();
      try {
        await api.stream((id, _) { _changes.add(id); _refresh(); }, cancel: _stop!.future);
      } catch (_) {}
      if (_disposed) return;
      await Future<void>.delayed(const Duration(seconds: 5));
    }
  }

  Future<void> _refresh() async {
    try {
      final r = await Future.wait([api.requests(), api.shippingList()]);
      if (mounted) setState(() { _reqs = r[0]; _ships = r[1]; _err = null; });
    } on PortalError catch (e) {
      if (mounted) setState(() => _err = e.message);
    } catch (_) {
      if (mounted) setState(() => _err = 'Could not reach Source Easy. Pull down to try again.');
    }
  }

  Future<void> _open(Widget w) async {
    await Navigator.of(context).push(MaterialPageRoute<Object?>(builder: (_) => w));
    _refresh();
  }

  Widget _list(List<Json>? items, Widget Function(Json) tile, String empty) => RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 96), children: [
          if (_tab == 1) GreetingBanner(api: api, store: widget.session.store),
          if (_err != null && items == null) ErrorRetry(_err!, _refresh)
          else if (items == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
          else if (items.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Text(empty, textAlign: TextAlign.center))
          else ...items.map(tile),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final me = widget.session.me ?? const {};
    final waiting = (_reqs ?? []).where((r) => (r['quotesWaiting'] ?? 0) > 0).length + (_ships ?? []).where((r) => r['quoteWaiting'] == true || r['canReply'] == true).length;
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [Image.asset('assets/brand/mark.png', height: 28), const SizedBox(width: 8), const Text('Source Easy')]),
        actions: [PopupMenuButton<String>(key: const Key('account-menu'), tooltip: 'Account', icon: const Icon(Icons.account_circle_outlined), onSelected: (v) async {
          if (v == 'pw') await _open(ChangePasswordScreen(session: widget.session, forced: false));
          if (v == 'out') await widget.session.signOut();
        }, itemBuilder: (_) => [
          PopupMenuItem(enabled: false, child: Text('${me['company'] ?? me['name'] ?? ''}')),
          const PopupMenuItem(value: 'pw', child: Text('Change password')),
          const PopupMenuItem(key: Key('sign-out'), value: 'out', child: Text('Sign out')),
        ])],
      ),
      body: IndexedStack(index: _tab, children: [
        MarketplaceTab(api: api, signedIn: true),
        _list(_reqs, (r) => RequestTile(r, onTap: () => _open(RequestDetailScreen(api: api, id: '${r['id']}', changes: _changes.stream))), 'No requests yet. Tap “New request” to tell us what you need.'),
        _list(_ships, (r) => ShippingTile(r, onTap: () => _open(ShippingDetailScreen(api: api, id: '${r['id']}', changes: _changes.stream))), 'No shipping requests yet.'),
        AlertsScreen(api: api, push: widget.session.push),
      ]),
      floatingActionButton: (_tab == 0 || _tab == 3) ? null : FloatingActionButton.extended(key: const Key('fab-new'), icon: const Icon(Icons.add), label: Text(_tab == 1 ? 'New request' : 'Ship goods'),
          onPressed: () => _open(_tab == 1 ? NewRequestScreen(api: api) : NewShippingScreen(api: api))),
      bottomNavigationBar: NavigationBar(selectedIndex: _tab, onDestinationSelected: (i) => setState(() => _tab = i), destinations: [
        const NavigationDestination(icon: Icon(Icons.storefront_outlined), label: 'Catalog'),
        NavigationDestination(icon: Badge(isLabelVisible: waiting > 0, label: Text('$waiting'), child: const Icon(Icons.inventory_2_outlined)), label: 'Requests'),
        const NavigationDestination(icon: Icon(Icons.local_shipping_outlined), label: 'Shipping'),
        const NavigationDestination(icon: Icon(Icons.notifications_none), label: 'Alerts'),
      ]),
    );
  }
}

/// Home greeting (APP surface): text-only presets or uploaded artwork, closeable per version, expires on time.
class GreetingBanner extends StatefulWidget {
  const GreetingBanner({super.key, required this.api, required this.store, this.now});
  final PortalApi api;
  final KeyValue store;
  final DateTime Function()? now;
  @override
  State<GreetingBanner> createState() => _GreetingBannerState();
}

class _GreetingBannerState extends State<GreetingBanner> {
  late final cache = GreetingCache(widget.store, now: widget.now);
  Json? _g;
  Uint8List? _img;
  Timer? _tick;
  List<Json> _feed = [];
  @override
  void initState() {
    super.initState();
    _load();
    _tick = Timer.periodic(const Duration(minutes: 1), (_) => _pick()); // drop a greeting the minute it expires
  }

  @override
  void dispose() { _tick?.cancel(); super.dispose(); }
  Future<void> _load() async {
    _feed = await cache.cached();
    await _pick();
    try { _feed = await widget.api.greetings(); await cache.save(_feed); await _pick(); } catch (_) {}
  }

  Future<void> _pick() async {
    final g = await cache.pick(_feed);
    if (!mounted) return;
    if (g?['id'] != _g?['id'] || g?['version'] != _g?['version']) {
      Uint8List? img;
      final path = (g?['imageMobile'] ?? g?['imageDesktop']) as String?;
      if (path != null) { try { img = Uint8List.fromList(await widget.api.bytes(path)); } catch (_) {} }
      if (!mounted) return;
      setState(() { _g = g; _img = img; });
    }
  }

  static const themes = {'BRAND': [Color(0xFF0E7490), Color(0xFF16A34A)], 'GOLD': [Color(0xFFF59E0B), Color(0xFFEA580C)], 'NIGHT': [Color(0xFF111827), Color(0xFF312E81)], 'ROSE': [Color(0xFFF43F5E), Color(0xFFC026D3)]};
  @override
  Widget build(BuildContext context) {
    final g = _g;
    if (g == null || (g['layout'] == 'IMAGE' && _img == null)) return const SizedBox.shrink();
    final colors = themes[g['theme']] ?? themes['BRAND']!;
    final pic = _img == null ? null : Image.memory(_img!, fit: BoxFit.cover, semanticLabel: '${g['alt'] ?? ''}', width: double.infinity);
    final text = Column(crossAxisAlignment: g['layout'] == 'FESTIVE' ? CrossAxisAlignment.center : CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      if (g['heading'] != null) Text('${g['heading']}', textAlign: g['layout'] == 'FESTIVE' ? TextAlign.center : TextAlign.start,
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: g['layout'] == 'MINIMAL' ? 15 : 22)),
      if (g['message'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${g['message']}', textAlign: g['layout'] == 'FESTIVE' ? TextAlign.center : TextAlign.start, style: const TextStyle(color: Colors.white))),
    ]);
    final body = switch (g['layout']) {
      'IMAGE' => pic!,
      'CLASSIC' => Column(children: [if (pic != null) SizedBox(height: 140, child: pic), Padding(padding: const EdgeInsets.fromLTRB(16, 16, 40, 16), child: SizedBox(width: double.infinity, child: text))]),
      'MINIMAL' => Padding(padding: const EdgeInsets.fromLTRB(16, 12, 40, 12), child: SizedBox(width: double.infinity, child: text)),
      _ => Stack(children: [if (pic != null) Positioned.fill(child: Opacity(opacity: .35, child: pic)), Padding(padding: const EdgeInsets.fromLTRB(24, 28, 24, 28), child: SizedBox(width: double.infinity, child: text))]),
    };
    return Padding(padding: const EdgeInsets.only(bottom: 12), child: Semantics(container: true, label: 'Greeting', child: ClipRRect(borderRadius: BorderRadius.circular(16), child: Container(
      key: Key('greeting-${g['id']}-${g['version']}'),
      decoration: BoxDecoration(gradient: LinearGradient(colors: colors)),
      child: Stack(children: [body, if (g['dismissible'] == true) Positioned(right: 4, top: 4, child: IconButton(key: const Key('greeting-close'), tooltip: 'Close greeting', color: Colors.white,
          icon: const Icon(Icons.close), onPressed: () async { await cache.dismiss(g); await _pick(); setState(() => _g = null); }))]),
    ))));
  }
}
