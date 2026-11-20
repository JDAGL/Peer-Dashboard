// Charts tab: peer ranking (dot plot), trend over time (lines + peer band), two-metric scatter.
// Plain SVG, no chart library. Names from the workbook are inserted with textContent only.
import { METRICS, compute, median } from "./engine.js";

const NS = "http://www.w3.org/2000/svg";
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];   // validated categorical slots 1-4
const INK = { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", band: "rgba(137,135,129,0.16)" };
const SELF = SERIES[1];   // your company: orange; peers: blue

const isNum = (v) => typeof v === "number" && !isNaN(v);
const metric = (k) => METRICS.find((m) => m.key === k);
export const fmt = (v, kind) => {
  if (!isNum(v)) return "–";
  if (kind === "pts") return v < 0 ? `(${(-v).toFixed(1)})` : v.toFixed(1);
  const p = (Math.abs(v) * 100).toFixed(1) + "%";
  return v < 0 ? `(${p})` : p;
};
const axisFmt = (v, kind) => kind === "pts" ? (v < 0 ? `(${-v})` : `${v}`) : `${Math.round(v * 1000) / 10}%`.replace(/^-(.*)$/, "($1)");
const quantile = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function text(parent, x, y, str, attrs = {}) {
  const t = el("text", { x, y, fill: INK.secondary, "font-size": 12, ...attrs }, parent);
  t.textContent = str; return t;
}
function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 0.01; max += 0.01; }
  const span = max - min, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}
const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

// ---------- tooltip ----------
let tipEl;
function tip() {
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "viz-tip"; document.body.appendChild(tipEl); }
  return tipEl;
}
function showTip(evt, rows, title) {
  const t = tip(); t.replaceChildren();
  if (title) { const h = document.createElement("div"); h.className = "viz-tip-title"; h.textContent = title; t.appendChild(h); }
  for (const r of rows) {
    const row = document.createElement("div"); row.className = "viz-tip-row";
    const key = document.createElement("span"); key.className = "viz-tip-key"; key.style.background = r.color || "transparent"; if (r.dash) key.style.background = INK.muted;
    const val = document.createElement("strong"); val.textContent = r.value;
    const lab = document.createElement("span"); lab.className = "viz-tip-label"; lab.textContent = r.label;
    row.append(key, val, lab); t.appendChild(row);
  }
  t.style.display = "block";
  const x = evt.clientX + 14, y = evt.clientY + 14, w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(x, window.innerWidth - w - 8) + window.scrollX + "px";
  t.style.top = Math.min(y, window.innerHeight - h - 8) + window.scrollY + "px";
}
const hideTip = () => { if (tipEl) tipEl.style.display = "none"; };

function legend(container, items) {
  const lg = document.createElement("div"); lg.className = "viz-legend";
  for (const it of items) {
    const s = document.createElement("span"); s.className = "viz-legend-item";
    const k = document.createElement("span"); k.className = "viz-key " + (it.kind || "line"); k.style.background = it.color;
    const l = document.createElement("span"); l.textContent = it.label;
    s.append(k, l); lg.appendChild(s);
  }
  container.appendChild(lg);
}
function tableView(container, headers, rows) {
  const d = document.createElement("details"); d.className = "viz-table";
  const s = document.createElement("summary"); s.textContent = "View as table"; d.appendChild(s);
  const t = document.createElement("table"), th = document.createElement("tr");
  headers.forEach((h) => { const c = document.createElement("th"); c.textContent = h; th.appendChild(c); });
  t.appendChild(th);
  rows.forEach((r) => { const tr = document.createElement("tr"); r.forEach((v) => { const c = document.createElement("td"); c.textContent = v; tr.appendChild(c); }); t.appendChild(tr); });
  d.appendChild(t); container.appendChild(d);
}
function card(container, title, subtitle) {
  const c = document.createElement("div"); c.className = "viz-card";
  const h = document.createElement("h3"); h.textContent = title; c.appendChild(h);
  if (subtitle) { const p = document.createElement("p"); p.className = "viz-sub"; p.textContent = subtitle; c.appendChild(p); }
  container.appendChild(c); return c;
}
const periodLabel = (v) => v.type === "Annual" ? `FY ${v.fy}` : `${v.type} Q${v.q} ${v.fy}`;
const shortLabel = (type, fy, q) => type === "Annual" ? `FY${String(fy).slice(2)}` : `Q${q} ${String(fy).slice(2)}`;

