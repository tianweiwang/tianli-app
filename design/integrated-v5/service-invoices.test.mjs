import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeInvoices, syncInvoices, invoiceCommand, invoiceSummary, canReadInvoice } from './service-invoices.mjs';

const DAY = 86400000;
const user = { role: 'user', userId: 'u1' }, store = { role: 'store', storeId: 's1' };
const title = { kind: 'company', title: '示例科技有限公司', taxId: '91320100000000000X', email: 'invoice@example.com' };
const file = { ref: `invoice-file:${'a'.repeat(64)}`, name: '电子发票.pdf', type: 'application/pdf', size: 1024 };
function fixture() {
  const finishedAt = Date.parse('2026-10-03T10:00:00+08:00');
  let s = { schema: 5, seq: 1, now: finishedAt + 60000, users: [{ id: 'u1' }, { id: 'u2' }], stores: [{ id: 's1' }, { id: 's2' }],
    bookings: [{ id: 'BK1', userId: 'u1', storeId: 's1', status: 'done', completedAt: finishedAt,
      payment: { id: 'BP1', amountCents: 29800, refundedCents: 0, status: 'success' },
      extensions: [{ id: 'BX1', amountCents: 14900, refundedCents: 0, status: 'success' }], refunds: [] }] };
  upgradeInvoices(s);
  const context = state => ({ id: prefix => prefix + ++state.seq, fail: message => { throw new Error(message); }, log: (entity, text) => { (entity.events ??= []).push({ text, at: state.now }); } });
  let requestSeq = 0;
  const run = (type, payload = {}, actor = user) => {
    const next = structuredClone(s), p = { requestId: `request-${++requestSeq}`, ...payload };
    const result = invoiceCommand(next, actor, type, p, context(next));
    syncInvoices(next, context(next)); s = next;
    return result;
  };
  return {
    get s() { return s; }, get b() { return s.bookings[0]; }, get inv() { return s.serviceInvoices.at(-1); }, run,
    sync() { syncInvoices(s, context(s)); },
    apply(extra = {}) { return run('invoice.apply', { bookingId: 'BK1', ...title, ...extra }); },
    issue(extra = {}, actor = store) { return run('invoice.issue', { id: this.inv.id, version: this.inv.version, ticketNumber: 'BLUE-001', file, ...extra }, actor); },
    red(extra = {}) { return run('invoice.red', { id: this.inv.id, version: this.inv.version, ticketNumber: 'RED-001', file, ...extra }, store); },
    refund(main, extension = 0, status = 'success') {
      this.b.payment.refundedCents += main; this.b.extensions[0].refundedCents += extension;
      this.b.refunds = [{ id: 'BR1', status, executions: [{ paymentId: 'BP1', amountCents: main, status: 'success' }, ...(extension ? [{ paymentId: 'BX1', amountCents: extension, status: 'success' }] : [])] }];
      this.sync();
    }
  };
}

test('J02 增量升级只新增容器，无记录时不补票或改预约', () => {
  const s = { schema: 5, bookings: [{ id: 'BK1' }], goods: [{ id: 'G1' }], other: { value: 1 } };
  const before = structuredClone(s);
  assert.equal(upgradeInvoices(s), s); syncInvoices(s); upgradeInvoices(s);
  assert.deepEqual(s, { ...before, serviceInvoices: [], serviceInvoiceRequests: [] });
});

