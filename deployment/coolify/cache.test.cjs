const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

test('built site caches versioned imports and revalidates mutable URLs across releases', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tianli-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const app = path.join(source, 'design/integrated-v5');
  const products = path.join(source, 'design/reference-demos/franchise-demo/products');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(products, { recursive: true });
  fs.writeFileSync(path.join(app, 'index.html'), '<!doctype html><link rel="stylesheet" href="app.css"><script defer src="../admin-prototype-v1/vendor/lucide.min.js"></script><script type="module" src="app.mjs"></script>');
  fs.writeFileSync(path.join(app, 'app.mjs'), "import './child.mjs'; export const version = 1;\n");
  fs.writeFileSync(path.join(app, 'child.mjs'), 'export const child = true;\n');
  fs.writeFileSync(path.join(app, 'app.css'), 'body{color:black}');
  fs.writeFileSync(path.join(app, 'hidden.test.mjs'), 'must not ship');
  for (const name of ['igood-01.svg', 'igood-02.svg']) fs.writeFileSync(path.join(products, name), '<svg/>');
  const build = output => {
    execFileSync(process.execPath, [path.join(__dirname, 'build-site.cjs'), source, output]);
    return JSON.parse(fs.readFileSync(path.join(output, 'release.json')));
  };
  const output = path.join(directory, 'first');
  const release = build(output);
  assert.match(release.assetVersion || '', /^[a-f0-9]{64}$/, 'build must assign a content version');
  const versionRoot = '/assets/' + release.assetVersion + '/';
  const html = fs.readFileSync(path.join(output, 'integrated-v5/index.html'), 'utf8');
  assert.ok(html.includes('src="' + versionRoot + 'integrated-v5/app.mjs"'));
  assert.ok(html.includes('href="' + versionRoot + 'integrated-v5/app.css"'));
  assert.ok(html.includes('src="' + versionRoot + 'admin-prototype-v1/vendor/lucide.min.js"'));
  const start = async site => {
    const port = await new Promise(resolve => {
      const probe = net.createServer();
      probe.listen(0, '127.0.0.1', () => { const assigned = probe.address().port; probe.close(() => resolve(assigned)); });
    });
    const child = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], { env: { ...process.env, SITE_ROOT: site, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'pipe' });
    t.after(() => child.kill());
    const base = 'http://127.0.0.1:' + port;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(base + '/healthz')).ok) return base; } catch {}
      if (child.exitCode !== null) throw Error('Server exited ' + child.exitCode);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('Server did not become ready');
  };
  const base = await start(output);
  const get = (file, options) => fetch(base + file, options);
  const moduleUrl = versionRoot + 'integrated-v5/app.mjs';
  const initial = await get(moduleUrl);
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await initial.text(), fs.readFileSync(path.join(app, 'app.mjs'), 'utf8'));
  const dependency = new URL('./child.mjs', base + moduleUrl).pathname;
  assert.equal((await get(dependency)).status, 200, 'relative module import must remain within version');
  assert.equal((await get(versionRoot + 'integrated-v5/vendor/pdfjs-5.6.205/pdf.worker.min.mjs')).status, 200);
  const page = await get('/integrated-v5/');
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.ok(page.headers.get('etag'));
  assert.ok(page.headers.get('last-modified'));
  const unversioned = await get('/integrated-v5/app.mjs');
  const etag = unversioned.headers.get('etag');
  const modified = unversioned.headers.get('last-modified');
  assert.equal(unversioned.headers.get('cache-control'), 'no-cache');
  for (const value of [etag, etag.replace(/^W\//, ''), '"unrelated", ' + etag, '*']) {
    const response = await get('/integrated-v5/app.mjs', { headers: { 'If-None-Match': value } });
    assert.equal(response.status, 304, 'matching validator must avoid downloading body');
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('etag'), etag);
  }
  assert.equal((await get('/integrated-v5/app.mjs', { method: 'HEAD', headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await get('/integrated-v5/app.mjs', { headers: { 'If-Modified-Since': modified } })).status, 304);
  assert.equal((await get('/integrated-v5/app.mjs', { headers: { 'If-None-Match': '"stale"', 'If-Modified-Since': modified } })).status, 200, 'ETag takes precedence over date');
  assert.equal((await get('/integrated-v5/app.mjs', { headers: { 'If-Modified-Since': 'invalid' } })).status, 200);
  for (const forbidden of ['/assets/' + '0'.repeat(64) + '/integrated-v5/app.mjs', versionRoot + 'integrated-v5/hidden.test.mjs', versionRoot + '.git/config', versionRoot + 'release.json', versionRoot + 'integrated-v5/index.html', '/deployment/coolify/server.cjs']) {
    assert.ok([403, 404].includes((await get(forbidden)).status), forbidden);
  }
  assert.equal((await get('/integrated-v5/app.mjs', { method: 'POST' })).status, 405);
  assert.equal((await get('/healthz')).headers.get('cache-control'), 'no-store');
  const repeat = build(path.join(directory, 'repeat'));
  assert.equal(repeat.assetVersion, release.assetVersion, 'identical content has a stable version');
  fs.writeFileSync(path.join(app, 'app.mjs'), "import './child.mjs'; export const version = 2;\n");
  const nextOutput = path.join(directory, 'next');
  const next = build(nextOutput);
  assert.notEqual(next.assetVersion, release.assetVersion, 'new content must invalidate version URL');
  const nextBase = await start(nextOutput);
  const changed = await fetch(nextBase + '/integrated-v5/app.mjs', { headers: { 'If-None-Match': etag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get('etag'), etag);
  assert.match(await changed.text(), /version = 2/);
  assert.equal((await fetch(nextBase + moduleUrl)).status, 404, 'old version may never serve new content');
});
