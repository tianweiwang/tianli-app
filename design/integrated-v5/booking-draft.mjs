import { privacyProfile } from './privacy.mjs';
import { bookingOptions } from './booking.mjs';
import { handoffSources } from './service-handoff.mjs';

const BOOL = new Set(['identityVerified', 'identityConsent', 'adultConfirmed', 'healthConsent', 'recipientConfirmed']);
const RECIPIENT_FIELDS = ['recipientId', 'recipientVersion', 'recipientKind', 'recipientName', 'recipientRelationship', 'attention', 'preference', 'sourceKey'];
const FIELDS = new Set(['regionId', 'storeId', 'serviceId', 'mode', 'techId', 'genderPreference', 'date', 'startAt', 'contactName', 'phone', 'locationMode', ...RECIPIENT_FIELDS, ...BOOL]);
export const bookingDate = at => new Date(Number(at) + 8 * 3600000).toISOString().slice(0, 10);

export function createBookingDraft(s, userId, requestId) {
  const user = s.users.find(item => item.id === userId);
  return {
    userId, privacyVersion: privacyProfile(s, userId).version, recipientId: '', recipientVersion: null, recipientKind: '', recipientName: '', recipientRelationship: '', recipientConfirmed: false,
    attention: '', preference: '', sourceKey: '', sourceBookingId: '', sourceNoteId: '', sourceVersion: null,
    regionId: 'home', storeId: 'xingfu', serviceId: 'relax', mode: 'nearest', techId: '', genderPreference: 'any',
    date: bookingDate(s.now + (s.bookingRules?.earliestHours || 2) * 3600000), startAt: null,
    contactName: user?.name || '', phone: user?.phone || '', locationMode: 'manual',
    identityVerified: false, identityConsent: false, adultConfirmed: false, healthConsent: false,
    requestId, submittedId: null
  };
}

export function repeatBookingDraft(s, userId, bookingId, requestId) {
  const booking = s.bookings.find(item => item.id === bookingId && item.userId === userId);
  if (!s.users.some(item => item.id === userId) || !booking) throw new Error('只能再次预约本人的历史订单。');
  if (!['done', 'cancelled', 'closed'].includes(booking.status)) throw new Error('请从已完成、已取消或已关闭的预约发起再次预约。');
  const freshRequestId = String(requestId || '').trim();
  if (!freshRequestId || freshRequestId.length > 300 || s.bookings.some(item => item.userId === userId && item.requestId === freshRequestId)) throw new Error('再次预约需要新的提交标识，请重新发起。');
  const draft = {
    ...createBookingDraft(s, userId, freshRequestId),
    regionId: booking.regionId || '', storeId: booking.storeId || '', serviceId: booking.serviceId || '',
    mode: booking.mode === 'nearest' ? 'nearest' : 'specified',
    techId: booking.mode === 'nearest' ? '' : booking.techId || '',
    genderPreference: ['any', 'male', 'female'].includes(booking.genderPreference) ? booking.genderPreference : 'any'
  };
  if (!s.regions.some(item => item.id === draft.regionId)) {
    draft.regionId = ''; draft.storeId = ''; draft.techId = '';
    return { draft, next: '/user/booking/stores', message: '原预约片区已失效，请重新选择片区和可约门店。' };
  }
  const options = bookingOptions(s, draft);
  if (!options.stores.some(item => item.id === draft.storeId && item.bookable && item.covered)) {
    draft.storeId = ''; draft.techId = '';
    return { draft, next: '/user/booking/stores', message: '原门店已暂停、移除或不再覆盖所选片区，请重新选择门店。' };
  }
  const service = s.services.find(item => item.id === draft.serviceId);
  const store = s.stores.find(item => item.id === draft.storeId);
  if (!service || service.active === false || !store.serviceIds.includes(draft.serviceId)) {
    draft.serviceId = ''; draft.techId = '';
    return { draft, next: '/user/booking/store', message: '原项目已下架或本店不再提供，请重新选择项目。' };
  }
  if (!options.valid) {
    if (draft.mode === 'specified') draft.techId = '';
    return { draft, next: '/user/booking/tech', message: `${options.error || '原技师当前不可约'}。请重新确认技师与偏好。` };
  }
  return { draft, next: '/user/booking/slots', message: '已带入原门店、项目和预约方式，请重新选择时间，并确认当前价格、联系人及健康告知。' };
}

