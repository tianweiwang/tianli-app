import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './engine.mjs';
import { createBookingDraft, patchBookingDraft, bookingDraftPayload } from './booking-draft.mjs';

test('更换门店立即更新提交归属，清理原技师与时间，保留联系人', () => {
  const s = seed(), d = { ...createBookingDraft(s, 'u1', 'draft-1'), mode: 'specified', techId: 'lin', startAt: s.now + 4 * 3600000, phone: '13800008000' };
  const next = patchBookingDraft(s, d, { storeId: 'silver' });
  assert.equal(next.storeId, 'silver'); assert.equal(next.techId, ''); assert.equal(next.startAt, null); assert.equal(next.mode, 'nearest'); assert.equal(next.phone, d.phone); assert.equal(d.storeId, 'xingfu');
});
test('就近指定互斥，偏好改变清除不匹配人选', () => {
  const s = seed(), d = { ...createBookingDraft(s, 'u1', 'draft-1'), mode: 'specified', techId: 'lin', startAt: s.now + 4 * 3600000 };
  assert.equal(patchBookingDraft(s, d, { mode: 'nearest' }).techId, '');
  const next = patchBookingDraft(s, d, { genderPreference: 'female' });
  assert.equal(next.techId, ''); assert.equal(next.startAt, null); assert.equal(next.mode, 'specified');
});
test('用户草稿相互独立，返回只改当前字段，提交后新建使用新幂等标识', () => {
  const s = seed(), one = createBookingDraft(s, 'u1', 'one'), two = createBookingDraft(s, 'u2', 'two');
  const edited = patchBookingDraft(s, one, { contactName: '演示联系人', phone: '13800008000', adultConfirmed: true });
  assert.notEqual(edited.contactName, two.contactName); assert.equal(two.phone, '');
  const returned = patchBookingDraft(s, edited, { date: '2026-10-03' });
  assert.equal(returned.contactName, edited.contactName); assert.equal(returned.phone, edited.phone); assert.equal(returned.adultConfirmed, true);
  const restarted = patchBookingDraft(s, { ...returned, submittedId: 'BK1' }, { restart: true, serviceId: 'neck' }, 'new');
  assert.equal(restarted.submittedId, null); assert.equal(restarted.requestId, 'new'); assert.equal(restarted.serviceId, 'neck'); assert.equal(restarted.phone, edited.phone); assert.equal(restarted.adultConfirmed, false);
});
test('片区独立于门店，超出覆盖不能留下可提交的预约；撤回身份同意清除核验', () => {
  const s = seed(), d = createBookingDraft(s, 'u1', 'one');
  const moved = patchBookingDraft(s, d, { storeId: 'silver' });
  assert.equal(moved.regionId, 'home');
  const outside = patchBookingDraft(s, moved, { regionId: 'outside' });
  assert.equal(outside.storeId, ''); assert.equal(outside.startAt, null);
  const withdrawn = patchBookingDraft(s, { ...d, identityConsent: true, identityVerified: true }, { identityConsent: false });
  assert.equal(withdrawn.identityVerified, false);
});
test('确认提交须完成时间联系人成年健康与身份，重复草稿不能再建单', () => {
  const s = seed(), draft = { ...createBookingDraft(s, 'u1', 'one'), recipientId: 'visit', recipientKind: 'self', recipientName: '测试本人', recipientConfirmed: true, startAt: s.now + 4 * 3600000, phone: '13800008000', adultConfirmed: true, healthConsent: true, identityConsent: true, identityVerified: true };
  assert.equal(bookingDraftPayload(draft).requestId, 'one');
  for (const key of ['adultConfirmed', 'healthConsent', 'identityConsent', 'identityVerified']) assert.throws(() => bookingDraftPayload({ ...draft, [key]: false }));
  assert.throws(() => bookingDraftPayload({ ...draft, submittedId: 'BK1' }), /已提交/);
});
