import test from 'node:test';
import assert from 'node:assert/strict';
import { taskActorScope, createTaskReturnContext, taskReturnTarget, taskNavigationTarget } from './task-navigation.mjs';
import { upgradeAccounts, accountCommand, resolveAccountActor, STAFF_JOBS } from './staff-accounts.mjs';
import { bookingTaskRows } from './work-booking.mjs';
import { goodsTaskRows } from './work-goods.mjs';
import { careTaskRows } from './work-care.mjs';
import { seed, reduce } from './engine.mjs';

const GROUP = { role: 'group', job: 'all' }, STORE = { role: 'store', storeId: 's1' };
const FILTER = '/store/tasks?category=dispatch&status=open&q=BK1&owner=mine&store=s1';
function fixture() {
  const s = upgradeAccounts({ schema: 5, now: 1791000000000, seq: 0,
    stores: [{ id: 's1' }, { id: 's2' }], techs: [{ id: 't1', storeId: 's1' }, { id: 't2', storeId: 's2' }],
    bookings: [{ id: 'BK1', storeId: 's1', status: 'waiting', confirmationPhase: 'store', phone: '13800000000', round: { id: 'ROUND1', startedAt: 1, deadline: 2 }, rounds: [{ id: 'ROUND1' }], refunds: [], assistance: [], disputes: [] }, { id: 'BK2', storeId: 's2', status: 'waiting', round: { id: 'ROUND2' }, rounds: [], refunds: [] }],
    serviceInvoices: [{ id: 'SI1', bookingId: 'BK1', storeId: 's1', status: 'pending' }],
    serviceCareCases: [{ id: 'SC1', bookingId: 'BK1', storeId: 's1', description: '不应复制到导航缓存的正文' }],
    serviceCareFollowups: [{ id: 'CF1', bookingId: 'BK1', storeId: 's1' }],
    techQualifications: [{ techId: 't1', storeId: 's1', grants: [{ id: 'QG1', status: 'pending' }] }],
    goods: [{ id: 'G1', source: { storeId: 's1' }, status: 'paid', payment: { status: 'success' }, cases: [{ id: 'GC1', status: 'requested' }] }, { id: 'G2', source: null, status: 'paid', payment: { status: 'success' }, cases: [] }],
    safety: [{ id: 'SF1', bookingId: 'BK1', storeId: 's1', status: 'open', stage: 'pending' }]
  });
  let request = 0;
  const run = (a, type, p = {}) => accountCommand(s, a, type, { requestId: 'nav-' + ++request, ...p });
  const enter = (accountId, grantId) => resolveAccountActor(s, run(GROUP, 'account.enter', { accountId, grantId }));
  const admin = enter('DEMO-ADMIN', 'DEMO-ADMIN-GRANT');
  function staff(job, storeId = 's1') {
    const account = run(admin, 'account.create', { name: '导航核验员工', reason: '测试授权范围' });
    const granted = run(admin, 'account.grant', { id: account.id, version: account.version, job, ...(STAFF_JOBS[job].role === 'store' ? { storeId } : {}), reason: '测试办理权限' });
    return enter(account.id, granted.grants[0].id);
  }
  return { s, admin, run, enter, staff };
}
const dispatch = s => bookingTaskRows(s).find(x => x.category === 'dispatch' && x.bookingId === 'BK1');
function context(s, a = STORE, task = dispatch(s), listHash = a.role === 'store' ? FILTER : '/group/tasks?status=open') {
  return createTaskReturnContext(s, a, { taskKey: task.id, task, listHash, token: 'task-token-1' });
}
function row(category, sourceId, requiredRoute, path, extra = {}) {
  return { id: `${category}:${sourceId}:handle`, category, sourceId, storeId: 's1', requiredRoute,
    routes: { group: '/group/' + path, store: '/store/' + path },
    allowedJobs: { group: ['support', 'finance', 'operations'], store: ['store-manager', 'store-finance'] }, ...extra };
}
function completedDemo() {
  let s = seed(), seq = 0;
  const user = { role: 'user', userId: 'u1' }, store = { role: 'store', storeId: 'xingfu' }, tech = { role: 'tech', techId: 'lin' };
  const run = (a, command, p = {}) => { s = reduce(s, a, command, { requestId: 'nav-real-' + ++seq, ...p }); return s; };
  run(user, 'booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', startAt: s.now + 4 * 3600000, mode: 'specified', genderPreference: 'any', contactName: '测试用户', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true });
  const bookingId = s.bookings.at(-1).id;
  run(user, 'booking.pay', { id: bookingId, outcome: 'success' }); run(tech, 'booking.accept', { id: bookingId });
  run(user, 'clock.advance', { minutes: 240 }); run(tech, 'booking.start', { id: bookingId });
  run(user, 'clock.advance', { minutes: 60 }); run(tech, 'booking.finish', { id: bookingId, mode: 'normal' });
  return { get s() { return s; }, get b() { return s.bookings.find(x => x.id === bookingId); }, user, store, tech, run };
}

