import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce, upgradeFinanceState } from './engine.mjs';
import { serviceFinanceSummary } from './service-finance.mjs';
import { serviceFinanceComposition } from './service-finance-composition.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';
import { prepareServiceExtraEvidence } from './service-extra-file-validation.mjs';
import { serviceExtraSourceToken } from './service-finance-extras.mjs';
import { financeView } from './finance-ui.mjs';

const DAY = 86400000, finance = { role: 'group', job: 'finance' }, support = { role: 'group', job: 'support' }, manager = { role: 'store', job: 'store-manager', storeId: 'xingfu' };
const buyer = { role: 'user', userId: 'u1' }, person = { role: 'user', userId: 'u2' }, tech = { role: 'tech', techId: 'lin' };
const bytes = new TextEncoder().encode('%PDF-1.4\nActual local bytes for composition integration\n%%EOF'), blob = new Blob([bytes], { type: 'application/pdf' });
const file = { ref: 'invoice-file:' + createHash('sha256').update(bytes).digest('hex'), name: '现金组成原依据.pdf', type: blob.type, size: blob.size };
function harness() {
  let state = seed(), sequence = 0;
  const h = { get s() { return state; }, b: id => state.bookings.find(b => b.id === id), e: id => state.serviceFinanceEntries.find(e => e.bookingId === id), v: id => serviceFinanceSummary(state, id, h.b(id).payment.id),
    proof: (reference = 'ACTUAL-' + ++sequence) => ({ reference, occurredAt: state.now, file, reason: '实际Blob与原号核对的合成验收依据' }),
    async run(type, p = {}, actor = finance) {
      const row = ['servicePromoters', 'servicePromotionInvites', 'serviceFinanceEntries', 'serviceFinanceRecoveries','serviceRefundShortages','serviceExtraRecoveries','serviceExtraOffsets'].flatMap(k => state[k] || []).find(x => x.id === (p.id || p.promoterId));
      const payload = { requestId: 'COMPOSITION-' + ++sequence, version: row?.version || 0, ...p };
      const readFile=async metadata=>{assert.equal(metadata.ref,file.ref);return blob;},promotion=await prepareServicePromotionEvidence(state,actor,type,payload,{readFile}),extra=await prepareServiceExtraEvidence(state,actor,type,payload,{readFile}),runtime={evidenceRefs:[...promotion.evidenceRefs,...extra.evidenceRefs]};
      state = reduce(state, actor, type, payload, () => {}, runtime); return state;
    },
    async advance(minutes) { while (minutes) { const step = Math.min(minutes, 44640); await h.run('clock.advance', { minutes: step }); minutes -= step; } },
    async setup({ hBps = 500 } = {}) {
      await h.run('finance.rule-publish', { scope: 'global', groupBps: 1000, storeBps: hBps, effectiveAt: state.now, version: 0, reason: '显式原H测试配置' });
      await h.run('service-promotion.agreement-publish', { promoterType: 'store-promoter', title: '原邀请测试协议', body: '本人核实原协议，仅验证本地命令和真实文件读取。', effectiveAt: state.now, ...h.proof() }, support);
      await h.run('service-promotion.invite', { userId: 'u2', promoterType: 'store-promoter', expiresAt: state.now + DAY, reason: '本店本人原邀请' }, manager);
      const invite = state.servicePromotionInvites.at(-1);
      await h.run('service-promotion.invite-confirm', { id: invite.id, decision: 'accept', agreementAccepted: true, agreementId: invite.agreementSnapshot.id, reason: '本人确认原协议' }, person);
      await h.run('service-promotion.identity-review', { id: state.servicePromoters.find(r => r.personKind === 'user' && r.personId === 'u2').id, decision: 'verified', ...h.proof() }, support);
      await h.run('service-promotion.rule-publish', { promoterType: 'store-promoter', firstBps: 2000, repeatBps: 1000, storeCostBps: 5000, csRounding: 'floor', concurrency: 'completed-created-id', lateFullRefund: 'reassign', effectiveAt: state.now, version: 0, basis: '显式测试佣金，不作为正式审批' });
      const promoter = state.servicePromoters.find(r => r.personKind === 'user' && r.personId === 'u2');
      await h.run('service-promotion.enter', { promoterId: promoter.id, version: state.users.find(u => u.id === 'u1').serviceBinding.version }, buyer);
    },
    async create() {
      await h.run('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', startAt: Math.ceil((state.now + 4 * 3600000) / 1800000) * 1800000, mode: 'specified', genderPreference: 'any', contactName: '本地合成顾客', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true }, buyer);
      const id = state.bookings.at(-1).id; await h.run('booking.pay', { id, outcome: 'success' }, buyer); await h.run('booking.accept', { id }, tech); return id;
    },
    async complete(id) { await h.advance(Math.max(0,Math.ceil((h.b(id).startAt - state.now) / 60000))); await h.run('booking.start', { id }, tech); await h.advance(h.b(id).duration); await h.run('booking.finish', { id, mode: 'normal' }, tech); await h.advance(2881); },
    async refund(id, amountCents) { await h.run('booking.special-aftersale', { id, requests: [{ paymentId: h.b(id).payment.id, amountCents }], reason: '原客服特批真实售后' }, support); const refund = h.b(id).refunds.at(-1); await h.run('booking.refund-review', { id, refundId: refund.id, decision: 'approve', reason: '原本款金额核准' }, support); await h.run('booking.refund-pay', { id, refundId: refund.id, paymentId: h.b(id).payment.id, outcome: 'success' }); },
    async execute(id, operation = 'split-start', outcome = 'success', extra = {}) { return h.run('finance.' + operation, { id: h.e(id).id, version: h.e(id).version, outcome, ...extra }); }
  }; return h;
}

