import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {seed,reduce} from './engine.mjs';
import {prepareQualificationEvidence} from './qualification-file-validation.mjs';
import {saveInvoiceFile,readInvoiceFile,validateInvoiceFile} from './invoice-files.mjs';
import {qualificationEvidenceFile,qualificationEligibility,qualificationView} from './tech-qualification.mjs';
import {applyTechnicianTransfer} from './organization-assignment.mjs';

// Runtime unit with IndexedDB/image decoder stand-ins. Actual bytes and original module behavior;
// browser PNG/JPEG decoding, PDF rendering and user-visible controls require browser acceptance.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64');
const PDF=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const NOW=Date.parse('2026-10-04T12:00:00+08:00'),stored=new Map();let oldDB,oldDecoder;
before(()=>{oldDB=globalThis.indexedDB;oldDecoder=globalThis.createImageBitmap;
  globalThis.indexedDB={open(){const req={};queueMicrotask(()=>{req.result={createObjectStore(){},transaction(){const tx={objectStore(){return{put(blob,key){stored.set(key,blob);queueMicrotask(()=>tx.oncomplete?.());},get(key){const read={};queueMicrotask(()=>{read.result=stored.get(key);read.onsuccess?.();});return read;}};}};return tx;}};req.onupgradeneeded?.();req.onsuccess?.();});return req;}};
  globalThis.createImageBitmap=async blob=>{if(!Buffer.from(await blob.arrayBuffer()).equals(PNG))throw Error('decoder fixture only');return{width:1,height:1,close(){}};};
});
after(()=>{globalThis.indexedDB=oldDB;globalThis.createImageBitmap=oldDecoder;});
const actualFile=(type='application/pdf')=>saveInvoiceFile(new File([type==='image/png'?PNG:PDF],type==='image/png'?'原考核样本.png':'原考核技术样本.pdf',{type}));
function fixture(){const s=seed();s.now=NOW;const tech=s.techs[0];tech.qualificationRequired=true;tech.active=true;tech.reviewStatus='approved';tech.certificate='技术原证书';tech.insurance='技术原保单';tech.validUntil='2027-12-31';s.techQualifications=[];s.techQualificationRequests=[];return{state:s,techId:tech.id,actor:{role:'store',storeId:tech.storeId},serviceId:tech.serviceIds[0]};}
let request=0;
const row=f=>f.state.techQualifications.find(item=>item.techId===f.techId&&item.storeId===(f.storeId||f.actor.storeId));
function payload(f,type,file,extra={}){return{techId:f.techId,version:row(f)?.version||0,requestId:'qualification-file-'+(++request),reason:'原逐人实际核验依据',...(file?{evidenceRefs:[file]}:{}),...extra};}
const assess=(f,file,extra={})=>payload(f,'assess',file,{kind:'mature',serviceIds:[f.serviceId],occurredAt:NOW-1000,batch:'旧名单逐人核实',assessor:'实际考核作者',proof:'原纸质来源编号',result:'pass',...extra});
const options=f=>({currentContext:()=>({state:f.state,actor:f.liveActor||f.actor})});
const prepare=(f,type,p,extra={})=>prepareQualificationEvidence(f.state,f.actor,'qualification.'+type,p,{...options(f),...extra});
const commit=(f,type,p,ready)=>{f.state=reduce(f.state,f.actor,'qualification.'+type,p,()=>{},ready);return row(f);};
async function run(f,type,p){return commit(f,type,p,await prepare(f,type,p));}
function register(f,job='operations'){
  f.state.staffAccounts??=[];f.state.staffSessions??=[];f.state.staffAccounts.push({id:'Q-A',name:'实际核验运营账号',enabled:true,version:1,grants:[{id:'Q-G',role:'group',job,enabled:true}]});f.state.staffSessions.push({id:'Q-S',accountId:'Q-A',grantId:'Q-G',accountVersion:1,expiresAt:NOW+86400000});return{sessionId:'Q-S'};
}

