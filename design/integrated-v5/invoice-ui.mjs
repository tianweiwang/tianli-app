// Service-invoice views only. Rendering does not create records or change money.
import { invoiceSummary, canReadInvoice } from './service-invoices.mjs';
import { resolveAccountActor, canAccountReadSource } from './staff-accounts.mjs';

const STATUS = {pending:'待开票',rejected:'已驳回',issued:'已开票',red_pending:'待红冲',red:'已红冲'};
const ACTION = {apply:'提交申请',resubmit:'修改后重提',issue:'开具发票',reject:'驳回申请',red:'登记红冲',reapply:'申请净额重开','replace-file':'补传凭证',replace_file:'补传凭证',refund:'成功退款更新',sync:'更新开票依据'};
const canEnter = actor => ['user','store','manager'].includes(actor.role) || (actor.role === 'group' && (!actor.job || ['all','finance'].includes(actor.job)));
const canSeeBooking = (actor, booking) => booking && (actor.role === 'user' ? actor.userId === booking.userId : ['store','manager'].includes(actor.role) ? actor.storeId === booking.storeId : actor.role === 'group' && (!actor.job || ['all','finance'].includes(actor.job)));
const recordsFor = (s, actor) => (s.serviceInvoices || []).filter(x => canReadInvoice(actor,x,s));

