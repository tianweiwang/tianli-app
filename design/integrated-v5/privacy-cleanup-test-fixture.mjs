// Standard IndexedDB API unit stand-in: exact keys, copy-on-write transactions,
// completion/abort, and injected I/O faults. No business cleanup rules live here.
import { upgradeAccounts, accountCommand, resolveAccountActor } from './staff-accounts.mjs';
import { privacyCommand, privacyProfile } from './privacy.mjs';
import { lifecycleFingerprint } from './organization-lifecycle-projection.mjs';
import { createPrivacyCleanupStorage } from './privacy-cleanup-storage.mjs';
export const NOW=Date.parse('2026-10-04T10:00:00+08:00');
export function createIndexedDBStandin() {
  const databases=new Map(),events=[];let hook=null;
  function transaction(db,storeNames,mode='readonly') {
    const name=Array.isArray(storeNames)?storeNames[0]:storeNames, original=db.stores.get(name);
    if(!original)throw Error('missing store');
    const working=new Map(original),tx={mode,aborted:false,pending:0,closed:false};
    const finish=()=>queueMicrotask(()=>{if(tx.closed||tx.pending)return;if(tx.aborted){tx.closed=true;tx.onabort?.();return;}if(mode==='readwrite')db.stores.set(name,working);tx.closed=true;events.push({op:'complete',db:db.name,store:name,mode});hook?.({op:'complete',db:db.name,store:name,mode});tx.oncomplete?.();});
    tx.abort=()=>{tx.aborted=true;finish();};
    function request(op,key,value) {if(tx.closed)throw Error('inactive tx');tx.pending++;const r={};queueMicrotask(()=>{
      try {const event={op,db:db.name,store:name,key};events.push(event);hook?.(event);if(tx.aborted)throw Error('aborted');r.result=op==='get'?structuredClone(working.get(key)):op==='keys'?[...working.keys()]:undefined;if(op==='put')working.set(key,structuredClone(value));if(op==='delete')working.delete(key);r.onsuccess?.();}catch(error){r.error=error;tx.aborted=true;r.onerror?.();}finally{tx.pending--;finish();}
    });return r;}
    tx.objectStore=store=>{if(store!==name)throw Error('wrong store');return {get:key=>request('get',key),getAllKeys:()=>request('keys'),put:(value,key)=>request('put',key,value),delete:key=>{if(mode!=='readwrite')throw Error('readonly');return request('delete',key);}};};finish();return tx;
  }
  const indexedDB={open(name,version){const r={};queueMicrotask(()=>{let db=databases.get(name),fresh=!db;if(!db){db={name,version,stores:new Map()};}
    let aborted=false;r.transaction={abort(){aborted=true;}};r.result={createObjectStore(store){db.stores.set(store,new Map());},transaction:(stores,mode)=>transaction(db,stores,mode)};
    if(fresh)r.onupgradeneeded?.();if(aborted){r.onerror?.();return;}if(fresh)databases.set(name,db);events.push({op:'open',db:name});r.onsuccess?.();});return r;}};
  return {indexedDB,events,databases,setHook(value){hook=value;},clear(){databases.clear();events.length=0;hook=null;},store(db,name){return databases.get(db)?.stores.get(name);}};
}

