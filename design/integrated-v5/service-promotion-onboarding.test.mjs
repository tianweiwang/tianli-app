import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce } from './engine.mjs';
import { storeOpeningReadiness } from './management.mjs';
import { captureTechServicePromoter } from './service-promotion.mjs';

const group = { role: 'group' }, user = { role: 'user', userId: 'u2' };
const HOUR = 3600000;

function onboarding() {
  let s = seed(), sequence = 0;
  const run = (type, p, actor = group) => {
    s = reduce(s, actor, type, { requestId: `onboarding-regression-${++sequence}`, reason: '独立经营准入回归', ...p });
    return s;
  };
  run('manage.store-save', { name: '回归待开业门店', address: '合成经营地址', phone: '13800008001', contact: '合成负责人', regionId: 'home', lat: 31.23, lng: 121.47, serviceIds: ['relax'], radiusKm: 20, bufferMinutes: 30, qualification: 'REGRESSION-STORE', merchantNo: 'REGRESSION-MERCHANT' });
  const storeId = s.stores.at(-1).id;
  run('manage.tech-save', { storeId, name: '回归在岗技师', phone: '13800008002', gender: 'female', lat: 31.23, lng: 121.47, serviceIds: ['relax'], certificate: 'REGRESSION-CERT', insurance: 'REGRESSION-INSURANCE', validUntil: '2027-12-31' });
  const techId = s.techs.at(-1).id;
  const profile = () => s.techQualifications.find(x => x.techId === techId);
  const qualification = (type, p) => run(`qualification.${type}`, { techId, version: profile()?.version || 0, ...p });
  const h = {
    get s() { return s; }, get store() { return s.stores.find(x => x.id === storeId); }, get tech() { return s.techs.find(x => x.id === techId); },
    get profile() { return profile(); }, get promoter() { return s.servicePromoters.find(x => x.personKind === 'tech' && x.personId === techId); },
    run, qualification,
    reviewDetails() { run('manage.tech-review', { id: techId, version: h.tech.version, decision: 'approve' }); },
    requestQualification() {
      qualification('assess', { serviceIds: ['relax'], batch: '本次实际回归名单', assessor: '回归考核人', proof: 'REGRESSION-ASSESS', occurredAt: s.now, result: 'pass', kind: 'mature' });
      qualification('request', { assessmentId: profile().assessments.at(-1).id });
    },
    approveQualification() { qualification('review', { grantId: profile().grants.at(-1).id, decision: 'approve', reviewer: '回归集团审核', proof: 'REGRESSION-AUTH' }); },
    bookingPayload() { return { storeId, serviceId: 'relax', regionId: 'home', techId, mode: 'specified', genderPreference: 'any', startAt: Math.ceil((s.now + 4 * HOUR) / 1800000) * 1800000, contactName: '合成顾客', phone: '13800008003', adultConfirmed: true, healthConsent: true, identityVerified: true }; },
    enter() { return run('service-promotion.enter', { promoterId: h.promoter.id, version: s.users.find(x => x.id === user.userId).serviceBinding.version || 0 }, user); },
  };
  return h;
}

test('新门店开业前先完成资料与独立资格，自动登记保留真实批准来源', () => {
  const h = onboarding();
  assert.equal(h.store.active, false); assert.equal(h.promoter, undefined);
  h.requestQualification(); assert.equal(h.promoter, undefined);
  assert.throws(() => h.approveQualification(), /资料审核|证书|在岗/);
  h.reviewDetails(); assert.equal(h.promoter, undefined);
  assert.equal(storeOpeningReadiness(h.s, h.store).ready, false);
  h.approveQualification();
  assert.equal(h.profile.grants.at(-1).status, 'approved');
  assert.equal(h.store.active, false);
  assert.equal(storeOpeningReadiness(h.s, h.store).ready, true);
  assert.equal(h.promoter.status, 'active'); assert.equal(h.promoter.origin, 'qualified-tech');
  assert.equal(h.promoter.ownerStoreId, h.store.id);
  assert.equal(h.promoter.eligibility.grantId, h.profile.grants.at(-1).id);
  assert.equal(h.promoter.eligibility.reference, 'REGRESSION-AUTH');
  assert.equal(h.promoter.eligibility.verifiedAt, h.profile.grants.at(-1).review.at);
  assert.equal(h.promoter.identity, null);
});

test('已确证推广身份不能在未营业门店接受客户绑定或接单，原开业后可用', () => {
  const h = onboarding(); h.reviewDetails(); h.requestQualification(); h.approveQualification();
  const before = structuredClone(h.s);
  assert.throws(() => h.enter(), /推广入口无效/);
  assert.throws(() => h.run('booking.create', h.bookingPayload(), user), /门店|营业/);
  assert.deepEqual(h.s, before);
  const promoterId = h.promoter.id;
  h.run('manage.store-status', { id: h.store.id, version: h.store.version, status: 'open' });
  assert.equal(h.store.active, true); assert.equal(h.promoter.id, promoterId);
  h.enter();
  assert.equal(h.s.users.find(x => x.id === user.userId).serviceBinding.promoterId, promoterId);
  h.run('booking.create', h.bookingPayload(), user);
  assert.equal(h.s.bookings.at(-1).servicePromotionSnapshot.promoter.id, promoterId);
  assert.equal(h.s.serviceCommissions.length, 0);
});

test('自动登记仍拒绝缺失资格、错本人错店与未来时间，确证同源不重复', () => {
  const h = onboarding(); h.reviewDetails(); h.requestQualification(); h.approveQualification();
  const original = structuredClone(h.s), e = h.promoter.eligibility;
  for (const bad of [{}, { ...e, eligible: false }, { ...e, techId: 'OTHER' }, { ...e, storeId: 'OTHER' }, { ...e, reference: '' }, { ...e, verifiedAt: h.s.now + 1 }]) {
    const s = structuredClone(h.s);
    assert.throws(() => captureTechServicePromoter(s, h.tech.id, bad), /资格依据/);
    assert.deepEqual(s, original);
  }
  assert.equal(captureTechServicePromoter(h.s, h.tech.id, e).id, h.promoter.id);
  assert.deepEqual(h.s, original);
});

test('未知、不唯一或已有关闭时间的所属门店不能登记技师推广身份', () => {
  const h = onboarding(); h.reviewDetails(); h.requestQualification(); h.approveQualification();
  for (const change of [s => { s.stores = s.stores.filter(x => x.id !== h.store.id); }, s => { s.stores.push({ ...s.stores.find(x => x.id === h.store.id) }); }, s => { s.stores.find(x => x.id === h.store.id).closedAt = s.now; }, s => { s.stores.find(x => x.id === h.store.id).closedAt = 0; }]) {
    const s = structuredClone(h.s); change(s); const before = structuredClone(s);
    assert.throws(() => captureTechServicePromoter(s, h.tech.id, h.promoter.eligibility), /资格依据/);
    assert.deepEqual(s, before);
  }
});
