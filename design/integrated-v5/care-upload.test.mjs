import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce} from './engine.mjs';
import {saveCareUpload,parseCareFormEvidence} from './care-upload.mjs';
import {careUploadScope} from './service-care.mjs';
import {prepareCareEvidence} from './care-file-validation.mjs';
import {saveInvoiceFile,authorizedInvoiceFile,readInvoiceFile} from './invoice-files.mjs';
import {careView as careUi} from './care-ui.mjs';
import {closedRightsTransactionsUiView} from './privacy-closed-transactions-ui.mjs';

// Standard API stand-ins verify original save/read and async event contracts.
// They provide no browser rendering evidence.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64'),stored=new Map();
let oldDatabase,oldDecoder;
before(()=>{
  oldDatabase=globalThis.indexedDB;oldDecoder=globalThis.createImageBitmap;
  globalThis.indexedDB={open(){const r={};queueMicrotask(()=>{r.result={createObjectStore(){},transaction(){const tx={objectStore(){return{put(blob,key){stored.set(key,blob);queueMicrotask(()=>tx.oncomplete?.());},get(key){const x={};queueMicrotask(()=>{x.result=stored.get(key);x.onsuccess?.();});return x;}};}};return tx;}};r.onupgradeneeded?.();r.onsuccess?.();});return r;}};
  globalThis.createImageBitmap=async b=>{assert.ok(Buffer.from(await b.arrayBuffer()).equals(png));return{width:1,height:1,close(){}};};
});
after(()=>{globalThis.indexedDB=oldDatabase;globalThis.createImageBitmap=oldDecoder;});
function fixture(){const state=seed();const user=state.users[0],tech=state.techs[0];state.bookings.push({id:'UPLOAD-B1',userId:user.id,storeId:tech.storeId,techId:tech.id,serviceId:tech.serviceIds[0],status:'done',completedAt:state.now-1000,payment:{id:'UPLOAD-P1',status:'success',amountCents:19800,refundedCents:0},extensions:[],refunds:[],disputes:[],createdAt:state.now-3600000});return{state,actor:{role:'user',userId:user.id},payload:{bookingId:'UPLOAD-B1'},current(){return{state:this.state,actor:this.actor};}};}
const image=()=>new File([png],'原图片技术样本.png',{type:'image/png'});
const scopeOptions={assertUserScope(){}};
const file=n=>({ref:'invoice-file:'+String(n).repeat(64),name:`图片${n}.png`,type:'image/png',size:68});
async function upload(f,options={}){return saveCareUpload([image()],'care.case-create',f.payload,{currentContext:()=>f.current(),...options});}
async function create(f){const refs=await upload(f),p={...f.payload,category:'quality',description:'实际文件原案件测试',requestId:'upload-create',evidenceRefs:refs},evidence=await prepareCareEvidence(f.state,f.actor,'care.case-create',p,{currentContext:()=>f.current()});f.state=reduce(f.state,f.actor,'care.case-create',p,()=>{},evidence);return f.state.serviceCareCases.at(-1);}