test('legacy scope includes role, job and store; actual sessions use archived grants instead of caller fields', () => {
  const f = fixture(), a = f.staff('store-manager');
  assert.equal(taskActorScope(f.s, GROUP), taskActorScope(f.s, { role: 'group' }));
  assert.notEqual(taskActorScope(f.s, GROUP), taskActorScope(f.s, { role: 'group', job: 'support' }));
  assert.notEqual(taskActorScope(f.s, STORE), taskActorScope(f.s, { ...STORE, storeId: 's2' }));
  assert.notEqual(taskActorScope(f.s, GROUP), taskActorScope(f.s, STORE));
  assert.equal(taskActorScope(f.s, a), taskActorScope(f.s, { ...a, role: 'group', job: 'all', storeId: 's2', accountId: 'forged' }));
  assert.throws(() => taskActorScope(f.s, { role: 'user', userId: 'u1' }));
  assert.throws(() => taskActorScope(f.s, f.admin));
});

test('real dispatch projection saves minimal return metadata and preserves all list filters without mutating state', () => {
  const { s } = fixture(), before = structuredClone(s), task = dispatch(s);
  task.title = '不应缓存标题或客户正文';
  const c = context(s, STORE, task);
  assert.equal(c.targetPath, '/store/bookings/BK1/assign');
  assert.equal(c.listHash, FILTER);
  assert.equal(taskReturnTarget(s, STORE, c, c.targetPath), FILTER);
  assert.doesNotMatch(JSON.stringify(c), /13800000000|不应缓存|sourceToken|dueAt|statusLabel/);
  assert.deepEqual(s, before);
});

test('booking detail and existing assign/reschedule pages keep return access including an unsuccessful submission', () => {
  const { s } = fixture(), c = context(s);
  for (const hash of ['#/store/bookings/BK1', '/store/bookings/BK1/assign', '/store/bookings/BK1/reschedule?startAt=2026-10-04T10%3A00']) {
    assert.equal(taskNavigationTarget(s, STORE, c, hash), true, hash);
    assert.equal(taskReturnTarget(s, STORE, c, hash), FILTER, hash);
  }
  assert.equal(taskReturnTarget(s, STORE, c, '/store/bookings/BK1/refund-pay'), null);
  assert.equal(taskReturnTarget(s, STORE, c, '/store/bookings/BK2'), null);
  assert.equal(taskReturnTarget(s, STORE, c, '/store/tasks'), null);
  assert.equal(taskReturnTarget(s, STORE, c, '/store/dashboard'), null);
  assert.equal(taskReturnTarget(s, STORE, c, '/group/bookings/BK1'), null);
});

test('completed task and JSON refresh/back context retain return access to the original open-only list', () => {
  const { s } = fixture(), saved = JSON.parse(JSON.stringify(context(s)));
  s.bookings[0].status = 'confirmed'; s.bookings[0].round.completedAt = s.now;
  assert.equal(dispatch(s).status, 'done');
  assert.equal(taskReturnTarget(s, STORE, saved, '/store/bookings/BK1'), FILTER);
  assert.equal(taskReturnTarget(s, STORE, saved, '/store/bookings/BK1/assign'), FILTER);
  s.bookings[0].round = { id: 'ROUND3' };
  assert.equal(taskReturnTarget(s, STORE, saved, '/store/bookings/BK1'), FILTER, '原轮次仍在历史记录中');
});

