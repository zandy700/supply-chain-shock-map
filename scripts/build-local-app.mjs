// Package the full app from explicit runtime roots; never copy private installation files.
import { mkdir, readFile, readdir, copyFile, rm, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function copyTree(source, target, accept) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink() || !accept(entry.name, entry.isDirectory())) continue;
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, accept); else if (entry.isFile()) await copyFile(from, to);
  }
}
async function filesIn(root) {
  const files = [];
  async function visit(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) await visit(path); else if (entry.isFile()) files.push(path); } }
  await visit(root); return files.sort();
}
// Dependency-free ZIP (stored entries), readable by standard macOS/Windows/Linux unzip tools.
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
export async function writeZip(root, target) {
  const chunks = [], central = []; let offset = 0;
  const files = await filesIn(root);
  for (const file of files) {
    const body = await readFile(file), name = Buffer.from('ultimater-local-app/' + relative(root,file).split('\\').join('/')), crc = crc32(body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6); local.writeUInt16LE(0x21,12); local.writeUInt32LE(crc,14); local.writeUInt32LE(body.length,18); local.writeUInt32LE(body.length,22); local.writeUInt16LE(name.length,26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(20,6); header.writeUInt16LE(0x800,8); header.writeUInt16LE(0x21,14); header.writeUInt32LE(crc,16); header.writeUInt32LE(body.length,20); header.writeUInt32LE(body.length,24); header.writeUInt16LE(name.length,28); header.writeUInt32LE(offset,42);
    chunks.push(local,name,body); central.push(header,name); offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  await writeFile(target, Buffer.concat([...chunks,directory,end]));
}
export async function buildLocalApp({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), target = resolve(root, 'dist/ultimater-local-app'), zip = resolve(root,'dist/ultimater-local-app.zip') } = {}) {
  const buildRoot = resolve(root,'dist'), within = relative(buildRoot,target), archiveWithin = relative(buildRoot,zip);
  if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within) || !archiveWithin || archiveWithin === '..' || archiveWithin.startsWith('..' + sep) || isAbsolute(archiveWithin) ||
      (await lstat(buildRoot).catch(() => null))?.isSymbolicLink() || (await lstat(target).catch(() => null))?.isSymbolicLink()) throw new Error('Use a regular build directory and archive inside dist.');
  await rm(target, { recursive: true, force: true }); await mkdir(target, { recursive: true });
  await copyTree(resolve(root,'web'), resolve(target,'web'), (name,isDir) => isDir ? name !== 'data' : /\.(?:html|js|css|json|svg|png|jpe?g|webp|woff2?|ico)$/.test(name));
  await copyTree(resolve(root,'worker'), resolve(target,'worker'), (name,isDir) => isDir || /\.(?:js|json)$/.test(name) && !name.endsWith('.test.js'));
  for (const name of ['package-lock.json','wrangler.jsonc','LICENSE','NOTICE']) await copyFile(resolve(root,name),resolve(target,name));
  await mkdir(resolve(target,'scripts')); await copyFile(resolve(root,'scripts/local-app.mjs'),resolve(target,'scripts/local-app.mjs'));
  await copyFile(resolve(root,'docs/local-app.md'),resolve(target,'README.md'));
  const manifest = JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
  manifest.scripts = { start: 'node scripts/local-app.mjs', dev: 'wrangler dev --ip 127.0.0.1' }; manifest.engines = { node: '>=22' };
  await writeFile(resolve(target,'package.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(resolve(target,'.gitignore'),'.dev.vars\n.dev.vars.*\nnode_modules/\n.wrangler/\n');
  await mkdir(dirname(zip), { recursive: true }); await writeZip(target,zip);
  return { directory: target, zip, files: (await filesIn(target)).length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await buildLocalApp(); console.log(`Built ${result.directory}\nDownload archive: ${result.zip}\nIncludes dashboard, portfolio, Analyzer and local API setup. No keys or account files.`);
}
