// Supply Chain Shock Map: static front end. Reads only ./data/*.json. Original work, MIT.
import { createGraph } from "./graph.js";
import { verifyChain } from "./ledger.js";
import { GROUPS, SERIES, forest, metricOf, scatter } from "./charts.js";
import { esc, fmtCI, fmtNum, fmtPct, fmtRate, loadJSON, safeUrl, shortHash } from "./util.js";

const $ = (id) => document.getElementById(id);
const state = { data: null, graph: null, eventId: null, pendingEvent: null };
const VIEWS = ["graph", "events", "ledger", "accuracy", "about"];

const link = (url, text) => {
  const u = safeUrl(url);
  return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
};
const dirBadge = (m) => (m < 0 ? '<span class="badge neg">negative</span>' : m > 0 ? '<span class="badge pos">positive</span>' : '<span class="badge">flat</span>');

async function main() {
  try {
    const [graph, events, predictions, scores, results, meta] = await Promise.all(
      ["graph", "events", "predictions", "scores", "results", "meta"].map(loadJSON));
    events.sort((a, b) => b.date.localeCompare(a.date));
    state.data = { graph, events, predictions, scores, results, meta,
      eventsById: new Map(events.map((e) => [e.id, e])) };
  } catch (err) {
    const box = $("load-error");
    box.hidden = false;
    box.textContent = `Could not load data (${err.message}). Serve this folder over HTTP, e.g. python -m http.server --directory web.`;
    return;
  }
  // Open on the event whose shock travels furthest along documented edges (most recent on ties).
  const events = state.data.events;
  const reach = (e) => (e.predictions || []).filter((p) => p.hops > 0).length;
  const best = events.reduce((a, e) => (reach(e) > reach(a) ? e : a), events[0]);
  state.eventId = best?.id;
  setupGraphControls();
  renderFeed();
  renderAbout();
  window.addEventListener("hashchange", route);
  route();
  runLedger(); // verify eagerly so the status is ready when the tab opens
}

/* Routing */
function route() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "graph";
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll(".tabs a").forEach((a) => {
    if (a.dataset.view === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (name === "accuracy" && !state.accuracyDrawn) {
    state.accuracyDrawn = true;
    renderAccuracy();
    let t;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => { if (!$("view-accuracy").hidden) drawAccuracyCharts(); }, 200);
    });
  }
  if (name === "graph") {
    if (state.pendingEvent && !state.graph) state.eventId = state.pendingEvent;
    else if (state.pendingEvent) selectEventLater(state.pendingEvent);
    state.pendingEvent = null;
    ensureGraph();
  }
}
const selectEventLater = (id) => requestAnimationFrame(() => selectEvent(id));

/* Graph view */
function setupGraphControls() {
  const sel = $("event-select");
  sel.innerHTML = state.data.events.map((e) =>
    `<option value="${esc(e.id)}">${esc(e.date)} · ${esc(e.title)}</option>`).join("");
  sel.addEventListener("change", () => selectEvent(sel.value));
  $("replay-btn").addEventListener("click", () => selectEvent(state.eventId));
  $("zoom-in").addEventListener("click", () => state.graph?.zoomBy(1.4));
  $("zoom-out").addEventListener("click", () => state.graph?.zoomBy(1 / 1.4));
  $("zoom-fit").addEventListener("click", () => state.graph?.fit());
}

function ensureGraph() {
  if (state.graph) return;
  const { graph, events } = state.data;
  state.graph = createGraph({ svgEl: $("graph-svg"), graph, events, onInspect: inspect, statusEl: $("hop-status") });
  if (state.eventId) selectEvent(state.eventId);
}

function selectEvent(id) {
  const ev = state.data.eventsById.get(id);
  if (!ev) return;
  state.eventId = id;
  $("event-select").value = id;
  renderEventDetail(ev);
  $("inspector").innerHTML = "";
  state.graph?.play(ev);
}

