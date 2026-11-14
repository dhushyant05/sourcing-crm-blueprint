import 'package:flutter/material.dart';

import '../api.dart';

class MarketplaceTab extends StatefulWidget {
  const MarketplaceTab({super.key, required this.api, this.onSignIn, this.signedIn = false});
  final PortalApi api;
  final VoidCallback? onSignIn;
  final bool signedIn;
  @override
  State<MarketplaceTab> createState() => _MarketplaceTabState();
}

class _MarketplaceTabState extends State<MarketplaceTab> {
  List<Json> _products = [];
  List<Json> _banners = [];
  String? _err;
  bool _loading = true;
  final _q = TextEditingController();

  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() { _q.dispose(); super.dispose(); }

  Future<void> _load([String? q]) async {
    setState(() { _loading = true; _err = null; });
    try {
      final r = await Future.wait([
        widget.api.catalogProducts(q: q),
        widget.api.catalogBanners(),
      ]);
      if (!mounted) return;
      setState(() {
        _products = ((((r[0] as Json)['data'] as List?) ?? []).cast<Json>());
        _banners = (r[1] as List<Json>).where((b) => b['source'] != 'greeting').toList();
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _err = e is PortalError ? e.message : 'Could not load the catalog.'; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () => _load(_q.text.trim()),
      child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 32), children: [
        if (widget.onSignIn != null)
          Align(alignment: Alignment.centerRight, child: TextButton(onPressed: widget.onSignIn, child: const Text('Sign in'))),
        TextField(controller: _q, decoration: InputDecoration(hintText: 'Search products', prefixIcon: const Icon(Icons.search), suffixIcon: IconButton(icon: const Icon(Icons.arrow_forward), onPressed: () => _load(_q.text.trim()))),
          onSubmitted: _load),
        CatalogGreetingBanner(api: widget.api),
        if (_banners.isNotEmpty) ...[
          const SizedBox(height: 12),
          SizedBox(height: 160, child: PageView(children: [
            for (final b in _banners)
              Padding(padding: const EdgeInsets.only(right: 8), child: ClipRRect(borderRadius: BorderRadius.circular(16), child: _banner(b))),
          ])),
        ],
        const SizedBox(height: 16),
        Text('Catalog', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
        if (_loading) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
        if (_err != null) Padding(padding: const EdgeInsets.all(16), child: Text(_err!, style: const TextStyle(color: Colors.red))),
        if (!_loading)
          GridView.count(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), crossAxisCount: 2, childAspectRatio: 0.72, crossAxisSpacing: 12, mainAxisSpacing: 12, children: [
            for (final p in _products) _card(p),
          ]),
        if (!_loading && _products.isEmpty && _err == null) const Padding(padding: EdgeInsets.all(32), child: Text('No products published yet.', textAlign: TextAlign.center)),
      ]),
    );
  }

