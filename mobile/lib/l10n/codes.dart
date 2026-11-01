import 'package:flutter/widgets.dart';

import 'l10n.dart';

/// Translated label for an enum code (status, office, channel, role…).
/// Unknown codes fall back to Title Case. Data values (names, products) are never translated.
String codeLabel(BuildContext context, String? code) {
  if (code == null || code.isEmpty) return '—';
  final l = context.l10n;
  return switch (code) {
    'NEW' => l.codeNew,
    'ASSIGNED' => l.codeAssigned,
    'SOURCING' => l.codeSourcing,
    'QUOTED' => l.codeQuoted,
    'APPROVED' => l.codeApproved,
    'REJECTED' => l.codeRejected,
    'SHIPPING' => l.codeShipping,
    'DELIVERED' => l.codeDelivered,
    'WON' => l.codeWon,
    'LOST' => l.codeLost,
    'OPEN' => l.codeOpen,
    'PENDING' => l.codePending,
    'SENT' => l.codeSent,
    'DRAFT' => l.codeDraft,
    'EXPIRED' => l.codeExpired,
    'INDIA' => l.codeIndia,
    'CHINA' => l.codeChina,
    'BOTH' => l.codeBoth,
    'NOT_REQUESTED' => l.codeNotRequested,
    'REQUESTED' => l.codeRequested,
    'RECEIVED' => l.codeReceived,
    'NOT_STARTED' => l.codeNotStarted,
    'FILED' => l.codeFiled,
    'CLEARED' => l.codeCleared,
    'HELD' => l.codeHeld,
    'BOOKED' => l.codeBooked,
    'IN_TRANSIT' => l.codeInTransit,
    'AT_PORT' => l.codeAtPort,
    'OUT_FOR_DELIVERY' => l.codeOutForDelivery,
    'AIR' => l.codeAir,
    'LCL' => l.codeLcl,
    'FCL' => l.codeFcl,
    'FCL_20' => l.codeFcl20,
    'FCL_40' => l.codeFcl40,
    'COURIER' => l.codeCourier,
    'PHONE' => l.codePhone,
    'WHATSAPP' => l.codeWhatsapp,
    'WEBSITE' => l.codeWebsite,
    'REFERRAL' => l.codeReferral,
    'WALK_IN' => l.codeWalkIn,
    'EXHIBITION' => l.codeExhibition,
    'EMAIL' => l.codeEmail,
    'OTHER' => l.codeOther,
    'QUOTATION' => l.codeQuotation,
    'INDIA_STAFF' => l.codeIndiaStaff,
    'CHINA_STAFF' => l.codeChinaStaff,
    'INDIA_ADMIN' => l.codeIndiaAdmin,
    'CHINA_ADMIN' => l.codeChinaAdmin,
    'SUPER_ADMIN' => l.codeSuperAdmin,
    _ => code.split('_').map((w) => w.isEmpty ? w : w[0] + w.substring(1).toLowerCase()).join(' '),
  };
}
