// Ultimater AI: the right-dock research assistant and the `ai-recap` panel. Owned by the ai builder.
// Talks to /api/space/scout/{status,chat,recap} (worker/space/scout.js). See docs/space-contract.md.
import { registerPanel, getPanel, links, bus, fmt, esc, state as ui, store } from './core.js';
import { selectedPortfolioHoldings } from './panels/portfolio.js';

const NOT_SET_UP = "Ultimater AI isn't set up yet — the site owner needs to add an API key.";
const SYMBOL = /^\^?[A-Z0-9]{1,6}(?:[.=-][A-Z0-9]{1,4})?$/;
const MAX_CHARS = 8000, MAX_HISTORY = 20, MAX_CHATS = 20, PANEL_CHARS = 3900;

// ---------- icons ----------
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const I = {
  spark: `<svg viewBox="0 0 24 24" aria-hidden="true" class="p-scout-spark"><path fill="currentColor" d="M12 2.5c.5 4.6 2.9 7 9.5 9.5-6.6 2.5-9 4.9-9.5 9.5-.5-4.6-2.9-7-9.5-9.5 6.6-2.5 9-4.9 9.5-9.5Z"/><path fill="currentColor" opacity=".55" d="M19 2c.2 1.6 1 2.4 3 3-2 .6-2.8 1.4-3 3-.2-1.6-1-2.4-3-3 2-.6 2.8-1.4 3-3Z"/></svg>`,
  more: svg('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'),
  dock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'),
  undock: svg('<rect x="3" y="7" width="13" height="13" rx="2"/><path d="M9 3h10a2 2 0 0 1 2 2v10"/>'),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  collapse: svg('<path d="M20 4l-6 6M14 5v5h5M4 20l6-6M10 19v-5H5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  send: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`,
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  up: svg('<path d="M7 11v9H4v-9h3Zm0 0 4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"/>'),
  down: svg('<path d="M17 13V4h3v9h-3Zm0 0-4 8a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 4H17"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  warn: svg('<path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>')
};

// ---------- safe markdown ----------
// Escapes everything, then re-adds a small whitelist: headings, lists, quotes, code, tables, rules,
// bold/italic/strike/inline code, and links whose URL is http(s) only.
export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = []; let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const LIST = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush(); const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { flush(); out.push(`<h4>${inline(h[2])}</h4>`); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush(); const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`); continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush(); const head = cells(line); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="p-scout-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = line.match(LIST);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (m && /\d/.test(m[2]) === ordered && m[1].length < 2) { items.push({ text: m[3], sub: [] }); i++; continue; }
        if (m && m[1].length >= 2 && items.length) { items.at(-1).sub.push(lines[i].trim()); i++; continue; }
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) { items.at(-1).text += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      const start = ordered ? parseInt(li[2], 10) : 1;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${items.map(it => `<li>${inline(it.text)}${it.sub.length ? renderMarkdown(it.sub.join('\n')) : ''}</li>`).join('')}</${tag}>`);
      continue;
    }
    para.push(line.trim()); i++;
  }
  flush();
  return out.join('');
}

