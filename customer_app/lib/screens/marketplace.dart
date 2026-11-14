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
        _banners = r[1] as List<Json>;
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
        if (_banners.isNotEmpty) ...[
          const SizedBox(height: 12),
          SizedBox(height: 140, child: PageView(children: [
            for (final b in _banners)
              Padding(padding: const EdgeInsets.only(right: 8), child: ClipRRect(borderRadius: BorderRadius.circular(16), child: ColoredBox(color: const Color(0xFF1a6d98), child: Center(child: Padding(padding: const EdgeInsets.all(16), child: Text('${b['altText'] ?? ''}', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600), textAlign: TextAlign.center)))))),
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

  Widget _card(Json p) {
    final images = (p['images'] as List?) ?? [];
    final url = images.isNotEmpty ? '${(images.first as Json)['url'] ?? ''}' : '';
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
  final _name = TextEditingController(), _phone = TextEditingController(), _qty = TextEditingController(), _msg = TextEditingController();
  String? _result;

  @override
  void initState() { super.initState(); widget.api.catalogProduct(widget.slug).then((p) { if (mounted) setState(() => _p = p); }).catchError((e) { if (mounted) setState(() => _err = e is PortalError ? e.message : 'Not found'); }); }
  @override
  void dispose() { _name.dispose(); _phone.dispose(); _qty.dispose(); _msg.dispose(); super.dispose(); }

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
