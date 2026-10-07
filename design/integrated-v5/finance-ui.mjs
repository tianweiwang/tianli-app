// Service funds and technician income. Rendering never writes financial state.
import { serviceFinanceView, previewServiceFinanceRule, serviceSplitTransactions } from './service-finance.mjs';
import { serviceFinanceComposition } from './service-finance-composition.mjs';
import { financeCompositionReviewPanel } from './finance-composition-ui.mjs';
import { techIncomeView, previewTechIncome } from './tech-income.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '待核对' : '¥' + (Number(value) / 100).toFixed(2);
const date = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : new Date(Number(value)).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false });
const preciseDate = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : new Date(Number(value)).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3 });
const localTime = value => new Date(Number(value) + 8 * 3600000).toISOString().slice(0,16);
const groupFinance = actor => actor.role === 'group' && (!actor.job || ['all','finance'].includes(actor.job));
const allowed = actor => ['store','manager','tech'].includes(actor.role) || groupFinance(actor);
const STATUSES = {pending:'待核对',held:'暂不可发',payable:'待发放',paid:'已发放',void:'已作废',difference:'发放后待调整',processing:'处理中',failed:'失败待处理',success:'成功',open:'待处理',closed:'已结清',channel_pending:'渠道处理中',unconfigured:'缺少规则',blocked:'结算阻断',ready:'待分账',finished:'已完结',settled:'分账已完结',unshared:'尚未分账',none:'未发起',zero:'无需向集团分账'};
const label = status => STATUSES[status] || status || '—';
const badge = (status, text=label(status)) => `<span class="tag ${['failed','pending','held','difference','open','unconfigured','blocked'].includes(status)?'warning':['success','closed','paid','finished'].includes(status)?'success':''}">${e(text)}</span>`;
const panel = (title,body) => `<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const note = (text,warn=false) => `<p class="notice${warn?' warning':''}" role="status">${e(text)}</p>`;
const row = (title,value) => `<div class="row"><span class="muted">${e(title)}</span><span>${value}</span></div>`;
const empty = (title,detail='') => `<section class="panel empty"><h2>${e(title)}</h2><p>${e(detail)}</p></section>`;
const field = (title,name,value='',type='text',attrs='') => `<label class="field"><span>${e(title)}</span><input type="${e(type)}" name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
const select = (title,name,options,value='',attrs='') => `<label class="field"><span>${e(title)}</span><select name="${e(name)}" ${attrs}>${options.map(([v,t])=>`<option value="${e(v)}" ${String(v)===String(value)?'selected':''}>${e(t)}</option>`).join('')}</select></label>`;
const reason = (title='处理原因') => `<label class="field wide"><span>${e(title)}</span><textarea name="reason" required maxlength="300" rows="3"></textarea></label>`;
const hidden = (name,value) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`;
const table = (heads,rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${heads.map(v=>`<th>${e(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">暂无相关记录。</p>';
const details = (title,body) => `<details class="action-details"><summary>${e(title)}</summary>${body}</details>`;
const additionalPath = value => ({none:'当前无需补差',channel:'原服务款仍可按条件补分账',recovery:'原服务款已释放，按原追偿单核对实际回款',blocked:'当前阻断，先核对原来源或未知结果'})[value] || '办理路径待核对';
const roleName = actor => ({group:'集团财务',store:'门店后台',manager:'店长',tech:'技师',system:'系统'})[actor?.role] || actor?.role || '系统';
const actorLabel = actor => actor?.accountId ? `${actor.accountName || '工作员工'} · ${actor.accountId} · ${roleName(actor)}` : `${roleName(actor)}${actor?.id || actor?.storeId || actor?.techId ? ' · ' + (actor.id || actor.storeId || actor.techId) : ''}`;
const recoveryType = type => ({'unshared-release':'解冻漏分','return-failed':'回退失败','offline-adjustment':'线下多收退回'})[type] || type;
const scopeName = scope => ({global:'全局',service:'项目',store:'门店','store-service':'门店与项目'})[scope] || scope;
const actionName = action => ({'split-start':'发起或重试分账','split-query':'查询分账结果','finish-start':'发起或重试完结','finish-query':'查询完结结果','return-start':'发起或重试回退','return-query':'查询回退结果',recover:'登记实际追回',supplement:'登记实际补发'})[action] || action || '调整记录';

function helpers(s,actor,query) {
  const path = (part='ledger',id='') => `/${actor.role}/service-finance/${part}${id?'/'+encodeURIComponent(id):''}`;
  const link = (title,target,kind='') => `<a class="${e(kind)}" href="#${e(target)}">${e(title)}</a>`;
  const bookingLink = id => link(id,`/${actor.role}/bookings/${encodeURIComponent(id)}`);
  const storeName = id => s.stores?.find(x=>x.id===id)?.name || id || '—';
  const techName = id => s.techs?.find(x=>x.id===id)?.name || id || '—';
  const partyName = party => party === 'group' ? '集团' : String(party || '').startsWith('store:') ? storeName(String(party).slice(6)) : party || '待核对';
  const serviceName = id => id === 'all' || !id ? '全部项目' : s.services?.find(x=>x.id===id)?.name || id;
  const form = (command,payload,fields,title,key,confirm='') => `<form class="management-form" data-management-form="${e(`finance:${actor.role}:${actor.techId || ''}:${actor.storeId || ''}:${actor.job || ''}:${key}:${command}`)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}" data-confirm="${e(confirm)}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${e(title)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  const filters = (part,fields,payload={}) => `<form class="management-filters" data-command="ui.filter" data-payload="${e(JSON.stringify({path:path(part),...Object.fromEntries(Object.entries(payload).filter(([,v])=>v!=null))}))}">${fields}<button type="submit" class="secondary">查看结果</button>${link('清除筛选',path(part),'secondary')}</form>`;
  return {path,link,bookingLink,storeName,techName,serviceName,partyName,form,filters,query};
}

function tabs(actor,h,current) {
  const items = actor.role === 'tech' ? [['income','我的收入'],['payouts','发放记录']] : actor.role === 'manager' ? [['ledger','资金摘要']] : [['ledger','服务账本'],['income','技师提成'],['payouts','发放记录'],...(groupFinance(actor)?[['rules','财务规则'],['recoveries','回退与追偿']]:[])];
  return `<nav class="filter-tabs" aria-label="服务财务栏目">${items.map(([part,title])=>h.link(title,h.path(part),current===part?'active':'')).join('')}</nav>`;
}
function metric(title,value,target,h,detail='') {
  return `<div class="metric"><span>${e(title)}</span><strong>${h.link(value,target).replace('<a ',`<a aria-label="${e(title+' '+value+'，查看明细')}" `)}</strong>${detail?`<small>${e(detail)}</small>`:''}</div>`;
}
function financeMetrics(view,h,manager=false) {
  const v=view.summary || {};
  let html=`<div class="metrics">${metric('历史成功支付',money(v.paidCents),h.path('ledger'),h)}${metric('历史成功退款',money(v.refundedCents),h.path('ledger'),h)}${metric('历史净实付',money(v.netCents),h.path('ledger'),h,'支付减成功退款，非门店净利润')}${metric('待核对支付',String(v.unconfiguredCount ?? 0),h.path('ledger')+'?status='+(manager?'needs-review':'unconfigured'),h,'缺历史依据不能当作零佣金')}</div>`;
  if(!manager) {
    const entries=view.entries || [],toStore=entries.reduce((total,x)=>total+(x.externalToStoreCents || 0),0),toGroup=entries.reduce((total,x)=>total+(x.externalToGroupCents || 0),0),offlinePath=h.path(view.canExecute?'recoveries':'ledger');
    html+=`<div class="metrics">${metric('已知应分给集团',money(v.targetGroupCents),h.path('ledger'),h,v.unconfiguredCount?'仅含依据完整记录':'按每笔净额和规则快照')}${metric('渠道已分账',money(v.splitPaidCents),h.path('ledger'),h)}${metric('渠道已回退',money(v.returnedCents),h.path('ledger'),h)}${metric('需处理支付',String(v.needsActionCount ?? 0),h.path('ledger')+'?status=action',h)}</div><div class="metrics">${metric('线下已退门店',money(toStore),offlinePath,h,'集团向门店的已登记实际回款')}${metric('线下已付集团',money(toGroup),offlinePath,h,'门店向集团的已登记实际回款')}</div>`+note('集团已收净额 = 渠道已分账 − 渠道已回退 − 线下已退门店 + 线下已付集团。线下收付另记，不计入渠道成功金额。');
  }
  return html;
}
function incomeMetrics(view,h,summaryOnly=false) {
  const x=view.summary || {};
  if(summaryOnly) return `<div class="metrics">${[['本店已知提成应计',x.accruedCents],['本店已登记发放',x.paidCents],['本店当前可发',x.payableCents],['本店待核差额',x.differenceCents]].map(([title,value])=>`<div class="metric"><span>${e(title)}</span><strong>${money(value)}</strong><small>本店汇总；明细由门店后台核对</small></div>`).join('')}</div>`+(x.pendingCount?note(`有 ${x.pendingCount} 项提成待核对，已知应计汇总不完整。`,true):'');
  return `<div class="metrics">${metric('历史累计应计',money(x.accruedCents),h.path('income'),h,'仅包含已能计算的条目')}${metric('历史已登记发放',money(x.paidCents),h.path('payouts'),h)}${metric('当前可发放',money(x.payableCents),h.path('income')+'?status=payable',h)}${metric('发放后待核差额',money(x.differenceCents),h.path('income')+'?status=difference',h)}</div>`+(x.pendingCount?note(`有 ${x.pendingCount} 项缺少提成快照或核实依据，当前应计汇总不完整。`,true):'');
}
function ledgerFilters(s,actor,h) {
  return h.filters('ledger',select('资金状态','status',actor.role==='manager'?[['','全部'],['needs-review','缺少依据待核对'],['blocked','结算阻断'],['settled','已完结']]:[['','全部'],['action','需要处理'],['unconfigured','缺少依据待核对'],['blocked','结算阻断']],h.query.get('status') || '')+field('预约号 / 支付号','q',h.query.get('q') || '','search')+(groupFinance(actor)?select('服务门店','storeId',[['','全部门店'],...(s.stores || []).map(x=>[x.id,x.name])],h.query.get('storeId') || ''):''));
}
function filterEntries(entries,h) {
  const q=(h.query.get('q') || '').trim().toLowerCase(),storeId=h.query.get('storeId'),status=h.query.get('status');
  return entries.filter(x=>(!storeId || x.storeId===storeId)&&(!q || [x.bookingId,x.paymentId,x.id].some(v=>String(v || '').toLowerCase().includes(q)))&&(!status || status==='unconfigured' && x.targetGroupCents==null || status==='blocked' && x.blockers?.length || status==='action' && !['settled','void','waiting'].includes(x.status) || x.status===status));
}
function ledger(s,actor,view,income,h) {
  const manager=actor.role==='manager',rows=filterEntries(view.entries || [],h);
  const body=manager?table(['预约 / 支付','净实付','资金状态'],rows.map(x=>[`${h.bookingLink(x.bookingId)}<small>${e(x.paymentId)}</small>`,money(x.netCents),badge(x.status,x.statusLabel || label(x.status))])):table(['预约 / 支付','服务门店','成功支付 / 退款','净实付','应分集团 / 门店','渠道分账 / 回退与线下收付','状态 / 原因','操作'],rows.map(x=>[`${h.bookingLink(x.bookingId)}<small>${e(x.kind==='extension'?'加时':'主单')} · ${e(x.paymentId)}</small>`,e(h.storeName(x.storeId)),`${money(x.paidCents)}<small>已退 ${money(x.refundedCents)}</small>`,money(x.netCents),`${money(x.targetGroupCents)}<small>门店 ${money(x.storeTargetCents)}</small>`,`${money(x.splitPaidCents)}<small>渠道回退 ${money(x.returnedCents)}</small>${x.externalToStoreCents>0?`<small>线下已退门店 ${money(x.externalToStoreCents)}</small>`:''}${x.externalToGroupCents>0?`<small>线下已付集团 ${money(x.externalToGroupCents)}</small>`:''}`,`${badge(x.status,x.statusLabel || label(x.status))}<small>${e(x.eligibilityReason || x.blockers?.join('；') || '')}</small>`,h.link('资金明细',h.path('entry',x.id))]));
  const composition=manager?'':panel('平台费与推广款组成',table(['预约 / 支付','平台服务费H','个人推广佣金C','门店承担Cs','已付尚未扣回店承担额','当前应补差 / 路径'],rows.map(x=>[`${h.bookingLink(x.bookingId)}<small>${e(x.paymentId)}</small>`,money(x.known?x.platformCents:null),money(x.known?x.commissionCents:null),money(x.known?x.promotionStoreCents:null),money(x.known?x.retainedStoreCommissionCents:null),`${money(x.known?x.pendingAdditionalCents:null)}<small>${e(additionalPath(x.additionalPath))}</small>`])));
  return financeMetrics(view,h,manager)+(manager?incomeMetrics(income,h,true):'')+panel('查找服务支付',ledgerFilters(s,actor,h))+panel(manager?'本店资金摘要':'逐笔服务账本',body)+composition+note(manager?'店长只跟进本店金额和办理状态；规则、交易与发放凭证由获授权财务人员处理。':'主预约与加时逐笔结算。商品佣金另记；待核对记录不会自动补成自然客户或零佣金。',Boolean(view.summary?.unconfiguredCount));
}
function channelFields() {
  return select('本次模拟渠道结果','outcome',[['processing','处理中 / 结果待确认'],['success','成功'],['failed','失败']],'processing')+reason('本次模拟处理说明');
}
function retryFields(tx,canOrdinary) {
  return note(`原请求已尝试 ${tx.attempts} 次；下次普通重试时间 ${date(tx.nextRetryAt)}。${canOrdinary?'可按原号重试。':'普通重试尚不可用；人工核实后可按原号处理，仍受退款未知、金额和期限限制。'}`,!canOrdinary)+`<label class="check-row wide"><input type="checkbox" name="manual" value="true" ${canOrdinary?'':'required'}><span>本次由财务人工核实后处理（须记录原因）</span></label>`+channelFields();
}
function sourceRows(snapshot,h,entry) {
  if(!snapshot || snapshot.status!=='known' && !(snapshot.status==='promotion-pending' && snapshot.promoterId && entry?.known)) return note(snapshot?.reason || '缺少历史客户归属或服务分销依据，待核对；本批不自动补认。',true);
  return row('客户归属快照',e(snapshot.ownerType==='store'?h.storeName(snapshot.ownerStoreId):'集团'))+row('适用客户档',e(snapshot.customerType==='store'?'门店客户':'集团客户'))+row('服务推广依据',e(snapshot.promoterId?'推广员 '+snapshot.promoterId:'已明确无个人服务推广'))+row('快照时间',e(date(snapshot.capturedAt)));
}
function historyRows(records) {
  return records?.length?`<ol class="timeline">${[...records].reverse().map(x=>`<li><p>${e(actionName(x.action || x.kind))} · ${e(date(x.at || x.occurredAt || x.createdAt))}</p><p>${e(x.reason || '')}</p>${x.amountCents!=null?`<p>${money(x.amountCents)}</p>`:''}${x.before && x.after?`<p>净实付 ${money(x.before.netCents)} → ${money(x.after.netCents)}；应分集团 ${money(x.before.targetGroupCents)} → ${money(x.after.targetGroupCents)}</p>`:''}${x.proof || x.reference?`<p>实际凭证编号：${e(x.proof || x.reference)}</p>`:''}${x.transactionNo?`<p>${e(x.transactionNo)} · ${e(label(x.outcome))}</p>`:''}${x.actor?`<small>${e(actorLabel(x.actor))}</small>`:''}</li>`).join('')}</ol>`:'<p class="muted">暂无调整记录。</p>';
}
function channelHistory(entry) {
  const transactions=[...(entry.splitTransactions || serviceSplitTransactions(entry)),entry.finish,...(entry.returns || [])].filter(tx=>tx?.requestNo);
  return panel('原渠道请求与查询记录',transactions.length?transactions.map(tx=>details(`${tx.requestNo} · ${label(tx.status)}`,row('原交易编号',e(tx.id || '原编号待核对'))+row(tx.kind==='split'?'本服务款正常份额':'请求金额',money(tx.amountCents))+(tx.channelTotalCents!=null?row('本笔渠道总额',money(tx.channelTotalCents))+row('其中C04额外追收',money(tx.recoveryCents)): '')+(tx.splitRequestNo?row('原成功分账来源',e(tx.splitRequestNo)):'')+(tx.reason?note(tx.reason):'')+(tx.supersededAt?note(`此原请求已于 ${date(tx.supersededAt)} 保留为历史记录。`):'')+table(['时间','处理方式','模拟结果','处理人','说明'],(tx.results || []).map(r=>[e(date(r.at)),e(r.operation==='query'?'查询原请求':'发起 / 重试原请求'),badge(r.outcome),e(actorLabel(r.actor)),e(r.reason || '')])))).join(''):'<p class="muted">尚未发起渠道请求。</p>');
}

function promotionAmounts(x) {
  return row('平台服务费H',money(x.known?x.platformCents:null))+row('个人推广佣金C',money(x.known?x.commissionCents:null))+row('门店承担推广佣金Cs',money(x.known?x.promotionStoreCents:null))+row('已付尚未扣回的门店承担额',money(x.known?x.retainedStoreCommissionCents:null))+row('当前应补差',money(x.known?x.pendingAdditionalCents:null))+row('补差办理路径',e(additionalPath(x.additionalPath)))+note('集团应得包含平台费与门店承担推广款；平台服务费、个人佣金和实际分账记录分别核对。',!x.known);
}
function cashCompositionPanel(composition,entry,recoveries=[]) {
  const originals=[entry.split,...(entry.splitHistory || []),...(entry.returns || []),...recoveries.flatMap(x=>x.records || [])];
  const reasons=[...new Set([composition.reason,...composition.errors,...originals.map(x=>(x?.cashComposition || x?.cashCompositionRequest)?.reason)].filter(Boolean))];
  const totals=row('实际正常现金组成',e(composition.known?'已核清':'待核对'))+row('实际平台费H已收',money(composition.hReceivedCents))+row('实际平台费H已退',money(composition.hReturnedCents))+row('实际平台费H净额',money(composition.hNetCents))+row('实际推广款Cs已收',money(composition.csReceivedCents))+row('实际推广款Cs已退',money(composition.csReturnedCents))+row('实际推广款Cs净额',money(composition.csNetCents));
  const partial=!composition.known?note('完整实际H/Cs金额仍待核对。下表只列已核成功原现金，不能当作本款完整净额。',true):'';
  const normal=table(['原现金 / 实际凭据','收退方向','本笔正常现金','其中平台费H','其中推广款Cs','实际发生时间'],composition.rows.map(x=>[`${e(x.id)}<small>${e(x.actualReference)}</small>`,e(x.direction==='income'?'收集团':'退门店'),money(x.normalCents),money(x.hCents),money(x.csCents),e(preciseDate(x.actualAt))]));
  const reserved=composition.reservations.length?details('原未知回退组成占额',table(['原回退','正常占额','H占额','Cs占额'],composition.reservations.map(x=>[e(x.id),money(x.normalCents),money(x.hCents),money(x.csCents)]))):'';
  const principal=composition.principalRows.length?panel('C04额外追收本金',note('以下金额清偿原垫付债务，正常H/Cs组成单独核对。')+table(['原渠道请求 / 方案','本金金额','渠道总额','状态','实际成功时间'],composition.principalRows.map(x=>[`${e(x.source.requestNo)}<small>${e(x.planId)}</small>`,money(x.amountCents),money(x.channelTotalCents),badge(x.status),e(preciseDate(x.actualAt))]))):'';
  return panel('实际正常现金H / Cs组成',totals+partial+reasons.map(reason=>note('现金组成待核对：'+reason,true)).join('')+(composition.unresolvedSourceIds.length?row('待核原现金来源',e(composition.unresolvedSourceIds.join('；'))):'')+normal+reserved)+principal;
}
function returnSourceRows(sources) {
  return table(['原成功分账号','本服务正常份额','已成功回退','未知回退占额','实际线下代退','本笔剩余额','本次可回退'],sources.map(x=>[e(x.splitRequestNo || '原分账号待核对'),money(x.amountCents),money(x.returnedCents),money(x.reservedCents),money(x.offlineCents),money(x.remainingCents),money(x.returnableCents)]));
}
function newReturnForms(x,h) {
  const sources=(x.returnSources || []).filter(src=>src.splitId && src.splitRequestNo && src.returnableCents>0 && !src.failedReturn);
  if(!sources.length)return note('没有可核验且有本次可退余额的原成功分账，请先核对原笔。',true);
  return panel('选择原成功分账办理回退',note('展开对应原分账后填写本次正常份额回退金额。每笔回退绑定该成功分账号，C04额外追收沿其原领域办理。')+sources.map(src=>details(`${src.splitRequestNo} · 本次最多 ${money(src.returnableCents)}`,row('原分账编号',e(src.splitId))+h.form('finance.return-start',{id:x.id,version:x.version,splitId:src.splitId,splitRequestNo:src.splitRequestNo},field('本次原笔回退金额（元）','amountCents','','number',`required min="0.01" max="${src.returnableCents/100}" step="0.01" data-unit="yuan"`)+channelFields(),'发起本笔模拟回退',`${x.id}:${src.splitId}`,'确认使用所示原成功分账办理本次正常份额回退？结果仍按原笔记录，不回退C04额外追收。'))).join(''));
}
function recoveryFileFields() {
  return field('实际回款发生时间（上海时间）','occurredAt','','datetime-local','required step="0.001"')+`<div class="field wide"><label class="field"><span>实际回款依据文件（必填，PDF / PNG / JPEG，最大5 MiB）</span><input type="file" data-invoice-upload accept="application/pdf,image/png,image/jpeg" required></label>${hidden('fileRef','')}${hidden('fileName','')}${hidden('fileType','')}${hidden('fileSize','')}<p class="small muted" data-invoice-upload-status role="status">上传本机实际文件；仅填写凭证编号或文件名不构成实际附件。</p></div>`;
}
function recoveryAttachment(id,recordId,index,file) {
  if(!file?.ref)return '';
  return `<div data-invoice-file="${e(file.ref)}" data-invoice-domain="service-finance" data-invoice-id="${e(id)}" data-invoice-slot="${e(`recovery:${recordId}:${index}`)}"><p>${e(file.name)} · ${e(file.type)}</p><div class="actions"><button type="button" class="btn secondary" data-invoice-action="view" aria-expanded="false" disabled>查看实际回款依据</button><a class="btn secondary" data-invoice-action="download">下载实际依据</a></div><p class="small muted" data-invoice-file-status role="status">正在读取实际文件；读取成功后可查看。</p><section class="invoice-inline-preview" data-invoice-preview role="region" aria-label="实际回款依据" hidden><div class="invoice-preview-heading"><h3>实际回款依据</h3><button type="button" class="btn secondary" data-invoice-action="close-preview">关闭预览</button></div><p class="small muted" data-invoice-preview-status role="status"></p><div data-invoice-preview-content></div></section></div>`;
}
function recoveryHistory(recovery,composition) {
  return recovery.records?.length?details('原实际回款历史',`<ol class="timeline">${[...recovery.records].reverse().map(record=>{const checked=composition.rows.find(x=>x.id===`recovery:${recovery.id}:${record.id}`);return `<li>${row('实际回款金额',money(record.amountCents))}${row('实际发生时间',e(preciseDate(record.occurredAt ?? record.at)))}${row('登记时间',e(preciseDate(record.recordedAt ?? record.at)))}${row('实际凭证编号',e(record.reference))}${record.splitRequestNo?row('原成功分账来源',e(record.splitRequestNo)):''}${record.incomeSourceId?row('原实际回款来源',e(`${record.incomeSourceId} · ${record.incomeRequestNo || '原凭据待核对'}`)):''}${row('本笔实际平台费H',money(checked?.hCents))}${row('本笔实际推广款Cs',money(checked?.csCents))}${!checked?note('本笔现金组成待核对：'+(record.cashComposition?.reason || composition.reason || '本原现金尚无已核H/Cs组成'),true):''}<p>${e(record.reason || '')}</p><small>${e(actorLabel(record.actor))}</small>${(record.evidenceRefs || []).map((file,i)=>recoveryAttachment(recovery.id,record.id,i,file)).join('')}</li>`;}).join('')}</ol>`):'<p class="muted">暂无实际回款记录。</p>';
}
function recoveryForms(x,entry,view,h,composition) {
  if(x.status!=='open' || !(x.outstandingCents>0) || !view.canExecute)return '';
  if(!entry?.known || entry.unknownChannel || entry.unknownRefund || entry.unknownPersonalTransfer)return note(entry?.eligibilityReason || '原资金来源或结果尚未核对，先查询原笔，再登记实际回款。',true);
  const fields=max=>field(x.type==='offline-adjustment'?'本次实际退回门店（元）':'本次实际回款（元）','amountCents','','number',`required min="0.01" max="${max/100}" step="0.01" data-unit="yuan"`)+field('实际回款凭证编号','reference','','text','required maxlength="120"')+(x.requiresPromotionEvidence?recoveryFileFields():'')+reason('回款核实说明');
  const form=(max,source,pending=false)=>h.form('finance.recovery-receive',{id:x.id,version:x.version,...(source?.splitId?{splitId:source.splitId,splitRequestNo:source.splitRequestNo}:source?.incomeSourceId?{incomeSourceId:source.incomeSourceId,incomeRequestNo:source.incomeRequestNo}:{})},fields(max),pending?'登记实际退回并标记待核':x.type==='offline-adjustment'?'登记已退回门店':'登记已回款',`${x.id}${source?':'+(source.splitId || source.incomeSourceId):pending?':source-pending':''}`,pending?'确认登记已实际发生的退回？缺原收入来源，H/Cs组成将保持待核对。':x.requiresPromotionEvidence?'确认已发生这笔实际回款，并提供原发生时间及真实文件？Demo只登记原追偿，不触发资金交易。':'确认已发生这笔线下收付，并留存实际转账凭证编号？Demo只记账。');
  if(x.type==='offline-adjustment'){
    const sources=composition.returnSources.filter(src=>src.known && src.sourceKind==='recovery' && src.recoveryType==='unshared-release' && src.hRemainingCents+src.csRemainingCents>0);
    return details('选择原实际回款办理退回',note('明确展开本次退回对应的原实际收入。原来源H/Cs余额已扣除成功退回及未知占额；部分混合金额仍须逐笔核对。')+(sources.length?sources.map(src=>{const max=Math.min(x.outstandingCents,src.hRemainingCents+src.csRemainingCents);return details(`${src.incomeRequestNo} · 本次最多 ${money(max)}`,row('原实际回款来源',e(src.incomeSourceId))+row('原实际凭据编号',e(src.incomeRequestNo))+row('原实际发生时间',e(preciseDate(src.actualAt)))+row('原来源剩余平台费H',money(src.hRemainingCents))+row('原来源剩余推广款Cs',money(src.csRemainingCents))+form(max,src));}).join(''):note('没有已核且有剩余额的原实际收入来源，不能自动指定来源。',true))+details('原收入尚未核定，登记已发生退回',note('缺原收入来源的实际退回仍可登记，现金组成将保持待核对，不补造H/Cs；请在核实说明中记录缺口。',true)+form(x.outstandingCents,null,true)));
  }
  if(x.type!=='return-failed')return details('登记实际回款',form(x.outstandingCents));
  const sources=(entry.returnSources || []).filter(src=>src.splitId && src.splitRequestNo && src.remainingCents>0);
  if(sources.length===1){const src=sources[0];return details('登记实际回款',row('原成功分账来源',e(src.splitRequestNo))+form(Math.min(x.outstandingCents,src.remainingCents),src));}
  return sources.length?details('选择原成功分账登记实际代退',note('实际线下代退同样绑定原成功分账，按该笔剩余正常份额登记。')+sources.map(src=>details(`${src.splitRequestNo} · 最多 ${money(Math.min(x.outstandingCents,src.remainingCents))}`,form(Math.min(x.outstandingCents,src.remainingCents),src))).join('')):note('实际代退缺少可核验且有剩余额的原成功分账来源，待人工核对。',true);
}
function entryPage(s,actor,view,h,id) {
  if(['tech','manager'].includes(actor.role)) return empty('当前身份无权查看资金交易明细','请返回资金摘要或本人收入。');
  const x=view.entries.find(v=>v.id===id); if(!x) return empty('支付记录不存在或无权查看');
  let html=panel('关联预约',row('预约',h.bookingLink(x.bookingId))+row('支付',e(`${x.paymentId} · ${x.kind==='extension'?'加时':'主单'}`))+row('服务门店',e(h.storeName(x.storeId)))+row('业务状态',badge(x.status,x.statusLabel || label(x.status))))+panel('支付及分账金额',row('成功支付',money(x.paidCents))+row('成功退款',money(x.refundedCents))+row('当前净实付',money(x.netCents))+row('应分给集团',money(x.targetGroupCents))+row('门店应留',money(x.storeTargetCents))+row('实际分账成功',money(x.splitPaidCents))+row('实际回退成功',money(x.returnedCents))+row('待渠道回退',money(x.pendingReturnCents))+row('待线下退回',money(x.pendingOfflineReturnCents))+row('门店当前资金余额',money(x.storeCashCents))+note('门店资金余额不代表已可用余额或净利润；解冻以完结/自动解冻状态为准。'));
  html+=panel('平台费、推广款与补差',promotionAmounts(x));
  html+=cashCompositionPanel(serviceFinanceComposition(s,x.id),x,(view.recoveries || []).filter(r=>r.entryId===x.id));
  html+=financeCompositionReviewPanel(s,actor,x.id);
  html+=panel('下单依据',sourceRows(x.sourceSnapshot,h,x)+(x.ruleSnapshot?row('分成规则版本',e(`${x.ruleSnapshot.id || ''} · v${x.ruleSnapshot.version}`))+row('集团客户档',e(Number(x.ruleSnapshot.groupBps)/100+'%'))+row('门店客户档',e(Number(x.ruleSnapshot.storeBps)/100+'%')):note('缺少下单时的分成规则快照，不能使用现行规则补算旧单。',true)));
  html+=panel('逐笔期限与结算条件',row('支付成功',e(date(x.paidAt)))+row('强制分账日',e(date(x.forceAt)))+row('告警日',e(date(x.alertAt)))+row('资金解冻日',e(date(x.expiresAt)))+row('已确认待退占额',money(x.heldConfirmedCents))+row('本次可分给集团',money(x.splitTargetCents))+note(x.eligibilityReason || (x.blockers || []).join('；') || '按模型当前状态处理；实际渠道尚未接入。',Boolean(x.blockers?.length)));
  const splits=x.splitTransactions || serviceSplitTransactions(x);
  html+=panel('累计分账原笔',table(['原分账编号 / 商户请求号','本服务正常份额','状态','次数','下次普通重试'],splits.map(tx=>[`${e(tx.id || '未生成渠道交易')}<small>${e(tx.requestNo || (tx.status==='zero'?'明确无需分账':'原请求号待核对'))}</small>`,money(tx.amountCents),badge(tx.status),e(tx.attempts),e(date(tx.nextRetryAt))])))+panel('完结请求',table(['商户请求号','状态','次数','下次普通重试'],[[e(x.finish?.requestNo || '尚未发起'),badge(x.finish?.status || 'none'),e(x.finish?.attempts || 0),e(date(x.finish?.nextRetryAt))]]));
  const writer=groupFinance(actor)&&view.canExecute;
  if(writer) {
    const actions=[['canSplit','finance.split-start',x.pendingAdditionalCents>0&&x.splitPaidCents>0?'补充分账明确差额':'发起模拟分账',x.split],['canFinish','finance.finish-start','完结模拟分账',x.finish],['canQueryFinish','finance.finish-query','查询原完结请求']];
    for(const [flag,cmd,title,tx] of actions) if(x[flag] && tx?.status!=='failed') html+=panel(title,h.form(cmd,{id:x.id,version:x.version},channelFields(),title,x.id,'确认记录本次模拟渠道结果？此操作不触发真实资金交易。'));
    for(const [key,manual,ordinary,cmd,title] of [['split','canManualSplit','canSplit','finance.split-start','原分账请求重试'],['finish','canManualFinish','canFinish','finance.finish-start','原完结请求重试']]) if(x[key]?.status==='failed'&&x[manual]) {
      const changed=key==='split' && x.split.amountCents!==x.pendingAdditionalCents,label=changed?'保留原失败笔并办理新差额':title;
      const fields=changed?row('原明确失败请求',e(x.split.requestNo))+row('原失败金额',money(x.split.amountCents))+row('当前明确应补差',money(x.pendingAdditionalCents))+note('当前差额与原失败请求金额不同。原失败笔完整留在历史，本次按当前差额创建新请求，不改写原结果。')+`<label class="check-row wide"><input type="checkbox" name="manual" value="true" ${x[ordinary]?'':'required'}><span>本次由财务人工核实后处理（须记录原因）</span></label>`+channelFields():retryFields(x[key],x[ordinary]);
      html+=panel(label,h.form(cmd,{id:x.id,version:x.version},fields,label,x.id,changed?'确认保留所示原失败笔并办理当前明确差额？实际成功结果不沿旧失败额补造。':'确认使用原交易号记录重试结果？人工处理不会绕过资金和退款条件。'));
    }
    if(x.canQuerySplit) for(const tx of splits.filter(tx=>tx.status==='processing')) html+=tx.id&&tx.requestNo?details(`查询原分账 ${tx.requestNo}`,row('原分账编号',e(tx.id))+row('原请求金额',money(tx.amountCents))+h.form('finance.split-query',{id:x.id,version:x.version,transactionId:tx.id},channelFields(),'查询本笔分账原结果',`${x.id}:${tx.id}`,'确认查询所示原分账？成功仍按原请求金额记录，再核对当前补差。')):note('未知分账缺少原编号或请求号，须先核对原笔，不能凭当前金额新建成功结果。',true);
    if(x.canReturn)html+=newReturnForms(x,h);
  }
  html+=panel('原成功分账可回退余额',returnSourceRows(x.returnSources || []));
  html+=panel('回退记录',table(['回退单','原成功分账来源','商户回退请求号','金额','状态','次数','下次普通重试'],(x.returns || []).map(r=>[e(r.id),e(r.splitRequestNo || '原来源待核对'),e(r.requestNo),money(r.amountCents),`${badge(r.status)}${r.supersededAt?'<small>原失败笔已失效，仅保留历史</small>':''}`,e(r.attempts),e(date(r.nextRetryAt))])));
  if(writer) for(const r of x.returns || []) if(r.canQuery || r.canManualRetry) html+=details(`${r.canQuery?'查询':'重试'}回退 ${r.id}`,h.form(r.canQuery?'finance.return-query':'finance.return-start',{id:x.id,version:x.version,returnId:r.id,...(r.splitId?{splitId:r.splitId,splitRequestNo:r.splitRequestNo}:{})},r.canQuery?channelFields():retryFields(r,r.canRetry),r.canQuery?'查询原笔回退':'原笔回退重试',`${x.id}:${r.id}`,'确认记录原回退请求的模拟结果？不会重复创建其他回退单。'));
  const recoveries=(view.recoveries || []).filter(r=>r.entryId===x.id);
  if(recoveries.length) html+=panel('关联追偿',table(['追偿单','类型','未结金额','操作'],recoveries.map(r=>[e(r.id),e(recoveryType(r.type)),money(r.outstandingCents),groupFinance(actor)?h.link('处理追偿',h.path('recoveries')+'?id='+encodeURIComponent(r.id)):'由集团财务处理'])));
  if(x.additionalPath==='recovery')html+=note('原分账已完结或原服务款已释放。新增应补差由原同店追偿办理，原成功分账和完结记录保留。');
  return html+panel('金额调整记录',historyRows(x.adjustments))+channelHistory(x)+panel('资金处理记录',historyRows(x.history))+h.link('返回服务账本',h.path('ledger'),'secondary');
}

function incomePage(s,actor,view,h) {
  const status=h.query.get('status') || '',month=h.query.get('month') || '',techId=actor.role==='tech'?actor.techId:h.query.get('techId') || '';
  const visibleTechs=(s.techs || []).filter(t=>actor.role==='group' || t.storeId===actor.storeId || t.id===actor.techId);
  const entries=(view.entries || []).filter(x=>(!status || x.status===status)&&(!month || x.month===month)&&(!techId || x.techId===techId));
  let html=incomeMetrics(view,h)+panel('查找收入',h.filters('income',field('归属月份','month',month,'month')+select('收入状态','status',[['','全部'],['pending','缺依据待核对'],['held','暂不可发'],['payable','待发放'],['paid','已发放'],['difference','发放后待调整']],status)+(actor.role!=='tech'?select('技师','techId',[['','全部可见技师'],...visibleTechs.map(t=>[t.id,t.name])],techId):'')));
  const cards=entries.map(x=>{const rule=x.ruleSnapshot?.rule;return `<article class="list-card"><div class="row"><strong>${e(h.techName(x.techId))} · ${e(x.month)}</strong>${badge(x.status)}</div><p>${h.bookingLink(x.bookingId)} · ${e(x.paymentId)} · ${e(h.storeName(x.storeId))}</p>${row(x.status==='pending'&&x.amountCents!=null?'上次已知应计，待核对':'当前应计',money(x.amountCents))}${row('已登记发放',money(x.paidCents))}${row('已登记追回',money(x.recoveredCents ?? 0))}${row('当前可发',money(x.payableCents))}<p class="muted">${e(x.reason || '')}</p>${rule?`<p class="small muted">接单提成快照 v${e(rule.version)} · ${e(Number(rule.rateBps)/100)}% · ${e(rule.refundPolicy==='unchanged'?'部分退款不减少':'部分退款按比例调整')}</p>`:'<p class="notice warning">缺少有效接单提成规则快照，等待核对；不按现行比例补算旧记录。</p>'}</article>`;}).join('');
  html+=panel(actor.role==='tech'?'本人收入明细':'技师收入明细',cards || '<p class="muted">暂无收入记录。服务完成后按有效规则形成台账。</p>');
  const differences=(view.differences || []).filter(x=>(!techId || x.techId===techId)&&(!month || x.month===month));
  if(differences.length) html+=panel('已发后差额',differences.map(x=>`<article class="list-card"><div class="row"><strong>${e(x.id)} · ${e(h.techName(x.techId))}</strong>${badge(x.status)}</div><p>${h.bookingLink(x.bookingId)} · ${e(x.kind==='recover'?'已多发，待核实追回':'应补发')} · ${e(x.month)}</p>${row('差额总额',money(x.amountCents))}${row('仍待处理',money(x.remainingCents))}<p>${e(x.reason || '')}</p>${actor.role==='store' && x.status==='open' && x.remainingCents>0?details(x.kind==='recover'?'登记线下追回':'登记线下补发',h.form('tech-income.difference-record',{id:x.id,version:x.version,kind:x.kind},field('本次实际金额（元）','amountCents','','number',`required min="0.01" max="${x.remainingCents/100}" step="0.01" data-unit="yuan"`)+field('实际转账凭证编号','proof','','text','required maxlength="120"')+field('实际发生时间','occurredAt',localTime(s.now),'datetime-local','required')+reason('核实和处理说明'),'保存实际处理记录',x.id,'确认已在线下完成这笔追回或补发，并登记真实凭证编号？Demo只记录，不发起转账。')):''}${historyRows(x.records)}</article>`).join('')+note('差额单独核实处理，不自动抵扣下一月收入或工资。'));
  const adjustments=(view.adjustments || []).filter(x=>(!techId || x.techId===techId)&&(!month || (x.originMonth || x.month)===month));
  if(adjustments.length) html+=panel('提成调整记录',table(['预约 / 支付','所属月份 / 调整时间','调整前 / 调整后','本次差额','依据'],[...adjustments].reverse().map(x=>[`${h.bookingLink(x.bookingId)}<small>${e(x.paymentId)}</small>`,`${e(x.originMonth || x.month)}<small>${e(date(x.at))}</small>`,`${money(x.beforeCents)}<small>调整后 ${money(x.afterCents)}</small>`,money(x.deltaCents),`${e(x.reason || '')}<small>${e(actorLabel(x.actor))}</small>`])));
  if(view.summary?.pendingTypes?.length) html+=note('尚待接入的收入类型：'+view.summary.pendingTypes.join('；'));
  return html;
}
function payoutPage(s,actor,view,h) {
  let html=note('本页记录门店已在线下完成的技师发放，凭证为转账编号及说明；不会自动转账或伪装文件附件。');
  const groups=new Map();
  for(const x of view.entries || []) if(x.status==='payable' && x.payableCents>0) {const key=x.techId+':'+x.month; if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(x);}
  if(actor.role==='store') html+=panel('登记月度线下发放',groups.size?[...groups.entries()].map(([key,entries])=>{const first=entries[0],total=entries.reduce((v,x)=>v+x.payableCents,0),lines=entries.map(x=>({entryId:x.id,version:x.version})); return details(`${h.techName(first.techId)} · ${first.month} · ${money(total)}`,table(['收入明细','预约 / 支付','本次未发金额'],entries.map(x=>[e(x.id),`${h.bookingLink(x.bookingId)}<small>${e(x.paymentId)}</small>`,money(x.payableCents)]))+h.form('tech-income.payout',{techId:first.techId,month:first.month,lines},note(`本次合计 ${money(total)}，共 ${lines.length} 项。提交时重新核验每项版本与未发金额。`)+field('实际转账凭证编号','proof','','text','required maxlength="120"')+field('实际发放时间','paidAt',localTime(s.now),'datetime-local','required')+reason('发放说明'),'登记已线下发放',key,'确认所列明细已实际线下发放？记录不会发起真实转账，不能替代银行到账凭证。'));}).join(''):'<p class="muted">当前没有满足资金条件且尚未发放的条目；可返回收入明细查看暂不可发原因。</p>');
  html+=panel(actor.role==='tech'?'本人发放记录':'历史发放记录',table(['批次 / 月份','技师 / 门店','实际登记金额','实际发放时间','凭证编号 / 说明','关联明细'],[...(view.payouts || [])].reverse().map(p=>[`${e(p.id)}<small>${e(p.month)}</small>`,`${e(h.techName(p.techId))}<small>${e(h.storeName(p.storeId))}</small>`,money(p.amountCents),e(date(p.paidAt)),`${e(p.proof)}<small>${e(p.reason || '')}</small>`,(p.lines || []).map(x=>e(x.entryId)).join('<br>')])));
  return html;
}

function ruleScope(query,s) {
  const scope=['global','service','store','store-service'].includes(query.get('scope'))?query.get('scope'):'global';
  const storeId=scope.includes('store')?(query.get('storeId') || s.stores?.[0]?.id):null;
  const serviceId=scope.includes('service')?(query.get('serviceId') || s.services?.[0]?.id):null;
  return {scope,storeId,serviceId};
}
const scaled = value => /^\d+(?:\.\d{1,2})?$/.test(value || '')?Math.round(Number(value)*100):null;
function rulesPage(s,actor,finance,income,h) {
  if(!groupFinance(actor)) return empty('当前身份无权发布财务规则');
  const selected=ruleScope(h.query,s),sameScope=x=>x.scope===selected.scope&&(x.storeId || null)===(selected.storeId || null)&&(x.serviceId || null)===(selected.serviceId || null),versions=(finance.rules || []).filter(sameScope),current=versions.reduce((a,x)=>x.version>a.version?x:a,{version:0});
  const scopeFields=select('分成规则范围','scope',[['global','全局'],['service','项目'],['store','门店'],['store-service','门店与项目']],selected.scope)+select('门店','storeId',(s.stores || []).map(x=>[x.id,x.name]),selected.storeId || h.query.get('storeId'))+select('项目','serviceId',(s.services || []).map(x=>[x.id,x.name]),selected.serviceId || h.query.get('serviceId'));
  let html=note('初始财务规则为空。以下发布为人工配置的 Demo 规则；比例须明确填写，0% 也必须主动填写。发布不回填旧单，正式经营参数仍须另行确认。',!(finance.rules || []).length)+panel('选择分成规则范围',h.filters('rules',scopeFields));
  html+=panel('发布分成规则',row('适用范围',e([scopeName(selected.scope),selected.storeId?h.storeName(selected.storeId):'',selected.serviceId?h.serviceName(selected.serviceId):''].filter(Boolean).join(' · ')))+row('当前范围最新版本',e(current.version?`v${current.version}`:'尚未配置'))+h.form('finance.rule-publish',{...selected,version:current.version},field('集团客户抽成（%）','groupBps','','number','required min="0" max="30" step="0.01" data-unit="percent"')+field('门店客户抽成（%）','storeBps','','number','required min="0" max="30" step="0.01" data-unit="percent"')+field('生效时间','effectiveAt',localTime(s.now),'datetime-local','required')+reason('发布原因'),'发布分成规则',`split:${selected.scope}:${selected.storeId || ''}:${selected.serviceId || ''}`,'确认发布新版本？既有预约仍使用下单快照，不补造旧单归属或服务推广。'));
  const techStore=h.query.get('techStoreId') || s.stores?.[0]?.id,techService=h.query.get('techServiceId') || 'all',techCurrent=(income.rules || []).filter(x=>x.storeId===techStore&&x.serviceId===techService).reduce((a,x)=>x.version>a.version?x:a,{version:0});
  html+=panel('选择技师规则范围',h.filters('rules',select('提成门店','techStoreId',(s.stores || []).map(x=>[x.id,x.name]),techStore)+select('提成项目','techServiceId',[['all','本店全部项目'],...(s.services || []).map(x=>[x.id,x.name])],techService),selected));
  html+=panel('发布技师提成规则',row('适用范围',e(h.storeName(techStore)+' · '+h.serviceName(techService)))+row('当前范围最新版本',e(techCurrent.version?`v${techCurrent.version}`:'尚未配置'))+h.form('tech-income.rule-publish',{storeId:techStore,serviceId:techService,version:techCurrent.version},field('技师提成（%）','rateBps','','number','required min="0" max="100" step="0.01" data-unit="percent"')+select('部分退款调整','refundPolicy',[['','请选择'],['proportional','按比例减少'],['unchanged','不减少，差额由门店承担']],'','required')+select('金额取整方式','rounding',[['','请选择'],['floor','向下取整到分'],['round','四舍五入到分']],'','required')+field('生效时间','effectiveAt',localTime(s.now),'datetime-local','required')+reason('发布原因'),'发布提成规则',`tech:${techStore}:${techService}`,'确认发布新提成版本？新接单或新派单固定快照，已接单不受新规则影响。'));
  html+=rulePreviews(selected,techStore,techService,h);
  html+=panel('分成规则历史',table(['范围','版本','集团客户 / 门店客户','生效时间','说明'],[...(finance.rules || [])].reverse().map(x=>[e(`${scopeName(x.scope)} · ${x.storeId?h.storeName(x.storeId):'全部门店'} · ${h.serviceName(x.serviceId)}`),e('v'+x.version),e(`${x.groupBps/100}% / ${x.storeBps/100}%`),e(date(x.effectiveAt)),e(x.reason)])))+panel('提成规则历史',table(['门店 / 项目','版本','提成','退款调整 / 取整','生效时间'],[...(income.rules || [])].reverse().map(x=>[e(h.storeName(x.storeId)+' · '+h.serviceName(x.serviceId)),e('v'+x.version),e(x.rateBps/100+'%'),e(`${x.refundPolicy==='unchanged'?'不减少':'按比例减少'} / ${x.rounding==='round'?'四舍五入':'向下取整'}`),e(date(x.effectiveAt))])));
  return html+note('服务推广佣金首单、取消补偿、交通事实及已发差额仍按各自依据处理。本页不会用片区距离生成路费，也不会把未知服务推广记为零。');
}
function rulePreviews(selected,techStoreId,techServiceId,h) {
  const q=h.query,amount=scaled(q.get('trialAmount')),groupBps=scaled(q.get('trialGroupRate')),storeBps=scaled(q.get('trialStoreRate'));
  const result=amount!=null&&groupBps!=null&&storeBps!=null?previewServiceFinanceRule({amountCents:amount,groupBps,storeBps,customerType:q.get('trialType') || 'group'}):null;
  let html=panel('分成试算（不保存）',h.filters('rules',field('试算净额（元）','trialAmount',q.get('trialAmount') || '','number','required min="0" step="0.01"')+field('集团客户抽成（%）','trialGroupRate',q.get('trialGroupRate') || '','number','required min="0" max="30" step="0.01"')+field('门店客户抽成（%）','trialStoreRate',q.get('trialStoreRate') || '','number','required min="0" max="30" step="0.01"')+select('试算客户档','trialType',[['group','集团客户'],['store','门店客户']],q.get('trialType') || 'group'),{...selected,techStoreId,techServiceId})+(result?result.valid?row('试算集团金额',money(result.groupCents))+row('试算门店金额',money(result.storeCents)):note(result.error || '请检查输入',true):'<p class="muted">输入净额与两个抽成比例后查看结果；试算不会发布规则。</p>'));
  const techAmount=scaled(q.get('trialTechAmount')),refunded=scaled(q.get('trialRefund')),rate=scaled(q.get('trialRate')),techResult=techAmount!=null&&refunded!=null&&rate!=null?previewTechIncome({amountCents:techAmount,refundedCents:refunded,rateBps:rate,refundPolicy:q.get('trialPolicy'),rounding:q.get('trialRounding')}):null;
  html+=panel('技师提成试算（不保存）',h.filters('rules',field('支付金额（元）','trialTechAmount',q.get('trialTechAmount') || '','number','required min="0" step="0.01"')+field('成功退款（元）','trialRefund',q.get('trialRefund') || '','number','required min="0" step="0.01"')+field('技师提成（%）','trialRate',q.get('trialRate') || '','number','required min="0" max="100" step="0.01"')+select('退款调整','trialPolicy',[['','请选择'],['proportional','按比例减少'],['unchanged','不减少']],q.get('trialPolicy') || '')+select('金额取整','trialRounding',[['','请选择'],['floor','向下取整'],['round','四舍五入']],q.get('trialRounding') || ''),{...selected,techStoreId,techServiceId})+(techResult?row('试算提成',money(techResult.amountCents))+(techResult.reason?note(techResult.reason,techResult.amountCents==null):''):'<p class="muted">输入金额、退款与提成规则后查看结果。</p>'));
  return html;
}
function recoveryPage(s,actor,view,h) {
  if(!groupFinance(actor)) return empty('当前身份无权处理集团追偿');
  const id=h.query.get('id'),items=(view.recoveries || []).filter(x=>!id || x.id===id);
  return note('先处理用户退款，再独立核对回退与追偿。回退渠道仍处理中时，不重复登记线下回款。')+panel('服务资金追偿',items.length?items.map(x=>{const entry=view.entries.find(v=>v.id===x.entryId),composition=serviceFinanceComposition(s,x.entryId);return `<article class="list-card"><div class="row"><strong>${e(x.id)}</strong>${badge(x.status)}</div><p>${e(recoveryType(x.type))} · ${e(h.storeName(x.storeId))} · ${h.bookingLink(x.bookingId)}</p>${row('应付方 / 应收方',e(h.partyName(x.payer)+' → '+h.partyName(x.payee)))}${row('应追金额',money(entry?.known?x.amountCents:null))}${row('已实际回款',money(x.receivedCents))}${row('尚未结清',money(entry?.known?x.outstandingCents:null))}<p>${e(x.reason || '')}</p>${!composition.known?note('本款现金组成待核对：'+composition.reason,true):''}<div class="actions">${h.link('关联支付明细',h.path('entry',x.entryId),'secondary')}</div>${recoveryForms(x,entry,view,h,composition)}${recoveryHistory(x,composition)}</article>`;}).join(''):'<p class="muted">暂无服务资金追偿事项。</p>');
}

export function financeView(s,actor,parts=[],ui={}) {
  if(parts[0]!=='service-finance') return null;
  if(!allowed(actor)) return empty('当前身份无权查看服务财务');
  const query=ui.query || new URLSearchParams(typeof location==='undefined'?'':location.hash.split('?')[1] || ''),h=helpers(s,actor,query);
  const part=parts[1] || (actor.role==='tech'?'income':'ledger'),finance=actor.role==='tech'?{entries:[],rules:[],recoveries:[],summary:{}}:serviceFinanceView(s,actor),income=techIncomeView(s,actor);
  if(actor.role==='tech'&&!['income','payouts'].includes(part) || actor.role==='manager'&&part!=='ledger') return empty('当前身份无权查看此财务栏目','请返回当前身份的资金摘要或收入页。');
  let content;
  if(part==='ledger') content=ledger(s,actor,finance,income,h);
  else if(part==='entry') content=entryPage(s,actor,finance,h,parts[2]);
  else if(part==='income') content=incomePage(s,actor,income,h);
  else if(part==='payouts') content=payoutPage(s,actor,income,h);
  else if(part==='rules') content=rulesPage(s,actor,finance,income,h);
  else if(part==='recoveries') content=recoveryPage(s,actor,finance,h);
  else content=empty('财务页面不存在');
  return `<header class="page-head"><div><h1>${actor.role==='tech'?'我的服务收入':'服务财务'}</h1><p>${actor.role==='tech'?'查看本人服务提成与门店线下发放记录。':'从预约和逐笔支付核对分账、提成及实际处理记录。'}</p></div></header>`+tabs(actor,h,part)+content;
}

export function financeBookingPanel(s,actor,booking) {
  if(!allowed(actor) || !booking || (actor.role==='tech'?booking.techId!==actor.techId:['store','manager'].includes(actor.role)?booking.storeId!==actor.storeId:false)) return '';
  const h=helpers(s,actor,new URLSearchParams());
  if(actor.role==='tech') {
    const entries=(techIncomeView(s,actor).entries || []).filter(x=>x.bookingId===booking.id);
    return panel('本人服务收入',entries.length?entries.map(x=>row(x.paymentId,`${money(x.amountCents)} · ${badge(x.status)}`)).join('')+h.link('查看本人收入',h.path('income'),'secondary'):'<p class="muted">服务完成后按接单提成快照形成台账；缺少规则时保留待核对。</p>');
  }
  const entries=(serviceFinanceView(s,actor).entries || []).filter(x=>x.bookingId===booking.id);
  if(!entries.length) return '';
  return panel('服务资金',entries.map(x=>row(x.paymentId,`${money(x.netCents)} · ${badge(x.status,x.statusLabel || label(x.status))}`)).join('')+note('净额按成功支付和成功退款计算；分账、提成和商品佣金分别记账。')+`<div class="actions">${actor.role==='manager'?h.link('查看本店资金摘要',h.path('ledger'),'secondary'):entries.map(x=>h.link((x.kind==='extension'?'加时':'主单')+'资金明细',h.path('entry',x.id),'secondary')).join('')}</div>`);
}
