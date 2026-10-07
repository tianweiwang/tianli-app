// Qualification forms reuse the existing management UI; the model owns every transition.
import { qualificationView } from './tech-qualification.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Date(Number(value)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const panel = (title,body) => `<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const note = (body,warning=false) => `<p class="notice${warning?' warning':''}">${e(body)}</p>`;
const row = (title,body) => `<div class="row"><span class="muted">${e(title)}</span><span>${body}</span></div>`;
const empty = (title,body='') => `<section class="panel empty"><h2>${e(title)}</h2><p>${e(body)}</p></section>`;
const details = (title,body) => `<details class="action-details"><summary>${e(title)}</summary>${body}</details>`;
const badge = (title,kind='') => `<span class="tag ${e(kind)}">${e(title)}</span>`;
const field = (title,name,value='',type='text',attrs='required maxlength="100"') => `<label class="field"><span>${e(title)}</span><input type="${e(type)}" name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
const text = (title,name='reason',value='') => `<label class="field wide"><span>${e(title)}</span><textarea name="${e(name)}" required maxlength="1000" rows="3">${e(value)}</textarea></label>`;
const select = (title,name,options,value='',attrs='required') => `<label class="field"><span>${e(title)}</span><select name="${e(name)}" ${attrs}>${options.map(([id,title])=>`<option value="${e(id)}"${String(id)===String(value)?' selected':''}>${e(title)}</option>`).join('')}</select></label>`;
const table = (heads,rows) => rows.length?`<div class="table-wrap"><table><thead><tr>${heads.map(title=>`<th>${e(title)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(body=>`<td>${body}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="muted">暂无相关记录。</p>';
const KINDS={initial:'培训考核',mature:'成熟技师名单核验',retraining:'关联暂停复训'};
const GRANTS={pending:'待集团审核',approved:'授权已批准',rejected:'授权未通过'};
const ACTIONS={'qualification.assess':'登记实际考核','qualification.request':'申请独立授权','qualification.review':'集团审核授权','qualification.pause':'登记项目暂停','qualification.resume':'集团确认恢复'};
const ACTORS={tech:'本人技师',store:'门店后台',manager:'本店店长',group:'集团后台'};
const authorLabel = actor => actor?.accountId ? `${actor.accountName || '工作员工'} · ${actor.accountId}` : ACTORS[actor?.role] || '';
const BOOKING={unpaid:'待支付',waiting:'待接单',confirmed:'已接单',active:'服务中',done:'已完成',cancelled:'已取消',closed:'已关闭'};
const roleScope = actor => `${actor.role}:${actor.userId || ''}:${actor.techId || ''}:${actor.storeId || ''}:${actor.role==='group'?actor.job || 'all':''}`;

export function qualificationEvidenceAttachments(profileId,source,files=[]) {
  if(!profileId||!files.length)return '';
  return `<div class="qualification-evidence">${files.map((file,index)=>`<div data-invoice-file="${e(file.ref)}" data-invoice-domain="qualification" data-invoice-id="${e(profileId)}" data-invoice-slot="${e(source+':'+index)}"><p>${e(file.name)} · ${e(file.type)}</p><div class="actions"><button type="button" class="secondary" data-invoice-action="view" aria-expanded="false" disabled>查看原资格凭证</button><a class="secondary" data-invoice-action="download" aria-disabled="true">下载原凭证</a></div><p class="small muted" data-invoice-file-status role="status">正在读取实际凭证…</p><section class="invoice-inline-preview" data-invoice-preview role="region" aria-label="原资格凭证预览" hidden><div class="invoice-preview-heading"><h3>原资格凭证预览</h3><button type="button" class="secondary" data-invoice-action="close-preview">关闭预览</button></div><p class="small muted" data-invoice-preview-status role="status"></p><div data-invoice-preview-content></div></section></div>`).join('')}</div>`;
}
export function qualificationEvidenceUploadFields() {
  return `<fieldset class="field wide"><legend>实际资格凭证（可选）</legend><input type="hidden" name="evidenceRefs" value="[]"><label class="field"><span>选择实际凭证文件</span><input type="file" accept="application/pdf,image/png,image/jpeg" multiple data-qualification-upload></label><p class="small muted">支持PDF、PNG或JPEG，本机演示每份文件须在5 MiB以内。可以先选择文件，再填写考核或处理事实。</p><p class="small muted" data-qualification-upload-status role="status">尚未选择实际凭证。</p><ul class="small" data-qualification-selected-files></ul><div class="actions"><button type="button" class="secondary" data-qualification-clear disabled>清除本次选择</button></div></fieldset>`;
}

function helpers(s,actor,ui={}) {
  const path = id => `/${actor.role}/qualifications${id?'/'+encodeURIComponent(id):''}${id&&ui.qualificationSelection?`?profileId=${encodeURIComponent(ui.qualificationSelection.profileId)}&storeId=${encodeURIComponent(ui.qualificationSelection.storeId)}`:''}`;
  const link = (title,target,kind='') => `<a class="${e(kind)}" href="#${e(target)}">${e(title)}</a>`;
  const bookingLink = id => actor.role==='group'&&actor.job==='operations'?e(id):link(id,`/${actor.role}/bookings/${encodeURIComponent(id)}`);
  const serviceName = id => s.services?.find(x=>x.id===id)?.name || id;
  const serviceNames = ids => (ids || []).map(serviceName).join('、') || '未记录项目';
  const head = (title,body,actions='') => `<header class="page-head"><div><h1>${e(title)}</h1><p>${e(body)}</p></div><div class="actions">${actions}</div></header>`;
  const query = ui.query instanceof URLSearchParams?ui.query:new URLSearchParams(ui.query || {});
  const form = (command,payload,fields,title,key,confirm) => `<form class="management-form" data-management-form="${e(`qualification:${roleScope(actor)}:${payload.techId}:${command}:${key}:profile:${payload.profileId||payload.techId}:store:${payload.storeId}`)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}" data-next="${e(path(payload.techId))}" data-confirm="${e(confirm)}"><div class="management-grid">${fields}${qualificationEvidenceUploadFields()}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${e(title)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  return {path,link,bookingLink,serviceName,serviceNames,head,query,form};
}
function serviceChecks(t,ids=t.serviceIds) {
  const options=(ids || []).map(id=>t.services.find(x=>x.id===id) || {id,name:id});
  return `<fieldset class="field wide"><legend>本次覆盖项目（至少一项）</legend>${options.map(x=>`<label class="check-row"><input type="checkbox" name="serviceIds" value="${e(x.id)}"><span>${e(x.name)}</span></label>`).join('')}</fieldset>`;
}
function basePayload(t,extra={}) {return {techId:t.techId || t.id,storeId:t.storeId,...(t.profileId?{profileId:t.profileId}:{}),version:t.version,...extra};}
function legacyNote(t) {
  return t.legacy?note('历史演示资格，待补录。仅保留迁移时已有的项目范围；这些记录没有真实考核和授权凭据，不能作为正式准入验收。',true):'';
}
function projectPanel(t) {
  return panel('当前项目资格',legacyNote(t)+table(['项目','当前资格','核验结果'],(t.services || []).map(x=>[e(x.name),badge(x.allowed?(x.legacy?'历史演示资格':'项目授权有效'):'项目资格暂不可用',x.allowed?'success':'warning'),e(x.reason || (x.legacy?'待补录正式考核和授权':'已有项目授权'))]))+note('资料审核、证书保单与项目授权分别核验。项目授权不代替原资料审核，修改技师项目也不会自动扩大授权范围；可接单状态还须满足证书保单、在岗及排班等条件。'));
}
function impactsPanel(impacts,actor,h,snapshot=false) {
  if(!(impacts || []).length) return '<p class="muted">当前没有需要核对的受影响预约。</p>';
  return table(['原预约','涉及项目 / 时间','安排与履约事实',snapshot?'当时处理要求':'处理要求'],impacts.map(x=>[h.bookingLink(x.bookingId),`${e(h.serviceName(x.serviceId))}<small>${e(date(x.startAt))}</small>`,`${e(BOOKING[x.status] || x.status)}<small>${e([x.current?'原预约技师':'',x.proposed?'待确认变更候选':''].filter(Boolean).join('、'))}</small>`,x.stage==='fulfilling'?'已发生履约；保留原完成、求助、中止及退款入口':x.needsCoordination?badge(snapshot?'暂停时需协调':'待原门店 / 客服协调','warning'):'当前安排已不受本次暂停影响']))+note(snapshot?'以上为登记暂停时保留的历史事实；是否仍需协调以当前受影响预约为准。':actor.role==='group'&&actor.job==='operations'?'请将待协调预约交原门店或集团客服，从原预约改派、改约或取消；运营岗位不新增预约处置权限。':'待协调事项从原预约改派、改约或取消。暂停不会重置派单期限、强行换人或修改已发生履约事实。');
}
function assessmentFields(t,hold=null) {
  return (hold?row('复训覆盖项目',e((hold.serviceIds || []).map(id=>t.services.find(x=>x.id===id)?.name || id).join('、'))):select('考核方式','kind',[['initial',KINDS.initial],['mature',KINDS.mature]])+serviceChecks(t))+
    field('培训 / 审核批次','batch')+field('实际考核人','assessor')+field('实际考核时间（北京时间）','occurredAt','','datetime-local','required')+select('实际考核结果','result',[['','请选择结果'],['pass','通过'],['fail','未通过']])+field('考核凭证编号','proof')+text('考核事实与依据');
}
function assessmentPanel(t,actor,h) {
  let body='';
  if(t.canAssess) body+=details('登记实际考核 / 名单核验',note('只登记已经发生的实际考核或核验；批次、考核人和凭证编号均需填写。本地记录编号不代表已上传或核验真实附件。')+(!t.hasProfile&&t.legacy?note('首次补录即建立正式资格档案，原兼容资格停止适用；完成集团授权前不能新接相应项目。',true):'')+h.form('qualification.assess',basePayload(t),assessmentFields(t),'保存考核记录','initial','确认记录这次实际考核？记录保存后不可覆盖；通过考核不会自动获得独立服务授权。'));
  const records=[...(t.assessments || [])].reverse();
  body+=records.length?records.map(a=>{
    let content=row('考核方式',e(KINDS[a.kind] || a.kind))+row('项目',e(h.serviceNames(a.serviceIds)))+row('发生时间',e(date(a.occurredAt)))+row('考核结果',badge(a.result==='pass'?'通过':'未通过',a.result==='pass'?'success':'warning'))+(a.holdId?row('关联暂停',e(a.holdId)):'');
    if(actor.role!=='tech') content+=row('批次 / 考核人',e(`${a.batch || '—'} / ${a.assessor || '—'}`))+row('凭证编号',e(a.proof || '—'))+row('依据',e(a.reason || '—'))+qualificationEvidenceAttachments(t.profileId,`assessment:${a.id}`,a.evidenceRefs);
    const grants=(t.grants || []).filter(g=>g.assessmentId===a.id);
    content+=grants.length?row('授权申请',grants.map(g=>`${e(g.id)} · ${e(GRANTS[g.status] || g.status)}`).join('<br>')):'';
    if(t.canRequest&&a.result==='pass'&&!grants.length) content+=h.form('qualification.request',basePayload(t,{assessmentId:a.id}),text('授权申请依据'),'申请独立授权',`assessment:${a.id}`,'确认按该次通过考核的项目申请独立授权？申请须由集团审核，未获批准前不能作为服务资格。');
    return details(`${a.id} · ${KINDS[a.kind] || a.kind} · ${a.result==='pass'?'通过':'未通过'}`,content);
  }).join(''):'<p class="muted">尚未登记实际考核。不会自动生成培训、审核人或凭据。</p>';
  return panel('实际考核记录',body);
}
function grantsPanel(t,actor,h) {
  const grants=[...(t.grants || [])].reverse();
  return panel('独立授权申请与审核',grants.length?grants.map(g=>{
    let content=row('项目',e(h.serviceNames(g.serviceIds)))+row('考核记录',e(g.assessmentId))+row('申请时间',e(date(g.requestedAt)))+row('审核进度',badge(GRANTS[g.status] || g.status,g.status==='pending'?'warning':g.status==='approved'?'success':''));
    if(actor.role!=='tech')content+=qualificationEvidenceAttachments(t.profileId,`request:${g.id}`,g.evidenceRefs);
    if(g.review) content+=row('审核时间',e(date(g.review.at)))+(actor.role!=='tech'?row('实际审核人',e(g.review.reviewer || '—'))+row('授权凭证编号',e(g.review.proof || '—'))+row('审核依据',e(g.review.reason || '—')):'');
    if(actor.role!=='tech'&&g.review)content+=qualificationEvidenceAttachments(t.profileId,`review:${g.id}`,g.review.evidenceRefs);
    if(t.canReview&&g.status==='pending') content+=h.form('qualification.review',basePayload(t,{grantId:g.id}),select('审核结论','decision',[['','请选择结论'],['approve','批准独立授权'],['reject','不批准']])+field('实际审核人','reviewer')+field('审核 / 授权凭证编号','proof')+text('审核事实与依据'),'保存集团审核',`grant:${g.id}`,'确认保存集团审核结论？批准只覆盖本次项目；已有暂停仍须完成复训和明确恢复。');
    return details(`${g.id} · ${GRANTS[g.status] || g.status}`,content);
  }).join(''):'<p class="muted">暂无独立授权申请。通过考核后需由门店提交并等待集团审核。</p>');
}
function sourceCase(s,t,h) {
  const caseId=h.query.get('caseId'),indexText=h.query.get('actionIndex'),versionText=h.query.get('caseVersion');
  if(!caseId&&!indexText&&!versionText) return {source:null};
  const c=(s.serviceCareCases || []).find(c=>c.id===caseId),index=Number(indexText),version=Number(versionText);
  if(!c||c.techId!==t.techId||c.storeId!==t.storeId||!/^\d+$/.test(indexText || '')||!/^\d+$/.test(versionText || '')||!Number.isSafeInteger(index)||!Number.isSafeInteger(version)||c.version!==version) return {error:'反馈来源已更新、不属于当前技师或无效。请返回原案件核对后重新进入。'};
  const action=c.specialistActions?.[index];
  if(!action||!['restriction','retraining'].includes(action.kind)||action.status==='completed'||action.qualificationHoldId) return {error:'该反馈事项不能再新建关联暂停，请从原反馈查看已有处理记录。'};
  return {source:{caseId:c.id,actionIndex:index,caseVersion:version},case:c,action};
}
function pausePanel(s,t,actor,h) {
  if(!t.canPause) return '';
  const source=sourceCase(s,t,h);
  if(source.error) return panel('来自反馈的专项处理',note(source.error,true));
  const heading=source.source?'登记此反馈的项目暂停':'登记项目暂停';
  const body=(source.source?row('关联反馈',e(source.source.caseId))+row('待办事项',e(source.action.kind==='restriction'?'限制接单':'复训'))+note('来源已锁定此技师及原反馈版本。只有真实暂停、复训、再授权和恢复均核验完成后，专项才可办结。'):'')+note('暂停立即阻止这些项目的新安排，原预约状态和期限保持；请先核实影响预约并安排负责人。暂停不设自动结束日期。',true)+(!t.hasProfile&&t.legacy?note('首次登记会建立正式资格档案，原历史兼容资格停止适用；未获得实际授权的其他项目也不能新接单。',true):'')+h.form('qualification.pause',basePayload(t,source.source || {}),serviceChecks(t)+field('复训跟进负责人','owner','','text','required maxlength="60"')+text('暂停事实与核实依据'),'确认项目暂停',source.source?`case:${source.source.caseId}:${source.source.actionIndex}`:'manual','确认按所选项目登记暂停？新安排将受限，原预约仍需原门店或客服协调；恢复必须完成实际复训及集团再授权。');
  return panel(heading,source.source?body:details('核实后登记暂停',body));
}
function holdPanel(t,hold,actor,h) {
  let body=row('涉及项目',e(h.serviceNames(hold.serviceIds)))+row('处理状态',badge(hold.status==='resolved'?'已恢复':'暂停中',hold.status==='resolved'?'success':'warning'))+row('登记时间',e(date(hold.startedAt)));
  if(actor.role!=='tech') body+=row('复训负责人',e(hold.owner || '—'))+row('暂停依据',e(hold.reason || '—'))+(hold.source?row('来源反馈',actor.role==='group'&&actor.job==='operations'?e(hold.source.caseId):h.link(hold.source.caseId,`/${actor.role}/care/case/${encodeURIComponent(hold.source.caseId)}`)):'');
  if(actor.role!=='tech')body+=qualificationEvidenceAttachments(t.profileId,`pause:${hold.id}`,hold.evidenceRefs);
  if(hold.resolution) body+=row('恢复时间',e(date(hold.resolution.at)))+row('复训考核 / 新授权',e(`${hold.resolution.assessmentId} / ${hold.resolution.grantId}`))+(actor.role!=='tech'?row('恢复审核人',e(hold.resolution.reviewer || '—'))+row('恢复依据',e(hold.resolution.reason || '—')):'');
  if(actor.role!=='tech'&&hold.resolution)body+=qualificationEvidenceAttachments(t.profileId,`resume:${hold.id}`,hold.resolution.evidenceRefs);
  const impacts=hold.currentImpacts || [];
  if(actor.role!=='tech') body+=details('当前受影响预约',impactsPanel(impacts,actor,h))+(hold.impacts?.length?details('暂停时的预约快照',impactsPanel(hold.impacts,actor,h,true)): '');
  if(hold.status==='open') {
    if(t.canAssess) body+=details('登记该次暂停的实际复训',h.form('qualification.assess',basePayload(t,{kind:'retraining',holdId:hold.id,serviceIds:hold.serviceIds}),assessmentFields(t,hold),'保存复训考核',`retraining:${hold.id}`,'确认保存针对这次暂停的实际复训记录？复训覆盖暂停全部项目，通过后还须申请新授权并由集团明确恢复。'));
    const assessments=(t.assessments || []).filter(a=>a.holdId===hold.id&&a.kind==='retraining'&&a.result==='pass');
    const approved=(t.grants || []).find(g=>g.status==='approved'&&assessments.some(a=>a.id===g.assessmentId));
    const blocked=Boolean(hold.unresolvedImpacts?.length);
    if(t.canResume&&hold.readyForResume) body+=h.form('qualification.resume',basePayload(t,{holdId:hold.id}),field('恢复核验人','reviewer')+text('恢复核验依据'),'确认恢复此项',`resume:${hold.id}`,'确认本次复训、新授权、当前证书保单及受影响预约均已核验？只恢复这一次暂停，其他未完成暂停继续生效。');
    else body+=note(blocked?'未开始预约仍待协调，暂不能恢复此项。':!approved?'等待本次暂停关联的复训通过及集团批准新授权；之后由集团核验并明确恢复。':!hold.readyForResume?'已有复训和新授权，请核对当前证书保单、资料审核及项目状态后再恢复。':'复训与新授权已有记录，等待集团运营核验并明确恢复。');
  }
  return details(`${hold.id} · ${hold.status==='resolved'?'已恢复':'暂停中'} · ${h.serviceNames(hold.serviceIds)}`,body);
}
function historyPanel(t,actor) {
  const records=[...(t.history || [])].reverse();
  return panel('资格处理历史',records.length?`<ol class="timeline">${records.map(x=>`<li><p>${e(ACTIONS[x.action || x.type] || x.action || x.type || '资格变更')} · ${e(date(x.at))}${x.version!=null?' · v'+e(x.version):''}</p><small>${e(authorLabel(x.by || x.actor))}</small>${actor.role!=='tech'&&x.reason?`<p>${e(x.reason)}</p>`:''}${actor.role!=='tech'?qualificationEvidenceAttachments(t.profileId,`history:${x.version}`,x.evidenceRefs):''}</li>`).join('')}</ol>`:'<p class="muted">暂无实际资格处理历史。</p>');
}

export function qualificationUiView(s,actor,parts=[],ui={}) {
  if(parts[0]!=='qualifications') return null;
  const query=ui.query instanceof URLSearchParams?ui.query:new URLSearchParams(ui.query || {});
  let selection,view;
  try{
    actor=resolveAccountActor(s,actor);
    if(query.has('profileId')||parts.length===2&&query.has('storeId')){
      if(parts.length!==2||[...query.keys()].some(k=>!['profileId','storeId'].includes(k))||query.getAll('profileId').length!==1||query.getAll('storeId').length!==1)throw Error('资格档案来源已失效');
      selection={techId:parts[1],profileId:query.get('profileId'),storeId:query.get('storeId')};
    }
    view=qualificationView(s,actor,selection);
  }catch{return empty('资格档案不存在或当前身份无权查看，原来源已失效');}
  const h=helpers(s,actor,{...ui,...(selection?{qualificationSelection:selection}:{})});
  if(!view.canRead) return empty('当前身份无权查看独立服务准入','仅本人技师、原门店、集团运营及客服可按各自职责查看。');
  if(parts.length>2) return empty('页面不存在');
  const id=parts[1];
  if(!id) {
    const q=(h.query.get('q') || '').trim().toLowerCase(),status=h.query.get('status') || '';
    const items=view.technicians.filter(t=>(!q||[t.name,t.techId,t.storeName].some(v=>String(v || '').toLowerCase().includes(q)))&&(!status||status==='legacy'&&t.legacy||status==='pending'&&t.grants.some(g=>g.status==='pending')||status==='paused'&&t.holds.some(x=>x.status==='open')||status==='unqualified'&&t.services.some(x=>!x.allowed)));
    const filters=`<form class="management-filters" data-command="ui.filter" data-payload="${e(JSON.stringify({path:h.path()}))}">${field('姓名 / 技师编号 / 门店','q',h.query.get('q') || '','search','')}${select('处理范围','status',[['','全部'],['legacy','历史演示待补录'],['pending','待集团授权'],['paused','有未恢复暂停'],['unqualified','有未授权项目']],status,'')}<button type="submit" class="secondary">筛选</button>${h.link('清除筛选',h.path(),'secondary')}</form>`;
    return h.head('独立服务准入',actor.role==='tech'?'查看本人项目资格、考核结果与复训进度。':'实际考核 → 独立授权 → 项目暂停 → 复训再授权 → 集团恢复。')+panel('查找技师资格',filters)+panel('技师项目资格',table(['技师 / 门店','项目资格','待处理','操作'],items.map(t=>[`${e(t.name)}<small>${e(t.techId)} · ${e(t.storeName)}</small>`,`${e(t.services.filter(x=>x.allowed).length)} / ${e(t.services.length)} 项具备项目资格${t.legacy?'<small>历史演示资格，待补录</small>':''}`,`${e(t.grants.filter(g=>g.status==='pending').length)} 项授权待审<small>${e(t.holds.filter(x=>x.status==='open').length)} 项暂停未恢复</small>`,h.link('查看资格档案',h.path(t.techId))])))+note('本批为人工准入和复训闭环；正式培训体系、处罚等级、停单天数与人事决策未在此实施。');
  }
  const t=view.technicians.find(x=>x.techId===id || x.id===id);
  if(!t) return empty('资格档案不存在或无权查看')+h.link('返回资格列表',h.path(),'secondary');
  return h.head(`${t.name} · 独立服务准入`,`${t.storeName} · 资格档案第 ${t.version} 版`,h.link('返回资格列表',h.path(),'secondary'))+projectPanel(t)+pausePanel(s,t,actor,h)+(actor.role!=='tech'?panel('当前受影响预约',impactsPanel(t.impacts,actor,h)):'')+assessmentPanel(t,actor,h)+grantsPanel(t,actor,h)+panel('项目暂停与恢复',(t.holds || []).length?[...t.holds].reverse().map(x=>holdPanel(t,x,actor,h)).join(''):'<p class="muted">暂无项目暂停记录。</p>')+historyPanel(t,actor)+note('暂停与授权不直接退款、结案或施加正式处罚。资料审核、证书保单和其他未恢复暂停仍分别生效。');
}
export function qualificationTechPanel(s,actor,tech,ui={}) {
  if(!tech) return '';
  const view=qualificationView(s,actor),t=view.technicians.find(x=>x.techId===tech.id || x.id===tech.id);
  if(!view.canRead||!t) return '';
  const h=helpers(s,actor,ui);
  return panel('独立服务准入',legacyNote(t)+row('当前有效项目',e(t.services.filter(x=>x.allowed).map(x=>x.name).join('、') || '暂无有效项目资格'))+row('待集团授权',e(t.grants.filter(x=>x.status==='pending').length+' 项'))+row('未恢复暂停',e(t.holds.filter(x=>x.status==='open').length+' 项'))+`<div class="actions">${h.link('查看考核与项目授权',h.path(t.techId),'secondary')}</div>`+note('接单还须通过原资料审核、有效证书保单及排班等检查。'));
}
export function qualificationCarePanel(s,actor,c,ui={}) {
  if(!c||['user','tech'].includes(actor.role)) return '';
  const view=qualificationView(s,actor),t=view.technicians.find(x=>x.techId===c.techId&&x.storeId===c.storeId);
  if(!view.canRead||!t) return '';
  const h=helpers(s,actor,ui),items=(c.specialistActions || []).map((action,index)=>({action,index})).filter(({action})=>['restriction','retraining'].includes(action.kind));
  if(!items.length) return '';
  const body=items.map(({action,index})=>{
    const hold=t.holds.find(x=>x.id===action.qualificationHoldId&&x.source?.caseId===c.id&&x.source?.actionIndex===index);
    if(hold) return row(action.kind==='restriction'?'限制接单专项':'复训专项',`${e(hold.id)} · ${e(hold.status==='resolved'?'已恢复':'暂停与复训跟进中')} ${h.link('查看真实处理记录',h.path(t.techId),'secondary')}`);
    if(action.qualificationHoldId||action.status==='completed') return note('该专项没有可追溯且匹配的资格暂停记录，请由原负责人核实。',true);
    const target=h.path(t.techId)+'?'+new URLSearchParams({caseId:c.id,actionIndex:String(index),caseVersion:String(c.version)}).toString();
    return row(action.kind==='restriction'?'限制接单专项':'复训专项',t.canPause?h.link('核实并登记关联暂停',target,'secondary'):e('等待有权负责人登记关联项目暂停'));
  }).join('');
  return panel('准入与复训专项',body+note('专项依据真实暂停、复训、授权和恢复记录核验；原退款、安全及其他未结事项仍须分别办理。'));
}
