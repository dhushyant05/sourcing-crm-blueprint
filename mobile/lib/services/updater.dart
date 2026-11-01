import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

/// Where the website publishes the APK manifest (written by infra/app-servers/publish-apk.sh).
const updateManifestUrl = String.fromEnvironment('UPDATE_URL', defaultValue: 'https://sourceeasy.in/download/version.json');

/// Parsed /download/version.json.
class UpdateInfo {
  UpdateInfo({required this.version, required this.build, required this.apkUrl, this.sha256, this.size, this.minBuild, this.notes = const {}});
  final String version;
  final int build;
  final Uri apkUrl;
  final String? sha256;
  final int? size;
  final int? minBuild;
  /// Release notes by language: {"en": "...", "zh": "..."}.
  final Map<String, String> notes;

  factory UpdateInfo.fromJson(Map<String, dynamic> j, Uri manifest) {
    final n = j['notes'];
    return UpdateInfo(
      version: '${j['version'] ?? '?'}',
      build: (j['build'] as num?)?.toInt() ?? 0,
      apkUrl: manifest.resolve('${j['url'] ?? 'source-easy.apk'}'),
      sha256: (j['sha256'] as String?)?.toLowerCase(),
      size: (j['size'] as num?)?.toInt(),
      minBuild: (j['minBuild'] as num?)?.toInt(),
      notes: n is Map ? {for (final e in n.entries) '${e.key}': '${e.value}'} : n is String ? {'en': n} : const {},
    );
  }

  bool isNewerThan(int installed) => build > installed;
  /// Installed build is below the minimum supported one: the update can't be skipped.
  bool isForcedFor(int installed) => minBuild != null && installed < minBuild!;
  String? notesFor(String lang) => notes[lang.startsWith('zh') ? 'zh' : 'en'] ?? notes['en'] ?? notes['zh'];
}

class UpdateCheckException implements Exception {
  UpdateCheckException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// OTA updater: checks the manifest, downloads with progress, verifies sha256, hands the APK to the installer.
class Updater {
  Updater({http.Client? client, this.manifestUrl = updateManifestUrl, this.throttle = const Duration(hours: 6), Future<int> Function()? installedBuild})
      : _client = client ?? http.Client(),
        _installedBuild = installedBuild ?? (() async => int.tryParse((await PackageInfo.fromPlatform()).buildNumber) ?? 0);
  final http.Client _client;
  final String manifestUrl;
  final Duration throttle;
  final Future<int> Function() _installedBuild;
  static const _ch = MethodChannel('sourceeasy/installer');
  DateTime? _lastCheck;

  Future<int> installedBuild() => _installedBuild();

  /// Automatic check on launch/resume: at most once per [throttle]. Returns null when skipped or up to date.
  Future<UpdateInfo?> maybeCheck({DateTime? now}) async {
    if (!Platform.isAndroid) return null;
    final t = now ?? DateTime.now();
    if (_lastCheck != null && t.difference(_lastCheck!) < throttle) return null;
    _lastCheck = t;
    try {
      return await check();
    } catch (_) {
      return null; // silent on auto-check
    }
  }

  /// Returns the update if newer than the installed build, else null. Throws on network/format errors.
  Future<UpdateInfo?> check() async {
    final u = Uri.parse(manifestUrl);
    final r = await _client.get(u, headers: {'cache-control': 'no-cache'}).timeout(const Duration(seconds: 15));
    if (r.statusCode != 200) throw UpdateCheckException('HTTP ${r.statusCode}');
    final info = UpdateInfo.fromJson(jsonDecode(r.body) as Map<String, dynamic>, u);
    return info.isNewerThan(await installedBuild()) ? info : null;
  }

  /// Streams the APK to app cache (updates/), reporting progress 0..1, and verifies its sha256.
  Future<File> download(UpdateInfo info, {void Function(double? progress)? onProgress, Directory? into}) async {
    final dir = into ?? Directory('${(await getTemporaryDirectory()).path}/updates');
    if (dir.existsSync()) dir.deleteSync(recursive: true);
    dir.createSync(recursive: true);
    final file = File('${dir.path}/source-easy-${info.build}.apk');
    final res = await _client.send(http.Request('GET', info.apkUrl));
    if (res.statusCode != 200) throw UpdateCheckException('HTTP ${res.statusCode}');
    final total = res.contentLength ?? info.size;
    final sink = file.openWrite();
    final digest = AccumulatorSink<Digest>();
    final hasher = sha256.startChunkedConversion(digest);
    var got = 0;
    try {
      await for (final chunk in res.stream) {
        sink.add(chunk);
        hasher.add(chunk);
        got += chunk.length;
        onProgress?.call(total != null && total > 0 ? got / total : null);
      }
    } finally {
      await sink.close();
      hasher.close();
    }
    final hex = digest.events.single.toString();
    if (info.sha256 != null && hex != info.sha256) {
      file.deleteSync();
      throw UpdateCheckException('checksum');
    }
    return file;
  }

  Future<bool> canInstall() async => await _ch.invokeMethod<bool>('canInstall') ?? false;
  Future<void> openInstallSettings() => _ch.invokeMethod('openInstallSettings');
  Future<void> install(File apk) => _ch.invokeMethod('install', {'path': apk.path});
}

/// Minimal sink for chunked hashing (avoids pulling package:convert just for this).
class AccumulatorSink<T> implements Sink<T> {
  final events = <T>[];
  @override
  void add(T event) => events.add(event);
  @override
  void close() {}
}
