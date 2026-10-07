import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexedDBStandin, fixture, NOW } from './privacy-cleanup-test-fixture.mjs';
import { privacyCleanupInventory, privacyCleanupInventoryView, collectPrivacyFileReferences } from './privacy-cleanup-inventory.mjs';
import { accountCommand, upgradeAccounts, resolveAccountActor } from './staff-accounts.mjs';
import { privacyCommand, privacyProfile } from './privacy.mjs';
import { invoiceCommand, upgradeInvoices } from './service-invoices.mjs';
import { servicePromotionCommand, upgradeServicePromotion } from './service-promotion.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';
import { saveInvoiceFile, readInvoiceFile } from './invoice-files.mjs';
import { closedRightsView } from './privacy-closed-rights.mjs';
import { lifecycleFingerprint } from './organization-lifecycle-projection.mjs';

// Pure/runtime unit source inventory. Original commands create real source rows;
// Blob/hash/save/read are original functions, IDB is synthetic. No browser data,
// policy approval, physical cleanup, or business algorithms are recreated here.
const idb=createIndexedDBStandin(),previousIDB=globalThis.indexedDB;
globalThis.indexedDB=idb.indexedDB;
test.after(()=>{globalThis.indexedDB=previousIDB;});
const file={ref:'invoice-file:'+'a'.repeat(64),name:'internal.pdf',type:'application/pdf',size:20};
const directory=f=>privacyCleanupInventory(f.s,'u1',f.closureId,{coverage:f.coverage});
const field=(inv,path)=>inv.items.find(x=>JSON.stringify(x.path)===JSON.stringify(path));
const fresh=()=>fixture(idb);