test('switching legacy role/job/store or entering a new session cannot reuse another task context', () => {
  const f = fixture(), c = context(f.s), group = context(f.s, { role: 'group', job: 'support' });
  assert.equal(taskReturnTarget(f.s, { ...STORE, storeId: 's2' }, c, '/store/bookings/BK1'), null);
  assert.equal(taskReturnTarget(f.s, GROUP, c, '/group/bookings/BK1'), null);
  assert.equal(taskReturnTarget(f.s, { role: 'group', job: 'finance' }, group, '/group/bookings/BK1'), null);
  assert.equal(taskReturnTarget(f.s, f.staff('store-manager'), c, '/store/bookings/BK1'), null);
});

test('actual account revocation and re-entry invalidate the old context without deleting business data', () => {
  const f = fixture(), a = f.staff('store-manager'), c = context(f.s, a), bookings = structuredClone(f.s.bookings);
  const account = f.s.staffAccounts.find(x => x.id === a.accountId);
  f.run(f.admin, 'account.status', { id: account.id, version: account.version, enabled: false, reason: '撤销办理权' });
  assert.equal(taskReturnTarget(f.s, a, c, '/store/bookings/BK1'), null);
  assert.throws(() => createTaskReturnContext(f.s, a, { taskKey: dispatch(f.s).id, task: dispatch(f.s), listHash: FILTER, token: 'new' }));
  f.run(f.admin, 'account.status', { id: account.id, version: account.version, enabled: true, reason: '恢复后重新进入' });
  const next = f.enter(a.accountId, a.grantId);
  assert.equal(taskReturnTarget(f.s, next, c, '/store/bookings/BK1'), null);
  assert.deepEqual(f.s.bookings, bookings);
});

test('real leave ends the session; legacy backend or another grant cannot inherit its task context', () => {
  const f = fixture(), a = f.staff('store-manager'), c = context(f.s, a);
  f.run(a, 'account.leave');
  assert.equal(taskReturnTarget(f.s, a, c, '/store/bookings/BK1'), null);
  assert.equal(taskReturnTarget(f.s, STORE, c, '/store/bookings/BK1'), null);
  assert.equal(taskReturnTarget(f.s, f.staff('store-finance'), c, '/store/bookings/BK1'), null);
});

test('list context rejects external, malformed, duplicate, cross-end and unknown query targets', () => {
  const { s } = fixture();
  for (const listHash of ['https://outside.invalid/store/tasks', '//outside.invalid/tasks', '/group/tasks', '/store/tasks/other', '/store/../store/tasks', '/store/%2e%2e/tasks', '/store/tasks#extra', '/store/tasks?status=open&status=done', '/store/tasks?next=%2Fgroup%2Faccounts', '/store/tasks?q=%00', '/store/tasks?q=%FF', '/store/tasks?q=%GG', '/store/tasks?store=s2', '/store/tasks?store=missing', '/store/tasks?q=' + 'x'.repeat(301), '/store/tasks?owner=all%0A']) {
    assert.throws(() => context(s, STORE, dispatch(s), listHash), undefined, listHash);
  }
  const query = '/store/tasks?q=%E5%BE%85%E5%8A%9E%20BK1&status=waiting';
  assert.equal(context(s, STORE, dispatch(s), query).listHash, query);
});

test('source target and restored context reject injected actions, encoded separators and unowned resources', () => {
  const { s } = fixture(), task = dispatch(s), c = context(s);
  for (const bad of ['javascript:alert(1)', '//outside.invalid', '/store/bookings/BK2', '/store/bookings/BK1%2Fassign', '/store/bookings/BK1%252Fassign', '/store/bookings/BK1/../BK2', '/store\\bookings\\BK1', '/store/bookings/BK1?command=booking.cancel', '/store/bookings/BK1/reschedule?startAt=bad', '/store/bookings/BK1/reschedule?startAt=2026-10-04T10%3A00&extra=x', '/group/bookings/BK1']) {
    assert.throws(() => context(s, STORE, { ...task, routes: { ...task.routes, store: bad } }), undefined, bad);
    assert.equal(taskReturnTarget(s, STORE, { ...c, targetPath: bad }, '/store/bookings/BK1'), null, bad);
    assert.equal(taskReturnTarget(s, STORE, c, bad), null, bad);
  }
});

