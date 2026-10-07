import test from 'node:test';
import assert from 'node:assert/strict';
import { saveInvoiceFile, readInvoiceFile } from './invoice-files.mjs';
import { saveMedia, readMedia } from './media.mjs';
import { saveCareUpload } from './care-upload.mjs';
import { careUploadScope, careEvidenceFile, careCommand } from './service-care.mjs';
import { prepareCareEvidence } from './care-file-validation.mjs';
import { saveQualificationUpload } from './qualification-upload.mjs';
import { qualificationUploadScope, qualificationCommand, qualificationEvidenceFile } from './tech-qualification.mjs';
import { prepareQualificationEvidence } from './qualification-file-validation.mjs';
import { closedRightsBinding, closedRightsView } from './privacy-closed-rights.mjs';
import { lifecycleFingerprint as hash } from './organization-lifecycle-projection.mjs';
import { privacyCleanupInventory } from './privacy-cleanup-inventory.mjs';
import { createPrivacyCleanupStorage } from './privacy-cleanup-storage.mjs';
import { createIndexedDBStandin, fixture } from './privacy-cleanup-test-fixture.mjs';
import { createPrivacyUploadRegistry, PRIVACY_UPLOAD_PURPOSES } from './privacy-upload-registry.mjs';
import {createPrivacyUploadTabs} from './privacy-upload-tabs.mjs';

// Runtime unit, not a browser test: real Blob/SHA, original file-store functions,
// care/qualification scope, file preparation and commands. Only IDB/decoder and
// Root's injected ledger/lock runtime are synthetic. No policy or real data I/O.
const idb=createIndexedDBStandin(),oldIDB=globalThis.indexedDB,oldDecoder=globalThis.createImageBitmap;
globalThis.indexedDB=idb.indexedDB;
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64');
globalThis.createImageBitmap=async file=>{assert.deepEqual(Buffer.from(await file.arrayBuffer()),PNG);return {width:1,height:1,close(){}};};
test.after(()=>{globalThis.indexedDB=oldIDB;globalThis.createImageBitmap=oldDecoder;});
test.beforeEach(()=>{idb.setHook(null);idb.events.length=0;for(const db of idb.databases.values())for(const store of db.stores.values())store.clear();});
const image=()=>new File([PNG],'PRIVATE-NAME-13800001111.png',{type:'image/png'});
const pdf=n=>new File([`%PDF-1.4\nSYNTHETIC ${n}\n%%EOF`],'PRIVATE-ID-CARD.pdf',{type:'application/pdf'});
const originalScope=(state,actor)=>careUploadScope(state,actor,'care.case-create',{bookingId:'B1'},
  {assertUserScope:(s,a,kind,id)=>closedRightsBinding(s,a,kind,id)});