function inline(text) {
  const keep = [];
  const hold = html => `\u0000${keep.push(html) - 1}\u0000`;
  let s = String(text)
    .replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()<>]+(?:\([^\s()<>]*\))?[^\s()<>]*)\)/g, (_, t, u) => hold(link(u, t)))
    .replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, (_, pre, u) => pre + hold(link(u, u)));
  s = esc(s)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[+n]);
}
function link(url, label) {
  let ok = false;
  try { ok = ['http:', 'https:'].includes(new URL(url).protocol); } catch { /* invalid */ }
  return ok ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>` : esc(label);
}

// ---------- persisted state ----------
const settings = { includeContext: true, shareHoldings: true, detailed: false, enterSends: true, ...store.get('scout:settings', {}) };
const saveSettings = () => store.set('scout:settings', settings);
let chats = (() => { const v = store.get('scout:chats', []); return Array.isArray(v) ? v.filter(c => c && Array.isArray(c.messages)) : []; })();
function saveChats() {
  chats = chats.filter(c => c.messages.length).sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
  for (const c of chats) if (c.messages.length > 80) c.messages = c.messages.slice(-80);
  store.set('scout:chats', chats);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let current = null;               // active chat {id,title,created,updated,messages,attachments}
let pending = [];                 // chips for the next message [{label,text,panelType}]
let streaming = null;             // {controller, msg}
let pane = 'chat';                // chat | history | settings | about
let confirmClear = false;
let aiStatus = { configured: null, model: null };
let layout = { mode: store.get('scout:mode', 'docked'), open: store.get('scout:open', true), expanded: false };
let view = { id: null, name: null };

// ---------- workspace context ----------
const currentSymbol = () => { const doc=window.__spaceShell?.cur?.doc;return doc ? links.get(doc.id+':A') || doc.groups?.A || doc.symbols?.[0] || null : links.get('dev') || null; };
function activeSymbols() {const cur=window.__spaceShell?.cur;if(!cur?.doc)return [currentSymbol()].filter(Boolean);return [...new Set([currentSymbol(),...(cur.doc.symbols||[]),...[...cur.mounted.values()].filter(m=>m.def?.symbolLinked).map(m=>links.get((m.p.locked||!m.p.group)?`${cur.doc.id}:${m.p.id}`:`${cur.doc.id}:${m.p.group}`))].filter(Boolean))];}
async function hydrateUntilAborted(signal) {
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(new DOMException('Aborted','AbortError'));signal.addEventListener('abort',abort,{once:true});});
  try {await Promise.race([hydrateHoldings(),stopped]);}finally{signal.removeEventListener('abort',abort);}
}
let linkedHoldings = null, holdingsUnavailable = false, holdingsGeneration = 0;
async function hydrateHoldings() {
  const ticket=++holdingsGeneration;
  if (!settings.shareHoldings) {linkedHoldings=null;holdingsUnavailable=false;return;}
  try {const rows=await selectedPortfolioHoldings();if(ticket===holdingsGeneration&&settings.shareHoldings){linkedHoldings=rows;holdingsUnavailable=false;}}
  catch {if(ticket===holdingsGeneration){linkedHoldings=[];holdingsUnavailable=true;}}
}
function holdings() { return settings.shareHoldings ? linkedHoldings || [] : []; }
function holdingsSummary() {
  if (!settings.shareHoldings) return null;
  if (holdingsUnavailable) return 'Selected portfolio holdings could not be loaded. Do not infer positions from another account.';
  const rows = holdings();
  if (!rows.length) return null;
  const text = 'Holdings (ticker, shares, average cost): ' + rows.map(r => `${r.ticker} ${fmt.num(r.shares, r.shares % 1 ? 4 : 0)}${r.avgCost ? ` @ $${fmt.price(r.avgCost)}` : ''}`).join('; ');
  return clip(text, 3900);
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function workspacePanels() {
  const mounted=window.__spaceShell?.cur?.mounted;
  const inst = mounted ? [...mounted.values()].map(m=>({type:m.p.type,inst:m.inst})) : window.__space?.instances;
  if (!settings.includeContext || !Array.isArray(inst)) return [];
  const out = [];
  for (const { type, inst: p } of inst) {
    if (out.length >= 6 || type === 'ai-recap' || (!settings.shareHoldings && type.startsWith('portfolio-'))) continue;
    try { const t = p?.scoutContext?.(); if (t) out.push(clip(`${getPanel(type)?.title || type}: ${t}`, 1500)); } catch { /* panel failed */ }
  }
  return out;
}
function buildContext(attachments) {
  const panels = attachments.map(a => {let text=a.text;try{if(a.getContext)text=a.getContext();}catch{}return clip(`[Attached] ${a.label}: ${String(text||'Context unavailable')}`,PANEL_CHARS);});
  for (const p of workspacePanels()) if (panels.length < 12) panels.push(p);
  let total = 0;
  const kept = panels.filter(p => (total += p.length) <= 20000);
  const symbols = [...new Set(activeSymbols().filter(s => s && SYMBOL.test(s)))].slice(0, 25);
  const ctx = { panels: kept, symbols, style: settings.detailed ? 'detailed' : 'concise' };
  if (view.name || view.id) ctx.view = clip(String(view.name || view.id), 80);
  const hs = holdingsSummary(); if (hs) ctx.holdingsSummary = hs;
  return ctx;
}
function suggestions() {
  const sym = currentSymbol(), v = String(view.id || view.name || '').toLowerCase();
  const list = [];
  if (v.includes('portfolio') || holdings().length) list.push('Flag the events ahead that could hit my holdings');
  if (v.includes('earning')) list.push('Which earnings this week could move the market?');
  else if (v.includes('option')) list.push(`What is ${sym || 'NVDA'}'s options activity signaling?`);
  else if (v.includes('crypto')) list.push("What's driving crypto today?");
  else if (sym && !v.includes('portfolio')) list.push(`Why is ${sym} moving today?`);
  list.push('What can Ultimater AI do?', 'Explain how sector rotation works', 'Compare growth vs value investing strategies', 'Set up my workspace');
  return [...new Set(list)].slice(0, 5);
}

// ---------- DOM ----------
const root = document.createElement('aside');
root.className = 'p-scout';
root.setAttribute('aria-label', 'Ultimater AI assistant');
root.innerHTML = `
  <header class="p-scout-head">
    ${I.spark}<h2 class="p-scout-title">Ask Ultimater AI</h2>
    <button class="s-icon-btn s-icon-btn-sm" data-act="about" aria-label="About Ultimater AI" title="About Ultimater AI">${I.info}</button>
    <span class="p-scout-grow"></span>
    <button class="s-icon-btn" data-act="menu" aria-label="Ultimater AI menu" aria-haspopup="menu" aria-expanded="false" title="More">${I.more}</button>
    <button class="s-icon-btn" data-act="dock" title=""></button>
    <button class="s-icon-btn" data-act="expand" title=""></button>
    <button class="s-icon-btn" data-act="hide" aria-label="Hide Ultimater AI" title="Hide Ultimater AI">${I.close}</button>
  </header>
  <div class="p-scout-banner" role="status" hidden>${I.warn}<span>${esc(NOT_SET_UP)}</span></div>
  <div class="p-scout-body s-scroll" tabindex="-1"></div>
  <form class="p-scout-compose" novalidate>
    <div class="p-scout-chips" aria-label="Attached context"></div>
    <label class="s-sr" for="p-scout-input">Message Ultimater AI</label>
    <textarea id="p-scout-input" class="p-scout-input" rows="1" maxlength="${MAX_CHARS}" placeholder="Ask anything..."></textarea>
    <div class="p-scout-compose-row"><span class="p-scout-count" aria-live="polite"></span><button type="submit" class="p-scout-send" aria-label="Send message">${I.send}</button></div>
  </form>
  <p class="p-scout-foot">AI can make mistakes. Please double-check answers.</p>`;
