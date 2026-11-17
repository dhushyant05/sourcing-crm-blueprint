import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/roles.dart';
import '../../services/session.dart';

class ProductFormScreen extends StatefulWidget {
  const ProductFormScreen({super.key, this.existing});
  final Map<String, dynamic>? existing;
  @override
  State<ProductFormScreen> createState() => _ProductFormScreenState();
}

class _PendingPhoto {
  _PendingPhoto(this.path);
  final String path;
  bool cover = false;
}

class _Kv {
  _Kv([this.key = '', this.value = '']);
  String key;
  String value;
}

class _Tier {
  _Tier({this.minQty = '', this.maxQty = '', this.unitPrice = '', this.priceUsd = '', this.priceCny = '', this.priceInr = ''});
  String minQty, maxQty, unitPrice, priceUsd, priceCny, priceInr;
}

class _Lead {
  _Lead({this.minQty = '', this.maxQty = '', this.time = ''});
  String minQty, maxQty, time;
}

class _Cust {
  _Cust({this.label = '', this.moq = '', this.note = ''});
  String label, moq, note;
}

class _Prot {
  _Prot({this.title = '', this.text = ''});
  String title, text;
}

class _Opt {
  _Opt({this.label = '', this.hex = ''});
  String label, hex;
}

class _Var {
  _Var({this.name = '', List<_Opt>? options}) : options = options ?? [_Opt()];
  String name;
  List<_Opt> options;
}

String _s(dynamic v) => v == null || v == 'null' ? '' : '$v';

class _ProductFormScreenState extends State<ProductFormScreen> {
  static const _photoMax = 15;
  static const _currencies = ['USD', 'CNY', 'INR'];

  late final _title = TextEditingController();
  late final _summary = TextEditingController();
  late final _tags = TextEditingController();
  late final _moq = TextEditingController();
  late final _unit = TextEditingController(text: 'pcs');
  late final _lead = TextEditingController();
  late final _capacity = TextEditingController();
  late final _packaging = TextEditingController();
  late final _customization = TextEditingController();
  late final _samplePolicy = TextEditingController();
  late final _priceMin = TextEditingController();
  late final _priceMax = TextEditingController();
  late final _priceUsd = TextEditingController();
  late final _priceCny = TextEditingController();
  late final _priceInr = TextEditingController();
  late final _sampleAmount = TextEditingController();
  late final _sampleLead = TextEditingController();
  late final _shipOrigin = TextEditingController();
  late final _shipEstimate = TextEditingController();
  late final _shipNote = TextEditingController();
  late final _sellingUnits = TextEditingController();
  late final _packageSize = TextEditingController();
  late final _grossWeight = TextEditingController();
  late final _packageType = TextEditingController();
  late final _longDescription = TextEditingController();
  late final _reviewsNote = TextEditingController();
  late final _newSupName = TextEditingController();
  late final _newSupRegion = TextEditingController();
  late final _newSupYears = TextEditingController();
  late final _newSupAbout = TextEditingController();
  late final _clearancePrice = TextEditingController();
  late final _clearanceDiscount = TextEditingController();
  late final _clearanceEnds = TextEditingController();
  late final _clearanceStock = TextEditingController();

  String _priceMode = 'GET_QUOTE';
  String _baseCurrency = 'USD';
  String _sampleCurrency = 'USD';
  String? _categoryId;
  List<String> _extraIds = [];
  String? _supplierId;
  bool _newSupConsent = false;
  bool _newSupVerified = false;
  bool _pinned = false;
  bool _clearance = false;

  List<_Kv> _industry = [_Kv()];
  List<_Kv> _other = [_Kv()];
  List<_Kv> _legacy = [_Kv()];
  List<_Tier> _tiers = [_Tier()];
  List<_Var> _variations = [_Var()];
  List<_Cust> _customizations = [_Cust()];
  List<_Lead> _leadTimes = [_Lead()];
  List<_Prot> _protections = [_Prot()];

  final List<_PendingPhoto> _pending = [];
  final List<Map<String, dynamic>> _images = [];
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _suppliers = [];
  bool _busy = false;
  bool _loading = true;
  String? _err;

  Map<String, dynamic>? _product;

  @override
  void initState() {
    super.initState();
    _product = widget.existing;
    _hydrate(_product);
    WidgetsBinding.instance.addPostFrameCallback((_) => _boot());
  }

  Future<void> _boot() async {
    try {
      final repo = context.read<Session>().repo;
      final id = widget.existing?['id'];
      if (id != null) {
        final fresh = await repo.getProduct('$id');
        if (!mounted) return;
        _product = fresh;
        _hydrate(fresh);
      }
      final link = context.read<Session>().perms.canLinkCatalogSupplier;
      final cats = await repo.listCategories();
      List<Map<String, dynamic>> suppliers = [];
      if (link) {
        suppliers = await repo.listCatalogSuppliers();
      }
      if (!mounted) return;
      setState(() {
        _categories = cats;
        _suppliers = suppliers;
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _err = '$e'; _loading = false; });
    }
  }


  String _amt(dynamic price, String cur, [dynamic fallback]) {
    if (fallback != null) return _s(fallback);
    if (price is! Map) return '';
    final amounts = price['amounts'];
    if (amounts is! Map) return '';
    final a = amounts[cur];
    if (a is Map && a['min'] != null) return _s(a['min']);
    if (a != null && a is! Map) return _s(a);
    return '';
  }

