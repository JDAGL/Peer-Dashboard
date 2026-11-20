// Calculation engine. Mirrors the workbook's company-tab formulas (columns D and AA/AB)
// and the Summary tab, so the site shows the same numbers as Excel for any period.

export const VIEW_TYPES = ["Quarterly", "YTD", "TTM", "Annual"];

// The 13 Summary metrics. better: which direction ranks higher.
export const METRICS = [
  { key: "gpwGrowth", label: "GPW growth (YoY %)", fmt: "pct", better: "high", group: "Growth" },
  { key: "cr", label: "Combined ratio", fmt: "pct", better: "low", group: "Underwriting" },
  { key: "crChg", label: "Combined ratio YoY chg (pts)", fmt: "pts", better: "low", group: "Underwriting" },
  { key: "lr", label: "Loss ratio", fmt: "pct", better: "low", group: "Underwriting" },
  { key: "lrChg", label: "Loss ratio YoY chg (pts)", fmt: "pts", better: "low", group: "Underwriting" },
  { key: "catr", label: "Cat loss ratio", fmt: "pct", better: "low", group: "Underwriting" },
  { key: "pydr", label: "PYD ratio", fmt: "pct", better: "low", group: "Underwriting" },
  { key: "er", label: "Expense ratio", fmt: "pct", better: "low", group: "Underwriting" },
  { key: "erChg", label: "Expense ratio YoY chg (pts)", fmt: "pts", better: "low", group: "Underwriting" },
  { key: "ay", label: "AY combined ratio (ex. PYD)", fmt: "pct", better: "low", group: "Accident year" },
  { key: "ayx", label: "AY combined ratio ex. cat", fmt: "pct", better: "low", group: "Accident year" },
  { key: "oroe", label: "Operating ROE", fmt: "pct", better: "high", group: "Returns" },
  { key: "bvpsGrowth", label: "BVPS growth (YoY %)", fmt: "pct", better: "high", group: "Per share" },
];

const isNum = (v) => typeof v === "number" && !isNaN(v);

// Period numbers (1-based, as in the workbook's "Period #" row) for a view.
export function window(data, view) {
  const firstFY = Math.min(...data.periods.map((p) => p.fy));
  const end = view.type === "Annual" ? (view.fy - firstFY) * 4 + 4 : (view.fy - firstFY) * 4 + view.q;
  const start = Math.max(1, view.type === "YTD" ? (view.fy - firstFY) * 4 + 1 : end - (view.type === "Quarterly" ? 0 : 3));
  return { start, end, inView: end - start + 1 };
}

function companyView(c, view, start, end, current) {
  const at = (arr, n) => (arr && n >= 1 && n <= arr.length && isNum(arr[n - 1]) ? arr[n - 1] : null);
  const ns = []; for (let n = start; n <= end; n++) if (n >= 1) ns.push(n);
  const ytdView = view.type === "YTD" || view.type === "Annual";
  const ytdAt = (key) => (end < 1 ? null : at(c.ytd?.[key], end));
  const qc = (n) => at(c.qc, n) ?? 0;

  const sum = (key) => {
    const y = ytdAt(key); if (ytdView && y !== null) return y;
    const f = ns.filter((n) => at(c.m[key], n) !== null);
    return f.length ? f.reduce((s, n) => s + at(c.m[key], n), 0) : null;
  };
  const weighted = (series) => { // NPE-weighted, simple average if no NPE
    const f = ns.filter((n) => series(n) !== null);
    if (!f.length) return null;
    const d = f.reduce((s, n) => s + (at(c.m.npe, n) ?? 0), 0);
    if (d === 0) return f.reduce((s, n) => s + series(n), 0) / f.length;
    return f.reduce((s, n) => s + series(n) * (at(c.m.npe, n) ?? 0), 0) / d;
  };
  const ratio = (key) => { const y = ytdAt(key); if (ytdView && y !== null) return y; return weighted((n) => at(c.m[key], n)); };
  const ayQ = (n, exCat) => { const cr = at(c.m.cr, n), p = at(c.m.pydr, n); if (cr === null || p === null) return null; return cr - p - (exCat ? at(c.m.catr, n) ?? 0 : 0); };
  const ay = (exCat) => {
    const a = ytdAt("cr"), b = ytdAt("pydr"), k = ytdAt("catr");
    if (ytdView && a !== null && b !== null) return a - b - (exCat ? k ?? 0 : 0);
    return weighted((n) => ayQ(n, exCat));
  };
  const calcRoe = (key) => {
    const f = ns.filter((n) => at(c.m[key], n) !== null);
    const nq = f.reduce((s, n) => s + qc(n), 0);
    const bvs = []; for (let n = start - 1; n <= end; n++) if (at(c.m.bv, n) !== null) bvs.push(at(c.m.bv, n));
    if (nq === 0 || !bvs.length) return null;
    return (f.reduce((s, n) => s + at(c.m[key], n), 0) * (4 / nq)) / (bvs.reduce((s, v) => s + v, 0) / bvs.length);
  };
  const qWithData = ns.reduce((s, n) => s + qc(n), 0);
  const reportedRoe = (key, calcKey) => {
    const y = ytdAt(key); if (ytdView && y !== null) return { v: y, basis: "Reported (YTD)" };
    const f = ns.filter((n) => at(c.m[key], n) !== null);
    if (f.length) return { v: f.reduce((s, n) => s + at(c.m[key], n), 0) / f.length, basis: "Reported" };
    if (!current || qWithData >= end - start + 1) { const v = calcRoe(calcKey); return { v, basis: v === null ? null : "Calculated" }; }
    return { v: null, basis: null };
  };

  const roe = reportedRoe("roe", "ni"), oroe = reportedRoe("oroe", "oi");
  return {
    qWithData,
    gpw: sum("gpw"), npw: sum("npw"), npe: sum("npe"), pyd: sum("pyd"), cat: sum("cat"), ni: sum("ni"), oi: sum("oi"),
    cr: ratio("cr"), lr: ratio("lr"), er: ratio("er"), pydr: ratio("pydr"), catr: ratio("catr"),
    ay: ay(false), ayx: ay(true),
    bvps: at(c.m.bvps, end), tbvps: at(c.m.tbvps, end), bv: at(c.m.bv, end),
    roe: roe.v, roeBasis: roe.basis, oroe: oroe.v, oroeBasis: oroe.basis,
  };
}

