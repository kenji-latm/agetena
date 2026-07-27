(() => {
  "use strict";

  const STORE_KEY = "michitena.cases.v1";
  const PUBLIC_APP_URL = "https://tools.ishimoto-legal.com/michitena/";

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
    shareUrl: $("share-url"),
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

  /* ===== URL共有 ===== */
  function conditionShareUrl(query) {
    const base = location.protocol === "file:" ? PUBLIC_APP_URL : location.href;
    const url = new URL(base);
    url.hash = "";
    url.search = query.toString();
    if (/\/index\.html$/.test(url.pathname)) url.pathname = url.pathname.replace(/index\.html$/, "");
    return url.href;
  }
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

  el.shareUrl.addEventListener("click", async () => {
    const p = currentParams();
    const q = new URLSearchParams({ type: p.noticeType, method: p.method });
    if (p.noticeType === "custom") q.set("months", String(p.months));
    if (isISODate(p.plannedDate)) q.set("date", p.plannedDate);
    const url = conditionShareUrl(q);
    const ok = await copyText(url);
    showMessage(ok ? "この条件を開くURLをコピーしました" : "コピーできませんでした");
  });

  el.printBtn.addEventListener("click", () => window.print());

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
        .register("./sw.js?v=20260727-v3", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {});
    });
  }
})();
