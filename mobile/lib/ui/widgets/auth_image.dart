import 'dart:async';
import 'dart:collection';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

/// Authenticated media cache: in-memory LRU (~60 MB) + on-disk cache (app cache dir), de-duplicated in-flight requests.
/// Images on the server are behind the staff token, so Image.network can't be used — bytes are fetched with the
/// Bearer header through [fetch] and decoded downsized (cacheWidth) for thumbnails to avoid OOM on 10 MB photos.
class MediaCache {
  MediaCache._();
  static final MediaCache I = MediaCache._();
  final LinkedHashMap<String, Uint8List> _mem = LinkedHashMap();
  final _inflight = <String, Future<Uint8List>>{};
  int _size = 0;
  static const _max = 60 * 1024 * 1024;

  Uint8List? peek(String key) {
    final b = _mem.remove(key);
    if (b != null) _mem[key] = b;
    return b;
  }

  void _put(String key, Uint8List b) {
    _mem.remove(key);
    _mem[key] = b;
    _size += b.length;
    while (_size > _max && _mem.length > 1) {
      final k = _mem.keys.first;
      _size -= _mem.remove(k)!.length;
    }
  }

  Future<File?> _file(String key) async {
    try {
      final d = Directory('${(await getTemporaryDirectory()).path}/media');
      if (!d.existsSync()) d.createSync(recursive: true);
      return File('${d.path}/${sha1.convert(key.codeUnits)}');
    } catch (_) {
      return null; // tests / no platform channel
    }
  }

  Future<Uint8List> get(String key, Future<List<int>> Function() fetch) {
    final m = peek(key);
    if (m != null) return Future.value(m);
    return _inflight[key] ??= () async {
      try {
        final f = await _file(key);
        if (f != null && f.existsSync()) {
          final b = await f.readAsBytes();
          if (b.isNotEmpty) { _put(key, b); return b; }
        }
        final b = Uint8List.fromList(await fetch());
        if (b.isEmpty) throw StateError('empty');
        _put(key, b);
        if (f != null) unawaited(f.writeAsBytes(b, flush: false).catchError((_) => f));
        return b;
      } finally {
        _inflight.remove(key);
      }
    }();
  }
}

/// Thumbnail/inline image loaded with auth, with placeholder, error + tap-to-retry.
class AuthImage extends StatefulWidget {
  const AuthImage({super.key, required this.cacheKey, required this.fetch, this.fit = BoxFit.cover, this.thumbWidth = 400, this.fallbackIcon = Icons.image_outlined});
  final String cacheKey;
  final Future<List<int>> Function() fetch;
  final BoxFit fit;
  final int? thumbWidth;
  final IconData fallbackIcon;
  @override
  State<AuthImage> createState() => _AuthImageState();
}

class _AuthImageState extends State<AuthImage> {
  Uint8List? _b;
  bool _err = false;

  @override
  void initState() {
    super.initState();
    _b = MediaCache.I.peek(widget.cacheKey);
    if (_b == null) _load();
  }

  @override
  void didUpdateWidget(AuthImage o) {
    super.didUpdateWidget(o);
    if (o.cacheKey != widget.cacheKey) { _b = MediaCache.I.peek(widget.cacheKey); if (_b == null) _load(); }
  }

  Future<void> _load() async {
    setState(() => _err = false);
    try {
      final b = await MediaCache.I.get(widget.cacheKey, widget.fetch);
      if (mounted) setState(() => _b = b);
    } catch (_) {
      if (mounted) setState(() => _err = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final dpr = MediaQuery.maybeOf(context)?.devicePixelRatio ?? 2;
    if (_b != null) {
      return Image.memory(_b!, fit: widget.fit, gaplessPlayback: true,
          cacheWidth: widget.thumbWidth == null ? null : (widget.thumbWidth! * dpr / 2).round(),
          errorBuilder: (_, _, _) => _box(cs, Icon(Icons.broken_image_outlined, color: cs.error)));
    }
    if (_err) {
      return InkWell(key: const Key('img-retry'), onTap: _load,
          child: _box(cs, Column(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.refresh, color: cs.primary), Text('Retry', style: TextStyle(fontSize: 11, color: cs.primary))])));
    }
    return _box(cs, SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: cs.primary)));
  }

  Widget _box(ColorScheme cs, Widget c) => Container(color: cs.surfaceContainerHighest, alignment: Alignment.center, child: c);
}

/// Full-screen viewer: swipe between photos, pinch/double-tap zoom up to 6x, full-resolution decode.
class GalleryViewer extends StatefulWidget {
  const GalleryViewer({super.key, required this.items, this.initial = 0, this.onShare});
  final List<({String key, String name, Future<List<int>> Function() fetch})> items;
  final int initial;
  final void Function(int index, Uint8List bytes)? onShare;
  @override
  State<GalleryViewer> createState() => _GalleryViewerState();
}

class _GalleryViewerState extends State<GalleryViewer> {
  late final _pc = PageController(initialPage: widget.initial);
  late int _i = widget.initial;
  final _tc = <int, TransformationController>{};
  bool _zoomed = false;

  @override
  void dispose() { _pc.dispose(); for (final c in _tc.values) { c.dispose(); } super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final it = widget.items[_i];
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white,
          title: Text(widget.items.length > 1 ? '${it.name}  ·  ${_i + 1}/${widget.items.length}' : it.name, overflow: TextOverflow.ellipsis),
          actions: [if (widget.onShare != null) IconButton(key: const Key('viewer-share'), icon: const Icon(Icons.share), onPressed: () async {
            final b = MediaCache.I.peek(it.key); if (b != null) widget.onShare!(_i, b);
          })]),
      body: PageView.builder(
        controller: _pc, physics: _zoomed ? const NeverScrollableScrollPhysics() : null,
        itemCount: widget.items.length, onPageChanged: (i) => setState(() { _i = i; _zoomed = false; }),
        itemBuilder: (_, i) {
          final tc = _tc[i] ??= TransformationController();
          final x = widget.items[i];
          return GestureDetector(
            onDoubleTapDown: (d) {
              final z = tc.value.getMaxScaleOnAxis() > 1.01;
              tc.value = z ? Matrix4.identity() : (Matrix4.identity()..translateByDouble(-d.localPosition.dx * 1.5, -d.localPosition.dy * 1.5, 0, 1)..scaleByDouble(2.5, 2.5, 1, 1));
              setState(() => _zoomed = !z);
            },
            onDoubleTap: () {},
            child: InteractiveViewer(
              transformationController: tc, minScale: 1, maxScale: 6,
              onInteractionEnd: (_) => setState(() => _zoomed = tc.value.getMaxScaleOnAxis() > 1.01),
              child: Center(child: AuthImage(cacheKey: x.key, fetch: x.fetch, fit: BoxFit.contain, thumbWidth: null)),
            ),
          );
        },
      ),
    );
  }
}