function renderEventDetail(ev) {
  const preds = [...(ev.predictions || [])].sort((a, b) => a.hops - b.hops);
  $("event-detail").innerHTML = `
    <h3>${esc(ev.title)}</h3>
    <div class="meta-line"><span class="badge">${esc(ev.event_type)}</span>
      <span class="badge">${esc(ev.date)}</span><span class="badge">severity ${esc(ev.severity)}</span></div>
    <p class="small muted">${esc(ev.source_note || "")} ${link(ev.url, "Source")}</p>
    <p class="small"><strong>Predicted abnormal returns</strong> (uncalibrated scenario):</p>
    <ul class="pred-list">${preds.map((p) => `
      <li><span class="tick">${esc(p.ticker)}</span>
        <span class="path">${pathText(p)}</span>
        <span class="mag ${p.magnitude < 0 ? "neg-text" : "pos-text"}">${fmtPct(p.magnitude)}</span></li>`).join("")}
    </ul>`;
}

const RELATION = { downstream: "lost supply", upstream: "lost demand", competitor: "substitution" };
function pathText(p) {
  if (p.hops === 0) return "origin";
  const why = RELATION[p.relation] || "supply link";
  return `${esc(p.path.join(" → "))} <span class="nowrap">(${why}, ${p.hops} hop${p.hops > 1 ? "s" : ""})</span>`;
}

function inspect(item) {
  const box = $("inspector");
  if (item.type === "edge") {
    const e = item.edge;
    box.innerHTML = `<h3>${esc(e.source.id)} supplies ${esc(e.target.id)}</h3>
      <blockquote>${esc(e.evidence)}</blockquote>
      <p class="small">${link(e.source_url, "SEC filing")} filed ${esc(e.filed_date)}, accession <span class="mono">${esc(e.accession_number)}</span></p>
      <p class="small muted">Edge weight ${esc(e.weight)}: ${esc(e.weight_basis || "")}. Extraction confidence ${esc(e.extraction_confidence)} is an upstream constant, not a probability.</p>`;
    return;
  }
  const n = item.node;
  const ev = state.data.eventsById.get(state.eventId);
  const pred = ev?.predictions?.find((p) => p.ticker === n.id);
  const edges = state.graph.edgesOf(n.id);
  box.innerHTML = `<h3>${esc(n.ticker)}${n.name && n.name !== n.ticker ? ` <span class="muted small">${esc(n.name)}</span>` : ""}</h3>
    ${n.sector ? `<p class="small muted">${esc(n.sector)}</p>` : ""}
    ${pred ? `<p>${dirBadge(pred.magnitude)} ${fmtPct(pred.magnitude)} in this scenario via ${pathText(pred)}</p>` : '<p class="small muted">Not affected by the selected event.</p>'}
    ${n.outside ? '<p class="small muted">No reviewed SEC supply edge for this company in the shipped graph, so only its direct effect is modeled.</p>' : ""}
    ${edges.length ? `<p class="small"><strong>Documented relationships</strong></p><ul class="small">${edges.map((e) =>
      `<li>${esc(e.source.id)} &rarr; ${esc(e.target.id)}: ${link(e.source_url, `filed ${esc(e.filed_date)}`)}</li>`).join("")}</ul>` : ""}`;
}

/* Event feed */
function renderFeed() {
  const { events } = state.data;
  const sources = d3.rollup(events, (v) => v.length, (e) => e.source);
  $("events-lede").textContent = `${events.length} cached events (${[...sources].map(([s, n]) => `${n} ${s.replace(/_/g, " ")}`).join(", ")}). ` +
    "Each is matched to S&P 500 tickers and classified; severities are heuristic, not measured.";
  $("feed").innerHTML = events.map((e) => `
    <li class="card">
      <time datetime="${esc(e.date)}">${esc(e.date)}</time>
      <h3>${esc(e.title)}</h3>
      <div class="meta-line"><span class="badge">${esc(e.event_type)}</span>
        ${e.tickers.map((t) => `<span class="badge ${e.sign < 0 ? "neg" : "pos"}">${esc(t)}</span>`).join("")}
        <span class="badge">severity ${esc(e.severity)}</span></div>
      <p class="note">${esc(e.source_note || "")}</p>
      <p class="small muted">${(e.predictions || []).length} predicted ticker${(e.predictions || []).length === 1 ? "" : "s"}${
        (e.predictions || []).some((p) => p.hops > 0) ? ", including supply-chain propagation" : ", direct effect only"}.</p>
      <div class="actions"><button type="button" class="btn" data-show="${esc(e.id)}">Show ripple on graph</button>
        ${link(e.url, "Primary source")}</div>
    </li>`).join("");
  $("feed").addEventListener("click", (ev) => {
    const id = ev.target.closest("[data-show]")?.dataset.show;
    if (!id) return;
    state.pendingEvent = id;
    location.hash = "graph";
    $("event-select").focus();
  });
}