function setup({purpose='care-evidence',kind='booking',library='invoice',job,tech=false,sourceId='B1'}={}) {
  const f=fixture(idb),a=job?f.work(job):tech?{role:'tech',techId:'t1'}:{...f.user,storeId:'irrelevant-store',techId:'unrelated-ui-hint'};
  let state=structuredClone(f.s),actor=a,held=false,seq=0,commits=0,scopeOverride=null,attachmentOverride=null;
  const storage=createPrivacyCleanupStorage({indexedDB:idb.indexedDB,originScope:f.coverage.originScope});
  const selection={tabId:'SYNTHETIC-TAB',instanceId:'SYNTHETIC-DOCUMENT',formKeyDigest:hash('PRIVATE-FORM-KEY'),generation:'SELECT-1'};
  const h={f,storage,selection,events:[],get state(){return state;},get actor(){return actor;},set actor(value){actor=value;},get held(){return held;},commitHook:null,saveHook:null,readHook:null,contextHook:null,
    replace(value){state=structuredClone(value);},scopeOverride(value){scopeOverride=value;},attachmentOverride(value){attachmentOverride=value;}};
  const deps={
    load:()=>structuredClone(state),currentContext:()=>{h.contextHook?.();return {actor,originScope:f.coverage.originScope};},
    withMutation:async callback=>{assert.equal(held,false,'Root owns one injected mutation boundary');held=true;h.events.push('lock-enter');try{return await callback();}finally{held=false;h.events.push('lock-exit');}},
    scopeFor:(context,operation,row)=>{
      if(scopeOverride)return scopeOverride(context,operation,row);
      const actual=purpose==='care-evidence'?originalScope(context.state,context.actor):{sourceToken:hash({sourceId,kind,version:context.state.sourceVersion||1})};
      return {purpose,library,command:purpose==='care-evidence'?'care.case-create':purpose==='catalog-image'?'product.save':purpose==='legacy-inline-image'?'media.legacy-externalize':'service-promotion.identity-review',
        source:{kind,id:sourceId},sourceToken:actual.sourceToken,subjects:library==='media'?[{kind:'public',id:sourceId}]:[{kind:'user',id:'u1'}],selection:{...selection},
        ...(operation==='cancel'?{cancellation:{id:'CLEAR-1',kind:'clear-selection'}}:{})};
    },
    commit:async (next,{expectedStateToken})=>{assert.equal(held,true);assert.equal(expectedStateToken,hash(state));commits++;h.events.push('commit:'+commits);h.commitHook?.(next,commits);state=structuredClone(next);},
    save:async (lib,file)=>{assert.equal(held,true);const row=state.privacyUploadReservations.at(-1);assert.equal(row.status,'preparing');assert.equal(row.file.size,file.size);h.events.push('put-start');const result=lib==='invoice'?await saveInvoiceFile(file):await saveMedia(file);await h.saveHook?.(result);return result;},
    read:async (lib,file)=>{assert.equal(held,true);const result=lib==='invoice'?await readInvoiceFile(file):await readMedia(file);await h.readHook?.(result);return result;},
    attachmentFor:(next,a,row)=>attachmentOverride?.(next,a,row)||[{source:row.source,slot:'original:0',path:['syntheticOriginalFiles',0],sourceToken:hash(next.syntheticOriginalFiles)}],
    id:()=> 'SYNTHETIC-UPLOAD-'+(++seq)
  };
  h.registry=createPrivacyUploadRegistry(deps);h.deps=deps;
  h.baseScopeFor=(...args)=>{const previous=scopeOverride;scopeOverride=null;try{return deps.scopeFor(...args);}finally{scopeOverride=previous;}};
  return h;
}
const last=h=>h.state.privacyUploadReservations.at(-1);
const storedCount=()=>idb.events.filter(event=>event.op==='put'&&['files','images'].includes(event.store)).length;
const opts=h=>({currentContext:()=>({state:h.state,actor:h.actor}),saveFile:async file=>(await h.registry.save(file)).file});

class DraftStorage {
  constructor(copy){this.values=new Map(copy?.values||[]);}
  get length(){return this.values.size;}key(i){return [...this.values.keys()][i]??null;}
  getItem(key){return this.values.get(key)??null;}setItem(key,value){this.values.set(key,String(value));}removeItem(key){this.values.delete(key);}
}
async function resumable(){
  const h=setup(),key='management:original',documents=[];let serial=0;
  const document=copy=>{
    const storage=new DraftStorage(copy),prefix='RESUME-DOC-'+ ++serial;let ids=0;
    const tabs=createPrivacyUploadTabs({withMutation:h.deps.withMutation,load:h.deps.load,commit:h.deps.commit,currentContext:()=>({...h.deps.currentContext(),writerProtocolVersion:1}),sessionStorage:storage,listStoredRefs:()=>[],
      scopeForDraft:()=>({kind:'management-draft',disposition:'scoped',source:{kind:'booking',id:'B1'},sourceToken:originalScope(h.state,h.actor).sourceToken,subjects:[{kind:'user',id:'u1'}],roots:[{kind:'booking',id:'B1'}]}),id:()=>prefix+'-'+ ++ids});
    const doc={storage,tabs};documents.push(doc);return doc;
  };
  const original=document();await original.tabs.register();Object.assign(h.selection,original.tabs.identity(),{formKeyDigest:hash(key)});delete h.selection.protocolVersion;
  const saved=await h.registry.save(image()),originalSelection=structuredClone(h.selection),encode=(version,chosen)=>JSON.stringify({values:[{name:'evidenceRefs',value:JSON.stringify([saved.file])}],uploadSelections:[{id:saved.id,version,ref:saved.file.ref,field:'evidenceRefs',instanceId:chosen.instanceId,generation:chosen.generation,published:true,released:false}]});
  await original.tabs.mutate('write',storage=>storage.setItem(key,encode(saved.version,originalSelection)));
  const next=async()=>{const doc=document(original.storage);await doc.tabs.register();const proof=await doc.tabs.restoreScoped([key]),chosen={tabId:doc.tabs.identity().tabId,instanceId:doc.tabs.identity().instanceId,generation:'RESUME-'+serial,formKeyDigest:hash(key)};
    doc.registry=createPrivacyUploadRegistry({...h.deps,scopeFor:(ctx,op,row)=>({...h.deps.scopeFor(ctx,op,row),selection:chosen}),resumeFor:()=>doc.tabs.resumeSource(proof.receipt)});doc.proof=proof;doc.selection=chosen;return doc;};
  return {h,key,original,saved,next,encode,originalSelection};
}

