const ranges = ['1D', '5D', '1M', '6M', 'YTD', '1Y', 'All', 'Custom'];
const dayMs = 86400000;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const shortMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const fullDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
let chartId = 0;

function validDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const time = Date.parse(text + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text;
}

function rangeStart(end, range) {
  const date = new Date(end);
  if (range === '1D') return end;
  if (range === '5D') return new Date(date.getTime() - 4 * dayMs).toISOString().slice(0, 10);
  if (range === 'YTD') return end.slice(0, 4) + '-01-01';
  if (range === 'All') return '';
  const months = { '1M': 1, '6M': 6, '1Y': 12 }[range];
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1 - months, 0));
  last.setUTCDate(Math.min(date.getUTCDate(), last.getUTCDate()));
  return last.toISOString().slice(0, 10);
}

export function renderChart(container, points, state) {
  if (!ranges.includes(state.range)) state.range = '6M';
  const series = points.filter(p => validDate(p.date) && Number.isFinite(p.value));
  const latest = series.at(-1)?.date || new Date().toISOString().slice(0, 10);
  const custom = state.range === 'Custom';
  const start = custom ? (validDate(state.from) ? state.from : rangeStart(latest, '6M')) : rangeStart(latest, state.range);
  const end = custom && validDate(state.to) ? state.to : latest;
  const selected = series.filter(p => p.date >= start && p.date <= end);
  const id = 'pf-chart-' + ++chartId;
  container.innerHTML = `<section class="pf-history" aria-label="Portfolio value history">
    <div class="pf-history-head"><div class="pf-history-controls" role="group" aria-label="Chart date range">
      ${ranges.map(range => `<button type="button" data-pf-range="${range}" aria-pressed="${range === state.range}">${range}</button>`).join('')}
    </div><strong class="pf-chart-title">Holdings Value</strong></div>
    ${custom ? `<form class="pf-history-custom"><label>From <input type="date" name="from" required value="${start}"></label><label>To <input type="date" name="to" required value="${end}"></label><button type="submit">Apply dates</button></form>` : ''}
    <div class="pf-history-content"></div></section>`;
  for (const button of container.querySelectorAll('[data-pf-range]')) button.onclick = () => {
    state.range = button.dataset.pfRange;
    renderChart(container, points, state);
    container.querySelector('[aria-pressed="true"]').focus();
  };
  const form = container.querySelector('.pf-history-custom');
  if (form) {
    form.oninput = () => form.elements.to.setCustomValidity('');
    form.onsubmit = event => {
      event.preventDefault();
      if (form.elements.from.value > form.elements.to.value) {
        form.elements.to.setCustomValidity('Choose an end date on or after the start date.');
        form.elements.to.reportValidity();
        return;
      }
      state.from = form.elements.from.value;
      state.to = form.elements.to.value;
      renderChart(container, points, state);
      container.querySelector('[type="submit"]').focus();
    };
  }
  const content = container.querySelector('.pf-history-content');
  if (!selected.length) {
    const message = series.length ? 'No portfolio values in this date range.' : 'Add dated portfolio values to see your chart.';
    content.innerHTML = `<div class="pf-chart-empty">${message}</div>`;
    return;
  }

  const times = selected.map(p => Date.parse(p.date));
  const firstTime = times[0];
  const timeSpan = times.at(-1) - firstTime;
  let lo = selected[0].value, hi = lo;
  for (const { value } of selected) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  const pad = hi === lo ? Math.max(1, Math.abs(hi) * 0.01) : (hi-lo) * 0.1;
  lo -= pad;
  hi += pad;
  const x = index => timeSpan ? (times[index] - firstTime) / timeSpan * 100 : 50;
  const y = index => (hi - selected[index].value) / (hi - lo) * 100;
  const coords = selected.map((_, i) => x(i).toFixed(3) + ',' + y(i).toFixed(3)).join(' ');
  const dates = timeSpan === 0 ? [firstTime] : [firstTime, times.at(-1)];
  if (timeSpan >= 2 * dayMs) dates.splice(1, 0, firstTime + timeSpan / 2);
  content.innerHTML = `<div class="pf-history-readout"><output></output><span>${selected.length} recorded ${selected.length === 1 ? 'value' : 'values'}</span></div>
    <div class="pf-chart-frame">
      <div class="pf-chart-plot" tabindex="0" role="slider" aria-label="Inspect recorded portfolio value" aria-orientation="horizontal" aria-valuemin="1" aria-valuemax="${selected.length}">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#2e9bff" stop-opacity=".22"/><stop offset="1" stop-color="#2e9bff" stop-opacity=".02"/></linearGradient></defs>
          ${selected.length > 1 ? `<polygon points="0,100 ${coords} 100,100" fill="url(#${id})"/><polyline points="${coords}" fill="none" stroke="#0074dc" stroke-width="2.6" vector-effect="non-scaling-stroke"/>` : ''}
        </svg>
        <i class="pf-chart-guide"></i><i class="pf-chart-dot"></i>
      </div>
      <div class="pf-chart-y" aria-hidden="true">${[hi, (hi + lo) / 2, lo].map(n => `<span>${shortMoney.format(n)}</span>`).join('')}</div>
      <div class="pf-chart-x" aria-hidden="true">${dates.map(time => `<span>${fullDate.format(time)}</span>`).join('')}</div>
    </div>`;

  const plot = content.querySelector('.pf-chart-plot');
  const output = content.querySelector('output');
  let current;
  const show = i => {
    current = i;
    const label = fullDate.format(times[i]) + ' · ' + money.format(selected[i].value);
    output.textContent = label;
    plot.setAttribute('aria-valuenow', String(i + 1));
    plot.setAttribute('aria-valuetext', label);
    plot.style.setProperty('--position-x', x(i) + '%');
    plot.style.setProperty('--position-y', y(i) + '%');
  };
  show(selected.length - 1);
  plot.onpointermove = plot.onpointerdown = event => {
    const rect = plot.getBoundingClientRect();
    const time = firstTime + (event.clientX - rect.left) / rect.width * timeSpan;
    let nearest = 0;
    for (let i=1; i<times.length; i++) if (Math.abs(times[i]-time) < Math.abs(times[nearest]-time)) nearest = i;
    show(nearest);
  };
  plot.onkeydown = event => {
    const targets = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: selected.length - 1 };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    show(Math.max(0, Math.min(selected.length - 1, targets[event.key])));
  };
}
