// Controlled C04 adapters into original refund aggregation and service split facts.
import { bookingCommand } from './booking.mjs';
import { serviceFinanceSummary } from './service-finance.mjs';
import { bindServiceFinanceComposition } from './service-finance-composition.mjs';
import { resolveAccountActor, actorAccountFields } from './staff-accounts.mjs';
const copy=x=>structuredClone(x),finance=a=>a?.role==='group'&&['finance','all'].includes(a.job);
function fail(ctx,message){ctx.fail?.(message);throw new Error(message);}
function required(v,label,ctx){if(typeof v!=='string'||!v.trim())fail(ctx,`缺少${label}`);return v.trim();}
function money(v,label,ctx,min=0){if(!Number.isSafeInteger(v)||v<min)fail(ctx,`${label}无效`);return v;}
function writer(s,actor,ctx){actor=resolveAccountActor(s,actor);if(!finance(actor))fail(ctx,'仅集团财务可以写入实际服务资金桥');return actor;}
const by=a=>({role:a.role,job:a.job,...actorAccountFields(a)});
export function applyServiceDirectRefund(s,p,actor,ctx={}){
  actor=writer(s,actor,ctx);const b=(s.bookings||[]).find(b=>b.id===p.bookingId),r=b?.refunds?.find(r=>r.id===p.refundId),part=r?.executions?.find(x=>x.paymentId===p.paymentId),pay=[b?.payment,...(b?.extensions||[])].find(x=>x?.id===p.paymentId),issue=(s.serviceRefundShortages||[]).find(x=>x.bookingId===p.bookingId&&x.refundId===p.refundId&&x.paymentId===p.paymentId&&x.refundNo===p.refundNo),advance=issue?.advances?.find(a=>a.id===p.advanceId);
  if(!b||!r||!part||!pay||!issue||!advance||advance.path!=='direct-user'||advance.status!=='succeeded'||advance.execution?.status!=='success'||advance.userDecision?.decision!=='accept'||advance.userDecision.userId!==b.userId)fail(ctx,'实际直接退款缺少原本人确认方案来源');
  const amount=money(p.amountCents,'实际直接退款金额',ctx,1);if(part.refundNo!==required(p.refundNo,'原退款技术号',ctx)||part.amountCents!==amount||issue.refundCents!==amount||advance.amountCents!==amount||pay.status!=='success'||!Number.isSafeInteger(pay.refundedCents)||pay.refundedCents+amount>pay.amountCents)fail(ctx,'实际直接退款金额或原执行不一致');
  if(part.status!=='failed'||(b.refunds||[]).some(x=>x.executions?.some(e=>e.status==='processing')||x.status==='processing'&&!x.executions?.length))fail(ctx,'原退款须明确失败且无未知结果，不重复付款');
  required(p.reference,'实际转账凭证号',ctx);if(!Number.isSafeInteger(p.occurredAt)||p.occurredAt<advance.createdAt||p.occurredAt>s.now||!Array.isArray(p.evidenceRefs)||!p.evidenceRefs.length||ctx.validateEvidenceRefs?.(p.evidenceRefs)!==true)fail(ctx,'实际直接退款须有已核验附件及真实时间');
  const facts=advance.execution.proof;if(facts?.reference!==p.reference||facts.occurredAt!==p.occurredAt||JSON.stringify(facts.evidenceRefs)!==JSON.stringify(p.evidenceRefs))fail(ctx,'实际资金凭证与原垫付款结果不一致');
  const originalRefundNo=part.refundNo,before=pay.refundedCents;
  bookingCommand(s,actor,'booking.refund-pay',{id:b.id,refundId:r.id,paymentId:pay.id,outcome:'success'}, {...ctx,log:(entity,message)=>ctx.log?.(entity,message.startsWith('模拟原路退款')?'核实本款直接垫付实际成功，结清原退款执行':message)});
  if(pay.refundedCents!==before+amount||part.status!=='success'||part.refundNo!==originalRefundNo)fail(ctx,'原退款聚合未精确结清本款');
  part.completedAt=p.occurredAt;part.directAdvanceId=advance.id;part.paymentPath='direct-user';part.actualFundReference=p.reference;
  Object.assign(part.results.at(-1),{operation:'direct-user-verified',occurredAt:p.occurredAt,advanceId:advance.id,reference:p.reference});
  (r.offlinePaymentFacts??=[]).push({advanceId:advance.id,paymentId:pay.id,refundNo:originalRefundNo,amountCents:amount,reference:p.reference,evidenceRefs:copy(p.evidenceRefs),occurredAt:p.occurredAt,recordedAt:s.now,by:by(actor)});
  if(r.status==='success')r.completedAt=Math.max(...r.executions.map(x=>x.completedAt||p.occurredAt));
  return r;
}
export function applyServiceRecoverySplit(s,p,actor,ctx={}){
  actor=writer(s,actor,ctx);const e=(s.serviceFinanceEntries||[]).find(e=>e.id===p.entryId),plan=(s.serviceExtraOffsets||[]).find(x=>x.id===p.planId),debt=(s.serviceExtraRecoveries||[]).find(x=>x.id===plan?.recoveryId),b=e&&(s.bookings||[]).find(b=>b.id===e.bookingId);
  if(!e||!b||!plan||plan.entryId!==e.id||plan.storeId!==e.storeId||!debt||debt.storeId!==e.storeId||debt.payer!==`store:${e.storeId}`||debt.payee!=='group'||!plan.execution)fail(ctx,'组合分账缺少原服务及同店实际债务');
  const normal=money(p.normalCents,'原正常分账份额',ctx),extra=money(p.recoveryCents,'追加追收份额',ctx,1),total=money(p.totalCents,'实际组合分账总额',ctx,1),tx=plan.execution;
  if(normal+extra!==total||normal!==plan.normalCents||extra!==plan.recoveryCents||tx.normalCents!==normal||tx.recoveryCents!==extra||tx.totalCents!==total||p.transactionId!==tx.id||p.requestNo!==tx.requestNo||p.status!==tx.status||p.attempts!==tx.attempts||!['processing','failed','success'].includes(p.status))fail(ctx,'组合分账必须引用原固定执行及金额');
  required(p.transactionId,'原组合交易号',ctx);required(p.requestNo,'原渠道请求号',ctx);money(p.attempts,'原尝试次数',ctx,1);
  const old=e.split;if(old?.status==='success'){if(old.serviceExtraPlanId===plan.id&&old.id===p.transactionId&&old.requestNo===p.requestNo&&old.amountCents===normal&&old.channelTotalCents===total&&p.status==='success')return old;fail(ctx,'原服务已成功分账，不能重复写入组合款');}
  if(old?.status==='processing'&&old.serviceExtraPlanId!==plan.id)fail(ctx,'原服务分账结果未知，不能替换');
  if(old?.serviceExtraPlanId===plan.id&&(old.id!==p.transactionId||old.requestNo!==p.requestNo||old.amountCents!==normal||old.channelTotalCents!==total))fail(ctx,'同一方案的原技术号和金额不能改变');
  // Beginning a new plan consumes only the original summary's eligibility and normal target.
  if(!old||old.serviceExtraPlanId!==plan.id){const v=serviceFinanceSummary(s,e.bookingId,e.paymentId),cap=v&&Number(BigInt(v.netCents-v.heldConfirmedCents)*3n/10n);if(!v?.canManualSplit||v.splitPaidCents||normal!==v.splitTargetCents||total>cap||extra>debt.amountCents-debt.receivedCents||b.createdAt<debt.createdAt)fail(ctx,'原服务正常份额或30%追收边界已变化');if(old){if(old.status!=='failed')fail(ctx,'已有原服务执行不允许替换');(e.splitHistory??=[]).push({...copy(old),supersededAt:s.now,reason:'明确失败后核对新组合分账方案，旧执行保留'});}}
  if(p.status==='success'&&(!Number.isSafeInteger(p.completedAt)||p.completedAt>s.now||p.completedAt<plan.createdAt))fail(ctx,'组合款成功时间无效');
  e.split={id:p.transactionId,requestNo:p.requestNo,kind:'split',amountCents:normal,channelTotalCents:total,recoveryCents:extra,serviceExtraPlanId:plan.id,status:p.status,attempts:p.attempts,results:copy(p.results||[]),createdAt:old?.serviceExtraPlanId===plan.id?old.createdAt:s.now,updatedAt:s.now,...(p.status==='failed'?{nextRetryAt:tx.nextRetryAt}:{}),...(p.status==='success'?{completedAt:p.completedAt}:{})};
  const cashRequest=old?.serviceExtraPlanId===plan.id?old.cashCompositionRequest:plan.cashCompositionRequest;
  if(normal>0&&cashRequest){const bound=bindServiceFinanceComposition(s,e.id,cashRequest,`split:${e.split.id}`);e.split.cashCompositionRequest=cashRequest.source?copy(cashRequest):bound;if(!plan.cashCompositionRequest?.source)plan.cashCompositionRequest=copy(e.split.cashCompositionRequest);if(p.status==='success')e.split.cashComposition=bound;}
  e.version++;(e.history??=[]).push({at:s.now,action:'原组合分账结果：正常分成与偿债额分别保留',actor:by(actor),version:e.version,planId:plan.id,transactionNo:p.requestNo,amountCents:normal,recoveryCents:extra,channelTotalCents:total,outcome:p.status});ctx.log?.(e,`原组合分账${p.status}，正常份额${normal}分，实际追加${extra}分`);return e.split;
}
export function createServiceFinanceExtrasBridges(ctx={}){return{applyDirectRefund:(s,p,actor)=>applyServiceDirectRefund(s,p,actor,ctx),applyRecoverySplit:(s,p,actor)=>applyServiceRecoverySplit(s,p,actor,ctx)};}
