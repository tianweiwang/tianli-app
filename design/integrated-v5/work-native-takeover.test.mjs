import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed } from './engine.mjs';
import { accountCommand, upgradeAccounts, resolveAccountActor } from './staff-accounts.mjs';
import { bookingCommand } from './booking.mjs';
import { careCommand } from './service-care.mjs';
import { fulfilmentCommand, fulfilmentBindingToken, fulfilmentView, captureFulfilmentTransition } from './fulfilment.mjs';
import { workTaskView } from './work-tasks.mjs';
import { workEscalationView, workEscalationCommand } from './work-escalation.mjs';
import { workEscalationPanel } from './work-escalation-ui.mjs';
import { nativeTakeoverAvailability, takeOver } from './work-native-takeover.mjs';
const user = { role: 'user', userId: 'u1' }, tech = { role: 'tech', techId: 'lin' };
let sequence = 0;
function fixture() {
  let s = seed(); upgradeAccounts(s);
  s.bookings = [{ id: 'BN', userId: 'u1', storeId: 'xingfu', techId: 'lin', serviceId: 'relax', status: 'done', createdAt: s.now - 3600000, completedAt: s.now, startAt: s.now - 3600000, payment: { id: 'PN', status: 'success', amountCents: 29800, refundedCents: 0 }, extensions: [], rounds: [], refunds: [], disputes: [], assistance: [], events: [] }];
  const f = { get s() { return s; }, edit: fn => fn(s), actor: raw => resolveAccountActor(s, raw), task: (a, id) => workTaskView(s, a).tasks.find(x => x.id === id), row: (a, id) => workEscalationView(s, a).rows.find(x => x.task.id === id),
    run(raw, type, p = {}) { const next = structuredClone(s), actor = resolveAccountActor(next, raw), ctx = { id: prefix => prefix + (++next.seq), fail: m => { throw Error(m); }, log: (row, text) => { const event={text,at:next.now,actor:actor.role,actorId:actor.role==='user'?actor.userId:actor.role==='tech'?actor.techId:actor.role==='group'?'group':actor.storeId}; (row.events ??= []).push(event); (next.logs ??= []).push({ ...event,id:row.id }); } }, request = { requestId: `native-test-${++sequence}`, ...p }; let result;
      if (type.startsWith('account.')) result = accountCommand(next, raw, type, request, ctx);
      else if (type.startsWith('care.')) result = careCommand(next, actor, type, request, ctx);
      else if (type.startsWith('booking.')) { const before = structuredClone(next.bookings.find(x => x.id === p.id)); result = bookingCommand(next, actor, type, request, ctx); if (before) captureFulfilmentTransition(next, actor, before, next.bookings.find(x => x.id === p.id), type, ctx); }
      else if (type.startsWith('fulfilment.')) { const b = next.bookings.find(x => x.id === p.bookingId); result = fulfilmentCommand(next, actor, type, { ...(b ? { bookingToken: fulfilmentBindingToken(b) } : {}), ...request }, ctx); }
      else if (type === 'native.test') result = takeOver(next, { task: p.task, actor: raw, reason: p.reason || '当前本人依实际值班与责任接管', requestId: request.requestId }, ctx);
      else result = workEscalationCommand(next, raw, type, request, { ...ctx, takeoverNativeWork: args => takeOver(next, args, ctx) });
      s = next; return structuredClone(result);
    },
    staff(job, name = job, storeId = 'xingfu') { const account = this.run(this.admin, 'account.create', { name, reason: '验证实际工作身份' }), assigned = this.run(this.admin, 'account.grant', { id: account.id, version: account.version, job, ...(job.startsWith('store-') ? { storeId } : {}), reason: '明确原资源授权' }); const entered = this.run(user, 'account.enter', { accountId: account.id, grantId: assigned.grants[0].id }); return resolveAccountActor(s, entered); },
    revoke(a) { const account = s.staffAccounts.find(x => x.id === a.accountId); this.run(this.admin, 'account.status', { id: account.id, version: account.version, enabled: false, reason: '停用原工作授权' }); },
    care() { const c = this.run(user, 'care.case-create', { bookingId: 'BN', category: 'quality', description: '实际质量问题核实' }); return `care-case:${c.id}:resolution`; },
    follow(a) { const row = this.run(a, 'care.followup-create', { bookingId: 'BN', reason: '人工安排实际回访', scope: 'store', name: '待实际工作账号接管', dueAt: s.now + 86400000 }); return `care-followup:${row.id}:followup`; },
    safety(a, ack = true) { s.safety = [{ id: 'HN', bookingId: 'BN', storeId: 'xingfu', status: 'open', stage: 'pending', createdAt: s.now, ackDeadline: s.now + 180000, escalationDeadline: s.now + 360000, events: [] }]; if (ack) this.run(a, 'booking.help-ack', { safetyId: 'HN', responsibleName: this.actor(a).accountName }); return 'booking-safety:HN:handle'; },
    exit() { const b = this.run(user, 'booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', mode: 'specified', startAt: s.now + 14400000, contactName: '履约测试顾客', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true }); this.run(user, 'booking.pay', { id: b.id, outcome: 'success' }); this.run(tech, 'booking.accept', { id: b.id }); s.now = b.startAt; this.run(tech, 'booking.start', { id: b.id }); s.now += 3600000; this.run(tech, 'booking.finish', { id: b.id, mode: 'normal' }); const exit = s.fulfilmentDepartures.find(x => x.bookingId === b.id); return `fulfilment-exit:${exit.id}:safety`; },
    duty(a, support, extra = {}) { this.run(support, 'fulfilment.duty-save', { version: 0, scope: a.role, storeId: a.storeId, accountId: a.accountId, grantId: a.grantId, startAt: s.now - 1, endAt: s.now + 3600000, enabled: true, reason: '实际人工值班安排', ...extra }); },
    payload(a, id, p = {}) { const r = this.row(a, id); return { id, sourceToken: r.task.sourceToken, ownerToken: r.ownerToken, assignmentVersion: r.assignmentVersion, version: r.version, reason: '当前本人依实际责任与班次接管', ...p }; },
    raise(a, id, receiver = a) { const target = this.actor(receiver); this.run(a, 'work-escalation.raise', this.payload(a, id, { cause: 'manual-review', accountId: target.accountId, grantId: target.grantId })); },
    take(a, id, p = {}) { return this.run(a, 'work-escalation.takeover', this.payload(a, id, p)); },
    direct(a, id, p = {}) { return this.run(a, 'native.test', { task: this.task(a, id), ...p }); }
  };
  f.admin = f.run(user, 'account.enter', { accountId: 'DEMO-ADMIN', grantId: 'DEMO-ADMIN-GRANT' });
  return f;
}
const business = s => structuredClone({ bookings: s.bookings, goods: s.goods, skus: s.skus, bills: s.bills, finance: s.serviceFinanceEntries, recoveries: s.serviceFinanceRecoveries, assignments: s.workTaskAssignments });

