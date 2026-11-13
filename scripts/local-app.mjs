// Full-app loopback launcher. Credentials stay in this installation's .dev.vars.
import { createServer, request as proxyRequest } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, rename, unlink, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { API_PROVIDERS, providerStatus } from '../web/shared/api-providers.js';

const PROVIDERS = new Map(API_PROVIDERS.map(p => [p.id, p.fields.map(f => f.name)]));
const MAX_BODY = 16_384, MAX_CONFIG = 131_072;
class SetupError extends Error {
  constructor(message, status = 400, code = 'invalid_setup') { super(message); this.status = status; this.code = code; }
}
const reply = (res, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};

// Keep unrelated comments, settings and multiline values intact when replacing a provider.
function envRecords(text) {
  const records = [], lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];
    const match = text.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)/);
    const key = match?.[1], value = match?.[2]?.trim() || '', quote = ['"', "'", '`'].includes(value[0]) ? value[0] : null;
    const closed = str => {
      for (let n = 1; n < str.length; n++) if (str[n] === quote && str[n - 1] !== '\\') return true;
      return false;
    };
    let raw = value;
    if (quote) while (!closed(raw) && i + 1 < lines.length) { text += lines[++i]; raw += '\n' + lines[i].replace(/\r?\n$/, ''); }
    if (quote && !closed(raw)) throw new SetupError('Local settings contain an unfinished quoted value. Fix .dev.vars before editing here.', 409, 'unsafe_config');
    records.push({ key, text, value: quote ? raw.slice(1, raw.lastIndexOf(quote)) : raw.split('#')[0].trim() });
  }
  return records;
}
async function readConfig(root) {
  const target = resolve(root, '.dev.vars');
  let file;
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG) throw new SetupError('Local settings must be a regular .dev.vars file smaller than 128 KB.', 409, 'unsafe_config');
    file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const text = await file.readFile('utf8');
    if (Buffer.byteLength(text) > MAX_CONFIG) throw new SetupError('Local settings are too large to edit here.', 409, 'unsafe_config');
    return text;
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    if (error instanceof SetupError) throw error;
    throw new SetupError('Local settings could not be read. Check the .dev.vars file permissions.', 500, 'settings_unreadable');
  } finally { await file?.close(); }
}
export async function localProviderStatus(root) {
  const values = Object.fromEntries(envRecords(await readConfig(root)).filter(r => r.key).map(r => [r.key, r.value]));
  return providerStatus(values);
}

export async function saveLocalCredentials(root, input) {
  const fields = PROVIDERS.get(input?.provider);
  if (!fields || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['provider', 'credentials', 'remove'].includes(key))) throw new SetupError('Choose a supported API provider.');
  const remove = input.remove === true;
  if (input.remove !== undefined && !remove || remove && input.credentials !== undefined) throw new SetupError('Choose either Save or Remove for this provider.');
  const credentials = input.credentials;
  if (!remove && (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || Object.keys(credentials).length !== fields.length || Object.keys(credentials).some(key => !fields.includes(key)))) throw new SetupError('Enter all credential fields for this provider.');
  const values = {};
  if (!remove) for (const field of fields) {
    const value = credentials[field];
    // Dotenv must preserve the exact token. API credentials are single-line printable tokens.
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\r\n]/.test(value) || /[^\x21-\x7e]|["'`\\]/.test(value.trim())) throw new SetupError('Credentials must be nonempty single-line tokens without quotes or backslashes.');
    values[field] = value.trim();
  }
  const text = await readConfig(root);
  const retained = envRecords(text).filter(record => !fields.includes(record.key)).map(record => record.text).join('');
  const updated = retained + (retained && !retained.endsWith('\n') ? '\n' : '') + Object.entries(values).map(([key,value]) => `${key}="${value}"\n`).join('');
  const temporary = resolve(root, '.dev.vars.' + randomBytes(12).toString('hex'));
  let file;
  try {
    file = await open(temporary, 'wx', 0o600); await file.writeFile(updated, 'utf8'); await file.sync(); await file.close(); file = null;
    await rename(temporary, resolve(root, '.dev.vars'));
  } catch {
    throw new SetupError('Credentials could not be saved. Existing settings were preserved.', 500, 'settings_write_failed');
  } finally { await file?.close(); await unlink(temporary).catch(() => {}); }
  return localProviderStatus(root);
}

