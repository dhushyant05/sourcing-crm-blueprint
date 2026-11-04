import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../l10n/l10n.dart';

const maxVideoBytes = 100 * 1024 * 1024;
const maxFileBytes = 10 * 1024 * 1024;
final _videoExt = RegExp(r'\.(mp4|m4v|mov|3gp|webm|mkv)$', caseSensitive: false);
bool isVideoPath(String p) => _videoExt.hasMatch(p);

/// Picks product photos/videos (gallery, camera, video camera). Returns paths that pass the size limits;
/// shows a snackbar for files that are too big.
Future<List<String>> pickMedia(BuildContext context) async {
  final l = context.l10n;
  final src = await showModalBottomSheet<String>(
    context: context,
    builder: (c) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(l.addPhotos), onTap: () => Navigator.pop(c, 'gallery')),
        ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(l.takePhoto), onTap: () => Navigator.pop(c, 'photo')),
        ListTile(leading: const Icon(Icons.videocam_outlined), title: Text(l.recordVideo), onTap: () => Navigator.pop(c, 'video')),
      ]),
    ),
  );
  if (src == null) return [];
  final picker = ImagePicker();
  final List<XFile> files = switch (src) {
    'gallery' => await picker.pickMultipleMedia(),
    'photo' => [?await picker.pickImage(source: ImageSource.camera)],
    _ => [?await picker.pickVideo(source: ImageSource.camera, maxDuration: const Duration(minutes: 3))],
  };
  final ok = <String>[];
  for (final f in files) {
    final size = await File(f.path).length();
    if (size > (isVideoPath(f.path) ? maxVideoBytes : maxFileBytes)) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.fileTooBig(f.name))));
      continue;
    }
    ok.add(f.path);
  }
  return ok;
}

/// Chips for files chosen but not uploaded yet.
class PendingMedia extends StatelessWidget {
  const PendingMedia({super.key, required this.paths, required this.onRemove});
  final List<String> paths;
  final void Function(String) onRemove;
  @override
  Widget build(BuildContext context) => Wrap(spacing: 6, runSpacing: 6, children: [
        for (final p in paths)
          InputChip(
            avatar: Icon(isVideoPath(p) ? Icons.movie_outlined : Icons.image_outlined, size: 18),
            label: Text(p.split('/').last, overflow: TextOverflow.ellipsis),
            onDeleted: () => onRemove(p),
          ),
      ]);
}
