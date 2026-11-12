// Capability-addressed ciphertext relay. Encryption keys never leave the client.
const json=(b,status=200)=>Response.json(b,{status,headers:{'Cache-Control':'no-store'}});
const MAX=500000;
export async function workspaceSyncRoute(request,env) {
 const auth=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'');if(!auth)return json({error:'A valid sync code is required.'},401);
 if(!['GET','PUT','DELETE'].includes(request.method))return json({error:'Method not allowed.'},405);
 if(!env.WORKSPACE_SYNC)return json({error:'Workspace sync is not configured on this server.'},503);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(auth[1]));const id=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 return env.WORKSPACE_SYNC.get(env.WORKSPACE_SYNC.idFromName(id)).fetch(request);
}
export class WorkspaceSync {
 constructor(state){this.state=state;}
 async fetch(request){
  if(request.method==='GET'){const v=await this.state.storage.get('workspace');return v?json(v):json({revision:0});}
  const expected=request.headers.get('If-Match');if(!/^(0|[1-9]\d{0,9})$/.test(expected||''))return json({error:'A revision is required.'},400);
  let body;
  if(request.method==='PUT'){
   const reader=request.body?.getReader();if(!reader)return json({error:'Encrypted workspace required.'},400);let size=0,chunks=[];
   for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX){await reader.cancel();return json({error:'Workspace is too large.'},413);}chunks.push(value);}
   try{const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}body=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'Invalid encrypted workspace.'},400);}
   if(body?.version!==1||typeof body.ciphertext!=='string'||body.ciphertext.length<24||body.ciphertext.length>MAX||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.ciphertext)||typeof body.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(body.iv))return json({error:'Invalid encrypted workspace.'},400);
  }
  // Storage transaction prevents two devices from overwriting the same revision.
  return this.state.storage.transaction(async txn=>{const old=await txn.get('workspace');if(Number(expected)!==(old?.revision||0))return json({error:'This workspace changed on another device. Load it before saving.',revision:old?.revision||0},409);
   if(request.method==='DELETE'){const next={revision:(old?.revision||0)+1,empty:true};await txn.put('workspace',next);return json(next);}
   const next={version:1,iv:body.iv,ciphertext:body.ciphertext,revision:(old?.revision||0)+1,updatedAt:new Date().toISOString()};await txn.put('workspace',next);return json({revision:next.revision,updatedAt:next.updatedAt});});
 }
}
