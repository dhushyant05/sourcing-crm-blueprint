// Plain models mapped from Twenty's GraphQL records.
// Composite fields (PHONES, EMAILS, CURRENCY, LINKS) are flattened here.

double? _num(dynamic v) => v == null ? null : (v as num).toDouble();
DateTime? _date(dynamic v) => v == null ? null : DateTime.tryParse(v as String);
String? _link(dynamic v) => v is Map ? v['primaryLinkUrl'] as String? : null;
double? _currency(dynamic v) =>
    v is Map && v['amountMicros'] != null ? (v['amountMicros'] as num) / 1e6 : null;

class Lead {
  Lead({
    required this.id,
    required this.name,
    this.clientName,
    this.contactPhone,
    this.contactEmail,
    this.productInterest,
    this.quantity,
    this.targetPrice,
    this.targetCurrency,
    this.sourceChannel,
    this.status = 'NEW',
    this.assignedOffice,
    this.assignedChinaAgent,
    this.chatwootUrl,
    this.winLossReason,
    this.createdAt,
    this.pendingSync = false,
    this.unit,
    this.deliveryCity,
    this.referenceUrl,
    this.enquiryMessage,
    this.leadRef,
    this.contactName,
    this.attachmentCount,
    this.summary,
    this.raisedBy, this.raisedByName, this.assignedTo, this.assignedToName, this.ownerOffice,
  });
  final String? raisedBy, raisedByName, assignedTo, assignedToName, ownerOffice;
  String get owner => ownerOffice ?? (assignedOffice == 'CHINA' ? 'CHINA' : 'INDIA');
  final String id;
  final String name;
  final String? unit, deliveryCity, referenceUrl, enquiryMessage, leadRef, contactName;
  final int? attachmentCount;
  final String? summary;
  final String? clientName, contactPhone, contactEmail, productInterest;
  final double? quantity, targetPrice;
  final String? targetCurrency, sourceChannel;
  final String status;
  final String? assignedOffice, assignedChinaAgent, chatwootUrl, winLossReason;
  final DateTime? createdAt;
  final bool pendingSync;

  static const gqlFields = '''id leadRef name createdAt clientName productInterest quantity status
    sourceChannel assignedOffice assignedChinaAgent winLossReason summary attachmentCount
    contactPhone { primaryPhoneNumber primaryPhoneCountryCode }
    contactEmail { primaryEmail }
    targetPrice { amountMicros currencyCode }
    chatwootConversationUrl { primaryLinkUrl }''';

  /// Fields safe for China staff (no customer details).
  static const gqlFieldsRedacted = '''id leadRef name createdAt productInterest quantity status
    assignedOffice assignedChinaAgent summary attachmentCount''';

  factory Lead.fromJson(Map<String, dynamic> j) => Lead(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        clientName: j['clientName'] as String?,
        contactPhone: j['contactPhone'] is Map
            ? '${j['contactPhone']['primaryPhoneCallingCode'] ?? j['contactPhone']['primaryPhoneCountryCode'] ?? ''} ${j['contactPhone']['primaryPhoneNumber'] ?? ''}'.trim()
            : null,
        contactEmail: j['contactEmail'] is Map ? j['contactEmail']['primaryEmail'] as String? : null,
        productInterest: j['productInterest'] as String?,
        quantity: _num(j['quantity']),
        targetPrice: _currency(j['targetPrice']),
        targetCurrency: j['targetPrice'] is Map ? j['targetPrice']['currencyCode'] as String? : null,
        sourceChannel: j['sourceChannel'] as String?,
        status: (j['status'] as String?) ?? 'NEW',
        assignedOffice: j['assignedOffice'] as String?,
        assignedChinaAgent: j['assignedChinaAgent'] as String?,
        chatwootUrl: _link(j['chatwootConversationUrl']),
        winLossReason: j['winLossReason'] as String?,
        createdAt: _date(j['createdAt']),
        pendingSync: j['_pending'] == true,
        unit: j['unit'] as String?,
        deliveryCity: j['deliveryCity'] as String?,
        referenceUrl: _link(j['referenceUrl']),
        enquiryMessage: j['enquiryMessage'] as String?,
        leadRef: j['leadRef'] as String?,
        contactName: j['contactName'] as String?,
        attachmentCount: _num(j['attachmentCount'])?.toInt(),
        summary: j['summary'] as String?,
        raisedBy: j['raisedBy'] as String?, raisedByName: j['raisedByName'] as String?,
        assignedTo: j['assignedTo'] as String?, assignedToName: j['assignedToName'] as String?,
        ownerOffice: j['ownerOffice'] as String?,
      );
}

