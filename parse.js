// Reads the P&C Peer Financials Tracker workbook (already opened by SheetJS)
// and returns the raw quarterly inputs from every company tab.
// Rows are found by their label in column A, so inserted rows don't break it.

const QUARTERLY_ROWS = {
  "gross premiums written (gpw)": "gpw",
  "net premiums written (npw)": "npw",
  "net premiums earned (npe / nep)": "npe",
  "combined ratio": "cr",
  "loss ratio": "lr",
  "expense ratio": "er",
  "prior-year development ratio": "pydr",
  "catastrophe loss ratio": "catr",
  "prior-year development": "pyd",
  "catastrophe losses": "cat",
  "shareholders' equity (total)": "se",
  "book value (common equity)": "bv",
  "tangible book value": "tbv",
  "total debt": "debt",
  "book value per share (bvps)": "bvps",
  "tangible book value per share (tbvps)": "tbvps",
  "return on equity (reported)": "roe",
  "operating return on equity (reported)": "oroe",
  "net income to common": "ni",
  "operating income": "oi",
};
const YTD_ROWS = {
  "gpw - ytd": "gpw",
  "npw - ytd": "npw",
  "npe / nep - ytd": "npe",
  "combined ratio - ytd": "cr",
  "loss ratio - ytd": "lr",
  "expense ratio - ytd": "er",
  "prior-year development ratio - ytd": "pydr",
  "catastrophe loss ratio - ytd": "catr",
  "prior-year development - ytd": "pyd",
  "catastrophe losses - ytd": "cat",
  "return on equity - ytd (reported)": "roe",
  "operating return on equity - ytd (reported)": "oroe",
  "net income to common - ytd": "ni",
  "operating income - ytd": "oi",
};

const norm = (s) => String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'")
  .replace(/\s+/g, " ").trim().toLowerCase();

export function parseWorkbook(XLSX, wb, fileName = "") {
  const warnings = [];
  const companies = [];
  let periods = null;

  // Company names and basis from the Summary tab, when present.
  const summaryInfo = {};
  if (wb.Sheets["Summary"]) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Summary"], { header: 1, raw: true, defval: null });
    for (const r of rows) if (r[1] && wb.Sheets[r[1]] && r[0]) summaryInfo[r[1]] = { name: String(r[0]).trim(), basis: r[2] ? String(r[2]).trim() : null };
  }

  for (const tab of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, raw: true, defval: null });
    const hdrIdx = rows.findIndex((r) => norm(r?.[0]) === "metric");
    if (hdrIdx < 0) continue;
    const byLabel = {};
    rows.forEach((r, i) => { const k = norm(r?.[0]); if (k && !(k in byLabel)) byLabel[k] = i; });
    if (!("period #" in byLabel)) continue;

    // Period columns: headers like "Q1 2024".
    const cols = [];
    rows[hdrIdx].forEach((h, c) => { if (/^Q[1-4] \d{4}$/.test(String(h ?? "").trim())) cols.push(c); });
    const fyRow = rows[byLabel["fiscal year"]], qRow = rows[byLabel["quarter"]], nRow = rows[byLabel["period #"]];
    const tabPeriods = cols.map((c) => ({ n: Number(nRow[c]), fy: Number(fyRow[c]), q: Number(qRow[c]) }));
    if (!periods) periods = tabPeriods;
    else if (JSON.stringify(periods) !== JSON.stringify(tabPeriods)) warnings.push(`${tab}: period columns differ from other tabs; skipped.`);
    if (periods !== tabPeriods && JSON.stringify(periods) !== JSON.stringify(tabPeriods)) continue;

    const num = (r, c, label) => {
      const v = rows[r]?.[c];
      if (v === null || v === undefined || v === "") return null;
      if (typeof v === "number") return v;
      warnings.push(`${tab}, ${label}, ${rows[hdrIdx][c]}: "${v}" is text, treated as blank.`);
      return null;
    };
    const txt = (r, c) => { const v = rows[r]?.[c]; return v === null || v === undefined || v === "" ? null : String(v); };
    const findStart = (prefix) => Object.keys(byLabel).find((k) => k.startsWith(prefix));

    const qcKey = findStart("quarters covered"), raKey = findStart("period reported as"), srcKey = findStart("source document");
    const m = {}, ytd = {};
    for (const [label, key] of Object.entries(QUARTERLY_ROWS)) {
      if (!(label in byLabel)) { warnings.push(`${tab}: row "${label}" not found.`); continue; }
      m[key] = cols.map((c) => num(byLabel[label], c, label));
    }
    for (const [label, key] of Object.entries(YTD_ROWS)) {
      if (label in byLabel) ytd[key] = cols.map((c) => num(byLabel[label], c, label));
    }
    const title = String(rows[0]?.[0] ?? "");
    const basisMatch = String(rows[1]?.[0] ?? "").match(/Basis:\s*([^·]+)/);
    companies.push({
      ticker: tab,
      name: summaryInfo[tab]?.name || title.split(" (")[0].trim() || tab,
      basis: summaryInfo[tab]?.basis || (basisMatch ? basisMatch[1].trim() : ""),
      qc: qcKey ? cols.map((c) => num(byLabel[qcKey], c, "quarters covered")) : cols.map(() => null),
      reportedAs: raKey ? cols.map((c) => txt(byLabel[raKey], c)) : [],
      source: srcKey ? cols.map((c) => txt(byLabel[srcKey], c)) : [],
      m, ytd,
    });
  }
  if (!companies.length) throw new Error("No company tabs found. Each company tab needs a 'Metric' header row and a 'Period #' row.");
  return { fileName, parsedAt: new Date().toISOString(), periods, companies, warnings };
}