const launcher = document.createElement('button');
launcher.type = 'button';
launcher.className = 'p-scout-launcher';
launcher.innerHTML = `${I.spark}<span>Ask Ultimater AI</span>`;
launcher.setAttribute('aria-label', 'Open Ultimater AI');
const $ = sel => root.querySelector(sel);
const body = $('.p-scout-body'), input = $('.p-scout-input'), form = $('.p-scout-compose'), sendBtn = $('.p-scout-send');

function host() { return document.getElementById('space-dock'); }
function place() {
  const h = host();
  const target = h && layout.mode === 'docked' && !layout.expanded ? h : document.body;
  if (root.parentElement !== target) target.append(root);
  if (!launcher.isConnected) document.body.append(launcher);
  root.dataset.mode = layout.expanded ? 'expanded' : layout.mode === 'docked' ? (h ? 'docked' : 'side') : 'floating';
  root.hidden = !layout.open;
  launcher.hidden = layout.open || Boolean(h);
  if (h) h.dataset.scout = !layout.open ? 'hidden' : layout.expanded ? 'expanded' : layout.mode;
  if (root.dataset.mode === 'floating') { const p = store.get('scout:pos', null); if (p) Object.assign(root.style, { left: p.left + 'px', top: p.top + 'px', right: 'auto', bottom: 'auto' }); }
  else Object.assign(root.style, { left: '', top: '', right: '', bottom: '' });
  const dock = $('[data-act=dock]'), exp = $('[data-act=expand]');
  const docked = layout.mode === 'docked';
  dock.innerHTML = docked ? I.undock : I.dock;
  dock.setAttribute('aria-label', docked ? 'Undock Ultimater AI' : 'Dock Ultimater AI'); dock.title = dock.getAttribute('aria-label');
  exp.innerHTML = layout.expanded ? I.collapse : I.expand;
  exp.setAttribute('aria-label', layout.expanded ? 'Collapse Ultimater AI' : 'Expand Ultimater AI'); exp.title = exp.getAttribute('aria-label');
  bus.emit('ai:layout', { mode: root.dataset.mode, open: layout.open, expanded: layout.expanded });
}
function setLayout(patch) {
  layout = { ...layout, ...patch };
  store.set('scout:mode', layout.mode); store.set('scout:open', layout.open);
  place();
}
function openDock({ focus = true } = {}) {
  if (!layout.open) setLayout({ open: true }); else place();
  if (layout.mode === 'docked' && !layout.expanded && host()?.dataset.state === 'collapsed') bus.emit('dock:open');
  if (focus) setTimeout(() => input.focus(), 0);
}