const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const money=n=>'¥'+(n/100).toFixed(2);
function forms(html){return[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,attrs,body])=>({attrs,body,payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1] || '{}')),command:/data-command="([^"]+)"/.exec(attrs)?.[1]})).filter(x=>x.command==='finance.recovery-receive');}
const detail=(h,id,actor=finance)=>financeView(h.s,actor,['service-finance','entry',h.e(id).id],{query:new URLSearchParams()});
const recoveries=(h,id,actor=finance)=>financeView(h.s,actor,['service-finance','recoveries'],{query:new URLSearchParams('id='+id)});
async function offline(h,{legacy=false}={}){
  await h.setup({hBps:0});const id=await h.create();await h.advance(25*1440);await h.execute(id);await h.execute(id,'finish-start');await h.complete(id);
  const debt=h.s.serviceFinanceRecoveries.find(x=>x.entryId===h.e(id).id&&x.type==='unshared-release');
  for(const reference of ['BANK-SOURCE-A','BANK-SOURCE-B']){await h.run('finance.recovery-receive',{id:debt.id,amountCents:500,...h.proof(reference)});}
  if(legacy)delete h.s.serviceFinanceRecoveries.find(x=>x.id===debt.id).records[0].cashComposition;
  await h.refund(id,h.b(id).payment.amountCents);return{id,debt:h.s.serviceFinanceRecoveries.find(x=>x.id===debt.id),adjustment:h.s.serviceFinanceRecoveries.find(x=>x.entryId===h.e(id).id&&x.type==='offline-adjustment')};
}

test('原详情消费真实成功H/Cs及纯Cs补差，H金额不由当前集团gross推算',async()=>{
  const h=harness();await h.setup();const first=await h.create();await h.complete(first);const second=await h.create();await h.complete(second);await h.execute(second);const original=structuredClone(h.e(second).split);
  await h.refund(first,h.b(first).payment.amountCents);await h.execute(second);assert.equal(h.e(second).split.cashComposition.hCents,0);const projection=serviceFinanceComposition(h.s,h.e(second).id),before=structuredClone(h.s),html=detail(h,second);
  assert.equal(projection.hReceivedCents,original.cashComposition.hCents);assert.match(html,new RegExp('实际平台费H已收</span><span>'+money(original.cashComposition.hCents).replace('.','\\.')));assert.match(html,/实际正常现金H \/ Cs组成/);assert.match(html,new RegExp(h.e(second).split.requestNo));assert.match(html,new RegExp(original.requestNo));assert.match(html,/实际发生时间/);assert.deepEqual(h.s,before);
});

test('原未知查询与旧成功缺组成在详情保留待核金额和原源原因，不补零H',async()=>{
  const h=harness();await h.setup();const id=await h.create();await h.complete(id);await h.execute(id,'split-start','processing');const tx=h.e(id).split,html=detail(h,id);assert.match(html,/实际平台费H净额<\/span><span>待核对/);assert.match(html,/原现金结果未知/);assert.match(html,new RegExp('待核原现金来源</span><span>split:'+tx.id));
  await h.execute(id,'split-query','success',{transactionId:tx.id});delete h.e(id).split.cashComposition;delete h.e(id).split.cashCompositionRequest;const before=structuredClone(h.s),legacy=detail(h,id);assert.match(legacy,/本原现金尚无已核H\/Cs组成/);assert.match(legacy,/完整实际H\/Cs金额仍待核对/);assert.doesNotMatch(legacy,/实际平台费H净额<\/span><span>¥0\.00/);assert.deepEqual(h.s,before);
});

