import test from 'node:test';
import assert from 'node:assert/strict';
import {fmt} from '../../web/space/core.js';
test('missing financial values stay unavailable rather than becoming zero',()=>{
  for(const format of ['price','num','pct','change','compact','date','time']) {
    for(const value of [null,undefined,'']) assert.equal(fmt[format](value),'—',`${format} ${value}`);
  }
  assert.equal(fmt.price(0),'0.0000');
  assert.equal(fmt.pct(0),'0.00%');
  assert.equal(fmt.price('12.5'),'12.50');
});
