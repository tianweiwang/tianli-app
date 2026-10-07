// Runtime adapters for a verified ordinary user's original technician ledgers.
// These wrappers never create a work session or rebuild a personal balance.
import { resolveAccountActor } from './staff-accounts.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { techIncomeView } from './tech-income.mjs';
import { servicePromotionView, servicePromotionCommand, authorizedServicePromotionFile } from './service-promotion.mjs';

const commands = new Set(['withdraw-create', 'withdraw-confirm', 'withdraw-cancel'].map(x => 'service-promotion.' + x));
const incomeContainers = ['techIncomeEntries', 'techIncomeDifferences', 'techIncomeAdjustments', 'techIncomePayouts'];
const promotionContainers = ['servicePromoters', 'servicePromotionInvites', 'servicePromotionRules', 'servicePromotionAgreements', 'servicePromotionPolicies', 'servicePromotionRisks', 'servicePromotionFirsts', 'serviceCommissions', 'servicePromotionWithdrawals', 'servicePromotionRecoveries', 'servicePromotionOffsets', 'servicePromotionRequests'];
const fail = message => { throw new Error(message); };
const copy = value => structuredClone(value);
const unique = (rows, id, label) => {
  const matches = Array.isArray(rows) ? rows.filter(row => row?.id === id) : [];
  if (typeof id !== 'string' || !id || matches.length !== 1) fail(label + '原来源缺失或不唯一');
  return matches[0];
};
const requireContainers = (s, names) => {
  for (const name of names) if (!Array.isArray(s[name])) fail('本人原账来源容器缺失：' + name);
};
const owns = (row, techId) => row?.personKind === 'tech' && row.personId === techId;
const keyFor = id => 'tech:' + id;

function binding(s, rawActor, requestedTechId) {
  const actor = resolveAccountActor(s, rawActor);
  if (actor?.role !== 'user') fail('仅明确普通用户本人可读取原技师资金');
  const user = unique(s.users, actor.userId, '普通用户');
  if (privacyUseClosed(s, user.id)) fail('账号使用已关闭，原技师资金闭域来源尚未接齐；不能恢复普通使用');
  if (!Array.isArray(s.techs)) fail('技师本人原来源容器缺失');
  const links = s.organizationIdentityLinks;
  if (links != null && !Array.isArray(links)) fail('持久本人映射来源无效');
  const relevant = (links || []).filter(row => row?.userId === user.id || row?.techId === requestedTechId);
  const mapped = s.techs.filter(t => t?.userId === user.id || relevant.some(row => row.techId === t?.id && row.userId === user.id));
  if (mapped.length !== 1) fail('普通用户与原技师本人映射缺失或冲突');
  const tech = unique(s.techs, requestedTechId || mapped[0].id, '技师');
  if (tech.id !== mapped[0].id || tech.userId != null && tech.userId !== user.id) fail('不能使用其他技师原资金或冲突本人映射');
  const related = (links || []).filter(row => row?.techId === tech.id || row?.userId === user.id);
  let link = null;
  if (tech.identityLinkId != null || related.length) {
    if (related.length !== 1) fail('持久本人映射原来源重复或冲突');
    link = unique(links, tech.identityLinkId || related[0].id, '持久本人映射');
    const author = link.createdBy;
    if (link !== related[0] || link.techId !== tech.id || link.userId !== user.id ||
        typeof link.reference !== 'string' || !link.reference.trim() ||
        !Number.isSafeInteger(link.occurredAt) || link.occurredAt < 0 || link.occurredAt > s.now ||
        !Number.isSafeInteger(link.createdAt) || link.createdAt < link.occurredAt || link.createdAt > s.now ||
        !author?.accountId || author.role !== 'group' || author.job !== 'account-admin') {
      fail('持久本人映射缺少准确原资格核验来源');
    }
  } else if (tech.userId !== user.id) fail('技师本人持久来源缺失');
  return { techId: tech.id, userId: user.id, personKey: keyFor(tech.id), ...(link ? { identityLinkId: link.id } : {}) };
}

