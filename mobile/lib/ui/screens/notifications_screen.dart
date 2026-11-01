import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../l10n/codes.dart';
import '../../l10n/l10n.dart';
import '../../data/models/models.dart';
import '../../services/notifications.dart';
import '../widgets/common.dart';
import 'lead_detail_screen.dart';

/// Privacy: text uses only the SE reference, product summary and the staff name of who handed it over.
String notifText(BuildContext context, AppNotification n) {
  final l = context.l10n;
  final ref = n.leadRef ?? '—', product = n.product ?? l.lead;
  final by = n.byName == null ? '' : l.notifBy(n.byName!);
  switch (n.kind) {
    case 'RETURNED': return l.notifReturned(ref, product, by);
    case 'QUOTE_ACCEPTED': return l.notifQuoteAccepted(ref, product, by);
    case 'QUOTE_REJECTED': return l.notifQuoteRejected(ref, product, by);
    case 'ORDER_NEW': return l.notifOrderNew(ref, product, by);
    case 'ORDER_UPDATE': return l.notifOrderUpdate(ref, product, by);
    case 'QUEUE': return l.notifQueue(ref, product, codeLabel(context, n.office ?? 'INDIA'), by);
    default: return l.notifAssigned(ref, product, by);
  }
}

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final nc = context.watch<NotificationCenter>();
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.notifications), actions: [
        if (nc.unread > 0) TextButton(key: const Key('mark-all'), onPressed: () => nc.markRead(), child: Text(context.l10n.markAllRead)),
      ]),
      body: RefreshIndicator(
        onRefresh: nc.poll,
        child: nc.items.isEmpty
            ? ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(context.l10n.noNotifications)))])
            : ListView.separated(
                itemCount: nc.items.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (c, i) {
                  final n = nc.items[i];
                  return ListTile(
                    key: Key('notif-${n.id}'),
                    leading: Icon(n.kind == 'RETURNED' ? Icons.reply : n.kind == 'QUEUE' ? Icons.inbox_outlined : Icons.assignment_ind_outlined,
                        color: n.read ? Colors.grey : Theme.of(c).colorScheme.primary),
                    title: Text(notifText(c, n), style: TextStyle(fontWeight: n.read ? FontWeight.normal : FontWeight.w600)),
                    subtitle: n.createdAt == null ? null : Text(dateFmt.format(n.createdAt!.toLocal())),
                    trailing: n.read ? null : const Badge(smallSize: 8),
                    onTap: () {
                      if (!n.read) nc.markRead(n.id);
                      Navigator.push(c, MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: n.leadId)));
                    },
                  );
                },
              ),
      ),
    );
  }
}