test('trusted new-document resume reads original bytes without put and preserves original author/selection; old claim cannot attach or cancel',async()=>{
  const {h,saved,next,originalSelection}=await resumable(),row=structuredClone(last(h)),doc=await next(),puts=storedCount();
  const resumed=await doc.registry.resume(saved.id,saved.version);assert.equal(storedCount(),puts);assert.equal(resumed.version,row.version+1);
  const retained=structuredClone(last(h));assert.deepEqual(await doc.registry.resume(saved.id,saved.version),resumed);assert.deepEqual(last(h),retained);
  assert.deepEqual(last(h).selection,originalSelection);assert.deepEqual(last(h).uploadedBy,row.uploadedBy);assert.deepEqual(last(h).activeClaim.selection,doc.selection);assert.equal(last(h).status,'saved');
  const before=structuredClone(h.state);await assert.rejects(h.registry.cancel(saved.id,last(h).version),e=>e.code==='scope_changed');
  const stale=structuredClone(h.state);stale.syntheticOriginalFiles=[saved.file];assert.throws(()=>h.registry.stageAttach(stale,[saved.id]),e=>e.code==='scope_changed');assert.deepEqual(h.state,before);
  const after=structuredClone(h.state);after.syntheticOriginalFiles=[saved.file];doc.registry.stageAttach(after,[saved.id]);assert.equal(after.privacyUploadReservations.at(-1).status,'attached');
});

test('two copied documents compete for one exact previous version; second cannot reclaim or retire the old tab',async()=>{
  const {h,saved,next,original}=await resumable(),one=await next(),two=await next(),old=structuredClone(h.state.privacyUploadTabs.find(x=>x.id===original.tabs.identity().instanceId));
  await one.registry.resume(saved.id,saved.version);const current=structuredClone(last(h));
  await assert.rejects(two.registry.resume(saved.id,saved.version),e=>e.code==='reservation_changed');
  await assert.rejects(two.registry.resume(saved.id,current.version),e=>e.code==='resume_missing');
  assert.deepEqual(last(h),current);assert.deepEqual(h.state.privacyUploadTabs.find(x=>x.id===old.id),old);
});

test('resume requires live private scoped receipt, original actor/source and unchanged session after actual read',async()=>{
  const {h,key,saved,next}=await resumable(),doc=await next(),before=structuredClone(last(h));
  assert.throws(()=>doc.tabs.resumeSource(structuredClone(doc.proof.receipt)),/复制/);
  h.actor={role:'user',userId:'u2'};await assert.rejects(doc.registry.resume(saved.id,saved.version));h.actor={...h.f.user,storeId:'irrelevant-store',techId:'unrelated-ui-hint'};
  h.readHook=()=>doc.storage.setItem(key,doc.storage.getItem(key)+' ');
  await assert.rejects(doc.registry.resume(saved.id,saved.version));assert.deepEqual(last(h),before);
});

test('resume failure cannot put bytes or replace the saved row; old H1 selection without a predecessor stays pending',async()=>{
  const {h,saved,next}=await resumable(),doc=await next(),before=structuredClone(last(h)),puts=storedCount();
  h.readHook=()=>{throw Error('isolated read failed');};await assert.rejects(doc.registry.resume(saved.id,saved.version));assert.deepEqual(last(h),before);assert.equal(storedCount(),puts);
  h.readHook=null;h.state.privacyUploadTabs.find(x=>x.id===doc.tabs.identity().instanceId).scopedReceipts[0].predecessor=null;
  await assert.rejects(doc.registry.resume(saved.id,saved.version),e=>e.code==='resume_missing');assert.deepEqual(last(h),before);
});

