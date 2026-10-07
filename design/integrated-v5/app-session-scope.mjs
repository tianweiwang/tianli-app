// Original app producers only. Stored hints contain identifiers and digests;
// they never carry form bodies or substitute for current domain ownership.
import {resolveAccountActor,assertAccountCommand} from './staff-accounts.mjs';
import {assertJob} from './management.mjs';
import {assertPrivacyCommand,privacyData,privacyProfile,privacyUseClosed} from './privacy.mjs';
import {assertClosedRightsDraft} from './privacy-closed-rights.mjs';
import {privacyUploadScope} from './privacy-upload-scope.mjs';
import {serviceFinanceExtrasView} from './service-finance-extras.mjs';
import {serviceFinanceTaskBinding} from './service-finance-tasks.mjs';
import {servicePromotionView} from './service-promotion.mjs';
import {recipientView,handoffView} from './service-handoff.mjs';
import {technicianPenaltyView} from './technician-penalties.mjs';
import {qualityPolicyView} from './quality-policy.mjs';
import {workTaskView} from './work-tasks.mjs';
import {workEscalationView} from './work-escalation.mjs';
import {createTaskReturnContext,taskReturnTarget} from './task-navigation.mjs';
import {lifecycleFingerprint as hash} from './organization-lifecycle-projection.mjs';

const fail=()=>{throw Error('原草稿命令、作者或准确业务来源尚未核实；原值保留待核。');};
const clone=value=>structuredClone(value),same=(a,b)=>hash(a)===hash(b),rows=(s,k)=>Array.isArray(s[k])?s[k]:[];
const unique=(list,id,key='id')=>{const found=(list||[]).filter(row=>row?.[key]===id);if(typeof id!=='string'||!id||found.length!==1)fail();return found[0];};
const selectors=new Set(['id','bookingId','orderId','techId','userId','storeId','toStoreId','productId','skuId','categoryId','serviceId','accountId','grantId','caseId','incidentId','noteId','correctionOf','leaveId','safetyId','profileId','assessmentId','holdId','promoterId','personId','personKind','promoterType','entryId','paymentId','refundId','advanceId','recoveryId','factId','departureId','noticeId','sourceId','sourceKind','sourceKey','sourceToken','sourceVersion','ownerToken','assignmentVersion','actionIndex','caseVersion','accountVersion','targetVersion','version','stockVersion','requestId','slot','category','month','kind','action','scope','path','date']);
function qualitySelectors(p,command){
  const request=p.requestId==null?{}:{requestId:p.requestId};
  if(command==='quality.policy-withdraw')return{id:p.id,version:p.version,revision:p.revision,sourceToken:p.sourceToken,...request};
  if(command!=='quality.policy-publish')return null;
  const value=p.scope,keys=['subject','domain','storeIds','serviceIds'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||!['tech','user'].includes(value.subject)||value.domain!=='service-order')fail();
  for(const key of ['storeIds','serviceIds'])if(value[key]!==null&&(!Array.isArray(value[key])||!value[key].length||value[key].some(id=>typeof id!=='string'||!id||id.length>300)||new Set(value[key]).size!==value[key].length))fail();
  return{scope:clone(value),expectedVersion:p.expectedVersion,sourceToken:p.sourceToken,...request};
}
const minimal=(p,command)=>qualitySelectors(p||{},command)??({...Object.fromEntries(Object.entries(p||{}).filter(([key,value])=>selectors.has(key)&&['string','number','boolean'].includes(typeof value)&&String(value).length<=300&&(!key.endsWith('Token')||/^(?:sha256:)?[a-f0-9]{64}$/.test(value)))),...(Array.isArray(p?.lines)?{lineSources:p.lines.map(line=>({entryId:line.entryId,version:line.version}))}:Array.isArray(p?.lineSources)?{lineSources:clone(p.lineSources)}:{})});
export const appSessionAuthor=actor=>hash(Object.fromEntries(['role','accountId','sessionId','grantId','job',...(actor.role==='user'?['userId']:actor.role==='tech'?['techId']:['store','manager'].includes(actor.role)?['storeId']:[])].filter(key=>actor[key]!=null).map(key=>[key,actor[key]])));

