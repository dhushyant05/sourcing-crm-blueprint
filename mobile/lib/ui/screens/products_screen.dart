import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';

class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key});
  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  List<Map<String, dynamic>> _rows = [];
  String? _err;
  bool _loading = true;

  Future<void> _load() async {
    setState(() { _loading = true; _err = null; });
    try {
      final rows = await context.read<Session>().repo.listProducts();
      if (mounted) setState(() { _rows = rows; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _err = e.toString(); _loading = false; });
    }
  }

  @override
  void initState() { super.initState(); _load(); }

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

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return Scaffold(
      appBar: AppBar(title: const Text('Products')),
      floatingActionButton: s.perms.canEditCatalog ? FloatingActionButton.extended(
        icon: const Icon(Icons.add), label: const Text('Add product'),
        onPressed: () async {
          final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const _ProductForm()));
          if (saved == true) _load();
        },
      ) : null,
      body: RefreshIndicator(onRefresh: _load, child: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 96), children: [
              if (_err != null) Padding(padding: const EdgeInsets.all(16), child: Text(_err!, style: const TextStyle(color: Colors.red))),
              if (_rows.isEmpty && _err == null) const Padding(padding: EdgeInsets.all(32), child: Text('No products yet.', textAlign: TextAlign.center)),
              for (final p in _rows)
                Card(child: ListTile(
                  title: Text('${p['title'] ?? ''}'),
                  subtitle: Text('${p['status'] ?? ''}${p['isSample'] == true ? ' · Sample' : ''}'),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    if (s.perms.canPublishCatalog && p['status'] != 'PUBLISHED' && p['status'] != 'DELETED')
                      IconButton(icon: const Icon(Icons.publish_outlined), tooltip: 'Publish', onPressed: () async { await s.repo.publishProduct('${p['id']}'); _load(); }),
                    if (s.perms.canDeleteCatalog && p['status'] != 'DELETED')
                      IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Delete', onPressed: () => _delete(p)),
                    if (s.perms.isSuperAdmin && p['status'] == 'DELETED')
                      IconButton(icon: const Icon(Icons.restore), tooltip: 'Restore', onPressed: () async { await s.repo.restoreProduct('${p['id']}'); _load(); }),
                  ]),
                  onTap: () async {
                    final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => _ProductForm(existing: p)));
                    if (saved == true) _load();
                  },
                )),
            ])),
    );
  }
}

class _ProductForm extends StatefulWidget {
  const _ProductForm({this.existing});
  final Map<String, dynamic>? existing;
  @override
  State<_ProductForm> createState() => _ProductFormState();
}

class _ProductFormState extends State<_ProductForm> {
  late final _title = TextEditingController(text: '${widget.existing?['title'] ?? ''}');
  late final _summary = TextEditingController(text: '${widget.existing?['summary'] ?? ''}');
  late final _moq = TextEditingController(text: widget.existing?['moq'] == null ? '' : '${widget.existing?['moq']}');
  late final _unit = TextEditingController(text: '${widget.existing?['unit'] ?? 'pcs'}');
  late final _lead = TextEditingController(text: '${widget.existing?['leadTime'] ?? ''}');
  final List<String> _pending = [];
  final List<Map<String, dynamic>> _images = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _images.addAll(((widget.existing?['images'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)));
  }

  @override
  void dispose() { _title.dispose(); _summary.dispose(); _moq.dispose(); _unit.dispose(); _lead.dispose(); super.dispose(); }

  String _abs(String url, Session s) {
    if (url.startsWith('http')) return url;
    return Uri.parse(s.serverUrl).resolve(url).toString();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      final repo = context.read<Session>().repo;
      final body = {
        'title': _title.text.trim(),
        'summary': _summary.text.trim(),
        if (_moq.text.trim().isNotEmpty) 'moq': num.tryParse(_moq.text.trim()),
        'unit': _unit.text.trim(),
        'leadTime': _lead.text.trim(),
      };
      Map<String, dynamic> saved;
      if (widget.existing == null) {
        saved = await repo.createProduct(body);
      } else {
        saved = await repo.updateProduct('${widget.existing!['id']}', body);
      }
      for (final path in _pending) {
        await repo.addProductImage('${saved['id']}', path);
      }
      if (_images.isNotEmpty) {
        await repo.reorderProductImages('${saved['id']}', order: _images.map((e) => '${e['id']}').toList(),
            cover: _images.cast<Map?>().firstWhere((e) => e?['cover'] == true, orElse: () => _images.first)?['id']?.toString());
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      appBar: AppBar(title: Text(widget.existing == null ? 'Add product' : 'Edit product')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _title, decoration: const InputDecoration(labelText: 'Title')),
        TextField(controller: _summary, decoration: const InputDecoration(labelText: 'Summary'), maxLines: 3),
        TextField(controller: _moq, decoration: const InputDecoration(labelText: 'Minimum order quantity'), keyboardType: TextInputType.number),
        TextField(controller: _unit, decoration: const InputDecoration(labelText: 'Unit')),
        TextField(controller: _lead, decoration: const InputDecoration(labelText: 'Lead time')),
        const SizedBox(height: 16),
        const Text('Photos', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        if (_images.isNotEmpty)
          SizedBox(height: 148, child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _images.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (c, i) {
              final im = _images[i];
              final url = '${im['cardUrl'] ?? im['url'] ?? ''}';
              return SizedBox(width: 120, child: Column(children: [
                Expanded(child: Stack(children: [
                  Positioned.fill(child: ClipRRect(borderRadius: BorderRadius.circular(12), child: url.isEmpty
                    ? const ColoredBox(color: Color(0xFFF1F5F9))
                    : Image.network(_abs(url, session), fit: BoxFit.cover, headers: {if (session.accessToken != null) 'Authorization': 'Bearer ${session.accessToken}'}))),
                  if (im['cover'] == true) const Positioned(left: 6, top: 6, child: Chip(label: Text('Cover', style: TextStyle(fontSize: 10)), visualDensity: VisualDensity.compact)),
                ])),
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  IconButton(icon: const Icon(Icons.chevron_left, size: 18), onPressed: i == 0 ? null : () { setState(() { final x = _images.removeAt(i); _images.insert(i - 1, x); }); }),
                  IconButton(icon: const Icon(Icons.star_outline, size: 18), tooltip: 'Set cover', onPressed: () { setState(() { for (final x in _images) { x['cover'] = false; } _images[i]['cover'] = true; }); }),
                  IconButton(icon: const Icon(Icons.delete_outline, size: 18), onPressed: () async {
                    final id = widget.existing?['id'];
                    if (id != null) { await session.repo.deleteProductImage('$id', '${im['id']}'); }
                    setState(() => _images.removeAt(i));
                  }),
                  IconButton(icon: const Icon(Icons.chevron_right, size: 18), onPressed: i == _images.length - 1 ? null : () { setState(() { final x = _images.removeAt(i); _images.insert(i + 1, x); }); }),
                ]),
              ]));
            },
          )),
        if (_pending.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${_pending.length} new photo${_pending.length == 1 ? '' : 's'} will upload on save.')),
        const SizedBox(height: 8),
        OutlinedButton.icon(icon: const Icon(Icons.photo_outlined), label: const Text('Add photos'),
          onPressed: () async {
            final files = await ImagePicker().pickMultiImage(maxWidth: 2000, imageQuality: 88);
            if (files.isNotEmpty) setState(() => _pending.addAll(files.map((f) => f.path)));
          }),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save')),
      ]),
    );
  }
}
