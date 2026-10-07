// Service reviews are facts from completed bookings. Reads never migrate or write.
import { actorAccountFields } from './staff-accounts.mjs';
const DAY = 86400000;
export const REVIEW_TAGS = Object.freeze(['准时', '手法专业', '沟通好']);
const COMMANDS = new Set(['review.create', 'review.moderate-text', 'review.hide', 'review.appeal', 'review.appeal-store', 'review.appeal-final']);
const clone = value => structuredClone(value);
const groupSupport = actor => actor?.role === 'group' && (!actor.job || ['all', 'support'].includes(actor.job));
const allowed = actor => ['user', 'tech', 'store', 'manager'].includes(actor?.role) || groupSupport(actor);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const signature = value => JSON.stringify(canonical(value));
const actorRecord = actor => ({role: actor.role, id: actor.role === 'user' ? actor.userId : actor.role === 'tech' ? actor.techId : ['store', 'manager'].includes(actor.role) ? actor.storeId : 'group', job: actor.role === 'group' ? actor.job || null : null, ...actorAccountFields(actor)});
const hidden = review => Boolean(review.hiddenReasons?.length || review.appeal?.status === 'upheld');
function required(value, label, ctx, limit = 1000) {
  const text = String(value ?? '').trim();
  if (!text || text.length > limit) ctx.fail(`请填写${label}（最多${limit}字）`);
  return text;
}
export function upgradeServiceReviews(s) {
  s.serviceReviews ??= [];
  s.serviceReviewRequests ??= [];
  return s;
}
export function canReadServiceReview(actor, review) {
  if (!actor || !review) return false;
  if (actor.role === 'user') return Boolean(actor.userId && actor.userId === review.userId);
  if (actor.role === 'tech') return Boolean(actor.techId && actor.techId === review.techId);
  if (['store', 'manager'].includes(actor.role)) return Boolean(actor.storeId && actor.storeId === review.storeId);
  return groupSupport(actor);
}
export function reviewEligibility(s, booking, actor) {
  const existing = (s.serviceReviews || []).find(review => review.bookingId === booking?.id);
  const completed = Boolean(booking?.status === 'done' && Number.isFinite(booking.completedAt) && booking.completedAt <= s.now);
  const deadline = completed ? booking.completedAt + 7 * DAY : null;
  const reason = !booking ? '预约不存在' : actor?.role !== 'user' || !actor.userId || actor.userId !== booking.userId || !s.users?.some(user => user.id === actor.userId) ? '仅预约本人可以评价' : existing ? '该预约已评价，每个主预约只能提交一次且不可修改' : !completed ? '服务完成后才能评价' : s.now > deadline ? '已超过完成后7天的评价期限' : !booking.techId || !booking.storeId ? '缺少实际服务技师或门店，请先核对预约记录' : '';
  return {canCreate: !reason, reason, deadline, reviewId: existing?.id || null};
}
function capabilities(s, actor, review) {
  const read = canReadServiceReview(actor, review), group = read && groupSupport(actor);
  const appealDeadline = review.createdAt + 7 * DAY;
  const appealReason = actor?.role !== 'tech' || actor.techId !== review.techId ? '仅实际服务技师可以申诉' : review.score > 2 ? '仅1–2星评价可以申诉' : review.appeal ? '每条评价仅能申诉一次' : !Number.isFinite(review.createdAt) || review.createdAt > s.now || s.now > appealDeadline ? '已超过评价后7天的申诉期限' : '';
  return {
    canModerate: Boolean(group && review.text && ['pending', 'error'].includes(review.textAudit?.status)),
    canHide: Boolean(group && !review.hiddenReasons?.some(item => item.kind === 'content')),
    canAppeal: Boolean(read && !appealReason), appealReason, appealDeadline,
    canStoreReview: Boolean(read && ['store', 'manager'].includes(actor.role) && actor.storeId === review.storeId && review.appeal?.status === 'store_pending'),
    canFinalReview: Boolean(group && review.appeal?.status === 'group_pending')
  };
}
function history(s, review, type, actor, ctx, details = {}) {
  review.updatedAt = s.now;
  review.history.push({action: type, at: s.now, version: review.version, actor: actorRecord(actor), ...clone(details)});
  // Global logs identify the action only. Raw text and internal reasons stay in the scoped record.
  ctx.log?.(review, `服务评价 ${type} · ${review.id}`);
}
function authorize(s, actor, type, review, booking, ctx) {
  if (type === 'review.create') {
    if (!booking || actor?.role !== 'user' || !actor.userId || actor.userId !== booking.userId || !s.users?.some(user => user.id === actor.userId)) ctx.fail('仅预约本人可以评价');
    return;
  }
  if (!review || !canReadServiceReview(actor, review)) ctx.fail('评价不存在或无权处理');
  if (['review.moderate-text', 'review.hide', 'review.appeal-final'].includes(type) && !groupSupport(actor)) ctx.fail('仅集团客服或管理员可以审核评价');
  if (type === 'review.appeal' && (actor.role !== 'tech' || actor.techId !== review.techId || !s.techs?.some(tech => tech.id === actor.techId))) ctx.fail('仅实际服务技师可以申诉');
  if (type === 'review.appeal-store' && (!['store', 'manager'].includes(actor.role) || actor.storeId !== review.storeId || !s.stores?.some(store => store.id === actor.storeId))) ctx.fail('仅原服务门店或店长可以初审');
}
export function serviceReviewCommand(s, actor, type, p, ctx) {
  if (!COMMANDS.has(type)) ctx.fail('不支持的评价操作');
  upgradeServiceReviews(s);
  let review = type === 'review.create' ? null : s.serviceReviews.find(item => item.id === p.id);
  const booking = (s.bookings || []).find(item => item.id === (review?.bookingId || p.bookingId));
  authorize(s, actor, type, review, booking, ctx);
  const requestId = required(p.requestId, '本次操作的唯一提交标识', ctx, 300);
  const who = signature(actorRecord(actor)), fingerprint = signature({type, payload: p});
  const prior = s.serviceReviewRequests.find(item => item.actor === who && item.requestId === requestId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) ctx.fail('同一提交标识不能用于不同评价操作或内容');
    return s.serviceReviews.find(item => item.id === prior.reviewId);
  }
  if (review && (!['number', 'string'].includes(typeof p.version) || !Number.isSafeInteger(Number(p.version)) || Number(p.version) !== review.version)) ctx.fail('评价记录已更新或缺少版本，请刷新后重试');
  if (type === 'review.create') {
    const eligibility = reviewEligibility(s, booking, actor);
    if (!eligibility.canCreate) ctx.fail(eligibility.reason);
    const score = Number(p.score), tags = p.tags ?? [], text = String(p.text ?? '').trim();
    if (!['number', 'string'].includes(typeof p.score) || !Number.isInteger(score) || score < 1 || score > 5) ctx.fail('请选择1至5星评价');
    if (!Array.isArray(tags) || tags.some(tag => !REVIEW_TAGS.includes(tag))) ctx.fail('请选择有效的评价标签');
    if (text.length > 1000) ctx.fail('评价文字最多1000字');
    review = {id: ctx.id('RV'), bookingId: booking.id, userId: booking.userId, storeId: booking.storeId, techId: booking.techId, score, tags: [...new Set(tags)], text, textAudit: {status: text ? 'pending' : 'no_text'}, hiddenReasons: [], appeal: null, version: 1, createdAt: s.now, updatedAt: s.now, history: []};
    s.serviceReviews.push(review);
    history(s, review, type, actor, ctx);
  } else {
    const cap = capabilities(s, actor, review), reason = required(p.reason, '处理说明', ctx);
    if (type === 'review.moderate-text') {
      if (!cap.canModerate) ctx.fail('只有待审核或审核异常的文字可以审核');
      if (!['approved', 'blocked', 'error'].includes(p.result)) ctx.fail('请选择有效的模拟文字审核结果');
      review.textAudit = {status: p.result, reason, at: s.now, actor: actorRecord(actor), mode: 'demo-recorded-result'};
    } else if (type === 'review.hide') {
      if (!cap.canHide) ctx.fail('该评价已登记违规隐藏');
      review.hiddenReasons.push({kind: 'content', reason, at: s.now, actor: actorRecord(actor)});
    } else if (type === 'review.appeal') {
      if (!cap.canAppeal) ctx.fail(cap.appealReason);
      review.appeal = {status: 'store_pending', reason, createdAt: s.now, actor: actorRecord(actor), storeReview: null, finalReview: null};
    } else if (type === 'review.appeal-store') {
      if (!cap.canStoreReview) ctx.fail('仅待门店初审的申诉可以初审');
      if (!['support', 'oppose'].includes(p.opinion)) ctx.fail('请选择初审意见');
      review.appeal.storeReview = {opinion: p.opinion, reason, at: s.now, actor: actorRecord(actor)};
      review.appeal.status = 'group_pending';
    } else if (type === 'review.appeal-final') {
      if (!cap.canFinalReview) ctx.fail('申诉须经门店初审后交集团终审');
      if (!['uphold', 'reject'].includes(p.decision)) ctx.fail('请选择终审结论');
      review.appeal.finalReview = {decision: p.decision, reason, at: s.now, actor: actorRecord(actor)};
      review.appeal.status = p.decision === 'uphold' ? 'upheld' : 'rejected';
      if (p.decision === 'uphold') review.hiddenReasons.push({kind: 'appeal', reason, at: s.now, actor: actorRecord(actor)});
    }
    review.version++;
    history(s, review, type, actor, ctx, {reason, ...p.result ? {result: p.result} : {}, ...p.opinion ? {opinion: p.opinion} : {}, ...p.decision ? {decision: p.decision} : {}});
  }
  s.serviceReviewRequests.push({actor: who, requestId, fingerprint, reviewId: review.id, at: s.now});
  return review;
}
function projected(s, actor, review) {
  const group = groupSupport(actor), author = actor.role === 'user' && actor.userId === review.userId;
  const textVisible = group || author || review.textAudit?.status === 'approved' && !hidden(review);
  const audit = group ? clone(review.textAudit) : {status: review.textAudit?.status || 'pending', at: review.textAudit?.at ?? null};
  const appeal = review.appeal ? clone(review.appeal) : null;
  if (appeal && author) {
    for (const key of ['reason', 'actor']) delete appeal[key];
    for (const key of ['storeReview', 'finalReview']) if (appeal[key]) appeal[key] = {at: appeal[key].at, ...(key === 'storeReview' ? {opinion: appeal[key].opinion} : {decision: appeal[key].decision})};
  }
  return {
    id: review.id, bookingId: review.bookingId, storeId: review.storeId, techId: review.techId,
    ...(author || group ? {userId: review.userId} : {}), score: review.score, tags: [...(review.tags || [])], text: textVisible ? review.text : '', textVisible,
    createdAt: review.createdAt, updatedAt: review.updatedAt, version: review.version, textAudit: audit, hidden: hidden(review),
    hiddenReasons: (review.hiddenReasons || []).map(item => group ? clone(item) : {kind: item.kind, at: item.at}), appeal,
    history: (review.history || []).map(item => {
      if (group) return clone(item);
      const safe = {action: item.action, at: item.at, version: item.version, actor: {role: item.actor?.role}};
      if (!author && item.action.startsWith('review.appeal')) Object.assign(safe, {reason: item.reason, opinion: item.opinion, decision: item.decision});
      return safe;
    }), ...capabilities(s, actor, review)
  };
}
export function serviceReviewView(s, actor) {
  const canEnter = allowed(actor), reviews = canEnter ? (s.serviceReviews || []).filter(item => canReadServiceReview(actor, item)).map(item => projected(s, actor, item)).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)) : [];
  return {canEnter, canModerate: groupSupport(actor), reviews, summary: {count: reviews.length, pendingText: reviews.filter(item => item.canModerate).length, pendingStore: reviews.filter(item => item.canStoreReview).length, pendingFinal: reviews.filter(item => item.canFinalReview).length, hidden: reviews.filter(item => item.hidden).length}};
}
export function technicianReviewSummary(s, techId) {
  const valid = (s.serviceReviews || []).filter(review => review.techId === techId && !hidden(review) && Number.isInteger(review.score) && review.score >= 1 && review.score <= 5 && Number.isFinite(review.createdAt) && review.createdAt <= s.now && review.createdAt >= s.now - 90 * DAY).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const count = valid.length, rating = count >= 5 ? Math.round(valid.reduce((total, review) => total + review.score, 0) / count * 10) / 10 : null;
  return {count, rating, label: rating === null ? '新技师' : rating.toFixed(1), publicReviews: valid.map(review => ({id: review.id, score: review.score, tags: [...(review.tags || [])], text: review.textAudit?.status === 'approved' ? review.text : '', createdAt: review.createdAt}))};
}
