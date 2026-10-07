import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce } from './engine.mjs';
import { affectedBookings, assertJob, canManageView, imageSource, storeOpeningReadiness } from './management.mjs';
import { bookingOptions } from './booking.mjs';

const group = { role: 'group' }, user = { role: 'user', userId: 'u1' }, manager = { role: 'manager', storeId: 'xingfu' };
let seq = 0;
const command = (s, type, p, actor = group) => reduce(s, actor, `manage.${type}`, { requestId: `management-closure-${++seq}`, reason: '核验经营流程闭环', ...p });
const authorizeTechnician = (s, techId) => {
  const tech=s.techs.find(t=>t.id===techId), profile=()=>s.techQualifications.find(x=>x.techId===techId);
  const q=(type,p)=>{s=reduce(s,group,'qualification.'+type,{techId,version:profile()?.version||0,requestId:'closure-qualification-'+(++seq),reason:'测试独立授权前提',...p});};
  q('assess',{serviceIds:tech.serviceIds,batch:'测试审核名单',assessor:'测试考核人',proof:'TEST-ASSESS',occurredAt:s.now,result:'pass',kind:'mature'});
  q('request',{assessmentId:profile().assessments.at(-1).id});
  q('review',{grantId:profile().grants.at(-1).id,decision:'approve',reviewer:'测试集团审核',proof:'TEST-AUTH'}); return s;
};
const storeData = { name: '待上线门店', address: '示例路1号', phone: '13800008001', contact: '负责人', regionId: 'home', lat: 31.23, lng: 121.47, serviceIds: ['relax'], radiusKm: 20, bufferMinutes: 30, qualification: 'Q-DEMO', merchantNo: 'M-DEMO' };
const techData = storeId => ({ storeId, name: '审核技师', phone: '13800008002', gender: 'female', lat: 31.23, lng: 121.47, serviceIds: ['relax'], certificate: 'C-DEMO', insurance: 'I-DEMO', validUntil: '2027-12-31' });
const createStore = () => command(seed(), 'store-save', storeData);
const createReadyStore = () => {
  let s = createStore(), store = s.stores.at(-1);
  s = command(s, 'tech-save', techData(store.id));
  const tech = s.techs.at(-1);
  s = command(s, 'tech-review', { id: tech.id, version: tech.version, decision: 'approve' });
  assert.equal(storeOpeningReadiness(s,store).ready,false);
  return authorizeTechnician(s,tech.id);
};
const pendingCandidate = () => {
  let s = reduce(seed(), user, 'booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', mode: 'specified', genderPreference: 'any', startAt: '2026-10-02T14:00', contactName: '测试', phone: '13800008003', adultConfirmed: true, healthConsent: true, identityVerified: true, requestId: `booking-closure-${++seq}` });
  const id = s.bookings[0].id;
  s = reduce(s, user, 'booking.pay', { id, outcome: 'success' });
  s = reduce(s, { role: 'tech', techId: 'lin' }, 'booking.accept', { id });
  return reduce(s, manager, 'booking.assign', { id, techId: 'zhou', reason: '等待用户同意改派' });
};

test('finance can enter appointment refunds without gaining customer-service commands', () => {
  const finance = { role: 'group', job: 'finance' }, support = { role: 'group', job: 'support' };
  assert.equal(canManageView(finance, 'bookings'), true);
  assert.equal(canManageView(finance, 'safety'), false);
  for (const command of ['booking.refund-pay', 'booking.refund-query']) { assert.doesNotThrow(() => assertJob(finance, command)); assert.throws(() => assertJob(support, command), /岗位无权/); }
  for (const command of ['booking.refund-review', 'booking.dispute-review', 'booking.dispute-close', 'booking.help-ack', 'booking.help-close']) { assert.throws(() => assertJob(finance, command), /岗位无权/); assert.doesNotThrow(() => assertJob(support, command)); }
});

test('pending candidate remains in organization impact list and cannot be suspended', () => {
  const s = pendingCandidate(), b = s.bookings[0], zhou = s.techs.find(t => t.id === 'zhou');
  assert.equal(b.change.status, 'pending');
  assert.deepEqual(affectedBookings(s, 'techId', 'zhou').map(x => x.id), [b.id]);
  assert.deepEqual(affectedBookings(s, 'techId', 'lin').map(x => x.id), [b.id]);
  assert.deepEqual(affectedBookings(s, 'storeId', 'xingfu').map(x => x.id), [b.id]);
  assert.deepEqual(affectedBookings(s, 'serviceId', 'relax').map(x => x.id), [b.id]);
  assert.throws(() => command(s, 'tech-review', { id: zhou.id, version: zhou.version, decision: 'pause' }), /在途预约/);
  assert.throws(() => command(s, 'tech-save', { ...zhou, phone: '13800008004', serviceIds: ['neck'] }), /在途预约使用此项目/);
  assert.equal(s.techs.find(t => t.id === 'zhou').active, true);
  const accepted = reduce(s, user, 'booking.change-answer', { id: b.id, changeId: b.change.id, decision: 'accept' });
  assert.equal(accepted.bookings[0].techId, 'zhou');
});

test('rejected specified reassignment releases its candidate under the existing cancellation policy', () => {
  let s = pendingCandidate();
  const b = s.bookings[0];
  s = reduce(s, user, 'booking.change-answer', { id: b.id, changeId: b.change.id, decision: 'reject' });
  assert.equal(affectedBookings(s, 'techId', 'zhou').length, 0);
  // Rejecting a specified reassignment cancels the original booking under its existing policy.
  assert.equal(s.bookings[0].status, 'cancelled');
});