function readJSON(req) {
  return new Promise((resolveBody, reject) => {
    let length = 0, settled = false; const buffers = [];
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    req.on('data', chunk => { length += chunk.length; if (length > MAX_BODY) fail(new SetupError('The setup request is too large.', 413)); else if (!settled) buffers.push(chunk); });
    req.on('end', () => {
      if (settled) return;
      try { const value = JSON.parse(Buffer.concat(buffers).toString('utf8')); settled = true; resolveBody(value); }
      catch { fail(new SetupError('Send a valid JSON setup request.')); }
    });
    req.on('error', () => fail(new SetupError('The setup request could not be read.')));
    req.on('aborted', () => fail(new SetupError('The setup request was interrupted.')));
  });
}

export function localAppServer({ root, workerPort, csrfToken = randomBytes(32).toString('hex'), isReady = () => true, onConfigChange = async () => {} }) {
  let changing = false;
  const server = createServer(async (req, res) => {
    try {
      const port = server.address()?.port, host = req.headers.host;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host) || !req.url?.startsWith('/') || req.url.startsWith('//')) throw new SetupError('Open Ultimater from its local address.', 403, 'invalid_local_origin');
      const url = new URL(req.url, 'http://' + host);
      if (url.pathname.startsWith('/api/setup/')) {
        if (req.headers.origin && req.headers.origin !== url.origin || req.headers['sec-fetch-site'] === 'cross-site') throw new SetupError('Open setup from this local app.', 403, 'invalid_local_origin');
        if (url.pathname === '/api/setup/status' && req.method === 'GET') return reply(res, { mode: 'local', writable: true, csrfToken, providers: await localProviderStatus(root), restarting: changing || !isReady() });
        if (url.pathname !== '/api/setup/credentials') return reply(res, { error: 'not_found' }, 404);
        if (req.method !== 'POST') return reply(res, { error: 'method_not_allowed' }, 405);
        if (req.headers.origin !== url.origin) throw new SetupError('Open setup from this local app.', 403, 'invalid_local_origin');
        const token = req.headers['x-ultimater-csrf'];
        if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(csrfToken) || !timingSafeEqual(Buffer.from(token), Buffer.from(csrfToken))) throw new SetupError('Reload API setup and try again.', 403, 'invalid_setup_token');
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new SetupError('Use a JSON setup request.', 415);
        if (changing) throw new SetupError('The local server is restarting. Try again shortly.', 409, 'setup_busy');
        changing = true;
        try {
          const providers = await saveLocalCredentials(root, await readJSON(req));
          reply(res, { ok: true, restarting: true, providers });
          Promise.resolve().then(onConfigChange).catch(() => {}).finally(() => { changing = false; });
        } catch (error) { changing = false; throw error; }
        return;
      }
      if (!isReady()) return reply(res, { error: 'local_worker_starting', message: 'The local app is starting or restarting. Try again shortly.' }, 503);
      const headers = { ...req.headers };
      delete headers.connection; delete headers['proxy-connection']; delete headers['proxy-authorization'];
      // Connect to the internal port while preserving the public Host/Origin for OAuth callbacks.
      const upstream = proxyRequest({ hostname: '127.0.0.1', port: workerPort, path: req.url, method: req.method, headers }, incoming => {
        const responseHeaders = { ...incoming.headers }; delete responseHeaders.connection;
        res.writeHead(incoming.statusCode || 502, responseHeaders); incoming.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) reply(res, { error: 'local_worker_unavailable', message: 'The local app server is unavailable. Restart npm start.' }, 503); else res.destroy(); });
      req.on('aborted', () => upstream.destroy()); res.on('close', () => { if (!res.writableFinished) upstream.destroy(); }); req.pipe(upstream);
    } catch (error) {
      if (!res.headersSent) reply(res, { error: error instanceof SetupError ? error.code : 'setup_failed', message: error instanceof SetupError ? error.message : 'Local setup could not complete. Existing settings were preserved.' }, error instanceof SetupError ? error.status : 500);
      else res.destroy();
    }
  });
  server.requestTimeout = 20_000; server.headersTimeout = 10_000;
  return server;
}