test('source ownership is re-read rather than trusted from task or persisted binding', () => {
  const { s } = fixture(), task = dispatch(s), c = context(s);
  assert.throws(() => context(s, STORE, { ...task, bookingId: 'BK2', sourceId: 'ROUND2', routes: { store: '/store/bookings/BK2' } }));
  assert.equal(taskReturnTarget(s, STORE, { ...c, storeId: 's2' }, '/store/bookings/BK1'), null);
  assert.equal(taskReturnTarget(s, STORE, { ...c, binding: { ...c.binding, bookingId: 'BK2', sourceId: 'ROUND2' } }, '/store/bookings/BK2'), null);
  s.bookings[0].storeId = 's2';
  assert.equal(taskReturnTarget(s, STORE, c, '/store/bookings/BK1'), null);
  s.bookings.splice(0, 1);
  assert.equal(taskReturnTarget(s, STORE, c, '/store/bookings/BK1'), null);
});

test('actual refund execution source keeps a distinct source binding through failure and success', () => {
  const f = fixture(), a = f.staff('store-finance');
  f.s.bookings[0].payment = { id: 'PAY1' };
  f.s.bookings[0].refunds = [{ id: 'RF1', status: 'failed', executions: [{ paymentId: 'PAY1', refundNo: 'RF1-PAY1', status: 'failed' }, { paymentId: 'PAY2', refundNo: 'RF1-PAY2', status: 'success' }] }];
  const task = bookingTaskRows(f.s).find(x => x.refundId === 'RF1' && x.paymentId === 'PAY1');
  const c = context(f.s, a, task, '/store/tasks?category=refund&status=open');
  assert.equal(taskReturnTarget(f.s, a, c, '/store/bookings/BK1'), c.listHash);
  f.s.bookings[0].refunds[0].status = 'success'; f.s.bookings[0].refunds[0].executions[0].status = 'success';
  assert.equal(taskReturnTarget(f.s, a, c, '/store/bookings/BK1'), c.listHash);
  assert.equal(taskReturnTarget(f.s, a, { ...c, binding: { ...c.binding, paymentId: 'PAY2' } }, '/store/bookings/BK1'), null);
});

test('invoice context requires the original booking store and allows only its invoice and booking', () => {
  const f = fixture(), a = f.staff('store-finance'), task = row('invoice', 'SI1', 'invoices', 'invoices/SI1', { invoiceId: 'SI1' });
  const c = context(f.s, a, task, '/store/tasks?category=invoice&owner=unclaimed');
  for (const path of ['/store/invoices/SI1', '/store/invoices?status=pending', '/store/bookings/BK1']) assert.equal(taskReturnTarget(f.s, a, c, path), c.listHash);
  f.s.serviceInvoices[0].status = 'issued';
  assert.equal(taskReturnTarget(f.s, a, c, '/store/invoices/SI1'), c.listHash);
  assert.equal(taskReturnTarget(f.s, a, c, '/store/invoices/SI2'), null);
  assert.throws(() => context(f.s, f.staff('store-manager'), task));
  f.s.serviceInvoices[0].bookingId = 'BK2';
  assert.equal(taskReturnTarget(f.s, a, c, '/store/invoices/SI1'), null);
});

test('care and follow-up contexts accept only linked original subflows, including post-submit lists', () => {
  const { s } = fixture(), task = row('care', 'SC1', 'care', 'care/case/SC1'), c = context(s, STORE, task);
  for (const path of ['/store/care/case/SC1', '/store/care/cases?status=open', '/store/care/followups', '/store/care/followups/new?bookingId=BK1&caseId=SC1', '/store/bookings/BK1']) assert.equal(taskReturnTarget(s, STORE, c, path), FILTER, path);
  assert.equal(taskReturnTarget(s, STORE, c, '/store/care/followups/new?bookingId=BK2&caseId=SC1'), null);
  assert.equal(taskReturnTarget(s, STORE, c, '/store/care/case/SC2'), null);
  const follow = context(s, STORE, row('followup', 'CF1', 'care', 'care/followup/CF1'));
  assert.equal(taskReturnTarget(s, STORE, follow, '/store/care/new?bookingId=BK1&sourceKind=followup&sourceId=CF1'), FILTER);
  s.serviceCareCases.push({ id: 'SC2', bookingId: 'BK1', storeId: 's1', source: { kind: 'followup', id: 'CF1' } });
  assert.equal(taskReturnTarget(s, STORE, follow, '/store/care/case/SC2'), FILTER);
  assert.equal(taskReturnTarget(s, STORE, follow, '/store/care/case/SC1'), null);
});