function paymentSource(s, row) {
  if (typeof row.paymentId !== 'string' || !row.paymentId) fail('原支付资金来源缺失');
  const booking = unique(s.bookings, row.bookingId, '原预约资金');
  const payments = [booking.payment, ...(booking.extensions || [])].filter(p => p?.id === row.paymentId);
  if (payments.length !== 1 || booking.storeId !== row.storeId) fail('原支付资金来源缺失、所属变化或不唯一');
  return booking;
}

function incomeSource(s, owner) {
  requireContainers(s, [...incomeContainers, 'bookings']);
  const entries = s.techIncomeEntries.filter(row => row.techId === owner.techId);
  for (const entry of entries) {
    unique(s.techIncomeEntries, entry.id, '原提成');
    paymentSource(s, entry);
  }
  for (const name of ['techIncomeDifferences', 'techIncomeAdjustments']) {
    for (const row of s[name].filter(row => row.techId === owner.techId)) {
      unique(s[name], row.id, '原提成事项');
      const entry = unique(s.techIncomeEntries, row.entryId, '原提成事项明细');
      if (entry.techId !== owner.techId || entry.bookingId !== row.bookingId || entry.paymentId !== row.paymentId || entry.storeId !== row.storeId) fail('原提成事项与本人明细来源冲突');
    }
  }
  for (const row of s.techIncomePayouts.filter(row => row.techId === owner.techId)) {
    unique(s.techIncomePayouts, row.id, '原提成发放');
    if (!Array.isArray(row.lines) || !row.lines.length) fail('原提成发放明细来源缺失');
    for (const line of row.lines) {
      const entry = unique(s.techIncomeEntries, line.entryId, '原提成发放明细');
      if (entry.techId !== owner.techId || entry.storeId !== row.storeId || entry.month !== row.month) fail('原提成发放包含其他主体来源');
    }
  }
}

function promotionSource(s, owner) {
  requireContainers(s, [...promotionContainers, 'bookings']);
  const promoters = s.servicePromoters.filter(row => owns(row, owner.techId));
  for (const row of promoters) unique(s.servicePromoters, row.id, '原技师推广身份');
  for (const name of ['serviceCommissions', 'servicePromotionWithdrawals', 'servicePromotionRecoveries', 'servicePromotionOffsets']) {
    for (const row of s[name]) {
      if ((promoters.some(p => p.id === row.promoterId) || owns(row, owner.techId)) && row.personKey !== owner.personKey) fail('原本人资金与旧personKey来源冲突');
    }
  }
  const promoter = id => {
    const row = unique(s.servicePromoters, id, '原推广资金身份');
    if (!owns(row, owner.techId)) fail('原推广资金包含其他本人身份');
    return row;
  };
  const commission = id => {
    const row = unique(s.serviceCommissions, id, '原佣金明细');
    if (row.personKey !== owner.personKey) fail('原佣金明细属于其他本人');
    return row;
  };
  for (const row of s.serviceCommissions.filter(row => row.personKey === owner.personKey)) {
    unique(s.serviceCommissions, row.id, '原佣金');
    promoter(row.promoterId);
    const booking = paymentSource(s, row), snapshot = booking.servicePromotionSnapshot?.promoter;
    if (!owns(snapshot, owner.techId) || snapshot.id !== row.promoterId) fail('原佣金缺少准确本人下单身份快照');
  }
  for (const row of s.servicePromotionWithdrawals.filter(row => row.personKey === owner.personKey)) {
    unique(s.servicePromotionWithdrawals, row.id, '原提现');
    promoter(row.promoterId);
    if (!owns(row, owner.techId) || !Array.isArray(row.allocations) || !row.allocations.length) fail('原提现本人或占款来源缺失');
    for (const allocation of row.allocations) commission(allocation.commissionId);
  }
  for (const row of s.servicePromotionRecoveries.filter(row => row.personKey === owner.personKey)) {
    unique(s.servicePromotionRecoveries, row.id, '原扣回');
    promoter(row.promoterId);
    const source = commission(row.commissionId);
    if (source.promoterId !== row.promoterId || source.bookingId !== row.bookingId || source.paymentId !== row.paymentId || source.storeId !== row.storeId) fail('原扣回与本人佣金来源冲突');
  }
  for (const row of s.servicePromotionOffsets.filter(row => row.personKey === owner.personKey)) {
    unique(s.servicePromotionOffsets, row.id, '原扣回抵扣');
    const source = commission(row.commissionId), debt = unique(s.servicePromotionRecoveries, row.recoveryId, '原抵扣债务');
    if (debt.personKey !== owner.personKey || source.promoterId !== row.promoterId) fail('原抵扣包含其他主体来源');
  }
}

