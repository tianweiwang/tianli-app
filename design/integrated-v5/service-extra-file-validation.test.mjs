import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareServiceExtraEvidence } from './service-extra-file-validation.mjs';
import { serviceExtraSourceToken, serviceFinanceExtrasCommand } from './service-finance-extras.mjs';

const group = {role:'group',job:'finance'}, store = {role:'store',job:'store-finance',storeId:'a'}, user = {role:'user',userId:'u1'};
const pdfBytes = Buffer.from('%PDF-1.7\n% Local technical signature fixture, not a tax document\n%%EOF\n');
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64');
function attachment(bytes = pdfBytes,type = 'application/pdf',name = '实际凭证.pdf') {
  const file = {ref:`invoice-file:${createHash('sha256').update(bytes).digest('hex')}`,name,type,size:bytes.length};
  return {file,blob:new Blob([bytes],{type})};
}
function fixture() {
  const first = attachment(), second = attachment(pngBytes,'image/png','实际凭证.png');
  const state = {schema:5,seq:0,now:100000,stores:[{id:'a'},{id:'b'}],users:[{id:'u1'}],bookings:[{id:'B',storeId:'a',userId:'u1',createdAt:100,status:'done',payment:{id:'P',status:'success',amountCents:20000,refundedCents:0,paidAt:200,channelReference:'CH'},extensions:[],refunds:[]}],serviceFinanceEntries:[],serviceExtraEvidence:[{id:'E',storeId:'a',userId:'u1',bookingId:'B',paymentId:'P',version:1,status:'requested',evidenceRefs:[first.file,second.file]}],serviceRefundShortages:[{id:'S',storeId:'a',userId:'u1',bookingId:'B',paymentId:'P',version:2,advances:[{id:'A',path:'direct-user',status:'needs-review',execution:{status:'success',proof:{evidenceRefs:[first.file,second.file]}}}]}],serviceExtraRecoveries:[{id:'D',storeId:'a',bookingId:'B',paymentId:'P',version:1}],serviceExtraOffsets:[{id:'O',storeId:'a',bookingId:'B',paymentId:'P',version:1}],serviceExtraPolicies:[],serviceExtraRequests:[]};
  const blobs = new Map([[first.file.ref,first.blob],[second.file.ref,second.blob]]), calls = [];
  const readFile = async file => {calls.push(structuredClone(file));return blobs.get(file.ref);};
  return {state,first,second,blobs,calls,readFile};
}
const prepare = (f,command,p = {},actor = group,readFile = f.readFile) => prepareServiceExtraEvidence(f.state,actor,`service-extra.${command}`,p,{readFile});