test('qualification context remains on the source technician after approval and rejects a later store move', () => {
  const f = fixture(), a = f.staff('operations'), task = row('qualification', 'QG1', 'qualifications', 'qualifications/t1', { techId: 't1', grantId: 'QG1' }), c = context(f.s, a, task);
  f.s.techQualifications[0].grants[0].status = 'approved';
  assert.equal(taskReturnTarget(f.s, a, c, '/group/qualifications/t1'), c.listHash);
  assert.equal(taskReturnTarget(f.s, a, c, '/group/qualifications?status=pending'), c.listHash);
  assert.equal(taskReturnTarget(f.s, a, c, '/group/qualifications/t2'), null);
  f.s.techs[0].storeId = 's2';
  assert.equal(taskReturnTarget(f.s, a, c, '/group/qualifications/t1'), null);
});

test('goods source binds the order and case; natural group sales never obtain a store return context', () => {
  const f = fixture(), a = f.staff('warehouse'), shipping = goodsTaskRows(f.s).find(x => x.category === 'goods-shipping' && x.sourceId === 'G2');
  const c = context(f.s, a, shipping);
  assert.equal(taskReturnTarget(f.s, a, c, '/group/goods/G2'), c.listHash);
  assert.throws(() => context(f.s, STORE, shipping));
  const after = goodsTaskRows(f.s).find(x => x.category === 'goods-aftersale'), store = context(f.s, STORE, after);
  assert.equal(taskReturnTarget(f.s, STORE, store, '/store/goods/G1'), FILTER);
  assert.equal(taskReturnTarget(f.s, STORE, store, '/store/goods/G2'), null);
  f.s.goods[0].source.storeId = 's2';
  assert.equal(taskReturnTarget(f.s, STORE, store, '/store/goods/G1'), null);
});

test('native safety permits its original list and booking but finance cannot reuse its metadata', () => {
  const f = fixture(), a = f.staff('support'), task = bookingTaskRows(f.s).find(x => x.category === 'safety'), c = context(f.s, a, task);
  assert.equal(taskReturnTarget(f.s, a, c, '/group/safety'), c.listHash);
  assert.equal(taskReturnTarget(f.s, a, c, '/group/bookings/BK1'), c.listHash);
  f.s.safety[0].status = 'closed';
  assert.equal(taskReturnTarget(f.s, a, c, '/group/safety'), c.listHash);
  assert.throws(() => context(f.s, f.staff('finance'), task));
  assert.equal(taskReturnTarget(f.s, a, c, '/group/safety/SF2'), null);
});

test('absent, corrupt and mismatched context fail closed; no task flag can grant a new role', () => {
  const f = fixture(), task = dispatch(f.s), c = context(f.s);
  for (const invalid of [null, {}, [], { ...c, version: 2 }, { ...c, token: '../x' }, { ...c, scope: taskActorScope(f.s, GROUP) }, { ...c, binding: { category: 'unknown', sourceId: 'ROUND1' } }, { ...c, listHash: '/group/tasks' }]) assert.equal(taskReturnTarget(f.s, STORE, invalid, '/store/bookings/BK1'), null);
  assert.throws(() => createTaskReturnContext(f.s, STORE, { taskKey: 'wrong', task, listHash: FILTER, token: 'one' }));
  assert.throws(() => context(f.s, f.admin, task, '/group/tasks'));
  assert.throws(() => context(f.s, { role: 'group', job: 'warehouse' }, task, '/group/tasks'));
});

