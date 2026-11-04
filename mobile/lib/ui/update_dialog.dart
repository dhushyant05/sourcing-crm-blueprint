import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/l10n.dart';
import '../services/updater.dart';

final appUpdater = Updater();

/// Checks for an OTA update on launch and on resume (throttled by [Updater.throttle]).
class UpdateGate extends StatefulWidget {
  const UpdateGate({super.key, required this.child, this.updater});
  final Widget child;
  final Updater? updater;
  @override
  State<UpdateGate> createState() => _UpdateGateState();
}

class _UpdateGateState extends State<UpdateGate> with WidgetsBindingObserver {
  Updater get _u => widget.updater ?? appUpdater;
  bool _showing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _auto());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _auto();
  }

  Future<void> _auto() async {
    if (_showing) return;
    final info = await _u.maybeCheck();
    if (info == null || !mounted || _showing) return;
    _showing = true;
    await showUpdateDialog(context, info, _u);
    _showing = false;
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Settings → "Check for updates".
Future<void> checkForUpdatesManually(BuildContext context, {Updater? updater}) async {
  final u = updater ?? appUpdater;
  final l = context.l10n, m = ScaffoldMessenger.of(context);
  m.showSnackBar(SnackBar(content: Text(l.updateChecking), duration: const Duration(seconds: 2)));
  try {
    final info = await u.check();
    if (!context.mounted) return;
    m.hideCurrentSnackBar();
    if (info == null) {
      m.showSnackBar(SnackBar(content: Text(l.updateNone)));
    } else {
      await showUpdateDialog(context, info, u);
    }
  } catch (_) {
    m.hideCurrentSnackBar();
    m.showSnackBar(SnackBar(content: Text(l.updateCheckFailed)));
  }
}

Future<void> showUpdateDialog(BuildContext context, UpdateInfo info, Updater u) async {
  final forced = info.isForcedFor(await u.installedBuild());
  if (!context.mounted) return;
  await showDialog<void>(
    context: context,
    barrierDismissible: !forced,
    builder: (_) => PopScope(canPop: !forced, child: UpdateDialog(info: info, updater: u, forced: forced)),
  );
}

enum _Stage { ready, downloading, needPermission, installing, failed }

class UpdateDialog extends StatefulWidget {
  const UpdateDialog({super.key, required this.info, required this.updater, required this.forced});
  final UpdateInfo info;
  final Updater updater;
  final bool forced;
  @override
  State<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<UpdateDialog> with WidgetsBindingObserver {
  _Stage _stage = _Stage.ready;
  bool _sentToSettings = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Updater.onInstallFailed((m) => _installError(m));
  }

  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); super.dispose(); }

  /// Back from "Install unknown apps" settings: continue the install automatically.
  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed && _sentToSettings && _stage == _Stage.needPermission && _apk != null) {
      _sentToSettings = false;
      _install();
    }
  }

  Future<void> _openSettings() async {
    _sentToSettings = true;
    try { await widget.updater.openInstallSettings(); } catch (e) { _installError('$e'); }
  }

  void _installError(String m) {
    if (!mounted) return;
    final l = context.l10n;
    _fail(l.updateInstallFailed(m));
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(
      content: Text(l.updateInstallFailed(m)), duration: const Duration(seconds: 10),
      action: SnackBarAction(label: l.updateBrowser, onPressed: () => widget.updater.openInBrowser()),
    ));
  }
  double? _progress;
  File? _apk;
  String? _error;

  Future<void> _start() async {
    final l = context.l10n;
    setState(() { _stage = _Stage.downloading; _progress = 0; _error = null; });
    try {
      _apk ??= await widget.updater.download(widget.info, onProgress: (p) { if (mounted) setState(() => _progress = p); });
      await _install();
    } on UpdateCheckException catch (e) {
      _fail(e.message == 'checksum' || e.message == 'size' ? l.updateChecksumFailed : l.updateDownloadFailed);
    } catch (e) {
      _fail('${l.updateDownloadFailed} ($e)');
    }
  }

  Future<void> _install() async {
    try {
      if (_apk == null || !_apk!.existsSync()) { _apk = null; await _start(); return; }
      if (!await widget.updater.canInstall()) {
        if (mounted) setState(() => _stage = _Stage.needPermission);
        return;
      }
      await widget.updater.install(_apk!);
      if (!mounted) return;
      setState(() => _stage = _Stage.installing); // keep the dialog open so a failure can be shown
    } on PlatformException catch (e) {
      _installError(e.message ?? e.code);
    } on MissingPluginException catch (e) {
      _installError('$e');
    } catch (e) {
      _installError('$e');
    }
  }

  void _fail(String msg) { if (mounted) setState(() { _stage = _Stage.failed; _error = msg; }); }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n, t = Theme.of(context);
    final notes = widget.info.notesFor(Localizations.localeOf(context).languageCode);
    final mb = widget.info.size != null ? ' · ${(widget.info.size! / 1048576).toStringAsFixed(1)} MB' : '';
    return AlertDialog(
      key: const Key('update-dialog'),
      icon: const Icon(Icons.system_update),
      title: Text(widget.forced ? l.updateRequired : l.updateAvailable),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l.updateVersion(widget.info.version, '${widget.info.build}') + mb, style: t.textTheme.titleSmall),
          if (widget.forced) Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.updateRequiredHint, style: TextStyle(color: t.colorScheme.error))),
          if (notes != null && notes.trim().isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(l.updateNotes, style: t.textTheme.labelLarge),
            const SizedBox(height: 4),
            Text(notes),
          ],
          if (_stage == _Stage.downloading) ...[
            const SizedBox(height: 16),
            LinearProgressIndicator(value: _progress),
            const SizedBox(height: 6),
            Text(_progress != null ? l.updateDownloading('${(_progress! * 100).round()}') : l.updateDownloading('…')),
          ],
          if (_stage == _Stage.needPermission) ...[
            const SizedBox(height: 16),
            Text(l.updatePermissionTitle, style: t.textTheme.labelLarge),
            const SizedBox(height: 4),
            Text(l.updatePermissionSteps),
          ],
          if (_stage == _Stage.installing) ...[const SizedBox(height: 16), Text(l.updateInstalling)],
          if (_stage == _Stage.failed && _error != null) ...[const SizedBox(height: 16), Text(_error!, style: TextStyle(color: t.colorScheme.error))],
        ]),
      ),
      actions: [
        if (_stage == _Stage.failed || _stage == _Stage.installing)
          TextButton(onPressed: () => widget.updater.openInBrowser(), child: Text(l.updateBrowser)),
        if (!widget.forced && _stage != _Stage.downloading) TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l.updateLater)),
        if (_stage == _Stage.needPermission) ...[
          TextButton(onPressed: _openSettings, child: Text(l.updateOpenSettings)),
          FilledButton(onPressed: _install, child: Text(l.updateInstall)),
        ] else if (_stage == _Stage.installing)
          FilledButton(onPressed: _install, child: Text(l.updateInstall))
        else
          FilledButton(onPressed: _stage == _Stage.downloading ? null : _start, child: Text(_stage == _Stage.failed ? l.retry : l.updateNow)),
      ],
    );
  }
}
