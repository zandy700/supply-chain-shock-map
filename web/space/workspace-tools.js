// Browser-only file generation uses standard ZIP storage and inline-string XLSX cells.
const encoder = new TextEncoder();
const xml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
export function parseCSV(text) {
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<String(text).length;i++) { const c=text[i];
    if(c==='"') {if(quoted && text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===',' && !quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r') && !quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(quoted)throw new Error('CSV has an unclosed quoted field.');
  if(value!==''||row.length){row.push(value);rows.push(row);}
  return rows;
}
function crc32(bytes) {let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function storedZip(files) {
  const chunks=[],directory=[];let offset=0;
  for(const [name,value] of Object.entries(files)){
    const filename=encoder.encode(name),bytes=encoder.encode(value),crc=crc32(bytes);
    const local=new Uint8Array(30+filename.length),v=new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,filename.length,true);local.set(filename,30);
    const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.set(filename,46);
    chunks.push(local,bytes);directory.push(central);offset+=local.length+bytes.length;
  }
  const size=directory.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);
  v.setUint32(0,0x06054b50,true);v.setUint16(8,directory.length,true);v.setUint16(10,directory.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
  const result=new Uint8Array(offset+size+22);let pos=0;for(const bytes of [...chunks,...directory,end]){result.set(bytes,pos);pos+=bytes.length;}return result;
}
export function csvToXlsx(csv) {
  const rows=parseCSV(csv);if(rows.length>10000||rows.some(r=>r.length>200))throw new Error('Use up to 10,000 rows and 200 columns per export.');
  const col=index=>{let out='';for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r,i)=>`<row r="${i+1}">${r.map((s,j)=>i>0 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s) && Number.isFinite(+s) && s.replace(/[^0-9]/g,'').length<=15 ? `<c r="${col(j)}${i+1}"><v>${s}</v></c>` : `<c r="${col(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${xml(s)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return storedZip({
    '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Panel data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':sheet
  });
}
export const portableKey = key => /^space:(prefs|myviews|lastView|goal|view:[\w-]+)$/.test(key);
const object = value => value && typeof value==='object' && !Array.isArray(value);
export function validateWorkspaceFile(file, panelTypes=[]) {
  if(file?.app!=='pulse-space'||file.version!==1||!object(file.data)||Object.keys(file.data).length>250)throw new Error('Not a supported Ultimater workspace file.');
  const clean={};const safeId=s=>typeof s==='string'&&/^[\w-]{1,120}$/.test(s);
  for(const [key,text] of Object.entries(file.data)) {
    if(!portableKey(key))continue;
    if(typeof text!=='string'||text.length>2e6)throw new Error('Workspace entry is too large.');
    const value=JSON.parse(text);
    if(key.startsWith('space:view:')) {
      if(!object(value)||!safeId(value.id)||key!=='space:view:'+value.id||typeof value.name!=='string'||value.name.length>160||!Array.isArray(value.panels)||value.panels.length>100)throw new Error('Invalid view in workspace file.');
      if(!Array.isArray(value.symbols)||value.symbols.some(s=>typeof s!=='string'||!/^\^?[A-Z0-9.=-]{1,16}$/.test(s)))throw new Error('Invalid symbols in workspace file.');
      if(new Set(value.panels.map(p=>p.id)).size!==value.panels.length)throw new Error('Duplicate panel IDs in workspace file.');
      for(const p of value.panels){if(!object(p)||!safeId(p.id)||!panelTypes.includes(p.type)||!Number.isInteger(p.x)||!Number.isInteger(p.y)||!Number.isInteger(p.w)||!Number.isInteger(p.h)||p.x<0||p.y<0||p.y>10000||p.w<1||p.w>12||p.h<1||p.h>200||p.x+p.w>12||!object(p.state))throw new Error('Invalid panel layout in workspace file.');}
    }else if(key==='space:myviews') {
      if(!Array.isArray(value)||value.length>100||value.some(v=>!safeId(v.id)||typeof v.name!=='string'||v.name.length>160))throw new Error('Invalid custom views.');
      if(new Set(value.map(v=>v.id)).size!==value.length)throw new Error('Duplicate view IDs in workspace file.');
    }else if(key==='space:prefs') {
      if(!object(value)||!['dark','light','blue-steel','system'].includes(value.theme)||!['comfortable','compact'].includes(value.density))throw new Error('Invalid display settings.');
    }else if(typeof value!=='string')throw new Error('Invalid workspace setting.');
    clean[key]=text;
  }
  return clean;
}
export function moveItem(items,id,offset) {const result=[...items],i=result.indexOf(id),j=i+offset;if(i>=0&&j>=0&&j<result.length)[result[i],result[j]]=[result[j],result[i]];return result;}
export function sharedPanel(panel,symbol) {
  const out={type:panel.type};if(typeof symbol==='string'&&/^\^?[A-Z0-9.=-]{1,16}$/.test(symbol))out.symbol=symbol;
  if(typeof panel.variant==='string'&&/^[\w-]{1,60}$/.test(panel.variant))out.variant=panel.variant;
  return out;
}

export function collectWorkspace(storage) {
  const data={};
  const privateFields=new Set(['holdings','positions','accounts','account','accountId','prices','history','messages','conversation','token','secret','apiKey','context']);
  const scrub=value=>Array.isArray(value)?value.map(scrub):object(value)?Object.fromEntries(Object.entries(value).filter(([key])=>!privateFields.has(key)).map(([key,v])=>[key,scrub(v)])):value;
  for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!portableKey(key))continue;const text=storage.getItem(key);data[key]=key.startsWith('space:view:')?JSON.stringify(scrub(JSON.parse(text))):text;}
  return {app:'pulse-space',version:1,data};
}
export function replaceWorkspace(file,panelTypes,storage) {
  const data=validateWorkspaceFile(file,panelTypes),backup={};
  for(let i=0;i<storage.length;i++){const key=storage.key(i);if(portableKey(key))backup[key]=storage.getItem(key);}
  try{for(const key of Object.keys(backup))storage.removeItem(key);for(const [key,value] of Object.entries(data))storage.setItem(key,value);}
  catch(error){for(const key of Object.keys(data))storage.removeItem(key);for(const [key,value] of Object.entries(backup))storage.setItem(key,value);throw error;}
  return data;
}