  Widget _banner(Json b) {
    final url = '${b['imageUrl'] ?? b['mobileUrl'] ?? ''}';
    if (url.isEmpty) {
      return ColoredBox(color: const Color(0xFF1a6d98), child: Center(child: Padding(padding: const EdgeInsets.all(16), child: Text('${b['altText'] ?? ''}', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600), textAlign: TextAlign.center))));
    }
    return Stack(fit: StackFit.expand, children: [
      Image.network(url.startsWith('http') ? url : widget.api.base.replace(path: url).toString(), fit: BoxFit.cover),
      const DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00000000), Color(0x66000000)]))),
      Align(alignment: Alignment.bottomLeft, child: Padding(padding: const EdgeInsets.all(12), child: Text('${b['altText'] ?? ''}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)))),
    ]);
  }

  Widget _card(Json p) {
    final images = (p['images'] as List?) ?? [];
    Json? cover;
    for (final im in images) {
      final m = im as Json;
      cover ??= m;
      if (m['cover'] == true) { cover = m; break; }
    }
    final url = cover == null ? '' : '${cover['cardUrl'] ?? cover['url'] ?? ''}';
    final sample = p['isSample'] == true;
    final price = _price(p);
    return InkWell(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ProductDetailScreen(api: widget.api, slug: '${p['slug']}', signedIn: widget.signedIn))),
      child: Container(decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: const [BoxShadow(color: Color(0x140F172A), blurRadius: 12, offset: Offset(0, 4))]),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Stack(children: [
            Positioned.fill(child: ClipRRect(borderRadius: const BorderRadius.vertical(top: Radius.circular(16)), child: url.isEmpty ? const ColoredBox(color: Color(0xFFF1F5F9)) : Image.network(url.startsWith('http') ? url : widget.api.base.replace(path: url).toString(), fit: BoxFit.cover))),
            if (sample) Positioned(left: 8, top: 8, child: Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(99)), child: const Text('SAMPLE', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Color(0xFF1a6d98))))),
          ])),
          Padding(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${p['title'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(price, style: const TextStyle(color: Color(0xFF1a6d98), fontWeight: FontWeight.w600)),
          ])),
        ])),
    );
  }

  String _price(Json p) {
    try {
      final amounts = (((p['price'] as Json?)?['amounts'] as Json?)?['INR'] as Json?);
      final min = amounts?['min'];
      if (min == null) return 'Get quote';
      return '₹$min';
    } catch (_) { return 'Get quote'; }
  }
}

class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.api, required this.slug, required this.signedIn});
  final PortalApi api;
  final String slug;
  final bool signedIn;
  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Json? _p;
  String? _err;
  int _img = 0;
  final _name = TextEditingController(), _phone = TextEditingController(), _qty = TextEditingController(), _msg = TextEditingController();
  String? _result;

  @override
  void initState() { super.initState(); widget.api.catalogProduct(widget.slug).then((p) { if (mounted) setState(() => _p = p); }).catchError((e) { if (mounted) setState(() => _err = e is PortalError ? e.message : 'Not found'); }); }
  @override
  void dispose() { _name.dispose(); _phone.dispose(); _qty.dispose(); _msg.dispose(); super.dispose(); }

  Widget _gallery(Json p) {
    final images = ((p['images'] as List?) ?? []).cast<Json>();
    if (images.isEmpty) return const SizedBox(height: 220, child: ColoredBox(color: Color(0xFFF1F5F9)));
    return Column(children: [
      SizedBox(height: 280, child: PageView.builder(
        itemCount: images.length,
        onPageChanged: (i) => setState(() => _img = i),
        itemBuilder: (c, i) {
          final im = images[i];
          final url = '${im['url'] ?? im['cardUrl'] ?? ''}';
          final src = url.startsWith('http') ? url : widget.api.base.replace(path: url).toString();
          return InteractiveViewer(minScale: 1, maxScale: 4, child: url.isEmpty
            ? const ColoredBox(color: Color(0xFFF1F5F9))
            : Image.network(src, fit: BoxFit.contain));
        },
      )),
      if (images.length > 1) Padding(padding: const EdgeInsets.only(top: 8), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 0; i < images.length; i++)
          Container(width: i == _img ? 16 : 6, height: 6, margin: const EdgeInsets.symmetric(horizontal: 2),
            decoration: BoxDecoration(color: i == _img ? const Color(0xFF1a6d98) : const Color(0xFFCBD5E1), borderRadius: BorderRadius.circular(99))),
      ])),
      Padding(padding: const EdgeInsets.only(top: 4), child: Text('${_img + 1} / ${images.length}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)))),
    ]);
  }

  Future<void> _enquire() async {
    try {
      final r = await widget.api.catalogEnquire('${_p!['id']}', {
        'name': _name.text.trim(), 'phone': _phone.text.trim(), 'phoneCode': '+91',
        if (_qty.text.trim().isNotEmpty) 'quantity': num.tryParse(_qty.text.trim()),
        if (_msg.text.trim().isNotEmpty) 'message': _msg.text.trim(),
      });
      if (mounted) setState(() => _result = 'Request sent. Reference ${r['reference'] ?? r['data']?['leadRef'] ?? ''}');
    } catch (e) {
      if (mounted) setState(() => _result = e is PortalError ? e.message : 'Could not send the enquiry');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    return Scaffold(
      appBar: AppBar(title: Text(p?['title'] as String? ?? 'Product')),
      body: p == null
          ? Center(child: _err == null ? const CircularProgressIndicator() : Text(_err!))
          : ListView(padding: const EdgeInsets.all(16), children: [
              _gallery(p),
              const SizedBox(height: 16),
              if (p['isSample'] == true) const Text('SAMPLE', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF1a6d98))),
              Text('${p['title']}', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
              if (p['summary'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${p['summary']}')),
              const SizedBox(height: 16),
              const Text('Request a quote', style: TextStyle(fontWeight: FontWeight.w700)),
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'Your name')),
              TextField(controller: _phone, decoration: const InputDecoration(labelText: 'Mobile number'), keyboardType: TextInputType.phone),
              TextField(controller: _qty, decoration: const InputDecoration(labelText: 'Quantity'), keyboardType: TextInputType.number),
              TextField(controller: _msg, decoration: const InputDecoration(labelText: 'Message'), maxLines: 3),
              const SizedBox(height: 12),
              FilledButton(onPressed: _enquire, child: const Text('Request quote')),
              if (_result != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_result!)),
            ]),
    );
  }
}

