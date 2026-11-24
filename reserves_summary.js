// Executive summary for the Reserving Detail page: KPI tiles, long-tail vs short-tail trend,
// TTM trend (peer total vs median), cohort scorecard, and notable moves. Text from the workbook uses textContent.
import { showTip, hideTip, el, text, niceTicks, scale, legend, quantile } from "./charts.js";
import { HALF_YEAR, qLabel, usd, pct, FAV, ADV } from "./reserves.js";
import { compute } from "./engine.js";

const isNum = (v) => typeof v === "number" && !isNaN(v);
const INK = { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7" };
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const COHORTS = [
  { key: "lc", label: "Large commercial", tickers: ["CB", "TRV", "AIG", "HIG", "CNA", "WRB", "MKL", "AFG", "ORI"] },
  { key: "es", label: "US E&S specialty", tickers: ["KNSL", "RLI", "PLMR", "SKWD", "BOW", "ASIC", "JRVR"] },
  { key: "bm", label: "Bermuda & reinsurance", tickers: ["ACGL", "AXS", "EG", "RNR", "SPNT", "HG", "FIHL"] },
  { key: "ld", label: "London", tickers: ["BEZ", "HSX", "LRE", "CRE"] },
];
export const cohortOf = (t) => COHORTS.find((c) => c.tickers.includes(t));

// Line categories grouped by tail.
export const TAIL = {
  "Property": "short", "Specialty (marine, energy, aviation)": "short", "Reinsurance - property": "short",
  "Reinsurance - specialty": "short", "Credit, surety and mortgage": "short",
  "Casualty - general liability": "long", "Casualty - professional lines": "long", "Workers' comp": "long",
  "Auto": "long", "Reinsurance - casualty": "long", "Other or unspecified": "other",
};
const TAIL_STYLE = { long: { label: "Long-tail casualty", color: "#eb6834" }, short: { label: "Short-tail (property, specialty, mortgage)", color: "#2a78d6" }, other: { label: "Not allocated by line", color: "#b4b2a9" } };

const pidx = (p) => p.fy * 4 + p.q;

// TTM for one company ending at period index e: needs every disclosed period in the window.
function ttm(m, t, periods, e) {
  const win = periods.filter((p) => pidx(p) > e - 4 && pidx(p) <= e && (!HALF_YEAR.has(t) || p.q === 2 || p.q === 4));
  const need = HALF_YEAR.has(t) ? 2 : 4;
  if (win.length < need) return null;
  const cells = win.map((p) => m.cell(t, p.fy, p.q));
  if (cells.some((c) => !c || !isNum(c.pydB))) return null;
  const base = cells[0].openUsed;
  if (!isNum(base) || base <= 0) return null;
  const sum = cells.reduce((s, c) => s + c.pydB, 0);
  return { sum, base, pct: sum / base };
}
function peerTTM(m, tickers, periods, e) {
  const rows = tickers.map((t) => ({ t, v: ttm(m, t, periods, e) })).filter((r) => r.v);
  if (!rows.length) return null;
  const sum = rows.reduce((s, r) => s + r.v.sum, 0), base = rows.reduce((s, r) => s + r.v.base, 0);
  return { weighted: sum / base, median: median(rows.map((r) => r.v.pct)), n: rows.length, rows };
}
function tailSums(m, tickers, p) {
  const out = { long: 0, short: 0, other: 0, n: 0 };
  tickers.forEach((t) => {
    const rows = m.dev(t, p.fy, p.q).filter((r) => isNum(r.amt) && r.gn !== "Gross");
    if (rows.length) out.n++;
    rows.forEach((r) => { out[TAIL[r.cat] || "other"] += r.amt; });
  });
  return out;
}
const readable = (q) => { if (!q) return false; const s = String(q), letters = (s.match(/[A-Za-z]/g) || []).length; return s.split(/\s+/).length >= 6 && letters / s.length > 0.6; };

function tile(parent, label, value, sub, valueClass) {
  const d = h("div", "tile"); d.append(h("div", "tile-label", label), h("div", "tile-value" + (valueClass ? " " + valueClass : ""), value));
  if (sub) d.append(h("div", "tile-sub", sub)); parent.append(d);
}

export function renderSummary(container, m, tickers, st, ctx) {
  const periods = m.periods, asOf = periods.find((p) => pidx(p) === st.asOf) || periods[periods.length - 1];
  const e = pidx(asOf), cohortLabel = st.cohort === "all" ? "All peers" : COHORTS.find((c) => c.key === st.cohort).label;
  const card = h("div", "viz-card summary-card");
  card.append(h("h3", null, `Reserving at a glance · ${cohortLabel} · ${qLabel(asOf.fy, asOf.q)}`),
    h("p", "viz-sub", "Balance-basis prior-year development (PYD). Favorable = negative (reserve releases); adverse = positive (strengthening). TTM = trailing twelve months."));

  // ---- tiles ----
  const tiles = h("div", "tiles");
  const cur = peerTTM(m, tickers, periods, e), prev = peerTTM(m, tickers, periods, e - 1);
  const pts = (a, b) => isNum(a) && isNum(b) ? `${((a - b) * 100 >= 0 ? "+" : "−")}${Math.abs((a - b) * 100).toFixed(2)} pts vs prior quarter` : "";
  tile(tiles, "Peer TTM PYD % of reserves", cur ? pct(cur.weighted, 2) : "–", cur ? `total of ${cur.n} companies · ${pts(cur.weighted, prev?.weighted)}` : "not enough data", cur ? (cur.weighted < 0 ? "fav" : "adv") : "");
  tile(tiles, "Median company, TTM", cur ? pct(cur.median, 2) : "–", cur ? pts(cur.median, prev?.median) : "", cur ? (cur.median < 0 ? "fav" : "adv") : "");
  const qCells = tickers.map((t) => ({ t, c: m.cell(t, asOf.fy, asOf.q) })).filter((r) => r.c && isNum(r.c.pydB) && (!HALF_YEAR.has(r.t) || asOf.q % 2 === 0));
  const adv = qCells.filter((r) => r.c.pydB > 0);
  tile(tiles, "Companies with adverse PYD this quarter", `${adv.length} of ${qCells.length}`, adv.length ? adv.map((r) => r.t).join(", ") : "none");
  const ts = tailSums(m, tickers, asOf);
  const sg = (v) => v > 0 ? "+" + usd(v) : usd(v);
  tile(tiles, "This quarter, $m: long-tail / short-tail", `${sg(ts.long)} / ${sg(ts.short)}`, `headline basis · not allocated by line ${sg(ts.other)}`);
  if (ctx.self && tickers.includes(ctx.self) && cur) {
    const mine = ttm(m, ctx.self, periods, e);
    tile(tiles, `${m.names[ctx.self] || ctx.self} TTM vs median`, mine ? pct(mine.pct, 2) : "–", mine ? `${((mine.pct - cur.median) * 100 >= 0 ? "+" : "−")}${Math.abs((mine.pct - cur.median) * 100).toFixed(2)} pts vs peer median` : "not enough data");
  }
  card.append(tiles);
  container.append(card);

  // ---- notable this quarter ----
  const note = h("div", "viz-card");
  note.append(h("h3", null, `What happened in ${qLabel(asOf.fy, asOf.q)}`), h("p", "viz-sub", "Largest moves (|PYD| ≥ 0.5% of opening reserves or ≥ $100m) and reserve transactions, generated from the data. Quotes are verbatim from the cited filing."));
  const items = [];
  qCells.forEach(({ t, c }) => { if ((isNum(c.pct) && Math.abs(c.pct) >= 0.005) || Math.abs(c.pydB) >= 100) items.push({ t, c, score: Math.abs(c.pct || 0) + Math.abs(c.pydB) / 1e5 }); });
  tickers.forEach((t) => { if (items.some((i) => i.t === t)) return; const ev = m.dev(t, asOf.fy, asOf.q).find((r) => r.tag === "Loss portfolio transfer or adverse development cover" || r.tag === "Acquisition"); const c = m.cell(t, asOf.fy, asOf.q); if (ev && c) items.push({ t, c, ev, score: 0 }); });
  items.sort((a, b) => b.score - a.score);
  const ul = h("ul", "notable");
  items.slice(0, 8).forEach((it) => {
    const li = h("li"), dir = it.c.pydB > 0 ? "adverse" : it.c.pydB < 0 ? "favorable" : "nil";
    const head = h("div", "notable-head");
    const dot = h("span", "notable-dot"); dot.style.background = it.c.pydB > 0 ? ADV : FAV;
    head.append(dot, h("strong", null, m.names[it.t] || it.t), h("span", null, ` ${dir} $${usd(Math.abs(it.c.pydB))}m (${pct(Math.abs(it.c.pct), 2)} of opening reserves)${it.ev ? " · " + it.ev.tag.toLowerCase() : ""}`));
    li.append(head);
    const rows = m.dev(it.t, asOf.fy, asOf.q).filter((r) => readable(r.quote));
    const pickRow = it.ev && readable(it.ev.quote) ? it.ev : rows.sort((a, b) => Math.abs(b.amt || 0) - Math.abs(a.amt || 0))[0];
    if (pickRow) { const q = String(pickRow.quote); li.append(h("div", "notable-quote", `“${q.length > 320 ? q.slice(0, 317) + "…" : q}”`), h("div", "notable-src", pickRow.source || "")); }
    li.addEventListener("click", () => ctx.onPick({ t: it.t, fy: asOf.fy, q: asOf.q }));
    ul.append(li);
  });
  if (!items.length) note.append(h("p", "viz-empty", "No moves above the thresholds this quarter."));
  note.append(ul);
  container.append(note);

  // ---- long-tail vs short-tail trend ----
  const tr = h("div", "viz-card");
  tr.append(h("h3", null, "Where development came from, by quarter"), h("p", "viz-sub", `${cohortLabel} · headline-basis components summed by tail ($m). Bars above zero = adverse, below = favorable; the line is the net. Q4 is seasonally heavy; half-year reporters appear in Q2 and Q4.`));
  const series = periods.map((p) => ({ p, ...tailSums(m, tickers, p) }));
  {
    const W = Math.max(tr.clientWidth || 1000, 700) - 40, H = 300, L = 70, R = 20, T = 14, B = 30;
    const vals = []; series.forEach((s) => { let up = 0, dn = 0; ["long", "short", "other"].forEach((k) => { if (s[k] > 0) up += s[k]; else dn += s[k]; }); vals.push(up, dn, s.long + s.short + s.other); });
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 6), y = scale(ticks[0], ticks[ticks.length - 1], H - B, T);
    const bw = Math.min(34, ((W - L - R) / series.length) * 0.62), x = (i) => L + ((W - L - R) / series.length) * (i + 0.5);
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Development by tail" });
    ticks.forEach((t) => { el("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: t === 0 ? INK.axis : INK.grid }, svg); text(svg, L - 8, y(t) + 4, usd(t), { "text-anchor": "end", fill: INK.muted, "font-size": 11 }); });
    series.forEach((s, i) => {
      let up = 0, dn = 0;
      const g = el("g", { class: "viz-hit" }, svg);
      el("rect", { x: x(i) - (W - L - R) / series.length / 2, y: T, width: (W - L - R) / series.length, height: H - B - T, fill: "transparent" }, g);
      ["long", "short", "other"].forEach((k) => {
        const v = s[k]; if (!v) return;
        const y0 = v > 0 ? y(up) : y(dn), y1 = v > 0 ? y(up + v) : y(dn + v);
        if (v > 0) up += v; else dn += v;
        el("rect", { x: x(i) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0) - 1), fill: TAIL_STYLE[k].color, rx: 1 }, g);
      });
      text(g, x(i), H - 10, qLabel(s.p.fy, s.p.q), { "text-anchor": "middle", fill: INK.muted, "font-size": 11 });
      g.addEventListener("pointermove", (ev) => showTip(ev, [
        { value: usd(s.long, 0), label: TAIL_STYLE.long.label, color: TAIL_STYLE.long.color },
        { value: usd(s.short, 0), label: TAIL_STYLE.short.label, color: TAIL_STYLE.short.color },
        { value: usd(s.other, 0), label: TAIL_STYLE.other.label, color: TAIL_STYLE.other.color },
        { value: usd(s.long + s.short + s.other, 0), label: "Net ($m)" }, { value: String(s.n), label: "companies with components" }], qLabel(s.p.fy, s.p.q)));
      g.addEventListener("pointerleave", hideTip);
    });
    let d = ""; series.forEach((s, i) => { d += `${i ? "L" : "M"}${x(i)},${y(s.long + s.short + s.other)}`; });
    el("path", { d, fill: "none", stroke: INK.primary, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
    series.forEach((s, i) => el("circle", { cx: x(i), cy: y(s.long + s.short + s.other), r: 3.5, fill: INK.primary, stroke: "#fff", "stroke-width": 1.5 }, svg));
    tr.append(svg);
    legend(tr, [{ label: TAIL_STYLE.long.label, color: TAIL_STYLE.long.color, kind: "rect" }, { label: TAIL_STYLE.short.label, color: TAIL_STYLE.short.color, kind: "rect" }, { label: TAIL_STYLE.other.label, color: TAIL_STYLE.other.color, kind: "rect" }, { label: "Net", color: INK.primary }]);
  }
  container.append(tr);

  // ---- TTM trend: peer total vs median ----
  const tt = h("div", "viz-card");
  tt.append(h("h3", null, "TTM prior-year development as % of reserves"), h("p", "viz-sub", `${cohortLabel} · total = sum of PYD ÷ sum of opening reserves (dominated by the largest companies); median = the typical company. Only companies with a full twelve months are included.`));
  const pts2 = periods.map((p) => ({ p, v: peerTTM(m, tickers, periods, pidx(p)) })).filter((r) => r.v);
  if (pts2.length >= 2) {
    const W = Math.max(tt.clientWidth || 1000, 700) - 40, H = 240, L = 60, R = 120, T = 14, B = 30;
    const vals = pts2.flatMap((r) => [r.v.weighted, r.v.median]);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 5), y = scale(ticks[0], ticks[ticks.length - 1], H - B, T), x = scale(0, pts2.length - 1, L, W - R);
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "TTM PYD trend" });
    ticks.forEach((t) => { el("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: t === 0 ? INK.axis : INK.grid }, svg); text(svg, L - 8, y(t) + 4, pct(t, 1), { "text-anchor": "end", fill: INK.muted, "font-size": 11 }); });
    pts2.forEach((r, i) => text(svg, x(i), H - 10, qLabel(r.p.fy, r.p.q), { "text-anchor": "middle", fill: INK.muted, "font-size": 11 }));
    [["weighted", "#23215e", "Peer total"], ["median", "#eb6834", "Median company"]].forEach(([k, col, lab]) => {
      el("path", { d: pts2.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r.v[k])}`).join(""), fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
      const lst = pts2[pts2.length - 1]; el("circle", { cx: x(pts2.length - 1), cy: y(lst.v[k]), r: 4, fill: col, stroke: "#fff", "stroke-width": 2 }, svg);
      text(svg, x(pts2.length - 1) + 8, y(lst.v[k]) + 4, lab, { "font-size": 11, fill: INK.secondary, "font-weight": 600 });
    });
    const hit = el("rect", { x: L, y: T, width: W - L - R, height: H - B - T, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (ev) => { const b = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(pts2.length - 1, Math.round((ev.clientX - b.left - L) / ((W - L - R) / Math.max(1, pts2.length - 1))))); const r = pts2[i];
      showTip(ev, [{ value: pct(r.v.weighted, 2), label: "Peer total", color: "#23215e" }, { value: pct(r.v.median, 2), label: "Median company", color: "#eb6834" }, { value: String(r.v.n), label: "companies with full TTM" }], `TTM to ${qLabel(r.p.fy, r.p.q)}`); });
    hit.addEventListener("pointerleave", hideTip);
    tt.append(svg);
    legend(tt, [{ label: "Peer total", color: "#23215e" }, { label: "Median company", color: "#eb6834" }]);
  } else tt.append(h("p", "viz-empty", "Not enough quarters for a TTM trend."));
  container.append(tt);

  // ---- scorecard ----
  const sc = h("div", "viz-card");
  sc.append(h("h3", null, `Company scorecard · TTM to ${qLabel(asOf.fy, asOf.q)}`), h("p", "viz-sub", "Sorted most favorable first within each cohort. Sparkline = PYD % of opening reserves for the last 8 periods (blue favorable, red adverse). ⚑ = adverse in 3+ consecutive quarters (2+ half-years). Click a row for detail."));
  let tdata = null;
  if (ctx.tracker) { const ok = ctx.tracker.periods.some((p) => p.fy === asOf.fy && p.q === asOf.q); if (ok) { try { tdata = Object.fromEntries(compute(ctx.tracker, { type: "TTM", fy: asOf.fy, q: asOf.q }).rows.map((r) => [r.ticker, r])); } catch { tdata = null; } } }
  const sparkMax = 0.03;
  const table = h("table", "scorecard"), hr = h("tr");
  ["Company", "TTM PYD $m", "TTM PYD % of reserves", "TTM PYD, pts of NPE (headline, from tracker)", "Last 8 periods", ""].forEach((x) => hr.append(h("th", null, x)));
  const thead = h("thead"); thead.append(hr); table.append(thead);
  const tb = h("tbody");
  const groups = st.cohort === "all" ? COHORTS : COHORTS.filter((c) => c.key === st.cohort);
  const allVals = tickers.map((t) => ttm(m, t, periods, e)).filter(Boolean).map((v) => Math.abs(v.pct));
  const barMax = Math.max(0.01, quantile(allVals, 0.95) || 0.01);
  groups.forEach((g) => {
    const ts2 = g.tickers.filter((t) => tickers.includes(t));
    if (!ts2.length) return;
    const pr = peerTTM(m, ts2, periods, e);
    const gh = h("tr", "cohort-row"); const gtd = h("td", null, g.label); gtd.colSpan = 6;
    gtd.append(h("span", "cohort-stat", pr ? `  total ${pct(pr.weighted, 2)} · median ${pct(pr.median, 2)} · ${pr.n} of ${ts2.length} with full TTM` : "  not enough data"));
    gh.append(gtd); tb.append(gh);
    const rows = ts2.map((t) => ({ t, v: ttm(m, t, periods, e) })).sort((a, b) => (a.v ? a.v.pct : 9) - (b.v ? b.v.pct : 9));
    rows.forEach(({ t, v }) => {
      const trw = h("tr", t === ctx.self ? "self" : ""); trw.tabIndex = 0;
      const name = h("td"); name.append(h("span", null, m.names[t] || t), h("span", "tk", t));
      const bar = h("td", "bar-cell");
      if (v) {
        const W = 160, mid = 80, w = Math.min(1, Math.abs(v.pct) / barMax) * 78;
        const svg = el("svg", { width: W, height: 16, viewBox: `0 0 ${W} 16` });
        el("line", { x1: mid, x2: mid, y1: 0, y2: 16, stroke: INK.axis }, svg);
        el("rect", { x: v.pct < 0 ? mid - w : mid, y: 3, width: Math.max(1, w), height: 10, rx: 2, fill: v.pct < 0 ? FAV : ADV }, svg);
        const wrap = h("span", "bar-wrap"); wrap.append(svg, h("span", "num", pct(v.pct, 2))); bar.append(wrap);
      } else bar.append(h("span", "muted", "incomplete"));
      const npe = tdata && tdata[t] && isNum(tdata[t].pydr) ? tdata[t].pydr * 100 : null;
      const spark = h("td"); const recent = periods.filter((p) => pidx(p) <= e && (!HALF_YEAR.has(t) || p.q % 2 === 0)).slice(-8);
      const svg2 = el("svg", { width: 104, height: 24, viewBox: "0 0 104 24" });
      el("line", { x1: 0, x2: 104, y1: 12, y2: 12, stroke: INK.grid }, svg2);
      recent.forEach((p, i) => { const c = m.cell(t, p.fy, p.q); if (!c || !isNum(c.pct)) return; const hgt = Math.min(1, Math.abs(c.pct) / sparkMax) * 11; el("rect", { x: i * 13 + 2, y: c.pct < 0 ? 12 : 12 - hgt, width: 9, height: Math.max(1, hgt), rx: 1.5, fill: c.pct < 0 ? FAV : ADV }, svg2); });
      spark.append(svg2);
      let streak = 0; for (let i = recent.length - 1; i >= 0; i--) { const c = m.cell(t, recent[i].fy, recent[i].q); if (c && isNum(c.pydB) && c.pydB > 0) streak++; else break; }
      const flag = h("td", "flag", streak >= (HALF_YEAR.has(t) ? 2 : 3) ? `⚑ ${streak} adverse in a row` : "");
      trw.append(name, h("td", "num", v ? usd(v.sum) : "–"), bar, h("td", "num", isNum(npe) ? (npe < 0 ? `(${Math.abs(npe).toFixed(1)})` : npe.toFixed(1)) : "–"), spark, flag);
      const pk = HALF_YEAR.has(t) && asOf.q % 2 ? (asOf.q === 3 ? { fy: asOf.fy, q: 2 } : { fy: asOf.fy - 1, q: 4 }) : { fy: asOf.fy, q: asOf.q };
      trw.addEventListener("click", () => ctx.onPick({ t, ...pk }));
      tb.append(trw);
    });
  });
  table.append(tb); sc.append(table);
  sc.append(h("p", "viz-note", "Long-tail = general liability, professional lines, workers' comp, auto, casualty reinsurance. Short-tail = property, specialty (marine, energy, aviation), property and specialty reinsurance, credit, surety and mortgage. TTM % uses balance-basis PYD over opening reserves at the start of the twelve months; pts of NPE comes from the tracker (headline basis)."));
  container.append(sc);
}
