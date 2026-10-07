import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,createIndexedDBStandin} from './privacy-cleanup-test-fixture.mjs';
import {qualityPolicyCommand,qualityPolicyStream,qualityPolicyView} from './quality-policy.mjs';
import {appSessionCommandSource,createAppSessionScopes,appSessionAuthor} from './app-session-scope.mjs';
import {createAppSessionRuntime} from './app-session.mjs';
import {privacyCleanupInventory,collectPrivacyFileReferences} from './privacy-cleanup-inventory.mjs';
import {accountCommand} from './staff-accounts.mjs';
import {lifecycleFingerprint as hash} from './organization-lifecycle-projection.mjs';

// Original policy/account/session functions over isolated state; no browser,
// formal policy values, physical cleanup, or new business state fixture in app.
const key='tianli-integrated-v5',scope={subject:'user',domain:'service-order',storeIds:null,serviceIds:null};
const copy=value=>structuredClone(value);
class Storage{constructor(){this.values=new Map();}get length(){return this.values.size;}key(i){return [...this.values.keys()][i]??null;}getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,String(v));}removeItem(k){this.values.delete(k);}}
function original(){
  const f=fixture(createIndexedDBStandin());f.s.services=[{id:'sv1'}];let serial=0;
  const payload=(chosen=scope)=>{const stream=qualityPolicyStream(f.s,chosen);return{scope:copy(chosen),expectedVersion:stream.version,sourceToken:stream.sourceToken,requestId:'SOURCE-POLICY-'+ ++serial,
    rules:[{id:'isolated-user-interruption',trigger:'user-interruption',sourceKinds:['established-care'],counting:null,effect:{kind:'restrict-new-service',endMode:'duration',durationMs:98765},restoration:{mode:'expiry',serviceIds:null},appeal:{limit:1,execution:'continues'}}],validFrom:f.s.now,validTo:null,basis:{reference:'SYNTHETIC-POLICY-BODY',version:'isolated-only',occurredAt:f.s.now}};};
  const run=(type,p)=>qualityPolicyCommand(f.s,f.actor,type,p,{id:prefix=>prefix+ ++f.s.seq,log(){}});
  const withdrawal=id=>{const row=qualityPolicyView(f.s,f.actor).policies.find(row=>row.id===id);return{id,version:row.version,revision:row.revision,sourceToken:row.sourceToken,reference:'SYNTHETIC-WITHDRAWAL-BODY',basisVersion:'isolated-withdraw',occurredAt:f.s.now,reason:'SYNTHETIC-REASON',requestId:'SOURCE-WITHDRAW-'+ ++serial};};
  return{f,payload,run,withdrawal};
}
const source=(s,a,type,p)=>appSessionCommandSource(s,a,type,p,hash('actual-quality-form'));
const inventory=f=>privacyCleanupInventory(f.s,'u1',f.closureId);

test('quality publish draft binds exact typed group stream; original version/source and actual role remain mandatory',()=>{
  const{f,payload}=original(),p=payload(),before=JSON.stringify(f.s),out=source(f.s,f.actor,'quality.policy-publish',p);
  assert.deepEqual(out.subjects,[{kind:'group',id:'group'}]);assert.equal(out.source.kind,'quality-policy-stream');assert.equal(out.source.id,hash(scope));
  const selected=payload({...scope,storeIds:['s1'],serviceIds:['sv1']});assert.notEqual(source(f.s,f.actor,'quality.policy-publish',selected).source.id,out.source.id);
  for(const bad of [{...p,expectedVersion:1},{...p,sourceToken:hash('different')},{...p,scope:{...scope,userId:'u1'}},{...p,scope:{...scope,storeIds:['s1','s1']}}])assert.throws(()=>source(f.s,f.actor,'quality.policy-publish',bad));
  for(const actor of [{role:'group',job:'support'},{role:'group',job:'all'},f.user])assert.throws(()=>source(f.s,actor,'quality.policy-publish',p));
  assert.equal(JSON.stringify(f.s),before);
});