// ---------- 1. ranking dot plot ----------
function barPath(x0, x1, yTop, h) {
  const r = Math.min(4, Math.abs(x1 - x0)), y1 = yTop + h;
  if (x1 >= x0) return `M${x0},${yTop}H${x1 - r}Q${x1},${yTop} ${x1},${yTop + r}V${y1 - r}Q${x1},${y1} ${x1 - r},${y1}H${x0}Z`;
  return `M${x0},${yTop}H${x1 + r}Q${x1},${yTop} ${x1},${yTop + r}V${y1 - r}Q${x1},${y1} ${x1 + r},${y1}H${x0}Z`;
}
const BREAKEVEN = new Set(["cr", "ay", "ayx"]);

function ranking(container, data, view, mKey, self, shape, hidden) {
  const m = metric(mKey), bars = shape === "bars";
  const all = compute(data, view).rows;
  const med = median(all.filter((r) => r.ticker !== self && isNum(r[mKey])).map((r) => r[mKey]));
  const rows = all.filter((r) => !hidden.includes(r.ticker));
  const have = rows.filter((r) => isNum(r[mKey])).sort((a, b) => m.better === "high" ? b[mKey] - a[mKey] : a[mKey] - b[mKey]);
  const missing = rows.filter((r) => !isNum(r[mKey]));
  const c = card(container, `${m.label}: peer ranking`, `${periodLabel(view)} · best at top (${m.better === "high" ? "higher" : "lower"} is better)`);
  if (!have.length) { const p = document.createElement("p"); p.className = "viz-empty"; p.textContent = "No data for this metric and period."; c.appendChild(p); return; }
  const W = Math.max(c.clientWidth - 40, 480), rowH = 26, top = 30, left = 210, right = 70, H = top + have.length * rowH + 30;
  const vals = have.map((r) => r[mKey]); let lo = Math.min(...vals), hi = Math.max(...vals);
  if (bars || (lo > 0 && m.fmt === "pts")) lo = Math.min(lo, 0); if (bars || hi < 0) hi = Math.max(hi, 0);
  if (bars && BREAKEVEN.has(mKey)) hi = Math.max(hi, 1);
  const ticks = niceTicks(lo, hi), x = scale(ticks[0], ticks[ticks.length - 1], left, W - right);
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${m.label} ranking` }, c);
  ticks.forEach((t) => {
    el("line", { x1: x(t), x2: x(t), y1: top - 6, y2: H - 26, stroke: t === 0 ? INK.axis : INK.grid, "stroke-width": 1 }, svg);
    text(svg, x(t), H - 10, axisFmt(t, m.fmt), { "text-anchor": "middle", fill: INK.muted, "font-size": 11 });
  });
  const refs = el("g", {}, svg);   // reference lines drawn after the marks so they stay visible
  have.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2, isSelf = r.ticker === self;
    const g = el("g", { tabindex: 0, class: "viz-hit" }, svg);
    el("rect", { x: 0, y: y - rowH / 2, width: W, height: rowH, fill: "transparent" }, g);
    el("line", { x1: left, x2: W - right, y1: y, y2: y, stroke: INK.grid, "stroke-width": 1, opacity: 0.6 }, g);
    text(g, left - 10, y + 4, `${i + 1}. ${r.name}`, { "text-anchor": "end", fill: isSelf ? INK.primary : INK.secondary, "font-weight": isSelf ? 700 : 400 });
    const col = isSelf ? SELF : SERIES[0];
    if (bars) {
      const v = r[mKey], bh = 16;
      el("path", { d: barPath(x(0), x(v), y - bh / 2, bh), fill: col }, g);
      const lx = v >= 0 ? x(v) + 6 : x(v) - 6;
      text(g, lx, y + 4, fmt(v, m.fmt), { "text-anchor": v >= 0 ? "start" : "end", fill: isSelf ? INK.primary : INK.secondary, "font-weight": isSelf ? 700 : 400, class: "num", "font-size": 11 });
    } else {
      el("circle", { cx: x(r[mKey]), cy: y, r: 5, fill: col, stroke: "#fff", "stroke-width": 2 }, g);
      text(g, W - right + 8, y + 4, fmt(r[mKey], m.fmt), { fill: isSelf ? INK.primary : INK.secondary, "font-weight": isSelf ? 700 : 400, class: "num" });
    }
    const show = (e) => showTip(e, [{ value: fmt(r[mKey], m.fmt), label: m.label, color: isSelf ? SELF : SERIES[0] },
      ...(isNum(med) ? [{ value: fmt(med, m.fmt), label: "Peer median", dash: true }] : []),
      { value: `${i + 1} of ${have.length}`, label: hidden.length ? "Rank among shown" : "Rank" }], `${r.name} (${r.ticker})`);
    g.addEventListener("pointermove", show); g.addEventListener("pointerleave", hideTip);
    g.addEventListener("focus", (e) => { const b = g.getBoundingClientRect(); show({ clientX: b.left + x(r[mKey]), clientY: b.top }); });
    g.addEventListener("blur", hideTip);
  });
  svg.appendChild(refs);
  if (bars && BREAKEVEN.has(mKey) && x(1) <= W - right) {
    el("line", { x1: x(1), x2: x(1), y1: top - 10, y2: H - 26, stroke: INK.primary, "stroke-width": 1, opacity: 0.55 }, refs);
    text(refs, x(1) + 4, top - 14, "100% breakeven", { fill: INK.secondary, "font-size": 11 });
  }
  if (isNum(med)) {
    const nearBE = bars && BREAKEVEN.has(mKey) && Math.abs(x(med) - x(1)) < 110;
    el("line", { x1: x(med), x2: x(med), y1: top - 10, y2: H - 26, stroke: INK.secondary, "stroke-width": 1.5, "stroke-dasharray": "none" }, refs);
    text(refs, x(med) + (nearBE ? -4 : 0), top - 14, `Peer median ${fmt(med, m.fmt)}`, { "text-anchor": nearBE ? "end" : "middle", fill: INK.secondary, "font-size": 11 });
  }
  if (hidden.length) { const p = document.createElement("p"); p.className = "viz-note"; p.textContent = `Showing ${have.length + missing.length} of ${all.length} companies. Peer median uses all peers.`; c.appendChild(p); }
  if (missing.length) { const p = document.createElement("p"); p.className = "viz-note"; p.textContent = `No data: ${missing.map((r) => r.ticker).join(", ")}`; c.appendChild(p); }
  tableView(c, ["Rank", "Company", m.label], have.map((r, i) => [String(i + 1), `${r.name} (${r.ticker})`, fmt(r[mKey], m.fmt)]));
}

// ---------- 2. trend lines ----------
function trendSeries(data, view, mKey, self) {
  const pts = [], type = view.type;
  const endN = (view.fy * 4) + (type === "Annual" ? 4 : view.q);
  const periods = (type === "Annual" ? data.periods.filter((p) => p.q === 4) : data.periods).filter((p) => p.fy * 4 + p.q <= endN);
  for (const p of periods) {
    const res = compute(data, { type, fy: p.fy, q: p.q });
    const by = {}; res.rows.forEach((r) => (by[r.ticker] = r[mKey]));
    const peerVals = res.rows.filter((r) => r.ticker !== self).map((r) => r[mKey]).filter(isNum);
    pts.push({ label: shortLabel(type, p.fy, p.q), fy: p.fy, q: p.q, by, med: median(peerVals), p25: quantile(peerVals, 0.25), p75: quantile(peerVals, 0.75), n: peerVals.length });
  }
  let a = pts.findIndex((p) => p.n > 0), b = pts.length - 1 - [...pts].reverse().findIndex((p) => p.n > 0);
  return a < 0 ? [] : pts.slice(a, b + 1);
}
function trend(container, data, view, mKey, picks, colorOf, self) {
  const m = metric(mKey), type = view.type;
  const c = card(container, `${m.label}: trend`, `${type} view, periods up to ${periodLabel(view)} · peer median with the middle 50% of peers shaded`);
  const pts = trendSeries(data, view, mKey, self);
  if (pts.length < 2) { const p = document.createElement("p"); p.className = "viz-empty"; p.textContent = "Not enough periods with data for this metric."; c.appendChild(p); return; }
  const names = Object.fromEntries(data.companies.map((co) => [co.ticker, co.name]));
  const vals = []; pts.forEach((p) => { [p.p25, p.p75, p.med].forEach((v) => isNum(v) && vals.push(v)); picks.forEach((t) => isNum(p.by[t]) && vals.push(p.by[t])); });
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const W = Math.max(c.clientWidth - 40, 480), H = 320, L = 56, R = 120, T = 16, B = 34;
  const x = scale(0, pts.length - 1, L, W - R), y = scale(ticks[0], ticks[ticks.length - 1], H - B, T);
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${m.label} trend` }, c);
  ticks.forEach((t) => { el("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: t === 0 ? INK.axis : INK.grid }, svg); text(svg, L - 8, y(t) + 4, axisFmt(t, m.fmt), { "text-anchor": "end", fill: INK.muted, "font-size": 11 }); });
  const every = Math.ceil(pts.length / 10);
  pts.forEach((p, i) => { if (i % every === 0 || i === pts.length - 1) text(svg, x(i), H - 12, p.label, { "text-anchor": "middle", fill: INK.muted, "font-size": 11 }); });
  const path = (acc) => { let d = "", pen = false; pts.forEach((p, i) => { const v = acc(p); if (isNum(v)) { d += `${pen ? "L" : "M"}${x(i)},${y(v)}`; pen = true; } else pen = false; }); return d; };
  // band (contiguous runs)
  let run = [];
  const flush = () => { if (run.length > 1) el("path", { d: run.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(pts[i].p75)}`).join("") + [...run].reverse().map((i) => `L${x(i)},${y(pts[i].p25)}`).join("") + "Z", fill: INK.band }, svg); run = []; };
  pts.forEach((p, i) => { if (isNum(p.p25) && isNum(p.p75) && p.n >= 4) run.push(i); else flush(); }); flush();
  el("path", { d: path((p) => p.med), fill: "none", stroke: INK.muted, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  const ends = [];
  picks.forEach((t) => {
    const col = colorOf(t);
    el("path", { d: path((p) => p.by[t]), fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    pts.forEach((p, i) => { if (isNum(p.by[t]) && !isNum(pts[i - 1]?.by[t]) && !isNum(pts[i + 1]?.by[t])) el("circle", { cx: x(i), cy: y(p.by[t]), r: 4, fill: col, stroke: "#fff", "stroke-width": 2 }, svg); });
    let li = pts.length - 1; while (li >= 0 && !isNum(pts[li].by[t])) li--;
    if (li >= 0) { el("circle", { cx: x(li), cy: y(pts[li].by[t]), r: 4, fill: col, stroke: "#fff", "stroke-width": 2 }, svg); ends.push({ t, x: x(li), y: y(pts[li].by[t]) }); }
  });
  ends.sort((a, b) => a.y - b.y);
  const clash = ends.some((e, i) => i && e.y - ends[i - 1].y < 14);
  if (!clash) ends.forEach((e) => text(svg, e.x + 8, e.y + 4, e.t, { fill: INK.secondary, "font-weight": 600 }));
  // crosshair
  const cross = el("line", { y1: T, y2: H - B, stroke: INK.axis, "stroke-width": 1, visibility: "hidden" }, svg);
  const hit = el("rect", { x: L, y: T, width: W - R - L, height: H - B - T, fill: "transparent", tabindex: 0 }, svg);
  const at = (i, e) => {
    const p = pts[i]; cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    showTip(e, [...picks.map((t) => ({ value: fmt(p.by[t], m.fmt), label: names[t] || t, color: colorOf(t) })),
      { value: fmt(p.med, m.fmt), label: "Peer median", dash: true },
      { value: `${fmt(p.p25, m.fmt)} to ${fmt(p.p75, m.fmt)}`, label: "Middle 50%" }], p.label);
  };
  hit.addEventListener("pointermove", (e) => { const b = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - b.left) - L) / ((W - R - L) / (pts.length - 1))))); at(i, e); });
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
  legend(c, [...picks.map((t) => ({ label: names[t] || t, color: colorOf(t) })), { label: "Peer median", color: INK.muted }, { label: "Middle 50% of peers", color: INK.band, kind: "rect" }]);
  tableView(c, ["Period", ...picks, "Peer median", "25th pct", "75th pct"], pts.map((p) => [p.label, ...picks.map((t) => fmt(p.by[t], m.fmt)), fmt(p.med, m.fmt), fmt(p.p25, m.fmt), fmt(p.p75, m.fmt)]));
}

// ---------- 3. scatter ----------
function scatter(container, data, view, xKey, yKey, self, hidden) {
  const mx = metric(xKey), my = metric(yKey);
  const c = card(container, `${my.label} vs ${mx.label}`, `${periodLabel(view)} · lines at the peer medians (all peers)`);
  const allRows = compute(data, view).rows.filter((r) => isNum(r[xKey]) && isNum(r[yKey]));
  const rows = allRows.filter((r) => !hidden.includes(r.ticker));
  if (rows.length < 3) { const p = document.createElement("p"); p.className = "viz-empty"; p.textContent = "Not enough companies with both metrics for this period."; c.appendChild(p); return; }
  const peers = rows.filter((r) => r.ticker !== self), allPeers = allRows.filter((r) => r.ticker !== self);
  const medX = median(allPeers.map((r) => r[xKey])), medY = median(allPeers.map((r) => r[yKey]));
  const xt = niceTicks(Math.min(...rows.map((r) => r[xKey])), Math.max(...rows.map((r) => r[xKey])));
  const yt = niceTicks(Math.min(...rows.map((r) => r[yKey])), Math.max(...rows.map((r) => r[yKey])));
  const W = Math.max(c.clientWidth - 40, 480), H = 400, L = 60, R = 20, T = 20, B = 44;
  const x = scale(xt[0], xt[xt.length - 1], L, W - R), y = scale(yt[0], yt[yt.length - 1], H - B, T);
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${my.label} vs ${mx.label}` }, c);
  xt.forEach((t) => { el("line", { x1: x(t), x2: x(t), y1: T, y2: H - B, stroke: INK.grid }, svg); text(svg, x(t), H - B + 16, axisFmt(t, mx.fmt), { "text-anchor": "middle", fill: INK.muted, "font-size": 11 }); });
  yt.forEach((t) => { el("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: INK.grid }, svg); text(svg, L - 8, y(t) + 4, axisFmt(t, my.fmt), { "text-anchor": "end", fill: INK.muted, "font-size": 11 }); });
  text(svg, (L + W - R) / 2, H - 6, `${mx.label} (${mx.better === "high" ? "higher" : "lower"} is better) →`, { "text-anchor": "middle", fill: INK.secondary });
  const yl = text(svg, 14, (T + H - B) / 2, `${my.label} (${my.better === "high" ? "higher" : "lower"} is better) →`, { "text-anchor": "middle", fill: INK.secondary });
  yl.setAttribute("transform", `rotate(-90 14 ${(T + H - B) / 2})`);
  el("line", { x1: x(medX), x2: x(medX), y1: T, y2: H - B, stroke: INK.secondary, "stroke-width": 1.5 }, svg);
  el("line", { x1: L, x2: W - R, y1: y(medY), y2: y(medY), stroke: INK.secondary, "stroke-width": 1.5 }, svg);
  const bx = mx.better === "high" ? W - R - 6 : L + 6, by = my.better === "high" ? T + 14 : H - B - 8;
  text(svg, bx, by, "Better on both", { "text-anchor": mx.better === "high" ? "end" : "start", fill: INK.muted, "font-size": 11, "font-style": "italic" });
  // labels: your company + the companies farthest from the medians
  const sx = (xt[xt.length - 1] - xt[0]) || 1, sy = (yt[yt.length - 1] - yt[0]) || 1;
  const dist = (r) => Math.hypot((r[xKey] - medX) / sx, (r[yKey] - medY) / sy);
  const labelled = new Set([self, ...[...peers].sort((a, b) => dist(b) - dist(a)).slice(0, 6).map((r) => r.ticker)]);
  const placed = [];
  const order = [...rows].sort((a, b) => (a.ticker === self) - (b.ticker === self));
  order.forEach((r) => { const isSelf = r.ticker === self; el("circle", { cx: x(r[xKey]), cy: y(r[yKey]), r: isSelf ? 6 : 5, fill: isSelf ? SELF : SERIES[0], stroke: "#fff", "stroke-width": 2 }, svg); });
  order.filter((r) => labelled.has(r.ticker)).forEach((r) => {
    const lx = x(r[xKey]) + 8, ly = y(r[yKey]) - 6, w = r.ticker.length * 7.5;
    if (placed.some((p) => lx < p.x + p.w && lx + w > p.x && Math.abs(ly - p.y) < 13) || lx + w > W - R) return;
    placed.push({ x: lx, y: ly, w });
    text(svg, lx, ly, r.ticker, { fill: r.ticker === self ? INK.primary : INK.secondary, "font-weight": r.ticker === self ? 700 : 600, "font-size": 11 });
  });
  const hit = el("rect", { x: L, y: T, width: W - R - L, height: H - B - T, fill: "transparent" }, svg);
  hit.addEventListener("pointermove", (e) => {
    const b = svg.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    let best = null, bd = 24;
    rows.forEach((r) => { const d = Math.hypot(x(r[xKey]) - px, y(r[yKey]) - py); if (d < bd) { bd = d; best = r; } });
    if (!best) return hideTip();
    showTip(e, [{ value: fmt(best[xKey], mx.fmt), label: mx.label, color: best.ticker === self ? SELF : SERIES[0] },
      { value: fmt(best[yKey], my.fmt), label: my.label, color: best.ticker === self ? SELF : SERIES[0] }], `${best.name} (${best.ticker})`);
  });
  hit.addEventListener("pointerleave", hideTip);
  const lg = [{ label: "Peers", color: SERIES[0], kind: "dot" }, { label: "Peer medians", color: INK.secondary }];
  if (self && rows.some((r) => r.ticker === self)) lg.unshift({ label: "My company", color: SELF, kind: "dot" });
  legend(c, lg);
  tableView(c, ["Company", mx.label, my.label], rows.map((r) => [`${r.name} (${r.ticker})`, fmt(r[xKey], mx.fmt), fmt(r[yKey], my.fmt)]));
}

// ---------- entry ----------
export function renderCharts(container, data, view, opts) {
  hideTip(); container.replaceChildren();
  const self = opts.self || "";
  const hidden = opts.hidden || [];
  ranking(container, data, view, opts.metric, self, opts.shape, hidden);
  trend(container, data, view, opts.metric, opts.picks, opts.colorOf, self);
  scatter(container, data, view, opts.metricX, opts.metric, self, hidden);
}
export const SERIES_COLORS = SERIES;
