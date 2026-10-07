import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffUiView, handoffBookingPanel, bookingRecipientFields, bookingRecipientSummary } from './service-handoff-ui.mjs';
import { upgradeHandoffs, recipientCommand, captureBookingHandoff, handoffCommand, handoffSources } from './service-handoff.mjs';

const NOW=Date.parse('2026-10-03T14:00:00+08:00'),HOUR=3600000;
const user={role:'user',userId:'u1'},other={role:'user',userId:'u2'},tech={role:'tech',techId:'t1'},tech2={role:'tech',techId:'t2'},store={role:'store',storeId:'s1'},manager={role:'manager',storeId:'s1'},support={role:'group',job:'support'};
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function forms(html,command) {return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,attrs,body])=>({attrs,body,command:/data-command="([^"]+)"/.exec(attrs)?.[1],payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1] || '{}')),key:decode(/data-management-form="([^"]+)"/.exec(attrs)?.[1] || '')})).filter(x=>!command||x.command===command);}
function fixture() {
  let s=upgradeHandoffs({schema:5,seq:0,now:NOW,users:[{id:'u1',name:'预约人王女士'},{id:'u2',name:'另一用户'}],stores:[{id:'s1',name:'幸福里门店'},{id:'s2',name:'银杏门店'}],techs:[{id:'t1',name:'林师傅',storeId:'s1'},{id:'t2',name:'陈师傅',storeId:'s1'}],bookings:[]}),req=0;
  const ctx=state=>({id:prefix=>prefix+(++state.seq),fail:message=>{throw Error(message);},log:()=>{}});
  const page=(actor=user,id='B1')=>handoffUiView(s,actor,['handoffs',id]);
  const profiles=(actor=user)=>handoffUiView(s,actor,['recipients']);
  const run=(command,payload,actor=user)=>{const next=structuredClone(s),result=(command.startsWith('recipient.')?recipientCommand:handoffCommand)(next,actor,command,{requestId:'ui-'+(++req),...payload},ctx(next));s=next;return result;};
  const send=(form,fields={},actor=user)=>{assert.ok(form,'action form exists');return run(form.command,{...form.payload,...fields},actor);};
  return {get s(){return s;},get handoff(){return s.serviceHandoffs.find(x=>x.bookingId==='B1');},get b(){return s.bookings.find(x=>x.id==='B1');},page,profiles,run,send,
    profile(extra={},actor=user){return send(forms(profiles(actor),'recipient.save')[0],{kind:'family',name:'王妈妈',relationship:'母亲',consent:true,...extra},actor);},
    booking(profile,extra={}){const b={id:'B1',userId:'u1',storeId:'s1',techId:'t1',status:'active',startedAt:NOW-HOUR,startAt:NOW-HOUR,...extra};s.bookings.push(b);captureBookingHandoff(s,user,b,{recipientId:profile?.id || 'visit',recipientVersion:profile?.version,recipientKind:'self',recipientName:'本次用户',recipientConfirmed:true,attention:'注意放松节奏',preference:'偏轻力度'},ctx(s));return b;},
    note(extra={},actor=tech){const f=forms(page(actor),'handoff.note').find(x=>!x.payload.correctionOf);send(f,{occurredAt:'2026-10-03T13:30',observation:'已确认并调整力度',nextAdvice:'下次继续偏轻力度',...extra},actor);return this.handoff.notes.at(-1);},
    decide(noteId=this.handoff.notes.at(-1).id,decision='accept'){return send(forms(page(),'handoff.decide').find(x=>x.payload.noteId===noteId),{decision});},
    done(){this.b.status='done';this.b.completedAt=NOW;},
    draft(profile,extra={}){return {storeId:'s1',recipientId:profile?.id || 'visit',recipientVersion:profile?.version,recipientKind:'family',recipientName:'本次家人',recipientRelationship:'母亲',attention:'注意放松节奏',preference:'偏轻力度',recipientConfirmed:false,...extra};}
  };
}

test('只处理对象与交接路由，档案列表只向有效用户开放',()=>{
  const f=fixture();assert.equal(handoffUiView(f.s,user,['care']),null);assert.match(f.profiles(),/服务对象/);
  for(const actor of [store,manager,tech,support,{role:'user',userId:'unknown'}]) assert.match(f.profiles(actor),/无权/);
  assert.match(handoffUiView(f.s,user,['recipients','extra']),/页面不存在/);assert.match(handoffUiView(f.s,user,['handoffs']),/请从原预约/);
});