// Navigation has already checked access and the original route. Re-read unique
// typed roots here so a technical return key keeps every actual data subject.
function taskSource(s,task){
  const b=task.binding,category=b.category,roots=[{kind:'work-task',id:task.taskKey}],subjects=[];
  const subject=(kind,id)=>{if(!id)return;if(['user','tech','store'].includes(kind))unique(rows(s,{user:'users',tech:'techs',store:'stores'}[kind]),id);if(!subjects.some(x=>x.kind===kind&&x.id===id))subjects.push({kind,id});};
  const add=(kind,row)=>{if(!row?.id)fail();if(!roots.some(x=>x.kind===kind&&x.id===row.id))roots.push({kind,id:row.id});for(const k of ['userId','techId','storeId','ownerStoreId'])subject(k==='userId'?'user':k==='techId'?'tech':'store',row[k]);return row;};
  const record=(container,kind,id)=>add(kind,unique(rows(s,container),id));
  const booking=id=>record('bookings','booking',id),goods=id=>{const row=record('goods','goods-order',id);subject('store',row.source?.storeId);return row;};
  const commission=id=>{const row=record('serviceCommissions','service-commission',id);booking(row.bookingId);return row;};
  if(b.bookingId)booking(b.bookingId);if(b.orderId)goods(b.orderId);
  if(['dispatch','change','assistance','refund','dispute','safety'].includes(category)){
    const row=unique(rows(s,'bookings'),b.bookingId);
    if(category==='safety')record('safety','booking-safety',b.sourceId);
    else if(category==='refund')add('booking-refund',unique(row.refunds,b.refundId||b.sourceId));
    else {const field={dispatch:'rounds',change:'changeHistory',assistance:'assistance',dispute:'disputes'}[category],current=category==='dispatch'?row.round:category==='change'?row.change:null,list=[...(row[field]||[])];if(current&&!list.some(x=>x.id===current.id))list.push(current);add('booking-'+category,unique(list,b.sourceId));}
  }
  else if(['invoice','care','followup'].includes(category)){const [container,kind]={invoice:['serviceInvoices','service-invoice'],care:['serviceCareCases','care-case'],followup:['serviceCareFollowups','care-followup']}[category],row=record(container,kind,b.sourceId);booking(row.bookingId);}
  else if(category==='technician-penalty-appeal'){const row=record('technicianPenalties','technician-penalty',b.sourceId);record('serviceCareCases','care-case',row.source.caseId);}
  else if(category==='qualification'){const tech=record('techs','tech',b.techId);subject('tech',tech.id);const profile=unique(rows(s,'techQualifications').filter(row=>b.profileId?row.id===b.profileId:row.techId===tech.id&&row.storeId===tech.storeId),b.profileId||rows(s,'techQualifications').find(row=>row.techId===tech.id&&row.storeId===tech.storeId)?.id);add('qualification-profile',profile);add('qualification-grant',unique(profile.grants,b.grantId));}
  else if(['goods-shipping','goods-aftersale','goods-exception','goods-logistics'].includes(category)){const row=unique(rows(s,'goods'),b.orderId);if(category==='goods-aftersale')add('goods-case',unique(row.cases,b.sourceId));if(category==='goods-exception')add('goods-incident',unique(row.incidents,b.sourceId));if(category==='goods-logistics'&&b.sourceId!==row.id)add('goods-logistics-source',unique([...(row.goodsDeliveryFacts||[]),...(row.cases||[])],b.sourceId));}
  else if(['goods-settlement-bill','goods-settlement-offset'].includes(category)){const bill=record('bills','goods-bill',b.billId);for(const line of bill.items||[])goods(line.orderId);if(category==='goods-settlement-offset')record('goodsOffsetPlans','goods-offset-plan',b.planId);}
  else if(category==='goods-settlement-recovery'){const row=record('recoveries','goods-recovery',b.recoveryId);goods(row.orderId);}
  else if(category==='fulfilment'){const found=rows(s,'fulfilmentRecords').filter(row=>row.bookingId===b.bookingId&&(row.facts||[]).some(f=>f.id===b.sourceId));if(found.length!==1)fail();add('fulfilment-record',found[0]);add('fulfilment-fact',unique(found[0].facts,b.sourceId));}
  else if(category==='safe-departure')record('fulfilmentDepartures','fulfilment-departure',b.sourceId);
  else if(category.startsWith('service-extra-')){const container={'service-extra-evidence':'serviceExtraEvidence','service-extra-shortage':'serviceRefundShortages','service-extra-recovery':'serviceExtraRecoveries','service-extra-offset':'serviceExtraOffsets'}[category];if(!container)fail();const row=record(container,category,b.sourceId);if(row.entryId)record('serviceFinanceEntries','service-finance-entry',row.entryId);if(category==='service-extra-recovery')record('serviceRefundShortages','service-refund-shortage',row.shortageId);if(category==='service-extra-offset')record('serviceExtraRecoveries','service-extra-recovery',row.recoveryId);}
  else if(['service-finance-entry','service-finance-recovery'].includes(category)){const original=serviceFinanceTaskBinding(s,b.entryId,category==='service-finance-recovery'?{recoveryId:b.sourceId}:{});if(!original||original.bookingId!==b.bookingId||original.paymentId!==b.paymentId||category==='service-finance-entry'&&original.entryId!==b.sourceId)fail();record('serviceFinanceEntries','service-finance-entry',original.entryId);const originalBooking=unique(rows(s,'bookings'),original.bookingId);add('booking-payment',unique([originalBooking.payment,...(originalBooking.extensions||[])].filter(Boolean),original.paymentId));if(original.recoveryId)record('serviceFinanceRecoveries','service-finance-recovery',original.recoveryId);}
  else if(['service-promotion-finance-entry','service-promotion-finance-recovery'].includes(category)){const entry=record('serviceFinanceEntries','service-finance-entry',b.entryId),promoter=record('servicePromoters','service-promoter',entry.sourceSnapshot?.promoterId);subject(promoter.personKind,promoter.personId);if(category==='service-promotion-finance-recovery')record('serviceFinanceRecoveries','service-finance-recovery',b.sourceId);}
  else if(category.startsWith('service-promotion-')){const container={'service-promotion-risk':'servicePromotionRisks','service-promotion-identity':'servicePromoters','service-promotion-withdrawal':'servicePromotionWithdrawals','service-promotion-recovery':'servicePromotionRecoveries'}[category];if(!container)fail();const row=record(container,category,b.sourceId),promoter=container==='servicePromoters'?row:record('servicePromoters','service-promoter',row.promoterId);subject(promoter.personKind,promoter.personId);if(row.bookingId)booking(row.bookingId);if(row.commissionId)commission(row.commissionId);for(const a of row.allocations||[])commission(a.commissionId);}
  else fail();
  // Completion may change status while the original return route stays valid.
  // Bind ownership and typed IDs, not mutable task presentation or form bodies.
  if(!subjects.length)fail();return{source:roots[0],roots,subjects,sourceToken:hash({binding:b,roots,subjects})};
}

