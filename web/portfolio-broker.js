const root = '/api/broker/';
const manageUrl = 'https://dashboard.snaptrade.com/';
const usMarkets=new Set(['XNAS','XNYS','XASE','ARCX','BATS','IEXG','OTCM','NASDAQ','NYSE','AMEX','NYSEARCA','OTC']);
const eligibleKind = new Set(['stock','etf','adr','preferred_stock','cef','mutualfund']);

export function brokerAccount(raw) {
  const holdings=[], prices={}, other=[];
  for (const p of raw.positions) {
    if (p.cashEquivalent || p.kind==='cash') continue;
    if (p.currency==='USD' && usMarkets.has(p.exchange?.toUpperCase()) && eligibleKind.has(p.kind) && /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(p.symbol) && p.shares>0) {
      holdings.push({ticker:p.symbol,shares:p.shares,cost:p.cost});
      if (p.price>0) prices[p.symbol]={price:p.price,asOf:raw.asOf};
    } else other.push(p);
  }
  const knownCash = raw.balances.length>0 && raw.balances.every(b=>b.cash!==null && (b.cash===0 || b.currency==='USD'));
  return {id:raw.id,name:raw.name,holdings,cash:raw.balances.filter(b=>b.currency==='USD').reduce((v,b)=>v+(b.cash??0),0),
    history:[],broker:true,prices,other,balances:raw.balances,asOf:raw.asOf,complete:knownCash && !other.length};
}

async function api(action,method) {
  const r=await fetch(root+action,{method,cache:'no-store',...(!method || method === 'GET' ? {signal:AbortSignal.timeout(30000)} : {})});
  if (!r.headers.get('content-type')?.includes('application/json')) throw new Error('Broker linking requires the Worker server.');
  const data=await r.json();
  if (!r.ok) throw new Error(data.error || 'Broker request failed.');
  return data;
}

export async function loadBrokers() {
  try {
    const data=await api('holdings','GET');
    return {...data,accounts:(data.accounts||[]).map(brokerAccount)};
  } catch (err) { return {error:err.message,accounts:[]}; }
}

export function brokerControls(node, state, reload, switchView, linkedView) {
  function button(label, fn) {
    const el=document.createElement('button');
    el.className='pf-pill'; el.textContent=label;
    el.onclick=async()=>{
      el.disabled=true;
      try { await fn(); }
      catch(err) { message.textContent=err.message; }
      finally { el.disabled=false; }
    };
    node.append(el);
  }
  const message=document.createElement('span'); message.className='pf-note'; message.setAttribute('role','status');
  const heading=document.createElement('h2');
  heading.textContent='SnapTrade broker connection';
  node.append(heading);
  if (state.connected) {
    button(linkedView?'View manual portfolios':'View linked accounts',switchView);
    button('Refresh holdings',reload);
    const manage=document.createElement('a'); manage.href=manageUrl; manage.target='_blank';manage.rel='noopener noreferrer';
    manage.textContent='Manage brokers'; node.append(manage);
    button('Disconnect',async()=>{ await api('disconnect','POST'); await reload(); });
  } else if (state.enabled) {
    button('Connect broker',async()=>{const {url}=await api('start','POST'); location.assign(url);});
    const setup=document.createElement('a');setup.href=manageUrl;setup.target='_blank';setup.rel='noopener noreferrer';
    setup.textContent='Link a broker in SnapTrade';node.append(setup);
  } else if (!state.error) {
    message.textContent='Broker sign-in is awaiting setup on this site. You can import a holdings CSV now.';
    const setup=document.createElement('a');setup.href='/setup#api-snaptrade';setup.textContent='API setup';node.append(setup);
  }
  if (state.error) { message.textContent=state.error; if (!state.connected) button('Retry broker link',reload); }
  if (state.message) message.textContent=state.message;
  node.append(message);
}
