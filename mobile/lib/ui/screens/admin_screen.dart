import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../data/repository.dart';
import '../../l10n/web_strings.dart';
import '../../services/downloads.dart';
import '../../services/session.dart';

/// Admin tools with web parity: Team (staff + per-user permissions), Suppliers, SLA hours + report, exports, backups.
/// Every action is also enforced by the server; the UI only hides what the signed-in user may not do.
String _err(Object e) => '$e'.replaceFirst(RegExp(r'^(Exception|ApiException)[^:]*:\s*'), '');
void _snack(BuildContext c, String m) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(m)));

const _roles = ['INDIA_STAFF', 'INDIA_ADMIN', 'CHINA_STAFF', 'CHINA_ADMIN', 'SUPER_ADMIN', 'MARKETPLACE_TEAM'];
List<String> _allowedRoles(String me) => me == 'SUPER_ADMIN' ? _roles : me == 'INDIA_ADMIN' ? ['INDIA_STAFF', 'INDIA_ADMIN'] : ['CHINA_STAFF', 'CHINA_ADMIN'];

class AdminSection extends StatelessWidget {
  const AdminSection({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>(), p = s.perms, sa = p.isSuperAdmin;
    Widget tile(Key k, IconData i, String t, Widget page) => ListTile(key: k, leading: Icon(i), title: Text(t), trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => page)));
    return Column(mainAxisSize: MainAxisSize.min, children: [
      if (p.canManageUsers) tile(const Key('more-team'), Icons.badge_outlined, tw(context, 'team.title'), const TeamScreen()),
      if (p.canSeeSupplierDetails) tile(const Key('more-suppliers'), Icons.factory_outlined, tw(context, 'suppliers.title'), const SuppliersScreen()),
      if (p.canViewReports || (sa && p.can('settings.sla'))) tile(const Key('more-sla'), Icons.timer_outlined, '${tw(context, 'sla.widget')} · ${tw(context, 'sla.settings')}', const SlaScreen()),
      if (p.can('data.export')) tile(const Key('more-export'), Icons.file_download_outlined, tw(context, 'perm.export'), const ExportScreen()),
      if (p.canDownloadBackups) tile(const Key('more-backups'), Icons.backup_outlined, tw(context, 'settings.backups'), const BackupsScreen()),
    ]);
  }
}

