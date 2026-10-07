import test from 'node:test';
import assert from 'node:assert/strict';
import { privacyUploadScope,privacyUploadAttachmentSlots,preparePrivacyInlineUpload } from './privacy-upload-scope.mjs';
import { createPrivacyUploadRegistry } from './privacy-upload-registry.mjs';
import { saveInvoiceFile,readInvoiceFile } from './invoice-files.mjs';
import { saveMedia,readMedia } from './media.mjs';
import { createIndexedDBStandin,fixture as closedFixture,NOW } from './privacy-cleanup-test-fixture.mjs';
import { lifecycleFingerprint as hash } from './organization-lifecycle-projection.mjs';
import { careCommand,careEvidenceFile } from './service-care.mjs';
import { prepareCareEvidence } from './care-file-validation.mjs';
import { qualificationCommand,qualificationEvidenceFile } from './tech-qualification.mjs';
import { prepareQualificationEvidence } from './qualification-file-validation.mjs';
import { invoiceCommand,syncInvoices } from './service-invoices.mjs';
import { commerceInvoiceCommand,syncCommerceInvoices } from './commerce-invoices.mjs';
import { serviceExtraSourceToken,serviceFinanceExtrasCommand,upgradeServiceFinanceExtras } from './service-finance-extras.mjs';
import { prepareServiceExtraEvidence } from './service-extra-file-validation.mjs';
import { servicePromotionCommand,upgradeServicePromotion } from './service-promotion.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';
import { serviceFinanceCommand,serviceFinanceSummary,syncServiceFinance } from './service-finance.mjs';
import { managementCommand,upgradeManagement } from './management.mjs';
import { closedRightsBinding } from './privacy-closed-rights.mjs';
import { createServiceFinanceExtrasBridges } from './service-finance-bridges.mjs';
import { upgradeAccounts,accountCommand,resolveAccountActor } from './staff-accounts.mjs';

