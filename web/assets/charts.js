// Accuracy charts drawn with D3 from data/results.json. Original work, MIT.
import { esc, fmtPct } from "./util.js";

export const SERIES = [
  { key: "model", label: "Shock model", color: "#24477a" },
  { key: "zero", label: "Zero baseline", color: "#6f7780" },
  { key: "same_sector", label: "Sector ex-post control", color: "#a8741a" },
];

const tip = () => document.getElementById("chart-tip");
function showTip(ev, html) {
  const t = tip();
  t.innerHTML = html;
  t.style.opacity = 1;
  const x = Math.min(ev.clientX + 12, window.innerWidth - t.offsetWidth - 8);
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${ev.clientY + 12}px`;
}
const hideTip = () => { tip().style.opacity = 0; };

export function metricOf(results, h, series) {
  const hz = results.horizons[h];
  const m = series === "model" ? hz : hz.baselines[series];
  return m;
}

/** Predicted vs actual CAR for one horizon. */
export function scatter(el, results, h, eventsById) {
  const root = d3.select(el);
  root.selectAll("*").remove();
  const pts = results.samples.filter((s) => String(s.horizon) === String(h));
  const W = Math.max(300, el.clientWidth || 900), H = Math.min(380, Math.max(300, W * 0.55)), m = { t: 14, r: 16, b: 44, l: 52 };
  const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", `Scatter of ${pts.length} predicted versus realized cumulative abnormal returns at +${h} trading days.`);
  const ext = d3.extent(pts.flatMap((p) => [p.predicted, p.actual, 0]));
  const lim = Math.ceil(Math.max(Math.abs(ext[0]), Math.abs(ext[1])) + 1);
  const x = d3.scaleLinear().domain([-lim, lim]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([-lim, lim]).range([H - m.b, m.t]);
  svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(6).tickSize(-(W - m.l - m.r)).tickFormat("")).call((g) => g.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(W < 500 ? 5 : 8).tickFormat((v) => `${v}%`));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat((v) => `${v}%`));
  svg.append("line").attr("x1", x(-lim)).attr("y1", y(-lim)).attr("x2", x(lim)).attr("y2", y(lim))
    .attr("stroke", "#24477a").attr("stroke-dasharray", "5 4").attr("opacity", 0.6);
  svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", y(-lim)).attr("y2", y(lim)).attr("stroke", "#a9b1b9");
  svg.append("line").attr("y1", y(0)).attr("y2", y(0)).attr("x1", x(-lim)).attr("x2", x(lim)).attr("stroke", "#a9b1b9");
  svg.append("text").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#4c535c").text("Predicted abnormal return (%, uncalibrated scenario)");
  svg.append("text").attr("transform", "rotate(-90)").attr("x", -(H - m.b + m.t) / 2).attr("y", 13).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#4c535c").text(`Realized CAR, +${h} trading days (%)`);
  const sym = d3.symbol().size(110);
  svg.append("g").selectAll("path").data(pts).join("path")
    .attr("transform", (p) => `translate(${x(p.predicted)},${y(p.actual)})`)
    .attr("d", (p) => sym.type(p.hops > 0 ? d3.symbolDiamond : d3.symbolCircle)())
    .attr("fill", (p) => (Math.sign(p.predicted) === Math.sign(p.actual) ? "#24477a" : "#fff"))
    .attr("stroke", "#24477a").attr("stroke-width", 1.6)
    .on("pointermove", (e, p) => showTip(e,
      `<strong>${esc(p.ticker)}</strong> &middot; ${esc(eventsById.get(p.event_id)?.title || p.event_id)}<br>` +
      `Predicted ${fmtPct(p.predicted)}, realized ${fmtPct(p.actual)}<br>${p.hops > 0 ? `${p.relation === "upstream" ? "Upstream" : "Downstream"} (${p.hops} hop${p.hops > 1 ? "s" : ""})` : "Direct issuer"}`))
    .on("pointerleave", hideTip);
  root.append("div").attr("class", "chart-legend").html(
    `<span><i style="background:#24477a;border-radius:50%"></i>Sign correct</span>` +
    `<span><i style="background:#fff;border:1.5px solid #24477a;border-radius:50%"></i>Sign wrong</span>` +
    `<span>&#9670; supplier or customer (propagated), &#9679; direct issuer</span>` +
    `<span>Dashed diagonal = perfect forecast</span>`);
  const rows = pts.map((p) => `<tr><td>${esc(eventsById.get(p.event_id)?.date || p.event_date)}</td><td>${esc(p.ticker)}</td>` +
    `<td>${esc(p.path.join(" → "))}</td><td class="num">${fmtPct(p.predicted)}</td><td class="num">${fmtPct(p.actual)}</td></tr>`).join("");
  root.append("details").html(`<summary>Data table (+${h} days)</summary><div class="table-wrap"><table>` +
    `<thead><tr><th>Event date</th><th>Ticker</th><th>Path</th><th class="num">Predicted</th><th class="num">Realized CAR</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`);
}

