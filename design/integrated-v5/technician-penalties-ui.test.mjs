import test from 'node:test';
import assert from 'node:assert/strict';
import { technicianPenaltyUiView, technicianPenaltyCarePanel } from './technician-penalties-ui.mjs';
import { fixture, NOW, tech, store, support, user } from './technician-penalties-test-fixture.mjs';
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// These parse actual rendered forms and drive actual domain commands; no source-string rule assertions.
function forms(html, command) { return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, attrs, body]) => ({ attrs, body, command: /data-command="([^"]+)"/.exec(attrs)?.[1], payload: JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1] || '{}')), key: decode(/data-management-form="([^"]+)"/.exec(attrs)?.[1] || '') })).filter(x => !command || x.command === command); }
const page = (f, actor = store, id = '') => technicianPenaltyUiView(f.s, actor, ['penalties', ...(id ? [id] : [])]);
function send(f, form, fields, actor) { assert.ok(form, 'expected actual actionable form'); return f.run(form.command, { ...form.payload, ...fields }, actor); }

test('处罚UI仅接自身路径和实际本人原店客服，其他岗位/深链不露记录', () => {
  const f = fixture(); assert.equal(technicianPenaltyUiView(f.s, store, ['care']), null); assert.match(technicianPenaltyUiView(f.s, store, ['penalties', 'one', 'extra']), /页面不存在/);
  assert.match(page(f), /待登记一般警告/); f.warning();
  for (const actor of [user, { role: 'group', job: 'finance' }, { role: 'group', job: 'operations' }, { role: 'group', job: 'warehouse' }]) { assert.match(page(f, actor), /无权/); assert.equal(technicianPenaltyCarePanel(f.s, actor, f.c), ''); }
  for (const actor of [{ role: 'tech', techId: 't2' }, { role: 'store', storeId: 's2' }]) { assert.match(page(f, actor, f.row.id), /不存在或无权/); assert.doesNotMatch(page(f, actor), /WARN-ORIGINAL-1|TP\d/); }
});
test('原case生成实际warning表单带准确源/版本与显式事实，提交关联真实决定', () => {
  const f = fixture(), html = technicianPenaltyCarePanel(f.s, store, f.c), form = forms(html, 'penalty.warning-record')[0];
  assert.equal(form.payload.caseId, f.c.id); assert.equal(form.payload.actionIndex, 0); assert.equal(form.payload.caseVersion, f.c.version); assert.equal(form.payload.sourceToken, f.candidate().sourceToken); assert.match(form.attrs, /data-live-version=/); assert.match(form.attrs, /data-confirm=/); assert.match(form.attrs, /data-next="\/store\/penalties"/); assert.match(form.key, new RegExp(`case:${f.c.id}:0`));
  assert.match(form.body, /name="occurredAt" value="" required/); assert.match(form.body, /management-draft-note[^>]*role="status"/); assert.match(form.body, /type="button"[^>]*data-command="ui.management-discard"/); assert.doesNotMatch(form.body, /name="(?:durationDays|fineCents|amountCents)"/);
  send(f, form, { reference: 'UI-WARN-1', occurredAt: '2026-10-04T10:00', reason: '实际一般问题的警告依据', internalNote: 'SECRET-UI-WARNING' }, store);
  assert.equal(f.row.decision.reference, 'UI-WARN-1'); assert.equal(f.row.decision.occurredAt, NOW); assert.match(technicianPenaltyCarePanel(f.s, store, f.c), /一般警告已入档|查看原一般警告与申诉/); assert.equal(forms(technicianPenaltyCarePanel(f.s, store, f.c), 'penalty.warning-record').length, 0);
});