  void _hydrate(Map<String, dynamic>? p) {
    _title.text = _s(p?['title']);
    _summary.text = _s(p?['summary']);
    final tags = p?['tags'];
    _tags.text = tags is List ? tags.map(_s).where((s) => s.isNotEmpty).join(', ') : _s(tags);
    _moq.text = p?['moq'] == null ? '' : _s(p?['moq']);
    _unit.text = _s(p?['unit']).isEmpty ? 'pcs' : _s(p?['unit']);
    _lead.text = _s(p?['leadTime']);
    _capacity.text = _s(p?['capacity']);
    _packaging.text = _s(p?['packaging']);
    _customization.text = _s(p?['customization']);
    _samplePolicy.text = _s(p?['samplePolicy']);
    _priceMode = _s(p?['priceMode'] ?? (p?['price'] is Map ? (p!['price'] as Map)['mode'] : null));
    if (_priceMode.isEmpty) _priceMode = 'GET_QUOTE';
    _baseCurrency = _s(p?['baseCurrency'] ?? (p?['price'] is Map ? (p!['price'] as Map)['base'] : null));
    if (_baseCurrency.isEmpty) _baseCurrency = 'USD';
    _priceMin.text = p?['priceMin'] == null ? '' : _s(p?['priceMin']);
    _priceMax.text = p?['priceMax'] == null ? '' : _s(p?['priceMax']);
    _priceUsd.text = _amt(p?['price'], 'USD', p?['priceUsd']);
    _priceCny.text = _amt(p?['price'], 'CNY', p?['priceCny']);
    _priceInr.text = _amt(p?['price'], 'INR', p?['priceInr']);
    _pinned = p?['pinned'] == true;
    _clearance = p?['clearance'] == true;
    final sale = p?['clearancePrice'];
    if (sale is Map) {
      final amounts = sale['amounts'];
      final min = amounts is Map ? (amounts['USD'] is Map ? amounts['USD']['min'] : amounts['USD']) : null;
      _clearancePrice.text = min == null ? '' : _s(min);
    } else {
      _clearancePrice.text = sale == null ? '' : _s(sale);
    }
    _clearanceDiscount.text = p?['clearanceDiscountPct'] == null ? '' : _s(p?['clearanceDiscountPct']);
    final ends = _s(p?['clearanceEndsAt']);
    _clearanceEnds.text = ends.length >= 10 ? ends.substring(0, 10) : ends;
    _clearanceStock.text = p?['clearanceStockLeft'] == null ? '' : _s(p?['clearanceStockLeft']);
    _categoryId = _s(p?['categoryId'] ?? p?['category']?['id']);
    if (_categoryId!.isEmpty) _categoryId = null;
    _extraIds = ((p?['extraCategories'] as List?) ?? [])
        .map((e) => _s(e is Map ? (e['id']) : e))
        .where((id) => id.isNotEmpty)
        .toList();
    _supplierId = _s(p?['supplierId'] ?? p?['catalogSupplier']?['id']);
    if (_supplierId!.isEmpty) _supplierId = null;

    final merch = (p?['merchandising'] is Map) ? Map<String, dynamic>.from(p!['merchandising'] as Map) : <String, dynamic>{};
    _industry = _kvs(merch['industryAttributes']);
    _other = _kvs(merch['otherAttributes']);
    _legacy = _kvs(p?['specs']);
    final sample = merch['samplePrice'];
    if (sample is Map) {
      _sampleAmount.text = sample['amount'] == null ? '' : _s(sample['amount']);
      _sampleCurrency = _s(sample['currency']).isEmpty ? 'USD' : _s(sample['currency']);
      _sampleLead.text = _s(sample['leadTime']);
    }
    final ship = merch['shipping'];
    if (ship is Map) {
      _shipOrigin.text = _s(ship['origin']);
      _shipEstimate.text = _s(ship['estimate']);
      _shipNote.text = _s(ship['note']);
    }
    final pack = merch['packing'];
    if (pack is Map) {
      _sellingUnits.text = _s(pack['sellingUnits']);
      _packageSize.text = _s(pack['singlePackageSize']);
      _grossWeight.text = _s(pack['grossWeight']);
      _packageType.text = _s(pack['packageType']);
    }
    _longDescription.text = _s(merch['description']);
    _reviewsNote.text = _s(merch['reviewsNote']);

    _variations = ((merch['variations'] as List?) ?? []).map((v) {
      final m = Map<String, dynamic>.from(v as Map);
      final opts = ((m['options'] as List?) ?? []).map((o) {
        final om = Map<String, dynamic>.from(o as Map);
        return _Opt(label: _s(om['label']), hex: _s(om['hex']));
      }).toList();
      if (opts.isEmpty || opts.last.label.isNotEmpty) opts.add(_Opt());
      return _Var(name: _s(m['name']), options: opts);
    }).toList();
    if (_variations.isEmpty || _variations.last.name.isNotEmpty) _variations.add(_Var());

    _customizations = ((merch['customizations'] as List?) ?? []).map((c) {
      final m = Map<String, dynamic>.from(c as Map);
      return _Cust(label: _s(m['label']), moq: m['moq'] == null ? '' : _s(m['moq']), note: _s(m['note']));
    }).toList();
    if (_customizations.isEmpty || _customizations.last.label.isNotEmpty) _customizations.add(_Cust());

    _leadTimes = ((merch['leadTimes'] as List?) ?? []).map((t) {
      final m = Map<String, dynamic>.from(t as Map);
      return _Lead(minQty: _s(m['minQty']), maxQty: m['maxQty'] == null ? '' : _s(m['maxQty']), time: _s(m['time']));
    }).toList();
    if (_leadTimes.isEmpty || _leadTimes.last.minQty.isNotEmpty) _leadTimes.add(_Lead());

    _protections = ((merch['protections'] as List?) ?? []).map((t) {
      final m = Map<String, dynamic>.from(t as Map);
      return _Prot(title: _s(m['title']), text: _s(m['text']));
    }).toList();
    if (_protections.isEmpty || _protections.last.title.isNotEmpty) _protections.add(_Prot());

    final base = _baseCurrency;
    _tiers = ((p?['tiers'] as List?) ?? []).map((t) {
      final m = Map<String, dynamic>.from(t as Map);
      final amounts = m['amounts'] is Map ? Map<String, dynamic>.from(m['amounts'] as Map) : <String, dynamic>{};
      final price = amounts[base] ?? amounts['USD'] ?? m['unitPrice'];
      return _Tier(
        minQty: _s(m['minQty']), maxQty: m['maxQty'] == null ? '' : _s(m['maxQty']), unitPrice: _s(price),
        priceUsd: _s(m['priceUsd'] ?? amounts['USD']),
        priceCny: _s(m['priceCny'] ?? amounts['CNY']),
        priceInr: _s(m['priceInr'] ?? amounts['INR']),
      );
    }).toList();
    if (_tiers.isEmpty || _tiers.last.unitPrice.isNotEmpty || _tiers.last.priceUsd.isNotEmpty) _tiers.add(_Tier());

    _images
      ..clear()
      ..addAll(((p?['images'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)));
  }

  List<_Kv> _kvs(dynamic raw) {
    final out = <_Kv>[];
    if (raw is List) {
      for (final e in raw) {
        if (e is Map) {
          final m = Map<String, dynamic>.from(e);
          out.add(_Kv(_s(m['key']), _s(m['value'])));
        }
      }
    } else if (raw is Map) {
      for (final e in raw.entries) {
        out.add(_Kv(_s(e.key), _s(e.value)));
      }
    }
    if (out.isEmpty || out.last.key.isNotEmpty || out.last.value.isNotEmpty) out.add(_Kv());
    return out;
  }

  @override
  void dispose() {
    for (final c in [
      _title, _summary, _tags, _moq, _unit, _lead, _capacity, _packaging, _customization, _samplePolicy,
      _priceMin, _priceMax, _priceUsd, _priceCny, _priceInr, _clearancePrice, _clearanceDiscount, _clearanceEnds, _clearanceStock,
      _sampleAmount, _sampleLead, _shipOrigin, _shipEstimate, _shipNote,
      _sellingUnits, _packageSize, _grossWeight, _packageType, _longDescription, _reviewsNote,
      _newSupName, _newSupRegion, _newSupYears, _newSupAbout,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  String _abs(String url, Session s) {
    if (url.startsWith('http')) return url;
    return Uri.parse(s.serverUrl).resolve(url).toString();
  }

  List<Map<String, String>> _filledKv(List<_Kv> rows) =>
      rows.where((r) => r.key.trim().isNotEmpty && r.value.trim().isNotEmpty)
          .map((r) => {'key': r.key.trim(), 'value': r.value.trim()}).toList();

  bool _formHasSellingPrice() {
    if (_priceUsd.text.trim().isNotEmpty || _priceCny.text.trim().isNotEmpty || _priceInr.text.trim().isNotEmpty || _priceMin.text.trim().isNotEmpty) return true;
    if (_priceMode == 'TIERS' && _tiers.any((x) => x.unitPrice.trim().isNotEmpty || x.priceUsd.trim().isNotEmpty || x.priceCny.trim().isNotEmpty || x.priceInr.trim().isNotEmpty)) return true;
    return false;
  }

  Future<void> _save(Permissions perms, {bool publish = false}) async {
    if (_title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Title is required.')));
      return;
    }
    if (publish && _product?['fromSourcing'] == true && !_formHasSellingPrice()) {
      const msg = 'Set a selling price in at least one currency (USD, RMB or INR), then save, before publishing a product from a sourcing request. The China factory cost is never shown publicly.';
      setState(() => _err = msg);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text(msg)));
      return;
    }
    setState(() { _busy = true; _err = null; });
    try {
      final repo = context.read<Session>().repo;
      final industry = _filledKv(_industry);
      final other = _filledKv(_other);
      final specs = [...industry, ...other];
      final merchandising = {
        'variations': _variations.where((v) => v.name.trim().isNotEmpty).map((v) {
          final opts = v.options.where((o) => o.label.trim().isNotEmpty)
              .map((o) => {'label': o.label.trim(), 'hex': o.hex.trim().isEmpty ? null : o.hex.trim()}).toList();
          return {'name': v.name.trim(), 'options': opts};
        }).where((v) => (v['options'] as List).isNotEmpty).toList(),
        'customizations': _customizations.where((c) => c.label.trim().isNotEmpty).map((c) => {
          'label': c.label.trim(),
          'moq': num.tryParse(c.moq.trim()),
          'note': c.note.trim().isEmpty ? null : c.note.trim(),
        }).toList(),
        'leadTimes': _leadTimes.where((x) => x.minQty.trim().isNotEmpty && x.time.trim().isNotEmpty).map((x) => {
          'minQty': num.tryParse(x.minQty.trim()) ?? 0,
          'maxQty': num.tryParse(x.maxQty.trim()),
          'time': x.time.trim(),
        }).toList(),
        'samplePrice': _sampleAmount.text.trim().isEmpty ? null : {
          'amount': num.tryParse(_sampleAmount.text.trim()),
          'currency': _sampleCurrency,
          'leadTime': _sampleLead.text.trim().isEmpty ? null : _sampleLead.text.trim(),
        },
        'shipping': (_shipOrigin.text.trim().isEmpty && _shipEstimate.text.trim().isEmpty && _shipNote.text.trim().isEmpty)
            ? null
            : {
                'origin': _shipOrigin.text.trim().isEmpty ? null : _shipOrigin.text.trim(),
                'estimate': _shipEstimate.text.trim().isEmpty ? null : _shipEstimate.text.trim(),
                'note': _shipNote.text.trim().isEmpty ? null : _shipNote.text.trim(),
              },
        'industryAttributes': industry,
        'otherAttributes': other,
        'packing': (_sellingUnits.text.trim().isEmpty && _packageSize.text.trim().isEmpty && _grossWeight.text.trim().isEmpty && _packageType.text.trim().isEmpty)
            ? null
            : {
                'sellingUnits': _sellingUnits.text.trim().isEmpty ? null : _sellingUnits.text.trim(),
                'singlePackageSize': _packageSize.text.trim().isEmpty ? null : _packageSize.text.trim(),
                'grossWeight': _grossWeight.text.trim().isEmpty ? null : _grossWeight.text.trim(),
                'packageType': _packageType.text.trim().isEmpty ? null : _packageType.text.trim(),
              },
        'description': _longDescription.text.trim().isEmpty ? null : _longDescription.text.trim(),
        'reviewsNote': _reviewsNote.text.trim().isEmpty ? null : _reviewsNote.text.trim(),
        'protections': _protections.where((x) => x.title.trim().isNotEmpty && x.text.trim().isNotEmpty)
            .map((x) => {'title': x.title.trim(), 'text': x.text.trim()}).toList(),
      };
      final body = <String, dynamic>{
        'title': _title.text.trim(),
        'summary': _summary.text.trim(),
        'moq': num.tryParse(_moq.text.trim()),
        'unit': _unit.text.trim(),
        'leadTime': _lead.text.trim(),
        'capacity': _capacity.text.trim().isEmpty ? null : _capacity.text.trim(),
        'packaging': _packaging.text.trim().isEmpty ? null : _packaging.text.trim(),
        'customization': _customization.text.trim().isEmpty ? null : _customization.text.trim(),
        'samplePolicy': _samplePolicy.text.trim().isEmpty ? null : _samplePolicy.text.trim(),
        'categoryId': _categoryId,
        'extraCategoryIds': _extraIds,
        'tags': _tags.text,
        'specs': specs.isNotEmpty ? specs : _filledKv(_legacy),
        'merchandising': merchandising,
      };
      if (perms.canPriceCatalog) {
        body['priceMode'] = _priceMode;
        body['priceMin'] = num.tryParse(_priceMin.text.trim());
        body['priceMax'] = num.tryParse(_priceMax.text.trim());
        body['priceUsd'] = num.tryParse(_priceUsd.text.trim());
        body['priceCny'] = num.tryParse(_priceCny.text.trim());
        body['priceInr'] = num.tryParse(_priceInr.text.trim());
        body['baseCurrency'] = _baseCurrency;
        body['tiers'] = _priceMode == 'TIERS'
            ? _tiers.where((t) => t.unitPrice.trim().isNotEmpty || t.priceUsd.trim().isNotEmpty || t.priceCny.trim().isNotEmpty || t.priceInr.trim().isNotEmpty).map((t) => {
                'minQty': num.tryParse(t.minQty.trim()) ?? 1,
                'maxQty': num.tryParse(t.maxQty.trim()),
                'unitPrice': num.tryParse(t.unitPrice.trim()) ?? num.tryParse(t.priceUsd.trim()) ?? num.tryParse(t.priceCny.trim()) ?? num.tryParse(t.priceInr.trim()),
                'priceUsd': num.tryParse(t.priceUsd.trim()),
                'priceCny': num.tryParse(t.priceCny.trim()),
                'priceInr': num.tryParse(t.priceInr.trim()),
              }).toList()
            : [];
      }
      if (perms.canPromoteCatalog) {
        body['pinned'] = _pinned;
        body['clearance'] = _clearance;
        body['clearancePrice'] = num.tryParse(_clearancePrice.text.trim());
        body['clearanceDiscountPct'] = num.tryParse(_clearanceDiscount.text.trim());
        body['clearanceEndsAt'] = _clearanceEnds.text.trim().isEmpty ? null : _clearanceEnds.text.trim();
        body['clearanceStockLeft'] = int.tryParse(_clearanceStock.text.trim());
      }
      if (perms.canLinkCatalogSupplier) {
        body['supplierId'] = _supplierId;
      }
      Map<String, dynamic> saved;
      final existingId = _product?['id'] ?? widget.existing?['id'];
      if (existingId == null) {
        saved = await repo.createProduct(body);
      } else {
        saved = await repo.updateProduct('$existingId', body);
      }
      final existingIds = _images.map((e) => '${e['id']}').toList();
      for (final photo in _pending) {
        await repo.addProductImage('${saved['id']}', photo.path);
      }
      if (_pending.isNotEmpty || _images.isNotEmpty) {
        final fresh = await repo.getProduct('${saved['id']}');
        final imgs = ((fresh['images'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        final added = imgs.skip(existingIds.length).map((e) => '${e['id']}').toList();
        final coverPending = _pending.indexWhere((p) => p.cover);
        String? coverId;
        if (coverPending >= 0 && coverPending < added.length) coverId = added[coverPending];
        coverId ??= _images.cast<Map?>().firstWhere((e) => e?['cover'] == true, orElse: () => _images.isEmpty ? null : _images.first)?['id']?.toString();
        coverId ??= added.isNotEmpty ? added.first : null;
        final order = [...existingIds, ...added];
        if (order.isNotEmpty) {
          await repo.reorderProductImages('${saved['id']}', order: order, cover: coverId);
        }
      }
      if (publish) {
        await repo.publishProduct('${saved['id']}');
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addSupplier() async {
    if (_newSupName.text.trim().isEmpty) return;
    try {
      final created = await context.read<Session>().repo.createCatalogSupplier({
        'name': _newSupName.text.trim(),
        'publicRegion': _newSupRegion.text.trim().isEmpty ? null : _newSupRegion.text.trim(),
        'publicYears': num.tryParse(_newSupYears.text.trim()),
        'publicAbout': _newSupAbout.text.trim().isEmpty ? null : _newSupAbout.text.trim(),
        'catalogConsent': _newSupConsent,
        'publicVerified': _newSupVerified,
      });
      if (!mounted) return;
      setState(() {
        _suppliers = [..._suppliers, created]..sort((a, b) => _s(a['name']).toLowerCase().compareTo(_s(b['name']).toLowerCase()));
        _supplierId = '${created['id']}';
        _newSupName.clear();
        _newSupRegion.clear();
        _newSupYears.clear();
        _newSupAbout.clear();
        _newSupConsent = false;
        _newSupVerified = false;
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final perms = session.perms;
    return Scaffold(
      appBar: AppBar(title: Text(widget.existing == null ? 'Add product' : 'Edit product')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
              if (_err != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_err!, style: const TextStyle(color: Colors.red))),
              if (_product?['fromSourcing'] == true)
                Card(
                  color: const Color(0xFFFFF8E1),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${_product?['sourceLabel'] ?? 'From sourcing request'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      if (_s(_product?['sourceLeadRef']).isNotEmpty) Text('Request ${_s(_product?['sourceLeadRef'])}'),
                      if (_product?['referenceCost'] is Map && (_product!['referenceCost'] as Map)['amount'] != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text('China quoted cost (internal only): ${(_product!['referenceCost'] as Map)['currency'] ?? ''} ${(_product!['referenceCost'] as Map)['amount']}'),
                        ),
                      const Padding(
                        padding: EdgeInsets.only(top: 4),
                        child: Text('Set a selling price in at least one currency (USD, RMB or INR). Values are stored as entered and never converted. The China factory cost is never shown on the public marketplace.', style: TextStyle(fontSize: 12)),
                      ),
                      if (_product?['sourceUpdatePending'] == true)
                        TextButton(
                          onPressed: () async {
                            final id = _s(_product?['id']);
                            if (id.isEmpty) return;
                            await context.read<Session>().repo.ackSourceUpdate(id);
                            if (mounted) setState(() => _product!['sourceUpdatePending'] = false);
                          },
                          child: const Text('Mark quote update as reviewed'),
                        ),
                    ]),
                  ),
                ),
              _section(
                title: 'Basic details',
                initiallyExpanded: true,
                children: [
                  TextField(controller: _title, decoration: const InputDecoration(labelText: 'Title'), textCapitalization: TextCapitalization.sentences),
                  TextField(controller: _summary, decoration: const InputDecoration(labelText: 'Description / summary'), maxLines: 3),
                  const SizedBox(height: 8),
                  _CategoryPicker(
                    categories: _categories,
                    value: _categoryId,
                    extraIds: _extraIds,
                    canCreate: perms.canManageCategories,
                    onChange: (id) => setState(() {
                      _categoryId = id;
                      _extraIds = _extraIds.where((x) => x != id).toList();
                    }),
                    onExtras: (ids) => setState(() => _extraIds = ids),
                    onCreate: (name, parentId) => session.repo.createCategory(name: name, parentId: parentId),
                    onCategories: (rows) => setState(() => _categories = rows),
                    reload: () => session.repo.listCategories(),
                  ),
                  TextField(controller: _tags, decoration: const InputDecoration(labelText: 'Tags (comma separated)')),
                ],
              ),
              _section(title: 'Order & production', initiallyExpanded: true, children: [
                TextField(controller: _moq, decoration: const InputDecoration(labelText: 'MOQ'), keyboardType: TextInputType.number),
                TextField(controller: _unit, decoration: const InputDecoration(labelText: 'Unit')),
                TextField(controller: _lead, decoration: const InputDecoration(labelText: 'Lead time')),
                TextField(controller: _capacity, decoration: const InputDecoration(labelText: 'Supply capacity')),
              ]),
              if (perms.canPriceCatalog)
                _section(title: 'Selling price', initiallyExpanded: true, children: [
                  DropdownButtonFormField<String>(
                    value: _priceMode,
                    decoration: const InputDecoration(labelText: 'Price mode'),
                    items: const [
                      DropdownMenuItem(value: 'GET_QUOTE', child: Text('Get quote')),
                      DropdownMenuItem(value: 'RANGE', child: Text('Price range')),
                      DropdownMenuItem(value: 'TIERS', child: Text('Price tiers')),
                    ],
                    onChanged: (v) => setState(() => _priceMode = v ?? 'GET_QUOTE'),
                  ),
                  DropdownButtonFormField<String>(
                    value: _currencies.contains(_baseCurrency) ? _baseCurrency : 'USD',
                    decoration: const InputDecoration(labelText: 'Currency'),
                    items: [for (final c in _currencies) DropdownMenuItem(value: c, child: Text(c))],
                    onChanged: (v) => setState(() => _baseCurrency = v ?? 'USD'),
                  ),
                  const Padding(
                    padding: EdgeInsets.only(top: 8, bottom: 4),
                    child: Text('Enter USD, RMB and INR separately. Missing currencies stay blank — values are never converted.', style: TextStyle(fontSize: 12)),
                  ),
                  TextField(controller: _priceUsd, decoration: const InputDecoration(labelText: 'Selling price (USD)'), keyboardType: const TextInputType.numberWithOptions(decimal: true)),
                  TextField(controller: _priceCny, decoration: const InputDecoration(labelText: 'Selling price (RMB)'), keyboardType: const TextInputType.numberWithOptions(decimal: true)),
                  TextField(controller: _priceInr, decoration: const InputDecoration(labelText: 'Selling price (INR)'), keyboardType: const TextInputType.numberWithOptions(decimal: true)),
                  if (_priceMode == 'RANGE') ...[
                    TextField(controller: _priceMin, decoration: InputDecoration(labelText: 'Min price ($_baseCurrency)'), keyboardType: TextInputType.number),
                    TextField(controller: _priceMax, decoration: InputDecoration(labelText: 'Max price ($_baseCurrency)'), keyboardType: TextInputType.number),
                  ],
                  if (_priceMode == 'TIERS')
                    for (var i = 0; i < _tiers.length; i++)
                      Column(children: [
                        Row(children: [
                          Expanded(child: _MemField(value: _tiers[i].minQty, decoration: const InputDecoration(labelText: 'Min qty'), keyboardType: TextInputType.number, onChanged: (v) { _tiers[i].minQty = v; })),
                          const SizedBox(width: 8),
                          Expanded(child: _MemField(value: _tiers[i].maxQty, decoration: const InputDecoration(labelText: 'Max qty'), keyboardType: TextInputType.number, onChanged: (v) { _tiers[i].maxQty = v; })),
                        ]),
                        Row(children: [
                          Expanded(child: _MemField(value: _tiers[i].priceUsd, decoration: const InputDecoration(labelText: 'USD'), keyboardType: TextInputType.number, onChanged: (v) {
                            _tiers[i].priceUsd = v;
                            if (i == _tiers.length - 1 && v.isNotEmpty) setState(() => _tiers.add(_Tier()));
                          })),
                          const SizedBox(width: 8),
                          Expanded(child: _MemField(value: _tiers[i].priceCny, decoration: const InputDecoration(labelText: 'RMB'), keyboardType: TextInputType.number, onChanged: (v) { _tiers[i].priceCny = v; })),
                          const SizedBox(width: 8),
                          Expanded(child: _MemField(value: _tiers[i].priceInr, decoration: const InputDecoration(labelText: 'INR'), keyboardType: TextInputType.number, onChanged: (v) { _tiers[i].priceInr = v; })),
                        ]),
                      ]),
                ]),
              if (perms.canPromoteCatalog)
                _section(title: 'Marketplace placement', initiallyExpanded: true, children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Mark as Trending'),
                    subtitle: const Text('Pins this product to the top of Trending. Automatic ranking by views and enquiries still applies after it.'),
                    value: _pinned,
                    onChanged: (v) => setState(() => _pinned = v),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Mark as Clearance'),
                    subtitle: const Text('Shows a Clearance badge and lists the product in the homepage Clearance section until the end date or stock left runs out.'),
                    value: _clearance,
                    onChanged: (v) => setState(() => _clearance = v),
                  ),
                  if (_clearance) ...[
                    TextField(controller: _clearancePrice, decoration: InputDecoration(labelText: 'Clearance price ($_baseCurrency)'), keyboardType: const TextInputType.numberWithOptions(decimal: true)),
                    TextField(controller: _clearanceDiscount, decoration: const InputDecoration(labelText: 'Discount % (optional)'), keyboardType: const TextInputType.numberWithOptions(decimal: true)),
                    TextField(controller: _clearanceEnds, decoration: const InputDecoration(labelText: 'End date (YYYY-MM-DD, optional)', hintText: '2099-12-31')),
                    TextField(controller: _clearanceStock, decoration: const InputDecoration(labelText: 'Stock left (optional)'), keyboardType: TextInputType.number),
                  ],
                ]),
              _section(title: 'Variations (colour, size, capacity)'
, children: [
                const Text('Each variation has options. Add a hex colour (e.g. #1f3a5f) to show a swatch.', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                for (var i = 0; i < _variations.length; i++) _variationCard(i),
              ]),
              _section(title: 'Industry-specific attributes', children: [
                _kvEditor(_industry, 'Attribute (e.g. Material)'),
              ]),
              _section(title: 'Other attributes', children: [
                _kvEditor(_other, 'Attribute (e.g. Origin)'),
                const Padding(padding: EdgeInsets.only(top: 8), child: Text('Legacy key attributes still save if the grouped lists above are empty.', style: TextStyle(fontSize: 12, color: Color(0xFF64748B)))),
                _kvEditor(_legacy, 'Attribute (e.g. Material)'),
              ]),
              _section(title: 'Customization options', children: [
                for (var i = 0; i < _customizations.length; i++)
                  Padding(padding: const EdgeInsets.only(bottom: 8), child: Column(children: [
                    _MemField(value: _customizations[i].label, decoration: const InputDecoration(labelText: 'Option (logo, packaging, graphic)'), onChanged: (v) {
                      _customizations[i].label = v;
                      if (i == _customizations.length - 1 && v.isNotEmpty) setState(() => _customizations.add(_Cust()));
                    }),
                    Row(children: [
                      Expanded(child: _MemField(value: _customizations[i].moq, decoration: const InputDecoration(labelText: 'Min qty'), keyboardType: TextInputType.number, onChanged: (v) { _customizations[i].moq = v; })),
                      const SizedBox(width: 8),
                      Expanded(flex: 2, child: _MemField(value: _customizations[i].note, decoration: const InputDecoration(labelText: 'Note'), onChanged: (v) { _customizations[i].note = v; })),
                    ]),
                  ])),
                TextField(controller: _customization, decoration: const InputDecoration(labelText: 'Customization notes'), maxLines: 3),
              ]),
              _section(title: 'Sample price', children: [
                TextField(controller: _sampleAmount, decoration: const InputDecoration(labelText: 'Sample price'), keyboardType: TextInputType.number),
                DropdownButtonFormField<String>(
                  value: _currencies.contains(_sampleCurrency) ? _sampleCurrency : 'USD',
                  decoration: const InputDecoration(labelText: 'Currency'),
                  items: [for (final c in _currencies) DropdownMenuItem(value: c, child: Text(c))],
                  onChanged: (v) => setState(() => _sampleCurrency = v ?? 'USD'),
                ),
                TextField(controller: _sampleLead, decoration: const InputDecoration(labelText: 'Sample lead time')),
                TextField(controller: _samplePolicy, decoration: const InputDecoration(labelText: 'Sample policy'), maxLines: 3),
              ]),
              _section(title: 'Lead time by quantity', children: [
                for (var i = 0; i < _leadTimes.length; i++)
                  Row(children: [
                    Expanded(child: _MemField(value: _leadTimes[i].minQty, decoration: const InputDecoration(labelText: 'Min qty'), keyboardType: TextInputType.number, onChanged: (v) {
                      _leadTimes[i].minQty = v;
                      if (i == _leadTimes.length - 1 && v.isNotEmpty) setState(() => _leadTimes.add(_Lead()));
                    })),
                    const SizedBox(width: 8),
                    Expanded(child: _MemField(value: _leadTimes[i].maxQty, decoration: const InputDecoration(labelText: 'Max qty'), keyboardType: TextInputType.number, onChanged: (v) { _leadTimes[i].maxQty = v; })),
                    const SizedBox(width: 8),
                    Expanded(child: _MemField(value: _leadTimes[i].time, decoration: const InputDecoration(labelText: 'Time (e.g. 15 days)'), onChanged: (v) { _leadTimes[i].time = v; })),
                  ]),
              ]),
              _section(title: 'Shipping and delivery estimate', children: [
                TextField(controller: _shipOrigin, decoration: const InputDecoration(labelText: 'Ships from (e.g. Ningbo, China)')),
                TextField(controller: _shipEstimate, decoration: const InputDecoration(labelText: 'Typical transit (e.g. 18–25 days by sea to India)')),
                TextField(controller: _shipNote, decoration: const InputDecoration(labelText: 'Shipping note (no live rate is calculated)'), maxLines: 3),
              ]),
              _section(title: 'Packaging & delivery', children: [
                TextField(controller: _sellingUnits, decoration: const InputDecoration(labelText: 'Selling units (e.g. Single item)')),
                TextField(controller: _packageSize, decoration: const InputDecoration(labelText: 'Single package size (e.g. 8 × 8 × 25 cm)')),
                TextField(controller: _grossWeight, decoration: const InputDecoration(labelText: 'Single gross weight (e.g. 0.35 kg)')),
                TextField(controller: _packageType, decoration: const InputDecoration(labelText: 'Package type')),
                TextField(controller: _packaging, decoration: const InputDecoration(labelText: 'Packaging notes'), maxLines: 3),
              ]),
              _section(title: 'Product description', children: [
                TextField(controller: _longDescription, decoration: const InputDecoration(labelText: 'Long product description (shown with product photos)'), maxLines: 6),
              ]),
              _section(title: 'Source Easy protections', children: [
                const Text('Leave blank to use the standard Source Easy guarantees. Do not enter Alibaba Trade Assurance wording.', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                for (var i = 0; i < _protections.length; i++)
                  Column(children: [
                    _MemField(value: _protections[i].title, decoration: const InputDecoration(labelText: 'Title'), onChanged: (v) {
                      _protections[i].title = v;
                      if (i == _protections.length - 1 && v.isNotEmpty) setState(() => _protections.add(_Prot()));
                    }),
                    _MemField(value: _protections[i].text, decoration: const InputDecoration(labelText: 'Details'), onChanged: (v) { _protections[i].text = v; }),
                  ]),
              ]),
              _section(title: 'Reviews note', children: [
                TextField(controller: _reviewsNote, decoration: const InputDecoration(labelText: 'Optional reviews placeholder (leave blank for the default message)')),
              ]),
              if (perms.canLinkCatalogSupplier)
                _section(title: 'Linked supplier', children: [
                  const Text('Company, location, years and verified status are shown on the product page only to paid members, and only if the supplier has consented. Factory cost is never shown.', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                  DropdownButtonFormField<String?>(
                    value: _supplierId,
                    decoration: const InputDecoration(labelText: 'Supplier'),
                    isExpanded: true,
                    items: [
                      const DropdownMenuItem<String?>(value: null, child: Text('No supplier linked')),
                      for (final s in _suppliers)
                        DropdownMenuItem(value: '${s['id']}', child: Text('${s['name'] ?? ''}${s['catalogConsent'] == true ? ' · consented' : ''}${s['publicRegion'] != null && '${s['publicRegion']}'.isNotEmpty ? ' · ${s['publicRegion']}' : ''}')),
                    ],
                    onChanged: (v) => setState(() => _supplierId = v),
                  ),
                  const SizedBox(height: 12),
                  const Text('Add and link a new supplier', style: TextStyle(fontWeight: FontWeight.w600)),
                  TextField(controller: _newSupName, decoration: const InputDecoration(labelText: 'New supplier company')),
                  TextField(controller: _newSupRegion, decoration: const InputDecoration(labelText: 'Public location')),
                  TextField(controller: _newSupYears, decoration: const InputDecoration(labelText: 'Years in business'), keyboardType: TextInputType.number),
                  TextField(controller: _newSupAbout, decoration: const InputDecoration(labelText: 'Public about')),
                  SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Catalog consent'), value: _newSupConsent, onChanged: (v) => setState(() => _newSupConsent = v)),
                  SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Verified'), value: _newSupVerified, onChanged: (v) => setState(() => _newSupVerified = v)),
                  OutlinedButton(onPressed: _addSupplier, child: const Text('Add and link supplier')),
                ]),
              _section(title: 'Photos', initiallyExpanded: true, children: [
                if (_images.isNotEmpty) _photoStrip(existing: true, session: session),
                const Text('JPEG, PNG or WebP, up to 10 MB each, at most 15 photos. They upload when you save. Mark one as the cover.', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                if (_pending.isNotEmpty) _photoStrip(existing: false, session: session),
                const SizedBox(height: 8),
                OutlinedButton.icon(icon: const Icon(Icons.photo_outlined), label: const Text('Add photos'), onPressed: _pickPhotos),
              ]),
              const SizedBox(height: 20),
              FilledButton(onPressed: _busy ? null : () => _save(perms), child: Text(_busy ? 'Saving…' : 'Save')),
              if (perms.canPublishCatalog && (_product?['status'] ?? widget.existing?['status']) != 'PUBLISHED' && (_product?['status'] ?? widget.existing?['status']) != 'DELETED') ...[
                const SizedBox(height: 8),
                FilledButton(onPressed: _busy ? null : () => _save(perms, publish: true), child: Text(_busy ? 'Publishing…' : 'Save and publish')),
              ],
            ]),
    );
  }

  Widget _section({required String title, bool initiallyExpanded = false, required List<Widget> children}) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ExpansionTile(
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        initiallyExpanded: initiallyExpanded,
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: children,
      ),
    );
  }

  Widget _kvEditor(List<_Kv> rows, String keyPh) {
    return Column(children: [
      for (var i = 0; i < rows.length; i++)
        Row(children: [
          Expanded(child: _MemField(value: rows[i].key, decoration: InputDecoration(labelText: keyPh), onChanged: (v) {
            rows[i].key = v;
            if (i == rows.length - 1 && v.isNotEmpty) setState(() => rows.add(_Kv()));
          })),
          const SizedBox(width: 8),
          Expanded(child: _MemField(value: rows[i].value, decoration: const InputDecoration(labelText: 'Value'), onChanged: (v) { rows[i].value = v; })),
        ]),
    ]);
  }

  Widget _variationCard(int i) {
    final v = _variations[i];
    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(children: [
          _MemField(value: v.name, decoration: const InputDecoration(labelText: 'Variation name (e.g. Colour)'), onChanged: (val) {
            v.name = val;
            if (i == _variations.length - 1 && val.isNotEmpty) setState(() => _variations.add(_Var()));
          }),
          for (var k = 0; k < v.options.length; k++)
            Row(children: [
              Expanded(child: _MemField(value: v.options[k].label, decoration: const InputDecoration(labelText: 'Option (e.g. Black)'), onChanged: (val) {
                v.options[k].label = val;
                if (k == v.options.length - 1 && val.isNotEmpty) setState(() => v.options.add(_Opt()));
              })),
              const SizedBox(width: 8),
              SizedBox(width: 100, child: _MemField(value: v.options[k].hex, decoration: const InputDecoration(labelText: '#hex'), onChanged: (val) { v.options[k].hex = val; })),
              if (v.options[k].hex.trim().startsWith('#') && v.options[k].hex.trim().length >= 7)
                Container(width: 20, height: 20, margin: const EdgeInsets.only(left: 6, top: 16), decoration: BoxDecoration(color: _tryColor(v.options[k].hex), shape: BoxShape.circle, border: Border.all(color: Colors.black26))),
            ]),
        ]),
      ),
    );
  }

  Color? _tryColor(String hex) {
    var h = hex.trim().replaceAll('#', '');
    if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
    if (h.length != 6) return null;
    final n = int.tryParse(h, radix: 16);
    if (n == null) return null;
    return Color(0xFF000000 | n);
  }

  Widget _photoStrip({required bool existing, required Session session}) {
    if (existing) {
      return SizedBox(height: 148, child: ListView.separated(
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
                final id = _product?['id'] ?? widget.existing?['id'];
                if (id != null) { await session.repo.deleteProductImage('$id', '${im['id']}'); }
                setState(() => _images.removeAt(i));
              }),
              IconButton(icon: const Icon(Icons.chevron_right, size: 18), onPressed: i == _images.length - 1 ? null : () { setState(() { final x = _images.removeAt(i); _images.insert(i + 1, x); }); }),
            ]),
          ]));
        },
      ));
    }
    return SizedBox(height: 148, child: ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: _pending.length,
      separatorBuilder: (_, __) => const SizedBox(width: 8),
      itemBuilder: (c, i) {
        final im = _pending[i];
        return SizedBox(width: 120, child: Column(children: [
          Expanded(child: Stack(children: [
            Positioned.fill(child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.file(File(im.path), fit: BoxFit.cover))),
            if (im.cover) const Positioned(left: 6, top: 6, child: Chip(label: Text('Cover', style: TextStyle(fontSize: 10)), visualDensity: VisualDensity.compact)),
          ])),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            IconButton(icon: const Icon(Icons.chevron_left, size: 18), onPressed: i == 0 ? null : () { setState(() { final x = _pending.removeAt(i); _pending.insert(i - 1, x); }); }),
            IconButton(icon: const Icon(Icons.star_outline, size: 18), tooltip: 'Set cover', onPressed: () { setState(() { for (final x in _pending) { x.cover = false; } _pending[i].cover = true; }); }),
            IconButton(icon: const Icon(Icons.delete_outline, size: 18), onPressed: () { setState(() => _pending.removeAt(i)); }),
            IconButton(icon: const Icon(Icons.chevron_right, size: 18), onPressed: i == _pending.length - 1 ? null : () { setState(() { final x = _pending.removeAt(i); _pending.insert(i + 1, x); }); }),
          ]),
        ]));
      },
    ));
  }

  Future<void> _pickPhotos() async {
    final files = await ImagePicker().pickMultiImage(maxWidth: 2000, imageQuality: 88);
    if (files.isEmpty) return;
    final room = _photoMax - _images.length - _pending.length;
    final take = files.take(room < 0 ? 0 : room).toList();
    if (take.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Up to 15 photos per product.')));
      return;
    }
    setState(() {
      final startEmpty = _pending.isEmpty && _images.isEmpty;
      _pending.addAll(take.map((f) => _PendingPhoto(f.path)));
      if (startEmpty && _pending.isNotEmpty && !_pending.any((p) => p.cover)) _pending.first.cover = true;
    });
  }
}

