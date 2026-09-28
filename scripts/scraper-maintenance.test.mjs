import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JURISDICTIONS, makeStores, parseMatrixCoordinateItems, parseOfficeCoordinateItems, validateJurisdiction, extractPdfLink, parseHtmlSequentialOfficeTables } from '../scraper/scrape.mjs';
const parse = id => {
 const j=JURISDICTIONS.find(j=>j.id===id), s=makeStores();
 const {items}=JSON.parse(fs.readFileSync(new URL(`fixtures/${id}-20260928.json`,import.meta.url)));
 (['maebashi','kobe'].includes(id)?parseOfficeCoordinateItems:parseMatrixCoordinateItems)(items,s,j);
 validateJurisdiction(s,j); return s[id];
};
for(const id of ['okayama','matsue','tokushima','matsuyama','nara','miyazaki','maebashi','kobe'])test(`${id}: 公式PDFの全申請日・列を読み取る`,()=>{const d=parse(id);for(const os of Object.values(d))for(const ds of Object.values(os))for(const [a,b]of Object.entries(ds)){assert.ok(a.startsWith('2026-'));assert.ok(a<=b);assert.ok(a<='2026-09-28');}});
test('岡山の新しい縦表',()=>{const d=parse('okayama');assert.equal(d.commercial['本局']['2026-09-25'],'2026-10-02');assert.equal(d.realEstate['倉敷支局']['2026-09-28'],'2026-10-07');});
test('徳島: 高さが1pt違う申請日を欠落させない',()=>assert.equal(parse('tokushima').commercial['本局']['2026-09-18'],'2026-09-28'));
test('松山: 申請日の列と庁名の並びを取り違えない',()=>{const d=parse('matsuyama');assert.equal(d.commercial['本局']['2026-09-25'],'2026-09-30');assert.equal(d.realEstate['今治支局']['2026-09-25'],'2026-10-02');assert.equal(d.realEstate['四国中央支局']['2026-09-25'],'2026-10-01');});
test('宮崎: 注意書きの令和6年ではなく表の令和8年・高鍋と小林の列',()=>{const d=parse('miyazaki');assert.equal(d.realEstate['高鍋出張所']['2026-09-28'],'2026-10-06');assert.equal(d.realEstate['小林出張所']['2026-09-28'],'2026-10-08');});
test('前橋: 午後行も同じ申請日に合算',()=>assert.equal(parse('maebashi').realEstate['本局登記部門']['2026-09-25'],'2026-10-13'));
test('神戸: 完了日を次の申請日と扱わない',()=>assert.equal(parse('kobe').realEstate['伊丹支局']['2026-09-25'],'2026-10-06'));
test('松江の登記完了日リンクも選べる',()=>assert.equal(extractPdfLink('<a href="/matsue/content/new.pdf">登記完了日</a>',{indexUrl:'https://houmukyoku.moj.go.jp/matsue/standard/aaaa.html'}),'https://houmukyoku.moj.go.jp/matsue/content/new.pdf'));
test('日付の逆転を公開前に拒否',()=>{const s=makeStores(),j=JURISDICTIONS.find(j=>j.id==='nagoya');s.nagoya.realEstate['本局']={'2026-09-25':'2026-09-24'};assert.throws(()=>validateJurisdiction(s,j),/申請日より前/);});