export function fixture(idb) {
  let state={schema:5,now:NOW,seq:0,users:[{id:'u1',name:'原本人',phone:'13800001111'},{id:'u2',name:'另一人'}],stores:[{id:'s1'}],techs:[{id:'t1',storeId:'s1'}],bookings:[{id:'B1',userId:'u1',storeId:'s1',techId:'t1',status:'done',createdAt:NOW-20000,completedAt:NOW-15000,contactName:'PRIVATE-CONTACT',phone:'PRIVATE-PHONE',payment:{id:'P1',status:'paid',createdAt:NOW-19000,amountCents:20000},refunds:[],extensions:[],disputes:[]}],goods:[],logs:[]};upgradeAccounts(state);let seq=0;
  const ctx=s=>({id:prefix=>prefix+(++s.seq),log:()=>{},fail:message=>{throw Error(message);}});
  function run(fn,actor,type,p) {const next=structuredClone(state),out=fn(next,actor,type,{requestId:'cleanup-fixture-'+(++seq),...p},ctx(next));state=next;return out;}
  const user={role:'user',userId:'u1'};
  const entered=run(accountCommand,user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(state,entered);
  const a=run(accountCommand,admin,'account.create',{name:'当前集团客服',reason:'合成临时测试岗位'}),account=run(accountCommand,admin,'account.grant',{id:a.id,version:a.version,job:'support',reason:'合成当前授权'});
  const staffEntered=run(accountCommand,user,'account.enter',{accountId:a.id,grantId:account.grants[0].id}),actor=resolveAccountActor(state,staffEntered);
  const closure=run(privacyCommand,user,'privacy.request',{version:privacyProfile(state,'u1').version,acknowledged:true,reason:'合成关闭源测试'});
  run(privacyCommand,actor,'privacy.close',{id:closure.id,version:closure.version,acknowledged:true,reason:'只测试合成原闭域',custodian:'合成负责岗位'});
  const coverage={originScope:'https://synthetic.test',revision:1,ledgerComplete:true,uploadsComplete:true,unregisteredStoredRefs:[],tabIds:['synthetic-tab'],tabs:[{id:'synthetic-tab',revision:1,status:'acknowledged',drafts:[]}]};
  const storage=createPrivacyCleanupStorage({indexedDB:idb.indexedDB,originScope:coverage.originScope});
  const f={get s(){return state;},actor,user,coverage,storage,closureId:closure.id,currentContext:()=>({state,actor:f.actor,coverage}),
    work(job) {const x=run(accountCommand,admin,'account.create',{name:'合成'+job,reason:'隔离权限测试'}),granted=run(accountCommand,admin,'account.grant',{id:x.id,version:x.version,job,reason:'隔离岗位授权'});const entered=run(accountCommand,user,'account.enter',{accountId:x.id,grantId:granted.grants[0].id});return resolveAccountActor(state,entered);},
    register(file,library='invoice',id='U1') {state.privacyUploadReservations??=[];state.privacyUploadReservations.push({id,userId:'u1',closureId:closure.id,ref:file.ref,library,file:structuredClone(file),source:{kind:'booking',id:'B1'},status:'cancelled',version:1,createdAt:NOW-10000,cancelledAt:NOW-9000,cancelledBy:{role:'user',userId:'u1'}});return state.privacyUploadReservations.at(-1);},
    policy(r) {
      // Explicit isolated published-policy input, never a real formal approval.
      const scope={kind:'cancelled-upload',library:r.library,userId:r.userId,closureId:r.closureId},by={accountId:actor.accountId,grantId:actor.grantId};
      const source={id:'PS-'+r.id,version:1,status:'confirmed',reference:'SYNTHETIC-TEST-ONLY',issuer:'isolated formal-authority fixture',basis:'isolated approved cancellation disposal fixture',purpose:'cancelled-unsubmitted-upload',scope,approvedAt:NOW-8000,recordedAt:NOW-7000,recordedBy:by,retentionMilliseconds:1000};
      const p={id:'PP-'+r.id,version:1,status:'published',sourceId:source.id,sourceVersion:source.version,sourceToken:lifecycleFingerprint(source),basis:source.basis,purpose:source.purpose,scope,retentionMilliseconds:source.retentionMilliseconds,effectiveAt:NOW-7000,publishedAt:NOW-6000,publishedBy:by};
      (state.privacyCleanupPolicySources??=[]).push(source);(state.privacyCleanupPolicies??=[]).push(p);r.cleanupDecision={policyId:p.id,policyVersion:1,startFact:'upload-cancelled',startAt:r.cancelledAt,retainUntil:r.cancelledAt+1000,action:'delete'};return p;
    }};
  return f;
}
