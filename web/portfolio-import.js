// Holdings snapshots only. A transactions export needs a separate lot accounting model.
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i+1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (char === ',' || char === '\n') {
      row.push(field.trim()); field = ''; closed = false;
      if (char === '\n') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (char === '"' && !field.trim() && !closed) {
      field = ''; quoted = true;
    } else {
      if (char === '"' || (closed && !/\s/.test(char))) throw new Error('Invalid CSV quoting.');
      field += char;
    }
  }
  if (quoted) throw new Error('A quoted CSV field was not closed.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function numeric(cell, label, line) {
  const value = (cell || '').replace(/^\$/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$|^\.\d+$/.test(value)) {
    throw new Error('Check ' + label + ' on row ' + line + '. Use a current USD holdings file.');
  }
  const n = Number(value.replaceAll(',',''));
  if (!Number.isFinite(n)) throw new Error('Invalid '+label+' on row '+line+'.');
  return n;
}
export function importPositions(text) {
  const [raw,...rows] = csvRows(text);
  const headers = (raw || []).map(s=>s.toLowerCase());
  const column = names => headers.findIndex(h=>names.includes(h));
  const symbol = column(['symbol','ticker']), shares = column(['quantity','shares','shares owned']);
  const cost = column(['average cost','avg cost','average cost basis','average cost per share','purchase price','cost/share']);
  const currency = column(['currency','currency code']);
  if (symbol < 0 || shares < 0 || !rows.length) throw new Error('Use a holdings CSV with Symbol and Quantity columns and at least one position.');
  if (column(['transaction type','action','buy/sell','side']) >= 0) throw new Error('Choose a current holdings export rather than a transaction history.');
  const holdings = new Map();
  rows.forEach((row,i)=>{
    const ticker = row[symbol]?.toUpperCase();
    if (!/^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(ticker || '')) throw new Error('Unsupported ticker on row '+(i+2)+'. Use USD stock positions only; enter cash separately.');
    if (currency >= 0 && row[currency]?.toUpperCase() !== 'USD') throw new Error('Only USD holdings are supported. Check row '+(i+2)+'.');
    const quantity = numeric(row[shares], 'share quantity', i+2);
    if (!quantity) return;
    const unitCost = cost<0 || ['', '-', '--', 'N/A'].includes((row[cost] || '').toUpperCase()) ? null : numeric(row[cost], 'cost per share',i+2);
    const position = holdings.get(ticker) || {ticker,shares:0,basis:0};
    position.shares += quantity;
    position.basis = unitCost===null || position.basis===null ? null : position.basis + quantity*unitCost;
    holdings.set(ticker,position);
  });
  if (!holdings.size || holdings.size>100) throw new Error('Use 1–100 stock positions with positive share quantities.');
  return [...holdings.values()].map(({ticker,shares,basis})=>({ticker,shares,cost:basis===null?null:basis/shares}));
}