test('J02 本人完成预约个人/企业申请，逐支付快照与净额均为分', () => {
  const f = fixture(); f.b.payment.refundedCents = 1000;
  const summary = invoiceSummary(f.s, f.b);
  assert.equal(summary.paid, 44700); assert.equal(summary.refunded, 1000); assert.equal(summary.net, 43700);
  assert.equal(summary.paidCents, summary.paid); assert.equal(summary.withinWindow, true); assert.equal(summary.blocked, false);
  const inv = f.apply();
  assert.equal(inv.amount, 43700); assert.equal(inv.status, 'pending'); assert.equal(inv.version, 1);
  assert.deepEqual(inv.paymentSnapshot.map(p => [p.paymentId, p.kind, p.netCents]), [['BP1', 'main', 28800], ['BX1', 'extension', 14900]]);
  assert.equal(inv.history[0].title, title.title);
  const personal = fixture().apply({ kind: 'personal', title: '张女士', taxId: '不应保存的旧企业税号' });
  assert.equal(personal.taxId, '');
  for (const invalid of [{ kind: 'other' }, { title: ' ' }, { taxId: '1234' }, { email: 'no-email' }, { requestId: '' }]) assert.throws(() => fixture().apply(invalid));
});

test('J02 申请资格、90天边界、零净额与其他用户均由模型拒绝', () => {
  for (const status of ['unpaid', 'waiting', 'confirmed', 'active', 'cancelled', 'closed']) {
    const f = fixture(); f.b.status = status; assert.throws(() => f.apply(), /完成后/);
  }
  const exact = fixture(); exact.s.now = exact.b.completedAt + 90 * DAY; exact.apply();
  const late = fixture(); late.s.now = late.b.completedAt + 90 * DAY + 1; assert.throws(() => late.apply(), /期限/);
  const zero = fixture(); zero.b.payment.refundedCents = 29800; zero.b.extensions[0].refundedCents = 14900; assert.throws(() => zero.apply(), /净实付为零/);
  const future = fixture(); future.b.completedAt = future.s.now + 1; assert.throws(() => future.apply(), /完成后/);
  const missing = fixture(); delete missing.b.completedAt; assert.throws(() => missing.apply(), /完成后/);
  const other = fixture(); assert.throws(() => other.run('invoice.apply', { bookingId: 'BK1', ...title }, { role: 'user', userId: 'u2' }), /本人/);
  assert.throws(() => other.run('invoice.apply', { bookingId: 'missing', ...title }), /不存在/);
});

test('J02 未结退款及未知支付阻止开票，失败退款不减净额', () => {
  for (const status of ['requested', 'offered', 'approved', 'processing', 'failed', 'escalated']) {
    const f = fixture(); f.apply(); f.b.refunds = [{ status, amountCents: 10000 }];
    assert.equal(invoiceSummary(f.s, f.b).net, 44700);
    assert.equal(invoiceSummary(f.s, f.b).blocked, true);
    assert.throws(() => f.issue(), /未结退款/);
    assert.equal(f.inv.status, 'pending');
  }
  const f = fixture(); f.b.refunds = [{ status: 'rejected', deadline: f.s.now + DAY }]; assert.equal(invoiceSummary(f.s, f.b).blocked, true);
  for (const refund of [{ status: 'rejected' }, { status: 'withdrawn' }, { status: 'closed' }, { status: 'success' }]) { f.b.refunds = [refund]; assert.equal(invoiceSummary(f.s, f.b).blocked, false); }
  f.b.extensions.push({ id: 'BX2', status: 'processing', amountCents: 5000, refundedCents: 0 });
  assert.equal(invoiceSummary(f.s, f.b).net, 44700); assert.throws(() => f.apply(), /支付结果尚未确认/);
});

test('J02 待开申请退款后更新金额/快照/版本，旧页禁止签发，零额只允许处理记录', () => {
  const f = fixture(); f.apply(); const before = structuredClone(f.inv);
  f.refund(6667, 3333);
  assert.equal(f.inv.amount, 34700); assert.equal(f.inv.version, before.version + 1);
  assert.throws(() => f.issue({ version: before.version }), /已更新/);
  f.issue(); assert.equal(f.inv.issued.ticketNumber, 'BLUE-001'); assert.equal(f.inv.amount, 34700);
  const zero = fixture(); zero.apply(); zero.refund(29800, 14900);
  assert.equal(zero.inv.amount, 0); assert.throws(() => zero.issue(), /净实付为零/);
  zero.run('invoice.reject', { id: zero.inv.id, version: zero.inv.version, reason: '已全额退款，无可开金额' }, store);
  assert.equal(zero.inv.status, 'rejected');
});