test('quality withdrawal draft/request writer binds one original published record and exact revision, never a category or another row',async()=>{
  const{f,payload,run,withdrawal}=original(),created=run('quality.policy-publish',payload()),p=withdrawal(created.id),out=source(f.s,f.actor,'quality.policy-withdraw',p);
  assert.deepEqual(out.source,{kind:'quality-policy',id:created.id});assert.deepEqual(out.subjects,[{kind:'group',id:'group'}]);
  for(const bad of [{...p,id:'OTHER'},{...p,revision:2},{...p,version:2},{...p,sourceToken:hash('other')}])assert.throws(()=>source(f.s,f.actor,'quality.policy-withdraw',bad));
  const storage=new Storage(),native=new Storage();storage.setItem(key,JSON.stringify(f.s));let seq=0;
  const current=()=>({state:JSON.parse(storage.getItem(key)),actor:f.actor,originScope:'https://quality-withdraw.test'}),scopes=createAppSessionScopes({key,currentContext:current}),runtime=createAppSessionRuntime({key,storage,sessionStorage:native,locks:{request:(_key,fn)=>fn()},currentContext:current,scopeForDraft:scopes.scopeForDraft,listStoredRefs:()=>[],id:()=> 'WITHDRAW-'+ ++seq});
  const draftKey=key+'-management:withdraw',requestKey=key+'-request:withdraw',draft=JSON.stringify({payload:JSON.stringify(p),values:[{name:'reason',value:''}]});
  scopes.produce(draftKey,draft,{kind:'management-draft',command:'quality.policy-withdraw',payload:{...p,reason:''}});scopes.produce(requestKey,p.requestId,{kind:'request-key',command:'quality.policy-withdraw',payload:p});
  await runtime.mutate('write',facade=>{facade.setItem(draftKey,draft);facade.setItem(requestKey,p.requestId);},{planned:[{key:draftKey,value:draft},{key:requestKey,value:p.requestId}]});
  const fresh=createAppSessionScopes({key,currentContext:current});for(const[k,v]of[[draftKey,draft],[requestKey,p.requestId]])assert.equal(fresh.scopeForDraft({...current(),key:k,value:v}).source.id,created.id);
  assert.doesNotMatch(JSON.stringify(runtime.load().privacyUploadTabs),/SYNTHETIC-WITHDRAWAL-BODY|SYNTHETIC-REASON/);
  run('quality.policy-withdraw',p);assert.throws(()=>source(f.s,f.actor,'quality.policy-withdraw',p));
});

test('unfinished quality draft and request writer survive exact reload without shared body copies or coverage claims',async()=>{
  const{f,payload}=original(),p=payload(),storage=new Storage(),native=new Storage();storage.setItem(key,JSON.stringify(f.s));let seq=0;
  const current=()=>({state:JSON.parse(storage.getItem(key)),actor:f.actor,originScope:'https://quality-source.test'}),scopes=createAppSessionScopes({key,currentContext:current});
  const runtime=createAppSessionRuntime({key,storage,sessionStorage:native,locks:{request:(_key,fn)=>fn()},currentContext:current,scopeForDraft:scopes.scopeForDraft,listStoredRefs:()=>[],id:()=> 'QUALITY-DOC-'+ ++seq});
  const initial={scope:p.scope,expectedVersion:p.expectedVersion,sourceToken:p.sourceToken,retainedRules:[{id:'original-rule',basis:'RETAINED-RULE-BODY'}],editingRuleId:'original-rule'},raw=key+'-management:quality',draft=JSON.stringify({payload:JSON.stringify(initial),values:[{name:'reference',value:'UNFINISHED-PRIVATE-BASIS'},{name:'reason',value:''}]}),requestKey=key+'-request:quality';
  scopes.produce(raw,draft,{kind:'management-draft',command:'quality.policy-publish',formId:'quality-publish',payload:{...initial,reference:'UNFINISHED-PRIVATE-BASIS',reason:''}});
  scopes.produce(requestKey,p.requestId,{kind:'request-key',command:'quality.policy-publish',payload:{...initial,requestId:p.requestId}});
  await runtime.mutate('write',facade=>{facade.setItem(raw,draft);facade.setItem(requestKey,p.requestId);},{planned:[{key:raw,value:draft},{key:requestKey,value:p.requestId}]});
  const ledger=runtime.load();assert.doesNotMatch(JSON.stringify(ledger.privacyUploadTabs),/UNFINISHED-PRIVATE-BASIS|SYNTHETIC-POLICY-BODY|RETAINED-RULE-BODY|editingRuleId|retainedRules/);
  const fresh=createAppSessionScopes({key,currentContext:current});for(const[k,v]of[[raw,draft],[requestKey,p.requestId]])assert.deepEqual(fresh.scopeForDraft({...current(),key:k,value:v}).subjects,[{kind:'group',id:'group'}]);
  const coverage=await runtime.coverage();assert.equal(coverage.deleteAllowed,false);assert.equal(coverage.ledgerComplete,false);
  const ended=runtime.load();accountCommand(ended,f.actor,'account.leave',{},{});storage.setItem(key,JSON.stringify(ended));
  assert.throws(()=>fresh.scopeForDraft({...current(),key:raw,value:draft}));assert.equal(native.getItem(raw),draft);
});

