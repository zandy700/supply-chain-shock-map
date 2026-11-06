import assert from 'node:assert/strict';
import test from 'node:test';
import {importPositions} from '../web/portfolio-import.js';

test('combines fractional lots by shares, handles quoted fields and preserves unknown basis',()=>{
  const csv='\uFEFFSymbol,Purchase Price,Quantity,Comment\r\nAAPL,10,1,"x, y"\r\naapl,20,1.5,"a\nb"\r\nASML,,2,\nASML,100,1,';
  assert.deepEqual(importPositions(csv),[{ticker:'AAPL',shares:2.5,cost:16},{ticker:'ASML',shares:3,cost:null}]);
});
test('rejects watchlists, unsupported transactions, currency mismatches and malformed batches',()=>{
  for(const csv of ['Symbol,Price\nAAPL,5','Symbol,Shares,Action\nAAPL,3,Sell','Symbol,Shares\nAAPL,2\nBAD,-1','Symbol,Shares,Currency\nASML,2,EUR','Symbol,Quantity\nX,','Symbol,Shares\nAAPL,"2'])assert.throws(()=>importPositions(csv));
});
