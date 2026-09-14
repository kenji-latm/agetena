// Chrome拡張版の配布フォルダとZipを生成する。
// 出力:
// - dist/chrome-extension/
// - dist/アゲテナChrome拡張.zip
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "app");
const EXTENSION = path.join(ROOT, "extension");
const DIST = path.join(ROOT, "dist");
const OUT_DIR = path.join(DIST, "chrome-extension");
const OUT_ZIP = path.join(DIST, "アゲテナChrome拡張.zip");

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const copiedFiles = [];

function copyFile(from, to) {
  const target = path.join(OUT_DIR, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(from, target);
  copiedFiles.push(to.replaceAll("\\", "/"));
}

function copyFromApp(from, to = from) {
  copyFile(path.join(APP, from), to);
}

function copyFromExtension(from, to = from) {
  copyFile(path.join(EXTENSION, from), to);
}

function collectFiles(dir, prefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== ".DS_Store" && entry.name !== "Thumbs.db")
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...collectFiles(full, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

const crc32 =
  zlib.crc32 ||
  ((buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  });

function zipStore(sourceDir, outputFile, selectedEntries = null) {
  const entries = [...new Set(selectedEntries || collectFiles(sourceDir))]
    .sort((a, b) => a.localeCompare(b, "ja"));
  const d = new Date();
  const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const name of entries) {
    const content = fs.readFileSync(path.join(sourceDir, ...name.split("/")));
    const nameBuf = Buffer.from(name, "utf8");
    const isAscii = /^[\x00-\x7f]*$/.test(name);
    const flags = isAscii ? 0 : 0x0800;
    const crc = crc32(content);
    const size = content.length;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(0, 8);
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18);
    lfh.writeUInt32LE(size, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(flags, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(size, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);

    locals.push(lfh, nameBuf, content);
    centrals.push(Buffer.concat([cdh, nameBuf]));
    offset += lfh.length + nameBuf.length + content.length;
  }

  const localPart = Buffer.concat(locals);
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);

  const zip = Buffer.concat([localPart, central, eocd]);
  fs.writeFileSync(outputFile, zip);
  return { entries, size: zip.length };
}

fs.mkdirSync(DIST, { recursive: true });
ensureCleanDir(OUT_DIR);

// 古いビルドのアイコンがGoogle Drive同期で残っても、manifestでは使わない。
// 念のため見た目からも消しておく。
for (const stale of ["icon-192.png", "icon-512.png"]) {
  fs.rmSync(path.join(OUT_DIR, stale), { force: true });
}

copyFromExtension("manifest.json");
copyFromExtension("popup.html");
copyFromExtension("app.html");
copyFromExtension("extension-config.js");
copyFromExtension("extension.css");
copyFromExtension("extension-page.css");
copyFromExtension("extension-popup.js");
copyFromExtension("icon.svg");
copyFromExtension("README.md", "README.txt");
for (const size of [16, 32, 48, 128]) {
  copyFromExtension(`icons/icon-${size}.png`, `icons/icon-${size}.png`);
}

copyFromApp("app.js");
copyFromApp("styles.css");
copyFromApp("data/kanryo-integrity.js");
copyFromApp("data/kanryo.js");
copyFromApp("data/holidays.js");
copyFromApp("data/business-days.js");
copyFromApp("data/kanryo.json");

const result = zipStore(OUT_DIR, OUT_ZIP, copiedFiles);
console.log(`出力フォルダ: ${OUT_DIR}`);
console.log(`出力Zip: ${OUT_ZIP}`);
console.log(`サイズ: ${Math.round(result.size / 1024)} KB`);
console.log(`同梱: ${result.entries.join(" , ")}`);
