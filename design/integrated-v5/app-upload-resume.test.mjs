import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppSessionRuntime} from './app-session.mjs';
import {createAppUploadRuntime} from './app-upload.mjs';
import {privacyUploadScope} from './privacy-upload-scope.mjs';
import {createIndexedDBStandin,fixture} from './privacy-cleanup-test-fixture.mjs';
import {saveInvoiceFile,readInvoiceFile} from './invoice-files.mjs';
import {lifecycleFingerprint as hash} from './organization-lifecycle-projection.mjs';

const KEY='tianli-integrated-v5',draftKey=KEY+'-management:original-care';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64');
class Storage{constructor(copy){this.values=new Map(copy?.values||[]);}get length(){return this.values.size;}key(i){return [...this.values.keys()][i]??null;}getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,String(v));}removeItem(k){this.values.delete(k);}}
const idb=createIndexedDBStandin(),originalIDB=globalThis.indexedDB,originalDecoder=globalThis.createImageBitmap;
globalThis.indexedDB=idb.indexedDB;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
test.after(()=>{globalThis.indexedDB=originalIDB;globalThis.createImageBitmap=originalDecoder;});
function setup(){
  idb.clear();const original=fixture(idb),storage=new Storage();storage.setItem(KEY,JSON.stringify(original.s));let sequence=0,tail=Promise.resolve(),busy=false,requests=0;
  const locks={request(key,work){assert.equal(key,KEY);requests++;const next=tail.then(async()=>{assert.equal(busy,false);busy=true;try{return await work();}finally{busy=false;}});tail=next.catch(()=>{});return next;}};
  const doc=copy=>{const native=new Storage(copy),form={},payload={bookingId:'B1'},currentContext=()=>({actor:original.user,originScope:original.coverage.originScope,route:'#/user/care/new'});
    let session;session=createAppSessionRuntime({key:KEY,storage,sessionStorage:native,locks,currentContext,listStoredRefs:()=>[],id:()=> 'RESUME-'+ ++sequence,
      scopeForDraft:c=>{assert.equal(c.key,draftKey);const source=privacyUploadScope(c.state,c.actor,'care.case-create',payload,{selection:{...session.identity(),generation:'scope-only',formKeyDigest:hash(draftKey)},field:'evidenceRefs'});return{kind:'management-draft',disposition:'scoped',source:source.source,sourceToken:source.sourceToken,subjects:source.subjects,roots:[source.source]};}});
    const upload=createAppUploadRuntime({key:KEY,storage,locks,sessionRuntime:session,currentContext,saveFile:saveInvoiceFile,readFile:readInvoiceFile,id:()=> 'UPLOAD-'+ ++sequence});
    const options={command:'care.case-create',field:'evidenceRefs',formKey:draftKey,payload:()=>payload,active:()=>true};
    const write=file=>session.mutate('write',s=>s.setItem(draftKey,JSON.stringify({values:[{name:'evidenceRefs',value:JSON.stringify([file])}],uploadSelections:upload.metadata(form)})));
    return{native,form,payload,session,upload,options,write};};
  return{doc,storage,get requests(){return requests;},puts:()=>idb.events.filter(e=>e.op==='put').length};
}
test('app helper shares exact document identity and resumes trusted draft without another put; old capability cannot cancel',async()=>{
  const h=setup(),one=h.doc(),publish=one.upload.begin(one.form,'evidenceRefs');
  const file=await one.upload.save(one.form,new File([PNG],'private-name.png',{type:'image/png'}),one.options);await publish();await one.write(file);
  const prior=one.upload.metadata(one.form),before=JSON.parse(h.storage.getItem(KEY)).privacyUploadReservations[0],puts=h.puts();
  assert.equal(before.selection.instanceId,one.session.identity().instanceId);
  const two=h.doc(one.native);await two.session.initialize();const proof=await two.session.restoreScoped([draftKey]);
  assert.equal(await two.upload.resume(two.form,two.options,prior,proof.receipt),true);assert.equal(h.puts(),puts);
  const resumed=two.upload.metadata(two.form)[0],after=JSON.parse(h.storage.getItem(KEY)).privacyUploadReservations[0];
  assert.deepEqual(after.selection,before.selection);assert.deepEqual(after.uploadedBy,before.uploadedBy);assert.equal(resumed.instanceId,two.session.identity().instanceId);assert.equal(resumed.version,after.version);
  await assert.rejects(one.upload.release(one.form,null,'clear-selection'));await two.write(file);
  const three=h.doc(two.native);await three.session.initialize();const newer=await three.session.restoreScoped([draftKey]);
  assert.equal(await three.upload.resume(three.form,three.options,two.upload.metadata(two.form),newer.receipt),true);assert.equal(h.puts(),puts);
});
test('app helper cannot accept copied receipt or unproven old draft metadata',async()=>{
  const h=setup(),one=h.doc(),publish=one.upload.begin(one.form,'evidenceRefs');const file=await one.upload.save(one.form,new File([PNG],'original.png',{type:'image/png'}),one.options);await publish();await one.write(file);
  const two=h.doc(one.native);await two.session.initialize();const proof=await two.session.restoreScoped([draftKey]),before=h.storage.getItem(KEY);
  await assert.rejects(two.upload.resume(two.form,two.options,one.upload.metadata(one.form),structuredClone(proof.receipt)),/复制/);assert.equal(h.storage.getItem(KEY),before);
  await assert.rejects(two.upload.resume(two.form,two.options,one.upload.metadata(one.form),null),/旧草稿/);
});
