import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../../data/models/models.dart';
import '../../l10n/l10n.dart';
import '../../services/session.dart';
import 'media_picker.dart';

String fileSize(int b) => b < 1024 * 1024 ? '${(b / 1024).ceil()} KB' : '${(b / 1024 / 1024).toStringAsFixed(1)} MB';

/// Photos/documents from the website enquiry. Downloaded with the staff token, kept in memory only.
class LeadAttachments extends StatefulWidget {
  const LeadAttachments({super.key, required this.leadId, this.canEdit = false});
  final String leadId;
  final bool canEdit;
  @override
  State<LeadAttachments> createState() => _LeadAttachmentsState();
}

class _LeadAttachmentsState extends State<LeadAttachments> {
  List<LeadAttachment>? _list;
  final _bytes = <String, Uint8List>{};
  bool _failed = false, _uploading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final repo = context.read<Session>().repo;
    try {
      final list = await repo.attachments(widget.leadId);
      if (!mounted) return;
      setState(() => _list = list);
      for (final a in list.where((a) => a.isImage)) {
        final b = Uint8List.fromList(await repo.attachmentBytes(widget.leadId, a));
        if (mounted) setState(() => _bytes[a.id] = b);
      }
    } catch (_) {
      if (mounted) setState(() { _list ??= []; _failed = true; });
    }
  }

  Future<Uint8List> _get(LeadAttachment a) async =>
      _bytes[a.id] ??= Uint8List.fromList(await context.read<Session>().repo.attachmentBytes(widget.leadId, a));

  Future<void> _add() async {
    final paths = await pickMedia(context);
    if (paths.isEmpty || !mounted) return;
    final m = ScaffoldMessenger.of(context);
    final l = context.l10n;
    setState(() => _uploading = true);
    try {
      final up = await context.read<Session>().repo.uploadAttachments(widget.leadId, paths);
      m.showSnackBar(SnackBar(content: Text(l.uploadedFiles(up.length))));
      await _load();
    } catch (e) {
      m.showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _delete(LeadAttachment a) async {
    final l = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(l.deleteFileQ(a.name)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: Text(l.delete)),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await context.read<Session>().repo.deleteAttachment(widget.leadId, a.id);
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _open(LeadAttachment a) async {
    if (a.isVideo) {
      final s = context.read<Session>().repo.attachmentStream(widget.leadId, a);
      await Navigator.push(context, MaterialPageRoute(builder: (_) => _VideoViewer(a: a, uri: s.uri, headers: s.headers)));
      return;
    }
    final b = await _get(a);
    if (!mounted) return;
    if (a.isImage) {
      await Navigator.push(context, MaterialPageRoute(builder: (_) => _ImageViewer(a: a, bytes: b, onShare: () => _share(a, b))));
    } else {
      await _share(a, b);
    }
  }

  Future<void> _share(LeadAttachment a, Uint8List b) =>
      SharePlus.instance.share(ShareParams(files: [XFile.fromData(b, mimeType: a.mime, name: a.name)], fileNameOverrides: [a.name]));

  IconData _icon(LeadAttachment a) => a.mime.contains('pdf')
      ? Icons.picture_as_pdf_outlined
      : a.mime.contains('sheet') || a.mime.contains('excel')
          ? Icons.table_chart_outlined
          : a.isVideo ? Icons.play_circle_outline : a.mime.startsWith('image/') ? Icons.image_outlined : Icons.description_outlined;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final list = _list;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text('${context.l10n.mediaTitle}${list != null && list.isNotEmpty ? ' · ${list.length}' : ''}', style: t.textTheme.titleMedium)),
        if (widget.canEdit)
          TextButton.icon(
            key: const Key('add-media'),
            onPressed: _uploading ? null : _add,
            icon: _uploading ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add_a_photo_outlined),
            label: Text(context.l10n.addPhotos),
          ),
      ]),
      const SizedBox(height: 8),
      if (list == null) const LinearProgressIndicator()
      else if (list.isEmpty) Padding(padding: const EdgeInsets.all(8), child: Text(_failed ? '—' : context.l10n.noAttachments))
      else GridView.count(
          crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 1.15,
          children: [
            for (final a in list)
              Card(
                margin: EdgeInsets.zero, clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => _open(a),
                  onLongPress: widget.canEdit ? () => _delete(a) : null,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Expanded(
                      child: _bytes[a.id] != null && a.isImage
                          ? Image.memory(_bytes[a.id]!, fit: BoxFit.cover)
                          : Container(color: t.colorScheme.surfaceContainerHighest, child: Icon(_icon(a), size: 40, color: t.colorScheme.primary)),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: t.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600)),
                        Text(fileSize(a.size), style: t.textTheme.labelSmall),
                      ]),
                    ),
                  ]),
                ),
              ),
          ],
        ),
    ]);
  }
}

class _ImageViewer extends StatelessWidget {
  const _ImageViewer({required this.a, required this.bytes, required this.onShare});
  final LeadAttachment a;
  final Uint8List bytes;
  final VoidCallback onShare;
  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text(a.name),
            actions: [IconButton(tooltip: context.l10n.openFile, icon: const Icon(Icons.share), onPressed: onShare)]),
        body: InteractiveViewer(child: Center(child: Image.memory(bytes))),
      );
}

class _VideoViewer extends StatefulWidget {
  const _VideoViewer({required this.a, required this.uri, required this.headers});
  final LeadAttachment a;
  final Uri uri;
  final Map<String, String> headers;
  @override
  State<_VideoViewer> createState() => _VideoViewerState();
}

class _VideoViewerState extends State<_VideoViewer> {
  late final VideoPlayerController _c = VideoPlayerController.networkUrl(widget.uri, httpHeaders: widget.headers);
  Object? _err;

  @override
  void initState() {
    super.initState();
    _c.initialize().then((_) {
      if (mounted) setState(() {});
      _c.play();
    }, onError: (e) {
      if (mounted) setState(() => _err = e);
    });
    _c.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text(widget.a.name)),
        body: Center(
          child: _err != null
              ? Text('$_err', style: const TextStyle(color: Colors.white))
              : !_c.value.isInitialized
                  ? const CircularProgressIndicator()
                  : Column(mainAxisSize: MainAxisSize.min, children: [
                      Flexible(child: AspectRatio(aspectRatio: _c.value.aspectRatio, child: VideoPlayer(_c))),
                      VideoProgressIndicator(_c, allowScrubbing: true),
                      IconButton(
                        tooltip: context.l10n.playVideo,
                        iconSize: 48,
                        color: Colors.white,
                        icon: Icon(_c.value.isPlaying ? Icons.pause_circle : Icons.play_circle),
                        onPressed: () => _c.value.isPlaying ? _c.pause() : _c.play(),
                      ),
                    ]),
        ),
      );
}
