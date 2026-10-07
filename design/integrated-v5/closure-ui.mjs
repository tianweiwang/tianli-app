import { assertJob } from './management.mjs';
export function closurePanels(s, o, actor, ui) {
  const { esc:e, date:d, money:m, field:f, select:sel } = ui;
  const staff = ['store','manager','group'].includes(actor.role);
  const can = command => { if (!staff) return false; try { assertJob(actor, command); return true; } catch { return false; } };
  const panel = (name, body) => `<section class="panel"><h2>${e(name)}</h2>${body}</section>`;
  const form = (command, payload, body, label) => `<form class="stack" data-command="${command}" data-payload="${e(JSON.stringify(payload))}">${body}<div class="actions"><button type="submit" class="secondary">${e(label)}</button></div></form>`;
  const labels = {verifying:'等待核实', 'awaiting-user':'等待用户确认', refunding:'分笔退款中', resolved:'已处理', open:'待处理', closed:'已结案'};
  let html = '';
  if (o.completionKind?.startsWith('interrupted') || o.completionKind === 'adjudicated-user') html += panel('服务中止记录', `<p>实际停止于 ${e(d(o.stoppedAt))}，按实际履约与核实结果处理。</p>`);
  for (const item of o.disputes || []) {
    let body = `<div class="row"><strong>${e(item.id)}</strong><span>${e(labels[item.status] || item.status)}</span></div><p>${e(item.reason)}</p>`;
    if (item.kind === 'interruption') {
      const refund = (o.refunds || []).find(r => r.id === item.refundId);
      body += `<p>实际 ${e(item.actualMinutes)} / 预约 ${e(item.totalMinutes)} 分钟</p>`;
      if (refund) {
        const succeeded = (refund.executions || []).filter(x => x.status === 'success').reduce((n, x) => n + x.amountCents, 0);
        const amount = refund.status === 'success' ? succeeded : refund.amountCents;
        body += `<p>${refund.status === 'success' ? '实际退款' : refund.acceptedVersion === refund.version ? '已确认退款方案' : '当前退款方案'} ${m(amount)} · 第 ${e(refund.version || 1)} 版</p>`;
        if (succeeded > 0 && refund.status !== 'success') body += `<p>已成功退回 ${m(succeeded)}，其余支付按退款结果继续处理。</p>`;
        if (refund.reviewReason) body += `<p>当前退款处理依据：${e(refund.reviewReason)}</p>`;
      } else if (item.actualRefundCents != null) body += `<p>实际退款 ${m(item.actualRefundCents)}</p>`;
    }
    if (item.resolution) body += `<p>处理依据：${e(item.resolution)}</p>`;
    if (item.refundId) body += `<p class="muted">关联退款 ${e(item.refundId)}，以各支付的退款结果跟踪结案。</p>`;
    if (item.accountRestriction?.status === 'pending' && staff) body += '<p class="notice warning">用户限制待办尚未执行；完整用户管理仍在后续补齐清单中。</p>';
    if (item.status === 'verifying' && can('booking.dispute-review')) body += form('booking.dispute-review', {id:o.id,disputeId:item.id}, sel('核实责任','responsibility',[{value:'health',label:'身体不适，退未服务部分'},{value:'non-user',label:'非用户原因，退未服务部分'},...(item.category === 'health' ? [] : [{value:'user',label:'用户原因，按原规则不退'}])],'health') + f('核实依据','reason','','text','required maxlength="500"'),'形成处理方案');
    if (item.kind === 'service' && item.status === 'open' && can('booking.dispute-close')) body += form('booking.dispute-close',{id:o.id,disputeId:item.id},f('争议处理结果','resolution','','text','required maxlength="500"'),'独立争议结案');
    html += panel(item.kind === 'interruption' ? '中止核实与退款' : '独立服务争议', body);
  }
  const assistanceVisible = actor.role === 'user' && actor.userId === o.userId || ['store','manager'].includes(actor.role) && actor.storeId === o.storeId || actor.role === 'group' && (!actor.job || ['all','support'].includes(actor.job));
  if (assistanceVisible && o.assistance?.length) html += panel('门店协助记录', [...o.assistance].reverse().map(item => {
    let body = `<article class="case-card"><div class="row"><strong>${e(item.id)}</strong><span>${item.status === 'closed' ? '已回复' : '等待门店处理'}</span></div><p>${e(item.reason)}</p><p class="small muted">提交于 ${e(d(item.createdAt))}</p>`;
    if (item.response) body += `<p>处理回复：${e(item.response)}</p><p class="small muted">${item.closedBy?.role === 'group' ? '集团客服' : '门店'} · ${e(d(item.closedAt))}</p>`;
    if (item.status === 'open' && can('booking.assistance-close')) body += form('booking.assistance-close', {id:o.id,assistanceId:item.id}, f('处理回复','response','','text','required maxlength="500"'), '回复并结案');
    return `${body}</article>`;
  }).join(''));
  if (o.changeHistory?.length) html += panel('安排变更记录', [...o.changeHistory].reverse().map(c => {
    const describe = value => value ? `${value.techName || value.techId || '待安排'} · ${d(value.startAt)}` : '旧存档未保存此项';
    return `<article class="case-card"><div class="row"><strong>${e(c.kind === 'reschedule' ? '改约' : '改派')}</strong><span>${e(({accepted:'已接受',pending:'待确认',rejected:'已拒绝',expired:'已过期',withdrawn:'已撤回'})[c.status] || c.status)}</span></div><p>原安排：${e(describe(c.before))}</p><p>拟安排：${e(describe(c.after))}</p><p>${e(c.reason)}</p><p class="small muted">提出 ${e(d(c.createdAt))}${c.decidedAt ? ` · 处理 ${e(d(c.decidedAt))}` : ''}</p></article>`;
  }).join(''));
  return html;
}
