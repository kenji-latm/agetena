"use strict";
(function () {
  const STORE_KEY = "touki_cases_v1";
  const STORAGE_MODE_KEY = "touki_storage_mode_v1";
  const SHARED_OFFICE_KEY = "touki_shared_office_v1";
  const TEAM_MODE_KEY = "touki_team_mode_v1";
  const FAVORITES_KEY = "touki_favorites_v1";
  const APP_CONFIG = window.TOUKI_APP_CONFIG && typeof window.TOUKI_APP_CONFIG === "object"
    ? window.TOUKI_APP_CONFIG
    : {};
  const FORCE_LOCAL_ONLY = APP_CONFIG.forceLocalOnly === true;
  const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  const DEFAULT_JURISDICTION = "tokyo";
  const DEFAULT_TYPE = "realEstate";
  const METHOD_REGISTRY = "registryData";
  const METHOD_LETTERPACK = "letterPack";
  const METHOD_LABELS = {
    [METHOD_REGISTRY]: "法務局データ",
    [METHOD_LETTERPACK]: "レターパック申請",
  };
  const FALLBACK_JURISDICTIONS = [
    { id: "tokyo", label: "東京法務局" },
  ];
  const FALLBACK_TYPES = [
    { id: "realEstate", label: "不動産（権利）" },
    { id: "commercial", label: "商業・法人" },
  ];

  function normalizeOption(item) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) return null;
    return { id: item.id, label: typeof item.label === "string" && item.label ? item.label : item.id };
  }

  function normalizeTypes(source) {
    const types = Array.isArray(source.types) ? source.types.map(normalizeOption).filter(Boolean) : [];
    return types.length ? types : FALLBACK_TYPES;
  }

  function isSchema3Data(data) {
    return Object.values(data || {}).some(
      (value) => value && typeof value === "object" && (value.realEstate || value.commercial)
    );
  }

  function normalizeMeta(meta) {
    const source = meta && typeof meta === "object" ? meta : {};
    const types = normalizeTypes(source);

    if (source.data && isSchema3Data(source.data)) {
      const jurisdictionIds = Object.keys(source.data).sort();
      const jurisdictions = Array.isArray(source.jurisdictions) && source.jurisdictions.length
        ? source.jurisdictions.map(normalizeOption).filter(Boolean)
        : jurisdictionIds.map((id) => ({ id, label: id }));
      const officesByJurisdiction = source.officesByJurisdiction || Object.fromEntries(
        jurisdictions.map((j) => [
          j.id,
          Object.fromEntries(types.map((type) => [
            type.id,
            Object.keys(source.data?.[j.id]?.[type.id] || {}).sort(),
          ])),
        ])
      );
      return { ...source, jurisdictions, types, officesByJurisdiction };
    }

    if (source.data && source.data.realEstate) {
      const officesByType = source.officesByType || Object.fromEntries(
        types.map((type) => [type.id, Object.keys(source.data[type.id] || {}).sort()])
      );
      return {
        ...source,
        jurisdictions: FALLBACK_JURISDICTIONS,
        types,
        officesByJurisdiction: { [DEFAULT_JURISDICTION]: officesByType },
        data: { [DEFAULT_JURISDICTION]: source.data },
      };
    }

    const oldData = source.data || {};
    return {
      ...source,
      jurisdictions: FALLBACK_JURISDICTIONS,
      types: [FALLBACK_TYPES[0]],
      officesByJurisdiction: {
        [DEFAULT_JURISDICTION]: {
          realEstate: source.offices || Object.keys(oldData).sort(),
        },
      },
      data: { [DEFAULT_JURISDICTION]: { realEstate: oldData } },
    };
  }

  let META = normalizeMeta(window.KANRYO_DATA || {});
  let DB = META.data || {};
  let TYPES = META.types || [];
  let JURISDICTIONS = META.jurisdictions || [];
  let dataIntegrityOk = true;
  let dataIntegrityState = { status: "unchecked", message: "データ整合性：確認中" };

  let useTodayFallback = false;
  let calendarSheetDraft = null;
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const isISODate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  function fmtJP(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    const wd = WD[new Date(y, m - 1, d).getDay()];
    return `${m}月${d}日（${wd}）`;
  }
  function diffDays(fromISO, toISO) {
    const a = new Date(fromISO + "T00:00:00");
    const b = new Date(toISO + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }
  function isoDate(iso) {
    if (!isISODate(iso)) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function addDaysISO(iso, days) {
    const d = isoDate(iso);
    if (!d) return "";
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addBusinessDaysISO(iso, days) {
    const d = isoDate(iso);
    if (!d) return "";
    let remaining = Math.max(0, Number(days) || 0);
    while (remaining > 0) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) remaining -= 1;
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const isWeekdayISO = (iso) => {
    const d = isoDate(iso);
    return !!d && d.getDay() !== 0 && d.getDay() !== 6;
  };
  function nextMondayISO(fromISO = todayISO()) {
    const d = isoDate(fromISO);
    if (!d) return "";
    const day = d.getDay();
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    d.setDate(d.getDate() + daysUntilMonday);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function updateApplyDateDisplay() {
    const d = isoDate($("f-apply")?.value);
    const display = $("f-apply-display");
    if (!display) return;
    display.textContent = d
      ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}（${WD[d.getDay()]}）`
      : "日付を選択";
  }
  function openApplyDatePicker() {
    const input = $("f-apply");
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // showPicker非対応時は、ユーザー操作内のclickへフォールバックする。
    }
    input.focus({ preventScroll: true });
    input.click();
  }


  const jurisdictionLabel = (jurisdictionId) =>
    JURISDICTIONS.find((j) => j.id === jurisdictionId)?.label ||
    FALLBACK_JURISDICTIONS.find((j) => j.id === jurisdictionId)?.label ||
    jurisdictionId;
  const typeLabel = (typeId) =>
    TYPES.find((type) => type.id === typeId)?.label ||
    FALLBACK_TYPES.find((type) => type.id === typeId)?.label ||
    typeId;
  const normalizeApplicationMethod = (value) => value === METHOD_LETTERPACK ? METHOD_LETTERPACK : METHOD_REGISTRY;
  const applicationMethodLabel = (value) => METHOD_LABELS[normalizeApplicationMethod(value)];
  const selectedJurisdiction = () => $("f-jurisdiction")?.value || DEFAULT_JURISDICTION;
  const selectedType = () =>
    document.querySelector('input[name="registration-type"]:checked')?.value || DEFAULT_TYPE;
  const selectedMethod = () =>
    normalizeApplicationMethod(document.querySelector('input[name="application-method"]:checked')?.value);
  const officesFor = (jurisdictionId, typeId) =>
    META.officesByJurisdiction?.[jurisdictionId]?.[typeId] ||
    Object.keys(DB[jurisdictionId]?.[typeId] || {}).sort();

  function normalizeFavorite(item) {
    if (!item || typeof item !== "object") return null;
    const jurisdiction = typeof item.jurisdiction === "string" ? item.jurisdiction : "";
    const registrationType = typeof item.registrationType === "string" ? item.registrationType : "";
    const office = typeof item.office === "string" ? item.office.trim() : "";
    if (!jurisdiction || !registrationType || !office) return null;
    return { jurisdiction, registrationType, office };
  }

  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
      return Array.isArray(raw) ? raw.map(normalizeFavorite).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  const favoriteKey = (item) => [item.jurisdiction, item.registrationType, item.office].join("\u001f");
  let favorites = loadFavorites();
  const saveFavorites = () => localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));

  const lookupDue = (jurisdictionId, typeId, office, applyISO) =>
    (DB[jurisdictionId] && DB[jurisdictionId][typeId] && DB[jurisdictionId][typeId][office] &&
      DB[jurisdictionId][typeId][office][applyISO]) || null;
  const publishedDatesFor = (jurisdictionId, typeId, office) =>
    META.publishedDates?.[jurisdictionId]?.[typeId]?.[office] || null;
  function lookupSourceStatus(jurisdictionId, typeId, office, applyISO) {
    if (!lookupDue(jurisdictionId, typeId, office, applyISO)) return "missing";
    if (!META.publishedDates) return "unknown";
    const dates = publishedDatesFor(jurisdictionId, typeId, office);
    if (!Array.isArray(dates)) return "history";
    return dates.includes(applyISO) ? "current" : "history";
  }
  function sourceText(status) {
    if (status === "current") return "現在掲載中";
    if (status === "history") return "過去取得済み（現在の公式掲載表には未掲載）";
    return "";
  }

  function isLetterPackMethod(method) {
    return normalizeApplicationMethod(method) === METHOD_LETTERPACK;
  }

  function nextBusinessDayEstimate(jurisdictionId, typeId, office, applyISO) {
    const entries = DB[jurisdictionId]?.[typeId]?.[office] || {};
    const previousApplyDate = Object.keys(entries)
      .filter((date) => isISODate(date) && date < applyISO && isISODate(entries[date]))
      .sort()
      .pop();
    if (!previousApplyDate) return null;
    return {
      dueDate: addBusinessDaysISO(entries[previousApplyDate], 1),
      previousApplyDate,
      previousDueDate: entries[previousApplyDate],
    };
  }

  function dueDateFor(jurisdictionId, typeId, office, applyISO, method = METHOD_REGISTRY, useFallback = false) {
    if (!isISODate(applyISO)) return null;
    if (applyISO > todayISO()) return null;
    let baseDue = lookupDue(jurisdictionId, typeId, office, applyISO);
    if (!baseDue && useFallback && applyISO === todayISO() && isWeekdayISO(applyISO)) {
      baseDue = nextBusinessDayEstimate(jurisdictionId, typeId, office, applyISO)?.dueDate || null;
    }
    if (!baseDue) return null;
    return isLetterPackMethod(method) ? addBusinessDaysISO(baseDue, 1) : baseDue;
  }

  // 「1営業日先登録」はv1.1.0〜v1.1.4の仮登録が保存した文字列（レターパック申請ではない）
  const isFallbackSource = (value) => /(?:掲載タイムラグ補完|1営業日で仮登録|1営業日先登録)/.test(value || "");
  const isFallbackCase = (c) => isFallbackSource(c?.dataSource);
  const isCalendarDraftSource = (value) => /(?:カレンダー仮登録|手動選択)/.test(value || "");
  const isCalendarDraftCase = (c) => isCalendarDraftSource(c?.dataSource);

  function normalizeStoredMethod(method, dataSource) {
    if (isFallbackSource(dataSource) && !/レターパック申請/.test(dataSource || "")) return METHOD_REGISTRY;
    return normalizeApplicationMethod(method || (/レターパック/.test(dataSource || "") ? METHOD_LETTERPACK : METHOD_REGISTRY));
  }

  function caseBasisText(c) {
    const letterPack = isLetterPackMethod(c?.applicationMethod);
    if (isFallbackCase(c)) {
      const jurisdiction = c?.jurisdiction || DEFAULT_JURISDICTION;
      const type = c?.registrationType || DEFAULT_TYPE;
      const estimate = nextBusinessDayEstimate(jurisdiction, type, c?.office, c?.applyDate);
      if (estimate) {
        const letterPackText = letterPack ? "。レターパック到着分として、さらに1営業日後" : "";
        const draftText = isCalendarDraftCase(c) ? "（カレンダー仮登録）" : "";
        return `掲載待ち補完${draftText}：${fmtJP(estimate.previousApplyDate)}申請分の予定日 ${fmtJP(estimate.previousDueDate)}から1営業日後${letterPackText}`;
      }
    }
    if (isCalendarDraftCase(c)) return "カレンダー仮登録：アゲテナで手動選択した登録日（法務局データに基づく完了予定日ではありません）";
    if (letterPack) return "申請方法：レターパック申請（法務局データの完了予定日の翌営業日・土日を除く）";
    return `データ基準：${dataSnapshotText(c)}`;
  }

  function fmtJPDateTime(iso) {
    if (!iso) return "不明";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "不明";
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function validDataHash(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : "";
  }

  function expectedDataHash() {
    return validDataHash(window.KANRYO_DATA_INTEGRITY?.sha256);
  }

  function setExpectedDataIntegrity(integrity) {
    const sha256 = validDataHash(integrity?.sha256);
    if (!sha256) return false;
    window.KANRYO_DATA_INTEGRITY = { ...(integrity || {}), sha256 };
    return true;
  }

  function parseIntegrityScript(source) {
    const match = String(source || "").match(/KANRYO_DATA_INTEGRITY\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  function dataSnapshotText(c) {
    const generatedAt = c === undefined ? (META.generatedAt || "") : (c?.dataGeneratedAt || "");
    return generatedAt ? `${fmtJPDateTime(generatedAt)} 時点` : "不明";
  }

  function currentDataSnapshot(method = METHOD_REGISTRY, usedFallback = false) {
    const sourceParts = [];
    if (typeof META.source === "string" && META.source) sourceParts.push(META.source);
    if (usedFallback) sourceParts.push("本日分の掲載タイムラグ補完");
    if (isLetterPackMethod(method)) sourceParts.push("レターパック申請");
    return {
      dataGeneratedAt: typeof META.generatedAt === "string" ? META.generatedAt : null,
      dataHash: expectedDataHash() || null,
      dataSource: sourceParts.join(" / "),
    };
  }

  function setDataIntegrityState(status, message) {
    dataIntegrityState = { status, message };
    dataIntegrityOk = status !== "error";
    renderDataIntegrityStatus();
  }

  function renderDataIntegrityStatus() {
    const el = $("data-integrity-status");
    if (!el) return;
    el.className = `integrity-status integrity-status--${dataIntegrityState.status}`;
    el.textContent = dataIntegrityState.message;
  }

  async function sha256Json(value) {
    if (!window.crypto?.subtle || typeof TextEncoder === "undefined") return "";
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function verifyDataIntegrity(meta, label = "データ") {
    const expected = expectedDataHash();
    if (!expected) {
      setDataIntegrityState("warn", "データ整合性：検証用ハッシュが見つかりません。表示内容は公式情報で確認してください。");
      return true;
    }
    const actual = await sha256Json(meta);
    if (!actual) {
      setDataIntegrityState("warn", "データ整合性：この環境では自動検証できません。表示内容は公式情報で確認してください。");
      return true;
    }
    if (actual !== expected) {
      setDataIntegrityState("error", `${label}の整合性を確認できません。データファイルが更新中または改ざんされた可能性があります。公式情報をご確認ください。`);
      return false;
    }
    setDataIntegrityState("ok", `データ整合性：確認済み（SHA-256 ${expected.slice(0, 8)}…）`);
    return true;
  }
  function useData(meta) {
    const normalized = normalizeMeta(meta);
    if (!normalized.data || !Array.isArray(normalized.types) || normalized.types.length === 0) return false;
    META = normalized;
    DB = normalized.data;
    TYPES = normalized.types;
    JURISDICTIONS = normalized.jurisdictions || FALLBACK_JURISDICTIONS;
    window.KANRYO_DATA = normalized;
    return true;
  }

  function loadScriptFresh(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`${src} を読み込めませんでした。`));
      document.head.appendChild(script);
    });
  }

  async function refreshLocalDataScripts() {
    if (location.protocol !== "file:") return;
    const stamp = Date.now();
    try {
      await loadScriptFresh(`data/kanryo-integrity.js?v=${stamp}`);
      await loadScriptFresh(`data/kanryo.js?v=${stamp}`);
      useData(window.KANRYO_DATA || META);
    } catch (e) {
      console.warn("ローカルデータを再読み込みできないため、現在読み込み済みのデータを使います。", e);
    }
  }

  async function fetchLatestIntegrity(dataUrl) {
    try {
      const integrityUrl = new URL("kanryo-integrity.js", dataUrl);
      integrityUrl.searchParams.set("_", String(Date.now()));
      const res = await fetch(integrityUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const integrity = parseIntegrityScript(await res.text());
      if (!setExpectedDataIntegrity(integrity)) throw new Error("invalid integrity data");
      return true;
    } catch (e) {
      console.warn("最新の検証用ハッシュを取得できないため、読み込み済みのハッシュで確認します。", e);
      return false;
    }
  }

  async function fetchLatestData() {
    const dataJsonUrl = typeof APP_CONFIG.dataJsonUrl === "string" && APP_CONFIG.dataJsonUrl.trim()
      ? APP_CONFIG.dataJsonUrl.trim()
      : "";
    if (!dataJsonUrl && !location.protocol.startsWith("http")) return null;
    try {
      const url = dataJsonUrl ? new URL(dataJsonUrl, location.href) : new URL("data/kanryo.json", location.href);
      await fetchLatestIntegrity(url);
      const freshUrl = new URL(url.href);
      freshUrl.searchParams.set("_", String(Date.now()));
      const res = await fetch(freshUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = await res.json();
      if (!meta || !meta.data) return null;
      const verified = await verifyDataIntegrity(meta, "最新データ");
      return verified ? meta : null;
    } catch (e) {
      console.warn("最新データを取得できないため、端末内データを使います。", e);
      return null;
    }
  }

  function normalizeCase(item) {
    if (!item || typeof item !== "object") return null;
    const office = typeof item.office === "string" ? item.office.trim() : "";
    const applyDate = isISODate(item.applyDate) ? item.applyDate : "";
    if (!office || !applyDate) return null;
    return {
      id: typeof item.id === "string" && item.id ? item.id : uid(),
      label: typeof item.label === "string" ? item.label : "",
      jurisdiction: typeof item.jurisdiction === "string" && item.jurisdiction ? item.jurisdiction : DEFAULT_JURISDICTION,
      registrationType: typeof item.registrationType === "string" && item.registrationType ? item.registrationType : DEFAULT_TYPE,
      applicationMethod: normalizeStoredMethod(item.applicationMethod, item.dataSource),
      office,
      applyDate,
      dueDate: isISODate(item.dueDate) ? item.dueDate : null,
      dataGeneratedAt: typeof item.dataGeneratedAt === "string" && item.dataGeneratedAt ? item.dataGeneratedAt : null,
      dataHash: typeof item.dataHash === "string" && item.dataHash ? item.dataHash : null,
      dataSource: typeof item.dataSource === "string" ? item.dataSource : "",
      status: item.status === "done" ? "done" : "active",
      createdAt: typeof item.createdAt === "string" && item.createdAt ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : null,
    };
  }
  function caseMatterKey(c) {
    return [
      c?.jurisdiction || DEFAULT_JURISDICTION,
      c?.registrationType || DEFAULT_TYPE,
      normalizeApplicationMethod(c?.applicationMethod),
      c?.office || "",
      c?.applyDate || "",
    ].map((value) => String(value).trim().toLowerCase()).join("\u001f");
  }

  function normalizedCaseLabel(c) {
    return String(c?.label || "").trim().toLowerCase();
  }

  function caseLabelsCompatible(a, b) {
    const labelA = normalizedCaseLabel(a);
    const labelB = normalizedCaseLabel(b);
    return !labelA || !labelB || labelA === labelB;
  }

  function caseHasUsefulLabel(c) {
    return Boolean(normalizedCaseLabel(c));
  }

  function casePathKey(c) {
    return [
      c?.jurisdiction || DEFAULT_JURISDICTION,
      c?.registrationType || DEFAULT_TYPE,
      normalizeApplicationMethod(c?.applicationMethod),
      c?.office || "",
    ].map((value) => String(value).trim().toLowerCase()).join("\u001f");
  }

  function daysBetweenISO(a, b) {
    if (!isISODate(a) || !isISODate(b)) return Number.POSITIVE_INFINITY;
    return Math.abs(diffDays(a, b));
  }

  function labelsAllowLooseMerge(a, b) {
    const labelA = normalizedCaseLabel(a);
    const labelB = normalizedCaseLabel(b);
    if (labelA && labelB) return labelA === labelB;
    return Boolean(labelA || labelB);
  }

  function casesAreNearDraftDuplicate(a, b) {
    if (!isCalendarDraftCase(a) && !isCalendarDraftCase(b)) return false;
    if (casePathKey(a) !== casePathKey(b)) return false;
    if (!labelsAllowLooseMerge(a, b)) return false;
    const applyDays = daysBetweenISO(a?.applyDate, b?.applyDate);
    const dueDays = daysBetweenISO(a?.dueDate, b?.dueDate);
    return applyDays <= 1 && dueDays <= 2;
  }

  function casesAreSameMatter(a, b) {
    return (caseMatterKey(a) === caseMatterKey(b) && caseLabelsCompatible(a, b)) || casesAreNearDraftDuplicate(a, b);
  }
  function timestampValue(value) {
    const time = Date.parse(value || "");
    return Number.isNaN(time) ? 0 : time;
  }

  function preferCase(candidate, current) {
    if (current.status === "done" && candidate.status !== "done") return true;
    if (candidate.status === "done" && current.status !== "done") return false;
    if (Boolean(candidate.dueDate) !== Boolean(current.dueDate)) return Boolean(candidate.dueDate);
    if (candidate.dueDate && current.dueDate && isCalendarDraftCase(candidate) !== isCalendarDraftCase(current)) return !isCalendarDraftCase(candidate);
    if (caseHasUsefulLabel(candidate) !== caseHasUsefulLabel(current)) return caseHasUsefulLabel(candidate);
    const candidateUpdated = timestampValue(candidate.updatedAt || candidate.createdAt);
    const currentUpdated = timestampValue(current.updatedAt || current.createdAt);
    return candidateUpdated > currentUpdated;
  }

  function mergeDuplicateCases(a, b) {
    const primary = preferCase(b, a) ? b : a;
    const secondary = primary === a ? b : a;
    const createdAt = timestampValue(a.createdAt) <= timestampValue(b.createdAt) ? a.createdAt : b.createdAt;
    const updatedAt = timestampValue(a.updatedAt || a.createdAt) >= timestampValue(b.updatedAt || b.createdAt)
      ? (a.updatedAt || a.createdAt)
      : (b.updatedAt || b.createdAt);
    return {
      item: normalizeCase({
        ...secondary,
        ...primary,
        id: primary.id,
        label: primary.label || secondary.label || "",
        dataGeneratedAt: primary.dataGeneratedAt || secondary.dataGeneratedAt || null,
        dataHash: primary.dataHash || secondary.dataHash || null,
        dataSource: primary.dataSource || secondary.dataSource || "",
        createdAt,
        updatedAt,
      }),
      removedId: secondary.id,
    };
  }

  function dedupeCaseList(list) {
    const merged = [];
    const removedIds = [];
    for (const item of list) {
      const normalized = normalizeCase(item);
      if (!normalized) continue;
      const index = merged.findIndex((existing) => casesAreSameMatter(existing, normalized));
      if (index < 0) {
        merged.push(normalized);
        continue;
      }
      const result = mergeDuplicateCases(merged[index], normalized);
      merged[index] = result.item;
      if (result.removedId) removedIds.push(result.removedId);
    }
    return { list: merged.filter(Boolean), removedIds };
  }

  const loadLocal = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY)) || [];
      const list = Array.isArray(raw) ? raw : [];
      const normalized = list.map(normalizeCase).filter(Boolean);
      const deduped = dedupeCaseList(normalized).list;
      if (JSON.stringify(list) !== JSON.stringify(deduped)) {
        localStorage.setItem(STORE_KEY, JSON.stringify(deduped));
      }
      return deduped;
    } catch {
      return [];
    }
  };
  const saveLocal = (list) => localStorage.setItem(STORE_KEY, JSON.stringify(list));

  if (FORCE_LOCAL_ONLY && localStorage.getItem(STORAGE_MODE_KEY) === "shared") {
    localStorage.setItem(STORAGE_MODE_KEY, "local");
  }
  let storageMode = !FORCE_LOCAL_ONLY && localStorage.getItem(STORAGE_MODE_KEY) === "shared" ? "shared" : "local";
  let cases = loadLocal();
  const shared = {
    client: null,
    scriptPromise: null,
    session: null,
    user: null,
    memberships: [],
    officeId: localStorage.getItem(SHARED_OFFICE_KEY) || "",
    loading: false,
    error: "",
    configured: false,
    snapshotColumnsReady: true,
    applicationMethodColumnReady: true,
  };

  function getSharedConfig() {
    const cfg = window.TOUKI_SHARED_CONFIG && typeof window.TOUKI_SHARED_CONFIG === "object"
      ? window.TOUKI_SHARED_CONFIG
      : {};
    return {
      enabled: cfg.enabled !== false,
      supabaseUrl: typeof cfg.supabaseUrl === "string" ? cfg.supabaseUrl.trim() : "",
      supabaseAnonKey: typeof cfg.supabaseAnonKey === "string" ? cfg.supabaseAnonKey.trim() : "",
      activationParam: typeof cfg.activationParam === "string" && cfg.activationParam ? cfg.activationParam : "team",
      activationValue: typeof cfg.activationValue === "string" && cfg.activationValue ? cfg.activationValue : "office",
      alwaysShow: cfg.alwaysShow === true,
    };
  }

  function activateSharedFeatureFromUrl() {
    const cfg = getSharedConfig();
    if (!cfg.enabled) return;
    const params = new URLSearchParams(location.search || "");
    if (params.get(cfg.activationParam) === cfg.activationValue) {
      localStorage.setItem(TEAM_MODE_KEY, "1");
    }
  }

  function isSharedFeatureVisible() {
    if (FORCE_LOCAL_ONLY) return false;
    const cfg = getSharedConfig();
    if (!cfg.enabled) return false;
    return cfg.alwaysShow || localStorage.getItem(TEAM_MODE_KEY) === "1" || storageMode === "shared";
  }

  function isSharedConfigured() {
    const cfg = getSharedConfig();
    return Boolean(cfg.enabled && /^https:\/\//.test(cfg.supabaseUrl) && cfg.supabaseAnonKey.length > 20);
  }
  const isSharedReady = () => storageMode === "shared" && !!(shared.client && shared.session && shared.officeId);
  const canSaveToCurrentMode = () => storageMode !== "shared" || isSharedReady();
  function currentOfficeName() {
    const m = shared.memberships.find((item) => item.officeId === shared.officeId);
    return m?.officeName || "事務所";
  }

  function roleLabel(role) {
    if (role === "owner" || role === "admin") return "管理者";
    if (role === "member") return "メンバー";
    return role || "";
  }

  function loadSupabaseScript() {
    if (window.supabase?.createClient) return Promise.resolve();
    if (shared.scriptPromise) return shared.scriptPromise;
    shared.scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SUPABASE_CDN;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("共有機能の読込に失敗しました。ネットワークを確認してください。"));
      document.head.appendChild(script);
    });
    return shared.scriptPromise;
  }

  async function ensureSharedClient() {
    if (shared.client) return shared.client;
    if (!isSharedConfigured()) {
      throw new Error("共有モードの設定が未完了です。shared-config.js にSupabaseのURLとanon keyを設定してください。");
    }
    await loadSupabaseScript();
    const cfg = getSharedConfig();
    shared.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    shared.client.auth.onAuthStateChange((_event, session) => {
      shared.session = session;
      shared.user = session?.user || null;
      if (storageMode === "shared") {
        loadSharedAfterAuth().catch(handleSharedError);
      }
    });
    return shared.client;
  }

  function membershipFromRow(row) {
    const office = Array.isArray(row.office) ? row.office[0] : row.office;
    return {
      officeId: row.office_id,
      role: row.role || "member",
      displayName: row.display_name || "",
      officeName: office?.name || "事務所",
    };
  }

  async function loadSharedMemberships() {
    const client = await ensureSharedClient();
    if (!shared.user) return [];
    const { data, error } = await client
      .from("office_members")
      .select("office_id, role, display_name, office:offices(name)")
      .eq("user_id", shared.user.id);
    if (error) throw error;
    shared.memberships = (data || []).map(membershipFromRow).filter((m) => m.officeId);
    const ids = shared.memberships.map((m) => m.officeId);
    if (!ids.includes(shared.officeId)) {
      shared.officeId = ids[0] || "";
      if (shared.officeId) localStorage.setItem(SHARED_OFFICE_KEY, shared.officeId);
      else localStorage.removeItem(SHARED_OFFICE_KEY);
    }
    return shared.memberships;
  }

  function rowToCase(row) {
    return normalizeCase({
      id: row.id,
      label: row.label || "",
      jurisdiction: row.jurisdiction_id || DEFAULT_JURISDICTION,
      registrationType: row.registration_type || DEFAULT_TYPE,
      applicationMethod: normalizeStoredMethod(row.application_method, row.data_source),
      office: row.registry_office || "",
      applyDate: row.apply_date || "",
      dueDate: row.due_date || null,
      dataGeneratedAt: row.data_generated_at || null,
      dataHash: row.data_hash || null,
      dataSource: row.data_source || "",
      status: row.status || "active",
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || null,
    });
  }

  function caseToRow(c, includeSnapshot = true, includeApplicationMethod = true) {
    const now = new Date().toISOString();
    const row = {
      office_id: shared.officeId,
      label: c.label || "",
      jurisdiction_id: c.jurisdiction || DEFAULT_JURISDICTION,
      registration_type: c.registrationType || DEFAULT_TYPE,
      registry_office: c.office,
      apply_date: c.applyDate,
      due_date: c.dueDate,
      status: c.status === "done" ? "done" : "active",
      created_by: shared.user?.id,
      updated_by: shared.user?.id,
      updated_at: now,
    };
    if (includeApplicationMethod) {
      row.application_method = normalizeApplicationMethod(c.applicationMethod);
    }
    if (includeSnapshot) {
      row.data_generated_at = c.dataGeneratedAt || null;
      row.data_hash = c.dataHash || null;
      row.data_source = c.dataSource || "";
    }
    return row;
  }
  async function loadSharedCases() {
    const client = await ensureSharedClient();
    if (!shared.session || !shared.officeId) {
      cases = [];
      return;
    }
    const { data, error } = await client
      .from("office_cases")
      .select("*")
      .eq("office_id", shared.officeId)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;
    const deduped = dedupeCaseList((data || []).map(rowToCase).filter(Boolean));
    cases = deduped.list;
    if (deduped.removedIds.length) {
      try {
        await Promise.all(deduped.removedIds.map((id) => deleteSharedCase(id)));
      } catch (e) {
        console.warn("重複した共有案件の整理に失敗しました。", e);
        shared.error = "重複した共有案件の整理に失敗しました。表示上は1件にまとめています。";
      }
    }
  }

  async function loadSharedAfterAuth() {
    if (storageMode !== "shared") return;
    if (!shared.session) {
      cases = [];
      shared.memberships = [];
      renderStoragePanel();
      render();
      updateResult();
      return;
    }
    shared.loading = true;
    shared.error = "";
    renderStoragePanel();
    try {
      await loadSharedMemberships();
      if (!shared.officeId) {
        cases = [];
        shared.error = "このログインユーザーは、まだ事務所に紐づいていません。管理者が office_members に追加してください。";
      } else {
        await loadSharedCases();
      }
    } finally {
      shared.loading = false;
      renderStoragePanel();
      render();
      updateResult();
    }
  }

  async function startSharedMode() {
    shared.configured = isSharedConfigured();
    if (!shared.configured) {
      shared.error = "共有モードはまだ未設定です。Supabaseの設定後に使えます。今はこの端末に保存します。";
      storageMode = "local";
      localStorage.setItem(STORAGE_MODE_KEY, storageMode);
      cases = loadLocal();
      renderStoragePanel();
      render();
      updateResult();
      return;
    }
    storageMode = "shared";
    localStorage.setItem(STORAGE_MODE_KEY, storageMode);
    cases = [];
    shared.loading = true;
    shared.error = "";
    renderStoragePanel();
    render();
    updateResult();
    try {
      const client = await ensureSharedClient();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      shared.session = data.session;
      shared.user = data.session?.user || null;
      await loadSharedAfterAuth();
    } catch (e) {
      shared.loading = false;
      handleSharedError(e);
    }
  }

  function switchToLocalMode() {
    storageMode = "local";
    localStorage.setItem(STORAGE_MODE_KEY, storageMode);
    shared.error = "";
    cases = loadLocal();
    renderStoragePanel();
    render();
    updateResult();
  }

  function handleSharedError(e) {
    console.warn("共有モードでエラーが発生しました。", e);
    shared.loading = false;
    shared.error = e?.message || "共有モードで処理できませんでした。";
    renderStoragePanel();
    render();
    updateResult();
  }

  async function signInShared(event) {
    event.preventDefault();
    const email = $("shared-email")?.value.trim();
    const password = $("shared-password")?.value;
    if (!email || !password) return;
    try {
      shared.loading = true;
      shared.error = "";
      renderStoragePanel();
      const client = await ensureSharedClient();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      shared.session = data.session;
      shared.user = data.user;
      if ($("shared-password")) $("shared-password").value = "";
      await loadSharedAfterAuth();
    } catch (e) {
      handleSharedError(e);
    }
  }

  async function signOutShared() {
    try {
      const client = await ensureSharedClient();
      await client.auth.signOut();
      shared.session = null;
      shared.user = null;
      shared.memberships = [];
      cases = [];
      renderStoragePanel();
      render();
      updateResult();
    } catch (e) {
      handleSharedError(e);
    }
  }

  async function refreshSharedFromButton() {
    try {
      if (!isSharedReady()) return;
      shared.loading = true;
      shared.error = "";
      renderStoragePanel();
      await loadSharedCases();
      shared.loading = false;
      renderStoragePanel();
      render();
      updateResult();
    } catch (e) {
      handleSharedError(e);
    }
  }

  async function changeSharedOffice() {
    const value = $("shared-office")?.value || "";
    if (!value || value === shared.officeId) return;
    shared.officeId = value;
    localStorage.setItem(SHARED_OFFICE_KEY, value);
    await refreshSharedFromButton();
  }

  function isMissingSnapshotColumnError(error) {
    return /data_generated_at|data_hash|data_source|schema cache|column .* does not exist/i.test(error?.message || "");
  }

  function isMissingApplicationMethodColumnError(error) {
    return /application_method|schema cache|column .* does not exist/i.test(error?.message || "");
  }

  async function createSharedCase(c) {
    const client = await ensureSharedClient();
    let data = null;
    let error = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const payload = caseToRow(c, shared.snapshotColumnsReady, shared.applicationMethodColumnReady);
      const result = await client
        .from("office_cases")
        .insert(payload)
        .select("*")
        .single();
      data = result.data;
      error = result.error;
      if (!error) break;
      if (shared.applicationMethodColumnReady && isMissingApplicationMethodColumnError(error)) {
        shared.applicationMethodColumnReady = false;
        shared.error = "共有DBに申請方法の列が未追加です。supabase/shared-office-schema.sql の追加SQLを反映すると共有案件にも記録できます。";
        continue;
      }
      if (shared.snapshotColumnsReady && isMissingSnapshotColumnError(error)) {
        shared.snapshotColumnsReady = false;
        shared.error = "共有DBに保存時データ基準日の列が未追加です。supabase/shared-office-schema.sql の追加SQLを反映すると共有案件にも記録できます。";
        continue;
      }
      break;
    }
    if (error) throw error;
    const saved = rowToCase(data);
    if (saved) cases.push(saved);
  }
  async function updateSharedCase(id, patch) {
    const client = await ensureSharedClient();
    const payload = { ...patch, updated_by: shared.user?.id, updated_at: new Date().toISOString() };
    const { error } = await client.from("office_cases").update(payload).eq("id", id).eq("office_id", shared.officeId);
    if (error) throw error;
  }

  async function deleteSharedCase(id) {
    const client = await ensureSharedClient();
    const { error } = await client.from("office_cases").delete().eq("id", id).eq("office_id", shared.officeId);
    if (error) throw error;
  }

  function renderStoragePanel() {
    const panel = $("storage-panel");
    const localBtn = $("mode-local");
    if (!localBtn) return;
    const cfg = getSharedConfig();
    const shouldShowPanel = isSharedFeatureVisible();
    if (panel) panel.hidden = !shouldShowPanel;
    if (!shouldShowPanel) return;
    shared.configured = isSharedConfigured();
    const sharedBtn = $("mode-shared");
    const status = $("sync-status");
    const login = $("shared-login");
    const session = $("shared-session");
    const message = $("shared-message");
    const officeSelect = $("shared-office");
    const refreshBtn = $("shared-refresh");
    const logoutBtn = $("shared-logout");
    const listTitle = $("list-title");

    localBtn.classList.toggle("is-active", storageMode === "local");
    sharedBtn?.classList.toggle("is-active", storageMode === "shared");
    sharedBtn?.setAttribute("aria-pressed", storageMode === "shared" ? "true" : "false");
    localBtn.setAttribute("aria-pressed", storageMode === "local" ? "true" : "false");
    if (listTitle) listTitle.textContent = storageMode === "shared" ? "事務所共有案件" : "保存した案件";

    if (status) {
      if (storageMode === "local") status.textContent = "この端末だけに保存中。共有DBには送信されません。";
      else if (shared.loading) status.textContent = "事務所共有データを確認中…";
      else if (!shared.configured) status.textContent = "共有モードは未設定です。";
      else if (!shared.session) status.textContent = "事務所共有にログインしてください。";
      else if (!shared.officeId) status.textContent = "ログイン済み。事務所の紐づけ待ちです。";
      else status.textContent = `${currentOfficeName()} の共有案件を表示中。`;
    }

    if (login) login.hidden = !(storageMode === "shared" && shared.configured && !shared.session);
    if (session) session.hidden = !(storageMode === "shared" && shared.configured && !!shared.session);

    if (officeSelect) {
      officeSelect.innerHTML = "";
      for (const m of shared.memberships) {
        const option = document.createElement("option");
        option.value = m.officeId;
        option.textContent = `${m.officeName}${m.role ? `（${roleLabel(m.role)}）` : ""}`;
        officeSelect.appendChild(option);
      }
      if (shared.officeId) officeSelect.value = shared.officeId;
      officeSelect.disabled = shared.memberships.length <= 1 || shared.loading;
    }
    if (refreshBtn) refreshBtn.disabled = shared.loading || !isSharedReady();
    if (logoutBtn) logoutBtn.disabled = shared.loading;

    const messages = [];
    if (storageMode === "shared" && !shared.configured) messages.push("共有モードを使うには、Supabaseプロジェクト作成後に app/shared-config.js を設定してください。");
    if (storageMode === "shared" && shared.configured && !shared.session) messages.push("案件名も共有されるため、友人事務所のメンバーだけにログインを配布してください。");
    if (shared.error) messages.push(shared.error);
    if (message) {
      message.hidden = messages.length === 0;
      message.textContent = messages.join(" ");
    }
  }

  function showResultCalendarButton(title, subtitle) {
    const button = $("result-calendar");
    if (!button) return;
    const strong = button.querySelector("strong");
    const span = button.querySelector("span");
    if (strong) strong.textContent = title;
    if (span) span.textContent = subtitle;
    button.hidden = false;
  }

  function hideResultCalendarButton() {
    const button = $("result-calendar");
    if (button) button.hidden = true;
  }

  function saveUnavailableReason() {
    if (storageMode === "shared" && !isSharedReady()) return "事務所共有に保存するには、ログインと事務所設定が必要です。下の「保存先」で「この端末」に戻すと、この端末だけに保存できます。";
    return "";
  }

  function setSaveMessage(message = "", tone = "") {
    const el = $("save-message");
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
    el.className = `save-message${tone ? ` save-message--${tone}` : ""}`;
  }

  function updateResult() {
    const jurisdictionId = selectedJurisdiction();
    const typeId = selectedType();
    const method = selectedMethod();
    const office = $("f-office").value;
    const apply = $("f-apply").value;
    const box = $("result");
    const dateEl = $("result-date");
    const hintEl = $("result-hint");
    const addBtn = $("f-add");
    hideResultCalendarButton();
    setSaveMessage();
    const isLetterPack = isLetterPackMethod(method);

    if (!dataIntegrityOk) {
      box.className = "result result--warn";
      dateEl.textContent = "データ確認エラー";
      hintEl.textContent = "完了予定日データの整合性を確認できません。公式情報をご確認ください。";
      addBtn.disabled = true;
      setSaveMessage("データ確認エラーのため保存できません。公式情報をご確認ください。", "warn");
      return;
    }

    if (officesFor(jurisdictionId, typeId).length === 0) {
      box.className = "result result--warn";
      dateEl.textContent = "データ未収録";
      hintEl.textContent = `${jurisdictionLabel(jurisdictionId)}・${typeLabel(typeId)}のデータを読み込めませんでした。オンラインで開き直してください。`;
      addBtn.disabled = true;
      setSaveMessage("この法務局・登記種別のデータを読み込めないため保存できません。", "warn");
      return;
    }

    if (!office || !apply) {
      box.className = "result result--empty";
      dateEl.textContent = "— — —";
      hintEl.textContent = "↑ 法務局・登記種別・申請方法・管轄・申請日を選ぶと、ここに自動表示されます";
      addBtn.disabled = true;
      setSaveMessage();
      return;
    }

    const due = dueDateFor(jurisdictionId, typeId, office, apply, method, useTodayFallback);
    const canSave = canSaveToCurrentMode();
    addBtn.disabled = !canSave;
    const saveReason = saveUnavailableReason();
    const saveSuffix = canSave ? "" : ` ／ ${saveReason}`;
    setSaveMessage(canSave ? "この内容で一覧に保存できます。" : saveReason, canSave ? "" : "warn");

    if (!due) {
      box.className = "result result--warn";
      dateEl.textContent = "未掲載";
      const today = todayISO();
      const estimate = apply === today && isWeekdayISO(apply) ? nextBusinessDayEstimate(jurisdictionId, typeId, office, apply) : null;
      if (estimate) {
        showResultCalendarButton("日付を選んで保存", "候補日を初期値にして確認");
        const letterPackText = isLetterPack ? " レターパック申請の場合は、候補日に到着分としてさらに1営業日を加えます。" : "";
        hintEl.textContent = `本日分はまだ未掲載です。下のボタンで登録日を選択できます。${letterPackText}${saveSuffix}`;
      } else {
        showResultCalendarButton("日付を選んで保存", "登録日と案件名を入力");
        if (apply === today && !isWeekdayISO(apply)) {
          hintEl.textContent = `本日は土日のため、法務局の受付・データ掲載はありません。登録日は手動で選択できます。${saveSuffix}`;
        } else if (apply > today) {
          hintEl.textContent = `未来の申請日は、法務局データが掲載されるまで「未掲載」として扱います。登録日は手動で選択できます。${saveSuffix}`;
        } else {
          hintEl.textContent = `この申請日は現在の掲載表・過去取得済みデータのどちらにもありません。登録日は手動で選択できます。${saveSuffix}`;
        }
      }
      return;
    }

    showResultCalendarButton("日付を選んで保存", "表示された予定日を初期値にして確認");
    const n = diffDays(todayISO(), due);
    const context = `${jurisdictionLabel(jurisdictionId)}・${typeLabel(typeId)}・${office}`;
    const estimate = useTodayFallback ? nextBusinessDayEstimate(jurisdictionId, typeId, office, apply) : null;
    const sourceNote = useTodayFallback && estimate
      ? `${fmtJP(estimate.previousApplyDate)}申請分の予定日から1営業日後${isLetterPack ? "、レターパック分でさらに1営業日後" : ""}`
      : isLetterPack
        ? "法務局データの完了予定日の翌営業日（レターパック到着分）"
        : sourceText(lookupSourceStatus(jurisdictionId, typeId, office, apply));
    const sourceSuffix = sourceNote ? ` ／ ${sourceNote}` : "";
    const dataBasisSuffix = ` ／ データ基準：${dataSnapshotText()}`;
    if (n > 0) {
      box.className = "result result--ok";
      hintEl.textContent = `あと ${n} 日（${context}・${applicationMethodLabel(method)}）${sourceSuffix}${dataBasisSuffix}${saveSuffix}`;
    } else if (n === 0) {
      box.className = "result result--due";
      hintEl.textContent = `本日が予定日です（${context}・${applicationMethodLabel(method)}）${sourceSuffix}${dataBasisSuffix}${saveSuffix}`;
    } else {
      box.className = "result result--over";
      hintEl.textContent = `予定日を ${-n} 日過ぎています（${context}・${applicationMethodLabel(method)}）${sourceSuffix}${dataBasisSuffix}${saveSuffix}`;
    }
    dateEl.textContent = fmtJP(due);

    if (window.goatcounter) {
      const src = new URLSearchParams(location.search).get("src") || "direct";
      window.goatcounter.count({ path: "check-" + src, event: true });
    }
  }

  function caseState(c) {
    if (c.status === "done") return "done";
    if (isCalendarDraftCase(c)) return "draft";
    if (!c.dueDate) return "unknown";
    const t = todayISO();
    if (t > c.dueDate) return "over";
    if (t === c.dueDate) return "due";
    return "wait";
  }
  function badge(state, c) {
    if (state === "done") return { cls: "badge--done", text: "完了" };
    if (state === "draft") return { cls: "badge--draft", text: "仮登録" };
    if (state === "unknown") return { cls: "badge--unknown", text: "予定日 未掲載" };
    if (state === "over") return { cls: "badge--over", text: `${diffDays(c.dueDate, todayISO())}日超過` };
    if (state === "due") return { cls: "badge--due", text: "本日が予定日" };
    return { cls: "badge--wait", text: `あと${diffDays(todayISO(), c.dueDate)}日` };
  }

  function updateBanner() {
    const t = todayISO();
    const hit = dedupeCaseList(cases).list.filter((c) => c.status === "active" && c.dueDate && !isCalendarDraftCase(c) && t > c.dueDate);
    const banner = $("alert-banner");
    if (hit.length === 0) { banner.hidden = true; banner.textContent = ""; return; }
    const names = hit.map((c) => (c.label && c.label.trim() ? c.label : "（メモなし）")).join("、");
    banner.hidden = false;
    banner.textContent = "";
    const main = document.createElement("span");
    main.textContent = `完了予定日を過ぎている案件が ${hit.length} 件あります`;
    const sub = document.createElement("span");
    sub.className = "alert-banner__sub";
    sub.textContent = names;
    banner.append(main, sub);
  }

  function filterValue(id) {
    return $(id)?.value || "";
  }

  function caseSearchText(c) {
    return [
      c.label,
      jurisdictionLabel(c.jurisdiction || DEFAULT_JURISDICTION),
      typeLabel(c.registrationType || DEFAULT_TYPE),
      applicationMethodLabel(c.applicationMethod),
      c.office,
      c.applyDate,
      c.dueDate,
      fmtJP(c.applyDate),
      fmtJP(c.dueDate),
      dataSnapshotText(c),
      isCalendarDraftCase(c) ? "仮登録 カレンダー仮登録" : "",
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function dueBucket(c) {
    if (c.status === "done") return "done";
    if (isCalendarDraftCase(c)) return "unknown";
    if (!c.dueDate) return "unknown";
    const today = todayISO();
    if (c.dueDate < today) return "overdue";
    if (c.dueDate === today) return "today";
    const nextMonday = nextMondayISO(today);
    const afterNextMonday = addDaysISO(nextMonday, 7);
    if (c.dueDate < nextMonday) return "thisWeek";
    if (c.dueDate < afterNextMonday) return "nextWeek";
    return "later";
  }

  function bucketLabel(bucket) {
    return {
      overdue: "期限超過",
      today: "今日",
      thisWeek: "今週",
      nextWeek: "来週",
      later: "それ以降",
      unknown: "予定日未掲載",
      done: "完了",
    }[bucket] || "その他";
  }

  function bucketOrder(bucket) {
    return { overdue: 0, today: 1, thisWeek: 2, nextWeek: 3, later: 4, unknown: 5, done: 6 }[bucket] ?? 9;
  }

  function getVisibleCases() {
    const showDone = $("show-done")?.checked;
    const query = (filterValue("case-search").trim().toLowerCase());
    const jurisdiction = filterValue("case-jurisdiction-filter");
    const registrationType = filterValue("case-type-filter");
    const week = filterValue("case-week-filter");
    return dedupeCaseList(cases).list
      .filter((c) => showDone || c.status !== "done")
      .filter((c) => !jurisdiction || (c.jurisdiction || DEFAULT_JURISDICTION) === jurisdiction)
      .filter((c) => !registrationType || (c.registrationType || DEFAULT_TYPE) === registrationType)
      .filter((c) => !week || dueBucket(c) === week)
      .filter((c) => !query || caseSearchText(c).includes(query))
      .sort((a, b) => {
        const bucketDiff = bucketOrder(dueBucket(a)) - bucketOrder(dueBucket(b));
        if (bucketDiff) return bucketDiff;
        return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") ||
          (a.createdAt || "").localeCompare(b.createdAt || "");
      });
  }

  function populateListFilters() {
    const jurisdictionSelect = $("case-jurisdiction-filter");
    const typeSelect = $("case-type-filter");
    if (jurisdictionSelect) {
      const current = jurisdictionSelect.value;
      jurisdictionSelect.innerHTML = '<option value="">すべての法務局</option>';
      for (const jurisdiction of (JURISDICTIONS.length ? JURISDICTIONS : FALLBACK_JURISDICTIONS)) {
        const option = document.createElement("option");
        option.value = jurisdiction.id;
        option.textContent = jurisdiction.label;
        jurisdictionSelect.appendChild(option);
      }
      jurisdictionSelect.value = [...jurisdictionSelect.options].some((option) => option.value === current) ? current : "";
    }
    if (typeSelect) {
      const current = typeSelect.value;
      typeSelect.innerHTML = '<option value="">すべての種別</option>';
      for (const type of (TYPES.length ? TYPES : FALLBACK_TYPES)) {
        const option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.label;
        typeSelect.appendChild(option);
      }
      typeSelect.value = [...typeSelect.options].some((option) => option.value === current) ? current : "";
    }
  }

  function icsDate(iso) {
    return String(iso || "").replace(/-/g, "");
  }

  function calendarTitle(c, marker = "") {
    const name = c.label && c.label.trim()
      ? c.label.trim()
      : jurisdictionLabel(c.jurisdiction || DEFAULT_JURISDICTION);
    return `【完了予定日】${marker}${name}`;
  }

  function caseLabelPlaceholder() {
    return selectedType() === "commercial"
      ? "依頼者名・会社名・件名・メモ（任意）"
      : "依頼者名・物件・件名・メモ（任意）";
  }

  function currentFormCase(dueDate = null, usedFallback = false) {
    const applicationMethod = selectedMethod();
    return {
      id: "draft",
      label: $("f-label")?.value.trim() || "",
      jurisdiction: selectedJurisdiction(),
      registrationType: selectedType(),
      applicationMethod,
      office: $("f-office").value,
      applyDate: $("f-apply").value,
      dueDate,
      ...currentDataSnapshot(applicationMethod, usedFallback),
      status: "active",
      createdAt: new Date().toISOString(),
    };
  }

  function googleCalendarUrl(c, options = {}) {
    const calendarDate = isISODate(options.calendarDate) ? options.calendarDate : c.dueDate;
    if (!calendarDate) return "";
    const leadDetails = Array.isArray(options.leadDetails) ? options.leadDetails.filter(Boolean) : [];
    const details = [
      ...leadDetails,
      `法務局：${jurisdictionLabel(c.jurisdiction || DEFAULT_JURISDICTION)}`,
      `種別：${typeLabel(c.registrationType || DEFAULT_TYPE)}`,
      `申請方法：${applicationMethodLabel(c.applicationMethod)}`,
      `管轄：${c.office}`,
      `申請日：${fmtJP(c.applyDate)}`,
      options.basisText || caseBasisText(c),
      "完了予定日は目安です。各法務局の公式情報をご確認ください。",
    ].filter(Boolean).join("\n");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: options.title || calendarTitle(c),
      dates: `${icsDate(calendarDate)}/${icsDate(addDaysISO(calendarDate, 1))}`,
      details,
      ctz: "Asia/Tokyo",
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function calendarIsProvisional(draft, selectedDate = draft?.calendarDate) {
    if (!draft) return false;
    return draft.mode !== "listed" || selectedDate !== draft.calendarDate;
  }

  function appendSourcePart(source, part) {
    const parts = String(source || "").split(" / ").filter(Boolean);
    if (part && !parts.includes(part)) parts.push(part);
    return parts.join(" / ");
  }

  function calendarSelectionSnapshot(draft, selectedDate) {
    const method = draft?.caseData?.applicationMethod || METHOD_REGISTRY;
    const snapshot = currentDataSnapshot(method, draft?.mode === "fallback");
    let dataSource = snapshot.dataSource || "";
    if (calendarIsProvisional(draft, selectedDate)) {
      const reason = draft?.mode === "fallback"
        ? "カレンダー仮登録"
        : draft?.mode === "manual"
          ? "カレンダー仮登録（手動選択）"
          : "カレンダー仮登録（表示予定日から変更）";
      dataSource = appendSourcePart(dataSource, reason);
    }
    return { ...snapshot, dataSource };
  }

  function calendarCaseForSelection(draft, selectedDate) {
    const base = draft?.caseData || {};
    const now = new Date().toISOString();
    return {
      ...base,
      id: draft?.targetCaseId || (base.id && base.id !== "draft" ? base.id : uid()),
      dueDate: selectedDate,
      ...calendarSelectionSnapshot(draft, selectedDate),
      status: base.status === "done" ? "done" : "active",
      createdAt: base.createdAt || now,
      updatedAt: now,
    };
  }

  function calendarCaseMatchKey(c) {
    return [
      String(c?.label || "").trim(),
      c?.jurisdiction || DEFAULT_JURISDICTION,
      c?.registrationType || DEFAULT_TYPE,
      normalizeApplicationMethod(c?.applicationMethod),
      c?.office || "",
      c?.applyDate || "",
    ].map((value) => String(value).trim().toLowerCase()).join("\u001f");
  }

  function findCalendarCaseIndex(c) {
    if (c?.id && c.id !== "draft") {
      const byId = cases.findIndex((item) => item.id === c.id);
      if (byId >= 0) return byId;
    }
    const key = calendarCaseMatchKey(c);
    const exactIndex = cases.findIndex((item) => calendarCaseMatchKey(item) === key);
    if (exactIndex >= 0) return exactIndex;

    const candidates = cases
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => casesAreSameMatter(item, c));
    if (!candidates.length) return -1;

    const incomingLabel = normalizedCaseLabel(c);
    const labeledCandidate = !incomingLabel ? candidates.find(({ item }) => caseHasUsefulLabel(item)) : null;
    if (labeledCandidate) return labeledCandidate.index;
    const sameLabelUnknown = candidates.find(({ item }) => normalizedCaseLabel(item) === incomingLabel && !item.dueDate);
    if (sameLabelUnknown) return sameLabelUnknown.index;
    const compatibleUnknown = candidates.find(({ item }) => !item.dueDate);
    if (compatibleUnknown) return compatibleUnknown.index;
    const sameLabel = candidates.find(({ item }) => normalizedCaseLabel(item) === normalizedCaseLabel(c));
    return (sameLabel || candidates[0]).index;
  }

  function sharedCasePatch(c) {
    const row = caseToRow(c, shared.snapshotColumnsReady, shared.applicationMethodColumnReady);
    delete row.office_id;
    delete row.created_by;
    return row;
  }

  async function cleanupDuplicateCasesAfterSave() {
    const deduped = dedupeCaseList(cases);
    if (!deduped.removedIds.length) return;
    cases = deduped.list;
    if (isSharedReady()) {
      try {
        await Promise.all(deduped.removedIds.map((id) => deleteSharedCase(id)));
      } catch (e) {
        console.warn("重複した共有案件の整理に失敗しました。", e);
        shared.error = "重複した共有案件の整理に失敗しました。表示上は1件にまとめています。";
        renderStoragePanel();
      }
    } else {
      saveLocal(cases);
    }
  }

  async function saveCalendarCaseSelection(caseData) {
    const normalized = normalizeCase(caseData);
    if (!normalized) return { saved: false, reason: "案件情報を保存できませんでした。" };
    if (!canSaveToCurrentMode()) {
      const reason = saveUnavailableReason();
      shared.error = reason;
      renderStoragePanel();
      updateResult();
      return { saved: false, reason };
    }

    const index = findCalendarCaseIndex(normalized);
    const existing = index >= 0 ? cases[index] : null;
    const item = {
      ...(existing || {}),
      ...normalized,
      id: existing?.id || normalized.id,
      status: existing?.status === "done" ? "done" : normalized.status,
      createdAt: existing?.createdAt || normalized.createdAt,
      updatedAt: new Date().toISOString(),
    };

    if (isSharedReady()) {
      if (existing) {
        await updateSharedCase(existing.id, sharedCasePatch(item));
        cases[index] = item;
      } else {
        await createSharedCase(item);
      }
    } else {
      if (existing) cases[index] = item;
      else cases.push(item);
      saveLocal(cases);
    }

    await cleanupDuplicateCasesAfterSave();
    render();
    updateResult();
    return { saved: true, updated: Boolean(existing) };
  }

  function calendarDraftFromCase(c) {
    const normalized = normalizeCase(c);
    if (!normalized) return null;
    const jurisdiction = normalized.jurisdiction || DEFAULT_JURISDICTION;
    const registrationType = normalized.registrationType || DEFAULT_TYPE;
    const applicationMethod = normalizeApplicationMethod(normalized.applicationMethod);
    const office = normalized.office;
    const applyDate = normalized.applyDate;
    const listedDate = dueDateFor(jurisdiction, registrationType, office, applyDate, applicationMethod, false);
    if (listedDate) {
      return { mode: "listed", calendarDate: listedDate, caseData: { ...normalized, dueDate: listedDate }, estimate: null, targetCaseId: normalized.id };
    }
    const canEstimate = applyDate === todayISO() && isWeekdayISO(applyDate) && !lookupDue(jurisdiction, registrationType, office, applyDate);
    const estimate = canEstimate ? nextBusinessDayEstimate(jurisdiction, registrationType, office, applyDate) : null;
    const fallbackDate = estimate ? dueDateFor(jurisdiction, registrationType, office, applyDate, applicationMethod, true) : null;
    return {
      mode: fallbackDate ? "fallback" : "manual",
      calendarDate: fallbackDate || applyDate || todayISO(),
      caseData: { ...normalized, applicationMethod, dueDate: fallbackDate || applyDate || todayISO() },
      estimate,
      targetCaseId: normalized.id,
    };
  }

  function openGoogleCalendar(c) {
    if (!c?.dueDate) {
      const draft = calendarDraftFromCase(c);
      if (!draft) {
        alert("保存するには、管轄・申請日を確認してください。");
        return;
      }
      openCalendarSheet(draft);
      return;
    }
    const marker = isCalendarDraftCase(c) ? "【仮】" : "";
    const url = googleCalendarUrl(c, { title: calendarTitle(c, marker), basisText: caseBasisText(c) });
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  function selectedCalendarDraft() {
    const jurisdiction = selectedJurisdiction();
    const registrationType = selectedType();
    const applicationMethod = selectedMethod();
    const office = $("f-office").value;
    const applyDate = $("f-apply").value;
    if (!office || !isISODate(applyDate)) return null;

    const listedDate = dueDateFor(jurisdiction, registrationType, office, applyDate, applicationMethod, false);
    if (listedDate) {
      return { mode: "listed", calendarDate: listedDate, caseData: currentFormCase(listedDate, false), estimate: null };
    }

    const canEstimate = applyDate === todayISO() && isWeekdayISO(applyDate) && !lookupDue(jurisdiction, registrationType, office, applyDate);
    const estimate = canEstimate ? nextBusinessDayEstimate(jurisdiction, registrationType, office, applyDate) : null;
    const fallbackDate = estimate ? dueDateFor(jurisdiction, registrationType, office, applyDate, applicationMethod, true) : null;
    const calendarDate = fallbackDate || applyDate || todayISO();
    return {
      mode: fallbackDate ? "fallback" : "manual",
      calendarDate,
      caseData: currentFormCase(calendarDate, !!fallbackDate),
      estimate,
    };
  }

  function calendarDraftSummary(draft) {
    if (!draft) return "";
    if (draft.mode === "listed") return `表示された完了予定日 ${fmtJP(draft.calendarDate)} を初期値にしています。`;
    if (draft.mode === "fallback") return `候補日 ${fmtJP(draft.calendarDate)} を初期値にしています。`;
    return "完了予定日が未掲載のため、登録日を手動で選択してください。";
  }

  function calendarSaveNote(draft) {
    if (!canSaveToCurrentMode()) return "案件一覧にも保存するには、保存先をこの端末に戻すか、事務所共有にログインしてください。";
    return draft?.targetCaseId
      ? "保存すると、この保存案件の登録日と案件名を更新してGoogleカレンダーを開きます。"
      : "保存すると、この日付と案件名で案件一覧に保存してGoogleカレンダーを開きます。";
  }

  function calendarDraftNote(draft) {
    if (!draft) return "";
    const base = draft.mode === "listed"
      ? "必要に応じて、登録日を変更してから保存できます。"
      : draft.mode === "fallback"
        ? "候補日は直前の取得済み予定日から計算した目安です。必要に応じて変更してください。"
        : "ここで選んだ日付は、法務局データに基づく完了予定日ではありません。";
    return `${base} ${calendarSaveNote(draft)}`;
  }

  function calendarSheetLabel() {
    const input = $("calendar-label");
    return input ? input.value.trim() : "";
  }

  function calendarCaseDataWithLabel(draft) {
    const label = calendarSheetLabel();
    return { ...(draft?.caseData || {}), label };
  }

  function calendarTitlePreview(draft, selectedDate = draft?.calendarDate) {
    if (!draft) return "";
    const marker = calendarIsProvisional(draft, selectedDate) ? "【仮】" : "";
    return `Googleカレンダーの件名は「${calendarTitle(calendarCaseDataWithLabel(draft), marker)}」で作成されます。`;
  }

  function updateCalendarSheetPreview() {
    if (!calendarSheetDraft) return;
    const input = $("calendar-date");
    const preview = $("calendar-title-preview");
    if (preview) preview.textContent = calendarTitlePreview(calendarSheetDraft, input?.value || calendarSheetDraft.calendarDate);
  }

  function calendarLeadDetails(draft, selectedDate) {
    if (!draft) return [];
    const lines = [
      `アゲテナで選択した登録日：${fmtJP(selectedDate)}`,
    ];
    if (draft.mode === "listed") {
      lines.push(`表示された完了予定日：${fmtJP(draft.calendarDate)}`);
      if (selectedDate !== draft.calendarDate) lines.push("表示された完了予定日から変更して仮登録しています。");
    } else if (draft.mode === "fallback" && draft.estimate) {
      lines.push("本日分の法務局データが未掲載のため、仮登録として作成しています。");
      lines.push(`根拠：${fmtJP(draft.estimate.previousApplyDate)}申請分の完了予定日 ${fmtJP(draft.estimate.previousDueDate)}`);
      if (isLetterPackMethod(draft.caseData.applicationMethod)) lines.push("レターパック申請のため、候補日は到着分としてさらに1営業日後にしています。");
    } else {
      lines.push("完了予定日データが未掲載のため、手動選択した日付です。");
    }
    return lines;
  }

  function openCalendarSheet(draft) {
    if (!draft) return;
    calendarSheetDraft = draft;
    const sheet = $("calendar-sheet");
    const input = $("calendar-date");
    const labelInput = $("calendar-label");
    $("calendar-sheet-summary").textContent = calendarDraftSummary(draft);
    $("calendar-sheet-note").textContent = calendarDraftNote(draft);
    input.value = draft.calendarDate;
    if (labelInput) {
      labelInput.placeholder = caseLabelPlaceholder();
      labelInput.value = draft.caseData?.label || $("f-label")?.value.trim() || "";
    }
    updateCalendarSheetPreview();
    if (typeof sheet.showModal === "function") sheet.showModal();
    else sheet.setAttribute("open", "");
    try { input.showPicker?.(); } catch {}
  }

  function openCalendarSheetFromResult() {
    const draft = selectedCalendarDraft();
    if (!draft) {
      alert("保存するには、法務局・登記種別・管轄・申請日を選択してください。");
      return;
    }
    openCalendarSheet(draft);
  }

  function closeCalendarSheet() {
    const sheet = $("calendar-sheet");
    calendarSheetDraft = null;
    if (typeof sheet.close === "function") sheet.close();
    else sheet.removeAttribute("open");
  }

  async function openSelectedGoogleCalendar() {
    if (!calendarSheetDraft) return;
    const selectedDate = $("calendar-date").value;
    if (!isISODate(selectedDate)) {
      alert("保存する登録日を選択してください。");
      return;
    }

    const button = $("calendar-open");
    const originalText = button?.textContent || "";
    if (button) {
      button.disabled = true;
      button.textContent = "保存中...";
    }
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      try { popup.opener = null; } catch {}
    }

    const label = calendarSheetLabel();
    const nextDraft = { ...calendarSheetDraft, caseData: { ...calendarSheetDraft.caseData, label } };
    const caseData = calendarCaseForSelection(nextDraft, selectedDate);
    try {
      const saveResult = await saveCalendarCaseSelection(caseData);
      if (!saveResult.saved) {
        if (popup) popup.close();
        alert(`${saveResult.reason}\n\n保存先を確認してから、もう一度お試しください。`);
        return;
      }
      const provisional = calendarIsProvisional(nextDraft, selectedDate);
      const url = googleCalendarUrl(caseData, {
        title: calendarTitle(caseData, provisional ? "【仮】" : ""),
        calendarDate: selectedDate,
        leadDetails: calendarLeadDetails(nextDraft, selectedDate),
        basisText: provisional ? caseBasisText(caseData) : "",
      });
      if (!url) {
        if (popup) popup.close();
        return;
      }
      if ($("f-label")) $("f-label").value = label;
      if (popup) popup.location.href = url;
      else window.open(url, "_blank", "noopener");
      closeCalendarSheet();
      setSaveMessage("保存してGoogleカレンダーを開きました。", "");
    } catch (e) {
      if (popup) popup.close();
      handleSharedError(e);
      alert("案件一覧への保存に失敗しました。保存先の状態を確認してください。");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }
  function reportTemplate(c) {
    const subject = c.label && c.label.trim() ? c.label.trim() : typeLabel(c.registrationType || DEFAULT_TYPE);
    const registrationSubject = /登記$/.test(subject) ? subject : `${subject}の登記`;
    const dueText = c.dueDate
      ? (() => {
          const [, month, day] = c.dueDate.split("-").map(Number);
          return `登記完了は${month}月${day}日頃の予定です。`;
        })()
      : "登記完了予定日は、現在確認中です。";
    return `お世話になっております。\n本日、${registrationSubject}を申請しました。\n${dueText}\n登記が完了しましたら、改めてご連絡いたします。`;
  }

  function openReportSheet(c) {
    const sheet = $("report-sheet");
    $("report-text").value = reportTemplate(c);
    if (typeof sheet.showModal === "function") sheet.showModal();
    else sheet.setAttribute("open", "");
  }

  function closeReportSheet() {
    const sheet = $("report-sheet");
    if (typeof sheet.close === "function") sheet.close();
    else sheet.removeAttribute("open");
  }

  async function copyReportText(button) {
    const text = $("report-text").value;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      $("report-text").select();
      document.execCommand("copy");
      window.getSelection()?.removeAllRanges();
    }
    const original = button.textContent;
    button.textContent = "コピーしました ✓";
    setTimeout(() => { button.textContent = original; }, 1200);
  }

  function render() {
    const list = $("list");
    const visible = getVisibleCases();
    list.innerHTML = "";
    const empty = $("empty");
    empty.hidden = visible.length > 0;
    const hasAnyCases = cases.some((c) => $("show-done")?.checked || c.status !== "done");
    empty.textContent = hasAnyCases
      ? "条件に合う案件はありません。検索や絞り込みを変更してください。"
      : storageMode === "shared"
        ? "この事務所の共有案件はここに並びます。予定日を過ぎた案件だけ、静かにお知らせします。"
        : "保存した案件はここに並びます。予定日を過ぎた案件だけ、静かにお知らせします。";
    updateBanner();
    renderStoragePanel();

    let currentBucket = "";
    for (const c of visible) {
      const bucket = dueBucket(c);
      if (bucket !== currentBucket) {
        currentBucket = bucket;
        const group = document.createElement("h3");
        group.className = "list-group";
        group.textContent = bucketLabel(bucket);
        list.appendChild(group);
      }

      const st = caseState(c);
      const b = badge(st, c);
      const el = document.createElement("div");
      el.className = `item item--${st}`;
      el.innerHTML = `
        <div class="item__top">
          <button class="item__label" type="button" title="申請報告文を表示"></button>
          <span class="badge ${b.cls}">${b.text}</span>
        </div>
        <div class="item__office"></div>
        <div class="item__row">申請日 <span class="apply"></span></div>
        <div class="item__due">保存時の完了予定日 <b class="due"></b><span class="item__source"></span></div>
        <div class="item__latest" hidden></div>
        <div class="item__snapshot"></div>
        <div class="item__actions"></div>`;
      el.querySelector(".item__label").textContent = c.label && c.label.trim() ? c.label : "（メモなし）";
      el.querySelector(".item__label").addEventListener("click", () => openReportSheet(c));
      const methodText = isLetterPackMethod(c.applicationMethod) ? ` ｜ ${applicationMethodLabel(c.applicationMethod)}` : "";
      el.querySelector(".item__office").textContent = `${jurisdictionLabel(c.jurisdiction || DEFAULT_JURISDICTION)} ｜ ${typeLabel(c.registrationType || DEFAULT_TYPE)} ｜ ${c.office}${methodText}`;
      el.querySelector(".apply").textContent = fmtJP(c.applyDate);
      el.querySelector(".due").textContent = c.dueDate ? `${isCalendarDraftCase(c) ? "仮 " : ""}${fmtJP(c.dueDate)}` : "未掲載";
      const sourceEl = el.querySelector(".item__source");
      sourceEl.textContent = isCalendarDraftCase(c) ? "仮登録日" : "保存時点";
      const snapshotEl = el.querySelector(".item__snapshot");
      if (snapshotEl) snapshotEl.textContent = caseBasisText(c);
      const latestDue = dueDateFor(c.jurisdiction || DEFAULT_JURISDICTION, c.registrationType || DEFAULT_TYPE, c.office, c.applyDate, c.applicationMethod, isFallbackCase(c));
      if (latestDue !== c.dueDate && (latestDue || c.dueDate)) {
        const latestEl = el.querySelector(".item__latest");
        latestEl.hidden = false;
        latestEl.textContent = latestDue ? "現在の掲載 " : "現在の掲載では確認できません";
        if (latestDue) {
          const latestDate = document.createElement("b");
          latestDate.textContent = fmtJP(latestDue);
          latestEl.appendChild(latestDate);
          const latestNote = document.createElement("span");
          latestNote.className = "item__latest-note";
          latestNote.textContent = "保存時から変更あり";
          latestEl.appendChild(latestNote);
        }
      }
      const actions = el.querySelector(".item__actions");
      actions.appendChild(mkBtn("Googleカレンダー", "mini mini--calendar", () => openGoogleCalendar(c)));
      actions.appendChild(mkBtn("文面コピー", "mini mini--report", () => openReportSheet(c)));
      actions.appendChild(c.status === "done"
        ? mkBtn("未完了に戻す", "mini mini--undo", () => toggleDone(c.id, false))
        : mkBtn("完了にする", "mini mini--done", () => toggleDone(c.id, true)));
      actions.appendChild(mkBtn("削除", "mini mini--del", () => removeCase(c.id)));
      list.appendChild(el);
    }
  }  function mkBtn(text, cls, fn) {
    const button = document.createElement("button");
    button.type = "button"; button.className = cls; button.textContent = text;
    button.addEventListener("click", () => Promise.resolve(fn(button)).catch(handleSharedError));
    return button;
  }  async function addCase() {
    const jurisdiction = selectedJurisdiction();
    const registrationType = selectedType();
    const applicationMethod = selectedMethod();
    const office = $("f-office").value;
    const applyDate = $("f-apply").value;
    if (!office || !applyDate) return;
    if (storageMode === "shared" && !isSharedReady()) {
      shared.error = "事務所共有に保存するには、ログインと事務所の紐づけが必要です。";
      renderStoragePanel();
      updateResult();
      return;
    }
    const usedFallback = useTodayFallback && !lookupDue(jurisdiction, registrationType, office, applyDate);
    const newCase = {
      id: uid(),
      label: $("f-label").value.trim(),
      jurisdiction,
      registrationType,
      applicationMethod,
      office,
      applyDate,
      dueDate: dueDateFor(jurisdiction, registrationType, office, applyDate, applicationMethod, usedFallback),
      ...currentDataSnapshot(applicationMethod, usedFallback),
      status: "active",
      createdAt: new Date().toISOString(),
    };
    try {
      if (isSharedReady()) await createSharedCase(newCase);
      else { cases.push(newCase); saveLocal(cases); }
      await cleanupDuplicateCasesAfterSave();
      $("f-label").value = "";
      useTodayFallback = false;
      flashSaved();
      render();
      updateResult();
    } catch (e) {
      handleSharedError(e);
    }
  }
  function flashSaved() {
    const button = $("f-add");
    const text = button.textContent;
    button.textContent = storageMode === "shared" ? "共有に保存しました ✓" : "保存しました ✓";
    setTimeout(() => (button.textContent = text), 1200);
  }
  async function toggleDone(id, done) {
    const c = cases.find((x) => x.id === id);
    if (!c) return;
    const nextStatus = done ? "done" : "active";
    if (isSharedReady()) await updateSharedCase(id, { status: nextStatus });
    c.status = nextStatus;
    c.updatedAt = new Date().toISOString();
    if (!isSharedReady()) saveLocal(cases);
    render();
  }
  async function removeCase(id) {
    if (!confirm("この案件を削除しますか？")) return;
    if (isSharedReady()) await deleteSharedCase(id);
    cases = cases.filter((x) => x.id !== id);
    if (!isSharedReady()) saveLocal(cases);
    render();
  }

  function populateJurisdictions(selected = "") {
    const select = $("f-jurisdiction");
    const jurisdictions = JURISDICTIONS.length ? JURISDICTIONS : FALLBACK_JURISDICTIONS;
    select.innerHTML = "";
    for (const jurisdiction of jurisdictions) {
      const option = document.createElement("option");
      option.value = jurisdiction.id;
      option.textContent = jurisdiction.label;
      select.appendChild(option);
    }
    const ids = jurisdictions.map((j) => j.id);
    select.value = ids.includes(selected)
      ? selected
      : ids.includes(DEFAULT_JURISDICTION)
        ? DEFAULT_JURISDICTION
        : ids[0] || "";
  }

  function populateOffices(selected = "") {
    const jurisdictionId = selectedJurisdiction();
    const typeId = selectedType();
    const offices = officesFor(jurisdictionId, typeId);
    const select = $("f-office");
    select.innerHTML = "";
    if (offices.length !== 1) {
      const def = document.createElement("option");
      def.value = "";
      def.textContent = offices.length ? "選択してください" : "掲載データなし";
      select.appendChild(def);
    }
    for (const office of offices) {
      const option = document.createElement("option");
      option.value = office; option.textContent = office;
      select.appendChild(option);
    }
    select.value = offices.includes(selected)
      ? selected
      : offices.length === 1 ? offices[0] : "";
  }

  function updateControls() {
    useTodayFallback = false;
    const previousOffice = $("f-office").value;
    populateOffices(previousOffice);
    $("f-label").placeholder = caseLabelPlaceholder();
    renderFavorites();
    updateResult();
  }

  function currentFavorite() {
    const office = $("f-office")?.value || "";
    if (!office) return null;
    return {
      jurisdiction: selectedJurisdiction(),
      registrationType: selectedType(),
      office,
    };
  }

  function renderFavorites() {
    const panel = $("favorites-panel");
    const shortcuts = $("favorite-shortcuts");
    const toggle = $("favorite-toggle");
    if (!panel || !shortcuts || !toggle) return;

    shortcuts.replaceChildren();
    panel.hidden = favorites.length === 0;
    for (const favorite of favorites) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "favorite-chip";
      button.title = `${jurisdictionLabel(favorite.jurisdiction)}｜${typeLabel(favorite.registrationType)}｜${favorite.office}`;
      const star = document.createElement("span");
      star.className = "favorite-chip__star";
      star.textContent = "★";
      const text = document.createElement("span");
      text.className = "favorite-chip__text";
      const office = document.createElement("span");
      office.className = "favorite-chip__office";
      office.textContent = favorite.office;
      const meta = document.createElement("span");
      meta.className = "favorite-chip__meta";
      meta.textContent = `${jurisdictionLabel(favorite.jurisdiction)}・${typeLabel(favorite.registrationType)}`;
      text.append(office, meta);
      button.append(star, text);
      button.addEventListener("click", () => applyFavorite(favorite));
      shortcuts.appendChild(button);
    }

    const current = currentFavorite();
    const active = Boolean(current && favorites.some((item) => favoriteKey(item) === favoriteKey(current)));
    toggle.disabled = !current;
    toggle.classList.toggle("is-active", active);
    toggle.setAttribute("aria-pressed", active ? "true" : "false");
    toggle.textContent = active ? "★ お気に入り登録済み（押すと解除）" : "☆ よく使う組み合わせに追加";
  }

  function applyFavorite(favorite) {
    populateJurisdictions(favorite.jurisdiction);
    const typeInput = [...document.querySelectorAll('input[name="registration-type"]')]
      .find((input) => input.value === favorite.registrationType);
    if (typeInput) typeInput.checked = true;
    populateOffices(favorite.office);
    updateControls();
  }

  function toggleFavorite() {
    const current = currentFavorite();
    if (!current) return;
    const key = favoriteKey(current);
    const index = favorites.findIndex((item) => favoriteKey(item) === key);
    if (index >= 0) favorites.splice(index, 1);
    else favorites.push(current);
    saveFavorites();
    renderFavorites();
  }

  function updateDataMeta() {
    if (META.generatedAt) {
      const d = new Date(META.generatedAt);
      const count = (JURISDICTIONS.length || FALLBACK_JURISDICTIONS.length);
      const history = META.history?.enabled ? " / 履歴蓄積：有効" : "";
      const policy = META.fetchPolicy?.mode === "scheduledSnapshot" ? " / 負荷対策：検索時は保存済みデータを照会" : "";
      $("data-meta").textContent = `データ取得：${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} 時点 / 対象：${count}法務局・地方法務局${history}${policy}`;
    } else {
      $("data-meta").textContent = "";
    }
  }

  async function unregisterLegacyRootServiceWorkers() {
    if (!navigator.serviceWorker?.getRegistrations || !location.protocol.startsWith("http") || !location.pathname.startsWith("/agetena/")) return;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => {
        const scopePath = new URL(registration.scope).pathname;
        return scopePath === "/" ? registration.unregister() : true;
      }));
    } catch (e) {
      console.warn("旧URL用のキャッシュ解除を完了できませんでした。", e);
    }
  }

  async function init() {
    activateSharedFeatureFromUrl();
    await unregisterLegacyRootServiceWorkers();
    await refreshLocalDataScripts();
    renderDataIntegrityStatus();
    await verifyDataIntegrity(META, "同梱データ");
    $("f-apply").value = todayISO();
    updateApplyDateDisplay();
    populateJurisdictions();
    updateControls();
    updateDataMeta();
    populateListFilters();
    renderStoragePanel();

    $("f-jurisdiction").addEventListener("change", updateControls);
    document.querySelectorAll('input[name="registration-type"]').forEach((input) => input.addEventListener("change", updateControls));
    $("f-apply-trigger").addEventListener("click", openApplyDatePicker);
    document.querySelectorAll('input[name="application-method"]').forEach((input) => input.addEventListener("change", updateResult));
    $("f-office").addEventListener("change", () => {
      useTodayFallback = false;
      renderFavorites();
      updateResult();
    });
    $("f-apply").addEventListener("change", () => {
      useTodayFallback = false;
      updateApplyDateDisplay();
      updateResult();
    });
    $("favorite-toggle").addEventListener("click", toggleFavorite);
    $("result-calendar").addEventListener("click", openCalendarSheetFromResult);
    $("f-add").addEventListener("click", addCase);
    $("show-done").addEventListener("change", render);
    $("case-search")?.addEventListener("input", render);
    $("case-jurisdiction-filter")?.addEventListener("change", render);
    $("case-type-filter")?.addEventListener("change", render);
    $("case-week-filter")?.addEventListener("change", render);
    $("alert-banner").addEventListener("click", () => {
      const head = document.querySelector(".list-head");
      if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("mode-local")?.addEventListener("click", switchToLocalMode);
    $("mode-shared")?.addEventListener("click", () => startSharedMode());
    $("shared-login")?.addEventListener("submit", signInShared);
    $("shared-logout")?.addEventListener("click", signOutShared);
    $("shared-refresh")?.addEventListener("click", refreshSharedFromButton);
    $("shared-office")?.addEventListener("change", () => changeSharedOffice().catch(handleSharedError));
    $("calendar-close")?.addEventListener("click", closeCalendarSheet);
    $("calendar-date")?.addEventListener("change", updateCalendarSheetPreview);
    $("calendar-label")?.addEventListener("input", updateCalendarSheetPreview);
    $("calendar-open")?.addEventListener("click", openSelectedGoogleCalendar);
    $("calendar-sheet")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeCalendarSheet();
    });
    $("report-close")?.addEventListener("click", closeReportSheet);
    $("report-copy")?.addEventListener("click", (event) => copyReportText(event.currentTarget).catch(handleSharedError));
    $("report-sheet")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeReportSheet();
    });

    render();
    if (storageMode === "shared") await startSharedMode();

    const latest = await fetchLatestData();
    if (latest && useData(latest)) {
      const selectedJ = selectedJurisdiction();
      const selectedOffice = $("f-office").value;
      populateJurisdictions(selectedJ);
      populateOffices(selectedOffice);
      updateControls();
      updateDataMeta();
      populateListFilters();
      render();
    }
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      location.reload();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js?v=20260721-v133", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {});
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
