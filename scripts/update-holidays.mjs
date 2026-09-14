import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const SOURCE = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
export function parseHolidayCsv(csv) {
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (!lines.shift()?.includes('国民の祝日')) throw new Error('Unexpected holiday CSV header');
  const dates = lines.map(line => {
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2}),.+$/.exec(line);
    if (!match) throw new Error('Invalid holiday CSV row');
    const [, year, month, day] = match;
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    if (new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) !== iso) throw new Error('Invalid holiday date');
    return iso;
  }).sort();
  if (new Set(dates).size !== dates.length) throw new Error('Duplicate holiday date');
  const firstYear = Number(dates[0]?.slice(0, 4)), lastYear = Number(dates.at(-1)?.slice(0, 4));
  if (firstYear !== 1955 || lastYear < new Date().getFullYear()) throw new Error('Incomplete holiday coverage');
  for (let year = firstYear; year <= lastYear; year++) {
    const annual = dates.filter(date => date.startsWith(`${year}-`));
    if (annual.length < 8 || annual.length > 25 || !annual.includes(`${year}-01-01`) || !annual.includes(`${year}-11-23`)) throw new Error(`Incomplete holidays: ${year}`);
  }
  return { source: SOURCE, firstYear, lastYear, dates };
}
export async function updateHolidays() {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Holiday CSV: HTTP ${response.status}`);
  const calendar = parseHolidayCsv(new TextDecoder('shift_jis').decode(await response.arrayBuffer()));
  const target = new URL('../app/data/holidays.js', import.meta.url);
  const previous = await readFile(target, 'utf8').catch(() => '');
  const previousYear = Number(/"lastYear":(\d+)/.exec(previous)?.[1] || 0);
  if (calendar.lastYear < previousYear) throw new Error('Holiday coverage must not shrink');
  const output = '// 内閣府の祝日CSVから生成。振替休日・祝日に挟まれた休日を含む。\nwindow.TOUKI_HOLIDAYS = ' + JSON.stringify(calendar) + ';\n';
  if (output !== previous) await writeFile(target, output);
  console.log(`Holiday data: ${calendar.firstYear}-${calendar.lastYear}, ${calendar.dates.length} days`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await updateHolidays();
