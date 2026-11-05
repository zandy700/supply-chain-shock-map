import test from 'node:test';
import assert from 'node:assert/strict';
import {classify} from './classify.js';
const negatives = {factory_fire:'Fire at factory',explosion:'Plant explosion',cyberattack:'A ransomware incident',export_ban:'New export restrictions',sanctions:'US sanctions firm',recall:'Company recalls devices',strike:'Workers strike',lawsuit:'Company sued'};
const positives = {earnings_beat:'Company earnings beat', product_launch:'Company launches a new product', guidance_raise:'Company raises guidance',major_win:'Company wins a major contract',rate_cut_relief:'Fed rate-cut relief',supplier_expansion:'New supplier expansion'};
for (const [sign,cases] of [[-1,negatives],[1,positives]]) for (const [type,text] of Object.entries(cases)) {
  test(type,()=>{assert.equal(classify(text).event_type,type);assert.equal(classify(text).sign,sign);});
}
for (const text of ['No earnings beat','Product launch delayed','Company cancels supplier expansion','No strike','Recall avoided','Unrelated market news']) {
  test(text,()=>assert.equal(classify(text).sign,0));
}
test('disruption precedes positive',()=>assert.equal(classify('Earnings beat but lawsuit').event_type,'lawsuit'));

test('Python and Worker classifier outputs match for all categories and negation cases',async()=>{
  const {spawnSync}=await import('node:child_process');
  const texts=[...Object.values(negatives),...Object.values(positives),
    ...Object.values(positives).flatMap(x=>['No '+x,'Not '+x,x+' cancelled',x+' delayed']),
    'No strike','Strike avoided','not an explosion','recall averted',
    'Averted cyberattack but earnings beat','earnings beat but lawsuit',
    'Company cyber.attack','Unclassified ordinary news'];
  const result=spawnSync('python3',['-c','import json,sys; from scsm.news import classify; print(json.dumps([classify(x) for x in json.load(sys.stdin)]))'],{input:JSON.stringify(texts),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(texts.map(classify),JSON.parse(result.stdout));
});
