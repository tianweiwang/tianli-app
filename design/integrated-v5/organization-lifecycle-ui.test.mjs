import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, createLifecycleContext } from './engine.mjs';
import { organizationLifecyclePanel } from './organization-lifecycle-ui.mjs';
import { lifecycleCompletionView } from './organization-lifecycle.mjs';
import { lifecycleCaseImpact } from './organization-lifecycle-projection.mjs';
import { lifecycleHandoverCommands } from './organization-lifecycle-authority.mjs';
import { lifecyclePauseImpact, lifecyclePauseView } from './organization-lifecycle-pause.mjs';
const ops={role:'group',job:'operations'},user={role:'user',userId:'u1'},store={role:'store',storeId:'xingfu'},MIN=60000;
const decode=v=>v.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const forms=(html,command)=>[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,attrs,body])=>({attrs,body,command:/data-command="([^"]+)"/.exec(attrs)?.[1],payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1]||'{}')),key:decode(/data-management-form="([^"]+)"/.exec(attrs)?.[1]||'')})).filter(f=>!command||f.command===command);
function fixture() {
  let s=seed(),seq=0;
  const h={get s(){return s;},get t(){return s.techs.at(-1);},get c(){return s.organizationLifecycleCases.at(-1);},run(a,type,p={}){let result;s=reduce(s,a,type,{requestId:'lifecycle-ui-'+ ++seq,reason:'隔离实际页面办理',...p},r=>result=r);return result;},page(a=ops,scope={techId:h.t.id}){return organizationLifecyclePanel(s,a,scope);},send(f,p={},a=ops){assert.ok(f,'实际页面应有当前表单');return h.run(a,f.command,{...f.payload,...p});},advance(n=10){h.run(user,'clock.advance',{minutes:n});}};
  h.advance(1);
  h.run(store,'manage.tech-save',{name:'实际页面试点师傅',phone:'13800007831',storeId:'xingfu',gender:'female',lat:31.23,lng:121.47,serviceIds:['neck'],certificate:'UI-PRIVATE-CERTIFICATE',insurance:'UI-PRIVATE-INSURANCE',validUntil:'2027-12-31'});
  h.run(ops,'manage.tech-review',{id:h.t.id,version:h.t.version,decision:'approve'});
  const q=()=>s.techQualifications.find(x=>x.techId===h.t.id&&x.storeId===h.t.storeId&&(!h.t.qualificationProfileId||x.id===h.t.qualificationProfileId));
  const qualify=(type,p,a=store)=>h.run(a,'qualification.'+type,{techId:h.t.id,version:q()?.version||0,...p});
  qualify('assess',{serviceIds:['neck'],batch:'真实页面隔离考核',assessor:'试点考核人',proof:'UI-ASSESS',occurredAt:s.now,result:'pass',kind:'initial'});
  qualify('request',{assessmentId:q().assessments.at(-1).id});qualify('review',{grantId:q().grants.at(-1).id,decision:'approve',reviewer:'实际审核人',proof:'UI-QUALIFY'},ops);
  h.admin=h.run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
  h.members=[];
  h.create=(job,storeId)=>{
    let a=h.run(h.admin,'account.create',{name:'页面真实'+job});
    a=h.run(h.admin,'account.employment',{id:a.id,version:a.version,employmentStatus:'active',reference:'UI-EMP-'+job,verifiedAt:s.now});
    a=h.run(h.admin,'account.grant',{id:a.id,version:a.version,job,...(storeId?{storeId}:{})});
    const g=a.grants.at(-1),actor=h.run(user,'account.enter',{accountId:a.id,grantId:g.id});return {id:a.id,grantId:g.id,job,storeId,actor};
  };
  h.members.push(h.create('support'),h.create('finance'),h.create('store-finance','xingfu'));
  h.operator=h.create('operations');
  h.plan=()=>h.send(forms(h.page(),'lifecycle.transfer-plan')[0],{toStoreId:'silver',targetVersion:s.stores.find(x=>x.id==='silver').version,effectiveAt:s.now+10*MIN,reference:'UI-TRANSFER'},h.operator.actor);
  h.accept=()=>{
    const c=h.c,impact=lifecycleCaseImpact(s,c.id,createLifecycleContext()),stores=new Set([c.fromStoreId,...impact.bookings.map(x=>x.storeId),...Object.values(impact.settlement.groups).flat().map(x=>x.storeId)].filter(Boolean));
    for(const m of h.members)for(const storeId of m.storeId?[m.storeId]:stores){const a=s.staffAccounts.find(x=>x.id===m.id),r=h.run(h.admin,'account.handover',{caseId:c.id,caseVersion:c.version,accountId:a.id,accountVersion:a.version,grantId:m.grantId,storeId,allowedCommands:lifecycleHandoverCommands(m.job),reference:'UI-HANDOVER-'+m.job+'-'+storeId});h.run(m.actor,'account.handover-accept',{id:r.id,version:r.version,reference:'UI-ACCEPT-'+m.job+'-'+storeId});}
  };
  return h;
}