test('J02 驳回有理由，同一记录修改重提且保留原抬头，原申请超期不能重提', () => {
  const f = fixture(); f.apply(); const id = f.inv.id;
  assert.throws(() => f.run('invoice.reject', { id, version: f.inv.version, reason: ' ' }, store), /驳回原因/);
  f.run('invoice.reject', { id, version: f.inv.version, reason: '抬头有误' }, store);
  assert.equal(f.inv.rejectReason, '抬头有误');
  f.run('invoice.resubmit', { id, version: f.inv.version, ...title, title: '更正后的抬头' });
  assert.equal(f.inv.id, id); assert.equal(f.inv.title, '更正后的抬头'); assert.equal(f.inv.status, 'pending'); assert.equal(f.inv.rejectReason, '');
  assert.equal(f.inv.history[0].title, title.title);
  f.run('invoice.reject', { id, version: f.inv.version, reason: '再次核对' }, store);
  f.s.now = f.b.completedAt + 91 * DAY;
  assert.throws(() => f.run('invoice.resubmit', { id, version: f.inv.version, ...title }), /期限/);
});

test('J02 部分退款成功触发红冲，失败笔不减额，红冲可先登记而重开必须等全部结果', () => {
  const f = fixture(); f.apply(); f.issue(); const original = structuredClone(f.inv);
  f.b.refunds = [{ id: 'BR1', status: 'failed', executions: [{ paymentId: 'BP1', amountCents: 6667, status: 'success' }, { paymentId: 'BX1', amountCents: 3333, status: 'failed' }] }];
  f.b.payment.refundedCents = 6667; f.sync();
  assert.equal(invoiceSummary(f.s, f.b).net, 38033); assert.equal(f.inv.status, 'red_pending');
  assert.equal(f.inv.amount, 44700); assert.deepEqual(f.inv.issued, original.issued); assert.deepEqual(f.inv.paymentSnapshot, original.paymentSnapshot);
  const v = f.inv.version; f.sync(); assert.equal(f.inv.version, v);
  f.red(); const oldId = f.inv.id;
  assert.throws(() => f.run('invoice.reapply', { id: oldId, version: f.inv.version, ...title }), /未结退款/);
  f.b.extensions[0].refundedCents = 3333; f.b.refunds[0].status = 'success'; f.b.refunds[0].executions[1].status = 'success'; f.sync();
  f.run('invoice.reapply', { id: oldId, version: f.inv.version, ...title });
  assert.equal(f.inv.amount, 34700); assert.equal(f.inv.replacesId, oldId); assert.equal(f.s.serviceInvoices[0].replacedById, f.inv.id);
  assert.equal(f.s.serviceInvoices[0].amount, 44700); f.issue({ ticketNumber: 'BLUE-002' });
});

test('J02 开票后退款失败或处理中不提前红冲；全退后只能红冲不能零额重开', () => {
  const f = fixture(); f.apply(); f.issue();
  for (const status of ['processing', 'failed']) { f.b.refunds = [{ status, amountCents: 10000 }]; f.sync(); assert.equal(f.inv.status, 'issued'); assert.equal(f.inv.amount, 44700); }
  f.refund(29800, 14900); assert.equal(f.inv.status, 'red_pending');
  assert.throws(() => f.issue(), /待开票/);
  f.red(); assert.equal(f.inv.status, 'red');
  assert.throws(() => f.run('invoice.reapply', { id: f.inv.id, version: f.inv.version, ...title }), /净实付为零/);
  assert.equal(f.s.serviceInvoices.length, 1);
});

