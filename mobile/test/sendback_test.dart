import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/models/models.dart';
import 'package:source_easy/l10n/gen/app_localizations.dart';
import 'package:source_easy/services/session.dart';
import 'package:source_easy/ui/widgets/lead_workflow.dart';

Widget _app(Role role, Widget home, {Locale locale = const Locale('en')}) => ChangeNotifierProvider.value(
      value: Session()..role = role,
      child: MaterialApp(locale: locale, supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: Scaffold(body: SingleChildScrollView(child: home))),
    );

void main() {
  final atChina = Lead.fromJson({'id': 'L1', 'name': 'SE-2611-0001', 'status': 'SOURCING', 'assignedOffice': 'CHINA', 'ownerOffice': 'CHINA'});
  final back = Lead.fromJson({'id': 'L1', 'name': 'SE-2611-0001', 'status': 'SOURCING', 'assignedOffice': 'INDIA', 'ownerOffice': 'INDIA',
    'sendBack': {'side': 'INDIA', 'note': 'Need drawing + material grade', 'at': '2026-11-04T10:00:00Z', 'byName': 'Li'}});

  testWidgets('China sees "Send back to India"; note is required; India sees banner + re-send', (t) async {
    await t.pumpWidget(_app(Role.chinaStaff, SendBackCard(lead: atChina, onLead: (_) {})));
    expect(find.byKey(const Key('sb-to-india')), findsOneWidget);
    await t.tap(find.byKey(const Key('sb-to-india')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('sb-privacy')), findsOneWidget);
    await t.tap(find.byKey(const Key('sb-submit')));
    await t.pump();
    expect(find.text('Please write a note'), findsOneWidget);

    await t.pumpWidget(_app(Role.indiaStaff, SendBackCard(lead: atChina, onLead: (_) {})));
    expect(find.byKey(const Key('sb-to-india')), findsNothing);

    await t.pumpWidget(_app(Role.indiaStaff, SendBackCard(lead: back, onLead: (_) {})));
    expect(find.byKey(const Key('sb-banner')), findsOneWidget);
    expect(find.textContaining('Need drawing'), findsOneWidget);
    expect(find.byKey(const Key('sb-resend')), findsOneWidget);

    await t.pumpWidget(_app(Role.chinaStaff, SendBackCard(lead: back, onLead: (_) {}), locale: const Locale('zh')));
    expect(find.byKey(const Key('sb-banner')), findsOneWidget);
    expect(find.byKey(const Key('sb-resend')), findsNothing);
  });

  test('models parse sendBack and quote revision', () {
    final q = LeadQuote.fromJson({'id': 'q', 'revision': 2, 'revRequest': {'note': 'cheaper'}});
    expect(q.revision, 2);
    expect(q.revRequest?['note'], 'cheaper');
    expect(back.sendBack?['side'], 'INDIA');
  });
}
