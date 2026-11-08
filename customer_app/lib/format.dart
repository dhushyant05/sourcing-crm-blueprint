import 'package:intl/intl.dart';

/// Indian Standard Time formatting (all customer dates are shown in IST).
const ist = Duration(hours: 5, minutes: 30);
String when(Object? iso) {
  final d = DateTime.tryParse('${iso ?? ''}');
  if (d == null) return '';
  return '${DateFormat('dd MMM yyyy, hh:mm a').format(d.toUtc().add(ist))} IST';
}
String day(Object? ymd) {
  final d = DateTime.tryParse('${ymd ?? ''}');
  return d == null ? '—' : DateFormat('dd MMM yyyy').format(d);
}
final _inr = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _inr2 = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
String inr(Object? n) => n is num ? (n == n.roundToDouble() ? _inr.format(n) : _inr2.format(n)) : '—';
String money(Object? n, Object? cur) => n is num ? (cur == null || cur == 'INR' ? inr(n) : '$cur ${NumberFormat('#,##0.##').format(n)}') : '—';

const stages = [('RECEIVED', 'Received'), ('SOURCING', 'Sourcing'), ('QUOTE_READY', 'Quote ready'), ('DECIDED', 'Decided'), ('ORDER', 'Order'), ('SHIPPED', 'Shipped'), ('DELIVERED', 'Delivered')];
String stageLabel(Object? s) => stages.firstWhere((e) => e.$1 == s, orElse: () => ('$s', '$s')).$2;
const reasons = {'PRICE': 'Price too high', 'QUALITY': 'Quality / specification', 'LEAD_TIME': 'Delivery time', 'MOQ': 'Minimum quantity', 'SUPPLIER': 'Other source', 'NO_NEED': 'No longer needed', 'OTHER': 'Other reason'};
const units = ['pcs', 'kg', 'ton', 'm', 'sqm', 'sets', 'cartons', 'containers'];
const srStatus = {'SUBMITTED': 'Received', 'UNDER_REVIEW': 'Being reviewed', 'NEEDS_INFO': 'Info needed', 'QUOTED': 'Freight quote ready', 'ACCEPTED': 'Accepted',
  'PENDING': 'Awaiting booking', 'BOOKED': 'Booked', 'IN_TRANSIT': 'In transit', 'ARRIVED': 'Arrived', 'CUSTOMS': 'In customs', 'CLEARED': 'Customs cleared', 'OUT_FOR_DELIVERY': 'Out for delivery',
  'DELIVERED': 'Delivered', 'REJECTED': 'Declined', 'CANCELLED': 'Cancelled'};
const modes = [('', 'Not sure'), ('SEA', 'Sea'), ('AIR', 'Air'), ('EXPRESS', 'Courier / express'), ('ROAD', 'Road')];
const payment = {'PENDING': 'Payment pending', 'ADVANCE': 'Advance received', 'PARTIAL': 'Partly paid', 'PAID': 'Paid'};
/// Status shown to the customer: a sourced request follows its shipment once accepted.
String srShown(Map<String, dynamic> r) => r['status'] == 'ACCEPTED' && r['tracking'] is Map ? '${r['tracking']['stage']}' : '${r['status']}';
String fqStatus(Object? s) => switch (s) { 'SENT' => 'Waiting for you', 'ACCEPTED' => 'Accepted', 'REJECTED' => 'Declined', _ => 'Replaced' };