// ---------------- Team ----------------
class TeamScreen extends StatefulWidget {
  const TeamScreen({super.key});
  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  List<Map<String, dynamic>>? _u;
  String? _e;
  SourceEasyRepository get _r => context.read<Session>().repo;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final u = await _r.users(); if (mounted) setState(() { _u = u; _e = null; }); } catch (e) { if (mounted) setState(() => _e = _err(e)); }
  }
  Future<void> _do(Future<void> Function() f, String ok) async {
    try { await f(); if (mounted) _snack(context, tw(context, ok)); await _load(); } catch (e) { if (mounted) _snack(context, _err(e)); }
  }

  Future<void> _edit([Map<String, dynamic>? u]) async {
    final s = context.read<Session>(), me = s.role.code, sa = me == 'SUPER_ADMIN';
    final self = u != null && u['email'] == s.email;
    final allowed = _allowedRoles(me);
    final name = TextEditingController(text: u?['name'] ?? ''), email = TextEditingController(text: u?['email'] ?? ''), pw = TextEditingController();
    String role = u?['role'] ?? allowed.first;
    bool active = u?['active'] != false;
    String? err;
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, showDragHandle: true, builder: (c) => StatefulBuilder(builder: (c, set) => Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(c).viewInsets.bottom + 16),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(u == null ? tw(context, 'team.add') : tw(context, 'team.editTitle', {'name': u['name']}), style: Theme.of(c).textTheme.titleLarge), const SizedBox(height: 12),
        TextField(key: const Key('staff-name'), controller: name, decoration: InputDecoration(labelText: tw(context, 'common.name'), border: const OutlineInputBorder())), const SizedBox(height: 10),
        TextField(key: const Key('staff-email'), controller: email, enabled: u == null || sa, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: tw(context, 'common.email'), border: const OutlineInputBorder())), const SizedBox(height: 10),
        DropdownButtonFormField<String>(key: const Key('staff-role'), initialValue: role, decoration: InputDecoration(labelText: tw(context, 'common.role'), border: const OutlineInputBorder()),
            items: [for (final r in {role, ...allowed}) DropdownMenuItem(value: r, child: Text(tw(context, 'role.$r')))], onChanged: self ? null : (v) => set(() => role = v ?? role)),
        if (u != null) SwitchListTile(key: const Key('staff-active'), contentPadding: EdgeInsets.zero, value: active, onChanged: self ? null : (v) => set(() => active = v), title: Text(tw(context, 'team.active'))),
        const SizedBox(height: 10),
        TextField(key: const Key('staff-pw'), controller: pw, obscureText: true, decoration: InputDecoration(labelText: u == null ? tw(context, 'team.initialPassword') : tw(context, 'team.passwordOptional'), border: const OutlineInputBorder())),
        if (u != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(tw(context, 'team.sessionsNote'), style: Theme.of(c).textTheme.bodySmall)),
        if (err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(err!, style: TextStyle(color: Theme.of(c).colorScheme.error))),
        const SizedBox(height: 12),
        FilledButton(key: const Key('staff-save'), onPressed: () async {
          final p = pw.text;
          if ((u == null || p.isNotEmpty) && p.length < 10) return set(() => err = tw(context, 'team.pwShort'));
          if (name.text.trim().isEmpty || email.text.trim().isEmpty) return set(() => err = tw(context, 'suppliers.nameRequired'));
          try {
            if (u == null) {
              await _r.createUser({'name': name.text.trim(), 'email': email.text.trim(), 'role': role, 'password': p});
            } else {
              final patch = <String, dynamic>{
                if (name.text.trim() != u['name']) 'name': name.text.trim(),
                if (sa && email.text.trim().toLowerCase() != u['email']) 'email': email.text.trim(),
                if (!self && role != u['role']) 'role': role,
                if (!self && active != (u['active'] != false)) 'active': active,
              };
              if (patch.isNotEmpty) await _r.updateUser(u['id'], patch);
              if (p.isNotEmpty) await _r.resetPassword(u['id'], p);
            }
            if (c.mounted) Navigator.pop(c, true);
          } catch (e) { set(() => err = _err(e)); }
        }, child: Text(u == null ? tw(context, 'team.create') : tw(context, 'common.save'))),
      ])))));
    if (ok == true && mounted) { _snack(context, tw(context, u == null ? 'team.created' : 'team.saved')); await _load(); }
  }

  Future<void> _remove(Map<String, dynamic> u) async {
    final ok = await showDialog<bool>(context: context, builder: (d) => AlertDialog(title: Text(tw(context, 'team.removeTitle', {'name': u['name']})),
        content: Text(tw(context, 'team.removeBody')), actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tw(context, 'common.cancel'))),
          FilledButton(key: const Key('remove-confirm'), style: FilledButton.styleFrom(backgroundColor: Colors.red), onPressed: () => Navigator.pop(d, true), child: Text(tw(context, 'team.removeConfirm')))]));
    if (ok == true) await _do(() => _r.deleteUser(u['id']), 'team.removed');
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>(), sa = s.perms.isSuperAdmin, t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(tw(context, 'team.title'))),
      floatingActionButton: FloatingActionButton.extended(key: const Key('staff-add'), onPressed: () => _edit(), icon: const Icon(Icons.person_add_alt), label: Text(tw(context, 'team.add'))),
      body: RefreshIndicator(onRefresh: _load, child: _e != null ? ListView(children: [ListTile(title: Text(tw(context, 'team.loadFail')), subtitle: Text(_e!))])
          : _u == null ? const Center(child: CircularProgressIndicator()) : ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 96), children: [
        for (final u in _u!) Card(key: Key('staff-${u['email']}'), child: ListTile(
          leading: CircleAvatar(child: Text(((u['name'] as String?) ?? '?').trim().isEmpty ? '?' : (u['name'] as String).trim()[0].toUpperCase())),
          title: Text('${u['name']}${u['email'] == s.email ? ' · ${tw(context, 'team.you')}' : ''}'),
          subtitle: Text('${u['email']}\n${tw(context, 'role.${u['role']}')}${u['active'] == false ? ' · ${tw(context, 'team.disable')}d' : ''}'), isThreeLine: true,
          trailing: PopupMenuButton<String>(key: Key('staff-menu-${u['email']}'), onSelected: (v) async {
            switch (v) {
              case 'edit': await _edit(u);
              case 'perm': await Navigator.push(context, MaterialPageRoute(builder: (_) => UserPermissionsScreen(user: u)));
              case 'active': await _do(() => _r.updateUser(u['id'], {'active': u['active'] == false}), 'team.saved');
              case 'remove': await _remove(u);
            }
          }, itemBuilder: (_) => [
            PopupMenuItem(value: 'edit', child: Text(tw(context, 'team.edit'))),
            if (u['role'] != 'SUPER_ADMIN') PopupMenuItem(value: 'perm', child: Text(tw(context, 'perm.title'))),
            if (u['email'] != s.email) PopupMenuItem(value: 'active', child: Text(tw(context, u['active'] == false ? 'team.enable' : 'team.disable'))),
            if (sa && u['email'] != s.email) PopupMenuItem(value: 'remove', child: Text(tw(context, 'team.remove'), style: TextStyle(color: t.colorScheme.error))),
          ]),
        )),
      ])),
    );
  }
}

