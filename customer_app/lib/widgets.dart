import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'api.dart';
import 'format.dart';

const brand = Color(0xFF0E7490), accent = Color(0xFFEA580C);

void toast(BuildContext c, String msg) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(msg)));

/// Opens an authenticated PDF: downloads it with the token, checks it is a real PDF, and hands it to the
/// system "open with / share" sheet from app-private storage. No public link is ever created.
Future<void> openPdf(BuildContext context, PortalApi api, String path, String name) async {
  try {
    final b = await api.bytes(path);
    if (b.length < 5 || String.fromCharCodes(b.take(5)) != '%PDF-') throw PortalError('The server did not return a PDF', 500);
    final dir = Directory('${(await getTemporaryDirectory()).path}/pdf')..createSync(recursive: true);
    final f = File('${dir.path}/${safeName(name)}.pdf');
    await f.writeAsBytes(b, flush: true);
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: 'application/pdf')]));
  } catch (e) {
    if (context.mounted) toast(context, e is PortalError ? e.message : 'Could not open the PDF');
  }
}

/// File name safe for the app cache (no path parts, never empty or dots only).
String safeName(String n) { final s = n.replaceAll(RegExp(r'[^\w.-]'), '_').replaceAll(RegExp(r'^\.+'), ''); return s.isEmpty ? 'file' : (s.length > 100 ? s.substring(s.length - 100) : s); }

Future<void> openFile(BuildContext context, PortalApi api, String path, String name, String mime) async {
  try {
    final b = await api.bytes(path);
    final dir = Directory('${(await getTemporaryDirectory()).path}/files')..createSync(recursive: true);
    final f = File('${dir.path}/${safeName(name)}');
    await f.writeAsBytes(b, flush: true);
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: mime)]));
  } catch (e) {
    if (context.mounted) toast(context, 'Could not open the file');
  }
}

/// Photo / video picker with the server's limits (5 files, photos ≤ 10 MB, videos ≤ 100 MB).
class MediaPicker extends StatefulWidget {
  const MediaPicker({super.key, required this.files, required this.onChanged});
  final List<UploadFile> files;
  final ValueChanged<List<UploadFile>> onChanged;
  @override
  State<MediaPicker> createState() => _MediaPickerState();
}

class _MediaPickerState extends State<MediaPicker> {
  final _p = ImagePicker();
  Future<void> _add(Future<List<XFile>> Function() pick) async {
    try {
      final picked = await pick();
      final list = [...widget.files];
      for (final x in picked) {
        final f = UploadFile(x.path, x.name, await x.length());
        final p = f.problem;
        if (p != null) { if (mounted) toast(context, p); continue; }
        if (list.length >= UploadFile.maxFiles) { if (mounted) toast(context, 'Up to ${UploadFile.maxFiles} files'); break; }
        list.add(f);
      }
      widget.onChanged(list);
    } catch (_) {
      if (mounted) toast(context, 'Could not open the camera or gallery');
    }
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 8, runSpacing: 8, children: [
          OutlinedButton.icon(onPressed: () => _add(() async { final x = await _p.pickImage(source: ImageSource.camera, imageQuality: 85); return [if (x != null) x]; }),
              icon: const Icon(Icons.photo_camera_outlined), label: const Text('Camera')),
          OutlinedButton.icon(onPressed: () => _add(() => _p.pickMultipleMedia()), icon: const Icon(Icons.photo_library_outlined), label: const Text('Photos / videos')),
        ]),
        for (final f in widget.files)
          ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: Icon(f.isVideo ? Icons.videocam_outlined : Icons.image_outlined), title: Text(f.name, overflow: TextOverflow.ellipsis),
              subtitle: Text('${(f.size / 1024 / 1024).toStringAsFixed(1)} MB'),
              trailing: IconButton(tooltip: 'Remove', icon: const Icon(Icons.close), onPressed: () => widget.onChanged([...widget.files]..remove(f)))),
      ]);
}

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.color = brand});
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)), child: Text(text, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w600)));
}

class ErrorRetry extends StatelessWidget {
  const ErrorRetry(this.message, this.retry, {super.key});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(message, textAlign: TextAlign.center), const SizedBox(height: 12), FilledButton(onPressed: retry, child: const Text('Try again'))])));
}

/// Customer-safe timeline (text comes from the server's customer allowlist).
class Timeline extends StatelessWidget {
  const Timeline(this.items, {super.key});
  final List items;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final t in items.reversed)
          Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Padding(padding: EdgeInsets.only(top: 5, right: 8), child: Icon(Icons.circle, size: 8, color: brand)),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${t['text']}'), Text(when(t['at']), style: const TextStyle(fontSize: 12, color: Colors.black54))])),
          ])),
      ]);
}

