import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

/// Direct-APK updates for the customer app (separate from the staff app's manifest and APK).
/// The manifest is published by infra at /download/customer/version.json: {version, build, sha256, size?, minBuild?, notes?}.
const customerManifestUrl = String.fromEnvironment('UPDATE_URL', defaultValue: 'https://sourceeasy.in/download/customer/version.json');

class UpdateInfo {
  UpdateInfo({required this.version, required this.build, required this.apkUrl, required this.sha256, this.size, this.minBuild, this.notes});
  final String version;
  final int build;
  final Uri apkUrl;
  final String sha256;
  final int? size, minBuild;
  final String? notes;
  bool isForcedFor(int installed) => minBuild != null && installed < minBuild!;

  /// Strict parsing: the APK must be https on the manifest's own host, and a sha256 is mandatory.
  factory UpdateInfo.fromJson(Map<String, dynamic> j, Uri manifest) {
    final url = manifest.resolve('${j['url'] ?? 'source-easy-customer.apk'}');
    if (url.scheme != 'https' || url.host != manifest.host) throw const UpdateError('bad_url');
    final sha = '${j['sha256'] ?? ''}'.toLowerCase();
    if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(sha)) throw const UpdateError('no_checksum');
    final n = j['notes'];
    return UpdateInfo(version: '${j['version'] ?? '?'}', build: (j['build'] as num?)?.toInt() ?? 0, apkUrl: url, sha256: sha,
        size: (j['size'] as num?)?.toInt(), minBuild: (j['minBuild'] as num?)?.toInt(), notes: n is Map ? '${n['en'] ?? ''}' : n is String ? n : null);
  }
}

class UpdateError implements Exception {
  const UpdateError(this.code);
  final String code;
  @override
  String toString() => switch (code) {
        'checksum' || 'size' => 'The download was damaged. Please try again.',
        'no_permission' => 'Allow installing apps from Source Easy Customer, then try again.',
        _ => 'Could not check for updates. Please try again later.',
      };
}

/// Check → download (progress, size + sha256 verified) → hand to Android's package installer.
/// Android itself refuses an APK not signed with this app's key, so a tampered file cannot replace the app.
class Updater {
  Updater({http.Client? client, this.manifestUrl = customerManifestUrl, this.throttle = const Duration(hours: 6), Future<int> Function()? installedBuild, Future<Directory> Function()? cacheDir})
      : _client = client ?? http.Client(),
        _installed = installedBuild ?? (() async => int.tryParse((await PackageInfo.fromPlatform()).buildNumber) ?? 0),
        _cache = cacheDir ?? getTemporaryDirectory;
  final http.Client _client;
  final String manifestUrl;
  final Duration throttle;
  final Future<int> Function() _installed;
  final Future<Directory> Function() _cache;
  static const _ch = MethodChannel('sourceeasy.customer/installer');
  DateTime? _last;

  Future<int> installedBuild() => _installed();

  Future<UpdateInfo?> maybeCheck({DateTime? now}) async {
    final t = now ?? DateTime.now();
    if (_last != null && t.difference(_last!) < throttle) return null;
    _last = t;
    try { return await check(); } catch (_) { return null; }
  }

  Future<UpdateInfo?> check() async {
    final u = Uri.parse(manifestUrl);
    if (u.scheme != 'https') throw const UpdateError('bad_url');
    final r = await _client.get(u, headers: {'cache-control': 'no-cache'}).timeout(const Duration(seconds: 15));
    if (r.statusCode == 404) return null; // nothing published yet
    if (r.statusCode != 200) throw UpdateError('http_${r.statusCode}');
    final info = UpdateInfo.fromJson(jsonDecode(r.body) as Map<String, dynamic>, u);
    return info.build > await installedBuild() ? info : null;
  }

