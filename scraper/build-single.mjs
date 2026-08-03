// app/ の index.html・styles.css・shared-config.js・app.js・data/kanryo.js を1枚のHTMLに埋め込む
// 出力: dist/touki-kanryo-standalone.html（1ファイルで動作確認できる版）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, "..", "app");
const DIST = path.join(__dirname, "..", "dist");
const OUT = path.join(DIST, "touki-kanryo-standalone.html");

const read = (p) => fs.readFileSync(path.join(APP, p), "utf8");

let html = read("index.html");
const css = read("styles.css");
const integrity = read("data/kanryo-integrity.js");
const data = read("data/kanryo.js");
const sharedConfig = read("shared-config.js");
const app = read("app.js");

// 外部参照を撤去（単一ファイルでは不要・解決できない）
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/i, "")
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/i, "")
  .replace(/\s*<link rel="icon"[^>]*>/i, "");

// アクセス解析はWebサイト版のみ。配布用の単一ファイルには含めない
html = html.replace(/\s*<script data-goatcounter[^>]*><\/script>/i, "");

// CSS を <style> に
html = html.replace(
  /<link rel="stylesheet" href="styles\.css(?:\?[^\"]+)?" \/>/i,
  `<style>\n${css}\n</style>`
);

// データ整合性 JS を埋め込み
html = html.replace(
  /<script src="data\/kanryo-integrity\.js"><\/script>/i,
  `<script>\n${integrity}\n</script>`
);

// データ JS を埋め込み
html = html.replace(
  /<script src="data\/kanryo\.js"><\/script>/i,
  `<script>\n${data}\n</script>`
);

// 共有設定 JS を埋め込み
html = html.replace(
  /<script src="shared-config\.js(?:\?[^\"]+)?"><\/script>/i,
  `<script>\n${sharedConfig}\n</script>`
);

// アプリ JS を埋め込み
html = html.replace(
  /<script src="app\.js(?:\?[^\"]+)?"><\/script>/i,
  `<script>\n${app}\n</script>`
);

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(OUT, html, "utf8");

const kb = Math.round(Buffer.byteLength(html, "utf8") / 1024);
console.log(`出力: ${OUT}`);
console.log(`サイズ: ${kb} KB（単一ファイル・file://でそのまま動作）`);
// 取りこぼし確認
for (const frag of ['href="styles.css', 'src="app.js', 'src="shared-config.js', 'src="data/kanryo-integrity.js', 'src="data/kanryo.js']) {
  if (html.includes(frag)) console.warn("⚠ 未置換:", frag);
}
