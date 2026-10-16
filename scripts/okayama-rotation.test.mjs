import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { auditData } from './audit-data.mjs';
import { JURISDICTIONS, makeStores, pdfTextItems, parseMatrixCoordinateItems, validateJurisdiction, buildOutput } from '../scraper/scrape.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('fixtures/okayama-20261016.json', import.meta.url)));
const pdf = fs.readFileSync(new URL('fixtures/okayama-20261016.pdf', import.meta.url));
const jurisdiction = JURISDICTIONS.find(j => j.id === 'okayama');
// Transcribed from the rendered official PDF; display-registration rows are excluded.
const expected = {
  realEstate: {
    '本局': { '2026-10-14': '2026-10-22', '2026-10-15': '2026-10-23', '2026-10-16': '2026-10-26' },
    '備前支局': { '2026-10-14': '2026-10-21', '2026-10-15': '2026-10-22', '2026-10-16': '2026-10-23' },
    '倉敷支局': { '2026-10-14': '2026-10-23', '2026-10-15': '2026-10-26', '2026-10-16': '2026-10-27' },
    '笠岡支局': { '2026-10-14': '2026-10-20', '2026-10-15': '2026-10-21', '2026-10-16': '2026-10-22' },
    '高梁支局': { '2026-10-14': '2026-10-19', '2026-10-15': '2026-10-20', '2026-10-16': '2026-10-21' },
    '津山支局': { '2026-10-14': '2026-10-23', '2026-10-15': '2026-10-26', '2026-10-16': '2026-10-27' },
  },
  commercial: { '本局': { '2026-10-14': '2026-10-20', '2026-10-15': '2026-10-21', '2026-10-16': '2026-10-22' } },
};

test('Okayama: rotated official PDF extracts in displayed coordinates and parses all 21 entries', async () => {
  assert.equal(crypto.createHash('sha256').update(pdf).digest('hex'), fixture.pdfSha256);
  const items = await pdfTextItems(pdf);
  assert.deepEqual(items, fixture.items);
  const before = structuredClone(items), stores = makeStores();
  parseMatrixCoordinateItems(items, stores, jurisdiction);
  validateJurisdiction(stores, jurisdiction);
  assert.deepEqual(stores.okayama, expected);
  assert.deepEqual(items, before);
  for (const offices of Object.values(stores.okayama)) {
    for (const dates of Object.values(offices)) {
      assert.equal(Object.keys(dates).length, 3);
      for (const [apply, due] of Object.entries(dates)) assert.ok(apply <= due);
    }
  }
});

test('Okayama: recovery retains history and leaves the other 49 jurisdictions unchanged', () => {
  const previous = JSON.parse(fs.readFileSync(new URL('../app/data/kanryo.json', import.meta.url)));
  const before = structuredClone(previous), stores = makeStores();
  for (const [id, types] of Object.entries(previous.publishedDates)) {
    if (id === 'okayama') continue;
    for (const [type, offices] of Object.entries(types)) {
      for (const [office, dates] of Object.entries(offices)) {
        stores[id][type][office] = Object.fromEntries(dates.map(apply => [apply, previous.data[id][type][office][apply]]));
      }
    }
  }
  parseMatrixCoordinateItems(fixture.items, stores, jurisdiction);
  const output = buildOutput(stores, {}, previous);
  assert.deepEqual(output.publishedTotals.okayama, { realEstate: 18, commercial: 3 });
  for (const [type, offices] of Object.entries(previous.data.okayama)) {
    for (const [office, dates] of Object.entries(offices)) {
      for (const [apply, due] of Object.entries(dates)) {
        assert.equal(output.data.okayama[type][office][apply], expected[type][office]?.[apply] ?? due);
      }
    }
  }
  for (const j of JURISDICTIONS.filter(j => j.id !== 'okayama')) {
    assert.deepEqual(output.data[j.id], previous.data[j.id]);
    assert.deepEqual(output.publishedDates[j.id], previous.publishedDates[j.id]);
    assert.deepEqual(output.publishedTotals[j.id], previous.publishedTotals[j.id]);
  }
  assert.deepEqual(auditData(output, Date.parse(output.generatedAt)).issues, []);
  assert.deepEqual(previous, before);
});