test('原空正文表单可先选图；权限scope与实际save不创建案件或改原付款',async()=>{
  const f=fixture(),before=structuredClone(f.state),refs=await upload(f);
  assert.equal(refs.length,1);assert.equal((await readInvoiceFile(refs[0])).size,png.length);assert.deepEqual(f.state,before);
  assert.deepEqual(parseCareFormEvidence(JSON.stringify(refs)),refs);
  for(const bad of ['not-json','{}','null','[1]',JSON.stringify([file(1),file(1)])])assert.throws(()=>parseCareFormEvidence(bad));
});
test('实际选择→重新字节核验→原reduce→原精确槽回看，普通和关闭详情保留原图片',async()=>{
  const f=fixture(),c=await create(f),ref=c.evidenceRefs[0].ref;
  assert.equal(f.state.bookings.at(-1).payment.amountCents,19800);assert.equal(f.state.bookings.at(-1).payment.refundedCents,0);
  assert.equal(authorizedInvoiceFile(f.state,f.actor,c.id,'evidence:0',ref,'care').ref,ref);
  assert.match(careUi(f.state,f.actor,['care','case',c.id]),/data-invoice-domain="care"/);
  for(const a of [{role:'user',userId:'u2'},{role:'tech',techId:'zhou'},{role:'store',storeId:'hexi'},{role:'group',job:'finance'}])assert.throws(()=>authorizedInvoiceFile(f.state,a,c.id,'evidence:0',ref,'care'));
  f.state=reduce(f.state,{role:'group',job:'support'},'care.case-respond',{id:c.id,version:c.version,requestId:'upload-response',decision:'respond',publicReply:'技术核实完毕'});
  let live=f.state.serviceCareCases.at(-1);f.state=reduce(f.state,f.actor,'care.case-answer',{id:c.id,version:live.version,decision:'accept',requestId:'upload-answer'});
  f.state=reduce(f.state,f.actor,'privacy.request',{version:0,reason:'技术关闭验证',acknowledged:true,requestId:'upload-close-request'});
  const pc=f.state.privacyClosures.at(-1);f.state=reduce(f.state,{role:'group',job:'support'},'privacy.close',{id:pc.id,version:pc.version,reason:'技术历史材料保留待核',custodian:'技术核查人',acknowledged:true,requestId:'upload-close'});
  assert.equal(authorizedInvoiceFile(f.state,f.actor,c.id,'evidence:0',ref,'care').ref,ref);
  assert.match(closedRightsTransactionsUiView(f.state,f.actor,['care','case',c.id]),/data-invoice-domain="care"/);
  assert.ok(f.state.privacyClosures.at(-1).retention.some(x=>x.kind==='care-evidence'&&x.count===1&&x.status==='pending_review'));
  const changed=structuredClone(f.state);changed.bookings.at(-1).payment.id='REPLACED-P1';assert.throws(()=>authorizedInvoiceFile(changed,f.actor,c.id,'evidence:0',ref,'care'),/原权益|支付/);
});
test('未完成、超期、跨本人、来源串号选择都在存文件之前拒绝',async()=>{
  for(const mutate of [f=>f.state.bookings.at(-1).status='active',f=>f.state.now+=3*86400000,f=>f.actor.userId='u2',f=>f.payload.sourceId='OTHER',f=>f.state.techs.push({...f.state.techs[0]})]){
    const f=fixture();mutate(f);let writes=0;await assert.rejects(upload(f,{saveFile:async()=>{writes++;return file(1);}}));assert.equal(writes,0);
  }
});
test('数量、格式与大小限制先于保存；重复选择不能发布到草稿',async()=>{
  const f=fixture();let writes=0;const options={currentContext:()=>f.current(),saveFile:async()=>{writes++;return file(1);}};
  for(const chosen of [Array(7).fill(image()),[new File(['%PDF'], 'a.pdf',{type:'application/pdf'})],[new File([], 'a.png',{type:'image/png'})]])await assert.rejects(saveCareUpload(chosen,'care.case-create',f.payload,options));
  assert.equal(writes,0);await assert.rejects(saveCareUpload([image(),image()],'care.case-create',f.payload,options),/重复/);assert.equal(writes,2);
});
test('案件总量与原提交不能重复，新剩余数量来自原case而非DOM属性',async()=>{
  const f=fixture(),c=await create(f),p={id:c.id,version:c.version};
  const original=careUploadScope(f.state,f.actor,'care.case-statement',p,scopeOptions);assert.equal(original.available,5);
  await assert.rejects(saveCareUpload([image()],'care.case-statement',p,{currentContext:()=>f.current()}),/不能重复/);
  c.statements.push({id:'TEST-ST',text:'合成边界',at:f.state.now,evidenceRefs:[2,3,4,5,6].map(file)});
  assert.equal(careUploadScope(f.state,f.actor,'care.case-statement',p,scopeOptions).available,0);
  assert.doesNotMatch(careUi(f.state,f.actor,['care','case',c.id]),/data-care-upload /);assert.match(careUi(f.state,f.actor,['care','case',c.id]),/已保存6张/);
});
for(const mutation of ['actor','source','clock'])test('await保存期间'+mutation+'变化拒绝回写选择与提交',async()=>{
  const f=fixture(),before=structuredClone(f.state);
  await assert.rejects(upload(f,{saveFile:async()=>{if(mutation==='actor')f.actor={role:'user',userId:'u2'};else if(mutation==='source')f.state.bookings.at(-1).payment.id='NEW';else f.state.now++;return file(1);}}));
  assert.equal(f.state.serviceCareCases.length,0);assert.deepEqual(f.state.bookings.at(-1).payment.amountCents,before.bookings.at(-1).payment.amountCents);
});
test('保存失败保留原业务，下一次原选择可正常重试',async()=>{
  const f=fixture(),before=structuredClone(f.state);await assert.rejects(upload(f,{saveFile:async()=>{throw new Error('技术存储失败');}}),/存储失败/);assert.deepEqual(f.state,before);assert.equal((await upload(f)).length,1);
});