test('原页面实际计划、时钟生效、真实岗位本人承接、完成闭环，并沿版本幂等',()=>{
  const h=fixture();h.plan();assert.equal(h.c.stage,'planned');let html=h.page(h.operator.actor);assert.equal(forms(html,'lifecycle.complete').length,0);assert.equal(forms(html,'lifecycle.cancel-plan').length,1);
  h.advance();html=h.page(h.operator.actor);assert.match(html,/当前阻断原因|本案尚有原事项待办/);assert.equal(forms(html,'lifecycle.complete').length,0);
  h.accept();const before=structuredClone(h.s);html=h.page(h.operator.actor);const f=forms(html,'lifecycle.complete')[0],actual=lifecycleCompletionView(h.s,h.c.id,createLifecycleContext());assert.deepEqual(h.s,before);assert.equal(actual.canComplete,true);
  assert.equal(f.payload.id,h.c.id);assert.equal(f.payload.version,h.c.version);assert.equal(f.payload.sourceToken,actual.sourceToken);assert.match(f.payload.sourceToken,/^sha256:[a-f0-9]{64}$/);assert.match(f.attrs,new RegExp('data-live-version="'+h.c.version+'"'));assert.match(f.body,/name="reason" required/);
  const again=forms(h.page(h.operator.actor),'lifecycle.complete')[0];assert.equal(again.key,f.key);assert.equal(again.payload.sourceToken,f.payload.sourceToken);
  const p={reason:'实际页面完成同案原责任'},result=h.send(f,p,h.operator.actor),snapshot=structuredClone(h.s);assert.equal(result.stage,'completed');assert.deepEqual(h.send(f,p,h.operator.actor),result);assert.deepEqual({...h.s,revision:snapshot.revision},snapshot);assert.equal(h.s.revision,snapshot.revision+1);
  html=h.page(h.operator.actor);assert.match(html,/办理完成/);assert.equal(forms(html,'lifecycle.complete').length,0);
});

test('未结原预约在生效案中显示真实编号和原因，不能用开始办理代替完成',()=>{
  const h=fixture();h.run(user,'booking.create',{storeId:'xingfu',serviceId:'neck',techId:h.t.id,regionId:'home',mode:'specified',genderPreference:'any',startAt:Math.ceil((h.s.now+5*60*MIN)/(30*MIN))*30*MIN,contactName:'实际隔离客户',phone:'13800006591',healthConsent:true,identityVerified:true,adultConfirmed:true});const b=h.s.bookings.at(-1);h.run(user,'booking.pay',{id:b.id,outcome:'success'});h.run({role:'tech',techId:h.t.id},'booking.accept',{id:b.id});h.plan();h.advance();h.accept();
  const html=h.page(h.operator.actor);assert.match(html,new RegExp(b.id));assert.match(html,/原预约尚未完成或取消/);assert.match(html,/由原业务岗位继续办理/);assert.doesNotMatch(html,new RegExp('/group/bookings/'+b.id));assert.match(h.page({role:'group',job:'all'}),new RegExp('/group/bookings/'+b.id));assert.equal(forms(html,'lifecycle.complete').length,0);assert.doesNotMatch(html,/13800006591|实际隔离客户/);
});

