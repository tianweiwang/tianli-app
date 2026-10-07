import test from 'node:test';
import assert from 'node:assert/strict';
import { careCommand, careView, careEvidenceFile, careEvidenceRefs } from './service-care.mjs';

const NOW = Date.parse('2026-10-04T12:00:00+08:00');
const user = {role:'user',userId:'u1'}, tech = {role:'tech',techId:'t1'};
const scope = {assertUserScope(){}};
const photo = n => ({ref:'invoice-file:'+String(n).repeat(64),name:`技术图片${n}.png`,type:'image/png',size:68});
function fixture() {
  let s = {now:NOW,seq:0,users:[{id:'u1'},{id:'u2'}],stores:[{id:'s1'},{id:'s2'}],techs:[{id:'t1',storeId:'s1'},{id:'t2',storeId:'s2'}],bookings:[{id:'B1',userId:'u1',storeId:'s1',techId:'t1',status:'done',completedAt:NOW-1000,payment:{id:'P1',status:'success',amountCents:19800,refundedCents:0},extensions:[],refunds:[],disputes:[]}],logs:[],safety:[]};
  let request = 0;
  const run = (type,p,a=user,verified=[]) => {
    const next = structuredClone(s);
    const result = careCommand(next,a,type,{requestId:'unit-'+(++request),...p},{id:prefix=>prefix+(++next.seq),fail:m=>{throw Error(m);},log(){},validateEvidenceRefs:refs=>refs.every(r=>verified.some(f=>['ref','name','type','size'].every(k=>r[k]===f[k])))});
    s=next; return result;
  };
  return {get s(){return s;},get c(){return s.serviceCareCases.at(-1);},run,
    create(files=[],extra={},a=user,verified=files){return run('care.case-create',{bookingId:'B1',category:'quality',description:'隔离原反馈技术测试',evidenceRefs:files,...extra},a,verified);},
    append(files=[],extra={},a=user,verified=files){return run('care.case-statement',{id:this.c.id,version:this.c.version,text:'隔离原补充说明',evidenceRefs:files,...extra},a,verified);}};
}
function registered(s,job,storeId) {
  const n=(s.staffAccounts || []).length+1, accountId='A'+n,grantId='G'+n,sessionId='S'+n,role=storeId?'store':'group';
  (s.staffAccounts ??=[]).push({id:accountId,name:'技术工作账号',enabled:true,version:1,grants:[{id:grantId,job,role,storeId,enabled:true}]});
  (s.staffSessions ??=[]).push({id:sessionId,accountId,grantId,accountVersion:1,expiresAt:NOW+86400000});
  return {sessionId};
}

