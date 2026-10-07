import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { prepareCareEvidence } from './care-file-validation.mjs';
import { saveInvoiceFile, readInvoiceFile, validateInvoiceFile } from './invoice-files.mjs';
import { careEvidenceFile } from './service-care.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { closedRightsBinding } from './privacy-closed-rights.mjs';

// Runtime unit: standard IndexedDB and image-decoder stand-ins, never a browser acceptance claim.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64');
const NOW = Date.parse('2026-10-04T12:00:00+08:00'), stored = new Map();
let previousIndexedDB, previousDecoder;
before(()=>{
  previousIndexedDB=globalThis.indexedDB;previousDecoder=globalThis.createImageBitmap;
  globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={createObjectStore(){},transaction(){const tx={objectStore(){return{put(blob,key){stored.set(key,blob);queueMicrotask(()=>tx.oncomplete?.());},get(key){const read={};queueMicrotask(()=>{read.result=stored.get(key);read.onsuccess?.();});return read;}};}};return tx;}};request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
  // The fixture is a complete embedded PNG. Decoder coverage belongs to the real browser.
  globalThis.createImageBitmap=async blob=>{if(!Buffer.from(await blob.arrayBuffer()).equals(png))throw Error('isolated decoder rejected non-fixture image');return{width:1,height:1,close(){}};};
});
after(()=>{globalThis.indexedDB=previousIndexedDB;globalThis.createImageBitmap=previousDecoder;});
async function actualFile(){return saveInvoiceFile(new File([png],'原投诉技术样本.png',{type:'image/png'}));}
function fixture(){
  const s=seed();s.now=NOW;
  const u=s.users[0],t=s.techs[0],bookingId='CARE-TECHNICAL-B1';
  s.bookings.push({id:bookingId,userId:u.id,storeId:t.storeId,techId:t.id,serviceId:t.serviceIds[0],status:'done',completedAt:NOW-1000,payment:{id:'CARE-TECHNICAL-P1',status:'success',amountCents:19800,refundedCents:0},extensions:[],refunds:[],disputes:[],createdAt:NOW-3600000});
  return {state:s,actor:{role:'user',userId:u.id},bookingId};
}
const create = (f,file,extra={})=>({bookingId:f.bookingId,category:'quality',description:'实际字节及原事务的隔离技术测试',reason:'技术受理依据',requestId:'care-photo-create',evidenceRefs:file?[file]:[],...extra});
const prepare = (f,p,options={})=>prepareCareEvidence(f.state,f.actor,'care.case-create',p,{currentContext:()=>({state:f.state,actor:f.liveActor || f.actor}),...options});
const commit = (f,type,p,evidence)=>{f.state=reduce(f.state,f.actor,type,p,()=>{},evidence);return f.state.serviceCareCases.at(-1);};
function register(f,job='support'){
  const id='CARE-A',grantId='CARE-G',sessionId='CARE-S';
  (f.state.staffAccounts ??=[]).push({id,name:'图片技术客服',enabled:true,version:1,grants:[{id:grantId,job,role:'group',enabled:true}]});
  (f.state.staffSessions ??=[]).push({id:sessionId,accountId:id,grantId,accountVersion:1,expiresAt:NOW+86400000});
  return{sessionId};
}