class _CategoryPicker extends StatefulWidget {
  const _CategoryPicker({
    required this.categories,
    required this.value,
    required this.extraIds,
    required this.canCreate,
    required this.onChange,
    required this.onExtras,
    required this.onCreate,
    required this.onCategories,
    required this.reload,
  });
  final List<Map<String, dynamic>> categories;
  final String? value;
  final List<String> extraIds;
  final bool canCreate;
  final ValueChanged<String?> onChange;
  final ValueChanged<List<String>> onExtras;
  final Future<Map<String, dynamic>> Function(String name, String? parentId) onCreate;
  final ValueChanged<List<Map<String, dynamic>>> onCategories;
  final Future<List<Map<String, dynamic>>> Function() reload;

  @override
  State<_CategoryPicker> createState() => _CategoryPickerState();
}

class _CategoryPickerState extends State<_CategoryPicker> {
  bool _extraOpen = false;

  String? _pid(Map<String, dynamic> c) {
    final v = c['parentId'] ?? c['parent_id'];
    if (v == null) return null;
    final s = '$v';
    return s.isEmpty || s == 'null' ? null : s;
  }

  List<String> _chain() {
    if (widget.value == null) return [];
    final byId = {for (final c in widget.categories) '${c['id']}': c};
    final start = byId[widget.value];
    if (start == null) return [];
    final chain = <String>['${start['id']}'];
    var parent = _pid(start);
    final seen = {chain.first};
    while (parent != null && byId[parent] != null && !seen.contains(parent)) {
      seen.add(parent);
      chain.insert(0, parent);
      parent = _pid(byId[parent]!);
    }
    return chain;
  }

