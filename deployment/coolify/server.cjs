const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(process.env.SITE_ROOT || path.join(__dirname, 'site'));
const releaseBody = fs.readFileSync(path.join(root, 'release.json'));
const release = JSON.parse(releaseBody);
const hashes = { ...release.files, 'release.json': crypto.createHash('sha256').update(releaseBody).digest('hex') };
const versionRoot = '/assets/' + release.assetVersion + '/';
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };

http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end(); }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(req.method === 'HEAD' ? undefined : 'ok\n'); }
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url === '/') { res.writeHead(302, { Location: '/integrated-v5/' }); return res.end(); }
  let versioned = false;
  if (url.startsWith('/assets/')) {
    if (!release.assetVersion || !url.startsWith(versionRoot)) { res.writeHead(404); return res.end('Not found'); }
    url = '/' + url.slice(versionRoot.length);
    versioned = true;
  }
  if (url.includes('\0') || url.includes('\\') || url.split('/').some(part => part.startsWith('.'))) { res.writeHead(403); return res.end(); }
  if (url.endsWith('/')) url += 'index.html';
  if (versioned && (url === '/release.json' || path.extname(url) === '.html')) { res.writeHead(404); return res.end('Not found'); }
  const hash = hashes[url.slice(1)];
  if (!hash) { res.writeHead(404); return res.end('Not found'); }
  const file = path.resolve(root, '.' + url);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const etag = 'W/"' + hash + '"';
    const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache', ETag: etag, 'Last-Modified': stat.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
    const ifNoneMatch = req.headers['if-none-match'];
    const notModified = ifNoneMatch !== undefined
      ? ifNoneMatch.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.slice(2))
      : Date.parse(req.headers['if-modified-since']) >= Math.floor(stat.mtimeMs / 1000) * 1000;
    if (notModified) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}).listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () => console.log('Tianli demo listening on port ' + (process.env.PORT || 8080)));
