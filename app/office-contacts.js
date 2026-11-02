"use strict";
(function (root) {
  const DIRECTORY = "https://houmukyoku.moj.go.jp/";
  function officialUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "houmukyoku.moj.go.jp" &&
        !url.username && !url.password && !url.port ? url.href : "";
    } catch { return ""; }
  }
  // 内線・制御文字・URIパラメータを許可しない。用途と発信先を勝手に変換しない。
  function phoneHref(value) {
    return typeof value === "string" && !/[^0-9-]/.test(value) && /^0[1-9][0-9]{0,3}-[0-9]{1,4}-[0-9]{4}$/.test(value) &&
      [10, 11].includes(value.replaceAll("-", "").length) ? "tel:" + value.replaceAll("-", "") : "";
  }
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value &&
      value <= new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
      }).format(new Date());
  }
  function resolve(registry, jurisdictionId, officeName, typeId) {
    if (!jurisdictionId || !officeName || !["realEstate", "commercial"].includes(typeId)) return null;
    const offices = registry?.schemaVersion === 1 && Array.isArray(registry.offices) ? registry.offices : [];
    const matches = offices.filter(o => o?.jurisdictionId === jurisdictionId &&
      Array.isArray(o.officeNames) && o.officeNames.includes(officeName));
    // あいまいな対応は表示しない。同名の別法務局へフォールバックしない。
    const office = matches.length === 1 ? matches[0] : null;
    const exclusion = Array.isArray(registry?.coverage?.excludedTargets)
      ? registry.coverage.excludedTargets.find(e => e.jurisdictionId === jurisdictionId &&
        e.officeName === officeName && e.registrationType === typeId) : null;
    const contacts = !exclusion && office && Array.isArray(office.contacts) ? office.contacts.filter(c =>
      c?.kind === "phone" && c.status === "active" && c.verificationStatus === "verified" &&
      ((c.evidenceMethod === "official_live" && c.liveVerified === true) ||
        (c.evidenceMethod === "official_indexed_body" && c.liveVerified === false)) &&
      !c.withdrawnOn && Array.isArray(c.registrationTypes) && c.registrationTypes.includes(typeId) &&
      typeof c.desk === "string" && c.desk.trim() && typeof c.purpose === "string" && c.purpose.trim() &&
      phoneHref(c.number) && officialUrl(c.sourceUrl) && validDate(c.verifiedOn) && validDate(c.retrievedOn)) : [];
    return { office, contacts, exclusion };
  }
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function link(text, href) {
    const el = node("a", "office-contact__source", text);
    el.href = href; el.target = "_blank"; el.rel = "noopener noreferrer";
    return el;
  }
  async function copyNumber(number) {
    if (!phoneHref(number)) throw new Error("invalid phone");
    if (root.navigator.clipboard?.writeText) {
      await root.navigator.clipboard.writeText(number);
      return;
    }
    const input = node("textarea", "office-contact__copy-buffer");
    input.value = number;
    document.body.appendChild(input);
    try {
      input.select();
      if (!document.execCommand("copy")) throw new Error("copy failed");
    } finally { input.remove(); }
  }
  function render(container, jurisdictionId, officeName, typeId) {
    if (!container) return;
    const resolved = resolve(root.TOUKI_OFFICE_CONTACTS, jurisdictionId, officeName, typeId);
    if (!resolved) return;
    const details = node("details", "office-contact");
    const summary = node("summary", "office-contact__toggle", "☎ 連絡先");
    const panel = node("div", "office-contact__panel");
    details.appendChild(summary); details.appendChild(panel);
    details.addEventListener("keydown", e => {
      if (e.key === "Escape" && details.open) {
        e.preventDefault(); details.open = false; summary.focus();
      }
    });
    if (!resolved.contacts.length) {
      panel.appendChild(node("p", "", resolved.exclusion
        ? "この管轄・登記種別の申請窓口との対応を確認できないため、電話番号を掲載していません。公式案内で申請先をご確認ください。"
        : "この管轄・登記種別の電話番号は未確認です。公式の連絡先案内で担当窓口をご確認ください。"));
      panel.appendChild(link("公式の連絡先・管轄案内（別タブ）",
        officialUrl(resolved.exclusion?.sourceUrl) || DIRECTORY));
    } else {
      panel.appendChild(node("strong", "", resolved.office.name));
      for (const contact of resolved.contacts) {
        const row = node("div", "office-contact__entry");
        row.appendChild(node("p", "office-contact__desk", contact.desk));
        row.appendChild(node("p", "", contact.purpose));
        const number = node("span", "office-contact__number", contact.number);
        row.appendChild(number);
        if (contact.instructions) row.appendChild(node("p", "", contact.instructions));
        const actions = node("div", "office-contact__actions");
        const call = node("a", "office-contact__call", "電話する");
        call.href = phoneHref(contact.number);
        call.setAttribute("aria-label", contact.desk + " " + contact.number + " に電話する");
        actions.appendChild(call);
        const copy = node("button", "office-contact__copy", "番号をコピー");
        copy.type = "button";
        copy.setAttribute("aria-label", contact.desk + " " + contact.number + " をコピー");
        const status = node("p", "office-contact__status");
        status.setAttribute("role", "status");
        copy.addEventListener("click", async () => {
          copy.disabled = true; status.textContent = "";
          try { await copyNumber(contact.number); status.textContent = "番号をコピーしました"; }
          catch { status.textContent = "コピーできませんでした。表示された番号を選択してコピーしてください。"; }
          finally { copy.disabled = false; if (copy.isConnected && details.open) copy.focus(); }
        });
        actions.appendChild(copy); row.appendChild(actions); row.appendChild(status);
        row.appendChild(link("公式出典（別タブ）", officialUrl(contact.sourceUrl)));
        const indexed = contact.evidenceMethod === "official_indexed_body";
        row.appendChild(node("p", "office-contact__verified",
          (indexed ? "公式掲載情報の確認日（検索経由）：" : "公式ページ確認日：") + contact.verifiedOn));
        row.appendChild(node("p", "office-contact__evidence", indexed
          ? "検索インデックスの本文を確認しています。現在の番号・案内は公式ページで確認してください。"
          : "公式ページを直接取得して確認しています。番号・案内は変更される場合があります。"));
        if (contact.sourceUpdatedOn && validDate(contact.sourceUpdatedOn)) {
          row.appendChild(node("p", "office-contact__updated", "出典ページの更新日：" + contact.sourceUpdatedOn));
        }
        panel.appendChild(row);
      }
    }
    panel.appendChild(node("p", "office-contact__scope", "公開情報を確認できた用途の連絡先のみ掲載しています。追加・訂正は画面下の機能リクエストからお知らせください。"));
    container.appendChild(details);
  }
  root.TOUKI_CONTACTS = { resolve, phoneHref, officialUrl, render };
})(window);
