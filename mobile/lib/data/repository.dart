import 'dart:math';

import '../core/roles.dart';
import 'api/server_client.dart';
import 'models/models.dart';
import 'offline/offline_queue.dart';

/// Result of a write: either the saved record, or `queued` when offline.
class WriteResult {
  WriteResult.saved(this.record) : queued = false;
  WriteResult.queued() : record = null, queued = true;
  final Map<String, dynamic>? record;
  final bool queued;
}

String newClientRef() {
  final r = Random.secure();
  return '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-${r.nextInt(1 << 32).toRadixString(36)}';
}

/// All app data access goes through here. Reads fall back to the SQLite cache
/// when offline; writes fall back to the offline queue.
class SourceEasyRepository {
  SourceEasyRepository({required this.api, required this.store, required this.perms});
  final ServerClient api;
  final LocalStore store;
  final Permissions perms;

  static const _plural = {
    'lead': 'leads', 'sourcingRequest': 'sourcingRequests', 'supplier': 'suppliers',
    'quotation': 'quotations', 'clientApproval': 'clientApprovals',
    'shippingOrder': 'shippingOrders', 'teamMember': 'teamMembers',
  };

  Future<List<Map<String, dynamic>>> _read(String cacheKey, String plural, String fields,
      {Map<String, dynamic>? filter, Map<String, dynamic>? orderBy}) async {
    try {
      final rows = await api.findMany(plural, fields, filter: filter, orderBy: orderBy);
      await store.putCache(cacheKey, rows);
      return rows;
    } on OfflineException {
      final cached = await store.getCache(cacheKey);
      if (cached == null) rethrow;
      return (cached as List).cast<Map<String, dynamic>>();
    }
  }

  Future<WriteResult> _write(String object, Map<String, dynamic> data, {String? id}) async {
    final ref = newClientRef();
    final payload = id == null ? {...data, 'clientRef': ref} : data;
    try {
      final rec = id == null
          ? await api.create(object, payload, 'id')
          : await api.update(object, id, payload, 'id');
      return WriteResult.saved(rec);
    } on OfflineException {
      await store.enqueue(PendingOp(
          kind: id == null ? 'create' : 'update', object: object, recordId: id, payload: payload, clientRef: ref));
      return WriteResult.queued();
    }
  }

  /// Executor used by [SyncEngine]. Creates are idempotent via clientRef.
  Future<void> replay(PendingOp op) async {
    if (op.kind == 'create') {
      final existing = await api.findMany(_plural[op.object]!, 'id',
          filter: {'clientRef': {'eq': op.clientRef}}, first: 1);
      if (existing.isNotEmpty) return;
      await api.create(op.object, op.payload, 'id');
    } else {
      await api.update(op.object, op.recordId!, op.payload, 'id');
    }
  }

  // ---------- Leads ----------
  String get _leadFields => perms.canSeeCustomerDetails ? Lead.gqlFields : Lead.gqlFieldsRedacted;

  Future<List<Lead>> leads({String? office, String? status, bool mine = false}) async {
    final filter = <String, dynamic>{
      if (mine) 'assignedTo': {'eq': 'me'},
      if (office != null) 'assignedOffice': {'eq': office},
      if (status != null) 'status': {'eq': status},
    };
    final rows = await _read('leads:$office:$status:$mine', 'leads', _leadFields, filter: filter.isEmpty ? null : filter);
    final pending = (await store.pending()).where((p) => p.object == 'lead' && p.kind == 'create');
    return [
      ...pending.map((p) => Lead.fromJson({...p.payload, 'id': 'pending-${p.id}', '_pending': true})),
      ...rows.map(Lead.fromJson),
    ];
  }

  Future<Lead?> lead(String id) async {
    final rows = await _read('lead:$id', 'leads', _leadFields, filter: {'id': {'eq': id}});
    return rows.isEmpty ? null : Lead.fromJson(rows.first);
  }

  Future<WriteResult> createLead({required String clientName, String? phone, String? email,
      required String productInterest, double? quantity, double? targetPrice, String targetCurrency = 'INR',
      String? sourceChannel, String? summary}) {
    assert(perms.canCreateLead);
    return _write('lead', {
      'name': '$clientName — $productInterest',
      'clientName': clientName,
      if (phone != null && phone.isNotEmpty) 'contactPhone': {'primaryPhoneNumber': phone},
      if (email != null && email.isNotEmpty) 'contactEmail': {'primaryEmail': email},
      'productInterest': productInterest,
      'quantity': ?quantity,
      if (targetPrice != null)
        'targetPrice': {'amountMicros': (targetPrice * 1e6).round(), 'currencyCode': targetCurrency},
      'sourceChannel': ?sourceChannel,
      if (summary != null && summary.isNotEmpty) 'summary': summary,
      'status': 'NEW',
      'assignedOffice': 'INDIA',
      'office': 'BOTH',
    });
  }