test('J02 合法旧票链超90天仍可红冲/重开及替代申请重提，再次退款形成下一版', () => {
  const f = fixture(); f.apply(); f.issue(); f.s.now = f.b.completedAt + 91 * DAY; f.refund(1000); f.red();
  const root = f.inv.id;
  f.run('invoice.reapply', { id: root, version: f.inv.version, ...title });
  f.run('invoice.reject', { id: f.inv.id, version: f.inv.version, reason: '请更正抬头' }, store);
  f.run('invoice.resubmit', { id: f.inv.id, version: f.inv.version, ...title }); f.issue({ ticketNumber: 'BLUE-002' });
  const second = f.inv.id; f.refund(1000); f.red({ ticketNumber: 'RED-002' });
  f.run('invoice.reapply', { id: second, version: f.inv.version, ...title }); f.issue({ ticketNumber: 'BLUE-003' });
  assert.deepEqual(f.s.serviceInvoices.map(x => x.amount), [44700, 43700, 42700]);
  assert.deepEqual(f.s.serviceInvoices.map(x => x.status), ['red', 'red', 'issued']);
  assert.equal(f.s.serviceInvoices[0].replacedById, second);
  const invalid = fixture(); invalid.apply(); invalid.issue(); invalid.refund(1000); invalid.red(); invalid.inv.createdAt = invalid.b.completedAt + 91 * DAY;
  assert.throws(() => invalid.run('invoice.reapply', { id: invalid.inv.id, version: invalid.inv.version, ...title }), /有效的申请记录/);
});

test('J02 请求持久幂等且同标识异内容拒绝，不裁剪老请求；权限优先于幂等', () => {
  const f = fixture(), payload = { bookingId: 'BK1', ...title, requestId: 'permanent-apply' };
  const first = f.run('invoice.apply', payload); f.issue();
  const again = f.run('invoice.apply', Object.fromEntries(Object.entries(payload).reverse()));
  assert.equal(again.id, first.id); assert.equal(again.status, 'issued'); assert.equal(f.s.serviceInvoices.length, 1);
  assert.throws(() => f.run('invoice.apply', { ...payload, title: '另一个抬头' }), /同一提交标识/);
  assert.throws(() => f.run('invoice.apply', payload, { role: 'user', userId: 'u2' }), /本人/);
  f.s.users = f.s.users.filter(x => x.id !== 'u1'); assert.throws(() => f.run('invoice.apply', payload), /本人/);
  const reloaded = JSON.parse(JSON.stringify(f.s)); assert.equal(reloaded.serviceInvoiceRequests[0].requestId, 'permanent-apply');
});

test('J02 多页开票/重开幂等与旧版本冲突，不能绕开同链重复申请', () => {
  const f = fixture(); f.apply();
  assert.throws(() => f.apply(), /已有发票申请/);
  const issue = { id: f.inv.id, version: f.inv.version, ticketNumber: 'BLUE-001', file, requestId: 'issue-once' };
  f.run('invoice.issue', issue, store); const version = f.inv.version;
  f.run('invoice.issue', issue, store); assert.equal(f.inv.version, version);
  assert.throws(() => f.run('invoice.issue', { ...issue, requestId: 'stale-tab' }, store), /已更新/);
  f.refund(1000); f.red(); const redId = f.inv.id;
  const reapply = { id: redId, version: f.inv.version, ...title, requestId: 'replacement-once' };
  const replacement = f.run('invoice.reapply', reapply); f.run('invoice.reapply', reapply);
  assert.equal(f.s.serviceInvoices.length, 2); assert.equal(f.inv.id, replacement.id);
  assert.throws(() => f.run('invoice.reapply', { ...reapply, version: f.s.serviceInvoices[0].version, requestId: 'another-replacement' }), /尚未重开/);
});

