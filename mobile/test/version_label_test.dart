import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:source_easy/ui/widgets/version_label.dart';

void main() {
  testWidgets('shows v<version> (<build>)', (t) async {
    final p = PackageInfo(appName: 'a', packageName: 'p', version: '0.3.6', buildNumber: '18');
    await t.pumpWidget(MaterialApp(home: Scaffold(bottomNavigationBar: VersionLabel(info: Future.value(p)))));
    await t.pumpAndSettle();
    expect(find.text('v0.3.6 (18)'), findsOneWidget);
  });
}