test('quality publish completion uses actual unique request to remove only unchanged original draft after source advances',async()=>{
  const{f,payload}=original(),p=payload(),storage=new Storage(),native=new Storage();storage.setItem(key,JSON.stringify(f.s));let seq=0;
  const current=()=>({state:JSON.parse(storage.getItem(key)),actor:f.actor,originScope:'https://quality-complete.test'}),scopes=createAppSessionScopes({key,currentContext:current});
  const runtime=createAppSessionRuntime({key,storage,sessionStorage:native,locks:{request:(_key,fn)=>fn()},currentContext:current,scopeForDraft:scopes.scopeForDraft,listStoredRefs:()=>[],id:()=> 'QUALITY-COMPLETE-'+ ++seq}),raw=key+'-management:quality-complete',draft=JSON.stringify({payload:JSON.stringify(p),values:[]});
  scopes.produce(raw,draft,{kind:'management-draft',command:'quality.policy-publish',formId:'quality-publish',payload:p});await runtime.mutate('write',facade=>facade.setItem(raw,draft),{planned:[{key:raw,value:draft}]});
  const before=runtime.load(),next=copy(before);qualityPolicyCommand(next,f.actor,'quality.policy-publish',p,{id:prefix=>prefix+ ++next.seq,log(){}});scopes.stageCompletion(before,next,runtime.identity(),[{key:raw,value:draft}],p.requestId);storage.setItem(key,JSON.stringify(next));
  const fresh=createAppSessionScopes({key,currentContext:current});assert.throws(()=>source(next,f.actor,'quality.policy-publish',p));assert.equal(fresh.completion(raw,draft),true);assert.equal(fresh.completion(raw,draft+' '),false);
  assert.equal(fresh.scopeForDraft({...current(),key:raw,value:draft,operation:'remove'}).source.kind,'quality-policy-stream');
  next.qualityPolicyRequests[0].requestId='BROKEN';storage.setItem(key,JSON.stringify(next));assert.equal(fresh.completion(raw,draft),false);
});

test('quality policy and actual publish/withdraw requests are located group facts, not user cleanup items',()=>{
  const{f,payload,run,withdrawal}=original(),created=run('quality.policy-publish',payload());run('quality.policy-withdraw',withdrawal(created.id));
  const before=JSON.stringify(f.s),inv=inventory(f);assert.equal(inv.items.some(row=>['qualityPolicies','qualityPolicyRequests'].includes(row.path?.[0])),false);
  assert.equal(inv.unlocated.some(row=>['qualityPolicies','qualityPolicyRequests'].includes(row.container)),false);assert.equal(JSON.stringify(f.s),before);assert.ok(inv.items.every(row=>row.deleteAllowed===false));
});

