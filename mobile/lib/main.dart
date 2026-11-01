import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'l10n/l10n.dart';
import 'services/session.dart';
import 'ui/home_shell.dart';
import 'ui/screens/login_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(ChangeNotifierProvider(create: (_) => Session()..restore(), child: const SourceEasyApp()));
}

class SourceEasyApp extends StatelessWidget {
  const SourceEasyApp({super.key});

  /// Matches the web dashboard: Source Easy logo blue brand accent, slate neutrals, Inter,
  /// 12-16px radii and soft, low-elevation surfaces.
  static const brand = Color(0xFF2A9FD6); // logo blue (gradient to #6CC04A green)

  static ThemeData theme(Brightness b) {
    final dark = b == Brightness.dark;
    final scheme = ColorScheme.fromSeed(
      seedColor: brand,
      brightness: b,
      primary: dark ? const Color(0xFF818CF8) : brand,
      surface: dark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
    );
    final card = dark ? const Color(0xFF111827) : Colors.white;
    final border = dark ? const Color(0xFF1F2937) : const Color(0xFFE2E8F0);
    final r12 = BorderRadius.circular(12);
    return ThemeData(
      useMaterial3: true,
      fontFamily: 'Inter',
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: TextStyle(fontFamily: 'Inter', fontSize: 18, fontWeight: FontWeight.w600, color: scheme.onSurface),
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: border)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(borderRadius: r12, borderSide: BorderSide(color: border)),
        enabledBorder: OutlineInputBorder(borderRadius: r12, borderSide: BorderSide(color: border)),
        focusedBorder: OutlineInputBorder(borderRadius: r12, borderSide: BorderSide(color: scheme.primary, width: 1.6)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(0, 48), shape: RoundedRectangleBorder(borderRadius: r12)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48), shape: RoundedRectangleBorder(borderRadius: r12)),
      ),
      chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)), side: BorderSide(color: border)),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 68,
        indicatorColor: scheme.primary.withValues(alpha: 0.14),
        indicatorShape: RoundedRectangleBorder(borderRadius: r12),
      ),
      listTileTheme: ListTileThemeData(shape: RoundedRectangleBorder(borderRadius: r12)),
      dividerTheme: DividerThemeData(color: border, space: 1),
      snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: RoundedRectangleBorder(borderRadius: r12)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<Session>().locale;
    return MaterialApp(
      title: 'Source Easy',
      locale: locale, // null → follow the device language
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      debugShowCheckedModeBanner: false,
      theme: theme(Brightness.light),
      darkTheme: theme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: Consumer<Session>(builder: (context, s, _) {
        if (s.restoring) return const Scaffold(body: Center(child: CircularProgressIndicator()));
        return s.signedIn ? const HomeShell() : const LoginScreen();
      }),
    );
  }
}