test('legacy store ignores a retained group job while actual store grants and group jobs remain isolated', () => {
  const f = fixture(), clean = context(f.s), retained = { ...STORE, job: 'finance' };
  assert.equal(taskActorScope(f.s, retained), taskActorScope(f.s, STORE));
  assert.equal(taskReturnTarget(f.s, retained, clean, '/store/bookings/BK1'), FILTER);
  assert.equal(context(f.s, retained).scope, clean.scope);
  assert.notEqual(taskActorScope(f.s, { role: 'group', job: 'finance' }), taskActorScope(f.s, { role: 'group', job: 'support' }));
  assert.notEqual(taskActorScope(f.s, f.staff('store-finance')), taskActorScope(f.s, f.staff('store-manager')));
});

test('actual care/invoice/qualification adapters produce usable original routes in both authorized backends', () => {
  const h = completedDemo();
  h.run(h.user, 'invoice.apply', { bookingId: h.b.id, kind: 'personal', title: '测试抬头', email: 'demo@example.test' });
  h.run(h.user, 'care.case-create', { bookingId: h.b.id, category: 'quality', description: '实际命令生成的反馈' });
  h.run(h.store, 'care.followup-create', { bookingId: h.b.id, caseId: h.s.serviceCareCases.at(-1).id, scope: 'store', name: '负责人', reason: '人工安排', dueAt: h.s.now + 86400000 });
  h.run(h.store, 'qualification.assess', { techId: 'lin', version: 0, serviceIds: ['relax'], occurredAt: h.s.now, kind: 'initial', batch: '导航测试批次', assessor: '考核人', proof: 'DEMO-NAV-QA', result: 'pass', reason: '正式补录' });
  const q = h.s.techQualifications.find(x => x.techId === 'lin');
  h.run(h.store, 'qualification.request', { techId: 'lin', version: q.version, assessmentId: q.assessments.at(-1).id, reason: '申请测试授权' });
  const before = structuredClone(h.s), rows = careTaskRows(h.s);
  assert.deepEqual(new Set(rows.map(x => x.category)), new Set(['invoice', 'care', 'followup', 'qualification']));
  for (const task of rows) for (const a of [GROUP, h.store]) {
    const list = `/${a.role}/tasks?category=${task.category}&status=active`;
    const c = context(h.s, a, task, list);
    assert.equal(c.targetPath, task.routes[a.role]);
    assert.equal(taskReturnTarget(h.s, a, c, task.routes[a.role]), list, task.id + ':' + a.role);
  }
  assert.deepEqual(h.s, before, '来源和导航读取不升级、补造或改写业务资料');
});

test('real refund approval immediately navigates its approved line before lazy executions exist', () => {
  const h = completedDemo();
  h.run(h.user, 'booking.refund-request', { id: h.b.id, reason: '核验逐笔退款', requests: [{ paymentId: h.b.payment.id, amountCents: 9800 }] });
  const refundId = h.b.refunds.at(-1).id;
  h.run(h.store, 'booking.refund-review', { id: h.b.id, refundId, decision: 'approve', amountCents: 9800, reason: '批准实际退款申请' });
  const refund = h.b.refunds.find(x => x.id === refundId);
  assert.equal(refund.status, 'approved'); assert.equal(refund.executions?.length || 0, 0);
  const task = bookingTaskRows(h.s).find(x => x.refundId === refundId && x.paymentId === h.b.payment.id);
  assert.ok(task); const before = structuredClone(h.s), c = context(h.s, h.store, task, '/store/tasks?category=refund&status=open');
  assert.equal(taskReturnTarget(h.s, h.store, c, task.routes.store), c.listHash);
  assert.deepEqual(h.s, before, '导航不创建退款执行记录');
  assert.throws(() => context(h.s, h.store, { ...task, paymentId: 'unrelated', sourceId: `${refundId}-unrelated` }, c.listHash));
  h.run(h.store, 'booking.refund-pay', { id: h.b.id, refundId, paymentId: h.b.payment.id, outcome: 'failed' });
  assert.equal(taskReturnTarget(h.s, h.store, c, task.routes.store), c.listHash);
  h.run(h.store, 'booking.refund-pay', { id: h.b.id, refundId, paymentId: h.b.payment.id, outcome: 'success' });
  assert.equal(taskReturnTarget(h.s, h.store, c, task.routes.store), c.listHash);
});