/* Ledger */
async function runLedger(records = state.data.predictions) {
  const status = $("ledger-status");
  const res = await verifyChain(records);
  const exported = state.data.meta.ledger?.head;
  if (res.unsupported) {
    status.innerHTML = `<span class="badge bad">not checked</span> ${esc(res.error)}`;
  } else if (res.valid) {
    const match = exported === res.head;
    status.innerHTML = `<span class="badge ok">valid</span> ${res.count} entries, head <span class="hash">${shortHash(res.head)}</span> ` +
      (match ? "matches the exported Python verifier head." : '<span class="badge bad">differs from exported head</span>');
  } else {
    status.innerHTML = `<span class="badge bad">broken</span> chain fails at entry ${res.firstBad + 1}.`;
  }
  renderLedgerRows(records, res);
  return res;
}

function renderLedgerRows(records, res) {
  const cell = (r, i) => {
    const row = res.rows[i];
    if (!row) return { ok: false, label: "not checked" };
    if (row.ok) return { ok: true, label: "✓ hash and link match" };
    return { ok: false, label: !row.hashOk ? "✗ hash mismatch" : !row.linkOk ? "✗ prev_hash mismatch" : "✗ after a break" };
  };
  $("ledger-rows").innerHTML = records.map((r, i) => {
    const c = cell(r, i);
    return `<tr><td>${i + 1}</td><td class="mono">${esc(r.timestamp_utc)}</td>
      <td>${esc(r.event?.title)}<br><span class="small muted">${esc(r.event?.date)} · ${(r.predictions || []).map((p) => `${esc(p.ticker)} ${fmtPct(p.magnitude)}`).join(", ")}</span></td>
      <td><span class="badge">${esc((r.mode || "").replace(/_/g, " "))}</span></td>
      <td class="hash" title="${esc(r.prev_hash)}">${shortHash(r.prev_hash)}</td>
      <td class="hash" title="${esc(r.hash)}">${shortHash(r.hash)}</td>
      <td><span class="badge ${c.ok ? "ok" : "bad"}">${c.label}</span></td></tr>`;
  }).join("");
  $("ledger-cards").innerHTML = records.map((r, i) => {
    const c = cell(r, i);
    return `<li class="card"><div class="meta-line"><strong>#${i + 1}</strong>
        <span class="badge">${esc((r.mode || "").replace(/_/g, " "))}</span><span class="badge ${c.ok ? "ok" : "bad"}">${c.label}</span></div>
      <p style="margin:0 0 .3rem">${esc(r.event?.title)}</p>
      <p class="small muted" style="margin:0 0 .3rem">Issued ${esc(r.timestamp_utc)}</p>
      <p class="hash" style="margin:0">hash ${esc(r.hash)}</p></li>`;
  }).join("");
}

function setupLedgerButtons() {
  $("reverify-btn").addEventListener("click", () => { $("tamper-result").textContent = ""; runLedger(); });
  $("tamper-btn").addEventListener("click", async () => {
    const copy = structuredClone(state.data.predictions);
    if (copy.length < 2) return;
    const target = copy[1];
    const p = target.predictions[0];
    const before = p.magnitude;
    p.magnitude = Math.round((before + 0.5) * 100) / 100;
    const res = await runLedger(copy);
    $("tamper-result").textContent = `Demo on an in-memory copy: entry 2's ${p.ticker} prediction was changed from ${fmtPct(before)} to ${fmtPct(p.magnitude)}. ` +
      `${res.valid ? "Unexpectedly still valid." : `Verification now fails at entry ${res.firstBad + 1}.`} Press Re-verify to check the real file again.`;
  });
}

