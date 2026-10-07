// Test setup calls the original care/account commands; it does not emulate their rules.
import { upgradeCare, careCommand, syncCare } from './service-care.mjs';
import { upgradeAccounts, accountCommand, resolveAccountActor } from './staff-accounts.mjs';
import { upgradeTechnicianPenalties, technicianPenaltyCommand, technicianPenaltyView } from './technician-penalties.mjs';
export const NOW = Date.parse('2026-10-04T10:00:00+08:00'), HOUR = 3600000;
export const user = { role: 'user', userId: 'u1' }, tech = { role: 'tech', techId: 't1' }, store = { role: 'store', storeId: 's1' }, support = { role: 'group', job: 'support' };
export function fixture({ accepted = true, decision = 'respond', action = 'penalty', responder = store } = {}) {
  let s = { schema: 5, now: NOW, seq: 0, users: [{ id: 'u1' }, { id: 'u2' }], stores: [{ id: 's1', name: '原门店' }, { id: 's2' }], techs: [{ id: 't1', storeId: 's1', active: true }, { id: 't2', storeId: 's2' }], safety: [], serviceReviews: [], logs: [], bookings: ['1', '2'].map(x => ({ id: 'B' + x, userId: 'u' + x, techId: 't' + x, storeId: 's' + x, status: 'done', completedAt: NOW - HOUR, paidCents: 20000, refunds: [], disputes: [], mainPayment: { id: 'P' + x, amountCents: 20000, status: 'paid' } })) };
  upgradeCare(s); upgradeAccounts(s); upgradeTechnicianPenalties(s); let requests = 0;
  const context = state => ({ id: prefix => prefix + (++state.seq), fail: message => { throw Error(message); }, log: (row, content) => state.logs.push({ id: row.id, at: state.now, text: content }) });
  const execute = (fn, actor, type, payload) => { const next = structuredClone(s), result = fn(next, actor, type, { requestId: 'penalty-test-' + (++requests), ...payload }, context(next)); s = next; return result; };
  const f = {
    get s() { return s; }, get c() { return s.serviceCareCases[0]; }, get row() { return s.technicianPenalties[0]; },
    care(type, p = {}, actor = store) { return execute(careCommand, actor, type, p); },
    run(type, p = {}, actor = store) { return execute(technicianPenaltyCommand, actor, type, p); },
    account(type, p = {}, actor = user) { return execute(accountCommand, actor, type, p); },
    candidate(actor = store) { return technicianPenaltyView(s, actor).sourceCases[0]; },
    warning(p = {}, actor = store) { return this.run('penalty.warning-record', { ...this.candidate(actor), reference: 'WARN-ORIGINAL-1', occurredAt: s.now, reason: '原案件已核实的一般态度问题，原店实际予以警告', internalNote: 'SECRET-INTERNAL-DECISION', ...p }, actor); },
    current(actor = tech) { return technicianPenaltyView(s, actor).penalties[0]; },
    appeal(p = {}, actor = tech) { const v = this.current(actor); return this.run('penalty.appeal', { id: this.row.id, version: this.row.version, sourceToken: v?.sourceToken, reason: '本人陈述实际情况并申请集团复核', ...p }, actor); },
    review(p = {}, actor = support) { const v = this.current(actor); return this.run('penalty.appeal-review', { id: this.row.id, version: this.row.version, sourceToken: v?.sourceToken, decision: 'maintain', reference: 'REVIEW-ORIGINAL-1', occurredAt: s.now, reason: '集团核对实际陈述及原事实后维持警告', internalNote: 'SECRET-INTERNAL-REVIEW', ...p }, actor); },
    staff(job = 'store-manager', storeId = 's1') { const entered = this.account('account.enter', { accountId: 'DEMO-ADMIN', grantId: 'DEMO-ADMIN-GRANT' }); const admin = resolveAccountActor(s, entered); const a = this.account('account.create', { name: '真实测试员工', reason: '明确人员岗位' }, admin); const result = this.account('account.grant', { id: a.id, version: a.version, job, ...(job.startsWith('store-') ? { storeId } : {}), reason: '当前岗位授权' }, admin); const session = this.account('account.enter', { accountId: a.id, grantId: result.grants.at(-1).id }); return resolveAccountActor(s, session); },
    advance(delta) { s.now += delta; syncCare(s, context(s)); }
  };
  f.care('care.case-create', { bookingId: 'B1', category: 'attitude', description: '原用户投诉实际服务态度问题', evidence: '原文字说明-CLIENT-PRIVATE' }, user);
  if (responder.role === 'group') f.care('care.task-assign', { entity: 'case', id: f.c.id, version: f.c.version, scope: 'group', name: '集团原客服', reason: '原事实提交集团核实' });
  f.care('care.case-respond', { id: f.c.id, version: f.c.version, decision, publicReply: '已核实实际情况并提出处理', internalNote: 'SECRET-SOURCE-INVESTIGATION', specialistAction: action }, responder);
  if (accepted && responder.role !== 'group') f.care('care.case-answer', { id: f.c.id, version: f.c.version, decision: 'accept' }, user);
  return f;
}
