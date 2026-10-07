import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce} from './engine.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';
import {serviceFinanceCompositionReview,prepareServiceFinanceCompositionEvidence,authorizedServiceFinanceCompositionFile} from './service-finance-composition-review.mjs';
import {privacyUploadScope,privacyUploadAttachmentSlots} from './privacy-upload-scope.mjs';
import {createPrivacyUploadRegistry} from './privacy-upload-registry.mjs';
import {saveInvoiceFile,readInvoiceFile} from './invoice-files.mjs';
import {createIndexedDBStandin} from './privacy-cleanup-test-fixture.mjs';
import {lifecycleFingerprint as hash} from './organization-lifecycle-projection.mjs';

// Isolated original reduce/Blob/registry flow; only storage and the KEY lock are stand-ins.
const idb=createIndexedDBStandin(),previousIDB=globalThis.indexedDB;globalThis.indexedDB=idb.indexedDB;
test.after(()=>{globalThis.indexedDB=previousIDB;});
const finance={role:'group',job:'finance'},buyer={role:'user',userId:'u1'},tech={role:'tech',techId:'lin'};
async function fixture(){let state=seed(),seq=0;const run=(type,p={},actor=finance)=>{let result;state=reduce(state,actor,type,{requestId:'SETUP-'+ ++seq,...p},x=>{result=x;});return result;};
  run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:state.now,version:0,reason:'isolated original rule'});
  run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:Math.ceil((state.now+4*3600000)/1800000)*1800000,mode:'specified',genderPreference:'any',contactName:'本地合成顾客',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true},buyer);
  const b=state.bookings.at(-1),id=b.id;run('booking.pay',{id,outcome:'success'},buyer);run('booking.accept',{id},tech);run('clock.advance',{minutes:Math.ceil((b.startAt-state.now)/60000)});run('booking.start',{id},tech);run('clock.advance',{minutes:b.duration});run('booking.finish',{id,mode:'normal'},tech);run('clock.advance',{minutes:2881});
  let entry=state.serviceFinanceEntries.find(e=>e.bookingId===id);run('finance.split-start',{id:entry.id,version:entry.version,outcome:'success'});entry=state.serviceFinanceEntries.find(e=>e.bookingId===id);
  // Emulate only a legacy missing-classification record, preserving actual original cash facts.
  delete entry.split.cashComposition;delete entry.split.cashCompositionRequest;
  const adminResult=run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'},buyer),admin=resolveAccountActor(state,adminResult);
  const account=run('account.create',{name:'组成附件原财务',reason:'actual isolated account'},admin),granted=run('account.grant',{id:account.id,version:account.version,job:'finance',reason:'actual isolated grant'},admin);
  const login=run('account.enter',{accountId:account.id,grantId:granted.grants[0].id},buyer),actor=resolveAccountActor(state,login);
  return {state,actor,entryId:entry.id,key:'split:'+entry.split.id};
}
async function uploadAndSubmit(h,type,number){
  const view=serviceFinanceCompositionReview(h.state,h.actor,h.entryId,h.key),selection={tabId:'C03-TAB',instanceId:'C03-DOCUMENT',generation:'FILE-'+number,formKeyDigest:hash('C03-FORM-'+number)},base={id:h.entryId,version:view.entryVersion,sourceKey:h.key,sourceToken:view.sourceToken};
  let before,payload,result,held=false,slots;
  const registry=createPrivacyUploadRegistry({load:()=>structuredClone(h.state),currentContext:()=>({actor:h.actor,originScope:'https://composition.test'}),withMutation:async fn=>{assert.equal(held,false);held=true;try{return await fn();}finally{held=false;}},
    scopeFor:c=>privacyUploadScope(c.state,c.actor,type,base,{selection,field:'file'}),commit:(next,{expectedStateToken})=>{assert.ok(held);assert.equal(hash(h.state),expectedStateToken);h.state=structuredClone(next);},
    save:(_,file)=>saveInvoiceFile(file),read:(_,file)=>readInvoiceFile(file),attachmentFor:(next,actor,row)=>{slots=privacyUploadAttachmentSlots(before,next,actor,type,payload,result,row,{field:'file'});return slots;},id:()=> 'C03-UPLOAD-'+number});
  const saved=await registry.save(new File(['%PDF-1.4\nactual isolated composition '+number+'\n%%EOF'],'组成依据.pdf',{type:'application/pdf'}));
  payload={...base,requestId:'C03-REQUEST-'+number,hCents:view.facts.normalCents-(number-1)*100,csCents:(number-1)*100,retainedCsCents:null,allocations:[],basisReference:'C03-EVIDENCE-'+number,basisDescription:'按原分类凭据逐项核验',reason:'本地原组成分类验证',evidenceRefs:[saved.file],...(type.endsWith('reconcile')?{supersedes:view.supersedes}:{})};
  before=structuredClone(h.state);const prepared=await prepareServiceFinanceCompositionEvidence(before,h.actor,type,payload,{readFile:readInvoiceFile});
  const next=reduce(before,h.actor,type,payload,value=>{result=value;},{compositionPrepared:prepared});registry.stageAttach(next,[saved.id]);h.state=next;
  return {before,payload,result,slots,saved};
}

test('C03 original working-finance upload confirms and reconciles exact SFC evidence, retaining all original cash',async()=>{
  const h=await fixture(),cash=structuredClone(h.state.bookings),first=await uploadAndSubmit(h,'finance.composition-confirm',1);
  assert.equal(h.state.privacyUploadReservations.at(-1).status,'attached');assert.equal(first.result.by.id,h.actor.accountId);
  assert.deepEqual(first.slots.map(x=>({source:x.source,slot:x.slot,path:x.path})),[{source:{kind:'service-finance-composition',id:first.result.id},slot:'evidence:0',path:['serviceFinanceCompositions',0,'evidenceRefs',0]}]);
  const second=await uploadAndSubmit(h,'finance.composition-reconcile',2);assert.equal(second.slots[0].path[1],1);
  assert.deepEqual(authorizedServiceFinanceCompositionFile(h.state,h.actor,first.result.id,'evidence:0',first.saved.file.ref),first.saved.file);
  assert.deepEqual(h.state.bookings,cash);assert.equal(h.state.serviceFinanceCompositions.length,2);
});

test('C03 selection rejects wrong source/version and privilege; attachment checks actual account digest and exact result source',async()=>{
  const h=await fixture(),view=serviceFinanceCompositionReview(h.state,h.actor,h.entryId,h.key),p={id:h.entryId,version:view.entryVersion,sourceKey:h.key,sourceToken:view.sourceToken},options={selection:{tabId:'T',instanceId:'I',generation:'G',formKeyDigest:hash('K')},field:'file'};
  for(const changed of [{...p,version:p.version+1},{...p,sourceToken:'bad'},{...p,sourceKey:'split:missing'}])assert.throws(()=>privacyUploadScope(h.state,h.actor,'finance.composition-confirm',changed,options));
  assert.throws(()=>privacyUploadScope(h.state,{role:'group',job:'support'},'finance.composition-confirm',p,options));
  const submitted=await uploadAndSubmit(h,'finance.composition-confirm',1),reservation=submitted.before.privacyUploadReservations.at(-1),bad=structuredClone(h.state);
  bad.serviceFinanceRequests.at(-1).actorDigest=hash({role:'group',job:'finance',id:'group'});
  assert.throws(()=>privacyUploadAttachmentSlots(submitted.before,bad,h.actor,'finance.composition-confirm',submitted.payload,submitted.result,reservation,{field:'file'}),/作者/);
});
