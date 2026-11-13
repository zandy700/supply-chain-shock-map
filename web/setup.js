import { API_PROVIDERS } from './shared/api-providers.js';
import { mountDashboardShell, researchItemsHTML } from './shared/nav.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const DOWNLOAD = 'https://github.com/zandy700/supply-chain-shock-map/releases/latest/download/ultimater-local-app.zip';
const main = document.querySelector('main');
let status = null, saving = false, restartTimer;
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const writable = () => loopback && status?.mode === 'local' && status?.writable === true && typeof status.csrfToken === 'string';

mountDashboardShell();
document.querySelector('#research-nav').innerHTML = researchItemsHTML(undefined, 'setup', '/');

function providerHTML(provider) {
  const configured = status?.providers?.[provider.id]?.configured === true;
  return `<section class="setup-provider" id="api-${provider.id}" data-provider="${provider.id}"><header><div><h3>${esc(provider.name)}</h3><p>${esc(provider.purpose)}</p></div><span class="s-badge ${configured ? 's-badge-up' : ''}">${status ? configured ? writable() ? 'Saved locally' : 'Configured on server' : 'Not configured' : 'Status unavailable'}</span></header>
    <details><summary>${writable() ? configured ? 'Update connection' : 'Set up ' + esc(provider.name) : 'How to connect'}</summary><p>${esc(provider.instructions)}</p><a href="${esc(provider.url)}" target="_blank" rel="noopener noreferrer">${esc(provider.link)} ↗</a><p class="setup-note">${esc(provider.note)}</p>
    ${provider.id === 'snaptrade' && writable() ? `<p class="setup-note">Redirect URI: <code>${esc(location.origin)}/api/broker/callback</code></p>` : ''}
    ${writable() ? `<form autocomplete="off">${provider.fields.map(field => `<label>${esc(field.label)}<input type="password" name="${field.name}" autocomplete="new-password" spellcheck="false" autocapitalize="none" maxlength="4096" required></label>`).join('')}<div class="setup-form-actions"><button type="submit" class="s-btn s-btn-primary">Save locally</button><button type="button" class="s-btn s-btn-ghost" data-show-keys aria-pressed="false">Show keys</button>${configured ? '<button type="button" class="s-btn s-btn-danger" data-remove-provider>Remove saved keys</button>' : ''}</div></form>` : '<p class="setup-note">Run the downloaded app with <code>npm start</code> to enter your own keys here.</p>'}
    </details>${configured && provider.probe ? '<button type="button" class="s-btn s-btn-sm setup-probe" data-probe>Check data access</button>' : configured && provider.destination ? `<a class="s-btn s-btn-sm setup-probe" href="${esc(provider.destination)}">${esc(provider.action)}</a>` : ''}<p data-provider-result role="status" aria-live="polite"></p></section>`;
}

function modeCopy() {
  if (writable()) return [status.restarting ? 'Applying your local settings…' : 'Local setup is ready', 'Keys are saved only to this app folder. They are never stored in browser storage or included in downloads. Saving restarts the local data server.'];
  if (loopback) return ['Start the local setup launcher', 'To save API keys in this screen, run npm start in the complete local app folder. A plain static server or npm run dev does not enable key entry.'];
  return ['Use your own keys in the local app', 'This hosted copy uses the site owner’s connections. Download the app to configure your own providers; this website does not accept visitors’ API keys.'];
}
function updateMode() {
  const [title, description] = modeCopy(), mode = main.querySelector('[data-setup-mode]');
  if (mode) { mode.querySelector('strong').textContent = title; mode.querySelector('p').textContent = description; }
}

