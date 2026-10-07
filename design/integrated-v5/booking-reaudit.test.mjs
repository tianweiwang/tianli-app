import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money } from './engine.mjs';
import { bookingView, upgradeBookings } from './booking.mjs';
import { closurePanels } from './closure-ui.mjs';
import { customerView } from './customer.mjs';
import { staffView } from './staff.mjs';

const user = { role: 'user', userId: 'u1' }, other = { role: 'user', userId: 'u2' };
const tech = { role: 'tech', techId: 'lin' }, store = { role: 'store', storeId: 'xingfu' };
const support = { role: 'group', job: 'support' }, finance = { role: 'group', job: 'finance' };
const foreign = { role: 'store', storeId: 'silver' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const ui = {
  esc, money, query: new URLSearchParams(), date: value => value ? new Date(value).toISOString() : '—',
  link: (label, path, cls = '') => `<a href="#${esc(path)}" class="${esc(cls)}">${label}</a>`,
  button: (label, command, payload = {}, cls = '') => `<button class="${esc(cls)}" data-command="${esc(command)}" data-payload="${esc(JSON.stringify(payload))}">${esc(label)}</button>`,
  field: (label, name, value = '', type = 'text', attrs = '') => `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" type="${esc(type)}" ${attrs}></label>`,
  select: (label, name, options) => `<label>${esc(label)}<select name="${esc(name)}">${options.map(x => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</select></label>`,
  tag: label => `<span>${esc(label)}</span>`, empty: label => `<p>${esc(label)}</p>`
};
function fixture() {
  let s = seed();
  const f = {
    get s() { return s; },
    run(actor, type, payload = {}) { s = reduce(s, actor, type, payload); },
    get(id) { return s.bookings.find(x => x.id === id); },
    advance(minutes) { f.run(support, 'clock.advance', { minutes }); },
    create() {
      f.run(user, 'booking.create', { requestId: 'reaudit-booking', storeId: 'xingfu', serviceId: 'relax', regionId: 'home', mode: 'specified', techId: 'lin', startAt: Date.parse('2026-10-02T13:00:00+08:00'), contactName: '回归顾客', phone: '13800000001', healthConsent: true, adultConfirmed: true, identityVerified: true });
      return s.bookings.at(-1).id;
    },
    paid() { const id = f.create(); f.run(user, 'booking.pay', { id, outcome: 'success' }); return id; },
    confirmed() { const id = f.paid(); f.run(tech, 'booking.accept', { id }); return id; },
    active() { const id = f.confirmed(); f.advance(240); f.run(tech, 'booking.start', { id }); return id; },
    interrupted() {
      const id = f.active(); f.advance(30); f.run(tech, 'booking.stop', { id, category: 'health', reason: '身体不适停止' });
      f.run(store, 'booking.dispute-review', { id, disputeId: f.get(id).disputes[0].id, responsibility: 'health', reason: '初次核实30分钟' }); return id;
    },
    revised() {
      const id = f.interrupted(), refundId = f.get(id).refunds[0].id;
      f.run(user, 'booking.refund-answer', { id, refundId, decision: 'escalate' });
      f.run(support, 'booking.refund-review', { id, refundId, decision: 'offer', amountCents: 100, reason: '集团重新核实一元方案' }); return id;
    }
  }; return f;
}

test('R01 每个安全事件保留自己的独立争议，中止退款成功不消除其他争议', () => {
  const f = fixture(), id = f.active(); f.advance(20);
  for (const reason of ['安全事项甲', '安全事项乙']) f.run(user, 'booking.help', { id, reason });
  f.run(tech, 'booking.stop', { id, category: 'health', reason: '立即停止' });
  const interruptionId = f.get(id).disputes[0].id;
  for (const h of [...f.s.safety]) f.run(store, 'booking.help-close', { safetyId: h.id, resolution: `${h.reason}人员安全，费用另议`, unresolvedDispute: true });
  assert.equal(f.get(id).disputes.length, 3);
  assert.equal(new Set(f.s.safety.map(h => h.disputeId)).size, 2);
  f.run(store, 'booking.dispute-review', { id, disputeId: interruptionId, responsibility: 'health', reason: '中止单独退款' });
  const r = f.get(id).refunds[0]; f.run(user, 'booking.refund-answer', { id, refundId: r.id, version: r.version, decision: 'accept' });
  f.run(finance, 'booking.refund-pay', { id, refundId: r.id, outcome: 'success' });
  assert.equal(f.get(id).disputes.find(d => d.id === interruptionId).status, 'resolved');
  assert.equal(bookingView(f.s, user)[0].settlementBlocked, true);
  const independent = f.get(id).disputes.filter(d => d.kind === 'service');
  f.run(support, 'booking.dispute-close', { id, disputeId: independent[0].id, resolution: '甲已协调' });
  assert.equal(bookingView(f.s, user)[0].settlementBlocked, true);
  f.run(support, 'booking.dispute-close', { id, disputeId: independent[1].id, resolution: '乙已协调' });
  assert.equal(bookingView(f.s, user)[0].settlementBlocked, false);
  upgradeBookings(f.s); assert.equal(f.get(id).disputes.length, 3);
});

test('R01 旧安全结案缺失独立争议先保持阻断，迁移补建且不重开已明确关闭事项', () => {
  const f = fixture(), id = f.active(); f.run(user, 'booking.help', { id, reason: '需保留争议' });
  const help = f.s.safety[0]; help.status = 'closed'; help.closedAt = f.s.now; help.unresolvedDispute = true; help.resolution = '人员安全但争议未结';
  assert.equal(bookingView(f.s, user)[0].settlementBlocked, true);
  upgradeBookings(f.s); upgradeBookings(f.s);
  assert.equal(f.get(id).disputes.length, 1); assert.equal(f.get(id).disputes[0].safetyId, help.id);
  const disputeId = f.get(id).disputes[0].id;
  f.run(support, 'booking.dispute-close', { id, disputeId, resolution: '人工确认已解决' });
  upgradeBookings(f.s); assert.equal(f.get(id).disputes[0].status, 'closed'); assert.equal(bookingView(f.s, user)[0].settlementBlocked, false);
});

test('R02 旧页面和缺版本接受均拒绝，新版本接受锁定金额与分笔且重复幂等', () => {
  const f = fixture(), id = f.interrupted(), first = structuredClone(f.get(id).refunds[0]);
  const html = customerView(f.s, user, ['booking', id], ui);
  assert.match(html, /&quot;version&quot;:1,&quot;decision&quot;:&quot;accept&quot;/);
  f.run(user, 'booking.refund-answer', { id, refundId: first.id, decision: 'escalate' });
  f.run(support, 'booking.refund-review', { id, refundId: first.id, decision: 'offer', amountCents: 100, reason: '复核一元' });
  for (const version of [undefined, first.version]) assert.throws(() => f.run(user, 'booking.refund-answer', { id, refundId: first.id, version, decision: 'accept' }), /版本|更新/);
  assert.equal(f.get(id).refunds[0].status, 'offered'); assert.equal(f.get(id).refunds[0].versions.length, 2);
  assert.deepEqual(f.get(id).refunds[0].versions[0], first.versions[0]);
  const r = f.get(id).refunds[0]; f.run(user, 'booking.refund-answer', { id, refundId: r.id, version: r.version, decision: 'accept' });
  assert.equal(f.get(id).refunds[0].acceptedVersion, 2); assert.equal(f.get(id).refunds[0].acceptedAmountCents, 100);
  assert.deepEqual(f.get(id).refunds[0].acceptedLines, [{ paymentId: f.get(id).payment.id, amountCents: 100 }]);
  f.run(finance, 'booking.refund-pay', { id, refundId: r.id, outcome: 'success' });
  f.run(user, 'booking.refund-answer', { id, refundId: r.id, version: r.version, decision: 'accept' });
  assert.equal(f.get(id).payment.refundedCents, 100); assert.equal(f.get(id).refunds[0].versions[0].amountCents, 14900);
});

test('R02 旧待确认方案补版本，旧成功退款只补记录、不再次计入资金', () => {
  const f = fixture(), id = f.interrupted(); const r = f.get(id).refunds[0];
  delete r.version; delete r.versions; upgradeBookings(f.s);
  assert.equal(r.version, 1); assert.equal(r.versions[0].migrated, true);
  assert.throws(() => f.run(user, 'booking.refund-answer', { id, refundId: r.id, decision: 'accept' }), /版本/);
  f.run(user, 'booking.refund-answer', { id, refundId: r.id, version: 1, decision: 'accept' });
  f.run(finance, 'booking.refund-pay', { id, refundId: r.id, outcome: 'success' });
  const paidBefore = f.get(id).payment.refundedCents, old = f.get(id).refunds[0];
  delete old.version; delete old.versions; delete old.acceptedVersion; delete old.acceptedLines; delete old.acceptedAmountCents; delete old.executions;
  upgradeBookings(f.s); upgradeBookings(f.s);
  assert.equal(f.get(id).payment.refundedCents, paidBefore); assert.equal(old.acceptedVersion, 1); assert.equal(old.acceptedAmountCents, paidBefore);
  assert.equal(old.versions.length, 1); assert.equal(old.executions[0].status, 'success');
  f.run(finance, 'booking.refund-query', { id, refundId: old.id, outcome: 'success' }); assert.equal(f.get(id).payment.refundedCents, paidBefore);
});

test('R02 零元中止方案仍要核对版本，确认后按零元结案', () => {
  const f = fixture(), id = f.interrupted(), refundId = f.get(id).refunds[0].id;
  f.run(user, 'booking.refund-answer', { id, refundId, decision: 'escalate' });
  f.run(support, 'booking.refund-review', { id, refundId, decision: 'offer', amountCents: 0, reason: '重新协商零元' });
  assert.equal(f.get(id).refunds[0].status, 'offered');
  f.run(user, 'booking.refund-answer', { id, refundId, version: 2, decision: 'accept' });
  assert.equal(f.get(id).refunds[0].status, 'success'); assert.equal(f.get(id).refunds[0].acceptedAmountCents, 0);
  assert.equal(f.get(id).disputes[0].status, 'resolved'); assert.equal(f.get(id).payment.refundedCents, 0);
});

test('R03 中止摘要显示当前方案和依据，实际成功后显示实际退款', () => {
  const f = fixture(), id = f.revised();
  const customerHtml = customerView(f.s, user, ['booking', id], ui);
  assert.match(customerHtml, /待确认协商方案/); assert.doesNotMatch(customerHtml, /门店提出协商方案/);
  assert.match(customerHtml, /退款金额[\s\S]*?¥1.00/); assert.match(customerHtml, /处理版本[\s\S]*?第 2 版/);
  for (const actor of [support, finance]) {
    const staffHtml = staffView(f.s, actor, ['bookings', id], ui);
    const currentCard = [...staffHtml.matchAll(/<article class="case-card">[\s\S]*?<\/article>/g)].map(x => x[0]).find(x => x.includes(f.get(id).refunds[0].id));
    assert.ok(currentCard, `${actor.job} 应显示当前退款卡片`);
    assert.match(currentCard, /集团重新核实一元方案/); assert.doesNotMatch(currentCard, /中止服务未完成|初次核实30分钟/);
  }
  let html = closurePanels(f.s, bookingView(f.s, user)[0], user, ui);
  assert.match(html, /当前退款方案 ¥1.00 · 第 2 版/); assert.match(html, /集团重新核实一元方案/); assert.doesNotMatch(html, /¥149.00/);
  const r = f.get(id).refunds[0]; f.run(user, 'booking.refund-answer', { id, refundId: r.id, version: 2, decision: 'accept' });
  html = closurePanels(f.s, bookingView(f.s, user)[0], user, ui); assert.match(html, /已确认退款方案 ¥1.00/);
  f.run(finance, 'booking.refund-pay', { id, refundId: r.id, outcome: 'success' });
  html = closurePanels(f.s, bookingView(f.s, user)[0], user, ui); assert.match(html, /实际退款 ¥1.00/); assert.doesNotMatch(html, /¥149.00/);
});

test('R04 待确认普通协助不改变派单期限、状态与结算，重复请求幂等且内容冲突拒绝', () => {
  const f = fixture(), id = f.paid(), before = structuredClone(f.get(id));
  const p = { id, reason: '需要确认联系人', requestId: 'assistance-one' };
  f.run(user, 'booking.assistance-request', p); f.run(user, 'booking.assistance-request', p);
  assert.equal(f.get(id).assistance.length, 1); assert.equal(f.get(id).status, before.status);
  assert.deepEqual(f.get(id).round, before.round); assert.equal(f.s.safety.length, 0);
  assert.equal(bookingView(f.s, user)[0].settlementBlocked, false);
  assert.throws(() => f.run(user, 'booking.assistance-request', { ...p, reason: '修改内容' }), /内容已变化/);
  f.run(tech, 'booking.accept', { id }); f.run(user, 'booking.assistance-request', { id, reason: '已确认后协调', requestId: 'assistance-two' });
  assert.equal(f.get(id).assistance.length, 2); assert.equal(f.get(id).status, 'confirmed');
});

test('R04 普通协助由门店或集团客服回复，用户可见完整闭环，技师和财务无内容', () => {
  const f = fixture(), id = f.confirmed();
  f.run(user, 'booking.assistance-request', { id, reason: '普通事项隐私样本', requestId: 'private-assistance' });
  const assistanceId = f.get(id).assistance[0].id;
  for (const actor of [foreign, tech, finance, other]) assert.throws(() => f.run(actor, 'booking.assistance-close', { id, assistanceId, response: '越权回复' }), /无权|门店/);
  for (const actor of [tech, finance]) {
    const v = bookingView(f.s, actor)[0]; assert.deepEqual(v.assistance, []);
    assert.doesNotMatch(closurePanels(f.s, f.get(id), actor, ui), /普通事项隐私样本|门店协助记录/);
  }
  assert.match(closurePanels(f.s, bookingView(f.s, store)[0], store, ui), /booking.assistance-close/);
  f.run(support, 'booking.assistance-close', { id, assistanceId, response: '已与本人核对联系人' });
  const html = customerView(f.s, user, ['booking', id], ui);
  assert.match(html, /普通事项隐私样本/); assert.match(html, /已与本人核对联系人/); assert.match(html, /集团客服/);
  assert.equal(f.get(id).status, 'confirmed'); assert.equal(bookingView(f.s, user)[0].settlementBlocked, false);
});

test('R04 未付款及非本人拒绝申请，已取消已付预约仍可联系门店', () => {
  const f = fixture(), id = f.create(), p = { id, reason: '协调事项', requestId: 'access-assistance' };
  assert.throws(() => f.run(user, 'booking.assistance-request', p), /支付/);
  f.run(user, 'booking.pay', { id, outcome: 'success' });
  for (const actor of [other, tech, store]) assert.throws(() => f.run(actor, 'booking.assistance-request', p), /本人|无权/);
  assert.throws(() => f.run(user, 'booking.assistance-request', { id, reason: '缺标识' }), /提交标识/);
  f.run(user, 'booking.cancel', { id, reason: '行程调整' }); f.run(user, 'booking.assistance-request', p);
  assert.equal(f.get(id).status, 'cancelled'); assert.equal(f.get(id).assistance.length, 1); assert.equal(f.s.safety.length, 0);
});
