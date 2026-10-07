import { goodsLogisticsAutoReceipt } from './goods-logistics-policy.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
const group = (a,jobs) => a.role === 'group' && (!a.job || a.job === 'all' || jobs.includes(a.job));
const byLabel = a => a ? `${a.accountId || a.id || '未记录'} · ${a.job || a.role || '未记录'}` : '未记录';
function helpers(ui,actor) {
  const e=ui.esc,d=v=>e(ui.date(v)),panel=(title,body)=>`<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`,row=(label,value)=>`<div class="row"><span class="muted">${e(label)}</span><span>${e(value)}</span></div>`;
  const note=text=>`<p class="notice" role="status">${e(text)}</p>`;
  const form=(type,p,fields,label)=>`<form class="management-form" data-management-form="${e(`goods-logistics:${actor.accountId || actor.userId || actor.job || 'all'}:${p.id || 'policy'}:${type}:${p.factId || ''}`)}" data-command="${e(type)}" data-payload="${e(JSON.stringify(p))}" data-live-version="${e(p.version)}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="btn primary">${e(label)}</button><button type="button" class="btn secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  const select=(label,name,options,value='')=>ui.select(label,name,options.map(([value,label])=>({value,label})),value);
  const reason=label=>`<label class="field wide"><span>${e(label)}</span><textarea name="reason" required maxlength="1000" rows="3"></textarea></label>`;
  const table=(heads,rows)=>rows.length?`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:ui.empty('尚无本地物流配置');
  return{e,d,panel,row,note,form,select,reason,table};
}
export function goodsLogisticsPolicyView(s,rawActor,ui,options={}) {
  let actor;try{actor=resolveAccountActor(s,rawActor);}catch(error){return ui.empty('工作身份已失效',error.message);}
  if(!group(actor,['operations']))return ui.empty('当前岗位无权查看物流政策配置');
  const h=helpers(ui,actor),records=s.goodsLogisticsPolicies || [],version=Math.max(0,...records.map(r=>r.version)),choose=[['','请明确选择']];
  let body=`<header class="page-head"><div><h1>商品物流配置</h1><p>本地Demo输入，正式期限、赔付和无人领取最终处置仍待确认。</p></div></header>`;
  if(options.canCommand?.('goods-logistics.policy-publish')) {
    const fields=h.select('适用范围','scope',[...choose,['all','全部商品的新订单'],['skus','明确SKU组成的新订单']]) + ui.field('适用SKU编号（指定SKU时必填）','skuIds','','text','maxlength="1000"') + ui.field('配置生效时间（不能倒签）','effectiveAt','','datetime-local','required') + h.select('自动收货','autoReceiptMode',[...choose,['disabled','保持关闭'],['enabled','按实际已核实送达事实启用']]) + ui.field('自动收货等待分钟（启用时必填）','autoReceiptMinutes','','number','min="1" step="1"') + ui.field('配送运单人工跟进分钟（选填）','deliveryFollowupMinutes','','number','min="1" step="1"') + ui.field('寄回运单人工跟进分钟（选填）','returnTransitFollowupMinutes','','number','min="1" step="1"') + ui.field('返还运单人工跟进分钟（选填）','returnBackFollowupMinutes','','number','min="1" step="1"') + h.select('赔付办理口径','compensationMode',[...choose,['not-configured','正式政策未配置'],['case-agreement','逐案协商，原售后执行']]) + ui.field('逐案赔付协商依据（采用时必填）','compensationBasis','','text','maxlength="1000"') + h.select('无人领取办理口径','unclaimedMode',[...choose,['not-configured','最终处置未配置'],['manual-hold','人工保管并协调']]) + ui.field('人工保管与协调依据（采用时必填）','unclaimedBasis','','text','maxlength="1000"') + h.reason('配置依据及本地发布说明');
    body+=h.panel('发布明确的本地配置',h.note('空配置不能自动收货或处置货物。启用后仅适用于创建时锁定此规则的新单；更改配置保留旧单规则。跟进到期仅提示人工核实，不自动赔付、销毁、扣款或结案。')+h.form('goods-logistics.policy-publish',{version},fields,'发布本地Demo物流配置'));
  }
  body+=h.panel('配置与生效历史',h.table(['版本 / 适用范围','生效 / 发布时间','自动收货','依据 / 发布人','正式政策'],[...records].reverse().map(p=>[`v${h.e(p.version)}<small>${h.e(p.scope==='all'?'全部新单':p.skuIds.join('、'))}</small>`,`${h.d(p.effectiveAt)}<small>${h.d(p.publishedAt)}</small>`,h.e(p.autoReceiptMode==='enabled'?`实际已核实送达后 ${p.autoReceiptMinutes} 分钟`:'关闭'),`${h.e(p.reason)}<small>${h.e(byLabel(p.publishedBy))}</small>`,'尚未确认'])));
  return body;
}
export function goodsLogisticsOrderPanel(s,rawActor,o,ui,options={}) {
  let actor;try{actor=resolveAccountActor(s,rawActor);}catch{return '';}
  const own=actor.role==='user'&&actor.userId===o.userId,store=['store','manager'].includes(actor.role)&&actor.storeId===o.source?.storeId,groupRead=group(actor,['support','warehouse','finance']);
  if(!own&&!store&&!groupRead)return '';
  const h=helpers(ui,actor),p=o.logisticsPolicySnapshot,state=goodsLogisticsAutoReceipt(s,o),facts=o.goodsDeliveryFacts || [],full=own||group(actor,['support','warehouse']);
  let body=h.row('本单物流规则',p?`v${p.version} · 本地Demo配置`:'创建时未配置，自动收货关闭')+h.row('自动收货',p?.autoReceiptMode==='enabled'?`以实际已核实送达后 ${p.autoReceiptMinutes} 分钟起算`:'未启用')+h.row('当前进度',o.status==='received'?'原收货事实已记录':state.reason || '已到本单规则时点，等待原收货流程确认');
  if(state.dueAt!=null)body+=h.row('规则时点',ui.date(state.dueAt));
  if(full&&p)body+=h.row('规则依据',p.reason)+h.note('本单沿用下单时锁定的规则。赔付按原售后逐案协商，跟进到期不会自动处置货物或改变款项。');
  if(full&&facts.length)body+=h.table(['原事实 / 当前状态','实际发生 / 登记','凭据 / 记录人','核实'],facts.map(f=>[`${h.e(f.id)}<small>${h.e(f.replacedBy?'已更正':({pending:'待核实',verified:'已核实',rejected:'未予核实'})[f.status]||'未知')}</small>`,`${h.d(f.occurredAt)}<small>${h.d(f.recordedAt)}</small>`,`${h.e(f.reference)}<small>${h.e(byLabel(f.by))}</small>`,(f.verifications || []).map(v=>`${h.e(v.decision==='verified'?'已核实':'未予核实')} · ${h.d(v.occurredAt)}<small>${h.e(byLabel(v.by))} · ${h.e(v.reason)} · ${h.e(v.evidence)}</small>`).join('')||'尚无核实记录']));
  if(full&&facts.length)body+=`<details class="action-details"><summary>原送达证据与更正依据</summary>${facts.map(f=>`<article><p>${h.e(f.id)} · ${h.e(f.evidence)}</p><p>${h.e(f.reason)}</p>${f.replacesId?`<p>更正原事实：${h.e(f.replacesId)}</p>`:''}</article>`).join('')}</details>`;
  if(groupRead&&options.canCommand?.('goods-logistics.delivery-record')&&['shipped','received'].includes(o.status)&&o.shipment)body+=`<details class="action-details"><summary>登记实际送达或签收</summary>${h.note('须登记已真实发生的事实和原运单凭据；登记后待客服核实。不能用出库时间替代签收。')}${h.form('goods-logistics.delivery-record',{id:o.id,version:o.version || 0},h.select('事实类型','kind',[['delivered','实际送达'],['signed','实际签收']],'delivered')+ui.field('实际送达或签收时间','occurredAt','','datetime-local','required')+ui.field('实际送达证据','evidence','','text','required maxlength="1000"')+ui.field('外部实际凭据号','reference','','text','required maxlength="1000"')+h.select('更正原事实（选填）','replacesId',[['','登记新的事实'],...facts.filter(f=>!f.replacedBy).map(f=>[f.id,f.id])])+h.reason('事实说明或更正依据'),'保存实际事实，交客服核实')}</details>`;
  if(groupRead&&options.canCommand?.('goods-logistics.delivery-verify'))for(const f of facts.filter(f=>!f.replacedBy))body+=`<details class="action-details"><summary>核实送达事实 ${h.e(f.id)}</summary>${h.form('goods-logistics.delivery-verify',{id:o.id,factId:f.id,version:o.version || 0},h.select('实际核实结论','decision',[['verified','实际依据核实通过'],['rejected','依据不足，不予核实']],'rejected')+ui.field('核实实际发生时间','occurredAt','','datetime-local','required')+ui.field('核实证据','evidence','','text','required maxlength="1000"')+h.reason('核实说明'),'保存实际核实结果')}</details>`;
  if(!full&&facts.length)body+=h.row('最新送达事实核实',({pending:'待客服核实',verified:'已核实',rejected:'未予核实'})[facts.filter(f=>!f.replacedBy).at(-1)?.status]||'待核对');
  return h.panel('物流规则与实际送达',body);
}