/// A photo/document a client attached to a website enquiry. Bytes are fetched with the staff token.
class LeadAttachment {
  LeadAttachment({required this.id, required this.name, required this.mime, required this.size, this.createdAt});
  final String id, name, mime;
  final int size;
  final DateTime? createdAt;
  bool get isImage => RegExp(r'^image/(jpeg|png|webp)$').hasMatch(mime);
  bool get isVideo => mime.startsWith('video/') || RegExp(r'\.(mp4|m4v|mov|3gp|webm|mkv)$', caseSensitive: false).hasMatch(name);
  factory LeadAttachment.fromJson(Map<String, dynamic> j) => LeadAttachment(
        id: j['id'] as String, name: (j['name'] as String?) ?? 'file', mime: (j['mime'] as String?) ?? 'application/octet-stream',
        size: (j['size'] as num?)?.toInt() ?? 0, createdAt: _date(j['createdAt']));
}

class SourcingRequest {
  SourcingRequest({
    required this.id,
    required this.name,
    this.productDescription,
    this.quantity,
    this.targetPrice,
    this.deadline,
    this.assignedChinaAgent,
    this.sampleStatus,
    this.status,
    this.chatwootConversationId,
    this.leadId,
    this.createdAt,
    this.leadRef,
  });
  final String id, name;
  /// Shared lead reference (SE-YYMM-NNNN), copied from the lead by the server.
  final String? leadRef;
  final String? productDescription;
  final double? quantity, targetPrice;
  final DateTime? deadline;
  final String? assignedChinaAgent, sampleStatus, status;
  final int? chatwootConversationId;
  final String? leadId;
  final DateTime? createdAt;

  static const gqlFields = '''id name createdAt productDescription quantity deadline
    assignedChinaAgent sampleStatus status chatwootConversationId leadId
    targetPrice { amountMicros currencyCode }''';

  factory SourcingRequest.fromJson(Map<String, dynamic> j) => SourcingRequest(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        productDescription: j['productDescription'] as String?,
        quantity: _num(j['quantity']),
        targetPrice: _currency(j['targetPrice']),
        deadline: _date(j['deadline']),
        assignedChinaAgent: j['assignedChinaAgent'] as String?,
        sampleStatus: j['sampleStatus'] as String?,
        status: j['status'] as String?,
        chatwootConversationId: (j['chatwootConversationId'] as num?)?.toInt(),
        leadId: j['leadId'] as String?,
        createdAt: _date(j['createdAt']),
        leadRef: j['leadRef'] as String?,
      );
}

class Supplier {
  Supplier({required this.id, required this.name, this.phone, this.wechatId, this.notes});
  final String id, name;
  final String? phone, wechatId, notes;
  static const gqlFields = 'id name wechatId notes phone { primaryPhoneNumber primaryPhoneCountryCode }';
  factory Supplier.fromJson(Map<String, dynamic> j) => Supplier(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        phone: j['phone'] is Map ? j['phone']['primaryPhoneNumber'] as String? : null,
        wechatId: j['wechatId'] as String?,
        notes: j['notes'] as String?,
      );
}

class Quotation {
  Quotation({
    required this.id,
    required this.name,
    required this.unitCost,
    required this.currency,
    this.totalCost,
    this.quantity,
    this.clientUnitPrice,
    this.clientCurrency,
    this.validityDate,
    this.sourcingRequestId,
    this.supplierName,
    this.leadRef,
  });
  final String id, name;
  final String? leadRef;
  final double unitCost;
  /// Supplier cost currency (USD/CNY/INR) as entered by China. Never converted.
  final String currency;
  final double? totalCost, quantity, clientUnitPrice;
  /// Client price currency as entered by India. Independent of [currency].
  final String? clientCurrency;
  final DateTime? validityDate;
  final String? sourcingRequestId, supplierName;

  static const gqlFields = '''id name unitCost totalCost currency clientUnitPrice clientCurrency
    validityDate sourcingRequestId''';
  static const gqlFieldsIndia = '''id name clientUnitPrice clientCurrency validityDate sourcingRequestId''';

  double get effectiveQuantity =>
      quantity ?? (totalCost != null && unitCost > 0 ? totalCost! / unitCost : 1);

