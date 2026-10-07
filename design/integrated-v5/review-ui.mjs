// Review pages use the same scoped model for buttons, detail access and public scores.
import { REVIEW_TAGS, canReadServiceReview, reviewEligibility, serviceReviewView, technicianReviewSummary } from './service-reviews.mjs';

const AUDIT = {no_text:'未填写文字',pending:'文字待审核',approved:'文字审核通过',blocked:'文字未通过审核',error:'审核异常，待重试'};
const APPEAL = {store_pending:'待门店初审',group_pending:'待集团终审',upheld:'申诉成立',rejected:'申诉不成立'};
const ACTION = {'review.create':'用户提交评价','review.moderate-text':'登记文字审核结果','review.hide':'集团登记违规隐藏','review.appeal':'技师提出申诉','review.appeal-store':'门店完成初审','review.appeal-final':'集团完成终审'};
const roleName = role => ({user:'用户',tech:'技师',store:'门店后台',manager:'店长',group:'集团客服 / 管理员'})[role] || role || '';
const authorLabel = actor => actor?.accountId ? `${actor.accountName || '工作员工'} · ${actor.accountId}` : roleName(actor?.role);
function helpers(s,actor,ui) {
  const e=ui.esc, date=at=>e(ui.date(at)), path=id=>`/${actor.role}/reviews${id?'/'+encodeURIComponent(id):''}`;
  const link=(label,target,kind='')=>ui.link(e(label),target,kind);
  const panel=(title,body)=>`<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
  const note=(text,warning=false)=>`<p class="notice${warning?' warning':''}">${e(text)}</p>`;
  const row=(label,value)=>`<div class="row"><span class="muted">${e(label)}</span><span>${value}</span></div>`;
  const head=(title,subtitle='',actions='')=>`<header class="page-head"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div><div class="actions">${actions}</div></header>`;
  const select=(label,name,options,value='')=>ui.select(label,name,options.map(([value,label])=>({value,label})),value);
  const reason=(label='处理说明')=>`<label class="field wide"><span>${e(label)}</span><textarea name="reason" required maxlength="1000" rows="3"></textarea></label>`;
  const form=(command,payload,fields,title)=>`<form class="management-form" data-command="${e(command)}" data-management-form="${e(`review:${actor.role}:${actor.userId || ''}:${actor.techId || ''}:${actor.storeId || ''}:${actor.role==='group'?actor.job || 'all':''}:${payload.id || payload.bookingId}:${command}`)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}" data-next="${e(path(payload.id))}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${e(title)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  const bookingPath=id=>`/${actor.role}/${actor.role==='user'?'booking':'bookings'}/${encodeURIComponent(id)}`;
  const storeName=id=>s.stores?.find(item=>item.id===id)?.name || id;
  const techName=id=>s.techs?.find(item=>item.id===id)?.name || id;
  const badge=(text,kind='')=>ui.tag(text,kind);
  return {e,date,path,link,panel,note,row,head,select,reason,form,bookingPath,storeName,techName,badge};
}
function reviewStatus(review,h) {
  return `${h.badge(review.hidden?'评价已隐藏':'有效评价',review.hidden?'warning':'success')} ${h.badge(AUDIT[review.textAudit?.status] || '文字待审核')}${review.appeal?' '+h.badge(APPEAL[review.appeal.status] || review.appeal.status,['store_pending','group_pending'].includes(review.appeal.status)?'warning':''):''}`;
}
function reviewText(review,h) {
  return h.row('星级',h.e(`${review.score} 星`))+h.row('标签',h.e(review.tags?.join('、') || '未选择标签'))+(review.textVisible && review.text ? `<p class="notice">${h.e(review.text)}</p>` : h.note(review.textAudit?.status==='no_text'?'用户未填写文字。':review.hidden?'该评价已隐藏，当前身份不展示评价原文。':'文字未获审核通过，当前身份仅查看星级、标签及处理进度。'));
}
function createForm(booking,h) {
  const score=h.select('服务评分','score',[['','请选择星级'],...Array.from({length:5},(_,index)=>[String(index+1),`${index+1} 星`])]).replace('name="score"','name="score" required');
  const tags=`<fieldset class="field wide"><legend>评价标签（可选）</legend>${REVIEW_TAGS.map(tag=>`<label class="check-row"><input type="checkbox" name="tags" value="${h.e(tag)}"><span>${h.e(tag)}</span></label>`).join('')}</fieldset>`;
  const text='<label class="field wide"><span>评价文字（可选，最多1000字）</span><textarea name="text" rows="3" maxlength="1000"></textarea></label>';
  return h.note('每个主预约可评价一次，提交后不能修改；加时与主预约一起评价。文字通过审核后才对外展示。')+h.form('review.create',{bookingId:booking.id},score+tags+text,'提交评价');
}
export function reviewBookingPanel(s,booking,actor,ui) {
  if (!booking || !canReadServiceReview(actor,booking)) return '';
  const h=helpers(s,actor,ui), review=serviceReviewView(s,actor).reviews.find(item=>item.bookingId===booking.id);
  if (!review && booking.status!=='done') return '';
  if (review) return h.panel('服务评价',reviewStatus(review,h)+h.row('用户评分',h.e(`${review.score} 星`))+`<div class="actions">${h.link('查看评价与申诉进度',h.path(review.id),'secondary')}</div>`);
  if (actor.role!=='user') return h.panel('服务评价','<p class="muted">用户尚未提交评价。</p>');
  const eligibility=reviewEligibility(s,booking,actor);
  return h.panel('服务评价',eligibility.canCreate?`<details class="action-details"><summary>评价本次服务</summary>${h.row('提交截止时间',h.date(eligibility.deadline))}${createForm(booking,h)}</details>`:h.note(eligibility.reason,true));
}
function appealDetail(review,h) {
  const appeal=review.appeal;
  if (!appeal) return '';
  let body=h.row('当前进度',h.badge(APPEAL[appeal.status] || appeal.status))+h.row('申诉时间',h.date(appeal.createdAt));
  if (appeal.reason) body+=h.row('技师申诉说明',h.e(appeal.reason));
  if (appeal.storeReview) body+=h.row('门店初审',h.e(appeal.storeReview.opinion==='support'?'支持申诉，已交集团终审':'不支持申诉，已交集团终审'))+(appeal.storeReview.reason?h.row('初审依据',h.e(appeal.storeReview.reason)):'');
  if (appeal.finalReview) body+=h.row('集团终审',h.e(appeal.finalReview.decision==='uphold'?'申诉成立，隐藏评价并移出评分':'申诉不成立'))+(appeal.finalReview.reason?h.row('终审依据',h.e(appeal.finalReview.reason)):'');
  if (['store_pending','group_pending'].includes(appeal.status)) body+=h.note('申诉处理中保持原有评分。门店初审后由集团终审，不论初审是否支持。');
  return h.panel('差评申诉',body);
}
function history(review,h) {
  return h.panel('处理记录',review.history?.length?`<ol class="timeline">${[...review.history].reverse().map(item=>`<li><p>${h.e(ACTION[item.action] || item.action)} · ${h.date(item.at)} · v${h.e(item.version)}</p><small>${h.e(authorLabel(item.actor))}</small>${item.reason?`<p>${h.e(item.reason)}</p>`:''}${item.result?`<p>${h.e(AUDIT[item.result] || item.result)}</p>`:''}</li>`).join('')}</ol>`:'<p class="muted">暂无处理记录。</p>');
}
function actions(review,h) {
  const payload={id:review.id,version:review.version};
  let html='';
  if (review.canModerate) html+=h.panel('登记文字审核结果',h.note('此处为 Demo 模拟审核回执，尚未接入真实内容安全服务。待审核、异常及未通过的文字均不对外展示。')+h.form('review.moderate-text',payload,h.select('模拟审核结果','result',[['approved','通过'],['blocked','未通过'],['error','审核异常']],'approved')+h.reason('审核依据（仅集团客服 / 管理员可见）'),'保存审核结果'));
  if (review.canHide) html+=`<details class="action-details"><summary>登记违规隐藏</summary>${h.note('隐藏整条评价并从评分中移除；保留原评价、申诉与审核历史。',true)}${h.form('review.hide',payload,h.reason('违规依据（仅集团客服 / 管理员可见）'),'确认隐藏')}</details>`;
  if (review.canAppeal) html+=h.panel('申请差评复核',h.note('1–2星评价可在评价后7天内申诉一次。请说明与事实不符的部分，由原服务门店初审、集团终审。')+h.row('申诉截止时间',h.date(review.appealDeadline))+h.form('review.appeal',payload,h.reason('申诉事实与依据'),'提交申诉'));
  if (review.canStoreReview) html+=h.panel('门店初审',h.form('review.appeal-store',payload,h.select('初审意见','opinion',[['support','支持申诉'],['oppose','不支持申诉']],'support')+h.reason('初审事实与依据'),'提交集团终审'));
  if (review.canFinalReview) html+=h.panel('集团终审',h.form('review.appeal-final',payload,h.select('终审结论','decision',[['uphold','申诉成立'],['reject','申诉不成立']],'uphold')+h.reason('终审事实与依据'),'保存终审结论'));
  return html;
}
export function reviewUiView(s,actor,parts=[],ui) {
  if (parts[0]!=='reviews') return null;
  const view=serviceReviewView(s,actor);
  if (!view.canEnter) return ui.empty('当前身份无权查看服务评价','请切换为本人用户、实际服务技师、原服务门店或集团客服。');
  const h=helpers(s,actor,ui), id=parts[1];
  if (!id) {
    const query=ui.query || new URLSearchParams(), status=query.get('status') || '', bookingId=query.get('bookingId') || '', q=(query.get('q') || '').trim().toLowerCase();
    const reviews=view.reviews.filter(item=>(!bookingId || item.bookingId===bookingId) && (!q || [item.id,item.bookingId].some(value=>value.toLowerCase().includes(q))) && (!status || status==='hidden' && item.hidden || status==='pending_text' && ['pending','error'].includes(item.textAudit.status) || status==='store_pending' && item.appeal?.status==='store_pending' || status==='group_pending' && item.appeal?.status==='group_pending'));
    const filters=`<form class="management-filters" data-command="ui.filter" data-payload="${h.e(JSON.stringify({path:h.path(),...bookingId?{bookingId}:{}}))}">${h.select('处理状态','status',[['','全部'],['pending_text','文字待审核 / 异常'],['store_pending','待门店初审'],['group_pending','待集团终审'],['hidden','已隐藏']],status)}${ui.field('评价编号 / 预约号','q',query.get('q') || '','search')}<button type="submit" class="secondary">筛选</button>${h.link('清除筛选',h.path(),'secondary')}</form>`;
    const rows=reviews.length?`<div class="table-wrap"><table><thead><tr><th>评价 / 预约</th><th>实际服务技师 / 门店</th><th>评分 / 标签</th><th>状态</th><th>操作</th></tr></thead><tbody>${reviews.map(item=>`<tr><td>${h.e(item.id)}<small>${h.e(item.bookingId)}</small></td><td>${h.e(h.techName(item.techId))}<small>${h.e(h.storeName(item.storeId))}</small></td><td>${h.e(item.score)} 星<small>${h.e(item.tags.join('、'))}</small></td><td>${reviewStatus(item,h)}</td><td>${h.link('查看详情',h.path(item.id))}</td></tr>`).join('')}</tbody></table></div>`:ui.empty('暂无符合条件的评价');
    const summary=view.summary;
    const subtitle=actor.role==='group'?`共 ${summary.count} 条；当前可办理文字审核 ${summary.pendingText} 条、申诉终审 ${summary.pendingFinal} 条。`:['store','manager'].includes(actor.role)?`本店共 ${summary.count} 条；当前待申诉初审 ${summary.pendingStore} 条。`:actor.role==='tech'?`本人实际服务评价共 ${summary.count} 条，可查看评分与申诉进度。`:`本人已提交 ${summary.count} 条评价，可查看文字审核与申诉进度。`;
    return h.head('服务评价',subtitle)+h.panel('查找评价',filters)+h.panel('评价记录',rows)+h.note('评价从本人已完成预约提交；评分只统计近90天未隐藏的评价，少于5条显示“新技师”。');
  }
  const review=view.reviews.find(item=>item.id===id);
  if (!review) return h.head('服务评价')+ui.empty('评价不存在或无权查看')+h.link('返回评价列表',h.path(),'secondary');
  let html=h.head(review.id,`服务评价 · 第${review.version}版`,h.link('返回评价列表',h.path(),'secondary'))+h.panel('评价与关联预约',reviewStatus(review,h)+h.row('关联预约',h.link(review.bookingId,h.bookingPath(review.bookingId)))+h.row('实际服务技师',h.e(h.techName(review.techId)))+h.row('原服务门店',h.e(h.storeName(review.storeId)))+h.row('提交时间',h.date(review.createdAt))+reviewText(review,h));
  if (review.textAudit.reason) html+=h.panel('内部文字审核依据',h.row('模拟审核结果',h.e(AUDIT[review.textAudit.status]))+h.row('审核说明',h.e(review.textAudit.reason)));
  if (review.hidden) html+=h.note('评价已隐藏，不计入公开评分。不同隐藏依据独立保留，申诉结论不会撤销其他违规隐藏。',true)+review.hiddenReasons.filter(item=>item.reason).map(item=>h.panel(item.kind==='content'?'内部违规隐藏依据':'申诉隐藏依据',h.e(item.reason))).join('');
  if (actor.role==='tech' && !review.canAppeal && !review.appeal) html+=h.note(review.appealReason);
  html+=appealDetail(review,h)+actions(review,h)+history(review,h)+h.note('评价与申诉不直接办理退款、投诉结案或正式处罚；相关事项继续从原预约跟进。');
  return html;
}
export function technicianReviewsPanel(s,techId,ui) {
  const summary=technicianReviewSummary(s,techId), e=ui.esc;
  const title=summary.rating===null?'新技师 · 近90天有效评价不足5条':`${summary.rating.toFixed(1)} 分 · 近90天 ${summary.count} 条有效评价`;
  return `<section class="panel management-panel"><h2>服务评价</h2><p>${e(title)}</p>${summary.publicReviews.length?summary.publicReviews.map(item=>`<article class="panel"><div class="row"><strong>${e(item.score)} 星</strong><span class="muted">${e(ui.date(item.createdAt))}</span></div><p>${e(item.tags.join('、') || '未选择标签')}</p>${item.text?`<p>${e(item.text)}</p>`:'<p class="muted">暂无可公开的文字评价</p>'}</article>`).join(''):'<p class="muted">近90天暂无有效评价。</p>'}</section>`;
}