test('自由店长不继承旧集团岗位限制，真实财务会话不能伪装店长入档',()=>{
  for(const job of ['warehouse','finance','support']){
    const manager={role:'manager',storeId:'s1',job},f=fixture({responder:manager});
    const form=forms(technicianPenaltyCarePanel(f.s,manager,f.c),'penalty.warning-record')[0];
    assert.ok(form,'原本店已核实且本人接受后，店长须能登记一般警告');
    const finance=f.staff('store-finance'),before=structuredClone(f.s);
    const fake={...finance,role:'manager',job:'all'};
    assert.equal(forms(technicianPenaltyCarePanel(f.s,fake,f.c),'penalty.warning-record').length,0);
    assert.throws(()=>send(f,form,{reference:'BAD-ACTOR',occurredAt:NOW,reason:'伪装不能替代原工作岗位'},fake),/无权|岗位/);
    assert.deepEqual(f.s,before);
    send(f,form,{reference:'DEMO-MANAGER-'+job,occurredAt:NOW,reason:'本地合成一般沟通问题实际警告'},manager);
    assert.equal(f.row.decision.by.role,'manager');assert.equal(f.row.decision.by.id,'s1');assert.equal(f.row.decision.by.job,null);
    f.care('care.case-close',{id:f.c.id,version:f.c.version,conclusion:'原专项实际警告已入档'},manager);
    f.appeal();f.review();
    assert.equal(f.c.status,'closed');assert.equal(f.current().status,'maintained');
    assert.deepEqual(f.s.bookings,before.bookings);assert.deepEqual(f.s.techs,before.techs);
  }
});
test('本人实际一次申诉表单到集团实际维持/撤回表单贯通四种状态', () => {
  for (const decision of ['maintain', 'revoke']) {
    const f = fixture(); f.warning(); const appeal = forms(page(f, tech, f.row.id), 'penalty.appeal')[0]; assert.equal(appeal.payload.id, f.row.id); assert.equal(appeal.payload.version, 1); assert.equal(forms(page(f, store, f.row.id), 'penalty.appeal').length, 0);
    send(f, appeal, { reason: '本人实际申诉请求' }, tech); assert.match(page(f, tech, f.row.id), /本人申诉待集团复核/); assert.equal(forms(page(f, tech, f.row.id), 'penalty.appeal').length, 0);
    const review = forms(page(f, support, f.row.id), 'penalty.appeal-review')[0]; assert.equal(review.payload.version, 2); assert.match(review.body, /value="" selected>请选择实际复核决定/); assert.equal(forms(page(f, store, f.row.id), 'penalty.appeal-review').length, 0);
    const select=/\u003cselect\b[^>]*name="decision"[^>]*>([\s\S]*?)<\/select>/.exec(review.body)?.[1]||'';
    const available=[...select.matchAll(/\u003coption\b[^>]*value="([^"]*)"[^>]*>/g)].map(match=>decode(match[1]));
    assert.ok(available.includes(decision),`实际复核控件必须提供${decision}，不能在测试中替缺失选项补载荷`);
    send(f, review, { decision, reference: 'UI-REVIEW-1', occurredAt: '2026-10-04T10:00', reason: '真实集团复核理由', internalNote: 'SECRET-UI-REVIEW' }, support);
    assert.match(page(f, tech, f.row.id), decision === 'maintain' ? /集团已维持警告/ : /集团已撤回警告/); assert.equal(forms(page(f, support, f.row.id), 'penalty.appeal-review').length, 0); assert.equal(f.row.decision.reference, 'WARN-ORIGINAL-1');
  }
});
test('技师页面只读公开原事实和本人出口，不露内部调查/备注及原客户正文', () => {
  const f = fixture(); f.warning(); f.appeal(); f.review(); const html = page(f, tech, f.row.id);
  assert.match(html, /WARN-ORIGINAL-1|REVIEW-ORIGINAL-1|本人申诉事实/); assert.doesNotMatch(html, /SECRET|CLIENT-PRIVATE|sourceFingerprint/); assert.match(page(f, store, f.row.id), /SECRET-INTERNAL-DECISION|SECRET-INTERNAL-REVIEW/);
  assert.match(html, /role="status"/); assert.doesNotMatch(html, /role="button"/); assert.match(html, /待正式标准和专项办理/);
});
test('旧表单真实拒绝，刷新原候选恢复稳定草稿key和最新case版本', () => {
  const f = fixture(), form = forms(page(f), 'penalty.warning-record')[0]; f.care('care.case-statement', { id: f.c.id, version: f.c.version, text: '追加本人说明' }, user);
  const before = JSON.stringify(f.s); assert.throws(() => send(f, form, { reference: 'R', occurredAt: NOW, reason: '旧表单' }, store), /版本/); assert.equal(JSON.stringify(f.s), before);
  const fresh = forms(page(f), 'penalty.warning-record')[0]; assert.equal(fresh.key, form.key); assert.equal(fresh.payload.caseVersion, f.c.version); assert.notEqual(fresh.payload.sourceToken, form.payload.sourceToken);
});
test('坏源只能显示待核对且拒绝操作；失效会话连旧详情也无权读取', () => {
  const f = fixture(); f.warning(); f.c.description = '原事实被替换'; const html = page(f, tech, f.row.id); assert.match(html, /原决定来源待核对/); assert.equal(forms(html, 'penalty.appeal').length, 0); assert.doesNotMatch(html, /WARN-ORIGINAL-1|SECRET/);
  const g = fixture(), employee = g.staff(); g.warning({}, employee); g.s.staffSessions.find(x => x.id === employee.sessionId).revokedAt = NOW; assert.match(page(g, employee, g.row.id), /无权|失效/); assert.equal(technicianPenaltyCarePanel(g.s, employee, g.c), '');
});
