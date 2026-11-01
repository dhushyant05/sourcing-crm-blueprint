import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:source_easy/main.dart';
import 'package:source_easy/services/quote_pdf.dart';

void main() {
  test('quote PDF builds', () async {
    final bytes = await QuotePdf.build(
      QuoteData(
        quoteNo: 'AB12-CD',
        clientName: 'Acme Traders',
        product: 'Steel bottles 750ml',
        quantity: 500,
        unitPrice: 245.5,
        currency: 'INR',
        validUntil: DateTime(2026, 11, 15),
      ),
    );
    expect(String.fromCharCodes(bytes.take(4)), '%PDF');
    expect(bytes.length, greaterThan(1000));
  });

  test('quote PDF carries the shared lead reference', () async {
    final bytes = await QuotePdf.build(
      QuoteData(
        quoteNo: 'QT-1',
        leadRef: 'SE-2610-0002',
        clientName: 'Mehta Kitchenware',
        product: 'Bamboo boards',
        quantity: 1200,
        unitPrice: 150,
        currency: 'INR',
        validUntil: DateTime(2026, 11, 30),
      ),
    );
    expect(String.fromCharCodes(bytes.take(4)), '%PDF');
    final out = Platform.environment['QUOTE_PDF_OUT'];
    if (out != null) File(out).writeAsBytesSync(bytes);
  });

  testWidgets('Material 3 theme is enabled', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: SourceEasyApp.theme(Brightness.light),
        home: const Scaffold(),
      ),
    );
    expect(
      Theme.of(tester.element(find.byType(Scaffold))).useMaterial3,
      isTrue,
    );
  });
}
