import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Saves bytes into the phone's Downloads folder (MediaStore on Android 10+, no storage permission) and opens it.
/// Falls back to the share sheet when the platform channel is unavailable.
class Downloads {
  static const _ch = MethodChannel('sourceeasy/installer');

  static Future<String> save(List<int> bytes, String name, {String mime = 'application/pdf', bool open = true}) async {
    if (bytes.length < 5 || (mime == 'application/pdf' && String.fromCharCodes(bytes.take(5)) != '%PDF-')) {
      throw const FormatException('The server did not return a valid PDF');
    }
    final dir = Directory('${(await getTemporaryDirectory()).path}/shared')..createSync(recursive: true);
    final f = File('${dir.path}/$name');
    await f.writeAsBytes(bytes, flush: true);
    try {
      final uri = await _ch.invokeMethod<String>('saveDownload', {'path': f.path, 'name': name, 'mime': mime});
      if (open && uri != null) await _ch.invokeMethod('openFile', {'uri': uri, 'mime': mime});
      return 'Downloads/$name';
    } on MissingPluginException {
      await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: mime, name: name)], fileNameOverrides: [name]));
      return f.path;
    }
  }

  static Future<void> shareFile(List<int> bytes, String name, {String mime = 'application/pdf'}) async {
    final dir = Directory('${(await getTemporaryDirectory()).path}/shared')..createSync(recursive: true);
    final f = File('${dir.path}/$name');
    await f.writeAsBytes(bytes, flush: true);
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: mime, name: name)], fileNameOverrides: [name]));
  }
}
