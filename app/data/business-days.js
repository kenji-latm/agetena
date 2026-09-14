// 法務局の営業日。公式に収録済みの年だけを計算する。
(function (root) {
  const calendar = root.TOUKI_HOLIDAYS;
  const holidays = new Set(calendar?.dates || []);
  function parseISO(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const d = new Date(iso + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? d : null;
  }
  function isBusinessDay(iso) {
    const d = parseISO(iso);
    if (!d || !holidays.size || d.getUTCFullYear() < calendar.firstYear || d.getUTCFullYear() > calendar.lastYear) return null;
    const monthDay = iso.slice(5);
    return d.getUTCDay() !== 0 && d.getUTCDay() !== 6 &&
      !holidays.has(iso) && !(monthDay >= '12-29' || monthDay <= '01-03');
  }
  function addBusinessDays(iso, days) {
    const d = parseISO(iso);
    if (!d || !Number.isInteger(days) || days < 0 || isBusinessDay(iso) === null) return '';
    let remaining = days;
    while (remaining > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      const open = isBusinessDay(d.toISOString().slice(0, 10));
      if (open === null) return '';
      if (open) remaining--;
    }
    return d.toISOString().slice(0, 10);
  }
  root.TOUKI_BUSINESS_DAYS = { isBusinessDay, addBusinessDays };
})(window);
