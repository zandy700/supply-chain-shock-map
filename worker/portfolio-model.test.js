import test from 'node:test';
import assert from 'node:assert/strict';
import {readPortfolios,writePortfolios,summarize,combinedHistory} from '../web/portfolio-model.js';

const sample = (id, holdings, history = []) => ({id, name:id, cash:100, holdings, history});
const holding = (shares,cost,ticker='AAPL') => ({ticker,shares,cost});

test('two portfolios combine cash and share-weighted costs with consistent percentage denominators', () => {
  const accounts = [sample('a',[holding(2,8)]), sample('b',[holding(1,11)])];
  const summary = summarize(accounts, {AAPL:{price:12,previous:10}});
  assert.deepEqual(summary.rows,[{ticker:'AAPL',shares:3,cost:9,price:12,value:36,dayChange:6,gain:9}]);
  assert.equal(summary.value,236);
  assert.equal(summary.cash,200);
  assert.equal(summary.dayPercent,600/230);
  assert.equal(summary.gainPercent,900/27);
});

test('absent price, prior quote or cost only hides affected calculations', () => {
  const accounts = [sample('a',[holding(1,8), holding(2,null,'ASML')])];
  const prices = {AAPL:{price:12,previous:10}, ASML:{price:23}};
  const partial = summarize(accounts,prices);
  assert.equal(partial.value,158);
  assert.equal(partial.gain,null);
  assert.equal(partial.gainPercent,null);
  assert.equal(partial.dayChange,null);
  assert.equal(partial.rows[0].gain,4);
  const missing = summarize(accounts,{AAPL:prices.AAPL});
  assert.equal(missing.value,null);
  assert.equal(missing.rows[1].price,null);
  assert.equal(missing.dayPercent,null);
  assert.equal(summarize([sample('a',[holding(1,0)])],prices).gainPercent,null);
});

test('combined chart uses the intersection of observed dates even for empty accounts', () => {
  const a = sample('a',[],[{date:'2026-07-01',value:18},{date:'2026-06-01',value:10}]);
  const b = sample('b',[],[{date:'2026-06-01',value:20},{date:'2026-08-01',value:0}]);
  assert.deepEqual(combinedHistory([a,b]),[{date:'2026-06-01',value:30}]);
  assert.deepEqual(combinedHistory([a,sample('c',[])]),[]);
  assert.deepEqual(combinedHistory([]),[]);
});

test('storage validation is atomic and leaves unreadable existing data untouched', () => {
  let saved = null;
  const storage = {getItem:() => saved, setItem:(_,next) => { saved = next; }};
  assert.deepEqual(readPortfolios(storage),[]);
  const account = sample('one',[holding(.25,3,'brk.b')]);
  const normalized = writePortfolios([account],storage);
  assert.equal(normalized[0].holdings[0].ticker,'BRK.B');
  assert.deepEqual(readPortfolios(storage),normalized);
  for (const holdings of [[holding(NaN,2)], [holding(0,2)], [holding(1,-1)], [holding(2,3),holding(1,4,'aapl')]]) {
    assert.throws(() => writePortfolios([{...account,holdings}],storage));
    assert.deepEqual(readPortfolios(storage),normalized);
  }
  assert.throws(() => writePortfolios([{...account,history:[{date:'2026-02-30',value:10}]}],storage));
  assert.throws(() => writePortfolios([account,account],storage));
  assert.deepEqual(readPortfolios(storage),normalized);
  storage.setItem = () => { throw new Error('Storage full'); };
  assert.throws(() => writePortfolios([],storage), /Storage full/);
  assert.deepEqual(readPortfolios(storage),normalized);
  saved = '{bad data';
  assert.throws(() => readPortfolios(storage));
  assert.equal(saved,'{bad data');
});
