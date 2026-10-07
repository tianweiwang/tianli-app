// Ordinary service-money task metadata. All financial calculations and command
// eligibility remain in the original finance, extras and composition domains.
import { serviceFinanceView } from './service-finance.mjs';
import { assertServiceFinanceExtrasCommand } from './service-finance-extras.mjs';
import { serviceFinanceComposition, serviceFinanceCompositionToken, serviceFinanceCompositionFingerprint as hash } from './service-finance-composition.mjs';
import { serviceFinanceCompositionReview } from './service-finance-composition-review.mjs';
import { ordinaryServiceFinanceSource as originalSource } from './service-finance-source.mjs';

const finance={role:'group',job:'finance'};
const rows=(s,key)=>Array.isArray(s[key])?s[key]:[];
const id=value=>typeof value==='string'&&Boolean(value.trim());
const unique=(list,key)=>{const found=list.filter(row=>row?.id===key);return id(key)&&found.length===1?found[0]:null;};
const money=value=>Number.isSafeInteger(value)&&value>=0;
const actualTime=(s,value)=>Number.isSafeInteger(value)&&value>=0&&value<=s.now;

export function serviceFinanceTaskBinding(s,entryId,{recoveryId}={}){
  const source=originalSource(s,entryId);if(!source)return null;
  const {entry,booking,payment,consistent}=source;
  if(recoveryId!=null){const recovery=unique(rows(s,'serviceFinanceRecoveries'),recoveryId);
    if(!recovery||recovery.entryId!==entry.id||recovery.bookingId!==booking.id||recovery.paymentId!==payment.id||recovery.storeId!==entry.storeId)return null;
  }
  return{entryId:entry.id,bookingId:booking.id,paymentId:payment.id,storeId:entry.storeId,recoveryId:recoveryId??null,
    consistent,reason:consistent?'':'原下单来源或规则快照待核对'};
}

function originalCommand(s,entry,command){
  try{assertServiceFinanceExtrasCommand(s,finance,command,{id:entry.id});return true;}catch{return false;}
}
function entryCommands(s,v,source,composition){
  const queries=[...(v.canQuerySplit?['finance.split-query']:[]),...(v.canQueryFinish?['finance.finish-query']:[]),
    ...((v.returns||[]).some(tx=>tx.canQuery)?['finance.return-query']:[])];
  if(queries.length)return queries.filter(command=>originalCommand(s,v,command));
  if(!source.consistent)return[];
  if(v.unknownRefund||v.unknownChannel||v.unknownPersonalTransfer)return[];
  const commands=v.known?[
    ...(v.canSplit||v.canManualSplit?['finance.split-start']:[]),
    ...(v.canFinish||v.canManualFinish?['finance.finish-start']:[]),
    ...(v.canReturn||v.canManualReturn?['finance.return-start']:[])
  ]:[];
  if(!composition.known)for(const key of composition.unresolvedSourceIds){
    const review=serviceFinanceCompositionReview(s,finance,v.id,key);
    if(review.canConfirm)commands.push('finance.composition-confirm');
    if(review.canReconcile)commands.push('finance.composition-reconcile');
  }
  return[...new Set(commands)].filter(command=>originalCommand(s,v,command));
}
function token(s,source,v,composition){
  const evidenceIds=new Set((source.entry.historicalEvidence||[]).map(row=>row.id).filter(id));
  return hash({entry:source.entry,booking:source.booking,payment:source.payment,consistent:source.consistent,
    projection:v,composition:serviceFinanceCompositionToken(s,v.id),compositionKnown:composition.known,
    historicalEvidence:rows(s,'serviceExtraEvidence').filter(row=>evidenceIds.has(row.id)),
    offsets:rows(s,'serviceExtraOffsets').filter(row=>row.entryId===v.id)});
}
function task(row,kind,status,commands,sourceToken,label){
  return{id:`service-finance:${kind}:${row.id}`,category:`service-finance-${kind}`,sourceId:row.id,
    entryId:kind==='entry'?row.id:row.entryId,...(kind==='recovery'?{recoveryId:row.id}:{}),
    bookingId:row.bookingId,paymentId:row.paymentId,storeId:row.storeId,
    title:kind==='entry'?'普通服务原款分账与现金核对':'普通服务原门店资金差额',status,sourceStatus:row.status,
    statusLabel:label,createdAt:row.createdAt,dueAt:kind==='entry'?row.alertAt??null:row.dueAt??null,
    commands,requiredRoute:'service-finance',assignmentMode:'task',manageRoles:commands.length?['group']:[],
    allowedJobs:{group:['finance'],store:[]},routes:{group:kind==='entry'?`/group/service-finance/entry/${row.id}`:'/group/service-finance/recoveries'},sourceToken};
}
function recoveryFactsValid(s,debt,v){
  if(!['unshared-release','return-failed','offline-adjustment'].includes(debt.type)||!money(debt.amountCents)||!money(debt.receivedCents)||debt.receivedCents>debt.amountCents||!actualTime(s,debt.createdAt))return false;
  if(debt.payer!==(debt.type==='unshared-release'?`store:${v.storeId}`:'group')||debt.payee!==(debt.type==='unshared-release'?'group':`store:${v.storeId}`))return false;
  const receipts=debt.records||[];
  if(!Array.isArray(receipts)||receipts.some(r=>!id(r.id)||!id(r.reference)||!money(r.amountCents)||!actualTime(s,r.occurredAt??r.at)||(r.occurredAt??r.at)<debt.createdAt)||
    new Set(receipts.map(r=>r.id)).size!==receipts.length||receipts.reduce((sum,r)=>sum+r.amountCents,0)!==debt.receivedCents)return false;
  if(debt.type==='unshared-release'&&!v.successfulFinish)return false;
  return true;
}

