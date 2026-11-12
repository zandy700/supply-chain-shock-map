import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV,csvToXlsx,portableKey,validateWorkspaceFile,moveItem,sharedPanel } from '../../web/space/workspace-tools.js';
import { getTourSteps } from '../../web/space/tour.js';
test('CSV parser preserves multiline quoted cells, escaped quotes and trailing empties',()=>{
  assert.deepEqual(parseCSV('name,note,last\r\nA,"a,b\nline ""two""",\r\n'),[['name','note','last'],['A','a,b\nline "two"','']]);
  assert.throws(()=>parseCSV('"unclosed'),/unclosed/);
});
test('XLSX is a ZIP workbook with inline strings, including formula-looking values',()=>{
  const bytes=csvToXlsx('symbol,value\nAAPL,123\n"=HYPERLINK(""x"")",<unsafe>');
  assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
  const text=new TextDecoder().decode(bytes);assert.match(text,/xl\/worksheets\/sheet1.xml/);assert.match(text,/t="inlineStr"/);assert.match(text,/&lt;unsafe&gt;/);assert.doesNotMatch(text,/<f>/);
});
test('portable workspace validates layouts and excludes unrelated/private storage keys',()=>{
  const view={id:'my-test',name:'View',symbols:['NVDA'],panels:[{id:'p1',type:'chart',x:0,y:0,w:8,h:12,state:{}}]};
  const file={app:'pulse-space',version:1,data:{'space:view:my-test':JSON.stringify(view),'space:myviews':JSON.stringify([{id:'my-test',name:'View'}]),'space:scout:chat':'private','watchlist-pulse-portfolios-v1':'private'}};
  assert.deepEqual(Object.keys(validateWorkspaceFile(file,['chart'])),['space:view:my-test','space:myviews']);
  assert.equal(portableKey('space:alerts'),false);
  view.panels[0].w=999;file.data['space:view:my-test']=JSON.stringify(view);assert.throws(()=>validateWorkspaceFile(file,['chart']),/Invalid panel/);
});
test('share whitelist excludes account selection, holdings and panel context',()=>{
  assert.deepEqual(sharedPanel({type:'portfolio-holdings',state:{account:'secret',holdings:[{shares:5}]},context:'secret'},null),{type:'portfolio-holdings'});
  assert.deepEqual(sharedPanel({type:'chart',variant:'line'},'NVDA'),{type:'chart',symbol:'NVDA',variant:'line'});
});
test('section ordering respects boundaries and tours differ by goal',()=>{
  const a=['views','themes','mine'];assert.deepEqual(moveItem(a,'mine',-1),['views','mine','themes']);assert.deepEqual(moveItem(a,'views',-1),a);
  assert.match(getTourSteps('portfolio')[0].title,/portfolio/);assert.match(getTourSteps('analysis')[0].title,/company/);assert.match(getTourSteps('scratch')[0].title,/workspace/);
});

test('portable snapshots scrub private view state and rollback a failed replacement',async()=>{
  const {collectWorkspace,replaceWorkspace}=await import('../../web/space/workspace-tools.js');
  const initial={'space:prefs':JSON.stringify({theme:'dark',density:'comfortable'}),'space:scout:chat':'private','space:view:my-p':JSON.stringify({id:'my-p',name:'Test',symbols:['NVDA'],panels:[{id:'p',type:'chart',x:0,y:0,w:12,h:10,state:{range:'1Y',account:'secret',holdings:[{shares:10}]}}]})};
  const data=new Map(Object.entries(initial));let fail=false;
  const storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem(k,v){if(fail&&k==='space:goal'){fail=false;throw new Error('quota');}data.set(k,v);},removeItem:k=>data.delete(k)};
  const snapshot=collectWorkspace(storage);assert.ok(!('space:scout:chat' in snapshot.data));assert.deepEqual(JSON.parse(snapshot.data['space:view:my-p']).panels[0].state,{range:'1Y'});
  fail=true;assert.throws(()=>replaceWorkspace({app:'pulse-space',version:1,data:{'space:goal':'"analysis"'}},['chart'],storage),/quota/);
  assert.deepEqual(Object.fromEntries(data),initial);
});
