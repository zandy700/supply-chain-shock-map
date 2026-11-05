// Shock propagation graph.
// Force layout, pre-ticked "untangled" first render, zoom-to-fit, arrow markers and drag
// handling are adapted from supat-roong/stock-relation's D3 frontend
// (web/vendor/stock-relation-original.js, renderGraph), MIT License,
// Copyright (c) 2026 Supat Roongpraiwan. See web/vendor/stock-relation-LICENSE.txt.
// Modifications: static local data, supplier->customer shock animation hop by hop,
// direction/magnitude encoding, touch-first zoom controls, keyboard focusable nodes.

import { esc, fmtPct } from "./util.js";

const HOP_MS = 900;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createGraph({ svgEl, graph, events, onInspect, statusEl }) {
  const svg = d3.select(svgEl);
  const known = new Set(graph.nodes.map((n) => n.id));
  const nodes = graph.nodes.map((n) => ({ ...n, outside: false }));
  // Event companies without SEC edges are shown (dashed) so every shock has a home.
  for (const ev of events) {
    for (const p of ev.predictions || []) {
      if (!known.has(p.ticker)) {
        known.add(p.ticker);
        nodes.push({ id: p.ticker, ticker: p.ticker, name: p.ticker, sector: null, outside: true });
      }
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges.map((e, i) => ({ ...e, key: `${e.source}>${e.target}#${i}` }));

  const width = () => svgEl.clientWidth || 800;
  const height = () => svgEl.clientHeight || 600;

  const defs = svg.append("defs");
  for (const [id, color] of [["idle", "#b9b09b"], ["active", "#1b1c1e"]]) {
    defs.append("marker").attr("id", `arrow-${id}`).attr("viewBox", "0 -5 10 10")
      .attr("refX", 10).attr("refY", 0).attr("markerWidth", 7).attr("markerHeight", 7)
      .attr("orient", "auto").append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", color);
  }

  const root = svg.append("g").attr("class", "graph-root");
  const zoom = d3.zoom().scaleExtent([0.3, 4]).on("zoom", (e) => root.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);

  // Pre-position radially (as upstream) to reduce initial chaos, then tick to rest.
  const W = width(), H = height();
  nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / nodes.length;
    const r = Math.min(W, H) * (n.outside ? 0.42 : 0.25);
    n.x = W / 2 + Math.cos(a) * r;
    n.y = H / 2 + Math.sin(a) * r;
  });
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(edges).id((d) => d.id).distance(95).strength(0.7))
    .force("charge", d3.forceManyBody().strength(-380).distanceMax(380))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("x", d3.forceX(W / 2).strength(0.06))
    .force("y", d3.forceY(H / 2).strength(0.08))
    .force("collision", d3.forceCollide(34).strength(0.9))
    .stop();
  for (let i = 0; i < 400; i++) sim.tick();

  const linkG = root.append("g");
  const link = linkG.selectAll("line.link").data(edges).join("line")
    .attr("class", "link").attr("marker-end", "url(#arrow-idle)");
  const linkHit = linkG.selectAll("line.link-hit").data(edges).join("line")
    .attr("class", "link-hit")
    .on("click", (e, d) => onInspect({ type: "edge", edge: d }));
  linkHit.append("title").text((d) => `${d.source.id} supplies ${d.target.id}`);

  const pulseG = root.append("g");
  const node = root.append("g").selectAll("g.node").data(nodes).join("g")
    .attr("class", (d) => `node${d.outside ? " outside" : ""}`)
    .attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", (d) => `${d.ticker}${d.name && d.name !== d.ticker ? ", " + d.name : ""}`)
    .on("click", (e, d) => onInspect({ type: "node", node: d }))
    .on("keydown", (e, d) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onInspect({ type: "node", node: d }); }
    })
    .call(d3.drag()
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.12).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
  node.append("circle").attr("class", "ripple").attr("r", 0).attr("opacity", 0);
  node.append("circle").attr("class", "body").attr("r", 13);
  node.append("text").attr("class", "tick").attr("text-anchor", "middle").attr("dy", 27).text((d) => d.ticker);
  node.append("text").attr("class", "mag").attr("text-anchor", "middle").attr("dy", 40);

  const radius = (m) => 13 + Math.sqrt(Math.abs(m)) * 7;

  function endpoint(d, end) {
    // Stop the line at the circle edge so arrowheads stay visible.
    const s = d.source, t = d.target;
    const dx = t.x - s.x, dy = t.y - s.y, len = Math.hypot(dx, dy) || 1;
    const rs = (s._r || 13) + 2, rt = (t._r || 13) + 4;
    return end === "s"
      ? [s.x + (dx / len) * rs, s.y + (dy / len) * rs]
      : [t.x - (dx / len) * rt, t.y - (dy / len) * rt];
  }
  function draw() {
    for (const sel of [link, linkHit]) {
      sel.attr("x1", (d) => endpoint(d, "s")[0]).attr("y1", (d) => endpoint(d, "s")[1])
        .attr("x2", (d) => endpoint(d, "t")[0]).attr("y2", (d) => endpoint(d, "t")[1]);
    }
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }
  draw();
  sim.on("tick", draw);

  function fitTo(subset, animate = true) {
    const pts = subset && subset.length ? subset : nodes;
    const [x0, x1] = d3.extent(pts, (d) => d.x), [y0, y1] = d3.extent(pts, (d) => d.y);
    const pad = 70, w = width(), h = height();
    const bw = Math.max(x1 - x0, 60) + pad * 2, bh = Math.max(y1 - y0, 60) + pad * 2;
    const k = Math.max(0.3, Math.min(w / bw, h / bh, pts.length < 3 ? 1.3 : 2));
    const t = d3.zoomIdentity.translate(w / 2 - k * (x0 + x1) / 2, h / 2 - k * (y0 + y1) / 2).scale(k);
    (animate && !reducedMotion() ? svg.transition().duration(650) : svg).call(zoom.transform, t);
  }
  fitTo(null, false);

  let runId = 0;
  function reset() {
    runId++;
    svg.selectAll("*").interrupt();
    pulseG.selectAll("*").remove();
    nodes.forEach((n) => { n._r = 13; n._pred = null; });
    node.select("circle.body").attr("r", 13).style("fill", null).style("stroke", null);
    node.select("circle.ripple").attr("r", 0).attr("opacity", 0);
    node.select("text.mag").text("").attr("dy", 40);
    node.select("text.tick").attr("dy", 27);
    node.attr("opacity", 1);
    link.classed("active", false).attr("marker-end", "url(#arrow-idle)").attr("opacity", 1);
    draw();
  }

  function edgeFor(a, b) {
    return edges.find((e) => e.source.id === a && e.target.id === b)
      || edges.find((e) => e.source.id === b && e.target.id === a);
  }

  function play(ev) {
    reset();
    const id = runId;
    const preds = ev.predictions || [];
    const affected = new Set(preds.map((p) => p.ticker));
    const instant = reducedMotion();
    node.attr("opacity", (d) => (affected.has(d.id) ? 1 : 0.35));
    link.attr("opacity", 0.35);
    fitTo(nodes.filter((n) => affected.has(n.id)));

    const maxHop = d3.max(preds, (p) => p.hops) ?? 0;
    const color = (m) => (m < 0 ? "#b23a0e" : "#1b5e84");
    const soft = (m) => (m < 0 ? "#f6dccf" : "#d5e6f0");

    for (const p of preds) {
      const n = byId.get(p.ticker);
      if (!n) continue;
      const delay = instant ? 0 : p.hops * HOP_MS + 200;
      // Edge pulses travel along the path into this node.
      for (let i = 0; i < p.path.length - 1; i++) {
        const e = edgeFor(p.path[i], p.path[i + 1]);
        if (!e) continue;
        const ls = link.filter((d) => d === e);
        const start = instant ? 0 : i * HOP_MS + 200 + HOP_MS * 0.35;
        ls.transition().delay(start).duration(instant ? 0 : 300).attr("opacity", 1)
          .on("start", function () { d3.select(this).classed("active", true).attr("marker-end", "url(#arrow-active)"); });
        if (!instant) {
          const from = byId.get(p.path[i]), to = byId.get(p.path[i + 1]);
          pulseG.append("circle").attr("class", "pulse").attr("r", 5).attr("fill", color(p.magnitude))
            .attr("cx", from.x).attr("cy", from.y).attr("opacity", 0)
            .transition().delay(start).duration(0).attr("opacity", 1)
            .transition().duration(HOP_MS * 0.6).ease(d3.easeCubicInOut).attr("cx", to.x).attr("cy", to.y)
            .transition().duration(150).attr("opacity", 0).remove();
        }
      }
      const g = node.filter((d) => d === n);
      const r = radius(p.magnitude);
      n._pred = p;
      g.select("circle.body").transition().delay(delay).duration(instant ? 0 : 500).ease(d3.easeBackOut)
        .attr("r", r).style("fill", soft(p.magnitude)).style("stroke", color(p.magnitude))
        .on("start", () => { n._r = r; draw(); });
      g.select("text.tick").transition().delay(delay).duration(instant ? 0 : 400).attr("dy", r + 14);
      g.select("text.mag").text(fmtPct(p.magnitude)).attr("opacity", 0).attr("dy", r + 27)
        .attr("fill", color(p.magnitude))
        .transition().delay(delay + (instant ? 0 : 250)).duration(instant ? 0 : 300).attr("opacity", 1);
      if (!instant) {
        g.select("circle.ripple").style("stroke", color(p.magnitude))
          .transition().delay(delay).duration(0).attr("r", r).attr("opacity", 0.8)
          .transition().duration(1100).ease(d3.easeCubicOut).attr("r", r + 30).attr("opacity", 0);
      }
    }

    // Narrate each hop for screen readers and sighted users alike.
    const narrate = (h) => {
      if (id !== runId) return;
      const at = preds.filter((p) => p.hops === h);
      const label = h === 0 ? "Origin" : `Hop ${h}`;
      statusEl.textContent = `${label} of ${maxHop}: ` + at.map((p) => `${p.ticker} ${fmtPct(p.magnitude)}`).join(", ");
    };
    if (instant) narrate(maxHop);
    else for (let h = 0; h <= maxHop; h++) setTimeout(() => narrate(h), h * HOP_MS + 200);
    if (!instant) {
      setTimeout(() => {
        if (id !== runId) return;
        statusEl.textContent = preds.length > 1
          ? `Shock reached ${preds.length} companies across ${maxHop} hop${maxHop === 1 ? "" : "s"}.`
          : "No documented supplier/customer edge from this company: direct effect only.";
      }, maxHop * HOP_MS + 1600);
    }
  }

  return {
    play,
    fit: () => fitTo(null),
    zoomBy: (k) => svg.transition().duration(reducedMotion() ? 0 : 250).call(zoom.scaleBy, k),
    edgesOf: (id) => edges.filter((e) => e.source.id === id || e.target.id === id),
    describeEdge: (e) => `${esc(e.source.id)} &rarr; ${esc(e.target.id)}`,
  };
}
