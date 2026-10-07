import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as media from './media.mjs';
import { createIndexedDBStandin } from './privacy-cleanup-test-fixture.mjs';

// Original media producer/read helper with real Blob/SHA; only IndexedDB is a
// standard API stand-in. No browser, network, business fixture or delete call.
const idb = createIndexedDBStandin(), originalIDB = globalThis.indexedDB;
globalThis.indexedDB = idb.indexedDB;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=', 'base64');
const image = () => new Blob([PNG], { type: 'image/png' });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const events = op => idb.events.filter(event => event.op === op && event.store === 'images');
test.beforeEach(() => {
  idb.setHook(null); idb.events.length = 0;
  for (const db of idb.databases.values()) for (const store of db.stores.values()) store.clear();
});
test.after(() => { globalThis.indexedDB = originalIDB; });

test('original saveMedia returns the real byte hash; readMedia returns the same Blob after readonly completion', async () => {
  assert.equal(typeof media.readMedia, 'function');
  const file = image(), ref = await media.saveMedia(file);
  assert.equal(ref, 'media:' + digest(PNG));
  const read = await media.readMedia(ref);
  assert.ok(read instanceof Blob);
  assert.equal(read.type, file.type); assert.equal(read.size, PNG.length);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), PNG);
  assert.equal(digest(Buffer.from(await read.arrayBuffer())), ref.slice(6));
  assert.equal(idb.events.at(-1).op, 'complete');
  assert.equal(idb.events.at(-1).mode, 'readonly');
  assert.equal(events('put').length, 1); assert.equal(events('get').length, 1);
  assert.deepEqual([...idb.databases.keys()], ['tianli-integrated-media-v1']);
});

test('optional file metadata matches the actual Blob and does not require a copied name', async () => {
  const ref = await media.saveMedia(image());
  const actual = await media.readMedia({ ref, type: 'image/png', size: PNG.length });
  assert.deepEqual(Buffer.from(await actual.arrayBuffer()), PNG);
  assert.equal((await media.readMedia({ ref })).size, PNG.length);
  for (const file of [{ ref, type: 'image/jpeg' }, { ref, size: PNG.length + 1 }]) {
    await assert.rejects(media.readMedia(file), /元数据.*不一致/);
  }
  for (const file of [{ ref, type: '' }, { ref, type: 'text/html' }, { ref, size: '1' }, { ref, size: -1 }, { ref, size: NaN }]) {
    await assert.rejects(media.readMedia(file), /元数据.*无效/);
  }
  assert.equal(events('put').length, 1);
});

test('bad read references fail before any file I/O; mediaUrl still passes through ordinary assets', async () => {
  for (const ref of [null, undefined, {}, [], '', 'media:', 'media:a/b', 'invoice-file:' + 'a'.repeat(64), 'https://example.invalid/image.png']) {
    await assert.rejects(media.readMedia(ref), /图片引用无效/);
  }
  assert.equal(idb.events.length, 0);
  for (const asset of ['', '../asset.svg', 'https://example.invalid/image.png']) assert.equal(await media.mediaUrl(asset), asset);
  assert.equal(idb.events.length, 0);
});

test('missing original media stays a missing-file error for readMedia and mediaUrl', async () => {
  await media.saveMedia(image());
  const missing = 'media:' + '0'.repeat(64), before = events('put').length;
  for (const read of [() => media.readMedia(missing), () => media.mediaUrl(missing)]) {
    await assert.rejects(read(), { message: '图片记录缺失，请在商品管理中重新选择图片。' });
  }
  assert.equal(events('put').length, before);
});

test('the existing isMediaRef shape remains readable for a retained legacy key', async () => {
  await media.saveMedia(image());
  const ref = 'media:legacy-source-1';
  idb.store('tianli-integrated-media-v1', 'images').set(ref, image());
  assert.equal(media.isMediaRef(ref), true);
  assert.deepEqual(Buffer.from(await (await media.readMedia(ref)).arrayBuffer()), PNG);
});

test('corrupt stored values are rejected rather than replaced with an empty Blob', async () => {
  const ref = await media.saveMedia(image());
  idb.store('tianli-integrated-media-v1', 'images').set(ref, { unexpected: true });
  await assert.rejects(media.readMedia(ref), /图片记录无效/);
  await assert.rejects(media.mediaUrl(ref), /图片记录无效/);
  assert.deepEqual(idb.store('tianli-integrated-media-v1', 'images').get(ref), { unexpected: true });
});

test('actual IndexedDB get failure rejects and leaves the original stored file intact', async () => {
  const ref = await media.saveMedia(image());
  idb.setHook(event => { if (event.op === 'get' && event.store === 'images') throw Error('synthetic original-media read failure'); });
  await assert.rejects(media.readMedia(ref), /original-media read failure/);
  await assert.rejects(media.mediaUrl(ref), /original-media read failure/);
  idb.setHook(null);
  assert.deepEqual(Buffer.from(await (await media.readMedia(ref)).arrayBuffer()), PNG);
  assert.equal(events('put').length, 1);
});

test('mediaUrl uses the original Blob reader once and preserves its URL cache', async () => {
  const ref = await media.saveMedia(image()), before = events('get').length;
  const url = await media.mediaUrl(ref);
  assert.match(url, /^blob:/);
  assert.equal(events('get').length, before + 1);
  assert.equal(await media.mediaUrl(ref), url);
  assert.equal(events('get').length, before + 1);
  URL.revokeObjectURL(url);
});

test('default externalizeImages still saves one original Blob and leaves the source object intact', async () => {
  const inline = 'data:image/png;base64,' + PNG.toString('base64');
  const source = { image: inline, gallery: [inline] }, original = structuredClone(source);
  const result = await media.externalizeImages(source);
  assert.equal(result.changed, true); assert.equal(result.count, 1);
  assert.deepEqual(source, original);
  assert.equal(result.value.image, 'media:' + digest(PNG));
  assert.equal(result.value.gallery[0], result.value.image);
  assert.deepEqual(Buffer.from(await (await media.readMedia(result.value.image)).arrayBuffer()), PNG);
  assert.equal(events('put').length, 1);
});
