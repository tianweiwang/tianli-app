import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce} from './engine.mjs';
import {appSessionCommandSource,createAppSessionScopes} from './app-session-scope.mjs';
import {createAppSessionRuntime} from './app-session.mjs';
import {lifecycleFingerprint as hash} from './organization-lifecycle-projection.mjs';
import {createTaskReturnContext} from './task-navigation.mjs';
const group={role:'group',job:'all'},key='tianli-integrated-v5';
const source=(s,a,type,p)=>appSessionCommandSource(s,a,type,p,hash('actual-form'));
class Storage{constructor(copy){this.values=new Map(copy?.values||[]);}get length(){return this.values.size;}key(i){return [...this.values.keys()][i]??null;}getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,String(v));}removeItem(k){this.values.delete(k);}}
test('management SKU uses its original product, inventory uses skuId, and cross-product or duplicate roots fail',()=>{
  const s=seed(),sku=s.skus[0],product=s.products.find(p=>p.id===sku.productId);
  assert.deepEqual(source(s,group,'manage.sku-save',{id:sku.id,productId:product.id,version:product.version}).source,{kind:'catalog-product',id:product.id});
  assert.deepEqual(source(s,group,'manage.inventory',{skuId:sku.id,stockVersion:sku.stockVersion}).source,{kind:'catalog-sku',id:sku.id});
  assert.throws(()=>source(s,group,'manage.sku-save',{id:sku.id,productId:s.products.find(p=>p.id!==product.id).id}));
  s.skus.push(structuredClone(sku));assert.throws(()=>source(s,group,'manage.inventory',{skuId:sku.id}));
});
test('new technician/import belongs to the actual selected store, never an inferred customer',()=>{
  const s=seed(),out=source(s,group,'manage.tech-save',{storeId:'xingfu'});
  assert.deepEqual(out.subjects,[{kind:'store',id:'xingfu'}]);assert.equal(out.source.kind,'tech-draft');
  assert.throws(()=>source(s,{role:'store',storeId:'yuan'},'manage.tech-import',{storeId:'xingfu'}));
});
test('recipient and privacy drafts bind original owner; closure id is distinct from profile user id',()=>{
  const s=seed(),actor={role:'user',userId:'u1'};
  assert.deepEqual(source(s,actor,'recipient.save',{}).subjects,[{kind:'user',id:'u1'}]);
  assert.deepEqual(source(s,actor,'privacy.request',{}).subjects,[{kind:'user',id:'u1'}]);
  s.recipients=[{id:'R-other',userId:'u2',version:1}];assert.throws(()=>source(s,actor,'recipient.save',{id:'R-other'}));
});
test('new producer proof survives actual journal/reload with selectors only and unknown old value stays pending',async()=>{
  const storage=new Storage(),native=new Storage(),s=seed();storage.setItem(key,JSON.stringify(s));let serial=0,actor=group;
  const context=()=>({state:JSON.parse(storage.getItem(key)),actor,originScope:'https://source.test'}),scopes=createAppSessionScopes({key,currentContext:context});
  const session=createAppSessionRuntime({key,storage,sessionStorage:native,locks:{request:(_key,fn)=>fn()},currentContext:context,scopeForDraft:scopes.scopeForDraft,listStoredRefs:()=>[],id:()=> 'SRC-'+ ++serial});
  const product=s.products[0],rawKey=key+'-management:actual:product',payload={id:product.id,version:product.version},draft=JSON.stringify({payload:JSON.stringify(payload),values:[{name:'name',value:'PRIVATE-FORM-BODY'}]});
  scopes.produce(rawKey,draft,{kind:'management-draft',command:'manage.product-save',formId:'product:'+product.id,payload});
  await session.mutate('write',facade=>facade.setItem(rawKey,draft),{planned:[{key:rawKey,value:draft}]});
  const ledger=JSON.parse(storage.getItem(key));assert.equal(JSON.stringify(ledger.privacyUploadTabs).includes('PRIVATE-FORM-BODY'),false);
  const fresh=createAppSessionScopes({key,currentContext:context});assert.equal(fresh.scopeForDraft({...context(),key:rawKey,value:draft}).source.id,product.id);
  assert.throws(()=>fresh.scopeForDraft({...context(),key:rawKey+'unknown',value:draft}));
  actor={role:'group',job:'finance'};assert.throws(()=>fresh.scopeForDraft({...context(),key:rawKey,value:draft}));
});
test('preparing failure happens before actual session writer and retains no body in planned ledger hints',async()=>{
  const storage=new Storage(),native=new Storage(),s=seed();storage.setItem(key,JSON.stringify(s));let serial=0;
  const context=()=>({state:JSON.parse(storage.getItem(key)),actor:group,originScope:'https://source.test'}),scopes=createAppSessionScopes({key,currentContext:context});
  const session=createAppSessionRuntime({key,storage,sessionStorage:native,locks:{request:(_key,fn)=>fn()},currentContext:context,scopeForDraft:scopes.scopeForDraft,listStoredRefs:()=>[],id:()=> 'FAIL-'+ ++serial});
  await session.initialize();const product=s.products[0],rawKey=key+'-request:actual',value='original-request';scopes.produce(rawKey,value,{kind:'request-key',command:'manage.product-status',payload:{id:product.id}});
  const set=storage.setItem.bind(storage);storage.setItem=(k,v)=>{if(JSON.parse(v).privacyUploadTabs?.some(row=>row.operation?.sources?.length))throw Error('preparing failed');set(k,v);};
  await assert.rejects(session.mutate('write',facade=>facade.setItem(rawKey,value),{planned:[{key:rawKey,value}]}));assert.equal(native.getItem(rawKey),null);
});