/* Accuracy */
function renderAccuracy() {
  const { results, scores, predictions, eventsById } = state.data;
  const hs = Object.keys(results.horizons).sort((a, b) => a - b);
  const any = results.horizons[hs[0]];
  const propagated = any?.propagated_n ?? 0;
  $("accuracy-lede").textContent = `Historical replay on ${results.historical_events_n} real, curated events ` +
    `(${any.n} ticker predictions per horizon: ${any.direct_n} direct, ${propagated} propagated). ` +
    `Market-model CAR vs ${results.methodology.market}, estimation window ${results.methodology.estimation_window.join("..")} trading days. ` +
    `This is a small, selected sample: treat every number as descriptive, not as evidence of skill.`;

  const ev = results.evaluation || {};
  const pp = (v) => `${v > 0 ? "+" : ""}${fmtNum(v, 2)} pp`;
  const pval = (p) => (p == null ? "n/a" : p < 0.001 ? "<0.001" : fmtNum(p, 3));
  const verdict = (m) => {
    if (!m?.n) return "no observations";
    const [lo, hi] = m.mae_diff_ci95;
    const err = hi < 0 ? "beat zero on error" : lo > 0 ? "was <strong>worse than predicting zero</strong>" : "was indistinguishable from zero on error";
    return `hit ${fmtRate(m.hit_rate)} of ${m.n} (p = ${pval(m.binomial_p_two_sided)}) and ${err} (${pp(m.mae_diff)}, CI ${pp(lo)} to ${pp(hi)})`;
  };
  const prop = hs.map((h) => ev[h]?.propagated?.n ?? 0);
  $("finding").innerHTML = `<strong>Honest read.</strong> ` +
    hs.map((h) => `At +${h} day${h === "1" ? "" : "s"} the model ${verdict(ev[h]?.overall)}.`).join(" ") +
    ` Propagated (supplier/customer) predictions: ${prop.join(" / ")} per horizon. ` +
    "Small, hand-selected sample with correlated predictions within an event; treat as descriptive, not proof of skill.";

  const statRows = hs.flatMap((h) => GROUPS.map((g, i) => {
    const m = ev[h]?.[g.key] || { n: 0 };
    const cells = m.n
      ? `<td class="num">${m.n}</td><td class="num">${m.events}</td><td class="num">${fmtRate(m.hit_rate)}</td><td class="num">${fmtCI(m.hit_rate_ci95, fmtRate)}</td>` +
        `<td class="num">${pval(m.binomial_p_two_sided)}</td><td class="num">${fmtNum(m.mae_model, 2)}</td><td class="num">${fmtNum(m.mae_zero, 2)}</td>` +
        `<td class="num">${pp(m.mae_diff)}</td><td class="num">${fmtCI(m.mae_diff_ci95, (v) => fmtNum(v, 2))}</td>`
      : `<td class="num">0</td><td colspan="8" class="muted">no observations</td>`;
    return `<tr${i === 0 ? ' class="first"' : ""}><td>${i === 0 ? `<strong>+${h}d</strong>` : ""}</td><td>${esc(g.label)}</td>${cells}</tr>`;
  })).join("");
  $("stats-table").innerHTML = `<caption class="sr-only">Hit rate, binomial test and MAE versus zero by horizon and relation group</caption>` +
    `<thead><tr><th>Horizon</th><th>Group</th><th class="num">n</th><th class="num">Events</th><th class="num">Hit rate</th><th class="num">95% CI</th>` +
    `<th class="num">p vs 50%</th><th class="num">MAE model (pp)</th><th class="num">MAE zero (pp)</th><th class="num">Model − zero</th><th class="num">95% CI</th></tr></thead>` +
    `<tbody>${statRows}</tbody>`;

  drawAccuracyCharts();
  const btns = $("horizon-btns");
  btns.innerHTML = hs.map((h, i) => `<button type="button" class="btn" data-h="${h}" aria-pressed="${i === 0}">+${h} day${h === "1" ? "" : "s"}</button>`).join("");
  btns.addEventListener("click", (e) => { const h = e.target.closest("[data-h]")?.dataset.h; if (h) showScatter(h); });
  showScatter(hs[0]);

  const head = "<thead><tr><th>Horizon</th><th>Series</th><th class=\"num\">n</th><th>Hit rate [95% CI]</th><th>Pearson [CI]</th><th>Spearman [CI]</th><th>MAE pp [CI]</th></tr></thead>";
  const rows = hs.flatMap((h) => SERIES.map((s) => {
    const m = metricOf(results, h, s.key), ci = m.bootstrap_ci || {};
    const f2 = (v) => fmtNum(v, 2);
    return `<tr><td>+${h}</td><td>${esc(s.label)}</td><td class="num">${m.n}</td>
      <td>${fmtRate(m.directional_hit_rate)} ${fmtCI(ci.directional_hit_rate, fmtRate)}</td>
      <td>${fmtNum(m.pearson)} ${fmtCI(ci.pearson, f2)}</td><td>${fmtNum(m.spearman)} ${fmtCI(ci.spearman, f2)}</td>
      <td>${fmtNum(m.mae)} ${fmtCI(ci.mae, f2)}</td></tr>`;
  })).join("");
  $("metrics-table").innerHTML = `<caption class="sr-only">Backtest metrics by horizon</caption>${head}<tbody>${rows}</tbody>`;

  const modes = d3.rollup(predictions, (v) => v.length, (r) => r.mode);
  const prospective = modes.get("prospective") || 0;
  if (!scores.length) {
    $("prospective").innerHTML = `No matured prospective scores yet: prospective accuracy is <strong>unavailable, not 0%</strong>. ` +
      `The ledger holds ${predictions.length} entries (${[...modes].map(([m, n]) => `${n} ${esc(String(m).replace(/_/g, " "))}`).join(", ")}); ` +
      `historical replays are never scored as forecasts.${prospective ? "" : " Prospective entries appear as the daily workflow ingests new events."}`;
  } else {
    const hits = scores.filter((s) => s.hit).length;
    $("prospective").innerHTML = `${scores.length} matured prospective observations, ${hits} with the correct sign (${fmtRate(hits / scores.length)}).` +
      `<div class="table-wrap" style="margin-top:.5rem"><table><thead><tr><th>Ticker</th><th class="num">Horizon</th><th class="num">Predicted</th><th class="num">Realized CAR</th><th>Window end</th></tr></thead><tbody>` +
      scores.map((s) => `<tr><td>${esc(s.ticker)}</td><td class="num">+${esc(s.horizon)}</td><td class="num">${fmtPct(s.predicted_pct)}</td><td class="num">${fmtPct(s.actual_car_pct)}</td><td>${esc(s.window_end)}</td></tr>`).join("") +
      "</tbody></table></div>";
  }
}