const run = (command, args, options) => new Promise((resolveRun,reject) => {
  const child = spawn(command, args, options); child.once('error', reject); child.once('exit', code => code === 0 ? resolveRun() : reject(new Error('Command failed.')));
});
function validPort(value, fallback) { const port = value === undefined ? fallback : Number(value); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a local port between 1024 and 65535.'); return port; }

export async function startLocalApp({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), port = validPort(process.env.PORT, 8820), workerPort = validPort(process.env.ULTIMATER_WORKER_PORT, 8822), install = true } = {}) {
  if (+process.versions.node.split('.')[0] < 22) throw new Error('Install Node.js 22 or newer before starting Ultimater.');
  if (port === workerPort) throw new Error('PORT and ULTIMATER_WORKER_PORT must be different.');
  const wrangler = resolve(root, 'node_modules/wrangler/wrangler-dist/cli.js');
  try { await access(wrangler); } catch {
    if (!install) throw new Error('Run npm ci before starting Ultimater.');
    console.log('Installing locked local dependencies. This is needed only on first launch.');
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  }
  let child, ready = false, closing = false;
  const stopWorker = async () => {
    ready = false;
    if (!child || child.exitCode !== null || child.signalCode) return;
    const current = child;
    if (process.platform === 'win32') {
      // Windows does not propagate child.kill() to Wrangler's workerd descendants.
      // Kill only the tree rooted at the exact process this launcher owns.
      const exited = new Promise(resolveExit => current.once('exit', resolveExit));
      await run('taskkill.exe', ['/PID', String(current.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).catch(error => {
        if (current.exitCode === null && !current.signalCode) throw error;
      });
      await exited;
      return;
    }
    await new Promise(resolveStop => {
      const force = setTimeout(() => { current.kill('SIGKILL'); }, 5000); force.unref();
      current.once('exit', () => { clearTimeout(force); resolveStop(); }); current.kill('SIGTERM');
    });
  };
  async function restartWorker() {
    await stopWorker(); if (closing) return;
    await new Promise((resolvePort, reject) => {
      const probe = createServer(); probe.once('error', () => reject(new Error('The internal Worker port is already in use. Choose a different ULTIMATER_WORKER_PORT.')));
      probe.listen(workerPort, '127.0.0.1', () => probe.close(resolvePort));
    });
    const workerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' };
    // In-app setup controls this installation's provider keys, including removal.
    // Do not silently fall back to unrelated tokens inherited from a terminal.
    for (const fields of PROVIDERS.values()) for (const field of fields) delete workerEnv[field];
    child = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(workerPort), '--show-interactive-dev-session=false'], {
      cwd: root, stdio: 'ignore', env: workerEnv
    });
    const current = child;
    child.once('exit', () => { if (child === current) ready = false; });
    child.once('error', () => { if (child === current) ready = false; });
    for (let attempt = 0; attempt < 120 && !closing && child === current; attempt++) {
      if (current.exitCode !== null || current.signalCode) throw new Error('The local Worker could not start. Check the local port and Node installation.');
      try { const response = await fetch(`http://127.0.0.1:${workerPort}/api/setup/status`, { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; return; } }
      catch { /* wait for this owned local process */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 250));
    }
    if (!closing) throw new Error('The local Worker did not become ready. Restart npm start.');
  }
  const server = localAppServer({ root, workerPort, isReady: () => ready, onConfigChange: restartWorker });
  await new Promise((resolveListen,reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  const close = async () => { closing = true; await stopWorker(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); };
  console.log('Starting the local app server…');
  try { await restartWorker(); } catch (error) { await close(); throw error; }
  console.log(`Ultimater: http://127.0.0.1:${port}/#/home`);
  console.log(`API setup: http://127.0.0.1:${port}/setup`);
  return { server, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startLocalApp().then(({ close }) => {
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
