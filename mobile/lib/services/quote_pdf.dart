import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';

import '../core/currency.dart';

class QuoteData {
  QuoteData({required this.quoteNo, required this.clientName, required this.product,
      required this.quantity, required this.unitPrice, required this.currency,
      this.validUntil, this.notes, DateTime? date})
      : date = date ?? DateTime.now();
  final String quoteNo, clientName, product, currency;
  final double quantity, unitPrice;
  final DateTime? validUntil;
  final String? notes;
  final DateTime date;
  double get total => quantity * unitPrice;
}

/// Builds the client-facing quote PDF. It never contains supplier names or
/// supplier costs — only the client price, in the currency it was entered in.
class QuotePdf {
  static Future<Uint8List> build(QuoteData q) async {
    final df = DateFormat('dd MMM yyyy');
    // Built-in Helvetica has no ₹ glyph; bundled Noto Sans covers ₹, ¥ and \$.
    final theme = pw.ThemeData.withFont(
      base: pw.Font.ttf(await rootBundle.load('assets/fonts/NotoSans-Regular.ttf')),
      bold: pw.Font.ttf(await rootBundle.load('assets/fonts/NotoSans-Bold.ttf')),
      // Chinese client/product names: Noto Sans SC subset to GB2312 (~6.8k common hanzi, 2.2 MB).
      fontFallback: [pw.Font.ttf(await rootBundle.load('assets/fonts/NotoSansSC-GB2312.ttf'))],
    );
    final doc = pw.Document(title: 'Quotation ${q.quoteNo}', author: 'Source Easy', theme: theme);
    // Shown exactly in the currency India entered — never converted.
    String money(double v) => formatMoneyCode(v, q.currency);
    doc.addPage(pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(40),
      build: (ctx) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Text('Source Easy', style: pw.TextStyle(fontSize: 26, fontWeight: pw.FontWeight.bold, color: PdfColors.indigo)),
            pw.Text('sourceeasy.in'),
          ]),
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
            pw.Text('QUOTATION', style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold)),
            pw.Text('No. ${q.quoteNo}'),
            pw.Text('Date: ${df.format(q.date)}'),
            if (q.validUntil != null) pw.Text('Valid until: ${df.format(q.validUntil!)}'),
          ]),
        ]),
        pw.SizedBox(height: 30),
        pw.Text('Prepared for', style: const pw.TextStyle(color: PdfColors.grey700)),
        pw.Text(q.clientName, style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 20),
        pw.TableHelper.fromTextArray(
          headers: ['Product', 'Qty', 'Unit price', 'Amount'],
          data: [[q.product, NumberFormat('#,##0').format(q.quantity), money(q.unitPrice), money(q.total)]],
          headerStyle: pw.TextStyle(fontWeight: pw.FontWeight.bold, color: PdfColors.white),
          headerDecoration: const pw.BoxDecoration(color: PdfColors.indigo),
          cellAlignments: {1: pw.Alignment.centerRight, 2: pw.Alignment.centerRight, 3: pw.Alignment.centerRight},
        ),
        pw.SizedBox(height: 10),
        pw.Align(
          alignment: pw.Alignment.centerRight,
          child: pw.Text('Total: ${money(q.total)}', style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold)),
        ),
        if (q.notes != null && q.notes!.isNotEmpty) ...[pw.SizedBox(height: 20), pw.Text(q.notes!)],
        pw.Spacer(),
        pw.Text('Prices are subject to change after the validity date. Freight, duties and taxes extra unless stated.',
            style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
      ]),
    ));
    return doc.save();
  }

  static Future<File> save(QuoteData q, Uint8List bytes) async {
    final dir = await getTemporaryDirectory();
    final safe = q.quoteNo.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final f = File('${dir.path}/SourceEasy_Quote_$safe.pdf');
    return f.writeAsBytes(bytes, flush: true);
  }

  /// Opens the Android share sheet; the user picks WhatsApp (no API integration).
  static Future<void> share(QuoteData q) async {
    final file = await save(q, await build(q));
    await SharePlus.instance.share(ShareParams(
      files: [XFile(file.path, mimeType: 'application/pdf')],
      text: 'Quotation ${q.quoteNo} for ${q.product} — ${formatMoney(q.total, q.currency)}',
      subject: 'Source Easy quotation ${q.quoteNo}',
    ));
  }
}