test('旧完成表单在真实承接撤权后拒绝，刷新显示当前原原因',()=>{
  const h=fixture();h.plan();h.advance();h.accept();const f=forms(h.page(h.operator.actor),'lifecycle.complete')[0],m=h.members[0],a=h.s.staffAccounts.find(x=>x.id===m.id);h.run(h.admin,'account.revoke',{id:a.id,version:a.version,grantId:m.grantId});const before=structuredClone(h.s);assert.throws(()=>h.send(f,{},h.operator.actor),/来源已变化/);assert.deepEqual(h.s,before);
  const html=h.page(h.operator.actor);assert.equal(forms(html,'lifecycle.complete').length,0);assert.match(html,/承接|授权|来源/);
});

test('账号管理员没有组织业务读取入口，财务客服技师门店不能出现最终办理表单',()=>{
  const h=fixture();h.plan();h.advance();h.accept();assert.throws(()=>h.page(h.admin),/无权读取/);
  for(const a of [{role:'group',job:'finance'},{role:'group',job:'support'},store,{role:'tech',techId:h.t.id}]){const html=h.page(a);assert.equal(forms(html).length,0);assert.doesNotMatch(html,/当前阻断原因|原事项协调与清算|data-command="lifecycle.complete"/);}
});

test('原办理页面只输出opaque指纹和源编号，查询纯只读且反馈不伪装按钮',()=>{
  const h=fixture();h.plan();h.advance();h.accept();const before=structuredClone(h.s),html=h.page(h.operator.actor);assert.deepEqual(h.s,before);assert.doesNotMatch(html,/UI-PRIVATE-CERTIFICATE|UI-PRIVATE-INSURANCE|13800007831|amountCents|priceCents|staffSessions|sessionId|evidenceRefs|sha256:\{ /);assert.match(html,/<p class="notice" role="status">/);assert.match(html,/<button type="submit" class="primary">完成本案办理<\/button>/);assert.doesNotMatch(html,/<button[^>]*>[^<]*(本案尚有|原来源已核齐|办理完成)/);
});

test('本人离职页面要求实际关联来源，管理员原命令补齐后才能实际完成',()=>{
  const h=fixture();h.send(forms(h.page(),'lifecycle.departure-start')[0],{reference:'UI-DEPARTURE'},h.operator.actor);h.accept();let html=h.page(h.operator.actor);assert.equal(forms(html,'lifecycle.complete').length,0);assert.match(html,/本人|映射|关联/);
  h.run(h.admin,'lifecycle.identity-link',{techId:h.t.id,userId:'u2',version:h.t.version,reference:'UI-REAL-OWNER',occurredAt:h.s.now});html=h.page(h.operator.actor);const f=forms(html,'lifecycle.complete')[0];h.send(f,{reason:'实际离职原责任核齐'},h.operator.actor);assert.equal(h.t.lifecycleStatus,'left');assert.equal(h.t.active,false);assert.equal(forms(h.page(h.operator.actor)).length,0);assert.match(h.page(h.operator.actor),/办理完成/);assert.match(h.page(h.operator.actor),/已离职：工作身份及新接单能力已结束/);assert.match(h.page(h.operator.actor),/本人原提成、推广资金和历史权利保留/);assert.doesNotMatch(h.page(h.operator.actor),/data-command="lifecycle\.(transfer-plan|departure-start)"/);
});

test('原案件和阻断文字安全转义，关店页面也采用当前真实完成来源',()=>{
  const h=fixture();const scope={storeId:'xingfu'},f=forms(h.page(h.operator.actor,scope),'lifecycle.store-close-start')[0];h.send(f,{reference:'UI-CLOSE'},h.operator.actor);h.accept();const html=h.page(h.operator.actor,scope),complete=forms(html,'lifecycle.complete')[0];assert.equal(complete.payload.sourceToken,lifecycleCompletionView(h.s,h.c.id,createLifecycleContext()).sourceToken);h.send(complete,{},h.operator.actor);assert.equal(h.s.stores.find(x=>x.id==='xingfu').lifecycleStatus,'closed');assert.equal(forms(h.page(h.operator.actor,scope)).length,0);
  const damaged=structuredClone(h.s);damaged.organizationLifecycleCases[0].effectBlockedReason='<img src=x onerror=alert(1)>';const escaped=organizationLifecyclePanel(damaged,h.operator.actor,scope);assert.match(escaped,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(escaped,/<img src=x/);
});

const storeScope={storeId:'xingfu'},DAY=24*60*MIN;
function pauseFixture(){
  const h=fixture(),x=h.s.stores.find(x=>x.id==='xingfu');
  h.run(ops,'manage.store-save',{...x,contact:'原页面门店负责人',phone:'13800006831',qualification:'UI-STORE-QUAL',merchantNo:'UI-STORE-MERCHANT'});
  h.manager=h.create('store-manager','xingfu');
  h.storePage=a=>h.page(a,storeScope);
  return h;
}

function pauseCoordination(html){
  const body=/<section class="panel management-panel"><h2>停业时段与原预约协调<\/h2>([\s\S]*?)<\/section>/.exec(html)?.[1];
  assert.ok(body,'实际页面保留停业协调区');return body;
}
function confirmedPauseBooking(h,startAt){
  h.run(user,'booking.create',{storeId:'xingfu',serviceId:'neck',techId:h.t.id,regionId:'home',mode:'specified',genderPreference:'any',startAt,contactName:'隔离实际预约客户',phone:'13800006917',healthConsent:true,identityVerified:true,adultConfirmed:true});
  const id=h.s.bookings.at(-1).id;h.run(user,'booking.pay',{id,outcome:'success'});h.run({role:'tech',techId:h.t.id},'booking.accept',{id});return id;
}
function pauseAt(h,startAt,endAt){
  return h.send(forms(h.storePage(h.manager.actor),'lifecycle.store-pause')[0],{startAt,endAt,reference:'UI-COORDINATION-ACTUAL'},h.manager.actor);
}

test('没有未结束停业案的正常在途预约不进入停业协调，通用原事项仍保留',()=>{
  const h=pauseFixture(),startAt=Math.ceil((h.s.now+5*60*MIN)/(30*MIN))*30*MIN,id=confirmedPauseBooking(h,startAt),before=structuredClone(h.s),html=h.storePage(h.operator.actor);
  assert.deepEqual(h.s,before);assert.doesNotMatch(pauseCoordination(html),new RegExp(id));
  assert.match(html,new RegExp(id));
  h.send(forms(html,'lifecycle.store-close-start')[0],{reference:'UI-NORMAL-BOOKING-CLOSE'},h.operator.actor);
  assert.ok(lifecycleCaseImpact(h.s,h.c.id,createLifecycleContext()).bookings.some(b=>b.sourceId===id));assert.equal(forms(h.storePage(h.operator.actor),'lifecycle.complete').length,0);
});

test('原有限停业区间后的两笔已确认预约在计划及实际恢复后均无停业协调误报',()=>{
  const h=pauseFixture(),midnight=Math.floor((h.s.now+8*60*MIN)/DAY)*DAY-8*60*MIN,startAt=midnight+DAY+12*60*MIN,endAt=startAt+DAY;
  const ids=[confirmedPauseBooking(h,endAt+60*MIN),confirmedPauseBooking(h,endAt+3*60*MIN)];pauseAt(h,startAt,endAt);
  for(const id of ids)assert.doesNotMatch(pauseCoordination(h.storePage(h.operator.actor)),new RegExp(id));
  h.advance((startAt-h.s.now)/MIN);assert.equal(h.c.stage,'effective');assert.equal(h.s.stores.find(x=>x.id==='xingfu').active,false);
  h.advance((endAt-h.s.now)/MIN);assert.equal(h.c.stage,'completed');assert.equal(h.s.stores.find(x=>x.id==='xingfu').active,true);
  const before=structuredClone(h.s),html=h.storePage(h.operator.actor);assert.deepEqual(h.s,before);
  for(const id of ids){assert.doesNotMatch(pauseCoordination(html),new RegExp(id));assert.match(html,new RegExp(id));assert.equal(h.s.bookings.find(b=>b.id===id).status,'confirmed');}
});

test('全部未结束计划合并真实跨度并去重，非重叠原预约不被附加协调要求',()=>{
  const h=pauseFixture(),midnight=Math.floor((h.s.now+8*60*MIN)/DAY)*DAY-8*60*MIN,day=midnight+DAY;
  const overlapping=confirmedPauseBooking(h,day+14*60*MIN),second=confirmedPauseBooking(h,day+17*60*MIN),outside=confirmedPauseBooking(h,day+11*60*MIN);
  pauseAt(h,day+14*60*MIN,day+14*60*MIN+30*MIN);pauseAt(h,day+14*60*MIN+30*MIN,day+15*60*MIN);pauseAt(h,day+17*60*MIN,day+18*60*MIN);
  const html=h.storePage(h.operator.actor),body=pauseCoordination(html);
  assert.equal((body.match(new RegExp(overlapping,'g'))||[]).length,1);assert.match(body,new RegExp(second));assert.doesNotMatch(body,new RegExp(outside));
  assert.match(body,/须门店改约并由本人确认/);assert.match(html,new RegExp(outside));
});

test('停业协调保留真实待确认拟安排和已开始原履约，不自行取消或改变资金',()=>{
  const h=pauseFixture(),midnight=Math.floor((h.s.now+8*60*MIN)/DAY)*DAY-8*60*MIN,day=midnight+DAY,id=confirmedPauseBooking(h,day+11*60*MIN);
  h.run(h.manager.actor,'booking.propose-reschedule',{id,startAt:day+13*60*MIN});pauseAt(h,day+13*60*MIN,day+14*60*MIN);
  let body=pauseCoordination(h.storePage(h.operator.actor));assert.match(body,new RegExp(id));assert.match(body,/本人待确认的拟安排/);assert.doesNotMatch(body,new RegExp(new Date(day+11*60*MIN).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})));
  const h2=pauseFixture(),start=Math.ceil((h2.s.now+5*60*MIN)/(30*MIN))*30*MIN,started=confirmedPauseBooking(h2,start);h2.advance((start-h2.s.now)/MIN);h2.run({role:'tech',techId:h2.t.id},'booking.start',{id:started});
  const before=structuredClone(h2.s.bookings.find(b=>b.id===started));h2.send(forms(h2.storePage(h2.operator.actor),'lifecycle.store-pause-emergency')[0],{reference:'UI-STARTED-PAUSE',endAt:h2.s.now+60*MIN},h2.operator.actor);
  body=pauseCoordination(h2.storePage(h2.operator.actor));assert.match(body,new RegExp(started));assert.match(body,/原已开始履约保留/);assert.deepEqual(h2.s.bookings.find(b=>b.id===started),before);
  h2.advance(45);h2.run({role:'tech',techId:h2.t.id},'booking.finish',{id:started,mode:'normal'});assert.equal(h2.s.bookings.find(b=>b.id===started).status,'done');
});