export function appSessionCommandSource(s,rawActor,type,p={},formIdDigest){
  const actor=resolveAccountActor(s,rawActor);assertAccountCommand(actor,type,p,s);if(!type.startsWith('account.'))assertJob(actor,type);
  if(actor.role==='user'&&privacyUseClosed(s,actor.userId)){
    const draft={...p};if(type==='booking.refund-request'&&!draft.requests)draft.requests=Object.keys(p).filter(key=>key.startsWith('refundAmount:')).map(key=>({paymentId:key.slice(13)}));
    if(!assertClosedRightsDraft(s,actor,type,draft))fail();
  }else assertPrivacyCommand(s,actor,type,p);
  const sources=[],subjects=[],facts=[];
  const subject=(kind,id)=>{if(!id)return;if(['user','tech','store'].includes(kind))unique(rows(s,{user:'users',tech:'techs',store:'stores'}[kind]),id);if(!subjects.some(x=>x.kind===kind&&x.id===id))subjects.push({kind,id});};
  const add=(kind,row)=>{if(!row?.id)fail();sources.push({kind,id:row.id});facts.push(row);for(const key of ['userId','techId','storeId','ownerStoreId','fromStoreId'])subject(key==='userId'?'user':key==='techId'?'tech':'store',row[key]);return row;};
  const owned=row=>{if(actor.role==='user'&&row.userId!==actor.userId||actor.role==='tech'&&row.techId!==actor.techId||['store','manager'].includes(actor.role)&&row.storeId!==actor.storeId)fail();return row;};
  const booking=id=>add('booking',owned(unique(rows(s,'bookings'),id)));
  const record=(container,kind,id=p.id,scope=true)=>{const row=unique(rows(s,container),id);add(kind,row);if(row.bookingId)booking(row.bookingId);else if(scope)owned(row);return row;};
  const draft=(kind,owner)=>{const source={kind,id:p.requestId||formIdDigest};if(!source.id)fail();sources.push(source);facts.push(source);if(owner)subject(owner.kind,owner.id);};
  const config=(kind,container)=>{if(actor.role!=='group')fail();sources.push({kind,id:'current'});facts.push(s[container]??null);subject('group','group');};
  const fileCommands=/^(care\.(case-create|case-statement)|qualification\.|invoice\.(issue|red|replace-file)$|commerce-invoice\.(issue|red|replace-file)$|finance\.(recovery-receive|composition-confirm|composition-reconcile)$|service-extra\.(evidence-submit|refund-shortage|recovery-receive|offset-return)$|service-promotion\.(agreement-publish|identity-review|risk-review|withdraw-pay|withdraw-query|recovery-receive|recovery-return|recovery-loss)$|manage\.product-save$)/;
  if(fileCommands.test(type)&&!(type==='manage.product-save'&&!p.id&&!p.requestId)){
    const selection={tabId:'source-only',instanceId:'source-only',generation:'source-only',formKeyDigest:formIdDigest||hash(type)};
    const actual=privacyUploadScope(s,actor,type,p,{selection,field:type.startsWith('care.')||type.startsWith('qualification.')?'evidenceRefs':type==='manage.product-save'?'image':'file'});
    return{source:actual.source,sourceToken:actual.sourceToken,subjects:actual.subjects,roots:[actual.source]};
  }
  if(type.startsWith('recipient.')){const view=recipientView(s,actor);if(p.id){const row=unique(view,p.id);record('recipients','recipient',row.id);}else if(type==='recipient.save'&&actor.role==='user')draft('recipient-draft',{kind:'user',id:actor.userId});else fail();}
  else if(type.startsWith('handoff.')){const b=booking(p.bookingId),view=handoffView(s,actor,b.id);if(!view||Number(p.version)!==view.version||!view[{ 'handoff.ack':'canAck','handoff.note':'canNote','handoff.decide':'canDecide'}[type]])fail();const row=unique(rows(s,'serviceHandoffs'),b.id,'bookingId');add('service-handoff',{...row,id:row.bookingId});for(const id of [p.noteId,p.correctionOf].filter(Boolean))unique(row.notes,id);}
  else if(type.startsWith('privacy.')){const view=privacyData(s,actor);if(!view)fail();if(['privacy.consent','privacy.withdraw','privacy.request'].includes(type)){if(actor.role!=='user')fail();add('user',unique(rows(s,'users'),actor.userId));subject('user',actor.userId);facts.push(privacyProfile(s,actor.userId));}else{const row=unique(view.closures,p.id);record('privacyClosures','privacy-closure',row.id,false);}}
  else if(type==='sensitive.reveal')booking(p.bookingId);
  else if(['quality.policy-publish','quality.policy-withdraw'].includes(type)){
    const publish=type==='quality.policy-publish',view=qualityPolicyView(s,actor,publish?{scope:p.scope}:{});
    if(!view.canEnter)fail();
    const version=(value,expected)=>['string','number'].includes(typeof value)&&String(value).trim()!==''&&Number.isSafeInteger(Number(value))&&Number(value)===expected;
    if(publish){const stream=view.stream;if(!stream||!version(p.expectedVersion,stream.version)||p.sourceToken!==stream.sourceToken)fail();const root={kind:'quality-policy-stream',id:hash(stream.scope)};sources.push(root);facts.push(stream);}
    else{const row=unique(view.policies,p.id);if(row.status!=='published'||!version(p.version,row.version)||!version(p.revision,row.revision)||p.sourceToken!==row.sourceToken)fail();add('quality-policy',row);}
    subject('group','group');
  }
  else if(type.startsWith('penalty.')){const view=technicianPenaltyView(s,actor);if(type==='penalty.warning-record'){const found=(view.sourceCases||[]).filter(x=>x.caseId===p.caseId&&x.actionIndex===Number(p.actionIndex)&&x.caseVersion===Number(p.caseVersion)&&x.sourceToken===p.sourceToken);if(found.length!==1)fail();record('serviceCareCases','care-case',p.caseId);}else{const item=unique(view.penalties,p.id);if(!item.sourceValid||!item[type==='penalty.appeal'?'canAppeal':'canReview'])fail();record('technicianPenalties','technician-penalty');}}
  else if(type.startsWith('work.')||type.startsWith('work-escalation.')){
    const task=type.startsWith('work-escalation.')?unique(workEscalationView(s,actor).rows.map(row=>row.task),p.id):unique(workTaskView(s,actor).tasks,p.id);
    const context=createTaskReturnContext(s,actor,{taskKey:task.id,task,listHash:`/${actor.role}/tasks`,token:'source-check'});return taskSource(s,context);
  }
  else if(type.startsWith('account.')){
    if(type==='account.create'){draft('staff-account-draft',{kind:'group',id:'group'});}
    else if(type==='account.leave')record('staffSessions','staff-session',actor.sessionId,false);
    else if(type==='account.handover'){record('organizationLifecycleCases','organization-lifecycle-case',p.caseId,false);const account=record('staffAccounts','staff-account',p.accountId,false);facts.push(unique(account.grants,p.grantId));subject('store',p.storeId);}
    else if(['account.handover-accept','account.handover-cancel'].includes(type)){const row=record('organizationAuthorityHandovers','organization-authority-handover',p.id,false);record('organizationLifecycleCases','organization-lifecycle-case',row.caseId,false);record('staffAccounts','staff-account',row.accountId,false);}
    else {const account=record('staffAccounts','staff-account',type==='account.enter'?p.accountId:p.id,false);if(p.grantId)facts.push(unique(account.grants,p.grantId));}if(!subjects.length)subject('group','group');
  }
  else if(type.startsWith('manage.')){
    if(type==='manage.rules-save')config('booking-rules','bookingRules');
    else if(type==='manage.sku-save'){const product=record('products','catalog-product',p.productId,false);if(p.id){const sku=record('skus','catalog-sku',p.id,false);if(sku.productId!==product.id)fail();}subject('public',product.id);}
    else if(type==='manage.inventory'){const sku=record('skus','catalog-sku',p.skuId,false);record('products','catalog-product',sku.productId,false);subject('public',sku.productId);}
    else if(type==='manage.tech-import'){record('stores','store',p.storeId,false);if(['store','manager'].includes(actor.role)&&actor.storeId!==p.storeId)fail();subject('store',p.storeId);}
    else {const match=/^manage\.(product|category|service|store|tech)-(save|status|review)$/.exec(type);if(!match)fail();const [container,kind]={product:['products','catalog-product'],category:['categories','catalog-category'],service:['services','catalog-service'],store:['stores','store'],tech:['techs','tech']}[match[1]];
      if(p.id){const row=record(container,kind,p.id,false);if(['store','manager'].includes(actor.role)&&(kind==='store'?row.id!==actor.storeId:kind==='tech'?row.storeId!==actor.storeId:true))fail();if(kind==='tech'&&p.storeId&&p.storeId!==row.storeId)fail();subject(kind==='store'?'store':kind==='tech'?'tech':'public',row.id);}else if(match[2]==='save'){if(kind==='tech'){unique(rows(s,'stores'),p.storeId);if(['store','manager'].includes(actor.role)&&actor.storeId!==p.storeId)fail();draft('tech-draft',{kind:'store',id:p.storeId});}else draft(kind+'-draft',{kind:'public',id:formIdDigest});}else fail();}
  }
  else if(type.startsWith('lifecycle.')){
    if(p.techId){const tech=record('techs','tech',p.techId,false);subject('tech',tech.id);if(p.userId){record('users','user',p.userId,false);subject('user',p.userId);}if(p.toStoreId)record('stores','store',p.toStoreId,false);}
    else if(p.storeId&&!p.id){record('stores','store',p.storeId,false);subject('store',p.storeId);}else record('organizationLifecycleCases','organization-lifecycle-case',p.id,false);
  }
  else if(type.startsWith('booking.busy-')){if(type==='booking.busy-create'){const tech=record('techs','tech',p.techId||actor.techId,false);if(actor.role==='tech'&&actor.techId!==tech.id||['store','manager'].includes(actor.role)&&actor.storeId!==tech.storeId)fail();subject('tech',tech.id);}else record('busyRecords','busy-record');}
  else if(type==='booking.schedule-save'||type==='booking.leave-request'){const tech=record('techs','tech',p.techId||actor.techId,false);if(actor.role==='tech'&&actor.techId!==tech.id||['store','manager'].includes(actor.role)&&actor.storeId!==tech.storeId)fail();subject('tech',tech.id);facts.push(s.schedules?.[tech.id]||null);}
  else if(type==='booking.leave-review'){record('leaves','tech-leave',p.leaveId);}
  else if(['booking.help-ack','booking.help-close'].includes(type))record('safety','booking-safety',p.safetyId);
  else if(type.startsWith('booking.'))booking(p.id||p.bookingId);
  else if(type.startsWith('care.')){if(type==='care.followup-create')booking(p.bookingId);else record(type.startsWith('care.followup-')?'serviceCareFollowups':'serviceCareCases',type.startsWith('care.followup-')?'care-followup':'care-case');}
  else if(type.startsWith('invoice.')){if(type==='invoice.apply')booking(p.bookingId);else record('serviceInvoices','service-invoice');}
  else if(type.startsWith('commerce-invoice.')){if(type==='commerce-invoice.rule-publish')config('commerce-invoice-rules','commerceInvoiceRules');else if(p.id)record('commerceInvoices','commerce-invoice');else if(p.orderId)record('goods','goods-order',p.orderId);else if(type==='commerce-invoice.apply-fee'){subject('store',actor.storeId);draft('commerce-invoice-draft',{kind:'store',id:actor.storeId});}else fail();}
  else if(type.startsWith('goods.')||type.startsWith('goods-logistics.')){if(type==='goods-logistics.policy-publish')config('goods-logistics-policy','goodsLogisticsPolicies');else {const order=record('goods','goods-order',p.id||p.orderId,false);if(actor.role==='user'&&order.userId!==actor.userId||['store','manager'].includes(actor.role)&&order.source?.storeId!==actor.storeId)fail();subject('store',order.source?.storeId);for(const [key,container]of [['caseId','cases'],['incidentId','incidents'],['factId','goodsDeliveryFacts']])if(p[key])facts.push(unique(order[container],p[key]));}}
  else if(type==='recovery.receive')record('recoveries','goods-recovery');
  else if(type.startsWith('service-extra.')){
    const command=type.slice(14),view=serviceFinanceExtrasView(s,actor);
    if(command==='policy-publish'){config('service-extra-policies','serviceExtraPolicies');if(p.storeId)subject('store',p.storeId);}
    else if(command==='offset-propose'){const row=record('serviceFinanceEntries','service-finance-entry',p.entryId);if(p.recoveryId)record('serviceExtraRecoveries','service-extra-recovery',p.recoveryId);facts.push(row);}
    else {const [container,kind,viewKey]=command==='evidence-review'?['serviceExtraEvidence','service-extra-evidence','evidence']:command.startsWith('offset-')?['serviceExtraOffsets','service-extra-offset','offsets']:command.startsWith('recovery-')?['serviceExtraRecoveries','service-extra-recovery','recoveries']:['serviceRefundShortages','service-refund-shortage','shortages'];unique(view[viewKey],p.id);const row=record(container,kind);if(p.advanceId)facts.push(unique(row.advances,p.advanceId));}
  }
  else if(type.startsWith('service-promotion.')){
    const command=type.slice(18),view=servicePromotionView(s,actor);
    if(command==='policy-publish'||command==='rule-publish')config(command==='policy-publish'?'service-promotion-policies':'service-promotion-rules',command==='policy-publish'?'servicePromotionPolicies':'servicePromotionRules');
    else if(command==='invite'){if(p.userId){record('users','user',p.userId,false);subject('user',p.userId);}if(actor.storeId)subject('store',actor.storeId);else subject('group','group');draft('service-promotion-invite-draft');}
    else if(command==='enter'||command==='clear-expired'){if(actor.role!=='user')fail();add('user',unique(rows(s,'users'),actor.userId));subject('user',actor.userId);}
    else {const [container,kind,viewKey]=command==='invite-confirm'?['servicePromotionInvites','service-promotion-invite','invites']:command.startsWith('withdraw-')&&command!=='withdraw-create'?['servicePromotionWithdrawals','service-promotion-withdrawal','withdrawals']:['servicePromoters','service-promoter','promoters'];const id=p.promoterId||p.id;unique(view[viewKey],id);const row=record(container,kind,id,false),person=container==='servicePromotionWithdrawals'?record('servicePromoters','service-promoter',row.promoterId,false):row;subject(person.personKind,person.personId);for(const allocation of row.allocations||[]){const commission=record('serviceCommissions','service-commission',allocation.commissionId,false);booking(commission.bookingId);}}
  }
  else if(type.startsWith('finance.')){if(type==='finance.rule-publish')config('service-finance-rules','serviceFinanceRules');else record('serviceFinanceEntries','service-finance-entry');}
  else if(type.startsWith('tech-income.')){if(type==='tech-income.rule-publish'){config('tech-income-rules','techIncomeRules');subject('store',p.storeId);}else if(type==='tech-income.difference-record'){const difference=record('techIncomeDifferences','tech-income-difference');record('techIncomeEntries','tech-income-entry',difference.entryId);}else if(type==='tech-income.payout'){const tech=record('techs','tech',p.techId,false);subject('tech',tech.id);const lines=p.lines||p.lineSources;if(!Array.isArray(lines)||!lines.length||new Set(lines.map(line=>line.entryId)).size!==lines.length)fail();for(const line of lines){const entry=record('techIncomeEntries','tech-income-entry',line.entryId);if(entry.storeId!==actor.storeId||entry.techId!==p.techId||entry.month!==p.month||Number(line.version)!==entry.version)fail();}}else fail();}
  else if(type==='review.create')booking(p.bookingId||p.id);
  else if(type.startsWith('report.')){sources.push({kind:'report-query',id:formIdDigest});facts.push(minimal(p));if(['store','manager'].includes(actor.role))subject('store',actor.storeId);else subject('group','group');}
  else if(type.startsWith('fulfilment.')){if(p.bookingId)booking(p.bookingId);else if(type==='fulfilment.policy-publish')config('fulfilment-policy','fulfilmentPolicies');else if(type==='fulfilment.duty-save'){subject('store',p.storeId);draft('fulfilment-duty-draft',{kind:p.storeId?'store':'group',id:p.storeId||'group'});}else fail();}
  else fail();
  if(!sources.length||!subjects.length)fail();
  return{source:sources[0],roots:sources,subjects,sourceToken:hash({type,sources,facts})};
}