const pctChg = (a, b) => (a === null || b === null || b === 0 ? null : (a - b) / Math.abs(b));
const ptsChg = (a, b) => (a === null || b === null ? null : (a - b) * 100);

export function compute(data, view) {
  const { start, end, inView } = window(data, view);
  const rows = data.companies.map((c) => {
    const cur = companyView(c, view, start, end, true);
    const pri = companyView(c, view, start - 4, end - 4, false);
    return {
      ticker: c.ticker, name: c.name, basis: c.basis, qWithData: cur.qWithData, priorQWithData: pri.qWithData, inView,
      gpwGrowth: pctChg(cur.gpw, pri.gpw),
      cr: cur.cr, crChg: ptsChg(cur.cr, pri.cr), lr: cur.lr, lrChg: ptsChg(cur.lr, pri.lr),
      catr: cur.catr, pydr: cur.pydr, er: cur.er, erChg: ptsChg(cur.er, pri.er),
      ay: cur.ay, ayx: cur.ayx, oroe: cur.oroe, oroeBasis: cur.oroeBasis,
      bvpsGrowth: pctChg(cur.bvps, pri.bvps),
      detail: cur, prior: pri,
    };
  });
  return { start, end, inView, rows };
}

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Peer statistics; excludes the user's own company when one is set.
export function stats(rows, selfTicker) {
  const peers = rows.filter((r) => r.ticker !== selfTicker);
  const out = { mean: {}, median: {}, gaap: {}, ifrs: {} };
  for (const m of METRICS) {
    const vals = (rs) => rs.map((r) => r[m.key]).filter(isNum);
    out.mean[m.key] = mean(vals(peers));
    out.median[m.key] = median(vals(peers));
    out.gaap[m.key] = mean(vals(peers.filter((r) => r.basis === "US GAAP")));
    out.ifrs[m.key] = mean(vals(peers.filter((r) => r.basis === "IFRS 17")));
  }
  return out;
}

// Rank of one company on each metric among companies with a value (1 = best).
export function ranks(rows, ticker) {
  const self = rows.find((r) => r.ticker === ticker); const out = {};
  if (!self) return out;
  for (const m of METRICS) {
    const v = self[m.key]; const withVal = rows.filter((r) => isNum(r[m.key]));
    if (!isNum(v)) { out[m.key] = null; continue; }
    const better = withVal.filter((r) => (m.better === "high" ? r[m.key] > v : r[m.key] < v)).length;
    out[m.key] = { rank: better + 1, of: withVal.length };
  }
  return out;
}

// Latest period that has any combined ratio entered, as the default view.
export function latestPeriod(data) {
  let best = 0;
  for (const c of data.companies) (c.m.cr || []).forEach((v, i) => { if (isNum(v) && i + 1 > best) best = i + 1; });
  const p = data.periods[Math.max(0, best - 1)];
  return { fy: p.fy, q: p.q };
}