test('本店主管独立canPause表单可实际计划与撤回，不获得组织运营或原清算能力',()=>{
  const h=pauseFixture(),a=h.manager.actor,before=structuredClone(h.s),html=h.storePage(a);
  assert.deepEqual(h.s,before);assert.match(html,/停业时段与原预约协调|至少提前24小时/);
  assert.equal(forms(html,'lifecycle.store-pause').length,1);
  for(const command of ['lifecycle.store-pause-emergency','lifecycle.store-resume','lifecycle.store-close-start','lifecycle.complete'])assert.equal(forms(html,command).length,0);
  assert.doesNotMatch(html,/原事项协调与清算|amountCents|merchantNo|UI-PRIVATE-CERTIFICATE|staffSessions/);
  const f=forms(html,'lifecycle.store-pause')[0],x=h.s.stores.find(x=>x.id==='xingfu');
  assert.equal(f.payload.version,x.version);assert.equal(f.payload.sourceToken,lifecyclePauseImpact(h.s,x.id,{startAt:h.s.now,endAt:null},createLifecycleContext()).sourceToken);
  assert.match(f.body,/name="startAt" type="datetime-local" required/);assert.match(f.body,/name="endAt" type="datetime-local" required/);
  h.send(f,{startAt:h.s.now+DAY,endAt:h.s.now+DAY+60*MIN,reference:'UI-PAUSE-PLAN'},a);
  assert.equal(h.c.stage,'planned');assert.equal(h.s.stores.find(x=>x.id==='xingfu').active,true);
  const cancel=forms(h.storePage(a),'lifecycle.store-pause-cancel')[0];assert.equal(cancel.payload.id,h.c.id);h.send(cancel,{},a);
  assert.equal(h.c.stage,'cancelled');assert.match(h.storePage(a),/计划已撤回/);
});