test('新建对象不预填联系人、不预勾保存授权，明确自愿保存和停用边界',()=>{
  const f=fixture(),html=f.profiles(),form=forms(html,'recipient.save')[0];assert.equal(form.payload.version,0);assert.equal(form.payload.consent,undefined);assert.match(form.body,/name="consent"[^>]*required/);assert.doesNotMatch(form.body,/checked/);assert.doesNotMatch(form.body,/value="预约人王女士"/);assert.match(html,/保存档案由您自愿选择/);assert.match(html,/停用不等于删除或账号注销/);assert.match(html,/历史预约不会自动转成对象档案/);assert.match(form.attrs,/data-live-version="0"/);
  assert.throws(()=>f.send(form,{kind:'self',name:'本人'}),/同意并授权/);
});

test('本人档案创建、修改、停用、恢复均从实际表单执行且不串用户',()=>{
  const f=fixture(),p=f.profile();f.profile({name:'其他用户母亲'},other);assert.match(f.profiles(),/王妈妈/);assert.doesNotMatch(f.profiles(),/其他用户母亲/);
  let edit=forms(f.profiles(),'recipient.save').find(x=>x.payload.id===p.id);f.send(edit,{kind:'family',name:'王女士母亲',relationship:'母亲',consent:true});assert.match(f.profiles(),/王女士母亲/);
  let status=forms(f.profiles(),'recipient.status')[0];assert.equal(status.payload.active,false);f.send(status,{reason:'本人申请暂时停用'});assert.match(f.profiles(),/已停用/);assert.equal(forms(f.profiles(),'recipient.save').filter(x=>x.payload.id===p.id).length,0);
  status=forms(f.profiles(),'recipient.status')[0];assert.equal(status.payload.active,true);f.send(status,{reason:'确认可恢复使用'});assert.equal(forms(f.profiles(),'recipient.save').filter(x=>x.payload.id===p.id).length,1);
});

test('对象旧版本拒绝覆盖，重新读取表单版本变化但草稿实体键保持',()=>{
  const f=fixture(),p=f.profile(),old=forms(f.profiles(),'recipient.save').find(x=>x.payload.id===p.id);f.send(old,{kind:'family',name:'新称呼',relationship:'母亲',consent:true});assert.throws(()=>f.send(old,{kind:'family',name:'旧页面覆盖',relationship:'母亲',consent:true}),/记录已更新/);
  const fresh=forms(f.profiles(),'recipient.save').find(x=>x.payload.id===p.id);assert.equal(fresh.payload.version,2);assert.equal(fresh.key,old.key);assert.match(fresh.body,/role="status"/);
});

test('修改对象称呼不回写旧预约快照',()=>{
  const f=fixture(),p=f.profile();f.booking(p);const old=f.b.recipientSnapshot;f.send(forms(f.profiles(),'recipient.save').find(x=>x.payload.id===p.id),{kind:'family',name:'新称呼',relationship:'母亲',consent:true});assert.deepEqual(f.b.recipientSnapshot,old);assert.match(f.page(),/王妈妈/);assert.doesNotMatch(f.page(),/新称呼/);
});

