import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';
import 'product_form_screen.dart';

class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key});
  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  List<Map<String, dynamic>> _rows = [];
  String? _err;
  bool _loading = true;
  String _q = '';
  String _status = '';
  bool _fromSourcing = false;
  bool _discarded = false;
  int _page = 1;
  int _pageCount = 1;
  int _total = 0;
  static const _pageSize = 25;

  Future<void> _load({int? page}) async {
    final nextPage = page ?? _page;
    setState(() { _loading = true; _err = null; _page = nextPage; });
    try {
      final s = context.read<Session>();
      final result = await s.repo.listProducts(
        q: _q, status: _status,
        includeDeleted: s.perms.isSuperAdmin && _status == 'DELETED',
        fromSourcing: _fromSourcing, discarded: _discarded,
        page: nextPage, limit: _pageSize,
      );
      if (mounted) setState(() { _rows = result.data; _total = result.total; _page = result.page; _pageCount = result.pageCount; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _err = e.toString(); _loading = false; });
    }
  }

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _openForm({Map<String, dynamic>? existing}) async {
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ProductFormScreen(existing: existing)));
    if (saved == true) _load();
  }

  Future<void> _delete(Map<String, dynamic> p) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: const Text('Delete product?'),
      content: Text('“${p['title']}” will be hidden from the catalog. Super admin can restore it.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Delete')),
      ],
    ));
    if (ok != true || !mounted) return;
    try {
      await context.read<Session>().repo.deleteProduct('${p['id']}');
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _run(Future<void> Function() fn) async {
    try {
      await fn();
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  bool _hasSelling(Map<String, dynamic> p) {
    if (p['priceUsd'] != null || p['priceCny'] != null || p['priceInr'] != null || p['priceMin'] != null) return true;
    final price = p['price'];
    if (price is Map && price['amounts'] is Map) {
      for (final a in (price['amounts'] as Map).values) {
        if (a is Map && (a['min'] != null || a['max'] != null)) return true;
      }
    }
    final tiers = p['tiers'];
    return tiers is List && tiers.isNotEmpty;
  }

  bool _needsSelling(Map<String, dynamic> p) {
    final price = p['price'];
    final mode = '${p['priceMode'] ?? (price is Map ? price['mode'] : null) ?? 'GET_QUOTE'}';
    if (mode == 'GET_QUOTE') return false;
    return !_hasSelling(p);
  }

  String? _supplierName(Map<String, dynamic> p) {
    final s = p['catalogSupplier'];
    if (s is Map && s['name'] != null && '${s['name']}'.trim().isNotEmpty) return '${s['name']}'.trim();
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    const statuses = ['', 'DRAFT', 'READY_FOR_PRICE', 'PENDING_REVIEW', 'PUBLISHED', 'UNPUBLISHED', 'DELETED'];
    return Scaffold(
      appBar: AppBar(title: const Text('Products')),
      floatingActionButton: s.perms.canEditCatalog ? FloatingActionButton.extended(
        icon: const Icon(Icons.add), label: const Text('Add product'),
        onPressed: () => _openForm(),
      ) : null,
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 96), children: [
        TextField(
          decoration: const InputDecoration(prefixIcon: Icon(Icons.search), labelText: 'Search products'),
          onChanged: (v) { _q = v; },
          onSubmitted: (_) { _page = 1; _load(page: 1); },
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          value: _status,
          decoration: const InputDecoration(labelText: 'Status'),
          items: [for (final st in statuses) DropdownMenuItem(value: st, child: Text(st.isEmpty ? 'All statuses' : st))],
          onChanged: (v) { setState(() { _status = v ?? ''; _page = 1; }); _load(page: 1); },
        ),
        if (s.perms.canReviewSourcing) ...[
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            FilterChip(
              label: const Text('From sourcing — needs review'),
              selected: _fromSourcing,
              onSelected: (v) { setState(() { _fromSourcing = v; _discarded = false; _page = 1; }); _load(page: 1); },
            ),
            FilterChip(
              label: const Text('Discarded'),
              selected: _discarded,
              onSelected: (v) { setState(() { _discarded = v; _fromSourcing = false; _page = 1; }); _load(page: 1); },
            ),
          ]),
        ],
        const SizedBox(height: 12),
        if (_loading) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
        if (_err != null) Padding(padding: const EdgeInsets.all(16), child: Text(_err!, style: const TextStyle(color: Colors.red))),
        if (!_loading && _rows.isEmpty && _err == null) const Padding(padding: EdgeInsets.all(32), child: Text('No products yet.', textAlign: TextAlign.center)),
        for (final p in _rows)
          Card(child: ListTile(
            title: Text('${p['title'] ?? ''}'),
            subtitle: Text([
              '${p['status'] ?? ''}',
              if (p['isSample'] == true) 'Sample',
              if (p['fromSourcing'] == true) 'From sourcing request',
              if (p['sourceUpdatePending'] == true) 'Updated from sourcing — review',
              if (_supplierName(p) != null) _supplierName(p)!,
              if (p['categoryName'] != null) '${p['categoryName']}',
            ].join(' · ')),
            isThreeLine: false,
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              if (s.perms.isSupplier && (p['status'] == 'DRAFT' || p['status'] == 'UNPUBLISHED' || p['status'] == 'READY_FOR_PRICE'))
                IconButton(icon: const Icon(Icons.rate_review_outlined), tooltip: 'Submit for review', onPressed: () => _run(() => s.repo.submitProductReview('${p['id']}', on: true))),
              if (s.perms.isSupplier && p['status'] == 'PENDING_REVIEW')
                IconButton(icon: const Icon(Icons.undo), tooltip: 'Withdraw review', onPressed: () => _run(() => s.repo.submitProductReview('${p['id']}', on: false))),
              if (s.perms.canPublishCatalog && p['status'] != 'PUBLISHED' && p['status'] != 'DELETED')
                IconButton(icon: const Icon(Icons.publish_outlined), tooltip: 'Publish', onPressed: () => _run(() async {
                  final blockers = (p['publishBlockers'] as List?) ?? const [];
                  if (blockers.isNotEmpty) throw blockers.first.toString();
                  if (_needsSelling(p)) {
                    throw 'Set a selling price in at least one currency (USD, RMB or INR), then save, before publishing a fixed-price product. One currency is enough. Or switch the pricing mode to Get quote. The China factory cost is never shown publicly.';
                  }
                  await s.repo.publishProduct('${p['id']}');
                })),
              if (s.perms.canPublishCatalog && p['status'] == 'PUBLISHED')
                IconButton(icon: const Icon(Icons.unpublished_outlined), tooltip: 'Unpublish', onPressed: () => _run(() => s.repo.publishProduct('${p['id']}', on: false))),
              if (s.perms.canReviewSourcing && p['fromSourcing'] == true && p['status'] != 'DELETED')
                IconButton(icon: const Icon(Icons.remove_circle_outline), tooltip: 'Discard sourcing draft', onPressed: () async {
                  final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
                    title: const Text('Discard from review?'),
                    content: const Text('The sourcing request itself will not be changed.'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
                      TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Discard')),
                    ],
                  ));
                  if (ok == true) _run(() => s.repo.discardSourceDraft('${p['id']}'));
                }),
              if (s.perms.canDeleteCatalog && p['status'] != 'DELETED')
                IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Delete', onPressed: () => _delete(p)),
              if (s.perms.isSuperAdmin && p['status'] == 'DELETED')
                IconButton(icon: const Icon(Icons.restore), tooltip: 'Restore', onPressed: () => _run(() => s.repo.restoreProduct('${p['id']}'))),
            ]),
            onTap: () {
              if (s.perms.isSupplier && p['status'] == 'PUBLISHED') {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Published products are locked for suppliers. Ask the Marketplace Team if a change is needed.')));
                return;
              }
              _openForm(existing: p);
            },
          )),
        if (!_loading && _total > 0) Padding(
          padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
          child: Row(children: [
            Expanded(child: Text('Showing ${((_page - 1) * _pageSize) + 1}–${(_page * _pageSize).clamp(0, _total)} of $_total')),
            TextButton(onPressed: _page <= 1 ? null : () => _load(page: _page - 1), child: const Text('Previous')),
            Text('Page $_page of $_pageCount'),
            TextButton(onPressed: _page >= _pageCount ? null : () => _load(page: _page + 1), child: const Text('Next')),
          ]),
        ),
      ])),
    );
  }
}