test('集团紧急暂停表单使用实际现在、可不定结束，恢复只给运营原核验表单',()=>{
  const h=pauseFixture(),html=h.storePage(h.operator.actor),f=forms(html,'lifecycle.store-pause-emergency')[0];
  assert.ok(f);assert.doesNotMatch(f.body,/name="startAt"/);assert.match(f.body,/预计结束时间（未定可空）/);assert.doesNotMatch(f.body,/name="endAt"[^>]*required/);
  h.send(f,{reference:'UI-PAUSE-EMERGENCY'},h.operator.actor);assert.equal(h.c.startAt,h.s.now);assert.equal(h.c.endAt,null);
  const localHtml=h.storePage(h.manager.actor);assert.equal(forms(localHtml).length,0);assert.match(localHtml,/须集团实际核验恢复/);
  const resume=forms(h.storePage(h.operator.actor),'lifecycle.store-resume')[0],view=lifecyclePauseView(h.s,h.c.id,createLifecycleContext());
  assert.equal(resume.payload.sourceToken,view.sourceToken);assert.equal(resume.payload.version,h.c.version);assert.match(resume.body,/name="reference"/);
  h.send(resume,{reference:'UI-PAUSE-EXPLICIT-RESUME'},h.operator.actor);assert.equal(h.c.stage,'completed');assert.equal(h.s.stores.find(x=>x.id==='xingfu').active,true);
  assert.equal(forms(h.storePage(h.operator.actor),'lifecycle.store-resume').length,0);
});