test('care specialist link stays bound to its actual technician and action before and after real pause', () => {
  const h = completedDemo();
  h.run(h.user, 'care.case-create', { bookingId: h.b.id, category: 'quality', description: '需要复训的反馈' });
  let care = h.s.serviceCareCases.at(-1);
  h.run(h.store, 'care.case-respond', { id: care.id, version: care.version, decision: 'respond', publicReply: '核实后安排复训', specialistAction: 'retraining' });
  care = h.s.serviceCareCases.at(-1);
  const task = careTaskRows(h.s).find(x => x.category === 'care'), c = context(h.s, h.store, task, '/store/tasks?category=care&status=waiting');
  const base = '/store/qualifications/lin', query = `?caseId=${care.id}&actionIndex=0&caseVersion=${care.version}`, linked = base + query;
  assert.equal(taskReturnTarget(h.s, h.store, c, linked), c.listHash);
  for (const bad of [base, '/store/qualifications/chen' + query, base + query.replace('actionIndex=0', 'actionIndex=8'), base + query.replace(care.id, 'SC-missing'), base + query + '&next=all']) assert.equal(taskReturnTarget(h.s, h.store, c, bad), null, bad);
  h.run(h.store, 'qualification.pause', { techId: 'lin', version: 0, serviceIds: ['relax'], owner: '复训负责人', reason: '按反馈登记真实暂停', caseId: care.id, actionIndex: 0, caseVersion: care.version });
  assert.equal(taskReturnTarget(h.s, h.store, c, base), c.listHash, '原表单成功跳不带query的技师详情');
  assert.equal(taskReturnTarget(h.s, h.store, c, linked), c.listHash, '后退到旧版本表单仍可返回列表');
  assert.equal(taskReturnTarget(h.s, h.store, c, '/store/qualifications/chen'), null);
});

test('real red invoice and net replacement keep return access only along their reciprocal invoice chain', () => {
  const h = completedDemo(), file = { ref: 'invoice-file:' + 'a'.repeat(64), name: '测试发票.pdf', type: 'application/pdf', size: 100 };
  h.run(h.user, 'invoice.apply', { bookingId: h.b.id, kind: 'personal', title: '测试抬头', email: 'demo@example.test' });
  let invoice = h.s.serviceInvoices.at(-1);
  const task = careTaskRows(h.s).find(x => x.category === 'invoice'), c = context(h.s, h.store, task, '/store/tasks?category=invoice&status=active');
  h.run(h.store, 'invoice.issue', { id: invoice.id, version: invoice.version, ticketNumber: 'DEMO-INVOICE-1', file });
  h.run(h.user, 'booking.refund-request', { id: h.b.id, reason: '真实部分退款', requests: [{ paymentId: h.b.payment.id, amountCents: 9800 }] });
  const refundId = h.b.refunds.at(-1).id;
  h.run(h.store, 'booking.refund-review', { id: h.b.id, refundId, decision: 'approve', amountCents: 9800, reason: '批准退款' });
  h.run(h.store, 'booking.refund-pay', { id: h.b.id, refundId, outcome: 'success' });
  invoice = h.s.serviceInvoices[0]; assert.equal(invoice.status, 'red_pending');
  h.run(h.store, 'invoice.red', { id: invoice.id, version: invoice.version, ticketNumber: 'DEMO-RED-1', file: { ...file, ref: 'invoice-file:' + 'b'.repeat(64) } });
  invoice = h.s.serviceInvoices[0];
  h.run(h.user, 'invoice.reapply', { id: invoice.id, version: invoice.version, kind: 'personal', title: '净额发票', email: 'demo@example.test' });
  const replacement = h.s.serviceInvoices.at(-1), target = `/store/invoices/${replacement.id}`;
  assert.notEqual(replacement.id, invoice.id);
  assert.equal(taskReturnTarget(h.s, h.store, c, target), c.listHash);
  assert.equal(taskReturnTarget(h.s, h.store, c, '/store/invoices?status=pending'), c.listHash);
  h.s.serviceInvoices.push({ ...replacement, id: 'SI-unlinked', replacesId: null, replacedById: null });
  assert.equal(taskReturnTarget(h.s, h.store, c, '/store/invoices/SI-unlinked'), null);
  replacement.replacesId = null;
  assert.equal(taskReturnTarget(h.s, h.store, c, target), null, '单向伪造链接不能拓展原发票链');
});