test('真实原质量转派接管保存唯一 assignee 和授权版本，源阶段/期限及资金库存不动', () => {
  const f = fixture(), a = f.staff('store-manager', '真实甲'), id = f.care(), before = business(f.s), original = structuredClone(f.s.serviceCareCases[0]);
  assert.deepEqual(nativeTakeoverAvailability(f.s, a, f.task(a, id)), { available: true, reason: '' }); f.raise(a, id); f.take(a, id);
  const row = f.s.serviceCareCases[0]; assert.equal(row.assignee.accountId, a.accountId); assert.equal(row.assignee.grantId, a.grantId); assert.equal(row.assignee.accountVersion, f.s.staffAccounts.find(x => x.id === a.accountId).version); assert.equal(row.assignee.claimedAt, f.s.now); assert.equal(row.ownerScope, original.ownerScope); assert.equal(row.status, original.status); assert.equal(row.storeDueAt, original.storeDueAt); assert.equal(row.version, original.version + 2); assert.ok(row.history.some(x => x.action === '转派事项')); assert.ok(row.history.some(x => x.action === '事项升级由本人接管')); assert.deepEqual(business(f.s), before); assert.equal(f.row(a, id).status, 'taken-over');
});
test('实际原人工回访转派接管：原人工dueAt和计划信息原样，不能凭接管标回访已做', () => {
  const f = fixture(), a = f.staff('store-manager'), id = f.follow(a), original = structuredClone(f.s.serviceCareFollowups[0]); f.raise(a, id); f.take(a, id);
  const row = f.s.serviceCareFollowups[0]; assert.equal(row.assignee.accountId, a.accountId); assert.equal(row.dueAt, original.dueAt); assert.equal(row.nextContactAt, original.nextContactAt); assert.equal(row.status, 'open'); assert.deepEqual(row.attempts, []); assert.equal(f.row(a, id).task.status, 'open');
});
test('质量跨ownerScope明确拒绝，原页真实转集团后以新源阶段接管且期限保留', () => {
  const f = fixture(), a = f.staff('store-manager'), g = f.staff('support'), id = f.care(), before = structuredClone(f.s);
  const availability = nativeTakeoverAvailability(f.s, g, f.task(g, id)); assert.equal(availability.available, false); assert.match(availability.reason, /跨负责工作端/); assert.throws(() => f.direct(g, id), /跨负责工作端/); assert.deepEqual(f.s, before);
  const c = f.s.serviceCareCases[0]; f.run(a, 'care.task-assign', { entity: 'case', id: c.id, version: c.version, scope: 'group', name: '待集团真实接管', reason: '原门店按源规则转集团' }); const due = f.s.serviceCareCases[0].groupDueAt;
  assert.equal(nativeTakeoverAvailability(f.s, a, f.task(a, id)).available, false); f.raise(g, id); f.take(g, id); assert.equal(f.s.serviceCareCases[0].groupDueAt, due); assert.equal(f.s.serviceCareCases[0].status, 'group_pending'); assert.equal(f.s.serviceCareCases[0].assignee.accountId, g.accountId);
});
test('等待用户确认的质量事项只换同源责任，不能转端或缩短用户确认窗口', () => {
  const f = fixture(), a = f.staff('store-manager'), b = f.staff('store-manager', '乙'), g = f.staff('support'), id = f.care(), c = f.s.serviceCareCases[0]; f.run(a, 'care.case-respond', { id: c.id, version: c.version, decision: 'respond', publicReply: '已核查并给出公开回复' }); const due = f.s.serviceCareCases[0].userDueAt;
  assert.equal(f.task(a, id).status, 'waiting'); assert.equal(nativeTakeoverAvailability(f.s, g, f.task(g, id)).available, false); f.raise(a, id, b); f.take(b, id); assert.equal(f.s.serviceCareCases[0].status, 'user_pending'); assert.equal(f.s.serviceCareCases[0].userDueAt, due); assert.equal(f.s.serviceCareCases[0].assignee.accountId, b.accountId);
});
test('原接报事实保留，安全接管只更新唯一 current responsibility 并追加审计', () => {
  const f = fixture(), a = f.staff('support', '原接报甲'), b = f.staff('support', '接管乙'), id = f.safety(a), before = business(f.s), old = structuredClone(f.s.safety[0]); f.raise(a, id, b); f.take(b, id);
  const h = f.s.safety[0]; assert.deepEqual(h.acknowledgedBy, old.acknowledgedBy); assert.equal(h.acknowledgedAt, old.acknowledgedAt); assert.equal(h.stage, old.stage); assert.equal(h.ackDeadline, old.ackDeadline); assert.equal(h.escalationDeadline, old.escalationDeadline); assert.equal(h.status, 'open'); assert.equal(h.responsibility.accountId, b.accountId); assert.equal(h.responsibility.grantId, b.grantId); assert.equal(h.responsibility.version, 1); assert.equal(h.events.findLast(e => e.text === '事项升级由当前工作账号本人接管').by.accountId, b.accountId); assert.equal(f.row(b, id).owner.accountId, b.accountId); assert.deepEqual(business(f.s), before);
});
test('再次交接只有一个当前responsibility，历史前任和实际拒接/接管均可追溯', () => {
  const f = fixture(), a = f.staff('support', '甲'), b = f.staff('support', '乙'), id = f.safety(a); f.raise(a, id, b); f.take(b, id); f.run(b, 'work-escalation.decline', f.payload(b, id, { reason: '本班次结束需实际交接' })); f.raise(a, id, a); f.take(a, id);
  const h = f.s.safety[0]; assert.equal(h.responsibility.accountId, a.accountId); assert.equal(h.responsibility.version, 2); assert.equal(h.events.findLast(e => e.text === '事项升级由当前工作账号本人接管').before.accountId, b.accountId); assert.equal(h.acknowledgedBy.accountId, a.accountId); assert.equal(f.row(a, id).record.history.filter(x => x.type.endsWith('takeover')).length, 2); assert.equal((f.s.workTaskAssignments || []).length, 0);
});
test('未接报、缺原接报证据或未来接报不可借adapter代接报，UI有具体恢复说明', () => {
  const f = fixture(), a = f.staff('support'), id = f.safety(a, false); f.raise(a, id); const before = structuredClone(f.s), task = f.task(a, id), availability = nativeTakeoverAvailability(f.s, a, task);
  assert.equal(availability.available, false); assert.match(availability.reason, /实际接报/); assert.throws(() => f.take(a, id), /实际接报/); assert.deepEqual(f.s, before);
  const e = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), ui = { esc: e, date: x => String(x), button: (text, cmd) => `<button data-command="${cmd}">${text}</button>`, nativeWorkTakeoverReady: () => true, nativeWorkTakeoverAvailability: t => nativeTakeoverAvailability(f.s, a, t) };
  const html = workEscalationPanel(f.s, a, task, ui); assert.match(html, /实际接报/); assert.doesNotMatch(html, /data-command="work-escalation.takeover"/); assert.match(html, /data-command="ui.task-open"/);
  for (const mutation of [s => { s.safety[0].acknowledgedAt = s.now + 1; s.safety[0].acknowledgedBy = { role: 'store' }; }, s => { s.safety[0].acknowledgedAt = s.now; delete s.safety[0].acknowledgedBy; }]) { f.edit(mutation); assert.equal(nativeTakeoverAvailability(f.s, a, f.task(a, id)).available, false); }
});
test('安全离开真实原takeover需要实际有效值班；无默认值班或安全确认', () => {
  const f = fixture(), a = f.staff('store-manager'), g = f.staff('support'), id = f.exit(), task = f.task(a, id);
  assert.equal(nativeTakeoverAvailability(f.s, a, task).available, false); const before = structuredClone(f.s); assert.throws(() => f.direct(a, id), /有效值班/); assert.deepEqual(f.s, before);
  f.duty(a, g); const businessBefore = business(f.s), due = f.task(a, id).dueAt; f.raise(a, id); f.take(a, id); const exit = f.s.fulfilmentDepartures.find(x => x.id === f.task(a, id).sourceId);
  assert.equal(exit.owner.accountId, a.accountId); assert.equal(exit.owner.grantId, a.grantId); assert.equal(exit.status, 'handling'); assert.equal(exit.safeLeftFact, null); assert.equal(exit.resolution, undefined); assert.equal(f.task(a, id).dueAt, due); assert.ok(exit.history.some(x => x.action === '当前有效值班人员接管')); assert.deepEqual(business(f.s), businessBefore);
});
test('安全离开升级后只有有效集团值班可接管，值班/源资格即时失效不能重试', () => {
  const f = fixture(), a = f.staff('store-manager'), g = f.staff('support'), id = f.exit(); f.duty(a, g); f.duty(g, g);
  const task = f.task(a, id), b = f.s.bookings.find(x => x.id === task.bookingId), exit = f.s.fulfilmentDepartures.find(x => x.id === task.sourceId); f.run(a, 'fulfilment.departure-escalate', { bookingId: b.id, departureId: exit.id, version: exit.version, reason: '实际联系后仍不能核实' });
  assert.equal(nativeTakeoverAvailability(f.s, a, f.task(a, id)).available, false); f.raise(g, id); f.take(g, id); assert.equal(f.s.fulfilmentDepartures.find(x => x.id === exit.id).owner.accountId, g.accountId);
  f.edit(s => s.fulfilmentDutyRosters.find(x => x.accountId === g.accountId).endAt = s.now); assert.equal(nativeTakeoverAvailability(f.s, g, f.task(g, id)).available, false); assert.throws(() => f.direct(g, id), /有效值班/);
});
test('显式测试配置的原安全联系期限不随接管、重试重计', () => {
  const f = fixture(), a = f.staff('store-manager'), g = f.staff('support'); f.run(g, 'fulfilment.policy-publish', { version: 0, collectorMode: 'tech-store-confirm', noticeMode: 'none', blockUnconfirmed: false, basis: '仅焦点测试显式分钟，非正式默认规则', reason: '核验不重置原期限', effectiveAt: f.s.now, departureContactMinutes: 3, escalateMinutes: 6 }); const id = f.exit(); f.duty(a, g); const t = f.task(a, id), exit = f.s.fulfilmentDepartures.find(x => x.id === t.sourceId), original = { contactDueAt: exit.contactDueAt, escalationDueAt: exit.escalationDueAt };
  f.raise(a, id); const p = f.payload(a, id, { requestId: 'native-stable-retry' }); f.run(a, 'work-escalation.takeover', p); f.run(a, 'work-escalation.takeover', p); assert.equal(f.task(a, id).dueAt, original.contactDueAt); assert.equal(exit.contactDueAt, original.contactDueAt); const actual = f.s.fulfilmentDepartures.find(x => x.id === t.sourceId); assert.equal(actual.escalationDueAt, original.escalationDueAt); assert.equal(actual.history.filter(x => x.action === '当前有效值班人员接管').length, 1);
});
test('本源token、实际本人会话、跨店和岗位权限全部复核，不能靠传入task冒充资源', () => {
  const f = fixture(), a = f.staff('store-manager'), b = f.staff('store-manager', '外店', 'silver'), finance = f.staff('store-finance'), id = f.care(), task = f.task(a, id), before = structuredClone(f.s);
  for (const actor of [b, finance, f.admin, { role: 'store', storeId: 'xingfu' }, user, { ...b, role: 'store', storeId: 'xingfu', job: 'store-manager' }]) { assert.equal(nativeTakeoverAvailability(f.s, actor, task).available, false); assert.throws(() => f.run(actor, 'native.test', { task })); }
  assert.throws(() => f.direct(a, id, { task: { ...task, sourceToken: 'old' } }), /阶段或版本/); assert.deepEqual(f.s, before); f.revoke(a); assert.equal(nativeTakeoverAvailability(f.s, a, task).available, false); assert.throws(() => f.run(a, 'native.test', { task }), /失效/);
});
test('原case/安全关闭、源门店迁移或task模式不可重新接管，读取不能制造来源', () => {
  const f = fixture(), a = f.staff('store-manager'), id = f.care(), task = f.task(a, id); f.edit(s => s.serviceCareCases[0].status = 'closed'); assert.equal(nativeTakeoverAvailability(f.s, a, task).available, false);
  const h = fixture(), g = h.staff('support'), safetyId = h.safety(g), safetyTask = h.task(g, safetyId); h.edit(s => s.safety[0].status = 'closed'); assert.equal(nativeTakeoverAvailability(h.s, g, safetyTask).available, false);
  const shifted = fixture(), manager = shifted.staff('store-manager'), careId = shifted.care(), old = shifted.task(manager, careId); shifted.edit(s => s.bookings[0].storeId = 'silver'); assert.equal(nativeTakeoverAvailability(shifted.s, manager, old).available, false); const before = structuredClone(shifted.s); assert.throws(() => shifted.run(manager, 'native.test', { task: old }), /门店|来源/); assert.deepEqual(shifted.s, before);
});
test('原子事务遇到原期限触发升阶段拒绝旧接管，不能保留一半源转派和升级状态', () => {
  const f = fixture(), a = f.staff('store-manager'), id = f.care(); f.raise(a, id); f.edit(s => s.now = s.serviceCareCases[0].storeDueAt); const before = structuredClone(f.s); assert.throws(() => f.take(a, id), /记录已更新|原.*阶段|期限/); assert.deepEqual(f.s, before); assert.equal(f.row(a, id).record.status, 'raised');
});
test('子请求SHA-256与Node标准一致，最长外层ID保持稳定且不突破原care200字上限', () => {
  const f = fixture(), a = f.staff('store-manager'), id = f.care(), outerId = '中文🙂'.repeat(60); f.raise(a, id); const payload = f.payload(a, id, { requestId: outerId }); f.run(a, 'work-escalation.takeover', payload);
  const expected = 'native-work:' + createHash('sha256').update(JSON.stringify({ requestId: outerId, taskId: id, accountId: a.accountId, grantId: a.grantId })).digest('hex'); assert.equal(f.s.serviceCareRequests.at(-1).requestId, expected); assert.equal(expected.length, 76); assert.ok(expected.length < 200); const count = f.s.serviceCareRequests.length; f.run(a, 'work-escalation.takeover', payload); assert.equal(f.s.serviceCareRequests.length, count);
});
test('pure availability不修改任何来源；第五参数复用投影，null显式不再重新聚合', () => {
  const f = fixture(), a = f.staff('store-manager'), id = f.care(), task = f.task(a, id), row = f.row(a, id), before = structuredClone(f.s), ui = { esc: String, date: String, button: () => '<button>原办理页</button>' };
  assert.equal(nativeTakeoverAvailability(f.s, a, task).available, true); assert.equal(workEscalationPanel(f.s, user, task, ui, null), ''); assert.equal(workEscalationPanel(f.s, user, task, ui, { ...row, task: { ...task, id: 'other' } }), ''); assert.match(workEscalationPanel(f.s, a, task, ui, row), /责任升级与接管/); assert.deepEqual(f.s, before);
});
test('嵌入原待办卡片不重复展示业务owner或原页入口，汇总独立页完整保留', () => {
  const f = fixture(), a = f.staff('store-manager'), id = f.care(); f.raise(a, id); const task = f.task(a, id), row = f.row(a, id), ui = { esc: String, date: String, button: (label, command) => `<button data-command="${command}">${label}</button>`, nativeWorkTakeoverAvailability: t => nativeTakeoverAvailability(f.s, a, t) };
  const embedded = workEscalationPanel(f.s, a, task, { ...ui, escalationEmbedded: true }, row); assert.doesNotMatch(embedded, /<dt>原业务责任<\/dt>|<dt>原办理期限<\/dt>|data-command="ui.task-open"/); assert.match(embedded, /升级核对接收者/); assert.match(embedded, /data-command="work-escalation.takeover"/);
  const standalone = workEscalationPanel(f.s, a, task, ui, row); assert.match(standalone, /<dt>原业务责任<\/dt>/); assert.equal((standalone.match(/data-command="ui.task-open"/g) || []).length, 1);
});
