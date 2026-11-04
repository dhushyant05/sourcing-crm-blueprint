import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../l10n/codes.dart';
import '../../l10n/l10n.dart';
import '../../l10n/web_strings.dart';
import '../../services/session.dart';

/// Profile picture (camera or gallery, uploaded to POST /api/me/avatar), name, role, and change password.
class ProfileTile extends StatefulWidget {
  const ProfileTile({super.key, this.picker});
  final ImagePicker? picker;
  @override
  State<ProfileTile> createState() => _ProfileTileState();
}

class _ProfileTileState extends State<ProfileTile> {
  bool busy = false;

  Future<void> _pick() async {
    final s = context.read<Session>(), m = ScaffoldMessenger.of(context);
    final src = await showModalBottomSheet<Object>(context: context, builder: (c) => SafeArea(child: Wrap(children: [
      ListTile(key: const Key('avatar-camera'), leading: const Icon(Icons.photo_camera_outlined), title: Text(context.l10n.camera), onTap: () => Navigator.pop(c, ImageSource.camera)),
      ListTile(key: const Key('avatar-gallery'), leading: const Icon(Icons.photo_library_outlined), title: Text(context.l10n.gallery), onTap: () => Navigator.pop(c, ImageSource.gallery)),
      if (s.avatarUrl != null) ListTile(key: const Key('avatar-remove'), leading: const Icon(Icons.delete_outline), title: Text(tw(context, 'profile.remove')), onTap: () => Navigator.pop(c, 'remove')),
    ])));
    if (src == null || !mounted) return;
    String? path;
    if (src is ImageSource) {
      final f = await (widget.picker ?? ImagePicker()).pickImage(source: src, maxWidth: 1024, maxHeight: 1024, imageQuality: 85);
      if (f == null || !mounted) return;
      final big = tw(context, 'profile.tooBig');
      if (await f.length() > 5 * 1024 * 1024) { m.showSnackBar(SnackBar(content: Text(big))); return; }
      path = f.path;
    }
    setState(() => busy = true);
    try { await s.setAvatar(path); } catch (e) { m.showSnackBar(SnackBar(content: Text('$e'))); } finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>(), url = s.avatarUrl;
    final full = url == null ? null : (url.startsWith('http') ? url : s.config.serverUrl.replaceAll(RegExp(r'/+$'), '') + url);
    final initials = (s.displayName ?? s.email ?? '?').trim().split(RegExp(r'\s+')).take(2).map((w) => w.isEmpty ? '' : w[0].toUpperCase()).join();
    return Column(children: [
      ListTile(
        leading: GestureDetector(key: const Key('avatar'), onTap: busy ? null : _pick, child: Stack(children: [
          CircleAvatar(radius: 26, backgroundImage: full == null ? null : NetworkImage(full), child: full == null ? Text(initials) : null),
          Positioned(right: 0, bottom: 0, child: CircleAvatar(radius: 9, backgroundColor: Theme.of(context).colorScheme.primary,
              child: busy ? const SizedBox(width: 10, height: 10, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.photo_camera, size: 11, color: Colors.white))),
        ])),
        title: Text(s.displayName ?? ''),
        subtitle: Text('${s.email} · ${codeLabel(context, s.role.code)}'),
        trailing: TextButton(onPressed: busy ? null : _pick, child: Text(tw(context, url == null ? 'profile.upload' : 'profile.change'))),
      ),
      ListTile(key: const Key('change-password'), leading: const Icon(Icons.lock_outline), title: Text(tw(context, 'pw.title')), subtitle: Text(tw(context, 'pw.hint')),
          onTap: () => showDialog(context: context, builder: (_) => const ChangePasswordDialog())),
    ]);
  }
}

class ChangePasswordDialog extends StatefulWidget {
  const ChangePasswordDialog({super.key});
  @override
  State<ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<ChangePasswordDialog> {
  final cur = TextEditingController(), nw = TextEditingController(), cf = TextEditingController();
  String? err;
  bool busy = false;
  Future<void> _submit() async {
    if (nw.text.length < 10) return setState(() => err = tw(context, 'pw.min'));
    if (nw.text != cf.text) return setState(() => err = tw(context, 'pw.mismatch'));
    setState(() { busy = true; err = null; });
    final m = ScaffoldMessenger.of(context), nav = Navigator.of(context), done = tw(context, 'pw.done'), wrong = tw(context, 'pw.wrong');
    try { await context.read<Session>().changePassword(cur.text, nw.text); nav.pop(); m.showSnackBar(SnackBar(content: Text(done))); }
    catch (e) { setState(() => err = '$e'.contains('Current password') ? wrong : '$e'); } finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => AlertDialog(title: Text(tw(context, 'pw.title')), content: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(tw(context, 'pw.hint'), style: Theme.of(context).textTheme.bodySmall),
        TextField(key: const Key('pw-current'), controller: cur, obscureText: true, decoration: InputDecoration(labelText: tw(context, 'pw.current'))),
        TextField(key: const Key('pw-new'), controller: nw, obscureText: true, decoration: InputDecoration(labelText: tw(context, 'pw.new'))),
        TextField(key: const Key('pw-confirm'), controller: cf, obscureText: true, decoration: InputDecoration(labelText: tw(context, 'pw.confirm'))),
        if (err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(err!, key: const Key('pw-error'), style: TextStyle(color: Theme.of(context).colorScheme.error))),
      ]), actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(context.l10n.cancel)),
        FilledButton(key: const Key('pw-submit'), onPressed: busy ? null : _submit, child: Text(tw(context, 'pw.submit'))),
      ]);
}