test('J02 门店签发权限与只读身份范围；撤销门店身份后旧成功请求也不能重放', () => {
  const f = fixture(); f.apply();
  for (const actor of [user, { role: 'manager', storeId: 's1' }, { role: 'store', storeId: 's2' }, { role: 'group' }, { role: 'group', job: 'all' }, { role: 'group', job: 'finance' }, { role: 'tech', techId: 't1' }]) assert.throws(() => f.issue({}, actor), /仅服务门店后台/);
  for (const actor of [user, store, { role: 'manager', storeId: 's1' }, { role: 'group' }, { role: 'group', job: 'all' }, { role: 'group', job: 'finance' }]) assert.equal(canReadInvoice(actor, f.inv), true);
  for (const actor of [{ role: 'user', userId: 'u2' }, { role: 'manager', storeId: 's2' }, { role: 'group', job: 'support' }, { role: 'group', job: 'warehouse' }, { role: 'group', job: 'operations' }, { role: 'tech', techId: 't1' }]) assert.equal(canReadInvoice(actor, f.inv), false);
  const payload = { id: f.inv.id, version: f.inv.version, ticketNumber: 'BLUE-001', file, requestId: 'store-issue' };
  f.run('invoice.issue', payload, store); f.s.stores = f.s.stores.filter(x => x.id !== 's1');
  assert.throws(() => f.run('invoice.issue', payload, store), /仅服务门店后台/);
});

test('J02 凭证格式/体积校验，补传保留票号金额状态及原附件历史', () => {
  for (const patch of [{ ref: 'https://example.com/invoice.pdf' }, { ref: 'invoice-file:abc' }, { type: 'image/webp' }, { size: 0 }, { size: 5 * 1024 * 1024 + 1 }, { size: 1.5 }, { name: '' }]) {
    const f = fixture(); f.apply(); assert.throws(() => f.issue({ file: { ...file, ...patch } })); assert.equal(f.inv.status, 'pending');
  }
  const f = fixture(); f.apply(); f.issue({ file: { ...file, size: 5 * 1024 * 1024 } });
  const snapshot = structuredClone(f.inv), replacement = { ...file, ref: `invoice-file:${'b'.repeat(64)}`, name: '补传.jpg', type: 'image/jpeg' };
  assert.throws(() => f.run('invoice.replace-file', { id: f.inv.id, version: f.inv.version, slot: 'issued', file: replacement, reason: '' }, store), /原因/);
  f.run('invoice.replace-file', { id: f.inv.id, version: f.inv.version, slot: 'issued', file: replacement, reason: '本地文件丢失，补传相同票号凭证' }, store);
  assert.equal(f.inv.amount, snapshot.amount); assert.equal(f.inv.status, 'issued'); assert.equal(f.inv.issued.ticketNumber, snapshot.issued.ticketNumber);
  assert.equal(f.inv.issued.file.ref, replacement.ref); assert.deepEqual(f.inv.history.at(-1).previousFile, snapshot.issued.file);
  assert.throws(() => f.run('invoice.replace-file', { id: f.inv.id, version: f.inv.version, slot: 'red', file, reason: '没有红票' }, store), /没有可补传/);
  f.refund(1000); f.red(); f.run('invoice.replace-file', { id: f.inv.id, version: f.inv.version, slot: 'red', file: replacement, reason: '补传红冲凭证' }, store);
  assert.equal(f.inv.status, 'red'); assert.equal(f.inv.red.ticketNumber, 'RED-001');
});

test('J02 渲染摘要不写数据，异常金额不能签发，也不把客服事项擅自当退款', () => {
  const f = fixture(); f.b.disputes = [{ status: 'open' }]; f.s.safety = [{ bookingId: 'BK1', status: 'open' }];
  const before = structuredClone(f.s); assert.equal(invoiceSummary(f.s, f.b).blocked, false); assert.deepEqual(f.s, before);
  f.b.payment.refundedCents = 29801; assert.throws(() => f.apply(), /金额异常/);
});