test('completed original request permits only the exact unchanged draft cleanup; actor/request changes invalidate the proof',async()=>{
  const storage=new Storage(),native=new Storage(),s=seed();storage.setItem(key,JSON.stringify(s));let serial=0,actor=group;
  const context=()=>({state:JSON.parse(storage.getItem(key)),actor,originScope:'https://source.test'}),scopes=createAppSessionScopes({key,currentContext:context});
  const session=createAppSessionRuntime({key,storage,sessionStorage:native,locks:{request:(_key,fn)=>fn()},currentContext:context,scopeForDraft:scopes.scopeForDraft,listStoredRefs:()=>[],id:()=> 'DONE-'+ ++serial});
  const p={id:s.products[0].id,version:1,status:'offline',reason:'original business',requestId:'DONE-REQUEST'},rawKey=key+'-management:actual',draft=JSON.stringify({payload:JSON.stringify({id:p.id,version:1}),values:[{name:'status',value:p.status},{name:'reason',value:p.reason}]});
  scopes.produce(rawKey,draft,{kind:'management-draft',command:'manage.product-status',formId:'actual',payload:{id:p.id,version:1,status:p.status,reason:p.reason}});await session.mutate('write',view=>view.setItem(rawKey,draft),{planned:[{key:rawKey,value:draft}]});
  const before=session.load(),next=reduce(before,actor,'manage.product-status',p);scopes.stageCompletion(before,next,session.identity(),[{key:rawKey,value:draft}],p.requestId);storage.setItem(key,JSON.stringify(next));
  const fresh=createAppSessionScopes({key,currentContext:context});assert.equal(fresh.completion(rawKey,draft),true);assert.equal(fresh.completion(rawKey,draft+' '),false);
  actor={role:'group',job:'finance'};assert.equal(fresh.completion(rawKey,draft),false);actor=group;
  const changed=session.load();changed.managementRequests.at(-1).requestId='OTHER';storage.setItem(key,JSON.stringify(changed));assert.equal(fresh.completion(rawKey,draft),false);assert.throws(()=>fresh.scopeForDraft({...context(),key:rawKey,value:draft,operation:'remove'}));assert.equal(native.getItem(rawKey),draft);
});
test('new invite uses the actual original userId selector and producer does not duplicate plaintext owner tokens',()=>{
  const s=seed(),scope=source(s,{role:'store',storeId:'xingfu'},'service-promotion.invite',{userId:'u2',promoterType:'store-promoter'});assert.ok(scope.subjects.some(row=>row.kind==='user'&&row.id==='u2'));
  const scopes=createAppSessionScopes({key,currentContext:()=>({state:s,actor:group,originScope:'https://source.test'})}),hint=scopes.produce(key+'-request:actual','R',{kind:'request-key',command:'work.assign',payload:{id:'original',ownerToken:'{"name":"PRIVATE-NAME"}'}});assert.doesNotMatch(JSON.stringify(hint),/PRIVATE-NAME/);
});
test('original invoice and goods task return keys retain exact customer roots and reject duplicate roots',()=>{
  const s=seed();s.bookings.push({id:'SCOPE-B',userId:'u1',storeId:'xingfu'});s.serviceInvoices.push({id:'SCOPE-I',bookingId:'SCOPE-B',storeId:'xingfu'});s.goods.push({id:'SCOPE-G',userId:'u2',source:{storeId:'xingfu'}});
  const scopes=createAppSessionScopes({key,currentContext:()=>({state:s,actor:group,originScope:'https://source.test'})});
  for(const [category,id,path,extra,userId,root] of [['invoice','SCOPE-I','invoices/SCOPE-I',{},'u1','booking'],['goods-shipping','SCOPE-G','goods/SCOPE-G',{orderId:'SCOPE-G'},'u2','goods-order']]){
    const task={id:category+':'+id,category,sourceId:id,storeId:'xingfu',requiredRoute:category==='invoice'?'invoices':'goods',routes:{group:'/group/'+path},allowedJobs:{group:['all','finance']},...extra},context=createTaskReturnContext(s,group,{taskKey:task.id,task,listHash:'/group/tasks?status=open',token:'scope-'+id}),rawKey=key+'-task-return:'+context.token;
    const result=scopes.scopeForDraft({state:s,actor:group,key:rawKey,value:JSON.stringify(context)});assert.ok(result.subjects.some(x=>x.kind==='user'&&x.id===userId));assert.ok(result.roots.some(x=>x.kind===root));
    const completed=structuredClone(s);completed[category==='invoice'?'serviceInvoices':'goods'].find(x=>x.id===id).status='done';assert.equal(scopes.scopeForDraft({state:completed,actor:group,key:rawKey,value:JSON.stringify(context)}).sourceToken,result.sourceToken);
    const changed=structuredClone(s),container=category==='invoice'?'serviceInvoices':'goods';changed[container].push({...changed[container].find(x=>x.id===id)});assert.throws(()=>scopes.scopeForDraft({state:changed,actor:group,key:rawKey,value:JSON.stringify(context)}));
  }
});
test('ordinary service entry/recovery return scope keeps the original payment root while missing rule snapshots stay readonly',()=>{
  let s=seed();const user={role:'user',userId:'u1'},p={requestId:'SCOPE-CREATE',storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:Math.ceil((s.now+4*3600000)/1800000)*1800000,mode:'specified',genderPreference:'any',contactName:'合成来源',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true};
  s=reduce(s,user,'booking.create',p);const bookingId=s.bookings.at(-1).id;s=reduce(s,user,'booking.pay',{id:bookingId,requestId:'SCOPE-PAY',outcome:'success'});const entry=s.serviceFinanceEntries.find(x=>x.bookingId===bookingId);delete s.bookings.find(x=>x.id===bookingId).serviceFinanceSnapshot;
  s.serviceFinanceRecoveries.push({id:'SCOPE-DEBT',entryId:entry.id,bookingId,paymentId:entry.paymentId,storeId:entry.storeId});
  const actor={role:'group',job:'finance'},scopes=createAppSessionScopes({key,currentContext:()=>({state:s,actor,originScope:'https://source.test'})});
  for(const kind of ['entry','recovery']){const sourceId=kind==='entry'?entry.id:'SCOPE-DEBT',task={id:'service-finance:'+kind+':'+sourceId,category:'service-finance-'+kind,sourceId,entryId:entry.id,bookingId,paymentId:entry.paymentId,storeId:entry.storeId,...(kind==='recovery'?{recoveryId:sourceId}:{}),requiredRoute:'service-finance',routes:{group:kind==='entry'?'/group/service-finance/entry/'+entry.id:'/group/service-finance/recoveries'},allowedJobs:{group:['finance']}};
    const context=createTaskReturnContext(s,actor,{taskKey:task.id,task,listHash:'/group/tasks',token:'scope-'+kind}),rawKey=key+'-task-return:'+context.token,result=scopes.scopeForDraft({state:s,actor,key:rawKey,value:JSON.stringify(context)});
    assert.ok(result.subjects.some(x=>x.kind==='user'&&x.id==='u1'));assert.ok(result.roots.some(x=>x.kind==='service-finance-entry'&&x.id===entry.id));assert.ok(result.roots.some(x=>x.kind==='booking-payment'&&x.id===entry.paymentId));if(kind==='recovery')assert.ok(result.roots.some(x=>x.kind==='service-finance-recovery'&&x.id===sourceId));
    const bad=structuredClone(s);bad.serviceFinanceEntries.find(x=>x.id===entry.id).paymentId='OTHER';assert.throws(()=>scopes.scopeForDraft({state:bad,actor,key:rawKey,value:JSON.stringify(context)}));
  }
});