export function patchBookingDraft(s, current, changes, requestId = current.requestId) {
  let next = { ...current };
  const privacyVersion = privacyProfile(s, current.userId).version;
  if ((current.privacyVersion ?? 0) !== privacyVersion) { next.privacyVersion = privacyVersion; next.identityConsent = false; next.identityVerified = false; }
  // An explicit consent action may reauthorize at the current version; unrelated edits cannot.
  if (changes.identityConsent === true || changes.identityConsent === 'on' || changes.identityConsent === 'true') next.privacyVersion = privacyVersion;
  if (changes.restart) next = { ...createBookingDraft(s, current.userId || '', requestId), regionId: current.regionId, storeId: current.storeId, contactName: current.contactName, phone: current.phone, identityVerified: current.identityVerified, identityConsent: current.identityConsent, locationMode: current.locationMode };
  if ((current.privacyVersion ?? 0) !== privacyVersion && !changes.identityConsent) { next.identityConsent = false; next.identityVerified = false; }
  const patch = Object.fromEntries(Object.entries(changes).filter(([key]) => FIELDS.has(key)));
  for (const key of BOOL) if (key in patch) patch[key] = patch[key] === true || patch[key] === 'true' || patch[key] === 'on';
  if ('startAt' in patch) patch.startAt = patch.startAt ? Number(patch.startAt) : null;
  const changed = key => key in patch && patch[key] !== next[key];
  const upstreamChanged = ['regionId', 'storeId', 'serviceId', 'genderPreference'].some(changed);
  const resetTime = upstreamChanged || ['mode', 'techId', 'date'].some(changed);
  const regionChanged = changed('regionId'), storeChanged = changed('storeId'), serviceChanged = changed('serviceId');
  const recipientChanged = changed('recipientId'), sourceChanged = changed('sourceKey');
  const reconfirm = RECIPIENT_FIELDS.some(changed) || storeChanged || serviceChanged;
  if (resetTime && !('startAt' in patch)) next.startAt = null;
  if (upstreamChanged) next.techId = '';
  if ((storeChanged || serviceChanged) && !('mode' in patch)) next.mode = 'nearest';
  Object.assign(next, patch);
  if (recipientChanged) {
    const profile = (s.recipients || []).find(x => x.id === next.recipientId && x.userId === next.userId && x.active);
    next.recipientVersion = profile?.version ?? null;
    next.recipientKind = ''; next.recipientName = ''; next.recipientRelationship = '';
  }
  if (recipientChanged || storeChanged) {
    next.attention = ''; next.preference = ''; next.sourceKey = ''; next.sourceBookingId = ''; next.sourceNoteId = ''; next.sourceVersion = null;
  } else if (sourceChanged) {
    const source = handoffSources(s, { role: 'user', userId: next.userId }, next.recipientId, next.storeId).find(x => `${x.bookingId}:${x.noteId}:${x.version}` === next.sourceKey);
    next.sourceBookingId = source?.bookingId || ''; next.sourceNoteId = source?.noteId || ''; next.sourceVersion = source?.version ?? null;
    next.preference = source?.advice || '';
    if (!source) next.sourceKey = '';
  }
  if (reconfirm) { next.recipientConfirmed = false; next.adultConfirmed = false; next.healthConsent = false; }
  if (next.mode === 'nearest') next.techId = '';
  if (regionChanged) {
    const stores = bookingOptions(s, { ...next, startAt: undefined }).stores.filter(item => item.covered && item.bookable);
    if (!stores.some(item => item.id === next.storeId)) next.storeId = stores[0]?.id || '';
  }
  const store = s.stores.find(item => item.id === next.storeId);
  if (store && (!store.serviceIds.includes(next.serviceId) || s.services.find(x => x.id === next.serviceId)?.active === false)) next.serviceId = store.serviceIds.find(id => s.services.some(x => x.id === id && x.active !== false)) || '';
  if (next.techId && !bookingOptions(s, { ...next, startAt: undefined }).candidates.some(item => item.id === next.techId && item.available)) next.techId = '';
  if (next.startAt) next.date = bookingDate(next.startAt);
  if (next.storeId !== current.storeId && !storeChanged) {
    next.attention = ''; next.preference = ''; next.sourceKey = ''; next.sourceBookingId = ''; next.sourceNoteId = ''; next.sourceVersion = null;
    next.recipientConfirmed = false; next.adultConfirmed = false; next.healthConsent = false;
  }
  if (next.serviceId !== current.serviceId) { next.recipientConfirmed = false; next.adultConfirmed = false; next.healthConsent = false; }
  if (!next.identityConsent) next.identityVerified = false;
  return next;
}

export function bookingDraftPayload(draft) {
  if (draft.submittedId) throw new Error('本次预约已提交，请查看预约或重新发起。');
  if (!draft.startAt) throw new Error('请先选择可预约的时间。');
  if (!String(draft.contactName || '').trim() || !/^1\d{10}$/.test(String(draft.phone || ''))) throw new Error('请完善联系人及11位联系电话。');
  if (!draft.recipientId || !draft.recipientConfirmed) throw new Error('请在联系人步骤选择服务对象，并重新确认当次事项。');
  if (draft.recipientId === 'visit' && (!['self', 'family', 'other'].includes(draft.recipientKind) || !String(draft.recipientName || '').trim())) throw new Error('请完善本次服务对象的称呼与关系。');
  if (!draft.adultConfirmed) throw new Error('请确认服务对象已满18周岁。');
  if (!draft.healthConsent) throw new Error('请阅读并确认健康告知。');
  if (!draft.identityConsent || !draft.identityVerified) throw new Error('请先完成预约人身份授权与核验演示。');
  return { privacyVersion: draft.privacyVersion ?? 0, privacyConsent: draft.identityConsent === true, ...Object.fromEntries(['regionId', 'storeId', 'serviceId', 'mode', 'techId', 'genderPreference', 'startAt', 'contactName', 'phone', 'identityVerified', 'identityConsent', 'adultConfirmed', 'healthConsent', 'requestId', ...RECIPIENT_FIELDS, 'recipientConfirmed', 'sourceBookingId', 'sourceNoteId', 'sourceVersion'].map(key => [key, draft[key]])) };
}
