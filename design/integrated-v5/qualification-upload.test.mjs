import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce} from './engine.mjs';
import {readInvoiceFile} from './invoice-files.mjs';
import {saveQualificationUpload,parseQualificationFormEvidence} from './qualification-upload.mjs';
import {prepareQualificationEvidence} from './qualification-file-validation.mjs';
import {qualificationUploadScope,qualificationEvidenceFile,qualificationEligibility} from './tech-qualification.mjs';
import {qualificationUiView} from './qualification-ui.mjs';
import {applyTechnicianTransfer} from './organization-assignment.mjs';

// Runtime unit: actual original save/read/prepare/reduce/render, standard IndexedDB/decoder stand-ins.
// Browser file events, storage permissions, visual controls and preview/download need runtime acceptance.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64');
const pdf=n=>Buffer.from(`%PDF-1.4\n% isolated qualification fixture ${n}\n%%EOF\n`),NOW=Date.parse('2026-10-04T12:00:00+08:00'),stored=new Map();let oldDB,oldDecoder,request=0;
before(()=>{oldDB=globalThis.indexedDB;oldDecoder=globalThis.createImageBitmap;
  globalThis.indexedDB={open(){const r={};queueMicrotask(()=>{r.result={createObjectStore(){},transaction(){const tx={objectStore(){return{put(blob,key){stored.set(key,blob);queueMicrotask(()=>tx.oncomplete?.());},get(key){const read={};queueMicrotask(()=>{read.result=stored.get(key);read.onsuccess?.();});return read;}};}};return tx;}};r.onupgradeneeded?.();r.onsuccess?.();});return r;}};
  globalThis.createImageBitmap=async blob=>{if(!Buffer.from(await blob.arrayBuffer()).equals(PNG))throw Error('fixture decoder only');return{width:1,height:1,close(){}};};
});
after(()=>{globalThis.indexedDB=oldDB;globalThis.createImageBitmap=oldDecoder;});
const chosen=n=>new File([pdf(n)],`原资格资料${n}.pdf`,{type:'application/pdf'}),image=()=>new File([PNG],'原考核图片.png',{type:'image/png'});
const descriptor=n=>({ref:'invoice-file:'+String(n).repeat(64),name:'隔离原凭证.pdf',type:'application/pdf',size:50});
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function forms(html,type){return[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,attrs,body])=>({attrs,body,type:/data-command="([^"]+)"/.exec(attrs)?.[1],payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1]||'{}')),key:decode(/data-management-form="([^"]+)"/.exec(attrs)?.[1]||'')})).filter(form=>form.type===type);}
function fixture(){const state=seed();state.now=NOW;const person=state.techs[0];Object.assign(person,{active:true,reviewStatus:'approved',certificate:'原证书',insurance:'原保单',validUntil:'2027-12-31',qualificationRequired:true});state.techQualifications=[];state.techQualificationRequests=[];return{state,actor:{role:'store',storeId:person.storeId},storeId:person.storeId,techId:person.id,serviceId:person.serviceIds[0]};}
const current=f=>({state:f.state,actor:f.actor}),page=(f,actor=f.actor)=>qualificationUiView(f.state,actor,['qualifications',f.techId]),profile=f=>f.state.techQualifications.find(row=>row.techId===f.techId&&row.storeId===f.storeId);
const payload=(f,extra={})=>({techId:f.techId,storeId:f.storeId,...(profile(f)?{profileId:profile(f).id}:{}),version:profile(f)?.version||0,...extra});
const options=f=>({currentContext:()=>current(f)});
async function upload(f,type='qualification.assess',p=payload(f),files=[chosen(1)],extra={}){return saveQualificationUpload(files,type,p,{...options(f),...extra});}
async function run(f,type,extra={},refs=[]){const p={...payload(f),requestId:'qualification-upload-'+(++request),reason:'原逐人实际依据',...extra,evidenceRefs:refs};const ready=await prepareQualificationEvidence(f.state,f.actor,type,p,options(f));f.state=reduce(f.state,f.actor,type,p,()=>{},ready);return profile(f);}
async function assess(f,refs=[]){return run(f,'qualification.assess',{kind:'mature',serviceIds:[f.serviceId],occurredAt:NOW-1000,batch:'原名单',assessor:'实际考核作者',proof:'原考核来源',result:'pass'},refs);}
async function authorize(f,refs=[]){await assess(f,refs);await run(f,'qualification.request',{assessmentId:profile(f).assessments.at(-1).id},refs);f.actor={role:'group',job:'operations'};await run(f,'qualification.review',{grantId:profile(f).grants.at(-1).id,decision:'approve',reviewer:'实际集团核验人',proof:'原审核来源'},refs);}
function register(f,job='operations'){f.state.staffAccounts??=[];f.state.staffSessions??=[];f.state.staffAccounts.push({id:'QU-A',name:'实际资格账号',enabled:true,version:1,grants:[{id:'QU-G',role:'group',job,enabled:true}]});f.state.staffSessions.push({id:'QU-S',accountId:'QU-A',grantId:'QU-G',accountVersion:1,expiresAt:NOW+86400000});f.actor={sessionId:'QU-S'};}

