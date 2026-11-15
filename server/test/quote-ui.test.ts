import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyQuoteFields, emptyQuoteFiles, filesAfterTypeChange, filesAreTypeSpecific } from '../../web/src/catalog/quoteForm.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('quote form reset helpers', () => {
  it('starts with no attachments', () => {
    const files = emptyQuoteFiles();
    expect(files.photos).toEqual([]);
    expect(files.invoices).toEqual([]);
    expect(files.packingLists).toEqual([]);
  });

  it('resets fields but keeps the default phone code and unit', () => {
    expect(emptyQuoteFields.name).toBe('');
    expect(emptyQuoteFields.email).toBe('');
    expect(emptyQuoteFields.goods).toBe('');
    expect(emptyQuoteFields.requestLogin).toBe(false);
    expect(emptyQuoteFields.phoneCode).toBe('+91');
    expect(emptyQuoteFields.unit).toBe('pcs');
  });

  it('keeps attachments when switching type because they apply to both sourcing and shipping', () => {
    expect(filesAreTypeSpecific).toBe(false);
    const files = emptyQuoteFiles();
    const photo = { name: 'a.png' } as File;
    files.photos = [photo];
    expect(filesAfterTypeChange(files).photos).toEqual([photo]);
  });
});

describe('shipping request reject placeholder', () => {
  it('is a plain string in English and Chinese, not the reason-code object', () => {
    const en = JSON.parse(read('web/src/i18n/en.json'));
    const zh = JSON.parse(read('web/src/i18n/zh-CN.json'));
    expect(typeof en.sr.rejectPlaceholder).toBe('string');
    expect(en.sr.rejectPlaceholder.length).toBeGreaterThan(8);
    expect(typeof zh.sr.rejectPlaceholder).toBe('string');
    expect(zh.sr.rejectPlaceholder.length).toBeGreaterThan(8);
    expect(en.sr.reason).toBeTypeOf('object');
    expect(en.sr.reason.PRICE).toBeTruthy();
  });

  it('uses the string key in the staff shipping request form', () => {
    const src = read('web/src/components/ShippingRequests.tsx');
    expect(src).toMatch(/placeholder=\{t\('sr\.rejectPlaceholder'\)\}/);
    expect(src).not.toMatch(/placeholder=\{t\('sr\.reason'\)\}/);
  });
});

describe('EnquireForm success reset', () => {
  it('clears fields and attachments after a successful send, and remounts the file inputs', () => {
    const src = read('web/src/catalog/EnquireForm.tsx');
    expect(src).toMatch(/setF\(emptyQuoteFields\)/);
    expect(src).toMatch(/setFiles\(emptyQuoteFiles\(\)\)/);
    expect(src).toMatch(/setFileTick/);
    expect(src).toMatch(/key=\{`\$\{x\.key\}-\$\{fileTick\}`\}/);
  });
});
