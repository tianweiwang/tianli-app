import test from 'node:test';
import assert from 'node:assert/strict';
import { qualificationUiView, qualificationTechPanel, qualificationCarePanel } from './qualification-ui.mjs';
import { upgradeQualifications, qualificationCommand, qualificationView, qualificationEligibility } from './tech-qualification.mjs';

const NOW=Date.parse('2026-10-03T14:00:00+08:00'),HOUR=3600000;
const store={role:'store',storeId:'s1'},manager={role:'manager',storeId:'s1'},ops={role:'group',job:'operations'},support={role:'group',job:'support'},tech={role:'tech',techId:'t1'};
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function forms(html,command) {return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,attrs,body])=>({attrs,body,command:/data-command="([^"]+)"/.exec(attrs)?.[1],payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1] || '{}')),key:decode(/data-management-form="([^"]+)"/.exec(attrs)?.[1] || '')})).filter(x=>!command||x.command===command);}
function fixture({legacy=false}={}) {
  let s={schema:5,seq:0,now:NOW,services:[{id:'relax',name:'舒缓放松',active:true},{id:'neck',name:'肩颈护理',active:true}],stores:[{id:'s1',name:'幸福里门店',serviceIds:['relax','neck']},{id:'s2',name:'银杏门店',serviceIds:['relax','neck']}],techs:[{id:'t1',name:'林师傅',storeId:'s1',serviceIds:['relax','neck'],reviewStatus:'approved',active:true,certificate:'CERT-1',insurance:'INS-1',validUntil:'2027-12-31',qualificationRequired:!legacy},{id:'t2',name:'王师傅',storeId:'s2',serviceIds:['relax'],reviewStatus:'approved',active:true,certificate:'CERT-2',insurance:'INS-2',validUntil:'2027-12-31',qualificationRequired:true}],bookings:[],serviceCareCases:[]};upgradeQualifications(s);let req=0;
  const ctx=state=>({id:prefix=>prefix+(++state.seq),fail:message=>{throw Error(message);},log:()=>{}});
  const run=(command,payload,actor=store)=>{const next=structuredClone(s);qualificationCommand(next,actor,command,{requestId:'qualification-ui-'+(++req),...payload},ctx(next));s=next;};
  const page=(actor=store,id='t1',query='')=>qualificationUiView(s,actor,['qualifications',...(id?[id]:[])],{query:new URLSearchParams(query)});
  const send=(form,fields={},actor=store)=>{assert.ok(form,'expected actionable form');run(form.command,{...form.payload,...fields},actor);};
  return {get s(){return s;},get profile(){return s.techQualifications[0];},get t(){return s.techs[0];},get hold(){return this.profile.holds.at(-1);},page,run,send,
    assess(extra={},actor=store){const form=forms(page(actor),'qualification.assess').find(f=>!f.payload.holdId);send(form,{kind:'initial',serviceIds:['relax'],batch:'DEMO-Q1',assessor:'实际考核陈老师',occurredAt:'2026-10-03T13:00',result:'pass',proof:'ASSESS-SECRET-1',reason:'实际完成项目考核-SECRET',...extra},actor);return this.profile.assessments.at(-1);},
    request(assessmentId=this.profile.assessments.at(-1).id,actor=store){const form=forms(page(actor),'qualification.request').find(f=>f.payload.assessmentId===assessmentId);send(form,{reason:'已核对考核原件，申请相应项目授权'},actor);return this.profile.grants.at(-1);},
    review(grantId=this.profile.grants.at(-1).id,extra={}){const form=forms(page(ops),'qualification.review').find(f=>f.payload.grantId===grantId);send(form,{decision:'approve',reviewer:'集团审核王老师',proof:'AUTH-SECRET-1',reason:'授权审核依据-SECRET',...extra},ops);},
    authorize(){this.assess();this.request();this.review();},
    pause(extra={},actor=store,query=''){const form=forms(page(actor,'t1',query),'qualification.pause')[0];send(form,{serviceIds:['relax'],owner:'陈经理',reason:'暂停核实依据-SECRET',...extra},actor);return this.hold;},
    retrain(holdId=this.hold.id,extra={}){const form=forms(page(store),'qualification.assess').find(f=>f.payload.holdId===holdId);send(form,{batch:'DEMO-RETRAIN-1',assessor:'复训考核陈老师',occurredAt:'2026-10-03T14:00',result:'pass',proof:'RETRAIN-SECRET-1',reason:'已经完成专项复训-SECRET',...extra});return this.profile.assessments.at(-1);},
    resume(holdId=this.hold.id){const form=forms(page(ops),'qualification.resume').find(f=>f.payload.holdId===holdId);send(form,{reviewer:'集团恢复核验王老师',reason:'已核验复训授权及全部影响事项'},ops);},
    advance(hours){s.now+=hours*HOUR;},
    addCase(kind='restriction'){const b={id:'B-DONE',techId:'t1',storeId:'s1',serviceId:'relax',status:'done',startAt:NOW-HOUR,completedAt:NOW};s.bookings.push(b);const c={id:'SC1',version:3,techId:'t1',storeId:'s1',bookingId:b.id,status:'execution_pending',specialistActions:[{kind,status:'pending',reason:'SOURCE-INTERNAL'}],history:[]};s.serviceCareCases.push(c);return c;}
  };
}

