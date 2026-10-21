import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPdfDiagnostics } from '../scraper/pdf-diagnostics.mjs';

const pdf = fs.readFileSync(new URL('fixtures/okayama-20261016.pdf', import.meta.url));
const source = 'https://houmukyoku.moj.go.jp/okayama/content/test.pdf?secret=omitted#fragment';
const setup = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agetena-diagnostics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('diagnostics: successful parsing writes nothing; failed parsing retains exact fetched PDF and safe provenance', t => {
  const directory = setup(t);
  const diagnostics = createPdfDiagnostics('okayama', directory);
  diagnostics.record(source, pdf);
  assert.deepEqual(fs.readdirSync(directory), []);
  diagnostics.saveFailure();
  const target = path.join(directory, 'okayama');
  assert.deepEqual(fs.readFileSync(path.join(target, '1.pdf')), pdf);
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json')));
  assert.equal(manifest.jurisdiction, 'okayama');
  assert.ok(Number.isFinite(Date.parse(manifest.capturedAt)));
  assert.deepEqual(manifest.files, [{ file: '1.pdf',
    sourceUrl: 'https://houmukyoku.moj.go.jp/okayama/content/test.pdf', size: pdf.length,
    sha256: crypto.createHash('sha256').update(pdf).digest('hex') }]);
  assert.ok(!JSON.stringify(manifest).includes('secret'));
});

test('diagnostics: rejected responses, nonpublic origins and disabled capture leave no files', t => {
  const directory = setup(t);
  const diagnostics = createPdfDiagnostics('takamatsu', directory);
  diagnostics.record(source, Buffer.from('<html>403 Request blocked</html>'));
  diagnostics.record('https://example.com/document.pdf', pdf);
  diagnostics.record('https://user:password@moj.go.jp/document.pdf', pdf);
  diagnostics.record('http://moj.go.jp/document.pdf', pdf);
  diagnostics.saveFailure();
  createPdfDiagnostics('takamatsu', '').record(source, pdf);
  const invalid = createPdfDiagnostics('../outside', directory);
  invalid.record(source, pdf);
  invalid.saveFailure();
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('diagnostics: per-jurisdiction count and byte limits bound retained inputs', t => {
  const directory = setup(t);
  const diagnostics = createPdfDiagnostics('okayama', directory);
  const oversized = Buffer.alloc(50 * 1024 * 1024 + 1);
  oversized.write('%PDF-');
  diagnostics.record(source, oversized);
  for (let i = 0; i < 6; i++) diagnostics.record(source, pdf);
  diagnostics.saveFailure();
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'okayama/manifest.json')));
  assert.equal(manifest.files.length, 5);
  assert.ok(manifest.files.every(file => file.size === pdf.length));
  assert.equal(fs.readdirSync(path.join(directory, 'okayama')).length, 6);
});
