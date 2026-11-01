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

  Future<List<Lead>> leads({String? office, String? status}) async {
    final filter = <String, dynamic>{
      if (office != null) 'assignedOffice': {'eq': office},
      if (status != null) 'status': {'eq': status},
    };
    final rows = await _read('leads:$office:$status', 'leads', _leadFields, filter: filter.isEmpty ? null : filter);
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
      String? sourceChannel}) {
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
      'status': 'NEW',
      'assignedOffice': 'INDIA',
      'office': 'BOTH',
    });
  }

  /// Enquiry photos/documents (India side + super admin only; the server enforces this too).
  Future<List<LeadAttachment>> attachments(String leadId) async {
    if (!perms.canSeeCustomerDetails) return [];
    final j = await api.send('GET', '/api/leads/${Uri.encodeComponent(leadId)}/attachments') as Map<String, dynamic>;
    return ((j['data'] as List?) ?? []).cast<Map<String, dynamic>>().map(LeadAttachment.fromJson).toList();
  }

  Future<List<int>> attachmentBytes(String leadId, LeadAttachment a) =>
      api.getBytes('/api/leads/${Uri.encodeComponent(leadId)}/attachments/${Uri.encodeComponent(a.id)}');

  Future<WriteResult> updateLead(String id, Map<String, dynamic> data) => _write('lead', data, id: id);

  /// Step 2: hand a lead to a China agent.
  Future<WriteResult> assignToChina(String leadId, String agent) =>
      updateLead(leadId, {'assignedChinaAgent': agent, 'assignedOffice': 'CHINA', 'status': 'ASSIGNED'});

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