test('普通命令返回空集合，不解析身份或读取文件；未知该域命令拒绝',async () => {
  let calls = 0;
  assert.deepEqual(await prepareServiceExtraEvidence({},null,'booking.refund-query',{}, {readFile(){calls++;}}),{evidenceRefs:[]});
  assert.equal(calls,0);
  await assert.rejects(prepareServiceExtraEvidence({},group,'service-extra.unknown',{}),/未知/);
});
for (const [command,p,actor] of [
  ['evidence-submit',{bookingId:'B',paymentId:'P'},store],['refund-shortage',{bookingId:'B',paymentId:'P'},store],
  ['recharge',{id:'S'},store],['advance-pay',{id:'S',advanceId:'A',outcome:'success'},group],
  ['advance-query',{id:'S',advanceId:'A',outcome:'success'},group],['advance-reconcile',{id:'S',advanceId:'A',action:'return'},group],
  ['recovery-receive',{id:'D'},group],['offset-return',{id:'O'},group]
]) test(`${command}实际凭证路径读取真实Blob，返回精确元数据且不修改原账`,async () => {
  const f = fixture(), before = structuredClone(f.state), result = await prepare(f,command,{...p,file:f.first.file},actor);
  assert.deepEqual(result,{evidenceRefs:[f.first.file]});
  assert.deepEqual(f.calls,[f.first.file]);
  assert.deepEqual(f.state,before);
  result.evidenceRefs[0].name = '外部修改'; assert.equal(f.first.file.name,'实际凭证.pdf');
});
test('JSON数组和数字大小沿原表单规范化，PDF和PNG均实读',async () => {
  const f = fixture(), refs = [f.first.file,{...f.second.file,size:String(f.second.file.size)}];
  const result = await prepare(f,'evidence-submit',{bookingId:'B',paymentId:'P',evidenceRefs:JSON.stringify(refs)},store);
  assert.deepEqual(result.evidenceRefs,[f.first.file,f.second.file]); assert.equal(f.calls.length,2);
});
test('JPEG实际Blob核对文件头尾、类型、大小与SHA-256，不冒称图片渲染验收',async () => {
  const f = fixture(), item = attachment(Buffer.from([255,216,255,224,0,2,255,217]),'image/jpeg','JPEG边界技术样本.jpg');
  f.blobs.set(item.file.ref,item.blob);
  assert.deepEqual(await prepare(f,'recharge',{id:'S',file:item.file},store),{evidenceRefs:[item.file]});
});
test('完全相同引用只实读一次，同ref不同名称/类型/大小拒绝且不先读文件',async () => {
  const f = fixture(), result = await prepare(f,'recharge',{id:'S',evidenceRefs:[f.first.file,{...f.first.file}]},store);
  assert.deepEqual(result.evidenceRefs,[f.first.file]); assert.equal(f.calls.length,1);
  for (const change of [{name:'别的名称.pdf'},{type:'image/png'},{size:f.first.file.size+1}]) {
    const c = fixture(); await assert.rejects(prepare(c,'recharge',{id:'S',evidenceRefs:[c.first.file,{...c.first.file,...change}]},store),/冲突/);assert.equal(c.calls.length,0);
  }
});
test('旧依据批准只读取原授权evidence槽所有附件，payload伪文件不能替代',async () => {
  const f = fixture(), result = await prepare(f,'evidence-review',{id:'E',decision:'approve',file:{...f.first.file,ref:`invoice-file:${'f'.repeat(64)}`},validateEvidence:true});
  assert.deepEqual(result.evidenceRefs,[f.first.file,f.second.file]);assert.deepEqual(f.calls,[f.first.file,f.second.file]);
});
test('原直接款结清只读取不足事项原advance槽全部凭证',async () => {
  const f = fixture(), result = await prepare(f,'advance-reconcile',{id:'S',advanceId:'A',action:'confirm-refund',evidenceRefs:'假的新列表'});
  assert.deepEqual(result.evidenceRefs,[f.first.file,f.second.file]);assert.equal(f.calls.length,2);
});
test('旧依据批准缺任何原文件整笔拒绝，不用payload新文件补过',async () => {
  const f = fixture();f.blobs.delete(f.second.file.ref);
  await assert.rejects(prepare(f,'evidence-review',{id:'E',decision:'approve',file:f.first.file}),/不存在|不是文件/);
  assert.equal(f.state.serviceExtraEvidence[0].status,'requested');assert.equal(f.calls.length,2);
});
test('旧成功直接款结清缺原附件拒绝，商户补余额路径不能冒充原直接款',async () => {
  const f = fixture();f.blobs.delete(f.first.file.ref);
  await assert.rejects(prepare(f,'advance-reconcile',{id:'S',advanceId:'A',action:'confirm-refund',file:f.second.file}),/不存在|不是文件/);
  const c = fixture();c.state.serviceRefundShortages[0].advances[0].path = 'merchant-balance';
  await assert.rejects(prepare(c,'advance-reconcile',{id:'S',advanceId:'A',action:'confirm-refund'}),/直接款/);assert.equal(c.calls.length,0);
});
test('无岗位、他店财务、他人本人确认、不存在支付在实读之前拒绝',async () => {
  for (const [command,p,actor] of [
    ['recharge',{id:'S'},group],['evidence-review',{id:'E',decision:'approve'},store],
    ['recharge',{id:'S'},{...store,storeId:'b'}],['refund-shortage',{bookingId:'B',paymentId:'P'},{role:'group',job:'support'}],
    ['advance-confirm',{id:'S'},{...user,userId:'u2'}],['evidence-submit',{bookingId:'B',paymentId:'missing'},store]
  ]) {const f=fixture();await assert.rejects(prepare(f,command,{...p,file:f.first.file},actor),/无权|不存在/);assert.equal(f.calls.length,0);}
});
test('篡改不足事项、债务、追收的原门店/本人绑定不能读文件',async () => {
  for (const [key,command,id] of [['serviceRefundShortages','recharge','S'],['serviceExtraRecoveries','recovery-receive','D'],['serviceExtraOffsets','offset-return','O']]) {
    const f=fixture();f.state[key][0].storeId='b';
    await assert.rejects(prepare(f,command,{id,file:f.first.file},command==='recharge'?{...store,storeId:'b'}:group),/来源/);assert.equal(f.calls.length,0);
  }
  const f=fixture();f.state.serviceRefundShortages[0].userId='u2';
  await assert.rejects(prepare(f,'advance-confirm',{id:'S'},{role:'user',userId:'u2'}),/来源/);assert.equal(f.calls.length,0);
});
function session(f,job='finance',role='group',storeId=null) {
  f.state.staffAccounts=[{id:'ACC',enabled:true,version:1,name:'已授权财务',grants:[{id:'GR',enabled:true,role,job,storeId}]}];
  f.state.staffSessions=[{id:'SS',accountId:'ACC',grantId:'GR',accountVersion:1,revokedAt:null}];
  return {sessionId:'SS',role:'group',job:'finance'};
}
test('真实会话岗位由原授权重新解析，不接受payload或传入身份抬升',async () => {
  const f=fixture(),actor=session(f,'support');
  await assert.rejects(prepare(f,'evidence-review',{id:'E',decision:'approve'},actor),/岗位无权/);assert.equal(f.calls.length,0);
  const c=fixture(),active=session(c);c.state.staffSessions[0].revokedAt=c.state.now;
  await assert.rejects(prepare(c,'evidence-review',{id:'E',decision:'approve'},active),/失效/);assert.equal(c.calls.length,0);
});
test('读取中撤销工作会话立即失败，不返回已读成功集合',async () => {
  const f=fixture(),actor=session(f);
  await assert.rejects(prepare(f,'evidence-review',{id:'E',decision:'approve'},actor,async file=>{f.calls.push(file);f.state.staffSessions[0].revokedAt=f.state.now;return f.blobs.get(file.ref);}),/失效/);
  assert.equal(f.calls.length,1);
});
test('异步返回时原授权槽文件名或记录版本改变拒绝',async () => {
  for (const modify of [f=>f.state.serviceExtraEvidence[0].evidenceRefs[0].name='改名.pdf',f=>f.state.serviceExtraEvidence[0].version++]) {
    const f=fixture();await assert.rejects(prepare(f,'evidence-review',{id:'E',decision:'approve'},group,async file=>{f.calls.push(file);modify(f);return f.blobs.get(file.ref);}),/变化/);assert.equal(f.calls.length,1);
  }
});
test('读取中原支付/本人来源改变不返回预校验成功',async () => {
  const f=fixture();await assert.rejects(prepare(f,'recharge',{id:'S',file:f.first.file},store,async file=>{f.state.bookings[0].payment.status='processing';return f.blobs.get(file.ref);}),/变化/);
});
test('缺读取适配、缺Blob和普通对象伪文件都拒绝，不能信validateEvidence标记',async () => {
  const f=fixture(),p={id:'S',file:f.first.file,validateEvidence:true,evidenceValidated:true};
  await assert.rejects(prepareServiceExtraEvidence(f.state,store,'service-extra.recharge',p),/尚未接入/);
  for (const result of [undefined,null,{size:f.first.file.size,type:f.first.file.type,arrayBuffer:async()=>pdfBytes.buffer}]) await assert.rejects(prepare(f,'recharge',p,store,async()=>result),/不存在|不是文件/);
});
test('实际Blob大小/类型不同拒绝；同大小不同字节仍按摘要拒绝',async () => {
  const f=fixture(),p={id:'S',file:f.first.file};
  await assert.rejects(prepare(f,'recharge',p,store,async()=>new Blob([pdfBytes],{type:'image/png'})),/不一致/);
  await assert.rejects(prepare(f,'recharge',p,store,async()=>new Blob([pdfBytes,'x'],{type:'application/pdf'})),/不一致/);
  const changed=Buffer.from(pdfBytes);changed[15]^=1;
  await assert.rejects(prepare(f,'recharge',p,store,async()=>new Blob([changed],{type:'application/pdf'})),/引用不一致/);
});
test('哈希真实但格式伪造的Blob不能登记为PDF或图片',async () => {
  for (const type of ['application/pdf','image/png','image/jpeg']) {
    const f=fixture(),item=attachment(Buffer.from('plain-text'),type,'伪造格式');
    await assert.rejects(prepare(f,'recharge',{id:'S',file:item.file},store,async()=>item.blob),/格式不符/);
  }
});
test('引用、mime、名称、大小、JSON及数量边界在读前校验',async () => {
  const f=fixture();
  for (const item of [null,{...f.first.file,ref:'https://example.com/file'},{...f.first.file,type:'text/plain'},{...f.first.file,name:''},{...f.first.file,name:'x'.repeat(256)},{...f.first.file,size:true},{...f.first.file,size:0},{...f.first.file,size:5*1024*1024+1},{...f.first.file,size:1.5}]) {
    await assert.rejects(prepare(f,'recharge',{id:'S',evidenceRefs:[item]},store),/证据|大小/);
  }
  for(const refs of ['bad-json',[],Array(11).fill(f.first.file),{}]) await assert.rejects(prepare(f,'recharge',{id:'S',evidenceRefs:refs},store),/附件/);
  assert.equal(f.calls.length,0);
});
test('读取异常原样拒绝，辅助层不改原账本且不伪造成功',async () => {
  const f=fixture(),before=structuredClone(f.state);
  await assert.rejects(prepare(f,'recharge',{id:'S',file:f.first.file},store,async()=>{throw new Error('IndexedDB附件缺失');}),/附件缺失/);
  assert.deepEqual(f.state,before);
});
test('本人确认、拒绝、未知/失败、配置/方案/跟进都不读内部附件',async () => {
  for(const [command,p,actor] of [
    ['advance-confirm',{id:'S',advanceId:'A',decision:'accept'},user],['evidence-review',{id:'E',decision:'reject'},group],
    ['advance-pay',{id:'S',advanceId:'A',outcome:'processing'},group],['advance-query',{id:'S',advanceId:'A',outcome:'failed'},group],
    ['advance-reconcile',{id:'S',advanceId:'A',action:'note'},group],['policy-publish',{},group],
    ['advance-decision',{id:'S',decision:'defer'},group],['advance-cancel',{id:'S',advanceId:'A'},group],
    ['offset-propose',{entryId:'F'},group],['offset-confirm',{id:'O'},store],['offset-cancel',{id:'O'},group],
    ['offset-pay',{id:'O',outcome:'success'},group],['offset-query',{id:'O',outcome:'success'},group]
  ]) {
    const f=fixture();f.state.serviceFinanceEntries.push({id:'F',bookingId:'B',paymentId:'P',storeId:'a'});
    assert.deepEqual(await prepare(f,command,{...p,file:f.first.file,evidenceRefs:'不应读取'},actor),{evidenceRefs:[]});assert.equal(f.calls.length,0);
  }
});
test('本次实际回读集合可精确接原领域proof，伪元数据不可借永久true通过',async () => {
  const f=fixture(),p={bookingId:'B',paymentId:'P',version:0,requestId:'actual-file-submit',kind:'payment',sourceVersion:0,sourceToken:serviceExtraSourceToken(f.state,'B','P'),payload:{amountCents:20000,paidAt:200,channelReference:'CH'},reference:'CH',occurredAt:200,reason:'核对原成功付款',file:f.first.file};
  f.state.serviceExtraEvidence=[];
  const runtime=await prepare(f,'evidence-submit',p,store),ctx={validateEvidenceRefs:rows=>rows.every(row=>runtime.evidenceRefs.some(verified=>JSON.stringify(row)===JSON.stringify(verified)))};
  const result=serviceFinanceExtrasCommand(f.state,store,'service-extra.evidence-submit',p,ctx);
  assert.equal(result.status,'requested');assert.deepEqual(result.evidenceRefs,runtime.evidenceRefs);
  const c=fixture();c.state.serviceExtraEvidence=[];
  const bad={...p,sourceToken:serviceExtraSourceToken(c.state,'B','P'),file:{...f.first.file,name:'伪改名.pdf'}};
  assert.throws(()=>serviceFinanceExtrasCommand(c.state,store,'service-extra.evidence-submit',bad,ctx),/不存在|核验/);assert.equal(c.state.serviceExtraEvidence.length,0);
});