/// Per-user permission checklist (super admin edits; admins read-only). Locked = other office's data, never grantable.
class UserPermissionsScreen extends StatefulWidget {
  const UserPermissionsScreen({super.key, required this.user});
  final Map<String, dynamic> user;
  @override
  State<UserPermissionsScreen> createState() => _UserPermissionsScreenState();
}

class _UserPermissionsScreenState extends State<UserPermissionsScreen> {
  Map<String, dynamic>? _m;
  bool _busy = false;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final m = await context.read<Session>().repo.userPermissions(widget.user['id']); if (mounted) setState(() => _m = m); } catch (e) { if (mounted) _snack(context, _err(e)); }
  }
  Future<void> _set(Map<String, bool?> ch) async {
    setState(() => _busy = true);
    try { await context.read<Session>().repo.setUserPermissions(widget.user['id'], ch); await _load(); } catch (e) { if (mounted) _snack(context, _err(e)); } finally { if (mounted) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final sa = context.watch<Session>().perms.isSuperAdmin, t = Theme.of(context);
    final rows = ((_m?['permissions'] as List?) ?? const []).cast<Map>();
    final groups = {for (final r in rows) r['group'] as String}.toList();
    final over = rows.where((r) => r['override'] != null).toList();
    final audit = ((_m?['audit'] as List?) ?? const []).cast<Map>();
    return Scaffold(
      appBar: AppBar(title: Text(tw(context, 'perm.title')), actions: [
        if (sa && over.isNotEmpty) TextButton.icon(key: const Key('perm-reset'), onPressed: _busy ? null : () => _set({for (final r in over) r['key'] as String: null}), icon: const Icon(Icons.restart_alt), label: Text(tw(context, 'perm.reset'))),
      ]),
      body: _m == null ? const Center(child: CircularProgressIndicator()) : ListView(children: [
        ListTile(title: Text('${widget.user['name']} · ${tw(context, 'role.${widget.user['role']}')}'), subtitle: Text(sa ? tw(context, 'perm.hint') : tw(context, 'perm.readOnly'))),
        for (final g in groups) ...[
          Container(color: t.colorScheme.surfaceContainerHighest, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6), child: Text(tw(context, 'perm.group.$g').toUpperCase(), style: t.textTheme.labelSmall)),
          for (final r in rows.where((r) => r['group'] == g))
            r['locked'] == true
                ? ListTile(key: Key('perm-${r['key']}-locked'), dense: true, leading: const Icon(Icons.lock_outline, size: 18), title: Text(tw(context, 'perm.k.${r['key']}')), subtitle: Text(tw(context, 'perm.locked')))
                : CheckboxListTile(key: Key('perm-${r['key']}'), dense: true, value: r['effective'] == true,
                    title: Row(children: [Flexible(child: Text(tw(context, 'perm.k.${r['key']}'))), if (r['override'] != null) const Padding(padding: EdgeInsets.only(left: 6), child: CircleAvatar(radius: 4, backgroundColor: Colors.amber))]),
                    subtitle: Text(r['key'] as String, style: const TextStyle(fontFamily: 'monospace', fontSize: 10)),
                    onChanged: !sa || _busy ? null : (v) => _set({r['key'] as String: v ?? false})),
        ],
        if (audit.isNotEmpty) ...[
          Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text(tw(context, 'perm.audit'), style: t.textTheme.titleSmall)),
          for (final a in audit.take(12)) ListTile(dense: true, title: Text('${a['changedByName'] ?? '—'}: ${tw(context, 'perm.k.${a['perm']}')}'),
              subtitle: Text('${'${a['changedAt']}'.replaceFirst('T', ' ').substring(0, 16)} · ${_pv(context, a['before'])} → ${_pv(context, a['after'])}')),
        ],
        const SizedBox(height: 24),
      ]),
    );
  }
  String _pv(BuildContext c, Object? v) => v == null ? tw(c, 'perm.default') : v == true ? tw(c, 'perm.on') : tw(c, 'perm.off');
}