function drawAccuracyCharts() {
  const ev = state.data.results.evaluation || {};
  const span = (rows, f) => d3.extent(rows.flatMap((r) => (r.m?.n ? f(r.m) : [])));
  forest($("chart-hit"), ev, {
    value: (m) => m.hit_rate, ci: (m) => m.hit_rate_ci95, domain: () => [0, 1], ref: 0.5, refLabel: "50%",
    xLabel: "Hit rate (% of predictions with correct sign)", xShort: "Hit rate (% correct sign)", fmt: fmtRate, axisFmt: (v) => `${Math.round(v * 100)}%`,
    betterSide: "right",
  });
  forest($("chart-mae"), ev, {
    value: (m) => m.mae_diff, ci: (m) => m.mae_diff_ci95,
    domain: (rows) => { const [lo, hi] = span(rows, (m) => m.mae_diff_ci95); const a = Math.max(Math.abs(lo ?? 1), Math.abs(hi ?? 1)); return [-a, a]; },
    ref: 0, refLabel: "0", xLabel: "MAE difference, model − zero (percentage points)", xShort: "Model − zero MAE (pp)",
    fmt: (v) => `${v > 0 ? "+" : ""}${fmtNum(v, 2)} pp`, axisFmt: (v) => `${v}`, betterSide: "left",
  });
  if (state.horizon) showScatter(state.horizon);
}

function showScatter(h) {
  state.horizon = h;
  $("horizon-btns").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.h === h)));
  scatter($("chart-scatter"), state.data.results, h, state.data.eventsById);
}

