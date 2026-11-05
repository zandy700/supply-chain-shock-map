export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const minus = (s) => s.replace("-", "−");
export const fmtPct = (v, d = 2) => (v == null ? "n/a" : minus(`${v > 0 ? "+" : ""}${(+v).toFixed(d)}%`));
export const fmtNum = (v, d = 3) => (v == null ? "n/a" : minus((+v).toFixed(d)));
export const fmtRate = (v) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
export const fmtCI = (ci, f) => (ci ? `[${f(ci[0])}, ${f(ci[1])}]` : "");
export const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "");
export const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);

export async function loadJSON(name) {
  const res = await fetch(`data/${name}.json`);
  if (!res.ok) throw new Error(`data/${name}.json: HTTP ${res.status}`);
  return res.json();
}