test('store cannot open without an approved, insured technician for an enabled project', () => {
  let s = createStore(), store = s.stores.at(-1);
  assert.equal(storeOpeningReadiness(s, store).ready, false);
  assert.throws(() => command(s, 'store-status', { id: store.id, version: store.version, status: 'open' }), /至少1名/);
  s = command(s, 'tech-save', techData(store.id));
  assert.throws(() => command(s, 'store-status', { id: store.id, version: store.version, status: 'open' }), /至少1名/);
  assert.equal(s.stores.at(-1).active, false);
});

test('technician review can precede store opening; bookings remain unavailable until opening', () => {
  let s = createReadyStore(), store = s.stores.at(-1), tech = s.techs.at(-1);
  assert.equal(tech.reviewStatus, 'approved'); assert.equal(tech.active, true); assert.equal(store.active, false);
  const query = { storeId: store.id, serviceId: 'relax', regionId: 'home', mode: 'specified', techId: tech.id, startAt: '2026-10-02T14:00' };
  assert.equal(bookingOptions(s, query).valid, false);
  assert.deepEqual(storeOpeningReadiness(s, store).technicianIds, [tech.id]);
  s = command(s, 'store-status', { id: store.id, version: store.version, status: 'open' });
  assert.equal(s.stores.at(-1).active, true);
  assert.equal(bookingOptions(s, query).valid, true);
});

test('expired, paused, unreviewed and mismatched technician records do not satisfy opening', () => {
  const base = createReadyStore();
  for (const patch of [{ validUntil: '2026-10-01' }, { active: false }, { reviewStatus: 'pending' }, { insurance: '' }, { certificate: '' }, { serviceIds: ['neck'] }]) {
    const s = structuredClone(base); Object.assign(s.techs.at(-1), patch); const store = s.stores.at(-1);
    assert.equal(storeOpeningReadiness(s, store).ready, false, JSON.stringify(patch));
    assert.throws(() => command(s, 'store-status', { id: store.id, version: store.version, status: 'open' }), /至少1名/);
  }
});

test('live store cannot clear onboarding fields or silently replace approved credentials', () => {
  let s = createReadyStore(), store = s.stores.at(-1);
  s = command(s, 'store-status', { id: store.id, version: store.version, status: 'open' }); store = s.stores.at(-1);
  for (const patch of [{ qualification: '' }, { merchantNo: '' }, { serviceIds: [] }]) assert.throws(() => command(s, 'store-save', { ...store, ...patch }, { role: 'store', storeId: store.id }), /营业门店须保留/);
  assert.throws(() => command(s, 'store-save', { ...store, merchantNo: 'M-NEW' }), /先暂停营业/);
  s = command(s, 'store-save', { ...store, name: '正常改名门店' }); store = s.stores.at(-1);
  assert.equal(store.active, true);
  s = command(s, 'store-status', { id: store.id, version: store.version, status: 'promotion-on' }); store = s.stores.at(-1);
  s = reduce(s, user, 'promotion.enter', { storeId: store.id, sourceId: 'onboarding-source' });
  s = reduce(s, user, 'cart.set', { skuId: 'oil', qty: 1 });
  s = reduce(s, user, 'goods.submit', { addressId: 'AD1', requestId: 'before-credential-change' });
  const lockedSource = structuredClone(s.goods.at(-1).source);
  assert.equal(lockedSource.storeId, store.id);
  s = command(s, 'store-status', { id: store.id, version: store.version, status: 'pause' }); store = s.stores.at(-1);
  assert.equal(store.promotionDisabled, false);
  s = command(s, 'store-save', { ...store, merchantNo: 'M-NEW' }); store = s.stores.at(-1);
  assert.equal(store.reviewStatus, 'pending'); assert.equal(store.active, false);
  assert.equal(store.promotionDisabled, true);
  assert.deepEqual(s.goods.at(-1).source, lockedSource);
  assert.throws(() => reduce(s, user, 'promotion.enter', { storeId: store.id, sourceId: 'after-credential-change' }), /已失效/);
  assert.throws(() => command(s, 'store-status', { id: store.id, version: store.version, status: 'promotion-on' }), /审核通过/);
  s = command(s, 'store-status', { id: store.id, version: store.version, status: 'open' });
  assert.equal(s.stores.at(-1).reviewStatus, 'approved');
  assert.equal(s.stores.at(-1).promotionDisabled, true);
});

test('legacy active seed is preserved without fabricated onboarding records', () => {
  const s = seed();
  assert.ok(s.stores.every(x => x.active)); assert.ok(s.techs.every(x => x.active));
  assert.ok(s.stores.every(x => !x.qualification && !x.merchantNo));
  assert.ok(s.techs.every(x => !x.insurance));
  assert.equal(bookingOptions(s, { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', mode: 'specified', techId: 'lin', startAt: '2026-10-02T14:00' }).valid, true);
});

test('managed media references are accepted while scripts and arbitrary URLs stay forbidden', () => {
  assert.equal(imageSource('media:2fbd-66d4-01'), 'media:2fbd-66d4-01');
  for (const value of ['media:../escape', 'media:', 'media:<script>', 'javascript:alert(1)', 'https://unknown.invalid/image.png']) assert.throws(() => imageSource(value), /图片请使用/);
});