test('J02 engine实链：预约加时完成→447元票→分笔失败/成功→红冲→347元替代票', async () => {
  const { seed, reduce } = await import('./engine.mjs');
  let s = seed();
  const shop = { role: 'store', storeId: 'xingfu' }, technician = { role: 'tech', techId: 'lin' };
  const run = (type, payload = {}, actor = user) => { s = reduce(s, actor, type, payload); };
  run('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', mode: 'specified', genderPreference: 'any', startAt: '2026-10-02T13:00', contactName: '王女士', phone: '13800009999', adultConfirmed: true, identityVerified: true, healthConsent: true, requestId: 'invoice-booking' });
  const id = s.bookings.at(-1).id;
  run('booking.pay', { id, outcome: 'success' }); run('booking.accept', { id }, technician);
  run('clock.advance', { minutes: 240 }); run('booking.start', { id }, technician);
  run('booking.extension-create', { id, requestId: 'invoice-extension' });
  const extensionId = s.bookings.at(-1).extensions[0].id;
  run('booking.extension-pay', { id, extensionId, outcome: 'success' });
  run('clock.advance', { minutes: 90 }); run('booking.finish', { id, mode: 'normal' }, technician);
  run('invoice.apply', { bookingId: id, ...title, requestId: 'engine-apply' });
  let inv = s.serviceInvoices.at(-1); assert.equal(inv.amount, 44700);
  run('invoice.issue', { id: inv.id, version: inv.version, ticketNumber: 'E-BLUE-1', file, requestId: 'engine-issue' }, shop);
  const paymentId = s.bookings.at(-1).payment.id;
  run('booking.refund-request', { id, reason: '主预约与加时协商', requests: [{ paymentId, amountCents: 9800 }, { paymentId: extensionId, amountCents: 4900 }] });
  let refund = s.bookings.at(-1).refunds.at(-1);
  run('booking.refund-review', { id, refundId: refund.id, decision: 'offer', amountCents: 10000, reason: '协商退100元' }, shop);
  refund = s.bookings.at(-1).refunds.at(-1);
  run('booking.refund-answer', { id, refundId: refund.id, version: refund.version, decision: 'accept' });
  run('booking.refund-pay', { id, refundId: refund.id, paymentId, outcome: 'success' }, shop);
  run('booking.refund-pay', { id, refundId: refund.id, paymentId: extensionId, outcome: 'failed' }, shop);
  inv = s.serviceInvoices.at(-1); assert.equal(inv.status, 'red_pending'); assert.equal(inv.amount, 44700);
  assert.equal(invoiceSummary(s, s.bookings.at(-1)).net, 38033);
  run('invoice.red', { id: inv.id, version: inv.version, ticketNumber: 'E-RED-1', file, requestId: 'engine-red' }, shop);
  run('booking.refund-pay', { id, refundId: refund.id, paymentId: extensionId, outcome: 'success' }, shop);
  const refundedBeforeReplay = structuredClone(s.bookings.at(-1));
  run('booking.refund-pay', { id, refundId: refund.id, paymentId: extensionId, outcome: 'success' }, shop);
  assert.deepEqual(s.bookings.at(-1), refundedBeforeReplay);
  inv = s.serviceInvoices.at(-1);
  run('invoice.reapply', { id: inv.id, version: inv.version, ...title, requestId: 'engine-reapply' });
  inv = s.serviceInvoices.at(-1); assert.equal(inv.amount, 34700); assert.equal(inv.requestId, 'engine-reapply');
  run('invoice.issue', { id: inv.id, version: inv.version, ticketNumber: 'E-BLUE-2', file, requestId: 'engine-reissue' }, shop);
  assert.deepEqual(s.serviceInvoices.map(item => [item.status, item.amount]), [['red', 44700], ['issued', 34700]]);
  assert.equal(s.bookings.at(-1).status, 'done');
});