test('预约联系人内嵌对象字段：默认未选，允许仅本次且不强制建档',()=>{
  const f=fixture(),blank=bookingRecipientFields(f.s,user,{recipientId:'',contactName:'预约人王女士'});assert.match(blank,/请选择本次服务对象/);assert.match(blank,/data-booking-field="recipientId" data-booking-refresh/);assert.doesNotMatch(blank,/name="recipientConfirmed"|value="预约人王女士"/);assert.match(blank,/#\/user\/recipients/);
  const visit=bookingRecipientFields(f.s,user,f.draft(null));assert.match(visit,/仅|本次对象只随原预约保留/);assert.match(visit,/name="recipientName"/);assert.match(visit,/name="recipientRelationship"[^>]*required/);assert.match(visit,/name="recipientConfirmed"[^>]*required/);assert.doesNotMatch(visit,/<form/);assert.doesNotMatch(visit,/name="consent"/);
  const self=bookingRecipientFields(f.s,user,f.draft(null,{recipientKind:'self'}));assert.doesNotMatch(self,/name="recipientRelationship"/);assert.equal(bookingRecipientFields(f.s,store,f.draft(null)),'');
});

test('已存对象只展示最小信息，档案旧版和停用均要求重新选择',()=>{
  const f=fixture(),p=f.profile(),d=f.draft(p);let html=bookingRecipientFields(f.s,user,d);assert.match(html,/王妈妈/);assert.doesNotMatch(html,/name="recipientName"/);assert.match(html,/name="recipientConfirmed"/);
  f.send(forms(f.profiles(),'recipient.save').find(x=>x.payload.id===p.id),{kind:'family',name:'更新称呼',relationship:'母亲',consent:true});html=bookingRecipientFields(f.s,user,d);assert.match(html,/旧版本不能继续提交/);assert.doesNotMatch(html,/name="recipientConfirmed"/);
  f.send(forms(f.profiles(),'recipient.status')[0],{reason:'暂停'});assert.match(bookingRecipientFields(f.s,user,d),/此前所选对象不可用/);
});

test('历史建议必须用户接受且同对象同门店完成服务后才能主动选用',()=>{
  const f=fixture(),p=f.profile(),second=f.profile({name:'王爸爸',relationship:'父亲'});f.booking(p);const n=f.note();f.done();assert.doesNotMatch(bookingRecipientFields(f.s,user,f.draft(p)),/name="sourceKey"/);f.decide(n.id);const source=handoffSources(f.s,user,p.id,'s1')[0],html=bookingRecipientFields(f.s,user,f.draft(p));assert.match(html,/name="sourceKey" data-booking-field="sourceKey" data-booking-refresh/);assert.match(html,/下次继续偏轻力度/);assert.match(html,/<option value="" selected>/);assert.ok(html.includes(`value="${source.bookingId}:${source.noteId}:${source.version}"`));
  assert.doesNotMatch(bookingRecipientFields(f.s,user,f.draft(second)),/下次继续偏轻力度/);assert.doesNotMatch(bookingRecipientFields(f.s,user,f.draft(p,{storeId:'s2'})),/下次继续偏轻力度/);
});

test('选中的历史来源被更正时明确告知，不静默替换或默认采用',()=>{
  const f=fixture(),p=f.profile();f.booking(p);f.note();f.done();f.decide();const source=handoffSources(f.s,user,p.id,'s1')[0];const d=f.draft(p,{sourceKey:`${source.bookingId}:${source.noteId}:${source.version}`});
  f.send(forms(f.page(tech),'handoff.note').find(x=>x.payload.correctionOf),{occurredAt:'2026-10-03T13:40',observation:'重新核实客观记录',nextAdvice:'新建议尚未确认',reason:'修正原建议'},tech);
  const html=bookingRecipientFields(f.s,user,d);assert.match(html,/此前引用已变化，请重新选择/);assert.match(html,/旧来源不能用于本次提交/);assert.doesNotMatch(html,/新建议尚未确认/);
});

test('最终确认摘要展示实际对象与全部当次事项，并保持未确认和版本提醒',()=>{
  const f=fixture(),p=f.profile(),d=f.draft(p);let html=bookingRecipientSummary(f.s,user,d);assert.match(html,/王妈妈/);assert.match(html,/注意放松节奏/);assert.match(html,/偏轻力度/);assert.match(html,/尚未确认/);html=bookingRecipientSummary(f.s,user,{...d,recipientConfirmed:true});assert.match(html,/已确认适用于本次预约/);assert.doesNotMatch(html,/<button|<input/);assert.match(bookingRecipientSummary(f.s,user,{recipientId:''}),/尚未明确服务对象/);assert.equal(bookingRecipientSummary(f.s,tech,d),'');
});

test('旧预约明确对象未确认且不提供补造记录、已读或采纳表单',()=>{
  const f=fixture();f.s.bookings.push({id:'OLD',userId:'u1',storeId:'s1',techId:'t1',contactName:'家人联系人',status:'done'});
  for(const actor of [user,tech,store,support]) {const html=f.page(actor,'OLD');assert.match(html,/未确认服务对象/);assert.match(html,/不能补造交接记录/);assert.equal(forms(html).length,0);assert.doesNotMatch(html,/家人联系人/);}
});

test('订单交接入口和正文严格按用户、当前技师、原门店及客服隔离',()=>{
  const f=fixture(),p=f.profile();f.booking(p);f.note({observation:'敏感服务事实甲'});
  for(const actor of [user,tech,store,manager,support,{role:'group',job:'all'}]) {assert.match(f.page(actor),/敏感服务事实甲/);assert.match(handoffBookingPanel(f.s,actor,'B1'),/查看服务交接/);}
  for(const actor of [other,tech2,{role:'store',storeId:'s2'},{role:'group',job:'finance'},{role:'group',job:'operations'},{role:'group',job:'warehouse'}]) {assert.match(f.page(actor),/不存在或无权/);assert.doesNotMatch(f.page(actor),/敏感服务事实甲|王妈妈/);assert.equal(handoffBookingPanel(f.s,actor,'B1'),'');}
  assert.doesNotMatch(handoffBookingPanel(f.s,store,'B1'),/敏感服务事实甲/);
});

test('当前技师实际确认已读后显示反馈；改派新技师须重新确认且旧技师失去正文权限',()=>{
  const f=fixture(),p=f.profile();f.booking(p);let ack=forms(f.page(tech),'handoff.ack')[0];assert.equal(ack.payload.version,1);assert.match(ack.body,/name="readConfirmed"[^>]*required/);assert.equal(ack.payload.readConfirmed,undefined);f.send(ack,{readConfirmed:true},tech);assert.equal(forms(f.page(tech),'handoff.ack').length,0);assert.match(f.page(tech),/当前技师已确认/);assert.match(f.page(user),/不增加开始服务的强制步骤/);
  f.b.techId='t2';f.b.changeHistory=[{id:'C1',status:'accepted'}];assert.equal(handoffBookingPanel(f.s,tech,'B1'),'');ack=forms(f.page(tech2),'handoff.ack')[0];assert.ok(ack);f.send(ack,{readConfirmed:true},tech2);assert.match(f.page(tech2),/当前技师已确认/);assert.equal(f.handoff.acks.length,2);
});

test('尚未实际开始无事实表单；实际服务中可追加、用户可读且不可代写',()=>{
  const f=fixture(),p=f.profile();f.booking(p,{status:'confirmed',startedAt:null});assert.equal(forms(f.page(tech),'handoff.note').length,0);assert.match(f.page(tech),/实际开始服务后/);f.b.status='active';f.b.startedAt=NOW-HOUR;assert.equal(forms(f.page(tech),'handoff.note').length,1);assert.equal(forms(f.page(user),'handoff.note').length,0);const n=f.note();assert.match(f.page(user),/已确认并调整力度/);assert.equal(n.by.id,'t1');assert.match(f.page(user),/事实发生时间/);assert.match(f.page(user),/记录时间/);
});

test('用户接受与不采用建议都走实际命令且处理后不再显示可重复提交表单',()=>{
  const f=fixture(),p=f.profile();f.booking(p);const first=f.note(),second=f.note({nextAdvice:'请在下次重新沟通力度'});const decisions=forms(f.page(),'handoff.decide');assert.equal(decisions.length,2);assert.equal(new Set(decisions.map(x=>x.key)).size,2);assert.ok(decisions.every(x=>x.payload.version===3));f.decide(first.id,'accept');f.decide(second.id,'reject');assert.match(f.page(),/用户已接受建议/);assert.match(f.page(),/用户不采用建议/);assert.equal(forms(f.page(),'handoff.decide').length,0);assert.equal(forms(f.page(store),'handoff.decide').length,0);
});

test('只有原作者有更正表单，更正保留原文并要求重新确认新建议',()=>{
  const f=fixture(),p=f.profile();f.booking(p);const n=f.note();f.decide(n.id);assert.equal(forms(f.page(store),'handoff.note').filter(x=>x.payload.correctionOf).length,0);const correction=forms(f.page(tech),'handoff.note').find(x=>x.payload.correctionOf===n.id);assert.match(correction.body,/name="reason"[^>]*required/);f.send(correction,{occurredAt:'2026-10-03T13:40',observation:'更正后的客观记录',nextAdvice:'重新确认力度建议',reason:'补充当时实际确认'},tech);const html=f.page();assert.match(html,/已确认并调整力度/);assert.match(html,/更正后的客观记录/);assert.match(html,/不再用于新预约/);assert.equal(forms(html,'handoff.decide').length,1);
});

test('没有下次建议的客观记录不出现空建议采纳动作',()=>{
  const f=fixture(),p=f.profile();f.booking(p);f.note({nextAdvice:''});const html=f.page();assert.match(html,/已确认并调整力度/);assert.equal(forms(html,'handoff.decide').length,0);assert.doesNotMatch(html,/下次建议<\/span>/);
});

test('交接旧版本拒绝覆盖，角色与订单实体隔离表单草稿',()=>{
  const f=fixture(),p=f.profile();f.booking(p);const old=forms(f.page(tech),'handoff.note')[0];f.note();assert.throws(()=>f.send(old,{occurredAt:'2026-10-03T13:40',observation:'旧版本记录'},tech),/记录已更新/);const fresh=forms(f.page(tech),'handoff.note').find(x=>!x.payload.correctionOf);assert.equal(old.key,fresh.key);assert.equal(fresh.payload.version,2);assert.notEqual(fresh.key,forms(f.page(store),'handoff.note')[0].key);assert.match(fresh.attrs,/data-next="\/tech\/handoffs\/B1"/);assert.match(fresh.attrs,/data-live-version="2"/);
});

test('全部动态文本与字段转义，反馈是notice/status并不伪装为可点击控件',()=>{
  const f=fixture(),p=f.profile({name:'<img src=x onerror=evil()>',relationship:'<关系>'});f.booking(p);f.note({observation:'<script>alert(1)</script>',nextAdvice:'<建议>'});const html=f.page(),profile=f.profiles();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img src=x/);assert.match(profile,/&lt;img src=x/);assert.match(profile,/&lt;关系&gt;/);
  assert.match(html,/<p class="notice">/);assert.doesNotMatch(html,/<(?:button|input)[^>]*(?:已确认|待用户确认)/);assert.doesNotMatch(profile,/<p[^>]*(?:tabindex|data-command|role="button")/);assert.match(profile,/<p class="management-draft-note small muted" role="status">/);
});

