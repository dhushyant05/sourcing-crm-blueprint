import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../l10n/l10n.dart';
import '../../l10n/web_strings.dart';
import '../../services/session.dart';

const stages = ['NEW', 'CHINA', 'SOURCING', 'QUOTED', 'CQ_SENT', 'DECIDED', 'ORDER', 'SHIPPED', 'DELIVERED'];
bool _indiaSide(Session s) => s.role.code.startsWith('INDIA') || s.role.code == 'SUPER_ADMIN';

String fmtLeft(Duration d) { final m = (d.inSeconds.abs() / 60).round(), h = m ~/ 60; return h > 0 ? '${h}h ${m % 60}m' : '${m}m'; }

/// SLA state: green, amber at 80 %, red when breached (same rule as the web app).
({Duration left, String level}) slaState(Map<String, dynamic> sla, DateTime now) {
  final start = DateTime.parse(sla['startedAt'] as String), due = DateTime.parse(sla['dueAt'] as String), left = due.difference(now);
  final warnAt = start.add(Duration(milliseconds: (due.difference(start).inMilliseconds * 0.8).round()));
  return (left: left, level: sla['breached'] == true || left.inSeconds <= 0 ? 'breach' : (now.isAfter(warnAt) ? 'warn' : 'ok'));
}

/// Countdown chip, ticking every 30 s.
class SlaChip extends StatefulWidget {
  const SlaChip(this.sla, {super.key, this.big = false});
  final Map<String, dynamic> sla;
  final bool big;
  @override
  State<SlaChip> createState() => _SlaChipState();
}

class _SlaChipState extends State<SlaChip> {
  late final Timer _t = Timer.periodic(const Duration(seconds: 30), (_) { if (mounted) setState(() {}); });
  @override
  void dispose() { _t.cancel(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final st = slaState(widget.sla, DateTime.now()), office = tw(context, 'sla.office.${widget.sla['office']}');
    final (bg, fg) = switch (st.level) { 'breach' => (Colors.red.shade100, Colors.red.shade800), 'warn' => (Colors.amber.shade100, Colors.brown.shade800), _ => (Colors.green.shade50, Colors.green.shade800) };
    final txt = widget.big
        ? '${tw(context, 'sla.bigLabel', {'office': office})} · ${st.level == 'breach' ? tw(context, 'sla.overdueBy', {'t': fmtLeft(st.left)}) : tw(context, 'sla.left', {'t': fmtLeft(st.left)})}'
        : '$office · ${st.level == 'breach' ? tw(context, 'sla.overdue', {'t': fmtLeft(st.left)}) : tw(context, 'sla.left', {'t': fmtLeft(st.left)})}';
    return Container(key: Key('sla-chip-${st.level}'), padding: EdgeInsets.symmetric(horizontal: widget.big ? 12 : 8, vertical: widget.big ? 6 : 2),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.timer_outlined, size: widget.big ? 16 : 12, color: fg), const SizedBox(width: 4),
          Text(txt, style: TextStyle(color: fg, fontSize: widget.big ? 13 : 11, fontWeight: FontWeight.w600))]));
  }
}

class PriorityBadge extends StatelessWidget {
  const PriorityBadge({super.key});
  @override
  Widget build(BuildContext context) => Container(key: const Key('priority-badge'), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: Colors.orange.shade100, borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.local_fire_department, size: 12, color: Colors.orange.shade800),
        Text(tw(context, 'sla.priority'), style: TextStyle(color: Colors.orange.shade800, fontSize: 11, fontWeight: FontWeight.w600))]));
}

/// Progress bar over the whole workflow.
class WorkflowProgress extends StatelessWidget {
  const WorkflowProgress(this.p, {super.key});
  final Map<String, dynamic> p;
  @override
  Widget build(BuildContext context) {
    final idx = (p['index'] as num?)?.toInt() ?? 0, lost = p['lost'] == true, cs = Theme.of(context).colorScheme;
    return Column(key: const Key('wf-progress'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [for (var i = 0; i < stages.length; i++) Expanded(child: Container(height: 8, margin: const EdgeInsets.symmetric(horizontal: 1.5),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(4), color: i <= idx ? (lost ? Colors.red.shade300 : cs.primary) : cs.surfaceContainerHighest)))]),
      const SizedBox(height: 4),
      Row(children: [Text(tw(context, 'wf.stageN', {'n': idx + 1, 'of': stages.length}), style: Theme.of(context).textTheme.labelSmall), const Spacer(),
        Text(lost ? tw(context, 'wf.lost') : tw(context, 'wf.stage.${p['stage']}'), style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: lost ? Colors.red : cs.primary))]),
    ]);
  }
}