test('J02 过期加时晚到支付全退不红冲仅覆盖主预约的原票，原票支付退款仍会红冲', async () => {
  const { seed, reduce } = await import('./engine.mjs');
  let s = seed();
  const shop = { role: 'store', storeId: 'xingfu' }, technician = { role: 'tech', techId: 'lin' };
  const run = (type, payload = {}, actor = user) => { s = reduce(s, actor, type, payload); };
  run('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', mode: 'specified', genderPreference: 'any', startAt: '2026-10-02T13:00', contactName: '王女士', phone: '13800009999', adultConfirmed: true, identityVerified: true, healthConsent: true, requestId: 'late-extension-booking' });
  const id = s.bookings.at(-1).id;
  run('booking.pay', { id, outcome: 'success' }); run('booking.accept', { id }, technician);
  run('clock.advance', { minutes: 240 }); run('booking.start', { id }, technician);
  run('booking.extension-create', { id, requestId: 'unpaid-expiring-extension' });
  const extensionId = s.bookings.at(-1).extensions[0].id;
  run('clock.advance', { minutes: 60 }); run('booking.finish', { id, mode: 'normal' }, technician);
  assert.equal(s.bookings.at(-1).extensions[0].status, 'expired');
  run('invoice.apply', { bookingId: id, ...title, requestId: 'main-only-apply' });
  let inv = s.serviceInvoices.at(-1);
  run('invoice.issue', { id: inv.id, version: inv.version, ticketNumber: 'MAIN-ONLY', file, requestId: 'main-only-issue' }, shop);
  const issued = structuredClone(s.serviceInvoices.at(-1));
  assert.equal(issued.paymentSnapshot.length, 1); assert.equal(issued.amount, 29800);
  run('booking.extension-query', { id, extensionId, outcome: 'success' }, shop);
  const lateRefund = s.bookings.at(-1).refunds.at(-1);
  assert.equal(lateRefund.amountCents, 14900);
  assert.equal(s.serviceInvoices.at(-1).status, 'issued');
  run('booking.refund-pay', { id, refundId: lateRefund.id, paymentId: extensionId, outcome: 'success' }, shop);
  assert.equal(invoiceSummary(s, s.bookings.at(-1)).net, 29800);
  assert.deepEqual(s.serviceInvoices.at(-1), issued);
  // The original covered payment must still trigger a red flush when it is refunded.
  const paymentId = s.bookings.at(-1).payment.id;
  run('booking.refund-request', { id, reason: '主预约部分退款', requests: [{ paymentId, amountCents: 1000 }] });
  const mainRefund = s.bookings.at(-1).refunds.at(-1);
  run('booking.refund-review', { id, refundId: mainRefund.id, decision: 'approve', reason: '核实主预约退款' }, shop);
  run('booking.refund-pay', { id, refundId: mainRefund.id, paymentId, outcome: 'success' }, shop);
  inv = s.serviceInvoices.at(-1);
  assert.equal(inv.status, 'red_pending'); assert.equal(inv.amount, 29800); assert.deepEqual(inv.issued, issued.issued);
});

