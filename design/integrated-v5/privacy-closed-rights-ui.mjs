// C09: navigation to verified existing sources. Candidate scope is not an action permission.
import { closedRightsView } from './privacy-closed-rights.mjs';

const LABEL = {
  booking:'原预约', goods:'原商品订单', 'booking-refund':'预约退款', 'care-case':'投诉与反馈',
  'goods-case':'商品售后', 'goods-incident':'商品配送异常', 'service-invoice':'服务发票',
  'goods-invoice':'商品发票', 'service-shortage':'本人直接退款事项', 'service-advance':'本人直接退款方案',
  closure:'使用关闭依据', 'booking-extension':'原加时', payment:'原支付',
  'service-promoter':'个人推广身份来源', 'service-commission-source':'原佣金付款来源',
  'service-commission':'个人服务佣金', 'service-withdrawal':'原个人提现', 'service-promotion-recovery':'原个人佣金扣回'
};
const COMMON = {pending:'等待处理',requested:'等待受理',processing:'原结果核对中',failed:'原处理失败',success:'原处理成功',done:'已完成',closed:'已结束',cancelled:'已取消',rejected:'未通过',withdrawn:'已撤回','needs-review':'来源待核对'};
const STATUS = {
  booking:{unpaid:'待付款',waiting:'待确认',confirmed:'已确认',serving:'服务中',active:'进行中',done:'已完成',stopped:'已中止',disputed:'争议处理中',support:'客服介入',cancelled:'已取消'},
  goods:{unpaid:'待付款',paid:'待发货',shipped:'待收货',received:'已收货',closed:'已关闭',cancelled:'已取消'},
  'booking-refund':{requested:'等待处理',offered:'待本人回应',escalated:'集团核对中',approved:'退款已批准',processing:'退款结果核对中',failed:'原退款失败',success:'原退款成功',withdrawn:'已撤回',rejected:'已拒绝'},
  'care-case':{store_pending:'门店处理中',group_pending:'集团处理中',user_pending:'待本人回应',execution_pending:'关联事项待办结',closed:'已结案',withdrawn:'本人已撤回'},
  'goods-case':{requested:'等待集团受理',approved:'已受理',awaiting_return:'等待寄回',returning:'退货运输中',partial_received:'部分收到，待集团协商',partial_confirmation:'部分验货方案待本人确认',inspection_disputed:'验收存在分歧',inspection_review:'集团复核中',awaiting_return_disposition:'等待仓储处置',awaiting_return_to_customer:'原货等待返还',return_to_customer_shipping:'原货返还运输中',refund_pending:'等待退款',refunding:'退款处理中',refund_failed:'原退款失败',done:'售后完成',closed:'售后已关闭'},
  'goods-incident':{open:'待协调',awaiting_user:'待本人确认',waiting:'等待原处理结果',done:'已按事实办结'},
  'service-invoice':{pending:'等待财务受理',rejected:'待本人补正',issued:'原票已开具',red_pending:'等待红冲',red:'原票已红冲'},
  'goods-invoice':{pending:'等待财务受理',rejected:'待本人补正',issued:'原票已开具',red_pending:'等待红冲',red:'原票已红冲'},
  'service-shortage':{awaiting_store:'等待协调',awaiting_user:'待本人确认',resolved:'专项核对完成'},
  'service-advance':{awaiting_user:'待本人确认',confirmed:'本人已确认方案',rejected:'本人已拒绝方案'},
  'service-commission':{pending:'原佣金待结算',available:'原佣金可用',withdrawing:'原提现占款中',paid:'原佣金已付',void:'原佣金已作废','needs-review':'原佣金来源待核对'},
  'service-withdrawal':{requested:'等待财务发起原笔',processing:'原笔结果待查询',awaiting_user:'待本人确认收款',cancel_requested:'原撤销结果待查询',paid:'实际转账成功',success:'实际转账成功',failed:'原转账明确失败',cancelled:'原申请或渠道已撤销'},
  'service-promotion-recovery':{open:'原已付佣金待扣回',closed:'原扣回已按事实结清',loss:'原损失已登记','return-pending':'原超收待实际退回','needs-review':'原扣回依据待核对'}
};
function helpers(ui={}){
  const esc=ui.esc|| (v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const link=(label,path)=>ui.link?ui.link(esc(label),path,'btn secondary'):`<a class="btn secondary" href="#${esc(path)}">${esc(label)}</a>`;
  const date=v=>v==null?'—':esc(ui.date?ui.date(v):new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}));
  const panel=(label,body)=>`<section class="panel management-panel"><h2>${esc(label)}</h2>${body}</section>`;
  const notice=(text,warning=false)=>`<p class="notice${warning?' warning':''}" role="status">${esc(text)}</p>`;
  const row=(label,body)=>`<div class="row"><span class="muted">${esc(label)}</span><span>${body}</span></div>`;
  const money=v=>Number.isSafeInteger(v)&&v>=0?esc(ui.money?ui.money(v):`¥${(v/100).toFixed(2)}`):esc('金额待人工核对');
  return{esc,link,date,panel,notice,row,money};
}
const label=kind=>LABEL[kind]||'原业务来源';
const status=item=>STATUS[item.kind]?.[item.status]||COMMON[item.status]||'原状态待核对';
const rootLabel=kind=>({booking:'原预约',goods:'原商品订单','service-promotion':'原个人服务推广身份'})[kind]||'原业务来源';
const detailLabel=kind=>({'service-commission':'查看原佣金明细','service-withdrawal':'查看原提现记录','service-promotion-recovery':'查看原扣回记录'})[kind]||'查看原详情';
function financialSummary(item,h){
  const f=item.financial;if(!f)return '';
  if(item.kind==='service-commission')return h.row('原应计佣金',h.money(f.known===true?f.commissionCents:null));
  if(item.kind==='service-withdrawal')return h.row('原提现申请金额',h.money(f.amountCents))+(f.confirmExpiresAt!=null?h.row('原渠道本人确认截止',h.date(f.confirmExpiresAt)):'')+(f.execution?h.row('原渠道最后记录',h.esc(STATUS['service-withdrawal'][f.execution.status]||COMMON[f.execution.status]||'原结果待核对')):'')+(f.execution?.status==='success'&&f.execution.completedAt!=null?h.row('原实际成功发生时间',h.date(f.execution.completedAt)):'');
  if(item.kind==='service-promotion-recovery')return h.row('原应扣回',h.money(f.known===true?f.amountCents:null))+h.row('原实际已收回',h.money(f.receivedCents))+h.row('原尚待扣回',h.money(f.known===true?f.outstandingCents:null))+h.row('原超收待退',h.money(f.known===true?f.returnPendingCents:null));
  return '';
}
function sourceList(items,h){
  return items.map(item=>`<article class="list-row"><div><h3>${h.esc(label(item.kind))}</h3><p>${h.esc(item.id)}</p><p class="muted">${h.esc(status(item))} · ${h.esc(rootLabel(item.rootKind))} ${h.esc(item.rootId)}</p><p class="small muted">${h.esc(item.rootKind==='service-promotion'?'已按关闭时个人佣金来源核验':item.basis==='closure-snapshot'?'已按关闭时原交易记录核验':'已按原创建时间核验')}</p>${financialSummary(item,h)}</div>${h.link(detailLabel(item.kind),item.path)}</article>`).join('');
}