String eventText(BuildContext context, String kind, Map<String, dynamic> d) {
  String t(String k, [Map<String, Object?> a = const {}]) => tw(context, k, a);
  final office = d['office'] != null ? t('sla.office.${d['office']}') : '';
  final base = t('wf.ev.$kind', {
    'n': d['n'] ?? '', 'office': office, 'to': d['to'] ?? office, 'from': d['from'] != null ? t('status.${d['from']}') : '',
    'st': d['to'] != null && kind == 'STATUS' ? t('status.${d['to']}') : '', 'ship': d['status'] == null ? '' : (tw(context, 'ship.st.${d['status']}').startsWith('ship.st.') ? d['status'] : tw(context, 'ship.st.${d['status']}')),
    'on': d['on'] == true ? t('wf.on') : t('wf.off'), 'ref': d['ref'] ?? '', 'date': d['date'] ?? '—'});
  final b = base == 'wf.ev.$kind' ? kind : base;
  final extra = switch (kind) {
    'QUOTE_ADDED' => d['supplier'] != null ? ' · ${d['supplier']}' : '',
    'CQ_REJECTED' || 'LEAD_CLOSED' => d['reason'] != null ? ' — “${d['reason']}”' : '',
    'REVISE_REQUESTED' => [if (d['reason'] != null) '“${d['reason']}”', if (d['targetPrice'] != null) '${t('wf.target')} ${d['targetPrice']} ${d['targetCurrency'] ?? ''}', if (d['notes'] != null) '${d['notes']}'].join(' · '),
    'CLOSED_PERMANENT' => [if (d['reason'] != null) ' — “${d['reason']}”', if (d['followUp'] != null) ' · ${t('lost.followUp')} ${d['followUp']}'].join(),
    'SHIPPED' => [if ((d['tracking'] ?? d['container']) != null) '${d['tracking'] ?? d['container']}', if (d['etd'] != null) 'ETD ${d['etd']}'].join(' · '),
    _ => '',
  };
  if (extra.isEmpty) return b;
  return kind == 'REVISE_REQUESTED' || kind == 'SHIPPED' ? '$b — $extra' : b + extra;
}

/// Lead section: progress, SLA clock, Priority switch (India + super admin) and the role-filtered event log
/// from GET /api/leads/:id/timeline.
class LeadWorkflow extends StatefulWidget {
  const LeadWorkflow({super.key, required this.lead, this.initial});
  final Lead lead;
  final Map<String, dynamic>? initial;
  @override
  State<LeadWorkflow> createState() => _LeadWorkflowState();
}

class _LeadWorkflowState extends State<LeadWorkflow> {
  Map<String, dynamic>? data;
  String? err;
  bool busy = false;
  @override
  void initState() { super.initState(); data = widget.initial; if (data == null) _load(); }
  Future<void> _load() async {
    try { final d = await context.read<Session>().repo.leadTimeline(widget.lead.id); if (mounted) setState(() { data = d; err = null; }); }
    catch (e) { if (mounted) setState(() => err = '$e'); }
  }
  Future<void> _toggle(bool on) async {
    setState(() { busy = true; err = null; });
    try { final r = await context.read<Session>().repo.setPriority(widget.lead.id, on); setState(() => data = {...?data, ...r}); unawaited(_load()); }
    catch (e) { setState(() => err = '$e'); } finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>(), t = Theme.of(context), d = data;
    final sla = (d?['sla'] as Map?)?.cast<String, dynamic>(), prio = d?['priority'] == true;
    final hours = (((d?['settings'] as Map?)?['priorityMinutes'] as num?) ?? 0) / 60;
    return Column(key: const Key('workflow'), crossAxisAlignment: CrossAxisAlignment.start, children: [
      Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Text(context.l10n.timeline, style: t.textTheme.titleMedium),
        if (prio) const PriorityBadge(),
      ]),
      if (sla != null) Padding(padding: const EdgeInsets.only(top: 8), child: SlaChip(sla, big: true)),
      if (_indiaSide(s) && d != null) SwitchListTile(key: const Key('priority-toggle'), contentPadding: EdgeInsets.zero, dense: true,
          secondary: Icon(Icons.local_fire_department, color: prio ? Colors.orange : null),
          title: Text(prio ? tw(context, 'sla.priority') : tw(context, 'sla.mark', {'h': hours == hours.roundToDouble() ? hours.toInt() : hours})),
          value: prio, onChanged: busy ? null : _toggle),
      if (err != null) Text(err!, style: TextStyle(color: t.colorScheme.error, fontSize: 12)),
      if (d == null) const Padding(padding: EdgeInsets.all(8), child: LinearProgressIndicator())
      else ...[
        const SizedBox(height: 8),
        WorkflowProgress((d['progress'] as Map).cast<String, dynamic>()),
        if (sla != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(key: const Key('sla-line'), tw(context, 'sla.line', {
          'office': tw(context, 'sla.office.${sla['office']}'), 'who': sla['assigneeName'] ?? tw(context, 'sla.queue'),
          'd': DateTime.parse(sla['dueAt'] as String).toLocal().toString().substring(0, 16)}), style: t.textTheme.bodySmall)),
        const SizedBox(height: 8),
        for (final e in (d['events'] as List).cast<Map>()) _event(context, e.cast<String, dynamic>()),
      ],
    ]);
  }

  Widget _event(BuildContext context, Map<String, dynamic> e) {
    final kind = e['kind'] as String, at = DateTime.tryParse('${e['at']}')?.toLocal();
    final color = kind.startsWith('SLA') ? Colors.red : (kind == 'SHIPPED' || kind == 'CQ_ACCEPTED') ? Colors.green
        : (kind == 'CQ_REJECTED' || kind == 'LEAD_CLOSED') ? Colors.red.shade300 : Theme.of(context).colorScheme.primary;
    return Padding(key: Key('ev-$kind'), padding: const EdgeInsets.symmetric(vertical: 5), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.only(top: 5, right: 10), child: Icon(Icons.circle, size: 9, color: color)),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(eventText(context, kind, ((e['data'] as Map?) ?? {}).cast<String, dynamic>())),
        Text([if (e['actorName'] != null) e['actorName'], if (at != null) at.toString().substring(0, 16)].join(' · '), style: Theme.of(context).textTheme.bodySmall),
      ])),
    ]));
  }
}