  Future<File> download(UpdateInfo info, {void Function(double? p)? onProgress}) async {
    final dir = Directory('${(await _cache()).path}/updates');
    if (dir.existsSync()) dir.deleteSync(recursive: true);
    dir.createSync(recursive: true);
    final file = File('${dir.path}/source-easy-customer-${info.build}.apk');
    final res = await _client.send(http.Request('GET', info.apkUrl)).timeout(const Duration(seconds: 30));
    if (res.statusCode != 200) throw UpdateError('http_${res.statusCode}');
    final total = res.contentLength ?? info.size;
    final sink = file.openWrite();
    final out = _DigestSink();
    final hasher = sha256.startChunkedConversion(out);
    var got = 0;
    try {
      await for (final c in res.stream) { sink.add(c); hasher.add(c); got += c.length; onProgress?.call(total != null && total > 0 ? got / total : null); }
    } finally { await sink.close(); hasher.close(); }
    if (info.size != null && got != info.size) { file.deleteSync(); throw const UpdateError('size'); }
    if (out.value.toString() != info.sha256) { file.deleteSync(); throw const UpdateError('checksum'); }
    return file;
  }

  Future<bool> canInstall() async => await _ch.invokeMethod<bool>('canInstall') ?? false;
  Future<void> openInstallSettings() => _ch.invokeMethod('openInstallSettings');
  Future<void> install(File apk) => _ch.invokeMethod('install', {'path': apk.path});
}

class _DigestSink implements Sink<Digest> {
  late Digest value;
  @override
  void add(Digest d) => value = d;
  @override
  void close() {}
}

/// Checks on launch and resume (throttled) and offers the update.
class UpdateGate extends StatefulWidget {
  const UpdateGate({super.key, required this.child, required this.updater});
  final Widget child;
  final Updater? updater;
  @override
  State<UpdateGate> createState() => _UpdateGateState();
}

class _UpdateGateState extends State<UpdateGate> with WidgetsBindingObserver {
  bool _showing = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _auto());
  }

  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); super.dispose(); }
  @override
  void didChangeAppLifecycleState(AppLifecycleState s) { if (s == AppLifecycleState.resumed) _auto(); }

  Future<void> _auto() async {
    final u = widget.updater;
    if (u == null || _showing) return;
    final info = await u.maybeCheck();
    if (info == null || !mounted || _showing) return;
    _showing = true;
    await showUpdateDialog(context, info, u);
    _showing = false;
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

Future<void> showUpdateDialog(BuildContext context, UpdateInfo info, Updater u) async {
  final forced = info.isForcedFor(await u.installedBuild());
  if (!context.mounted) return;
  await showDialog<void>(context: context, barrierDismissible: !forced, builder: (_) => PopScope(canPop: !forced, child: _UpdateDialog(info: info, u: u, forced: forced)));
}

class _UpdateDialog extends StatefulWidget {
  const _UpdateDialog({required this.info, required this.u, required this.forced});
  final UpdateInfo info;
  final Updater u;
  final bool forced;
  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  double? _p;
  bool _busy = false, _needPermission = false;
  String? _err;
  File? _file;

  Future<void> _go() async {
    setState(() { _busy = true; _err = null; _p = null; });
    try {
      _file ??= await widget.u.download(widget.info, onProgress: (p) { if (mounted) setState(() => _p = p); });
      if (!await widget.u.canInstall()) { setState(() { _needPermission = true; _busy = false; }); return; }
      await widget.u.install(_file!);
      if (mounted) setState(() => _busy = false);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _err = e is UpdateError ? e.toString() : 'Could not install the update. Please try again.'; });
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        key: const Key('update-dialog'),
        title: Text(widget.forced ? 'Update required' : 'Update available'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Version ${widget.info.version} is ready.${widget.forced ? ' This version of the app is no longer supported.' : ''}'),
          if (widget.info.notes?.isNotEmpty == true) Padding(padding: const EdgeInsets.only(top: 8), child: Text(widget.info.notes!)),
          if (_busy) Padding(padding: const EdgeInsets.only(top: 12), child: LinearProgressIndicator(value: _p)),
          if (_needPermission) const Padding(padding: EdgeInsets.only(top: 12), child: Text('To finish, allow Source Easy Customer to install apps, then tap Install again.')),
          if (_err != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_err!, style: const TextStyle(color: Colors.red))),
        ]),
        actions: [
          if (!widget.forced && !_busy) TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Later')),
          if (_needPermission) TextButton(onPressed: () { widget.u.openInstallSettings(); setState(() => _needPermission = false); }, child: const Text('Open settings')),
          FilledButton(key: const Key('update-install'), onPressed: _busy ? null : _go, child: Text(_file == null ? 'Update' : 'Install')),
        ],
      );
}
