// Shared panel polling. A successful check is distinct from the source's quote/bar time.
export function createLiveRefresh({ el, refresh, interval = 30000, enabled = () => true,
  onState = () => {}, paused = false, now = () => Date.now(), schedule = setTimeout,
  cancel = clearTimeout, doc = globalThis.document, win = globalThis.window,
  Observer = globalThis.IntersectionObserver, timeout = 45000 } = {}) {
  let dead = false, timer = null, running = null, controller = null, queued = false;
  let cancelRunning = null;
  let intersecting = true, lastSuccessAt = null, lastAttemptAt = null, error = null, failures = 0;
  const cadence = () => Math.max(1000, Number(typeof interval === 'function' ? interval() : interval) || 30000);
  function visible() {
    if (doc?.visibilityState && doc.visibilityState !== 'visible') return false;
    if (el?.isConnected === false || !intersecting) return false;
    if (!el?.getBoundingClientRect) return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < (win?.innerHeight || Infinity) && r.left < (win?.innerWidth || Infinity);
  }
  const online = () => win?.navigator?.onLine !== false;
  const allowed = () => !paused && online() && visible() && enabled();
  function state() {
    let status = 'idle';
    if (!online()) status = 'offline';
    else if (paused || !enabled()) status = 'paused';
    else if (running) status = 'updating';
    else if (error || (lastSuccessAt !== null && now() - lastSuccessAt > cadence() * 3)) status = lastSuccessAt === null ? 'error' : 'stale';
    else if (lastSuccessAt !== null) status = 'current';
    return { busy: !!running, paused, status, lastSuccessAt, lastAttemptAt, error };
  }
  const notify = () => { if (!dead) onState(state()); };
  function arm() {
    if (timer !== null) cancel(timer);
    if (dead) return;
    const delay = Math.min(Math.max(300000, cadence()), cadence() * 2 ** Math.min(failures, 4));
    timer = schedule(() => {
      timer = null; notify();
      if (allowed()) request(false).catch(() => {});
      else arm();
    }, delay);
  }
  function request(manual = true) {
    if (dead) return Promise.resolve();
    if (!online() || (!manual && !allowed())) { notify(); arm(); return Promise.resolve(); }
    if (running) {
      if (manual) { queued = true; const previous = running; return previous.then(() => running); }
      return running;
    }
    if (timer !== null) { cancel(timer); timer = null; }
    controller = new AbortController();
    const signal = controller.signal;
    lastAttemptAt = now();
    let timeoutTimer, timedOut = false;
    const expiry = new Promise((_, reject) => {
      cancelRunning = () => { cancel(timeoutTimer); reject(new DOMException('Aborted', 'AbortError')); };
      timeoutTimer = schedule(() => {
        timedOut = true; controller?.abort(); reject(new Error('Request timed out'));
      }, timeout);
    });
    running = Promise.race([Promise.resolve().then(() => refresh(signal)), expiry]).then(value => {
      if (!dead && !signal.aborted) { lastSuccessAt = now(); error = null; failures = 0; }
      return value;
    }).catch(e => {
      if (!timedOut && (signal.aborted || e?.name === 'AbortError')) return;
      if (!dead) { error = timedOut ? 'Request timed out' : e?.message || 'Refresh failed'; failures++; }
      throw e;
    }).finally(() => {
      cancel(timeoutTimer);
      running = null; controller = null; cancelRunning = null;
      if (dead) return;
      notify();
      if (queued) { queued = false; request(true).catch(() => {}); }
      else arm();
    });
    notify();
    return running;
  }
  function resume() {
    if (dead) return;
    notify();
    if (allowed() && (lastAttemptAt === null || now() - lastAttemptAt >= 1000)) request(false).catch(() => {});
  }
  const observer = Observer && el ? new Observer(entries => {
    const before = intersecting;
    intersecting = entries.some(entry => entry.isIntersecting);
    if (!before && intersecting) resume();
  }) : null;
  observer?.observe(el);
  doc?.addEventListener?.('visibilitychange', resume);
  win?.addEventListener?.('focus', resume);
  win?.addEventListener?.('online', resume);
  win?.addEventListener?.('offline', notify);
  arm();
  return {
    request, state,
    recordSuccess() { if (!dead) { lastSuccessAt = now(); error = null; failures = 0; notify(); if (!running) arm(); } },
    restart() {
      if (dead) return Promise.resolve();
      queued = false;
      if (running) { const previous = running; queued = true; controller?.abort(); cancelRunning?.(); return previous.then(() => running); }
      return request(true);
    },
    setPaused(value) { paused = !!value; notify(); if (!paused) resume(); arm(); },
    destroy() {
      dead = true; queued = false;
      if (timer !== null) cancel(timer);
      controller?.abort(); cancelRunning?.(); observer?.disconnect();
      doc?.removeEventListener?.('visibilitychange', resume);
      win?.removeEventListener?.('focus', resume);
      win?.removeEventListener?.('online', resume);
      win?.removeEventListener?.('offline', notify);
    }
  };
}

export function refreshLabel(state) {
  const checked = state.lastSuccessAt === null ? '' : ' · Checked ' + new Date(state.lastSuccessAt).toLocaleTimeString();
  if (state.status === 'offline') return 'Offline · showing last available data' + checked;
  if (state.status === 'paused') return 'Automatic updates paused' + checked;
  if (state.status === 'updating') return 'Updating…' + checked;
  if (state.status === 'stale' || state.status === 'error') return 'Update failed · retrying automatically' + checked;
  return (state.lastSuccessAt === null ? 'Waiting for data' : 'Auto updates on') + checked;
}