test('资格原暂停后的页面显示当前恢复阻断，不显示财务/证书或伪恢复按钮',()=>{
  const h=pauseFixture();h.send(forms(h.storePage(h.operator.actor),'lifecycle.store-pause-emergency')[0],{reference:'UI-PAUSE-QUAL-HOLD',endAt:h.s.now+60*MIN},h.operator.actor);
  const q=h.s.techQualifications.find(x=>x.techId===h.t.id&&x.storeId==='xingfu');h.run(store,'qualification.pause',{techId:h.t.id,version:q.version,serviceIds:['neck'],owner:'实际复训负责人'});
  const before=structuredClone(h.s),html=h.storePage(h.operator.actor);assert.deepEqual(h.s,before);
  assert.match(html,/恢复营业条件未齐|独立项目资格/);assert.equal(forms(html,'lifecycle.store-resume').length,0);assert.equal(forms(html,'lifecycle.complete').length,0);
  assert.doesNotMatch(html,/UI-PRIVATE-CERTIFICATE|UI-PRIVATE-INSURANCE|UI-STORE-MERCHANT|amountCents|evidenceRefs|sessionId/);
  assert.match(html,/<p class="notice" role="status">/);assert.doesNotMatch(html,/<button[^>]*>[^<]*(恢复营业条件|本案尚有)/);
});