test('qualification只接自身路径，各门店技师与集团岗位深链隔离',()=>{
  const f=fixture();assert.equal(qualificationUiView(f.s,store,['care']),null);assert.match(f.page(store,'t1',''),/独立服务准入/);
  for(const actor of [{role:'user',userId:'u1'},{role:'group',job:'finance'},{role:'group',job:'warehouse'}]) {assert.match(f.page(actor),/无权/);assert.equal(qualificationTechPanel(f.s,actor,f.t),'');}
  for(const actor of [{role:'store',storeId:'s2'},{role:'manager',storeId:'s2'},{role:'tech',techId:'t2'}]) {assert.match(f.page(actor),/不存在或无权/);assert.equal(qualificationTechPanel(f.s,actor,f.t),'');}
  assert.match(f.page(manager),/登记实际考核/);assert.match(f.page(tech),/暂无实际资格处理历史/);assert.match(qualificationUiView(f.s,store,['qualifications','t1','extra']),/页面不存在/);
});

test('新人员没有独立授权，旧演示资格明确待补录且首次记录要求确认',()=>{
  const fresh=fixture(),legacy=fixture({legacy:true});assert.match(fresh.page(),/项目资格暂不可用/);assert.doesNotMatch(fresh.page(),/历史演示资格，待补录/);assert.match(qualificationTechPanel(fresh.s,store,fresh.t),/暂无有效项目资格/);
  assert.match(legacy.page(),/历史演示资格，待补录/);assert.match(legacy.page(),/首次补录即建立正式资格档案/);assert.match(legacy.page(),/不能作为正式准入验收/);legacy.assess();assert.equal(qualificationEligibility(legacy.s,'t1','relax').allowed,false);assert.equal(qualificationEligibility(legacy.s,'t1','neck').allowed,false);assert.doesNotMatch(legacy.page(),/历史演示资格，待补录/);
});

