import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

/// Optional PIN / fingerprint unlock. The PIN is never stored: only a salted, stretched SHA-256
/// (PBKDF2-HMAC-SHA256) in Keystore-backed secure storage. 5 wrong PINs wipe quick unlock and
/// the caller must fall back to a full password sign-in.
class QuickUnlock {
  QuickUnlock(this._s, {LocalAuthentication? auth}) : _auth = auth ?? LocalAuthentication();
  final FlutterSecureStorage _s;
  final LocalAuthentication _auth;
  static const maxAttempts = 5;
  static const _kHash = 'pin_hash', _kSalt = 'pin_salt', _kFails = 'pin_fails', _kBio = 'bio_on', _kOffered = 'pin_offered';
  static const keys = [_kHash, _kSalt, _kFails, _kBio];

  bool pinSet = false, bioOn = false;
  int fails = 0;

  Future<void> load() async {
    final m = await _s.readAll();
    pinSet = (m[_kHash] ?? '').isNotEmpty && (m[_kSalt] ?? '').isNotEmpty;
    bioOn = pinSet && m[_kBio] == '1';
    fails = int.tryParse(m[_kFails] ?? '') ?? 0;
  }

  static bool validPin(String p) => RegExp(r'^\d{4,6}$').hasMatch(p);

  /// PBKDF2-HMAC-SHA256, 20k rounds (fast enough on low-end phones, slows offline guessing).
  static String hash(String pin, List<int> salt, {int rounds = 20000}) {
    final mac = Hmac(sha256, utf8.encode(pin));
    var u = mac.convert([...salt, 0, 0, 0, 1]).bytes;
    final out = List<int>.from(u);
    for (var i = 1; i < rounds; i++) { u = mac.convert(u).bytes; for (var j = 0; j < out.length; j++) { out[j] ^= u[j]; } }
    return base64Encode(out);
  }

  Future<void> setPin(String pin) async {
    if (!validPin(pin)) throw ArgumentError('PIN must be 4-6 digits');
    final r = Random.secure(), salt = List<int>.generate(16, (_) => r.nextInt(256));
    await _s.write(key: _kSalt, value: base64Encode(salt));
    await _s.write(key: _kHash, value: hash(pin, salt));
    await _s.write(key: _kFails, value: '0');
    await _s.write(key: _kOffered, value: '1');
    pinSet = true; fails = 0;
  }

  /// true = correct. On the 5th wrong PIN quick unlock is cleared (returns false, [lockedOut] becomes true).
  Future<bool> check(String pin) async {
    final m = await _s.readAll();
    final salt = m[_kSalt], h = m[_kHash];
    if (salt == null || h == null) return false;
    if (hash(pin, base64Decode(salt)) == h) { fails = 0; await _s.write(key: _kFails, value: '0'); return true; }
    fails++;
    if (fails >= maxAttempts) { await clear(); fails = maxAttempts; } else { await _s.write(key: _kFails, value: '$fails'); }
    return false;
  }
  bool get lockedOut => fails >= maxAttempts;
  int get attemptsLeft => max(0, maxAttempts - fails);

  Future<void> clear() async { for (final k in keys) { try { await _s.delete(key: k); } catch (_) {} } pinSet = false; bioOn = false; }

  Future<bool> offered() async => (await _s.read(key: _kOffered)) == '1';
  Future<void> markOffered() => _s.write(key: _kOffered, value: '1');

  /// Fingerprint/face available and enrolled on this phone.
  Future<bool> bioAvailable() async {
    try { return await _auth.canCheckBiometrics && (await _auth.getAvailableBiometrics()).isNotEmpty; } catch (_) { return false; }
  }
  Future<void> setBio(bool on) async { await _s.write(key: _kBio, value: on ? '1' : '0'); bioOn = on && pinSet; }

  /// Biometric prompt (strong biometrics preferred; Android falls back to weak/class 2 where that is all the phone has).
  Future<bool> bioUnlock(String reason) async {
    try { return await _auth.authenticate(localizedReason: reason, biometricOnly: true, persistAcrossBackgrounding: true); } catch (_) { return false; }
  }
}
