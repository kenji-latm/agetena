import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHolidayCsv } from './update-holidays.mjs';
const holidaySource = readFileSync(new URL('../app/data/holidays.js', import.meta.url), 'utf8');
const businessSource = readFileSync(new URL('../app/data/business-days.js', import.meta.url), 'utf8');
function load(withData = true) {
  const context = vm.createContext({ window: {} });
  if (withData) vm.runInContext(holidaySource, context);
  vm.runInContext(businessSource, context);
  return context.window;
}
const { TOUKI_BUSINESS_DAYS: calendar, TOUKI_HOLIDAYS: holidays } = load();
const cases = [
  ['平日', '2026-09-15', 1, '2026-09-16'],
  ['通常の週末', '2026-09-11', 1, '2026-09-14'],
  ['敬老の日・国民の休日・秋分の日', '2026-09-18', 1, '2026-09-24'],
  ['連休をまたぐ2営業日', '2026-09-17', 2, '2026-09-24'],
  ['春分の日', '2026-03-19', 1, '2026-03-23'],
  ['GW・振替休日', '2026-05-01', 1, '2026-05-07'],
  ['スポーツの日', '2026-10-09', 1, '2026-10-13'],
  ['年末年始', '2026-12-28', 1, '2027-01-04'],
  ['振替休日2027', '2027-03-19', 1, '2027-03-23'],
  ['即位に伴う休日', '2019-04-26', 1, '2019-05-07'],
  ['五輪移動2020', '2020-07-22', 1, '2020-07-27'],
  ['五輪移動2021', '2021-08-06', 1, '2021-08-10'],
  ['移動した後の平日', '2021-07-19', 1, '2021-07-20'],
];
for (const [name, start, count, expected] of cases) test(name, () => assert.equal(calendar.addBusinessDays(start, count), expected));
test('公式CSVの全休日が営業日から除かれる', () => {
  for (const iso of holidays.dates) assert.equal(calendar.isBusinessDay(iso), false, iso);
});
test('年末年始・通常日・不正日・未収録年', () => {
  for (const iso of ['2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']) assert.equal(calendar.isBusinessDay(iso), false);
  assert.equal(calendar.isBusinessDay('2026-09-24'), true);
  assert.equal(calendar.isBusinessDay('2026-02-30'), null);
  assert.equal(calendar.addBusinessDays(`${holidays.lastYear}-12-28`, 10), '');
  assert.equal(calendar.addBusinessDays('2026-09-15', -1), '');
  assert.equal(calendar.addBusinessDays('2026-09-15', 1.5), '');
});
test('祝日ファイルが欠けても土日だけで計算しない', () => {
  assert.equal(load(false).TOUKI_BUSINESS_DAYS.addBusinessDays('2026-09-18', 1), '');
});
test('不正な取得結果で休日一覧を上書きしない', () => {
  assert.throws(() => parseHolidayCsv('<html>error</html>'));
  assert.throws(() => parseHolidayCsv('国民の祝日・休日月日,国民の祝日・休日名称\n2026/1/1,元日'));
});
