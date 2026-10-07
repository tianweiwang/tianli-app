import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { seed, reduce } from './engine.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { qualityPolicySource } from './quality-policy.mjs';

// Reuse the established DOM/Storage/IndexedDB subset while executing the actual
// app, original command handlers and current modules. No browser data is read.
const fixtureUrl = new URL('./app-upload-runtime.test.mjs', import.meta.url);
let fixture = await readFile(fixtureUrl, 'utf8');
fixture = fixture.replace("import test from 'node:test';", "const hooks={};const test=Object.assign(()=>{}, {beforeEach:fn=>hooks.before=fn,after:fn=>hooks.after=fn});");
fixture = fixture.replace(/(from\s+)(['"])(\.\/[^'"]+)\2/g, (_all, prefix, quote, path) => prefix + quote + new URL(path, fixtureUrl).href + quote);
fixture = fixture.replace("const appUrl = new URL('./app.mjs', import.meta.url);", 'const appUrl = new URL(' + JSON.stringify(new URL('./app.mjs', import.meta.url).href) + ');');
fixture = fixture.replace('crypto: webcrypto, URL, Blob', 'crypto: webcrypto, URL, URLSearchParams, Blob');
fixture = fixture.replace('console: { error: error', 'JSON, console: { error: error');
fixture = fixture.replace('  get checked() {', "  get selected() { return this.hasAttribute('selected'); }\n  set selected(value) { if(value)this.setAttribute('selected','');else this.removeAttribute('selected'); }\n  get checked() {");
fixture = fixture.replace('function simpleMatch(node, selector) {', "function simpleMatch(node, selector) {\n  const excluded=[...selector.matchAll(/:not\\(([^)]+)\\)/g)].map(match=>match[1]);\n  if(excluded.some(part=>simpleMatch(node,part)))return false;\n  selector=selector.replace(/:not\\([^)]+\\)/g,'');");
fixture = fixture.replace('  set value(value) { this._value = String(value); }', "  set value(value) { this._value = String(value); if(this.tagName==='SELECT')for(const option of this.querySelectorAll('option'))option.selected=option.value===String(value); }");
fixture += '\nexport {runtime,originalForm,submit,ledger,toast,assertNoDelete};export const resetFixtures=()=>hooks.before();export const closeFixtures=()=>hooks.after();';
fixture += '\n//# sourceURL=quality-policy-app-fixture.mjs';
const h = await import('data:text/javascript;base64,' + Buffer.from(fixture).toString('base64'));
test.beforeEach(() => h.resetFixtures());
test.after(() => h.closeFixtures());
const user = { role: 'user', userId: 'u1' };
function sources() {
  let s=seed(), n=0;
  const run=(actor,type,p={})=>{let result;s=reduce(s,actor,type,{requestId:'policy-app-source-'+ ++n,...p},value=>result=value);return result;};
  const entered=run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(s,entered);
  const staff=job=>{const a=run(admin,'account.create',{name:'政策页面合成'+job,reason:'本地页面隔离测试'}),g=run(admin,'account.grant',{id:a.id,version:a.version,job,reason:'原岗位显式授权'}),session=run(user,'account.enter',{accountId:a.id,grantId:g.grants.at(-1).id});return resolveAccountActor(s,session);};
  const support=staff('support'),finance=staff('finance');
  return {get s(){return s;},run,admin,support,finance};
}
const path='#/group/quality-policies';
test('quality app: actual support has original group entry, empty policies and explicit scope selection',async()=>{
  const f=sources(),a=await h.runtime(f.s,path,{initialActor:f.support});
  assert.ok(a.document.querySelector('a[href="#/group/quality-policies"]'),'actual group navigation');
  assert.ok(a.document.querySelector('form[data-quality-policy-scope]'),'original scope selection, no hidden default publication');
  assert.deepEqual(h.ledger(a).qualityPolicies,[]);assert.deepEqual(h.ledger(a).qualityPolicyRequests,[]);h.assertNoDelete();
});
test('quality app: finance and free group identity cannot see publisher or acquire entry by direct route',async()=>{
  const f=sources();
  for(const actor of [f.finance,{role:'group',job:'all'},{role:'group',job:'support'}]){
    const a=await h.runtime(f.s,path,{initialActor:actor});
    assert.equal(a.document.querySelector('a[href="#/group/quality-policies"]'),null);
    assert.equal(a.document.querySelector('form[data-quality-policy-scope]'),null);
    assert.equal(a.document.querySelector('form[data-command="quality.policy-publish"]'),null);
    assert.deepEqual(h.ledger(a).qualityPolicies,[]);h.assertNoDelete();
  }
});

const localTime=at=>new Date(at+8*3600000).toISOString().slice(0,23);
function setFields(form,values){for(const [name,value] of Object.entries(values)){const field=form.elements.namedItem(name);assert.ok(field,name);field.value=value;}}
function selectMany(form,name,ids){for(const option of form.querySelector(`[name="${name}"]`).querySelectorAll('option')){if(ids.includes(option.value))option.setAttribute('selected','');else option.removeAttribute('selected');}}
async function scopePage(a,subject='user',storeIds=null,serviceIds=null){
  const form=h.originalForm(a,'ui.filter');setFields(form,{subject,storeMode:storeIds?'selected':'all',serviceMode:serviceIds?'selected':'all'});
  if(storeIds)selectMany(form,'storeIds',storeIds);if(serviceIds)selectMany(form,'serviceIds',serviceIds);
  await a.dispatch('submit',form);await a.render();const editor=a.document.querySelector('form[data-command="quality.policy-publish"]');assert.ok(editor,JSON.stringify({hash:a.location.hash,toast:h.toast(a),page:a.document.querySelector('main')?.textContent}));return editor;
}
async function fillRule(a,form,{id='APP-ABUSE',trigger='user-abuse',sourceKinds=['established-care','established-safety'],extra={}}={}){
  const now=h.ledger(a).now;
  setFields(form,{ruleId:id,trigger,endMode:'manual-review',restorationMode:'explicit-release',appealExecution:'continues',validFrom:localTime(now),validUntilMode:'none',reference:'ISOLATED-APP-NOT-FORMAL',basisVersion:'technical-explicit-1',occurredAt:localTime(now),...extra});
  await a.dispatch('change',form.elements.namedItem('trigger'));
  for(const input of form.querySelectorAll('[name="sourceKinds"]'))input.checked=sourceKinds.includes(input.value);
}
async function confirmSubmit(a,form,beforeConfirm){
  const pending=a.dispatch('submit',form);let confirm;
  for(let i=0;i<150;i++){await new Promise(setImmediate);confirm=a.document.querySelector('[data-confirm-choice="accept"]');if(confirm)break;}
  assert.ok(confirm,'actual management confirmation must be reached: '+h.toast(a));
  if(beforeConfirm)await beforeConfirm();await a.dispatch('click',confirm);await pending;await a.settle();
}
const business=s=>({bookings:s.bookings,goods:s.goods,techs:s.techs,qualifications:s.techQualifications,penalties:s.technicianPenalties});

test('quality app: actual scope multiselect and explicit publication persist once through original transaction without changing business facts',async()=>{
  const f=sources(),a=await h.runtime(f.s,path,{initialActor:f.support});
  const stores=f.s.stores.slice(0,2).map(x=>x.id),services=f.s.services.slice(0,2).map(x=>x.id);
  const form=await scopePage(a,'user',stores,services),before=business(h.ledger(a));
  await fillRule(a,form);await confirmSubmit(a,form);
  const after=h.ledger(a);assert.equal(after.qualityPolicies.length,1,h.toast(a));assert.equal(after.qualityPolicyRequests.length,1);
  const policy=after.qualityPolicies[0];assert.deepEqual(policy.scope,{subject:'user',domain:'service-order',storeIds:[...stores].sort(),serviceIds:[...services].sort()});
  assert.deepEqual([...policy.rules[0].sourceKinds].sort(),['established-care','established-safety']);assert.equal(policy.publication.by.sessionId,f.support.sessionId);
  assert.deepEqual(business(after),before);assert.equal(qualityPolicySource(after,{scope:policy.scope}).available,true);h.assertNoDelete();
});

test('quality app: adding a rule and editing one retain the other original rule; withdrawal keeps history and does not revive old version',async()=>{
  const f=sources(),a=await h.runtime(f.s,path,{initialActor:f.support});let form=await scopePage(a);
  await fillRule(a,form);await confirmSubmit(a,form);await a.render();
  form=h.originalForm(a,'quality.policy-publish');await fillRule(a,form,{id:'APP-REFUND',trigger:'user-malicious-refund',sourceKinds:['established-dispute']});await confirmSubmit(a,form);await a.render();
  let after=h.ledger(a);assert.equal(after.qualityPolicies.length,2,h.toast(a));const retained=structuredClone(after.qualityPolicies[1].rules.find(r=>r.id==='APP-REFUND'));
  a.location.hash+='&editRule=APP-ABUSE';await a.render();form=h.originalForm(a,'quality.policy-publish');
  await fillRule(a,form,{extra:{appealExecution:'suspend-until-review'}});await confirmSubmit(a,form);await a.render();
  after=h.ledger(a);assert.equal(after.qualityPolicies.length,3,h.toast(a));const latest=after.qualityPolicies[2];assert.equal(latest.rules.length,2);assert.deepEqual(latest.rules.find(r=>r.id==='APP-REFUND'),retained);assert.equal(latest.rules.find(r=>r.id==='APP-ABUSE').appeal.execution,'suspend-until-review');
  a.location.hash=path+'/'+latest.id;await a.render();form=h.originalForm(a,'quality.policy-withdraw');setFields(form,{reference:'ISOLATED-WITHDRAWAL',basisVersion:'technical-explicit-2',occurredAt:localTime(after.now),reason:'仅隔离页面验收撤回，不是正式政策决定'});await confirmSubmit(a,form);await a.render();
  after=h.ledger(a);assert.equal(after.qualityPolicies.length,3);assert.equal(after.qualityPolicyRequests.length,4);assert.equal(after.qualityPolicies[2].status,'withdrawn');assert.equal(qualityPolicySource(after,{scope:latest.scope}).available,false);assert.equal(a.document.querySelector('form[data-command="quality.policy-withdraw"]'),null);h.assertNoDelete();
});

test('quality app: source changes while confirmation is open reject the old form without replacing newer policy',async()=>{
  const f=sources(),a=await h.runtime(f.s,path,{initialActor:f.support}),form=await scopePage(a);await fillRule(a,form);
  const b=await h.runtime(h.ledger(a),a.location.hash,{initialActor:f.support});
  // A second actual app session renders its own form against the same original
  // policy source; its completed ledger is then delivered as shared storage.
  const other=h.originalForm(b,'quality.policy-publish');await fillRule(b,other,{id:'APP-OTHER'});await confirmSubmit(b,other);
  const newer=h.ledger(b);assert.equal(newer.qualityPolicies.length,1,h.toast(b));
  await confirmSubmit(a,form,()=>a.authoritative(newer));assert.deepEqual(h.ledger(a),newer);assert.match(h.toast(a),/来源|变化|版本|更新|重新/);h.assertNoDelete();
});

test('quality app: grant revoked during actual confirmation cannot publish or preserve a working entry',async()=>{
  const f=sources(),a=await h.runtime(f.s,path,{initialActor:f.support}),form=await scopePage(a);await fillRule(a,form);let revoked;
  await confirmSubmit(a,form,()=>{const account=f.s.staffAccounts.find(row=>row.id===f.support.accountId);f.run(f.admin,'account.revoke',{id:account.id,version:account.version,grantId:f.support.grantId,reason:'隔离原授权结束'});revoked=f.s;a.authoritative(revoked);});
  assert.deepEqual(h.ledger(a),revoked);assert.match(h.toast(a),/失效|授权|权限|会话/);
  const event=new Event('storage');Object.defineProperty(event,'key',{value:'tianli-integrated-v5'});for(const listener of a.window.listeners.get('storage')||[])await listener(event);
  await a.render();assert.equal(a.document.querySelector('form[data-command="quality.policy-publish"]'),null);h.assertNoDelete();
});

test('quality app: refresh restores every selected retraining project and exact draft version before original submission',async()=>{
  const f=sources();let a=await h.runtime(f.s,path,{initialActor:f.support}),form=await scopePage(a,'tech');
  const projects=f.s.services.map(row=>row.id);
  await fillRule(a,form,{id:'APP-TECH',trigger:'tech-noshow',sourceKinds:['verified-fulfilment-responsibility'],extra:{endMode:'duration',durationDays:'456789',durationUnit:'milliseconds',restorationMode:'retraining-and-release',retrainingMode:'selected'}});
  selectMany(form,'retrainingServiceIds',projects);await a.dispatch('change',form.elements.namedItem('retrainingServiceIds'));
  const original=JSON.parse(form.dataset.payload),saved=Object.fromEntries(Object.entries(a.sessionStorage));
  a=await h.runtime(h.ledger(a),a.location.hash,{initialActor:f.support,initialSession:saved,initialHistory:structuredClone(a.history.state)});form=h.originalForm(a,'quality.policy-publish');
  assert.deepEqual(form.elements.namedItem('retrainingServiceIds').selectedOptions.map(option=>option.value).sort(),[...projects].sort(),'all selected projects survive actual draft restore');
  assert.equal(form.elements.namedItem('durationDays').value,'456789');assert.equal(form.elements.namedItem('durationUnit').value,'milliseconds');assert.deepEqual(JSON.parse(form.dataset.payload),original);
  await confirmSubmit(a,form);const after=h.ledger(a);assert.equal(after.qualityPolicies.length,1,h.toast(a));assert.deepEqual(after.qualityPolicies[0].rules[0].restoration.serviceIds,[...projects].sort());assert.equal(after.qualityPolicies[0].rules[0].effect.durationMs,456789);h.assertNoDelete();
});

test('quality app: unchanged withdrawal draft refresh shows restored feedback and keeps the exact policy source',async()=>{
  const f=sources();let a=await h.runtime(f.s,path,{initialActor:f.support}),form=await scopePage(a);await fillRule(a,form);await confirmSubmit(a,form);
  const policy=h.ledger(a).qualityPolicies[0];a.location.hash=path+'/'+policy.id;await a.render();form=h.originalForm(a,'quality.policy-withdraw');
  setFields(form,{reference:'APP-DRAFT-WITHDRAW',basisVersion:'isolated-2',occurredAt:localTime(h.ledger(a).now),reason:'刷新后保留的合成撤回理由'});await a.dispatch('input',form.elements.namedItem('reason'));
  const source=JSON.parse(form.dataset.payload);a=await h.runtime(h.ledger(a),a.location.hash,{initialActor:f.support,initialSession:Object.fromEntries(Object.entries(a.sessionStorage))});form=a.document.querySelector('form[data-command="quality.policy-withdraw"]');assert.ok(form,JSON.stringify({hash:a.location.hash,toast:h.toast(a),page:a.document.querySelector('main')?.textContent}));
  assert.equal(form.elements.namedItem('reason').value,'刷新后保留的合成撤回理由');assert.deepEqual(JSON.parse(form.dataset.payload),source);
  assert.match(form.querySelector('.management-draft-note').textContent,/已恢复/);assert.doesNotMatch(form.querySelector('.management-draft-note').textContent,/资料已更新|旧草稿/);
  assert.equal(h.ledger(a).qualityPolicies[0].status,'published');h.assertNoDelete();
});

test('quality app: in-flight draft saving is visible and warns before reload; completed save restores the latest field',async()=>{
  const f=sources();let a=await h.runtime(f.s,path,{initialActor:f.support}),form=await scopePage(a);await fillRule(a,form);
  const request=a.locks.request.bind(a.locks);let release,held=false;
  a.locks.request=(key,callback)=>request(key,async()=>{if(!held){held=true;await new Promise(resolve=>release=resolve);}return callback();});
  const field=form.elements.namedItem('reference');field.value='LATEST-FIELD-SAVE';const pending=a.dispatch('input',field);
  for(let i=0;i<150&&!held;i++)await new Promise(setImmediate);
  try {
    assert.equal(held,true,'hold the original save transaction, not a replacement writer');assert.match(form.querySelector('.management-draft-note').textContent,/正在保存/);
    const event=new Event('beforeunload',{cancelable:true});for(const listener of a.window.listeners.get('beforeunload')||[])listener(event);assert.equal(event.defaultPrevented,true,'unfinished original draft save warns before reload');
  } finally {release?.();await pending;await a.settle();}
  assert.match(form.querySelector('.management-draft-note').textContent,/草稿已保存/);
  const event=new Event('beforeunload',{cancelable:true});for(const listener of a.window.listeners.get('beforeunload')||[])listener(event);assert.equal(event.defaultPrevented,false);
  a=await h.runtime(h.ledger(a),a.location.hash,{initialActor:f.support,initialSession:Object.fromEntries(Object.entries(a.sessionStorage))});form=h.originalForm(a,'quality.policy-publish');assert.equal(form.elements.namedItem('reference').value,'LATEST-FIELD-SAVE');assert.equal(h.ledger(a).qualityPolicies.length,0);h.assertNoDelete();
});

test('quality app: actual confirmation shows the frozen scope, all retraining projects and every selected source before publication',async()=>{
  const f=sources(),a=await h.runtime(f.s,path,{initialActor:f.support}),store=f.s.stores[1];
  const form=await scopePage(a,'tech',[store.id]);
  await fillRule(a,form,{id:'APP-TECH-REVIEW',trigger:'tech-noshow',sourceKinds:['verified-fulfilment-responsibility','established-care'],extra:{endMode:'duration',durationDays:'17',durationUnit:'minutes',restorationMode:'retraining-and-release',retrainingMode:'selected'}});
  selectMany(form,'retrainingServiceIds',f.s.services.map(row=>row.id));
  await confirmSubmit(a,form,()=>{
    const text=a.document.querySelector('[role="dialog"]').textContent;
    for(const project of f.s.services)assert.ok(text.includes(project.name||project.title),'confirmation includes each selected project: '+(project.name||project.title));
    assert.ok(text.includes('已核实的履约责任'),'confirmation includes the selected fulfilment basis: '+text);
    assert.ok(text.includes('已成立的投诉案件'),'confirmation includes the selected care basis');
    assert.ok(text.includes(store.name),'confirmation identifies the frozen store scope');
    assert.ok(text.includes('新版本完整规则'),'confirmation identifies the full publication snapshot');
  });
  const after=h.ledger(a);assert.equal(after.qualityPolicies.length,1,h.toast(a));assert.equal(after.qualityPolicies[0].rules[0].restoration.serviceIds.length,f.s.services.length);assert.equal(after.qualityPolicies[0].rules[0].sourceKinds.length,2);h.assertNoDelete();
});