function render(message = '') {
  main.innerHTML = `<header class="setup-head"><h1>Make Ultimater your own</h1><p>Run the news tracker, portfolio and stock Analyzer together. Connect only the data sources you want.</p></header>
    <section class="setup-download" aria-labelledby="download-title"><h2 id="download-title">Download the complete local app</h2><p>Includes the news-tracking dashboard, manual and CSV portfolios, charts, options, prediction events and this API setup screen. Your API keys stay in the downloaded app’s private configuration.</p><div class="setup-actions"><a class="s-btn s-btn-primary" href="${DOWNLOAD}">Download local app (.zip)</a><a class="s-btn" href="https://github.com/zandy700/supply-chain-shock-map" target="_blank" rel="noopener noreferrer">View source on GitHub</a></div><ol><li>Install <a href="https://nodejs.org/en/download" target="_blank" rel="noopener noreferrer">Node.js 22 or newer</a>, then download and unzip the app.</li><li>Open Terminal in the unzipped folder and run <code>npm start</code>. The first launch installs the app’s dependencies.</li><li>Open the local address shown in Terminal, then use this screen to connect your APIs.</li></ol><p class="setup-note">Internet access is needed for installation and live feeds. Manual portfolios remain usable without API keys. The separate event-only pack is described in the <a href="https://github.com/zandy700/supply-chain-shock-map/blob/main/docs/local-event-pack.md" target="_blank" rel="noopener noreferrer">download guide</a>.</p></section>
    <section aria-labelledby="connections-title"><header class="setup-section-head"><div><h2 id="connections-title">API connections</h2><p>Start with Finnhub for the news tracker. Add the others when you need their features. A saved key is not proof that a provider has granted data access.</p></div><button type="button" class="s-btn s-btn-sm" data-refresh-status>Refresh status</button></header>
    <div class="setup-mode" data-setup-mode role="status"><strong>${esc(modeCopy()[0])}</strong><p>${esc(modeCopy()[1])}</p></div>
    <p class="setup-error" data-setup-error role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p><div class="setup-providers">${API_PROVIDERS.map(providerHTML).join('')}</div></section>
    ${writable() ? '' : '<details class="setup-owner"><summary>For people hosting their own server</summary><p>Save provider keys as private server secrets. A local configuration file is not uploaded automatically. For the included Cloudflare Worker, use the provider field names in the README with this command:</p><pre>npx wrangler secret put FINNHUB_API_KEY</pre><p>Never add API keys to source files or a GitHub release.</p></details>'}`;
  main.querySelector('[data-refresh-status]').onclick = () => loadStatus();
  for (const section of main.querySelectorAll('[data-provider]')) bindProvider(section);
  if (location.hash.startsWith('#api-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
}
function bindProvider(section) {
    const provider = API_PROVIDERS.find(p => p.id === section.dataset.provider);
    const form = section.querySelector('form');
    form?.addEventListener('submit', event => { event.preventDefault(); saveProvider(provider, section, false); });
    section.querySelector('[data-remove-provider]')?.addEventListener('click', () => saveProvider(provider, section, true));
    section.querySelector('[data-show-keys]')?.addEventListener('click', event => {
      const shown = event.currentTarget.getAttribute('aria-pressed') !== 'true';
      form.querySelectorAll('input').forEach(input => { input.type = shown ? 'text' : 'password'; });
      event.currentTarget.setAttribute('aria-pressed', String(shown)); event.currentTarget.textContent = shown ? 'Hide keys' : 'Show keys';
    });
    section.querySelector('[data-probe]')?.addEventListener('click', () => probeProvider(provider, section));
}

async function fetchStatus() {
  const response = await fetch('/api/setup/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Setup status is unavailable. For local key entry, start the complete downloaded app with npm start.');
  const body = await response.json();
  if (!body.providers || typeof body.providers !== 'object') throw new Error('The setup server returned an invalid response.');
  return body;
}
async function loadStatus() {
  if (saving) return;
  try {
    status = await fetchStatus();
    // A background readiness check must not discard keys someone is typing.
    if (![...main.querySelectorAll('form input')].some(input => input.value)) render();
    else updateMode();
  } catch (error) {
    const message = main.querySelector('[data-setup-error]');
    message.hidden = false; message.textContent = error.name === 'TimeoutError' ? 'Setup status timed out. Refresh to try again.' : error.message;
  }
}
function watchRestart(attempt = 0) {
  clearTimeout(restartTimer);
  if (!status?.restarting || attempt >= 30) return;
  restartTimer = setTimeout(async () => {
    try { status = await fetchStatus(); updateMode(); } catch { /* manual status refresh remains available */ }
    watchRestart(attempt + 1);
  }, 1000);
}
async function saveProvider(provider, section, remove) {
  if (!writable() || saving) return;
  const result = section.querySelector('[data-provider-result]'), form = section.querySelector('form');
  const credentials = Object.fromEntries(provider.fields.map(field => [field.name, form.elements[field.name].value.trim()]));
  if (!remove && Object.values(credentials).some(value => !value || /[\r\n]/.test(value))) { result.textContent = 'Fill in every field with a single-line key.'; return; }
  saving = true; main.querySelectorAll('button').forEach(button => { button.disabled = true; });
  result.className = ''; result.textContent = remove ? 'Removing local keys…' : 'Saving on this computer…';
  try {
    const response = await fetch('/api/setup/credentials', { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Ultimater-CSRF': status.csrfToken },
      body: JSON.stringify(remove ? { provider: provider.id, remove: true } : { provider: provider.id, credentials }), signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (!response.ok || body.ok !== true) throw new Error(body.message || 'Local settings could not be saved. Existing settings are retained.');
    form.reset(); status = { ...status, providers: body.providers || status.providers, restarting: body.restarting === true };
    const template = document.createElement('template'); template.innerHTML = providerHTML(provider);
    const updated = template.content.firstElementChild; section.replaceWith(updated); bindProvider(updated); updateMode(); watchRestart();
    updated.querySelector('details').open = true;
    const note = updated.querySelector('[data-provider-result]'); note.className = 'setup-saved';
    note.textContent = remove ? 'Removed from local configuration.' : 'Saved locally. The data server is restarting; check access after it is ready.';
    updated.querySelector('summary').focus({ preventScroll: true });
  } catch (error) { result.className = 'setup-error'; result.textContent = error.name === 'TimeoutError' ? 'The setup request timed out. Refresh status before trying again.' : error.message; }
  finally { saving = false; main.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
}
async function probeProvider(provider, section) {
  const button = section.querySelector('[data-probe]'), result = section.querySelector('[data-provider-result]');
  button.disabled = true; result.className = ''; result.textContent = 'Checking provider data…';
  try {
    const response = await fetch(provider.probe, { cache: 'no-store', signal: AbortSignal.timeout(90000) });
    const data = await response.json();
    const accepted = response.ok && (provider.id === 'alpaca' ? data.provider === 'alpaca' : provider.id === 'finnhub' ? data.companies?.some(company => company.verified === true) && !data.errors?.length : Array.isArray(data.rows));
    if (!accepted) throw new Error('Data access could not be confirmed. Check your keys, provider subscription and the app’s connection status.');
    result.className = 'setup-saved'; result.textContent = provider.id === 'alpaca' ? 'Alpaca indicative data responded successfully. Its feed limits still apply.' : `${provider.name} data responded successfully.`;
  } catch { result.className = 'setup-error'; result.textContent = 'Data access could not be confirmed. The server may still be restarting, or the provider may require different keys or access.'; }
  finally { button.disabled = false; }
}

render(); loadStatus();
addEventListener('pagehide', () => clearTimeout(restartTimer));
