import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceRoute } from './router.js';
import { resetScoutForTests, echoBlocks, validateAction, LIMITS } from './scout.js';
import { resetSpaceUpstreamForTests } from './upstream.js';

const KEY = 'test-anthropic-key-not-real';
const env = { ANTHROPIC_API_KEY: KEY };
const post = (path, body, headers = {}) => new Request('https://pulse.test/api/space/scout/' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.' + Math.floor(Math.random() * 250), ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const ask = (content = 'How is NVDA doing?', extra = {}) => ({ messages: [{ role: 'user', content }], context: { view: 'Markets', symbols: ['NVDA'], panels: ['NVDA quote: 159.38'] }, ...extra });

// Anthropic SSE body from a list of event objects.
const sse = events => new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const textTurn = (text, stop = 'end_turn') => [
  { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-5-5', content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...text.match(/.{1,6}/gs).map(t => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5 } },
  { type: 'message_stop' }
];
const toolTurn = (name, input, id = 'toolu_1') => [
  { type: 'message_start', message: { id: 'msg_t', model: 'claude-sonnet-5-5', content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name, input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(0, 5) } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(5) } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  { type: 'message_stop' }
];

// Stub fetch: `anthropic` handles calls to api.anthropic.com, `other` handles data providers.
function stub({ anthropic, other = () => new Response('not found', { status: 404 }) }) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.anthropic.com') {
      assert.equal(init.headers['x-api-key'], KEY);
      assert.ok(!String(url).includes(KEY));
      const body = JSON.parse(init.body);
      calls.push(body);
      return anthropic(body, calls.length, init);
    }
    return other(u);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
async function readSSE(res) {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map(chunk => {
    const event = chunk.match(/^event: (.*)$/m)[1];
    return { event, data: JSON.parse(chunk.match(/^data: (.*)$/m)[1]) };
  });
}
const reset = () => { resetScoutForTests(); resetSpaceUpstreamForTests(); };

test('not configured: chat and recap return 503 ai_not_configured without calling out', async () => {
  reset();
  const s = stub({ anthropic: () => assert.fail('must not call Anthropic') });
  try {
    for (const path of ['chat', 'recap']) {
      const res = await spaceRoute(post(path, ask()), {}, {});
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error, 'ai_not_configured');
    }
    const status = await (await spaceRoute(new Request('https://pulse.test/api/space/scout/status'), {}, {})).json();
    assert.deepEqual(status, { configured: false, model: 'claude-sonnet-5-5' });
    const st2 = await (await spaceRoute(new Request('https://pulse.test/api/space/scout/status'), { ANTHROPIC_API_KEY: KEY, PULSE_AI_MODEL: 'claude-opus-5-5' }, {})).text();
    assert.ok(!st2.includes(KEY));
    assert.equal(JSON.parse(st2).model, 'claude-opus-5-5');
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test('GET chat is rejected and unknown routes 404', async () => {
  reset();
  assert.equal((await spaceRoute(new Request('https://pulse.test/api/space/scout/chat'), env, {})).status, 405);
  assert.equal((await spaceRoute(post('nope', {}), env, {})).status, 404);
});

test('streaming passthrough: text deltas arrive as SSE text events with request shape', async () => {
  reset();
  const s = stub({ anthropic: () => sse(textTurn('NVDA fell **8%** after hours.')) });
  try {
    const res = await spaceRoute(post('chat', ask()), env, {});
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type'), /text\/event-stream/);
    const events = await readSSE(res);
    assert.equal(events.filter(e => e.event === 'text').map(e => e.data.text).join(''), 'NVDA fell **8%** after hours.');
    const done = events.at(-1);
    assert.equal(done.event, 'done');
    assert.equal(done.data.stop_reason, 'end_turn');
    const body = s.calls[0];
    assert.equal(body.model, 'claude-sonnet-5-5');
    assert.equal(body.stream, true);
    assert.equal(body.fallbacks, 'default');
    assert.equal(body.output_config.effort, 'low');
    assert.ok(!('thinking' in body) && !('temperature' in body) && !('tool_choice' in body));
    assert.ok(body.tools.some(t => t.name === 'create_view'));
    assert.match(body.system[0].text, /Ultimater AI/);
    assert.ok(!/yahoo|scout/i.test(body.system[0].text));
    assert.match(body.system[1].text, /NVDA quote: 159\.38/);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'How is NVDA doing?' }]);
  } finally { s.restore(); }
});

test('PULSE_AI_MODEL overrides the model; fallbacks only for models that accept them', async () => {
  reset();
  const s = stub({ anthropic: (body, n, init) => { assert.equal(init.headers['anthropic-beta'], undefined); return sse(textTurn('ok')); } });
  try {
    await (await spaceRoute(post('chat', ask()), { ...env, PULSE_AI_MODEL: 'claude-haiku-5-5' }, {})).text();
    assert.equal(s.calls[0].model, 'claude-haiku-5-5');
    assert.ok(!('fallbacks' in s.calls[0]));
  } finally { s.restore(); }
});