  /// Enquiry product photos/documents. Both sides (China only for China-assigned leads; the server enforces it).
  Future<List<LeadAttachment>> attachments(String leadId) async {
    final j = await api.send('GET', '/api/leads/${Uri.encodeComponent(leadId)}/attachments') as Map<String, dynamic>;
    return ((j['data'] as List?) ?? []).cast<Map<String, dynamic>>().map(LeadAttachment.fromJson).toList();
  }

  Future<List<int>> attachmentBytes(String leadId, LeadAttachment a) =>
      api.getBytes('/api/leads/${Uri.encodeComponent(leadId)}/attachments/${Uri.encodeComponent(a.id)}');

  /// India side: add product photos/videos/documents to a lead (needs a connection; files are big).
  Future<List<LeadAttachment>> uploadAttachments(String leadId, List<String> paths) async {
    final j = await api.upload('/api/leads/${Uri.encodeComponent(leadId)}/attachments', paths) as Map<String, dynamic>;
    return ((j['data'] as List?) ?? []).cast<Map<String, dynamic>>().map(LeadAttachment.fromJson).toList();
  }

  Future<void> deleteAttachment(String leadId, String fileId) =>
      api.send('DELETE', '/api/leads/${Uri.encodeComponent(leadId)}/attachments/${Uri.encodeComponent(fileId)}');

  // ── Supplier quotes on a lead (server SQLite; China adds, India sees them redacted) ──
  Future<List<LeadQuote>> leadQuotes(String leadId) async {
    final j = await api.send('GET', '/api/leads/${Uri.encodeComponent(leadId)}/quotes') as Map<String, dynamic>;
    return ((j['data'] as List?) ?? []).cast<Map<String, dynamic>>().map(LeadQuote.fromJson).toList();
  }
  Future<LeadQuote> createLeadQuote(String leadId, Map<String, dynamic> body) async =>
      LeadQuote.fromJson((await api.send('POST', '/api/leads/${Uri.encodeComponent(leadId)}/quotes', body: body) as Map<String, dynamic>)['data'] as Map<String, dynamic>);
  Future<LeadQuote> updateLeadQuote(String id, Map<String, dynamic> body) async =>
      LeadQuote.fromJson((await api.send('PATCH', '/api/quotes/${Uri.encodeComponent(id)}', body: body) as Map<String, dynamic>)['data'] as Map<String, dynamic>);
  Future<void> deleteLeadQuote(String id) => api.send('DELETE', '/api/quotes/${Uri.encodeComponent(id)}');
  Future<LeadQuote> uploadQuoteFiles(String id, List<String> paths) async =>
      LeadQuote.fromJson((await api.upload('/api/quotes/${Uri.encodeComponent(id)}/files', paths) as Map<String, dynamic>)['data'] as Map<String, dynamic>);
  Future<List<int>> quoteFileBytes(String id, LeadAttachment a) => api.getBytes('/api/quotes/${Uri.encodeComponent(id)}/files/${Uri.encodeComponent(a.id)}');
  ({Uri uri, Map<String, String> headers}) quoteFileStream(String id, LeadAttachment a) => api.authed('/api/quotes/${Uri.encodeComponent(id)}/files/${Uri.encodeComponent(a.id)}');
  Future<void> deleteQuoteFile(String id, String fid) => api.send('DELETE', '/api/quotes/${Uri.encodeComponent(id)}/files/${Uri.encodeComponent(fid)}');
  Map<String, dynamic> _d(dynamic r) => ((r as Map<String, dynamic>)['data'] as Map).cast<String, dynamic>();
  Future<List<LeadQuote>> allQuotes({String? status, String? office, bool mine = false}) async {
    final q = [if (status != null) 'status=$status', if (office != null) 'office=$office', if (mine) 'mine=1'].join('&');
    final j = await api.send('GET', '/api/quotes${q.isEmpty ? '' : '?$q'}') as Map<String, dynamic>;
    return ((j['data'] as List?) ?? []).cast<Map<String, dynamic>>().map(LeadQuote.fromJson).toList();
  }
  Future<LeadQuote> saveCustomerQuote(String id, Map<String, dynamic> b) async => LeadQuote.fromJson(_d(await api.send('PUT', '/api/quotes/${Uri.encodeComponent(id)}/customer', body: b)));
  Future<LeadQuote> quotePdf(String id) async => LeadQuote.fromJson(_d(await api.send('POST', '/api/quotes/${Uri.encodeComponent(id)}/pdf', body: <String, dynamic>{})));
  Future<LeadQuote> setQuoteStatus(String id, String status, [String? reason]) async =>
      setQuoteStatusCode(id, status, reason: reason);
  Future<LeadQuote> setQuoteStatusCode(String id, String status, {String? reason, String? reasonCode}) async =>
      LeadQuote.fromJson(_d(await api.send('POST', '/api/quotes/${Uri.encodeComponent(id)}/status',
          body: {'status': status, if (reason != null && reason.isNotEmpty) 'reason': reason, if (reasonCode != null) 'reasonCode': reasonCode})));
  Future<SeOrder> createOrder(String quoteId, Map<String, dynamic> b) async => SeOrder(_d(await api.send('POST', '/api/quotes/${Uri.encodeComponent(quoteId)}/order', body: b)));
  Future<List<SeOrder>> orders() async {
    final j = await api.send('GET', '/api/orders') as Map<String, dynamic>;
    return ((j['data'] as List?) ?? []).cast<Map<String, dynamic>>().map(SeOrder.new).toList();
  }
  Future<SeOrder> updateOrder(String id, Map<String, dynamic> b) async => SeOrder(_d(await api.send('PATCH', '/api/orders/${Uri.encodeComponent(id)}', body: b)));
  String absoluteUrl(String path) => api.authed(path).uri.toString();

