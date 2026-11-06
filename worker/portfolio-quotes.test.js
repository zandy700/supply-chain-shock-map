import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {resetUpstreamStateForTests} from './index.js';

const quoteRequest = tickers => new Request('https://pulse.test/api/portfolio-quotes?tickers=' + encodeURIComponent(tickers));
const env = {FINNHUB_API_KEY:'fake-test-key'};

test('portfolio quotes normalize and cache symbols, retaining available quotes and missing previous close', async t => {
  resetUpstreamStateForTests();
  const requests = [];
  t.mock.method(globalThis,'fetch', async (url, options) => {
    assert.equal(url.pathname,'/api/v1/quote');
    assert.deepEqual([...url.searchParams.keys()],['symbol']);
    assert.equal(options.headers['X-Finnhub-Token'], env.FINNHUB_API_KEY);
    const ticker = url.searchParams.get('symbol');
    requests.push(ticker);
    if (ticker === 'ERR') return new Response('', {status:503});
    if (ticker === 'ZERO') return Response.json({c:0,pc:0,t:0});
    return Response.json({c:101,pc:ticker === 'ASML' ? 97 : 0,t:1700000000});
  });
  const load = async tickers => (await worker.fetch(quoteRequest(tickers), env)).json();
  const result = await load('asml,AsMl,BRK.B,ERR,ZERO');
  assert.deepEqual(result, {prices:{
    ASML:{price:101,previous:97,asOf:'2023-11-14T22:13:20.000Z'},
    'BRK.B':{price:101,previous:null,asOf:'2023-11-14T22:13:20.000Z'}
  }, unavailable:['ERR','ZERO']});
  await load('ASML,BRK.B');
  assert.deepEqual(requests,['ASML','BRK.B','ERR','ZERO']);
});

test('portfolio quotes reject invalid input without upstream requests and identify missing-key quotes', async t => {
  resetUpstreamStateForTests();
  const fetches = t.mock.method(globalThis,'fetch',() => { throw new Error('Unexpected request'); });
  for (const input of ['', 'Example Company', 'A,B,C,D,E,F,G,H,I,J,K,L,M']) {
    assert.equal((await worker.fetch(quoteRequest(input),env)).status,400);
  }
  assert.deepEqual(await (await worker.fetch(quoteRequest('ASML,BRK.B'),{})).json(), {prices:{},unavailable:['ASML','BRK.B']});
  assert.equal(fetches.mock.callCount(),0);
});
