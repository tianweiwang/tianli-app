import { createTechHistoricalRightsAdapters } from './tech-historical-rights.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { servicePromotionUi } from './service-promotion-ui.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const panel = (title, body) => `<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const table = (heads, rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${heads.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">暂无原记录。</p>';
const STATUS = {pending:'缺依据待核对', held:'暂不可发', payable:'待发放', paid:'已发放', difference:'发放后待调整', open:'待处理', closed:'已办结'};

export function techHistoricalRightsEntry(s, rawActor, ui) {
  try {
    createTechHistoricalRightsAdapters().incomeView(s, rawActor);
    return ui.link('本人历史提成与佣金', '/user/tech-rights', 'btn secondary');
  } catch { return ''; }
}

export function techHistoricalRightsUi(s, rawActor, route, ui, options = {}) {
  let actor, tech, income;
  try {
    actor = resolveAccountActor(s, rawActor);
    const matches = (s.techs || []).filter(t=>t.userId===actor.userId);
    if (matches.length !== 1) throw new Error('本人关联尚未核验或来源冲突，请联系原管理人员核对。');
    tech = matches[0];
    income = createTechHistoricalRightsAdapters().incomeView(s, actor, tech.id);
  } catch (error) { return ui.empty('本人历史权益暂不可查看', error.message); }
  const page = route[1] || 'income';
  const nav = `<nav class="actions" aria-label="本人历史资金">${ui.link('原提成与发放', '/user/tech-rights', 'btn secondary')}${ui.link('原推广佣金与提现', '/user/tech-rights/promotion/promoters', 'btn secondary')}${ui.link('返回我的', '/user/me', 'btn secondary')}</nav>`;
  if (page === 'promotion') return nav + servicePromotionUi(s, ['service-promotion', ...route.slice(2)], actor, ui, {...options, historicalTechId:tech.id});
  if (page !== 'income' || route.length > 2) return ui.empty('本人历史权益入口不存在');
  const m = value => Number.isSafeInteger(value) ? e(ui.money(value)) : '待核对', d = value => e(ui.date(value));
  const name = id => e((s.stores || []).find(x=>x.id===id)?.name || id);
  return `<header class="page-head"><div><h1>本人历史提成与佣金</h1><p>${e(tech.name||'原技师')}的原记录继续按实际进展查询，后续款项由原负责岗位办理。</p></div></header>` + nav +
    panel('原提成明细', table(['原明细 / 预约 / 支付', '门店 / 月份', '原应计 / 已发放 / 已追回', '当前可发 / 状态'], income.entries.map(x=>[`${e(x.id)}<small>${e(x.bookingId)} · ${e(x.paymentId)}</small>`,`${name(x.storeId)}<small>${e(x.month)}</small>`,`${m(x.amountCents)} / ${m(x.paidCents)} / ${m(x.recoveredCents)}`,`${m(x.payableCents)}<small>${e(STATUS[x.status]||x.status)} · ${e(x.reason||'')}</small>`]))) +
    panel('原发放记录', table(['原批次 / 月份 / 门店', '实际发放金额 / 时间', '原凭证 / 说明', '原明细'], income.payouts.map(x=>[`${e(x.id)} · ${e(x.month)}<small>${name(x.storeId)}</small>`,`${m(x.amountCents)}<small>${d(x.paidAt)}</small>`,`${e(x.proof)}<small>${e(x.reason)}</small>`,(x.lines||[]).map(l=>e(l.entryId)).join('<br>')]))) +
    panel('原补发与追回差额', table(['原事项 / 预约 / 支付', '处理类型 / 原差额 / 待处理', '状态 / 原依据'], income.differences.map(x=>[`${e(x.id)}<small>${e(x.bookingId)} · ${e(x.paymentId)}</small>`,`${e(x.kind==='recover'?'追回':'补发')} · ${m(x.amountCents)} / ${m(x.remainingCents)}`,`${e(STATUS[x.status]||x.status)}<small>${e(x.reason)}</small>`]))) +
    panel('原提成调整', table(['原预约 / 支付 / 月份', '调整前 / 调整后 / 差额', '记录时间 / 原依据'], income.adjustments.map(x=>[`${e(x.bookingId)} · ${e(x.paymentId)}<small>${e(x.originMonth||x.month)}</small>`,`${m(x.beforeCents)} / ${m(x.afterCents)} / ${m(x.deltaCents)}`,`${d(x.at)}<small>${e(x.reason)}</small>`])));
}
