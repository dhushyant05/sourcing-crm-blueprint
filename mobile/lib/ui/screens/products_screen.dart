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
  String? _photo;
  bool _busy = false;

  @override
  void dispose() { _title.dispose(); _summary.dispose(); _moq.dispose(); _unit.dispose(); _lead.dispose(); super.dispose(); }

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
      if (_photo != null) await repo.addProductImage('${saved['id']}', _photo!);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.existing == null ? 'Add product' : 'Edit product')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _title, decoration: const InputDecoration(labelText: 'Title')),
        TextField(controller: _summary, decoration: const InputDecoration(labelText: 'Summary'), maxLines: 3),
        TextField(controller: _moq, decoration: const InputDecoration(labelText: 'Minimum order quantity'), keyboardType: TextInputType.number),
        TextField(controller: _unit, decoration: const InputDecoration(labelText: 'Unit')),
        TextField(controller: _lead, decoration: const InputDecoration(labelText: 'Lead time')),
        const SizedBox(height: 12),
        OutlinedButton.icon(icon: const Icon(Icons.photo_outlined), label: Text(_photo == null ? 'Add photo' : 'Photo selected'),
          onPressed: () async {
            final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2000, imageQuality: 88);
            if (f != null) setState(() => _photo = f.path);
          }),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save')),
      ]),
    );
  }
}