  factory Quotation.fromJson(Map<String, dynamic> j) => Quotation(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        unitCost: _num(j['unitCost']) ?? 0,
        currency: (j['currency'] as String?) ?? 'CNY',
        totalCost: _num(j['totalCost']),
        clientUnitPrice: _num(j['clientUnitPrice']),
        clientCurrency: j['clientCurrency'] as String?,
        validityDate: _date(j['validityDate']),
        sourcingRequestId: j['sourcingRequestId'] as String?,
        supplierName: j['supplier'] is Map ? j['supplier']['name'] as String? : null,
        leadRef: j['leadRef'] as String?,
      );
}

class ClientApproval {
  ClientApproval({required this.id, required this.status, this.approver, this.decidedAt, this.notes, this.quotationId});
  final String id, status;
  final String? approver, notes, quotationId;
  final DateTime? decidedAt;
  static const gqlFields = 'id status approver decidedAt notes quotationId';
  factory ClientApproval.fromJson(Map<String, dynamic> j) => ClientApproval(
        id: j['id'] as String,
        status: (j['status'] as String?) ?? 'PENDING',
        approver: j['approver'] as String?,
        decidedAt: _date(j['decidedAt']),
        notes: j['notes'] as String?,
        quotationId: j['quotationId'] as String?,
      );
}

class ShippingOrder {
  ShippingOrder({
    required this.id,
    required this.name,
    this.forwarder,
    this.trackingNumber,
    this.containerType,
    this.etd,
    this.eta,
    this.customsStatus,
    this.shipmentStatus,
    this.currentLocation,
    this.latitude,
    this.longitude,
    this.leadId,
    this.leadRef,
  });
  final String id, name;
  final String? leadRef;
  final String? forwarder, trackingNumber, containerType, customsStatus, shipmentStatus, currentLocation, leadId;
  final DateTime? etd, eta;
  final double? latitude, longitude;
  static const gqlFields = '''id name forwarder trackingNumber containerType etd eta customsStatus
    shipmentStatus currentLocation latitude longitude leadId''';
  factory ShippingOrder.fromJson(Map<String, dynamic> j) => ShippingOrder(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        forwarder: j['forwarder'] as String?,
        trackingNumber: j['trackingNumber'] as String?,
        containerType: j['containerType'] as String?,
        etd: _date(j['etd']),
        eta: _date(j['eta']),
        customsStatus: j['customsStatus'] as String?,
        shipmentStatus: j['shipmentStatus'] as String?,
        currentLocation: j['currentLocation'] as String?,
        latitude: _num(j['latitude']),
        longitude: _num(j['longitude']),
        leadId: j['leadId'] as String?,
        leadRef: j['leadRef'] as String?,
      );
}

/// One entry in the lead detail handoff timeline.
class TimelineEvent {
  TimelineEvent(this.at, this.title, this.subtitle, this.kind, [this.code]);
  final DateTime at;
  final String title, subtitle, kind;
  /// Status code (approval / shipment) so the UI can show it in the user's language.
  final String? code;
}

class ChatMessage {
  ChatMessage({required this.id, required this.content, required this.outgoing, required this.sender, required this.at});
  final int id;
  final String content, sender;
  final bool outgoing;
  final DateTime at;
}

class StaffLite {
  StaffLite(this.id, this.name, this.role);
  final String id, name, role;
  factory StaffLite.fromJson(Map<String, dynamic> j) => StaffLite(j['id'] as String, (j['name'] as String?) ?? '', (j['role'] as String?) ?? '');
}

/// Server notification. Carries only the SE reference + product summary (never customer details).
class AppNotification {
  AppNotification({required this.id, required this.leadId, this.leadRef, this.product, required this.kind, this.office, this.byName, this.createdAt, this.read = false});
  final String id, leadId, kind;
  final String? leadRef, product, office, byName;
  final DateTime? createdAt;
  final bool read;
  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: '${j['id']}', leadId: j['leadId'] as String, leadRef: j['leadRef'] as String?, product: j['product'] as String?,
        kind: (j['kind'] as String?) ?? 'ASSIGNED', office: j['office'] as String?, byName: j['byName'] as String?,
        createdAt: _date(j['createdAt']), read: j['read'] == true || j['readAt'] != null);
}

/// China-side supplier for lead quotes (never sent to India by the server).
class QuoteSupplier {
  QuoteSupplier({required this.id, required this.name, this.contact, this.phone, this.wechat, this.city});
  final String id, name;
  final String? contact, phone, wechat, city;
  factory QuoteSupplier.fromJson(Map<String, dynamic> j) => QuoteSupplier(id: j['id'] as String, name: (j['name'] as String?) ?? '',
      contact: j['contact'] as String?, phone: j['phone'] as String?, wechat: j['wechat'] as String?, city: j['city'] as String?);
}

