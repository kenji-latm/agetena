// 全国の法務局サイトから「登記完了予定日」掲載形式を棚卸しする調査スクリプト。
// 公開アプリのデータは変更しない。結果は ../codex-work/ にJSON/Markdownで出力する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = "https://houmukyoku.moj.go.jp";
const KANKATSU = `${ROOT}/homu/static/kankatsu_index.html`;
const OUT_DIR = path.join(__dirname, "..", "..", "codex-work");
const OUT_JSON = path.join(OUT_DIR, "touki-kanryo-national-inventory.json");
const OUT_MD = path.join(OUT_DIR, "touki-kanryo-national-inventory.md");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getBuf(url, retries = 3) {
  let lastError;
  for (let i = 1; i <= retries; i++) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:" || !(host === "moj.go.jp" || host.endsWith(".moj.go.jp"))) {
        throw new Error(`許可していない取得先です: ${url}`);
      }
      const res = await fetch(url, {
        redirect: "error",
        headers: { "User-Agent": "Mozilla/5.0 touki-kanryo-app inventory" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastError = e;
      if (i < retries) await sleep(400 * i);
    }
  }
  throw lastError;
}

function decodeHtml(buf) {
  const head = buf.toString("ascii", 0, Math.min(buf.length, 4096));
  const m = head.match(/charset=["']?([^"'\s>]+)/i);
  const charset = (m?.[1] || "utf-8").toLowerCase();
  const encoding = /shift|sjis|windows-31j/.test(charset) ? "shift_jis" : "utf-8";
  return new TextDecoder(encoding).decode(buf);
}

function cleanText(s) {
  return String(s || "")
    .replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractAnchors(html, base) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: absUrl(m[1], base), text: cleanText(m[2]) }))
    .filter((a) => a.href);
}

