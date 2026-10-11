const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://www.moj.go.jp/MINJI/minji60.html';
const OUT_FILE = path.join(__dirname, '..', 'app', 'toshitena', 'moj-signature-data.js');

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cleanText(html) {
  return decodeHtml(String(html || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/（\s*注\s*[０-９0-9]+\s*）/g, '')
    .replace(/\(\s*注\s*[0-9]+\s*\)/gi, '')
    .trim();
}

function textLines(html) {
  return cleanText(html).split('\n').map((line) => line.trim()).filter(Boolean);
}

function firstHref(html) {
  const match = String(html || '').match(/href=["']([^"']+)["']/i);
  if (!match) return '';
  // 掲載するリンクは http(s) だけ。javascript: や data: などはリンク化しない。
  try {
    const url = new URL(decodeHtml(match[1]), SOURCE_URL);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function attrNumber(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`${name}=["']?(\\d+)`, 'i'));
  return match ? Math.max(1, Number(match[1])) : 1;
}

function findMatchingTable(html, start) {
  const re = /<\/?table\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return html.slice(start, re.lastIndex);
    } else {
      depth += 1;
    }
  }
  throw new Error('Could not find the end of the services table.');
}

function extractOtherServicesTable(html) {
  const marker = html.indexOf('サービス名');
  if (marker < 0) throw new Error('Could not find the services table marker.');
  const start = html.lastIndexOf('<table', marker);
  if (start < 0) throw new Error('Could not find the services table start.');
  return findMatchingTable(html, start);
}

function parseCells(rowHtml) {
  const cells = [];
  const re = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
  let match;
  while ((match = re.exec(rowHtml))) {
    cells.push({
      attrs: match[1] || '',
      html: match[2] || '',
      rowSpan: attrNumber(match[1], 'rowspan'),
      colSpan: attrNumber(match[1], 'colspan')
    });
  }
  return cells;
}

function tableToGrid(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const pending = [];
  return rows.map((rowHtml) => {
    const row = [];
    let col = 0;

    function consumePending() {
      while (pending[col] && pending[col].remaining > 0) {
        row[col] = pending[col].cell;
        pending[col].remaining -= 1;
        col += 1;
      }
    }

    consumePending();
    for (const cell of parseCells(rowHtml)) {
      consumePending();
      for (let offset = 0; offset < cell.colSpan; offset += 1) {
        row[col + offset] = cell;
        if (cell.rowSpan > 1) {
          pending[col + offset] = { remaining: cell.rowSpan - 1, cell };
        }
      }
      col += cell.colSpan;
    }
    return row;
  });
}

function mergeServiceRows(rows) {
  const byName = new Map();
  for (const row of rows) {
    const [, serviceCell, providerCell, certCell, publishedCell] = row;
    const name = cleanText(serviceCell && serviceCell.html);
    if (!name || name === 'サービス名') continue;
    const provider = cleanText(providerCell && providerCell.html);
    const certificates = textLines(certCell && certCell.html);
    const published = cleanText(publishedCell && publishedCell.html).replace(/\s+/g, '');
    const link = firstHref(serviceCell && serviceCell.html);

    if (!byName.has(name)) {
      byName.set(name, {
        name,
        provider: '',
        certificates: [],
        published: '',
        link,
        aliases: []
      });
    }

    const entry = byName.get(name);
    if (link && !entry.link) entry.link = link;
    for (const item of provider.split('\n').filter(Boolean)) {
      if (item && !entry.provider.split('／').includes(item)) {
        entry.provider = entry.provider ? `${entry.provider}／${item}` : item;
      }
    }
    for (const item of certificates) {
      if (item && !entry.certificates.includes(item)) entry.certificates.push(item);
    }
    for (const item of published.split(/[／,、\n]+/).filter(Boolean)) {
      if (item && !entry.published.split('／').includes(item)) {
        entry.published = entry.published ? `${entry.published}／${item}` : item;
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

function buildOutput(services) {
  const now = new Date();
  const updatedAt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now).replace(/\//g, '-');

  return `// Generated from ${SOURCE_URL}\n` +
    `// Updated at ${updatedAt}\n` +
    `window.MOJ_SIGNATURE_DATA_UPDATED_AT = ${JSON.stringify(updatedAt)};\n` +
    `window.MOJ_SIGNATURE_OTHER_SERVICES = ${JSON.stringify(services, null, 2)};\n`;
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  const html = await response.text();
  const table = extractOtherServicesTable(html);
  const services = mergeServiceRows(tableToGrid(table));
  if (services.length < 20) throw new Error(`Parsed service count looks too small: ${services.length}`);
  fs.writeFileSync(OUT_FILE, buildOutput(services), 'utf8');
  console.log(`Updated ${path.basename(OUT_FILE)}: ${services.length} services`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});


