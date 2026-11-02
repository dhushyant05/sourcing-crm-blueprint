import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import '../../services/session.dart';

/// Keeps a screen's data live: reloads on server change events (SSE `change`) of [liveTypes],
/// polls every [livePoll] while the screen is on top and the app is in the foreground, and reloads on app resume.
/// Bursts of events are coalesced into one reload.
mixin LiveRefresh<T extends StatefulWidget> on State<T> {
  Set<String> get liveTypes;
  /// When set, only events for this lead (or with no lead) trigger a reload.
  String? get liveLeadId => null;
  Duration get livePoll => const Duration(seconds: 15);
  void liveRefresh();

  Session? _lrSes;
  Timer? _lrPoll, _lrDebounce;
  _LrObserver? _lrObs;
  bool _lrFg = true;

  void startLive() {
    _lrSes = context.read<Session>()..lastChange.addListener(_lrOnChange);
    _lrObs = _LrObserver((s) {
      _lrFg = s == AppLifecycleState.resumed;
      if (_lrFg) _lrKick();
    });
    WidgetsBinding.instance.addObserver(_lrObs!);
    _lrPoll = Timer.periodic(livePoll, (_) { if (_lrVisible) liveRefresh(); });
  }

  bool get _lrVisible => mounted && _lrFg && (ModalRoute.of(context)?.isCurrent ?? true) && TickerMode.of(context);

  void _lrOnChange() {
    final c = _lrSes?.lastChange.value;
    if (c == null || !mounted || !liveTypes.contains(c['type'])) return;
    final lid = liveLeadId;
    if (lid != null && c['leadId'] != null && c['leadId'] != lid && c['id'] != lid) return;
    _lrKick();
  }

  void _lrKick() { _lrDebounce?.cancel(); _lrDebounce = Timer(const Duration(milliseconds: 400), () { if (mounted) liveRefresh(); }); }

  void stopLive() {
    _lrSes?.lastChange.removeListener(_lrOnChange);
    if (_lrObs != null) WidgetsBinding.instance.removeObserver(_lrObs!);
    _lrPoll?.cancel(); _lrDebounce?.cancel();
  }
}

class _LrObserver with WidgetsBindingObserver {
  _LrObserver(this.on);
  final void Function(AppLifecycleState) on;
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => on(state);
}
