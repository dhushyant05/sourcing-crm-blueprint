import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// Small "v0.3.6 (18)" footer read from the installed package.
class VersionLabel extends StatelessWidget {
  const VersionLabel({super.key, this.info});
  final Future<PackageInfo>? info;
  static Future<PackageInfo>? _cached;
  static String format(PackageInfo p) => 'v${p.version} (${p.buildNumber})';
  @override
  Widget build(BuildContext context) => FutureBuilder<PackageInfo>(
        future: info ?? (_cached ??= PackageInfo.fromPlatform()),
        builder: (c, s) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Text(s.hasData ? format(s.data!) : '', key: const Key('app-version'), textAlign: TextAlign.center,
              style: Theme.of(c).textTheme.labelSmall?.copyWith(color: Theme.of(c).colorScheme.outline)),
        ),
      );
}