function capability(s, rawActor, type, payload = {}) {
  if (!commands.has(type)) fail('本人历史出口只允许原提现申请、确认及撤销');
  let techId = payload.techId;
  let promoter = null, withdrawal = null;
  if (payload.promoterId != null) promoter = unique(s.servicePromoters, payload.promoterId, '原提现推广身份');
  if (payload.id != null) {
    withdrawal = unique(s.servicePromotionWithdrawals, payload.id, '原提现申请');
    const subject = unique(s.servicePromoters, withdrawal.promoterId, '原提现身份');
    if (promoter && promoter.id !== subject.id) fail('原提现申请与本人推广身份冲突');
    promoter = subject;
  }
  if (techId == null && promoter?.personKind === 'tech') techId = promoter.personId;
  const owner = binding(s, rawActor, techId);
  promotionSource(s, owner);
  if (!promoter || !owns(promoter, owner.techId) || withdrawal && withdrawal.personKey !== owner.personKey) fail('原提现不属于本人技师资金范围');
  return { allowed: true, ...owner };
}

function contextFor(rawActor, techId, ctx = {}) {
  // The original module calls this trusted callback with the actual state again.
  // No owner actor or role-conversion helper is exported to application callers.
  return { ...ctx, historicalTechOwner(s, actor, type, payload = {}) {
    if (actor?.role !== 'user' || actor.userId !== rawActor?.userId) fail('本人历史调用者已变化');
    const owner = binding(s, rawActor, techId);
    promotionSource(s, owner);
    if (commands.has(type)) {
      const allowed = capability(s, rawActor, type, { ...payload, techId });
      if (allowed.techId !== owner.techId) fail('本人历史命令来源已变化');
    } else if (!['service-promotion.view', 'service-promotion.file'].includes(type)) fail('历史本人能力不能用于其他推广命令');
    return owner;
  } };
}

function fileSlots(s, owner) {
  const out = [], add = (id, prefix, files) => {
    if (!Array.isArray(files)) return;
    files.forEach((file, index) => { if (file?.ref) out.push({ id, slot: prefix + ':' + index, file }); });
  };
  const promoters = s.servicePromoters.filter(row => owns(row, owner.techId));
  for (const row of promoters) {
    add(row.id, 'identity', row.identity?.evidenceRefs);
    (row.identityHistory || []).forEach((history, index) => add(row.id, 'identity-history:' + index, history.evidenceRefs));
  }
  const agreementIds = new Set([
    ...promoters.map(row => row.agreementSnapshot?.id),
    ...s.servicePromotionInvites.filter(row => owns(row, owner.techId)).map(row => row.agreementSnapshot?.id)
  ].filter(Boolean));
  for (const id of agreementIds) {
    const row = unique(s.servicePromotionAgreements, id, '原本人推广协议');
    add(row.id, 'agreement', row.evidenceRefs);
  }
  for (const row of s.servicePromotionWithdrawals.filter(row => row.personKey === owner.personKey)) {
    add(row.id, 'payment', row.execution?.proof?.evidenceRefs);
    (row.execution?.results || []).forEach((result, index) => add(row.id, 'result:' + index, result.facts?.evidenceRefs));
  }
  for (const row of s.servicePromotionRecoveries.filter(row => row.personKey === owner.personKey)) {
    for (const record of row.records || []) add(row.id, 'record:' + record.id, record.evidenceRefs);
  }
  for (const row of s.servicePromotionRisks.filter(row => promoters.some(p => p.id === row.promoterId))) {
    unique(s.servicePromotionRisks, row.id, '原本人推广审核');
    add(row.id, 'risk-review', row.review?.evidenceRefs);
    (row.reviewHistory || []).forEach((review, index) => add(row.id, 'risk-history:' + index, review.evidenceRefs));
  }
  return out;
}