test('旧文字新案及补充兼容，读取不初始化图片或改变原预约资金',()=>{
  const f=fixture(),before=structuredClone(f.s.bookings); f.create([], {evidence:'原文字编号'}); f.append();
  assert.equal(f.c.evidenceRefs,undefined); assert.equal(f.c.statements[0].evidenceRefs,undefined);
  const snapshot=structuredClone(f.s); assert.deepEqual(careView(f.s,user).cases[0].evidenceRefs,[]); assert.deepEqual(f.s,snapshot); assert.deepEqual(f.s.bookings,before);
});
test('最多6张初始图片保留真实原作者时间，视图和getter脱离原资料',()=>{
  const f=fixture(),files=[1,2,3,4,5,6].map(photo),before=structuredClone(f.s.bookings); f.create(files);
  assert.deepEqual(f.c.evidenceRefs,files); assert.equal(f.c.createdBy.id,'u1'); assert.equal(f.c.createdAt,NOW);
  const file=careEvidenceFile(f.s,user,f.c.id,'evidence:0',scope); assert.ok(file.sourceToken); file.name='外部变更';
  const view=careView(f.s,user); view.cases[0].evidenceRefs[0].name='视图变更'; assert.equal(f.c.evidenceRefs[0].name,files[0].name); assert.deepEqual(f.s.bookings,before);
});
test('原本人和本单技师补充追加独立槽，原图片及原事实不替换',()=>{
  const f=fixture(); f.create([photo(1)]); f.append([photo(2)]); f.append([photo(3)],{},tech);
  assert.deepEqual(f.c.evidenceRefs,[photo(1)]); assert.equal(f.c.statements.length,2);
  for(const [index,a] of [[0,user],[1,tech]]){const x=f.c.statements[index];assert.ok(x.requestId);assert.equal(x.by.role,a.role);assert.deepEqual(careEvidenceRefs([careEvidenceFile(f.s,a,f.c.id,`statement:${x.id}:0`,scope)]),[photo(index+2)]);}
  assert.equal(f.s.bookings[0].payment.refundedCents,0);
});
test('第7张、重复图片与原图片改名不能借补充替换，原记录保持',()=>{
  const f=fixture(); f.create([1,2,3,4,5,6].map(photo));const before=structuredClone(f.s);
  assert.throws(()=>f.append([photo(7)]),/合计最多6/);assert.deepEqual(f.s,before);
  const g=fixture();g.create([photo(1)]);assert.throws(()=>g.append([{...photo(1),name:'改名.png'}]),/不能重复或替换/);
});
test('实际运行证据必须精确匹配；载荷已核标记、缺适配及不同元数据拒绝',()=>{
  const f=fixture();assert.throws(()=>f.create([photo(1)],{verified:true,evidenceVerified:true},user,[]),/真实文件核验/);
  assert.throws(()=>f.create([photo(1)],{},user,[{...photo(1),size:69}]),/真实文件核验/);
  const s=fixture().s;assert.throws(()=>careCommand(s,user,'care.case-create',{requestId:'no-adapter',bookingId:'B1',category:'quality',description:'技术样本',evidenceRefs:[photo(1)]},{id:()=> 'SC1'}),/真实文件核验/);
});
test('元数据拒绝非数组、空/超限字节、PDF/WebP、伪ref和非法文件名',()=>{
  for(const input of [null,'[]',{},[...Array(7)].map((_,i)=>photo(i+1)),[{...photo(1),size:0}],[{...photo(1),size:5*1024*1024+1}],[{...photo(1),size:'68'}],[{...photo(1),size:true}],[{...photo(1),type:'application/pdf'}],[{...photo(1),type:'image/webp'}],[{...photo(1),ref:'media:abc'}],[{...photo(1),name:'../a.png'}],[photo(1),photo(1)]])assert.throws(()=>careEvidenceRefs(input));
  assert.deepEqual(careEvidenceRefs([{...photo(1),owner:'伪作者'}]),[photo(1)]);
  assert.equal(careEvidenceRefs([{...photo(1),name:'技术.jpg',type:'image/jpeg'}])[0].type,'image/jpeg');
});
test('稳定原请求重放不追加图片；不同载荷仍拒绝复用requestId',()=>{
  const f=fixture();f.create([photo(1)],{requestId:'once'});f.create([photo(1)],{requestId:'once'},user,[]);assert.equal(f.s.serviceCareCases.length,1);
  assert.throws(()=>f.create([{...photo(1),name:'改.png'}],{requestId:'once'}),/同一提交/);
  const p={id:f.c.id,version:f.c.version,text:'技术补充',evidenceRefs:[photo(2)],requestId:'append-once'};
  f.run('care.case-statement',p,user,[photo(2)]);f.run('care.case-statement',p,user,[]);assert.equal(f.c.statements.length,1);
});
test('原补充角色和终态守卫保留，不从工作人员上传旁路追加',()=>{
  const f=fixture();f.create([photo(1)]);
  for(const a of [{role:'user',userId:'u2'},{role:'tech',techId:'t2'},{role:'store',storeId:'s1'},{role:'group',job:'support'}])assert.throws(()=>f.append([photo(2)],{},a));
  f.c.status='closed';assert.throws(()=>f.append([photo(2)]),/已结束/);
  assert.throws(()=>f.run('care.case-note',{id:f.c.id,version:f.c.version,text:'技术说明',evidenceRefs:[photo(2)]},{role:'store',storeId:'s1'},[photo(2)]),/图片仅可/);
});
test('案件查看拒跨用户/店/技师和财务，有效原客服/本店账号可读取',()=>{
  const f=fixture();f.create([photo(1)]);const id=f.c.id;
  for(const a of [{role:'user',userId:'u2'},{role:'tech',techId:'t2'},{role:'store',storeId:'s2'},{role:'group',job:'finance'},{role:'group',job:'operations'}])assert.throws(()=>careEvidenceFile(f.s,a,id,'evidence:0',scope));
  for(const a of [tech,registered(f.s,'support'),registered(f.s,'store-manager','s1')])assert.equal(careEvidenceFile(f.s,a,id,'evidence:0').ref,photo(1).ref);
  const bad=registered(f.s,'finance');assert.throws(()=>careEvidenceFile(f.s,bad,id,'evidence:0'));
  f.s.staffSessions.at(-1).revokedAt=NOW;assert.throws(()=>careEvidenceFile(f.s,bad,id,'evidence:0'),/失效/);
});
test('user必须接同步原scope回调，关闭scope拒绝和异步回调不能放行',()=>{
  const f=fixture();f.create([photo(1)]);assert.throws(()=>careEvidenceFile(f.s,user,f.c.id,'evidence:0'),/范围核验尚未接入/);
  let called;careEvidenceFile(f.s,user,f.c.id,'evidence:0',{assertUserScope:(s,a,kind,id)=>{called=[s===f.s,a.userId,kind,id];}});assert.deepEqual(called,[true,'u1','care-case',f.c.id]);
  assert.throws(()=>careEvidenceFile(f.s,user,f.c.id,'evidence:0',{assertUserScope(){throw Error('原关闭依据拒绝');}}),/原关闭依据/);
  assert.throws(()=>careEvidenceFile(f.s,user,f.c.id,'evidence:0',{assertUserScope:()=>false}),/范围核验拒绝/);
  assert.throws(()=>careEvidenceFile(f.s,user,f.c.id,'evidence:0',{assertUserScope:async()=>{}}),/必须同步/);
});
test('精确slot及当前来源token拒串号/重复源，原版本及元数据变化可检测',()=>{
  const f=fixture();f.create([photo(1)]);const token=()=>careEvidenceFile(f.s,user,f.c.id,'evidence:0',scope).sourceToken,first=token();
  f.c.version++;assert.notEqual(token(),first);const next=token();f.c.evidenceRefs[0].name='新技术名.png';assert.notEqual(token(),next);
  for(const slot of ['evidence:00','evidence:-1','evidence:1','evidence:0:extra','statement:missing:0'])assert.throws(()=>careEvidenceFile(f.s,user,f.c.id,slot,scope));
  f.c.userId='u2';assert.throws(()=>careEvidenceFile(f.s,user,f.c.id,'evidence:0',scope),/来源不一致/);
  const g=fixture();g.create([photo(1)]);g.s.bookings.push(structuredClone(g.s.bookings[0]));assert.throws(()=>careEvidenceFile(g.s,user,g.c.id,'evidence:0',scope),/不唯一/);
});
