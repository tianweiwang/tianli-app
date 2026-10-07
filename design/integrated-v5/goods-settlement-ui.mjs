import { goodsSettlementView, goodsSettlementExitBlockers } from './goods-settlement.mjs';
import { resolveAccountActor, canAccountView, canAccountReadSource } from './staff-accounts.mjs';
const PLAN_STATUS={proposed:'待本店确认',confirmed:'本店已确认，待集团执行',processing:'现金付款待查询，尚未抵扣',failed:'现金付款失败，原方案待重试',succeeded:'现金及抵扣已入账',rejected:'本店已驳回',cancelled:'集团已撤销',invalidated:'来源变化，需重新核对'};
const ACTIVE=new Set(['proposed','confirmed','processing','failed']);
function helpers(ui) {
  const e=ui.esc,m=ui.money,d=ui.date,f=ui.field;
  const form=(command,payload,body,label,kind='primary')=>`<form class="stack" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}"><div class="form-grid">${body}</div><div class="actions"><button type="submit" class="${kind}">${e(label)}</button></div></form>`;
  const panel=(title,body)=>`<section class="panel"><div class="panel-head"><h2>${e(title)}</h2></div><div class="panel-body">${body}</div></section>`;
  const note=value=>`<div class="notice" role="status">${e(value)}</div>`;
  const detail=(title,body)=>`<details class="action-details"><summary>${e(title)}</summary><div class="stack">${body}</div></details>`;
  const row=(label,value)=>`<div class="row"><span class="muted">${e(label)}</span><strong>${e(value)}</strong></div>`;
  const reason=label=>f(label,'reason','','text','required minlength="2" maxlength="500"');
  const choice=(label,name,values)=>`<label class="field"><span>${e(label)}</span><select name="${e(name)}" required>${values.map(([id,title])=>`<option value="${e(id)}">${e(title)}</option>`).join('')}</select></label>`;
  const orders=(rows,selected=[])=>`<fieldset><legend>选择商品订单明细</legend><div class="stack">${rows.map(line=>`<label class="check"><input type="checkbox" name="orderIds" value="${e(line.orderId)}"${selected.includes(line.orderId)?' checked':''}><span>${e(line.orderId)} · ${e(m(line.amountCents))}</span></label>`).join('')}</div></fieldset>`;
  return{e,m,d,f,form,panel,note,detail,row,reason,choice,orders};
}
function can(actor,command,options) { if(options.canCommand)return options.canCommand(command);return command==='bill.offset-confirm'||command==='bill.dispute-lines'?['store','manager'].includes(actor.role):actor.role==='group'&&(!actor.job||['all','finance'].includes(actor.job)); }

