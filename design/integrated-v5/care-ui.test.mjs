import test from 'node:test';
import assert from 'node:assert/strict';
import { careView, careBookingPanel, careSummary } from './care-ui.mjs';
import { upgradeCare, syncCare, careCommand, careView as modelView, careBlocksBooking } from './service-care.mjs';
import { upgradeQualifications, qualificationCommand } from './tech-qualification.mjs';

const NOW=Date.parse('2026-10-03T14:00:00+08:00'),HOUR=3600000;
const user={role:'user',userId:'u1'},tech={role:'tech',techId:'t1'},store={role:'store',storeId:'s1'},manager={role:'manager',storeId:'s1'},support={role:'group',job:'support'};
const decode=v=>v.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function forms(html,command) {return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,attrs,body])=>({attrs,body,command:/data-command="([^"]+)"/.exec(attrs)?.[1],payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1] || '{}')),key:decode(/data-management-form="([^"]+)"/.exec(attrs)?.[1] || '')})).filter(x=>x.command===command);}
function fixture() {
  let s={schema:5,seq:0,now:NOW,users:[{id:'u1'},{id:'u2'}],stores:[{id:'s1',name:'幸福里门店'},{id:'s2',name:'银杏门店'}],techs:[{id:'t1',storeId:'s1',name:'林师傅'},{id:'t2',storeId:'s2',name:'王师傅'}],bookings:[{id:'B1',userId:'u1',storeId:'s1',techId:'t1',serviceId:'relax',status:'done',completedAt:NOW,payment:{id:'P1',status:'success',amountCents:29800,refundedCents:0},refunds:[],disputes:[]},{id:'B2',userId:'u2',storeId:'s2',techId:'t2',serviceId:'neck',status:'done',completedAt:NOW,refunds:[],disputes:[]}],safety:[],serviceReviews:[]};upgradeCare(s);let request=0;
  const ctx=state=>({id:prefix=>prefix+(++state.seq),fail:message=>{throw Error(message);},log:()=>{}});
  const run=(command,payload={},actor=user)=>{const next=structuredClone(s);const result=careCommand(next,actor,command,{requestId:'care-ui-'+(++request),...payload},ctx(next));s=next;syncCare(s,ctx(s));return result;};
  const view=(actor=user,parts=['care'],query='')=>careView(s,actor,parts,{query:new URLSearchParams(query)});
  const send=(form,fields={},actor=user)=>run(form.command,{...form.payload,...fields},actor);
  return {get s(){return s;},get b(){return s.bookings[0];},get c(){return s.serviceCareCases.at(-1);},get follow(){return s.serviceCareFollowups.at(-1);},run,view,send,
    advance(hours){s.now+=hours*HOUR;syncCare(s,ctx(s));},sync(){syncCare(s,ctx(s));},
    create(actor=user){const form=forms(view(actor,['care','new'],'bookingId=B1'),'care.case-create')[0];assert.ok(form);return send(form,{category:'quality',description:'服务力度与约定不符，希望说明并改进',evidence:'DEMO-NOTE-01',...(actor.role!=='user'?{reason:'按本人来电实际登记'}:{})},actor);},
    respond(extra={}){const form=forms(view(store,['care','case',this.c.id]),'care.case-respond')[0];assert.ok(form);return send(form,{decision:'respond',publicReply:'已核实并与技师沟通改进',internalNote:'内部核实笔记-不得外露',specialistAction:'none',...extra},store);},
    followup(actor=store){const form=forms(view(actor,['care','followups','new'],'bookingId=B1'),'care.followup-create')[0];assert.ok(form);return send(form,{reason:'本次服务后用户提出力度调整，安排人工回访',scope:'store',name:'陈经理',dueAt:s.now+24*HOUR},actor);}
  };
}

