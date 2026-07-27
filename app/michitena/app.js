(() => {
  "use strict";

  const STORE_KEY = "michitena.cases.v1";

  const TYPE_LABELS = {
    merger: "合併・会社分割",
    reduction: "資本金の額の減少",
    dissolution: "解散",
    custom: "その他",
  };
  const TYPE_MONTHS = { merger: 1, reduction: 1, dissolution: 2 };
  const METHOD_LABELS = {
    normal: "官報公告（初日不算入）",
    electronic: "電子公告（0時開始・初日算入）",
  };

  /* ===== 日付ユーティリティ ===== */
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  function parseISO(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function isISODate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const date = parseISO(value);
    return Number.isFinite(date.getTime()) && toISO(date) === value;
  }
  function todayISO() {
    return toISO(new Date());
  }
  function fmtJP(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
  }
  function fmtJPShort(date) {
    return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}）`;
  }
  function icsDate(date) {
    return toISO(date).replace(/-/g, "");
  }
  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  /* ===== 祝日・休日判定 ===== */
  function vernalEquinoxDay(year) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  function autumnalEquinoxDay(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  function isNationalHolidayBase(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const w = date.getDay();
    const md = `${m}/${d}`;
    const fixed = ["1/1", "2/11", "2/23", "4/29", "5/3", "5/4", "5/5", "8/11", "11/3", "11/23"];
    if (fixed.includes(md)) return true;
    if (m === 1 && Math.floor((d - 1) / 7) === 1 && w === 1) return true; // 成人の日
    if (m === 7 && Math.floor((d - 1) / 7) === 2 && w === 1) return true; // 海の日
    if (m === 9 && Math.floor((d - 1) / 7) === 2 && w === 1) return true; // 敬老の日
    if (m === 10 && Math.floor((d - 1) / 7) === 1 && w === 1) return true; // スポーツの日
    if (m === 3 && d === vernalEquinoxDay(y)) return true;
    if (m === 9 && d === autumnalEquinoxDay(y)) return true;
    return false;
  }
  function isHolidayActHoliday(date) {
    if (isNationalHolidayBase(date)) return true;
    if (isNationalHolidayBase(addDays(date, -1)) && isNationalHolidayBase(addDays(date, 1))) return true; // 国民の休日

    for (let d = addDays(date, -1); isNationalHolidayBase(d); d = addDays(d, -1)) {
      if (d.getDay() === 0) return true; // 振替休日
    }
    return false;
  }
  function isHoliday(date) {
    const md = `${date.getMonth() + 1}/${date.getDate()}`;
    return isHolidayActHoliday(date) || ["1/2", "1/3", "12/29", "12/30", "12/31"].includes(md);
  }
  function isWeekend(date) {
    return date.getDay() === 0 || date.getDay() === 6;
  }
  function nextBusinessDay(date) {
    const d = new Date(date);
    while (isWeekend(d) || isHoliday(d)) d.setDate(d.getDate() + 1);
    return d;
  }
  function addMonthsForPeriodExpiry(start, months) {
    const y = start.getFullYear();
    const targetMonth = start.getMonth() + months;
    const day = start.getDate();
    const targetLastDay = new Date(y, targetMonth + 1, 0).getDate();
    if (day > targetLastDay) return new Date(y, targetMonth, targetLastDay);
    return new Date(y, targetMonth, day - 1);
  }

  /* ===== 公告スケジュール計算 ===== */
  function computeSchedule({ plannedDate, method, months }) {
    const original = parseISO(plannedDate);
    let actualStart = new Date(original);
    if (method === "normal") actualStart = nextBusinessDay(original);
    const slid = actualStart.getTime() !== original.getTime();

    const calcStart = new Date(actualStart);
    if (method === "normal") calcStart.setDate(calcStart.getDate() + 1);

    const expiry = addMonthsForPeriodExpiry(calcStart, months);
    while (isWeekend(expiry) || isHoliday(expiry)) expiry.setDate(expiry.getDate() + 1);

    const effective = new Date(expiry);
    effective.setDate(effective.getDate() + 1);

    return { actualStart, calcStart, expiry, effective, slid };
  }

  /* ===== 保存（localStorage） ===== */
  function uid() {
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function normalizeCase(item) {
    if (!item || typeof item !== "object") return null;
    const plannedDate = isISODate(item.plannedDate) ? item.plannedDate : null;
    if (!plannedDate) return null;
    const noticeType = TYPE_LABELS[item.noticeType] ? item.noticeType : "custom";
    const parsedMonths = Number(item.months);
    const months = Number.isInteger(parsedMonths) && parsedMonths >= 1 && parsedMonths <= 120
      ? parsedMonths
      : (TYPE_MONTHS[noticeType] || 1);
    return {
      id: typeof item.id === "string" && /^c_[a-z0-9]+_[a-z0-9]+$/i.test(item.id) ? item.id : uid(),
      label: typeof item.label === "string" ? item.label : "",
      noticeType,
      months,
      method: item.method === "electronic" ? "electronic" : "normal",
      plannedDate,
      status: item.status === "done" ? "done" : "active",
      createdAt: typeof item.createdAt === "string" && item.createdAt ? item.createdAt : new Date().toISOString(),
    };
  }
  function loadCases() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY)) || [];
      return Array.isArray(raw) ? raw.map(normalizeCase).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  function saveCases(list) {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  }

  let cases = loadCases();

  /* ===== DOM ===== */
  const $ = (id) => document.getElementById(id);
  const el = {
    type: $("f-type"),
    monthsRow: $("custom-months-row"),
    months: $("f-months"),
    date: $("f-date"),
    slideNotice: $("slide-notice"),
    methodNote: $("method-note"),
    results: $("results"),
    label: $("f-label"),
    add: $("f-add"),
    saveMessage: $("save-message"),
    printBtn: $("print-btn"),
    alertBanner: $("alert-banner"),
    caseFilter: $("case-filter"),
    caseList: $("case-list"),
    printType: $("print-type"),
    printMethod: $("print-method"),
    printReportDate: $("print-report-date"),
  };

  function currentMethod() {
    return document.querySelector('input[name="notice-method"]:checked').value;
  }
  function currentMonths() {
    if (el.type.value === "custom") {
      const n = parseInt(el.months.value, 10);
      return Number.isInteger(n) && n >= 1 ? Math.min(n, 120) : 1;
    }
    return TYPE_MONTHS[el.type.value] || 1;
  }
  function currentParams() {
    return {
      noticeType: el.type.value,
      months: currentMonths(),
      method: currentMethod(),
      plannedDate: el.date.value,
    };
  }
  function typeDisplay(c) {
    return c.noticeType === "custom" ? `個別設定（${c.months}ヶ月）` : TYPE_LABELS[c.noticeType];
  }

  /* ===== 計算結果の描画 ===== */
  function renderResults() {
    const p = currentParams();
    el.monthsRow.hidden = p.noticeType !== "custom";
    if (!p.plannedDate || !isISODate(p.plannedDate)) {
      el.results.innerHTML = "";
      return;
    }
    const s = computeSchedule(p);

    el.slideNotice.hidden = !s.slid;
    if (s.slid) {
      el.slideNotice.textContent = `官報休刊日のため ${fmtJP(s.actualStart)} にスライドされました`;
    }

    if (p.method === "normal") {
      el.methodNote.className = "notice notice--method is-normal no-print";
      el.methodNote.innerHTML = "<strong>官報公告:</strong> 土日祝・年末年始は非掲載。掲載日が休日の場合、翌営業日にスライドします。民法140条により初日は算入しません。";
    } else {
      el.methodNote.className = "notice notice--method is-electronic no-print";
      el.methodNote.innerHTML = "<strong>電子公告:</strong> 0時開始のため当日を初日として算入。休日による掲載日変動はありません。";
    }

    el.results.innerHTML = `
      <div class="tile">
        <div class="tile__caption">公告掲載日</div>
        <div class="tile__date">${fmtJP(s.actualStart)}</div>
      </div>
      <div class="tile tile--start">
        <div class="tile__caption">期間起算日</div>
        <div class="tile__date">${fmtJP(s.calcStart)}</div>
      </div>
      <div class="tile tile--expiry">
        <div class="tile__caption">異議申述期限（期間満了）</div>
        <div class="tile__date">${fmtJP(s.expiry)}</div>
      </div>
      <div class="tile tile--effective">
        <div class="tile__caption">最短の登記申請可能日</div>
        <div class="tile__date">${fmtJP(s.effective)}</div>
        <div class="tile__hint">※公告期間満了日の翌日から手続きが可能です。</div>
      </div>`;

    el.printType.textContent = p.noticeType === "custom" ? `個別設定（${p.months}ヶ月）` : TYPE_LABELS[p.noticeType];
    el.printMethod.textContent = METHOD_LABELS[p.method];
    el.printReportDate.textContent = fmtJP(new Date());
  }

  /* ===== 案件一覧 ===== */
  function caseStage(c) {
    if (c.status === "done") return "done";
    const today = todayISO();
    const s = computeSchedule(c);
    if (today >= toISO(s.effective)) return "ready";
    if (today >= toISO(s.actualStart)) return "waiting";
    return "before";
  }

  const STAGE_META = {
    ready: { badge: "badge--ready", label: "申請可能" },
    waiting: { badge: "badge--waiting", label: "公告期間中" },
    before: { badge: "badge--before", label: "掲載待ち" },
    done: { badge: "badge--done", label: "完了" },
  };

  function renderCases() {
    const filter = (el.caseFilter.value || "").trim().toLowerCase();
    el.caseFilter.hidden = cases.length < 4;

    if (!cases.length) {
      el.alertBanner.hidden = true;
      el.caseList.innerHTML = '<div class="cases__empty">計算した公告スケジュールを「一覧に保存」すると、ここに案件として表示されます。</div>';
      return;
    }

    const readyCount = cases.filter((c) => caseStage(c) === "ready").length;
    el.alertBanner.hidden = readyCount === 0;
    if (readyCount > 0) {
      el.alertBanner.textContent = `公告期間が満了し、登記申請が可能になった案件が ${readyCount} 件あります`;
    }

    const visible = cases.filter((c) => !filter || (c.label || "").toLowerCase().includes(filter));
    const stages = ["ready", "waiting", "before", "done"];
    const groupTitles = { ready: "申請可能", waiting: "公告期間中", before: "掲載待ち", done: "完了した案件" };

    const bySchedule = (a, b) => toISO(computeSchedule(a).effective).localeCompare(toISO(computeSchedule(b).effective));

    let html = "";
    for (const stage of stages) {
      const group = visible.filter((c) => caseStage(c) === stage).sort(bySchedule);
      if (!group.length) continue;
      html += `<div class="case-group case-group--${stage}"><p class="case-group__title">${groupTitles[stage]}</p>`;
      for (const c of group) {
        const s = computeSchedule(c);
        const meta = STAGE_META[stage];
        const label = c.label || "（案件名なし）";
        const safeId = escapeHtml(c.id);
        html += `
          <div class="case-item case-item--${stage}" data-id="${safeId}">
            <div class="case-item__top">
              <button class="case-item__label" type="button" data-act="open" title="この条件を計算フォームに読み込む">${escapeHtml(label)}</button>
              <span class="case-item__badge ${meta.badge}">${meta.label}</span>
            </div>
            <div class="case-item__meta">${typeDisplay(c)}・${c.method === "normal" ? "官報公告" : "電子公告"}</div>
            <div class="case-item__dates">掲載 ${fmtJPShort(s.actualStart)} ／ 満了 ${fmtJPShort(s.expiry)} ／ 申請可能 <strong>${fmtJPShort(s.effective)}</strong></div>
            <div class="case-item__actions">
              <button type="button" data-act="calendar">カレンダーに登録</button>
              <button type="button" data-act="copy">報告文をコピー</button>
              <button type="button" data-act="toggle">${c.status === "done" ? "未完了に戻す" : "完了にする"}</button>
              <button type="button" data-act="delete" class="danger">削除</button>
            </div>
          </div>`;
      }
      html += "</div>";
    }
    el.caseList.innerHTML = html || '<div class="cases__empty">絞り込みに一致する案件がありません。</div>';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
  }

  /* ===== 案件操作 ===== */
  function googleCalendarUrl(c) {
    const s = computeSchedule(c);
    const title = `${c.label ? `${c.label} ` : ""}${typeDisplay(c)}公告 登記申請可能日`;
    const details = [
      `公告の種類：${typeDisplay(c)}`,
      `公告方式：${METHOD_LABELS[c.method]}`,
      `公告掲載日：${fmtJP(s.actualStart)}`,
      `期間起算日：${fmtJP(s.calcStart)}`,
      `異議申述期限（期間満了）：${fmtJP(s.expiry)}`,
      `最短の登記申請可能日：${fmtJP(s.effective)}`,
      "この予定はミチテナ（法定公告 満了日計算）で作成されました。日付は目安であり、正確性を保証するものではありません。",
    ].join("\n");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: `${icsDate(s.effective)}/${icsDate(new Date(s.effective.getFullYear(), s.effective.getMonth(), s.effective.getDate() + 1))}`,
      details,
      ctz: "Asia/Tokyo",
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function reportText(c) {
    const s = computeSchedule(c);
    const subject = c.label ? `${c.label}の${typeDisplay(c)}` : typeDisplay(c);
    return [
      "お世話になっております。",
      "",
      `${subject}に伴う債権者保護手続の公告スケジュールは、下記のとおりです。`,
      "",
      `公告方式：${METHOD_LABELS[c.method]}`,
      `公告掲載日：${fmtJP(s.actualStart)}`,
      `期間起算日：${fmtJP(s.calcStart)}`,
      `異議申述期限（期間満了）：${fmtJP(s.expiry)}`,
      `最短の登記申請可能日：${fmtJP(s.effective)}`,
      "",
      "公告期間満了後、異議申述の有無を確認のうえ、登記申請手続に進む予定です。",
      "※日程は現時点の目安です。官報休刊日、公告内容、管轄法務局の取扱い等により変更となる場合があります。",
    ].join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function drawRoundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const paragraphs = String(text).split("\n");
    let currentY = y;
    for (const paragraph of paragraphs) {
      if (!paragraph) {
        currentY += lineHeight;
        continue;
      }
      let line = "";
      for (const char of paragraph) {
        const next = line + char;
        if (line && ctx.measureText(next).width > maxWidth) {
          ctx.fillText(line, x, currentY);
          currentY += lineHeight;
          line = char;
        } else {
          line = next;
        }
      }
      if (line) {
        ctx.fillText(line, x, currentY);
        currentY += lineHeight;
      }
    }
    return currentY;
  }

  function drawPdfTextRow(ctx, label, value, x, y, width) {
    ctx.fillStyle = "#6e6e73";
    ctx.font = '600 24px "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
    ctx.fillText(label, x, y);
    ctx.fillStyle = "#1d1d1f";
    ctx.font = '650 30px "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
    return drawWrappedText(ctx, value, x + 210, y, width - 210, 38);
  }

  function drawPdfTile(ctx, caption, dateText, x, y, width, height, tone) {
    const palette = tone === "ready"
      ? { bg: "#edf4e4", border: "#a4be83", caption: "#4d6b32", text: "#4d6b32" }
      : tone === "deadline"
        ? { bg: "#fffaf0", border: "#ead39c", caption: "#8a6416", text: "#1d1d1f" }
        : { bg: "#f7f7f9", border: "#e1e1e4", caption: "#6e6e73", text: "#1d1d1f" };
    drawRoundRect(ctx, x, y, width, height, 24);
    ctx.fillStyle = palette.bg;
    ctx.fill();
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = palette.caption;
    ctx.font = '700 23px "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
    ctx.fillText(caption, x + 28, y + 42);
    ctx.fillStyle = palette.text;
    ctx.font = `${tone === "ready" ? "760 42px" : "700 34px"} "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif`;
    ctx.fillText(dateText, x + 28, y + 92);
  }

  function bytesFromDataUrl(dataUrl) {
    const base64 = dataUrl.split(",")[1] || "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function singlePageJpegPdf(jpegBytes, imageWidth, imageHeight) {
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let offset = 0;
    const addString = (value) => {
      const bytes = encoder.encode(value);
      chunks.push(bytes);
      offset += bytes.length;
    };
    const addBytes = (bytes) => {
      chunks.push(bytes);
      offset += bytes.length;
    };
    const addObjectStart = (id) => {
      offsets[id] = offset;
      addString(`${id} 0 obj\n`);
    };
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    addString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    addObjectStart(1);
    addString("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    addObjectStart(2);
    addString("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
    addObjectStart(3);
    addString(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
    addObjectStart(4);
    addString(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    addBytes(jpegBytes);
    addString("\nendstream\nendobj\n");
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
    addObjectStart(5);
    addString(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    const xrefOffset = offset;
    addString(`xref\n0 6\n0000000000 65535 f \n`);
    for (let id = 1; id <= 5; id += 1) addString(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    addString(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    return concatBytes(chunks);
  }

  function pdfFilename(plannedDate) {
    const fallback = "法定公告スケジュール";
    const name = (el.label.value.trim() || fallback)
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || fallback;
    return `${name}_${plannedDate}.pdf`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function resultPdfBlob(params, schedule) {
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF canvas is unavailable");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#9eca45";
    drawRoundRect(ctx, 78, 76, 82, 82, 22);
    ctx.fill();
    ctx.strokeStyle = "#648b31";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#1d1d1f";
    ctx.font = '760 48px "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
    ctx.fillText("法定公告スケジュール 計算結果", 184, 116);
    ctx.fillStyle = "#6e6e73";
    ctx.font = '500 24px "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
    ctx.fillText(`作成日：${toISO(new Date())}`, 184, 154);

    ctx.fillStyle = "#ffffff";
    drawRoundRect(ctx, 78, 208, 1084, 310, 26);
    ctx.fill();
    ctx.strokeStyle = "#e1e1e4";
    ctx.lineWidth = 2;
    ctx.stroke();
    let y = 264;
    const label = el.label.value.trim() || "（未入力）";
    y = Math.max(y + 42, drawPdfTextRow(ctx, "案件名", label, 118, y, 1004));
    y = Math.max(y + 42, drawPdfTextRow(ctx, "公告内容", params.noticeType === "custom" ? `個別設定（${params.months}ヶ月）` : TYPE_LABELS[params.noticeType], 118, y, 1004));
    y = Math.max(y + 42, drawPdfTextRow(ctx, "公告方式", METHOD_LABELS[params.method], 118, y, 1004));
    drawPdfTextRow(ctx, "掲載予定日", fmtJP(parseISO(params.plannedDate)), 118, y, 1004);

    drawPdfTile(ctx, "公告掲載日", fmtJP(schedule.actualStart), 78, 570, 1084, 132, "normal");
    drawPdfTile(ctx, "期間起算日", fmtJP(schedule.calcStart), 78, 726, 1084, 132, "deadline");
    drawPdfTile(ctx, "異議申述期限（期間満了）", fmtJP(schedule.expiry), 78, 882, 1084, 132, "normal");
    drawPdfTile(ctx, "最短の登記申請可能日", fmtJP(schedule.effective), 78, 1038, 1084, 150, "ready");

    ctx.fillStyle = "#1d1d1f";
    ctx.font = '650 25px "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
    ctx.fillText("備考", 78, 1260);
    ctx.fillStyle = "#6e6e73";
    ctx.font = '500 22px "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
    drawWrappedText(ctx, "公告期間満了日の翌日を、最短の登記申請可能日として表示しています。日程は現時点の目安です。官報休刊日、公告内容、管轄法務局の取扱い等により変更となる場合があります。", 78, 1304, 1084, 34);

    ctx.fillStyle = "#8e8e93";
    ctx.font = '500 18px "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
    drawWrappedText(ctx, "本算出結果はシミュレーションであり、正確性を保証するものではありません。登記申請、公告の詳細は、必ず管轄法務局、弁護士、司法書士、または官報販売所にご確認ください。", 78, 1594, 1084, 28);

    const jpegBytes = bytesFromDataUrl(canvas.toDataURL("image/jpeg", 0.92));
    return new Blob([singlePageJpegPdf(jpegBytes, canvas.width, canvas.height)], { type: "application/pdf" });
  }

  async function saveResultsPdf() {
    const p = currentParams();
    if (!isISODate(p.plannedDate)) {
      showMessage("掲載予定日を入力してください");
      return;
    }
    const s = computeSchedule(p);
    try {
      const blob = await resultPdfBlob(p, s);
      downloadBlob(blob, pdfFilename(p.plannedDate));
      showMessage("計算結果PDFを保存しました");
    } catch {
      window.print();
      showMessage("PDF生成に失敗したため、印刷画面を開きました");
    }
  }
  let messageTimer = null;
  function showMessage(text) {
    el.saveMessage.textContent = text;
    el.saveMessage.hidden = false;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { el.saveMessage.hidden = true; }, 4000);
  }

  el.caseList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const item = button.closest(".case-item");
    const c = cases.find((x) => x.id === item?.dataset.id);
    if (!c) return;

    switch (button.dataset.act) {
      case "open": {
        el.type.value = c.noticeType;
        if (c.noticeType === "custom") el.months.value = String(c.months);
        document.querySelector(`input[name="notice-method"][value="${c.method}"]`).checked = true;
        el.date.value = c.plannedDate;
        el.label.value = c.label;
        renderResults();
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      }
      case "calendar":
        window.open(googleCalendarUrl(c), "_blank", "noopener");
        break;
      case "copy": {
        const ok = await copyText(reportText(c));
        showMessage(ok ? "報告文をコピーしました" : "コピーできませんでした。お手数ですが手動でコピーしてください");
        break;
      }
      case "toggle":
        c.status = c.status === "done" ? "active" : "done";
        saveCases(cases);
        renderCases();
        break;
      case "delete": {
        const name = c.label || "（案件名なし）";
        if (window.confirm(`「${name}」を一覧から削除します。よろしいですか？`)) {
          cases = cases.filter((x) => x.id !== c.id);
          saveCases(cases);
          renderCases();
        }
        break;
      }
    }
  });

  el.add.addEventListener("click", () => {
    const p = currentParams();
    if (!isISODate(p.plannedDate)) {
      showMessage("掲載予定日を入力してください");
      return;
    }
    cases.push({
      id: uid(),
      label: el.label.value.trim(),
      noticeType: p.noticeType,
      months: p.months,
      method: p.method,
      plannedDate: p.plannedDate,
      status: "active",
      createdAt: new Date().toISOString(),
    });
    saveCases(cases);
    el.label.value = "";
    renderCases();
    showMessage("案件を一覧に保存しました");
  });

  el.caseFilter.addEventListener("input", renderCases);
  el.alertBanner.addEventListener("click", () => {
    document.querySelector(".cases").scrollIntoView({ behavior: "smooth" });
  });

  /* ===== URLパラメータ復元 ===== */
  function applyUrlParams() {
    const q = new URLSearchParams(window.location.search);
    if (q.get("type") && TYPE_LABELS[q.get("type")]) el.type.value = q.get("type");
    if (q.get("months") && el.type.value === "custom") {
      const n = Number(q.get("months"));
      if (Number.isInteger(n) && n >= 1 && n <= 120) el.months.value = String(n);
    }
    if (q.get("method") === "electronic" || q.get("method") === "normal") {
      document.querySelector(`input[name="notice-method"][value="${q.get("method")}"]`).checked = true;
    }
    if (isISODate(q.get("date"))) el.date.value = q.get("date");
  }
  el.printBtn.addEventListener("click", () => saveResultsPdf());

  /* ===== 初期化 ===== */
  ["input", "change"].forEach((ev) => {
    el.type.addEventListener(ev, renderResults);
    el.months.addEventListener(ev, renderResults);
    el.date.addEventListener(ev, renderResults);
    document.querySelectorAll('input[name="notice-method"]').forEach((r) => r.addEventListener(ev, renderResults));
  });

  el.date.value = todayISO();
  applyUrlParams();
  renderResults();
  renderCases();

  if (location.protocol.startsWith("http") && "serviceWorker" in navigator) {
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      location.reload();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js?v=20260727-v5", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {});
    });
  }
})();
