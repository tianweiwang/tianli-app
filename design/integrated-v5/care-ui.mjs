import { qualificationCarePanel } from './qualification-ui.mjs';
import { technicianPenaltyCarePanel } from './technician-penalties-ui.mjs';
import { technicianPenaltyCaseResolution } from './technician-penalties.mjs';
// Quality feedback and manual follow-up views. The care model owns every mutation.
import { careView as careModelView } from './service-care.mjs';
import { canReadServiceReview } from './service-reviews.mjs';
import { careEvidenceAttachments, careEvidenceUploadFields, careEvidenceCount } from './care-evidence-ui.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groupSupport = actor => actor.role === 'group' && (!actor.job || ['all','support'].includes(actor.job));
const staff = actor => ['store','manager'].includes(actor.role) || groupSupport(actor);
const canEnter = actor => ['user','tech'].includes(actor.role) || staff(actor);
const date = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Date(Number(value)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const panel = (title,body) => `<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const note = (text,warning=false) => `<p class="notice${warning?' warning':''}">${e(text)}</p>`;
const row = (title,body) => `<div class="row"><span class="muted">${e(title)}</span><span>${body}</span></div>`;
const empty = (title,description='') => `<section class="panel empty"><h2>${e(title)}</h2><p>${e(description)}</p></section>`;
const field = (title,name,value='',type='text',attrs='') => `<label class="field"><span>${e(title)}</span><input type="${e(type)}" name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
const select = (title,name,options,value='',attrs='') => `<label class="field"><span>${e(title)}</span><select name="${e(name)}" ${attrs}>${options.map(([v,t])=>`<option value="${e(v)}" ${String(v)===String(value)?'selected':''}>${e(t)}</option>`).join('')}</select></label>`;
const text = (title,name,attrs='required maxlength="1000"',value='') => `<label class="field wide"><span>${e(title)}</span><textarea name="${e(name)}" rows="3" ${attrs}>${e(value)}</textarea></label>`;
const details = (title,body) => `<details class="action-details"><summary>${e(title)}</summary>${body}</details>`;
const table = (heads,rows) => rows.length?`<div class="table-wrap"><table><thead><tr>${heads.map(v=>`<th>${e(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="muted">暂无相关记录。</p>';
const actorName = actor => actor?.accountId ? `${actor.accountName || '工作员工'} · ${actor.accountId}` : `${({user:'用户',tech:'本人技师',store:'门店后台',manager:'本店店长',group:'集团客服',system:'系统'})[actor?.role] || '未记录身份'}${actor?.id?' · '+actor.id:''}`;

function helpers(s,actor,ui={}) {
  const path = (part='',id='') => `/${actor.role}/care${part?'/'+part:''}${id?'/'+encodeURIComponent(id):''}`;
  const link = (title,target,kind='') => `<a class="${e(kind)}" href="#${e(target)}">${e(title)}</a>`;
  const bookingPath = id => `/${actor.role}/${actor.role==='user'?'booking':'bookings'}/${encodeURIComponent(id)}`;
  const bookingLink = id => link(id,bookingPath(id));
  const storeName = id => s.stores?.find(x=>x.id===id)?.name || id || '未记录门店';
  const techName = id => s.techs?.find(x=>x.id===id)?.name || id || '未记录技师';
  const canReadReview = id => canReadServiceReview(actor,(s.serviceReviews || []).find(x=>x.id===id));
  const form = (command,payload,fields,title,key,next='',confirm='') => `<form class="management-form" data-management-form="${e(`care:${actor.role}:${actor.userId || ''}:${actor.techId || ''}:${actor.storeId || ''}:${actor.job || ''}:${key}:${command}:${payload.decision || payload.entity || ''}`)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}" data-next="${e(next)}" data-confirm="${e(confirm)}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${e(title)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  const filter = (part,fields) => `<form class="management-filters" data-command="ui.filter" data-payload="${e(JSON.stringify({path:path(part)}))}">${fields}<button type="submit" class="secondary">查看结果</button>${link('清除筛选',path(part),'secondary')}</form>`;
  const query = ui.query instanceof URLSearchParams?ui.query:new URLSearchParams(ui.query || {});
  const head = (title,subtitle,actions='') => `<header class="page-head"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div><div class="actions">${actions}</div></header>`;
  return {path,link,bookingPath,bookingLink,storeName,techName,canReadReview,form,filter,query,head};
}

function tabs(actor,h,current='cases') {
  const pages=[['cases','反馈案件'],...(staff(actor)?[['followups','人工回访']]:[])];
  return `<nav class="filter-tabs" aria-label="服务质量栏目">${pages.map(([part,title])=>h.link(title,h.path(part),current===part?'active':'')).join('')}</nav>`;
}

const CASE_STATUS={store_pending:'待门店处理',user_pending:'待用户确认',group_pending:'待集团裁决',execution_pending:'待关联事项办结',closed:'已结案',withdrawn:'用户已撤回'};
const FOLLOWUP_STATUS={open:'待联系',working:'跟进中',awaiting_actions:'待问题办结',closed:'已结案'};
const CATEGORY={quality:'服务质量',agreement:'没按约定服务',duration:'时长不足',attitude:'技师态度',other:'其他'};
const KIND={refund:'预约退款',safety:'安全事件',dispute:'服务争议',review:'服务评价',case:'反馈案件',followup:'人工回访',booking:'预约'};
const OUTCOME={reached:'已接通',no_answer:'未接通',refused:'用户拒访',invalid_contact:'联系方式无效'};
const closed=x=>['closed','withdrawn'].includes(x.status);
const badge=(x,isFollowup=false)=>`<span class="tag ${closed(x)?'success':x.overdue?'warning':''}">${e(x.statusLabel || (isFollowup?FOLLOWUP_STATUS:CASE_STATUS)[x.status] || x.status)}</span>`;
const identityNote=()=>note('负责人姓名用于本次 Demo 的责任记录；实际权限仍按工作端、门店和集团岗位校验。');
const evidenceNote=()=>note('可填写证据说明并上传原图片。已提交图片按原案件保存，后续补充合计最多6张。');

function taskForms(x,entity,actor,h) {
  let html='';const payload={entity,id:x.id,version:x.version},next=h.path(entity,x.id);
  if(x.canClaim) html+=details('认领处理',h.form('care.task-claim',payload,field('具体负责人姓名','name','','text','required maxlength="60"'),'确认认领',x.id,next,'确认以当前工作端认领，并记录该负责人姓名？'));
  if(x.canAssign) {
    const scopes=entity==='case'&&(x.ownerScope==='group'||x.status==='user_pending')?[[x.ownerScope,x.ownerScope==='group'?'集团客服':'原服务门店']]:[['store','原服务门店'],['group','集团客服']];
    html+=details('转派责任人',h.form('care.task-assign',payload,select('负责工作端','scope',scopes,x.ownerScope)+field('具体负责人姓名','name','','text','required maxlength="60"')+text('转派依据','reason','required maxlength="500"'),'确认转派',x.id,next,'转派保留原期限、原服务门店及预约归属。确认记录新负责人？'));
  }
  return html?panel('责任分派',identityNote()+html):'';
}
function taskFacts(x,h,isFollowup=false,internal=true) {
  return row('原预约',h.bookingLink(x.bookingId))+row('原服务门店',e(h.storeName(x.storeId)))+row('实际技师',e(h.techName(x.techId)))+(internal?row('负责工作端',e(x.ownerScope==='group'?'集团客服':'原服务门店'))+row('负责人',e((x.assignee?.name || '未指定姓名')+(x.assignee?.claimedAt==null?'（待认领）':'（已认领）'))):'')+row(isFollowup?'原处理期限':'本阶段截止',e(date(x.dueAt)))+(x.nextContactAt?row('下次联系时间',e(date(x.nextContactAt))):'')+(x.overdue?note('已超过处理期限，请由有权工作端跟进。转派和下次联系时间不会延长原期限。',true):'');
}
function relatedLink(x,actor,h) {
  if(x.kind==='case') return h.link(`${KIND[x.kind]} ${x.id}`,h.path('case',x.id));
  if(x.kind==='followup'&&staff(actor)) return h.link(`${KIND[x.kind]} ${x.id}`,h.path('followup',x.id));
  if(x.kind==='review'&&h.canReadReview(x.id)) return h.link(`${KIND[x.kind]} ${x.id}`,`/${actor.role}/reviews/${encodeURIComponent(x.id)}`);
  return `${e(KIND[x.kind] || '关联记录')} ${e(x.id)}`;
}
function linksPanel(x,actor,h) {
  const items=x.links || [],source=x.source?.id?row('案件来源',relatedLink(x.source,actor,h)):'';
  return panel('关联处理事项',source+(items.length?table(['事项','关联说明'],items.map(v=>[relatedLink(v,actor,h),e(v.reason || '')])):'<p class="muted">尚未关联独立事项。</p>')+`<div class="actions">${h.link('查看预约退款与安全记录',h.bookingPath(x.bookingId),'secondary')}</div>`+note('退款、安全和服务争议仍在原预约中办理；此处的反馈结案不会代替原业务执行。')+(x.closureBlockers?.length?note('当前不能结案：'+x.closureBlockers.join('；'),true):''));
}
function statementPanel(x,actor,h) {
  let body=(x.statements || []).length?`<ol class="timeline">${[...x.statements].reverse().map(v=>`<li><p>${e(v.text)}</p><span>${e(actorName(v.by))} · ${e(date(v.at))}</span>${careEvidenceAttachments(x.id,'statement:'+v.id,v.evidenceRefs)}</li>`).join('')}</ol>`:'<p class="muted">暂无补充说明。</p>';
  if(x.canStatement) body+=h.form('care.case-statement',{id:x.id,version:x.version},text(actor.role==='tech'?'本人情况说明':'补充情况说明','text')+careEvidenceUploadFields(6-careEvidenceCount(x)),'提交补充',x.id,h.path('case',x.id),'确认提交这段案件说明及本次选择的图片？');
  return panel(actor.role==='tech'?'本人说明':'补充说明',body);
}
function caseActions(x,actor,h) {
  const payload={id:x.id,version:x.version},next=h.path('case',x.id);let html='';
  if(x.canRespond) html+=panel(x.ownerScope==='group'?'集团处理结果':'门店处理结果',note('公开回复会提供给用户查看，内部备注只向有权处理人员展示。')+h.form('care.case-respond',payload,select('处理结果','decision',[['respond','提出处理结果'],['reject','不予支持并说明依据']],'respond')+text('用户可见的处理回复','publicReply')+text('内部处理备注（用户及技师不可见）','internalNote','maxlength="1000"')+select('是否需要专项处理','specialistAction',[['none','不涉及专项处理'],['penalty','正式处罚待专项处理'],['restriction','限制接单待专项处理'],['retraining','复训待专项处理']],'none'),'提交处理结果',x.id,next,'确认提交此处理结果？如需退款、安全或专项执行，必须按相应事项实际办结。'));
  if(x.canAnswer) html+=panel('确认处理结果',[['accept','接受处理结果'],['escalate','申请集团介入']].map(([decision,title])=>details(title,h.form('care.case-answer',{...payload,decision},text(decision==='escalate'?'申请集团介入原因':'确认说明','reason',`${decision==='escalate'?'required ':''}maxlength="500"`),title,x.id,next,decision==='accept'?'确认接受当前公开处理结果？未结退款和安全事项仍将继续跟进。':'确认将原诉求与处理结果提交集团客服？'))).join(''));
  if(x.canWithdraw) html+=details('撤回反馈',h.form('care.case-answer',{...payload,decision:'withdraw'},text('撤回原因','reason','required maxlength="500"'),'确认撤回',x.id,next,'撤回只结束本条反馈；独立退款、安全及争议继续处理，原记录会保留。'));
  if(x.canNote) html+=details('记录内部备注',h.form('care.case-note',payload,text('内部备注（用户及技师不可见）','text'),'保存内部备注',x.id,next,'确认保存这条内部处理记录？'));
  if(x.canLink) html+=details('关联实际处理记录',h.form('care.case-link',payload,select('事项类型','kind',[['refund','预约退款'],['safety','安全事件'],['dispute','服务争议'],['review','服务评价']],'refund')+field('实际记录编号','targetId','','text','required maxlength="100"')+text('关联依据','reason','required maxlength="500"'),'保存关联',x.id,next,'确认关联同一预约的真实记录？系统会再次核对编号和预约归属。'));
  if(x.canClose) html+=panel('核实结案',h.form('care.case-close',payload,text('结案结论','conclusion'),'确认结案',x.id,next,'确认相关退款、安全、争议及其他执行事项均已实际办结？'));
  return html;
}
function staffHistory(x) {
  let html='';
  if(x.notes?.length) html+=panel('内部备注',`<ol class="timeline">${[...x.notes].reverse().map(v=>`<li><p>${e(v.text)}</p><span>${e(actorName(v.by))} · ${e(date(v.at))}</span></li>`).join('')}</ol>`);
  if(x.history?.length) html+=panel('分派与处理历史',`<ol class="timeline">${[...x.history].reverse().map(v=>`<li><strong>${e(v.text || v.action || v.type || '处理记录')}</strong><p>${e(v.reason || v.conclusion || '')}</p>${v.name?`<p>认领负责人：${e(v.name)}</p>`:''}${v.before||v.after?`<p>${e(v.before?.name || '待认领')}（${v.before?.scope==='group'?'集团客服':'原服务门店'}） → ${e(v.after?.name || '待认领')}（${v.after?.scope==='group'?'集团客服':'原服务门店'}）</p>`:''}<span>${e(actorName(v.by || v.actor))} · ${e(date(v.at))}</span></li>`).join('')}</ol>`);
  return html;
}
function caseDetail(s,x,actor,h) {
  let html=h.head(`反馈 ${x.id}`,'反馈进度与原预约、退款和安全记录关联。',h.link('返回反馈列表',h.path('cases'),'secondary'))+panel('反馈情况',row('当前进度',badge(x))+taskFacts(x,h,false,staff(actor))+row('问题类型',e(CATEGORY[x.category] || x.category))+`<p>${e(x.description)}</p>`+(x.evidence?`<div class="care-evidence-description"><p class="muted">证据说明 / 编号</p><p>${e(x.evidence)}</p></div>`:'')+careEvidenceAttachments(x.id,'evidence',x.evidenceRefs)+row('提交时间',e(date(x.createdAt))));
  const resolutions=x.resolutions || [];
  if(resolutions.length) html+=panel('公开处理回复',`<ol class="timeline">${[...resolutions].reverse().map(v=>`<li><p>${e(v.publicReply)}</p><span>${e(actorName(v.by))} · ${e(date(v.at))}${v.final?' · 集团结论':''}</span>${staff(actor)&&v.internalNote?`<p class="small muted">内部备注：${e(v.internalNote)}</p>`:''}</li>`).join('')}</ol>`);
  else if(x.publicReply) html+=panel('公开处理回复',`<p>${e(x.publicReply)}</p>`);
  if(x.publicHistory?.length) html+=panel('公开处理进度',`<ol class="timeline">${[...x.publicHistory].reverse().map(v=>`<li><p>${e(v.text)}</p><time>${e(date(v.at))}</time></li>`).join('')}</ol>`);
  if(x.confirmationNote) html+=panel('用户确认说明',`<p>${e(x.confirmationNote)}</p>`+(x.confirmedAt?row('确认时间',e(date(x.confirmedAt))):''));
  if(staff(actor)&&x.intakeReason) html+=panel('受理依据',`<p>${e(x.intakeReason)}</p>`);
  if(x.conclusion) html+=panel('结案结论',`<p>${e(x.conclusion)}</p>`);
  if(staff(actor)&&x.specialistActions?.some(v=>!['restriction','retraining'].includes(v.kind))) html+=panel('专项处理待办',note('一般警告须关联原投诉和实际决定入档；限制与复训须按原准入记录办结。较重、严重处罚继续待正式规则，不能用备注代替执行。',true)+table(['事项','状态','依据'],x.specialistActions.flatMap((v,index)=>['restriction','retraining'].includes(v.kind)?[]:[[e(({penalty:'正式处罚',restriction:'限制接单',retraining:'复训'})[v.kind] || v.kind),e(v.kind==='penalty'?(technicianPenaltyCaseResolution(s,x.id,index).complete?'已按实际决定入档':'待实际决定入档'):v.status==='pending'?'待专项处理':v.status),e(v.reason || '')]])));
  html+=statementPanel(x,actor,h)+linksPanel(x,actor,h)+caseActions(x,actor,h);
  if(staff(actor)) html+=taskForms(x,'case',actor,h)+staffHistory(x);
  return html;
}
function followupDetail(x,actor,h,view) {
  const payload={id:x.id,version:x.version},next=h.path('followup',x.id);
  let html=h.head(`回访 ${x.id}`,'人工安排与逐次联系记录；原处理期限固定。',h.link('返回回访列表',h.path('followups'),'secondary'))+panel('回访安排',row('当前进度',badge(x,true))+taskFacts(x,h,true)+row('安排依据',e(x.reason))+row('创建时间',e(date(x.createdAt))));
  html+=panel('联系记录',x.attempts?.length?table(['联系时间','结果','记录','下次联系','记录人'],x.attempts.map(v=>[e(date(v.at)),e(OUTCOME[v.outcome] || v.outcome),e(v.note),e(date(v.nextContactAt)),e(actorName(v.by))])):'<p class="muted">尚未记录联系结果。</p>');
  if(x.canRecord) html+=panel('登记本次联系',h.form('care.followup-record',payload,select('联系结果','outcome',[['','请选择'],...Object.entries(OUTCOME)],'','required')+text('联系情况与用户反馈','note')+field('下次联系时间（未接通或号码无效必填）','nextContactAt','','datetime-local'),'保存联系记录',x.id,next,'确认记录实际联系结果？下次联系时间不会改变原处理期限。'));
  html+=linksPanel(x,actor,h);
  if(x.canLink) {
    const bookingOption=(view.bookingOptions || []).find(v=>(v.bookingId || v.id)===x.bookingId),sourceAllowed=(view.sourceOptions || []).some(v=>v.kind==='followup'&&v.id===x.id&&v.bookingId===x.bookingId),existing=(view.cases || []).find(v=>v.source?.kind==='followup'&&v.source.id===x.id&&!closed(v));
    const createAction=existing?h.link('跟进已登记反馈',h.path('case',existing.id),'secondary'):bookingOption?.canCreateCase&&sourceAllowed?h.link('由回访登记反馈',h.path('new')+'?bookingId='+encodeURIComponent(x.bookingId)+'&sourceKind=followup&sourceId='+encodeURIComponent(x.id),'secondary'):'';
    html+=panel('发现问题后跟进',(createAction?`<div class="actions">${createAction}</div>`:note(bookingOption?.caseCreateReason || '当前工作端不能从此回访新建反馈，请由负责工作端核实。'))+note('若反馈已超过完成后48小时，须由集团客服核实特批；原门店可转派集团跟进。')+details('关联已有反馈案件',h.form('care.followup-link',payload,field('同预约反馈案件编号','caseId','','text','required maxlength="100"')+text('关联依据','reason','required maxlength="500"'),'关联反馈案件',x.id,next,'确认关联同预约的反馈案件并持续跟进？')));
  } else if(x.status!=='closed') html+=note('当前回访由集团客服负责，原门店可查看进度；新增反馈与问题关联请由当前负责工作端办理。');
  if(x.canClose) html+=panel('核实结案',h.form('care.followup-close',payload,text('回访结论','conclusion'),'确认回访结案',x.id,next,'确认联系结果已记录，相关反馈、退款、安全及争议均已实际办结？'));
  if(x.conclusion) html+=panel('回访结论',`<p>${e(x.conclusion)}</p>`);
  return html+taskForms(x,'followup',actor,h)+staffHistory(x);
}

function metric(title,count,target,h) {
  return `<div class="metric"><span>${e(title)}</span><strong>${h.link(String(count),target).replace('<a ',`<a aria-label="${e(`${title} ${count} 项，查看明细`)}" `)}</strong></div>`;
}
function metrics(view,actor,h) {
  const cases=view.cases || [],followups=view.followups || [];
  return `<div class="metrics">${metric('未结反馈',cases.filter(x=>!closed(x)).length,h.path('cases')+'?status=open',h)}${metric('逾期待处理',cases.filter(x=>!closed(x)&&x.overdue).length,h.path('cases')+'?status=overdue',h)}${staff(actor)?metric('反馈待认领',cases.filter(x=>!closed(x)&&x.assignee?.claimedAt==null).length,h.path('cases')+'?status=unclaimed',h)+metric('未结人工回访',followups.filter(x=>!closed(x)).length,h.path('followups')+'?status=open',h):''}</div>`;
}
function filtered(records,h) {
  const status=h.query.get('status') || '',q=(h.query.get('q') || h.query.get('bookingId') || '').trim().toLowerCase();
  return records.filter(x=>(!q||[x.id,x.bookingId].some(v=>String(v).toLowerCase().includes(q)))&&(!status||status==='open'&&!closed(x)||status==='overdue'&&!closed(x)&&x.overdue||status==='unclaimed'&&!closed(x)&&x.assignee?.claimedAt==null||x.status===status)).sort((a,b)=>(b.createdAt || 0)-(a.createdAt || 0));
}
function listPage(view,actor,h,isFollowup=false) {
  const part=isFollowup?'followups':'cases',records=filtered(view[part] || [],h),states=isFollowup?FOLLOWUP_STATUS:CASE_STATUS;
  let html=h.head(isFollowup?'人工回访':'反馈案件',isFollowup?'按实际情况安排，逐次记录联系与问题处理。':actor.role==='tech'?'查看本人关联反馈并补充本人说明。':'查看服务问题、处理进度与关联事项。')+tabs(actor,h,part)+metrics(view,actor,h);
  html+=panel('查找记录',h.filter(part,select('状态','status',[['','全部'],['open','全部未结'],['overdue','逾期未结'],...(staff(actor)?[['unclaimed','待认领']]:[]),...Object.entries(states).filter(([key])=>key!=='open')],h.query.get('status') || '')+field('反馈 / 回访 / 预约编号','q',h.query.get('q') || h.query.get('bookingId') || '','search')));
  if(isFollowup&&view.canCreateFollowup) html+=`<div class="actions">${h.link('安排人工回访',h.path('followups/new'),'secondary')}</div>`;
  html+=panel(isFollowup?'回访记录':'反馈记录',records.length?`<div class="card-list">${records.map(x=>`<article class="list-card"><div class="row"><strong>${e(x.id)}</strong>${badge(x,isFollowup)}</div><p>${h.bookingLink(x.bookingId)} · ${e(h.storeName(x.storeId))}</p><p>${e(isFollowup?x.reason:CATEGORY[x.category] || x.category)}</p>${staff(actor)?`<p class="small muted">负责人：${e((x.assignee?.name || '未指定姓名')+(x.assignee?.claimedAt==null?'（待认领）':'（已认领）'))} · ${e(x.ownerScope==='group'?'集团客服':'原服务门店')}</p>`:''}<p class="small muted">${isFollowup?'原处理期限':'当前截止'}：${e(date(x.dueAt))}${x.overdue?' · 已逾期':''}</p><div class="actions">${h.link('查看详情',h.path(isFollowup?'followup':'case',x.id),'secondary')}</div></article>`).join('')}</div>`:empty(isFollowup?'暂无人工回访':'暂无反馈案件',isFollowup?'有权人员可按实际依据安排回访，不会自动生成历史回访记录。':'可从原预约详情进入反馈，原退款与安全入口保持可用。'));
  return html;
}
function newPage(view,actor,h,isFollowup=false) {
  const allowed=isFollowup?view.canCreateFollowup:view.canCreateCase;
  if(!allowed) return empty('当前身份无权提交此项',isFollowup?'人工回访由原门店或集团客服安排。':'请由本人用户或获授权处理人员从原预约进入。');
  const options=(view.bookingOptions || []).filter(x=>!isFollowup||x.completed),bookingId=h.query.get('bookingId') || '',selected=options.find(x=>(x.bookingId || x.id)===bookingId),base=isFollowup?'followups/new':'new';
  let html=h.head(isFollowup?'安排人工回访':'提交服务反馈','保留原预约与已记录事实。',h.link('返回列表',h.path(isFollowup?'followups':'cases'),'secondary'));
  html+=panel('关联原预约',h.filter(base,select('原预约','bookingId',[['','请选择已完成预约'],...options.map(x=>[x.bookingId || x.id,x.label || x.bookingId || x.id])],bookingId,'required')));
  if(!selected) return html+note(bookingId?'当前预约不存在、不可处理或无权查看。':'先选择原预约，核对是否符合本次办理条件。',Boolean(bookingId));
  html+=panel('原预约',row('预约',h.bookingLink(bookingId))+row('服务门店',e(h.storeName(selected.storeId)))+row('服务完成',e(date(selected.completedAt))));
  if(isFollowup) {
    const caseId=h.query.get('caseId') || '',related=(view.cases || []).find(x=>x.id===caseId&&x.bookingId===bookingId);
    if(caseId&&!related) return html+note('关联反馈不存在、不属于同一预约或当前无权查看。',true);
    return html+panel('人工回访安排',identityNote()+h.form('care.followup-create',{bookingId,...(caseId?{caseId}:{})},text('安排依据','reason','required maxlength="1000"')+select('负责工作端','scope',[['','请选择'],['store','原服务门店'],['group','集团客服']],'','required')+field('具体负责人姓名','name','','text','required maxlength="60"')+field('处理期限','dueAt','','datetime-local','required'),'安排回访',`new:${bookingId}`,h.path('followups'),'确认按以上实际依据安排人工回访？处理期限不会因转派或下次联系时间延长。'));
  }
  if(!selected.canCreateCase) return html+note(selected.caseCreateReason || '当前不能新建反馈。',true)+(actor.role==='user'?note('完成后48小时内可在此提交反馈。超期请联系门店客服；集团可在完成后30天内按实际诉求核实特批。')+`<div class="actions">${h.link('联系原门店',h.bookingPath(bookingId)+'/contact-store','secondary')}</div>`:'');
  const sourceKind=h.query.get('sourceKind'),sourceId=h.query.get('sourceId'),source=(view.sourceOptions || []).find(x=>x.kind===sourceKind&&x.id===sourceId&&x.bookingId===bookingId);
  if((sourceKind||sourceId)&&!source) return html+note('来源记录不存在、无权查看或不属于同一预约。请从原记录重新进入。',true);
  if(source) html+=panel('反馈来源',row('原记录',relatedLink(source,actor,h)));
  const payload={bookingId,...(source?{sourceKind,sourceId}:{})};
  return html+panel('情况与诉求',note('此入口只提交质量反馈。需要退款或安全协助时，仍须在原预约中登记相应事项。')+evidenceNote()+h.form('care.case-create',payload,select('问题类型','category',[['','请选择'],...Object.entries(CATEGORY)],'','required')+text('情况说明与原诉求（仅反馈）','description')+text('证据说明或凭证编号（可选）','evidence','maxlength="1000"')+careEvidenceUploadFields()+(staff(actor)?text(selected.withinUserWindow?'受理依据':'集团特批受理依据','reason','required maxlength="1000"'):''),'提交反馈',`new:${bookingId}:${sourceKind || ''}:${sourceId || ''}`,h.path('cases'),'确认按原预约提交此反馈及本次选择的图片？该操作不会生成退款或修改原预约。'));
}

export function careView(s,actor,parts=[],ui={}) {
  if(parts[0]!=='care') return null;
  if(!canEnter(actor)) return empty('当前身份无权查看反馈与回访','服务质量处理仅向本人、原门店及集团客服开放。');
  const h=helpers(s,actor,ui),view=careModelView(s,actor),part=parts[1] || 'cases';
  if(part==='new') return newPage(view,actor,h);
  if(part==='case') {const item=(view.cases || []).find(x=>x.id===parts[2]);return item?caseDetail(s,item,actor,h)+qualificationCarePanel(s,actor,item,ui)+technicianPenaltyCarePanel(s,actor,item,ui)+(staff(actor)&&view.canCreateFollowup?panel('人工跟进',h.link('按此案件安排回访',h.path('followups/new')+'?bookingId='+encodeURIComponent(item.bookingId)+'&caseId='+encodeURIComponent(item.id),'secondary')):''):empty('反馈不存在或无权查看');}
  if(['followups','followup'].includes(part)&&!staff(actor)) return empty('当前身份无权查看人工回访','用户查看本人反馈进度，技师补充本人案件说明。');
  if(part==='followups'&&parts[2]==='new') return newPage(view,actor,h,true);
  if(part==='followup') {const item=(view.followups || []).find(x=>x.id===parts[2]);return item?followupDetail(item,actor,h,view):empty('回访不存在或无权查看');}
  if(!['cases','followups'].includes(part)) return empty('页面不存在');
  return listPage(view,actor,h,part==='followups');
}
export function careSummary(s,actor,ui={}) {
  if(!canEnter(actor)) return '';
  const h=helpers(s,actor,ui),view=careModelView(s,actor);
  return panel(actor.role==='user'?'我的反馈':actor.role==='tech'?'本人反馈说明':'反馈与回访待办',metrics(view,actor,h)+h.link('查看反馈进度',h.path('cases'),'secondary'));
}
export function careBookingPanel(s,actor,b,ui={}) {
  if(!canEnter(actor)||!b) return '';
  const h=helpers(s,actor,ui),view=careModelView(s,actor),records=(view.cases || []).filter(x=>x.bookingId===b.id),option=(view.bookingOptions || []).find(x=>(x.bookingId || x.id)===b.id);
  const owns=actor.role==='user'?actor.userId===b.userId:actor.role==='tech'?actor.techId===b.techId:['store','manager'].includes(actor.role)?actor.storeId===b.storeId:groupSupport(actor);
  if(!owns&&!records.length) return '';
  let html=records.length?table(['反馈','当前进度','截止'],records.map(x=>[h.link(x.id,h.path('case',x.id)),badge(x),e(date(x.dueAt))])):'<p class="muted">暂无服务质量反馈。</p>';
  const actions=[];
  if(view.canCreateCase&&option?.canCreateCase) actions.push(h.link('提交服务反馈',h.path('new')+'?bookingId='+encodeURIComponent(b.id),'secondary'));
  else if(actor.role==='user'&&b.status==='done') html+=note(option?.caseCreateReason || '请联系原门店客服核实反馈受理条件。')+note('完成后48小时内可在线提交。超期请联系门店；集团可在完成后30天内核实特批。');
  if(staff(actor)&&view.canCreateFollowup&&option?.completed) actions.push(h.link('安排人工回访',h.path('followups/new')+'?bookingId='+encodeURIComponent(b.id),'secondary'));
  if(actor.role==='user'&&b.status==='done'&&!option?.canCreateCase) actions.push(h.link('联系原门店',h.bookingPath(b.id)+'/contact-store','secondary'));
  if(actions.length) html+=`<div class="actions">${actions.join('')}</div>`;
  return panel(actor.role==='tech'?'本人相关反馈':'服务质量反馈',html);
}
