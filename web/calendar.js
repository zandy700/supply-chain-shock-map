'use strict';
let calendarView;
const monthOf = date => date.slice(0, 7);
const calendarDate = (date, options) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {...options, timeZone:'UTC'});

function renderCalendar() {
  const key = watchlist.join(',');
  if (!calendarView || calendarView.key !== key || !calendarView.busy && Date.now() - calendarView.loaded > 900000) {
    const previous = calendarView?.key === key ? calendarView : null;
    const view = {key, loaded:Date.now(), month:previous?.month || '', day:previous?.day || '', data:previous?.data, busy:true};
    calendarView = view;
    const supported = watchlist.filter(symbol => STOCK_SYMBOL.test(symbol));
    batchData.mapSymbolBatches(supported, batch => api('/api/calendar?tickers=' + encodeURIComponent(batch.join(',')))).then(result => {
      const merged = batchData.mergeCalendars(result, previous?.data);
      merged.unavailable.push(...watchlist.filter(symbol => !STOCK_SYMBOL.test(symbol)));
      view.data = merged;
      if (!view.month) view.month = monthOf(merged.from);
    }).catch(() => { view.error = true; }).finally(() => {
      view.busy = false;
      if (calendarView === view && location.hash === '#/calendar') renderCalendar();
    });
  }
  const view = calendarView;
  main.innerHTML = heading('Event calendar', 'Earnings for your stocks and related companies, plus selected market-wide events over the next three calendar months.', 'Your watchlist');
  if (!view.data) {
    main.innerHTML += view.error ? '<div class="panel notice" role="alert">The calendar could not load. <button class="secondary button" id="calendar-retry">Retry</button></div>' : '<div class="panel notice loading" role="status">Loading upcoming events…</div>';
    bindCalendarRetry();
    return;
  }
  if (view.busy) main.innerHTML += '<p class="hint" role="status">Refreshing events…</p>';
  if (view.error) main.innerHTML += '<p class="hint" role="status">Refresh failed; previous events remain visible. <button class="button secondary" id="calendar-retry">Retry</button></p>';
  if (view.data.staleSymbols?.length) main.innerHTML += `<p class="hint" role="status">Previously retrieved events remain visible for ${escapeHTML(view.data.staleSymbols.join(', '))}; their refresh is incomplete.</p>`;
  const {from,to,events,unlisted,unavailable} = view.data;
  const first = new Date(view.month + '-01T12:00:00Z');
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth()+1,0);
  const monthEvents = events.filter(event => monthOf(event.date) === view.month);
  const visible = monthEvents.filter(event => !view.day || event.date === view.day);
  const cells = Array(first.getUTCDay()).fill('<span></span>');
  for (let d=1; d<=last.getUTCDate(); d++) {
    const date = view.month + '-' + String(d).padStart(2,'0');
    const items = monthEvents.filter(event => event.date === date);
    const today = date === from ? ' aria-current="date"' : '';
    cells.push(items.length
      ? `<button type="button" class="event-day" data-day="${date}" aria-pressed="${date === view.day}" aria-label="${calendarDate(date,{month:'long',day:'numeric'})}, ${items.length} events"${today}>${d}<small>${escapeHTML(items[0].ticker || 'Market')}${items.length > 1 ? ' +' + (items.length-1) : ''}</small></button>`
      : `<span class="cal-day"${today}>${d}</span>`);
  }
  main.innerHTML += `<section class="panel cal-panel"><div class="cal-head">
    <h2>${calendarDate(view.month+'-01',{month:'long',year:'numeric'})}</h2>
    <div><button class="button secondary" data-shift="-1" aria-label="Previous month" ${view.month === monthOf(from) ? 'disabled' : ''}>‹</button>
    <button class="button secondary" data-shift="1" aria-label="Next month" ${view.month === monthOf(to) ? 'disabled' : ''}>›</button></div></div>
    <div class="cal-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => '<strong>'+day+'</strong>').join('')}${cells.join('')}</div></section>
    <div class="section-head"><h2>${view.day ? calendarDate(view.day,{month:'long',day:'numeric'}) : 'This month’s events'}</h2>${view.day ? '<button class="button secondary" id="show-month">Show all dates</button>' : ''}</div>`;
  main.innerHTML += visible.length ? '<div class="panel">' + visible.map(event => `<article class="cal-event">
    <time datetime="${event.date}">${calendarDate(event.date,{month:'short',day:'numeric'})}</time><div>
    <div class="eyebrow">${event.ticker ? escapeHTML(event.ticker) + (event.scope === 'related' ? ' · Related earnings' : ' · Your watchlist') : 'Market-wide'} · ${escapeHTML(event.status)}${event.timing ? ' · ' + escapeHTML(event.timing) : ''}</div>
    <h3>${escapeHTML(event.title)}</h3><p class="muted small">${escapeHTML(event.detail)}</p>
    <a class="link" href="${escapeHTML(event.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(event.source)} ↗</a>
    ${(event.connections || []).map(link => `<div class="earnings-connection"><strong>${escapeHTML(link.holding)} · ${escapeHTML(link.kind)}</strong><p>${escapeHTML(link.detail)}</p><a class="link" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer">Relationship source ↗</a></div>`).join('')}</div></article>`).join('') + '</div>' : '<div class="panel empty">No upcoming events listed for this month.</div>';
  if (unlisted.length) main.innerHTML += `<p class="hint">No earnings date listed in this window for ${escapeHTML(unlisted.join(', '))}.</p>`;
  const warnings = [];
  if (view.data.peerErrors?.length) warnings.push('Industry peer lookup unavailable for ' + view.data.peerErrors.join(', ') + '.');
  if (unavailable.length) warnings.push('Earnings lookup unavailable for ' + unavailable.join(', ') + '.');
  if (warnings.length) main.innerHTML += `<p class="hint" role="status">${escapeHTML(warnings.join(' '))} <button class="button secondary" id="calendar-retry">Retry</button></p>`;
  for (const button of main.querySelectorAll('[data-shift]')) button.onclick = () => {
    first.setUTCMonth(first.getUTCMonth() + Number(button.dataset.shift));
    view.month = monthOf(first.toISOString()); view.day = ''; renderCalendar();
    const next = main.querySelector('[data-shift="'+button.dataset.shift+'"]:enabled') || main.querySelector('[data-shift]:enabled');
    next?.focus();
  };
  for (const button of main.querySelectorAll('[data-day]')) button.onclick = () => {
    view.day = view.day === button.dataset.day ? '' : button.dataset.day;
    renderCalendar(); main.querySelector('[data-day="'+button.dataset.day+'"]').focus();
  };
  const reset = document.querySelector('#show-month');
  if (reset) reset.onclick = () => { view.day = ''; renderCalendar(); };
  bindCalendarRetry();
}
function bindCalendarRetry() {
  const retry = document.querySelector('#calendar-retry');
  if (retry) retry.onclick = () => { if (calendarView) calendarView.loaded = 0; renderCalendar(); };
}