function authorizeFile(s, rawActor, reference, source = {}) {
  const owner = binding(s, rawActor, source.techId);
  promotionSource(s, owner);
  if (typeof reference !== 'string' || !/^invoice-file:[a-f0-9]{64}$/.test(reference)) fail('原附件引用无效');
  const matches = fileSlots(s, owner).filter(row => row.file.ref === reference && (source.id == null || source.id === row.id) && (source.slot == null || source.slot === row.slot));
  if (!matches.length) fail('本人原附件来源槽缺失或已变化');
  const ctx = contextFor(rawActor, owner.techId), results = matches.map(row => {
    try {
      const file = authorizedServicePromotionFile(s, rawActor, row.id, row.slot, reference, ctx);
      if (JSON.stringify(file) !== JSON.stringify(row.file)) fail('原附件槽元数据已变化');
      return { id: row.id, slot: row.slot, allowed: true, file };
    } catch (error) {
      if (error.message !== '当前岗位或来源槽无权查看实际证据') throw error;
      return { id: row.id, slot: row.slot, allowed: false, reason: error.message };
    }
  });
  const allowed = results.filter(row => row.allowed);
  return copy({ ...owner, reference, allowed: allowed.length > 0, ...(allowed.length ? {} : { reason: '原内部审核或财务附件继续按原岗位保留' }), sources: results, ...(results.length === 1 ? results[0] : {}) });
}

export function createTechHistoricalRightsAdapters() {
  return Object.freeze({
    incomeView(s, rawActor, techId) {
      const owner = binding(s, rawActor, techId);
      incomeSource(s, owner);
      return techIncomeView(s, { role: 'tech', techId: owner.techId });
    },
    promotionView(s, rawActor, techId) {
      const owner = binding(s, rawActor, techId);
      promotionSource(s, owner);
      const view = servicePromotionView(s, rawActor, contextFor(rawActor, owner.techId));
      // Keep only the person's original agreement sources; a same-type global
      // agreement is not evidence of this person's acceptance or file access.
      const ids = new Set([...view.promoters.map(row => row.agreementSnapshot?.id), ...view.invites.map(row => row.agreementSnapshot?.id)].filter(Boolean));
      view.agreements = view.agreements.filter(row => ids.has(row.id)).map(row => {
        const agreement = copy(row);
        if (Array.isArray(agreement.evidenceRefs)) agreement.evidenceRefs = agreement.evidenceRefs.filter((file, index) => authorizeFile(s, rawActor, file.ref, { techId: owner.techId, id: row.id, slot: 'agreement:' + index }).allowed);
        return agreement;
      });
      return view;
    },
    assertCommand: capability,
    authorizeFile
  });
}

export function techHistoricalRightsCommand(s, rawActor, type, payload = {}, ctx = {}) {
  if (!commands.has(type)) return undefined;
  // The normal ordinary-user promoter path is left to the original dispatcher.
  const subject = payload.id != null ? unique(s.servicePromotionWithdrawals, payload.id, '原提现申请') : payload.promoterId != null ? unique(s.servicePromoters, payload.promoterId, '原推广身份') : null;
  const promoter = subject?.personKind === 'tech' && subject?.personId ? subject : subject?.promoterId ? unique(s.servicePromoters, subject.promoterId, '原提现推广身份') : null;
  if (!promoter && payload.techId == null) return undefined;
  if (promoter?.personKind !== 'tech' && payload.techId == null) return undefined;
  const owner = capability(s, rawActor, type, payload);
  if (type !== 'service-promotion.withdraw-create' && payload.id == null) fail('本人原提现决定须提供准确原申请');
  return servicePromotionCommand(s, rawActor, type, payload, contextFor(rawActor, owner.techId, ctx));
}
