// Accuracy charts drawn with D3 from data/results.json. Original work, MIT.
import { esc, fmtNum, fmtPct, fmtRate } from "./util.js";

export const SERIES = [
  { key: "model", label: "Shock model", color: "#24477a" },
  { key: "zero", label: "Zero baseline", color: "#8c8778" },
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

function legend(container, series) {
  container.append("div").attr("class", "chart-legend").html(
    series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join(""));
}

/** Grouped bars per horizon with CI whiskers. */
export function groupedBars(el, results, { metric, series, format, yLabel, domainMax }) {
  const root = d3.select(el);
  root.selectAll("*").remove();
  const hs = Object.keys(results.horizons).sort((a, b) => a - b);
  const W = Math.max(300, Math.min(el.clientWidth || 520, 640)), H = 300, m = { t: 16, r: 10, b: 36, l: 48 };
  const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", `${yLabel} by horizon for ${series.map((s) => s.label).join(", ")}. Exact values in the metrics table.`);
  const x0 = d3.scaleBand().domain(hs).range([m.l, W - m.r]).padding(0.22);
  const x1 = d3.scaleBand().domain(series.map((s) => s.key)).range([0, x0.bandwidth()]).padding(0.1);
  const ymax = domainMax ?? d3.max(hs.flatMap((h) => series.map((s) => {
    const v = metricOf(results, h, s.key);
    return v.bootstrap_ci?.[metric]?.[1] ?? v[metric];
  })));
  const y = d3.scaleLinear().domain([0, ymax * 1.05]).nice().range([H - m.b, m.t]);
  svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""))
    .call((g) => g.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x0).tickFormat((h) => `+${h} day${h === "1" ? "" : "s"}`));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(format.axis));
  for (const h of hs) {
    const g = svg.append("g").attr("transform", `translate(${x0(h)},0)`);
    for (const s of series) {
      const v = metricOf(results, h, s.key);
      const val = v[metric];
      const ci = v.bootstrap_ci?.[metric];
      const x = x1(s.key), bw = x1.bandwidth();
      const html = `<strong>${esc(s.label)}, +${h}d</strong><br>${esc(yLabel)}: ${format.tip(val)}` +
        (ci ? `<br>95% CI ${format.tip(ci[0])} to ${format.tip(ci[1])}` : "") + `<br>n = ${v.n}`;
      g.append("rect").attr("x", x).attr("width", bw).attr("y", y(val ?? 0))
        .attr("height", Math.max(0.5, y(0) - y(val ?? 0))).attr("fill", s.color).attr("rx", 2)
        .on("pointermove", (e) => showTip(e, html)).on("pointerleave", hideTip);
      if (ci) {
        const cx = x + bw / 2;
        g.append("line").attr("x1", cx).attr("x2", cx).attr("y1", y(ci[0])).attr("y2", y(ci[1]))
          .attr("stroke", "#1b1c1e").attr("stroke-width", 1.2);
        for (const c of ci) g.append("line").attr("x1", cx - 4).attr("x2", cx + 4).attr("y1", y(c)).attr("y2", y(c)).attr("stroke", "#1b1c1e");
      }
      if (bw >= 30) g.append("text").attr("x", x + bw / 2).attr("y", y(val ?? 0) - 4).attr("text-anchor", "middle")
        .attr("font-size", 10).attr("fill", "#55585f").text(format.label(val));
    }
  }
  svg.append("text").attr("transform", "rotate(-90)").attr("x", -(H - m.b + m.t) / 2).attr("y", 12)
    .attr("text-anchor", "middle").attr("font-size", 11).attr("fill", "#55585f").text(yLabel);
  legend(root, series);
}

export const maeFormat = { axis: (v) => v.toFixed(0), tip: (v) => `${fmtNum(v, 2)} pp`, label: (v) => fmtNum(v, 2) };
export const rateFormat = { axis: (v) => `${Math.round(v * 100)}%`, tip: fmtRate, label: fmtRate };

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
  svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", y(-lim)).attr("y2", y(lim)).attr("stroke", "#b9b09b");
  svg.append("line").attr("y1", y(0)).attr("y2", y(0)).attr("x1", x(-lim)).attr("x2", x(lim)).attr("stroke", "#b9b09b");
  svg.append("text").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#55585f").text("Predicted abnormal return");
  svg.append("text").attr("transform", "rotate(-90)").attr("x", -(H - m.b + m.t) / 2).attr("y", 13).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#55585f").text(`Realized CAR, +${h} trading days`);
  const sym = d3.symbol().size(110);
  svg.append("g").selectAll("path").data(pts).join("path")
    .attr("transform", (p) => `translate(${x(p.predicted)},${y(p.actual)})`)
    .attr("d", (p) => sym.type(p.hops > 0 ? d3.symbolDiamond : d3.symbolCircle)())
    .attr("fill", (p) => (Math.sign(p.predicted) === Math.sign(p.actual) ? "#24477a" : "#fff"))
    .attr("stroke", "#24477a").attr("stroke-width", 1.6)
    .on("pointermove", (e, p) => showTip(e,
      `<strong>${esc(p.ticker)}</strong> &middot; ${esc(eventsById.get(p.event_id)?.title || p.event_id)}<br>` +
      `Predicted ${fmtPct(p.predicted)}, realized ${fmtPct(p.actual)}<br>${p.hops > 0 ? `Propagated (${p.hops} hop)` : "Direct issuer"}`))
    .on("pointerleave", hideTip);
  root.append("div").attr("class", "chart-legend").html(
    `<span><i style="background:#24477a;border-radius:50%"></i>Sign correct</span>` +
    `<span><i style="background:#fff;border:1.5px solid #24477a;border-radius:50%"></i>Sign wrong</span>` +
    `<span>&#9670; propagated via supply edge, &#9679; direct issuer</span>` +
    `<span>Dashed diagonal = perfect forecast</span>`);
  const rows = pts.map((p) => `<tr><td>${esc(eventsById.get(p.event_id)?.date || p.event_date)}</td><td>${esc(p.ticker)}</td>` +
    `<td>${esc(p.path.join(" → "))}</td><td class="num">${fmtPct(p.predicted)}</td><td class="num">${fmtPct(p.actual)}</td></tr>`).join("");
  root.append("details").html(`<summary>Data table (+${h} days)</summary><div class="table-wrap"><table>` +
    `<thead><tr><th>Event date</th><th>Ticker</th><th>Path</th><th class="num">Predicted</th><th class="num">Realized CAR</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`);
}