export const GROUPS = [
  { key: "overall", label: "All predictions", short: "All" },
  { key: "direct", label: "Direct issuer", short: "Direct" },
  { key: "downstream", label: "Downstream (lost supply)", short: "Downstream" },
  { key: "upstream", label: "Upstream (lost demand)", short: "Upstream" },
];

/**
 * Forest plot: one row per horizon x relation group, point estimate with 95% CI whisker
 * and a labeled reference line. Rows stack vertically, so it stays readable at 360px.
 */
export function forest(el, evaluation, { value, ci, domain, ref, refLabel, xLabel, xShort = xLabel, fmt, axisFmt, betterSide }) {
  const root = d3.select(el);
  root.selectAll("*").remove();
  const hs = Object.keys(evaluation).sort((a, b) => a - b);
  const rows = hs.flatMap((h) => GROUPS.map((g) => ({ h, g, m: evaluation[h][g.key] })));
  const W = Math.max(300, el.clientWidth || 520);
  const narrow = W < 640, tiny = W < 420;
  const rowH = 26, gapH = 14;
  const m = { t: 30, r: tiny ? 12 : 16, b: 46, l: tiny ? 142 : narrow ? 168 : 250 };
  const H = m.t + m.b + rows.length * rowH + (hs.length - 1) * gapH;
  const yOf = (i) => m.t + i * rowH + Math.floor(i / GROUPS.length) * gapH + rowH / 2;
  const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", `${xLabel} with 95% bootstrap intervals by horizon and relation group. Exact values are in the table below.`);
  const x = d3.scaleLinear().domain(domain(rows)).nice().range([m.l, W - m.r]);
  svg.append("g").attr("class", "gridline").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(narrow ? 4 : 6).tickSize(-(H - m.t - m.b)).tickFormat(""))
    .call((g) => g.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(narrow ? 4 : 6).tickFormat(axisFmt));
  svg.append("text").attr("class", "axis-label").attr("x", (m.l + W - m.r) / 2).attr("y", H - 8)
    .attr("text-anchor", "middle").text(tiny ? xShort : xLabel);
  // Reference line and which side is better.
  svg.append("line").attr("class", "ref-line").attr("x1", x(ref)).attr("x2", x(ref)).attr("y1", m.t - 6).attr("y2", H - m.b);
  svg.append("text").attr("class", "ref-label").attr("x", x(ref)).attr("y", m.t - 12).attr("text-anchor", "middle").text(refLabel);
  if (betterSide && !tiny) {
    const right = betterSide === "right";
    svg.append("text").attr("class", "axis-label").attr("x", right ? W - m.r : m.l).attr("y", m.t - 12)
      .attr("text-anchor", right ? "end" : "start").text(right ? "better →" : "← model better");
  }
  hs.forEach((h, j) => {
    const y0 = yOf(j * GROUPS.length) - rowH / 2;
    svg.append("text").attr("class", "row-head").attr("x", 0).attr("y", y0 + rowH / 2 + 4)
      .text(tiny ? `+${h}d` : `+${h} day${h === "1" ? "" : "s"}`);
    if (j) svg.append("line").attr("class", "row-sep").attr("x1", 0).attr("x2", W - m.r)
      .attr("y1", y0 - gapH / 2).attr("y2", y0 - gapH / 2);
  });
  rows.forEach((r, i) => {
    const y = yOf(i);
    const g = svg.append("g");
    const label = narrow ? r.g.short : r.g.label;
    g.append("text").attr("class", "row-label").attr("x", tiny ? 40 : 62).attr("y", y + 4)
      .text(tiny ? `${label} (${r.m.n})` : `${label} · n=${r.m.n}`);
    const v = value(r.m), c = ci(r.m);
    if (v == null) {
      g.append("text").attr("class", "row-empty").attr("x", m.l + 4).attr("y", y + 4).text("no observations");
      return;
    }
    if (c) {
      g.append("line").attr("class", "ci").attr("x1", x(c[0])).attr("x2", x(c[1])).attr("y1", y).attr("y2", y);
      for (const e of c) g.append("line").attr("class", "ci").attr("x1", x(e)).attr("x2", x(e)).attr("y1", y - 5).attr("y2", y + 5);
    }
    g.append("circle").attr("class", `est${r.g.key === "overall" ? " overall" : ""}`).attr("cx", x(v)).attr("cy", y).attr("r", 5);
    const html = `<strong>${esc(r.g.label)}, +${r.h}d</strong><br>${esc(xLabel)}: ${fmt(v)}` +
      (c ? `<br>95% CI ${fmt(c[0])} to ${fmt(c[1])}` : "") + `<br>n = ${r.m.n} predictions from ${r.m.events} event${r.m.events === 1 ? "" : "s"}`;
    g.append("rect").attr("x", 0).attr("width", W).attr("y", y - rowH / 2).attr("height", rowH).attr("fill", "transparent")
      .on("pointermove", (e) => showTip(e, html)).on("pointerleave", hideTip);
  });
}