function helpers(actor, ui) {
  const e=ui.esc, date=value=>e(ui.date(value)), money=value=>ui.money(value);
  const path=id=>`/${actor.role}/invoices${id?'/'+encodeURIComponent(id):''}`;
  const link=(label,target,kind='')=>ui.link(e(label),target,kind);
  const panel=(title,body)=>`<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
  const note=(text,warning=false)=>`<p class="notice${warning?' warning':''}">${e(text)}</p>`;
  const row=(label,value)=>`<div class="row"><span class="muted">${e(label)}</span><span>${value}</span></div>`;
  const badge=status=>ui.tag(STATUS[status] || status,['rejected','red_pending'].includes(status)?'warning':status==='issued'?'success':'');
  const table=(heads,rows)=>rows.length?`<div class="table-wrap"><table><thead><tr>${heads.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(x=>`<tr>${x.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:ui.empty('暂无服务发票记录');
  const head=(title,subtitle,action='')=>`<header class="page-head"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div><div class="actions">${action}</div></header>`;
  const bookingPath=id=>`/${actor.role}/${actor.role==='user'?'booking':'bookings'}/${encodeURIComponent(id)}`;
  const form=(command,payload,fields,label,entityId,confirm='')=>`<form class="management-form" data-invoice-form data-management-form="${e(`invoice:${actor.role}:${actor.userId || actor.storeId || actor.job || 'all'}:${entityId}:${command}:${payload.slot || ''}`)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}" data-next="${e(payload.id?path(payload.id):path())}" data-confirm="${e(confirm)}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容会保留在当前标签页，提交成功后清除。</p><div class="actions"><button class="primary" type="submit">${e(label)}</button><button class="secondary" type="button" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  const titleFields=invoice=>ui.select('抬头类型','kind',[{value:'personal',label:'个人'},{value:'company',label:'企业'}],invoice?.kind || 'personal').replace('name="kind"','name="kind" data-invoice-kind')+ui.field('发票抬头','title',invoice?.title || '','text','required maxlength="100"')+ui.field('税号（企业必填）','taxId',invoice?.taxId || '','text',`maxlength="30" ${invoice?.kind==='company'?'required':'disabled'}`)+ui.field('接收邮箱','email',invoice?.email || '','email','required maxlength="160"');
  const reasonField=(label='处理原因')=>`<label class="field wide"><span>${e(label)}</span><textarea name="reason" rows="3" required maxlength="300"></textarea></label>`;
  const upload=()=>`<div class="field wide"><label class="field"><span>凭证文件（必填，PDF / PNG / JPEG，最大5 MiB）</span><input type="file" data-invoice-upload accept="application/pdf,image/png,image/jpeg"></label><input type="hidden" name="fileRef" value=""><input type="hidden" name="fileName" value=""><input type="hidden" name="fileType" value=""><input type="hidden" name="fileSize" value=""><span class="small muted" data-invoice-upload-status role="status">选择文件后会保存到本机；仅填写文件名不能提交凭证。</span></div>`;
  return {e,date,money,path,link,panel,note,row,badge,table,head,bookingPath,form,titleFields,reasonField,upload};
}

function currentSummary(s, booking) { return invoiceSummary(s,booking); }
function unavailable(summary, maintenance=false) {
  if(!summary.completed) return '服务完成后才能申请服务发票。';
  if(summary.blocked) return summary.blockedReason || '当前有未结束的退款申请或支付结果待确认，请先处理退款和支付结果。';
  if(summary.netCents<=0) return '当前净实付为零，不能申请或重开零金额发票。';
  if(!maintenance && !summary.withinWindow) return '已超过服务完成后90天的新申请期限。';
  return '';
}
function originalInvoice(s, booking, records) {
  const scoped=records.filter(x=>x.bookingId===booking.id);
  return [...scoped].reverse().find(x=>!x.replacedById) || scoped.at(-1);
}
function paymentTable(payments,h) {
  return h.table(['关联支付','支付成功金额','成功退款','净额'],(payments || []).map(x=>[`${h.e(x.kind==='extension'?'加时支付':'主单支付')}<small>${h.e(x.paymentId)}</small>`,h.money(x.amountCents),h.money(x.refundedCents),h.money(x.netCents)]));
}
function attachment(record,slot,h) {
  const ticket=record[slot]; if(!ticket) return '';
  const title=slot==='issued'?'原发票':'红冲凭证';
  const file=ticket.file;
  return h.panel(title,h.row('票号',h.e(ticket.ticketNumber))+h.row('登记时间',h.date(ticket.at))+(file?.ref?`<div data-invoice-file="${h.e(file.ref)}" data-invoice-id="${h.e(record.id)}" data-invoice-slot="${slot}"><p class="order-number">${h.e(file.name)} · ${h.e(file.type)} · ${h.e((file.size/1024).toFixed(1))} KiB</p><div class="actions"><button type="button" class="secondary" data-invoice-action="view" aria-expanded="false" disabled>查看${h.e(title)}</button><a class="secondary" data-invoice-action="download">下载${h.e(title)}</a></div><span class="small muted" data-invoice-file-status role="status">正在读取本机文件；文件不可用时请联系服务门店补传。</span><section class="invoice-inline-preview" data-invoice-preview role="region" aria-label="${h.e(title)}预览" hidden><div class="invoice-preview-heading"><h3>${h.e(title)}预览</h3><button type="button" class="secondary" data-invoice-action="close-preview">关闭预览</button></div><p class="small muted" data-invoice-preview-status role="status"></p><div data-invoice-preview-content></div></section></div>`:h.note('未找到凭证文件引用，请联系服务门店补传。',true)));
}
function history(invoice,h) {
  return h.panel('办理记录',(invoice.history || []).length?`<ol class="timeline">${[...invoice.history].reverse().map(x=>`<li><span>${h.e(ACTION[x.action] || x.action || '状态更新')} · ${h.date(x.at)} · v${h.e(x.version ?? '—')}</span><p>${h.e(({user:'用户',store:'门店后台',manager:'店长',group:'集团',system:'系统'})[x.actor?.role] || x.actor?.role || '系统')}${x.actor?.id?' · '+h.e(x.actor.id):''} · ${h.e(STATUS[x.status] || x.status || '')}</p>${x.reason?`<p>${h.e(x.reason)}</p>`:''}${x.amount!=null?`<p>当时金额：${h.money(x.amount)}</p>`:''}</li>`).join('')}</ol>`:'<p class="muted">暂无办理记录。</p>');
}

export function invoiceBookingPanel(s,booking,actor,ui) {
  try{actor=resolveAccountActor(s,actor);}catch{return '';}
  if(!canEnter(actor) || !canSeeBooking(actor,booking) || !canAccountReadSource(s,actor,'booking',booking)) return '';
  const h=helpers(actor,ui), summary=currentSummary(s,booking), invoice=originalInvoice(s,booking,recordsFor(s,actor));
  if(!summary.completed && !invoice) return '';
  const storeName=booking.storeSnapshot?.name || s.stores.find(x=>x.id===booking.storeId)?.name || booking.storeId;
  let body=h.row('开票主体',h.e(storeName))+h.row('当前净实付',h.money(summary.netCents));
  if(invoice) {
    body+=h.row('办理进度',h.badge(invoice.status))+`<div class="actions">${h.link(actor.role==='manager'?'查看办理进度':'查看服务发票',h.path(invoice.id),'secondary')}</div>`;
    if(invoice.status==='red_pending') body+=h.note('成功退款后原票待红冲；原票金额和办理记录继续保留。',true);
  } else if(actor.role==='user') {
    const reason=unavailable(summary);
    body+=reason?h.note(reason,true):`<details class="action-details"><summary>申请服务发票</summary>${h.note('本次合并该预约主单及成功支付的加时，按当前净实付申请；真实税务开票和邮件发送尚未接入。')}${h.form('invoice.apply',{bookingId:booking.id},h.titleFields(),'提交开票申请',booking.id)}</details>`;
  } else body+='<p class="muted">用户尚未申请服务发票。</p>';
  return h.panel('服务发票',body);
}

export function invoiceView(s,route=[],actor,ui) {
  if(route[0]!=='invoices') return null;
  try{actor=resolveAccountActor(s,actor);}catch{return ui.empty('原工作身份已失效','请重新进入当前有效岗位。');}
  if(!canEnter(actor)) return ui.empty('当前身份无权查看服务发票','请使用本人用户、本店后台或获授权集团财务身份。');
  const h=helpers(actor,ui), records=recordsFor(s,actor), id=route[1], manager=actor.role==='manager', query=ui.query || new URLSearchParams();
  if(!id) {
    const status=query.get('status') || '', keyword=(query.get('q') || '').trim().toLowerCase(), storeId=actor.role==='group'?(query.get('storeId') || ''):'';
    const list=records.filter(x=>(!status || x.status===status) && (!storeId || x.storeId===storeId) && (!keyword || [x.id,x.bookingId,...manager?[]:[x.title]].some(v=>String(v || '').toLowerCase().includes(keyword))));
    const filters=`<form class="management-filters" data-command="ui.filter" data-payload="${h.e(JSON.stringify({path:h.path()}))}">${ui.select('办理状态','status',[{value:'',label:'全部'},...Object.entries(STATUS).map(([value,label])=>({value,label}))],status)}${ui.field(manager?'发票编号 / 预约号':'发票编号 / 预约号 / 抬头','q',query.get('q') || '','search')}${actor.role==='group'?ui.select('服务门店','storeId',[{value:'',label:'全部门店'},...s.stores.map(x=>({value:x.id,label:x.name}))],storeId):''}<button class="secondary" type="submit">筛选</button>${h.link('清除筛选',h.path(),'secondary')}</form>`;
    return h.head('服务发票',manager?'查看本店办理进度；抬头、邮箱和凭证由门店后台办理。':actor.role==='group'?'查看各服务门店的申请及票据，开具和红冲由原服务门店办理。':'按实际服务门店和预约追溯开票申请、红冲及净额重开。')+h.panel('查找申请',filters)+h.panel('申请记录',h.table(['申请 / 预约','服务门店',...manager?[]:['发票抬头'],'申请或原票金额','状态 / 版本','操作'],[...list].reverse().map(x=>[`${h.e(x.id)}<small>${h.e(x.bookingId)}</small>`,h.e(s.stores.find(store=>store.id===x.storeId)?.name || x.storeId),...manager?[]:[h.e(x.title)],h.money(x.amount),`${h.badge(x.status)}<small>v${h.e(x.version)}</small>`,h.link(manager?'查看进度':'查看详情',h.path(x.id))])))+(actor.role==='user'?h.note('新申请从本人已完成预约详情发起，服务门店开票。商品发票与服务发票分开办理。'):'');
  }
  const invoice=records.find(x=>x.id===id);
  if(!invoice) return h.head('服务发票')+ui.empty('申请不存在或无权查看','请返回当前身份可见的发票列表。')+h.link('返回列表',h.path(),'secondary');
  const booking=s.bookings.find(x=>x.id===invoice.bookingId), summary=currentSummary(s,booking);
  const storeName=booking?.storeSnapshot?.name || s.stores.find(x=>x.id===invoice.storeId)?.name || invoice.storeId;
  let html=h.head(invoice.id,`${STATUS[invoice.status] || invoice.status} · 第${invoice.version}版`,h.link('返回列表',h.path(),'secondary'))+h.panel('办理进度',h.row('当前状态',h.badge(invoice.status))+h.row('开票主体',h.e(storeName))+h.row('关联预约',h.link(invoice.bookingId,h.bookingPath(invoice.bookingId)))+h.row(invoice.issued?'原票金额':'当前申请金额',h.money(invoice.amount))+h.row('当前净实付',h.money(summary.netCents))+h.row('申请时间',h.date(invoice.createdAt))+(invoice.replacesId?h.row('替代原申请',h.link(invoice.replacesId,h.path(invoice.replacesId))):'')+(invoice.replacedById?h.row('后续重开申请',h.link(invoice.replacedById,h.path(invoice.replacedById))):''));
  if(manager) return html+h.note('本页仅供店长跟进办理进度。开具、红冲和凭证查看请交本店获授权财务人员。');
  html+=h.panel('申请抬头',h.row('抬头类型',h.e(invoice.kind==='company'?'企业':'个人'))+h.row('发票抬头',h.e(invoice.title))+(invoice.kind==='company'?h.row('企业税号',h.e(invoice.taxId)):'')+h.row('接收邮箱',h.e(invoice.email))+h.note('邮箱为本次申请记录，Demo 不发送邮件。'));
  if(invoice.rejectReason) html+=h.note('驳回原因：'+invoice.rejectReason,true);
  if(invoice.issued) html+=h.note('原票金额和支付快照保留开具时的记录；当前净实付按成功退款更新，两者不同须完成红冲与必要重开。',invoice.status==='red_pending');
  html+=h.panel(invoice.issued?'原票支付与退款依据':'申请支付与退款依据',paymentTable(invoice.paymentSnapshot,h));
  if(summary.blocked) html+=h.note(summary.blockedReason || '退款申请或支付结果尚未确定，暂缓开票。',true);
  html+=attachment(invoice,'issued',h)+attachment(invoice,'red',h);
  const writer=actor.role==='store' && actor.storeId===invoice.storeId;
  if(writer && invoice.status==='pending') {
    const issueBlocked=!summary.completed?'关联服务尚未完成。':summary.blocked?(summary.blockedReason || '请先确定退款及支付结果。'):summary.netCents<=0?'当前净实付为零，不能开具发票。':'';
    html+=issueBlocked?h.note(issueBlocked,true):h.panel('开具服务发票',h.note('按当前申请版本和净额登记票号与实际凭证，提交时会再次核验退款结果。')+h.form('invoice.issue',{id,version:invoice.version},ui.field('发票号码','ticketNumber','','text','required maxlength="80"')+h.upload(),'登记已开票',id,'确认按当前净额登记本店已开具的服务发票？'));
    html+=`<details class="action-details"><summary>驳回并说明原因</summary>${h.form('invoice.reject',{id,version:invoice.version},h.reasonField('驳回原因'),'驳回申请',id)}</details>`;
  }
  if(writer && invoice.status==='red_pending') html+=h.panel('登记原票红冲',h.note('保留原票和原金额。登记红冲凭证后，由用户按最新净额申请重开；全额退款只红冲。')+h.form('invoice.red',{id,version:invoice.version},ui.field('红冲凭证号码','ticketNumber','','text','required maxlength="80"')+h.upload(),'登记已红冲',id,'确认登记原发票已红冲，并保留原票及本次红冲凭证？'));
  if(writer) for(const slot of ['issued','red']) if(invoice[slot]) html+=`<details class="action-details"><summary>补传${slot==='issued'?'原发票':'红冲'}凭证</summary>${h.note('用于原文件丢失或凭证需更正。保留票号、金额和状态，记录本次补传原因。')}${h.form('invoice.replace-file',{id,version:invoice.version,slot},h.upload()+h.reasonField('补传原因'),'保存补传凭证',id)}</details>`;
  if(actor.role==='user' && invoice.userId===actor.userId && !invoice.replacedById && ['rejected','red'].includes(invoice.status)) {
    const maintenance=invoice.status==='red' || Boolean(invoice.replacesId), blocked=unavailable(summary,maintenance);
    html+=blocked?h.note(blocked,true):h.panel(invoice.status==='red'?'按净额申请重开':'修改后重新提交',h.note(invoice.status==='red'?'新申请关联已红冲原票，历史票据保留；重开不会覆盖原记录。':'修改抬头或接收邮箱后重新提交，原驳回记录保留。')+h.form(invoice.status==='red'?'invoice.reapply':'invoice.resubmit',{id,version:invoice.version},h.titleFields(invoice),invoice.status==='red'?'提交重开申请':'重新提交申请',id));
  }
  if(actor.role==='group') html+=h.note('集团财务仅查看服务票据，由原服务门店开具、红冲或补传凭证。');
  return html+history(invoice,h);
}
