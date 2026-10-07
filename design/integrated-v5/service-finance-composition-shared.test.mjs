import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from './engine.mjs';
import { oldCash, file, blob } from './service-finance-composition-test-fixture.mjs';
import { serviceFinanceCompositionReview, prepareServiceFinanceCompositionEvidence } from './service-finance-composition-review.mjs';
import { serviceFinanceComposition } from './service-finance-composition.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { authorizedInvoiceFile } from './invoice-files.mjs';
import { feeInvoiceSummary } from './commerce-invoices.mjs';
import { servicePromotionSharedTaskRows } from './service-promotion-shared-tasks.mjs';

async function fixture() {
  const h=await oldCash();let s=h.s,seq=0;
  const op=(actor,type,p={})=>{let result;s=reduce(s,actor,type,{requestId:'composition-shared-'+ ++seq,reason:'实际共享源隔离验证',...p},x=>result=x);return result;};
  const adminSession=op({role:'user',userId:'u1'},'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(s,adminSession);
  const staff=(job,storeId)=>{
    let a=op(admin,'account.create',{name:'组成核定共享'+job});
    a=op(admin,'account.employment',{id:a.id,version:a.version,employmentStatus:'active',reference:'COMPOSITION-EMP-'+job,verifiedAt:s.now});
    a=op(admin,'account.grant',{id:a.id,version:a.version,job,...(storeId?{storeId}:{})});
    const session=op({role:'user',userId:'u1'},'account.enter',{accountId:a.id,grantId:a.grants.at(-1).id});return resolveAccountActor(s,session);
  };
  const finance=staff('finance'),support=staff('support'),store=staff('store-finance','xingfu');
  const entryId=h.entry.id,sourceKey=h.key;
  const f={get s(){return s;},finance,support,store,admin,entryId,sourceKey,op,
    payload(extra={}){const v=serviceFinanceCompositionReview(s,finance,entryId,sourceKey);return {id:entryId,sourceKey,version:v.entryVersion,sourceToken:v.sourceToken,requestId:'composition-shared-review-'+ ++seq,hCents:1490,csCents:v.facts.normalCents-1490,retainedCsCents:null,allocations:[],basisReference:'DEMO-COMPOSITION-CLASSIFICATION',basisDescription:'原逐笔实际分类依据，技术合成测试',evidenceRefs:[file],reason:'补核原现金，不改变金额',...extra};},
    async commit(p,type='finance.composition-confirm',actor=finance,options={}){
      const prepared=await prepareServiceFinanceCompositionEvidence(s,actor,type,p,{readFile:async()=>blob,getState:()=>s,...options});let result;
      s=reduce(s,actor,type,p,x=>result=x,{compositionPrepared:prepared});return result;
    },
    cash(){const entry=s.serviceFinanceEntries.find(e=>e.id===entryId);return structuredClone({bookings:s.bookings,split:entry.split,splitHistory:entry.splitHistory,returns:entry.returns,recoveries:s.serviceFinanceRecoveries});}
  };return f;
}

test('原工作财务通过真实reduce补核，原现金不变，文件精确原域可读',async()=>{
  const f=await fixture(),before=f.cash(),p=f.payload(),row=await f.commit(p);
  assert.equal(row.by.accountId,f.finance.accountId);assert.equal(row.by.grantId,f.finance.grantId);
  assert.equal(serviceFinanceComposition(f.s,f.entryId).known,true);assert.deepEqual(f.cash(),before);
  assert.deepEqual(authorizedInvoiceFile(f.s,f.finance,row.id,'evidence:0',file.ref,'service-finance-composition'),file);
  for(const actor of [f.support,f.store,{role:'user',userId:'u1'}])assert.throws(()=>authorizedInvoiceFile(f.s,actor,row.id,'evidence:0',file.ref,'service-finance-composition'),/财务|岗位|无权/);
  assert.throws(()=>authorizedInvoiceFile(f.s,f.finance,row.id,'evidence:1',file.ref,'service-finance-composition'),/槽/);
});

test('原reduce实际日志不破坏原请求重放，更正留原记录且不重造现金',async()=>{
  const f=await fixture(),p=f.payload(),row=await f.commit(p),first=structuredClone(f.s);
  assert.ok(row.events?.length);await f.commit(p);
  // The original reduce increments its technical revision for every accepted call.
  assert.equal(f.s.revision,first.revision+1);assert.deepEqual({...f.s,revision:first.revision},first);
  const v=serviceFinanceCompositionReview(f.s,f.finance,f.entryId,f.sourceKey),cash=f.cash();
  const corrected=await f.commit(f.payload({hCents:p.hCents-100,csCents:p.csCents+100,supersedes:v.supersedes,reason:'原分类证据更正，原现金不变'}),'finance.composition-reconcile');
  assert.notEqual(corrected.id,row.id);assert.deepEqual(f.s.serviceFinanceCompositions.find(x=>x.id===row.id),row);
  assert.equal(serviceFinanceComposition(f.s,f.entryId).hNetCents,p.hCents-100);assert.deepEqual(f.cash(),cash);
});

test('载荷或runtime伪造文件描述/布尔/复制prepared不能进入原事务',async()=>{
  const f=await fixture(),p=f.payload(),before=structuredClone(f.s),prepared=await prepareServiceFinanceCompositionEvidence(f.s,f.finance,'finance.composition-confirm',p,{readFile:async()=>blob});
  for(const runtime of [null,{evidenceRefs:[file]},{compositionPrepared:true},{compositionPrepared:structuredClone(prepared)}])assert.throws(()=>reduce(f.s,f.finance,'finance.composition-confirm',{...p,verified:true},()=>{},runtime),/核验|预校验|复制/);
  assert.deepEqual(f.s,before);
});

test('实际撤权、非财务岗位和原源版本变动拒绝，旧页不落核定',async()=>{
  const f=await fixture(),p=f.payload();for(const actor of [f.support,f.store,f.admin])await assert.rejects(f.commit(p,undefined,actor),/财务|岗位|权限/);
  const prepared=await prepareServiceFinanceCompositionEvidence(f.s,f.finance,'finance.composition-confirm',p,{readFile:async()=>blob});
  const changed=structuredClone(f.s);changed.serviceFinanceEntries.find(x=>x.id===f.entryId).version++;
  assert.throws(()=>reduce(changed,f.finance,'finance.composition-confirm',p,()=>{},{compositionPrepared:prepared}),/核验|变化/);
  const account=f.s.staffAccounts.find(a=>a.id===f.finance.accountId);f.op(f.admin,'account.revoke',{id:account.id,version:account.version,grantId:f.finance.grantId});
  await assert.rejects(f.commit(p),/会话|授权|账号/);assert.equal(f.s.serviceFinanceCompositions?.length??0,0);
});

test('实际Blob读取期间原现金变化不能通过先前描述提交',async()=>{
  const f=await fixture(),p=f.payload();
  await assert.rejects(f.commit(p,undefined,f.finance,{readFile:async()=>{f.s.serviceFinanceEntries.find(x=>x.id===f.entryId).split.amountCents++;return blob;}}),/读取期间|原现金|来源/);
  assert.equal(f.s.serviceFinanceCompositions?.length??0,0);
});

test('原财务核定→原门店月票→组成更正自动待红冲，旧PDF和原票快照保留',async()=>{
  const f=await fixture(),entry=f.s.serviceFinanceEntries.find(e=>e.id===f.entryId),month=new Date(entry.split.completedAt+8*3600000).toISOString().slice(0,7);
  for(const minutes of [44640,12960])f.op({role:'group',job:'all'},'clock.advance',{minutes});
  f.op(f.finance,'commerce-invoice.rule-publish',{category:'fee',version:0,issuerName:'明确本地技术集团主体',issuerTaxId:'91320100000000000Y',invoiceItem:'平台服务费',effectiveAt:f.s.now,sourceFromAt:Date.parse(month+'-01T00:00:00+08:00'),cycle:'monthly',timezoneMinutes:480,returnPolicy:'cash-month',reason:'合成月票验收配置，不替代正式业务批准'});
  assert.equal(feeInvoiceSummary(f.s,'xingfu',month).blocked,true);
  await f.commit(f.payload());assert.equal(feeInvoiceSummary(f.s,'xingfu',month).netCents,1490);
  const inv=f.op(f.store,'commerce-invoice.apply-fee',{storeId:'xingfu',month,kind:'company',title:'本地技术门店',taxId:'91320100000000000X',email:'test@example.com'});
  f.op(f.finance,'commerce-invoice.issue',{id:inv.id,version:inv.version,ticketNumber:'DEMO-SHARED-MONTHLY',file});
  const issued=structuredClone(f.s.commerceInvoices.find(x=>x.id===inv.id)),cash=f.cash(),v=serviceFinanceCompositionReview(f.s,f.finance,f.entryId,f.sourceKey);
  await f.commit(f.payload({hCents:1000,csCents:v.facts.normalCents-1000,supersedes:v.supersedes,reason:'原分类依据更正'}),'finance.composition-reconcile');
  const changed=f.s.commerceInvoices.find(x=>x.id===inv.id);
  assert.equal(changed.status,'red_pending');assert.equal(changed.amount,issued.amount);
  assert.deepEqual(changed.issued,issued.issued);assert.deepEqual(changed.sourceSnapshot,issued.sourceSnapshot);assert.deepEqual(f.cash(),cash);
});

test('已完结款缺原现金组成仍留原财务待办，实际补核后同原待办完成',async()=>{
  const f=await fixture(),entry=f.s.serviceFinanceEntries.find(x=>x.id===f.entryId);
  f.op(f.finance,'finance.finish-start',{id:entry.id,version:entry.version,outcome:'success'});
  const before=servicePromotionSharedTaskRows(f.s).find(x=>x.category==='service-promotion-finance-entry'&&x.entryId===f.entryId);
  assert.equal(before.status,'open');assert.ok(before.commands.includes('finance.composition-confirm'));
  const cash=f.cash();await f.commit(f.payload());const after=servicePromotionSharedTaskRows(f.s).find(x=>x.id===before.id);
  assert.equal(after.status,'done');assert.notEqual(after.sourceToken,before.sourceToken);assert.deepEqual(f.cash(),cash);
});