/* About */
function renderAbout() {
  const { results, meta } = state.data;
  const cov = meta.coverage || {};
  const li = (xs) => `<ul>${(xs || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const credits = [
    ["sushaan-k/alphasig", "2026 Sushaan Kandukoori", "EDGAR ingestion, supply-chain engine, models and NetworkX graph builder (vendored)."],
    ["aaryapatel09/sigint", "2026 Sushaan Kandukoori", "Predecessor of alphasig; attribution and license only."],
    ["supat-roong/stock-relation", "2026 Supat Roongpraiwan", "Deterministic SEC supply-chain extraction fallback; D3 force-graph, zoom and drag patterns adapted for this page."],
    ["alex9smith/gdelt-doc-api", "2020 Alex Whitehead-Smith", "GDELT DOC 2.0 client used for news queries."],
    ["zrxbeijing/EventStudy", "2020 Rongxin", "Market-model alpha/beta and abnormal-return methodology."],
  ];
  $("about").innerHTML = `
    <h3>What this is</h3>
    <p>A research observatory built by Xingjian Zhang. It connects supply relationships disclosed in SEC filings, disruption news, and measured abnormal stock returns, and keeps every prediction in a tamper-evident ledger so it can be scored honestly later.</p>
    <h3>Supply graph</h3>
    <p>${esc(meta.counts.nodes)} companies and ${esc(meta.counts.edges)} reviewed supplier &rarr; customer edges from ${esc(cov.filings_fetched)} primary SEC filings (${esc(cov.source)}). Discovery: <code>${esc(cov.discovery)}</code>; extraction: <code>${esc(cov.extractor)}</code>; graph: <code>${esc(cov.graph_builder)}</code>. No relationship is hand-invented; each edge carries its evidence sentence and filing link.</p>
    ${li(cov.limitations)}
    <h3>Shock propagation</h3>
    <p>The issuer's base shock is signed severity &times; 5 percentage points. A shock at a supplier travels downstream to its customers (lost supply); a shock at a customer travels upstream to its suppliers (lost demand). A path never changes direction. Each hop multiplies the prior magnitude by edge weight &times; 0.5, for up to three hops. The strongest simple path per ticker is kept; cycles cannot amplify. Filings dated after an event are excluded from that event's scenario. These magnitudes are modeling choices, not calibrated expected returns.</p>
    <h3>Event study</h3>
    <p>Market model against ${esc(results.methodology.market)}: stock return = &alpha; + &beta; &times; market return fitted on trading days ${esc(results.methodology.estimation_window.join(" to "))}. CAR window: ${esc(results.methodology.car_window)}. ${esc(results.methodology.predictions)} ${esc(results.methodology.sector_baseline)}</p>
    ${li(results.limitations)}
    <h3>Ledger</h3>
    <p>Entries in <code>ledger/predictions.jsonl</code> are SHA-256 hashed over RFC 8785 canonical JSON (excluding the hash field) and chained via <code>prev_hash</code> from a genesis of 64 zeros. Outcomes are written to a separate <code>scores.jsonl</code>; predictions are never edited.</p>
    ${li(meta.limitations)}
    <h3>Credits</h3>
    <div class="table-wrap"><table><thead><tr><th>Repository</th><th>License</th><th>Copyright</th><th>What was used</th></tr></thead><tbody>
    ${credits.map(([r, c, w]) => `<tr><td>${link(`https://github.com/${r}`, esc(r))}</td><td>MIT</td><td>${esc(c)}</td><td>${esc(w)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="small" style="margin-top:.6rem">D3 v7 (ISC, Mike Bostock), IBM Plex Sans and Newsreader fonts (SIL OFL 1.1) are bundled locally with their licenses in <code>vendor/</code>. <em>Seungukeeee/bottleneck_indicators</em> has no license: cited for ideas only, no code copied. SEC filings, news and market data keep their sources' terms.</p>
    <h3>Not financial advice</h3>
    <p>Nothing here is a recommendation to buy or sell any security. The historical sample is tiny and hand-selected, and the model has not shown forecasting skill.</p>`;
}

setupLedgerButtons();
main();
