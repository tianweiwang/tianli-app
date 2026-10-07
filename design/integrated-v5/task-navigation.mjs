// Navigation state only. Business records, permissions and form drafts remain authoritative.
import { resolveAccountActor, canAccountView, canAccountReadSource } from './staff-accounts.mjs';
import { canManageView } from './management.mjs';
import { technicianPenaltyCaseResolution } from './technician-penalties.mjs';
import { serviceFinanceTaskBinding } from './service-finance-tasks.mjs';

const fail = () => { throw new Error('待办来源、工作范围或返回路径已失效，请从当前后台的统一待办重新进入。'); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const record = (rows, key) => (rows || []).find(row => row.id === key);
const readable = (actor, route) => canAccountView(actor, route) && canManageView(actor, route);
const backend = (s, raw) => {
  const actor = resolveAccountActor(s, raw);
  if (!actor || !['group', 'store'].includes(actor.role) || actor.role === 'group' && actor.job === 'account-admin') fail();
  if (actor.role === 'store' && !record(s.stores, actor.storeId)) fail();
  return actor;
};

export function taskActorScope(s, rawActor) {
  const a = backend(s, rawActor);
  const job = a.accountId ? a.job : a.role === 'group' ? a.job || 'all' : '';
  return JSON.stringify([a.role, job, a.storeId || '', a.accountId || '', a.sessionId || '', a.grantId || '']);
}

function route(value) {
  if (typeof value !== 'string' || value.length > 2000) fail();
  const path = value.startsWith('#') ? value.slice(1) : value;
  if (!path.startsWith('/') || /[\\#\u0000-\u0020\u007f]/.test(path) || /%(?![a-f0-9]{2})/i.test(path)) fail();
  const url = new URL(path, 'https://task.invalid');
  if (url.origin !== 'https://task.invalid' || url.pathname.includes('//')) fail();
  const rawParts = path.split('?')[0].split('/').slice(1);
  const parts = rawParts.map(part => decodeURIComponent(part));
  if (parts.length < 2 || !['group', 'store'].includes(parts[0]) || parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(part))) fail();
  // URL normalisation must not hide a dot segment or encoded path separator.
  if (url.pathname !== path.split('?')[0]) fail();
  const query = url.searchParams, seen = new Set();
  for (const [key, value] of query) {
    if (seen.has(key) || !/^[A-Za-z][A-Za-z0-9]*$/.test(key) || value.length > 300 || /[\u0000-\u001f\u007f\ufffd]/.test(value)) fail();
    seen.add(key);
  }
  return { path, pathname: '/' + parts.join('/'), parts, query };
}
const only = (query, keys) => [...query.keys()].every(key => keys.includes(key));
function listPath(s, actor, hash) {
  const r = route(hash);
  if(r.pathname===`/${actor.role}/work-escalations`) {
    if(!readable(actor,'work-escalations')||r.query.size)fail();
    return r.path;
  }
  if (r.pathname !== `/${actor.role}/tasks` || !readable(actor, 'tasks') || !only(r.query, ['category', 'status', 'q', 'owner', 'store'])) fail();
  for (const key of ['category', 'status', 'owner', 'store']) if (r.query.has(key) && !/^[A-Za-z0-9_-]*$/.test(r.query.get(key))) fail();
  const store = r.query.get('store');
  if (store && (!record(s.stores, store) || (actor.role === 'store' && store !== actor.storeId))) fail();
  return r.path;
}

const BOOKING_CATEGORIES = ['dispatch', 'change', 'assistance', 'refund', 'dispute', 'safety'];
const SERVICE_EXTRA_SOURCES = {'service-extra-evidence':['serviceExtraEvidence','evidence'],'service-extra-shortage':['serviceRefundShortages','shortages'],'service-extra-recovery':['serviceExtraRecoveries','recoveries'],'service-extra-offset':['serviceExtraOffsets','offsets']};
const SERVICE_PROMOTION_SOURCES={'service-promotion-risk':['servicePromotionRisks','risks','support'],'service-promotion-identity':['servicePromoters','promoters','support'],'service-promotion-withdrawal':['servicePromotionWithdrawals','withdrawals','finance'],'service-promotion-recovery':['servicePromotionRecoveries','recoveries','finance']};
const SERVICE_PROMOTION_FINANCE=['service-promotion-finance-entry','service-promotion-finance-recovery'];
const SERVICE_FINANCE=['service-finance-entry','service-finance-recovery'];
function bindingFor(task) {
  const base = { category: task.category, sourceId: task.sourceId };
  if (BOOKING_CATEGORIES.includes(task.category)) return { ...base, bookingId: task.bookingId, ...(task.refundId ? { refundId: task.refundId } : {}), ...(task.paymentId ? { paymentId: task.paymentId } : {}) };
  if (task.category === 'invoice') return { ...base, invoiceId: task.invoiceId || task.sourceId };
  if (task.category === 'care') return { ...base, caseId: task.caseId || task.sourceId };
  if (task.category === 'followup') return { ...base, followupId: task.followupId || task.sourceId };
  if (task.category === 'technician-penalty-appeal') {
    if (task.id !== `technician-penalty:${task.sourceId}:appeal`) fail();
    return { ...base, bookingId: task.bookingId };
  }
  if (task.category === 'qualification') return { ...base, techId: task.techId, grantId: task.grantId || task.sourceId, ...(task.profileId != null ? {profileId:task.profileId,storeId:task.storeId} : {}) };
  if (['goods-shipping', 'goods-aftersale', 'goods-exception'].includes(task.category)) return { ...base, orderId: task.orderId || task.sourceId };
  if (task.category === 'goods-logistics') return {...base,orderId:task.orderId};
  if (task.category === 'goods-settlement-bill') return { ...base, billId: task.sourceId };
  if (task.category === 'goods-settlement-offset') return { ...base, planId: task.sourceId, billId: task.billId };
  if (task.category === 'goods-settlement-recovery') return { ...base, recoveryId: task.sourceId };
  if (['fulfilment','safe-departure'].includes(task.category)) return {...base,bookingId:task.bookingId};
  if (SERVICE_EXTRA_SOURCES[task.category]) return {...base,bookingId:task.bookingId,paymentId:task.paymentId};
  if(SERVICE_PROMOTION_SOURCES[task.category])return base;
  if(SERVICE_PROMOTION_FINANCE.includes(task.category))return {...base,entryId:task.entryId,bookingId:task.bookingId,paymentId:task.paymentId};
  if(SERVICE_FINANCE.includes(task.category)){
    const kind=task.category==='service-finance-entry'?'entry':'recovery';
    if(task.id!==`service-finance:${kind}:${task.sourceId}`||kind==='entry'&&task.entryId!==task.sourceId||kind==='recovery'&&task.recoveryId!==task.sourceId)fail();
    return {...base,entryId:task.entryId,bookingId:task.bookingId,paymentId:task.paymentId};
  }
  fail();
}

// Re-read the resource even after the pending item has disappeared or changed stage.
// Ownership comes from the original record, never from saved context.storeId.
function source(s, binding) {
  if (!binding || Object.values(binding).some(value => !id(value))) fail();
  const b = binding, category = b.category;
  if (category === 'technician-penalty-appeal') {
    const rows = (s.technicianPenalties || []).filter(row => row.id === b.sourceId), row = rows[0];
    if (rows.length !== 1 || !row.appeal || row.bookingId !== b.bookingId) fail();
    const resolution = technicianPenaltyCaseResolution(s, row.source?.caseId, row.source?.actionIndex);
    if (!resolution.complete || resolution.penaltyId !== row.id) fail();
    return { requiredRoute: 'penalties', requiredJob: 'support', groupOnly: true, storeId: row.storeId, bookingId: row.bookingId, caseId: row.source.caseId };
  }
  if (BOOKING_CATEGORIES.includes(category)) {
    const booking = record(s.bookings, b.bookingId);
    if (!booking) fail();
    let found;
    if (category === 'dispatch') found = booking.round?.id === b.sourceId || record(booking.rounds, b.sourceId);
    if (category === 'change') found = booking.change?.id === b.sourceId || record(booking.changeHistory, b.sourceId);
    if (category === 'assistance') found = record(booking.assistance, b.sourceId);
    if (category === 'dispute') found = record(booking.disputes, b.sourceId);
    if (category === 'safety') found = (s.safety || []).some(x => x.id === b.sourceId && x.bookingId === booking.id && x.storeId === booking.storeId);
    if (category === 'refund') {
      const refund = record(booking.refunds, b.refundId || b.sourceId);
      if (refund && !b.paymentId) found = refund.id === b.sourceId;
      if (refund && b.paymentId) {
        const execution = (refund.executions || []).find(x => x.paymentId === b.paymentId);
        if (execution) found = [execution.refundNo, `${refund.id}:${execution.paymentId}`].includes(b.sourceId);
        else {
          // The original model materialises executions lazily. Approved split
          // lines already identify the source; navigating must not create one.
          const line = (refund.lines || []).find(x => x.paymentId === b.paymentId);
          const payment = [booking.payment, ...(booking.extensions || [])].find(x => x?.id === b.paymentId && x.status === 'success');
          found = line && payment && Number.isSafeInteger(line.amountCents) && line.amountCents >= 0 && b.sourceId === `${refund.id}-${line.paymentId}`;
        }
      }
    }
    if (!found) fail();
    return { requiredRoute: category === 'safety' ? 'safety' : 'bookings', storeId: booking.storeId, bookingId: booking.id };
  }
  if (category === 'invoice' || category === 'care' || category === 'followup') {
    const config = category === 'invoice' ? [s.serviceInvoices, b.invoiceId, 'invoices'] : category === 'care' ? [s.serviceCareCases, b.caseId, 'care'] : [s.serviceCareFollowups, b.followupId, 'care'];
    const row = record(config[0], config[1]), booking = record(s.bookings, row?.bookingId);
    if (!row || row.id !== b.sourceId || !booking || booking.storeId !== row.storeId) fail();
    return { requiredRoute: config[2], storeId: row.storeId, bookingId: booking.id };
  }
  if (category === 'qualification') {
    const people=(s.techs || []).filter(x=>x.id===b.techId),tech=people[0];
    const explicit=b.profileId!=null||b.storeId!=null;
    const profiles=(s.techQualifications || []).filter(x=>explicit?x.id===b.profileId:x.techId===b.techId&&x.storeId===tech?.storeId);
    const profile=profiles[0],grants=(profile?.grants || []).filter(x=>x.id===b.grantId);
    if(people.length!==1||profiles.length!==1||!profile||profile.techId!==tech.id||b.grantId!==b.sourceId||grants.length!==1||
      (explicit?profile.storeId!==b.storeId:profile.storeId!==tech.storeId)||
      (s.techQualifications || []).flatMap(x=>x.grants || []).filter(x=>x.id===b.grantId).length!==1)fail();
    return { requiredRoute:'qualifications',storeId:profile.storeId,profileId:profile.id,explicitProfile:explicit };
  }
  if (['goods-shipping', 'goods-aftersale', 'goods-exception'].includes(category)) {
    const order = record(s.goods, b.orderId);
    if (!order || (category === 'goods-shipping' ? order.id !== b.sourceId : !record(category === 'goods-exception' ? order.incidents : order.cases, b.sourceId))) fail();
    return { requiredRoute: 'goods', storeId: order.source?.storeId || null };
  }
  if (category === 'goods-logistics') {
    const order=record(s.goods,b.orderId);
    if(!order || !(order.id===b.sourceId || record(order.goodsDeliveryFacts,b.sourceId) || record(order.cases,b.sourceId))) fail();
    return {requiredRoute:'goods',storeId:order.source?.storeId||null,orderId:order.id};
  }
  if (['goods-settlement-bill','goods-settlement-offset'].includes(category)) {
    const bill = record(s.bills,b.billId), plan = category === 'goods-settlement-offset' ? record(s.goodsOffsetPlans,b.planId) : null;
    if (!bill || (category === 'goods-settlement-bill' ? bill.id !== b.sourceId : !plan || plan.id !== b.sourceId || plan.billId !== bill.id || plan.storeId !== bill.storeId)) fail();
    return { requiredRoute:'bills',storeId:bill.storeId,billId:bill.id };
  }
  if (category === 'goods-settlement-recovery') {
    const recovery = record(s.recoveries,b.recoveryId), order = record(s.goods,recovery?.orderId);
    if (!recovery || recovery.id !== b.sourceId || !order || order.source?.storeId !== recovery.storeId) fail();
    return { requiredRoute:'recoveries',storeId:recovery.storeId,orderId:order.id };
  }
  if (['fulfilment','safe-departure'].includes(category)) {
    const booking=record(s.bookings,b.bookingId);
    if(!booking) fail();
    const found=category==='fulfilment'?(s.fulfilmentRecords||[]).some(x=>x.bookingId===booking.id&&x.storeId===booking.storeId&&record(x.facts,b.sourceId)):(s.fulfilmentDepartures||[]).some(x=>x.id===b.sourceId&&x.bookingId===booking.id&&x.storeId===booking.storeId);
    if(!found) fail();
    return {requiredRoute:'fulfilment',storeId:booking.storeId,bookingId:booking.id};
  }
  if (SERVICE_EXTRA_SOURCES[category]) {
    const [container,section]=SERVICE_EXTRA_SOURCES[category],row=record(s[container],b.sourceId),booking=record(s.bookings,b.bookingId),payment=[booking?.payment,...(booking?.extensions||[])].find(x=>x?.id===b.paymentId);
    if(!row||!booking||!payment||row.bookingId!==booking.id||row.paymentId!==payment.id||row.storeId!==booking.storeId) fail();
    if(category==='service-extra-offset') {
      const entry=record(s.serviceFinanceEntries,row.entryId),debt=record(s.serviceExtraRecoveries,row.recoveryId);
      if(!entry||!debt||entry.bookingId!==booking.id||entry.paymentId!==payment.id||entry.storeId!==booking.storeId||debt.storeId!==booking.storeId) fail();
    }
    if(category==='service-extra-recovery') {
      const shortage=record(s.serviceRefundShortages,row.shortageId);
      if(!shortage||shortage.bookingId!==booking.id||shortage.paymentId!==payment.id||shortage.storeId!==booking.storeId||!record(shortage.advances,row.advanceId)) fail();
    }
    return {requiredRoute:'service-finance',storeId:booking.storeId,bookingId:booking.id,paymentId:payment.id,section};
  }
  if(SERVICE_PROMOTION_SOURCES[category]) {
    const [container,section,job]=SERVICE_PROMOTION_SOURCES[category],row=record(s[container],b.sourceId),promoter=category==='service-promotion-identity'?row:record(s.servicePromoters,row?.promoterId),person=promoter&&(promoter.personKind==='user'?record(s.users,promoter.personId):promoter.personKind==='tech'?record(s.techs,promoter.personId):null);
    if(!row||!promoter||!person||!['store','group'].includes(promoter.ownerType)||promoter.ownerType==='store'&&!record(s.stores,promoter.ownerStoreId))fail();
    const verifyCommission=c=>{const booking=c&&record(s.bookings,c.bookingId),payment=[booking?.payment,...(booking?.extensions||[])].find(x=>x?.id===c?.paymentId),snapshot=payment===booking?.payment?booking?.servicePromotionSnapshot:payment?.servicePromotionSnapshot;return c&&booking&&payment?.status==='success'&&c.storeId===booking.storeId&&snapshot?.promoter?.id===promoter.id&&snapshot.promoter.personKind===promoter.personKind&&snapshot.promoter.personId===promoter.personId;};
    if(category==='service-promotion-withdrawal'&&(!row.allocations?.length||row.allocations.some(a=>!verifyCommission(record(s.serviceCommissions,a.commissionId)))))fail();
    if(category==='service-promotion-recovery'&&!verifyCommission(record(s.serviceCommissions,row.commissionId)))fail();
    if(category==='service-promotion-risk'){const booking=record(s.bookings,row.bookingId);if(!booking||booking.servicePromotionSnapshot?.promoter?.id!==promoter.id)fail();}
    return {requiredRoute:'service-promotion',requiredJob:job,groupOnly:true,storeId:row.storeId||row.ownerStoreId||null,section};
  }
  if(SERVICE_FINANCE.includes(category)) {
    const original=serviceFinanceTaskBinding(s,b.entryId,category==='service-finance-recovery'?{recoveryId:b.sourceId}:{});
    if(!original||original.bookingId!==b.bookingId||original.paymentId!==b.paymentId||category==='service-finance-entry'&&original.entryId!==b.sourceId)fail();
    return {requiredRoute:'service-finance',requiredJob:'finance',groupOnly:true,storeId:original.storeId,bookingId:original.bookingId,paymentId:original.paymentId,entryId:original.entryId};
  }
  if(SERVICE_PROMOTION_FINANCE.includes(category)) {
    const entry=record(s.serviceFinanceEntries,b.entryId),booking=record(s.bookings,b.bookingId),payment=[booking?.payment,...(booking?.extensions||[])].find(x=>x?.id===b.paymentId),snapshot=payment===booking?.payment?booking?.servicePromotionSnapshot:payment?.servicePromotionSnapshot;
    if(!entry||!booking||payment?.status!=='success'||entry.bookingId!==booking.id||entry.paymentId!==payment.id||entry.storeId!==booking.storeId||!snapshot?.promoter||entry.sourceSnapshot?.promoterId!==snapshot.promoter.id||entry.sourceSnapshot.ownerType!==snapshot.promoter.ownerType||(entry.sourceSnapshot.ownerStoreId||null)!==(snapshot.promoter.ownerStoreId||null))fail();
    if(category==='service-promotion-finance-entry'&&entry.id!==b.sourceId)fail();
    const financeSnapshot=payment===booking.payment?booking.serviceFinanceSnapshot:payment.serviceFinanceSnapshot,sourceFields=x=>x&&[x.status,x.customerType,x.ownerType,x.ownerStoreId||null,x.promoterId||null];
    if(JSON.stringify(sourceFields(financeSnapshot?.source))!==JSON.stringify(sourceFields(entry.sourceSnapshot)))fail();
    if(category==='service-promotion-finance-recovery'){const debt=record(s.serviceFinanceRecoveries,b.sourceId);if(!debt||debt.entryId!==entry.id||debt.bookingId!==booking.id||debt.paymentId!==payment.id||debt.storeId!==booking.storeId)fail();}
    return {requiredRoute:'service-finance',requiredJob:'finance',groupOnly:true,storeId:booking.storeId,bookingId:booking.id,paymentId:payment.id,entryId:entry.id};
  }
  fail();
}

function owned(s, a, b, savedStore) {
  const value = source(s, b);
  if(value.groupOnly&&(a.role!=='group'||!['all',value.requiredJob].includes(a.job)))fail();
  if (b.category === 'technician-penalty-appeal' && !canAccountReadSource(s, a, 'care-case', record(s.serviceCareCases, value.caseId))) fail();
  if (value.storeId !== savedStore || (value.storeId && !record(s.stores, value.storeId)) || (a.role === 'store' && value.storeId !== a.storeId) || !readable(a, value.requiredRoute)) fail();
  return value;
}
function detailQuery(r) { return r.query.size === 0; }
function listQuery(r, source) {
  return only(r.query, ['status', 'q', 'bookingId', 'storeId']) && (!r.query.has('bookingId') || r.query.get('bookingId') === source.bookingId) && (!r.query.get('storeId') || r.query.get('storeId') === source.storeId);
}
function invoiceRelated(s, sourceId, targetId) {
  const original = record(s.serviceInvoices, sourceId), pending = [original], seen = new Set();
  while (pending.length) {
    const invoice = pending.pop();
    if (!invoice || seen.has(invoice.id)) continue;
    seen.add(invoice.id);
    if (invoice.id === targetId) return true;
    for (const [key, reverse] of [['replacesId', 'replacedById'], ['replacedById', 'replacesId']]) {
      const next = record(s.serviceInvoices, invoice[key]);
      if (next && next[reverse] === invoice.id && next.bookingId === original.bookingId && next.storeId === original.storeId && next.userId === original.userId) pending.push(next);
    }
  }
  return false;
}
function related(s, a, b, src, r) {
  if (r.parts[0] !== a.role || !readable(a, r.parts[1])) return false;
  const path = r.pathname, prefix = `/${a.role}`, bookingPath = `${prefix}/bookings/${src.bookingId}`;
  if (src.bookingId && path === bookingPath) return detailQuery(r);
  if (b.category === 'technician-penalty-appeal') return [`${prefix}/penalties/${b.sourceId}`, `${prefix}/penalties`, `${prefix}/care/case/${src.caseId}`].includes(path) && detailQuery(r);
  if (BOOKING_CATEGORIES.includes(b.category)) {
    if (path === `${bookingPath}/assign`) return detailQuery(r);
    if (path === `${bookingPath}/reschedule`) return only(r.query, ['startAt']) && (!r.query.has('startAt') || /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(r.query.get('startAt')));
    if (path === `${prefix}/bookings`) return listQuery(r, src);
    if (b.category === 'safety' && path === `${prefix}/safety`) return detailQuery(r);
  }
  if (b.category === 'invoice') return r.parts[1] === 'invoices' && r.parts.length === 3 ? detailQuery(r) && invoiceRelated(s, b.invoiceId, r.parts[2]) : path === `${prefix}/invoices` && listQuery(r, src);
  if (['care', 'followup'].includes(b.category)) {
    const part = b.category === 'care' ? 'case' : 'followup', entity = b.caseId || b.followupId;
    if (path === `${prefix}/care/${part}/${entity}`) return detailQuery(r);
    if (b.category === 'care' && r.parts[1] === 'penalties' && r.parts.length === 3 && detailQuery(r)) {
      const row = record(s.serviceCareCases, b.caseId);
      return (row?.specialistActions || []).some((action, index) => {
        if (action.kind !== 'penalty' || action.penaltyId !== r.parts[2]) return false;
        const result = technicianPenaltyCaseResolution(s, row.id, index);
        return result.complete && result.penaltyId === r.parts[2];
      });
    }
    if ([`${prefix}/care`, `${prefix}/care/cases`, `${prefix}/care/followups`].includes(path)) return listQuery(r, src);
    if (b.category === 'care' && path === `${prefix}/care/followups/new`) return only(r.query, ['bookingId', 'caseId']) && r.query.get('bookingId') === src.bookingId && r.query.get('caseId') === b.caseId;
    if (b.category === 'followup' && path === `${prefix}/care/new`) return only(r.query, ['bookingId', 'sourceKind', 'sourceId']) && r.query.get('bookingId') === src.bookingId && r.query.get('sourceKind') === 'followup' && r.query.get('sourceId') === b.followupId;
    // The existing follow-up page may link to the case created from that record.
    if (b.category === 'followup' && r.parts[1] === 'care' && r.parts[2] === 'case' && r.parts.length === 4) {
      const row = record(s.serviceCareCases, r.parts[3]);
      return detailQuery(r) && row?.bookingId === src.bookingId && row.storeId === src.storeId && row.source?.kind === 'followup' && row.source.id === b.followupId;
    }
    if (b.category === 'care' && r.parts[1] === 'qualifications' && r.parts.length === 3) {
      const row = record(s.serviceCareCases, b.caseId), booking = record(s.bookings, src.bookingId), tech = record(s.techs, r.parts[2]);
      if (!row || !tech || row.techId !== tech.id || booking?.techId !== tech.id || tech.storeId !== src.storeId) return false;
      if (r.query.size === 0) {
        const profile = (s.techQualifications || []).find(x => x.techId === tech.id && x.storeId === src.storeId);
        return (row.specialistActions || []).some((action, index) => ['restriction', 'retraining'].includes(action.kind) && (profile?.holds || []).some(hold => hold.id === action.qualificationHoldId && hold.source?.caseId === row.id && hold.source?.actionIndex === index));
      }
      if (!only(r.query, ['caseId', 'actionIndex', 'caseVersion']) || r.query.get('caseId') !== row.id || !/^\d+$/.test(r.query.get('actionIndex') || '') || !/^\d+$/.test(r.query.get('caseVersion') || '')) return false;
      const index = Number(r.query.get('actionIndex')), version = Number(r.query.get('caseVersion'));
      // A concurrently changed form still needs an exit back to the task list.
      return Number.isSafeInteger(index) && Number.isSafeInteger(version) && version >= 1 && version <= row.version && ['restriction', 'retraining'].includes(row.specialistActions?.[index]?.kind);
    }
  }
  if (b.category === 'qualification') {
    if(path===`${prefix}/qualifications/${b.techId}`)return src.explicitProfile ? only(r.query,['profileId','storeId'])&&r.query.size===2&&r.query.get('profileId')===b.profileId&&r.query.get('storeId')===src.storeId : detailQuery(r);
    return path===`${prefix}/qualifications`&&listQuery(r,src);
  }
  if (['goods-shipping', 'goods-aftersale', 'goods-exception','goods-logistics'].includes(b.category)) return path === `${prefix}/goods/${b.orderId}` ? detailQuery(r) : [ `${prefix}/goods`, ...(b.category === 'goods-aftersale' ? [`${prefix}/returns`] : []) ].includes(path) && listQuery(r, src);
  if (['goods-settlement-bill','goods-settlement-offset'].includes(b.category)) {
    if (path === `${prefix}/bills`) return listQuery(r,src);
    if (r.parts[1] !== 'bills' || r.parts.length !== 3 || !detailQuery(r)) return false;
    const pending=[record(s.bills,src.billId)],seen=new Set();
    while(pending.length) {
      const bill=pending.pop();if(!bill||seen.has(bill.id)||bill.storeId!==src.storeId)continue;seen.add(bill.id);
      if(bill.id===r.parts[2])return true;
      const parent=record(s.bills,bill.parentBillId);
      if(parent?.storeId===src.storeId && parent.childBillIds?.includes(bill.id))pending.push(parent);
      for(const id of bill.childBillIds||[]) {const child=record(s.bills,id);if(child?.parentBillId===bill.id && child.storeId===src.storeId)pending.push(child);}
    }
    return false;
  }
  if (b.category === 'goods-settlement-recovery') return path === `${prefix}/recoveries` ? detailQuery(r) : path === `${prefix}/goods/${src.orderId}` && detailQuery(r);
  if (['fulfilment','safe-departure'].includes(b.category)) return path===`${prefix}/fulfilment/${src.bookingId}`&&detailQuery(r);
  if (SERVICE_EXTRA_SOURCES[b.category]) return (path===`${prefix}/service-finance/extras/${src.section}/${b.sourceId}`||path===`${prefix}/service-finance/extras/${src.section}`)&&detailQuery(r);
  if(SERVICE_PROMOTION_SOURCES[b.category])return (path===`${prefix}/service-promotion/${src.section}/${b.sourceId}`||path===`${prefix}/service-promotion/${src.section}`)&&detailQuery(r);
  if(SERVICE_PROMOTION_FINANCE.includes(b.category)||SERVICE_FINANCE.includes(b.category)) {
    if(path===`${prefix}/service-finance/ledger`)return listQuery(r,src);
    return (path===`${prefix}/service-finance/entry/${src.entryId}`||path===`${prefix}/bookings/${src.bookingId}`||['service-promotion-finance-recovery','service-finance-recovery'].includes(b.category)&&path===`${prefix}/service-finance/recoveries`)&&detailQuery(r);
  }
  return false;
}

export function createTaskReturnContext(s, rawActor, { taskKey, listHash, task, token } = {}) {
  const actor = backend(s, rawActor);
  if (!id(token) || !id(taskKey) || !task || taskKey !== task.id) fail();
  const binding = bindingFor(task), src = owned(s, actor, binding, task.storeId ?? null);
  const jobs = task.allowedJobs?.[actor.role];
  if (task.requiredRoute !== src.requiredRoute || !Array.isArray(jobs) || ((actor.accountId || actor.role === 'group' && actor.job && actor.job !== 'all') && !jobs.includes(actor.job))) fail();
  const target = route(task.routes?.[actor.role]);
  if (!related(s, actor, binding, src, target)) fail();
  return { version: 1, token, scope: taskActorScope(s, actor), taskKey, listHash: listPath(s, actor, listHash), targetPath: target.path, storeId: src.storeId, binding };
}

export function taskNavigationTarget(s, rawActor, context, currentHash) {
  try {
    const actor = backend(s, rawActor), c = context;
    if (!c || c.version !== 1 || !id(c.token) || !id(c.taskKey) || c.scope !== taskActorScope(s, actor)) return false;
    listPath(s, actor, c.listHash);
    const src = owned(s, actor, c.binding, c.storeId);
    return related(s, actor, c.binding, src, route(c.targetPath)) && related(s, actor, c.binding, src, route(currentHash));
  } catch { return false; }
}

export function taskReturnTarget(s, actor, context, currentHash) {
  return taskNavigationTarget(s, actor, context, currentHash) ? context.listHash : null;
}