/// Festival greeting on the catalog home, separate from the product banner carousel.
/// Close hides it for this app session. Uses the public greetings feed so guests can see it too.
final _closedGreetings = <String>{};

class CatalogGreetingBanner extends StatefulWidget {
  const CatalogGreetingBanner({super.key, required this.api});
  final PortalApi api;
  @override
  State<CatalogGreetingBanner> createState() => _CatalogGreetingBannerState();
}

class _CatalogGreetingBannerState extends State<CatalogGreetingBanner> {
  Json? _g;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final feed = await widget.api.catalogGreetings();
      final now = DateTime.now();
      final live = feed.where((g) {
        if (_closedGreetings.contains('${g['id']}:${g['version']}')) return false;
        final img = '${g['imageDesktop'] ?? g['imageMobile'] ?? ''}';
        if (img.isEmpty) return false;
        final s = DateTime.tryParse('${g['startsAt']}'), e = DateTime.tryParse('${g['endsAt']}');
        return s != null && e != null && !s.isAfter(now) && e.isAfter(now);
      }).toList()
        ..sort((a, b) => ((b['priority'] as num?) ?? 0).compareTo((a['priority'] as num?) ?? 0));
      if (mounted) setState(() => _g = live.isEmpty ? null : live.first);
    } catch (_) {
      if (mounted) setState(() => _g = null);
    }
  }

  String _src(Json g) {
    final path = '${g['imageMobile'] ?? g['imageDesktop'] ?? ''}';
    if (path.isEmpty) return '';
    return path.startsWith('http') ? path : widget.api.base.resolve(path).toString();
  }

  @override
  Widget build(BuildContext context) {
    final g = _g;
    if (g == null) return const SizedBox.shrink();
    final url = _src(g);
    if (url.isEmpty) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(top: 12), child: Semantics(container: true, label: 'Festival greeting', child: ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: Stack(children: [
        Image.network(url, width: double.infinity, fit: BoxFit.contain, semanticLabel: '${g['alt'] ?? ''}'),
        if (g['dismissible'] == true) Positioned(right: 4, top: 4, child: IconButton(
          key: const Key('catalog-greeting-close'), tooltip: 'Close greeting', color: Colors.white,
          style: IconButton.styleFrom(backgroundColor: const Color(0x990F172A)),
          icon: const Icon(Icons.close),
          onPressed: () { _closedGreetings.add('${g['id']}:${g['version']}'); setState(() => _g = null); },
        )),
      ]),
    )));
  }
}