export function serviceFinanceTaskRows(s){
  if(!rows(s,'serviceFinanceEntries').length)return[];
  const view=serviceFinanceView(s,finance),result=[],entries=new Map();
  for(const v of view.entries){
    const source=originalSource(s,v.id);if(!source)continue;
    const composition=serviceFinanceComposition(s,v.id),commands=entryCommands(s,v,source,composition);
    const done=source.consistent&&v.known&&composition.known&&!v.unknownChannel&&!v.unknownRefund&&!v.unknownPersonalTransfer&&(v.canPayTech||v.status==='void');
    const entryToken=token(s,source,v,composition);entries.set(v.id,{v,source,composition,entryToken});
    const label=!source.consistent?'原下单来源或规则快照待核对':!v.known?'原归属、规则或资金依据待核对':v.unknownRefund?'退款结果待查询':v.unknownChannel?'原渠道结果待查询':!composition.known?'原现金组成待核对':v.statusLabel;
    result.push(task({...v,status:source.consistent?v.status:'needs-review'},'entry',done?'done':commands.length?'open':'waiting',commands,entryToken,label));
  }
  for(const debt of view.recoveries){
    const context=entries.get(debt.entryId);if(!context||!serviceFinanceTaskBinding(s,debt.entryId,{recoveryId:debt.id}))continue;
    const {v,source,composition,entryToken}=context,valid=source.consistent&&recoveryFactsValid(s,debt,v);
    const unknown=!v.known||v.unknownChannel||v.unknownRefund||v.unknownPersonalTransfer;
    const done=valid&&!unknown&&composition.known&&debt.status==='closed'&&debt.amountCents===debt.receivedCents;
    const difference=debt.type==='unshared-release'?v.pendingAdditionalCents>0:debt.type==='offline-adjustment'?v.pendingOfflineReturnCents>0:v.pendingReturnCents>0&&(v.returnSources||[]).some(row=>row.remainingCents>0);
    const actionable=valid&&!unknown&&debt.status==='open'&&debt.amountCents>debt.receivedCents&&difference;
    const commands=actionable?['finance.recovery-receive']:[];
    result.push(task({...debt,status:valid?debt.status:'needs-review'},'recovery',done?'done':commands.length?'open':'waiting',commands,
      hash({entryToken,debt,valid,compositionKnown:composition.known}),!valid?'原资金差额事实待核对':unknown?'等待原资金结果核定':done?'原资金差额已实际结清':!composition.known?'原已收现金组成待核对':'待登记原资金差额实际收付'));
  }
  return result;
}