test('原部分混合回退明确展示待核原因，已核原收入不被描述为完整净额',async()=>{
  const h=harness();await h.setup();const id=await h.create();await h.complete(id);await h.execute(id);const split=h.e(id).split;await h.refund(id,h.b(id).payment.amountCents/2);await h.execute(id,'return-start','success',{splitId:split.id,splitRequestNo:split.requestNo,amountCents:500});
  const html=detail(h,id);assert.equal(h.e(id).returns[0].cashComposition.status,'needs-review');assert.match(html,/本次部分混合回退有多种H\/Cs分配/);assert.match(html,/下表只列已核成功原现金/);assert.match(html,/实际推广款Cs净额<\/span><span>待核对/);
});

test('原整笔回退结果未知时只展示原H/Cs占额，不报告成功净额',async()=>{
  const h=harness();await h.setup();const id=await h.create();await h.complete(id);await h.execute(id);const split=h.e(id).split;await h.refund(id,h.b(id).payment.amountCents);await h.execute(id,'return-start','processing',{splitId:split.id,splitRequestNo:split.requestNo,amountCents:split.amountCents});const projection=serviceFinanceComposition(h.s,h.e(id).id),before=structuredClone(h.s),html=detail(h,id);
  assert.equal(projection.reservations.length,1);assert.equal(projection.hNetCents,null);assert.match(html,/原未知回退组成占额/);assert.match(html,/H占额/);assert.match(html,/Cs占额/);assert.match(html,/实际平台费H已退<\/span><span>待核对/);assert.match(html,new RegExp(h.e(id).returns[0].id));assert.deepEqual(h.s,before);
});

test('线下退回表单逐原收入固定真实record/ref和余额，提交原命令只消耗本源',async()=>{
  const h=harness(),{id,debt,adjustment}=await offline(h),html=recoveries(h,adjustment.id),all=forms(html),specific=all.filter(x=>x.payload.incomeSourceId);assert.equal(specific.length,2);assert.equal(all.length,3);
  for(const form of specific){const record=debt.records.find(x=>`recovery:${debt.id}:${x.id}`===form.payload.incomeSourceId);assert.ok(record);assert.equal(form.payload.incomeRequestNo,record.reference);assert.notEqual(form.payload.incomeRequestNo,record.requestId);assert.equal(form.payload.version,adjustment.version);assert.match(form.body,/max="5"/);assert.match(form.body,/name="occurredAt" value="" required step="0.001"/);assert.match(form.body,/type="file" data-invoice-upload/);assert.equal(form.payload.requestId,undefined);}
  const selected=specific.find(x=>x.payload.incomeRequestNo==='BANK-SOURCE-B');await h.run(selected.command,{...selected.payload,amountCents:500,...h.proof('ACTUAL-RETURN-B')});const record=h.s.serviceFinanceRecoveries.find(x=>x.id===adjustment.id).records[0];assert.equal(record.incomeSourceId,selected.payload.incomeSourceId);assert.equal(record.incomeRequestNo,'BANK-SOURCE-B');assert.equal(record.cashComposition.csCents,500);assert.equal(record.cashComposition.hCents,0);
  const now=forms(recoveries(h,adjustment.id)).filter(x=>x.payload.incomeSourceId);assert.equal(now.length,1);assert.equal(now[0].payload.incomeRequestNo,'BANK-SOURCE-A');const before=structuredClone(h.s);await assert.rejects(()=>h.run(selected.command,{...selected.payload,amountCents:500,...h.proof('STALE-RETURN-B')}),/版本|变化/);assert.deepEqual(h.s,before);assert.match(detail(h,id),/原现金 \/ 实际凭据/);
});

test('缺原收入的实际退回入口明确标记待核，原record/详情显示原因与待核H/Cs',async()=>{
  const h=harness(),{id,adjustment}=await offline(h),html=recoveries(h,adjustment.id),fallback=forms(html).find(x=>!x.payload.incomeSourceId);assert.ok(fallback);assert.match(html,/现金组成将保持待核对/);assert.match(fallback.body,/>登记实际退回并标记待核<\/button>/);assert.match(fallback.attrs,/缺原收入来源/);
  await h.run(fallback.command,{...fallback.payload,amountCents:500,...h.proof('ACTUAL-UNSOURCED-RETURN')});const record=h.s.serviceFinanceRecoveries.find(x=>x.id===adjustment.id).records[0];assert.equal(record.amountCents,500);assert.equal(record.cashComposition.status,'needs-review');const history=recoveries(h,adjustment.id);assert.match(history,/本次退回必须锁定精确已核原收入及组成余额/);assert.match(history,/本笔实际平台费H<\/span><span>待核对/);assert.match(detail(h,id),/实际推广款Cs净额<\/span><span>待核对/);
});