test('真实原空正文表单先选多文件，无资格row时不造考核批准，原业务不变',async()=>{
  const f=fixture(),form=forms(page(f),'qualification.assess')[0],before=structuredClone(f.state);assert.equal(form.payload.version,0);assert.equal(form.payload.storeId,f.storeId);assert.equal(form.payload.profileId,undefined);assert.match(form.body,/name="evidenceRefs" value="\[\]"/);
  const refs=await upload(f,form.type,form.payload,[chosen(1),chosen(2),image()]);assert.equal(refs.length,3);assert.equal((await readInvoiceFile(refs[0])).size,pdf(1).length);assert.deepEqual(f.state,before);assert.equal(f.state.techQualifications.length,0);assert.deepEqual(parseQualificationFormEvidence(JSON.stringify(refs)),refs);
  for(const value of ['not-json','{}','null','[1]',JSON.stringify([refs[0],refs[0]])])assert.throws(()=>parseQualificationFormEvidence(value));
});
test('实际选择→prepare复读→原reduce→render精确原profile/source/history组件',async()=>{
  const f=fixture(),form=forms(page(f),'qualification.assess')[0],refs=await upload(f,form.type,form.payload,[chosen(3),chosen(4)]);await assess(f,refs);const row=profile(f),html=page(f),slot=`assessment:${row.assessments[0].id}:0`;
  assert.match(html,/data-invoice-domain="qualification"/);assert.match(html,new RegExp(`data-invoice-id="${row.id}" data-invoice-slot="${slot}"`));assert.match(html,/data-invoice-slot="history:1:0"/);assert.equal(qualificationEvidenceFile(f.state,f.actor,row.id,slot).ref,refs[0].ref);assert.equal(qualificationEligibility(f.state,f.techId,f.serviceId).allowed,false);assert.equal(qualificationEvidenceFile(f.state,f.actor,row.id,'history:1:1').ref,refs[1].ref);
  const next=forms(html,'qualification.request')[0];assert.equal(next.payload.profileId,row.id);assert.equal(next.payload.storeId,f.storeId);assert.notEqual(next.key,form.key);
});
test('原request/review空原因和未选decision可选择；原完整submit仍拒正文缺项',async()=>{
  const f=fixture();await assess(f);const requestForm=forms(page(f),'qualification.request')[0],refs=await upload(f,requestForm.type,requestForm.payload,[chosen(5)]);assert.equal(refs.length,1);assert.throws(()=>reduce(f.state,f.actor,requestForm.type,{...requestForm.payload,requestId:'empty-request',evidenceRefs:refs},()=>{},{evidenceRefs:refs}),/处理依据/);await run(f,'qualification.request',{assessmentId:profile(f).assessments[0].id},refs);
  f.actor={role:'group',job:'operations'};const reviewForm=forms(page(f),'qualification.review')[0];assert.equal((await upload(f,reviewForm.type,{...reviewForm.payload,decision:''},[chosen(6)])).length,1);assert.throws(()=>reduce(f.state,f.actor,reviewForm.type,{...reviewForm.payload,reason:'事实',requestId:'empty-review',evidenceRefs:refs},()=>{},{evidenceRefs:refs}),/审核决定/);
  for(const decision of [false,0,'bad'])await assert.rejects(upload(f,reviewForm.type,{...reviewForm.payload,decision},[chosen(7)]),/有效审核决定/);
});
test('原pause/retraining/resume空正文表单可选，stage和关联资格仍核真实原记录',async()=>{
  const f=fixture();await authorize(f);let form=forms(page(f),'qualification.pause')[0];assert.equal((await upload(f,form.type,form.payload,[chosen(8)])).length,1);await run(f,'qualification.pause',{serviceIds:[f.serviceId],owner:'原复训负责人'});const holdId=profile(f).holds[0].id;form=forms(page(f),'qualification.assess').find(item=>item.payload.holdId===holdId);assert.equal((await upload(f,form.type,form.payload,[chosen(9)])).length,1);assert.equal(forms(page(f),'qualification.resume').length,0);await assert.rejects(upload(f,'qualification.resume',payload(f,{holdId}),[chosen(10)]),/尚未完成/);
  await run(f,'qualification.assess',{kind:'retraining',holdId,serviceIds:[f.serviceId],occurredAt:NOW,batch:'原復训',assessor:'原作者',proof:'原来源',result:'pass'});await run(f,'qualification.request',{assessmentId:profile(f).assessments.at(-1).id});await run(f,'qualification.review',{grantId:profile(f).grants.at(-1).id,decision:'approve',reviewer:'原集团作者',proof:'原审核'});form=forms(page(f),'qualification.resume')[0];assert.equal((await upload(f,form.type,form.payload,[chosen(11)])).length,1);assert.equal(profile(f).holds[0].status,'open');
});
test('每个可操作原表单有可选真实文件/JSON/独立清除及静态状态，内部材料技师隐藏',async()=>{
  const f=fixture(),refs=await upload(f,undefined,undefined,[chosen(12)]);await authorize(f,refs);await run(f,'qualification.pause',{serviceIds:[f.serviceId],owner:'原负责人'},refs);await run(f,'qualification.assess',{kind:'retraining',holdId:profile(f).holds[0].id,serviceIds:[f.serviceId],occurredAt:NOW,batch:'原復训',assessor:'原作者',proof:'原来源',result:'pass'},refs);await run(f,'qualification.request',{assessmentId:profile(f).assessments.at(-1).id},refs);
  for(const command of ['qualification.assess','qualification.pause','qualification.review'])for(const form of forms(page(f),command)){assert.match(form.body,/<input type="file"[^>]*multiple data-qualification-upload>/);assert.doesNotMatch(form.body,/<input type="file"[^>]*required/);assert.match(form.body,/data-qualification-upload-status role="status"/);assert.match(form.body,/<ul class="small" data-qualification-selected-files>/);assert.match(form.body,/<button type="button"[^>]*data-qualification-clear disabled>/);}
  await run(f,'qualification.review',{grantId:profile(f).grants.at(-1).id,decision:'approve',reviewer:'审核人',proof:'原来源'},refs);await run(f,'qualification.resume',{holdId:profile(f).holds[0].id,reviewer:'恢复人'},refs);const html=page(f);for(const kind of ['assessment','request','review','pause','resume','history'])assert.match(html,new RegExp(`data-invoice-slot="${kind}:`));const techHtml=page(f,{role:'tech',techId:f.techId});assert.doesNotMatch(techHtml,/data-qualification-upload|data-invoice-domain="qualification"|原考核来源/);
});
test('跨岗位/店/技师/用户和缺失原档均在存文件前拒绝',async()=>{
  const forbidden=[{role:'store',storeId:'missing'},{role:'group',job:'support'},{role:'group',job:'finance'},{role:'tech',techId:'lin'},{role:'user',userId:'u1'},{sessionId:'missing'}];for(const actor of forbidden){const f=fixture(),p=payload(f);f.actor=actor;let saves=0;await assert.rejects(upload(f,'qualification.assess',p,[chosen(13)],{saveFile:async()=>{saves++;return descriptor(1);}}));assert.equal(saves,0);}
  const f=fixture(),p=payload(f);f.state.techs=[];let saves=0;await assert.rejects(upload(f,'qualification.assess',p,[chosen(13)],{saveFile:async()=>{saves++;return descriptor(1);}}),/原技师/);assert.equal(saves,0);
});
test('版本/唯一原source/阶段选择前重核，不能用旧UI槽另造申请或恢复',async()=>{
  const f=fixture();await assess(f);const p=payload(f,{assessmentId:profile(f).assessments[0].id});for(const bad of [{...p,version:0},{...p,assessmentId:'missing'},{...p,profileId:'wrong'}])await assert.rejects(upload(f,'qualification.request',bad,[chosen(14)]));await run(f,'qualification.request',{assessmentId:p.assessmentId});await assert.rejects(upload(f,'qualification.request',payload(f,{assessmentId:p.assessmentId}),[chosen(14)]),/已申请/);f.actor={role:'group',job:'operations'};await run(f,'qualification.review',{grantId:profile(f).grants[0].id,decision:'reject',reviewer:'原审核人',proof:'原驳回事实'});await assert.rejects(upload(f,'qualification.review',payload(f,{grantId:profile(f).grants[0].id}),[chosen(15)]),/待审核/);
});
test('原反馈暂停选择锁唯一case/booking/事项和版本，正文未填无妨',async()=>{
  const f=fixture(),b={id:'QU-B',techId:f.techId,storeId:f.storeId,serviceId:f.serviceId,status:'done'},c={id:'QU-C',bookingId:b.id,techId:f.techId,storeId:f.storeId,version:2,specialistActions:[{kind:'retraining',status:'pending'}]};f.state.bookings.push(b);f.state.serviceCareCases.push(c);const p=payload(f,{caseId:c.id,actionIndex:0,caseVersion:2});assert.equal((await upload(f,'qualification.pause',p,[chosen(16)])).length,1);for(const extra of [{caseVersion:1},{actionIndex:false},{actionIndex:1},{caseId:'missing'}])await assert.rejects(upload(f,'qualification.pause',{...p,...extra},[chosen(16)]));c.specialistActions[0].qualificationHoldId='OTHER';await assert.rejects(upload(f,'qualification.pause',p,[chosen(16)]),/专项/);
});
for(const change of ['actor','person','profile','source','clock'])test('await保存后'+change+'改变拒绝返回草稿refs，原资格不被提交',async()=>{
  const f=fixture();await assess(f);const p=payload(f,{assessmentId:profile(f).assessments[0].id}),before=structuredClone(f.state);
  await assert.rejects(upload(f,'qualification.request',p,[chosen(17)],{saveFile:async()=>{if(change==='actor')f.actor={role:'group',job:'operations'};else if(change==='person')f.state.techs.find(person=>person.id===f.techId).storeId='different';else if(change==='profile')profile(f).version++;else if(change==='source')profile(f).assessments[0].proof='异步来源更换';else f.state.now++;return descriptor(1);}}));assert.equal(profile(f).grants.length,0);assert.deepEqual(f.state.bookings,before.bookings);
});
test('当前注册会话每次save前后重核，撤授权/会话不得发布已保存文件',async()=>{
  const f=fixture();register(f);const before=structuredClone(f.state);await assert.rejects(upload(f,'qualification.assess',payload(f),[chosen(18)],{saveFile:async()=>{f.state.staffSessions.find(session=>session.id==='QU-S').revokedAt=NOW;return descriptor(1);}}),/会话/);assert.equal(f.state.techQualifications.length,0);assert.deepEqual(f.state.bookings,before.bookings);
});
test('先核所有文件格式大小，实际保存失败/重复refs不返回选择，可重试',async()=>{
  const f=fixture();let saves=0;const failFile=async()=>{saves++;return descriptor(1);};for(const files of [[],[new File([],'空.pdf',{type:'application/pdf'})],[chosen(19),new File(['bad'],'bad.webp',{type:'image/webp'})],[{type:'application/pdf',size:100}]])await assert.rejects(upload(f,'qualification.assess',payload(f),files,{saveFile:failFile}));assert.equal(saves,0);await assert.rejects(upload(f,'qualification.assess',payload(f),[chosen(20),chosen(21)],{saveFile:failFile}),/重复/);assert.equal(saves,2);await assert.rejects(upload(f,'qualification.assess',payload(f),[chosen(22)],{saveFile:async()=>{throw Error('隔离存储失败');}}),/存储失败/);assert.equal((await upload(f)).length,1);
});
test('每次save之前也从freshContext重核；外部payload修改不更换冻结原source',async()=>{
  const f=fixture(),p=payload(f),files=[chosen(23),chosen(24)];let reads=0,saves=0;await assert.rejects(saveQualificationUpload(files,'qualification.assess',p,{currentContext:()=>{reads++;if(reads===4)f.state.now++;return current(f);},saveFile:async()=>{saves++;return descriptor(saves);}}),/变化/);assert.equal(saves,1);
  const g=fixture(),q=payload(g);const refs=await upload(g,'qualification.assess',q,[chosen(25)],{saveFile:async()=>{q.techId='missing';return descriptor(1);}});assert.deepEqual(refs,[descriptor(1)]);assert.equal(g.state.techQualifications.length,0);
});
test('调店后回原店多历史profile，当前表单固定新档且draft key换源，旧档只可显式选择',async()=>{
  const f=fixture();await assess(f);const old=profile(f),originalForm=forms(page(f),'qualification.assess')[0],target=f.state.stores.find(store=>store.id!==f.storeId).id;f.actor={role:'group',job:'operations'};
  function transfer(toStoreId){const person=f.state.techs.find(person=>person.id===f.techId),c={id:'QU-T-'+(++request),kind:'transfer',techId:f.techId,fromStoreId:person.storeId,toStoreId,createdAt:NOW,effectiveAt:NOW,stage:'planned',status:'planned',version:1,reference:'原调店来源',reason:'原多历史档核验'};f.state.organizationLifecycleCases.push(c);applyTechnicianTransfer(f.state,c,{id:prefix=>prefix+(++f.state.seq)});c.stage='effective';c.status='effective';}
  transfer(target);transfer(f.storeId);const actualForm=forms(page(f),'qualification.assess')[0];assert.notEqual(actualForm.payload.profileId,old.id);assert.notEqual(actualForm.key,originalForm.key);assert.equal((await upload(f,actualForm.type,actualForm.payload,[chosen(26)])).length,1);await assert.rejects(upload(f,'qualification.assess',{techId:f.techId,storeId:f.storeId,version:old.version},[chosen(27)]),/版本/);assert.equal((await upload(f,'qualification.assess',{techId:f.techId,storeId:f.storeId,profileId:old.id,version:old.version},[chosen(28)])).length,1);assert.equal(old.assessments.length,1);
});
