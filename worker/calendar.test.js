import test from 'node:test';
import assert from 'node:assert/strict';
import {calendar} from './calendar.js';
import worker from './index.js';

test('calendar filters by watchlist and Eastern date and preserves partial coverage', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const ticker = url.split('/').at(-2);
    requests.push(ticker);
    if (ticker === 'FAIL') return new Response('', {status:503});
    const reportText = {WMT:'Expected to report earnings on 11/19/2026 before market open.',
      OLD:'Expected to report earnings on 11/04/2026.', LATE:'Expected to report earnings on 02/01/2027.'}[ticker] || '';
    return Response.json({status:{rCode:200},data:{reportText}});
  });
  const result = await calendar(['ASML','WMT','OLD','LATE','FAIL','AAPL'], new Date('2026-11-06T01:00:00Z'));
  assert.equal(result.from,'2026-11-05');
  assert.equal(result.to,'2027-01-31');
  assert.deepEqual(result.events.filter(e=>e.ticker).map(e=>[e.ticker,e.date,e.status]),
    [['AMAT','2026-11-12','Company-announced'],['WMT','2026-11-19','Estimated'],['ASML','2027-01-27','Company-announced']]);
  assert.ok(result.events.some(e=>e.date==='2026-11-10' && !e.ticker));
  assert.deepEqual(result.unavailable,['FAIL']);
  assert.deepEqual(result.unlisted,['OLD','LATE','AAPL','INTC','AVGO']);
  assert.ok(!requests.includes('ASML'));
});
test('calendar rejects non-ticker queries before contacting providers', async () => {
  const response = await worker.fetch(new Request('https://pulse.test/api/calendar?tickers=Some%20Company'),{});
  assert.equal(response.status,400);
});

test('one reporting event explains multiple holdings, with no second-hop expansion', async t => {
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async url => {
    fetched.push(url.split('/').at(-2));
    return Response.json({status:{rCode:200},data:{reportText:''}});
  });
  const now = new Date('2026-11-06T12:00:00Z');
  const result = await calendar(['MSFT','META'], now);
  const reports = result.events.filter(event => event.ticker);
  assert.equal(reports.length,1);
  assert.equal(reports[0].ticker,'NVDA');
  assert.equal(reports[0].scope,'related');
  assert.deepEqual(reports[0].connections.map(item => item.holding),['MSFT','META']);
  assert.ok(!fetched.includes('AMZN'));
  const both = await calendar(['NVDA','MSFT'], now);
  assert.equal(both.events.filter(event => event.ticker === 'NVDA').length,1);
  assert.equal(both.events.find(event => event.ticker === 'NVDA').scope,'watchlist');
});

test('provider peers skip watched companies and share one earnings lookup; failures stay isolated', async t => {
  const requests = [];
  t.mock.method(globalThis,'fetch', async url => {
    const symbol = url.split('/').at(-2);
    requests.push(symbol);
    return Response.json({status:{rCode:200},data:{reportText:symbol === 'TGT' ? '11/18/2026' : ''}});
  });
  const result = await calendar(['WMT','COST','FAIL'],new Date('2026-11-06T18:00:00Z'),async symbol => {
    if (symbol === 'FAIL') throw new Error('Unavailable');
    return [symbol,'WMT','COST','TGT'];
  });
  assert.deepEqual(result.peerErrors,['FAIL']);
  assert.equal(requests.filter(ticker=>ticker==='TGT').length,1);
  const peer = result.events.find(event=>event.ticker==='TGT');
  assert.equal(peer.scope,'related');
  assert.deepEqual(peer.connections.map(link=>link.holding),['WMT','COST']);
});