// ---------------- Suppliers ----------------
class SuppliersScreen extends StatefulWidget {
  const SuppliersScreen({super.key});
  @override
  State<SuppliersScreen> createState() => _SuppliersScreenState();
}

class _SuppliersScreenState extends State<SuppliersScreen> {
  List<Map<String, dynamic>>? _s;
  String _q = '';
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final s = await context.read<Session>().repo.supplierList(); if (mounted) setState(() => _s = s); } catch (e) { if (mounted) _snack(context, _err(e)); }
  }
  @override
  Widget build(BuildContext context) {
    final canEdit = context.watch<Session>().perms.can('suppliers.edit');
    final q = _q.toLowerCase();
    final list = (_s ?? []).where((s) => q.isEmpty || ['name', 'contact', 'city', 'phone', 'wechat'].any((k) => '${s[k] ?? ''}'.toLowerCase().contains(q))).toList();
    return Scaffold(
      appBar: AppBar(title: Text(tw(context, 'suppliers.title'))),
      floatingActionButton: canEdit ? FloatingActionButton.extended(key: const Key('sup-add'), onPressed: () async { if (await editSupplier(context) && mounted) _load(); }, icon: const Icon(Icons.add), label: Text(tw(context, 'suppliers.add'))) : null,
      body: RefreshIndicator(onRefresh: _load, child: _s == null ? const Center(child: CircularProgressIndicator()) : ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 96), children: [
        TextField(key: const Key('sup-search'), onChanged: (v) => setState(() => _q = v), decoration: const InputDecoration(prefixIcon: Icon(Icons.search), border: OutlineInputBorder(), isDense: true)),
        const SizedBox(height: 8),
        if (list.isEmpty) ListTile(title: Text(tw(context, 'suppliers.none'))),
        for (final s in list) Card(child: ListTile(key: Key('sup-${s['id']}'),
          leading: const CircleAvatar(child: Icon(Icons.factory_outlined)), title: Text('${s['name']}'),
          subtitle: Text([if (s['contact'] != null) s['contact'], if (s['city'] != null) s['city'], tw(context, 'suppliers.stats', {'quotes': s['quotes'], 'accepted': s['accepted'], 'orders': s['orders']})].join(' · ')),
          trailing: const Icon(Icons.chevron_right),
          onTap: () async { await Navigator.push(context, MaterialPageRoute(builder: (_) => SupplierDetailScreen(id: s['id']))); _load(); },
        )),
      ])),
    );
  }
}

Future<bool> editSupplier(BuildContext context, [Map<String, dynamic>? s]) async {
  const ks = ['name', 'contact', 'phone', 'wechat', 'city', 'notes'];
  final c = {for (final k in ks) k: TextEditingController(text: '${s?[k] ?? ''}')};
  String? err;
  final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, showDragHandle: true, builder: (b) => StatefulBuilder(builder: (b, set) => Padding(
    padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(b).viewInsets.bottom + 16),
    child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tw(context, s == null ? 'suppliers.add' : 'suppliers.edit'), style: Theme.of(b).textTheme.titleLarge), const SizedBox(height: 12),
      for (final k in ks) Padding(padding: const EdgeInsets.only(bottom: 10), child: TextField(key: Key('sup-$k'), controller: c[k], maxLines: k == 'notes' ? 3 : 1,
          decoration: InputDecoration(labelText: tw(context, 'suppliers.f.$k'), border: const OutlineInputBorder()))),
      if (err != null) Text(err!, style: TextStyle(color: Theme.of(b).colorScheme.error)),
      FilledButton(key: const Key('sup-save'), onPressed: () async {
        if (c['name']!.text.trim().isEmpty) return set(() => err = tw(context, 'suppliers.nameRequired'));
        try {
          await context.read<Session>().repo.saveSupplier({for (final k in ks) k: c[k]!.text.trim().isEmpty ? null : c[k]!.text.trim()}, s?['id'] as String?);
          if (b.mounted) Navigator.pop(b, true);
        } catch (e) { set(() => err = _err(e)); }
      }, child: Text(tw(context, 'common.save'))),
    ])))));
  return ok == true;
}

