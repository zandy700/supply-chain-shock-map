import {importPositions} from './portfolio-import.js';

function readHistory(text) {
  const result = [];
  const now = new Date();
  // Use the user's calendar day when accepting end-of-day snapshots.
  const today = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
  for (const [index,line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const fields = line.split(',').map(cell => cell.trim());
    if (index === 0 && fields.join(',').toLowerCase() === 'date,value') continue;
    const [date,raw] = fields;
    if (fields.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
      throw new Error('History line ' + (index+1) + ' must contain a date and a USD value, such as 2026-06-01,10500.50.');
    }
    if (date > today) throw new Error('History line ' + (index+1) + ' has a future date.');
    result.push({date, value:Number(raw)});
  }
  return result;
}

export async function editAccount(account, onSave) {
  const prior = document.querySelector('dialog.portfolio-editor');
  if (prior) return prior;
  const dialog = document.createElement('dialog');
  dialog.className = 'portfolio-editor';
  dialog.setAttribute('aria-labelledby','pe-title');
  dialog.innerHTML = `<form>
    <header class="pe-head"><h2 id="pe-title">${account ? 'Edit portfolio' : 'New portfolio'}</h2><button class="pe-close" type="button" aria-label="Close editor">×</button></header>
    <div class="pe-content">
      <div class="pe-basics">
        <label>Portfolio name<input name="name" autofocus required maxlength="80" autocomplete="off" placeholder="e.g. Individual account"></label>
        <label>Cash balance (USD)<input name="cash" type="number" required min="0" max="1000000000000000" step="any"></label>
      </div>
      <section><label>Import holdings CSV<input type="file" accept=".csv,text/csv" name="positionsFile"></label>
        <p class="hint">Choose one account’s current USD stock positions with Symbol and Quantity columns. Average Cost is optional. Import replaces the rows below. Review cash separately before saving.</p>
        <p role="status" class="pe-import-status"></p></section>
      <section aria-labelledby="pe-positions"><h3 id="pe-positions">Holdings</h3><div class="pe-rows"></div><button class="pe-add" type="button">+ Add holding</button></section>
      <details class="pe-history"><summary>Portfolio value history (optional)</summary>
        <label>Historical values (USD)<textarea name="history" rows="4" autocomplete="off" spellcheck="false" placeholder="2026-06-01,10500.50" aria-describedby="pe-history-help"></textarea></label>
        <p id="pe-history-help">Enter one date and total account value per line, including cash. Use YYYY-MM-DD,value and omit thousands separators.</p>
      </details>
    </div>
    <footer class="pe-actions"><p role="alert"></p><div><button type="button" class="pe-cancel">Cancel</button><button type="submit" class="pe-save">Save portfolio</button></div></footer>
  </form>`;
  const form = dialog.querySelector('form');
  const fields = form.elements;
  const rows = dialog.querySelector('.pe-rows');
  const alert = dialog.querySelector('[role="alert"]');
  fields.namedItem('name').value = account?.name || '';
  fields.cash.value = account?.cash ?? 0;
  fields.history.value = (account?.history || []).map(point => point.date + ',' + point.value).join('\n');

  function addRow(holding) {
    const row = document.createElement('div');
    row.className = 'pe-position';
    row.innerHTML = `<label>Ticker<input name="ticker" type="text" required maxlength="7" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="AAPL"></label>
      <label>Shares<input name="shares" type="number" required min="0" max="10000000000" step="any"></label>
      <label>Avg. cost/share (USD)<input name="cost" type="number" min="0" max="1000000000" step="any" placeholder="Optional"></label>
      <button type="button" class="pe-remove" aria-label="Remove holding">Remove</button>`;
    const ticker = row.querySelector('[name="ticker"]');
    ticker.value = holding?.ticker || '';
    row.querySelector('[name="shares"]').value = holding?.shares ?? '';
    row.querySelector('[name="cost"]').value = holding?.cost ?? '';
    row.querySelector('.pe-remove').onclick = () => {
      const target = row.nextElementSibling?.querySelector('input') || dialog.querySelector('.pe-add');
      row.remove();
      target.focus();
    };
    rows.appendChild(row);
    return ticker;
  }

  for (const holding of account?.holdings || []) addRow(holding);
  fields.positionsFile.onchange = async () => {
    const file = fields.positionsFile.files[0];
    if (!file) return;
    const submit = dialog.querySelector('.pe-save');
    submit.disabled = true;
    fields.positionsFile.disabled = true;
    const status = dialog.querySelector('.pe-import-status');
    status.textContent = '';
    alert.textContent = '';
    try {
      if (file.size > 2_000_000) throw new Error('Use a CSV smaller than 2 MB.');
      const imported = importPositions(await file.text());
      rows.replaceChildren();
      imported.forEach(addRow);
      status.textContent = imported.length + (imported.length === 1 ? ' position ready.' : ' positions ready.') + ' Review and save your portfolio.';
    } catch (error) { alert.textContent = error.message; }
    finally { submit.disabled = false; fields.positionsFile.disabled = false; fields.positionsFile.value = ''; }
  };
  dialog.querySelector('.pe-add').onclick = () => {
    if (rows.children.length >= 100) {
      alert.textContent = 'Use up to 100 holdings per portfolio.';
      return;
    }
    addRow().focus();
  };
  dialog.querySelector('.pe-close').onclick = dialog.querySelector('.pe-cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  form.addEventListener('submit', event => {
    event.preventDefault();
    alert.textContent = '';
    let history;
    try {
      history = readHistory(fields.history.value);
    } catch (error) {
      dialog.querySelector('details').open = true;
      fields.history.focus();
      alert.textContent = error.message;
      return;
    }
    try {
      const holdings = [...rows.children].map(row => {
        const cost = row.querySelector('[name="cost"]');
        return {
          ticker:row.querySelector('[name="ticker"]').value.trim().toUpperCase(),
          shares:row.querySelector('[name="shares"]').valueAsNumber,
          cost:cost.value === '' ? null : cost.valueAsNumber
        };
      });
      onSave({id:account?.id ?? crypto.randomUUID(), name:fields.namedItem('name').value.trim(),
        cash:fields.cash.valueAsNumber, holdings, history});
      dialog.close();
    } catch (error) { alert.textContent = error.message || 'Could not save the portfolio.'; }
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}
