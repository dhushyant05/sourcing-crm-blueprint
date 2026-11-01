import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:source_easy/core/roles.dart';
import 'package:source_easy/data/models/models.dart';
import 'package:source_easy/l10n/gen/app_localizations.dart';
import 'package:source_easy/services/session.dart';
import 'package:source_easy/ui/widgets/lead_workflow.dart';

Future<void> _fonts() async {
  await (FontLoader('Inter')..addFont(rootBundle.load('assets/fonts/NotoSans-Regular.ttf'))).load();
  await (FontLoader('NotoSC')..addFont(rootBundle.load('assets/fonts/NotoSansSC-GB2312.ttf'))).load();
  final icons = File('/home/box/sdk/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (icons.existsSync()) await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
}

Widget _app(Role role, Widget home, {Locale locale = const Locale('en')}) => ChangeNotifierProvider.value(
      value: Session()..role = role,
      child: MaterialApp(
        debugShowCheckedModeBanner: false, locale: locale,
        theme: ThemeData(useMaterial3: true, fontFamily: 'Inter', fontFamilyFallback: const ['NotoSC'], colorSchemeSeed: const Color(0xFF1E6BFF)),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: Scaffold(body: SingleChildScrollView(padding: const EdgeInsets.all(12), child: home)),
      ),
    );

void main() {
  final shot = Platform.environment['SHOT'] != null;
  final now = DateTime.now().toUtc();
  final sla = {'office': 'CHINA', 'startedAt': now.subtract(const Duration(hours: 3)).toIso8601String(), 'dueAt': now.add(const Duration(minutes: 40)).toIso8601String()};
  final lead = Lead.fromJson({'id': 'L1', 'name': 'SE-2611-0008', 'status': 'SOURCING', 'priority': true, 'sla': sla});
  final tl = {
    'progress': {'stage': 'SOURCING', 'index': 2, 'won': false, 'lost': false}, 'priority': true, 'sla': sla, 'settings': {'priorityMinutes': 240},
    'events': [
      {'kind': 'CREATED', 'at': now.subtract(const Duration(hours: 5)).toIso8601String(), 'by': 'Priya'},
      {'kind': 'QUEUED', 'at': now.subtract(const Duration(hours: 4)).toIso8601String(), 'data': {'office': 'CHINA'}},
      {'kind': 'ASSIGNED', 'at': now.subtract(const Duration(hours: 3)).toIso8601String(), 'data': {'to': 'Li Wei'}},
    ],
  };
  testWidgets('Lead workflow: progress, SLA clock, priority, timeline (EN + ZH)', (t) async {
    await _fonts();
    await t.binding.setSurfaceSize(const Size(400, 760));
    for (final loc in ['en', 'zh']) {
      await t.pumpWidget(_app(Role.superAdmin, Column(children: [SlaChip(sla, big: true), const SizedBox(height: 8), LeadWorkflow(lead: lead, initial: tl)]), locale: Locale(loc)));
      await t.pump();
      expect(find.byType(WorkflowProgress), findsOneWidget);
      expect(find.byType(SwitchListTile), findsOneWidget);
      if (shot) await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-workflow-$loc.png'));
    }
    await t.pumpWidget(const SizedBox()); // dispose SLA timers
  });
  testWidgets('Lost lead actions for India', (t) async {
    await _fonts();
    await t.binding.setSurfaceSize(const Size(400, 560));
    final lost = Lead.fromJson({'id': 'L2', 'name': 'SE-2611-0009', 'status': 'LOST', 'winLossReason': 'Price'});
    await t.pumpWidget(_app(Role.indiaAdmin, LostActions(lead: lost, onLead: (_) {}, openLead: (_) {})));
    await t.pump();
    expect(find.byKey(const Key('lost-actions')), findsOneWidget);
    if (shot) await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/android-lost.png'));
    await t.pumpWidget(_app(Role.chinaStaff, LostActions(lead: lost, onLead: (_) {}, openLead: (_) {})));
    expect(find.byKey(const Key('lost-actions')), findsNothing);
  });
}