/// Customer rejected a quote: India asks China for a revised quote or closes the lead as Lost.
class RejectionCard extends StatefulWidget {
  const RejectionCard({super.key, required this.lead, required this.onLead});
  final Lead lead;
  final void Function(Lead) onLead;
  @override
  State<RejectionCard> createState() => _RejectionCardState();
}

class _RejectionCardState extends State<RejectionCard> {
  final price = TextEditingController(), notes = TextEditingController();
  bool busy = false, form = false;
  String? err;
  Future<void> _run(Future<Lead> Function() f) async {
    setState(() { busy = true; err = null; });
    try { widget.onLead(await f()); } catch (e) { setState(() => err = '$e'); } finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final r = widget.lead.rejection, s = context.watch<Session>();
    if (r == null || (r['count'] as num? ?? 0) == 0) return const SizedBox.shrink();
    final last = ((r['last'] as Map?) ?? {}).cast<String, dynamic>(), action = r['actionNeeded'] == true, revising = r['revising'] == true;
    final reason = [if (last['reasonCode'] != null) tw(context, 'rej.r.${last['reasonCode']}'), if (last['reasonText'] != null && '${last['reasonText']}'.isNotEmpty) '“${last['reasonText']}”'].join(' — ');
    final id = widget.lead.id;
    late final repo = s.repo;
    return Card(key: const Key('rejection'), color: action ? Colors.red.shade50 : null, child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [Expanded(child: Text(tw(context, 'rej.title'), style: Theme.of(context).textTheme.titleSmall)),
        Text(tw(context, 'rej.count', {'n': r['count']}), style: Theme.of(context).textTheme.bodySmall)]),
      Text(action ? tw(context, 'rej.actionNeeded') : revising ? tw(context, 'rej.revising') : '', style: TextStyle(color: action ? Colors.red.shade700 : null, fontWeight: FontWeight.w600)),
      if (reason.isNotEmpty) Text(reason),
      if (action && _indiaSide(s)) ...[
        const SizedBox(height: 8),
        if (form) ...[
          TextField(key: const Key('rej-target'), controller: price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tw(context, 'rej.targetOpt'), suffixText: 'INR', isDense: true)),
          TextField(key: const Key('rej-notes'), controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tw(context, 'rej.notesOpt'), isDense: true)),
          Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(tw(context, 'rej.reviseHint'), style: Theme.of(context).textTheme.bodySmall)),
          FilledButton(key: const Key('rej-send'), onPressed: busy ? null : () { final p = double.tryParse(price.text.trim());
            _run(() => repo.reviseRejected(id, targetPrice: p, targetCurrency: p == null ? null : 'INR', notes: notes.text.trim())); }, child: Text(tw(context, 'rej.send'))),
        ] else Wrap(spacing: 8, runSpacing: 6, children: [
          FilledButton.tonal(key: const Key('rej-revise'), onPressed: busy ? null : () => setState(() => form = true), child: Text(tw(context, 'rej.revise'))),
          OutlinedButton(key: const Key('rej-close'), onPressed: busy ? null : () async {
            final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(content: Text(tw(context, 'rej.closeConfirm')),
                actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(context.l10n.cancel)), FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tw(context, 'rej.close')))]));
            if (ok == true) _run(() => repo.closeRejected(id));
          }, child: Text(tw(context, 'rej.close'))),
        ]),
      ],
      if (err != null) Text(err!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
    ])));
  }
}