  List<Map<String, dynamic>> _children(String? parentId) {
    final rows = widget.categories.where((c) => _pid(c) == parentId).toList()
      ..sort((a, b) => _s(a['name']).toLowerCase().compareTo(_s(b['name']).toLowerCase()));
    return rows;
  }

  String _path(Map<String, dynamic> c) {
    final parts = [_s(c['name'])];
    var parent = _pid(c);
    final seen = {'${c['id']}'};
    final byId = {for (final x in widget.categories) '${x['id']}': x};
    while (parent != null && byId[parent] != null && !seen.contains(parent)) {
      seen.add(parent);
      parts.insert(0, _s(byId[parent]!['name']));
      parent = _pid(byId[parent]!);
    }
    return parts.join(' / ');
  }

  Future<void> _newCategory(String? parentId) async {
    final nameCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(parentId == null ? 'New category' : 'New subcategory'),
        content: TextField(controller: nameCtrl, autofocus: true, decoration: const InputDecoration(labelText: 'Category name')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Add')),
        ],
      ),
    );
    final name = nameCtrl.text.trim();
    nameCtrl.dispose();
    if (ok != true || name.isEmpty) return;
    try {
      final created = await widget.onCreate(name, parentId);
      final rows = await widget.reload();
      widget.onCategories(rows);
      widget.onChange('${created['id']}');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final chain = _chain();
    final levels = <({String? parentId, String? selected, List<Map<String, dynamic>> options})>[];
    levels.add((parentId: null, selected: chain.isEmpty ? null : chain[0], options: _children(null)));
    for (var i = 0; i < chain.length; i++) {
      final kids = _children(chain[i]);
      if (kids.isNotEmpty || widget.canCreate) {
        levels.add((parentId: chain[i], selected: i + 1 < chain.length ? chain[i + 1] : null, options: kids));
      }
    }
    const newVal = '__new__';
    final extras = widget.extraIds.map((id) => widget.categories.cast<Map<String, dynamic>?>().firstWhere((c) => '${c?['id']}' == id, orElse: () => null)).whereType<Map<String, dynamic>>().toList();

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Primary category (breadcrumb)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF475569))),
      const SizedBox(height: 4),
      for (final lvl in levels)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: DropdownButtonFormField<String?>(
            value: (lvl.selected != null && lvl.options.any((c) => '${c['id']}' == lvl.selected)) ? lvl.selected : null,
            isExpanded: true,
            decoration: InputDecoration(labelText: lvl.parentId == null ? 'Category' : 'Subcategory'),
            items: [
              DropdownMenuItem<String?>(value: null, child: Text(lvl.parentId == null ? 'Select a category' : 'Select a subcategory')),
              for (final c in lvl.options) DropdownMenuItem(value: '${c['id']}', child: Text(_s(c['name']))),
              if (widget.canCreate) DropdownMenuItem(value: newVal, child: Text(lvl.parentId == null ? '+ New category' : '+ New subcategory')),
            ],
            onChanged: (v) {
              if (v == newVal) {
                _newCategory(lvl.parentId);
                return;
              }
              widget.onChange(v);
            },
          ),
        ),
      const SizedBox(height: 8),
      const Text('Also show in these categories', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF475569))),
      Wrap(spacing: 8, children: [
        for (final c in extras)
          InputChip(
            label: Text(_path(c), style: const TextStyle(fontSize: 12)),
            onDeleted: () => widget.onExtras(widget.extraIds.where((id) => id != '${c['id']}').toList()),
          ),
      ]),
      if (_extraOpen)
        DropdownButtonFormField<String?>(
          value: null,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Add another category'),
          items: [
            const DropdownMenuItem<String?>(value: null, child: Text('Select a category')),
            for (final c in widget.categories.where((c) => '${c['id']}' != widget.value && !widget.extraIds.contains('${c['id']}')))
              DropdownMenuItem(value: '${c['id']}', child: Text(_path(c))),
          ],
          onChanged: (v) {
            if (v == null || v == widget.value || widget.extraIds.contains(v)) return;
            widget.onExtras([...widget.extraIds, v]);
            setState(() => _extraOpen = false);
          },
        )
      else
        TextButton(onPressed: () => setState(() => _extraOpen = true), child: const Text('Add another category')),
    ]);
  }
}


class _MemField extends StatefulWidget {
  const _MemField({required this.value, required this.onChanged, this.decoration, this.keyboardType});
  final String value;
  final ValueChanged<String> onChanged;
  final InputDecoration? decoration;
  final TextInputType? keyboardType;
  @override
  State<_MemField> createState() => _MemFieldState();
}

class _MemFieldState extends State<_MemField> {
  late final TextEditingController _c;
  @override
  void initState() {
    super.initState();
    _c = TextEditingController(text: widget.value);
  }
  @override
  void didUpdateWidget(covariant _MemField old) {
    super.didUpdateWidget(old);
    if (_c.text != widget.value) {
      _c.value = TextEditingValue(text: widget.value, selection: TextSelection.collapsed(offset: widget.value.length));
    }
  }
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _c,
      decoration: widget.decoration,
      keyboardType: widget.keyboardType,
      onChanged: widget.onChanged,
    );
  }
}
