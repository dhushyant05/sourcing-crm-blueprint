import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../data/models/models.dart';
import '../../l10n/l10n.dart';
import '../../services/session.dart';

String fileSize(int b) => b < 1024 * 1024 ? '${(b / 1024).ceil()} KB' : '${(b / 1024 / 1024).toStringAsFixed(1)} MB';

/// Photos/documents from the website enquiry. Downloaded with the staff token, kept in memory only.
class LeadAttachments extends StatefulWidget {
  const LeadAttachments({super.key, required this.leadId});
  final String leadId;
  @override
  State<LeadAttachments> createState() => _LeadAttachmentsState();
}

class _LeadAttachmentsState extends State<LeadAttachments> {
  List<LeadAttachment>? _list;
  final _bytes = <String, Uint8List>{};
  bool _failed = false;

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

  Future<void> _open(LeadAttachment a) async {
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
          : a.mime.startsWith('image/') ? Icons.image_outlined : Icons.description_outlined;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final list = _list;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${context.l10n.attachments}${list != null && list.isNotEmpty ? ' · ${list.length}' : ''}', style: t.textTheme.titleMedium),
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
