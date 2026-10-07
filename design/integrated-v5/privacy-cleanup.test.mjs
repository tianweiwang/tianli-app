import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { saveInvoiceFile, readInvoiceFile } from './invoice-files.mjs';
import { saveMedia, mediaUrl } from './media.mjs';
import { closedRightsView, closedRightsBinding } from './privacy-closed-rights.mjs';
import { privacyCleanupInventory, collectPrivacyFileReferences, privacyCleanupInventoryView } from './privacy-cleanup-inventory.mjs';
import { preparePrivacyCleanupJob, executePrivacyCleanupItem, privacyCleanupJobView } from './privacy-cleanup.mjs';
import { createPrivacyCleanupStorage } from './privacy-cleanup-storage.mjs';
import { createIndexedDBStandin, fixture, NOW } from './privacy-cleanup-test-fixture.mjs';

// Runtime unit with real Blob/hash and original save/read functions, synthetic IDB
// only. No browser storage, real policy, download, or existing origin is touched.
const idb=createIndexedDBStandin(),oldIDB=globalThis.indexedDB,oldDecode=globalThis.createImageBitmap;
globalThis.indexedDB=idb.indexedDB;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
test.after(()=>{globalThis.indexedDB=oldIDB;globalThis.createImageBitmap=oldDecode;});
test.beforeEach(()=>{idb.setHook(null);idb.events.length=0;for(const db of idb.databases.values())for(const store of db.stores.values())store.clear();});
const pdf=()=>Object.assign(new Blob(['%PDF-1.4\nSynthetic cleanup unit evidence\n%%EOF'],{type:'application/pdf'}),{name:'synthetic.pdf'});
const png=()=>Object.assign(new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V5sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),{name:'synthetic.png'});
async function setup({policy=true,library='invoice'}={}) {for(const db of idb.databases.values())for(const store of db.stores.values())store.clear();const f=fixture(idb),blob=library==='invoice'?pdf():png(),file=library==='invoice'?await saveInvoiceFile(blob):{ref:await saveMedia(blob),name:blob.name,type:blob.type,size:blob.size};f.file=file;f.r=f.register(file,library);if(policy)f.policy(f.r);return f;}
const options=f=>({currentContext:f.currentContext,storage:f.storage});
async function prepare(f,id='CJ1',itemIds=['upload:U1']) {const inv=privacyCleanupInventory(f.s,'u1',f.closureId,{coverage:f.coverage});return preparePrivacyCleanupJob(id,f.closureId,itemIds,{...options(f),inventoryToken:inv.sourceToken});}
const execute=(f,id='CJ1',item='upload:U1')=>executePrivacyCleanupItem(id,item,options(f));