function getTitle(html) {
  return cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function getHeadingText(html) {
  return [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => cleanText(m[1]))
    .join(" ");
}

function extractBureaus(kankatsuHtml) {
  const anchors = extractAnchors(kankatsuHtml, KANKATSU);
  const map = new Map();
  for (const a of anchors) {
    const url = new URL(a.href);
    const m = url.pathname.match(/^\/([^/]+)\/table\/shikyokutou\/all\.html$/);
    if (!m || !/法務局/.test(a.text)) continue;
    const id = m[1];
    const label = a.text.replace(/（/g, "(").replace(/）/g, ")");
    const name = label.replace(/\(.+?\)/g, "");
    const prefecture = label.match(/\((.+?)\)/)?.[1] || "";
    map.set(id, {
      id,
      name,
      prefecture,
      topUrl: `${ROOT}/${id}/`,
      officeListUrl: a.href,
    });
  }
  return [...map.values()];
}

function sameBureauHtmlLink(url, bureauId) {
  const u = new URL(url);
  if (u.origin !== ROOT) return false;
  if (!u.pathname.startsWith(`/${bureauId}/`)) return false;
  if (!/\.(html?|pdf|xlsx?|csv)$/i.test(u.pathname)) return false;
  if (/\/table\/|\/content\/.*\.(gif|jpg|png|css|js)$/i.test(u.pathname)) return false;
  return true;
}

function isLikelyNavCandidate(anchor) {
  const s = `${anchor.text} ${anchor.href}`;
  if (/登記完了予定|完了予定|kanryo|kanryobi|yotei/i.test(s)) return true;
  if (/category_\d+\.html|page\d|static\/[^/]+\.html/i.test(anchor.href)) return true;
  return false;
}

function pageSignals(html, url) {
  const title = getTitle(html);
  const heading = getHeadingText(html);
  const plain = cleanText(html);
  const anchors = extractAnchors(html, url);
  const dateCount = (plain.match(/\d{1,2}月\d{1,2}日/g) || []).length;
  const trCount = (html.match(/<tr\b/gi) || []).length;
  // 横メニューにも「登記完了予定日」が出るため、本文全体ではなくtitle/h見出しを主に見る。
  const subjectPage = /登記完了予定日|完了予定日/.test(`${title} ${heading}`);
  const pdfLinks = anchors.filter((a) => /\.pdf(?:$|[?#])/i.test(a.href) && /登記完了予定|完了予定|kanryo|kanryou|yotei/i.test(`${a.text} ${a.href}`));
  const excelLinks = anchors.filter((a) => /\.(xlsx?|csv)(?:$|[?#])/i.test(a.href) && /登記完了予定|完了予定|kanryo|kanryou|yotei/i.test(`${a.text} ${a.href}`));
  const htmlLinks = anchors.filter((a) => /\.html?(?:$|[?#])/i.test(a.href) && /登記完了予定|完了予定|kanryo|kanryou|kanryobi|yotei/i.test(`${a.text} ${a.href}`));
  const hasTableLike = /申\s*請\s*日/.test(plain) && (dateCount >= 6 || /不動産（権利）|商業・法人/.test(plain));
  return {
    url,
    title,
    heading,
    subjectPage,
    dateCount,
    trCount,
    hasRealEstate: /不動産（権利）/.test(plain),
    hasCommercial: /商業・法人/.test(plain),
    hasApplyDate: /申\s*請\s*日/.test(plain),
    hasTableLike,
    pdfLinks,
    excelLinks,
    htmlLinks,
  };
}

async function assessPdf(url) {
  try {
    const buf = await getBuf(url, 2);
    const pdf = await getDocument({ data: new Uint8Array(buf), disableWorker: true }).promise;
    let text = "";
    for (let p = 1; p <= Math.min(pdf.numPages, 2); p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += " " + content.items.map((item) => item.str || "").join(" ");
    }
    const normalized = cleanText(text);
    return {
      url,
      pages: pdf.numPages,
      textLength: normalized.length,
      dateCount: (normalized.match(/\d{1,2}月\d{1,2}日/g) || []).length,
      hasRealEstate: /不動産（権利）/.test(normalized),
      hasCommercial: /商業・法人/.test(normalized),
      readable: normalized.length > 100 && /\d{1,2}月\d{1,2}日/.test(normalized),
    };
  } catch (e) {
    return { url, error: e.message, readable: false };
  }
}

function classify(signals, pdfAssessments) {
  const htmlTable = signals.find((s) => s.hasTableLike && s.dateCount >= 6);
  const readablePdf = pdfAssessments.find((p) => p.readable);
  const detailHtml = signals.find((s) => s.subjectPage && s.htmlLinks.length > 0);
  const anyPdf = signals.find((s) => s.pdfLinks.length > 0);
  const anyExcel = signals.find((s) => s.excelLinks.length > 0);
  const anySubject = signals.find((s) => s.subjectPage);

  if (htmlTable) return { status: "候補OK", kind: "HTML表", reason: "ページ内に表形式の日付がある", primaryUrl: htmlTable.url };
  if (readablePdf) return { status: "候補OK", kind: "PDF文字型", reason: "PDFから日付テキストを抽出できる", primaryUrl: readablePdf.url };
  if (detailHtml) return { status: "候補OK", kind: "HTMLリンク型", reason: "完了予定日のHTML詳細ページへのリンクがある", primaryUrl: detailHtml.url };
  if (anyPdf) return { status: "要調整", kind: "PDF要確認", reason: "PDFリンクはあるが文字抽出の確認が必要", primaryUrl: anyPdf.pdfLinks[0].href };
  if (anyExcel) return { status: "要調整", kind: "Excel型", reason: "Excel/CSV掲載の可能性がある", primaryUrl: anyExcel.excelLinks[0].href };
  if (anySubject) return { status: "要調査", kind: "掲載ページのみ", reason: "完了予定日ページはあるが表・PDF・詳細リンクを判定できない", primaryUrl: anySubject.url };
  return { status: "未発見", kind: "未発見", reason: "通常巡回では完了予定日ページを見つけられない", primaryUrl: "" };
}

async function scanBureau(bureau) {
  const seen = new Set();
  const queue = [{ url: bureau.topUrl, depth: 0 }];
  const signals = [];
  const foundPdfUrls = new Set();
  const foundExcelUrls = new Set();
  const maxPages = 80;

  while (queue.length && seen.size < maxPages) {
    const { url, depth } = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);

    let html;
    try {
      const buf = await getBuf(url, 2);
      html = decodeHtml(buf);
    } catch {
      continue;
    }

    const sig = pageSignals(html, url);
    if (sig.subjectPage || sig.hasTableLike || sig.pdfLinks.length || sig.excelLinks.length) {
      signals.push(sig);
      sig.pdfLinks.forEach((a) => foundPdfUrls.add(a.href));
      sig.excelLinks.forEach((a) => foundExcelUrls.add(a.href));
    }

    if (depth >= 2) continue;
    for (const a of extractAnchors(html, url)) {
      if (!sameBureauHtmlLink(a.href, bureau.id)) continue;
      if (!isLikelyNavCandidate(a)) continue;
      if (seen.has(a.href)) continue;
      queue.push({ url: a.href, depth: depth + 1 });
    }
  }

  const pdfAssessments = [];
  for (const pdfUrl of [...foundPdfUrls].slice(0, 5)) {
    pdfAssessments.push(await assessPdf(pdfUrl));
  }

  const cls = classify(signals, pdfAssessments);
  return {
    ...bureau,
    scannedPages: seen.size,
    status: cls.status,
    kind: cls.kind,
    reason: cls.reason,
    primaryUrl: cls.primaryUrl,
    candidatePages: signals.map((s) => ({
      url: s.url,
      title: s.title,
      heading: s.heading,
      dateCount: s.dateCount,
      trCount: s.trCount,
      hasTableLike: s.hasTableLike,
      subjectPage: s.subjectPage,
      pdfCount: s.pdfLinks.length,
      excelCount: s.excelLinks.length,
      htmlLinkCount: s.htmlLinks.length,
    })),
    pdfAssessments,
    excelUrls: [...foundExcelUrls],
  };
}

function toMarkdown(results) {
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const byKind = results.reduce((acc, r) => {
    acc[r.kind] = (acc[r.kind] || 0) + 1;
    return acc;
  }, {});

  const lines = [];
  lines.push("# 登記完了予定日 全国棚卸しレポート");
  lines.push("");
  lines.push(`作成日時：${now}`);
  lines.push("");
  lines.push("## サマリー");
  lines.push("");
  lines.push(`- 調査対象：${results.length}法務局・地方法務局`);
  lines.push(`- 候補OK：${counts["候補OK"] || 0}`);
  lines.push(`- 要調整：${counts["要調整"] || 0}`);
  lines.push(`- 要調査：${counts["要調査"] || 0}`);
  lines.push(`- 未発見：${counts["未発見"] || 0}`);
  lines.push("");
  lines.push("### 形式別");
  lines.push("");
  for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${kind}：${count}`);
  }
  lines.push("");
  lines.push("## 一覧");
  lines.push("");
  lines.push("| 状態 | 形式 | 法務局 | 主なURL | 理由 |");
  lines.push("|---|---|---|---|---|");
  for (const r of results) {
    const url = r.primaryUrl ? `[開く](${r.primaryUrl})` : "";
    lines.push(`| ${r.status} | ${r.kind} | ${r.name} | ${url} | ${r.reason} |`);
  }
  lines.push("");
  lines.push("## 次に優先して追加しやすい候補");
  lines.push("");
  for (const r of results.filter((x) => x.status === "候補OK").slice(0, 20)) {
    lines.push(`- ${r.name}（${r.kind}） ${r.primaryUrl}`);
  }
  lines.push("");
  lines.push("## 要調整・要調査");
  lines.push("");
  for (const r of results.filter((x) => x.status !== "候補OK")) {
    lines.push(`- ${r.name}：${r.status} / ${r.kind} / ${r.reason}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const kankatsu = decodeHtml(await getBuf(KANKATSU));
  const bureaus = extractBureaus(kankatsu);
  console.log(`調査対象: ${bureaus.length}法務局`);

  const results = [];
  for (let i = 0; i < bureaus.length; i++) {
    const b = bureaus[i];
    process.stdout.write(`[${i + 1}/${bureaus.length}] ${b.name} ... `);
    const result = await scanBureau(b);
    results.push(result);
    console.log(`${result.status} / ${result.kind}`);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");
  fs.writeFileSync(OUT_MD, toMarkdown(results), "utf8");
  console.log(`\n出力: ${OUT_JSON}`);
  console.log(`出力: ${OUT_MD}`);
}

main();