// ---------- rendering ----------
function render() {
  $('.p-scout-banner').hidden = aiStatus.configured !== false;
  root.classList.toggle('is-streaming', Boolean(streaming));
  sendBtn.innerHTML = streaming ? I.stop : I.send;
  sendBtn.setAttribute('aria-label', streaming ? 'Stop generating' : 'Send message');
  sendBtn.classList.toggle('is-stop', Boolean(streaming));
  renderChips(); renderCount();
  if (pane === 'history') return renderHistory();
  if (pane === 'settings') return renderSettings();
  if (pane === 'about') return renderAbout();
  renderChat();
}
function renderChips() {
  const all = [...(current?.attachments || []).map(a => ({ ...a, kept: true })), ...pending];
  $('.p-scout-chips').innerHTML = all.map((c, i) => `<span class="s-chip p-scout-chip${c.kept ? ' is-kept' : ''}" title="${esc(clip(c.text, 300))}"><span class="s-chip-dot"></span>${esc(c.label)}<button type="button" class="s-chip-x" data-act="unchip" data-kept="${c.kept ? 1 : 0}" data-i="${c.kept ? i : i - (current?.attachments?.length || 0)}" aria-label="Remove ${esc(c.label)} from chat">×</button></span>`).join('');
}
function renderCount() {
  const n = input.value.length;
  $('.p-scout-count').textContent = n > MAX_CHARS * 0.8 ? `${n.toLocaleString()} / ${MAX_CHARS.toLocaleString()}` : '';
}
function renderChat() {
  const msgs = current?.messages || [];
  if (!msgs.length) {
    const off = aiStatus.configured === false;
    body.innerHTML = `<div class="p-scout-empty">
      <p class="p-scout-hello">Hello,<br>What would you like to know?</p>
      <div class="p-scout-prompts">${suggestions().map(p => `<button type="button" class="p-scout-prompt" data-act="prompt" ${off ? 'disabled' : ''}>${esc(p)}</button>`).join('')}</div>
    </div>`;
    return;
  }
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  body.innerHTML = `<div class="p-scout-msgs">${msgs.map(messageHTML).join('')}</div>`;
  if (atBottom || streaming) body.scrollTop = body.scrollHeight;
}
const ERRORS = {
  ai_not_configured: NOT_SET_UP,
  rate_limited: 'You are sending messages quickly. Wait a moment and try again.',
  ai_rate_limited: 'Ultimater AI is busy right now. Try again in a minute.',
  ai_overloaded: 'Ultimater AI is busy right now. Try again in a minute.',
  ai_auth_failed: "Ultimater AI's API key was rejected — the site owner needs to update it.",
  ai_model_unavailable: "The configured AI model isn't available — the site owner should check PULSE_AI_MODEL.",
  ai_timeout: 'Ultimater AI took too long to answer. Try again.',
  network: 'Could not reach Ultimater AI. Check your connection and try again.',
  interrupted: 'The answer was interrupted. Try again.'
};
function messageHTML(m, idx) {
  if (m.role === 'user') {
    return `<div class="p-scout-msg is-user" data-idx="${idx}">${m.chips?.length ? `<div class="p-scout-msg-chips">${m.chips.map(c => `<span class="s-chip">${esc(c)}</span>`).join('')}</div>` : ''}<div class="p-scout-bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
  }
  const live = m.status === 'streaming';
  const tools = (m.tools || []).map(t => `<li class="is-${t.status}">${t.status === 'start' ? '<span class="p-scout-spin" aria-hidden="true"></span>' : t.status === 'done' ? I.check : I.warn}<span>${esc(t.label)}${t.source ? ` <span class="p-scout-src">· ${esc(t.source)}</span>` : ''}</span></li>`).join('');
  const actions = (m.actions || []).map(a => `<div class="p-scout-action">${I.bolt}<span>${esc(a)}</span></div>`).join('');
  const text = m.content ? `<div class="p-scout-md">${renderMarkdown(m.content)}${live ? '<span class="p-scout-caret" aria-hidden="true"></span>' : ''}</div>`
    : live && !(m.tools || []).length ? '<div class="p-scout-thinking" role="status"><span></span><span></span><span></span><span class="s-sr">Ultimater AI is thinking</span></div>' : '';
  const notes = [
    m.status === 'stopped' ? '<p class="p-scout-note">Stopped.</p>' : '',
    m.truncated ? '<p class="p-scout-note">The answer hit its length limit. Ask Ultimater AI to continue.</p>' : '',
    ...(m.notices || []).map(n => `<p class="p-scout-note">${esc(n)}</p>`),
    m.status === 'error' || m.status === 'refused' ? `<div class="p-scout-error" role="alert">${I.warn}<span>${esc(m.errorText || ERRORS[m.error] || 'Ultimater AI is unavailable right now. Try again.')}</span>${m.error === 'ai_not_configured' ? '' : `<button type="button" class="s-btn s-btn-sm" data-act="retry" data-idx="${idx}">Retry</button>`}</div>` : ''
  ].join('');
  const sources = m.sources?.length && !/sources:/i.test(m.content || '') ? `<p class="p-scout-sources">Data: ${m.sources.map(esc).join(' · ')}</p>` : '';
  const bar = !live && m.content ? `<div class="p-scout-bar">
      <button type="button" class="s-icon-btn s-icon-btn-sm" data-act="copy" data-idx="${idx}" aria-label="Copy answer" title="Copy">${I.copy}</button>
      <button type="button" class="s-icon-btn s-icon-btn-sm" data-act="up" data-idx="${idx}" aria-label="Good answer" aria-pressed="${m.feedback === 'up'}" title="Good answer">${I.up}</button>
      <button type="button" class="s-icon-btn s-icon-btn-sm" data-act="down" data-idx="${idx}" aria-label="Bad answer" aria-pressed="${m.feedback === 'down'}" title="Bad answer">${I.down}</button>
    </div>` : '';
  return `<div class="p-scout-msg is-ai" data-idx="${idx}">${tools ? `<ul class="p-scout-tools">${tools}</ul>` : ''}${actions}${text}${sources}${notes}${bar}</div>`;
}
let rafPending = false;
function renderLive() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (pane !== 'chat' || !streaming) return render();
    const idx = current.messages.indexOf(streaming.msg);
    const el = body.querySelector(`.p-scout-msg[data-idx="${idx}"]`);
    if (!el) return renderChat();
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    el.outerHTML = messageHTML(streaming.msg, idx);
    if (atBottom) body.scrollTop = body.scrollHeight;
  });
}
function renderHistory() {
  const rel = t => { const d = (Date.now() - t) / 60000; return d < 1 ? 'just now' : d < 60 ? `${Math.floor(d)}m ago` : d < 1440 ? `${Math.floor(d / 60)}h ago` : fmt.date(t); };
  body.innerHTML = `<div class="p-scout-pane">
    <div class="p-scout-pane-head"><button type="button" class="s-icon-btn s-icon-btn-sm" data-act="back" aria-label="Back to chat">${I.back}</button><h3>Chat history</h3>
      <button type="button" class="s-btn s-btn-sm s-btn-ghost" data-act="new">${I.plus}New chat</button></div>
    ${confirmClear ? clearConfirmHTML() : ''}
    ${chats.length ? `<ul class="p-scout-history">${chats.map(c => `<li${current?.id === c.id ? ' class="is-current"' : ''}>
        <button type="button" class="p-scout-history-open" data-act="open-chat" data-id="${esc(c.id)}"><span class="p-scout-history-title">${esc(c.title || 'Untitled chat')}</span>
        <span class="p-scout-history-meta">${rel(c.updated)} · ${c.messages.filter(m => m.role === 'user').length} question${c.messages.filter(m => m.role === 'user').length === 1 ? '' : 's'}</span></button>
        <button type="button" class="s-icon-btn s-icon-btn-sm" data-act="delete-chat" data-id="${esc(c.id)}" aria-label="Delete chat ${esc(c.title || '')}" title="Delete">${I.trash}</button></li>`).join('')}</ul>
      <p class="p-scout-muted">The last ${MAX_CHATS} chats are kept in this browser only.</p>
      ${confirmClear ? '' : '<button type="button" class="s-btn s-btn-sm s-btn-ghost s-btn-danger" data-act="clear">Clear history</button>'}`
      : ui.empty('No chats yet. Your last 20 chats appear here.')}
  </div>`;
}
const clearConfirmHTML = () => `<div class="p-scout-confirm" role="alertdialog" aria-label="Clear chat history"><span>Delete all ${chats.length} saved chat${chats.length === 1 ? '' : 's'}? This can't be undone.</span>
  <span><button type="button" class="s-btn s-btn-sm s-btn-danger" data-act="clear-yes">Delete</button> <button type="button" class="s-btn s-btn-sm s-btn-ghost" data-act="clear-no">Cancel</button></span></div>`;
function renderSettings() {
  const row = (key, label, hint) => `<label class="p-scout-setting"><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}><span><strong>${esc(label)}</strong><small>${esc(hint)}</small></span></label>`;
  const state = aiStatus.configured === false ? `<span class="s-badge s-badge-warn">Not set up</span>` : aiStatus.configured ? `<span class="s-badge s-badge-up">Connected</span>` : `<span class="s-badge">Unknown</span>`;
  body.innerHTML = `<div class="p-scout-pane">
    <div class="p-scout-pane-head"><button type="button" class="s-icon-btn s-icon-btn-sm" data-act="back" aria-label="Back to chat">${I.back}</button><h3>Settings</h3></div>
    ${row('includeContext', 'Use open panels as context', 'Send short summaries of the panels on screen with each question.')}
    ${row('shareHoldings', 'Share my holdings', 'Send tickers, share counts and average cost from My Portfolio (no account names).')}
    ${row('detailed', 'Detailed answers', 'Longer explanations instead of short answers.')}
    ${row('enterSends', 'Enter sends', 'Shift+Enter adds a new line. When off, use ⌘/Ctrl+Enter to send.')}
    <div class="p-scout-status">Status ${state}${aiStatus.model ? `<span class="p-scout-muted">Model: ${esc(aiStatus.model)}</span>` : ''}</div>
    ${aiStatus.configured === false ? `<p class="p-scout-muted">${esc(NOT_SET_UP)}</p>` : ''}
    <div class="p-scout-pane-actions"><button type="button" class="s-btn s-btn-sm" data-act="clear">Clear chat history</button></div>
    ${confirmClear ? clearConfirmHTML() : ''}
  </div>`;
}
function renderAbout() {
  body.innerHTML = `<div class="p-scout-pane p-scout-about">
    <div class="p-scout-pane-head"><button type="button" class="s-icon-btn s-icon-btn-sm" data-act="back" aria-label="Back to chat">${I.back}</button><h3>About Ultimater AI</h3></div>
    <p>Ultimater AI answers with Anthropic's Claude models through this site's server. It can look up quotes, price history, company news and earnings dates, explain the panels you attach, and set up views, panels and alerts for you.</p>
    <p>What is sent: your question, recent messages in this chat, attached panels${settings.includeContext ? ', summaries of open panels' : ''}${settings.shareHoldings ? ', and your holdings (tickers, shares, average cost)' : ''}. Chats are saved only in this browser.</p>
    <p>Market data is usually delayed. Ultimater AI provides information, not financial advice. AI can make mistakes; double-check important answers.</p>
  </div>`;
}

// ---------- chat actions ----------
function newChat() { current = null; pane = 'chat'; confirmClear = false; render(); input.focus(); }
function ensureChat(firstText) {
  if (!current) { current = { id: uid(), title: clip(firstText.replace(/\s+/g, ' '), 70), created: Date.now(), updated: Date.now(), messages: [], attachments: [] }; chats.unshift(current); }
  return current;
}
function addChip(chip) {
  const c = { id:chip.id, getContext:chip.getContext, label: clip(chip.label || 'Panel', 48), text: clip(String(chip.text || ''), PANEL_CHARS), panelType: chip.panelType || null };
  pending = [...pending.filter(p => c.id ? p.id !== c.id : p.label !== c.label), c].slice(-6);
  renderChips();
}
function historyFor(chat) {
  const msgs = [];
  for (const m of chat.messages) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
    else if (m.content && (m.status === 'done' || m.status === 'stopped')) msgs.push({ role: 'assistant', content: clip(m.content, MAX_CHARS - 100) });
  }
  let h = msgs.slice(-MAX_HISTORY);
  while (h.length && h[0].role !== 'user') h = h.slice(1);
  while (h.reduce((n, m) => n + m.content.length, 0) > 38000 && h.length > 1) { h = h.slice(1); while (h.length && h[0].role !== 'user') h = h.slice(1); }
  return h;
}
function applyAction({ name, input: a }) {
  switch (name) {
    case 'create_view': bus.emit('view:create', { name: a.name, panels: a.panels }); return `Created view “${a.name}” with ${a.panels.length} panel${a.panels.length === 1 ? '' : 's'}`;
    case 'open_view': bus.emit('view:open', { id: a.id }); return `Opened view ${a.id}`;
    case 'set_symbol': bus.emit('search:select', { symbol: a.symbol }); return `Switched the view to ${a.symbol}`;
    case 'add_panel': bus.emit('panel:add', { type: a.type, state: a.state }); return `Added a ${getPanel(a.type)?.title || a.type} panel`;
    case 'create_alert': bus.emit('alerts:create', { symbol: a.symbol, price: a.value, condition: a.condition }); return `Alert set: ${a.symbol} ${a.condition} ${fmt.price(a.value)}`;
  }
  return null;
}
function onEvent(event, data, msg) {
  switch (event) {
    case 'text': msg.content += data.text || ''; break;
    case 'tool': {
      msg.tools ||= [];
      const t = msg.tools.find(x => x.id === data.id);
      if (t) Object.assign(t, { status: data.status, source: data.source || t.source });
      else msg.tools.push({ id: data.id, label: data.label || data.name, status: data.status, source: data.source || null });
      break;
    }
    case 'action': { const s = applyAction(data); if (s) (msg.actions ||= []).push(s); break; }
    case 'notice': if (data.kind === 'tool_limit') (msg.notices ||= []).push(data.message); break;
    case 'refusal': msg.status = 'refused'; msg.errorText = data.message; break;
    case 'error': msg.status = 'error'; msg.error = data.error; break;
    case 'done':
      msg.sources = data.sources || []; msg.model = data.model || null; msg.truncated = data.stop_reason === 'max_tokens';
      if (msg.status === 'streaming') msg.status = 'done';
      break;
  }
  renderLive();
}
async function readSSE(stream, handler) {
  const reader = stream.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = chunk.match(/^event: ?(.*)$/m)?.[1] || 'message';
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('');
      if (data) { try { handler(ev, JSON.parse(data)); } catch (e) { console.error('[pulse-ai] bad event', e); } }
    }
    if (done) break;
  }
}
async function send(text, { chips } = {}) {
  text = String(text || '').trim();
  if (!text || streaming) return;
  if (text.length > MAX_CHARS) { input.value = text; renderCount(); return; }
  pane = 'chat'; confirmClear = false;
  const chat = ensureChat(text);
  const attached = chips || pending;
  pending = [];
  chat.attachments = [...chat.attachments.filter(a => !attached.some(p => p.id&&a.id ? p.id===a.id : p.label === a.label)), ...attached].slice(-6);
  chat.messages.push({ role: 'user', content: text, chips: attached.map(c => c.label) });
  const msg = { role: 'assistant', content: '', tools: [], actions: [], status: 'streaming' };
  chat.messages.push(msg);
  chat.updated = Date.now();
  const controller = new AbortController();
  streaming = { controller, msg };
  input.value = ''; autosize(); render();
  try {
    await hydrateUntilAborted(controller.signal);
    if (controller.signal.aborted) return;
    const payload = { messages: historyFor({ messages: chat.messages.slice(0, -1) }), context: buildContext(chat.attachments) };
    const res = await fetch('/api/space/scout/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(payload), signal: controller.signal });
    if (!res.ok) {
      let err = null; try { err = await res.json(); } catch { /* not JSON */ }
      msg.status = 'error'; msg.error = err?.error || 'unavailable';
      if (err?.message && !ERRORS[msg.error]) msg.errorText = err.message;
      if (msg.error === 'rate_limited' && err?.retryAfter) msg.errorText = `You are sending messages quickly. Try again in ${err.retryAfter}s.`;
      if (msg.error === 'ai_not_configured') aiStatus.configured = false;
    } else {
      if (aiStatus.configured === null) aiStatus.configured = true;
      await readSSE(res.body, (ev, data) => onEvent(ev, data, msg));
      if (msg.status === 'streaming') { msg.status = msg.content ? 'stopped' : 'error'; if (!msg.content) msg.error = 'interrupted'; }
    }
  } catch (e) {
    if (e?.name === 'AbortError') msg.status = 'stopped';
    else { msg.status = 'error'; msg.error = 'network'; }
  } finally {
    streaming = null; chat.updated = Date.now();
    saveChats(); render();
  }
}
function stop() { streaming?.controller.abort(); }
function retry(idx) {
  if (!current || streaming) return;
  const user = current.messages[idx - 1];
  if (!user || user.role !== 'user') return;
  current.messages.splice(idx - 1, 2);
  send(user.content, { chips: [] });
}

// ---------- menu ----------
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; $('[data-act=menu]').setAttribute('aria-expanded', 'false'); }
function openMenu(btn) {
  if (menuEl) return closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 's-menu p-scout-menu'; menuEl.setAttribute('role', 'menu'); menuEl.setAttribute('aria-label', 'Ultimater AI');
  const items = [['new', I.plus, 'New chat'], ['history', I.history, 'Chat history'], ['clear', I.trash, 'Clear history'], ['settings', I.gear, 'Settings']];
  menuEl.innerHTML = items.map(([act, icon, label]) => `<button type="button" role="menuitem" data-menu="${act}">${icon}${label}</button>`).join('');
  document.body.append(menuEl);
  const r = btn.getBoundingClientRect();
  menuEl.style.top = `${r.bottom + 4}px`;
  menuEl.style.left = `${Math.max(8, Math.min(r.right - menuEl.offsetWidth, innerWidth - menuEl.offsetWidth - 8))}px`;
  btn.setAttribute('aria-expanded', 'true');
  const buttons = [...menuEl.querySelectorAll('[role=menuitem]')];
  buttons[0].focus();
  menuEl.addEventListener('keydown', e => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); btn.focus(); }
  });
  menuEl.addEventListener('click', e => {
    const act = e.target.closest('[data-menu]')?.dataset.menu; if (!act) return;
    closeMenu();
    if (act === 'new') newChat();
    else if (act === 'history') { pane = 'history'; confirmClear = false; render(); }
    else if (act === 'clear') { pane = 'history'; confirmClear = chats.length > 0; render(); }
    else if (act === 'settings') { pane = 'settings'; confirmClear = false; render(); }
  });
}
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-act=menu]')) closeMenu(); });

// ---------- events ----------
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; }
input.addEventListener('input', () => { autosize(); renderCount(); });
input.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const sendKey = settings.enterSends ? !e.shiftKey : (e.metaKey || e.ctrlKey);
  if (sendKey) { e.preventDefault(); if (!streaming) send(input.value); }
});
form.addEventListener('submit', e => { e.preventDefault(); if (streaming) stop(); else send(input.value); });
launcher.addEventListener('click', () => openDock());
root.addEventListener('keydown', e => { if (e.key === 'Escape' && layout.expanded && !menuEl) setLayout({ expanded: false }); });
root.addEventListener('change', e => {
  const key = e.target.dataset?.setting; if (!key) return;
  settings[key] = e.target.checked; saveSettings();
});
root.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
  const idx = Number(el.dataset.idx);
  switch (el.dataset.act) {
    case 'menu': return openMenu(el);
    case 'dock': return setLayout({ mode: layout.mode === 'docked' ? 'floating' : 'docked', expanded: false });
    case 'expand': return setLayout({ expanded: !layout.expanded });
    case 'hide': return setLayout({ open: false, expanded: false });
    case 'about': pane = pane === 'about' ? 'chat' : 'about'; return render();
    case 'back': pane = 'chat'; confirmClear = false; return render();
    case 'new': return newChat();
    case 'prompt': return send(el.textContent);
    case 'retry': return retry(idx);
    case 'stop': return stop();
    case 'unchip': {
      const i = Number(el.dataset.i);
      if (el.dataset.kept === '1' && current) current.attachments.splice(i, 1); else pending.splice(i, 1);
      if (current) saveChats();
      return renderChips();
    }
    case 'copy': {
      const m = current?.messages[idx]; if (!m) return;
      try { await navigator.clipboard.writeText(m.content); el.innerHTML = I.check; el.setAttribute('aria-label', 'Copied'); setTimeout(() => { el.innerHTML = I.copy; el.setAttribute('aria-label', 'Copy answer'); }, 1500); }
      catch { el.title = 'Copy failed'; }
      return;
    }
    case 'up': case 'down': {
      const m = current?.messages[idx]; if (!m) return;
      m.feedback = m.feedback === el.dataset.act ? null : el.dataset.act;
      saveChats(); return renderChat();
    }
    case 'open-chat': current = chats.find(c => c.id === el.dataset.id) || null; pending = []; pane = 'chat'; return render();
    case 'delete-chat': chats = chats.filter(c => c.id !== el.dataset.id); if (current?.id === el.dataset.id) current = null; saveChats(); return render();
    case 'clear': confirmClear = chats.length > 0; return render();
    case 'clear-no': confirmClear = false; return render();
    case 'clear-yes': chats = []; current = null; confirmClear = false; store.set('scout:chats', []); return render();
  }
});
// Drag the floating window by its header.
$('.p-scout-head').addEventListener('pointerdown', e => {
  if (root.dataset.mode !== 'floating' || e.target.closest('button')) return;
  const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
  const move = ev => {
    const left = Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)), top = Math.max(0, Math.min(innerHeight - 60, ev.clientY - dy));
    Object.assign(root.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
  };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); const b = root.getBoundingClientRect(); store.set('scout:pos', { left: Math.round(b.left), top: Math.round(b.top) }); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});

bus.on('ai:attach', ({id,attached,title,symbol,panelType,context,getContext}={}) => {
  const label = `${symbol ? symbol+' ' : ''}${title||getPanel(panelType)?.title||'Panel'}`;
  if(attached) {openDock();addChip({id,label,text:context,panelType,getContext});}
  else {pending=pending.filter(p=>p.id!==id);if(current)current.attachments=current.attachments.filter(p=>p.id!==id);renderChips();}
});
bus.on('portfolio:changed',()=>{holdingsGeneration++;linkedHoldings=null;});
bus.on('portfolio:selection',()=>{holdingsGeneration++;linkedHoldings=null;});
bus.on('ai:open', () => openDock());
bus.on('ai:ask', ({ prompt, context, panelType, label } = {}) => {
  openDock({ focus: !prompt });
  if (context) {
    const title = getPanel(panelType)?.title || 'Panel';
    const sym = currentSymbol();
    addChip({ label: label || (sym && getPanel(panelType)?.symbolLinked ? `${sym} ${title}` : title), text: context, panelType });
  }
  if (prompt) { pane = 'chat'; send(prompt); } else render();
});
bus.on('symbol', () => { if (pane === 'chat' && !current?.messages.length) renderChat(); });
const onView = d => { if (d && (d.id || d.name)) { view = { id: d.id || null, name: d.name || d.title || null }; if (pane === 'chat' && !current?.messages.length) renderChat(); } };
bus.on('view:open', onView);
bus.on('view:changed', onView);
bus.on('shell:ready', () => place());

async function checkStatus() {
  try {
    const res = await fetch('/api/space/scout/status', { headers: { Accept: 'application/json' } });
    if (res.ok) { const s = await res.json(); aiStatus = { configured: Boolean(s.configured), model: s.model || null }; }
  } catch { /* offline: leave unknown */ }
  render();
  bus.emit('ai:status', { ...aiStatus });
}

function init() { place(); render(); autosize(); checkStatus(); }
// Wait a tick so the shell (started right after this module loads) can create #space-dock first.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
else setTimeout(init, 0);

// ---------- ai-recap panel ----------
registerPanel('ai-recap', {
  title: 'AI Daily Recap', category: 'AI', defaultSize: { w: 4, h: 8 }, symbolLinked: true,
  mount(el, ctx) {
    let ctrl = null, data = null, editing = false, err = null, requestSeq = 0;
    el.classList.add('p-scout-recap');
    const symbols = () => {
      const own = Array.isArray(ctx.state?.symbols) ? ctx.state.symbols.filter(s => SYMBOL.test(s)) : [];
      if (own.length) return own.slice(0, 12);
      const set = new Set([ctx.symbol, ...holdings().sort((a, b) => b.shares * (b.avgCost || 1) - a.shares * (a.avgCost || 1)).map(h => h.ticker)].filter(Boolean));
      return [...set].slice(0, 10);
    };
    const cacheKey = () => 'scout:recap:' + symbols().join(',') + '|' + (settings.shareHoldings ? 'h' : '');
    async function load(fresh = false) {
      const ticket = ++requestSeq; ctrl?.abort();
      await hydrateHoldings();
      if(ticket!==requestSeq)return;
      const syms = symbols(), key = cacheKey() + '|' + JSON.stringify(holdings());
      if (!syms.length) { data = null; err = 'empty'; return paint(); }
      const cached = store.get(key, null);
      if (!fresh && cached && Date.now() - cached.at < 30 * 60000 && new Date(cached.at).toDateString() === new Date().toDateString()) { data = cached.data; err = null; return paint(); }
      ctrl?.abort(); ctrl = new AbortController();
      err = null; data = null; el.innerHTML = ui.loading('Writing today’s recap…');
      try {
        const res = await fetch('/api/space/scout/recap', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, signal: ctrl.signal,
          body: JSON.stringify({ symbols: syms, holdingsSummary: holdingsSummary() || undefined, view: view.name || view.id || undefined, fresh }) });
        let b = null; try { b = await res.json(); } catch { /* not JSON */ }
        if (ticket !== requestSeq || ctrl.signal.aborted) return;
        if (!res.ok) { err = b?.error || 'unavailable'; if (err === 'ai_not_configured') aiStatus.configured = false; err = { code: err, message: b?.message }; return paint(); }
        data = b; store.set(key, { at: Date.now(), data: b });
      } catch (e) { if (e?.name === 'AbortError' || ticket !== requestSeq) return; err = { code: 'network' }; }
      paint();
    }
    function paint() {
      if (err === 'empty') {
        el.innerHTML = ui.empty('Link a symbol or add holdings in My Portfolio to get a daily recap.') ;
        return;
      }
      if (err?.code === 'ai_not_configured') { el.innerHTML = ui.unavailable('AI daily recap', NOT_SET_UP); return; }
      if (err) { el.innerHTML = ui.error(err.message || ERRORS[err.code] || 'Could not write the recap right now.'); el.querySelector('[data-retry]')?.addEventListener('click', () => load(true)); return; }
      if (!data) return;
      const syms = data.symbols || symbols();
      el.innerHTML = `<div class="p-scout-recap-head">
          <span class="p-scout-recap-label">${I.spark}Daily recap</span>
          <span class="p-scout-muted">${esc(fmt.time(data.asOf))}${data.cached ? ' · saved' : ''}</span>
          <span class="p-scout-grow"></span>
          <button type="button" class="s-icon-btn s-icon-btn-sm" data-r="edit" aria-label="Edit recap symbols" title="Edit symbols">${I.gear}</button>
          <button type="button" class="s-icon-btn s-icon-btn-sm" data-r="ask" aria-label="Ask Ultimater AI about this recap" title="Ask a follow-up">${I.spark}</button>
          <button type="button" class="s-btn s-btn-sm" data-r="regen">${I.refresh}Regenerate</button>
        </div>
        ${editing ? `<form class="p-scout-recap-edit" data-r="form"><label class="s-sr" for="rc-${ctx.type}-sym">Symbols</label><input id="rc-${ctx.type}-sym" class="s-input" value="${esc(syms.join(', '))}" placeholder="NVDA, AAPL, BTC-USD"><button class="s-btn s-btn-sm s-btn-primary">Save</button><button type="button" class="s-btn s-btn-sm s-btn-ghost" data-r="auto">Use linked + holdings</button></form>` : ''}
        <div class="p-scout-recap-syms">${syms.map(s => `<span class="s-chip">${esc(s)}</span>`).join('')}</div>
        <div class="p-scout-md p-scout-recap-text">${renderMarkdown(data.recap)}</div>
        <p class="p-scout-muted p-scout-recap-foot">AI-generated from ${esc((data.sources || []).length ? 'delayed quotes' : 'your data')}. Not financial advice. AI can make mistakes.</p>`;
    }
    el.addEventListener('click', e => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (r === 'regen') load(true);
      else if (r === 'edit') { editing = !editing; paint(); el.querySelector('.p-scout-recap-edit input')?.focus(); }
      else if (r === 'auto') { ctx.setState({ symbols: null }); editing = false; load(); }
      else if (r === 'ask' && data) bus.emit('ai:ask', { prompt: '', context: data.recap, panelType: 'ai-recap', label: 'Daily recap' });
    });
    el.addEventListener('submit', e => {
      e.preventDefault();
      const list = [...new Set(el.querySelector('.p-scout-recap-edit input').value.toUpperCase().split(/[\s,]+/).filter(s => SYMBOL.test(s)))].slice(0, 12);
      ctx.setState({ symbols: list.length ? list : null }); editing = false; load();
    });
    const refreshPortfolio = () => { if (!ctx.state?.symbols?.length) load(); };
    const offPortfolioSelection = bus.on('portfolio:selection', refreshPortfolio);
    const offPortfolioChanged = bus.on('portfolio:changed', refreshPortfolio);
    load();
    return {
      onSymbol() { if (!ctx.state?.symbols?.length) load(); },
      csv() { return null; },
      scoutContext() { return data ? `AI daily recap for ${(data.symbols || []).join(', ')} as of ${fmt.time(data.asOf)}: ${data.recap}` : ''; },
      destroy() { requestSeq++; offPortfolioSelection(); offPortfolioChanged(); ctrl?.abort(); }
    };
  }
});
