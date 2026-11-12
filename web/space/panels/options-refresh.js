// Poll only while this panel is visible, unpaused and inside the regular US session.
// A manual request always works. Superseded requests abort, then settle before the next starts.
export function regularSession(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const minute=(+parts.hour%24)*60 + +parts.minute;
  return parts.weekday!=='Sat' && parts.weekday!=='Sun' && minute>=570 && minute<960;
}
export function panelVisible(el, doc=globalThis.document) {
  if(doc?.visibilityState!=='visible'||!el?.isConnected)return false;
  const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<(globalThis.innerHeight||0)&&r.left<(globalThis.innerWidth||0);
}
export function createOptionRefresh({refresh,visible=()=>true,now=()=>new Date(),schedule=setTimeout,cancel=clearTimeout,onState=()=>{},paused=false,interval=60000}) {
  let dead=false,timer=null,running=null,controller=null,queued=false,response=null;
  const state=()=>({paused,busy:!!running,regularSession:regularSession(now()),allowed:regularSession(now())&&(response?.refreshAllowed??response?.marketOpen??true)});
  const notify=()=>onState(state());
  const arm=()=>{if(timer!==null)cancel(timer);timer=dead?null:schedule(()=>{timer=null;if(!paused&&visible()&&state().allowed)request(false).catch(()=>{});else arm();},Math.max(60000,interval));};
  function request(manual=true) {
    if(dead)return Promise.resolve();
    if(!manual&&(paused||!visible()||!state().allowed)){arm();return Promise.resolve();}
    if(running){if(manual)queued=true;return running;}
    if(timer!==null){cancel(timer);timer=null;}
    controller=new AbortController();const signal=controller.signal;
    running=Promise.resolve().then(()=>refresh(signal)).catch(e=>{if(e?.name!=='AbortError')throw e;}).finally(()=>{running=null;controller=null;notify();if(queued&&!dead){queued=false;request(true).catch(()=>{});}else arm();});
    notify();return running;
  }
  arm();
  return {request,restart(){if(dead)return Promise.resolve();queued=false;if(running){queued=true;controller?.abort();return running;}return request(true);},update(data){response=data;notify();},setPaused(value){paused=!!value;notify();arm();},get paused(){return paused;},destroy(){dead=true;queued=false;if(timer!==null)cancel(timer);controller?.abort();},state};
}
export function optionSource(data, side) {
  if(!data)return 'Options source not loaded.';
  const indicative=data.indicative===true||data.feed==='indicative';
  const parts=[data.source||'Options provider',data.feed?'Feed: '+data.feed:null];
  if(indicative)parts.push('Indicative quotes are modified, not actual OPRA quotes. Trades are delayed 15 minutes; quote age varies.');
  else if(data.delayed)parts.push('Delayed options data.');
  const stamp=(label,value)=>`${label}: ${value||'unavailable'}`;
  parts.push(stamp(side?'Contract quote timestamp':'Latest quote timestamp',side ? side.quoteAsOf : data.quoteAsOf),stamp(side?'Contract trade timestamp':'Latest trade timestamp',side ? side.tradeAsOf : data.tradeAsOf),stamp('Fetched',data.fetchedAt));
  if(data.underlying)parts.push('Independent underlying: '+(data.underlying.source||'source unavailable')+' · spot timestamp: '+(data.underlying.asOf||'unavailable')+' · fetched: '+(data.underlying.fetchedAt||'unavailable'));
  if(data.note)parts.push(data.note);
  if(data.fallback)parts.push('Fallback from '+data.fallback.requestedProvider+' to '+data.fallback.provider+': '+data.fallback.reason);
  if(data.coverage?.partial)parts.push(`Partial coverage: ${data.coverage.reason||'Provider returned a subset of contracts.'}`);
  if(data.unavailableMetrics?.length)parts.push(`Unavailable: ${data.unavailableMetrics.join(', ')}. Volume/OI-dependent ratios and max pain require reported inputs.`);
  if(Array.isArray(data.notices))parts.push(...data.notices);
  return parts.filter(Boolean).join(' · ');
}
// IntersectionObserver also respects clipping inside the workspace's scroll container.
export function observePanel(el, callback) {
  let intersecting=true;
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{intersecting=entries[0]?.isIntersecting??false;callback?.();}):null;
  observer?.observe(el);
  return {visible:()=>intersecting&&panelVisible(el),destroy(){observer?.disconnect();}};
}
export function refreshControls(el, poll, ctx) {
  const render=()=>{for(const b of el.querySelectorAll('[data-options-pause]')){b.textContent=poll.paused?'Resume updates':'Pause updates';b.setAttribute('aria-pressed',String(poll.paused));}for(const n of el.querySelectorAll('[data-options-status]'))n.textContent=poll.paused?'Automatic updates paused.':'Auto refresh: 60s while visible, weekdays 9:30–16:00 ET. Refresh manually after close or on exchange holidays.';};
  const click=e=>{if(e.target.closest('[data-options-refresh]'))poll.request(true).catch(()=>{});else if(e.target.closest('[data-options-pause]')){poll.setPaused(!poll.paused);ctx?.setState?.({optionsPaused:poll.paused});render();}};
  el.addEventListener('click',click);render();return{render,destroy(){el.removeEventListener('click',click);}};
}
export const refreshHTML='<div class="p-opt-refresh"><button class="s-btn s-btn-sm" data-options-refresh>Refresh</button><button class="s-btn s-btn-sm" data-options-pause aria-pressed="false">Pause updates</button><span class="s-muted" data-options-status></span></div>';
export function optionSourceHTML(data, side) {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if(!data)return esc(optionSource(data));
  const indicative=data.indicative===true||data.feed==='indicative';
  const timestamp=side?side.quoteAsOf:data.quoteAsOf;
  const label=[data.source||'Options provider',data.feed?'Feed: '+data.feed:null,indicative?'Indicative quotes, not OPRA; trades delayed 15m':null,(side?'Contract quote':'Latest quote')+': '+(timestamp||'unavailable'),data.coverage?.partial?'Partial snapshot':null,data.unavailableMetrics?.some(m=>m==='volume'||m==='openInterest')?'Volume/OI unavailable':null].filter(Boolean).join(' · ');
  return `<details class="p-opt-source-details"><summary>${esc(label)} · Source details</summary><div>${esc(optionSource(data,side))}</div></details>`;
}