test('care仅匹配自身路径，各岗位深链与跨用户门店技师记录隔离',()=>{
  const f=fixture();f.create();f.followup();assert.equal(careView(f.s,user,['invoices']),null);
  for(const actor of [{role:'group',job:'finance'},{role:'group',job:'warehouse'},{role:'group',job:'operations'}]) {assert.match(f.view(actor),/无权/);assert.equal(careSummary(f.s,actor),'');assert.equal(careBookingPanel(f.s,actor,f.b),'');}
  for(const actor of [{role:'user',userId:'u2'},{role:'tech',techId:'t2'},{role:'store',storeId:'s2'},{role:'manager',storeId:'s2'}]) {assert.match(f.view(actor,['care','case',f.c.id]),/不存在或无权/);assert.equal(careBookingPanel(f.s,actor,f.b),'');}
  for(const actor of [user,tech])assert.match(f.view(actor,['care','followup',f.follow.id]),/无权/);
  assert.match(f.view(manager,['care','case',f.c.id]),/反馈情况/);assert.match(f.view(support,['care','followup',f.follow.id]),/回访安排/);
});

test('原预约进入反馈，原诉求和真实多图选择共用稳定表单且不产生退款',()=>{
  const f=fixture(),html=f.view(user,['care','new'],'bookingId=B1'),form=forms(html,'care.case-create')[0];assert.equal(form.payload.bookingId,'B1');assert.match(form.key,/care:user:u1:/);assert.match(form.body,/情况说明与原诉求/);assert.match(html,/合计最多6张/);assert.match(form.body,/type="file"[^>]*data-care-upload[^>]*multiple[^>]*accept="image\/png,image\/jpeg"/);assert.match(form.body,/name="evidenceRefs" value="\[\]"/);assert.doesNotMatch(html,/name="amountCents"|name="requests"|尚未实现图片附件上传/);assert.match(form.attrs,/data-live-version=""/);assert.match(form.body,/management-draft-note/);assert.equal(form.payload.requestId,undefined);assert.equal(f.view(user,['care','new'],'bookingId=B1'),html);
  f.send(form,{category:'duration',description:'时长问题，请核实',evidence:'NOTE-001'});assert.equal(f.c.status,'store_pending');assert.equal(f.b.refunds.length,0);assert.match(careBookingPanel(f.s,user,f.b),new RegExp('#/user/care/case/'+f.c.id));assert.equal(careBlocksBooking(f.s,f.b),true);
});

