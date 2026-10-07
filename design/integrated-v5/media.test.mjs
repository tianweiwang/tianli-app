import test from 'node:test';
import assert from 'node:assert/strict';
import { externalizeImages, mediaMarkup, isMediaRef } from './media.mjs';
test('five images and repeated product history/signatures are stored once, keeping references in JSON', async () => {
  const image = 'data:image/png;base64,' + Buffer.alloc(294783, 7).toString('base64');
  const product = { image, gallery: Array(4).fill(image) };
  const state = { product, history: [product, product], signature: JSON.stringify(product), sku: {image} };
  const original = JSON.stringify(state); let calls = 0;
  const result = await externalizeImages(state, async blob => { calls++; assert.equal(blob.size, 294783); return 'media:test-hash'; });
  assert.equal(calls, 1); assert.ok(JSON.stringify(result.value).length < 1000);
  assert.equal(JSON.parse(result.value.signature).image, 'media:test-hash');
  assert.equal(JSON.stringify(state), original);
});
test('media save failure leaves original state intact', async () => {
  const state = { image: 'data:image/png;base64,AQID' }; const original = structuredClone(state);
  await assert.rejects(externalizeImages(state, async () => { throw Error('quota'); }), /quota/);
  assert.deepEqual(state, original);
});
test('existing refs and stock assets do not require byte storage or issue media network URLs', async () => {
  assert.equal((await externalizeImages({image:'media:abc'})).changed, false);
  assert.equal(mediaMarkup('<img src="media:abc"><img src="../asset.svg">'), '<img data-media-ref="abc">'.replace('abc','media:abc') + '<img src="../asset.svg">');
  assert.equal(isMediaRef('media:abc-123'), true); assert.equal(isMediaRef('https://evil/image'), false);
});