test('旧原收入缺组成不进入已核来源选择，也不默认选第一笔',async()=>{
  const h=harness(),{adjustment}=await offline(h,{legacy:true}),html=recoveries(h,adjustment.id),specific=forms(html).filter(x=>x.payload.incomeSourceId);assert.equal(specific.length,1);assert.equal(specific[0].payload.incomeRequestNo,'BANK-SOURCE-B');assert.match(html,/本款现金组成待核对/);assert.equal(forms(html).filter(x=>!x.payload.incomeSourceId).length,1);assert.doesNotMatch(specific[0].body,/selected|type="hidden" name="incomeSource/);
});

test('C04真实原组合正常现金与本金分列，纯本金无H/Cs正常记录',async()=>{
  for(const normalRate of [1000,0]){
    const h=harness(),store={role:'store',job:'store-finance',storeId:'xingfu'};await h.run('finance.rule-publish',{scope:'global',groupBps:normalRate,storeBps:500,effectiveAt:h.s.now,version:0,reason:'本地明确正常比例'});const original=await h.create();await h.run('booking.cancel',{id:original,reason:'本地原退款'},buyer);await h.run('booking.refund-pay',{id:original,refundId:h.b(original).refunds[0].id,outcome:'failed'});
    const part=h.b(original).refunds[0].executions[0];await h.run('service-extra.refund-shortage',{bookingId:original,paymentId:h.b(original).payment.id,refundId:h.b(original).refunds[0].id,shortageCents:10000,failedAt:part.updatedAt,sourceToken:serviceExtraSourceToken(h.s,original,h.b(original).payment.id),...h.proof(part.refundNo)},store);await h.advance(1440);await h.run('service-extra.policy-publish',{path:'merchant-balance',effectiveAt:h.s.now,basis:'明确本地验证路径，非正式政策'});const issue=h.s.serviceRefundShortages.at(-1),policy=h.s.serviceExtraPolicies.at(-1);await h.run('service-extra.advance-decision',{id:issue.id,decision:'approve',path:'merchant-balance',policyId:policy.id,amountCents:10000,reason:'本地逐案决定'});await h.run('service-extra.advance-pay',{id:issue.id,advanceId:h.s.serviceRefundShortages.at(-1).advances[0].id,outcome:'success',...h.proof()});
    const next=await h.create();await h.complete(next);const entry=h.e(next),debt=h.s.serviceExtraRecoveries.at(-1);await h.run('service-extra.offset-propose',{entryId:entry.id,recoveryId:debt.id,amountCents:2000,sourceToken:serviceExtraSourceToken(h.s,next,entry.paymentId),reason:'原同店本金追收'});const plan=h.s.serviceExtraOffsets.at(-1);await h.run('service-extra.offset-confirm',{id:plan.id,decision:'accept',reason:'本店确认正常和本金'},store);await h.run('service-extra.offset-pay',{id:plan.id,outcome:'processing'});await h.run('service-extra.offset-query',{id:plan.id,outcome:'success'});
    const before=structuredClone(h.s),html=detail(h,next),projection=serviceFinanceComposition(h.s,entry.id);assert.match(html,/C04额外追收本金/);assert.match(html,/本金金额/);assert.match(html,/¥20\.00/);assert.match(html,/正常H\/Cs组成单独核对/);assert.equal(projection.principalRows[0].amountCents,2000);assert.equal(projection.hReceivedCents,normalRate?2980:0);if(!normalRate){assert.equal(projection.rows.length,0);assert.match(html,/实际正常现金组成<\/span><span>已核清/);assert.doesNotMatch(html,/现金组成待核对/);}assert.deepEqual(h.s,before);
  }
});

test('新增组成反馈沿静态notice且转义，原可见岗位/跨店边界和纯读取保留',async()=>{
  const h=harness(),{id,adjustment}=await offline(h);const fallback=forms(recoveries(h,adjustment.id)).find(x=>!x.payload.incomeSourceId);await h.run(fallback.command,{...fallback.payload,amountCents:500,...h.proof('UNSOURCED-FOR-SEMANTICS')});h.s.serviceFinanceRecoveries.find(x=>x.id===adjustment.id).records[0].cashComposition.reason='<script>source-gap</script>';const before=structuredClone(h.s),html=recoveries(h,adjustment.id);assert.match(html,/&lt;script&gt;source-gap/);assert.doesNotMatch(html,/<script>/);for(const [,attrs] of html.matchAll(/<p\b([^>]*class="notice[^>]*)>/g)){assert.match(attrs,/role="status"/);assert.doesNotMatch(attrs,/role="button"|data-command|tabindex/);}for(const actor of [{role:'manager',storeId:'xingfu'},tech,{role:'store',storeId:'silver'},support]){assert.doesNotMatch(detail(h,id,actor),/实际正常现金H \/ Cs组成|incomeSourceId/);assert.equal(forms(recoveries(h,adjustment.id,actor)).length,0);}assert.deepEqual(h.s,before);
});