test('J02 同门店原票/红票跨记录票号唯一，幂等与同票补传正常，跨门店互不占号', () => {
  const f = fixture(); f.apply(); f.issue({ ticketNumber: 'SAME-STORE-BLUE-1' });
  const firstId = f.inv.id;
  const secondBooking = structuredClone(f.b); secondBooking.id = 'BK2'; secondBooking.payment.id = 'BP2'; secondBooking.extensions[0].id = 'BX2'; f.s.bookings.push(secondBooking);
  f.run('invoice.apply', { bookingId: 'BK2', ...title }); const secondId = f.inv.id;
  assert.throws(() => f.issue({ ticketNumber: ' SAME-STORE-BLUE-1 ' }), /票号.*已使用/);
  f.issue({ ticketNumber: 'SAME-STORE-BLUE-2' });
  f.refund(1000); let first = f.s.serviceInvoices.find(item => item.id === firstId);
  assert.throws(() => f.run('invoice.red', { id: firstId, version: first.version, ticketNumber: 'SAME-STORE-BLUE-1', file }, store), /票号.*已使用/);
  const redPayload = { id: firstId, version: first.version, ticketNumber: 'SAME-STORE-RED-1', file, requestId: 'unique-red-once' };
  f.run('invoice.red', redPayload, store); f.run('invoice.red', redPayload, store);
  first = f.s.serviceInvoices.find(item => item.id === firstId);
  f.run('invoice.replace-file', { id: firstId, version: first.version, slot: 'red', file: { ...file, ref: `invoice-file:${'c'.repeat(64)}` }, reason: '补传原红票' }, store);
  const currentSecondBooking = f.s.bookings.find(item => item.id === 'BK2'); currentSecondBooking.payment.refundedCents = 1000; f.sync();
  const second = f.s.serviceInvoices.find(item => item.id === secondId);
  assert.throws(() => f.run('invoice.red', { id: secondId, version: second.version, ticketNumber: 'SAME-STORE-RED-1', file }, store), /票号.*已使用/);
  f.run('invoice.red', { id: secondId, version: second.version, ticketNumber: 'SAME-STORE-RED-2', file }, store);
  const thirdBooking = structuredClone(f.b); thirdBooking.id = 'BK3'; thirdBooking.payment.id = 'BP3'; thirdBooking.extensions[0].id = 'BX3'; f.s.bookings.push(thirdBooking);
  f.run('invoice.apply', { bookingId: 'BK3', ...title });
  assert.throws(() => f.issue({ ticketNumber: 'SAME-STORE-RED-1' }), /票号.*已使用/);
  const otherStore = structuredClone(f.b); otherStore.id = 'BK4'; otherStore.storeId = 's2'; otherStore.payment.id = 'BP4'; otherStore.extensions[0].id = 'BX4'; f.s.bookings.push(otherStore);
  f.run('invoice.apply', { bookingId: 'BK4', ...title });
  f.issue({ ticketNumber: 'SAME-STORE-BLUE-1' }, { role: 'store', storeId: 's2' });
  assert.equal(f.inv.issued.ticketNumber, 'SAME-STORE-BLUE-1');
});

test('J02 用户/门店岗位残留不改变幂等身份，系统退款同步明确标为system', () => {
  const f = fixture();
  const apply = { bookingId: 'BK1', ...title, requestId: 'actor-job-apply' };
  f.run('invoice.apply', apply, { ...user, job: 'finance' });
  const applied = structuredClone(f.inv);
  for (const job of ['support', 'all', undefined]) f.run('invoice.apply', apply, { ...user, job });
  assert.deepEqual(f.inv, applied); assert.equal(f.s.serviceInvoices.length, 1);
  assert.equal(f.inv.history[0].actor.job, null);
  const issue = { id: f.inv.id, version: f.inv.version, ticketNumber: 'ACTOR-JOB-BLUE', file, requestId: 'actor-job-issue' };
  f.run('invoice.issue', issue, { ...store, job: 'warehouse' });
  const issued = structuredClone(f.inv);
  for (const job of ['finance', 'operations', undefined]) f.run('invoice.issue', issue, { ...store, job });
  assert.deepEqual(f.inv, issued); assert.equal(f.s.serviceInvoiceRequests.length, 2);
  assert.equal(f.inv.history.at(-1).actor.job, null);
  // Earlier demo requests stored stale group jobs. Match them without rewriting history.
  f.s.serviceInvoiceRequests[0].actor = JSON.stringify({ role: 'user', job: 'finance', id: 'u1' });
  f.s.serviceInvoiceRequests[1].actor = JSON.stringify({ role: 'store', job: 'support', id: 's1' });
  const oldRequests = structuredClone(f.s.serviceInvoiceRequests);
  f.run('invoice.apply', apply, { ...user, job: 'warehouse' });
  f.run('invoice.issue', issue, { ...store, job: 'operations' });
  assert.deepEqual(f.inv, issued); assert.deepEqual(f.s.serviceInvoiceRequests, oldRequests);
  assert.throws(() => f.run('invoice.apply', { ...apply, title: '相同请求号的新内容' }, { ...user, job: 'support' }), /同一提交标识/);
  f.refund(1000);
  assert.deepEqual(f.inv.history.at(-1).actor, { role: 'system', job: null, id: 'system' });
});