  Future<List<QuoteSupplier>> quoteSuppliers() async {
    final j = await api.send('GET', '/api/suppliers') as Map<String, dynamic>;
    return ((j['data'] as List?) ?? []).cast<Map<String, dynamic>>().map(QuoteSupplier.fromJson).toList();
  }

  ({Uri uri, Map<String, String> headers}) attachmentStream(String leadId, LeadAttachment a) =>
      api.authed('/api/leads/${Uri.encodeComponent(leadId)}/attachments/${Uri.encodeComponent(a.id)}');

  Future<WriteResult> updateLead(String id, Map<String, dynamic> data) => _write('lead', data, id: id);

  /// Step 2: hand a lead to a China agent.
  Future<WriteResult> assignToChina(String leadId, String agent) =>
      updateLead(leadId, {if (agent.isNotEmpty) 'assignedChinaAgent': agent, 'assignedOffice': 'CHINA', 'status': 'ASSIGNED'});

  /// Active members of an office, for the assignee picker.
  Future<List<StaffLite>> staff(String office) async {
    final j = await api.send('GET', '/api/staff', query: {'office': office}) as Map<String, dynamic>;
    return (j['data'] as List).cast<Map<String, dynamic>>().map(StaffLite.fromJson).toList();
  }

  /// Hands a lead to [office]. [assignedTo] null = office queue; [useDefault] omits it (China→India returns to the raiser).
  Future<Lead> assignLead(String id, String office, {String? assignedTo, bool useDefault = false}) async {
    final j = await api.send('POST', '/api/leads/${Uri.encodeComponent(id)}/assign',
        body: {'office': office, if (!useDefault) 'assignedTo': assignedTo}) as Map<String, dynamic>;
    return Lead.fromJson((j['data'] ?? j) as Map<String, dynamic>);
  }

  /// Live notification events: ('hello', unread) on connect, then ('notification', item + unread).
  Stream<({AppNotification? item, int? unread, Map<String, dynamic>? change})> notificationStream() =>
      api.sse('/api/notifications/stream').where((e) => e.event == 'hello' || e.event == 'notification' || e.event == 'change').map((e) => (
            item: e.event == 'notification' ? AppNotification.fromJson((e.data['notification'] as Map).cast<String, dynamic>()) : null,
            unread: e.event == 'change' ? null : (e.data['unread'] as num?)?.toInt() ?? 0,
            change: e.event == 'change' ? e.data : null));

  Future<({List<AppNotification> items, int unread})> notifications() async {
    final j = await api.send('GET', '/api/notifications') as Map<String, dynamic>;
    return (items: (j['data'] as List).cast<Map<String, dynamic>>().map(AppNotification.fromJson).toList(), unread: (j['unread'] as num?)?.toInt() ?? 0);
  }