test('长交接正文与确认摘要采用上下内容段落，紧凑状态保持独立行',()=>{
  const f=fixture(),p=f.profile();f.booking(p);const note=f.note({observation:'客观记录包含本次沟通、实际调整及用户反馈等需要自然换行的事实。',nextAdvice:'以后如需继续沿用本次偏好，应重新与服务对象确认适用性。'});
  f.send(forms(f.page(tech),'handoff.note').find(x=>x.payload.correctionOf===note.id),{occurredAt:'2026-10-03T13:40',observation:'补充核实后的实际沟通记录，保留原文且用户可以查看。',nextAdvice:'重新沟通后再选择是否采用此前建议。',reason:'补充更正的原因包含核实方式和记录差异，正文不应挤压标签。'},tech);
  const html=f.page();
  for(const label of ['注意事项','偏好','客观服务记录','下次建议','更正原因']) {assert.ok(html.includes(`<div><p class="muted">${label}</p><p>`));assert.ok(!html.includes(`<div class="row"><span class="muted">${label}</span>`));}
  assert.match(html,/<div class="row"><span class="muted">建议处理<\/span>/);
  const summary=bookingRecipientSummary(f.s,user,f.draft(p,{attention:'完整注意事项需要以自然段呈现，标签在其上方单独占行。',preference:'完整偏好正文也需要充分使用可用宽度，并保留自然左对齐。'}));
  for(const label of ['当次注意事项','当次偏好']) {assert.ok(summary.includes(`<div><p class="muted">${label}</p><p>`));assert.ok(!summary.includes(`<div class="row"><span class="muted">${label}</span>`));}
  assert.doesNotMatch(summary,/<(?:button|input)|role="button"|tabindex=/);
});

test('所有对象和交接页面均为纯读取，不在渲染时造档案或补写确认',()=>{
  const f=fixture(),p=f.profile();f.booking(p);f.note();const before=JSON.stringify(f.s);for(const actor of [user,other,store,manager,tech,tech2,support,{role:'group',job:'finance'}]) {f.profiles(actor);f.page(actor);handoffBookingPanel(f.s,actor,'B1');bookingRecipientFields(f.s,actor,f.draft(p));bookingRecipientSummary(f.s,actor,f.draft(p));}assert.equal(JSON.stringify(f.s),before);
  const legacy={users:[{id:'u1'}],bookings:[]},snapshot=JSON.stringify(legacy);handoffUiView(legacy,user,['recipients']);assert.equal(JSON.stringify(legacy),snapshot);
});