class SupplierDetailScreen extends StatefulWidget {
  const SupplierDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<SupplierDetailScreen> createState() => _SupplierDetailScreenState();
}

class _SupplierDetailScreenState extends State<SupplierDetailScreen> {
  Map<String, dynamic>? _s;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final s = await context.read<Session>().repo.supplier(widget.id); if (mounted) setState(() => _s = s); } catch (e) { if (mounted) _snack(context, _err(e)); }
  }
  @override
  Widget build(BuildContext context) {
    final s = _s, t = Theme.of(context), canEdit = context.watch<Session>().perms.can('suppliers.edit');
    final quotes = ((s?['quotes'] as List?) ?? const []).cast<Map>();
    return Scaffold(
      appBar: AppBar(title: Text('${s?['name'] ?? tw(context, 'suppliers.title')}'), actions: [
        if (canEdit && s != null) IconButton(key: const Key('sup-edit'), icon: const Icon(Icons.edit_outlined), onPressed: () async { if (await editSupplier(context, s) && mounted) _load(); }),
      ]),
      body: s == null ? const Center(child: CircularProgressIndicator()) : ListView(padding: const EdgeInsets.all(12), children: [
        Card(child: Column(children: [
          for (final k in ['contact', 'phone', 'wechat', 'city', 'notes']) if (s[k] != null && '${s[k]}'.isNotEmpty)
            ListTile(dense: true, title: Text(tw(context, 'suppliers.f.$k')), subtitle: SelectableText('${s[k]}')),
          ListTile(dense: true, title: Text(tw(context, 'suppliers.addedBy')), subtitle: Text('${s['createdByName'] ?? '—'} · ${'${s['createdAt'] ?? ''}'.split('T').first}')),
        ])),
        Padding(padding: const EdgeInsets.fromLTRB(4, 12, 4, 4), child: Text(tw(context, 'suppliers.history'), style: t.textTheme.titleSmall)),
        if (quotes.isEmpty) ListTile(title: Text(tw(context, 'suppliers.noQuotes'))),
        for (final q in quotes) Card(child: ListTile(
          title: Text('${q['leadRef'] ?? ''} · ${q['product']}'),
          subtitle: Text([
            '${q['unitPrice']} ${q['currency']}', if (q['moq'] != null) 'MOQ ${q['moq']}', tw(context, 'status.${q['status']}'),
            if (q['order'] != null) tw(context, 'suppliers.order', {'qty': (q['order'] as Map)['qty']}),
            '${q['createdByName'] ?? ''} · ${'${q['createdAt']}'.split('T').first}',
          ].join(' · ')),
        )),
      ]),
    );
  }
}

// ---------------- SLA ----------------
class SlaScreen extends StatefulWidget {
  const SlaScreen({super.key});
  @override
  State<SlaScreen> createState() => _SlaScreenState();
}