test('实际表单贯通考核申请集团审核，资料审核不被项目授权代替',()=>{
  const f=fixture(),before=f.page(),form=forms(before,'qualification.assess')[0];assert.equal(form.payload.version,0);assert.match(form.attrs,/data-live-version="0"/);assert.match(form.attrs,/data-confirm="/);assert.match(form.attrs,/data-next="\/store\/qualifications\/t1"/);assert.match(form.key,/qualification:store:::s1::t1:qualification.assess:initial/);assert.match(form.body,/name="serviceIds"/);assert.match(form.body,/name="occurredAt"[^>]*required/);assert.match(before,/本地记录编号不代表已上传/);assert.match(form.body,/<input type="file"[^>]*multiple data-qualification-upload>/);assert.match(form.body,/<input type="hidden" name="evidenceRefs" value="\[\]">/);assert.match(form.body,/data-qualification-upload-status role="status"/);
  f.assess();assert.equal(f.profile.assessments[0].occurredAt,NOW-HOUR);assert.equal(qualificationEligibility(f.s,'t1','relax').allowed,false);f.request();assert.equal(f.profile.grants[0].status,'pending');assert.equal(forms(f.page(),'qualification.review').length,0);f.review();assert.equal(f.profile.grants[0].status,'approved');assert.equal(qualificationEligibility(f.s,'t1','relax').allowed,true);assert.equal(qualificationEligibility(f.s,'t1','neck').allowed,false);assert.match(f.page(),/项目授权有效/);assert.match(f.page(),/还须满足证书保单、在岗及排班/);
});

test('未通过考核无授权按钮，驳回后保留旧申请且需实际新考核',()=>{
  const f=fixture();f.assess({result:'fail'});assert.equal(forms(f.page(),'qualification.request').length,0);f.assess({kind:'mature'});f.request();f.review(undefined,{decision:'reject'});assert.match(f.page(),/授权未通过/);assert.equal(forms(f.page(),'qualification.request').length,0);assert.equal(forms(f.page(ops),'qualification.review').length,0);f.assess({kind:'mature',proof:'NEW-CHECK'});assert.equal(forms(f.page(),'qualification.request').length,1);assert.equal(f.profile.grants.length,1);
});

test('集团客服只能质量暂停，技师只读且不泄露内部凭据与受影响用户预约',()=>{
  const f=fixture();f.authorize();f.s.bookings.push({id:'B-INTERNAL',techId:'t1',storeId:'s1',serviceId:'relax',status:'confirmed',startAt:NOW+HOUR});f.pause();f.retrain();
  const html=f.page(tech);assert.equal(forms(html).filter(x=>x.command.startsWith('qualification.')).length,0);assert.doesNotMatch(html,/SECRET|B-INTERNAL|陈经理|实际考核陈老师|集团审核王老师|暂停核实依据/);assert.match(html,/关联暂停复训/);assert.match(html,/暂停中/);
  const supportPage=f.page(support);assert.equal(forms(supportPage,'qualification.pause').length,1);for(const c of ['assess','request','review','resume'])assert.equal(forms(supportPage,'qualification.'+c).length,0);assert.match(supportPage,/#\/group\/bookings\/B-INTERNAL/);
  assert.doesNotMatch(f.page(ops),/#\/group\/bookings\/B-INTERNAL/);assert.match(f.page(ops),/运营岗位不新增预约处置权限/);
});

test('暂停复训再授权恢复走真实模型，资格门禁在明确恢复前保持',()=>{
  const f=fixture();f.authorize();f.pause();assert.equal(qualificationEligibility(f.s,'t1','relax').allowed,false);assert.equal(forms(f.page(ops),'qualification.resume').length,0);
  const retrain=forms(f.page(),'qualification.assess').find(x=>x.payload.holdId===f.hold.id);assert.deepEqual(retrain.payload.serviceIds,['relax']);assert.equal(retrain.payload.kind,'retraining');assert.doesNotMatch(retrain.body,/name="serviceIds"/);f.retrain();f.request();f.review();assert.equal(qualificationEligibility(f.s,'t1','relax').allowed,false);assert.equal(forms(f.page(),'qualification.resume').length,0);assert.equal(forms(f.page(ops),'qualification.resume').length,1);f.resume();assert.equal(f.hold.status,'resolved');assert.equal(qualificationEligibility(f.s,'t1','relax').allowed,true);assert.equal(forms(f.page(ops),'qualification.resume').length,0);assert.match(f.page(),/复训考核 \/ 新授权/);assert.equal(f.profile.assessments.length,2);assert.equal(f.profile.grants.length,2);
});

test('已协调预约读取当前状态，历史暂停快照不再阻止恢复按钮',()=>{
  const f=fixture();f.authorize();f.s.bookings.push({id:'B-FUTURE',techId:'t1',storeId:'s1',serviceId:'relax',status:'confirmed',startAt:NOW+HOUR});f.pause();f.retrain();f.request();f.review();assert.match(f.page(ops),/未开始预约仍待协调/);assert.equal(forms(f.page(ops),'qualification.resume').length,0);
  f.s.bookings[0].status='cancelled';assert.equal(forms(f.page(ops),'qualification.resume').length,1);assert.match(f.page(ops),/暂停时的预约快照/);f.resume();assert.equal(f.hold.status,'resolved');assert.equal(f.hold.impacts[0].status,'confirmed');assert.equal(f.s.bookings[0].status,'cancelled');
});

test('已履约订单保留原入口和完成提示，不被暂停界面伪装成待派单',()=>{
  const f=fixture();f.authorize();f.s.bookings.push({id:'B-ACTIVE',techId:'t1',storeId:'s1',serviceId:'relax',status:'active',startedAt:NOW-HOUR,startAt:NOW-HOUR});f.pause();const html=f.page();assert.match(html,/#\/store\/bookings\/B-ACTIVE/);assert.match(html,/已发生履约；保留原完成、求助、中止及退款入口/);assert.equal(f.s.bookings[0].status,'active');f.retrain();f.request();f.review();assert.equal(forms(f.page(ops),'qualification.resume').length,1);
});

test('当前证书失效时即使有复训与授权也没有恢复按钮',()=>{
  const f=fixture();f.authorize();f.pause();f.retrain();f.request();f.review();f.t.validUntil='2026-10-02';assert.equal(forms(f.page(ops),'qualification.resume').length,0);assert.match(f.page(ops),/核对当前证书保单、资料审核及项目状态/);
});

test('多次暂停与审核各有实体草稿键，恢复一项保留另一项',()=>{
  const f=fixture();f.authorize();const first=f.pause().id,second=f.pause().id;let html=f.page();const retrains=forms(html,'qualification.assess').filter(x=>x.payload.holdId);assert.equal(retrains.length,2);assert.equal(new Set(retrains.map(x=>x.key)).size,2);assert.ok(retrains.every(x=>x.key.includes(x.payload.holdId)));
  f.retrain(first);f.request();f.retrain(second);f.request();const reviews=forms(f.page(ops),'qualification.review');assert.equal(reviews.length,2);assert.equal(new Set(reviews.map(x=>x.key)).size,2);assert.ok(reviews.every(x=>x.key.includes(x.payload.grantId)));f.review(f.profile.grants[1].id);f.resume(first);assert.equal(f.profile.holds[0].status,'resolved');assert.equal(f.profile.holds[1].status,'open');assert.equal(qualificationEligibility(f.s,'t1','relax').allowed,false);
});

test('旧版本真实拒绝提交，重取表单后保留稳定草稿键及最新版本',()=>{
  const f=fixture(),oldForm=forms(f.page(),'qualification.assess')[0];f.assess();assert.throws(()=>f.send(oldForm,{kind:'initial',serviceIds:['relax'],batch:'B',assessor:'老师',occurredAt:'2026-10-03T13:00',result:'pass',proof:'P',reason:'旧页面提交'}),/已更新/);const fresh=forms(f.page(),'qualification.assess')[0];assert.equal(fresh.key,oldForm.key);assert.equal(fresh.payload.version,1);assert.match(fresh.body,/management-draft-note/);
});

test('关联反馈先锁来源版本和技师，真实暂停引用可回看且正式处罚不可替代',()=>{
  const f=fixture();f.authorize();const c=f.addCase();const source=qualificationCarePanel(f.s,store,c);assert.match(source,/caseId=SC1&amp;actionIndex=0&amp;caseVersion=3/);assert.equal(qualificationCarePanel(f.s,tech,c),'');assert.equal(qualificationCarePanel(f.s,{role:'user',userId:'u1'},c),'');
  const query='caseId=SC1&actionIndex=0&caseVersion=3',form=forms(f.page(store,'t1',query),'qualification.pause')[0];assert.equal(form.payload.caseId,'SC1');assert.equal(form.payload.actionIndex,0);assert.equal(form.payload.caseVersion,3);assert.match(form.key,/case:SC1:0/);f.pause({},store,query);const next=f.s.serviceCareCases[0];assert.equal(next.specialistActions[0].qualificationHoldId,f.hold.id);assert.match(qualificationCarePanel(f.s,store,next),/查看真实处理记录/);assert.doesNotMatch(qualificationCarePanel(f.s,store,next),/核实并登记关联暂停/);
  next.specialistActions.push({kind:'penalty',status:'pending'});assert.doesNotMatch(qualificationCarePanel(f.s,store,next),/正式处罚专项仍待办理/);assert.match(qualificationCarePanel(f.s,store,next),/查看真实处理记录/);
  next.specialistActions[0].qualificationHoldId='BAD-HOLD';const unmatched=qualificationCarePanel(f.s,store,next);assert.match(unmatched,/没有可追溯且匹配的资格暂停记录/);assert.doesNotMatch(unmatched,/核实并登记关联暂停|查看真实处理记录/);
});

test('过期跨技师已绑定与不合法专项来源不产生可提交暂停表单',()=>{
  const f=fixture();f.authorize();f.addCase();for(const query of ['caseId=SC1&actionIndex=0&caseVersion=2','caseId=SC1&actionIndex=-1&caseVersion=3','caseId=SC1&actionIndex=999&caseVersion=3','caseId=BAD&actionIndex=0&caseVersion=3'])assert.equal(forms(f.page(store,'t1',query),'qualification.pause').length,0);
  f.s.serviceCareCases[0].techId='t2';assert.equal(forms(f.page(store,'t1','caseId=SC1&actionIndex=0&caseVersion=3'),'qualification.pause').length,0);f.s.serviceCareCases[0].techId='t1';f.s.serviceCareCases[0].specialistActions[0].kind='penalty';assert.equal(forms(f.page(store,'t1','caseId=SC1&actionIndex=0&caseVersion=3'),'qualification.pause').length,0);
});

test('列表筛选、输出转义与只读渲染不修改既有档案',()=>{
  const f=fixture({legacy:true}),before=JSON.stringify(f.s);assert.match(f.page(store,'','status=legacy'),/林师傅/);assert.doesNotMatch(f.page(store,'','q=王师傅'),/查看资格档案/);assert.equal(JSON.stringify(f.s),before);f.t.name='<script>alert(1)</script>';assert.match(f.page(),/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.doesNotMatch(f.page(),/<script>/);f.authorize();f.pause({owner:'<负责人>'});assert.match(f.page(),/&lt;负责人&gt;/);const snapshot=JSON.stringify(f.s);for(const actor of [store,manager,tech,ops,support])f.page(actor);assert.equal(JSON.stringify(f.s),snapshot);
});
