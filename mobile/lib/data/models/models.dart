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
  });
  final String id;
  final String name;
  final String? clientName, contactPhone, contactEmail, productInterest;
  final double? quantity, targetPrice;
  final String? targetCurrency, sourceChannel;
  final String status;
  final String? assignedOffice, assignedChinaAgent, chatwootUrl, winLossReason;
  final DateTime? createdAt;
  final bool pendingSync;

  static const gqlFields = '''id name createdAt clientName productInterest quantity status
    sourceChannel assignedOffice assignedChinaAgent winLossReason
    contactPhone { primaryPhoneNumber primaryPhoneCountryCode }
    contactEmail { primaryEmail }
    targetPrice { amountMicros currencyCode }
    chatwootConversationUrl { primaryLinkUrl }''';

  /// Fields safe for China staff (no customer details).
  static const gqlFieldsRedacted = '''id name createdAt productInterest quantity status
    assignedOffice assignedChinaAgent''';

  factory Lead.fromJson(Map<String, dynamic> j) => Lead(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        clientName: j['clientName'] as String?,
        contactPhone: j['contactPhone'] is Map
            ? '${j['contactPhone']['primaryPhoneCountryCode'] ?? ''} ${j['contactPhone']['primaryPhoneNumber'] ?? ''}'.trim()
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
      );
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
  });
  final String id, name;
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
    this.exchangeRateUsed,
    this.inrEquivalent,
    this.clientUnitPriceInr,
    this.validityDate,
    this.sourcingRequestId,
    this.supplierName,
  });
  final String id, name;
  final double unitCost;
  final String currency; // CNY or USD as quoted
  final double? totalCost, quantity, exchangeRateUsed, inrEquivalent, clientUnitPriceInr;
  final DateTime? validityDate;
  final String? sourcingRequestId, supplierName;

  static const gqlFields = '''id name unitCost totalCost currency exchangeRateUsed inrEquivalent
    clientUnitPriceInr validityDate sourcingRequestId''';
  static const gqlFieldsIndia = '''id name currency inrEquivalent clientUnitPriceInr
    exchangeRateUsed validityDate sourcingRequestId''';

  double get effectiveQuantity =>
      quantity ?? (totalCost != null && unitCost > 0 ? totalCost! / unitCost : 1);

  factory Quotation.fromJson(Map<String, dynamic> j) => Quotation(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        unitCost: _num(j['unitCost']) ?? 0,
        currency: (j['currency'] as String?) ?? 'CNY',
        totalCost: _num(j['totalCost']),
        exchangeRateUsed: _num(j['exchangeRateUsed']),
        inrEquivalent: _num(j['inrEquivalent']),
        clientUnitPriceInr: _num(j['clientUnitPriceInr']),
        validityDate: _date(j['validityDate']),
        sourcingRequestId: j['sourcingRequestId'] as String?,
        supplierName: j['supplier'] is Map ? j['supplier']['name'] as String? : null,
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
  });
  final String id, name;
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
      );
}

class ExchangeRate {
  ExchangeRate({required this.id, required this.pair, required this.rate, this.source, this.manual = false, this.setBy, this.effectiveDate});
  final String id, pair;
  final double rate;
  final String? source, setBy;
  final bool manual;
  final DateTime? effectiveDate;
  static const gqlFields = 'id currencyPair rate source isManualOverride setBy effectiveDate createdAt';
  factory ExchangeRate.fromJson(Map<String, dynamic> j) => ExchangeRate(
        id: j['id'] as String,
        pair: (j['currencyPair'] as String?) ?? '',
        rate: _num(j['rate']) ?? 0,
        source: j['source'] as String?,
        manual: j['isManualOverride'] == true,
        setBy: j['setBy'] as String?,
        effectiveDate: _date(j['effectiveDate']),
      );
}

/// One entry in the lead detail handoff timeline.
class TimelineEvent {
  TimelineEvent(this.at, this.title, this.subtitle, this.kind);
  final DateTime at;
  final String title, subtitle, kind;
}

class ChatMessage {
  ChatMessage({required this.id, required this.content, required this.outgoing, required this.sender, required this.at});
  final int id;
  final String content, sender;
  final bool outgoing;
  final DateTime at;
}
