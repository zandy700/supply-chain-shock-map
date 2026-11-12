import test from 'node:test';
import assert from 'node:assert/strict';
import { getPanel } from '../../web/space/core.js';
import '../../web/space/panels/markets.js';
import { loadMoverAsset } from '../../web/space/panels/markets.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('mover tabs share one validated selection path with title variants and keyboard controls', async () => {
  const original = { fetch: globalThis.fetch, location: globalThis.location, document: globalThis.document, window: globalThis.window };
  const calls = [], selected = [], saved = [], focused = [], handlers = new Map();
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', scrollTop: 0, scrollLeft: 0,
      classList: { toggle() {} }, contains: () => false, querySelectorAll: () => [],
      querySelector: selector => selector.startsWith('[data-market-variant=') ? { focus() { focused.push(selector); } } : null });
    return nodes.get(selector);
  };
  const el = { isConnected: true, innerHTML: '', querySelector: node,
    addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  globalThis.location = { origin: 'https://test.invalid' };
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible', activeElement: null });
  globalThis.window = Object.assign(new EventTarget(), { navigator: { onLine: true } });
  globalThis.fetch = async url => { calls.push(new URL(url)); return Response.json({ rows: [{ symbol: 'NVDA', price: 100 }], source: 'fixture' }); };
  let panel;
  try {
    panel = getPanel('stock-movers').mount(el, { id: 'test-movers', state: {}, variant: 'most-active',
      setVariant: id => selected.push(id), setState: patch => saved.push(patch), openSymbol() {} });
    await tick();
    assert.equal(calls.length, 1);
    assert.match(node('.p-market-toolbar').innerHTML, /role="tablist"/);
    assert.match(node('.p-market-toolbar').innerHTML, /data-market-variant="most-active" aria-selected="true"/);
    const target = id => ({ closest: () => ({ dataset: { marketVariant: id }, hasAttribute: () => false }) });
    handlers.get('click')({ target: target('gainers') }); await tick();
    assert.equal(calls.at(-1).searchParams.get('type'), 'gainers');
    assert.equal(calls.length, 2);
    assert.equal(selected.at(-1), 'gainers');
    assert.equal(saved.at(-1).variant, 'gainers');
    handlers.get('click')({ target: target('gainers') }); panel.onVariant('invalid'); await tick();
    assert.equal(calls.length, 2, 'active and invalid selections must not fetch');
    let prevented = false;
    handlers.get('keydown')({ target: target('gainers'), key: 'ArrowRight', preventDefault() { prevented = true; } });
    await tick(); assert.equal(prevented, true);
    assert.equal(calls.at(-1).searchParams.get('type'), 'losers');
    assert.match(focused.at(-1), /losers/);
    panel.onVariant('trending'); await tick();
    assert.equal(calls.length, 4, 'title selection shares a single fetch');
    assert.match(node('.p-market-toolbar').innerHTML, /data-market-variant="trending" aria-selected="true"/);
    assert.match(node('.p-market-toolbar').innerHTML, /Market list settings/);
    handlers.get('change')({target:{dataset:{control:'asset'},value:'funds'}});await tick();
    assert.equal(calls.length,4,'an unavailable asset feed must not request fabricated quotes');
    assert.match(node('.p-market-body').innerHTML,/Mutual Funds needs a connected/);
    handlers.get('change')({target:{dataset:{control:'asset'},value:'stocks'}});await tick();
    assert.equal(calls.at(-1).searchParams.get('type'),'most-active');
    for(const id of ['most-active','gainers','losers']){handlers.get('change')({target:{dataset:{marketTabChoice:id},checked:false}});await tick();}
    const last={dataset:{marketTabChoice:'trending'},checked:false};
    handlers.get('change')({target:last});await tick();
    assert.equal(last.checked,true,'a settings change must preserve one accessible tab');
    assert.match(node('.p-market-message').textContent,/at least one tab/);
    panel.destroy(); panel = null; assert.equal(handlers.size, 0);
  } finally {
    panel?.destroy(); Object.assign(globalThis, original);
  }
});

test('market asset samples keep their real source boundaries and unsupported feeds make no requests',async()=>{
  const original={fetch:globalThis.fetch,location:globalThis.location};const calls=[];
  globalThis.location={origin:'https://test.invalid'};
  globalThis.fetch=async raw=>{const url=new URL(raw);calls.push(url);return Response.json({quotes:[{symbol:'US10Y',price:4.2,source:'US Treasury',asOf:'2026-11-10',label:'10Y Yield'}],missing:['US2Y']});};
  try{
    const bonds=await loadMoverAsset('bonds');assert.match(bonds.notice,/not individual bond prices/);assert.equal(bonds.rows[0].asOf,'2026-11-10');assert.equal(bonds.rows[0].name,'10Y Yield');assert.match(calls[0].searchParams.get('symbols'),/US10Y/);
    for(const asset of ['funds','options','futures'])assert.match((await loadMoverAsset(asset)).unavailable,/connected market-wide data feed/);
    assert.equal(calls.length,1);
    const fx=await loadMoverAsset('currencies');assert.match(fx.definition,/Daily ECB/);assert.match(calls.at(-1).searchParams.get('symbols'),/EURUSD/);
  }finally{Object.assign(globalThis,original);}
});