/// A supplier quote on a lead. India receives it without supplier fields and with neutral file names.
class LeadQuote {
  LeadQuote({required this.id, required this.product, required this.unitPrice, required this.currency, this.label, this.moq, this.leadTime,
      this.validity, this.notes, this.clientPrice, this.clientCurrency, this.clientNotes, this.supplierId, this.supplier, this.createdByName,
      this.canEdit = false, this.files = const [], this.status = 'DRAFT', this.sentAt, this.decidedAt, this.rejectReason, this.shipCost, this.shipCurrency,
      this.shipTerm, this.shipMode, this.shipPort, this.shipTransit, this.cq, this.cqTotals, this.pdfUrl, this.leadId, this.leadRef, this.leadStatus,
      this.assignedToName, this.ownerOffice, this.orderId});
  final String id, product, currency, status;
  final String? sentAt, decidedAt, rejectReason, shipCurrency, shipTerm, shipMode, shipPort, shipTransit, pdfUrl, leadId, leadRef, leadStatus, assignedToName, ownerOffice, orderId;
  final double? shipCost;
  final Map<String, dynamic>? cq, cqTotals;
  final double unitPrice;
  final String? label, moq, leadTime, validity, notes, clientCurrency, clientNotes, supplierId, createdByName;
  final double? clientPrice;
  final QuoteSupplier? supplier;
  final bool canEdit;
  final List<LeadAttachment> files;
  factory LeadQuote.fromJson(Map<String, dynamic> j) => LeadQuote(
        id: j['id'] as String, product: (j['product'] as String?) ?? '', unitPrice: _num(j['unitPrice']) ?? 0, currency: (j['currency'] as String?) ?? 'USD',
        label: j['label'] as String?, moq: j['moq'] as String?, leadTime: j['leadTime'] as String?, validity: j['validity'] as String?, notes: j['notes'] as String?,
        clientPrice: _num(j['clientPrice']), clientCurrency: j['clientCurrency'] as String?, clientNotes: j['clientNotes'] as String?,
        supplierId: j['supplierId'] as String?, supplier: j['supplier'] is Map ? QuoteSupplier.fromJson((j['supplier'] as Map).cast<String, dynamic>()) : null,
        createdByName: j['createdByName'] as String?, canEdit: j['canEdit'] == true,
        files: ((j['files'] as List?) ?? []).cast<Map<String, dynamic>>().map(LeadAttachment.fromJson).toList(),
        status: (j['status'] as String?) ?? 'DRAFT', sentAt: j['sentAt'] as String?, decidedAt: j['decidedAt'] as String?, rejectReason: j['rejectReason'] as String?,
        shipCost: _num(j['shipCost']), shipCurrency: j['shipCurrency'] as String?, shipTerm: j['shipTerm'] as String?, shipMode: j['shipMode'] as String?,
        shipPort: j['shipPort'] as String?, shipTransit: j['shipTransit'] as String?,
        cq: (j['cq'] as Map?)?.cast<String, dynamic>(), cqTotals: (j['cqTotals'] as Map?)?.cast<String, dynamic>(), pdfUrl: j['pdfUrl'] as String?,
        leadId: j['leadId'] as String?, leadRef: j['leadRef'] as String?, leadStatus: j['leadStatus'] as String?, assignedToName: j['assignedToName'] as String?,
        ownerOffice: j['ownerOffice'] as String?, orderId: j['orderId'] as String?);
}

/// An order created from an accepted customer quote. Fields the caller may not see are null (server-redacted).
class SeOrder {
  SeOrder(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get leadId => j['leadId'] as String;
  String? get leadRef => j['leadRef'] as String?;
  String get product => (j['product'] as String?) ?? '';
  double get qty => _num(j['qty']) ?? 0;
  String get production => (j['production'] as String?) ?? 'NEW';
  String get indiaStatus => (j['indiaStatus'] as String?) ?? 'NONE';
  String? get paymentStatus => j['paymentStatus'] as String?;
  String? get tracking => j['tracking'] as String?;
  String? get container => j['container'] as String?;
  String? get etd => j['etd'] as String?;
  String? get eta => j['eta'] as String?;
  String? get expectedShip => j['expectedShip'] as String?;
  String? get customer => j['customer'] as String?;
  String? get leadStatus => j['leadStatus'] as String?;
  double? get agreedPrice => _num(j['agreedPrice']);
  double? get advance => _num(j['advance']);
  double? get total => _num(j['total']);
  double? get unitPrice => _num(j['unitPrice']);
  String? get currency => j['currency'] as String?;
  String? get supplierName => (j['supplier'] as Map?)?['name'] as String?;
}