export function createAppSessionScopes({key,currentContext}={}){
  const produced=new Map(),completed=new Map();
  function stageCompletion(before,next,identity,items,requestId){
    if(!requestId||!items.length)return;
    const c=currentContext(),authorDigest=appSessionAuthor(resolveAccountActor(before,c.actor)),own=(before.privacyUploadTabs||[]).filter(row=>row.id===identity.instanceId&&row.tabId===identity.tabId);
    if(own.length!==1)return;
    const requests=Object.entries(next).filter(([container,list])=>/Requests$/.test(container)&&Array.isArray(list)).flatMap(([container,list])=>list.filter(row=>row.requestId===requestId&&!(before[container]||[]).some(old=>same(old,row))).map(row=>({container,row})));
    if(requests.length!==1)return;
    const entries=items.flatMap(item=>own[0].manifest?.entries.filter(entry=>entry.keyDigest===hash(item.key)&&entry.valueDigest===hash(item.value)&&entry.producer?.authorDigest===authorDigest)||[]);
    if(!entries.length)return;
    next.privacyUploadSessionCompletions??=[];
    const request={container:requests[0].container,requestId,valueDigest:hash(requests[0].row)},id=hash({identity,request,entries});
    if(next.privacyUploadSessionCompletions.some(row=>row.id===id))fail();
    next.privacyUploadSessionCompletions.push({id,...identity,originScope:c.originScope,authorDigest,request,entries:entries.map(({keyDigest,valueDigest,kind,disposition,source,sourceToken,subjects,roots,producer})=>({keyDigest,valueDigest,kind,disposition,source,sourceToken,subjects,roots,producer})),at:next.now});
  }
  function completion(rawKey,value){
    const c=currentContext(),authorDigest=appSessionAuthor(resolveAccountActor(c.state,c.actor));
    const found=(c.state.privacyUploadSessionCompletions||[]).filter(row=>row.authorDigest===authorDigest&&row.originScope===c.originScope).flatMap(row=>{
      const request=(c.state[row.request?.container]||[]).filter(request=>request.requestId===row.request.requestId);
      return request.length===1&&hash(request[0])===row.request.valueDigest?row.entries.filter(entry=>entry.keyDigest===hash(rawKey)&&entry.valueDigest===hash(value)&&entry.producer?.authorDigest===authorDigest).map(entry=>({entry,request:row.request})):[];
    });
    if(!found.length||new Set(found.map(entry=>hash(entry))).size!==1)return false;
    completed.set(hash(rawKey)+hash(value),clone(found[0]));return true;
  }
  function complete(rawKey,value,identity){
    if(value!=null)completion(rawKey,value);
  }
  function produce(rawKey,value,{kind,command,formId,payload={}}={}){
    const current=currentContext(),actor=resolveAccountActor(current.state,current.actor);
    const producer={type:kind,authorDigest:appSessionAuthor(actor),...(command?{command}:{}),...(formId?{formIdDigest:hash(formId)}:{}),selectors:minimal(payload,command)};
    const descriptor={keyDigest:hash(rawKey),valueDigest:hash(String(value)),producer};produced.set(descriptor.keyDigest+descriptor.valueDigest,descriptor);return descriptor;
  }
  function scopeForDraft(c){
    const {state:s,actor:a,key:rawKey,value}=c;
    let liveActor;try{liveActor=resolveAccountActor(s,a);}catch{}
    if(!liveActor&&c.operation==='technical-transition'&&rawKey.startsWith(key+'-task-return:')){
      let task;try{task=JSON.parse(value);}catch{fail();}
      const expected=JSON.stringify([a.role,a.accountId?a.job:a.role==='group'?a.job||'all':'',a.storeId||'',a.accountId||'',a.sessionId||'',a.grantId||'']);
      if(!task||task.version!==1||rawKey!==key+'-task-return:'+task.token||task.scope!==expected||typeof task.taskKey!=='string')fail();
      const found=(s.privacyUploadTabs||[]).filter(row=>row.receipts?.some(receipt=>receipt.readbackVerified&&receipt.manifestDigest===row.manifest?.digest&&receipt.authorDigest===appSessionAuthor(a))).flatMap(row=>row.manifest.entries).filter(entry=>entry.kind==='task-context'&&entry.keyDigest===hash(rawKey)&&entry.valueDigest===hash(value));
      if(!found.length||new Set(found.map(entry=>hash({source:entry.source,subjects:entry.subjects,roots:entry.roots}))).size!==1)fail();
      // Exact old task removal is a technical exit only. No task data is restored,
      // and this never calls an alternate actor to grant business access.
      return{kind:'task-context',disposition:'technical',source:found[0].source,sourceToken:task,subjects:found[0].subjects,roots:found[0].roots};
    }
    const actor=liveActor||resolveAccountActor(s,a),authorDigest=appSessionAuthor(actor);
    const proof=completed.get(hash(rawKey)+hash(value)),committed=proof?.entry;
    if(c.operation==='remove'&&committed?.producer?.authorDigest===authorDigest){const requests=(s[proof.request.container]||[]).filter(row=>row.requestId===proof.request.requestId);if(requests.length!==1||hash(requests[0])!==proof.request.valueDigest)fail();return{kind:committed.kind,disposition:committed.disposition,source:committed.source,sourceToken:committed.sourceToken,subjects:committed.subjects,roots:committed.roots,producer:committed.producer};}
    let parsed;const parse=()=>{try{return parsed??=JSON.parse(value);}catch{fail();}};
    if(rawKey===key+'-actor'){const actual=parse();if(!same(resolveAccountActor(s,actual),actor))fail();return{kind:'actor-session',disposition:'technical',source:{kind:'actor-session',id:actor.sessionId||authorDigest},sourceToken:actor,subjects:[actor.role==='user'?{kind:'user',id:actor.userId}:actor.role==='tech'?{kind:'tech',id:actor.techId}:['store','manager'].includes(actor.role)?{kind:'store',id:actor.storeId}:{kind:'group',id:'group'}],roots:[]};}
    if(rawKey===key+'-booking-result'){if(!['success','failed','processing'].includes(value))fail();return{kind:'result-key',disposition:'technical',source:{kind:'demo-result',id:'booking-payment'},sourceToken:value,subjects:[{kind:'public',id:'booking-payment'}],roots:[]};}
    if(rawKey.startsWith(key+'-booking-draft:')){const d=parse();if(rawKey!==key+'-booking-draft:'+d.userId||actor.role!=='user'||d.userId!==actor.userId||typeof d.requestId!=='string'||!d.requestId)fail();unique(rows(s,'users'),d.userId);return{kind:'booking-draft',disposition:'scoped',source:{kind:'booking-draft',id:d.requestId},sourceToken:{userId:d.userId,privacy:privacyProfile(s,d.userId).version},subjects:[{kind:'user',id:d.userId}],roots:[{kind:'booking-draft',id:d.requestId}]};}
    if(rawKey.startsWith(key+'-task-return:')){const task=parse();if(rawKey!==key+'-task-return:'+task.token||!taskReturnTarget(s,actor,task,task.targetPath))fail();return{kind:'task-context',disposition:'scoped',...taskSource(s,task)};}
    const keyDigest=hash(rawKey),valueDigest=hash(value),direct=produced.get(keyDigest+valueDigest);
    const inherited=(s.privacyUploadTabs||[]).flatMap(row=>[...(row.manifest?.entries||[]),...(row.operation?.sources||[])]).filter(entry=>entry.keyDigest===keyDigest&&entry.valueDigest===valueDigest&&entry.producer);
    const hints=direct?[direct]:inherited,tokens=new Set(hints.map(entry=>hash(entry.producer)));if(!hints.length||tokens.size!==1)fail();const producer=hints[0].producer;
    if(producer.authorDigest!==authorDigest||!['management-draft','request-key'].includes(producer.type)||!producer.command)fail();
    let payload=producer.selectors;
    if(producer.type==='management-draft'){const draft=parse();if(!Array.isArray(draft.values)||typeof draft.payload!=='string')fail();let original;try{original=JSON.parse(draft.payload);}catch{fail();}payload={...original,...Object.fromEntries(draft.values.map(field=>[field.name,field.value]))};if(!same(minimal(payload,producer.command),producer.selectors))fail();}
    const source=appSessionCommandSource(s,actor,producer.command,payload,producer.formIdDigest||hash(rawKey));return{kind:producer.type,disposition:'scoped',...source,producer:clone(producer)};
  }
  return Object.freeze({produce,scopeForDraft,complete,stageCompletion,completion});
}