test('原save/read/validate与SHA后才提交真实reduce，新案原付款不变',async()=>{
  const f=fixture(),file=await actualFile(),p=create(f,file),before=structuredClone(f.state);
  assert.equal(file.ref,'invoice-file:'+createHash('sha256').update(png).digest('hex'));assert.equal(file.size,png.length);
  const blob=await readInvoiceFile(file);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),png);assert.equal((await validateInvoiceFile(blob)).byteLength,png.length);
  const ready=await prepare(f,p);assert.deepEqual(ready,{evidenceRefs:[file]});assert.deepEqual(f.state,before);
  const row=commit(f,'care.case-create',p,ready);assert.deepEqual(row.evidenceRefs,[file]);assert.equal(row.createdBy.id,f.actor.userId);
  const b=f.state.bookings.find(x=>x.id===f.bookingId);assert.equal(b.payment.amountCents,19800);assert.equal(b.payment.refundedCents,0);assert.equal(b.refunds.length,0);
});
test('实际原statement追加及同请求重放核原槽，原图片不覆盖',async()=>{
  const f=fixture(),file=await actualFile();const row=commit(f,'care.case-create',create(f,null),{evidenceRefs:[]});
  const p={id:row.id,version:row.version,text:'原本人实际补充技术图片',requestId:'original-statement',evidenceRefs:[file]};
  const options={currentContext:()=>({state:f.state,actor:f.actor})};
  const ready=await prepareCareEvidence(f.state,f.actor,'care.case-statement',p,options);commit(f,'care.case-statement',p,ready);
  assert.equal(f.state.serviceCareCases.at(-1).statements.length,1);
  const replay=await prepareCareEvidence(f.state,f.actor,'care.case-statement',p,options);commit(f,'care.case-statement',p,replay);assert.equal(f.state.serviceCareCases.at(-1).statements.length,1);
  f.state.serviceCareCases.at(-1).statements[0].evidenceRefs[0].name='槽变更.png';await assert.rejects(prepareCareEvidence(f.state,f.actor,'care.case-statement',p,options),/槽或元数据已变化/);
});
test('无图旧文字与无关域不读文件，未接真实运行证据不能直接写图片',async()=>{
  const f=fixture(),file=await actualFile();let calls=0;
  assert.deepEqual(await prepare(f,create(f,null),{readFile(){calls++;}}),{evidenceRefs:[]});
  assert.deepEqual(await prepareCareEvidence({},null,'booking.pay',{evidenceRefs:'fake'}),{evidenceRefs:[]});assert.equal(calls,0);
  assert.throws(()=>reduce(f.state,f.actor,'care.case-create',create(f,file)),/真实文件核验/);
});
test('当前身份、跨用户/门店/技师/财务/会话先于实读拒绝',async()=>{
  const file=await actualFile();
  for(const actor of [{role:'user',userId:'missing'},{role:'tech',techId:'missing'},{role:'store',storeId:'missing'},{role:'group',job:'finance'},{sessionId:'missing'}]){
    const f=fixture();f.actor=actor;let calls=0;await assert.rejects(prepare(f,create(f,file),{readFile(){calls++;}}));assert.equal(calls,0);
  }
  const f=fixture(),other=f.state.users.find(x=>x.id!==f.actor.userId);f.actor={role:'user',userId:other.id};let calls=0;
  await assert.rejects(prepare(f,create(f,file),{readFile(){calls++;}}),/本人|无权/);assert.equal(calls,0);
});
test('新案原48小时期限及准确源在实读前核验',async()=>{
  const f=fixture(),file=await actualFile();f.state.now+=2*86400000;let calls=0;
  await assert.rejects(prepare(f,create(f,file),{readFile(){calls++;}}),/48小时/);assert.equal(calls,0);
  const g=fixture();g.state.bookings.push(structuredClone(g.state.bookings.find(x=>x.id===g.bookingId)));await assert.rejects(prepare(g,create(g,file)),/不唯一/);
});
test('实读必须非空Blob，不能由名称、对象或元数据伪造',async()=>{
  const f=fixture(),file=await actualFile();
  for(const value of [undefined,{size:file.size,type:file.type},new Blob([],{type:'image/png'}),new Blob([png],{type:'image/jpeg'})])await assert.rejects(prepare(f,create(f,file),{readFile:async()=>value}),/缺失|元数据/);
  await assert.rejects(prepare(f,create(f,{...file,size:file.size+1})),/资料与文件不一致/);
});
test('实际SHA拒绝同长度同类型伪ref，原格式和解码验证不可略过',async()=>{
  const f=fixture(),file=await actualFile();
  await assert.rejects(prepare(f,create(f,{...file,ref:'invoice-file:'+'a'.repeat(64)}),{readFile:async()=>new Blob([png],{type:'image/png'})}),/摘要/);
  await assert.rejects(prepare(f,create(f,{...file,size:8}),{readFile:async()=>new Blob([png.subarray(0,8)],{type:'image/png'})}),/无法解码/);
  await assert.rejects(prepare(f,create(f,{...file,type:'application/pdf'})),/PNG或JPEG/);
});
test('实读await期间换成新账本对象的原预约来源变化拒绝',async()=>{
  const f=fixture(),file=await actualFile(),before=structuredClone(f.state);
  await assert.rejects(prepare(f,create(f,file),{readFile:async metadata=>{const blob=await readInvoiceFile(metadata);f.state=structuredClone(f.state);f.state.bookings.find(x=>x.id===f.bookingId).completedAt--;return blob;}}),/核验期间已变化/);
  assert.equal(f.state.serviceCareCases.length,before.serviceCareCases.length);
});
test('实读await期间页面本人变化或实际客服会话撤权拒绝',async()=>{
  const f=fixture(),file=await actualFile();
  await assert.rejects(prepare(f,create(f,file),{readFile:async metadata=>{const blob=await readInvoiceFile(metadata);f.liveActor={role:'user',userId:f.state.users.find(x=>x.id!==f.actor.userId).id};return blob;}}));
  const g=fixture();g.actor=register(g);
  await assert.rejects(prepare(g,create(g,file),{readFile:async metadata=>{const blob=await readInvoiceFile(metadata);g.state.staffSessions.find(x=>x.id===g.actor.sessionId).revokedAt=NOW;return blob;}}),/失效/);
});
test('解码await期间原案件版本变化拒绝，不提交原statement',async()=>{
  const f=fixture(),file=await actualFile(),row=commit(f,'care.case-create',create(f,null),{evidenceRefs:[]});
  const p={id:row.id,version:row.version,text:'技术补充',requestId:'version-change',evidenceRefs:[file]};
  await assert.rejects(prepareCareEvidence(f.state,f.actor,'care.case-statement',p,{currentContext:()=>({state:f.state,actor:f.actor}),validateFile:async blob=>{const bytes=await validateInvoiceFile(blob);f.state.serviceCareCases.find(x=>x.id===row.id).version++;return bytes;}}),/记录已更新|核验期间/);
  assert.equal(f.state.serviceCareCases.at(-1).statements.length,0);
});
test('重放实读期间原slot变化仍拒绝，不修改旧成功图片',async()=>{
  const f=fixture(),file=await actualFile(),p=create(f,file);commit(f,'care.case-create',p,await prepare(f,p));
  await assert.rejects(prepare(f,p,{readFile:async metadata=>{const blob=await readInvoiceFile(metadata);f.state.serviceCareCases.at(-1).evidenceRefs[0].name='另一个名称.png';return blob;}}),/槽或元数据已变化/);
  assert.equal(f.state.serviceCareCases.length,1);
});
test('核验期间外部载荷突变不会改已冻结的实际文件集合',async()=>{
  const f=fixture(),file=await actualFile(),p=create(f,file);
  const ready=await prepare(f,p,{readFile:async metadata=>{p.evidenceRefs[0].name='外部载荷变更.png';return readInvoiceFile(metadata);}});assert.equal(ready.evidenceRefs[0].name,'原投诉技术样本.png');
});
test('原案件正常办结及privacy.close后原照片经真实闭域Binding读取，主付款串号拒绝',async()=>{
  const f=fixture(),file=await actualFile(),row=commit(f,'care.case-create',create(f,file),await prepare(f,create(f,file)));
  f.state=reduce(f.state,{role:'group',job:'support'},'care.case-respond',{id:row.id,version:row.version,decision:'respond',publicReply:'隔离技术核实处理',requestId:'closed-care-respond'});
  let c=f.state.serviceCareCases.find(x=>x.id===row.id);
  f.state=reduce(f.state,f.actor,'care.case-answer',{id:c.id,version:c.version,decision:'accept',requestId:'closed-care-answer'});
  f.state=reduce(f.state,f.actor,'privacy.request',{version:0,acknowledged:true,reason:'隔离真实原关闭命令测试',requestId:'closed-care-request'});
  const closure=f.state.privacyClosures.at(-1);
  f.state=reduce(f.state,{role:'group',job:'support'},'privacy.close',{id:closure.id,version:closure.version,acknowledged:true,reason:'已核查原案件，历史图片保留待审',custodian:'技术核查负责人',requestId:'closed-care-close'});
  assert.equal(privacyUseClosed(f.state,f.actor.userId),true);
  const options={assertUserScope:(s,a,kind,id)=>{if(privacyUseClosed(s,a.userId))closedRightsBinding(s,a,kind,id);}};
  assert.equal(careEvidenceFile(f.state,f.actor,row.id,'evidence:0',options).ref,file.ref);
  f.state.bookings.find(x=>x.id===f.bookingId).payment.id='OTHER-PAYMENT';
  assert.throws(()=>careEvidenceFile(f.state,f.actor,row.id,'evidence:0',options),/该笔支付不在关闭时的原权益快照中/);
});
test('任一关闭信号缺真实回执依据时，新增原图片核验拒绝',async()=>{
  const f=fixture(),file=await actualFile();f.state.users.find(x=>x.id===f.actor.userId).status='closed';
  await assert.rejects(prepare(f,create(f,file)),/关闭|依据|回执/);
});
