import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Minimal in-memory stand-in for /api/portal/* used by the tests (no network).
class FakeServer {
  final calls = <String>[];
  String password = 'temp-pass-1';
  bool mustChange = true;
  int tokenN = 0;
  String? validToken;
  final requests = <Map<String, dynamic>>[];
  final ships = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> greetings = [];
  Map<String, dynamic> prefs = {'email': true, 'push': true, 'emailAvailable': false, 'pushAvailable': false};

  http.Response _j(Object b, [int s = 200]) => http.Response(jsonEncode(b), s, headers: {'content-type': 'application/json'});
  Map<String, dynamic> get me => {'name': 'Asha', 'phone': '9876543210', 'email': null, 'mustChangePassword': mustChange, 'company': 'Asha Traders', 'city': 'Chennai'};

  late final client = MockClient((req) async {
    final p = req.url.path;
    calls.add('${req.method} $p');
    if (!p.startsWith('/api/portal/')) return _j({'error': 'staff endpoint called'}, 500);
    if (p == '/api/portal/auth/login') {
      final b = jsonDecode(req.body) as Map;
      if (b['phone'] != '9876543210' || b['password'] != password) return _j({'error': 'Invalid mobile number or password'}, 401);
      validToken = 'tok${++tokenN}';
      return _j({'token': validToken, 'customer': {'name': 'Asha', 'mustChangePassword': mustChange}});
    }
    if (req.headers['authorization'] != 'Bearer $validToken') return _j({'error': 'Please sign in again'}, 401);
    if (p == '/api/portal/me') return _j({'data': me});
    if (p == '/api/portal/me/password') {
      final b = jsonDecode(req.body) as Map;
      if (b['currentPassword'] != password) return _j({'error': 'Current password is wrong'}, 400);
      password = b['newPassword'] as String; mustChange = false; validToken = 'tok${++tokenN}';
      return _j({'token': validToken, 'data': me});
    }
    if (mustChange) return _j({'error': 'Please change your temporary password first', 'code': 'password_change'}, 403);
    if (p == '/api/portal/requests') return _j({'data': requests});
    if (p.startsWith('/api/portal/requests/')) return _j({'data': requests.firstWhere((r) => p.endsWith('/${r['id']}'))});
    if (p == '/api/portal/shipping-requests') return _j({'data': ships});
    if (p.startsWith('/api/portal/shipping-requests/')) return _j({'data': ships.firstWhere((r) => p.endsWith('/${r['id']}'))});
    if (p == '/api/portal/reject-reasons') return _j({'data': ['PRICE', 'OTHER']});
    if (p == '/api/portal/greetings') return _j({'data': greetings});
    if (p == '/api/portal/me/notifications') {
      if (req.method == 'PUT') prefs = {...prefs, ...(jsonDecode(req.body) as Map<String, dynamic>)};
      return _j({'data': prefs});
    }
    final acc = RegExp(r'^/api/portal/quotes/(\w+)/accept$').firstMatch(p);
    if (acc != null) {
      final r = requests.first; final q = (r['quotes'] as List).first as Map;
      q['status'] = 'ACCEPTED'; q['canDecide'] = false; r['quotesWaiting'] = 0;
      return _j({'data': r});
    }
    if (p.endsWith('/pdf')) return http.Response.bytes(utf8.encode('%PDF-1.4 fake'), 200, headers: {'content-type': 'application/pdf'});
    return _j({'error': 'Not found'}, 404);
  });
}

Map<String, dynamic> quoteRequest() => {
      'id': 'L1', 'type': 'SOURCING', 'reference': 'SE-2611-0001', 'product': 'Brass lamps', 'quantity': 500, 'unit': 'pcs', 'createdAt': '2026-11-01T05:30:00Z',
      'stage': 'QUOTE_READY', 'stageIndex': 2, 'closed': false, 'quotesWaiting': 1, 'files': [], 'timeline': [{'at': '2026-11-01T05:30:00Z', 'kind': 'CREATED', 'text': 'Request received'}],
      'quotes': [{'id': 'Q1', 'label': 'SE-2611-0001-Q1', 'product': 'Brass lamps', 'status': 'SENT', 'qty': 500, 'unitPrice': 120, 'currency': 'INR', 'total': 60000, 'moq': null,
        'leadTime': '30 days', 'validity': null, 'pdfUrl': '/api/portal/quotes/Q1/pdf', 'canDecide': true}],
      'orders': [{'id': 'O1', 'product': 'Brass lamps', 'qty': 500, 'value': 60000, 'currency': 'INR', 'paymentStatus': 'PARTIAL', 'createdAt': '2026-11-02T05:30:00Z', 'shipment': null}],
    };

Map<String, dynamic> freightShip() => {
      'id': 'S1', 'type': 'SHIPPING', 'reference': 'SH-2611-0001', 'kind': 'FREIGHT_ONLY', 'status': 'QUOTED', 'goods': 'Lamps', 'quantity': null, 'unit': null, 'destCity': 'Chennai',
      'createdAt': '2026-11-01T05:30:00Z', 'leadReference': null, 'quoteWaiting': true, 'tracking': null, 'canCancel': true, 'canReply': false, 'files': [], 'timeline': [],
      'freightQuotes': [{'id': 'F1', 'label': 'SH-2611-0001-F1', 'amount': 41500, 'currency': 'INR', 'mode': 'SEA', 'incoterm': null, 'transit': '25 days', 'validUntil': null,
        'note': null, 'status': 'SENT', 'createdAt': '2026-11-03T05:30:00Z', 'decidedAt': null, 'canDecide': true}],
    };