test('48小时后用户和门店无隐形提交，集团30天内有明确特批依据',()=>{
  const f=fixture();f.advance(49);
  for(const actor of [user,store])assert.equal(forms(f.view(actor,['care','new'],'bookingId=B1'),'care.case-create').length,0);
  const userPage=f.view(user,['care','new'],'bookingId=B1');assert.match(userPage,/超期请联系门店客服/);assert.match(userPage,/#\/user\/booking\/B1\/contact-store/);
  const form=forms(f.view(support,['care','new'],'bookingId=B1'),'care.case-create')[0];assert.match(form.body,/集团特批受理依据/);f.send(form,{category:'other',description:'用户来电反馈',reason:'已核对实际诉求与原预约'},support);assert.equal(f.c.status,'group_pending');assert.equal(f.c.special,true);
  f.advance(30*24);assert.equal(forms(f.view(support,['care','new'],'bookingId=B1'),'care.case-create').length,0);
});

test('门店认领回复到用户确认，公开与内部记录隔离且三个决策草稿互不覆盖',()=>{
  const f=fixture();f.create();let html=f.view(store,['care','case',f.c.id]);f.send(forms(html,'care.task-claim')[0],{name:'陈经理'},store);f.respond();
  html=f.view(user,['care','case',f.c.id]);assert.match(html,/已核实并与技师沟通改进/);assert.match(html,/48小时内接受或申请集团介入/);assert.doesNotMatch(html,/内部核实笔记-不得外露|负责人姓名|陈经理/);
  const answers=forms(html,'care.case-answer');assert.equal(answers.length,3);assert.equal(new Set(answers.map(x=>x.key)).size,3);assert.match(answers.find(x=>x.payload.decision==='escalate').body,/name="reason"[^>]*required/);
  assert.match(f.view(store,['care','case',f.c.id]),/内部核实笔记-不得外露/);assert.doesNotMatch(f.view(tech,['care','case',f.c.id]),/内部核实笔记-不得外露/);
  f.send(answers.find(x=>x.payload.decision==='accept'));assert.equal(f.c.status,'closed');assert.equal(careBlocksBooking(f.s,f.b),false);assert.equal(forms(f.view(user,['care','case',f.c.id]),'care.case-answer').length,0);
});

test('用户接受时填写的确认说明真实保存并公开回读，旧记录缺失时不补造',()=>{
  const f=fixture();f.create();f.respond();const form=forms(f.view(user,['care','case',f.c.id]),'care.case-answer').find(x=>x.payload.decision==='accept');assert.match(form.body,/name="reason"/);const note='认可这次处理，后续请按约定沟通 <确认>';
  f.send(form,{reason:note});assert.equal(f.c.confirmationNote,note);assert.equal(f.c.confirmationMode,'user');assert.equal(f.c.confirmedAt,f.s.now);
  for(const actor of [user,tech,store,manager,support]) {const html=f.view(actor,['care','case',f.c.id]);assert.match(html,/>用户确认说明<\/h2>/);assert.match(html,/认可这次处理，后续请按约定沟通 &lt;确认&gt;/);assert.match(html,/确认时间/);}
  delete f.c.confirmationNote;const before=JSON.stringify(f.s);assert.doesNotMatch(f.view(user,['care','case',f.c.id]),/>用户确认说明<\/h2>/);assert.equal(JSON.stringify(f.s),before);assert.equal(Object.hasOwn(f.c,'confirmationNote'),false);
});

test('技师只有本人案件说明，说明版本真实推进并拒绝旧页重复修改',()=>{
  const f=fixture();f.create();const html=f.view(tech,['care','case',f.c.id]),form=forms(html,'care.case-statement')[0];assert.ok(form);assert.equal(forms(html,'care.case-respond').length,0);assert.equal(forms(html,'care.case-note').length,0);assert.match(form.key,/care:tech::t1:/);
  f.send(form,{text:'已按用户当场要求调整力度'},tech);assert.match(f.view(tech,['care','case',f.c.id]),/已按用户当场要求调整力度/);assert.throws(()=>f.send(form,{text:'旧页面第二次提交'},tech),/已更新/);
});

test('集团介入后原门店无裁决或退回权限，分派记录保留前后负责人',()=>{
  const f=fixture();f.create();f.respond();const answer=forms(f.view(user,['care','case',f.c.id]),'care.case-answer').find(x=>x.payload.decision==='escalate');f.send(answer,{reason:'仍不同意门店核实结果'});
  let html=f.view(support,['care','case',f.c.id]);const assign=forms(html,'care.task-assign')[0];assert.doesNotMatch(assign.body,/<option value="store"/);f.send(assign,{scope:'group',name:'集团客服李女士',reason:'由集团客服接管'},support);
  html=f.view(store,['care','case',f.c.id]);assert.equal(forms(html,'care.case-respond').length,0);assert.equal(forms(html,'care.task-assign').length,0);assert.match(f.view(support,['care','case',f.c.id]),/集团客服李女士/);
  const response=forms(f.view(support,['care','case',f.c.id]),'care.case-respond')[0];f.send(response,{decision:'respond',publicReply:'集团已复核并确认处理结论',internalNote:'集团内部结论'},support);assert.equal(f.c.status,'closed');assert.match(f.view(user,['care','case',f.c.id]),/集团已复核并确认处理结论/);assert.doesNotMatch(f.view(user,['care','case',f.c.id]),/集团内部结论/);
});

test('实际退款与安全未结时只能跟进，执行办结后才出现案件结案表单',()=>{
  const f=fixture();f.create();f.b.refunds.push({id:'RF1',status:'processing'});f.s.safety.push({id:'HS1',bookingId:'B1',storeId:'s1',status:'open'});
  const link=forms(f.view(store,['care','case',f.c.id]),'care.case-link')[0];f.send(link,{kind:'refund',targetId:'RF1',reason:'用户原退款申请'},store);f.respond();const answer=forms(f.view(user,['care','case',f.c.id]),'care.case-answer').find(x=>x.payload.decision==='accept');f.send(answer);assert.equal(f.c.status,'execution_pending');
  const pending=f.view(store,['care','case',f.c.id]);assert.match(pending,/退款 RF1 尚未办结/);assert.match(pending,/安全事件 HS1 尚未结案/);assert.match(pending,/#\/store\/bookings\/B1/);assert.equal(forms(pending,'care.case-close').length,0);assert.match(f.view(user,['care','case',f.c.id]),/原有关联处理事项尚未全部办结/);
  f.b.refunds[0].status='success';f.s.safety[0].status='closed';f.sync();const close=forms(f.view(store,['care','case',f.c.id]),'care.case-close')[0];f.send(close,{conclusion:'原退款成功且安全处置已核验'},store);assert.equal(f.c.status,'closed');assert.match(f.view(user,['care','case',f.c.id]),/原退款成功且安全处置已核验/);
});

test('限制专项未关联真实资格记录时阻止结案，提供办理入口并隐藏内部依据',()=>{
  const f=fixture();f.create();f.respond({specialistAction:'restriction',internalNote:'限制处理内部依据-SECRET'});const accept=forms(f.view(user,['care','case',f.c.id]),'care.case-answer').find(x=>x.payload.decision==='accept');f.send(accept);assert.equal(f.c.status,'execution_pending');assert.equal(careBlocksBooking(f.s,f.b),true);
  const html=f.view(store,['care','case',f.c.id]);assert.match(html,/限制接单专项尚未关联匹配的资格暂停记录/);assert.match(html,/核实并登记关联暂停/);assert.match(html,new RegExp(`#/store/qualifications/t1\\?caseId=${f.c.id}&amp;actionIndex=0&amp;caseVersion=${f.c.version}`));assert.doesNotMatch(html,/待专项处理/);assert.equal(forms(html,'care.case-close').length,0);assert.doesNotMatch(f.view(user,['care','case',f.c.id]),/限制处理内部依据-SECRET|核实并登记关联暂停/);
});

test('反馈限制与复训按同一暂停真实恢复后更新页面，不再显示旧待专项处理',()=>{
  for(const kind of ['restriction','retraining']) {
    const f=fixture();f.s.services=[{id:'relax',name:'舒缓放松',active:true}];f.s.stores[0].serviceIds=['relax'];Object.assign(f.s.techs[0],{serviceIds:['relax'],active:true,reviewStatus:'approved',certificate:'CERT-DEMO',insurance:'INS-DEMO',validUntil:'2027-12-31',qualificationRequired:true});upgradeQualifications(f.s);
    f.create();f.respond({specialistAction:kind,internalNote:'专项内部核实-SECRET'});f.send(forms(f.view(user,['care','case',f.c.id]),'care.case-answer').find(x=>x.payload.decision==='accept'));
    const ops={role:'group',job:'operations'};let request=0;
    const profile=()=>f.s.techQualifications.find(x=>x.techId==='t1');
    const qualification=(command,extra={},actor=store)=>{qualificationCommand(f.s,actor,command,{techId:'t1',version:profile()?.version || 0,requestId:`care-qualification-${kind}-${++request}`,reason:'按实际记录核实办理-SECRET',...extra},{id:prefix=>prefix+(++f.s.seq),fail:message=>{throw Error(message);},log:()=>{}});f.sync();};
    qualification('qualification.pause',{serviceIds:['relax'],owner:'复训负责人陈经理',caseId:f.c.id,actionIndex:0,caseVersion:f.c.version});const holdId=profile().holds[0].id;
    assert.equal(f.c.specialistActions[0].qualificationHoldId,holdId);let html=f.view(store,['care','case',f.c.id]);assert.match(html,new RegExp(holdId+' · 暂停与复训跟进中'));assert.match(html,/尚未完成复训、授权及恢复/);assert.equal(forms(html,'care.case-close').length,0);assert.doesNotMatch(html,/待专项处理/);
    qualification('qualification.assess',{kind:'retraining',holdId,serviceIds:['relax'],batch:'DEMO-RETRAIN',assessor:'实际考核陈老师',occurredAt:NOW,result:'pass',proof:'RETRAIN-PROOF-SECRET'});const assessmentId=profile().assessments[0].id;
    qualification('qualification.request',{assessmentId});const grantId=profile().grants[0].id;
    qualification('qualification.review',{grantId,decision:'approve',reviewer:'集团审核王老师',proof:'GRANT-PROOF-SECRET'},ops);
    assert.equal(forms(f.view(store,['care','case',f.c.id]),'care.case-close').length,0);
    qualification('qualification.resume',{holdId,reviewer:'集团恢复核验王老师'},ops);
    assert.deepEqual({assessmentId:profile().holds[0].resolution.assessmentId,grantId:profile().holds[0].resolution.grantId},{assessmentId,grantId});assert.equal(f.c.specialistActions[0].status,'pending','原专项字段不手改为完成，页面应按真实资格记录计算');
    html=f.view(store,['care','case',f.c.id]);assert.match(html,new RegExp(holdId+' · 已恢复'));assert.match(html,/查看真实处理记录/);assert.doesNotMatch(html,/待专项处理|尚未完成复训、授权及恢复|核实并登记关联暂停/);assert.equal(forms(html,'care.case-close').length,1);assert.doesNotMatch(f.view(user,['care','case',f.c.id]),/SECRET|复训负责人陈经理|查看真实处理记录/);
    f.send(forms(html,'care.case-close')[0],{conclusion:'已核验关联暂停的复训、集团再授权与恢复记录'},store);assert.equal(f.c.status,'closed');assert.equal(careBlocksBooking(f.s,f.b),false);assert.match(f.view(store,['care','case',f.c.id]),new RegExp(holdId+' · 已恢复'));
  }
});

test('正式处罚专项须有原决定入档，资格记录与备注不能替代执行',()=>{
  const f=fixture();f.create();f.respond({specialistAction:'penalty',internalNote:'正式处罚依据-SECRET'});f.send(forms(f.view(user,['care','case',f.c.id]),'care.case-answer').find(x=>x.payload.decision==='accept'));
  const html=f.view(store,['care','case',f.c.id]);assert.match(html,/待实际决定入档/);assert.match(html,/处罚专项未有匹配的实际决定/);assert.equal(forms(html,'penalty.warning-record').length,1);assert.equal(forms(html,'care.case-close').length,0);assert.doesNotMatch(html,/核实并登记关联暂停/);assert.doesNotMatch(f.view(user,['care','case',f.c.id]),/正式处罚依据-SECRET/);
});

test('回访安排必须人工填写姓名期限依据，不为未完成预约创建虚假计划',()=>{
  const f=fixture(),form=forms(f.view(store,['care','followups','new'],'bookingId=B1'),'care.followup-create')[0];assert.match(form.body,/name="name" value=""[^>]*required/);assert.match(form.body,/name="dueAt" value=""[^>]*required/);assert.match(form.body,/name="reason"[^>]*required/);assert.equal(form.payload.bookingId,'B1');f.followup();assert.equal(f.follow.assignee.name,'陈经理');assert.equal(f.follow.dueAt,NOW+24*HOUR);
  f.b.status='active';assert.equal(forms(f.view(store,['care','followups','new'],'bookingId=B1'),'care.followup-create').length,0);assert.doesNotMatch(careBookingPanel(f.s,store,f.b),/安排人工回访/);
});

test('未接通必须留未来联系时间，原期限与转派历史保持，不能冒充已解决',()=>{
  const f=fixture();f.followup();const due=f.follow.dueAt,form=forms(f.view(store,['care','followup',f.follow.id]),'care.followup-record')[0];assert.throws(()=>f.send(form,{outcome:'no_answer',note:'无人接听'},store),/下次联系时间/);f.send(form,{outcome:'no_answer',note:'无人接听，次日继续联系',nextContactAt:NOW+30*HOUR},store);assert.equal(f.follow.dueAt,due);assert.equal(forms(f.view(store,['care','followup',f.follow.id]),'care.followup-close').length,0);
  const assign=forms(f.view(store,['care','followup',f.follow.id]),'care.task-assign')[0];f.send(assign,{scope:'group',name:'客服王女士',reason:'请集团继续跟进'},store);assert.equal(f.follow.dueAt,due);assert.equal(forms(f.view(store,['care','followup',f.follow.id]),'care.followup-record').length,0);assert.match(f.view(support,['care','followup',f.follow.id]),/陈经理（原服务门店） → 客服王女士（集团客服）/);
  f.advance(25);assert.match(f.view(support,['care','followup',f.follow.id]),/已超过处理期限/);assert.match(f.view(support,['care','followups'],'status=overdue'),new RegExp(f.follow.id));
});

test('拒访不绕过未结反馈，反馈办结后保留拒访事实才能关闭回访',()=>{
  const f=fixture();f.create();f.followup();const record=forms(f.view(store,['care','followup',f.follow.id]),'care.followup-record')[0];f.send(record,{outcome:'refused',note:'用户明确表示不接受本次回访'},store);assert.equal(forms(f.view(store,['care','followup',f.follow.id]),'care.followup-close').length,0);assert.match(f.view(store,['care','followup',f.follow.id]),/反馈案件 .* 尚未办结/);
  const withdraw=forms(f.view(user,['care','case',f.c.id]),'care.case-answer')[0];f.send(withdraw,{reason:'用户撤回独立反馈'});assert.equal(f.c.status,'withdrawn');const close=forms(f.view(store,['care','followup',f.follow.id]),'care.followup-close')[0];f.send(close,{conclusion:'尊重拒访意愿，原反馈已撤回且无其他未结事项'},store);assert.equal(f.follow.status,'closed');assert.match(f.view(store,['care','followup',f.follow.id]),/用户拒访/);
});

test('回访发现问题通过来源转案自动关联，未结案件阻止回访关闭',()=>{
  const f=fixture();f.followup();const followId=f.follow.id,version=f.follow.version,query=`bookingId=B1&sourceKind=followup&sourceId=${followId}`,form=forms(f.view(store,['care','new'],query),'care.case-create')[0];assert.deepEqual(form.payload,{bookingId:'B1',sourceKind:'followup',sourceId:followId});f.send(form,{category:'attitude',description:'回访中用户提到服务沟通问题',reason:'依据本次实际回访'},store);assert.equal(f.follow.links[0].id,f.c.id);assert.ok(f.follow.version>version);assert.equal(f.follow.status,'awaiting_actions');assert.match(f.view(store,['care','followup',followId]),new RegExp('#/store/care/case/'+f.c.id));assert.equal(forms(f.view(store,['care','followup',followId]),'care.followup-close').length,0);assert.match(f.view(store,['care','followup',followId]),/跟进已登记反馈/);assert.doesNotMatch(f.view(store,['care','followup',followId]),/>由回访登记反馈<\/a>/);
});

test('回访转案显示条件提示，超期或已转集团的原门店不显示新建入口',()=>{
  const f=fixture();f.followup();let html=f.view(store,['care','followup',f.follow.id]);assert.match(html,/若反馈已超过完成后48小时/);assert.match(html,/>由回访登记反馈<\/a>/);assert.doesNotMatch(html,/已超过完成后48小时的反馈由/);
  const assign=forms(html,'care.task-assign')[0];f.send(assign,{scope:'group',name:'集团客服李女士',reason:'请集团直接接管'},store);html=f.view(store,['care','followup',f.follow.id]);assert.doesNotMatch(html,/>由回访登记反馈<\/a>/);assert.match(html,/当前回访由集团客服负责/);assert.match(f.view(support,['care','followup',f.follow.id]),/>由回访登记反馈<\/a>/);assert.equal(forms(f.view(store,['care','new'],`bookingId=B1&sourceKind=followup&sourceId=${f.follow.id}`),'care.case-create').length,0);
  const late=fixture();late.followup();late.advance(49);assert.doesNotMatch(late.view(store,['care','followup',late.follow.id]),/>由回访登记反馈<\/a>/);assert.match(late.view(store,['care','followup',late.follow.id]),/之后请联系集团客服核实特批/);assert.match(late.view(support,['care','followup',late.follow.id]),/>由回访登记反馈<\/a>/);
});

test('当前阶段能力控制按钮，待用户确认不能通过门店转派改变处理阶段',()=>{
  const f=fixture();f.create();assert.equal(forms(f.view(user,['care','case',f.c.id]),'care.case-answer').filter(x=>x.payload.decision==='accept').length,0);f.respond();const assign=forms(f.view(store,['care','case',f.c.id]),'care.task-assign')[0];assert.match(assign.body,/<option value="store"/);assert.doesNotMatch(assign.body,/<option value="group"/);assert.equal(forms(f.view(store,['care','case',f.c.id]),'care.case-respond').length,0);
});

test('已转派未认领保留待认领队列，姓名记录不冒充认领成功',()=>{
  const f=fixture();f.create();const assign=forms(f.view(store,['care','case',f.c.id]),'care.task-assign')[0];f.send(assign,{scope:'store',name:'赵店长',reason:'交值班负责人'},store);assert.equal(f.c.assignee.claimedAt,null);assert.match(f.view(store,['care','case',f.c.id]),/赵店长（待认领）/);assert.match(f.view(store,['care','cases'],'status=unclaimed'),new RegExp('#/store/care/case/'+f.c.id));assert.match(careSummary(f.s,store),/反馈待认领 1 项/);
  const claim=forms(f.view(manager,['care','case',f.c.id]),'care.task-claim')[0];f.send(claim,{name:'赵店长'},manager);assert.match(f.view(store,['care','case',f.c.id]),/赵店长（已认领）/);assert.doesNotMatch(f.view(store,['care','cases'],'status=unclaimed'),new RegExp('#/store/care/case/'+f.c.id));
});

test('关联评价只链接当前身份可读的原记录，不从反馈页面绕过评价权限',()=>{
  const f=fixture();f.create();f.s.serviceReviews.push({id:'RV1',bookingId:'B1',userId:'u1',storeId:'s1',techId:'t1'});const link=forms(f.view(store,['care','case',f.c.id]),'care.case-link')[0];f.send(link,{kind:'review',targetId:'RV1',reason:'原服务评价'},store);assert.match(f.view(user,['care','case',f.c.id]),/#\/user\/reviews\/RV1/);assert.match(f.view(tech,['care','case',f.c.id]),/#\/tech\/reviews\/RV1/);
  f.s.serviceReviews[0].techId='t2';assert.doesNotMatch(f.view(tech,['care','case',f.c.id]),/#\/tech\/reviews\/RV1/);assert.match(f.view(support,['care','case',f.c.id]),/#\/group\/reviews\/RV1/);
});

test('列表与摘要带可读链接名称，旧渲染不写状态，说明与编号转义',()=>{
  const f=fixture();f.create();f.followup();f.c.description='<img src=x onerror=alert(1)>';f.c.notes.push({at:NOW,text:'<script>secret</script>',by:{role:'store',id:'s1'}});const before=JSON.stringify(f.s);
  for(const actor of [user,tech,store,manager,support]) {f.view(actor);f.view(actor,['care','case',f.c.id]);careSummary(f.s,actor);careBookingPanel(f.s,actor,f.b);}
  assert.equal(JSON.stringify(f.s),before);assert.match(f.view(user,['care','case',f.c.id]),/&lt;img/);assert.doesNotMatch(f.view(user,['care','case',f.c.id]),/secret/);assert.match(f.view(store,['care','case',f.c.id]),/&lt;script&gt;secret/);assert.match(careSummary(f.s,store),/aria-label="未结反馈 1 项，查看明细"/);assert.match(f.view(store,['care','cases'],'q=B1'),new RegExp(f.c.id));assert.doesNotMatch(f.view(store,['care','cases'],'q=B2'),new RegExp(`href="#/store/care/case/${f.c.id}"`));
  const raw={schema:5,now:NOW,users:[],stores:[],techs:[],bookings:[]},snapshot=JSON.stringify(raw);careView(raw,support,['care']);assert.equal(JSON.stringify(raw),snapshot);
});
