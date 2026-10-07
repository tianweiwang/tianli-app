// Recipient and handoff pages only read scoped model views; booking keeps its original steps.
import { recipientView, handoffView, handoffSources } from './service-handoff.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const truth = value => value === true || value === 'true' || value === 'on';
const date = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Date(Number(value)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const KINDS = {self:'本人',family:'家人',other:'其他对象'};
const ROLES = {user:'预约用户',tech:'技师',store:'门店后台',manager:'店长',group:'集团客服 / 管理员'};
const STATUSES = {pending:'待用户确认',accepted:'用户已接受建议',rejected:'用户不采用建议'};
const ACTIONS = {'recipient.save':'保存对象档案','recipient.status':'调整档案使用状态','handoff.ack':'当前技师确认已读','handoff.note':'追加服务记录','handoff.decide':'用户确认建议'};
const panel = (title,body) => `<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const notice = (body,warning=false) => `<p class="notice${warning?' warning':''}">${e(body)}</p>`;
const row = (title,body) => `<div class="row"><span class="muted">${e(title)}</span><span>${body}</span></div>`;
const content = (title,body) => `<div><p class="muted">${e(title)}</p><p>${e(body)}</p></div>`;
const empty = title => panel(title,'<p class="muted">请从有权查看的原预约或本人对象列表进入。</p>');
const link = (title,path,kind='') => `<a class="${e(kind)}" href="#${e(path)}">${e(title)}</a>`;
const tag = (title,kind='') => `<span class="tag ${e(kind)}">${e(title)}</span>`;
const details = (title,body) => `<details class="action-details"><summary>${e(title)}</summary>${body}</details>`;
const field = (title,name,value='',type='text',attrs='required maxlength="60"') => `<label class="field"><span>${e(title)}</span><input type="${e(type)}" name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
const textarea = (title,name,value='',attrs='maxlength="1000"') => `<label class="field wide"><span>${e(title)}</span><textarea name="${e(name)}" rows="3" ${attrs}>${e(value)}</textarea></label>`;
const select = (title,name,options,value='',attrs='required') => `<label class="field"><span>${e(title)}</span><select name="${e(name)}" ${attrs}>${options.map(([id,title])=>`<option value="${e(id)}"${String(value)===String(id)?' selected':''}>${e(title)}</option>`).join('')}</select></label>`;
const check = (title,name,value=false,attrs='required') => `<label class="check-row wide"><input type="checkbox" name="${e(name)}" value="true"${truth(value)?' checked':''} ${attrs}><span>${e(title)}</span></label>`;
const head = (title,subtitle,actions='') => `<header class="page-head"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div><div class="actions">${actions}</div></header>`;
const roleScope = a => `${a.role}:${a.userId || ''}:${a.techId || ''}:${a.storeId || ''}:${a.role==='group'?a.job || 'all':''}`;
const bookingPath = (a,id) => `/${a.role}/${a.role==='user'?'booking':'bookings'}/${encodeURIComponent(id)}`;
const handoffPath = (a,id) => `/${a.role}/handoffs/${encodeURIComponent(id)}`;
const sourceKey = x => `${x.bookingId}:${x.noteId}:${x.version}`;
function form(actor,command,payload,fields,title,key,next,confirm='') {
  return `<form class="management-form" data-management-form="${e(`handoff:${roleScope(actor)}:${command}:${key}`)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}" data-next="${e(next)}"${confirm?` data-confirm="${e(confirm)}"`:''}><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${e(title)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
}
function author(s,by) {
  if (by?.accountId) return [by.accountName || '工作员工', by.accountId, ROLES[by.role]].filter(Boolean).join(' · ');
  const name=by?.role==='tech'?(s.techs || []).find(x=>x.id===by.id)?.name:by?.role==='user'?(s.users || []).find(x=>x.id===by.id)?.name:['store','manager'].includes(by?.role)?(s.stores || []).find(x=>x.id===by.id)?.name:'';
  return [ROLES[by?.role] || '记录人员',name,by?.id].filter(Boolean).join(' · ');
}
function profileFields(profile={}) {
  return select('服务对象与您的关系','kind',[['','请选择'],...Object.entries(KINDS)],profile.kind || '')+field('服务对象称呼','name',profile.name || '','text','required maxlength="30"')+field('关系说明（本人可留空，其他对象必填）','relationship',profile.relationship || '','text','maxlength="30"')+check('我确认已取得服务对象同意，并同意保存称呼与关系供以后预约使用。','consent');
}
function recipientPage(s,actor) {
  if(actor.role!=='user'||!(s.users || []).some(x=>x.id===actor.userId)) return empty('当前身份无权查看服务对象档案');
  const profiles=recipientView(s,actor),path='/user/recipients';
  const list=profiles.map(p=>{
    const payload={id:p.id,version:p.version};
    const edit=form(actor,'recipient.save',payload,profileFields(p),'保存档案修改',p.id+':edit',path,'确认保存此对象档案？修改不回写旧预约中的对象信息。');
    const status=form(actor,'recipient.status',{...payload,active:!p.active},textarea(p.active?'停用原因':'恢复原因','reason','','required maxlength="300"'),p.active?'停用此档案':'恢复此档案',p.id+':status',path,p.active?'确认停用此档案？以后预约不能再选择，历史预约与记录继续保留。':'确认恢复此档案供以后预约选择？已有预约的信息保持原样。');
    return panel(p.name,row('对象关系',e(KINDS[p.kind] || p.kind)+(p.relationship?' · '+e(p.relationship):''))+row('使用状态',tag(p.active?'可选择':'已停用',p.active?'success':''))+row('档案版本',e('第 '+p.version+' 版'))+row('最近更新',e(date(p.updatedAt || p.createdAt)))+(p.active?details('修改称呼与关系',edit):notice('恢复使用后可修改档案。'))+details(p.active?'停用档案':'恢复使用',status));
  }).join('');
  return head('服务对象','联系人用于联络；服务对象是实际接受本次服务的人。',link('返回预约填写', '/user/booking/contact','secondary'))+notice('保存档案由您自愿选择，也可以在预约时只填写本次对象。这里不收集身份证、生日、诊断或影像；为他人保存前请先取得本人同意。')+panel('新增服务对象',form(actor,'recipient.save',{version:0},profileFields(),'保存服务对象','new',path))+ (list || panel('我的服务对象','<p class="muted">尚未保存服务对象。原联系人和历史预约不会自动转成对象档案。</p>'))+notice('停用仅停止后续选择，历史记录仍保留；停用不等于删除或账号注销。修改称呼与关系不会改变旧单快照。');
}
function snapshotRows(view) {
  const p=view.recipientSnapshot;
  if(!p) return notice('未确认服务对象。此历史预约不按联系人姓名或手机号自动归入任何对象档案。',true);
  return row('本次服务对象',e(p.name))+row('对象关系',e(KINDS[p.kind] || p.kind)+(p.relationship?' · '+e(p.relationship):''))+row('保存方式',p.saved?'已保存对象 · 下单时第 '+e(p.version)+' 版':'仅记录本次对象，不建立长期档案');
}
function noteFields(record=null) {
  return field('事实发生时间（北京时间）','occurredAt','','datetime-local','required')+textarea('客观服务记录','observation',record?.observation || '','required maxlength="1000"')+textarea('下次建议（可选，须用户明确接受）','nextAdvice',record?.nextAdvice || '')+(record?textarea('更正原因','reason','','required maxlength="300"'):'');
}
function notePanel(s,actor,view,record) {
  let body=row('实际记录身份',e(author(s,record.by)))+row('事实发生时间',e(date(record.occurredAt)))+row('记录时间',e(date(record.createdAt)))+content('客观服务记录',record.observation);
  if(record.correctionOf) body+=row('更正原记录',e(record.correctionOf))+content('更正原因',record.reason);
  if(record.replacedBy) body+=notice('此记录已由 '+record.replacedBy+' 更正，保留原文供核对，不再用于新预约。',true);
  if(record.nextAdvice) body+=content('下次建议',record.nextAdvice)+row('建议处理',tag(STATUSES[record.status] || record.status,record.status==='accepted'?'success':''));
  if(record.decision) body+=row('用户处理时间',e(date(record.decision.at)));
  if(record.canDecide&&record.nextAdvice) body+=form(actor,'handoff.decide',{bookingId:view.bookingId,version:view.version,noteId:record.id},select('是否接受为下次参考','decision',[['','请选择'],['accept','接受为下次参考'],['reject','不采用此建议']]),'保存我的选择',`${view.bookingId}:note:${record.id}:decision`,handoffPath(actor,view.bookingId),'接受仅作为以后主动选用的参考；下次预约仍需重新确认适用性。');
  if(record.canCorrect) body+=details('追加更正，保留原文',form(actor,'handoff.note',{bookingId:view.bookingId,version:view.version,correctionOf:record.id},noteFields(record),'保存更正记录',`${view.bookingId}:note:${record.id}:correction`,handoffPath(actor,view.bookingId),'确认追加更正？原文继续保留，旧建议不能再被新预约引用，新建议需用户重新确认。'));
  return details(`${record.id} · ${date(record.occurredAt)}${record.replacedBy?' · 已更正':''}`,body);
}
function handoffPage(s,actor,bookingId) {
  const v=handoffView(s,actor,bookingId);
  if(!v) return empty('服务交接不存在或无权查看');
  let body=head('服务对象与交接',`${v.bookingId} · 交接记录第 ${v.version} 版`,link('返回原预约',bookingPath(actor,v.bookingId),'secondary'))+panel('本次服务对象',snapshotRows(v));
  if(v.legacy) return body+notice('原预约缺少当次服务对象与事项确认，不能补造交接记录，也不能用于跨订单复用。请在下次预约明确选择对象并重新确认。',true);
  const c=v.confirmation;
  body+=panel('用户已确认的当次事项',content('注意事项',c?.attention || '未填写额外注意事项')+content('偏好',c?.preference || '未填写额外偏好')+row('确认时间',e(date(c?.confirmedAt)))+(c?.sourceNoteId?row('主动引用来源',`${e(c.sourceBookingId)} · ${e(c.sourceNoteId)} · 第 ${e(c.sourceVersion)} 版`):'')+notice('内容仅用于本次服务交接，不构成诊断或治疗意见。历史建议须在新预约中主动选用并再次确认。'));
  const currentTech=(s.techs || []).find(x=>x.id===v.currentTechId);
  let read=row('当前安排技师',e(currentTech?.name || '尚未安排'))+row('当次事项已读',tag(v.hasRead?'当前技师已确认':'待当前技师确认',v.hasRead?'success':'warning'));
  if(v.canAck) read+=form(actor,'handoff.ack',{bookingId:v.bookingId,version:v.version},check('我已阅读用户确认的本次注意事项与偏好。','readConfirmed'),'确认已读',v.bookingId+':ack',handoffPath(actor,v.bookingId));
  if(v.acks?.length) read+=details('已读历史',v.acks.map(x=>row(date(x.at),e(author(s,x.by)))).join(''));
  body+=panel('当次交接确认',read+notice('改派后由新技师重新确认。已读记录用于交接跟踪，不增加开始服务的强制步骤。'));
  if(v.canNote) body+=panel('追加客观服务记录',notice('用户可查看这里的全部记录。只登记已经发生的事实，保留实际操作身份与时间；不要填写无关个人信息或诊断结论。')+form(actor,'handoff.note',{bookingId:v.bookingId,version:v.version},noteFields(),'保存服务记录',v.bookingId+':new-note',handoffPath(actor,v.bookingId),'确认保存已发生的客观服务记录？保存后不能覆盖原文，可追加更正。'));
  else if(v.reason) body+=notice(v.reason);
  body+=panel('服务记录与下次建议',v.notes.length?[...v.notes].reverse().map(x=>notePanel(s,actor,v,x)).join(''):'<p class="muted">暂无客观服务记录，不从旧备注自动补造。</p>');
  if(v.history?.length) body+=panel('交接处理历史',`<ol class="timeline">${[...v.history].reverse().map(x=>`<li><p>${e(ACTIONS[x.action] || x.action || '交接处理')} · ${e(date(x.at))}</p><small>${e(author(s,x.by || x.actor))}</small></li>`).join('')}</ol>`);
  return body;
}

export function handoffUiView(s,actor,route=[],ui={}) {
  if(!['recipients','handoffs'].includes(route[0])) return null;
  if(route[0]==='recipients') return route.length===1?recipientPage(s,actor):empty('页面不存在');
  if(route.length!==2||!route[1]) return empty('请从原预约查看服务交接');
  return handoffPage(s,actor,route[1]);
}
export function handoffBookingPanel(s,actor,bookingId,ui={}) {
  const v=handoffView(s,actor,bookingId);
  if(!v) return '';
  return panel('服务对象与交接',snapshotRows(v)+(v.legacy?'':row('当次事项',tag('用户已确认','success'))+row('当前技师已读',v.hasRead?'已确认':'待确认'))+`<div class="actions">${link('查看服务交接',handoffPath(actor,bookingId),'secondary')}</div>`);
}
export function bookingRecipientFields(s,actor,d,h={}) {
  if(actor.role!=='user') return '';
  const profiles=recipientView(s,actor),selected=profiles.find(x=>x.id===d.recipientId),active=profiles.filter(x=>x.active),isVisit=d.recipientId==='visit';
  const options=[['','请选择本次服务对象'],['visit','只填写本次对象'],...active.map(x=>[x.id,`${x.name} · ${KINDS[x.kind] || x.kind}${x.relationship?'（'+x.relationship+'）':''}`])];
  if(d.recipientId&&!isVisit&&!active.some(x=>x.id===d.recipientId)) options.push([d.recipientId,'此前所选对象不可用，请重新选择']);
  let body='<h3>本次服务对象</h3>'+select('谁接受本次服务','recipientId',options,d.recipientId || '','required data-booking-field="recipientId" data-booking-refresh')+`<div class="actions">${link('管理服务对象', '/user/recipients','secondary')}</div>`;
  if(!d.recipientId) return body+notice('请选择已保存对象，或只填写本次对象；联系人不会自动作为服务对象。');
  if(isVisit) body+=select('服务对象与您的关系','recipientKind',[['','请选择'],...Object.entries(KINDS)],d.recipientKind || '','required data-booking-field="recipientKind" data-booking-refresh')+field('服务对象称呼','recipientName',d.recipientName || '','text','required maxlength="30" data-booking-field="recipientName"')+(d.recipientKind==='self'?'':field('关系说明（例如母亲、配偶）','recipientRelationship',d.recipientRelationship || '','text','required maxlength="30" data-booking-field="recipientRelationship"'))+notice('本次对象只随原预约保留，不建立可跨订单复用的对象档案。');
  else if(!selected?.active||String(d.recipientVersion)!==String(selected.version)) return body+notice('所选对象档案已变更或停用。请重新选择并核对对象，旧版本不能继续提交。',true);
  else body+=row('已选对象',e(selected.name)+' · '+e(KINDS[selected.kind] || selected.kind))+row('确认档案版本',e('第 '+d.recipientVersion+' 版'));
  const sources=!isVisit?handoffSources(s,actor,d.recipientId,d.storeId):[];
  const currentKey=d.sourceKey || (d.sourceNoteId?`${d.sourceBookingId}:${d.sourceNoteId}:${d.sourceVersion}`:'');
  if(sources.length||currentKey) {
    const sourceOptions=[['','本次自行填写，不引用历史建议'],...sources.map(x=>[sourceKey(x),`${date(x.at)} · ${x.bookingId} · ${x.advice}`])];
    if(currentKey&&!sources.some(x=>sourceKey(x)===currentKey)) sourceOptions.push([currentKey,'此前引用已变化，请重新选择']);
    body+=select('主动选用已接受的历史建议','sourceKey',sourceOptions,currentKey,'data-booking-field="sourceKey" data-booking-refresh')+notice('这里只显示此对象在本店仍有效且您已接受的建议。选择后带入偏好，您可修改，并须重新确认本次是否适用。');
    if(currentKey&&!sources.some(x=>sourceKey(x)===currentKey)) body+=notice('引用记录已更正或版本变化，请重新选择；旧来源不能用于本次提交。',true);
  }
  body+=textarea('当次注意事项（可选）','attention',d.attention || '','maxlength="1000" data-booking-field="attention"')+textarea('当次偏好（可选）','preference',d.preference || '','maxlength="1000" data-booking-field="preference"')+notice('仅填写与本次服务相关的信息。原门店、当前安排技师与授权客服按职责查看；请勿填写身份证、诊断、影像或其他无关隐私。')+check('我已确认服务对象意愿，以上对象、注意事项与偏好适用于本次预约。','recipientConfirmed',d.recipientConfirmed,'required data-booking-field="recipientConfirmed"');
  return body;
}
export function bookingRecipientSummary(s,actor,d,h={}) {
  if(actor.role!=='user') return '';
  const p=d.recipientId==='visit'?{kind:d.recipientKind,name:d.recipientName,relationship:d.recipientRelationship,saved:false}:recipientView(s,actor).find(x=>x.id===d.recipientId);
  if(!p) return panel('本次服务对象',notice('尚未明确服务对象，请返回联系人步骤选择并确认。',true));
  const stale=d.recipientId!=='visit'&&(!p.active||String(p.version)!==String(d.recipientVersion));
  return panel('本次服务对象',row('对象称呼',e(p.name))+row('对象关系',e(KINDS[p.kind] || p.kind)+(p.relationship?' · '+e(p.relationship):''))+row('保存方式',d.recipientId==='visit'?'仅本次预约':'使用已保存对象档案')+content('当次注意事项',d.attention || '未填写额外注意事项')+content('当次偏好',d.preference || '未填写额外偏好')+(d.sourceNoteId?row('主动引用来源',e(`${d.sourceBookingId} · ${d.sourceNoteId}`)):'')+(stale?notice('对象档案已变化，请返回联系人步骤重新选择并确认。',true):!truth(d.recipientConfirmed)?notice('当次服务对象与事项尚未确认，请返回联系人步骤确认。',true):notice('已确认适用于本次预约；下次预约仍需重新选择与确认。')));
}