class _SlaScreenState extends State<SlaScreen> {
  Map<String, dynamic>? _rep;
  final _n = TextEditingController(), _p = TextEditingController(), _w = TextEditingController();
  bool _loaded = false;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    final s = context.read<Session>(), r = s.repo;
    try {
      final st = await r.slaSettings();
      _n.text = '${(st['normalMinutes'] as num) / 60}'.replaceFirst(RegExp(r'\.0$'), '');
      _p.text = '${(st['priorityMinutes'] as num) / 60}'.replaceFirst(RegExp(r'\.0$'), '');
      _w.text = '${st['warnMinutes'] ?? 30}';
      final rep = s.perms.canViewReports ? await r.slaReport(30) : null;
      if (mounted) setState(() { _rep = rep; _loaded = true; });
    } catch (e) { if (mounted) { setState(() => _loaded = true); _snack(context, _err(e)); } }
  }
  Future<void> _save() async {
    final n = double.tryParse(_n.text), p = double.tryParse(_p.text), w = int.tryParse(_w.text);
    if (n == null || p == null || w == null || n <= 0 || p <= 0 || w < 1) return _snack(context, 'Enter valid numbers');
    try { await context.read<Session>().repo.saveSlaSettings({'normalMinutes': (n * 60).round(), 'priorityMinutes': (p * 60).round(), 'warnMinutes': w}); if (mounted) _snack(context, tw(context, 'common.saved')); }
    catch (e) { if (mounted) _snack(context, _err(e)); }
  }
  @override
  Widget build(BuildContext context) {
    final p = context.watch<Session>().perms, edit = p.isSuperAdmin && p.can('settings.sla'), t = Theme.of(context);
    Widget f(Key k, TextEditingController c, String l) => Padding(padding: const EdgeInsets.only(bottom: 10), child: TextField(key: k, controller: c, enabled: edit,
        keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: l, border: const OutlineInputBorder())));
    final rep = _rep;
    return Scaffold(
      appBar: AppBar(title: Text(tw(context, 'sla.widget'))),
      body: !_loaded ? const Center(child: CircularProgressIndicator()) : ListView(padding: const EdgeInsets.all(12), children: [
        if (rep != null) ...[
          Row(children: [for (final o in (rep['office'] as List).cast<Map>()) Expanded(child: Card(key: Key('sla-office-${o['office']}'), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${tw(context, 'sla.office.${o['office']}')} · ${tw(context, 'sla.days', {'n': rep['days']})}', style: t.textTheme.bodySmall),
            Text(o['onTimePct'] == null ? '—' : '${o['onTimePct']}%', style: t.textTheme.headlineSmall),
            Text(tw(context, 'sla.onTime', {'ok': o['onTime'], 'total': o['total'], 'b': o['breached']}), style: t.textTheme.bodySmall),
          ]))))]),
          for (final m in (rep['members'] as List).cast<Map>()) ListTile(dense: true, leading: Icon(m['breached'] == 0 ? Icons.check_circle_outline : Icons.warning_amber, color: m['breached'] == 0 ? Colors.green : Colors.red),
              title: Text('${m['name'] ?? tw(context, 'sla.queue')} · ${tw(context, 'sla.office.${m['office']}')}'), trailing: Text('${m['breached']}/${m['total']}')),
          const Divider(),
        ],
        Text(tw(context, 'sla.settings'), style: t.textTheme.titleMedium),
        Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(tw(context, 'sla.settingsHint'), style: t.textTheme.bodySmall)),
        f(const Key('sla-normal'), _n, tw(context, 'sla.normalH')), f(const Key('sla-priority'), _p, tw(context, 'sla.priorityH')), f(const Key('sla-warn'), _w, tw(context, 'sla.warnMin')),
        Text(tw(context, 'sla.warnHint'), style: t.textTheme.bodySmall), const SizedBox(height: 10),
        if (edit) FilledButton(key: const Key('sla-save'), onPressed: _save, child: Text(tw(context, 'common.save'))),
      ]),
    );
  }
}

// ---------------- Export / backups ----------------
class ExportScreen extends StatelessWidget {
  const ExportScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(tw(context, 'perm.export'))), body: ListView(children: [
    ListTile(subtitle: Text(tw(context, 'perm.exportHint'))),
    for (final k in ['leads', 'quotes', 'orders', 'shipments']) ListTile(key: Key('export-$k'), leading: const Icon(Icons.table_view_outlined), title: Text(k[0].toUpperCase() + k.substring(1)), trailing: const Icon(Icons.download_outlined),
      onTap: () async {
        try {
          final b = await context.read<Session>().repo.exportCsv(k);
          final where = await Downloads.save(b, 'source-easy-$k-${DateTime.now().toIso8601String().substring(0, 10)}.csv', mime: 'text/csv');
          if (context.mounted) _snack(context, where);
        } catch (e) { if (context.mounted) _snack(context, _err(e)); }
      }),
  ]));
}

class BackupsScreen extends StatelessWidget {
  const BackupsScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(tw(context, 'settings.backups'))), body: FutureBuilder(
    future: context.read<Session>().repo.backups(),
    builder: (c, snap) => ListView(children: [
      ListTile(subtitle: Text(tw(context, 'settings.backupsHint'))),
      if (snap.hasError) ListTile(title: Text(_err(snap.error!))),
      if (!snap.hasData && !snap.hasError) const LinearProgressIndicator(),
      for (final b in snap.data ?? const <Map<String, dynamic>>[]) ListTile(leading: const Icon(Icons.link), title: Text('${b['label']}'), subtitle: Text('${b['url']}'),
          trailing: const Icon(Icons.copy), onTap: () { Clipboard.setData(ClipboardData(text: '${b['url']}')); _snack(context, 'Copied'); }),
    ]),
  ));
}
