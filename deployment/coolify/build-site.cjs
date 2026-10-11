const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const output = path.resolve(process.argv[3] || path.join(__dirname, 'site'));
if (fs.existsSync(output)) throw new Error('Output must be a new directory: ' + output);
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(output, to)), { recursive: true });
  fs.copyFileSync(from, path.join(output, to));
};

const app = path.join(source, 'design/integrated-v5');
for (const name of fs.readdirSync(app)) {
  if (name === 'index.html' || (/\.(?:css|mjs)$/.test(name) && !/(?:\.test\.|test-fixture|test-helper)/.test(name))) {
    copy(path.join(app, name), 'integrated-v5/' + name);
  }
}
for (const name of ['igood-01.svg', 'igood-02.svg']) {
  copy(path.join(source, 'design/reference-demos/franchise-demo/products', name), 'reference-demos/franchise-demo/products/' + name);
}
copy(require.resolve('lucide/dist/umd/lucide.min.js'), 'admin-prototype-v1/vendor/lucide.min.js');
const pdf = path.dirname(require.resolve('pdfjs-dist/package.json'));
const target = path.join(output, 'integrated-v5/vendor/pdfjs-5.6.205');
fs.mkdirSync(target, { recursive: true });
for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  copy(path.join(pdf, 'legacy/build', name), 'integrated-v5/vendor/pdfjs-5.6.205/' + name);
}
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  fs.cpSync(path.join(pdf, name), path.join(target, name), { recursive: true });
}
copy(path.join(pdf, 'LICENSE'), 'integrated-v5/vendor/pdfjs-5.6.205/LICENSE');
copy(require.resolve('lucide/LICENSE'), 'admin-prototype-v1/vendor/LICENSE');

const manifest = {};
const walk = directory => {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) walk(file);
    else manifest[path.relative(output, file).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
};
walk(output);
const pdfFiles = Object.fromEntries(Object.entries(manifest).filter(([file]) => file.startsWith('integrated-v5/vendor/pdfjs-5.6.205/')).map(([file, hash]) => [file.slice('integrated-v5/vendor/pdfjs-5.6.205/'.length), hash]));
const pdfLock = require('./package-lock.json').packages['node_modules/pdfjs-dist'];
fs.writeFileSync(path.join(target, 'provenance.json'), JSON.stringify({ package: 'pdfjs-dist', version: '5.6.205', build: 'legacy/build', license: 'Apache-2.0', source: pdfLock.resolved, npmIntegrity: pdfLock.integrity, note: 'Generated from npm ci build with locked official npm package.', files: pdfFiles }, null, 2) + '\n');
manifest['integrated-v5/vendor/pdfjs-5.6.205/provenance.json'] = crypto.createHash('sha256').update(fs.readFileSync(path.join(target, 'provenance.json'))).digest('hex');
const assetVersion = crypto.createHash('sha256').update(JSON.stringify(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
const indexFile = path.join(output, 'integrated-v5/index.html');
const index = fs.readFileSync(indexFile, 'utf8').replace(/\b(src|href)="([^"]+)"/g, (attribute, name, value) => {
  if (/^(?:#|[a-z]+:|\/\/)/i.test(value)) return attribute;
  const url = new URL(value, 'https://build.invalid/integrated-v5/');
  const file = url.pathname.slice(1);
  if (!manifest[file]) throw Error('HTML references an unpublished resource: ' + value);
  return name + '="/assets/' + assetVersion + '/' + file + url.search + url.hash + '"';
});
fs.writeFileSync(indexFile, index);
manifest['integrated-v5/index.html'] = crypto.createHash('sha256').update(index).digest('hex');
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify({ sourceCommit: process.env.SOURCE_COMMIT || 'local-check', assetVersion, files: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ output, files: Object.keys(manifest).length, assetVersion }));
