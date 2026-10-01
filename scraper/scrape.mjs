// 登記完了予定日スクレイパ
// 出力: ../app/data/kanryo.json / ../app/data/kanryo.js
// 仕様: 申請日 -> 完了予定日。AM/PMは無視し、同一申請日の遅い方を採用。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "app", "data", "kanryo.json");
const INTEGRITY_OUT = path.join(__dirname, "..", "app", "data", "kanryo-integrity.js");

const TYPES = [
  { id: "realEstate", label: "不動産（権利）" },
  { id: "commercial", label: "商業・法人" },
];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const minimum = (realEstateOffices, realEstateEntries, commercialOffices = 1, commercialEntries = 3) => ({
  realEstate: { offices: realEstateOffices, entries: realEstateEntries },
  commercial: { offices: commercialOffices, entries: commercialEntries },
});

const JURISDICTIONS = [
  {
    id: "sapporo",
    label: "札幌法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/sapporo/static/page000061.html",
    minimums: minimum(10, 70, 1, 8),
  },
  {
    id: "hakodate",
    label: "函館地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/hakodate/static/Kanryouyotei.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },  {
    id: "asahikawa",
    label: "旭川地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/asahikawa/static/touki.htm",
    minimums: minimum(4, 15, 1, 3),
  },
  {
    id: "kushiro",
    label: "釧路地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/kushiro/static/page000075.html",
    minimums: minimum(4, 15, 4, 15),
  },
  {
    id: "sendai",
    label: "仙台法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/sendai/static/Touki_kanryou.htm",
    minimums: minimum(6, 30, 1, 5),
  },
  {
    id: "fukushima",
    label: "福島地方法務局",
    kind: "htmlSequentialOfficeTables",
    pageUrl: "https://houmukyoku.moj.go.jp/fukushima/static/HP.htm",
    officeSequence: ["本局", "相馬支局", "郡山支局", "白河支局", "若松支局", "いわき支局", "二本松出張所", "田島出張所", "富岡出張所"],
    commercialOffices: ["本局"],
    minimums: minimum(9, 50, 1, 8),
  },  {
    id: "yamagata",
    label: "山形地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/yamagata/static/sinkanryoubi.htm",
    minimums: minimum(5, 30, 1, 4),
  },
  {
    id: "morioka",
    label: "盛岡地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/morioka/static/category_00015.html",
    minimums: minimum(5, 25, 1, 7),
  },
  {
    id: "akita",
    label: "秋田地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/akita/static/newpege1.htm",
    minimums: minimum(4, 20, 1, 4),
  },
  {
    id: "aomori",
    label: "青森地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/aomori/static/kanryoubi.htm",
    minimums: minimum(5, 20, 1, 3),
  },
  {
    id: "tokyo",
    label: "東京法務局",
    kind: "indexLinks",
    indexUrl: "https://houmukyoku.moj.go.jp/tokyo/category_00019.html",
    linkPattern: /kanryoyotei[^\"]*\.html?/i,
    minimums: {
      realEstate: { offices: 10, entries: 50 },
      commercial: { offices: 10, entries: 50 },
    },
  },
  {
    id: "yokohama",
    label: "横浜地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/yokohama/static/kanryoyoteibi.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },
  {
    id: "saitama",
    label: "さいたま地方法務局",
    kind: "pdfSaitama",
    pdfUrl: "https://houmukyoku.moj.go.jp/saitama/content/001142352.pdf",
    minimums: minimum(15, 80, 1, 5),
  },
  {
    id: "chiba",
    label: "千葉地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/chiba/static/kanryoyoteibi.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },
  {
    id: "mito",
    label: "水戸地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/mito/static/kanryouyoteibi.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },
  {
    id: "utsunomiya",
    label: "宇都宮地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/utsunomiya/static/kanryouPage.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },  {
    id: "maebashi",
    label: "前橋地方法務局",
    kind: "pdfDirect",
    pdfUrl: "https://houmukyoku.moj.go.jp/maebashi/content/001253538.pdf",
    minimums: minimum(8, 60, 1, 5),
  },  {
    id: "kofu",
    label: "甲府地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/kofu/static/kanryou.htm",
    minimums: minimum(4, 20, 1, 4),
  },
  {
    id: "nagano",
    label: "長野地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/nagano/static/kanryou.htm",
    minimums: minimum(8, 80, 1, 8),
  },
  {
    id: "niigata",
    label: "新潟地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/niigata/static/yotei.htm",
    minimums: minimum(10, 100, 1, 10),
  },
  {
    id: "shizuoka",
    label: "静岡地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/shizuoka/static/yotei.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },
  {
    id: "nagoya",
    label: "名古屋法務局",
    kind: "htmlSequentialOfficeTables",
    pageUrl: "https://houmukyoku.moj.go.jp/nagoya/static/toukikanryou.htm",
    officeSequence: ["本局登記部門", "春日井支局", "津島支局", "一宮支局", "半田支局", "岡崎支局", "刈谷支局", "豊田支局", "西尾支局", "豊橋支局", "新城支局", "熱田出張所", "名東出張所", "豊川出張所"],
    minimums: minimum(14, 100, 1, 10),
  },
  {
    id: "gifu",
    label: "岐阜地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/gifu/static/kanryoyotei.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },  {
    id: "tsu",
    label: "津地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/tsu/static/toki_kanryo.html",
    minimums: minimum(7, 25, 1, 3),
  },
  {
    id: "fukui",
    label: "福井地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/fukui/static/kanryoyotei.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },
  {
    id: "kanazawa",
    label: "金沢地方法務局",
    kind: "htmlSequentialOfficeTables",
    pageUrl: "https://houmukyoku.moj.go.jp/kanazawa/static/kanryouyoteibi.html",
    officeSequence: ["本局登記部門", "小松支局", "七尾支局", "輪島支局"],
    minimums: minimum(4, 25, 1, 5),
  },
  {
    id: "toyama",
    label: "富山地方法務局",
    kind: "htmlSequentialOfficeTables",
    pageUrl: "https://houmukyoku.moj.go.jp/toyama/static/kanryoyotei.htm",
    officeSequence: ["本局登記部門", "魚津支局", "高岡支局", "砺波支局"],
    minimums: minimum(4, 25, 1, 5),
  },  {
    id: "osaka",
    label: "大阪法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/osaka/static/kanryobi.html",
    minimums: {
      realEstate: { offices: 8, entries: 40 },
      commercial: { offices: 3, entries: 20 },
    },
  },
  {
    id: "kyoto",
    label: "京都地方法務局",
    kind: "pdfKyotoColumns",
    indexUrl: "https://houmukyoku.moj.go.jp/kyoto/category_00011.html",
    minimums: minimum(9, 40, 1, 5),
  },
  {
    id: "kobe",
    label: "神戸地方法務局",
    kind: "pdfKobe",
    indexUrl: "https://houmukyoku.moj.go.jp/kobe/category_00006.html",
    minimums: minimum(15, 80, 1, 5),
  },  {
    id: "nara",
    label: "奈良地方法務局",
    kind: "pdfMatrixCoordinates",
    pdfUrl: "https://houmukyoku.moj.go.jp/nara/content/001137057.pdf",
    pdfOffices: ["本局", "葛城支局", "中和支局", "五條支局"],
    minimums: minimum(4, 20, 1, 3),
  },  {
    id: "otsu",
    label: "大津地方法務局",
    kind: "htmlMatrixByOfficeRows",
    indexUrl: "https://houmukyoku.moj.go.jp/otsu/category_00012.html",
    minimums: minimum(5, 30, 1, 5),
  },
  {
    id: "wakayama",
    label: "和歌山地方法務局",
    kind: "pdfMatrixRows",
    pdfUrl: "https://houmukyoku.moj.go.jp/wakayama/content/001153033.pdf",
    pdfOffices: ["本局", "橋本支局", "田辺支局", "御坊支局", "新宮支局"],
    minimums: minimum(5, 20, 1, 3),
  },  {
    id: "hiroshima",
    label: "広島法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/hiroshima/static/kanryoubi.htm",
    minimums: minimum(6, 25, 1, 3),
  },
  {
    id: "okayama",
    label: "岡山地方法務局",
    kind: "pdfMatrixCoordinates",
    pdfOffices: ["本局", "備前支局", "倉敷支局", "笠岡支局", "高梁支局", "津山支局"],
    indexUrl: "https://houmukyoku.moj.go.jp/okayama/category_00011.html",
    minimums: minimum(6, 18, 1, 3),
  },  {
    id: "yamaguchi",
    label: "山口地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/yamaguchi/static/kanryou.htm",
    minimums: minimum(5, 20, 1, 3),
  },
  {
    id: "tottori",
    label: "鳥取地方法務局",
    kind: "pdfMatrixRows",
    pdfUrl: "https://houmukyoku.moj.go.jp/tottori/content/000135641.pdf",
    pdfOffices: ["本局", "倉吉支局", "米子支局"],
    minimums: minimum(3, 10, 1, 3),
  },
  {
    id: "matsue",
    label: "松江地方法務局",
    kind: "pdfMatrixCoordinates",
    indexUrl: "https://houmukyoku.moj.go.jp/matsue/standard/aaaa.html",
    pdfOffices: ["本局登記部門", "出雲支局", "浜田支局", "益田支局", "西郷支局"],
    minimums: minimum(5, 15, 1, 3),
  },
  {
    id: "takamatsu",
    label: "高松法務局",
    kind: "pdfMatrixRows",
    indexUrl: "https://houmukyoku.moj.go.jp/takamatsu/category_00013.html",
    pdfOffices: ["本局", "丸亀支局", "観音寺支局", "寒川出張所"],
    minimums: minimum(4, 12, 1, 3),
  },
  {
    id: "tokushima",
    label: "徳島地方法務局",
    kind: "pdfMatrixCoordinates",
    indexUrl: "https://houmukyoku.moj.go.jp/tokushima/category_00006.html",
    pdfOffices: ["本局", "阿南支局", "美馬支局"],
    minimums: minimum(3, 12, 1, 3),
  },
  {
    id: "kochi",
    label: "高知地方法務局",
    kind: "pdfMatrixRows",
    pdfUrl: "https://houmukyoku.moj.go.jp/kochi/content/001414262.pdf",
    pdfOffices: ["本局", "香美支局", "須崎支局", "安芸支局", "四万十支局"],
    minimums: minimum(5, 15, 1, 3),
  },
  {
    id: "matsuyama",
    label: "松山地方法務局",
    kind: "pdfMatrixCoordinates",
    indexUrl: "https://houmukyoku.moj.go.jp/matsuyama/category_00013.html",
    pdfOffices: ["本局", "大洲支局", "西条支局", "今治支局", "宇和島支局", "砥部出張所", "四国中央支局"],
    minimums: minimum(7, 25, 1, 3),
  },  {
    id: "saga",
    label: "佐賀地方法務局",
    kind: "htmlSagaMatrix",
    pageUrl: "https://houmukyoku.moj.go.jp/saga/static/saga.htm",
    minimums: minimum(4, 35, 1, 5),
  },
  {
    id: "fukuoka",
    label: "福岡法務局",
    kind: "htmlSequentialOfficeTables",
    pageUrl: "https://houmukyoku.moj.go.jp/fukuoka/static/kanryoubi.htm",
    officeSequence: ["本局", "筑紫支局", "朝倉支局", "飯塚支局", "直方支局", "久留米支局", "柳川支局", "八女支局", "北九州支局", "行橋支局", "田川支局", "西新出張所", "粕屋出張所", "福間出張所", "八幡出張所"],
    commercialOffices: ["本局", "北九州支局"],
    minimums: minimum(15, 100, 2, 20),
  },
  {
    id: "nagasaki",
    label: "長崎地方法務局",
    kind: "pdfNagasaki",
    pdfUrl: "https://houmukyoku.moj.go.jp/nagasaki/content/000133576.pdf",
    minimums: minimum(8, 100, 1, 10),
  },  {
    id: "kumamoto",
    label: "熊本地方法務局",
    kind: "pdfFromIndex",
    indexUrl: "https://houmukyoku.moj.go.jp/kumamoto/category_00012.html",
    minimums: minimum(6, 40, 1, 5),
  },  {
    id: "oita",
    label: "大分地方法務局",
    kind: "htmlPage",
    pageUrl: "https://houmukyoku.moj.go.jp/oita/static/kanryoyotei.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },  {
    id: "kagoshima",
    label: "鹿児島地方法務局",
    kind: "pdfFromIndex",
    indexUrl: "https://houmukyoku.moj.go.jp/kagoshima/category_00015.html",
    minimums: {
      realEstate: { offices: 5, entries: 25 },
      commercial: { offices: 1, entries: 10 },
    },
  },
  {
    id: "miyazaki",
    label: "宮崎地方法務局",
    kind: "pdfMatrixCoordinates",
    pdfUrl: "https://houmukyoku.moj.go.jp/miyazaki/page000082_00002.pdf",
    pdfOffices: ["本局", "都城支局", "延岡支局", "日南支局", "小林出張所", "高鍋出張所"],
    minimums: minimum(6, 30, 1, 5),
  },
  {
    id: "naha",
    label: "那覇地方法務局",
    kind: "htmlNahaMatrix",
    pageUrl: "https://houmukyoku.moj.go.jp/naha/static/toukikanryou.htm",
    minimums: { realEstate: { offices: 1, entries: 3 } },
  },];

function dec(buf) {
  const head = buf.toString("ascii", 0, Math.min(buf.length, 4096));
  const m = head.match(/charset=["']?([^"' >]+)/i);
  const charset = (m?.[1] || "utf-8").toLowerCase();
  const encoding = /shift|sjis|windows-31j/.test(charset) ? "shift_jis" : "utf-8";
  return new TextDecoder(encoding).decode(buf);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REQUEST_DELAY_MS = (() => {
  const value = Number.parseInt(process.env.TOUKI_SCRAPE_DELAY_MS || "1500", 10);
  return Number.isFinite(value) && value >= 0 ? value : 1500;
})();
let lastRequestAt = 0;

async function waitForPoliteInterval() {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt && elapsed < REQUEST_DELAY_MS) {
    await sleep(REQUEST_DELAY_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

async function getBuf(url) {
  let lastError;
  for (let i = 1; i <= 3; i++) {
    try {
      await waitForPoliteInterval();
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent": "Mozilla/5.0 touki-kanryo-app (+https://tools.ishimoto-legal.com/)",
        },
      });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastError = e;
      if (i < 3) await sleep(700 * i);
    }
  }
  throw lastError;
}

function cleanText(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowsOf(html) {
  return [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => cellsOf(m[0]));
}

function cellsOf(tr) {
  return [...tr.matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((td) => cleanText(td[0]));
}

function normalizeNumbers(text) {
  return String(text || "").replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// "令和8年" を西暦へ
function reiwaToYear(text) {
  const m = normalizeNumbers(text).match(/令和\s*(\d+)\s*年/);
  return m ? 2018 + Number(m[1]) : new Date().getFullYear();
}

// "令和8年6月11日（木）AM" / "6月11日(木)" -> { mm, dd, ampm }
const DATE_RE = /(?:令和\s*\d+\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(]\s*.?\s*[）)])?\s*(AM|PM|午前|午後)?/;
const DATE_RE_GLOBAL = /(?:令和\s*\d+\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(]\s*.?\s*[）)])?\s*(AM|PM|午前|午後)?/g;

function parseMD(s) {
  const m = normalizeNumbers(s).match(DATE_RE);
  if (!m) return null;
  return { mm: Number(m[1]), dd: Number(m[2]), ampm: m[3] || null };
}

function datesInText(s) {
  return [...normalizeNumbers(s).matchAll(DATE_RE_GLOBAL)].map((m) => ({
    mm: Number(m[1]),
    dd: Number(m[2]),
    ampm: m[3] || null,
  }));
}

function datesInSlashText(s) {
  return [...normalizeNumbers(s).matchAll(/(\d{1,2})\s*[\/／]\s*(\d{1,2})(?:\s*(AM|PM|午前|午後))?/g)].map((m) => ({
    mm: Number(m[1]),
    dd: Number(m[2]),
    ampm: m[3] || null,
  }));
}

function hasMultipleOfficeNames(text) {
  const compact = compactPdfText(text);
  const hits = compact.match(/支局|出張所/g) || [];
  return hits.length > 1;
}

function singleOfficeFromPdfLine(line, jurisdiction) {
  if (hasMultipleOfficeNames(line)) return null;
  return normalizeOfficeName(line, jurisdiction);
}

const iso = (y, mm, dd) => `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;

// 法務局ページの「令和○年」は完了予定日側の年として扱う。
// 例: 令和8年ページで「12月26日申請 -> 1月8日完了」は 2025-12-26 -> 2026-01-08。
function resolveYears(baseYear, appliedMonth, completedMonth) {
  const crossesYear = completedMonth < appliedMonth;
  return {
    applyYear: crossesYear ? baseYear - 1 : baseYear,
    completeYear: baseYear,
  };
}

function makeStores() {
  return Object.fromEntries(
    JURISDICTIONS.map((j) => [j.id, Object.fromEntries(TYPES.map((type) => [type.id, {}]))])
  );
}

function normalizeOfficeName(text, jurisdiction) {
  let t = cleanText(text)
    .replace(/一覧に戻る|庁選択に戻る|庁選択にもどる|TOP/g, "")
    .replace(/[【】\[\]■◆●]/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!t) return null;
  if (/必ず|ご覧|クリック|戻る|申請日|更新日|各庁別|登記完了予定日|トップページ|以下|下記以前|完了予定日について/.test(t)) {
    return null;
  }
  if (/^\d+$/.test(t)) return null;
  if (jurisdiction.id === "osaka" && /^本局/.test(t)) return "本局";
  const compactLabel = jurisdiction.label.replace(/\s/g, "");
  if (t === `${compactLabel}本局`) return "本局";
  if (jurisdiction.id === "kagoshima" && t === "鹿児島地方法務局本局") return "本局";
  if (/^本局[（(]/.test(t)) return "本局";
  if (t === "支局" || t === "出張所") return null;
  if (/^本局（山口）$/.test(t)) return "本局";
  if (t === "登記部門") return "本局登記部門";
  if (/(支局|出張所|部門|本局)$/.test(t)) return t;
  return null;
}

function officeFromCells(cells, jurisdiction) {
  const nonempty = cells.filter(Boolean);
  if (nonempty.length === 0) return null;
  if (nonempty.length === 1) return normalizeOfficeName(nonempty[0], jurisdiction);
  if (/戻る|もどる/.test(nonempty.join(" "))) return normalizeOfficeName(nonempty[0], jurisdiction);
  if (/^\d+$/.test(nonempty[0])) return normalizeOfficeName(nonempty[1], jurisdiction);
  if (/^■?本局/.test(nonempty[0])) return normalizeOfficeName(nonempty[0], jurisdiction);
  const firstOffice = normalizeOfficeName(nonempty[0], jurisdiction);
  if (firstOffice && nonempty.length <= 2 && !/申請日|登記完了|完了予定|不動産|商業/.test(nonempty.join(" "))) return firstOffice;
  if (firstOffice && nonempty.length <= 4 && /更新|取り扱|取扱/.test(nonempty.join(" "))) return firstOffice;
  return null;
}

function addEntry(stores, jurisdictionId, typeId, officeName, baseYear, applied, completed) {
  const { applyYear, completeYear } = resolveYears(baseYear, applied.mm, completed.mm);
  const applyISO = iso(applyYear, applied.mm, applied.dd);
  const completeISO = iso(completeYear, completed.mm, completed.dd);
  const office = (stores[jurisdictionId][typeId][officeName] ||= {});
  // 同一申請日でAM/PM等の複数行がある場合は、遅い完了予定日を採用。
  if (!office[applyISO] || completeISO > office[applyISO]) office[applyISO] = completeISO;
}

function rowHasCommercial(text) {
  return /商業\s*[・･・]?\s*法人|商業法人/.test(text);
}
function rowHasRealEstate(text) {
  return /不動産.*権利|不動産登記（権利）|不動産登記\(権利\)/.test(text);
}

function parseDateRow(raw, stores, jurisdiction, currentOffice, baseYear, tableState) {
  if (!currentOffice) return false;
  const cells = raw.filter(Boolean);
  if (cells.length === 0) return false;
  const joined = cells.join(" ");
  const dates = datesInText(joined);
  if (dates.length === 0) return false;

  const firstCellDate = parseMD(cells[0]);
  let applied;
  let dueDates;
  if (firstCellDate && dates.length >= 2) {
    applied = dates[0];
    dueDates = dates.slice(1);
    tableState.lastApplied = applied;
  } else if (tableState.lastApplied && dates.length >= 1) {
    applied = tableState.lastApplied;
    dueDates = dates;
  } else {
    return false;
  }

  if (dueDates.length === 0) return false;
  if (tableState.hasRealEstate || !tableState.hasCommercial) {
    addEntry(stores, jurisdiction.id, "realEstate", currentOffice, baseYear, applied, dueDates[0]);
  }
  if (tableState.hasCommercial) {
    // 「商業・法人」列が見出しにあっても、支局では「-」で日付がない場合がある。
    // 不動産（権利）＋不動産（表示）＋商業・法人の3日付以上があるときだけ商業を採用する。
    const commercialDate = tableState.hasRealEstate
      ? (dueDates.length >= 3 ? dueDates[dueDates.length - 1] : null)
      : dueDates[0];
    if (commercialDate) addEntry(stores, jurisdiction.id, "commercial", currentOffice, baseYear, applied, commercialDate);
  }
  return true;
}

function parseHtmlTables(html, stores, jurisdiction) {
  const baseYear = reiwaToYear(html);
  const tokenRe = /<h[1-6]\b[\s\S]*?<\/h[1-6]>|<a\b[^>]*name=["'][^"']+["'][^>]*>[\s\S]*?<\/a>|<tr\b[\s\S]*?<\/tr>/gi;
  let currentOffice = null;
  let inTable = false;
  let tableState = { hasRealEstate: false, hasCommercial: false, lastApplied: null };

  for (const token of html.matchAll(tokenRe)) {
    const rawToken = token[0];
    if (/^<h/i.test(rawToken) || /^<a/i.test(rawToken)) {
      const office = normalizeOfficeName(rawToken, jurisdiction);
      if (office) {
        currentOffice = office;
        inTable = false;
        tableState = { hasRealEstate: false, hasCommercial: false, lastApplied: null };
      } else if (/必ずお読みください/.test(cleanText(rawToken))) {
        inTable = false;
      }
      continue;
    }

    const raw = cellsOf(rawToken);
    const cells = raw.filter((x) => x !== "");
    if (cells.length === 0) continue;

    const office = officeFromCells(cells, jurisdiction);
    if (office) {
      currentOffice = office;
      inTable = false;
      tableState = { hasRealEstate: false, hasCommercial: false, lastApplied: null };
      continue;
    }

    const joined = cells.join(" ");
    const looksLikeHeader = /申\s*請\s*日|登記完了|完了予定日|不動産.*権利|商業/.test(joined) && !parseMD(cells[0]);
    if (looksLikeHeader) {
      inTable = true;
      if (rowHasRealEstate(joined)) tableState.hasRealEstate = true;
      if (rowHasCommercial(joined)) tableState.hasCommercial = true;
      continue;
    }
    if (!inTable) continue;
    if (!parseDateRow(raw, stores, jurisdiction, currentOffice, baseYear, tableState)) {
      if (/^（注）|確認方法|庁選択/.test(cells[0])) inTable = false;
    }
  }
}

function parseHtmlMatrixByOfficeRows(html, stores, jurisdiction) {
  const baseYear = reiwaToYear(html);
  const rows = rowsOf(html).map((row) => row.filter(Boolean));
  let offices = [];
  let currentApply = null;

  for (const row of rows) {
    if (row.length === 0) continue;
    const joined = row.join(" ");
    if (/庁\s*名/.test(joined)) continue;
    if (row.some((cell) => /支局|出張所|本局/.test(cell)) && row.length >= 3 && !/申請日|登記の種類/.test(joined)) {
      offices = row.map((cell) => normalizeOfficeName(cell, jurisdiction)).filter(Boolean);
      continue;
    }

    const firstDate = parseMD(row[0]);
    let typeText = "";
    let dueCells = [];
    if (firstDate) {
      currentApply = firstDate;
      typeText = row[1] || "";
      dueCells = row.slice(2);
    } else if (currentApply && /(権利|商業)/.test(row[0] || "")) {
      typeText = row[0] || "";
      dueCells = row.slice(1);
    } else {
      continue;
    }

    if (!offices.length) continue;
    for (let i = 0; i < offices.length; i++) {
      const due = parseMD(dueCells[i] || "");
      if (!due) continue;
      if (/権利/.test(typeText)) addEntry(stores, jurisdiction.id, "realEstate", offices[i], baseYear, currentApply, due);
      if (/商業/.test(typeText)) addEntry(stores, jurisdiction.id, "commercial", offices[i], baseYear, currentApply, due);
    }
  }
}

function parseHtmlSequentialOfficeTables(html, stores, jurisdiction) {
  const baseYear = reiwaToYear(html);
  const rows = rowsOf(html).map((row) => row.filter(Boolean));
  const offices = jurisdiction.officeSequence || [];
  let officeIndex = -1;
  let currentOffice = null;
  let tableState = { hasRealEstate: false, hasCommercial: false, lastApplied: null };

  for (const row of rows) {
    if (row.length === 0) continue;
    const joined = row.join(" ");
    const firstCell = cleanText(row[0] || "");
    const startsTable = (/^申\s*請\s*日/.test(firstCell) || /LINK.*申\s*請\s*日/.test(joined)) &&
      (/登\s*記\s*完\s*了|完了予定|不動産.*権利/.test(joined)) &&
      datesInText(joined).length === 0;
    if (startsTable) {
      officeIndex += 1;
      currentOffice = offices[officeIndex] || null;
      tableState = { hasRealEstate: false, hasCommercial: false, lastApplied: null };
      if (rowHasRealEstate(joined)) tableState.hasRealEstate = true;
      if (rowHasCommercial(joined) || /商業法人/.test(joined)) tableState.hasCommercial = true;
      continue;
    }
    if (!currentOffice) continue;

    const looksLikeHeader = /不動産.*権利|商業/.test(joined) && !parseMD(row[0] || "");
    if (looksLikeHeader) {
      if (rowHasRealEstate(joined)) tableState.hasRealEstate = true;
      if (rowHasCommercial(joined) || /商業法人/.test(joined)) tableState.hasCommercial = true;
      continue;
    }
    const rowState = { ...tableState };
    if (jurisdiction.commercialOffices && !jurisdiction.commercialOffices.includes(currentOffice)) {
      rowState.hasCommercial = false;
    }
    parseDateRow(row, stores, jurisdiction, currentOffice, baseYear, rowState);
  }
}

function parseHtmlNahaMatrix(html, stores, jurisdiction) {
  const baseYear = reiwaToYear(html);
  const rows = rowsOf(html).map((row) => row.filter(Boolean));
  let offices = [];
  let currentApply = null;

  for (const row of rows) {
    if (row.length === 0) continue;
    const joined = row.join(" ");
    if (/本\s*局/.test(joined) && /支局|出張所/.test(joined) && !/申請日|登記の種類/.test(joined)) {
      offices = row.map((cell) => normalizeOfficeName(cell, jurisdiction)).filter(Boolean);
      continue;
    }

    const apply = datesInSlashText(row[0] || "")[0];
    let typeText = "";
    let dueCells = [];
    if (apply) {
      currentApply = apply;
      typeText = row[1] || "";
      dueCells = row.slice(2);
    } else if (currentApply && /不動産|商業/.test(row[0] || "")) {
      typeText = row[0] || "";
      dueCells = row.slice(1);
    } else {
      continue;
    }

    if (!offices.length) continue;
    if (/不動産.*権利/.test(typeText)) {
      for (let i = 0; i < offices.length; i++) {
        const due = parseMD(dueCells[i] || "");
        if (due) addEntry(stores, jurisdiction.id, "realEstate", offices[i], baseYear, currentApply, due);
      }
    } else if (/商業/.test(typeText)) {
      const due = parseMD(dueCells[0] || "");
      if (due) addEntry(stores, jurisdiction.id, "commercial", offices[0], baseYear, currentApply, due);
    }
  }
}

function parseHtmlSagaMatrix(html, stores, jurisdiction) {
  const baseYear = reiwaToYear(html);
  const rows = rowsOf(html).map((row) => row.filter(Boolean));
  let offices = [];

  for (const row of rows) {
    if (row[0] === "申請日") {
      offices = row.slice(1).map((cell) => normalizeOfficeName(cell, jurisdiction)).filter(Boolean);
      continue;
    }
    const dates = datesInText(row.join(" "));
    if (!offices.length || dates.length < 2 || !parseMD(row[0] || "")) continue;

    const applied = dates[0];
    const dueDates = dates.slice(1);
    if (offices[0] && dueDates[0]) {
      addEntry(stores, jurisdiction.id, "realEstate", offices[0], baseYear, applied, dueDates[0]);
    }

    let offset = 1;
    if (dueDates.length > offices.length && dueDates[1]) {
      addEntry(stores, jurisdiction.id, "commercial", offices[0], baseYear, applied, dueDates[1]);
      offset = 2;
    }
    for (let i = 1; i < offices.length; i++) {
      const due = dueDates[offset + i - 1];
      if (due) addEntry(stores, jurisdiction.id, "realEstate", offices[i], baseYear, applied, due);
    }
  }
}

function absoluteUrl(href, baseUrl) {
  return new URL(href, baseUrl).toString();
}

function extractLinks(html, source) {
  return [...html.matchAll(/href="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((href) => source.linkPattern.test(href))
    .map((href) => absoluteUrl(href, source.indexUrl));
}

function extractScheduleLink(html, source, hrefPattern) {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: m[1], text: cleanText(m[2]) }));
  const hit = anchors.find((a) => /登記完了(?:予定)?日/.test(a.text.replace(/\s/g, "")) && (!hrefPattern || hrefPattern.test(a.href)));
  if (!hit) throw new Error("登記完了予定日のリンクが見つかりません。");
  return absoluteUrl(hit.href, source.indexUrl);
}

function extractPdfLink(html, source) {
  return extractScheduleLink(html, source, /\.pdf(?:$|[?#])/i);
}
async function pdfLines(buf) {
  const pdf = await getDocument({ data: new Uint8Array(buf), disableWorker: true }).promise;
  const lines = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const byLine = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const row = byLine.get(y) || [];
      row.push({ x: item.transform[4], text: item.str });
      byLine.set(y, row);
    }
    for (const [, row] of [...byLine.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push(row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "));
    }
  }
  return lines.map(cleanText).filter(Boolean);
}

async function pdfTextItems(buf) {
  const pdf = await getDocument({ data: new Uint8Array(buf), disableWorker: true }).promise;
  const items = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    for (const item of content.items) {
      const text = cleanText(item.str || "");
      if (!text) continue;
      items.push({ pageNo, x: item.transform[4], y: item.transform[5], width: item.width, text });
    }
  }
  return items;
}


function parseOfficeCoordinateItems(items, stores, jurisdiction) {
  const baseYear = reiwaToYear(items.map(i=>i.text).join(" "));
  for(const pageNo of new Set(items.map(i=>i.pageNo))) {
    const page=items.filter(i=>i.pageNo===pageNo);
    const dateItems=page.filter(i=>/^令和.*月.*日/.test(i.text));
    if(!dateItems.length) continue;
    const title=page.filter(i=>i.y>730).map(i=>compactPdfText(i.text)).find(t=>/^【.*(?:部門|支局|出張所)】$/.test(t)||/^(?:本局(?:不動産|法人)登記部門|[^【】]+(?:支局|出張所))$/.test(t));
    if(!title) throw new Error("PDFの庁名を特定できません。");
    const office=title.replace(/[【】]/g,"");
    const applyX=Math.min(...dateItems.map(i=>i.x));
    const rows=[];
    for(const item of dateItems.sort((a,b)=>b.y-a.y||a.x-b.x)) {
      let row=rows.find(r=>Math.abs(r.y-item.y)<3);
      if(!row){row={y:item.y,items:[]};rows.push(row);} row.items.push(item);
    }
    let applied=null;
    for(const row of rows.sort((a,b)=>b.y-a.y)) {
      const application=row.items.find(i=>i.x<applyX+30);
      if(application) applied=parseMD(application.text);
      const due=row.items.filter(i=>i.x>=applyX+30).sort((a,b)=>a.x-b.x);
      if(!applied || !due.length) throw new Error("申請日と完了日の対応が不明です。");
      if(/本局法人/.test(office)) {
        for(const item of due) addEntry(stores,jurisdiction.id,"commercial",office,baseYear,applied,parseMD(item.text));
      } else {
        addEntry(stores,jurisdiction.id,"realEstate",office,baseYear,applied,parseMD(due[0].text));
        if(jurisdiction.id==="maebashi" && office==="本局登記部門" && due[2]) addEntry(stores,jurisdiction.id,"commercial",office,baseYear,applied,parseMD(due[2].text));
      }
    }
  }
}

async function parsePdf(buf, stores, jurisdiction) {
  if (jurisdiction.id === "maebashi") return parseOfficeCoordinateItems(await pdfTextItems(buf), stores, jurisdiction);
  const lines = await pdfLines(buf);
  const baseYear = reiwaToYear(lines.join("\n"));
  let currentOffice = null;

  for (const line of lines) {
    const office = normalizeOfficeName(line, jurisdiction);
    if (office) {
      currentOffice = office;
      continue;
    }
    if (!currentOffice) continue;

    const dates = datesInText(line);
    if (dates.length < 2) continue;

    addEntry(stores, jurisdiction.id, "realEstate", currentOffice, baseYear, dates[0], dates[1]);
    // PDFでは、本局など一部だけ「申請日 / 不動産（権利） / 不動産（表示） / 商業・法人」の4日付。
    if (dates.length >= 4) {
      addEntry(stores, jurisdiction.id, "commercial", currentOffice, baseYear, dates[0], dates[3]);
    }
  }
}

function compactPdfText(text) {
  return String(text || "").replace(/\s/g, "").replace(/[()（）]/g, "");
}


// Match actual PDF coordinates: merged application-date cells and split labels
// must never turn a completion date into an application date.
function parseMatrixCoordinateItems(items, stores, jurisdiction) {
  const baseYear = reiwaToYear([...items].sort((a,b)=>a.pageNo-b.pageNo||b.y-a.y).map(i => i.text).join(" "));
  for (const pageNo of new Set(items.map(i => i.pageNo))) {
    const page = items.filter(i => i.pageNo === pageNo);
    // PDF text extraction can merge adjacent office headings into one item.
    // Recover their positions from the first date row inside that item's bounds.
    const combinedHeaders = [];
    for (const item of page) {
      const names = item.text.trim().split(/\s+/);
      if (names.length < 2 || !names.every(name => jurisdiction.pdfOffices?.includes(name)) || !(item.width > 0)) continue;
      const below = page.filter(i => i.y < item.y && i.x >= item.x - 10 && i.x < item.x + item.width && parseMD(i.text));
      const topY = Math.max(...below.map(i => i.y));
      const columns = below.filter(i => Math.abs(i.y - topY) < 3).sort((a,b) => a.x-b.x);
      if (columns.length !== names.length) throw new Error("結合された庁名の列対応が不明です。");
      names.forEach((text,index) => combinedHeaders.push({text,x:columns[index].x,y:item.y}));
    }
    const headers = (jurisdiction.pdfOffices || []).map(office => {
      let hit = [...page, ...combinedHeaders].find(i => compactPdfText(i.text) === office || (office === "本局" && compactPdfText(i.text) === "本"));
      if (!hit && jurisdiction.id === "miyazaki") {
        const topRight = page.filter(i=>/権/.test(i.text)).sort((a,b)=>b.y-a.y)[0];
        const columns = page.filter(i=>i.x>topRight.x+50 && Math.abs(i.y-topRight.y)<6 && parseMD(i.text)).sort((a,b)=>a.x-b.x);
        for (const column of columns) {
          const fragments = page.filter(i=>i.y>topRight.y+8 && i.y<topRight.y+35 && i.x>=column.x-1 && i.x<column.x+50);
          const label = fragments.sort((a,b)=>Math.abs(a.y-b.y)<4?a.x-b.x:b.y-a.y).map(i=>compactPdfText(i.text)).join("");
          if (label===office) hit={x:column.x,y:topRight.y+20};
        }
      }
      if (!hit) throw new Error(office + "の列見出しがありません。");
      return { office, x: hit.x, y: hit.y };
    }).sort((a,b) => a.x-b.x);
    if (!headers.length) throw new Error("庁名の列見出しがありません。");
    const firstDueX = Math.min(...page.filter(i => i.x >= headers[0].x-26 && i.y < headers[0].y && parseMD(i.text)).map(i=>i.x));
    const typeItems = page.filter(i => i.x < firstDueX - 2);
    const rights = typeItems.filter(i => /権/.test(i.text)).map(i => ({
      ...i, label: compactPdfText(typeItems.filter(t => Math.abs(t.y-i.y)<5).sort((a,b)=>a.x-b.x).map(t=>t.text).join(""))
    })).filter(i => /権利/.test(i.label)).sort((a,b)=>b.y-a.y);
    if (!rights.length) throw new Error("権利の行見出しがありません。");
    const typeX = Math.min(...typeItems.filter(i=>/不動産|商業/.test(compactPdfText(i.text)) && i.y > rights.at(-1).y-50).map(i=>i.x));
    const applications = page.filter(i=>i.x < typeX && parseMD(i.text) && i.y < headers[0].y);
    if (applications.length !== rights.length) throw new Error("申請日と権利行の数が一致しません。");
    const matched = new Set();
    for (const app of applications) {
      const right = [...rights].sort((a,b)=>Math.abs(a.y-app.y)-Math.abs(b.y-app.y))[0];
      if (matched.has(right)) throw new Error("申請日の行対応が重複しています。");
      matched.add(right);
      const nextY = rights[rights.indexOf(right)+1]?.y ?? -Infinity;
      const commercial = typeItems.filter(i=>i.y < right.y && i.y > nextY).find(i=>{
        const label=compactPdfText(typeItems.filter(t=>Math.abs(t.y-i.y)<3).sort((a,b)=>a.x-b.x).map(t=>t.text).join(""));
        return /^商業[・]?法人$/.test(label);
      });
      for (const [type, label] of [["realEstate",right],["commercial",commercial]]) {
        if (!label) continue;
        const dates = page.filter(i=>i.x >= headers[0].x-25 && Math.abs(i.y-label.y)<6 && parseMD(i.text));
        if ((type === "realEstate" && dates.length !== headers.length) || !dates.length) throw new Error(`完了日の列数が一致しません: ${jurisdiction.id} ${type} y=${label.y} dates=${dates.length}`);
        const used = new Set();
        for (const date of dates) {
          const header = [...headers].sort((a,b)=>Math.abs(a.x-date.x)-Math.abs(b.x-date.x))[0];
          if (Math.abs(header.x-date.x)>25 || used.has(header.office)) throw new Error("完了日の列対応が不明です。");
          used.add(header.office);
          addEntry(stores,jurisdiction.id,type,header.office,baseYear,parseMD(app.text),parseMD(date.text));
        }
      }
    }
  }
}
async function parsePdfMatrixCoordinates(buf, stores, jurisdiction) {
  parseMatrixCoordinateItems(await pdfTextItems(buf), stores, jurisdiction);
}

async function parsePdfMatrixRows(buf, stores, jurisdiction) {
  const lines = await pdfLines(buf);
  const offices = jurisdiction.pdfOffices || [];
  if (offices.length === 0) throw new Error("PDF横長表の庁名リストが未設定です。");

  const baseYear = reiwaToYear(lines.join("\n"));
  let pendingType = null;
  let pendingRealEstateDueDates = null;
  let currentApply = null;

  const addRealEstateDueDates = (applied, dueDates) => {
    currentApply = applied;
    for (let i = 0; i < Math.min(offices.length, dueDates.length); i++) {
      addEntry(stores, jurisdiction.id, "realEstate", offices[i], baseYear, applied, dueDates[i]);
    }
  };
  const addCommercialDueDates = (dueDates) => {
    if (!currentApply || dueDates.length === 0) return;
    if (dueDates.length >= offices.length) {
      for (let i = 0; i < offices.length; i++) {
        addEntry(stores, jurisdiction.id, "commercial", offices[i], baseYear, currentApply, dueDates[i]);
      }
    } else {
      addEntry(stores, jurisdiction.id, "commercial", offices[0], baseYear, currentApply, dueDates[0]);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normalized = compactPdfText(line);
    if (/注意事項|必ず|郵便|オンライン|申請書|添付/.test(normalized)) break;

    const prev = compactPdfText(lines[i - 1] || "");
    const next = compactPdfText(lines[i + 1] || "");
    const near = prev + normalized + next;
    const dates = datesInText(line);
    const hasCommercial = /商業.*法人/.test(normalized);
    const hasDisplay = /表示/.test(normalized);
    const hasRealEstate = /権利/.test(normalized) && !hasDisplay && !hasCommercial;

    if (pendingRealEstateDueDates && dates.length >= 1 && !hasCommercial) {
      addRealEstateDueDates(dates[0], pendingRealEstateDueDates);
      pendingRealEstateDueDates = null;
    }

    if (hasRealEstate && dates.length === 0) {
      pendingType = "realEstate";
      continue;
    }

    if ((hasRealEstate || pendingType === "realEstate" || (/権利/.test(near) && dates.length === offices.length)) && dates.length > 0) {
      if (dates.length >= offices.length + 1) {
        addRealEstateDueDates(dates[0], dates.slice(1, 1 + offices.length));
        pendingType = null;
        continue;
      }
      if (dates.length === offices.length) {
        pendingRealEstateDueDates = dates;
        pendingType = null;
        continue;
      }
    }

    if (hasCommercial && dates.length === 0) {
      pendingType = "commercial";
      continue;
    }
    if (hasCommercial && dates.length > 0) {
      addCommercialDueDates(dates);
      pendingType = null;
      continue;
    }
    if (pendingType === "commercial" && dates.length > 0) {
      addCommercialDueDates(dates);
      pendingType = null;
      continue;
    }
  }
}

async function parsePdfSaitama(buf, stores, jurisdiction) {
  const lines = await pdfLines(buf);
  const baseYear = reiwaToYear(lines.join("\n"));
  let currentOffice = null;
  let currentApply = null;
  let pendingDueDates = null;
  let waitingApplyDate = false;

  const addDueDates = (applied, dueDates) => {
    if (!currentOffice || !applied || dueDates.length < 2) return;
    addEntry(stores, jurisdiction.id, "realEstate", currentOffice, baseYear, applied, dueDates[1]);
    if (currentOffice === "本局" && dueDates[2]) {
      addEntry(stores, jurisdiction.id, "commercial", currentOffice, baseYear, applied, dueDates[2]);
    }
  };

  for (const line of lines) {
    const compact = compactPdfText(line);
    let office = null;
    if (/^本局不動産.*法人登記部門$/.test(compact)) office = "本局";
    else office = singleOfficeFromPdfLine(line, jurisdiction);
    if (office && !/^(支局|出張所)$/.test(office)) {
      currentOffice = office;
      currentApply = null;
      pendingDueDates = null;
      waitingApplyDate = false;
      continue;
    }

    if (!currentOffice) continue;
    if (/^令和\s*\d+\s*年$/.test(line)) {
      waitingApplyDate = true;
      continue;
    }

    const dates = datesInText(line);
    if (waitingApplyDate && dates.length === 1) {
      currentApply = dates[0];
      if (pendingDueDates) addDueDates(currentApply, pendingDueDates);
      pendingDueDates = null;
      waitingApplyDate = false;
      continue;
    }
    if (dates.length >= 2) {
      if (currentApply) addDueDates(currentApply, dates);
      else pendingDueDates = dates;
    }
  }
}

async function parsePdfKobe(buf, stores, jurisdiction) {
  return parseOfficeCoordinateItems(await pdfTextItems(buf), stores, jurisdiction);
}

async function parsePdfKyotoColumns(buf, stores, jurisdiction) {
  const lines = await pdfLines(buf);
  const baseYear = reiwaToYear(lines.join("\n"));
  const header = lines.find((line) => /庁名/.test(line) && datesInText(line).length >= 3);
  const applyDates = datesInText(header || "");
  if (applyDates.length === 0) throw new Error("京都PDFの申請日列が見つかりません。");

  const addDuePairs = (typeId, office, dueDates) => {
    for (let i = 0; i < applyDates.length; i++) {
      const pair = dueDates.slice(i * 2, i * 2 + 2);
      for (const due of pair) addEntry(stores, jurisdiction.id, typeId, office, baseYear, applyDates[i], due);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const compact = compactPdfText(line);
    const slashDates = datesInSlashText(line);

    if (/^権利/.test(line) && slashDates.length >= applyDates.length * 2) {
      addDuePairs("realEstate", "本局", slashDates);
      continue;
    }
    if (/商業法人/.test(compact)) {
      const commercialDates = datesInSlashText(lines[i + 1] || "");
      if (commercialDates.length >= applyDates.length * 2) addDuePairs("commercial", "本局", commercialDates);
      continue;
    }

    const match = line.match(/^(.+?)\s+権利/);
    if (!match || slashDates.length < applyDates.length * 2) continue;
    const prefix = cleanText(match[1]).replace(/\s/g, "");
    if (!prefix || prefix === "本局") continue;
    const suffixLine = compactPdfText(lines[i + 2] || "");
    const suffix = suffixLine.startsWith("出張所") ? "出張所" : "支局";
    addDuePairs("realEstate", `${prefix}${suffix}`, slashDates);
  }
}

async function parsePdfOkayama(buf, stores, jurisdiction) {
  const items = await pdfTextItems(buf);
  const baseYear = reiwaToYear(items.map((item) => item.text).join("\n"));
  const labelItems = items.map((item) => ({ ...item, compact: compactPdfText(item.text) }));
  const applyHeaders = labelItems
    .filter((item) => parseMD(item.text) && item.y < 130 && item.x > 200)
    .sort((a, b) => a.x - b.x)
    .map((item) => parseMD(item.text));
  const realEstateXs = labelItems
    .filter((item) => item.compact.includes("不動産権利"))
    .sort((a, b) => a.x - b.x)
    .map((item) => item.x);
  const commercialXs = labelItems
    .filter((item) => item.compact.includes("商業・法人"))
    .sort((a, b) => a.x - b.x)
    .map((item) => item.x);

  if (applyHeaders.length < 3 || realEstateXs.length < 3 || commercialXs.length < 3) {
    throw new Error("岡山PDFの列見出しを読み取れませんでした。");
  }

  const officeItems = labelItems
    .filter((item) => item.compact === "本" || (/支局$/.test(item.compact) && item.compact !== "支局"))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const dateAt = (rowItems, x) => {
    const hit = rowItems
      .filter((item) => parseMD(item.text))
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    if (!hit || Math.abs(hit.x - x) > 5) return null;
    return parseMD(hit.text);
  };

  for (const officeItem of officeItems) {
    const office = officeItem.compact === "本" ? "本局" : officeItem.compact;
    const rowItems = labelItems.filter(
      (item) => item.pageNo === officeItem.pageNo && Math.abs(item.y - officeItem.y) <= 4
    );
    for (let i = 0; i < Math.min(3, applyHeaders.length); i++) {
      const realEstateDue = dateAt(rowItems, realEstateXs[i]);
      if (realEstateDue) addEntry(stores, jurisdiction.id, "realEstate", office, baseYear, applyHeaders[i], realEstateDue);
      if (office === "本局") {
        const commercialDue = dateAt(rowItems, commercialXs[i]);
        if (commercialDue) addEntry(stores, jurisdiction.id, "commercial", office, baseYear, applyHeaders[i], commercialDue);
      }
    }
  }
}

async function parsePdfNagasaki(buf, stores, jurisdiction) {
  const lines = await pdfLines(buf);
  const baseYear = reiwaToYear(lines.join("\n"));
  const offices = ["本局", "諫早支局", "島原支局", "佐世保支局", "平戸支局", "壱岐支局", "五島支局", "対馬支局"];
  let currentApply = null;

  for (const line of lines) {
    const dates = datesInText(line);
    if (dates.length === 1 && !/権利|表示/.test(line)) {
      currentApply = dates[0];
      continue;
    }
    if (!/権利/.test(line)) continue;

    let applied = currentApply;
    let dueDates = dates;
    if (dates.length >= 10) {
      applied = dates[0];
      dueDates = dates.slice(1);
    }
    if (!applied || dueDates.length < 9) continue;
    currentApply = applied;

    addEntry(stores, jurisdiction.id, "realEstate", offices[0], baseYear, applied, dueDates[0]);
    addEntry(stores, jurisdiction.id, "commercial", offices[0], baseYear, applied, dueDates[1]);
    for (let i = 1; i < offices.length; i++) {
      addEntry(stores, jurisdiction.id, "realEstate", offices[i], baseYear, applied, dueDates[i + 1]);
    }
  }
}

function countEntries(store) {
  return Object.values(store).reduce((n, office) => n + Object.keys(office).length, 0);
}

function validateJurisdiction(stores, jurisdiction) {
  for (const offices of Object.values(stores[jurisdiction.id])) for (const [office, dates] of Object.entries(offices)) {
    for (const [applied, due] of Object.entries(dates)) {
      if (due < applied) throw new Error(office + "の完了日が申請日より前です: " + applied + " / " + due);
    }
  }
  for (const type of TYPES) {
    const min = jurisdiction.minimums?.[type.id];
    if (!min) continue;
    const typeStore = stores[jurisdiction.id][type.id];
    const offices = Object.keys(typeStore).length;
    const entries = countEntries(typeStore);
    if (offices < min.offices || entries < min.entries) {
      throw new Error(
        `${jurisdiction.label}・${type.label}の取得結果が少なすぎるため更新を中止しました` +
        `（庁数: ${offices}、申請日: ${entries}）。`
      );
    }
  }
}

async function scrapeJurisdiction(stores, jurisdiction) {
  console.log(`\n${jurisdiction.label}を取得中…`);
  const sourcePages = [];

  if (jurisdiction.kind === "indexLinks") {
    const idx = dec(await getBuf(jurisdiction.indexUrl));
    const links = [...new Set(extractLinks(idx, jurisdiction))];
    if (links.length === 0) throw new Error("完了予定日ページが見つかりません。");
    console.log(`完了予定日ページ ${links.length} 件`);
    for (const url of links) {
      const html = dec(await getBuf(url));
      parseHtmlTables(html, stores, jurisdiction);
      sourcePages.push(url);
      process.stdout.write(".");
    }
    console.log("");
  } else if (jurisdiction.kind === "htmlPage") {
    const html = dec(await getBuf(jurisdiction.pageUrl));
    parseHtmlTables(html, stores, jurisdiction);
    sourcePages.push(jurisdiction.pageUrl);
  } else if (jurisdiction.kind === "htmlMatrixByOfficeRows") {
    const pageUrl = jurisdiction.pageUrl || extractScheduleLink(dec(await getBuf(jurisdiction.indexUrl)), jurisdiction, /\.html?(?:$|[?#])/i);
    const html = dec(await getBuf(pageUrl));
    parseHtmlMatrixByOfficeRows(html, stores, jurisdiction);
    sourcePages.push(pageUrl);
  } else if (jurisdiction.kind === "htmlSequentialOfficeTables") {
    const html = dec(await getBuf(jurisdiction.pageUrl));
    parseHtmlSequentialOfficeTables(html, stores, jurisdiction);
    sourcePages.push(jurisdiction.pageUrl);
  } else if (jurisdiction.kind === "htmlSagaMatrix") {
    const html = dec(await getBuf(jurisdiction.pageUrl));
    parseHtmlSagaMatrix(html, stores, jurisdiction);
    sourcePages.push(jurisdiction.pageUrl);
  } else if (jurisdiction.kind === "htmlNahaMatrix") {
    const html = dec(await getBuf(jurisdiction.pageUrl));
    parseHtmlNahaMatrix(html, stores, jurisdiction);
    sourcePages.push(jurisdiction.pageUrl);
  } else if (jurisdiction.kind === "pdfDirect") {
    const pdfUrl = jurisdiction.pdfUrl;
    console.log(`PDF: ${pdfUrl}`);
    await parsePdf(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else if (jurisdiction.kind === "pdfMatrixCoordinates") {
    const pdfUrl = jurisdiction.pdfUrl || extractPdfLink(dec(await getBuf(jurisdiction.indexUrl)), jurisdiction);
    await parsePdfMatrixCoordinates(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else if (jurisdiction.kind === "pdfMatrixRows") {
    const pdfUrl = jurisdiction.pdfUrl || extractPdfLink(dec(await getBuf(jurisdiction.indexUrl)), jurisdiction);
    console.log(`PDF: ${pdfUrl}`);
    await parsePdfMatrixRows(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else if (jurisdiction.kind === "pdfSaitama") {
    const pdfUrl = jurisdiction.pdfUrl;
    console.log(`PDF: ${pdfUrl}`);
    await parsePdfSaitama(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else if (jurisdiction.kind === "pdfKobe") {
    const pdfUrl = jurisdiction.pdfUrl || extractPdfLink(dec(await getBuf(jurisdiction.indexUrl)), jurisdiction);
    console.log(`PDF: ${pdfUrl}`);
    await parsePdfKobe(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else if (jurisdiction.kind === "pdfKyotoColumns") {
    const pdfUrl = jurisdiction.pdfUrl || extractPdfLink(dec(await getBuf(jurisdiction.indexUrl)), jurisdiction);
    console.log(`PDF: ${pdfUrl}`);
    await parsePdfKyotoColumns(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else if (jurisdiction.kind === "pdfOkayama") {
    const pdfUrl = jurisdiction.pdfUrl || extractPdfLink(dec(await getBuf(jurisdiction.indexUrl)), jurisdiction);
    console.log(`PDF: ${pdfUrl}`);
    await parsePdfOkayama(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else if (jurisdiction.kind === "pdfNagasaki") {
    const pdfUrl = jurisdiction.pdfUrl;
    console.log(`PDF: ${pdfUrl}`);
    await parsePdfNagasaki(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else if (jurisdiction.kind === "pdfFromIndex") {
    const idx = dec(await getBuf(jurisdiction.indexUrl));
    const pdfUrl = extractPdfLink(idx, jurisdiction);
    console.log(`PDF: ${pdfUrl}`);
    await parsePdf(await getBuf(pdfUrl), stores, jurisdiction);
    sourcePages.push(pdfUrl);
  } else {
    throw new Error(`未対応の取得形式です: ${jurisdiction.kind}`);
  }

  validateJurisdiction(stores, jurisdiction);
  return sourcePages;
}

function sortedObject(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, "ja")));
}

function readPreviousOutput() {
  try {
    if (!fs.existsSync(OUT)) return null;
    const parsed = JSON.parse(fs.readFileSync(OUT, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    console.warn(`既存データを読み込めないため、今回取得分だけで出力します: ${e.message}`);
    return null;
  }
}

function makeEmptyData() {
  return Object.fromEntries(
    JURISDICTIONS.map((jurisdiction) => [
      jurisdiction.id,
      Object.fromEntries(TYPES.map((type) => [type.id, {}])),
    ])
  );
}

function isValidOfficeName(office) {
  return !!office && !/^(支局|出張所)$/.test(office);
}

function isAllowedOfficeForType(jurisdictionId, typeId, office) {
  if (!isValidOfficeName(office)) return false;
  const jurisdiction = JURISDICTIONS.find((j) => j.id === jurisdictionId);
  if (typeId === "commercial" && jurisdiction?.commercialOffices) {
    return jurisdiction.commercialOffices.includes(office);
  }
  return true;
}

function addDataEntry(data, jurisdictionId, typeId, office, applyISO, dueISO) {
  if (!isAllowedOfficeForType(jurisdictionId, typeId, office) || !ISO_DATE_RE.test(applyISO) || !ISO_DATE_RE.test(dueISO)) return false;
  const typeData = data[jurisdictionId]?.[typeId];
  if (!typeData) return false;
  (typeData[office] ||= {})[applyISO] = dueISO;
  return true;
}

function cloneSupportedData(sourceData) {
  const data = makeEmptyData();
  for (const jurisdiction of JURISDICTIONS) {
    for (const type of TYPES) {
      const sourceType = sourceData?.[jurisdiction.id]?.[type.id];
      if (!sourceType || typeof sourceType !== "object") continue;
      for (const [office, dates] of Object.entries(sourceType)) {
        if (!dates || typeof dates !== "object") continue;
        for (const [applyISO, dueISO] of Object.entries(dates)) {
          addDataEntry(data, jurisdiction.id, type.id, office, applyISO, dueISO);
        }
      }
    }
  }
  return data;
}

function dataEntryCount(data) {
  let total = 0;
  for (const jurisdiction of JURISDICTIONS) {
    for (const type of TYPES) {
      const typeData = data?.[jurisdiction.id]?.[type.id] || {};
      for (const officeData of Object.values(typeData)) {
        total += Object.keys(officeData || {}).length;
      }
    }
  }
  return total;
}

function hasDataEntry(data, jurisdictionId, typeId, office, applyISO) {
  return Boolean(data?.[jurisdictionId]?.[typeId]?.[office]?.[applyISO]);
}

function countHistoryOnlyEntries(mergedData, currentData) {
  let total = 0;
  for (const jurisdiction of JURISDICTIONS) {
    for (const type of TYPES) {
      const typeData = mergedData?.[jurisdiction.id]?.[type.id] || {};
      for (const [office, dates] of Object.entries(typeData)) {
        for (const applyISO of Object.keys(dates || {})) {
          if (!hasDataEntry(currentData, jurisdiction.id, type.id, office, applyISO)) total += 1;
        }
      }
    }
  }
  return total;
}

function prepareDataForOutput(sourceData) {
  const data = {};
  const officesByJurisdiction = {};
  const totals = {};

  for (const jurisdiction of JURISDICTIONS) {
    data[jurisdiction.id] = {};
    officesByJurisdiction[jurisdiction.id] = {};
    totals[jurisdiction.id] = {};

    for (const type of TYPES) {
      const typeData = sourceData?.[jurisdiction.id]?.[type.id] || {};
      const offices = Object.keys(typeData).sort((a, b) => a.localeCompare(b, "ja"));
      officesByJurisdiction[jurisdiction.id][type.id] = offices;
      data[jurisdiction.id][type.id] = {};
      for (const office of offices) {
        data[jurisdiction.id][type.id][office] = sortedObject(typeData[office]);
      }
      totals[jurisdiction.id][type.id] = offices.reduce(
        (n, office) => n + Object.keys(data[jurisdiction.id][type.id][office]).length,
        0
      );
    }
  }

  return { data, officesByJurisdiction, totals };
}

function buildPublishedDates(currentData) {
  const publishedDates = {};
  for (const jurisdiction of JURISDICTIONS) {
    publishedDates[jurisdiction.id] = {};
    for (const type of TYPES) {
      publishedDates[jurisdiction.id][type.id] = {};
      const typeData = currentData?.[jurisdiction.id]?.[type.id] || {};
      for (const [office, dates] of Object.entries(typeData)) {
        const applyDates = Object.keys(dates || {}).sort();
        if (applyDates.length > 0) publishedDates[jurisdiction.id][type.id][office] = applyDates;
      }
    }
  }
  return publishedDates;
}

function mergeWithHistory(currentData, previousOutput) {
  const previousData = cloneSupportedData(previousOutput?.data || {});
  const mergedData = cloneSupportedData(previousOutput?.data || {});
  const stats = {
    previousEntries: dataEntryCount(previousData),
    currentEntries: dataEntryCount(currentData),
    addedEntries: 0,
    updatedEntries: 0,
  };

  for (const jurisdiction of JURISDICTIONS) {
    for (const type of TYPES) {
      const typeData = currentData?.[jurisdiction.id]?.[type.id] || {};
      for (const [office, dates] of Object.entries(typeData)) {
        for (const [applyISO, dueISO] of Object.entries(dates || {})) {
          const oldDue = mergedData[jurisdiction.id][type.id][office]?.[applyISO];
          if (!oldDue) stats.addedEntries += 1;
          else if (oldDue !== dueISO) stats.updatedEntries += 1;
          addDataEntry(mergedData, jurisdiction.id, type.id, office, applyISO, dueISO);
        }
      }
    }
  }

  stats.totalEntries = dataEntryCount(mergedData);
  stats.retainedEntries = countHistoryOnlyEntries(mergedData, currentData);
  return { data: mergedData, stats };
}

function hashData(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data), "utf8").digest("hex");
}

function writeOutputFiles(out) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  const JSOUT = OUT.replace(/\.json$/, ".js");
  fs.writeFileSync(JSOUT, "window.KANRYO_DATA = " + JSON.stringify(out) + ";\n", "utf8");
  const integrity = {
    algorithm: "SHA-256",
    sha256: hashData(out),
    dataGeneratedAt: out.generatedAt || null,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(INTEGRITY_OUT, "window.KANRYO_DATA_INTEGRITY = " + JSON.stringify(integrity) + ";\n", "utf8");
}
function buildOutput(stores, sourcePages, previousOutput, fetchErrors = {}) {
  const current = prepareDataForOutput(stores);
  const { data: mergedRaw, stats } = mergeWithHistory(current.data, previousOutput);
  const merged = prepareDataForOutput(mergedRaw);
  const generatedAt = new Date().toISOString();
  const quarantinedDates = JSON.parse(JSON.stringify(previousOutput?.quarantinedDates || {}));
  for (const id of ["maebashi", "kobe", "nara", "miyazaki", "okayama", "matsue", "tokushima", "matsuyama"]) {
    for (const [type, offices] of Object.entries(previousOutput?.data?.[id] || {})) for (const [office, dates] of Object.entries(offices)) {
      const key = [id, type, office].join("|");
      const suspect = new Set(previousOutput?.parserRevision === "coordinates-20260928" ? (quarantinedDates[key] || []) : Object.keys(dates));
      for (const date of Object.keys(current.data?.[id]?.[type]?.[office] || {})) suspect.delete(date);
      if (suspect.size) quarantinedDates[key] = [...suspect].sort(); else delete quarantinedDates[key];
    }
  }

  return {
    schemaVersion: 3,
    parserRevision: "coordinates-20260928",
    quarantinedDates,
    generatedAt,
    source: `登記完了予定日（${JURISDICTIONS.length}法務局対応・履歴蓄積）`,
    fetchPolicy: {
      mode: "scheduledSnapshot",
      userLookup: "localDataOnly",
      sourceFetch: "GitHub Actionsまたは手動更新時のみ、登録済みURLを順番に取得",
      minRequestIntervalMs: REQUEST_DELAY_MS,
    },
    sources: JURISDICTIONS.map((j) => ({
      id: j.id,
      label: j.label,
      sourceUrl: j.indexUrl || j.pageUrl || j.pdfUrl,
      fetchedPages: sourcePages[j.id] || [],
      fetchError: fetchErrors[j.id] || null,
      lastSuccessfulFetchAt: fetchErrors[j.id]
        ? (previousOutput?.sources?.find(s => s.id === j.id)?.lastSuccessfulFetchAt || null)
        : generatedAt,
    })),
    note: "AM/PMは区別せず、同一申請日の遅い方の完了予定日を採用。不動産（表示）登記は対象外。過去に取得できた申請日データは履歴として保持。",
    history: {
      enabled: true,
      startedAt: previousOutput?.history?.startedAt || previousOutput?.generatedAt || generatedAt,
      previousGeneratedAt: previousOutput?.generatedAt || null,
      currentEntries: stats.currentEntries,
      retainedEntries: stats.retainedEntries,
      addedEntries: stats.addedEntries,
      updatedEntries: stats.updatedEntries,
      totalEntries: stats.totalEntries,
    },
    jurisdictions: JURISDICTIONS.map(({ id, label }) => ({ id, label })),
    types: TYPES.map(({ id, label }) => ({ id, label })),
    officesByJurisdiction: merged.officesByJurisdiction,
    totals: merged.totals,
    publishedDates: buildPublishedDates(current.data),
    publishedTotals: current.totals,
    data: merged.data,
  };
}

async function main() {
  const stores = makeStores();
  const sourcePages = {};
  const fetchErrors = {};
  const previousOutput = readPreviousOutput();

  for (const jurisdiction of JURISDICTIONS) {
    try {
      const candidate = makeStores();
      sourcePages[jurisdiction.id] = await scrapeJurisdiction(candidate, jurisdiction);
      stores[jurisdiction.id] = candidate[jurisdiction.id];
    } catch (e) {
      const message = `${jurisdiction.label}の取得に失敗しました: ${e.message}`;
      fetchErrors[jurisdiction.id] = message;
      console.warn(`WARN: ${message}`);
    }
  }

  const currentEntries = dataEntryCount(prepareDataForOutput(stores).data);
  const previousEntries = dataEntryCount(previousOutput?.data || {});
  if (currentEntries === 0 && previousEntries === 0) {
    throw new Error("全法務局の取得に失敗し、利用できる過去データもないため更新を中止しました。");
  }

  const out = buildOutput(stores, sourcePages, previousOutput, fetchErrors);
  writeOutputFiles(out);

  console.log(`\n出力: ${OUT}`);
  console.log(`整合性: ${INTEGRITY_OUT}`);
  for (const jurisdiction of JURISDICTIONS) {
    for (const type of TYPES) {
      const offices = out.officesByJurisdiction[jurisdiction.id][type.id].length;
      const entries = out.totals[jurisdiction.id][type.id];
      const publishedEntries = out.publishedTotals[jurisdiction.id][type.id];
      const suffix = entries === publishedEntries ? "" : `（現在掲載 ${publishedEntries}）`;
      console.log(`${jurisdiction.label}・${type.label}: 庁数 ${offices} / 申請日エントリ ${entries}${suffix}`);
    }
  }
}

export { JURISDICTIONS, makeStores, parseOfficeCoordinateItems, parseMatrixCoordinateItems, parsePdfMatrixCoordinates, parseHtmlSequentialOfficeTables, validateJurisdiction, extractPdfLink, pdfTextItems };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