  Future<void> markNotificationRead([String? id]) =>
      api.send('POST', id == null ? '/api/notifications/read-all' : '/api/notifications/${Uri.encodeComponent(id)}/read');

  // ---------- Sourcing ----------
  Future<List<SourcingRequest>> sourcingRequests({String? leadId}) async {
    final rows = await _read('sr:$leadId', 'sourcingRequests', SourcingRequest.gqlFields,
        filter: leadId == null ? null : {'leadId': {'eq': leadId}});
    return rows.map(SourcingRequest.fromJson).toList();
  }

  Future<WriteResult> createSourcingRequest({required String leadId, required String product,
      double? quantity, double? targetPrice, String currency = 'CNY', DateTime? deadline,
      String? agent, String sampleStatus = 'NOT_REQUESTED'}) {
    assert(perms.canCreateSourcingRequest);
    return _write('sourcingRequest', {
      'name': product,
      'productDescription': product,
      'leadId': leadId,
      'quantity': ?quantity,
      if (targetPrice != null) 'targetPrice': {'amountMicros': (targetPrice * 1e6).round(), 'currencyCode': currency},
      if (deadline != null) 'deadline': deadline.toIso8601String().substring(0, 10),
      'assignedChinaAgent': ?agent,
      'sampleStatus': sampleStatus,
      'status': 'OPEN',
      'office': 'CHINA',
    });
  }

  Future<WriteResult> linkChat(String sourcingRequestId, int conversationId, String url) =>
      _write('sourcingRequest', {
        'chatwootConversationId': conversationId,
        'chatwootThreadUrl': {'primaryLinkUrl': url},
      }, id: sourcingRequestId);

  Future<List<Supplier>> suppliers({String? sourcingRequestId}) async {
    if (!perms.canSeeSupplierDetails) return const [];
    final rows = await _read('suppliers:$sourcingRequestId', 'suppliers', Supplier.gqlFields,
        filter: sourcingRequestId == null ? null : {'sourcingRequestId': {'eq': sourcingRequestId}});
    return rows.map(Supplier.fromJson).toList();
  }

  Future<WriteResult> createSupplier(String srId, String name, {String? phone, String? wechat, String? notes}) {
    assert(perms.canSeeSupplierDetails);
    return _write('supplier', {
      'name': name, 'sourcingRequestId': srId, 'wechatId': ?wechat, 'notes': ?notes,
      if (phone != null && phone.isNotEmpty) 'phone': {'primaryPhoneNumber': phone},
      'office': 'CHINA',
    });
  }

  // ---------- Quotations ----------
  Future<List<Quotation>> quotations({String? sourcingRequestId}) async {
    final fields = perms.canSeeRawSupplierCost ? Quotation.gqlFields : Quotation.gqlFieldsIndia;
    final rows = await _read('q:$sourcingRequestId', 'quotations', fields,
        filter: sourcingRequestId == null ? null : {'sourcingRequestId': {'eq': sourcingRequestId}});
    return rows.map(Quotation.fromJson).toList();
  }

  /// China creates a quotation in the currency the supplier quoted (USD/CNY/INR). No conversion.
  Future<WriteResult> createQuotation({required String sourcingRequestId, String? supplierId,
      required double unitCost, required double quantity, required String currency,
      DateTime? validUntil}) {
    assert(perms.canCreateQuotation);
    final total = unitCost * quantity;
    return _write('quotation', {
      'name': 'Q ${DateTime.now().toIso8601String().substring(0, 10)}',
      'sourcingRequestId': sourcingRequestId,
      'supplierId': ?supplierId,
      'unitCost': unitCost,
      'totalCost': total,
      'currency': currency,
      if (validUntil != null) 'validityDate': validUntil.toIso8601String().substring(0, 10),
      'office': 'BOTH',
    });
  }

  /// India sets the client price in the currency it picks (USD/CNY/INR).
  Future<WriteResult> setClientPrice(String quotationId, double unitPrice, String currency) =>
      _write('quotation', {'clientUnitPrice': unitPrice, 'clientCurrency': currency}, id: quotationId);

  // ---------- Approvals ----------
  Future<List<ClientApproval>> approvals({String? quotationId}) async {
    final rows = await _read('ap:$quotationId', 'clientApprovals', ClientApproval.gqlFields,
        filter: quotationId == null ? null : {'quotationId': {'eq': quotationId}});
    return rows.map(ClientApproval.fromJson).toList();
  }

