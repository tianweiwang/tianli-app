const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
http.createServer((req, res) => {
  let requested; try { requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  if (requested === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (requested === '/') { res.writeHead(302, { Location: '/integrated-v5/' }); return res.end(); }
  if (requested.endsWith('/')) requested += 'index.html';
  const file = path.resolve(root, '.' + requested);
  if (!file.startsWith(root + path.sep) || /(?:^|\/)(?:node_modules|verification|\.git)(?:\/|$)/.test(requested)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
}).listen(Number(process.env.PORT || 4188), '127.0.0.1', () => console.log('http://127.0.0.1:' + (process.env.PORT || 4188) + '/integrated-v5/'));