test('真实care选择先持久preparing再原put/read，日志无文件名/正文/UI hint，原名仍能读取',async()=>{
  const h=setup(),rights=closedRightsView(h.state,h.actor),result=await h.registry.save(image()),row=last(h);
  assert.equal(row.status,'saved');assert.equal(row.ioOutcome,'stored_verified');assert.equal(row.usable,true);
  assert.ok(h.events.indexOf('commit:1')<h.events.indexOf('put-start'));assert.deepEqual(h.events.slice(-2),['commit:2','lock-exit']);
  assert.equal(row.file.name,'登记附件');assert.equal(result.file.name,image().name);assert.equal(row.nameDigest,hash(image().name));
  assert.doesNotMatch(JSON.stringify(row),/PRIVATE-|13800001111|unrelated-ui-hint|irrelevant-store|arrayBuffer|"accountName"/);
  assert.equal(row.userId,'u1');assert.equal(row.closureId,h.f.closureId);assert.equal(row.uploadedBy.userId,'u1');
  assert.equal((await readInvoiceFile(result.file)).size,row.file.size);assert.equal((await readInvoiceFile(row.file)).size,row.file.size);
  assert.equal((await h.storage.readStoredRef('invoice',row.ref)).size,row.file.size);assert.deepEqual(closedRightsView(h.state,h.actor),rights);
  const inv=privacyCleanupInventory(h.state,'u1',h.f.closureId,{coverage:h.f.coverage});assert.equal(inv.items.find(item=>item.kind==='cancelled-upload').status,'pending_review');
});
test('登记commit失败在实际put之前停止，不创造未登记字节',async()=>{
  const h=setup();h.commitHook=()=>{throw Error('isolated ledger quota');};await assert.rejects(h.registry.save(image()));assert.equal(storedCount(),0);assert.equal(h.state.privacyUploadReservations,undefined);
});
test('preparing实际回读失败不put，已持久意图如实留存',async()=>{
  const h=setup(),load=h.deps.load;let changed=false;h.deps.load=()=>{if(changed)throw Error('isolated read unavailable');return load();};h.registry=createPrivacyUploadRegistry(h.deps);h.commitHook=()=>{changed=true;};
  await assert.rejects(h.registry.save(image()));assert.equal(storedCount(),0);assert.equal(last(h).status,'preparing');assert.ok(/^invoice-file:[a-f0-9]{64}$/.test(last(h).ref));
});
test('真实原file put失败记failed/I/O待核，不假装clone回滚成功',async()=>{
  const h=setup();idb.setHook(event=>{if(event.op==='put'&&event.store==='files')throw Error('isolated file quota');});
  await assert.rejects(h.registry.save(image()),error=>error.facts.status==='failed'&&error.facts.ioOutcome==='write_unverified');assert.equal(last(h).status,'failed');assert.equal(last(h).usable,false);
  assert.equal(await h.storage.hasStoredRef('invoice',last(h).ref),false);assert.equal(last(h).transitions.length,2);
});
test('put后结果commit失败保留preparing和真实已存字节，不自动重put',async()=>{
  const h=setup();h.commitHook=(_,n)=>{if(n>1)throw Error('isolated result journal quota');};
  await assert.rejects(h.registry.save(image()),error=>error.code==='result_commit_failed'&&error.facts.ioOutcome==='stored_unverified');assert.equal(last(h).status,'preparing');assert.equal(await h.storage.hasStoredRef('invoice',last(h).ref),true);assert.equal(storedCount(),1);
});
test('原文件回读失败记failed/stored_unverified，保留文件和原意图',async()=>{
  const h=setup();h.readHook=()=>{throw Error('isolated read failed');};await assert.rejects(h.registry.save(image()),error=>error.facts.ioOutcome==='stored_unverified');assert.equal(last(h).status,'failed');assert.equal(await h.storage.hasStoredRef('invoice',last(h).ref),true);
});
test('真实保存后generation变化，记saved不可回填且不自动cancel',async()=>{
  const h=setup();h.saveHook=()=>{h.selection.generation='SELECT-2';};await assert.rejects(h.registry.save(image()),error=>error.code==='scope_changed'&&error.facts.status==='saved');
  assert.equal(last(h).status,'saved');assert.equal(last(h).usable,false);assert.equal(last(h).code,'scope_changed');assert.equal(last(h).cancelledBy,undefined);assert.equal(await h.storage.hasStoredRef('invoice',last(h).ref),true);
});
test('原read await后更换本人，真实saved保留原作者，拒新身份回填/取消',async()=>{
  const h=setup();h.readHook=()=>{h.actor={role:'user',userId:'u2'};};await assert.rejects(h.registry.save(image()),error=>error.facts.status==='saved');assert.equal(last(h).uploadedBy.userId,'u1');assert.equal(last(h).status,'saved');await assert.rejects(h.registry.cancel(last(h).id,last(h).version));assert.equal(last(h).status,'saved');
});
test('原booking/payment来源变化拒回填；原成功款不重造',async()=>{
  const h=setup(),amount=h.state.bookings[0].payment.amountCents;h.saveHook=()=>{h.state.bookings[0].payment.id='REPLACED-P1';};await assert.rejects(h.registry.save(image()),error=>error.facts.status==='saved');assert.equal(last(h).usable,false);assert.equal(h.state.bookings[0].payment.amountCents,amount);
});
test('preparing后撤销实际staff工作session，不再put，记failed/not_started',async()=>{
  const h=setup({purpose:'service-promotion',kind:'service-promoter',sourceId:'SYNTHETIC-PROMOTER',job:'support'});
  h.commitHook=next=>{next.staffSessions.find(session=>session.id===h.actor.sessionId).revokedAt=next.now;};
  await assert.rejects(h.registry.save(pdf(1)),error=>error.facts.ioOutcome==='not_started');assert.equal(storedCount(),0);assert.equal(last(h).status,'failed');assert.equal(last(h).uploadedBy.accountId,h.actor.accountId);
});
test('put后实际staff撤权仅补事实，不能附着或用新session冒原作者',async()=>{
  const h=setup({purpose:'service-promotion',kind:'service-promoter',sourceId:'SYNTHETIC-PROMOTER',job:'support'});
  h.saveHook=()=>{h.state.staffSessions.find(session=>session.id===h.actor.sessionId).revokedAt=h.state.now;};await assert.rejects(h.registry.save(pdf(2)),error=>error.facts.status==='saved');assert.equal(last(h).usable,false);assert.equal(last(h).cancelledBy,undefined);
  const next=structuredClone(h.state);next.syntheticOriginalFiles=[last(h).file];assert.throws(()=>h.registry.stageAttach(next,[last(h).id]));assert.equal(last(h).status,'saved');
});
test('错误实际保存metadata及回读字节hash均拒发布saved',async()=>{
  for(const mode of ['metadata','bytes']) {
    const h=setup(),original=h.deps.save;h.deps.save=async (lib,file)=>{const saved=await original(lib,file);return mode==='metadata'?{...saved,ref:'invoice-file:'+'0'.repeat(64)}:saved;};
    if(mode==='bytes')h.deps.read=async()=>new Blob([Buffer.concat([PNG,Buffer.from('tamper')])],{type:'image/png'});
    h.registry=createPrivacyUploadRegistry(h.deps);await assert.rejects(h.registry.save(image()),error=>error.code==='file_mismatch');assert.equal(last(h).status,'failed');assert.equal(last(h).ioOutcome,'stored_unverified');
  }
});
test('同SHA每次选择有独立reservation；同ref多用途继续hold不能抹历史',async()=>{
  const h=setup(),a=await h.registry.save(image());h.selection.generation='SELECT-2';const b=await h.registry.save(image());assert.notEqual(a.id,b.id);assert.equal(a.file.ref,b.file.ref);assert.equal(h.state.privacyUploadReservations.length,2);
  await h.registry.cancel(b.id,b.version);assert.equal(h.state.privacyUploadReservations[0].status,'saved');assert.equal(last(h).status,'cancelled');const item=privacyCleanupInventory(h.state,'u1',h.f.closureId,{coverage:h.f.coverage}).items.find(item=>item.sourceId===b.id);assert.ok(item.blockers.some(value=>value.includes('其他登记')));
});
test('明确原本人清除只记cancelled，metadata兼容原读取和原删除adapter回读',async()=>{
  const h=setup(),saved=await h.registry.save(image());const cancelled=await h.registry.cancel(saved.id,saved.version);assert.equal(cancelled.status,'cancelled');assert.deepEqual(last(h).cancelledBy,{role:'user',actorMode:'personal',userId:'u1'});assert.equal((await readInvoiceFile(last(h).file)).size,last(h).file.size);
  // Adapter interoperability on synthetic bytes only. No policy/cleanup receipt
  // is invented; Root's real delete endpoint remains unavailable.
  const result=await h.storage.deleteStoredRef('invoice',last(h).ref,{beforeDelete:()=>true});assert.equal(result.absent,true);await assert.rejects(readInvoiceFile(last(h).file),/缺失/);
});
test('不存在真实取消事件、旧version、route/代次失效均保留saved',async()=>{
  const h=setup(),saved=await h.registry.save(image()),base=h.baseScopeFor;await assert.rejects(h.registry.cancel(saved.id,saved.version-1));
  h.scopeOverride((ctx,op,row)=>{const value=base(ctx,'save',row);return {...value,cancellation:undefined};});await assert.rejects(h.registry.cancel(saved.id,saved.version),/解除事件/);h.scopeOverride(null);
  h.selection.generation='SELECT-2';await assert.rejects(h.registry.cancel(saved.id,saved.version),/已变化/);assert.equal(last(h).status,'saved');assert.equal(last(h).cancelledAt,undefined);
});
test('同ref仍有本人/另一主体/历史/政策用途，取消不得解除原使用事实',async()=>{
  for(const container of ['serviceInvoices','servicePromoters','privacyCleanupPolicySources','history']) {
    const h=setup(),saved=await h.registry.save(image());h.state[container]=[{id:'RETAINED',userId:'u2',originalFile:saved.file}];await assert.rejects(h.registry.cancel(saved.id,saved.version),error=>error.code==='reference_retained'&&error.facts.cancellationStatus==='pending_review');assert.equal(last(h).status,'saved');assert.equal(last(h).cancelledAt,undefined);assert.equal(last(h).selectionReleasedBy.userId,'u1');assert.equal(last(h).cancellationStatus,'pending_review');assert.equal(last(h).usable,false);assert.equal(await h.storage.hasStoredRef('invoice',saved.file.ref),true);
  }
});
test('worker取消记录真实staff作者，不伪本人/关闭，tech原身份亦无假user',async()=>{
  for(const variant of [{job:'support'},{tech:true}]) {
    const h=setup({purpose:'service-promotion',kind:'service-promoter',sourceId:'SYNTHETIC-PROMOTER',...variant}),saved=await h.registry.save(pdf(3));await h.registry.cancel(saved.id,saved.version);assert.equal(last(h).userId,undefined);assert.equal(last(h).closureId,undefined);assert.equal(last(h).cancelledBy.role,variant.tech?'tech':'group');assert.equal(last(h).cancelledBy.userId,undefined);
  }
});
test('所有原用途的trusted适配shape均可登记，公开图和迁移留真实作者/用途无客户closure',async()=>{
  const sources={'care-evidence':'booking','qualification-evidence':'qualification-profile','service-invoice':'service-invoice','commerce-invoice':'commerce-invoice','service-finance':'service-finance-recovery','service-extra':'service-extra-evidence','service-promotion':'service-promoter','organization-identity':'organization-identity','catalog-image':'catalog-product','legacy-inline-image':'catalog-draft'};
  for(const purpose of PRIVACY_UPLOAD_PURPOSES) {
    // Except care (real getter above), these are explicit trusted scope adapter
    // contract fixtures. They do not prove Root's still-pending original ACLs.
    const media=['catalog-image','legacy-inline-image'].includes(purpose),h=setup({purpose,kind:sources[purpose],sourceId:purpose==='care-evidence'?'B1':'SYNTHETIC-SOURCE',library:media?'media':'invoice',job:purpose==='care-evidence'?undefined:'operations'});
    const saved=await h.registry.save(media||purpose==='care-evidence'?image():pdf(purpose));assert.equal(last(h).purpose,purpose);assert.equal(last(h).file.name,'登记附件');assert.equal(await h.storage.hasStoredRef(media?'media':'invoice',saved.file.ref),true);
    if(purpose!=='care-evidence'){assert.equal(last(h).userId,undefined);assert.equal(last(h).closureId,undefined);assert.ok(last(h).uploadedBy.sessionId);}
  }
});
test('原care upload注入registry→实际prepare/原command→精确槽和attached同一提交',async()=>{
  const h=setup(),files=await saveCareUpload([image()],'care.case-create',{bookingId:'B1'},opts(h)),row=last(h);
  const p={bookingId:'B1',category:'quality',description:'合成原案件证据',requestId:'SYNTHETIC-CARE-CREATE',evidenceRefs:files};
  const ready=await prepareCareEvidence(h.state,h.actor,'care.case-create',p,{currentContext:opts(h).currentContext});
  const next=structuredClone(h.state),ctx={id:prefix=>prefix+'SYNTHETIC-1',log:()=>{},fail:message=>{throw Error(message);},validateEvidenceRefs:refs=>hash(refs)===hash(ready.evidenceRefs),assertUserScope:(s,a,kind,id)=>closedRightsBinding(s,a,kind,id)};
  const created=careCommand(next,h.actor,'care.case-create',p,ctx);
  h.attachmentOverride((s,a)=>{const actual=careEvidenceFile(s,a,created.id,'evidence:0',{assertUserScope:ctx.assertUserScope});assert.equal(actual.ref,files[0].ref);return [{source:{kind:'care-case',id:created.id},slot:'evidence:0',path:['serviceCareCases',0,'evidenceRefs',0],sourceToken:hash(s.serviceCareCases[0])}];});
  await h.deps.withMutation(async()=>{h.registry.stageAttach(next,[row.id]);await h.deps.commit(next,{expectedStateToken:hash(h.state)});});
  assert.equal(last(h).status,'attached');assert.equal(h.state.serviceCareCases[0].evidenceRefs[0].name,image().name);assert.equal(last(h).file.name,'登记附件');assert.equal(last(h).attachedSources[0].slot,'evidence:0');assert.equal(await h.storage.hasStoredRef('invoice',last(h).ref),true);await assert.rejects(h.registry.cancel(row.id,last(h).version));
});
test('真实qualification空表单可先保存，实际assess+原槽getter与attached同clone',async()=>{
  const h=setup({purpose:'qualification-evidence',kind:'qualification-draft',sourceId:'t1',job:'operations'});
  Object.assign(h.state.techs[0],{active:true,reviewStatus:'approved',certificate:'原证书',insurance:'原保单',validUntil:'2027-12-31',serviceIds:['SV1']});h.state.stores[0].serviceIds=['SV1'];h.state.services=[{id:'SV1',active:true}];h.state.techQualifications=[];h.state.techQualificationRequests=[];
  const payload={techId:'t1',storeId:'s1',version:0},selectionScope=(ctx)=>{const original=qualificationUploadScope(ctx.state,ctx.actor,'qualification.assess',payload);return {purpose:'qualification-evidence',library:'invoice',command:'qualification.assess',source:{kind:'qualification-draft',id:'t1'},sourceToken:original,subjects:[{kind:'tech',id:'t1'}],selection:{...h.selection}};};h.scopeOverride(selectionScope);
  const files=await saveQualificationUpload([pdf('qualification')],'qualification.assess',payload,opts(h)),row=last(h);
  const p={...payload,kind:'mature',serviceIds:['SV1'],occurredAt:h.state.now,batch:'合成名单',assessor:'合成原作者',proof:'合成原来源',result:'pass',reason:'合成逐人核验',requestId:'SYNTHETIC-QUALIFICATION',evidenceRefs:files};
  const ready=await prepareQualificationEvidence(h.state,h.actor,'qualification.assess',p,{currentContext:opts(h).currentContext});const next=structuredClone(h.state);qualificationCommand(next,h.actor,'qualification.assess',p,{id:prefix=>prefix+'SYNTHETIC-1',log:()=>{},fail:message=>{throw Error(message);},validateEvidenceRefs:refs=>hash(refs)===hash(ready.evidenceRefs)});
  const profile=next.techQualifications[0],assessment=profile.assessments[0];h.attachmentOverride((s,a)=>{const file=qualificationEvidenceFile(s,a,profile.id,`assessment:${assessment.id}:0`);assert.equal(file.ref,files[0].ref);return [{source:{kind:'qualification-profile',id:profile.id},slot:`assessment:${assessment.id}:0`,path:['techQualifications',0,'assessments',0,'evidenceRefs',0],sourceToken:hash(profile)}];});
  await h.deps.withMutation(async()=>{h.registry.stageAttach(next,[row.id]);await h.deps.commit(next,{expectedStateToken:hash(h.state)});});assert.equal(last(h).status,'attached');assert.equal(last(h).uploadedBy.role,'group');assert.equal(last(h).userId,undefined);assert.equal(h.state.techQualifications[0].grants.length,0);assert.throws(()=>qualificationEvidenceFile(h.state,{role:'tech',techId:'t1'},profile.id,`assessment:${assessment.id}:0`));
});
test('stage不另commit；业务commit失败不假认attached，原保存继续待核',async()=>{
  const h=setup(),saved=await h.registry.save(image()),next=structuredClone(h.state);next.syntheticOriginalFiles=[saved.file];h.registry.stageAttach(next,[saved.id]);assert.equal(next.privacyUploadReservations[0].status,'attached');assert.equal(last(h).status,'saved');h.commitHook=()=>{throw Error('isolated business commit failed');};await assert.rejects(h.deps.withMutation(()=>h.deps.commit(next,{expectedStateToken:hash(h.state)})));assert.equal(last(h).status,'saved');
});
test('假槽、串号、registry自身槽、重复ID、旧clone都拒附着且不部分stage',async()=>{
  const h=setup(),saved=await h.registry.save(image());
  for(const mutation of [s=>s.syntheticOriginalFiles=[{...saved.file,ref:'invoice-file:'+'0'.repeat(64)}],s=>s.syntheticOriginalFiles=[{...saved.file,size:saved.file.size+1}],s=>{s.syntheticOriginalFiles=[saved.file];s.privacyUploadReservations[0].version++;}]) {
    const next=structuredClone(h.state);mutation(next);const before=JSON.stringify(next);assert.throws(()=>h.registry.stageAttach(next,[saved.id]));assert.equal(JSON.stringify(next),before);
  }
  let next=structuredClone(h.state);next.syntheticOriginalFiles=[saved.file];assert.throws(()=>h.registry.stageAttach(next,[saved.id,saved.id]));
  h.attachmentOverride(()=>[{source:{kind:'booking',id:'B1'},slot:'fake',path:['privacyUploadReservations',0,'file'],sourceToken:'fake'}]);assert.throws(()=>h.registry.stageAttach(next,[saved.id]),/不能充当/);
});
test('源与context未接、假本人/closure、未知用途/主体、伪工作账号都在put前拒绝',async()=>{
  for(const change of [value=>({...value,userId:'u2'}),value=>({...value,closureId:'FAKE'}),value=>({...value,purpose:'invented-policy'}),value=>({...value,subjects:[{kind:'user',id:'missing'}]}),value=>({...value,sourceToken:null}),value=>({...value,selection:{...value.selection,formKeyDigest:'PRIVATE-KEY'}})]) {
    const h=setup(),base=h.baseScopeFor;h.scopeOverride((ctx,op,row)=>change(base(ctx,op,row)));const count=storedCount();await assert.rejects(h.registry.save(image()));assert.equal(storedCount(),count);
  }
  const h=setup({purpose:'service-promotion',kind:'service-promoter',sourceId:'SYNTHETIC-PROMOTER',job:'support'});h.actor={role:'group',job:'support',accountId:'FORGED-ACCOUNT'};const count=storedCount();await assert.rejects(h.registry.save(pdf(4)),/工作会话缺失/);assert.equal(storedCount(),count);assert.throws(()=>createPrivacyUploadRegistry({}),/尚未接入/);
});
test('原自由Demo qualification岗位继续原scope权限，作者不冒工作员工',async()=>{
  for(const actor of [{role:'group',job:'operations'},{role:'store',storeId:'s1'},{role:'manager',storeId:'s1'}]) {
    const h=setup();h.actor=actor;h.state.techQualifications=[];
    h.scopeOverride(ctx=>({purpose:'qualification-evidence',library:'invoice',command:'qualification.assess',source:{kind:'qualification-draft',id:'t1'},sourceToken:qualificationUploadScope(ctx.state,ctx.actor,'qualification.assess',{techId:'t1',storeId:'s1',version:0}),subjects:[{kind:'tech',id:'t1'}],selection:{...h.selection}}));
    await h.registry.save(pdf('demo'));assert.equal(last(h).uploadedBy.actorMode,'demo-role');assert.equal(last(h).uploadedBy.role,actor.role);assert.equal(last(h).uploadedBy.accountId,undefined);assert.equal(last(h).uploadedBy.sessionId,undefined);assert.equal(last(h).userId,undefined);assert.equal(last(h).closureId,undefined);
  }
});
test('原自由Demo已关闭门店身份仍拒，原失效工作session不能退回Demo',async()=>{
  const h=setup({purpose:'catalog-image',kind:'catalog-product',sourceId:'SYNTHETIC-PUBLIC',library:'media'});h.actor={role:'store',storeId:'s1'};h.state.stores[0].lifecycleStatus='closed';await assert.rejects(h.registry.save(image()),/门店已关闭/);assert.equal(storedCount(),0);
  const work=setup({purpose:'service-promotion',kind:'service-promoter',sourceId:'SYNTHETIC-PROMOTER',job:'support'});work.state.staffSessions.find(row=>row.id===work.actor.sessionId).revokedAt=work.state.now;await assert.rejects(work.registry.save(pdf('revoked')),/工作会话已失效/);assert.equal(storedCount(),0);
});