async function originalSources() {
  let s={schema:5,now:NOW,seq:0,users:[{id:'u1',name:'PRIVATE-NAME',phone:'13800001111'},{id:'u2'}],stores:[{id:'s1'}],techs:[{id:'t1',storeId:'s1'}],bookings:[{id:'B1',userId:'u1',storeId:'s1',techId:'t1',status:'done',createdAt:NOW-20000,completedAt:NOW-15000,contactName:'PRIVATE-CONTACT',phone:'13800001111',payment:{id:'P1',status:'success',createdAt:NOW-19000,paidAt:NOW-19000,amountCents:20000,refundedCents:0},refunds:[],extensions:[],disputes:[]}],goods:[],logs:[]};
  upgradeAccounts(s);upgradeInvoices(s);upgradeServicePromotion(s);let seq=0;
  function run(fn,actor,type,p,verified=[]) {const next=structuredClone(s),out=fn(next,actor,type,{requestId:'inventory-original-'+(++seq),...p},{id:prefix=>prefix+(++next.seq),log(){},fail(message){throw Error(message);},validateEvidenceRefs:refs=>refs.every(x=>verified.some(v=>JSON.stringify(v)===JSON.stringify(x)))});s=next;return out;}
  const user={role:'user',userId:'u1'},entered=run(accountCommand,user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(s,entered);
  function work(job) {const a=run(accountCommand,admin,'account.create',{name:'隔离'+job,reason:'隔离实际source测试'}),granted=run(accountCommand,admin,'account.grant',{id:a.id,version:a.version,job,reason:'原实际岗位'}),entered=run(accountCommand,user,'account.enter',{accountId:a.id,grantId:granted.grants[0].id});return resolveAccountActor(s,entered);}
  const support=work('support'),operations=work('operations'),store={role:'store',storeId:'s1'};
  const pdf=label=>Object.assign(new Blob(['%PDF-1.4\n'+label+'\n%%EOF'],{type:'application/pdf'}),{name:label+'.pdf'}),one=await saveInvoiceFile(pdf('synthetic-one')),two=await saveInvoiceFile(pdf('synthetic-two'));
  const promotion=async(actor,type,p)=>{const payload={requestId:'promotion-'+(++seq),...p},verified=await prepareServicePromotionEvidence(s,actor,type,payload,{readFile:readInvoiceFile});return run(servicePromotionCommand,actor,type,payload,verified.evidenceRefs);};
  const proof={reference:'SYNTHETIC-ORIGINAL-SOURCE',occurredAt:NOW,evidenceRefs:[one],reason:'PRIVATE-PROOF-REASON'};
  const agreement=await promotion(operations,'service-promotion.agreement-publish',{...proof,version:0,promoterType:'group-promoter',title:'PRIVATE-AGREEMENT',body:'PRIVATE-BODY',effectiveAt:NOW});
  const invite=await promotion(operations,'service-promotion.invite',{version:0,userId:'u1',promoterType:'group-promoter',expiresAt:NOW+100000,reason:'PRIVATE-INVITE'});
  const promoter=await promotion(user,'service-promotion.invite-confirm',{id:invite.id,version:invite.version,decision:'accept',agreementAccepted:true,agreementId:agreement.id,reason:'PRIVATE-ACCEPT'});
  await promotion(support,'service-promotion.identity-review',{...proof,id:promoter.id,version:promoter.version,decision:'verified'});
  await promotion(support,'service-promotion.identity-review',{...proof,evidenceRefs:[two],reference:'SECOND-SYNTHETIC-SOURCE',id:promoter.id,version:s.servicePromoters[0].version,decision:'verified'});
  let invoice=run(invoiceCommand,user,'invoice.apply',{bookingId:'B1',kind:'company',title:'PRIVATE-TITLE',taxId:'91320100000000000X',email:'private@example.test'});
  invoice=run(invoiceCommand,store,'invoice.issue',{id:invoice.id,version:invoice.version,ticketNumber:'ORIGINAL-SYNTHETIC-TICKET',file:one});
  invoice=run(invoiceCommand,store,'invoice.replace-file',{id:invoice.id,version:invoice.version,slot:'issued',file:two,reason:'PRIVATE-REPLACEMENT'});
  s.now++;const requested=run(privacyCommand,user,'privacy.request',{version:privacyProfile(s,'u1').version,acknowledged:true,reason:'原关闭'});
  run(privacyCommand,support,'privacy.close',{id:requested.id,version:requested.version,acknowledged:true,reason:'隔离正常关闭',custodian:'原客服'});
  return {get s(){return s;},closureId:requested.id,user,support,promoterId:promoter.id,invoiceId:invoice.id,one,two};
}

test('原命令实际推广邀请/两次核验和发票补传→正常关闭，逐历史叶路径纯盘点',async()=>{
  const f=await originalSources(),before=JSON.stringify(f.s),rights=closedRightsView(f.s,f.user),inv=directory(f);
  for(const path of [['servicePromotionInvites',0,'reason'],['servicePromoters',0,'identity','reference'],['servicePromoters',0,'identityHistory',0,'evidenceRefs',0,'ref'],['serviceInvoices',0,'history',0,'title'],['serviceInvoices',0,'history',0,'taxId'],['serviceInvoices',0,'history',2,'previousFile','ref'],['serviceInvoices',0,'issued','file','ref']])assert.ok(field(inv,path),JSON.stringify(path));
  assert.equal(field(inv,['serviceInvoices',0,'history',0,'taxId']).classification,'redaction_candidate');assert.equal(field(inv,['serviceInvoices',0,'history',2,'previousFile','ref']).classification,'file_reference');
  const requestIndex=f.s.serviceInvoiceRequests.findIndex(x=>x.invoiceId===f.invoiceId);assert.equal(f.s.serviceInvoiceRequests[requestIndex].digestVersion,1);assert.equal(f.s.serviceInvoiceRequests[requestIndex].digestAlgorithm,'SHA-256');assert.equal(field(inv,['serviceInvoiceRequests',requestIndex,'fingerprint']).classification,'retained_digest');
  assert.equal(field(inv,['serviceInvoiceRequests',requestIndex,'fingerprint']).blockers.some(x=>/请求原来源缺失|结构损坏/.test(x)),false);
  assert.ok(inv.items.some(x=>x.kind==='request-copy'&&x.path[0]==='servicePromotionRequests'&&x.classification==='retained_digest'));
  assert.doesNotMatch(JSON.stringify(inv),/PRIVATE-|private@example|13800001111|91320100000000000X/);assert.equal(inv.items.every(x=>x.deleteAllowed===false),true);assert.equal(JSON.stringify(f.s),before);assert.deepEqual(closedRightsView(f.s,f.user),rights);
  const own=privacyCleanupInventoryView(f.s,f.user,f.closureId);assert.doesNotMatch(JSON.stringify(own),/invoice-file:|previousFile|identityHistory|sourceRelations/);
});
test('个人personKey/promoter/commission/debt映射保留资金owner与客户两种角色',()=>{
  const f=fresh();f.s.bookings.push({id:'OTHER-B',userId:'u2',payment:{id:'OTHER-P'}});f.s.servicePromoters=[{id:'OWN',personKind:'user',personId:'u1',reason:'PRIVATE-OWNER'},{id:'FOREIGN',personKind:'user',personId:'u2'}];
  f.s.serviceCommissions=[{id:'C1',promoterId:'OWN',personKey:'user:u1',userId:'u2',bookingId:'OTHER-B',paymentId:'OTHER-P',commissionCents:5000,reason:'PRIVATE-COMMISSION'},{id:'CUSTOMER-C',promoterId:'FOREIGN',personKey:'user:u2',userId:'u1',bookingId:'B1',paymentId:'P1',commissionCents:7000}];
  f.s.servicePromotionRecoveries=[{id:'D1',personKey:'user:u1',promoterId:'OWN',commissionId:'C1',records:[{reason:'PRIVATE-DEBT',amountCents:100}]}];f.s.servicePromotionOffsets=[{id:'O1',commissionId:'C1',recoveryId:'D1',amountCents:10}];
  const inv=directory(f),own=field(inv,['serviceCommissions',0,'commissionCents']),customer=field(inv,['serviceCommissions',1,'commissionCents']);assert.ok(own.subjectBinding.roles.includes('personal-owner'));assert.ok(customer.subjectBinding.roles.includes('customer'));assert.equal(customer.subjectBinding.roles.includes('personal-owner'),false);assert.equal(own.classification,'retained_fact');assert.equal(customer.deleteAllowed,false);assert.ok(field(inv,['servicePromotionRecoveries',0,'records',0,'reason']));assert.ok(field(inv,['servicePromotionOffsets',0,'amountCents']));assert.equal(inv.relationIssues.length,0);
});
test('原personal owner冲突、客户root串号、重复编号、缺promoter均保留定位待核',()=>{
  for(const mutate of [f=>f.s.serviceCommissions[0].personKey='user:u2',f=>f.s.serviceCommissions[0].userId='u2',f=>f.s.servicePromoters.push({...f.s.servicePromoters[0]}),f=>f.s.serviceCommissions[0].promoterId='missing']){const f=fresh();f.s.servicePromoters=[{id:'OWN',personKind:'user',personId:'u1'}];f.s.serviceCommissions=[{id:'C1',personKey:'user:u1',promoterId:'OWN',userId:'u1',bookingId:'B1',paymentId:'P1',reason:'PRIVATE'}];mutate(f);const inv=directory(f),row=field(inv,['serviceCommissions',0,'reason']);assert.equal(row.status,'pending_review');assert.ok(inv.relationIssues.length);assert.equal(row.deleteAllowed,false);}
});
test('goods嵌套地址before/after、售后requestSignature、投诉补充与交接各准确路径',()=>{
  const f=fresh();f.s.goods=[{id:'G1',userId:'u1',address:{name:'PRIVATE-RECIPIENT',detail:'PRIVATE-ADDRESS'},addressHistory:[{before:{phone:'PRIVATE-OLD'},after:{detail:'PRIVATE-NEW'}}],cases:[{id:'CA1',reason:'PRIVATE-CASE',requestSignature:JSON.stringify({id:'G1',reason:'PRIVATE-REQUEST'}),returnShipment:{id:'RS1',proof:'PRIVATE-RETURN'}}],incidents:[{id:'INC1',records:[{evidence:'PRIVATE-INCIDENT'}]}]}];f.s.serviceCareCases=[{id:'SC1',bookingId:'B1',userId:'u1',statements:[{id:'ST1',text:'PRIVATE-STATEMENT',evidenceRefs:[file]}],notes:[{internalNote:'PRIVATE-NOTE'}]}];f.s.serviceHandoffs=[{id:'H1',bookingId:'B1',userId:'u1',notes:[{id:'HN1',observation:'PRIVATE-OBS',nextAdvice:'PRIVATE-ADVICE'}]}];
  const inv=directory(f);for(const path of [['goods',0,'addressHistory',0,'before','phone'],['goods',0,'addressHistory',0,'after','detail'],['goods',0,'cases',0,'requestSignature'],['goods',0,'cases',0,'returnShipment','proof'],['serviceCareCases',0,'statements',0,'text'],['serviceCareCases',0,'statements',0,'evidenceRefs',0,'ref'],['serviceHandoffs',0,'notes',0,'nextAdvice']])assert.ok(field(inv,path),JSON.stringify(path));assert.equal(field(inv,['goods',0,'cases',0,'requestSignature']).classification,'request_plaintext');assert.doesNotMatch(JSON.stringify(inv),/PRIVATE-/);
});
test('只有invoiceId/reviewId/accessId/resultId或recipient子ID的原明文请求仍准确盘点',()=>{
  const f=fresh();f.s.serviceInvoices=[{id:'I1',bookingId:'B1',userId:'u1'}];f.s.serviceReviews=[{id:'RV1',bookingId:'B1',userId:'u1'}];f.s.sensitiveAccessLogs=[{id:'A1',bookingId:'B1',reason:'PRIVATE'}];f.s.recipients=[{id:'R1',userId:'u1',name:'PRIVATE'}];
  for(const [container,selector,value] of [['serviceInvoiceRequests','invoiceId','I1'],['serviceReviewRequests','reviewId','RV1'],['sensitiveAccessRequests','accessId','A1'],['handoffRequests','id','R1']]){f.s[container]=[{requestId:container,[selector]:value,kind:container==='handoffRequests'?'recipient':undefined,actor:JSON.stringify({role:'group',id:'group'}),fingerprint:JSON.stringify({type:'legacy-command',p:{id:value,reason:'PRIVATE'}})}];}
  const inv=directory(f);for(const container of ['serviceInvoiceRequests','serviceReviewRequests','sensitiveAccessRequests','handoffRequests'])assert.equal(field(inv,[container,0,'fingerprint']).classification,'request_plaintext');assert.doesNotMatch(JSON.stringify(inv),/PRIVATE/);
});
test('SHA-only原结果ID定位不逆hash；子源退款/事件/履约fact和work专项按category定位',()=>{
  const f=fresh();f.s.bookings[0].refunds=[{id:'REF1',reason:'PRIVATE'}];f.s.fulfilmentRecords=[{id:'FUL1',bookingId:'B1',facts:[{id:'FACT1',evidence:'PRIVATE'}]}];f.s.fulfilmentRequests=[{result:{id:'FACT1'},digestAlgorithm:'SHA-256',fingerprint:'b'.repeat(64),actorDigest:'c'.repeat(64)}];f.s.workEscalations=[{id:'W1',sourceSnapshot:{category:'fulfilment',sourceId:'FACT1'},history:[{reason:'PRIVATE'}]}];f.s.workEscalationRequests=[{result:{id:'W1'},fingerprint:JSON.stringify({type:'work-escalation.takeover',p:{id:'W1',reason:'PRIVATE'}})}];
  const inv=directory(f);assert.equal(field(inv,['fulfilmentRequests',0,'fingerprint']).classification,'retained_digest');assert.ok(field(inv,['workEscalations',0,'history',0,'reason']));assert.ok(field(inv,['workEscalationRequests',0,'fingerprint']));assert.ok(field(inv,['bookings',0,'refunds',0,'reason']));assert.equal(inv.relationIssues.length,0);
});
test('普通服务原款和差额升级按唯一原资金根盘点，缺规则保留来源而串款明确待核',()=>{
  for(const broken of [false,true]){const f=fresh(),b=f.s.bookings[0];b.payment.status='success';f.s.serviceFinanceEntries=[{id:'ORD-SF',kind:'main',bookingId:b.id,paymentId:b.payment.id,storeId:b.storeId,userId:b.userId,sourceSnapshot:{status:'known',customerType:'group',ownerType:'group'}}];f.s.serviceFinanceRecoveries=[{id:'ORD-DEBT',entryId:'ORD-SF',bookingId:b.id,paymentId:b.payment.id,storeId:b.storeId}];
    f.s.workEscalations=['entry','recovery'].map(kind=>{const sourceId=kind==='entry'?'ORD-SF':'ORD-DEBT',id='service-finance:'+kind+':'+sourceId;return{id,sourceSnapshot:{taskId:id,category:'service-finance-'+kind,sourceId,storeId:b.storeId},history:[{reason:'PRIVATE-ORDINARY'}]};});
    if(broken)f.s.serviceFinanceRecoveries[0].paymentId='WRONG';const inv=directory(f);for(let i=0;i<2;i++){const item=field(inv,['workEscalations',i,'history',0,'reason']);assert.ok(item);assert.equal(item.deleteAllowed,false);assert.ok(item.subjectBinding.roles.includes('customer'));if(broken&&i===1)assert.equal(item.status,'pending_review');else assert.equal(inv.relationIssues.some(x=>x.container==='workEscalations'&&x.path[1]===i),false);}
    assert.doesNotMatch(JSON.stringify(inv),/PRIVATE-ORDINARY/);
  }
});
test('同ID不同原域不会substring串人；文本mention用户/原root不建立本人来源',()=>{
  const f=fresh();f.s.serviceInvoices=[{id:'SAME',userId:'u2',bookingId:'OTHER'}];f.s.serviceReviews=[{id:'SAME',userId:'u1',bookingId:'B1'}];f.s.serviceInvoiceRequests=[{invoiceId:'SAME',actor:JSON.stringify({role:'group'}),fingerprint:JSON.stringify({type:'invoice.replace-file',payload:{id:'SAME',reason:'u1 B1 PRIVATE'}})}];f.s.serviceReviewRequests=[{reviewId:'SAME',fingerprint:JSON.stringify({type:'review.reply',payload:{id:'SAME',reason:'PRIVATE'}})}];f.s.unrecognizedRequests=[{fingerprint:JSON.stringify({reason:'u1 B1 PRIVATE'})}];
  const inv=directory(f);assert.equal(field(inv,['serviceInvoiceRequests',0,'fingerprint']),undefined);assert.ok(field(inv,['serviceReviewRequests',0,'fingerprint']));assert.ok(inv.unlocated.some(x=>x.container==='unrecognizedRequests'));assert.equal(inv.items.some(x=>x.path?.[0]==='unrecognizedRequests'),false);
});
test('损坏请求/缺子源不漏为完成：真实result仍列，无法定位只对support显示待核',()=>{
  const f=fresh();f.s.serviceInvoices=[{id:'I1',userId:'u1',bookingId:'B1'}];f.s.serviceInvoiceRequests=[{invoiceId:'I1',fingerprint:'BROKEN PRIVATE JSON',actor:'BROKEN'}, {invoiceId:'MISSING',fingerprint:'BROKEN'}];f.s.legacyPrivateRows=[{id:'UNKNOWN',phone:'PRIVATE-UNOWNED'}];const inv=directory(f);assert.equal(field(inv,['serviceInvoiceRequests',0,'fingerprint']).status,'pending_review');assert.ok(inv.unlocated.some(x=>x.container==='serviceInvoiceRequests'&&x.path[1]===1));assert.ok(inv.unlocated.some(x=>x.container==='legacyPrivateRows'));const own=privacyCleanupInventoryView(f.s,f.user,f.closureId);assert.equal(own.unlocatedCount,inv.unlocated.length);assert.doesNotMatch(JSON.stringify(own),/UNKNOWN|MISSING|legacyPrivateRows|PRIVATE/);
});
test('服务提供techId不当本人；明确tech.userId才盘点旧资格/提成且不开放附件',()=>{
  const f=fresh();f.s.techQualifications=[{id:'Q1',techId:'t1',assessments:[{id:'AS1',proof:'PRIVATE-INTERNAL',evidenceRefs:[file]}]}];f.s.techIncomeEntries=[{id:'TI1',techId:'t1',bookingId:'B1',paymentId:'P1',amountCents:2000}];let inv=directory(f);assert.equal(field(inv,['techQualifications',0,'assessments',0,'proof']),undefined);
  f.s.techs[0].userId='u1';inv=directory(f);assert.ok(field(inv,['techQualifications',0,'assessments',0,'proof']));assert.equal(field(inv,['techIncomeEntries',0,'amountCents']).classification,'retained_fact');assert.ok(field(inv,['techQualifications',0,'assessments',0,'evidenceRefs',0,'ref']));assert.doesNotMatch(JSON.stringify(privacyCleanupInventoryView(f.s,f.user,f.closureId)),/invoice-file:|PRIVATE-INTERNAL|AS1|Q1/);
});
test('本人tech持久link缺依据/重复/冲突清楚待核，不漏已有关联资料',()=>{
  for(const bad of ['missing-proof','duplicate','conflict']){const f=fresh();f.s.techs[0].userId='u1';const link={id:'L1',userId:'u1',techId:'t1',reference:'ORIGINAL',occurredAt:NOW-2,createdAt:NOW-1,createdBy:{role:'group',job:'account-admin',accountId:'DEMO-ADMIN'}};f.s.organizationIdentityLinks=[link];if(bad==='missing-proof')link.reference='';if(bad==='duplicate')f.s.organizationIdentityLinks.push({...link,id:'L2'});if(bad==='conflict')link.userId='u2';f.s.techQualifications=[{id:'Q1',techId:'t1',assessments:[{id:'AS1',proof:'PRIVATE'}]}];const inv=directory(f);assert.equal(field(inv,['techQualifications',0,'assessments',0,'proof']).status,'pending_review');assert.ok(inv.relationIssues.some(x=>x.container==='techQualifications'));}
});
test('原qualification profileId请求与无当前userId的tech payout子entry准确继承来源',()=>{
  const f=fresh();f.s.techs[0].userId='u1';f.s.techQualifications=[{id:'Q1',techId:'t1',reason:'PRIVATE'}];f.s.techQualificationRequests=[{profileId:'Q1',techId:'t1',fingerprint:JSON.stringify({type:'qualification.review',p:{profileId:'Q1',reason:'PRIVATE'}})}];f.s.techIncomeEntries=[{id:'E1',techId:'t1',bookingId:'B1',paymentId:'P1'}];f.s.techIncomePayouts=[{id:'PAY1',techId:'t1',lines:[{entryId:'E1',amountCents:100}],history:[{proof:'PRIVATE'}]}];f.s.techIncomeRequests=[{result:{id:'PAY1'},fingerprint:JSON.stringify({type:'tech-income.payout',payload:{id:'PAY1',proof:'PRIVATE'}})}];const inv=directory(f);assert.ok(field(inv,['techQualificationRequests',0,'fingerprint']));assert.ok(field(inv,['techIncomeRequests',0,'fingerprint']));assert.ok(field(inv,['techIncomePayouts',0,'history',0,'proof']));
});
test('保留原ID/金额/数量/时序/作者并逐字段列清理候选、未知自由字段和空值',()=>{
  const f=fresh();f.s.bookings[0].healthNote='PRIVATE-UNKNOWN';f.s.bookings[0].phone='';f.s.bookings[0].events=[{at:NOW,by:{role:'user',id:'u1'},text:'PRIVATE-EVENT'}];const inv=directory(f);assert.equal(field(inv,['bookings',0,'id']).classification,'retained_fact');assert.equal(field(inv,['bookings',0,'payment','amountCents']).classification,'retained_fact');assert.equal(field(inv,['bookings',0,'events',0,'by','id']).classification,'retained_fact');assert.equal(field(inv,['bookings',0,'healthNote']).status,'pending_review');assert.equal(field(inv,['bookings',0,'phone']).status,'cleared_current');assert.equal(inv.items.every(x=>x.deleteAllowed===false),true);assert.doesNotMatch(JSON.stringify(inv),/PRIVATE-/);
});
test('目录改变使inventoryToken过期，文件图仍保护所有其他主体及原政策材料',()=>{
  const f=fresh(),first=directory(f).sourceToken;f.s.serviceInvoices=[{id:'I1',userId:'u1',bookingId:'B1',history:[{title:'PRIVATE-HISTORY'}]}];f.s.privacyCleanupPolicySources=[{id:'PS',evidenceRefs:[file]}];f.s.otherPersons=[{id:'OTHER',file}];const inv=directory(f);assert.notEqual(inv.sourceToken,first);const graph=collectPrivacyFileReferences(f.s);assert.equal(graph.references.filter(x=>x.ref===file.ref).length,2);assert.equal(graph.issues.length,0);assert.equal(inv.items.some(x=>x.path?.[0]==='privacyCleanupPolicySources'),false);
});
test('原actor.id只是作者：同号invoice不串资料，正常明文请求不误报payload.id缺源',()=>{
  const f=fresh();f.s.serviceInvoices=[{id:'I1',userId:'u1',bookingId:'B1'},{id:'u1',userId:'u2'},{id:'group',userId:'u2'}];f.s.serviceInvoiceRequests=[{invoiceId:'I1',actor:JSON.stringify({role:'user',id:'u1'}),fingerprint:JSON.stringify({type:'invoice.resubmit',payload:{id:'I1',reason:'PRIVATE'}})},{invoiceId:'I1',actor:JSON.stringify({role:'group',id:'group'}),fingerprint:JSON.stringify({type:'invoice.issue',payload:{id:'I1',reason:'PRIVATE'}})}];const inv=directory(f);
  for(const i of [0,1]){const entry=field(inv,['serviceInvoiceRequests',i,'fingerprint']);assert.equal(entry.status,'pending_policy');assert.equal(entry.subjectBinding.sourceRelations.some(x=>x.userId==='u2'),false);assert.equal(entry.blockers.some(x=>/payload.id请求原来源/.test(x)),false);}
});
test('原lifecycle/penalty带sha256前缀的signature/actorKey按实际producer保留摘要',()=>{
  const f=fresh();f.s.organizationLifecycleCases=[{id:'L1',userId:'u1',reason:'PRIVATE'}];f.s.technicianPenalties=[{id:'TP1',bookingId:'B1',userId:'u1',reason:'PRIVATE'}];for(const [container,id] of [['organizationLifecycleRequests','L1'],['technicianPenaltyRequests','TP1']])f.s[container]=[{result:{id},actorKey:lifecycleFingerprint({role:'group',job:'support'}),signature:lifecycleFingerprint({type:'actual-producer',p:{id,reason:'PRIVATE'}})}];const inv=directory(f);
  for(const container of ['organizationLifecycleRequests','technicianPenaltyRequests'])for(const key of ['signature','actorKey']){const entry=field(inv,[container,0,key]);assert.equal(entry.classification,'retained_digest');assert.equal(entry.status,'retain_required');assert.equal(entry.blockers.some(x=>/结构损坏|版本未知/.test(x)),false);}
});
test('客户资料与另一真实技师资金owner同时保留，未定位tech owner也不推给客户',()=>{
  for(const mapped of [true,false]){const f=fresh();if(mapped)f.s.techs[0].userId='u2';f.s.techIncomeEntries=[{id:'E1',techId:'t1',bookingId:'B1',paymentId:'P1'}];f.s.techIncomePayouts=[{id:'PAY1',techId:'t1',lines:[{entryId:'E1',amountCents:100}],proof:'PRIVATE-OTHER-OWNER'}];const inv=directory(f),entry=field(inv,['techIncomePayouts',0,'proof']);assert.ok(entry);assert.equal(entry.status,'pending_review');assert.equal(entry.deleteAllowed,false);if(mapped){assert.equal(entry.subjectBinding.mixedSubjects,true);assert.ok(entry.subjectBinding.sourceRelations.some(x=>x.userId==='u2'&&x.role==='technician-owner'));}else assert.match(entry.blockers.join(),/不把客户当资金owner/);}
});
test('原techIncome difference记录result.id/ differenceId精确子源，缺记录不吞缺源',()=>{
  const f=fresh();f.s.techs[0].userId='u1';f.s.techIncomeEntries=[{id:'E1',techId:'t1',bookingId:'B1',paymentId:'P1'}];f.s.techIncomeDifferences=[{id:'D1',techId:'t1',bookingId:'B1',paymentId:'P1',entryId:'E1',records:[{id:'TIF1',differenceId:'D1',proof:'PRIVATE-DIFF',amountCents:10}]}];f.s.techIncomeRequests=[{result:{id:'TIF1',differenceId:'D1'},fingerprint:JSON.stringify({type:'tech-income.difference-record',payload:{id:'D1',proof:'PRIVATE-DIFF'}})}];let inv=directory(f),entry=field(inv,['techIncomeRequests',0,'fingerprint']);assert.equal(entry.status,'pending_policy');assert.equal(entry.blockers.some(x=>/原来源缺失/.test(x)),false);assert.ok(field(inv,['techIncomeDifferences',0,'records',0,'proof']));f.s.techIncomeDifferences[0].records=[];inv=directory(f);entry=field(inv,['techIncomeRequests',0,'fingerprint']);assert.equal(entry.status,'pending_review');assert.match(entry.blockers.join(),/result请求原来源缺失/);
});
test('原engine日志entity.id精确来源和原作者枚举，重号日志非重复业务事实',()=>{
  const f=fresh();f.s.logs=[{id:'B1',at:NOW,actor:'group',actorId:'group',text:'PRIVATE-LOG'},{id:'B1',at:NOW,actor:'user',actorId:'u1',text:'PRIVATE-LOG'}];const inv=directory(f);for(const i of [0,1]){assert.ok(field(inv,['logs',i,'text']));assert.equal(field(inv,['logs',i,'actor']).classification,'retained_fact');assert.equal(field(inv,['logs',i,'text']).blockers.some(x=>/编号重复/.test(x)),false);}assert.doesNotMatch(JSON.stringify(inv),/PRIVATE-LOG/);
});
test('原嵌套历史其他user/owner明确保留多主体关系，收件人不由姓名猜本人',()=>{
  const f=fresh();f.s.serviceInvoices=[{id:'I1',userId:'u1',bookingId:'B1',history:[{before:{userId:'u2',name:'PRIVATE-OTHER'}},{person:{personKind:'user',personId:'u2',reason:'PRIVATE-OTHER'}}]}];f.s.goods=[{id:'G1',userId:'u1',address:{name:'PRIVATE-RECEIVER'}}];const inv=directory(f);for(const path of [['serviceInvoices',0,'history',0,'before','name'],['serviceInvoices',0,'history',1,'person','reason'],['goods',0,'address','name']]){const entry=field(inv,path);assert.equal(entry.subjectBinding.mixedSubjects,true);assert.equal(entry.status,'pending_review');assert.equal(entry.deleteAllowed,false);}assert.ok(field(inv,['serviceInvoices',0,'history',0,'before','name']).subjectBinding.sourceRelations.some(x=>x.userId==='u2'));
});
test('原按userId目录key保存的cart/promotion残留也只读列出，其他主体无关值不混入',()=>{
  const f=fresh();f.s.carts={u1:[{skuId:'S1',qty:2,note:'PRIVATE-CART'}],u2:[{note:'PRIVATE-OTHER-CART'}]};f.s.promotions={u1:{sourceId:'ORIGINAL',at:NOW,reason:'PRIVATE-ENTRY'},u2:{reason:'PRIVATE-OTHER'}};const inv=directory(f);assert.ok(field(inv,['carts','u1',0,'note']));assert.equal(field(inv,['carts','u1',0,'qty']).classification,'retained_fact');assert.ok(field(inv,['promotions','u1','reason']));assert.equal(inv.items.some(x=>x.path?.[0]==='carts'&&x.path[1]==='u2'),false);assert.doesNotMatch(JSON.stringify(inv),/PRIVATE-/);
});
test('同原域result与payload目标串号即使同本人也待核，create的root→子结果不误拒',()=>{
  const f=fresh();f.s.serviceInvoices=[{id:'I1',userId:'u1',bookingId:'B1'},{id:'I2',userId:'u1',bookingId:'B1'}];f.s.serviceInvoiceRequests=[{requestId:'STALE',invoiceId:'I1',fingerprint:JSON.stringify({type:'invoice.issue',payload:{id:'I2',reason:'PRIVATE'}})},{invoiceId:'I1',fingerprint:JSON.stringify({type:'invoice.apply',payload:{bookingId:'B1',title:'PRIVATE'}})}];const inv=directory(f);assert.equal(field(inv,['serviceInvoiceRequests',0,'fingerprint']).status,'pending_review');assert.match(field(inv,['serviceInvoiceRequests',0,'fingerprint']).blockers.join(),/result与payload目标串号/);assert.ok(inv.relationIssues.some(x=>x.sourceId==='STALE'));assert.equal(field(inv,['serviceInvoiceRequests',1,'fingerprint']).status,'pending_policy');
});
test('原历史循环结构明确待核，目录仍返回路径且不修改原引用',()=>{
  const f=fresh(),history={userId:'u1',reason:'PRIVATE-CYCLE'};history.previous=history;f.s.serviceInvoices=[{id:'I1',userId:'u1',bookingId:'B1',history:[history]}];const inv=directory(f);assert.ok(inv.graph.issues.some(x=>/循环/.test(x.reason)));assert.ok(inv.items.some(x=>x.path?.at(-1)==='previous'&&x.status==='pending_review'));assert.equal(f.s.serviceInvoices[0].history[0].previous,history);assert.doesNotMatch(JSON.stringify(inv),/PRIVATE-CYCLE/);
});