  Future<WriteResult> recordApproval({required String quotationId, required bool approved,
      required String approver, String? notes, String? leadId}) async {
    assert(perms.canRecordApproval);
    final res = await _write('clientApproval', {
      'name': approved ? 'Approved' : 'Rejected',
      'quotationId': quotationId,
      'status': approved ? 'APPROVED' : 'REJECTED',
      'approver': approver,
      'decidedAt': DateTime.now().toUtc().toIso8601String(),
      'notes': ?notes,
      'office': 'INDIA',
    });
    if (leadId != null) await updateLead(leadId, {'status': approved ? 'APPROVED' : 'LOST'});
    return res;
  }

  // ---------- Shipping ----------
  Future<List<ShippingOrder>> shippingOrders({String? leadId}) async {
    final rows = await _read('ship:$leadId', 'shippingOrders', ShippingOrder.gqlFields,
        filter: leadId == null ? null : {'leadId': {'eq': leadId}});
    return rows.map(ShippingOrder.fromJson).toList();
  }

  Future<WriteResult> createShippingOrder({required String leadId, String? quotationId}) =>
      _write('shippingOrder', {
        'name': 'Shipment', 'leadId': leadId, 'quotationId': ?quotationId,
        'shipmentStatus': 'BOOKED', 'customsStatus': 'NOT_STARTED', 'office': 'BOTH',
      });

  Future<WriteResult> updateShipping(String id, Map<String, dynamic> data) {
    assert(perms.canEditShipping);
    return _write('shippingOrder', data, id: id);
  }

  // ---------- Workflow (server timeline, SLA, priority, lost leads, rejections) ----------
  Future<Map<String, dynamic>> leadTimeline(String id) async => _d(await api.send('GET', '/api/leads/${Uri.encodeComponent(id)}/timeline'));
  Future<Map<String, dynamic>> setPriority(String id, bool on) async =>
      _d(await api.send('POST', '/api/leads/${Uri.encodeComponent(id)}/priority', body: {'priority': on}));
  Future<Lead> _leadPost(String id, String action, [Map<String, dynamic>? body]) async =>
      Lead.fromJson(_d(await api.send('POST', '/api/leads/${Uri.encodeComponent(id)}/$action', body: body ?? {})));
  Future<Lead> reopenLead(String id, String office) => _leadPost(id, 'reopen', {'office': office});
  Future<Lead> copyLead(String id) => _leadPost(id, 'copy');
  Future<Lead> closeLeadPermanently(String id, {String? followUp, String? reason}) =>
      _leadPost(id, 'close-permanent', {if (followUp != null) 'followUp': followUp, if (reason != null) 'reason': reason});
  Future<Lead> setFollowUp(String id, String? date) => _leadPost(id, 'follow-up', {'date': date});
  Future<Lead> reviseRejected(String id, {double? targetPrice, String? targetCurrency, String? notes}) => _leadPost(id, 'rejection/revise',
      {if (targetPrice != null) 'targetPrice': targetPrice, if (targetCurrency != null) 'targetCurrency': targetCurrency, if (notes != null && notes.isNotEmpty) 'notes': notes});
  Future<Lead> closeRejected(String id) => _leadPost(id, 'rejection/close');

  // ---------- Timeline ----------
  Future<List<TimelineEvent>> timeline(Lead lead) async {
    final ev = <TimelineEvent>[];
    if (lead.createdAt != null) ev.add(TimelineEvent(lead.createdAt!, 'Lead created', 'India office', 'lead', 'INDIA'));
    final srs = await sourcingRequests(leadId: lead.id);
    for (final s in srs) {
      if (s.createdAt != null) {
        ev.add(TimelineEvent(s.createdAt!, 'Sourcing request', s.productDescription ?? s.name, 'sourcing'));
      }
      for (final q in await quotations(sourcingRequestId: s.id)) {
        ev.add(TimelineEvent(q.validityDate ?? s.createdAt ?? DateTime.now(), 'Quotation', q.name, 'quote'));
        for (final a in await approvals(quotationId: q.id)) {
          if (a.decidedAt != null) ev.add(TimelineEvent(a.decidedAt!, 'Client ${a.status.toLowerCase()}', a.approver ?? '', 'approval', a.status));
        }
      }
    }
    for (final sh in await shippingOrders(leadId: lead.id)) {
      ev.add(TimelineEvent(sh.etd ?? DateTime.now(), 'Shipping ${sh.shipmentStatus?.toLowerCase() ?? ''}',
          sh.forwarder ?? sh.trackingNumber ?? '', 'shipping', sh.shipmentStatus));
    }
    ev.sort((a, b) => a.at.compareTo(b.at));
    return ev;
  }
}