test('停业表单沿真实版本和opaque完整指纹，旧资格来源变化提交拒绝',()=>{
  const h=pauseFixture(),f=forms(h.storePage(h.manager.actor),'lifecycle.store-pause')[0];
  const q=h.s.techQualifications.find(x=>x.techId===h.t.id&&x.storeId==='xingfu');h.run(store,'qualification.pause',{techId:h.t.id,version:q.version,serviceIds:['neck'],owner:'实际复训负责人'});
  const before=structuredClone(h.s);assert.throws(()=>h.send(f,{startAt:h.s.now+DAY,endAt:h.s.now+DAY+60*MIN,reference:'UI-PAUSE-STALE'},h.manager.actor),/来源已变化/);assert.deepEqual(h.s,before);
  const fresh=forms(h.storePage(h.manager.actor),'lifecycle.store-pause')[0];assert.notEqual(fresh.payload.sourceToken,f.payload.sourceToken);assert.equal(fresh.key,f.key);assert.match(fresh.payload.sourceToken,/^sha256:[a-f0-9]{64}$/);
});

test('门店财务和非本店主管没有停业写表单，账号管理员不扩入业务页面',()=>{
  const h=pauseFixture();assert.throws(()=>h.storePage(h.admin),/无权读取/);
  for(const a of [{role:'store',storeId:'xingfu',job:'store-finance'},{role:'store',storeId:'silver',job:'store-manager'},{role:'group',job:'finance'},{role:'group',job:'support'}]){
    const read=()=>h.storePage(a);
    if(a.storeId==='silver'){assert.throws(read,/无权|本店/);continue;}
    const html=read();for(const command of ['lifecycle.store-pause','lifecycle.store-pause-emergency','lifecycle.store-pause-cancel','lifecycle.store-resume'])assert.equal(forms(html,command).length,0);
  }
});

test('上次自动核验显示真实发生时间，当前ready恢复表单不读时改历史且可直接提交',()=>{
  const h=pauseFixture(),a=h.operator.actor;h.send(forms(h.storePage(a),'lifecycle.store-pause-emergency')[0],{reference:'UI-PAUSE-STALE-AUTO',endAt:h.s.now+60*MIN},a);
  h.run(ops,'manage.tech-review',{id:h.t.id,version:h.t.version,decision:'pause'});h.advance(60);
  const blocked=h.c.history.findLast(x=>x.action==='pause-blocked'),storeRow=h.s.stores.find(x=>x.id==='xingfu');
  h.run(ops,'manage.store-save',{...storeRow,merchantNo:'UI-PAUSE-CHANGED-MERCHANT'});
  h.run(ops,'manage.tech-review',{id:h.t.id,version:h.t.version,decision:'approve'});
  const before=structuredClone(h.s),html=h.storePage(a);assert.deepEqual(h.s,before);
  assert.match(html,/上次自动核验：恢复营业条件未齐/);assert.match(html,/核验时间：/);
  const at=new Date(blocked.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});assert.ok(html.includes(at));
  assert.match(html,/当前原营业条件齐全/);const f=forms(html,'lifecycle.store-resume')[0];assert.ok(f);assert.equal(f.payload.version,h.c.version);
  h.send(f,{reference:'UI-REAL-READY-RESUME'},a);assert.equal(h.c.stage,'completed');assert.ok(h.c.history.some(x=>x.action==='pause-blocked'&&x.at===blocked.at));
  assert.doesNotMatch(h.storePage(a),/上次自动核验：恢复营业条件未齐/);
});