/// LOST / CLOSED lead actions (India office + super admin): reopen, copy to a new lead, close permanently, follow-up.
class LostActions extends StatefulWidget {
  const LostActions({super.key, required this.lead, required this.onLead, required this.openLead});
  final Lead lead;
  final void Function(Lead) onLead, openLead;
  @override
  State<LostActions> createState() => _LostActionsState();
}

class _LostActionsState extends State<LostActions> {
  bool busy = false;
  String? err, msg;
  late String? fu = widget.lead.followUp;
  Future<void> _run(Future<Lead> Function() f, [void Function(Lead)? after]) async {
    setState(() { busy = true; err = null; msg = null; });
    try { (after ?? widget.onLead)(await f()); } catch (e) { setState(() => err = '$e'); } finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>(), l = widget.lead, closed = l.status == 'CLOSED' || l.raw['closedAt'] != null, sa = s.role.code == 'SUPER_ADMIN';
    final from = l.createdFromRef != null ? Text(tw(context, 'lost.createdFrom', {'ref': l.createdFromRef}), key: const Key('created-from'), style: Theme.of(context).textTheme.bodySmall) : null;
    if (!_indiaSide(s) || (l.status != 'LOST' && !closed)) return from ?? const SizedBox.shrink();
    late final repo = s.repo;
    return Card(key: const Key('lost-actions'), color: Colors.red.shade50, child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ?from,
      Text(closed ? tw(context, 'status.CLOSED') : tw(context, 'lost.title'), style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.bold)),
      if (closed) Text(tw(context, 'lost.closedOn', {'when': '${l.raw['closedAt'] ?? ''}'.replaceFirst('T', ' ').split('.').first, 'who': l.raw['closedByName'] ?? '—'}), style: Theme.of(context).textTheme.bodySmall),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 6, children: [
        if (!closed || sa) ...[
          OutlinedButton.icon(key: const Key('lost-reopen-india'), onPressed: busy ? null : () => _run(() => repo.reopenLead(l.id, 'INDIA')), icon: const Icon(Icons.replay, size: 16), label: Text(tw(context, 'lost.reopenIndia'))),
          OutlinedButton.icon(key: const Key('lost-reopen-china'), onPressed: busy ? null : () => _run(() => repo.reopenLead(l.id, 'CHINA')), icon: const Icon(Icons.replay, size: 16), label: Text(tw(context, 'lost.reopenChina'))),
        ],
        FilledButton.icon(key: const Key('lost-copy'), onPressed: busy ? null : () => _run(() => repo.copyLead(l.id), (n) { setState(() => msg = tw(context, 'lost.copied', {'ref': n.leadRef ?? ''})); widget.openLead(n); }),
            icon: const Icon(Icons.copy, size: 16), label: Text(tw(context, 'lost.copy'))),
        if (!closed) FilledButton.icon(key: const Key('lost-close'), style: FilledButton.styleFrom(backgroundColor: Colors.blueGrey.shade800), onPressed: busy ? null : () async {
          final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(content: Text(tw(context, 'lost.closeConfirm')),
              actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(context.l10n.cancel)), FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tw(context, 'lost.close')))]));
          if (ok == true) _run(() => repo.closeLeadPermanently(l.id, followUp: fu));
        }, icon: const Icon(Icons.archive_outlined, size: 16), label: Text(tw(context, 'lost.close'))),
      ]),
      if (closed && !sa) Padding(padding: const EdgeInsets.only(top: 6), child: Text(tw(context, 'lost.onlySa'), style: Theme.of(context).textTheme.bodySmall)),
      const SizedBox(height: 8),
      Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        const Icon(Icons.notifications_active_outlined, size: 16), Text(tw(context, 'lost.followUp')),
        OutlinedButton(key: const Key('lost-followup'), onPressed: busy ? null : () async {
          final now = DateTime.now();
          final d = await showDatePicker(context: context, firstDate: now.subtract(const Duration(days: 1)), lastDate: now.add(const Duration(days: 730)), initialDate: DateTime.tryParse(fu ?? '') ?? now.add(const Duration(days: 30)));
          if (d != null) setState(() => fu = d.toIso8601String().substring(0, 10));
        }, child: Text(fu ?? '—')),
        if (fu != null) IconButton(tooltip: tw(context, 'profile.remove'), onPressed: () => setState(() => fu = null), icon: const Icon(Icons.clear, size: 16)),
        TextButton(key: const Key('lost-followup-save'), onPressed: busy ? null : () => _run(() => repo.setFollowUp(l.id, fu)), child: Text(tw(context, 'lost.save'))),
      ]),
      if (msg != null) Text(msg!, style: const TextStyle(color: Colors.green, fontSize: 12)),
      if (err != null) Text(err!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
    ])));
  }
}