// ---------- Reserve workbook (P&C Peer Reserve Development Components) ----------
const BAL_COLS = {
  "ticker": "ticker", "fiscal year": "fy", "quarter": "q", "basis": "basis",
  "gross loss reserves": "gross", "reinsurance recoverable on unpaid losses": "recov", "net loss reserves": "net",
  "net case reserves": "netCase", "net ibnr": "netIbnr", "gross case reserves": "grossCase", "gross ibnr": "grossIbnr",
  "opening net loss reserves": "open", "net paid losses (quarter)": "paid",
  "net prior-year development (quarter)": "pyd", "net prior-year development (balance basis)": "pydB",
  "reserves discounted (y/n)": "disc", "case/ibnr disclosed (quarterly / annual only / not disclosed)": "caseIbnr",
  "source document and page": "source", "notes": "notes",
};
const DEV_COLS = {
  "ticker": "ticker", "fiscal year": "fy", "quarter": "q", "segment or line (as reported)": "seg", "line category": "cat",
  "accident years (as reported)": "ay", "amount": "amt", "gross or net": "gn", "event tag": "tag",
  "verbatim quote": "quote", "source document and page": "source",
};
const BAL_NUM = new Set(["fy", "q", "gross", "recov", "net", "netCase", "netIbnr", "grossCase", "grossIbnr", "open", "paid", "pyd", "pydB"]);
export const isReserveWorkbook = (wb) => wb.SheetNames.includes("Reserve Balances") && wb.SheetNames.includes("Reserve Development");

function readTable(XLSX, ws, colMap, numKeys, sheet, warnings) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hdr = (rows[0] || []).map((h) => norm(h));
  const pos = {};
  for (const [label, key] of Object.entries(colMap)) {
    const i = hdr.indexOf(label);
    if (i < 0) warnings.push(`${sheet}: column "${label}" not found.`); else pos[key] = i;
  }
  const out = [];
  rows.slice(1).forEach((r, n) => {
    if (!r || r[pos.ticker] === null || r[pos.ticker] === undefined || r[pos.ticker] === "") return;
    const o = {};
    for (const [key, i] of Object.entries(pos)) {
      let v = r[i];
      if (v === "" || v === undefined) v = null;
      if (numKeys.has(key) && v !== null && typeof v !== "number") {
        const p = Number(String(v).replace(/,/g, ""));
        if (!isNaN(p) && String(v).trim() !== "") v = p;
        else { warnings.push(`${sheet} row ${n + 2}, ${key}: "${v}" is text, treated as blank.`); v = null; }
      }
      o[key] = typeof v === "string" ? v.trim() : v;
    }
    o.ticker = String(o.ticker);
    out.push(o);
  });
  return out;
}

export function parseReserveWorkbook(XLSX, wb, fileName = "") {
  const warnings = [];
  const balances = readTable(XLSX, wb.Sheets["Reserve Balances"], BAL_COLS, BAL_NUM, "Reserve Balances", warnings);
  const dev = readTable(XLSX, wb.Sheets["Reserve Development"], DEV_COLS, new Set(["fy", "q", "amt"]), "Reserve Development", warnings);
  const names = {};
  if (wb.Sheets["Overview"]) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Overview"], { header: 1, raw: true, defval: null });
    for (const r of rows) if (r && r[0] && r[1] && /^[A-Z.]{1,6}$/.test(String(r[1]).trim())) names[String(r[1]).trim()] = String(r[0]).trim();
  }
  if (!balances.length) throw new Error("The Reserve Balances tab has no rows.");
  const keys = new Set(); balances.forEach((b) => { const k = `${b.ticker}|${b.fy}|${b.q}`; if (keys.has(k)) warnings.push(`Reserve Balances: duplicate row for ${b.ticker} ${b.fy} Q${b.q}.`); keys.add(k); });
  return { kind: "reserves", fileName, parsedAt: new Date().toISOString(), balances, dev, names, warnings };
}
