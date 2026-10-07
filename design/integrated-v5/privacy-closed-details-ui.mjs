// C09 closed-use details consume verified minimal sources, never ordinary promotion views.
import { closedRightsBinding, closedRightsView, assertClosedRightsCommand } from './privacy-closed-rights.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';

const KINDS={commissions:'service-commission',withdrawals:'service-withdrawal',recoveries:'service-promotion-recovery'};
const TITLES={'service-commission':'原个人服务佣金','service-withdrawal':'原个人提现','service-promotion-recovery':'原个人佣金扣回'};
const WITHDRAWAL_STATUS={requested:'等待财务发起原笔',processing:'原笔结果待查询',awaiting_user:'待本人确认收款',cancel_requested:'原撤销结果待查询',paid:'实际转账成功',success:'实际转账成功',failed:'原转账明确失败',cancelled:'原申请或渠道已撤销',new:'尚未发起原笔'};
const STATUS={
  'service-commission':{pending:'原佣金待结算',available:'原佣金已具备资金条件',withdrawing:'原提现占款中',paid:'原佣金已付',void:'原佣金已作废','needs-review':'原佣金来源待核对'},
  'service-withdrawal':WITHDRAWAL_STATUS,
  'service-promotion-recovery':{open:'原已付佣金待扣回',closed:'原扣回已按事实结清',loss:'原损失已登记','return-pending':'原超收待实际退回','needs-review':'原扣回依据待核对'}
};
function helpers(ui={}){
  const esc=ui.esc||(v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const link=(label,path)=>ui.link?ui.link(esc(label),path,'btn secondary'):`<a class="btn secondary" href="#${esc(path)}">${esc(label)}</a>`;
  const notice=(text,warning=false)=>`<p class="notice${warning?' warning':''}" role="status">${esc(text)}</p>`;
  const row=(label,value)=>`<div class="row"><span class="muted">${esc(label)}</span><span>${value}</span></div>`;
  const panel=(title,body)=>`<section class="panel management-panel"><h2>${esc(title)}</h2>${body}</section>`;
  const money=n=>Number.isSafeInteger(n)&&n>=0?esc(ui.money?ui.money(n):`¥${(n/100).toFixed(2)}`):esc('金额待人工核对');
  const date=t=>Number.isSafeInteger(t)&&t>=0?esc(ui.date?ui.date(t):new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})):esc('原时间待核对');
  const returns=()=>`<div class="actions">${link('返回既有权益','/user/rights')}${link('返回使用关闭回执','/user/privacy')}</div>`;
  const form=(actor,command,p,fields,label)=>`<form class="management-form" data-management-form="${esc(`closed-rights:${actor.userId}:${p.id}:${command}`)}" data-command="${esc(command)}" data-payload="${esc(JSON.stringify(p))}" data-live-version="${esc(p.version)}"><div class="management-grid">${fields}<label class="field wide"><span>本人决定说明</span><textarea name="reason" required maxlength="1000" rows="3"></textarea></label></div><p class="small muted" role="status">提交后仍按原记录版本、当前状态和原截止核验。</p><p class="small muted management-draft-note" role="status">未提交内容保留在当前标签页。</p><div class="actions"><button type="submit" class="btn primary">${esc(label)}</button><button type="button" class="btn secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  return{esc,link,notice,row,panel,money,date,returns,form};
}
function financialRoute(route){
  if(!Array.isArray(route)||route.length!==3||route[0]!=='service-promotion'||!KINDS[route[1]])return null;
  try{const id=decodeURIComponent(route[2]);return typeof id==='string'&&id.trim()===id&&id?{kind:KINDS[route[1]],id}:null;}catch{return null;}
}
function manual(h,reason){
  return h.panel('原权益来源待人工核验',h.notice(reason,true)+h.notice('请通过使用关闭回执提供原申请编号，由负责人员核对后继续处理。')+h.returns());
}
function scopedFormAllowed(s,actor,command,p,options){
  try{if(options.canCommand&&options.canCommand(command)!==true)return false;return Boolean(assertClosedRightsCommand(s,actor,command,p));}catch{return false;}
}
function withdrawalActions(s,actor,item,h,options){
  const w=(s.servicePromotionWithdrawals||[]).find(x=>x.id===item.id),p={id:item.id,version:item.sourceVersion};
  if(!w||!Number.isSafeInteger(p.version)||p.version<0)return h.notice('原记录版本待人工核对，核验后才能回应旧申请。',true);
  if(w.status==='awaiting_user'){
    const deadline=item.financial?.confirmExpiresAt;
    if(!Number.isSafeInteger(deadline)||deadline<=s.now)return h.notice('原渠道本人确认期限缺失或已过，请由财务继续查询原笔结果；本页不延长原截止。',true);
    const command='service-promotion.withdraw-confirm';
    if(scopedFormAllowed(s,actor,command,{...p,decision:'accept'},options))return h.panel('回应原笔收款',h.notice('本人接受后，原笔仍须由财务查询实际渠道结果。本人决定不代表实际到账。')+h.form(actor,command,p,'<label class="field"><span>本人原笔收款决定</span><select name="decision" required><option value="" selected>请明确选择</option><option value="accept">本人接受该原笔收款</option><option value="reject">本人拒绝，继续核对原撤销结果</option></select></label>','提交本人原笔决定'));
  }
  if(['requested','failed'].includes(w.status)&&w.execution?.status!=='processing'){
    const command='service-promotion.withdraw-cancel';
    if(scopedFormAllowed(s,actor,command,p,options))return h.panel('撤销明确未成功的原申请',h.notice('仅处理这笔旧申请，原申请记录和当日已创建次数保留。')+h.form(actor,command,p,'','撤销这笔原申请'));
  }
  return ['processing','cancel_requested'].includes(w.status)?h.notice('原笔结果仍待财务查询，对应款项继续按原记录处理。'):'';
}
function financialDetail(s,actor,item,h,options){
  const title=TITLES[item.kind],f=item.financial||{};
  let body=h.row('原来源编号',h.esc(item.id))+h.row('原个人推广身份',h.esc(item.rootId))+h.row('当前原状态',h.esc(STATUS[item.kind]?.[item.status]||'原状态待核对'))+h.row('原记录版本',h.esc(item.sourceVersion??'待核对'))+h.row('实际使用关闭时间',h.date(item.closedAt));
  if(item.kind==='service-commission')body+=h.row('原应计佣金',h.money(f.known===true?f.commissionCents:null))+h.notice(f.known===true?'原金额沿实际佣金记录核对。未申请余额的处理请通过原关闭回执联系负责人员。':'原佣金金额尚待核对，继续保留原记录。',f.known!==true);
  if(item.kind==='service-promotion-recovery')body+=h.row('原应扣回',h.money(f.known===true?f.amountCents:null))+h.row('原实际已收回',h.money(f.receivedCents))+h.row('原尚待扣回',h.money(f.known===true?f.outstandingCents:null))+h.row('原超收待退',h.money(f.known===true?f.returnPendingCents:null))+h.notice('原实际收付由财务按原资金记录继续办理，本人可保留此来源查询进度。');
  if(item.kind==='service-withdrawal')body+=h.row('原提现申请金额',h.money(f.amountCents))+(f.confirmExpiresAt!=null?h.row('原渠道本人确认截止',h.date(f.confirmExpiresAt)):'')+(f.execution?h.row('原渠道最后记录',h.esc(WITHDRAWAL_STATUS[f.execution.status]||'原结果待核对')):'')+(f.execution?.status==='success'&&f.execution.completedAt!=null?h.row('原实际成功发生时间',h.date(f.execution.completedAt)):'');
  return `<header class="page-head"><div><h1>${h.esc(title)}</h1><p>查询本人使用关闭前的原资金权益。</p></div>${h.returns()}</header>`+h.panel(title,body)+h.notice('普通使用已关闭，原资金事实和既有权益保留。')+(item.kind==='service-withdrawal'?withdrawalActions(s,actor,item,h,options):'');
}

export function closedRightsDetailsUiView(s,rawActor,route=[],ui={},options={}){
  const h=helpers(ui);let actor;
  try{actor=resolveAccountActor(s,rawActor);}catch{ return rawActor?.role==='user'&&privacyUseClosed(s,rawActor.userId)?manual(h,'当前本人工作会话已失效，请重新核验使用关闭身份。'):null; }
  if(actor?.role!=='user'||!privacyUseClosed(s,actor.userId))return null;
  const parsed=financialRoute(route);
  if(!parsed)return h.panel('请从既有权益查询原记录',h.notice('请返回权益列表选择已核验的原来源；此入口不会恢复普通使用。')+h.returns());
  try{
    const binding=closedRightsBinding(s,actor,parsed.kind,parsed.id),view=closedRightsView(s,actor),matches=(view?.items||[]).filter(x=>x.kind===parsed.kind&&x.id===parsed.id&&x.rootId===binding.rootId&&x.sourceVersion===binding.sourceVersion);
    if(matches.length!==1||binding.rootKind!=='service-promotion')return manual(h,'原资金来源缺失或已变化，须按关闭依据人工核验。');
    return financialDetail(s,actor,matches[0],h,options);
  }catch{return manual(h,'原关闭依据或本人资金来源尚未通过核验，暂不显示未核记录。');}
}