export function closedRightsEntry(s,actor,ui={}){
  const data=closedRightsView(s,actor);if(!data)return '';
  const h=helpers(ui);
  return `<div class="stack">${h.notice('普通使用已关闭，原交易权益继续保留。原业务详情会再次核对来源和办理条件。')}<div class="actions">${h.link('查看既有权益','/user/rights')}</div></div>`;
}

export function closedRightsUiView(s,actor,route=['rights'],ui={}){
  if(route[0]!=='rights')return null;
  const h=helpers(ui),data=closedRightsView(s,actor);
  if(!data)return h.panel('当前身份无法查看既有权益',h.notice('此入口仅供使用已关闭的本人查询原交易来源。',true));
  if(route.length!==1)return h.panel('既有权益页面不存在',h.notice('请从使用关闭回执进入既有权益列表。',true)+`<div class="actions">${h.link('返回使用关闭回执','/user/privacy')}</div>`);
  let html=`<header class="page-head"><div><h1>既有交易权益</h1><p>查看原预约、商品、个人服务佣金及相关事项来源。</p></div><div class="actions">${h.link('返回使用关闭回执','/user/privacy')}</div></header>`;
  html+=h.notice('普通使用已关闭，原交易权益继续保留。进入原详情后，是否可办理仍按当前原业务状态、期限和金额核验。');
  if(data.closureId!=null)html+=h.panel('原关闭记录',h.row('使用关闭申请编号',h.esc(data.closureId))+h.row('实际关闭时间',h.date(data.closedAt)));
  const bookings=data.items.filter(item=>item.rootKind==='booking'),goods=data.items.filter(item=>item.rootKind==='goods'),promotion=data.items.filter(item=>item.rootKind==='service-promotion');
  if(bookings.length)html+=h.panel('原预约及相关事项',sourceList(bookings,h));
  if(goods.length)html+=h.panel('原商品及相关事项',sourceList(goods,h));
  if(promotion.length)html+=h.panel('个人服务佣金',h.notice('本页保留本人原记录查询入口。进入详情后由原业务继续核验可办理事项。')+sourceList(promotion,h));
  if(!data.items.length)html+=h.panel('暂无已核验的原业务入口',h.notice(data.manualReview.length?'原来源仍需人工核对，核验后可从原详情查询。':'当前没有可核验的本人旧交易来源。可返回使用关闭回执查看处理说明。'));
  if(data.manualReview.length)html+=h.panel('待人工核对',h.notice('以下原来源尚未核验，暂不提供业务详情入口。请通过原使用关闭回执向负责人员提供申请编号及待核对来源。',true)+data.manualReview.map(item=>`<article class="list-row"><div><h3>${h.esc(label(item.kind))}</h3>${item.id!=null?`<p>${h.esc(item.id)}</p>`:''}<p class="muted">${h.esc(item.reason)}</p></div><span class="tag">待人工核对</span></article>`).join(''));
  return html;
}