test('tool call round trip: server tool runs, thinking is echoed unchanged, result goes back', async () => {
  reset();
  const s = stub({
    anthropic: (body, n) => n === 1 ? sse(toolTurn('get_quote', { symbol: 'nvda' })) : sse(textTurn('NVDA is $159.38.\nSources: Nasdaq')),
    other: u => {
      assert.equal(u.hostname, 'api.nasdaq.com');
      assert.equal(u.pathname, '/api/quote/NVDA/info');
      return Response.json({ data: { symbol: 'NVDA', companyName: 'NVIDIA Corporation', marketStatus: 'After-Hours', primaryData: { lastSalePrice: '$159.38', netChange: '-14.35', percentageChange: '-8.26%', lastTradeTimestamp: 'Nov 11, 2026 5:58 PM ET', isRealTime: false }, keyStats: {} }, status: { rCode: 200 } });
    }
  });
  try {
    const events = await readSSE(await spaceRoute(post('chat', ask()), env, {}));
    const tools = events.filter(e => e.event === 'tool');
    assert.deepEqual(tools.map(t => t.data.status), ['start', 'done']);
    assert.equal(tools[0].data.label, 'Checking nvda quote');
    assert.equal(s.calls.length, 2);
    const [assistant, user] = s.calls[1].messages.slice(1);
    assert.equal(assistant.role, 'assistant');
    assert.deepEqual(assistant.content[0], { type: 'thinking', thinking: '', signature: 'sig-abc' });
    assert.deepEqual(assistant.content[1], { type: 'tool_use', id: 'toolu_1', name: 'get_quote', input: { symbol: 'nvda' } });
    assert.equal(user.content[0].type, 'tool_result');
    assert.equal(user.content[0].tool_use_id, 'toolu_1');
    const result = JSON.parse(user.content[0].content);
    assert.equal(result.price, 159.38);
    assert.equal(result.changePercent, -8.26);
    assert.match(result.source, /Nasdaq quote for NVDA \(delayed\)/);
    const done = events.at(-1).data;
    assert.deepEqual(done.sources, ['Nasdaq quote for NVDA (delayed)']);
    assert.match(events.filter(e => e.event === 'text').map(e => e.data.text).join(''), /\$159\.38/);
  } finally { s.restore(); }
});

test('action tool: validated action event reaches the browser and the model gets a confirmation', async () => {
  reset();
  const s = stub({ anthropic: (body, n) => n === 1
    ? sse(toolTurn('create_view', { name: 'Semis', panels: [{ type: 'chart', state: { symbol: 'nvda', evil: { x: 1 } } }, { type: 'news' }] }))
    : sse(textTurn('Created **Semis**.')) });
  try {
    const events = await readSSE(await spaceRoute(post('chat', ask('Set up my workspace for semis')), env, {}));
    const action = events.find(e => e.event === 'action');
    assert.deepEqual(action.data, { name: 'create_view', input: { name: 'Semis', panels: [{ type: 'chart', state: { symbol: 'NVDA' } }, { type: 'news', state: {} }] } });
    assert.match(s.calls[1].messages.at(-1).content[0].content, /"ok":true/);
  } finally { s.restore(); }
});

test('invalid tool input becomes an error tool_result, not a crash', async () => {
  reset();
  const s = stub({ anthropic: (body, n) => n === 1 ? sse(toolTurn('add_panel', { type: 'not-a-panel' })) : sse(textTurn('Sorry.')) });
  try {
    const events = await readSSE(await spaceRoute(post('chat', ask()), env, {}));
    assert.ok(!events.some(e => e.event === 'action'));
    const tr = s.calls[1].messages.at(-1).content[0];
    assert.equal(tr.is_error, true);
    assert.match(tr.content, /Unknown panel type/);
    assert.equal(events.at(-1).event, 'done');
  } finally { s.restore(); }
});

test('input validation: shape, roles, sizes and context', async () => {
  reset();
  const s = stub({ anthropic: () => assert.fail('must not call Anthropic') });
  const cases = [
    ['{not json', 400, 'invalid_json'],
    [{ messages: [] }, 400, 'invalid_request'],
    [{ messages: [{ role: 'system', content: 'x' }] }, 400, 'invalid_request'],
    [{ messages: [{ role: 'assistant', content: 'hi' }] }, 400, 'invalid_request'],
    [{ messages: [{ role: 'user', content: '   ' }] }, 400, 'invalid_request'],
    [{ messages: Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'q' })) }, 400, 'invalid_request'],
    [{ messages: [{ role: 'user', content: 'x'.repeat(LIMITS.messageChars + 1) }] }, 413, 'input_too_large'],
    [{ messages: [{ role: 'user', content: 'hi' }], context: { symbols: ['$$$'] } }, 400, 'invalid_request'],
    [{ messages: [{ role: 'user', content: 'hi' }], context: { panels: Array(13).fill('p') } }, 400, 'invalid_request'],
    ['x'.repeat(LIMITS.bodyChars + 1), 413, 'input_too_large']
  ];
  try {
    for (const [body, status, error] of cases) {
      const res = await spaceRoute(post('chat', body), env, {});
      assert.equal(res.status, status, JSON.stringify(body).slice(0, 80));
      assert.equal((await res.json()).error, error);
    }
  } finally { s.restore(); }
});

