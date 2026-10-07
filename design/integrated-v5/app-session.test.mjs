import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppSessionRuntime} from './app-session.mjs';
import {lifecycleFingerprint as hash} from './organization-lifecycle-projection.mjs';
class Storage {constructor(){this.values=new Map();}get length(){return this.values.size;}key(i){return [...this.values.keys()][i]??null;}getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,String(v));}removeItem(k){this.values.delete(k);}}
function fixture({noLocks=false}={}){const storage=new Storage(),sessionStorage=new Storage(),key='tianli-integrated-v5';storage.setItem(key,JSON.stringify({schema:5,now:1000,users:[{id:'u1'}],stores:[],techs:[],bookings:[{id:'B1',userId:'u1'}]}));let busy=false,seq=0,tail=Promise.resolve(),requests=0;
  const locks={request(name,fn){assert.equal(name,key);requests++;const next=tail.then(async()=>{assert.equal(busy,false);busy=true;try{return await fn();}finally{busy=false;}});tail=next.catch(()=>{});return next;}};
  const runtime=createAppSessionRuntime({key,storage,sessionStorage,locks:noLocks?null:locks,currentContext:()=>({actor:{role:'user',userId:'u1'},originScope:'https://app-session.test'}),scopeForDraft:c=>{if(c.key!=='draft')throw Error('unknown key');return{kind:'booking-draft',disposition:'scoped',source:{kind:'booking',id:'B1'},sourceToken:c.state.bookings[0],subjects:[{kind:'user',id:'u1'}],roots:[{kind:'booking',id:'B1'}]};},listStoredRefs:()=>[],id:()=> 'SESSION-'+ ++seq});return{runtime,storage,sessionStorage,key,get requests(){return requests;}};
}
test('same KEY callback binds tabs without nested request and escaped capability cannot borrow a later lock',async()=>{
  const h=fixture();let escaped;
  await h.runtime.withMutation(async cap=>{escaped=cap;await cap.ensureRegistered();await cap.tabs.mutate('write',s=>s.setItem('draft','first'));});assert.equal(h.requests,1);
  await h.runtime.withMutation(async cap=>{assert.throws(()=>escaped.load(),/结束/);await assert.rejects(escaped.tabs.mutate('write',s=>s.setItem('draft','bad')),/结束/);await cap.tabs.mutate('replace',s=>s.setItem('draft','second'));});
  assert.equal(h.sessionStorage.getItem('draft'),'second');assert.equal(h.requests,2);
});
test('queued actual writers settle in order before a caller flushes; unrelated event receives its own lock',async()=>{
  const h=fixture(),order=[];const one=h.runtime.mutate('write',async s=>{order.push(1);await Promise.resolve();s.setItem('draft','one');order.push(2);}),two=h.runtime.mutate('replace',s=>{assert.equal(s.getItem('draft'),'one');order.push(3);s.setItem('draft','two');});await h.runtime.flush();await Promise.all([one,two]);assert.deepEqual(order,[1,2,3]);assert.equal(h.sessionStorage.getItem('draft'),'two');assert.equal(h.requests,2);
});
test('ordinary no-lock writer remains usable but cannot obtain protocol/upload capability or coverage',async()=>{
  const h=fixture({noLocks:true}),before=h.storage.getItem(h.key);assert.equal((await h.runtime.mutate('write',s=>s.setItem('draft','ordinary'))).status,'uncoordinated');assert.equal(h.storage.getItem(h.key),before);await assert.rejects(h.runtime.withMutation(()=>{}, {requireLock:true}),/可靠/);await assert.rejects(h.runtime.coverage(),/可靠/);assert.equal(h.sessionStorage.getItem('draft'),'ordinary');
});
test('strict ledger failure does not fall back to seed or write the original session',async()=>{
  const h=fixture();h.storage.setItem(h.key,'broken original');await assert.rejects(h.runtime.mutate('write',s=>s.setItem('draft','bad')),/读取失败/);assert.equal(h.sessionStorage.getItem('draft'),null);assert.equal(h.storage.getItem(h.key),'broken original');
});
test('business and subsequent session journal use fresh ledger so domain result is retained',async()=>{
  const h=fixture();await h.runtime.withMutation(async cap=>{await cap.ensureRegistered();const before=cap.load(),next=structuredClone(before);next.originalResult={id:'ACTUAL-RESULT'};cap.commit(next,{expectedStateToken:hash(before)});await cap.tabs.mutate('write',s=>s.setItem('draft','submitted'));});assert.deepEqual(h.runtime.load().originalResult,{id:'ACTUAL-RESULT'});assert.equal(h.sessionStorage.getItem('draft'),'submitted');
});

test('unawaited owned writer cannot write or acknowledge after its callback ends; original lock drains it before release',async()=>{
  const h=fixture();let release,started,pending,finished=false;
  const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);
  const outer=h.runtime.withMutation(async cap=>{await cap.ensureRegistered();pending=cap.tabs.mutate('write',async s=>{started();await gate;s.setItem('draft','AFTER-CAP-END');});pending.catch(()=>{});await ready;}).finally(()=>finished=true);
  await ready;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false,'KEY lock must still own the suspended operation');
  release();await assert.rejects(pending,/结束|未完整|未持久/);await outer;
  assert.equal(h.sessionStorage.getItem('draft'),null);const row=h.runtime.load().privacyUploadTabs[0];assert.equal(row.status,'pending');assert.equal(row.ackRevision,null);
});

test('escaped completed writer cannot read or write even while another writer owns the same callback',async()=>{
  const h=fixture();let escaped;
  await h.runtime.withMutation(async cap=>{await cap.ensureRegistered();await cap.tabs.mutate('write',s=>{s.setItem('draft','IN-LOCK');escaped=s;});
    for(const attempt of [()=>escaped.getItem('draft'),()=>escaped.setItem('draft','BAD'),()=>escaped.removeItem('draft')])assert.throws(attempt,/结束/);
    await cap.tabs.mutate('replace',s=>s.setItem('draft','SECOND'));
  });assert.throws(()=>escaped.setItem('draft','OUTSIDE-LOCK'),/结束/);assert.equal(h.sessionStorage.getItem('draft'),'SECOND');
});