export function goodsBillSettlementPanel(s,actor,bill,ui,options={}) {
  actor=resolveAccountActor(s,actor);
  const h=helpers(ui),view=goodsSettlementView(s,actor,bill.id,{goodsSummary:options.goodsSummary}),b=view.bills[0];if(!b)return'';
  let html='';
  if(b.parentBillId)html+=h.row('原账单',b.parentBillId)+(ui.link?`<div class="actions">${ui.link('查看原账单',`/${actor.role}/bills/${encodeURIComponent(b.parentBillId)}`,'secondary')}</div>`:'');
  if(b.childBillIds?.length)html+=h.detail('已拆出的子账',b.childBillIds.map(id=>ui.link?ui.link(id,`/${actor.role}/bills/${encodeURIComponent(id)}`):h.e(id)).join(' · '));
  if(b.disputeReference)html+=h.note(b.disputeReference.currentStatus==='resolved'?`原账 ${b.disputeReference.billId} 的差异已核查，依据留在原账；本子账只包含当前无争议的明细。`:b.disputeReference.currentStatus==='open'?`原账 ${b.disputeReference.billId} 的差异继续在原账处理，本子账只包含已确认无争议的明细。`:`本子账源自原账 ${b.disputeReference.billId} 的无争议明细；拆分依据和差异处理记录请查看原账。`);
  const current=view.plans.find(p=>p.id===b.activeOffsetPlanId&&ACTIVE.has(p.status));
  if(['review','adjusted','disputed','confirmed','failed'].includes(b.status)&&!current&&can(actor,'bill.dispute-lines',options))html+=h.detail('逐项确认差异范围',h.note('勾选至少一项有差异的订单；未勾选的明细明确确认为无争议。全部差异已消除时，由集团处理原差异后再核对；既有依据保留。')+h.form('bill.dispute-lines',{id:b.id,version:b.version},h.orders(b.items,b.dispute?.status==='open'?b.dispute.orderIds||[]:[])+h.reason('差异范围与核对依据'),'保存差异明细','secondary'));
  const candidates=b.items.filter(x=>b.splitCandidates.includes(x.orderId));
  if(['review','adjusted','disputed','confirmed','failed'].includes(b.status)&&!current&&b.items.length>1&&candidates.length&&can(actor,'bill.split',options))html+=h.detail('拆出无争议款项先核对',h.note('所选行转入新子账，原账保留余项与差异；新子账仍须本店核对，再由集团付款。')+h.form('bill.split',{id:b.id,version:b.version},h.orders(candidates)+h.reason('拆账依据'),'转入新子账','secondary'));
  const debts=view.recoveries.filter(r=>r.availableCents>0);
  if(['review','adjusted','confirmed','failed'].includes(b.status)&&b.dispute?.status!=='open'&&!current&&b.amountCents>0&&debts.length&&can(actor,'bill.offset-propose',options))html+=h.detail('提出本店商品佣金抵扣方案',h.note('仅使用本店已确认商品追回债务。本店同意后，现金最终成功才实际冲抵；全额抵扣由集团明确执行。')+h.form('bill.offset-propose',{id:b.id,version:b.version},h.choice('商品追回单','recoveryId',debts.map(r=>[r.id,`${r.id} · ${r.orderId} · 可抵扣${h.m(r.availableCents)}`]))+h.f('本次抵扣（元）','amountCents','','number',`required min="0.01" max="${b.amountCents/100}" step="0.01" data-unit="yuan"`)+h.reason('抵扣依据'),'发送本店核对'));
  for(const p of [...view.plans].reverse()) {
    const payload={id:b.id,planId:p.id,version:p.version};
    let body=h.row('方案',p.id)+h.row('当前状态',PLAN_STATUS[p.status]||p.status)+h.row('本账应结总额',h.m(p.grossCents))+h.row('商品债务抵扣',h.m(p.offsetCents))+h.row('本次现金付款',h.m(p.cashCents))+h.row('原付款标识',p.paymentId)+`<p>方案依据：${h.e(p.reason)}</p>`;
    body+=p.allocations.map(a=>h.row(`追回单 ${a.recoveryId}`,h.m(a.amountCents))).join('');
    if(p.confirmation)body+=`<p>本店意见：${h.e(p.confirmation.reason)} · ${h.e(h.d(p.confirmation.at))}</p>`;
    if(p.status==='proposed')body+=h.note('方案已提交，等待本店确认；提出方案只占用额度，债务尚未清偿。');
    if(p.status==='processing')body+=h.note('现金结果未知：原债务保持未清偿，抵扣额度被原方案占用。查询原笔结果，不能另处提前冲销。');
    if(p.status==='proposed'&&can(actor,'bill.offset-confirm',options))body+=h.form('bill.offset-confirm',payload,h.choice('本店核对决定','decision',[['accept','同意该抵扣和现金方案'],['reject','驳回，继续协调']])+h.reason('本店核对意见'),'提交方案意见');
    if(['confirmed','failed'].includes(p.status)&&can(actor,'bill.offset-pay',options))body+=h.form('bill.offset-pay',{...payload,outcome:'processing'},'',p.cashCents?p.status==='failed'?'原交易重新执行现金付款':'执行方案并发起现金付款':'执行确认冲抵，无需现金付款');
    if(p.status==='processing'&&can(actor,'bill.offset-query',options))body+=h.form('bill.offset-query',payload,h.choice('现金原笔查询结果','outcome',[['processing','仍处理中，继续等待'],['success','核实原笔成功'],['failed','核实原笔失败']]),'查询原笔结果');
    if(['proposed','confirmed','failed'].includes(p.status)&&can(actor,'bill.offset-cancel',options))body+=h.detail('撤销尚未成功方案',h.form('bill.offset-cancel',payload,h.reason('撤销依据'),'撤销并重新核对','secondary'));
    if(p.status==='succeeded')body+=h.note(`实际结佣${h.m(p.grossCents)}＝现金${h.m(p.cashCents)}＋抵扣${h.m(p.offsetCents)}，清偿已记入各商品追回单。`);
    if(p.completionReason)body+=h.note(p.completionReason);
    if(p.history?.length)body+=h.detail('方案记录',`<ol class="timeline">${p.history.map(r=>`<li><p>${h.e(r.action)}</p><time>${h.e(h.d(r.at))}</time></li>`).join('')}</ol>`);
    html+=h.detail(`抵扣方案 ${p.id} · ${PLAN_STATUS[p.status]||p.status}`,body);
  }
  if(b.cashPaidCents!=null)html+=h.row('实际现金付款',h.m(b.cashPaidCents))+h.row('实际债务抵扣',h.m(b.offsetSettledCents))+h.row('已结佣金总额',h.m(b.grossSettledCents));
  return html?h.panel('商品结算拆账与抵扣',html):'';
}

export function goodsRecoverySettlementPanel(s,actor,rows,ui) {
  actor=resolveAccountActor(s,actor);
  const h=helpers(ui);if(!canAccountView(actor,'recoveries')||!['group','store','manager'].includes(actor.role)||actor.role==='group'&&actor.job&&!['all','finance'].includes(actor.job))return'';
  const stores=new Set((rows||[]).filter(r=>(actor.role==='group'||r.storeId===actor.storeId)&&canAccountReadSource(s,actor,'goods-recovery',r)).map(r=>r.storeId));
  const body=[...stores].map(storeId=>{
    const blockers=goodsSettlementExitBlockers(s,storeId),name=(s.stores||[]).find(x=>x.id===storeId)?.name||storeId;
    const debts=blockers.debts.filter(r=>canAccountReadSource(s,actor,'goods-recovery',r));
    const plans=blockers.plans.filter(p=>canAccountReadSource(s,actor,'goods-offset',p));
    const bills=blockers.bills.filter(b=>canAccountReadSource(s,actor,'bill',b));
    const notice=actor.lifecyclePurpose?'仅显示本案授权范围内的商品清偿记录；完整退出条件由集团核对。':bills.length||debts.length||plans.length?'仍有商品账单、债务或执行方案待处理，退出不能直接免除欠款。':'当前商品账单及债务已结清；组织退出还须核对其他业务。';
    return h.detail(`${name} 商品清偿与退出核对`,h.note(notice)+debts.map(r=>h.row(`${r.id} 尚欠${h.m(r.outstandingCents)}`,`方案占用${h.m(r.reservedCents)} · 人工可收${h.m(Math.max(0,r.outstandingCents-r.reservedCents))}`)).join('')+plans.map(p=>h.row(p.id,PLAN_STATUS[p.status]||p.status)).join(''));
  }).join('');
  return body?h.panel('商品债务清偿范围',body):'';
}
