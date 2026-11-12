// Calculations describe current positions, not modeled investment returns.
export function portfolioRisk(rows, cash = 0) {
  const complete = Number.isFinite(cash) && rows.every(r => Number.isFinite(r.value) && r.value >= 0);
  if (!complete) return { complete:false, coverage:rows.filter(r=>Number.isFinite(r.value)).length, count:rows.length };
  const total = rows.reduce((s,r)=>s+r.value,cash);
  const weights = rows.map(r=>({symbol:r.ticker,value:r.value,weight:total>0?r.value/total:0})).sort((a,b)=>b.weight-a.weight);
  const stockValue = total-cash;
  const hhi = stockValue>0?rows.reduce((s,r)=>s+(r.value/stockValue)**2,0):null;
  return {complete:true,total,weights,cashWeight:total>0?cash/total:null,largest:weights[0]||null,effectivePositions:hhi>0?1/hhi:null};
}
export function holdingMovers(rows, order='desc', key='dayChange') {
  return [...rows].sort((a,b)=>{const av=a[key],bv=b[key];if(av==null)return bv==null?0:1;if(bv==null)return -1;return (typeof av==='string'?av.localeCompare(bv):av-bv)*(order==='asc'?1:-1);});
}
export function holdingsContext(accounts) {
  const map = new Map();
  for(const a of accounts) for(const h of a.holdings||[]) {
    const r=map.get(h.ticker)||{ticker:h.ticker,shares:0,basis:0};r.shares+=h.shares;
    r.basis=r.basis==null||h.cost==null?null:r.basis+h.cost*h.shares;map.set(h.ticker,r);
  }
  return [...map.values()].map(r=>({ticker:r.ticker,shares:r.shares,avgCost:r.basis==null?null:r.basis/r.shares}));
}
