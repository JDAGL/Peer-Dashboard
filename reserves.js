// Reserving Detail page: development heatmap, company-quarter drill-down,
// peer development by line category, IBNR share. Workbook text is inserted with textContent only.
import { showTip, hideTip, el, text, niceTicks, scale, legend, quantile } from "./charts.js";

const isNum = (v) => typeof v === "number" && !isNaN(v);
const INK = { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7" };
export const FAV = "#2a78d6", ADV = "#e34948";      // diverging poles (blue = favorable, red = adverse)
export const HALF_YEAR = new Set(["BEZ", "CRE", "HSX", "LRE"]);

export const MEASURES = [
  { key: "pct", label: "PYD % of opening net reserves (balance basis)", fmt: "pct" },
  { key: "pydB", label: "PYD $m (balance basis)", fmt: "usd" },
  { key: "pyd", label: "PYD $m (headline basis)", fmt: "usd" },
];
export const qLabel = (fy, q) => `${q}Q${String(fy).slice(2)}`;
export const usd = (v, d = 0) => !isNum(v) ? "–" : (v < 0 ? `(${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })})` : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (v, d = 1) => !isNum(v) ? "–" : (v < 0 ? `(${(Math.abs(v) * 100).toFixed(d)}%)` : `${(v * 100).toFixed(d)}%`);
const fmtM = (v, kind) => kind === "pct" ? pct(v, 2) : usd(v, Math.abs(v) < 10 && isNum(v) && v % 1 ? 1 : 0);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

// ---------- color: OKLab interpolation between gray midpoint and each pole ----------
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
function hexLab(hex) {
  const n = parseInt(hex.slice(1), 16), r = toLin(n >> 16), g = toLin((n >> 8) & 255), b = toLin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labHex([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g = toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b = toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const MID = hexLab("#f0efec"), BLUE = [hexLab("#9ec5f4"), hexLab("#2a78d6"), hexLab("#104281")], RED = [hexLab("#f5b3ab"), hexLab("#e34948"), hexLab("#8f1d1c")];
function ramp(stops, t) { // t in 0..1 from midpoint outward
  const pts = [MID, ...stops], x = Math.min(1, Math.max(0, t)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(x)), f = x - i;
  return labHex(pts[i].map((v, k) => v + (pts[i + 1][k] - v) * f));
}
export const cellColor = (v, max) => !isNum(v) ? null : v === 0 ? "#f0efec" : ramp(v < 0 ? BLUE : RED, Math.abs(v) / max);
export const inkOn = (hex) => { const n = parseInt(hex.slice(1), 16); const L = 0.2126 * toLin(n >> 16) + 0.7152 * toLin((n >> 8) & 255) + 0.0722 * toLin(n & 255); return L < 0.3 ? "#ffffff" : INK.primary; };
function niceMax(v, kind) {
  const steps = kind === "pct" ? [0.0025, 0.005, 0.01, 0.015, 0.02, 0.03, 0.05, 0.08, 0.1] : [10, 25, 50, 100, 150, 200, 300, 500, 1000, 2000];
  return steps.find((s) => s >= v) || steps[steps.length - 1];
}

// ---------- data model ----------
export function buildModel(res, trackerNames = {}) {
  const names = { ...trackerNames, ...(res.names || {}) };
  const periods = [...new Set(res.balances.map((b) => b.fy * 10 + b.q))].sort((a, b) => a - b).map((k) => ({ fy: Math.floor(k / 10), q: k % 10 }));
  const byKey = {}; res.balances.forEach((b) => (byKey[`${b.ticker}|${b.fy}|${b.q}`] = b));
  const prevKey = (t, fy, q) => q > 1 ? `${t}|${fy}|${q - 1}` : `${t}|${fy - 1}|4`;
  const cell = (t, fy, q) => {
    const b = byKey[`${t}|${fy}|${q}`]; if (!b) return null;
    let open = b.open, openSrc = "reported";
    if (!isNum(open)) {
      let pk = prevKey(t, fy, q);
      if (HALF_YEAR.has(t)) pk = q === 2 ? `${t}|${fy - 1}|4` : `${t}|${fy}|2`;
      const p = byKey[pk]; if (p && isNum(p.net)) { open = p.net; openSrc = "prior period net reserves"; }
    }
    return { ...b, openUsed: open, openSrc, pct: isNum(b.pydB) && isNum(open) && open !== 0 ? b.pydB / open : null };
  };
  const tickers = [...new Set(res.balances.map((b) => b.ticker))].sort((a, b) => (names[a] || a).localeCompare(names[b] || b));
  const devBy = {}; res.dev.forEach((d) => { (devBy[`${d.ticker}|${d.fy}|${d.q}`] ||= []).push(d); });
  return { names, periods, tickers, cell, dev: (t, fy, q) => devBy[`${t}|${fy}|${q}`] || [], byKey };
}

// ---------- 1. heatmap ----------
function heatmap(container, m, st, onPick) {
  const meas = MEASURES.find((x) => x.key === st.measure);
  const card = h("div", "viz-card");
  card.append(h("h3", null, "Prior-year reserve development by quarter"),
    h("p", "viz-sub", `${meas.label} · blue = favorable (reserve release), red = adverse (strengthening) · click a cell for detail`));
  const vals = []; m.tickers.forEach((t) => m.periods.forEach((p) => { const c = m.cell(t, p.fy, p.q); if (c && isNum(c[meas.key])) vals.push(Math.abs(c[meas.key])); }));
  const max = niceMax(quantile(vals, 0.9) || 0.01, meas.fmt);
  const rows = m.tickers.map((t) => {
    const cells = m.periods.map((p) => m.cell(t, p.fy, p.q));
    const v = cells.map((c) => c && c[meas.key]).filter(isNum);
    return { t, cells, avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null };
  });
  if (st.sort === "avg") rows.sort((a, b) => (isNum(a.avg) ? a.avg : 9e9) - (isNum(b.avg) ? b.avg : 9e9));

  const wrap = h("div", "heat-wrap"), tbl = h("table", "heat");
  const thead = h("thead"), hr = h("tr");
  hr.append(h("th", "heat-co", "Company"), ...m.periods.map((p) => h("th", null, qLabel(p.fy, p.q))), h("th", "heat-avg", meas.fmt === "pct" ? "Avg" : "Total"));
  thead.append(hr); tbl.append(thead);
  const tb = h("tbody");
  rows.forEach((r) => {
    const tr = h("tr"), name = h("td", "heat-co");
    name.append(h("span", null, m.names[r.t] || r.t), h("span", "tk", r.t));
    tr.append(name);
    r.cells.forEach((c, i) => {
      const p = m.periods[i], v = c ? c[meas.key] : null, td = h("td", "heat-cell");
      const bg = cellColor(v, max);
      if (bg) { td.style.background = bg; td.style.color = inkOn(bg); td.textContent = meas.fmt === "pct" ? pct(v, 1) : usd(v); }
      else { td.classList.add(c ? "nd" : "na"); td.textContent = c ? "–" : ""; }
      if (HALF_YEAR.has(r.t) && c && (p.q === 2 || p.q === 4)) td.classList.add("half");
      if (st.pick && st.pick.t === r.t && st.pick.fy === p.fy && st.pick.q === p.q) td.classList.add("picked");
      td.tabIndex = c ? 0 : -1;
      const tipRows = () => c ? [
        { value: usd(c.pyd, 1), label: "PYD, headline basis ($m)" },
        { value: usd(c.pydB, 1), label: "PYD, balance basis ($m)" },
        { value: usd(c.openUsed), label: `Opening net reserves ($m)${c.openSrc !== "reported" ? " · from prior period" : ""}` },
        { value: pct(c.pct, 2), label: "PYD % of opening reserves" },
        ...(HALF_YEAR.has(r.t) && (p.q === 2 || p.q === 4) ? [{ value: p.q === 2 ? "H1" : "H2", label: "Half-year figure" }] : []),
        { value: "", label: String(c.basis || "") },
      ] : [{ value: "", label: "Not listed / no row for this quarter" }];
      td.addEventListener("pointermove", (e) => showTip(e, tipRows(), `${m.names[r.t] || r.t} · ${qLabel(p.fy, p.q)}`));
      td.addEventListener("pointerleave", hideTip);
      if (c) { td.addEventListener("click", () => onPick({ t: r.t, fy: p.fy, q: p.q })); td.addEventListener("keydown", (e) => { if (e.key === "Enter") onPick({ t: r.t, fy: p.fy, q: p.q }); }); }
      tr.append(td);
    });
    const agg = st.measure === "pct" ? r.avg : (r.cells.map((c) => c && c[meas.key]).filter(isNum).reduce((s, x) => s + x, 0));
    tr.append(h("td", "heat-avg", meas.fmt === "pct" ? pct(agg, 2) : usd(agg)));
    tb.append(tr);
  });
  tbl.append(tb); wrap.append(tbl); card.append(wrap);
  // legend
  const lg = h("div", "heat-legend");
  const bar = h("span", "heat-grad"); const stops = []; for (let i = -10; i <= 10; i++) stops.push(cellColor((i / 10) * max, max) || "#f0efec");
  bar.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  lg.append(h("span", null, `${meas.fmt === "pct" ? pct(-max, 1) : usd(-max)} favorable`), bar, h("span", null, `${meas.fmt === "pct" ? pct(max, 1) : usd(max)}+ adverse`),
    h("span", "heat-key nd", "–"), h("span", null, "not disclosed"), h("span", "heat-key half-key", ""), h("span", null, "half-year figure (H1 in Q2, H2 in Q4)"));
  card.append(lg);
  card.append(h("p", "viz-note", "Balance basis = total-company development on the same scope as reserves (incl. run-off, legacy, A&E and LPT/ADC-covered business); excludes discount accretion, deferred-gain amortization and premium offsets. Where an excluded item is only disclosed annually (e.g. Old Republic, AIG), Q4 carries the full-year adjustment. Opening reserves are reported, or the prior period's net reserves where not reported. IFRS 17 reserves are discounted; US GAAP reserves are not."));
  container.append(card);
}

// ---------- 2. drill-down ----------
function drill(container, m, pick) {
  const card = h("div", "viz-card");
  const c = m.cell(pick.t, pick.fy, pick.q);
  card.append(h("h3", null, `${m.names[pick.t] || pick.t} · ${qLabel(pick.fy, pick.q)}${HALF_YEAR.has(pick.t) && (pick.q === 2 || pick.q === 4) ? (pick.q === 2 ? " (H1)" : " (H2)") : ""}`));
  card.append(h("p", "viz-sub", c ? String(c.basis || "") : "No data for this quarter."));
  if (!c) { container.append(card); return; }
  const tiles = h("div", "tiles");
  const tile = (label, value, sub) => { const d = h("div", "tile"); d.append(h("div", "tile-label", label), h("div", "tile-value", value)); if (sub) d.append(h("div", "tile-sub", sub)); tiles.append(d); };
  tile("PYD, headline basis", usd(c.pyd, 1), "$m");
  tile("PYD, balance basis", usd(c.pydB, 1), "$m");
  tile("Opening net reserves", usd(c.openUsed), c.openSrc === "reported" ? "$m" : "$m · prior period net reserves");
  tile("PYD % of opening reserves", pct(c.pct, 2), "balance basis");
  tile("Net loss reserves", usd(c.net), "$m, quarter-end");
  const ibnr = isNum(c.netIbnr) && isNum(c.net) && c.net ? c.netIbnr / c.net : (isNum(c.grossIbnr) && isNum(c.gross) && c.gross ? c.grossIbnr / c.gross : null);
  tile("IBNR share of reserves", pct(ibnr, 0), isNum(c.netIbnr) ? "net" : isNum(c.grossIbnr) ? "gross" : String(c.caseIbnr || "not disclosed"));
  card.append(tiles);

  const rows = m.dev(pick.t, pick.fy, pick.q);
  const withAmt = rows.filter((r) => isNum(r.amt) && r.gn !== "Gross").sort((a, b) => a.amt - b.amt);
  if (withAmt.length) {
    const W = Math.max(card.clientWidth || 900, 640) - 40, rowH = 24, left = 300, right = 70, top = 8, H = top + withAmt.length * rowH + 26;
    let lo = Math.min(0, ...withAmt.map((r) => r.amt)), hi = Math.max(0, ...withAmt.map((r) => r.amt));
    const ticks = niceTicks(lo, hi, 5), x = scale(ticks[0], ticks[ticks.length - 1], left, W - right);
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Development components" });
    ticks.forEach((t) => { el("line", { x1: x(t), x2: x(t), y1: top, y2: H - 22, stroke: t === 0 ? INK.axis : INK.grid }, svg); text(svg, x(t), H - 6, usd(t), { "text-anchor": "middle", fill: INK.muted, "font-size": 11 }); });
    withAmt.forEach((r, i) => {
      const y = top + i * rowH, v = r.amt, x0 = x(0), x1 = x(v), bh = 14, rr = Math.min(4, Math.abs(x1 - x0));
      const g = el("g", { class: "viz-hit" }, svg);
      el("rect", { x: 0, y, width: W, height: rowH, fill: "transparent" }, g);
      const lab = `${r.seg}`.length > 40 ? `${r.seg}`.slice(0, 39) + "…" : `${r.seg}`;
      text(g, left - 10, y + rowH / 2 + 4, lab, { "text-anchor": "end" });
      const yb = y + (rowH - bh) / 2, y2 = yb + bh;
      const d = v >= 0 ? `M${x0},${yb}H${x1 - rr}Q${x1},${yb} ${x1},${yb + rr}V${y2 - rr}Q${x1},${y2} ${x1 - rr},${y2}H${x0}Z` : `M${x0},${yb}H${x1 + rr}Q${x1},${yb} ${x1},${yb + rr}V${y2 - rr}Q${x1},${y2} ${x1 + rr},${y2}H${x0}Z`;
      el("path", { d, fill: v < 0 ? FAV : ADV }, g);
      text(g, v >= 0 ? x1 + 6 : x1 - 6, y + rowH / 2 + 4, usd(v, 1), { "text-anchor": v >= 0 ? "start" : "end", "font-size": 11, class: "num" });
      g.addEventListener("pointermove", (e) => showTip(e, [{ value: usd(v, 1), label: "$m", color: v < 0 ? FAV : ADV }, { value: "", label: r.cat || "" }, ...(r.ay ? [{ value: "", label: `Accident years: ${r.ay}` }] : []), ...(r.tag && r.tag !== "None" ? [{ value: "", label: r.tag }] : [])], r.seg));
      g.addEventListener("pointerleave", hideTip);
    });
    const box = h("div", "drill-chart"); box.append(svg); card.append(h("p", "viz-sub", "Components of headline-basis development ($m; favorable = negative)"), box);
  }
  // detail table
  const det = h("details", "viz-table"); det.open = true; det.append(h("summary", null, `Components, quotes and sources (${rows.length})`));
  const t = h("table", "drill-table"), hr = h("tr");
  ["Segment or line (as reported)", "Line category", "Accident years", "$m", "Event", "Company's words", "Source"].forEach((x) => hr.append(h("th", null, x)));
  t.append(hr);
  [...rows].sort((a, b) => (isNum(a.amt) ? a.amt : 9e9) - (isNum(b.amt) ? b.amt : 9e9)).forEach((r) => {
    const tr = h("tr");
    tr.append(h("td", null, r.seg || ""), h("td", null, r.cat || ""), h("td", null, r.ay || ""), h("td", "num", isNum(r.amt) ? usd(r.amt, 1) + (r.gn === "Gross" ? " (gross)" : "") : "named, no amount"),
      h("td", null, r.tag && r.tag !== "None" ? r.tag : ""), h("td", "quote", r.quote ? `“${r.quote}”` : ""), h("td", "src", r.source || ""));
    t.append(tr);
  });
  det.append(t); card.append(det);
  const notes = h("details", "viz-table"); notes.append(h("summary", null, "Notes and balance sources"), h("p", "notes", c.notes || ""), h("p", "notes src", c.source || ""));
  card.append(notes);
  container.append(card);
}

// ---------- 3. peer development by line category ----------
function byLine(container, m, fy, q) {
  const card = h("div", "viz-card");
  card.append(h("h3", null, `Where development came from · ${qLabel(fy, q)}, all companies`),
    h("p", "viz-sub", "Headline-basis components summed by line category ($m). Favorable to the left, adverse to the right; counts show how many companies booked each direction."));
  const agg = {};
  m.tickers.forEach((t) => m.dev(t, fy, q).forEach((r) => {
    if (!isNum(r.amt) || r.gn === "Gross" || r.amt === 0) return;
    const a = (agg[r.cat || "Other or unspecified"] ||= { fav: 0, adv: 0, favCos: new Set(), advCos: new Set() });
    if (r.amt < 0) { a.fav += r.amt; a.favCos.add(t); } else { a.adv += r.amt; a.advCos.add(t); }
  }));
  const cats = Object.entries(agg).sort((a, b) => (a[1].fav + a[1].adv) - (b[1].fav + b[1].adv));
  if (!cats.length) { card.append(h("p", "viz-empty", "No components with amounts for this quarter.")); container.append(card); return; }
  const W = Math.max(card.clientWidth || 900, 640) - 40, rowH = 28, left = 260, right = 150, top = 8, H = top + cats.length * rowH + 26;
  const lo = Math.min(0, ...cats.map(([, a]) => a.fav)), hi = Math.max(0, ...cats.map(([, a]) => a.adv));
  const ticks = niceTicks(lo, hi, 6), x = scale(ticks[0], ticks[ticks.length - 1], left, W - right);
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Development by line category" });
  ticks.forEach((t) => { el("line", { x1: x(t), x2: x(t), y1: top, y2: H - 22, stroke: t === 0 ? INK.axis : INK.grid }, svg); text(svg, x(t), H - 6, usd(t), { "text-anchor": "middle", fill: INK.muted, "font-size": 11 }); });
  const bar = (g, v, y, col) => { if (!v) return; const x0 = x(0), x1 = x(v), bh = 16, yb = y + (rowH - bh) / 2, rr = Math.min(4, Math.abs(x1 - x0)), y2 = yb + bh;
    const d = v >= 0 ? `M${x0},${yb}H${x1 - rr}Q${x1},${yb} ${x1},${yb + rr}V${y2 - rr}Q${x1},${y2} ${x1 - rr},${y2}H${x0}Z` : `M${x0},${yb}H${x1 + rr}Q${x1},${yb} ${x1},${yb + rr}V${y2 - rr}Q${x1},${y2} ${x1 + rr},${y2}H${x0}Z`;
    el("path", { d, fill: col }, g); };
  cats.forEach(([cat, a], i) => {
    const y = top + i * rowH, g = el("g", { class: "viz-hit" }, svg);
    el("rect", { x: 0, y, width: W, height: rowH, fill: "transparent" }, g);
    text(g, left - 10, y + rowH / 2 + 4, cat, { "text-anchor": "end" });
    bar(g, a.fav, y, FAV); bar(g, a.adv, y, ADV);
    text(g, W - right + 10, y + rowH / 2 + 4, `${a.favCos.size} fav · ${a.advCos.size} adv`, { "font-size": 11, fill: INK.muted });
    const list = (s) => [...s].join(", ") || "none";
    g.addEventListener("pointermove", (e) => showTip(e, [{ value: usd(a.fav, 1), label: `favorable: ${list(a.favCos)}`, color: FAV }, { value: usd(a.adv, 1), label: `adverse: ${list(a.advCos)}`, color: ADV }, { value: usd(a.fav + a.adv, 1), label: "net" }], cat));
    g.addEventListener("pointerleave", hideTip);
  });
  const box = h("div", "drill-chart"); box.append(svg); card.append(box);
  legend(card, [{ label: "Favorable", color: FAV, kind: "rect" }, { label: "Adverse", color: ADV, kind: "rect" }]);
  card.append(h("p", "viz-note", "Remainder rows (development a company did not allocate) appear under Other or unspecified. Half-year reporters contribute only in Q2 (H1) and Q4 (H2)."));
  container.append(card);
}

// ---------- 4. IBNR share, latest disclosed ----------
function ibnrShare(container, m) {
  const card = h("div", "viz-card");
  card.append(h("h3", null, "IBNR share of loss reserves · latest disclosed"),
    h("p", "viz-sub", "Incurred-but-not-reported reserves as a share of net reserves (gross where only gross is disclosed). Higher usually means a longer-tail or younger book, or more cautious reserving."));
  const rows = [];
  m.tickers.forEach((t) => {
    for (let i = m.periods.length - 1; i >= 0; i--) {
      const p = m.periods[i], c = m.cell(t, p.fy, p.q); if (!c) continue;
      if (isNum(c.netIbnr) && isNum(c.net) && c.net) { rows.push({ t, v: c.netIbnr / c.net, p, basis: "net" }); break; }
      if (isNum(c.grossIbnr) && isNum(c.gross) && c.gross) { rows.push({ t, v: c.grossIbnr / c.gross, p, basis: "gross" }); break; }
    }
  });
  rows.sort((a, b) => b.v - a.v);
  const none = m.tickers.filter((t) => !rows.some((r) => r.t === t));
  if (rows.length) {
    const W = Math.max(card.clientWidth || 900, 640) - 40, rowH = 24, left = 220, right = 150, top = 8, H = top + rows.length * rowH + 26;
    const x = scale(0, 1, left, W - right), svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "IBNR share" });
    [0, 0.25, 0.5, 0.75, 1].forEach((t) => { el("line", { x1: x(t), x2: x(t), y1: top, y2: H - 22, stroke: t === 0 ? INK.axis : INK.grid }, svg); text(svg, x(t), H - 6, `${t * 100}%`, { "text-anchor": "middle", fill: INK.muted, "font-size": 11 }); });
    rows.forEach((r, i) => {
      const y = top + i * rowH, bh = 14, yb = y + (rowH - bh) / 2, x0 = x(0), x1 = x(r.v), rr = Math.min(4, x1 - x0);
      const g = el("g", { class: "viz-hit" }, svg);
      el("rect", { x: 0, y, width: W, height: rowH, fill: "transparent" }, g);
      text(g, left - 10, y + rowH / 2 + 4, m.names[r.t] || r.t, { "text-anchor": "end" });
      el("path", { d: `M${x0},${yb}H${x1 - rr}Q${x1},${yb} ${x1},${yb + rr}V${yb + bh - rr}Q${x1},${yb + bh} ${x1 - rr},${yb + bh}H${x0}Z`, fill: "#6d6c66" }, g);
      text(g, x1 + 6, y + rowH / 2 + 4, pct(r.v, 0), { "font-size": 11, class: "num" });
      text(g, W - right + 40, y + rowH / 2 + 4, `${qLabel(r.p.fy, r.p.q)} · ${r.basis}`, { "font-size": 11, fill: INK.muted });
    });
    const box = h("div", "drill-chart"); box.append(svg); card.append(box);
  }
  if (none.length) card.append(h("p", "viz-note", `Not disclosed: ${none.map((t) => m.names[t] || t).join(", ")}.`));
  container.append(card);
}

export function renderReserves(container, res, st, trackerNames, onState) {
  hideTip(); container.replaceChildren();
  const m = buildModel(res, trackerNames);
  if (st.tickers) m.tickers = m.tickers.filter((t) => st.tickers.includes(t));
  const last = m.periods[m.periods.length - 1];
  if (!st.pick || !m.cell(st.pick.t, st.pick.fy, st.pick.q)) {
    const t0 = m.tickers.find((t) => m.cell(t, last.fy, last.q)) || m.tickers[0];
    st.pick = { t: t0, fy: last.fy, q: last.q };
  }
  const onPick = (p) => { st.pick = p; onState(); };
  heatmap(container, m, st, onPick);
  drill(container, m, st.pick);
  byLine(container, m, st.pick.fy, st.pick.q);
  ibnrShare(container, m);
  return m;
}