test('damaged quality policy/request links stay unlocated and group policy text still protects actual file refs',()=>{
  const{f,payload,run}=original(),p=payload(),ref='invoice-file:'+'e'.repeat(64);p.basis.reference=ref;run('quality.policy-publish',p);
  assert.ok(collectPrivacyFileReferences(f.s).references.some(row=>row.ref===ref&&row.container==='qualityPolicies'));
  const baseline=copy(f.s);
  for(const damage of [s=>s.qualityPolicyRequests[0].type='quality.unknown',s=>s.qualityPolicyRequests[0].digestVersion=2,s=>s.qualityPolicyRequests[0].result.id='OTHER',s=>s.qualityPolicyRequests[0].fingerprint=hash('OTHER'),s=>s.qualityPolicies[0].userId='u1']){
    const changed=copy(baseline);damage(changed);const inv=privacyCleanupInventory(changed,'u1',f.closureId);
    assert.ok(inv.unlocated.some(row=>row.container==='qualityPolicyRequests'));assert.equal(inv.items.some(row=>['qualityPolicies','qualityPolicyRequests'].includes(row.path?.[0])),false);
    if(changed.qualityPolicies[0].userId)assert.ok(inv.unlocated.some(row=>row.container==='qualityPolicies'));
  }
});

test('tabs permits only the two quality typed selector schemas and rejects unknown keys, nested bodies and invalid range IDs before native write',async()=>{
  const{f,payload}=original(),p=payload(),good={scope:p.scope,expectedVersion:p.expectedVersion,sourceToken:p.sourceToken,requestId:p.requestId};
  const cases=[
    ['quality.policy-publish',good,true],
    ['quality.policy-publish',{...good,scope:{...scope,storeIds:['s1'],serviceIds:['sv1']}},true],
    ['quality.policy-withdraw',{id:'QP-ORIGINAL',version:1,revision:1,sourceToken:hash('original')},true],
    ['quality.policy-publish',{...good,userId:'u1'},false],
    ['quality.policy-publish',{...good,rules:[{body:'PRIVATE-SCHEMA-LEAK'}]},false],
    ['quality.policy-publish',{...good,scope:{...scope,body:'PRIVATE-SCHEMA-LEAK'}},false],
    ['quality.policy-publish',{...good,scope:{...scope,storeIds:[{id:'s1',body:'PRIVATE-SCHEMA-LEAK'}]}},false],
    ['quality.policy-publish',{...good,scope:{...scope,storeIds:['s1','s1']}},false],
    ['quality.policy-publish',{...good,scope:{...scope,serviceIds:['MISSING']}},false],
    ['quality.policy-publish',{...good,scope:{...scope,storeIds:[]}},false],
    ['quality.policy-publish',{...good,scope:{...scope,storeIds:[' s1']}},false],
    ['quality.policy-publish',{...good,scope:{...scope,subject:'u1'}},false],
    ['quality.policy-publish',{...good,expectedVersion:NaN},false],
    ['quality.policy-withdraw',{id:'QP-ORIGINAL',version:1,revision:{body:'PRIVATE-SCHEMA-LEAK'},sourceToken:hash('original')},false],
    ['quality.policy-withdraw',{id:'QP-ORIGINAL',version:1,revision:1,sourceToken:hash('original'),scope},false],
    ['quality.policy-unknown',good,false],
    ['manage.product-save',{scope},false]
  ];
  for(const[command,selectors,valid]of cases){
    const storage=new Storage(),native=new Storage();storage.setItem(key,JSON.stringify(f.s));let seq=0;
    const current=()=>({state:JSON.parse(storage.getItem(key)),actor:f.actor,originScope:'https://quality-schema.test'}),runtime=createAppSessionRuntime({key,storage,sessionStorage:native,locks:{request:(_key,fn)=>fn()},currentContext:current,listStoredRefs:()=>[],id:()=> 'SCHEMA-'+ ++seq,
      scopeForDraft:()=>({kind:'request-key',disposition:'scoped',source:{kind:'quality-policy-stream',id:hash(scope)},sourceToken:hash('actual'),subjects:[{kind:'group',id:'group'}],roots:[],producer:{type:'request-key',authorDigest:appSessionAuthor(f.actor),command,selectors}})});
    const op=runtime.mutate('write',facade=>facade.setItem('source-request','R'),{planned:[{key:'source-request',value:'R'}]});
    if(valid){await op;assert.equal(native.getItem('source-request'),'R');}else{await assert.rejects(op,/来源选择器损坏/);assert.equal(native.getItem('source-request'),null);assert.doesNotMatch(storage.getItem(key),/PRIVATE-SCHEMA-LEAK/);}
  }
});
