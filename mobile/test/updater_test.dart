import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:source_easy/l10n/l10n.dart';
import 'package:source_easy/services/updater.dart';
import 'package:source_easy/ui/update_dialog.dart';

final apk = List<int>.generate(5000, (i) => i % 251);
Map<String, dynamic> manifest({int build = 4, int? minBuild, String? sha}) => {
      'version': '0.2.2', 'build': build, 'size': apk.length, 'sha256': sha ?? sha256.convert(apk).toString(),
      'url': '/download/source-easy.apk', if (minBuild != null) 'minBuild': minBuild,
      'notes': {'en': 'Faster sync', 'zh': '同步更快'},
    };

Updater updater(Map<String, dynamic> m, {int installed = 3}) => Updater(
      manifestUrl: 'https://sourceeasy.in/download/version.json',
      installedBuild: () async => installed,
      client: MockClient.streaming((req, _) async {
        if (req.url.path.endsWith('version.json')) return http.StreamedResponse(Stream.value(utf8.encode(jsonEncode(m))), 200);
        return http.StreamedResponse(Stream.fromIterable([apk.sublist(0, 2000), apk.sublist(2000)]), 200, contentLength: apk.length);
      }),
    );

void main() {
  test('parses manifest, resolves APK URL, picks notes by language', () {
    final i = UpdateInfo.fromJson(manifest(minBuild: 3), Uri.parse('https://sourceeasy.in/download/version.json'));
    expect(i.apkUrl.toString(), 'https://sourceeasy.in/download/source-easy.apk');
    expect(i.isNewerThan(3), isTrue);
    expect(i.isNewerThan(4), isFalse);
    expect(i.isForcedFor(2), isTrue);
    expect(i.isForcedFor(3), isFalse);
    expect(i.notesFor('zh'), '同步更快');
    expect(i.notesFor('en'), 'Faster sync');
  });

  test('check returns update only when remote build is newer', () async {
    expect(await updater(manifest(build: 4)).check(), isNotNull);
    expect(await updater(manifest(build: 3)).check(), isNull);
  });

  test('download reports progress and verifies sha256', () async {
    final dir = Directory.systemTemp.createTempSync('ota');
    final u = updater(manifest());
    final progress = <double?>[];
    final f = await u.download((await u.check())!, onProgress: progress.add, into: dir);
    expect(f.readAsBytesSync(), apk);
    expect(progress.last, 1.0);
    final bad = updater(manifest(sha: '00' * 32));
    await expectLater(bad.download((await bad.check())!, into: dir), throwsA(isA<UpdateCheckException>()));
  });

  for (final forced in [false, true]) {
    testWidgets('update dialog ${forced ? 'is non-dismissable when below minBuild' : 'offers Later'}', (t) async {
      final info = UpdateInfo.fromJson(manifest(minBuild: forced ? 4 : null), Uri.parse('https://x/download/version.json'));
      await t.pumpWidget(MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: UpdateDialog(info: info, updater: updater(manifest()), forced: forced)),
      ));
      expect(find.textContaining('0.2.2'), findsOneWidget);
      expect(find.text('Faster sync'), findsOneWidget);
      expect(find.text('Later'), forced ? findsNothing : findsOneWidget);
      expect(find.text(forced ? 'Update required' : 'Update available'), findsOneWidget);
    });
  }
}
