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
test('宮崎: 2026-11-04 PDFの庁名上段を混入せず全9行・6列と商業本局を読む',()=>{
 const {items}=JSON.parse(fs.readFileSync(new URL('fixtures/miyazaki-20261104.json',import.meta.url)));
 const j=JURISDICTIONS.find(j=>j.id==='miyazaki'),s=makeStores();
 parseMatrixCoordinateItems(items,s,j);validateJurisdiction(s,j);
 // Transcribed from the preserved official PDF: 権利 rows only, in visual column order.
 const offices=['本局','都城支局','延岡支局','日南支局','高鍋出張所','小林出張所'];
 const applications=['10-22','10-23','10-26','10-27','10-28','10-29','10-30','11-02','11-04'];
 const rows=[
  ['10-29','10-29','10-28','10-27','10-30','10-29'],
  ['11-02','10-30','10-29','10-28','11-02','10-30'],
  ['11-04','11-02','10-30','10-29','11-04','11-02'],
  ['11-05','11-04','11-02','10-30','11-05','11-04'],
  ['11-06','11-05','11-04','11-02','11-06','11-05'],
  ['11-09','11-06','11-05','11-04','11-09','11-06'],
  ['11-10','11-09','11-06','11-05','11-10','11-09'],
  ['11-11','11-10','11-09','11-06','11-11','11-10'],
  ['11-12','11-10','11-10','11-11','11-12','11-11']
 ];
 const expected={realEstate:{},commercial:{本局:{}}};
 offices.forEach((office,c)=>expected.realEstate[office]=Object.fromEntries(applications.map((a,r)=>['2026-'+a,'2026-'+rows[r][c]])));
 const commercial=['10-29','10-29','10-30','11-02','11-04','11-05','11-06','11-09','11-11'];
 applications.forEach((a,r)=>expected.commercial.本局['2026-'+a]='2026-'+commercial[r]);
 assert.deepEqual(s.miyazaki,expected);
 // Restricting the band must still reject an incomplete office label.
 assert.throws(()=>parseMatrixCoordinateItems(items.filter(i=>i.text!=='都'),makeStores(),j),/都城支局の列見出しがありません/);
});
for(const id of ['okayama','matsue','tokushima','matsuyama','nara','miyazaki','maebashi','kobe'])test(`${id}: 公式PDFの全申請日・列を読み取る`,()=>{const d=parse(id);for(const os of Object.values(d))for(const ds of Object.values(os))for(const [a,b]of Object.entries(ds)){assert.ok(a.startsWith('2026-'));assert.ok(a<=b);assert.ok(a<='2026-09-28');}});
test('岡山の新しい縦表',()=>{const d=parse('okayama');assert.equal(d.commercial['本局']['2026-09-25'],'2026-10-02');assert.equal(d.realEstate['倉敷支局']['2026-09-28'],'2026-10-07');});
test('徳島: 高さが1pt違う申請日を欠落させない',()=>assert.equal(parse('tokushima').commercial['本局']['2026-09-18'],'2026-09-28'));
test('松山: 申請日の列と庁名の並びを取り違えない',()=>{const d=parse('matsuyama');assert.equal(d.commercial['本局']['2026-09-25'],'2026-09-30');assert.equal(d.realEstate['今治支局']['2026-09-25'],'2026-10-02');assert.equal(d.realEstate['四国中央支局']['2026-09-25'],'2026-10-01');});
test('宮崎: 注意書きの令和6年ではなく表の令和8年・高鍋と小林の列',()=>{const d=parse('miyazaki');assert.equal(d.realEstate['高鍋出張所']['2026-09-28'],'2026-10-06');assert.equal(d.realEstate['小林出張所']['2026-09-28'],'2026-10-08');});
test('前橋: 午後行も同じ申請日に合算',()=>assert.equal(parse('maebashi').realEstate['本局登記部門']['2026-09-25'],'2026-10-13'));
test('神戸: 完了日を次の申請日と扱わない',()=>assert.equal(parse('kobe').realEstate['伊丹支局']['2026-09-25'],'2026-10-06'));
test('松江の登記完了日リンクも選べる',()=>assert.equal(extractPdfLink('<a href="/matsue/content/new.pdf">登記完了日</a>',{indexUrl:'https://houmukyoku.moj.go.jp/matsue/standard/aaaa.html'}),'https://houmukyoku.moj.go.jp/matsue/content/new.pdf'));
test('日付の逆転を公開前に拒否',()=>{const s=makeStores(),j=JURISDICTIONS.find(j=>j.id==='nagoya');s.nagoya.realEstate['本局']={'2026-09-25':'2026-09-24'};assert.throws(()=>validateJurisdiction(s,j),/申請日より前/);});
test('松山: 隣接2庁が一つの文字列でも日付の列を分離する',()=>{
 const {items}=JSON.parse(fs.readFileSync(new URL('fixtures/matsuyama-20261001.json',import.meta.url)));
 const j=JURISDICTIONS.find(j=>j.id==='matsuyama'),s=makeStores();
 parseMatrixCoordinateItems(items,s,j);validateJurisdiction(s,j);
 assert.equal(Object.keys(s.matsuyama.realEstate).length,7);
 for(const dates of Object.values(s.matsuyama.realEstate))assert.equal(Object.keys(dates).length,5);
 assert.equal(s.matsuyama.realEstate['宇和島支局']['2026-09-25'],'2026-10-01');
 assert.equal(s.matsuyama.realEstate['砥部出張所']['2026-09-25'],'2026-10-02');
 assert.equal(s.matsuyama.realEstate['宇和島支局']['2026-09-29'],'2026-10-05');
 assert.equal(s.matsuyama.realEstate['砥部出張所']['2026-09-29'],'2026-10-06');
 assert.equal(s.matsuyama.commercial['本局']['2026-10-01'],'2026-10-06');
 const incomplete=items.filter(i=>!(i.x===494.38 && i.y===694.54));
 assert.throws(()=>parseMatrixCoordinateItems(incomplete,makeStores(),j),/結合された庁名/);
});