test('原save/read/validate实际PDF和PNG字节、hash与元数据后，原reduce保存逐人考核',async()=>{
  for(const type of ['application/pdf','image/png']){const f=fixture(),file=await actualFile(type),p=assess(f,file),before=structuredClone(f.state),bytes=type==='image/png'?PNG:PDF;assert.equal(file.ref,'invoice-file:'+createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(Buffer.from(await (await readInvoiceFile(file)).arrayBuffer()),bytes);assert.equal((await validateInvoiceFile(await readInvoiceFile(file))).byteLength,bytes.length);
    const ready=await prepare(f,'assess',p);assert.deepEqual(ready,{evidenceRefs:[file]});assert.deepEqual(f.state,before);commit(f,'assess',p,ready);assert.deepEqual(row(f).assessments[0].evidenceRefs,[file]);assert.equal(row(f).assessments[0].createdBy.id,f.actor.storeId);assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).allowed,false);assert.equal(qualificationEvidenceFile(f.state,f.actor,row(f).id,`assessment:${row(f).assessments[0].id}:0`).ref,file.ref);
  }
});
test('实际原考核申请集团审核逐项批准，新文件不更改旧考核原件',async()=>{
  const f=fixture(),file=await actualFile();await run(f,'assess',assess(f,file));const original=structuredClone(row(f).assessments[0]);await run(f,'request',payload(f,'request',file,{assessmentId:original.id}));assert.equal(row(f).grants[0].status,'pending');assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).allowed,false);const grantId=row(f).grants[0].id;
  f.storeId=f.actor.storeId;f.actor={role:'group',job:'operations'};await run(f,'review',payload(f,'review',file,{grantId,decision:'approve',reviewer:'原集团核验作者',proof:'集团原审核来源'}));assert.deepEqual(row(f).assessments[0],original);assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).allowed,true);assert.equal(qualificationEvidenceFile(f.state,f.actor,row(f).id,`review:${grantId}:0`).ref,file.ref);
});
test('旧无附件记录继续原流程、不读文件，载荷verified不能直接reduce新增文件',async()=>{
  const f=fixture(),file=await actualFile();let calls=0;const ready=await prepare(f,'assess',assess(f,null),{readFile(){calls++;}});assert.deepEqual(ready,{evidenceRefs:[]});assert.equal(calls,0);assert.deepEqual(await prepareQualificationEvidence({},null,'booking.pay',{evidenceRefs:'fake'}),{evidenceRefs:[]});assert.throws(()=>reduce(f.state,f.actor,'qualification.assess',{...assess(f,file),verified:true}),/实际文件核验/);
});
test('原驳回保留历史文件，不能据附件自动改approved或复用该考核再申请',async()=>{
  const f=fixture(),file=await actualFile();await run(f,'assess',assess(f,file));await run(f,'request',payload(f,'request',file,{assessmentId:row(f).assessments[0].id}));const grantId=row(f).grants[0].id;f.storeId=f.actor.storeId;f.actor={role:'group',job:'operations'};await run(f,'review',payload(f,'review',file,{grantId,decision:'reject',reviewer:'原驳回作者',proof:'驳回原事实'}));assert.equal(row(f).grants[0].status,'rejected');assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).allowed,false);await assert.rejects(prepare(f,'request',payload(f,'request',file,{assessmentId:row(f).assessments[0].id})),/已申请|新的考核/);
});
test('实际暂停复训授权及显式恢复链保存各原凭证，未恢复前仍停新单',async()=>{
  const f=fixture(),file=await actualFile();await run(f,'assess',assess(f,file));await run(f,'request',payload(f,'request',file,{assessmentId:row(f).assessments[0].id}));f.storeId=f.actor.storeId;f.actor={role:'group',job:'operations'};await run(f,'review',payload(f,'review',file,{grantId:row(f).grants[0].id,decision:'approve',reviewer:'审核人',proof:'授权来源'}));await run(f,'pause',payload(f,'pause',file,{serviceIds:[f.serviceId],owner:'复训负责人'}));const holdId=row(f).holds[0].id;await assert.rejects(prepare(f,'resume',payload(f,'resume',file,{holdId,reviewer:'恢复人'})),/须完成/);
  await run(f,'assess',assess(f,file,{kind:'retraining',holdId,occurredAt:NOW}));await run(f,'request',payload(f,'request',file,{assessmentId:row(f).assessments.at(-1).id}));await run(f,'review',payload(f,'review',file,{grantId:row(f).grants.at(-1).id,decision:'approve',reviewer:'复训审核人',proof:'复训原来源'}));assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).allowed,false);await run(f,'resume',payload(f,'resume',file,{holdId,reviewer:'恢复核验作者'}));assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).allowed,true);assert.equal(qualificationEvidenceFile(f.state,f.actor,row(f).id,`resume:${holdId}:0`).ref,file.ref);
});
test('跨店/用户/技师/财务/客服不能新增考核文件，原权限先于实读',async()=>{
  const file=await actualFile();for(const actor of [{role:'store',storeId:'missing'},{role:'user',userId:'missing'},{role:'tech',techId:'missing'},{role:'group',job:'finance'},{role:'group',job:'support'},{sessionId:'missing'}]){const f=fixture(),p=assess(f,file);f.actor=actor;let calls=0;await assert.rejects(prepare(f,'assess',p,{readFile(){calls++;}}));assert.equal(calls,0);}
});
test('真实Blob非空/元数据/格式/SHA核验，不接受假verified或伪对象',async()=>{
  const f=fixture(),file=await actualFile();for(const fake of [undefined,{size:file.size,type:file.type},new Blob([],{type:file.type}),new Blob([PDF],{type:'image/png'})])await assert.rejects(prepare(f,'assess',assess(f,file),{readFile:async()=>fake}),/缺失|元数据/);
  await assert.rejects(prepare(f,'assess',assess(f,{...file,size:file.size+1})),/资料与文件/);await assert.rejects(prepare(f,'assess',assess(f,{...file,ref:'invoice-file:'+'b'.repeat(64)}),{readFile:async()=>new Blob([PDF],{type:file.type})}),/摘要/);
  const broken=Buffer.from('%PDF-broken'),descriptor={...file,size:broken.length,ref:'invoice-file:'+createHash('sha256').update(broken).digest('hex')};await assert.rejects(prepare(f,'assess',assess(f,descriptor),{readFile:async()=>new Blob([broken],{type:file.type})}),/内容与所选格式/);
});
test('实际图片解码失败拒绝，validate不能返回假字节长度',async()=>{
  const f=fixture(),file=await actualFile('image/png'),broken=PNG.subarray(0,8),descriptor={...file,size:broken.length,ref:'invoice-file:'+createHash('sha256').update(broken).digest('hex')};await assert.rejects(prepare(f,'assess',assess(f,descriptor),{readFile:async()=>new Blob([broken],{type:'image/png'})}),/无法解码/);await assert.rejects(prepare(f,'assess',assess(f,file),{validateFile:async()=>new Uint8Array(0)}),/原文件字节/);
});
test('freshContext替换整个原档version，旧等待读取不得提交新考核',async()=>{
  const f=fixture(),file=await actualFile();await run(f,'assess',assess(f,null));const p=assess(f,file);await assert.rejects(prepare(f,'assess',p,{readFile:async meta=>{const blob=await readInvoiceFile(meta);f.state=structuredClone(f.state);row(f).version++;return blob;}}),/已更新|变化/);assert.equal(row(f).assessments.length,1);
});
test('核验期间人员调店/档案原source变化，即使旧引用相同也拒绝',async()=>{
  const file=await actualFile(),f=fixture();await assert.rejects(prepare(f,'assess',assess(f,file),{readFile:async meta=>{const blob=await readInvoiceFile(meta);f.state.techs.find(item=>item.id===f.techId).storeId=f.state.stores.find(item=>item.id!==f.actor.storeId).id;return blob;}}),/无权|变化|归属/);
  const g=fixture();await run(g,'assess',assess(g,null));await run(g,'request',payload(g,'request',null,{assessmentId:row(g).assessments[0].id}));g.storeId=g.actor.storeId;g.actor={role:'group',job:'operations'};const p=payload(g,'review',file,{grantId:row(g).grants[0].id,decision:'approve',reviewer:'核验人',proof:'来源'});await assert.rejects(prepare(g,'review',p,{readFile:async meta=>{const blob=await readInvoiceFile(meta);row(g).assessments[0].proof='异步原源已改变';return blob;}}),/变化/);assert.equal(row(g).grants[0].status,'pending');
});
test('注册当前运营会话可核验，实读期间撤会话或切换actor拒绝',async()=>{
  const f=fixture(),file=await actualFile();f.storeId=f.actor.storeId;f.actor=register(f);assert.deepEqual(await prepare(f,'assess',assess(f,file)),{evidenceRefs:[file]});await assert.rejects(prepare(f,'assess',assess(f,file),{readFile:async meta=>{const blob=await readInvoiceFile(meta);f.state.staffSessions.find(item=>item.id==='Q-S').revokedAt=NOW;return blob;}}),/会话/);
  const g=fixture();await assert.rejects(prepare(g,'assess',assess(g,file),{readFile:async meta=>{const blob=await readInvoiceFile(meta);g.liveActor={role:'group',job:'operations'};return blob;}}),/变化/);
});
test('同请求实际重放比原history槽，不增加记录；异步重命名原槽拒绝',async()=>{
  const f=fixture(),file=await actualFile(),p=assess(f,file);await run(f,'assess',p);const snapshot=structuredClone(f.state);const ready=await prepare(f,'assess',p);assert.deepEqual(f.state,snapshot);commit(f,'assess',p,ready);assert.equal(f.state.revision,snapshot.revision+1);snapshot.revision++;assert.deepEqual(f.state,snapshot);await assert.rejects(prepare(f,'assess',p,{readFile:async meta=>{const blob=await readInvoiceFile(meta);row(f).assessments[0].evidenceRefs[0].name='旧槽名改变.pdf';return blob;}}),/不一致|变化/);
});
test('异步validate后再核权限来源；外部payload变更不替换克隆原提交',async()=>{
  const f=fixture(),file=await actualFile(),originalName=file.name,p=assess(f,file);const ready=await prepare(f,'assess',p,{readFile:async meta=>{const blob=await readInvoiceFile(meta);p.evidenceRefs[0].name='外部载荷改变.pdf';return blob;}});assert.equal(ready.evidenceRefs[0].name,originalName);
  const g=fixture();await assert.rejects(prepare(g,'assess',assess(g,file),{validateFile:async blob=>{const bytes=await validateInvoiceFile(blob);g.state.techs.find(item=>item.id===g.techId).active=false;return bytes;}}),/变化/);
});
test('精确重复profile/source先于实读拒绝，缺freshContext不得读取',async()=>{
  const f=fixture(),file=await actualFile();await run(f,'assess',assess(f,null));f.state.techQualifications.push(structuredClone(row(f)));let calls=0;await assert.rejects(prepare(f,'assess',assess(f,file),{readFile(){calls++;}}),/不唯一|归属/);assert.equal(calls,0);
  const g=fixture();await assert.rejects(prepare(g,'assess',assess(g,file),{currentContext:()=>null,readFile(){calls++;}}),/上下文/);await assert.rejects(prepare(g,'assess',assess(g,file),{assertCommandScope:()=>false}),/拒绝/);await assert.rejects(prepare(g,'assess',assess(g,file),{assertCommandScope:()=>Promise.resolve(true)}),/同步/);
});
test('新增实际附件仍隐藏原技师内部材料，只读getter及进度不写状态',async()=>{
  const f=fixture(),file=await actualFile();await run(f,'assess',assess(f,file));const before=structuredClone(f.state),slot=`assessment:${row(f).assessments[0].id}:0`;assert.throws(()=>qualificationEvidenceFile(f.state,{role:'tech',techId:f.techId},row(f).id,slot),/无权/);assert.ok(!JSON.stringify(qualificationView(f.state,{role:'tech',techId:f.techId})).includes(file.ref));assert.deepEqual(f.state,before);
});
test('原调店再回原店形成多个历史profile，旧资格附件复训只写显式旧档',async()=>{
  const f=fixture(),file=await actualFile();await run(f,'assess',assess(f,file));const oldProfileId=row(f).id;await run(f,'request',payload(f,'request',file,{assessmentId:row(f).assessments[0].id}));f.storeId=f.actor.storeId;f.actor={role:'group',job:'operations'};await run(f,'review',payload(f,'review',file,{grantId:row(f).grants[0].id,decision:'approve',reviewer:'原核验人',proof:'原审核来源'}));const originalGrant=structuredClone(row(f).grants[0]);await run(f,'pause',payload(f,'pause',file,{serviceIds:[f.serviceId],owner:'旧店复训负责人'}));const holdId=row(f).holds[0].id;
  const person=()=>f.state.techs.find(item=>item.id===f.techId),newStore=f.state.stores.find(item=>item.id!==f.storeId).id;
  function transfer(toStoreId){const c={id:'Q-TRANSFER-'+(++request),kind:'transfer',techId:f.techId,fromStoreId:person().storeId,toStoreId,createdAt:NOW,effectiveAt:NOW,stage:'planned',status:'planned',version:1,reference:'原调店记录',reason:'隔离逐人历史档案核验'};f.state.organizationLifecycleCases.push(c);applyTechnicianTransfer(f.state,c,{id:prefix=>prefix+(++f.state.seq)});c.stage='effective';c.status='effective';}
  transfer(newStore);transfer(f.storeId);const currentProfileId=person().qualificationProfileId;assert.notEqual(currentProfileId,oldProfileId);assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).reason.includes('暂停'),true);
  const source={storeId:f.storeId,profileId:oldProfileId};await run(f,'assess',assess(f,file,{...source,kind:'retraining',holdId,occurredAt:NOW}));await run(f,'request',payload(f,'request',file,{...source,assessmentId:row(f).assessments.at(-1).id}));await run(f,'review',payload(f,'review',file,{...source,grantId:row(f).grants.at(-1).id,decision:'approve',reviewer:'原复训作者',proof:'原复训来源'}));await run(f,'resume',payload(f,'resume',file,{...source,holdId,reviewer:'原恢复作者'}));assert.deepEqual(row(f).grants[0],originalGrant);assert.equal(f.state.techQualifications.find(item=>item.id===currentProfileId).grants.length,0);assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).allowed,false);assert.equal(qualificationEvidenceFile(f.state,f.actor,oldProfileId,`resume:${holdId}:0`).ref,file.ref);
});
