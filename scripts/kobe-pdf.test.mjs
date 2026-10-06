import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JURISDICTIONS, makeStores, parseOfficeCoordinateItems, validateJurisdiction, buildOutput } from '../scraper/scrape.mjs';

const jurisdiction = JURISDICTIONS.find(j => j.id === 'kobe');
const { items } = JSON.parse(fs.readFileSync(new URL('fixtures/kobe-20261006.json', import.meta.url)));
const parse = input => {
  const stores = makeStores();
  parseOfficeCoordinateItems(input, stores, jurisdiction);
  validateJurisdiction(stores, jurisdiction);
  return stores;
};

test('Kobe: combined morning/afternoon date items retain all application rows and ignore display registration', () => {
  const stores = parse(items);
  assert.equal(Object.keys(stores.kobe.realEstate).length, 17);
  for (const dates of Object.values(stores.kobe.realEstate)) assert.equal(Object.keys(dates).length, 6);
  assert.equal(Object.keys(stores.kobe.commercial['本局法人登記部門']).length, 6);
  assert.equal(stores.kobe.realEstate['本局不動産登記部門']['2026-09-29'], '2026-10-07');
  assert.equal(stores.kobe.realEstate['本局不動産登記部門']['2026-09-30'], '2026-10-13');
  assert.equal(stores.kobe.realEstate['三田出張所']['2026-10-06'], '2026-10-09');
  assert.equal(stores.kobe.commercial['本局法人登記部門']['2026-09-30'], '2026-10-09');
  assert.equal(stores.kobe.commercial['本局法人登記部門']['2026-10-06'], '2026-10-23');
  const separated = items.map(i => ({ ...i, text: i.text.replace(/^(午前|午後)\s+(?=令和)/, '') }));
  assert.deepEqual(stores, parse(separated));
});

test('Kobe: missing completion row still fails instead of publishing partial data', () => {
  const incomplete = items.filter(i => !(i.pageNo === 2 && Math.abs(i.y - 644.28) < 3 && i.x > 90));
  assert.throws(() => parse(incomplete), /申請日と完了日の対応が不明/);
});

test('Kobe: recovery preserves historical records and every other jurisdiction', () => {
  const previous = JSON.parse(fs.readFileSync(new URL('../app/data/kanryo.json', import.meta.url)));
  const stores = parse(items);
  const before = structuredClone(previous);
  const output = buildOutput(stores, { kobe: ['https://houmukyoku.moj.go.jp/kobe/content/001471424.pdf'] }, previous);
  let historical = 0;
  for (const [type, offices] of Object.entries(previous.data.kobe)) for (const [office, dates] of Object.entries(offices)) {
    for (const [applied, due] of Object.entries(dates)) {
      historical++;
      assert.equal(output.data.kobe[type][office][applied], stores.kobe[type][office]?.[applied] || due);
    }
  }
  assert.ok(historical > 0, 'existing history must be exercised even as scheduled updates add records');
  for (const j of JURISDICTIONS.filter(j => j.id !== 'kobe')) assert.deepEqual(output.data[j.id], previous.data[j.id]);
  assert.equal(output.publishedTotals.kobe.realEstate, 102);
  assert.equal(output.publishedTotals.kobe.commercial, 6);
  assert.equal(output.sources.find(s => s.id === 'kobe').fetchError, null);
  assert.deepEqual(previous, before);
});