test('rate limit: per-IP bucket returns 429 with Retry-After', async () => {
  reset();
  const s = stub({ anthropic: () => sse(textTurn('ok')) });
  try {
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      const res = await spaceRoute(post('chat', ask(), { 'CF-Connecting-IP': '198.51.100.7' }), env, {});
      statuses.push(res.status);
      if (res.status === 429) { assert.ok(Number(res.headers.get('Retry-After')) > 0); assert.equal((await res.json()).error, 'rate_limited'); }
      else await res.text();
    }
    assert.deepEqual(statuses, [...Array(8).fill(200), 429, 429]);
    const other = await spaceRoute(post('chat', ask(), { 'CF-Connecting-IP': '198.51.100.8' }), env, {});
    assert.equal(other.status, 200); await other.text();
  } finally { s.restore(); }
});

test('upstream errors map to stable codes and never echo the key', async () => {
  reset();
  for (const [status, code, ours] of [[401, 'ai_auth_failed', 502], [429, 'ai_rate_limited', 429], [529, 'ai_overloaded', 503], [404, 'ai_model_unavailable', 502]]) {
    const s = stub({ anthropic: () => Response.json({ type: 'error', error: { type: 'x', message: 'bad key ' + KEY } }, { status }) });
    try {
      const res = await spaceRoute(post('chat', ask()), env, {});
      assert.equal(res.status, ours);
      const text = await res.text();
      assert.equal(JSON.parse(text).error, code);
      assert.ok(!text.includes(KEY));
    } finally { s.restore(); }
  }
});

test('refusal and mid-stream errors surface as SSE events', async () => {
  reset();
  let s = stub({ anthropic: () => sse([{ type: 'message_start', message: { model: 'claude-sonnet-5-5' } }, { type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } } }]) });
  try {
    const events = await readSSE(await spaceRoute(post('chat', ask()), env, {}));
    assert.equal(events.find(e => e.event === 'refusal').data.category, 'cyber');
  } finally { s.restore(); }
  s = stub({ anthropic: () => sse([{ type: 'message_start', message: {} }, { type: 'error', error: { type: 'overloaded_error' } }]) });
  try {
    const events = await readSSE(await spaceRoute(post('chat', ask()), env, {}));
    assert.deepEqual(events.at(-1), { event: 'error', data: { error: 'ai_overloaded' } });
  } finally { s.restore(); }
});

test('echoBlocks drops pre-fallback thinking/tool_use but keeps text and the fallback block', () => {
  const blocks = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'partial' }, { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } }, { type: 'thinking', thinking: '', signature: 't' }, { type: 'tool_use', id: 'x', name: 'get_quote', input: {} }];
  assert.deepEqual(echoBlocks(blocks).map(b => b.type), ['text', 'fallback', 'thinking', 'tool_use']);
  assert.equal(echoBlocks(blocks.slice(0, 2)).length, 2);
});

test('validateAction normalizes alerts and rejects bad input', () => {
  assert.deepEqual(validateAction('create_alert', { symbol: 'aapl', condition: 'below', value: '180' }), { symbol: 'AAPL', condition: 'below', value: 180 });
  assert.throws(() => validateAction('create_alert', { symbol: 'AAPL', condition: 'near', value: 1 }));
  assert.throws(() => validateAction('open_view', { id: '../x' }));
  assert.deepEqual(validateAction('set_symbol', { symbol: 'btc-usd' }), { symbol: 'BTC-USD' });
});

test('recap: fetches quotes, returns JSON recap, caches unless fresh', async () => {
  reset();
  const s = stub({
    anthropic: (body) => {
      assert.ok(!body.stream && !body.tools);
      assert.match(body.messages[0].content, /AAPL/);
      return Response.json({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '**Tech slipped.**\n- AAPL -1%' }] });
    },
    other: u => Response.json({ data: { primaryData: { lastSalePrice: '$200.00', netChange: '-2', percentageChange: '-1%', isRealTime: true } }, status: { rCode: 200 } })
  });
  try {
    const r1 = await (await spaceRoute(post('recap', { symbols: ['AAPL'], holdingsSummary: 'AAPL 10 sh' }), env, {})).json();
    assert.equal(r1.recap, '**Tech slipped.**\n- AAPL -1%');
    assert.deepEqual(r1.symbols, ['AAPL']);
    assert.deepEqual(r1.sources, ['Nasdaq quote for AAPL']);
    const r2 = await (await spaceRoute(post('recap', { symbols: ['AAPL'], holdingsSummary: 'AAPL 10 sh' }), env, {})).json();
    assert.equal(r2.cached, true);
    assert.equal(s.calls.length, 1);
    await (await spaceRoute(post('recap', { symbols: ['AAPL'], holdingsSummary: 'AAPL 10 sh', fresh: true }), env, {})).json();
    assert.equal(s.calls.length, 2);
    const badRes = await spaceRoute(post('recap', {}), env, {});
    assert.equal(badRes.status, 400);
  } finally { s.restore(); }
});
