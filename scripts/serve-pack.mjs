// Dependency-free loopback static server. The event pack needs no hosted Worker.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export function packServer(root = resolve('web')) {
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    try {
      let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (path.startsWith('/api/')) { response.writeHead(path.startsWith('/api/space/prediction-markets/') ? 501 : 503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'This local pack uses saved event data. Run the Worker for other APIs.' })); return; }
      if (path === '/space' || path === '/space/') path = '/space.html';
      if (path === '/') path = '/index.html';
      const file = await realpath(resolve(root, '.' + path)), base = await realpath(root);
      if (!file.startsWith(base + sep)) { response.writeHead(403); response.end(); return; }
      const body = await readFile(file); response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 8830);
  packServer().listen(port, '127.0.0.1', () => console.log('Ultimater local pack: http://127.0.0.1:' + port + '/space?view=prediction-board&onboarding=0&marketData=snapshot'));
}