// Runtime unit, not browser acceptance: original domain commands, preparations,
// Blob/SHA and original file stores execute. Only ledger/lock/IDB are stand-ins.
// Fixtures are isolated source inputs, never real policy, person or money I/O.
const idb=createIndexedDBStandin(),oldIDB=globalThis.indexedDB,oldDecoder=globalThis.createImageBitmap;
globalThis.indexedDB=idb.indexedDB;test.after(()=>{globalThis.indexedDB=oldIDB;globalThis.createImageBitmap=oldDecoder;});
test.beforeEach(()=>{idb.setHook(null);idb.events.length=0;for(const db of idb.databases.values())for(const store of db.stores.values())store.clear();});
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64');
globalThis.createImageBitmap=async file=>{assert.deepEqual(Buffer.from(await file.arrayBuffer()),PNG);return {width:1,height:1,close(){}};};
const image=()=>new File([PNG],'PRIVATE-NAME-13800001111.png',{type:'image/png'});
const pdf=()=>new File(['%PDF-1.4\nSYNTHETIC SOURCE\n%%EOF'],'PRIVATE-IDENTITY.pdf',{type:'application/pdf'});
const actors={ops:{role:'group',job:'operations'},finance:{role:'group',job:'finance'},support:{role:'group',job:'support'},store:{role:'store',job:'store-finance',storeId:'a'},manager:{role:'store',storeId:'a',job:'store-manager'},user:{role:'user',userId:'u1'}};
const selection=()=>({tabId:'ISOLATED-TAB',instanceId:'ISOLATED-DOC',formKeyDigest:hash('PRIVATE-form-key'),generation:'S1'});
const same=(a,b)=>hash(a)===hash(b),copy=s=>structuredClone(s),userScope=(s,a,kind,id)=>closedRightsBinding(s,a,kind,id);
function base() {
  return {schema:5,seq:100,now:NOW,users:[{id:'u1'},{id:'u2'}],stores:[{id:'a',active:true,serviceIds:['SV1']},{id:'b',active:true,serviceIds:['SV1']}],techs:[{id:'t1',storeId:'a',serviceIds:['SV1'],qualificationRequired:true,active:true,reviewStatus:'approved',certificate:'SYNTHETIC-CERT',insurance:'SYNTHETIC-INS',validUntil:'2027-12-31'}],services:[{id:'SV1',active:true}],bookings:[{id:'B1',userId:'u2',techId:'t1',storeId:'a',serviceId:'SV1',status:'done',createdAt:NOW-5*86400000,completedAt:NOW-4*86400000,payment:{id:'P1',status:'success',amountCents:20000,refundedCents:0,paidAt:NOW-5*86400000,channelReference:'CH-P1'},extensions:[],refunds:[]}],goods:[],skus:[],products:[],regions:[],logs:[],safety:[]};
}
function context(s,verified=[]) {const ctx={id:prefix=>prefix+(++s.seq),log:()=>{},fail:message=>{throw Error(message);},validateEvidenceRefs:list=>list.every(file=>verified.some(actual=>same(actual,file))),assertUserScope:userScope,serviceFinanceSummary};return Object.assign(ctx,createServiceFinanceExtrasBridges(ctx));}
function workingStaff(s,job,name) {
  upgradeAccounts(s);const run=(actor,type,p)=>accountCommand(s,actor,type,{requestId:'staff-source-'+(++s.seq),...p},context(s));
  const admin=resolveAccountActor(s,run(actors.user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'})),account=run(admin,'account.create',{name,reason:'isolated actual source'}),granted=run(admin,'account.grant',{id:account.id,version:account.version,job,reason:'isolated actual finance grant'});
  return resolveAccountActor(s,run(actors.user,'account.enter',{accountId:account.id,grantId:granted.grants[0].id}));
}
async function preparation(s,a,type,p) {
  const deps={readFile:readInvoiceFile};
  if(type.startsWith('care.'))return (await prepareCareEvidence(s,a,type,p,{...deps,assertUserScope:userScope})).evidenceRefs;
  if(type.startsWith('qualification.'))return (await prepareQualificationEvidence(s,a,type,p,deps)).evidenceRefs;
  if(type.startsWith('service-extra.'))return (await prepareServiceExtraEvidence(s,a,type,p,deps)).evidenceRefs;
  if(type.startsWith('service-promotion.')||type==='finance.recovery-receive')return (await prepareServicePromotionEvidence(s,a,type,p,deps)).evidenceRefs;
  if(p.file)await readInvoiceFile(p.file);
  return p.file?[p.file]:[];
}
function command(s,a,type,p,ctx) {
  if(type.startsWith('care.'))return careCommand(s,a,type,p,ctx);
  if(type.startsWith('qualification.'))return qualificationCommand(s,a,type,p,ctx);
  if(type.startsWith('invoice.'))return invoiceCommand(s,a,type,p,ctx);
  if(type.startsWith('commerce-invoice.'))return commerceInvoiceCommand(s,a,type,p,ctx);
  if(type.startsWith('service-extra.'))return serviceFinanceExtrasCommand(s,a,type,p,ctx);
  if(type.startsWith('service-promotion.'))return servicePromotionCommand(s,a,type,p,ctx);
  if(type.startsWith('finance.'))return serviceFinanceCommand(s,a,type,p,ctx);
  return managementCommand(s,a,type,p,ctx);
}
function harness(initial,actor,type,selectPayload,options={}) {
  let state=copy(initial),held=false,count=(initial.privacyUploadReservations||[]).length,submitted=null,before=null,result=null;
  const chosen=selection(),h={get s(){return state;},get actor(){return actor;},set actor(a){actor=a;},selection:chosen,options,selectPayload,slots:null,replace:s=>{state=copy(s);}};
  h.registry=createPrivacyUploadRegistry({
    load:()=>copy(state),currentContext:()=>({actor,originScope:'https://isolated.test'}),
    withMutation:async fn=>{assert.equal(held,false);held=true;try{return await fn();}finally{held=false;}},
    scopeFor:ctx=>privacyUploadScope(ctx.state,ctx.actor,type,h.selectPayload,{selection:chosen,...options}),
    commit:async(next,{expectedStateToken})=>{assert.equal(held,true);assert.equal(expectedStateToken,hash(state));state=copy(next);},
    save:async(library,file)=>{assert.equal(held,true);assert.equal(state.privacyUploadReservations.at(-1).status,'preparing');return library==='invoice'?saveInvoiceFile(file):saveMedia(file);},
    read:async(library,file)=>library==='invoice'?readInvoiceFile(file):readMedia(file),
    attachmentFor:(next,a,row)=>{h.slots=privacyUploadAttachmentSlots(before,next,a,type,submitted,result,row,options);return h.slots;},id:()=> 'UPLOAD-'+(++count)
  });
  h.submit=async(payload,id)=>{
    submitted=payload;before=copy(state);const verified=await preparation(before,actor,type,payload),next=copy(before);
    result=command(next,actor,type,payload,context(next,verified));
    h.registry.stageAttach(next,[id]);state=copy(next);return {before,after:copy(next),result,payload};
  };
  return h;
}
const last=h=>h.s.privacyUploadReservations.at(-1);
const title={kind:'company',title:'SYNTHETIC TITLE',taxId:'91320100000000000X',email:'synthetic@example.test'};
function serviceInvoiceState() {const s=base();invoiceCommand(s,{role:'user',userId:'u2'},'invoice.apply',{bookingId:'B1',requestId:'invoice-apply',...title},context(s));return s;}
function goodsInvoiceState() {const s=base();s.goods=[{id:'G1',userId:'u1',version:1,status:'received',paidAt:NOW-2*86400000,receivedAt:NOW-86400000,payment:{id:'GP1',status:'success'},paidCents:10000,shippingCents:0,lines:[{skuId:'S1',paidCents:10000,refundedCents:0}],refunds:[],cases:[]}];commerceInvoiceCommand(s,actors.finance,'commerce-invoice.rule-publish',{category:'goods',version:0,issuerName:'SYNTHETIC ISSUER',issuerTaxId:'91320100000000000Y',invoiceItem:'SYNTHETIC ITEM',effectiveAt:NOW,sourceFromAt:NOW-10*86400000,reason:'explicit isolated Demo',applicationStage:'paid',shipping:'include',windowDays:90,requestId:'goods-rule'},context(s));commerceInvoiceCommand(s,actors.user,'commerce-invoice.apply-goods',{orderId:'G1',requestId:'goods-apply',...title},context(s));return s;}
function feeInvoiceState() {
  const s=base();s.now=Date.parse('2026-11-02T12:00:00+08:00');s.serviceFinanceEntries=[{id:'E-FEE',kind:'main',bookingId:'B1',paymentId:'P1',storeId:'a',split:{id:'SPL-FEE',kind:'split',status:'success',requestNo:'FEE-SPLIT',amountCents:2000,completedAt:Date.parse('2026-09-30T10:00:00+08:00')},splitHistory:[],finish:{id:'FIN-FEE',status:'success',amountCents:18000},returns:[]}];s.serviceFinanceRecoveries=[];
  commerceInvoiceCommand(s,actors.finance,'commerce-invoice.rule-publish',{category:'fee',version:0,issuerName:'SYNTHETIC ISSUER',issuerTaxId:'91320100000000000Y',invoiceItem:'SYNTHETIC ITEM',effectiveAt:s.now,sourceFromAt:Date.parse('2026-01-01T00:00:00+08:00'),reason:'explicit isolated Demo fee',applicationStage:'paid',shipping:'include',windowDays:90,cycle:'monthly',timezoneMinutes:480,returnPolicy:'original-income-fifo',requestId:'fee-rule'},context(s));commerceInvoiceCommand(s,actors.store,'commerce-invoice.apply-fee',{storeId:'a',month:'2026-09',requestId:'fee-apply',...title},context(s));return s;
}
function promotionState() {
  const s=base(),r={id:'R1',personKind:'user',personId:'u1',promoterType:'store-promoter',ownerType:'store',ownerStoreId:'a',status:'active',identity:{status:'verified'},transferAuthorization:{exempt:true},version:0,history:[]};
  const snapshot={promoter:{id:r.id,personKind:r.personKind,personId:r.personId,ownerType:r.ownerType,ownerStoreId:r.ownerStoreId},capturedAt:NOW-5*86400000};
  s.servicePromoters=[r];s.bookings[0].servicePromotionSnapshot=copy(snapshot);
  const rule={id:'SYNTHETIC-RULE',version:1,promoterType:'store-promoter',firstBps:2000,repeatBps:2000,storeCostBps:5000,csRounding:'floor',concurrency:'completed-created-id',lateFullRefund:'reassign'};
  s.serviceCommissions=[{id:'C1',promoterId:'R1',personKey:'user:u1',bookingId:'B1',paymentId:'P1',storeId:'a',userId:'u2',sourceSnapshot:copy(snapshot),ruleSnapshot:rule,version:1,known:true,commissionCents:4000,storeCents:2000,groupCents:2000,availableAt:NOW-1,status:'available',createdAt:NOW-4*86400000,adjustments:[]}];
  s.servicePromotionFirsts=[{id:'FIRST',userId:'u2',version:0,history:[],policySnapshot:{...rule}}];
  s.servicePromotionWithdrawals=[{id:'W1',promoterId:'R1',personKind:'user',personId:'u1',personKey:'user:u1',ownerType:'store',ownerStoreId:'a',createdAt:NOW-86400000,amountCents:4000,allocations:[{commissionId:'C1',amountCents:4000,storeCents:2000,groupCents:2000}],version:0,status:'requested',authorizationSnapshot:{exempt:true},execution:null,history:[]}];
  s.servicePromotionRecoveries=[{id:'D1',commissionId:'C1',bookingId:'B1',paymentId:'P1',promoterId:'R1',personKey:'user:u1',storeId:'a',amountCents:1000,storeCents:500,groupCents:500,createdAt:NOW-100*86400000,dueAt:NOW-10*86400000,status:'open',version:0,records:[],history:[]}];
  s.servicePromotionRisks=[{id:'K1',bookingId:'B1',userId:'u2',storeId:'a',promoterId:'R1',reference:'UPSTREAM-K1',kind:'suspicious-first',source:{reference:'UPSTREAM-K1',kind:'suspicious-first',evidenceIds:['SYNTHETIC-UPSTREAM'],at:NOW-86400000},status:'pending',version:0,createdAt:NOW-86400000,review:null,reviewHistory:[],history:[]}];
  s.bookings[0].servicePromotionSnapshot.rule=copy(rule);
  const source={status:'promotion-pending',customerType:'store',ownerType:'store',ownerStoreId:'a',promoterId:'R1',capturedAt:NOW-5*86400000};
  const financialRule={id:'FR1',scope:'global',groupBps:1000,storeBps:1000,version:1,effectiveAt:NOW-6*86400000};
  s.bookings[0].serviceFinanceSnapshot={source:copy(source),rule:copy(financialRule),capturedAt:NOW-5*86400000,origin:'booking-create'};
  s.serviceFinanceEntries=[{id:'E1',kind:'main',bookingId:'B1',paymentId:'P1',storeId:'a',userId:'u2',paidAt:NOW-5*86400000,sourceSnapshot:copy(source),ruleSnapshot:copy(financialRule),split:{id:'SPL1',kind:'split',requestNo:'SPLIT-ORIGINAL',amountCents:4000,status:'success',completedAt:NOW-3*86400000},splitHistory:[],finish:{id:'FIN1',amountCents:16000,status:'success',completedAt:NOW-3*86400000},returns:[],version:1}];
  s.serviceFinanceRules=[financialRule];s.serviceFinanceRequests=[];
  s.serviceFinanceRecoveries=[{id:'FD1',entryId:'E1',bookingId:'B1',paymentId:'P1',storeId:'a',type:'unshared-release',reasonCode:'finished-adjustment',payer:'store:a',payee:'group',version:1,amountCents:1000,receivedCents:0,createdAt:NOW-86400000,records:[],history:[]}];
  upgradeServicePromotion(s);return s;
}
function shortageState() {const s=base();s.bookings[0].refunds=[{id:'RF1',status:'failed',executions:[{paymentId:'P1',refundNo:'RN1',amountCents:20000,status:'failed',createdAt:NOW-86400000,updatedAt:NOW-86400000,results:[{outcome:'failed',at:NOW-86400000}]}]}];upgradeServiceFinanceExtras(s);return s;}
const facts=(file,extra={})=>({file,reference:'SYNTHETIC-REFERENCE',occurredAt:NOW,reason:'PRIVATE BODY ONLY IN ORIGINAL SLOT',...extra});

test('所有原guard输出pure source摘要；未填正文不写，缺岗位/源/旧版拒绝',()=>{
  const cases=[
    [serviceInvoiceState(),{role:'store',storeId:'a'},'invoice.issue',s=>({id:s.serviceInvoices[0].id,version:s.serviceInvoices[0].version})],
    [goodsInvoiceState(),actors.finance,'commerce-invoice.issue',s=>({id:s.commerceInvoices[0].id,version:s.commerceInvoices[0].version})],
    [base(),actors.manager,'qualification.assess',()=>({techId:'t1',version:0})],
    [promotionState(),actors.support,'service-promotion.identity-review',()=>({id:'R1',version:0})],
    [promotionState(),actors.finance,'service-promotion.withdraw-pay',()=>({id:'W1',version:0})],
    [promotionState(),actors.finance,'finance.recovery-receive',()=>({id:'FD1',version:1})]
  ];
  for(const [s,a,type,payload] of cases) {const before=copy(s),p=payload(s),value=privacyUploadScope(s,a,type,p,{selection:selection()});assert.deepEqual(s,before);assert.match(value.sourceToken,/^sha256:/);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|SYNTHETIC-CERT|SYNTHETIC-INS|"phone"|"payload"/);assert.throws(()=>privacyUploadScope(s,{role:'user',userId:'u2'},type,p,{selection:selection()}));assert.throws(()=>privacyUploadScope(s,a,type,{...p,version:99},{selection:selection()}));}
});
test('真实closed原案件上传→实读→原创建→精确图片及attached同clone',async()=>{
  const f=closedFixture(idb),h=harness(f.s,f.user,'care.case-create',{bookingId:'B1'}),saved=await h.registry.save(image());
  const done=await h.submit({bookingId:'B1',category:'quality',description:'PRIVATE complaint',evidenceRefs:[saved.file],requestId:'care-original'},saved.id);
  assert.equal(last(h).status,'attached');assert.equal(last(h).closureId,f.closureId);assert.equal(h.slots[0].source.kind,'care-case');const {sourceToken,...read}=careEvidenceFile(h.s,f.user,done.result.id,'evidence:0',{assertUserScope:userScope});assert.deepEqual(read,saved.file);assert.ok(sourceToken);
});
test('真实资格考核第一档及原内部history副本附着，store author保持原job:null',async()=>{
  const h=harness(base(),actors.manager,'qualification.assess',{techId:'t1',version:0}),saved=await h.registry.save(pdf());
  const done=await h.submit({techId:'t1',version:0,requestId:'qual-original',serviceIds:['SV1'],kind:'mature',batch:'SYNTHETIC-BATCH',assessor:'SYNTHETIC-AUTHOR',proof:'SYNTHETIC-PROOF',occurredAt:NOW,result:'pass',reason:'original facts',evidenceRefs:[saved.file]},saved.id);
  assert.equal(h.slots.length,2);assert.equal(h.slots[0].source.kind,'qualification-profile');const {sourceToken,...read}=qualificationEvidenceFile(h.s,actors.manager,done.result.id,h.slots.find(x=>x.slot.startsWith('assessment:')).slot);assert.deepEqual(read,saved.file);assert.ok(sourceToken);
});
for(const domain of ['service','commerce'])test(`${domain}真实issue与同SHA replace-file，新增当前槽+原history，不重附旧previousFile`,async()=>{
  const s=domain==='service'?serviceInvoiceState():goodsInvoiceState(),prefix=domain==='service'?'invoice':'commerce-invoice',key=domain==='service'?'serviceInvoices':'commerceInvoices',actor=domain==='service'?{role:'store',storeId:'a'}:actors.finance;
  let h=harness(s,actor,prefix+'.issue',{id:s[key][0].id,version:s[key][0].version}),saved=await h.registry.save(pdf());await h.submit({id:s[key][0].id,version:s[key][0].version,ticketNumber:'SYNTHETIC-BLUE',file:saved.file,requestId:'issued-original'},saved.id);
  assert.equal(h.slots.length,2);assert.ok(h.slots.some(x=>x.slot==='issued'));
  const issued=h.s[key][0];h=harness(h.s,actor,prefix+'.replace-file',{id:issued.id,version:issued.version,slot:'issued'});saved=await h.registry.save(pdf());await h.submit({id:issued.id,version:issued.version,slot:'issued',file:saved.file,reason:'original replacement',requestId:'replace-original'},saved.id);
  assert.equal(h.slots.length,2);assert.ok(h.slots.every(x=>!x.path.includes('previousFile')));assert.equal(last(h).status,'attached');
});
test('服务全额退款红票 net0仍按原scope选择及真实red，保留旧权益',async()=>{
  let s=serviceInvoiceState(),row=s.serviceInvoices[0],file=await saveInvoiceFile(pdf());invoiceCommand(s,{role:'store',storeId:'a'},'invoice.issue',{id:row.id,version:row.version,ticketNumber:'BLUE',file,requestId:'before-red'},context(s));
  s.bookings[0].payment.refundedCents=20000;s.bookings[0].refunds=[{id:'REF',status:'success',executions:[{paymentId:'P1',amountCents:20000,status:'success'}]}];syncInvoices(s,context(s));row=s.serviceInvoices[0];assert.equal(row.status,'red_pending');
  const h=harness(s,{role:'store',storeId:'a'},'invoice.red',{id:row.id,version:row.version}),saved=await h.registry.save(pdf());await h.submit({id:row.id,version:row.version,ticketNumber:'RED',file:saved.file,requestId:'red-original'},saved.id);assert.equal(h.slots.length,2);assert.ok(h.slots.some(x=>x.slot==='red'));
});
test('原退款不足新案与门店recharge均真实command，不以选择造资金',async()=>{
  const s=shortageState(),p={bookingId:'B1',paymentId:'P1',refundId:'RF1',version:0,sourceToken:serviceExtraSourceToken(s,'B1','P1')};
  let h=harness(s,actors.store,'service-extra.refund-shortage',p),saved=await h.registry.save(pdf());assert.equal(h.s.serviceRefundShortages.length,0);
  await h.submit({...p,requestId:'shortage-original',failedAt:NOW-86400000,shortageCents:20000,...facts(saved.file,{reference:'RN1',occurredAt:NOW-86400000})},saved.id);assert.equal(h.slots[0].source.kind,'service-refund-shortage');
  const row=h.s.serviceRefundShortages[0];h=harness(h.s,actors.store,'service-extra.recharge',{id:row.id,version:row.version});saved=await h.registry.save(pdf());await h.submit({id:row.id,version:row.version,requestId:'recharge-original',amountCents:500,...facts(saved.file)},saved.id);assert.match(h.slots[0].slot,/^recharge:/);assert.equal(h.s.serviceRefundShortages[0].recharges[0].amountCents,500);
});
for(const [commandName,actor,p] of [
  ['agreement-publish',actors.ops,{promoterType:'store-promoter',version:0,requestId:'agreement-original',title:'SYNTHETIC TITLE',body:'PRIVATE AGREEMENT BODY',effectiveAt:NOW}],
  ['identity-review',actors.support,{id:'R1',version:0,requestId:'identity-original',decision:'verified'}],
  ['risk-review',actors.support,{id:'K1',version:0,requestId:'risk-original',decision:'approved'}],
  ['withdraw-pay',actors.finance,{id:'W1',version:0,requestId:'withdraw-original',outcome:'success'}],
  ['recovery-receive',actors.finance,{id:'D1',version:0,requestId:'recovery-original',amountCents:500}],
  ['recovery-loss',actors.finance,{id:'D1',version:0,requestId:'loss-original',amountCents:500}]
])test(`推广${commandName}原scope允许未填正文→真实prepare/command最小结果→本次准确槽`,async()=>{
  const s=promotionState();if(commandName==='withdraw-pay'){s.servicePromotionRisks=[];s.serviceFinanceRecoveries=[];s.servicePromotionRecoveries=[];const v=serviceFinanceSummary(s,'B1','P1');assert.equal(v.canPayTech,true,JSON.stringify({status:v.status,reason:v.eligibilityReason,known:v.known,additional:v.pendingAdditionalCents,returns:v.totalReturnPendingCents,blockers:v.blockers}));}
  const select=commandName==='agreement-publish'?{promoterType:p.promoterType,version:0,requestId:p.requestId}:{id:p.id,version:p.version},h=harness(s,actor,'service-promotion.'+commandName,select),saved=await h.registry.save(pdf());
  await h.submit({...p,...facts(saved.file)},saved.id);assert.equal(last(h).status,'attached');assert.ok(h.slots.length);assert.ok(h.slots.every(x=>!x.path.includes('identityHistory')&&!x.path.includes('reviewHistory')));
});
test('原推广关联财务recovery真实原收款及实际record槽，无附件旧财务不得假scope',async()=>{
  const s=promotionState();s.servicePromotionRisks=[];s.serviceFinanceEntries[0].split.amountCents=1000;syncServiceFinance(s,context(s));const version=s.serviceFinanceRecoveries[0].version;assert.equal(serviceFinanceSummary(s,'B1','P1').known,true);const h=harness(s,actors.finance,'finance.recovery-receive',{id:'FD1',version}),saved=await h.registry.save(pdf());await h.submit({id:'FD1',version,requestId:'finance-original',amountCents:500,...facts(saved.file)},saved.id);assert.match(h.slots[0].slot,/^recovery:/);assert.equal(h.s.serviceFinanceRecoveries[0].receivedCents,500);
  delete s.bookings[0].servicePromotionSnapshot;delete s.serviceFinanceRecoveries[0].reasonCode;assert.throws(()=>privacyUploadScope(s,actors.finance,'finance.recovery-receive',{id:'FD1',version:1},{selection:selection()}),/没有/);
});
test('原公共新商品requestId→真实void command result→新product图，旧商品同步SKU实际副本',async()=>{
  const s=base();upgradeManagement(s);let h=harness(s,actors.ops,'manage.product-save',{requestId:'new-product'},{field:'image'}),saved=await h.registry.save(image());await h.submit({requestId:'new-product',reason:'synthetic operation',name:'SYNTHETIC PRODUCT',categoryId:s.categories[0].id,description:'PRIVATE DESCRIPTION',image:saved.file.ref,gallery:[]},saved.id);assert.equal(h.slots[0].source.kind,'catalog-product');
  const row=h.s.products[0],next=copy(h.s);next.skus=[{id:'SKU1',productId:row.id,image:'',version:1}];h=harness(next,actors.ops,'manage.product-save',{id:row.id,version:row.version},{field:'image'});saved=await h.registry.save(image());await h.submit({id:row.id,version:row.version,requestId:'update-product',reason:'synthetic operation',name:'SYNTHETIC UPDATED',categoryId:s.categories[0].id,description:'updated',image:saved.file.ref,gallery:[]},saved.id);assert.ok(h.slots.some(x=>x.slot==='materialized-image:SKU1'));
});
test('原详情图空槽packing由可信四槽证明，不拿payload声明索引或同ref另一槽冒附着',async()=>{
  const s=base();upgradeManagement(s);const h=harness(s,actors.ops,'manage.product-save',{requestId:'gallery-product'},{field:'gallery2'}),saved=await h.registry.save(image());h.options.galleryFields=['','',saved.file.ref,''];await h.submit({requestId:'gallery-product',reason:'synthetic operation',name:'SYNTHETIC',categoryId:s.categories[0].id,description:'',image:'',gallery:[saved.file.ref]},saved.id);assert.deepEqual(h.slots[0].path.slice(2),['gallery',0]);
  assert.throws(()=>privacyUploadAttachmentSlots({},h.s,actors.ops,'manage.product-save',{},null,last(h),{field:'gallery2'}));
});
test('同ref另一案/伪结果/伪新request/旧source均拒，state保持不变',async()=>{
  const s=serviceInvoiceState(),p={id:s.serviceInvoices[0].id,version:s.serviceInvoices[0].version},h=harness(s,{role:'store',storeId:'a'},'invoice.issue',p),saved=await h.registry.save(pdf()),done=await h.submit({...p,ticketNumber:'BLUE',file:saved.file,requestId:'real-issued'},saved.id),reservation={...copy(last(h)),status:'saved',usable:true};
  for(const mutate of [d=>d.result.id='OTHER',d=>d.after.serviceInvoiceRequests.at(-1).invoiceId='OTHER',d=>d.after.serviceInvoiceRequests.at(-1).actor='{}',d=>d.after.serviceInvoiceRequests.at(-1).fingerprint=hash({type:'other'}),d=>d.before.bookings[0].payment.id='OTHER']) {const d=copy(done),unchanged=copy(d);mutate(d);const current=copy(d);assert.throws(()=>privacyUploadAttachmentSlots(d.before,d.after,{role:'store',storeId:'a'},'invoice.issue',d.payload,d.result,reservation));assert.deepEqual(d,current);assert.ok(unchanged);}
});
test('失效真实session/无原选择代次/重复源/不存在identity文件用途均实读前拒',async()=>{
  const s=promotionState();s.staffAccounts=[{id:'ACC',version:1,enabled:true,grants:[{id:'GR',enabled:true,role:'group',job:'support'}]}];s.staffSessions=[{id:'SESSION',accountId:'ACC',grantId:'GR',accountVersion:1,revokedAt:NOW}];
  assert.throws(()=>privacyUploadScope(s,{sessionId:'SESSION'},'service-promotion.identity-review',{id:'R1',version:0},{selection:selection()}),/失效/);
  assert.throws(()=>privacyUploadScope(s,actors.support,'service-promotion.identity-review',{id:'R1',version:0},{selection:{}}),/代次/);
  s.servicePromoters.push(copy(s.servicePromoters[0]));assert.throws(()=>privacyUploadScope(s,actors.support,'service-promotion.identity-review',{id:'R1',version:0},{selection:selection()}),/不唯一/);
  assert.throws(()=>privacyUploadScope(base(),{role:'group',job:'account-admin'},'lifecycle.identity-link',{techId:'t1',userId:'u1'},{selection:selection()}),/只有文字/);
});
test('已知公共inline原字节SHA→原media库保存→唯一等价叶附着，不虚构业务request',async()=>{
  const s=base();s.products=[{id:'PD1',version:1,image:'data:image/png;base64,'+PNG.toString('base64'),gallery:[],history:[]}];const chosen=selection(),path=['products',0,'image'];let actual=s;
  const ready=await preparePrivacyInlineUpload({currentContext:()=>({state:actual,actor:actors.user}),path,selection:chosen}),h=harness(s,actors.user,'media.legacy-externalize',{}, {legacyProof:ready.proof});Object.assign(h.selection,chosen);const saved=await h.registry.save(ready.file),before=copy(h.s),after=copy(before);after.products[0].image=saved.file.ref;
  const slots=privacyUploadAttachmentSlots(before,after,actors.user,'media.legacy-externalize',{},undefined,last(h),{legacyProof:ready.proof});assert.equal(slots.length,1);assert.deepEqual(Buffer.from(await (await readMedia(saved.file)).arrayBuffer()),PNG);assert.equal(after.managementRequests,undefined);
  after.products[0].name='unexpected edit';assert.throws(()=>privacyUploadAttachmentSlots(before,after,actors.user,'media.legacy-externalize',{},undefined,last(h),{legacyProof:ready.proof}),/以外/);
});
test('旧inline未知正文/草稿/重号/伪proof/实际不同字节不发布附着',async()=>{
  const s=base(),inline='data:image/png;base64,'+PNG.toString('base64');s.products=[{id:'PD1',version:1,image:inline,description:inline,gallery:[]}];
  await assert.rejects(preparePrivacyInlineUpload({currentContext:()=>({state:s,actor:actors.user}),path:['products',0,'description'],selection:selection()}),/准确叶/);
  assert.throws(()=>privacyUploadScope(s,actors.user,'media.legacy-externalize',{}, {selection:selection(),legacyProof:{source:{kind:'catalog-product',id:'PD1'}}}),/等价核验/);
  const ready=await preparePrivacyInlineUpload({currentContext:()=>({state:s,actor:actors.user}),path:['products',0,'image'],selection:selection()}),h=harness(s,actors.user,'media.legacy-externalize',{}, {legacyProof:ready.proof}),saved=await h.registry.save(new File([PNG,'different'],'different.png',{type:'image/png'})),after=copy(h.s);after.products[0].image=saved.file.ref;
  assert.throws(()=>privacyUploadAttachmentSlots(h.s,after,actors.user,'media.legacy-externalize',{},null,last(h),{legacyProof:ready.proof}),/不等价/);assert.equal(last(h).status,'saved');assert.equal(idb.events.filter(e=>e.op==='delete').length,0);
});

test('原案件本人新statement图片精确新子源，不挂已有原案图片槽',async()=>{
  const s=base();s.bookings[0].completedAt=NOW-3600000;const user={role:'user',userId:'u2'},row=careCommand(s,user,'care.case-create',{bookingId:'B1',category:'quality',description:'original facts',requestId:'care-before'},context(s));
  const h=harness(s,user,'care.case-statement',{id:row.id,version:row.version}),saved=await h.registry.save(image());await h.submit({id:row.id,version:row.version,text:'new actual statement',evidenceRefs:[saved.file],requestId:'statement-original'},saved.id);assert.match(h.slots[0].slot,/^statement:/);assert.equal(h.slots.length,1);
});
test('原资格申请/批准/暂停/复训恢复选择复用历史档及完整submit守卫',async()=>{
  const s=base();let profile=qualificationCommand(s,actors.manager,'qualification.assess',{techId:'t1',version:0,requestId:'qual-setup',serviceIds:['SV1'],kind:'mature',batch:'FIRST',assessor:'A',proof:'P',occurredAt:NOW,result:'pass',reason:'original'},context(s));
  let h=harness(s,actors.manager,'qualification.request',{techId:'t1',version:profile.version,assessmentId:profile.assessments[0].id}),saved=await h.registry.save(pdf());await h.submit({techId:'t1',version:profile.version,assessmentId:profile.assessments[0].id,reason:'original request',requestId:'qual-request',evidenceRefs:[saved.file]},saved.id);assert.ok(h.slots.some(x=>x.slot.startsWith('request:')));
  profile=h.s.techQualifications[0];h=harness(h.s,actors.ops,'qualification.review',{techId:'t1',version:profile.version,grantId:profile.grants[0].id});saved=await h.registry.save(pdf());await h.submit({techId:'t1',version:profile.version,grantId:profile.grants[0].id,decision:'approve',reviewer:'REVIEWER',proof:'APPROVAL',reason:'actual approval',requestId:'qual-approve',evidenceRefs:[saved.file]},saved.id);assert.ok(h.slots.some(x=>x.slot.startsWith('review:')));
  profile=h.s.techQualifications[0];h=harness(h.s,actors.manager,'qualification.pause',{techId:'t1',version:profile.version});saved=await h.registry.save(pdf());await h.submit({techId:'t1',version:profile.version,serviceIds:['SV1'],owner:'OWNER',reason:'pause fact',requestId:'qual-pause',evidenceRefs:[saved.file]},saved.id);assert.ok(h.slots.some(x=>x.slot.startsWith('pause:')));
  const state=copy(h.s),hold=state.techQualifications[0].holds[0];profile=qualificationCommand(state,actors.manager,'qualification.assess',{techId:'t1',version:state.techQualifications[0].version,requestId:'qual-retrain',serviceIds:['SV1'],kind:'retraining',holdId:hold.id,batch:'RETRAIN',assessor:'A',proof:'P',occurredAt:NOW,result:'pass',reason:'actual retraining'},context(state));
  profile=qualificationCommand(state,actors.manager,'qualification.request',{techId:'t1',version:profile.version,requestId:'qual-retrain-request',assessmentId:profile.assessments.at(-1).id,reason:'original request'},context(state));
  profile=qualificationCommand(state,actors.ops,'qualification.review',{techId:'t1',version:profile.version,requestId:'qual-retrain-approve',grantId:profile.grants.at(-1).id,decision:'approve',reviewer:'A',proof:'P',reason:'original approval'},context(state));
  h=harness(state,actors.ops,'qualification.resume',{techId:'t1',version:profile.version,holdId:hold.id});saved=await h.registry.save(pdf());await h.submit({techId:'t1',version:profile.version,holdId:hold.id,reviewer:'A',reason:'actual restore',requestId:'qual-resume',evidenceRefs:[saved.file]},saved.id);assert.ok(h.slots.some(x=>x.slot.startsWith('resume:')));
});
async function actualShortage() {
  const s=shortageState(),file=await saveInvoiceFile(pdf()),p={bookingId:'B1',paymentId:'P1',refundId:'RF1',version:0,sourceToken:serviceExtraSourceToken(s,'B1','P1'),requestId:'initial-shortage',failedAt:NOW-86400000,shortageCents:20000,...facts(file,{reference:'RN1',occurredAt:NOW-86400000})};
  const verified=await preparation(s,actors.store,'service-extra.refund-shortage',p);serviceFinanceExtrasCommand(s,actors.store,'service-extra.refund-shortage',p,context(s,verified));return s;
}
async function actualAdvance({processing=false}={}) {
  const s=await actualShortage(),policy=serviceFinanceExtrasCommand(s,actors.finance,'service-extra.policy-publish',{path:'merchant-balance',version:0,effectiveAt:NOW,basis:'explicit isolated Demo only',requestId:'advance-policy'},context(s)),issue=s.serviceRefundShortages[0];
  serviceFinanceExtrasCommand(s,actors.finance,'service-extra.advance-decision',{id:issue.id,version:issue.version,decision:'approve',path:'merchant-balance',policyId:policy.id,amountCents:20000,reason:'actual decision',requestId:'advance-decision'},context(s));
  if(processing)serviceFinanceExtrasCommand(s,actors.finance,'service-extra.advance-pay',{id:issue.id,version:issue.version,advanceId:issue.advances[0].id,outcome:'processing',requestId:'advance-processing'},context(s));
  return s;
}
test('原payment历史依据提交来源版本及精确原金额/技术号，附件只入待核不伪批准',async()=>{
  const s=base();s.serviceFinanceEntries=[{id:'E1',bookingId:'B1',paymentId:'P1',storeId:'a',version:1,paidAt:s.bookings[0].payment.paidAt}];upgradeServiceFinanceExtras(s);
  const p={bookingId:'B1',paymentId:'P1',kind:'payment',version:0,sourceVersion:1,sourceToken:serviceExtraSourceToken(s,'B1','P1')},h=harness(s,actors.store,'service-extra.evidence-submit',p),saved=await h.registry.save(pdf());
  await h.submit({...p,payload:{amountCents:20000,paidAt:s.bookings[0].payment.paidAt,channelReference:'CH-P1'},requestId:'history-payment',...facts(saved.file,{reference:'CH-P1',occurredAt:s.bookings[0].payment.paidAt})},saved.id);assert.equal(h.s.serviceExtraEvidence[0].status,'requested');assert.equal(h.slots[0].source.kind,'service-extra-evidence');
});
for(const query of [false,true])test(`原merchant advance ${query?'query':'pay'}真实凭证/原资金事实及派生债，精确advance槽`,async()=>{
  const s=await actualAdvance({processing:query}),issue=s.serviceRefundShortages[0],p={id:issue.id,version:issue.version,advanceId:issue.advances[0].id},h=harness(s,actors.finance,'service-extra.advance-'+(query?'query':'pay'),p),saved=await h.registry.save(pdf());await h.submit({...p,outcome:'success',requestId:'advance-final',...facts(saved.file,{reference:'ACTUAL-ADVANCE'})},saved.id);assert.match(h.slots[0].slot,/^advance:/);assert.equal(h.s.serviceExtraRecoveries[0].amountCents,20000);assert.equal(h.s.bookings[0].payment.refundedCents,0);
});
test('原垫付债实际receive复用实际advance来源，原records槽与金额准确',async()=>{
  const s=await actualAdvance(),issue=s.serviceRefundShortages[0],file=await saveInvoiceFile(pdf()),p={id:issue.id,version:issue.version,advanceId:issue.advances[0].id,outcome:'success',requestId:'fund-before-receive',...facts(file,{reference:'ADVANCE-BANK'})},verified=await preparation(s,actors.finance,'service-extra.advance-pay',p);serviceFinanceExtrasCommand(s,actors.finance,'service-extra.advance-pay',p,context(s,verified));
  const debt=s.serviceExtraRecoveries[0],h=harness(s,actors.finance,'service-extra.recovery-receive',{id:debt.id,version:debt.version}),saved=await h.registry.save(pdf());await h.submit({id:debt.id,version:debt.version,amountCents:500,requestId:'debt-receive',...facts(saved.file,{reference:'RECEIVE-BANK'})},saved.id);assert.match(h.slots[0].slot,/^record:/);assert.equal(h.s.serviceExtraRecoveries[0].receivedCents,500);
});
test('isolated原历史direct款与另笔原成功退款输入，真实reconcile-return命令保留双方旧资金',async()=>{
  const s=await actualShortage(),issue=s.serviceRefundShortages[0],part=s.bookings[0].refunds[0].executions[0];part.status='success';s.bookings[0].refunds[0].status='success';s.bookings[0].payment.refundedCents=20000;
  // Explicit isolated historical source. This is not a new successful pay and
  // does not claim a real bank transfer or change the normal close policy.
  issue.advances=[{id:'HISTORICAL-DIRECT',path:'direct-user',status:'needs-review',amountCents:20000,createdAt:NOW-1000,execution:{status:'success',proof:{occurredAt:NOW-500,reference:'HISTORICAL-BANK',evidenceRefs:[]}}}];
  const h=harness(s,actors.finance,'service-extra.advance-reconcile',{id:issue.id,version:issue.version,advanceId:'HISTORICAL-DIRECT',action:'return'}),saved=await h.registry.save(pdf());await h.submit({id:issue.id,version:issue.version,advanceId:'HISTORICAL-DIRECT',action:'return',amountCents:500,requestId:'direct-return',...facts(saved.file)},saved.id);assert.match(h.slots[0].slot,/^advance-return:/);assert.equal(h.s.bookings[0].payment.refundedCents,20000);assert.equal(h.s.serviceRefundShortages[0].advances[0].returnedCents,500);
});
test('原推广query实际新result及当前proof双用途；原超收return精确新record',async()=>{
  let s=promotionState();s.servicePromotionRisks=[];s.servicePromotionRecoveries=[];s.serviceFinanceRecoveries=[];servicePromotionCommand(s,actors.finance,'service-promotion.withdraw-pay',{id:'W1',version:0,outcome:'processing',requestId:'withdraw-inflight'},context(s));
  let row=s.servicePromotionWithdrawals[0],h=harness(s,actors.finance,'service-promotion.withdraw-query',{id:row.id,version:row.version}),saved=await h.registry.save(pdf());await h.submit({id:row.id,version:row.version,outcome:'success',requestId:'withdraw-query',...facts(saved.file)},saved.id);assert.equal(h.slots.length,2);assert.ok(h.slots.some(x=>x.slot==='payment:0'));assert.ok(h.slots.some(x=>x.slot.startsWith('result:')));
  s=promotionState();s.servicePromotionRecoveries[0].records=[{id:'ISOLATED-OLD-CASH',kind:'cash',amountCents:1500,storeCents:750,groupCents:750,reference:'ISOLATED-OLD-BANK',occurredAt:NOW-1000,at:NOW-1000}];row=s.servicePromotionRecoveries[0];h=harness(s,actors.finance,'service-promotion.recovery-return',{id:row.id,version:row.version});saved=await h.registry.save(pdf());await h.submit({id:row.id,version:row.version,amountCents:500,requestId:'promotion-return',...facts(saved.file)},saved.id);assert.equal(h.slots.length,1);assert.match(h.slots[0].slot,/^record:/);assert.equal(h.s.servicePromotionRecoveries[0].records.at(-1).kind,'return');
});
test('原offset-return真实命令的新方案return和原债record副本均准确入附着关系',async()=>{
  const s=base(),b=s.bookings[0];b.payment.refundedCents=20000;b.refunds=[{id:'R1',status:'success',executions:[{paymentId:'P1',amountCents:20000,status:'success'}]}];
  // Isolated historical successful combination, not a new channel success.
  s.serviceFinanceEntries=[{id:'E1',kind:'main',bookingId:'B1',paymentId:'P1',storeId:'a',userId:'u2',version:1,paidAt:b.payment.paidAt,sourceSnapshot:{status:'known',customerType:'group'},ruleSnapshot:{groupBps:1000,storeBps:500},split:{id:'SPL1',status:'success',amountCents:2000,channelTotalCents:4000,completedAt:NOW-86400000,serviceExtraPlanId:'O1'},splitHistory:[],returns:[]}];
  // This isolated historical combination includes the original booking capture;
  // a current finance row alone cannot prove the original source/rule existed.
  b.serviceFinanceSnapshot={source:copy(s.serviceFinanceEntries[0].sourceSnapshot),rule:copy(s.serviceFinanceEntries[0].ruleSnapshot),capturedAt:b.createdAt,origin:'booking-create'};
  s.serviceFinanceRecoveries=[];upgradeServiceFinanceExtras(s);s.serviceExtraRecoveries=[{id:'D1',bookingId:'B1',paymentId:'P1',storeId:'a',amountCents:5000,receivedCents:2000,payer:'store:a',payee:'group',version:0,records:[],history:[]}];s.serviceExtraOffsets=[{id:'O1',entryId:'E1',bookingId:'B1',paymentId:'P1',storeId:'a',recoveryId:'D1',version:1,status:'succeeded',completedAt:NOW-86400000,recoveryCents:2000,normalCents:2000,returnRecords:[],history:[]}];
  const h=harness(s,actors.finance,'service-extra.offset-return',{id:'O1',version:1}),saved=await h.registry.save(pdf()),done=await h.submit({id:'O1',version:1,amountCents:500,requestId:'offset-return',...facts(saved.file)},saved.id);assert.equal(h.s.serviceExtraRecoveries[0].receivedCents,1500);assert.equal(h.slots.length,2);assert.ok(h.slots.some(x=>x.source.kind==='service-extra-recovery'&&x.source.id==='D1'));
  const reservation={...copy(last(h)),status:'saved',usable:true},missing=copy(done.after);missing.serviceExtraRecoveries[0].records=[];assert.throws(()=>privacyUploadAttachmentSlots(done.before,missing,actors.finance,'service-extra.offset-return',done.payload,done.result,reservation),/副本/);
  const wrong=copy(done.after);wrong.serviceExtraRecoveries[0].records.at(-1).amountCents++;assert.throws(()=>privacyUploadAttachmentSlots(done.before,wrong,actors.finance,'service-extra.offset-return',done.payload,done.result,reservation),/副本/);
});
test('原商品全额退款red/替换保持净额0原权利及历史文件副本',async()=>{
  const s=goodsInvoiceState(),file=await saveInvoiceFile(pdf());let row=s.commerceInvoices[0];commerceInvoiceCommand(s,actors.finance,'commerce-invoice.issue',{id:row.id,version:row.version,ticketNumber:'BLUE',file,requestId:'goods-blue'},context(s));
  s.goods[0].lines[0].refundedCents=10000;s.goods[0].cases=[{id:'GC1',status:'done',amountCents:10000,shippingCents:0,allocations:[{skuId:'S1',amountCents:10000}]}];s.goods[0].refunds=[{id:'GR1',caseId:'GC1',amountCents:10000,status:'success'}];syncCommerceInvoices(s,context(s));row=s.commerceInvoices[0];assert.equal(row.status,'red_pending');
  let h=harness(s,actors.finance,'commerce-invoice.red',{id:row.id,version:row.version}),saved=await h.registry.save(pdf());await h.submit({id:row.id,version:row.version,ticketNumber:'RED',file:saved.file,requestId:'goods-red'},saved.id);assert.equal(h.slots.length,2);
  row=h.s.commerceInvoices[0];h=harness(h.s,actors.finance,'commerce-invoice.replace-file',{id:row.id,version:row.version,slot:'red'});saved=await h.registry.save(pdf());await h.submit({id:row.id,version:row.version,slot:'red',file:saved.file,reason:'actual replacement',requestId:'goods-red-replace'},saved.id);assert.equal(h.slots.length,2);
});
test('新登记同SHA已在原公共主图，真实新version仍记录当前选用而不挂旧history',async()=>{
  const s=base();upgradeManagement(s);const ref=await saveMedia(image());managementCommand(s,actors.ops,'manage.product-save',{requestId:'product-before',name:'ORIGINAL',reason:'isolated original',image:ref,gallery:[],description:''},context(s));const row=s.products[0],h=harness(s,actors.ops,'manage.product-save',{id:row.id,version:row.version},{field:'image'}),saved=await h.registry.save(image());await h.submit({id:row.id,version:row.version,requestId:'product-again',name:'ORIGINAL',reason:'explicit same image choice',image:saved.file.ref,gallery:[],description:''},saved.id);assert.equal(h.slots.length,1);assert.deepEqual(h.slots[0].path.slice(2),['image']);
});
for(const query of [false,true])test(`原direct advance ${query?'query':'pay'}真实桥结清退款，实际新offlinePaymentFacts附件副本保持来源`,async()=>{
  const s=await actualShortage(),issue=s.serviceRefundShortages[0],r=s.bookings[0].refunds[0];Object.assign(r,{version:1,createdAt:NOW-86400000,lines:[{paymentId:'P1',amountCents:20000}]});r.executions[0].attempts=1;
  const policy=serviceFinanceExtrasCommand(s,actors.finance,'service-extra.policy-publish',{path:'direct-user',version:0,effectiveAt:NOW,basis:'explicit isolated Demo path',requestId:'direct-policy'},context(s));serviceFinanceExtrasCommand(s,actors.finance,'service-extra.advance-decision',{id:issue.id,version:issue.version,decision:'approve',path:'direct-user',policyId:policy.id,amountCents:20000,reason:'actual decision',requestId:'direct-decision'},context(s));const advance=issue.advances[0];serviceFinanceExtrasCommand(s,{role:'user',userId:'u2'},'service-extra.advance-confirm',{id:issue.id,version:issue.version,advanceId:advance.id,decision:'accept',reason:'original complete refund consent',requestId:'direct-consent'},context(s));
  if(query)serviceFinanceExtrasCommand(s,actors.finance,'service-extra.advance-pay',{id:issue.id,version:issue.version,advanceId:advance.id,outcome:'processing',requestId:'direct-processing'},context(s));
  const type='service-extra.advance-'+(query?'query':'pay'),p={id:issue.id,version:issue.version,advanceId:advance.id},h=harness(s,actors.finance,type,p),saved=await h.registry.save(pdf()),done=await h.submit({...p,outcome:'success',requestId:'direct-final',...facts(saved.file,{reference:'DIRECT-BANK'})},saved.id);assert.equal(h.s.bookings[0].payment.refundedCents,20000);assert.equal(h.s.bookings[0].refunds[0].offlinePaymentFacts.length,1);assert.equal(h.slots.length,2);assert.ok(h.slots.some(x=>x.source.kind==='booking'&&x.path.includes('offlinePaymentFacts')));
  const reservation={...copy(last(h)),status:'saved',usable:true},missing=copy(done.after);missing.bookings[0].refunds[0].offlinePaymentFacts=[];assert.throws(()=>privacyUploadAttachmentSlots(done.before,missing,actors.finance,type,done.payload,done.result,reservation),/副本/);
  const wrong=copy(done.after);wrong.bookings[0].refunds[0].offlinePaymentFacts[0].paymentId='OTHER';assert.throws(()=>privacyUploadAttachmentSlots(done.before,wrong,actors.finance,type,done.payload,done.result,reservation),/副本/);
  const altered=copy(done.after);altered.bookings[0].payment.refundedCents--;assert.throws(()=>privacyUploadAttachmentSlots(done.before,altered,actors.finance,type,done.payload,done.result,reservation),/资金来源/);
});
test('实际fee原月度来源表单选择/签发，准确store与group主体不猜用户',async()=>{
  const s=base();s.now=Date.parse('2026-11-02T12:00:00+08:00');s.serviceFinanceEntries=[{id:'E-FEE',kind:'main',bookingId:'B1',paymentId:'P1',storeId:'a',split:{id:'SPL-FEE',kind:'split',status:'success',requestNo:'FEE-SPLIT',amountCents:2000,completedAt:Date.parse('2026-09-30T10:00:00+08:00')},splitHistory:[],finish:{id:'FIN-FEE',status:'success',amountCents:18000},returns:[]}];s.serviceFinanceRecoveries=[];
  commerceInvoiceCommand(s,actors.finance,'commerce-invoice.rule-publish',{category:'fee',version:0,issuerName:'SYNTHETIC ISSUER',issuerTaxId:'91320100000000000Y',invoiceItem:'SYNTHETIC ITEM',effectiveAt:s.now,sourceFromAt:Date.parse('2026-01-01T00:00:00+08:00'),reason:'explicit isolated Demo fee',applicationStage:'paid',shipping:'include',windowDays:90,cycle:'monthly',timezoneMinutes:480,returnPolicy:'original-income-fifo',requestId:'fee-rule'},context(s));commerceInvoiceCommand(s,actors.store,'commerce-invoice.apply-fee',{storeId:'a',month:'2026-09',requestId:'fee-apply',...title},context(s));const row=s.commerceInvoices[0],h=harness(s,actors.finance,'commerce-invoice.issue',{id:row.id,version:row.version}),saved=await h.registry.save(pdf());await h.submit({id:row.id,version:row.version,ticketNumber:'FEE-BLUE',file:saved.file,requestId:'fee-issue'},saved.id);assert.deepEqual(last(h).subjectBinding.subjects,[{kind:'store',id:'a'},{kind:'group',id:'group'}]);assert.equal(h.slots.length,2);
});
test('实际不同选择附件metadata/新槽缺失及原命令旧幂等无新事件均不能附着',async()=>{
  const s=serviceInvoiceState(),p={id:s.serviceInvoices[0].id,version:s.serviceInvoices[0].version},h=harness(s,{role:'store',storeId:'a'},'invoice.issue',p),saved=await h.registry.save(pdf()),done=await h.submit({...p,ticketNumber:'BLUE',file:saved.file,requestId:'issued'},saved.id),reservation={...copy(last(h)),status:'saved',usable:true};
  const wrong=copy(reservation);wrong.file.size++;assert.throws(()=>privacyUploadAttachmentSlots(done.before,done.after,{role:'store',storeId:'a'},'invoice.issue',done.payload,done.result,wrong),/元数据/);
  const replay=copy(done.after);assert.throws(()=>privacyUploadAttachmentSlots(replay,replay,{role:'store',storeId:'a'},'invoice.issue',done.payload,done.result,reservation));
  const missing=copy(done.after);delete missing.serviceInvoices[0].issued.file;assert.throws(()=>privacyUploadAttachmentSlots(done.before,missing,{role:'store',storeId:'a'},'invoice.issue',done.payload,done.result,reservation));
});
test('原inline异步读取后切源或撤权、未知已闭域本人公共用途均零put',async()=>{
  const s=base();s.products=[{id:'PD1',version:1,image:'data:image/png;base64,'+PNG.toString('base64'),gallery:[]}];let calls=0;await assert.rejects(preparePrivacyInlineUpload({currentContext:()=>{if(calls++)s.products[0].version++;return {state:s,actor:actors.user};},path:['products',0,'image'],selection:selection()}),/变化/);assert.equal(idb.events.filter(e=>e.op==='put').length,0);
  const f=closedFixture(idb),state=copy(f.s);state.products=copy(s.products);const chosen=selection(),ready=await preparePrivacyInlineUpload({currentContext:()=>({state,actor:f.user}),path:['products',0,'image'],selection:chosen}),h=harness(state,f.user,'media.legacy-externalize',{}, {legacyProof:ready.proof});Object.assign(h.selection,chosen);await assert.rejects(h.registry.save(ready.file),/已关闭/);assert.equal(idb.events.filter(e=>e.op==='put').length,0);
});

for(const category of ['goods','fee'])test(`真实工作财务${category} issue附着沿原commerce accountId作者，切账户/伪作者拒绝`,async()=>{
  const s=category==='goods'?goodsInvoiceState():feeInvoiceState(),first=workingStaff(s,'finance','SYNTHETIC FINANCE A'),second=workingStaff(s,'finance','SYNTHETIC FINANCE B'),row=s.commerceInvoices[0],p={id:row.id,version:row.version},h=harness(s,first,'commerce-invoice.issue',p),saved=await h.registry.save(pdf()),done=await h.submit({...p,ticketNumber:'WORK-'+category,file:saved.file,requestId:'work-issue-'+category},saved.id);
  assert.equal(last(h).status,'attached');assert.equal(last(h).uploadedBy.actorMode,'work-session');assert.equal(last(h).uploadedBy.accountId,first.accountId);assert.equal(h.slots.length,2);assert.equal(JSON.parse(done.after.commerceInvoiceRequests.at(-1).actor).id,first.accountId);
  const reservation={...copy(last(h)),status:'saved',usable:true};assert.throws(()=>privacyUploadAttachmentSlots(done.before,done.after,second,'commerce-invoice.issue',done.payload,done.result,reservation),/来源|作者/);
  const forged=copy(done.after),author=JSON.parse(forged.commerceInvoiceRequests.at(-1).actor);author.accountId=second.accountId;author.id=second.accountId;author.grantId=second.grantId;forged.commerceInvoiceRequests.at(-1).actor=JSON.stringify(author);assert.throws(()=>privacyUploadAttachmentSlots(done.before,forged,first,'commerce-invoice.issue',done.payload,done.result,reservation),/作者/);
  const badAudit=copy(done.after);badAudit.commerceInvoices[0].history.at(-1).actor.accountId=second.accountId;const fakeResult=copy(badAudit.commerceInvoices[0]);assert.throws(()=>privacyUploadAttachmentSlots(done.before,badAudit,first,'commerce-invoice.issue',done.payload,fakeResult,reservation),/作者/);
});
