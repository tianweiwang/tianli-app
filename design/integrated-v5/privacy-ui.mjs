import {privacyData,PRIVACY_POLICY,privacyUseClosed} from './privacy.mjs';
import {closedRightsEntry} from './privacy-closed-rights-ui.mjs';
const e=v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v==null?'—':new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const panel=(title,body)=>`<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const notice=(text,warning=false)=>`<p class="notice${warning?' warning':''}" role="status">${e(text)}</p>`;
const row=(title,body)=>`<div class="row"><span class="muted">${e(title)}</span><span>${body}</span></div>`;
const content=(title,body)=>`<div><p class="muted">${e(title)}</p><p>${e(body)}</p></div>`;
const link=(title,path)=>`<a class="secondary" href="#${e(path)}">${e(title)}</a>`;
const field=(title,name,value='',attrs='required maxlength="100"')=>`<label class="field"><span>${e(title)}</span><input name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
const text=(title,name,attrs='required maxlength="500"')=>`<label class="field wide"><span>${e(title)}</span><textarea name="${e(name)}" rows="3" ${attrs}></textarea></label>`;
const check=(label,name)=>`<label class="check-row wide"><input type="checkbox" name="${e(name)}" value="true" required><span>${e(label)}</span></label>`;
const heading=(title,subtitle)=>`<header class="page-head"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div></header>`;
function form(a,command,payload,fields,label,key,confirm=''){
  const scope=[a.role,a.accountId || a.userId || '',a.job || ''].join(':');
  return `<form class="management-form" data-management-form="${e('privacy:'+scope+':'+key)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version)}" data-next="/${e(a.role)}/privacy"${confirm?` data-confirm="${e(confirm)}"`:''}><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${e(label)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
}
function blockers(items){return items.length?notice('以下事项尚未办结，客服暂不能关闭账号使用。申请不会自动取消订单或改变退款结果。',true)+items.map(x=>`<div class="list-row"><div><strong>${e(x.label)}</strong><p class="muted">${e(x.id)}</p></div>${link('查看并办理',x.path)}</div>`).join(''):notice('当前没有已识别的未结业务事项。客服办理时会重新核查。');}
function history(items){return `<ol class="timeline">${[...items].reverse().map(x=>`<li><p>${e(x.action || x.note)}</p><small>${e(date(x.at))} · ${e(x.by?.id || x.by?.role || '')}</small>${x.reason?`<p>${e(x.reason)}</p>`:''}</li>`).join('')}</ol>`;}
function receipt(a,c,canHandle){
  let body=row('申请编号',e(c.id))+row('申请时间',e(date(c.createdAt)))+row('申请进度',e(c.status==='requested'?'待客服核查':c.status==='retracted'?'已撤回':'使用已关闭 · 资料清理待完成'))+content('申请说明',c.reason);
  if(c.status==='use_closed'){
    body+=notice('已关闭普通使用并清理基础资料。历史业务材料、附件及缓存仍待核查处理；本回执不代表全部数据删除或匿名化完成。',true)+row('办理时间',e(date(c.closedAt)))+content('后续清理负责人',c.custodian)+content('办理说明',c.basis)+notice('既有交易权益继续保留。如需核实订单或售后，请将本申请编号交集团客服处理。');
    body+=`<h3>已处理的基础资料</h3><ul>${(c.cleared || []).map(x=>`<li>${e(x)}</li>`).join('')}</ul><h3>仍需核查的保留材料</h3>`;
    body+=(c.retention || []).map(x=>`<article class="panel"><strong>${e(x.label)}</strong><p class="muted">${x.count==null?'数量待核对':e(x.count)+' 条关联记录'} · 待核对与清理</p><p>${e(x.basis)}</p><p class="muted">具体期限待确认，不设置自动删除日期。</p></article>`).join('');
    if(c.followups?.length)body+='<h3>清理进度记录</h3>'+c.followups.map(x=>`<article class="panel"><p>${e(x.note)}</p><small>${e(date(x.at))} · 负责人 ${e(x.custodian)}</small></article>`).join('');
    if(canHandle)body+=form(a,'privacy.followup',{id:c.id,version:c.version},field('后续清理负责人','custodian',c.custodian)+text('处理进度与实际结果','note','required maxlength="1000"'),'登记清理进度',c.id+':followup','本次只追加实际处理记录，不会将尚未验证的资料清理标记完成。');
  }
  if(c.status==='requested'){
    if(canHandle){body+=blockers(c.blockers || []);if(!c.blockers?.length)body+=form(a,'privacy.close',{id:c.id,version:c.version},field('后续清理负责人','custodian')+text('办理依据与说明','reason')+check('我确认只关闭使用并清理基础资料；历史材料、附件及缓存仍由负责人继续核查。','acknowledged'),'关闭使用并登记保留事项',c.id+':close','确认关闭此用户的普通使用？该动作会清理基础资料，历史材料仍待后续处理；不会改动账务。');}
    else body+=form(a,'privacy.retract',{id:c.id,version:c.version},text('撤回申请原因','reason','required maxlength="300"'),'撤回本次申请',c.id+':retract','确认撤回这次使用关闭申请？');
  }
  return panel(c.status==='use_closed'?'使用关闭回执':'办理申请',body+history(c.history || []));
}
export function privacyUiView(s,actor,route=[]){
  if(route[0]!=='privacy')return null;
  const data=privacyData(s,actor);
  if(!data)return panel('当前身份无权查看隐私办理',notice('用户仅查看本人记录；集团客服负责核查申请和后续清理。',true));
  if(route.length!==1)return panel('页面不存在',notice('请从隐私中心或集团隐私办理列表进入。'));
  if(data.canHandle)return heading('隐私与使用关闭办理','按申请核查未结事项，登记资料保留与后续处理责任。')+notice('本地演示不会自动完成历史材料、附件或其他标签页缓存的物理清理。')+(data.closures.length?[...data.closures].reverse().map(c=>receipt(actor,c,true)).join(''):panel('暂无待处理申请','<p class="muted">用户提交申请后出现在这里。</p>'));
  const p=data.profile;
  let html=heading('隐私与账号使用','查看身份授权、申请关闭使用和资料处理进度。');
  if(privacyUseClosed(s,actor.userId))return html+notice('账号普通使用已关闭。此页保留办理回执及资料处理说明。',true)+(p.status==='use_closed'?closedRightsEntry(s,actor):notice('当前关闭依据需要人工核查，普通使用保持关闭；请凭原回执向集团客服核实。',true))+[...data.closures].filter(c=>c.status==='use_closed').reverse().map(c=>receipt(actor,c,false)).join('');
  const agreed=p.identityConsent?.agreed;
  html+=panel('身份核验演示授权',content('用途','用于预约人的身份核验演示，不采集真实身份证号。')+row('说明版本',e(PRIVACY_POLICY))+row('当前状态',e(agreed?'已明确同意':p.identityConsent?'已撤回':'尚未在隐私中心登记'))+notice('撤回后，新预约须在原预约步骤明确重新同意；已有订单、退款与求助继续可用。商城购物不要求此身份核验授权。')+form(actor,'privacy.consent',{version:p.version,purpose:'identity'},check('我同意身份核验演示及状态记录用于预约身份确认。','agreed'),'明确同意此用途','consent')+form(actor,'privacy.withdraw',{version:p.version,purpose:'identity'},text('撤回原因','reason','required maxlength="300"'),'撤回此用途授权','withdraw','确认撤回身份核验演示授权？原预约和退款权利保留，新预约需重新明确同意。')+(p.history.length?`<details class="action-details"><summary>授权与办理历史</summary>${history(p.history)}</details>`:''));
  html+=panel('未结事项核查',blockers(data.blockers));
  if(!data.closures.some(c=>c.status==='requested'))html+=panel('申请关闭账号使用',notice('申请可在办理前撤回。客服核查无未结事项后关闭普通使用并清理基础资料；订单、发票、争议、服务对象历史及附件可能仍需保留处理，最终范围与期限待确认。',true)+form(actor,'privacy.request',{version:p.version},text('申请说明','reason','required maxlength="300"')+check('我已阅读使用关闭、必要材料保留及待清理说明。','acknowledged'),'提交核查申请','request','确认提交申请？现有订单继续按原流程处理，客服无权跳过未结事项直接关闭使用。'));
  html+=[...data.closures].reverse().map(c=>receipt(actor,c,false)).join('');return html;
}