test('全局图覆盖历史/字符串请求/其他主体/public media，目录不复制PII值',async()=>{
  const f=await setup();f.s.serviceInvoices=[{id:'I1',userId:'u1',bookingId:'B1',history:[{previousFile:f.file}]}];f.s.serviceCareRequests=[{requestId:'X',fingerprint:JSON.stringify({p:{bookingId:'B1',evidenceRefs:[f.file]}})}];f.s.products=[{id:'PUBLIC',image:f.file.ref}];
  const before=JSON.stringify(f.s),graph=collectPrivacyFileReferences(f.s);assert.equal(graph.references.filter(x=>x.ref===f.file.ref).length,3);assert.ok(graph.references.some(x=>x.container==='serviceCareRequests'));
  const inv=privacyCleanupInventory(f.s,'u1',f.closureId,{coverage:f.coverage});assert.ok(inv.items.some(x=>x.kind==='request-copy'));assert.doesNotMatch(JSON.stringify(inv.items),/PRIVATE-CONTACT|PRIVATE-PHONE|原本人/);assert.equal(inv.items.find(x=>x.kind==='cancelled-upload').status,'pending_review');assert.equal(JSON.stringify(f.s),before);
  const own=privacyCleanupInventoryView(f.s,f.user,f.closureId,{coverage:f.coverage});assert.doesNotMatch(JSON.stringify(own),/invoice-file:|products|"file":|PRIVATE/);assert.throws(()=>privacyCleanupInventoryView(f.s,{role:'user',userId:'u2'},f.closureId),/无权/);
});
test('原invoice真实save/read与精确删除互操作，prepared+executing先于不可逆delete',async()=>{
  const f=await setup(),rights=closedRightsView(f.s,f.user),state=JSON.stringify(f.s);assert.equal((await readInvoiceFile(f.file)).size,f.file.size);assert.equal((await f.storage.listStoredRefs('invoice'))[0].ref,f.file.ref);
  const prepared=await prepare(f);assert.equal(prepared.items[0].status,'prepared');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);
  const job=await execute(f);assert.equal(job.status,'scope_verified');assert.equal(job.items[0].status,'deleted');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),false);await assert.rejects(()=>readInvoiceFile(f.file),/缺失/);
  const deleteAt=idb.events.findIndex(x=>x.op==='delete'),writes=idb.events.slice(0,deleteAt).filter(x=>x.op==='put'&&x.store==='jobs');assert.equal(writes.length,2);assert.equal(JSON.stringify(f.s),state);assert.deepEqual(closedRightsView(f.s,f.user),rights);assert.equal(closedRightsBinding(f.s,f.user,'booking','B1').rootId,'B1');
  const n=idb.events.filter(x=>x.op==='delete').length,replayed=await execute(f);assert.equal(replayed.items[0].attempts.length,job.items[0].attempts.length);assert.equal(replayed.items[0].currentObservation.status,'current_absent');assert.equal(idb.events.filter(x=>x.op==='delete').length,n);
});
test('原media真实save/读取字节与同origin准确删除，只释放自身cache回调',async()=>{
  const f=await setup({library:'media'}),url=await mediaUrl(f.file.ref);assert.equal(resolveObjectURL(url).size,f.file.size);const released=[];f.storage=createPrivacyCleanupStorage({indexedDB:idb.indexedDB,originScope:f.coverage.originScope,releaseRef:(library,ref)=>released.push({library,ref})});
  assert.equal((await f.storage.readStoredRef('media',f.file.ref)).type,'image/png');await prepare(f);const job=await execute(f);assert.equal(job.items[0].status,'deleted');assert.deepEqual(released,[{library:'media',ref:f.file.ref}]);assert.equal(job.items[0].attempts[0].io.cacheReleased,true);URL.revokeObjectURL(url);
});
test('当前未发布政策只持久blocked不删，载荷approved不产生许可',async()=>{
  const f=await setup({policy:false});const job=await prepare(f);assert.equal(job.items[0].status,'blocked');assert.match(job.items[0].blockers.join(),/尚未发布/);const result=await executePrivacyCleanupItem('CJ1','upload:U1',{...options(f),approved:true,policy:{status:'published'}});assert.equal(result.items[0].status,'blocked');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);assert.equal(idb.events.some(x=>x.op==='delete'),false);
});
test('其他主体或同本人旧权益/历史/请求副本任一有效ref均阻断字节删除',async()=>{
  for(const add of [f=>f.s.serviceInvoices=[{id:'I2',userId:'u2',issued:{file:f.file}}],f=>f.s.serviceInvoices=[{id:'I1',userId:'u1',issued:{file:f.file}}],f=>f.s.goods=[{id:'G2',userId:'u2',addressHistory:[{proof:f.file.ref}]}],f=>f.s.privacyRequests.push({fingerprint:JSON.stringify({ref:f.file.ref})})]){const f=await setup();add(f);await prepare(f);const job=await execute(f);assert.equal(job.items[0].status,'blocked');assert.match(job.items[0].blockers.join(),/仍被/);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);}
});
test('无所有者上传/休眠标签/另一草稿/同ref其他登记不会猜孤儿',async()=>{
  const f=await setup();delete f.s.privacyUploadReservations;const inv=privacyCleanupInventory(f.s,'u1',f.closureId,{coverage:f.coverage});assert.match(inv.unregisteredUploads,/pending_owner/);await assert.rejects(()=>prepare(f),/本子步/);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);
  for(const mutate of [g=>g.coverage.uploadsComplete=false,g=>g.coverage.unregisteredStoredRefs.push('invoice-file:'+ 'f'.repeat(64)),g=>g.coverage.tabs[0].status='sleeping',g=>g.coverage.tabs[0].drafts.push({evidenceRefs:[g.file]}),g=>g.s.privacyUploadReservations.push({...g.r,id:'OTHER',userId:'u2'})]){const g=await setup();mutate(g);await prepare(g);const job=await execute(g);assert.equal(job.items[0].status,'blocked');assert.equal(await g.storage.hasStoredRef('invoice',g.file.ref),true);}
});
test('policy持久source、版本、真实范围、依据和明确期限逐项核，零期限/未来拒绝',async()=>{
  for(const mutate of [f=>f.s.privacyCleanupPolicies[0].status='draft',f=>f.s.privacyCleanupPolicies[0].version++,f=>f.s.privacyCleanupPolicies[0].sourceToken='fake',f=>f.s.privacyCleanupPolicySources[0].reference='',f=>f.s.privacyCleanupPolicies[0].scope.userId='u2',f=>f.s.privacyCleanupPolicies[0].retentionMilliseconds=0,f=>f.r.cleanupDecision.retainUntil=NOW+1,f=>f.r.cleanupDecision.startAt++,f=>f.s.privacyCleanupPolicies[0].publishedBy.accountId='missing']){const f=await setup();mutate(f);await prepare(f);const result=await execute(f);assert.equal(result.items[0].status,'blocked');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);}
});
test('准备要求当前真support会话、准确目录token和实际关闭；跨人/finance拒绝',async()=>{
  const f=await setup();const inv=privacyCleanupInventory(f.s,'u1',f.closureId,{coverage:f.coverage});await assert.rejects(()=>preparePrivacyCleanupJob('X',f.closureId,['upload:U1'],{...options(f),inventoryToken:'old'}),/版本/);
  const original=f.actor;f.actor={role:'group',job:'support'};await assert.rejects(()=>prepare(f),/真实集团/);f.actor={role:'user',userId:'u1'};await assert.rejects(()=>prepare(f),/真实集团/);f.actor=original;f.s.staffSessions.find(x=>x.id===original.sessionId).revokedAt=NOW;await assert.rejects(()=>prepare(f),/失效/);assert.equal(idb.events.some(x=>x.op==='delete'),false);
  const g=await setup();g.s.privacyClosures[0].closedAt++;assert.throws(()=>privacyCleanupInventory(g.s,'u1',g.closureId,{coverage:g.coverage}),/关闭/);
});
test('freshContext在读取和实际delete事务内复核源/当前session，失权不删',async()=>{
  for(const stage of ['read','delete-read']){const f=await setup();await prepare(f);let gets=0;idb.setHook(event=>{if(event.op==='get'&&event.store==='files'&&event.key===f.file.ref){gets++;if(gets===(stage==='read'?1:2))f.s.staffSessions.find(x=>x.id===f.actor.sessionId).revokedAt=NOW;}});const job=await execute(f);idb.setHook(null);assert.equal(job.items[0].status,'failed');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);assert.equal(idb.events.some(x=>x.op==='delete'),false);}
});
test('删除前异步新增共享来源使原token过期，原字节和其他资料不动',async()=>{
  const f=await setup();await prepare(f);let changed=false;idb.setHook(event=>{if(!changed&&event.op==='get'&&event.store==='files'){changed=true;f.s.serviceCareCases=[{id:'OTHER',userId:'u2',evidenceRefs:[f.file]}];}});const job=await execute(f);idb.setHook(null);assert.equal(job.items[0].status,'failed');assert.match(job.items[0].blockers.join(),/来源已变化/);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);
});
test('journal准备或executing持久写失败都不能先删，CAS拒旧版本覆盖',async()=>{
  const f=await setup();idb.setHook(event=>{if(event.op==='put'&&event.store==='jobs')throw Error('synthetic journal unavailable');});await assert.rejects(()=>prepare(f),/journal/);idb.setHook(null);await prepare(f);const old=await f.storage.getJob('CJ1');idb.setHook(event=>{if(event.op==='put'&&event.store==='jobs')throw Error('synthetic journal unavailable');});await assert.rejects(()=>execute(f),/journal/);idb.setHook(null);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);assert.equal(idb.events.some(x=>x.op==='delete'),false);
  await execute(f);await assert.rejects(()=>f.storage.saveJob({...old,revision:old.revision+1},old.revision),/已更新/);
});
test('实际删除事务失败保留failed可原项重试，未删ref可核',async()=>{
  const f=await setup();await prepare(f);idb.setHook(event=>{if(event.op==='delete'&&event.store==='files')throw Error('synthetic storage quota/fault');});const failed=await execute(f);idb.setHook(null);assert.equal(failed.items[0].status,'failed');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);const retried=await execute(f);assert.equal(retried.items[0].status,'deleted');assert.equal(retried.items[0].attempts.length,2);assert.equal(retried.items[0].attempts[0].status,'failed');
});
test('delete已提交但回读失败如实deleted_unverified，重试只证明already_absent',async()=>{
  const f=await setup();await prepare(f);let deleted=false;idb.setHook(event=>{if(event.op==='delete'&&event.store==='files')deleted=true;if(deleted&&event.op==='get'&&event.store==='files')throw Error('synthetic readback failure');});const job=await execute(f);idb.setHook(null);assert.equal(job.items[0].status,'deleted_unverified');assert.equal(job.items[0].attempts[0].io.transactionCommitted,true);assert.equal(job.status,'partial');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),false);const retry=await execute(f);assert.equal(retry.items[0].status,'already_absent');assert.equal(retry.items[0].attempts.length,2);
});
test('delete实际后结果journal失败保留executing，重启回读不假回滚或重造删除事实',async()=>{
  const f=await setup();await prepare(f);let puts=0;idb.setHook(event=>{if(event.op==='put'&&event.store==='jobs'&&++puts===2)throw Error('synthetic result journal failure');});await assert.rejects(()=>execute(f),error=>{assert.equal(error.ioResult.status,'deleted');return /结果journal保存失败/.test(error.message);});idb.setHook(null);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),false);assert.equal((await f.storage.getJob('CJ1')).items[0].status,'executing');const result=await execute(f);assert.equal(result.items[0].status,'already_absent');assert.equal(result.items[0].attempts[0].status,'executing');
});
test('delete提交后当前失权仍记真实已删及changed，不把整体当当前源全绿',async()=>{
  const f=await setup();await prepare(f);let deleted=false;idb.setHook(event=>{if(event.op==='delete'&&event.store==='files')deleted=true;if(deleted&&event.op==='complete'&&event.store==='files'&&event.mode==='readwrite')f.s.staffSessions.find(x=>x.id===f.actor.sessionId).revokedAt=NOW;});const result=await execute(f);idb.setHook(null);assert.equal(result.items[0].status,'deleted');assert.equal(result.items[0].attempts[0].postcheck,'changed');assert.equal(result.status,'partial');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),false);await assert.rejects(()=>execute(f),/失效/);
});
test('原准确库/ref/同步guard、文件metadata/hash伪造均拒，缺库不是删除证明',async()=>{
  const f=await setup();await assert.rejects(()=>f.storage.deleteStoredRef('other',f.file.ref,{beforeDelete:()=>true}),/无效/);await assert.rejects(()=>f.storage.deleteStoredRef('invoice','invoice-file:bad',{beforeDelete:()=>true}),/无效/);await assert.rejects(()=>f.storage.deleteStoredRef('invoice',f.file.ref,{beforeDelete:async()=>true}),/变化/);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);
  const empty=createPrivacyCleanupStorage({indexedDB:createIndexedDBStandin().indexedDB,originScope:'https://synthetic.test'});await assert.rejects(()=>empty.hasStoredRef('invoice',f.file.ref),/不存在/);
  for(const mutate of [g=>g.r.file.size++,g=>idb.store('tianli-integrated-invoice-files-v1','files').set(g.file.ref,new Blob([new Uint8Array(g.file.size).fill(80)],{type:'application/pdf'}))]){const g=await setup();mutate(g);await prepare(g);const result=await execute(g);assert.equal(result.items[0].status,'failed');assert.match(result.items[0].blockers.join(),/元数据|hash/);assert.equal(await g.storage.hasStoredRef('invoice',g.file.ref),true);}
});
test('单项部分结果不冒全部删除，公开回执不露他人ref/正文，既有旧权益不变',async()=>{
  const f=await setup();const another=await saveInvoiceFile(Object.assign(new Blob(['%PDF-1.4\nSecond synthetic\n%%EOF'],{type:'application/pdf'}),{name:'second.pdf'})),r=f.register(another,'invoice','U2');f.policy(r);f.s.serviceInvoices=[{id:'RETAIN',userId:'u1',issued:{file:another}}];const before=JSON.stringify(f.s);await prepare(f,'CJ1',['upload:U1','upload:U2']);await execute(f);const result=await execute(f,'CJ1','upload:U2');assert.equal(result.status,'partial');assert.equal(result.items[0].status,'deleted');assert.equal(result.items[1].status,'blocked');assert.equal(await f.storage.hasStoredRef('invoice',another.ref),true);assert.equal(JSON.stringify(f.s),before);
  const view=privacyCleanupJobView(f.s,f.user,result);assert.doesNotMatch(JSON.stringify(view),/invoice-file:|PRIVATE-CONTACT|PRIVATE-PHONE/);assert.throws(()=>privacyCleanupJobView(f.s,{role:'user',userId:'u2'},result),/无权/);
});
test('已发布政策附件或未知ref仍是有效用途；复用对象逐准确路径扫描而非误报循环',async()=>{
  const f=await setup();const shared={file:f.file};f.s.policyProofs=[shared,shared];const graph=collectPrivacyFileReferences(f.s);assert.equal(graph.issues.length,0);assert.equal(graph.references.filter(x=>x.ref===f.file.ref).length,2);await prepare(f);assert.equal((await execute(f)).items[0].status,'blocked');
  const g=await setup();g.s.privacyCleanupPolicySources[0].evidenceRefs=[g.file];await prepare(g);assert.equal((await execute(g)).items[0].status,'blocked');
  const h=await setup();h.s.unknownHistory='invoice-file:bad-ref and '+h.file.ref;await prepare(h);assert.equal((await execute(h)).items[0].status,'blocked');assert.ok(collectPrivacyFileReferences(h.s).issues.length);
});
test('真实finance会话角色自报support不能转权；原客服切人或原root变更不删',async()=>{
  const f=await setup(),finance=f.work('finance');f.actor={...finance,role:'group',job:'support'};await assert.rejects(()=>prepare(f),/真实集团/);
  const g=await setup();await prepare(g);const other=g.work('support');let switched=false;idb.setHook(event=>{if(!switched&&event.op==='get'&&event.store==='files'){switched=true;g.actor=other;}});const result=await execute(g);idb.setHook(null);assert.equal(result.items[0].status,'failed');assert.match(result.items[0].blockers.join(),/会话已变化/);assert.equal(await g.storage.hasStoredRef('invoice',g.file.ref),true);
  const h=await setup();await prepare(h);idb.setHook(event=>{if(event.op==='get'&&event.store==='files')h.s.bookings[0].contactName='ROOT-CHANGED';});const changed=await execute(h);idb.setHook(null);assert.equal(changed.items[0].status,'failed');assert.match(changed.items[0].blockers.join(),/准确来源已变化/);assert.equal(await h.storage.hasStoredRef('invoice',h.file.ref),true);
});
test('原已核absent只报告本次核对，后续重新上传原ref不能复用旧回执再删',async()=>{
  const f=await setup();await prepare(f);await f.storage.deleteStoredRef('invoice',f.file.ref,{beforeDelete:()=>true});const job=await execute(f);assert.equal(job.items[0].status,'already_absent');await saveInvoiceFile(pdf());assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);const n=idb.events.filter(x=>x.op==='delete').length;const original=await execute(f);assert.equal(original.items[0].status,'already_absent');assert.equal(original.items[0].currentObservation.status,'reappeared');assert.equal(original.status,'partial');assert.equal(idb.events.filter(x=>x.op==='delete').length,n);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);
});
test('原实际deleted后重上传只记录reappeared，原作者/删除结果与次数保留',async()=>{
  const f=await setup();await prepare(f);const deleted=await execute(f),attempts=structuredClone(deleted.items[0].attempts);assert.equal(deleted.items[0].status,'deleted');await saveInvoiceFile(pdf());const n=idb.events.filter(x=>x.op==='delete').length;
  const replayed=await execute(f);assert.equal(replayed.items[0].status,'deleted');assert.deepEqual(replayed.items[0].attempts,attempts);assert.equal(replayed.items[0].currentObservation.status,'reappeared');assert.equal(replayed.status,'partial');assert.equal(idb.events.filter(x=>x.op==='delete').length,n);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);
});
test('终态回读失败或期间失权保留current_unverified，不改原事实或重删',async()=>{
  for(const fault of ['read-failure','session-revoked']) {const f=await setup();await prepare(f);const deleted=await execute(f),attempts=structuredClone(deleted.items[0].attempts),n=idb.events.filter(x=>x.op==='delete').length;
    idb.setHook(event=>{if(event.op==='get'&&event.store==='files'){if(fault==='read-failure')throw Error('synthetic terminal read failure');f.s.staffSessions.find(x=>x.id===f.actor.sessionId).revokedAt=NOW;}});
    const replayed=await execute(f);idb.setHook(null);assert.equal(replayed.items[0].currentObservation.status,'current_unverified');assert.match(replayed.items[0].currentObservation.reason,/回读失败|失效/);assert.deepEqual(replayed.items[0].attempts,attempts);assert.equal(replayed.items[0].status,'deleted');assert.equal(replayed.status,'partial');assert.equal(idb.events.filter(x=>x.op==='delete').length,n);assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),false);
  }
});
test('异步执行中正式policy即使保持同版本自报published也不能换原依据',async()=>{
  const f=await setup();await prepare(f);let changed=false;idb.setHook(event=>{if(!changed&&event.op==='get'&&event.store==='files'){changed=true;f.s.privacyCleanupPolicies[0].basis='changed-authority';f.s.privacyCleanupPolicySources[0].basis='changed-authority';}});const result=await execute(f);idb.setHook(null);assert.equal(result.items[0].status,'failed');assert.equal(await f.storage.hasStoredRef('invoice',f.file.ref),true);assert.equal(idb.events.some(x=>x.op==='delete'),false);
});
test('关闭后的原root合法未提交上传取消仍可核，不把原权益新附件当新交易',async()=>{
  const f=await setup();f.s.now=NOW+10000;f.r.createdAt=NOW+100;f.r.cancelledAt=NOW+200;f.r.cleanupDecision.startAt=f.r.cancelledAt;f.r.cleanupDecision.retainUntil=f.r.cancelledAt+1000;await prepare(f);const result=await execute(f);assert.equal(result.items[0].status,'deleted');assert.equal(closedRightsBinding(f.s,f.user,'booking','B1').rootId,'B1');
});
