import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'services/session.dart';
import 'ui/home_shell.dart';
import 'ui/screens/login_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(ChangeNotifierProvider(create: (_) => Session()..restore(), child: const SourceEasyApp()));
}

class SourceEasyApp extends StatelessWidget {
  const SourceEasyApp({super.key});

  static ThemeData theme(Brightness b) => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF3949AB), brightness: b),
        inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
      );

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Source Easy',
      debugShowCheckedModeBanner: false,
      theme: theme(Brightness.light),
      darkTheme: theme(Brightness.dark),
      home: Consumer<Session>(builder: (context, s, _) {
        if (s.restoring) return const Scaffold(body: Center(child: CircularProgressIndicator()));
        return s.signedIn ? const HomeShell() : const LoginScreen();
      }),
    );
  }
}
