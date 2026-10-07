// Closed-use transaction details. Source scope and original domain commands remain authoritative.
import { closedRightsBinding, closedRightsView, assertClosedRightsCommand } from './privacy-closed-rights.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { reduce, goodsAfterSaleAvailability } from './engine.mjs';
import { bookingView, bookingRefundAvailable } from './booking.mjs';
import { careView } from './service-care.mjs';
import { invoiceSummary } from './service-invoices.mjs';
import { goodsInvoiceSummary } from './commerce-invoices.mjs';
import { serviceFinanceExtrasView } from './service-finance-extras.mjs';
import { careEvidenceAttachments, careEvidenceUploadFields, careEvidenceCount } from './care-evidence-ui.mjs';

const ROOT_PATHS={booking:'booking',goods:'goods',invoices:'service-invoice','commodity-invoices':'goods-invoice'};
const LABEL={
  unpaid:'原支付未完成',waiting:'等待原安排',confirmed:'原安排已确认',active:'原预约进行中',interrupted:'中止待核实',done:'原预约已完成',cancelled:'已取消',closed:'已关闭',
  paid:'成功支付，待原发货',shipped:'已发货，待收货',received:'已确认收货',requested:'等待原申请处理',offered:'待本人确认原方案',approved:'原方案已同意',processing:'原结果待查询',success:'实际退款成功',failed:'原结果明确失败',rejected:'原申请已驳回',escalated:'集团处理中',withdrawn:'原申请已撤回',
  store_pending:'待门店处理',user_pending:'待本人确认',group_pending:'待集团裁决',execution_pending:'待原关联事项办结',pending:'原申请待办理',issued:'原票已开具',red_pending:'原票待红冲',red:'原票已红冲',
  awaiting_return:'等待本人寄回',returning:'寄回运输中',partial_received:'部分收到，待协商',partial_confirmation:'部分验货待本人确认',inspection_disputed:'原验收存在分歧',inspection_review:'验收申诉待复核',awaiting_return_disposition:'等待原实物处置',awaiting_return_to_customer:'原货等待返还',return_to_customer_shipping:'原货返还运输中',refund_ready:'等待原退款',refund_failed:'原退款失败，待查询或重试',
  open:'待继续核实',awaiting_user:'待本人确认原方案',confirmed_user:'本人已确认',confirmed_advance:'原直接款方案已确认',succeeded:'实际直接款已成功',waiting_result:'等待原流程结果','needs-review':'原依据待人工核对'
};
const CASE_KIND={cancel:'未发货取消',return:'退货退款',refund:'仅退款'};
const INCIDENT_KIND={delay:'配送延迟',lost:'运输丢失',damaged:'运输破损','not-returned':'尚未寄回',unclaimed:'返还无人签收','wrong-item':'商品错发','receipt-dispute':'签收争议'};
const INCIDENT_STAGE={delivery:'商品配送',return:'退货寄回','return-back':'原货返还'};
const RESOLUTION={continue:'继续原履约流程',refund:'关联原售后退款','return-back':'按原售后返还原货'};
let probeSequence=0;
const finiteCents=n=>Number.isSafeInteger(n)&&n>=0;
const originalVersion=row=>Number.isSafeInteger(row?.version)&&row.version>=0?{version:row.version}:{};
function parsedRoute(route){
  if(!Array.isArray(route))return null;
  const care=route.length===3&&route[0]==='care'&&route[1]==='case';
  if(!care&&!(route.length===2&&ROOT_PATHS[route[0]]))return null;
  try{const id=decodeURIComponent(route[care?2:1]);return{kind:care?'care-case':ROOT_PATHS[route[0]],id:typeof id==='string'&&id&&id.trim()===id?id:null};}catch{return{kind:care?'care-case':ROOT_PATHS[route[0]],id:null};}
}
function helpers(ui,actor){
  const e=ui.esc||(v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const m=n=>finiteCents(n)?e(ui.money?ui.money(n):`¥${(n/100).toFixed(2)}`):e('原金额待核对');
  const d=t=>{const n=typeof t==='number'?t:typeof t==='string'?Date.parse(t):NaN;return Number.isSafeInteger(n)&&n>=0&&Number.isFinite(new Date(n).getTime())?e(ui.date?ui.date(n):new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})):e('原时间待核对');};
  const row=(label,value)=>`<div class="row"><span class="muted">${e(label)}</span><span>${value}</span></div>`;
  const note=(value,warning=false)=>`<p class="notice${warning?' warning':''}" role="status">${e(value)}</p>`;
  const panel=(title,body)=>`<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
  const link=(title,path)=>ui.link?ui.link(e(title),path,'btn secondary'):`<a class="btn secondary" href="#${e(path)}">${e(title)}</a>`;
  const returns=()=>`<div class="actions">${link('返回既有权益','/user/rights')}${link('返回使用关闭回执','/user/privacy')}</div>`;
  const field=(label,name,value='',type='text',attrs='')=>`<label class="field"><span>${e(label)}</span><input type="${e(type)}" name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
  const text=(label,name='reason',value='',attrs='required maxlength="300"')=>`<label class="field wide"><span>${e(label)}</span><textarea name="${e(name)}" rows="3" ${attrs}>${e(value)}</textarea></label>`;
  const select=(label,name,items,value='')=>`<label class="field"><span>${e(label)}</span><select name="${e(name)}" required>${items.map(([id,title])=>`<option value="${e(id)}"${String(value)===String(id)?' selected':''}>${e(title)}</option>`).join('')}</select></label>`;
  const form=(command,p,fields,title,key='')=>`<form class="management-form" data-management-form="${e(['closed-transactions',actor.userId,command,p.id||p.bookingId,p.refundId||p.caseId||p.incidentId||p.advanceId||'',p.decision||p.kind||'',key].join(':'))}" data-command="${e(command)}" data-payload="${e(JSON.stringify(p))}" data-live-version="${e(p.version??'')}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除；提交时按原来源、当前状态和期限核验。</p><div class="actions"><button type="submit" class="btn primary">${e(title)}</button><button type="button" class="btn secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  return{e,m,d,row,note,panel,link,returns,field,text,select,form};
}
function manual(h){return h.panel('原权益来源待人工核验',h.note('原关闭依据或本人交易来源尚未通过核验，暂不显示未核记录。',true)+h.returns());}
function boundItem(s,actor,view,kind,id){
  try{const b=closedRightsBinding(s,actor,kind,id),items=(view?.items||[]).filter(x=>x.kind===kind&&x.id===id&&x.rootId===b.rootId&&x.sourceVersion===b.sourceVersion);return items.length===1?items[0]:null;}catch{return null;}
}
// Reduce clones its input. Discard every result; preflight creates no real event,
// request, payment or source. It reuses current domain guards rather than a second
// set of refund reservations, inventory rules or deadline calculations.
function check(s,actor,type,p,options={}){
  try{
    if(options.canCommand&&options.canCommand(type)!==true)return false;
    const probe={requestId:`closed-ui-preflight-${++probeSequence}`,reason:'隔离界面条件核对，不是实际业务提交',...p};
    assertClosedRightsCommand(s,actor,type,probe);reduce(s,actor,type,probe);return true;
  }catch{return false;}
}
function factsHeader(h,title,item){return `<header class="page-head"><div><h1>${h.e(title)}</h1><p>本人使用关闭前的原交易权益。</p></div>${h.returns()}</header>`+h.panel('原来源',h.row('原来源编号',h.e(item.id))+h.row('当前进度',h.e(LABEL[item.status]||'原进度待核对'))+h.row('当前原版本',h.e(item.sourceVersion??'原源未设版本'))+h.row('实际使用关闭时间',h.d(item.closedAt)))+h.note('普通使用已关闭，原交易事实与既有权益继续保留。');}
function linkedSources(s,actor,view,root,h){
  const other=(view?.items||[]).filter(x=>x.rootKind===root.rootKind&&x.rootId===root.rootId&&x.path&&x.path!==root.path&&boundItem(s,actor,view,x.kind,x.id));
  const paths=new Map();for(const x of other)if(!paths.has(x.path))paths.set(x.path,x);
  return paths.size?h.panel('原关联权益',[...paths.values()].map(x=>`<div class="actions">${h.link(x.kind==='care-case'?'查看原反馈':x.kind==='service-invoice'?'查看原服务票':x.kind==='goods-invoice'?'查看原商品票':'查看原关联记录',x.path)}</div>`).join('')):'';
}
function bookingRefund(s,actor,view,b,r,h,options){
  if(!boundItem(s,actor,view,'booking-refund',r.id))return h.note('一项原退款来源待人工核验，未显示未核事项。',true);
  const p={id:b.id,refundId:r.id,...originalVersion(r)};
  let body=h.row('原退款编号',h.e(r.id))+h.row('原退款进度',h.e(LABEL[r.status]||'原进度待核对'))+h.row('原方案金额',h.m(r.amountCents))+h.row('原方案版本',h.e(r.version??'待核对'))+(r.deadline!=null?h.row('原处理截止',h.d(r.deadline)):'')+(r.reviewReason||r.reason?`<p>${h.e(r.reviewReason||r.reason)}</p>`:'');
  for(const part of r.lines?.length?r.lines:r.requests||[])body+=h.row('原退款付款明细',`${h.e(part.paymentId)} · ${h.m(part.amountCents)}`);
  for(const [decision,title] of [['accept','接受原协商金额'],['escalate','申请集团介入原退款'],['withdraw','撤回原退款申请']])if(check(s,actor,'booking.refund-answer',{...p,decision},options))body+=h.form('booking.refund-answer',{...p,decision},h.text('本人原方案处理说明'),title);
  return h.panel('原预约退款',body);
}
function bookingDetail(s,actor,view,item,h,options){
  const raw=s.bookings?.find(x=>x.id===item.id),b=bookingView(structuredClone(s),actor).find(x=>x.id===item.id);if(!raw||!b)return manual(h);
  // Aggregate money may only use the captured original payment sources. A root
  // binding alone does not bind a replacement payment or a later extension.
  try{assertClosedRightsCommand(s,actor,'booking.refund-request',{id:raw.id,requests:[raw.payment,...raw.extensions||[]].filter(Boolean).map(p=>({paymentId:p.id,amountCents:0}))});}catch{return manual(h);}
  let html=factsHeader(h,'原预约权益',item)+h.panel('原预约及实际资金',h.row('原项目',h.e(b.serviceSnapshot?.name||b.serviceId))+h.row('原预约时间',h.d(b.startAt))+h.row('实际完成时间',h.d(b.completedAt))+h.row('累计实际支付',h.m(b.paidCents))+h.row('累计实际退款',h.m(b.refundedCents)));
  for(const r of b.refunds||[])html+=bookingRefund(s,actor,view,b,r,h,options);
  const payments=[raw.payment,...raw.extensions||[]].filter(p=>p?.status==='success'&&finiteCents(p.amountCents)&&p.amountCents>0),eligible=[];
  for(const p of payments){
    const max=bookingRefundAvailable(raw,p.id),base={id:b.id,...originalVersion(raw)};
    if(!finiteCents(max)||max===0||!check(s,actor,'booking.refund-request',{...base,requests:[{paymentId:p.id,amountCents:1}]},options))continue;
    eligible.push({p,max});
  }
  if(eligible.length)html+=h.panel('申请原预约退款',h.note('分别填写原付款的申请金额，未申请的明细填0。实际退款由原处理流程执行。')+h.form('booking.refund-request',{id:b.id,...originalVersion(raw)},eligible.map(({p,max})=>h.field(`原付款 ${p.id} 申请退款（元）`,`refundAmount:${p.id}`,'0','number',`min="0" max="${max/100}" step="0.01"`)).join('')+h.text('原预约退款原因'),'提交原预约退款申请'));
  for(const [type,title] of [['booking.assistance-request','提交原门店协助'],['booking.help','联系原安全值班']])if(check(s,actor,type,{id:b.id,...originalVersion(raw)},options))html+=h.panel(title,h.form(type,{id:b.id,...originalVersion(raw)},h.text(type==='booking.help'?'需要安全协助的实际情况':'原预约需要协助的事项','reason','',type==='booking.help'?'required maxlength="200"':'required maxlength="500"'),title));
  for(const a of b.assistance||[])html+=h.panel('原门店协助记录',h.row('原协助编号',h.e(a.id))+h.row('当前进度',h.e(a.status==='closed'?'已回复办结':'待门店处理'))+`<p>${h.e(a.reason)}</p>`+(a.response?`<p>${h.e(a.response)}</p>`:'')+h.row('实际提交时间',h.d(a.createdAt)));
  for(const a of s.safety||[])if(a.bookingId===b.id)html+=h.panel('原安全求助进度',h.row('原事件编号',h.e(a.id))+h.row('进度',h.e(a.status==='closed'?'原事件已核实结案':({pending:'等待接报',acknowledged:'值班人员已接报',escalated:'已升级集团',unanswered:'升级后仍未响应'})[a.stage]||'原事件处理中'))+h.row('实际报告时间',h.d(a.createdAt))+h.note('如有紧急人身危险，请直接报警。')+`<div class="actions"><a class="btn secondary" href="tel:110">拨打110</a></div>`);
  const care=careView(structuredClone(s),actor),option=care.bookingOptions.find(x=>x.id===b.id),cp={bookingId:b.id,claim:'feedback',sourceKind:'booking',sourceId:b.id,...originalVersion(raw)};
  if(option?.canCreateCase&&check(s,actor,'care.case-create',{...cp,category:'other',description:'原预约反馈条件核对'},options))html+=h.panel('提交原预约反馈',h.note('此反馈继续处理原预约情况；退款须通过原退款记录办理。')+h.form('care.case-create',cp,h.select('原预约反馈类型','category',[['','请选择'],...care.categories.map(x=>[x.value,x.label])])+h.text('原预约实际反馈情况','description','','required maxlength="1000"')+h.text('证据说明或编号（选填）','evidence','','maxlength="1000"'),'提交原预约反馈'));
  const extras=serviceFinanceExtrasView(s,actor);
  for(const issue of extras.shortages||[])if(issue.bookingId===b.id)for(const a of issue.advances||[]){
    if(!boundItem(s,actor,view,'service-advance',a.id)||!boundItem(s,actor,view,'service-shortage',issue.id))continue;
    const p={id:issue.id,advanceId:a.id,...originalVersion(issue)};let body=h.row('原直接款方案',h.e(a.id))+h.row('本款原应退金额',h.m(a.amountCents))+h.row('原方案进度',h.e(({awaiting_user:'待本人确认',confirmed:'本人已确认，待实际付款',rejected:'本人已拒绝',succeeded:'实际垫付已成功',processing:'原款结果待查询',failed:'原款明确失败','needs-review':'原款依据待核对'})[a.status]||'原方案处理中'))+h.note('本人接受后仍须财务实际执行与核对原款；不会同时重复原路退款。');
    for(const [decision,title] of [['accept','接受原直接款方案'],['reject','拒绝原直接款方案']])if(check(s,actor,'service-extra.advance-confirm',{...p,decision},options))body+=h.form('service-extra.advance-confirm',{...p,decision},h.text('本人原方案决定说明'),title);
    html+=h.panel('原退款直接款方案',body);
  }
  return html+linkedSources(s,actor,view,item,h);
}
function goodsCase(s,actor,view,o,c,h,options){
  if(!boundItem(s,actor,view,'goods-case',c.id))return h.note('一项原商品售后来源待人工核验，未显示未核事项。',true);
  const p={id:o.id,caseId:c.id,...originalVersion(c)};
  let body=h.row('原售后编号',h.e(c.id))+h.row('原售后类型',h.e(CASE_KIND[c.kind]||'原售后'))+h.row('原进度',h.e(c.status==='done'?'原售后已办结':LABEL[c.status]||'原进度待核对'))+h.row('原申请商品退款',h.m(c.amountCents))+h.row('原申请运费退款',h.m(c.shippingCents))+h.row('当前原版本',h.e(c.version??'待核对'))+(c.reason?`<p>${h.e(c.reason)}</p>`:'')+(c.reviewReason?`<p>${h.e(c.reviewReason)}</p>`:'');
  if(c.returnShipment)body+=h.row('原寄回运单',h.e(`${c.returnShipment.carrier||''} · ${c.returnShipment.tracking||''}`));
  if(c.backShipment)body+=h.row('原货返还运单',h.e(`${c.backShipment.carrier||''} · ${c.backShipment.tracking||''}`))+h.row('原返还约定',h.e(c.backShipment.agreement||''));
  for(const r of o.refunds||[])if(r.caseId===c.id)body+=h.row('原退款结果',h.e(({success:'实际已退款',processing:'原笔结果待查询',failed:'明确失败，集团待处理'})[r.status]||'原款尚待办理'))+(r.status==='success'?h.row('实际退回金额',h.m(r.amountCents)):'');
  if(check(s,actor,'goods.return',{...p,carrier:'隔离核对',tracking:'preflight'},options))body+=h.form('goods.return',p,h.field('原退货快递','carrier','','text','required maxlength="30"')+h.field('原退货单号','tracking','','text','required maxlength="40"'),'提交实际寄回运单');
  for(const [type,title] of [['goods.appeal','申请复核原售后'],['goods.return-back-accept','接受原拒退并返还原货'],['goods.return-back-receive','确认实际收回原货'],['goods.case-withdraw',c.kind==='return'?'撤回尚未寄回的申请':'撤回尚未执行的申请']])if(check(s,actor,type,p,options))body+=h.form(type,p,h.text('原事项本人处理说明'),title);
  if(c.partialProposal){const q=c.partialProposal;body+=h.panel('原部分验货方案',h.row('实际收到数量',h.e(q.qty))+h.row('方案商品退款',h.m(q.amountCents))+h.row('方案运费退款',h.m(q.shippingCents))+h.row('原实物处置',h.e(q.resolution==='return-back'?'返还实收原货，本案不退款':'按原验货流程处置实收货物'))+`<p>${h.e(q.reason)}</p>`+h.note(`同意后，未寄回的${Number.isSafeInteger(q.keptQty)?q.keptQty:'待核对'}件由您继续保留，本案不退该部分金额；已实收原货按上述方案处置。`));
    const decisions=[['accept','同意原部分验货方案'],['reject','不同意，继续原核查']].filter(([decision])=>check(s,actor,'goods.partial-confirm',{...p,decision},options));
    if(decisions.length)body+=h.form('goods.partial-confirm',p,h.select('本人原部分验货意见','decision',[['','请选择'],...decisions])+h.text('本人原部分验货确认说明'),'提交本人原部分验货意见');
  }
  return h.panel('原商品售后',body);
}
function goodsIncident(s,actor,view,o,i,h,options){
  if(!boundItem(s,actor,view,'goods-incident',i.id))return h.note('一项原配送异常来源待人工核验，未显示未核事项。',true);
  const p={id:o.id,incidentId:i.id,...originalVersion(i)},q=i.proposal;
  let body=h.row('原异常编号',h.e(i.id))+h.row('原阶段与问题',h.e(`${INCIDENT_STAGE[i.stage]||'原物流'} · ${INCIDENT_KIND[i.kind]||'原异常'}`))+h.row('进度',h.e(({open:'原异常待核实',awaiting_user:'待本人确认原方案',waiting:'等待原流程事实',done:'已按实际原事实办结'})[i.status]||'原进度待核对'))+h.row('当前原版本',h.e(i.version??'待核对'));
  if(q)body+=h.panel('原异常处理方案',h.row('处理方式',h.e(RESOLUTION[q.resolution]||'原方案待核对'))+(q.caseId?h.row('已核关联售后',h.e(q.caseId)):'')+`<p>${h.e(q.reason)}</p>`+h.note('本人同意后仍按原配送、实物和退款事实办理，不会直接记为退款或办结。'));
  const decisions=[['accept','同意此原方案'],['reject','不同意，继续原协调']].filter(([decision])=>check(s,actor,'goods.incident-confirm',{...p,decision},options));
  if(decisions.length)body+=h.form('goods.incident-confirm',p,h.select('本人原异常方案意见','decision',[['','请选择'],...decisions])+h.text('本人原方案确认说明'),'提交本人原异常方案意见');
  if(check(s,actor,'goods.incident-receipt',{...p,occurredAt:s.now,evidence:'隔离原条件核对'},options))body+=h.note('同意继续方案不表示实际已经收货。请填写本人真实完整正确收货时间和依据；原订单收货仍按原事实办理。')+h.form('goods.incident-receipt',p,h.field('本人实际完整正确收货时间','occurredAt','','datetime-local','required step="0.001"')+h.text('本人实际收货依据','evidence','','required maxlength="1000"')+h.text('实际收货说明'),'登记本人实际完整正确收货');
  if(i.receiptFact)body+=h.row('本人原实际收货发生时间',h.d(i.receiptFact.occurredAt))+h.row('原收货事实登记时间',h.d(i.receiptFact.recordedAt));
  return h.panel('原配送异常',body);
}
function goodsDetail(s,actor,view,item,h,options){
  const o=s.goods?.find(x=>x.id===item.id);if(!o)return manual(h);const p={id:o.id,...originalVersion(o)};
  try{assertClosedRightsCommand(s,actor,'goods.case',{id:o.id,kind:'refund',paymentId:o.payment?.id});}catch{return manual(h);}
  const availability=goodsAfterSaleAvailability(s,actor,o.id);
  let html=factsHeader(h,'原商品权益',item)+h.panel('原商品与资金',h.row('原实际支付',o.payment?.status==='success'?h.m(o.paidCents):h.e('原支付待核对'))+h.row('原配送费',h.m(o.shippingCents))+(o.lines||[]).map(l=>h.row('原商品',h.e(`${l.name||l.skuId} · ${l.spec||''} · ${finiteCents(l.qty)?`${l.qty}件`:'原数量待核对'}`))).join('')+(o.shipment?h.row('原发货运单',h.e(`${o.shipment.carrier||''} · ${o.shipment.tracking||''}`)):'')+(o.receivedAt?h.row('原实际确认收货时间',h.d(o.receivedAt)):''));
  if(!availability.known)html+=h.note(availability.reason||'原商品申请额度待人工核对。',true);
  if(o.status==='shipped'&&check(s,actor,'goods.receive',p,options))html+=h.panel('原商品实际收货',h.form('goods.receive',p,h.text('本人实际收到原商品的确认说明'),'确认实际收到原商品'));
  if(availability.canCancel&&check(s,actor,'goods.case',{...p,kind:'cancel'},options))html+=h.panel('取消原未发货整单',h.form('goods.case',{...p,kind:'cancel'},h.text('原未发货订单取消原因'),'申请取消原整单'));
  for(const l of o.lines||[]){
    const capacity=availability.lines.find(x=>x.skuId===l.skuId);if(!availability.known||!capacity?.known)continue;
    const cancel={...p,kind:'cancel',skuId:l.skuId},cancelQty=capacity.cancelQty;
    if(availability.canCancel&&cancelQty>0&&check(s,actor,'goods.case',{...cancel,qty:1},options))html+=h.panel(`按原商品取消 · ${l.name||l.skuId}`,h.form('goods.case',cancel,h.field('本次原商品取消数量','qty','','number',`min="1" max="${cancelQty}" step="1" required`)+h.text('原商品取消原因'),'申请取消这些原商品',l.skuId));
    for(const kind of ['return','refund']){
      const allowed=kind==='return'?availability.canReturn:availability.canRefund,qty=kind==='return'?capacity.returnQty:capacity.refundQty;
      const amount=Math.min(capacity.amountCents,availability.availableCents,capacity.unitCents*qty),base={...p,kind,skuId:l.skuId,qty:1,amountCents:1,shippingCents:0};
      if(!allowed||!finiteCents(qty)||qty===0||!finiteCents(amount)||amount===0||!check(s,actor,'goods.case',base,options))continue;
      const payload={...p,kind,skuId:l.skuId},shipping=Math.min(availability.shippingCents,availability.availableCents);
      html+=h.panel(`${CASE_KIND[kind]} · ${l.name||l.skuId}`,h.row('本单商品及运费共用剩余额度',h.m(availability.availableCents))+h.note('申请只对应本单原商品。减少数量时，请同时核对申请金额不超过所选数量的实付额；商品金额与运费合计共用本单剩余额度，提交时由原领域核对。')+h.form('goods.case',payload,h.field('申请原商品数量','qty','','number',`min="1" max="${qty}" step="1" required`)+h.field('申请原商品退款（元）','amountYuan','','number',`min="0.01" max="${amount/100}" step="0.01" required`)+(shipping?h.field('申请原运费退款（元）','shippingYuan','0','number',`min="0" max="${shipping/100}" step="0.01" required`):'')+h.text('原商品售后原因'),'提交原商品售后申请',`${l.skuId}:${kind}`));
    }
  }
  const shipping=availability.known?Math.min(availability.shippingCents,availability.availableCents):null;
  if(availability.canRefund&&finiteCents(shipping)&&shipping>0&&check(s,actor,'goods.case',{...p,kind:'refund',amountCents:0,shippingCents:1},options))html+=h.panel('原运费售后',h.form('goods.case',{...p,kind:'refund',amountCents:0},h.field('申请原运费退款（元）','shippingYuan','','number',`min="0.01" max="${shipping/100}" step="0.01" required`)+h.text('原运费售后原因'),'提交原运费退款申请'));
  for(const c of o.cases||[])html+=goodsCase(s,actor,view,o,c,h,options);
  for(const i of o.incidents||[])html+=goodsIncident(s,actor,view,o,i,h,options);
  return html+linkedSources(s,actor,view,item,h);
}
function careDetail(s,actor,view,item,h,options){
  const x=careView(structuredClone(s),actor).cases.find(x=>x.id===item.id);if(!x)return manual(h);const p={id:x.id,...originalVersion(x)};
  let html=factsHeader(h,'原投诉与反馈',item)+h.panel('本人原反馈',h.row('原预约',h.e(x.bookingId))+`<p>${h.e(x.description)}</p>`+(x.evidence?`<p>${h.e(x.evidence)}</p>`:'')+careEvidenceAttachments(x.id,'evidence',x.evidenceRefs)+h.row('原实际提交时间',h.d(x.createdAt))+(x.userDueAt?h.row('原本人处理截止',h.d(x.userDueAt)):''));
  for(const r of x.resolutions||[])html+=h.panel('原公开处理结果',`<p>${h.e(r.publicReply)}</p>`+h.row('实际回复时间',h.d(r.at)));
  for(const statement of x.statements||[])html+=h.panel('原补充说明',`<p>${h.e(statement.text)}</p>`+h.row('实际说明时间',h.d(statement.at))+careEvidenceAttachments(x.id,'statement:'+statement.id,statement.evidenceRefs));
  if(x.canStatement&&check(s,actor,'care.case-statement',{...p,text:'原反馈条件核对'},options))html+=h.panel('补充原反馈情况',h.form('care.case-statement',p,h.text('原反馈补充说明','text','','required maxlength="1000"')+careEvidenceUploadFields(6-careEvidenceCount(x)),'提交本人补充说明'));
  for(const [decision,title,cap] of [['accept','接受原反馈处理结果',x.canAnswer],['escalate','申请集团介入原反馈',x.canAnswer],['withdraw','撤回此原反馈',x.canWithdraw]])if(cap&&check(s,actor,'care.case-answer',{...p,decision},options))html+=h.panel(title,h.note('此决定仅处理原反馈；独立退款、安全和争议继续按原事项执行。')+h.form('care.case-answer',{...p,decision},h.text('本人原反馈处理说明','reason','','required maxlength="500"'),title));
  if(x.conclusion)html+=h.panel('原结案结论',`<p>${h.e(x.conclusion)}</p>`);
  return html+linkedSources(s,actor,view,item,h);
}
function invoiceAttachment(x,slot,kind,h){
  const ticket=x[slot],file=ticket?.file;if(!ticket)return '';
  const label=slot==='issued'?'原发票':'红冲凭证';
  let body=h.row('原实际票号',h.e(ticket.ticketNumber))+h.row('实际登记时间',h.d(ticket.at));
  if(file?.ref)body+=`<div data-invoice-file="${h.e(file.ref)}"${kind==='goods-invoice'?' data-invoice-domain="commerce"':''} data-invoice-id="${h.e(x.id)}" data-invoice-slot="${slot}"><p class="order-number">${h.e(file.name)} · ${h.e(file.type)}</p><div class="actions"><button class="btn secondary" type="button" data-invoice-action="view" aria-expanded="false" disabled>查看${label}</button><a class="btn secondary" data-invoice-action="download">下载${label}</a></div><span class="small muted" data-invoice-file-status role="status">正在核验原票文件与当前本人权限。</span><section class="invoice-inline-preview" data-invoice-preview role="region" aria-label="${label}预览" hidden><div class="invoice-preview-heading"><h3>${label}预览</h3><button class="btn secondary" type="button" data-invoice-action="close-preview">关闭预览</button></div><p class="small muted" data-invoice-preview-status role="status"></p><div data-invoice-preview-content></div></section></div>`;
  else body+=h.note('原票文件引用缺失，请负责开票人员补传原凭证。',true);
  return h.panel(label,body);
}
function invoiceDetail(s,actor,view,item,h,options){
  const goods=item.kind==='goods-invoice',x=(goods?s.commerceInvoices:s.serviceInvoices)?.find(x=>x.id===item.id);if(!x)return manual(h);
  const b=s.bookings?.find(b=>b.id===x.bookingId),summary=goods?goodsInvoiceSummary(s,x.orderId,x.ruleSnapshot):invoiceSummary(s,b);
  let html=factsHeader(h,goods?'原商品发票权益':'原服务发票权益',item)+h.panel('原申请与净额',h.row('原来源',h.e(goods?x.orderId:x.bookingId))+h.row('原申请或原票金额',h.m(x.amount))+h.row('当前原可开净额',summary.blocked?h.e('原资金依据待核对'):h.m(summary.netCents))+h.row('原受票抬头',h.e(x.title))+h.row('原接收邮箱',h.e(x.email))+(x.rejectReason?`<p>${h.e(x.rejectReason)}</p>`:'')+(summary.blockedReason?h.note(summary.blockedReason,true):''));
  html+=invoiceAttachment(x,'issued',item.kind,h)+invoiceAttachment(x,'red',item.kind,h);
  const p={id:x.id,...originalVersion(x)},prefix=goods?'commerce-invoice':'invoice';
  for(const op of ['resubmit','reapply']){
    const probe={...p,kind:'personal',title:'原票补正条件核对',email:'preflight@example.invalid',taxId:''};
    if(!check(s,actor,`${prefix}.${op}`,probe,options))continue;
    const fields=h.select('原受票抬头类型','kind',[['personal','个人'],['company','企业']],x.kind||'personal')+h.field('原受票抬头','title',x.title||'','text','required maxlength="120"')+h.field('企业税号（企业必填）','taxId',x.taxId||'','text','maxlength="20"')+h.field('原接收邮箱','email',x.email||'','email','required maxlength="254"');
    html+=h.panel(op==='reapply'?'原票按净额重开':'修改原申请后重提',h.note(op==='reapply'?'重开沿原红冲票链，原票和原金额继续保留。':'仅补正当前原申请，原驳回及办理历史保留。')+h.form(`${prefix}.${op}`,p,fields,op==='reapply'?'提交原票净额重开':'提交原申请补正'));
  }
  return html+linkedSources(s,actor,view,item,h);
}

export function closedRightsTransactionsUiView(s,rawActor,route=[],ui={},options={}){
  const parsed=parsedRoute(route);if(!parsed)return null;const h=helpers(ui,rawActor||{});let actor;
  try{actor=resolveAccountActor(s,rawActor);}catch{return rawActor?.role==='user'&&privacyUseClosed(s,rawActor.userId)?manual(h):null;}
  if(actor?.role!=='user'||!privacyUseClosed(s,actor.userId))return null;
  const view=closedRightsView(s,actor),item=boundItem(s,actor,view,parsed.kind,parsed.id);if(!item)return manual(h);
  try{
    if(parsed.kind==='booking')return bookingDetail(s,actor,view,item,h,options);
    if(parsed.kind==='goods')return goodsDetail(s,actor,view,item,h,options);
    if(parsed.kind==='care-case')return careDetail(s,actor,view,item,h,options);
    return invoiceDetail(s,actor,view,item,h,options);
  }catch{return manual(h);}
}
