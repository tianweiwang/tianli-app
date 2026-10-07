// General-warning views reuse management forms. Every action is checked by the domain.
import { technicianPenaltyView, technicianPenaltyCaseResolution } from './technician-penalties.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value == null ? '—' : new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const panel = (title, body) => `<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const note = (body, warning = false) => `<p class="notice${warning ? ' warning' : ''}" role="status">${e(body)}</p>`;
const row = (title, body) => `<div class="row"><span class="muted">${e(title)}</span><span>${body}</span></div>`;
const prose = (title, body) => `<div class="penalty-prose"><p class="muted">${e(title)}</p><p>${e(body)}</p></div>`;
const field = (title, name, type = 'text', attrs = 'required maxlength="200"') => `<label class="field"><span>${e(title)}</span><input type="${e(type)}" name="${e(name)}" value="" ${attrs}></label>`;
const text = (title, name = 'reason', required = true) => `<label class="field wide"><span>${e(title)}</span><textarea name="${e(name)}" rows="3" ${required ? 'required ' : ''}maxlength="1000"></textarea></label>`;
const author = a => a?.accountId ? `${a.accountName || '工作员工'} · ${a.accountId}` : `${({ tech: '本人技师', store: '原门店', manager: '原店长', group: '集团客服' })[a?.role] || '原作者'} · ${a?.id || ''}`;
const policyNote = () => note('较重、严重处罚及用户限制仍待正式标准和专项办理。一般警告不产生停单天数、罚款或资格暂停。');

function helpers(actor) {
  const path = id => `/${actor.role}/penalties${id ? '/' + encodeURIComponent(id) : ''}`;
  const link = (title, target, kind = '') => `<a class="${e(kind)}" href="#${e(target)}">${e(title)}</a>`;
  const form = (command, payload, fields, title, key, next, confirm) => `<form class="management-form" data-management-form="${e(`penalty:${actor.role}:${actor.accountId || actor.techId || actor.storeId || ''}:${actor.grantId || ''}:${key}:${command}`)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? payload.caseVersion)}" data-next="${e(next)}" data-confirm="${e(confirm)}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${e(title)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  const head = (title, body, actions = '') => `<header class="page-head"><div><h1>${e(title)}</h1><p>${e(body)}</p></div><div class="actions">${actions}</div></header>`;
  return { path, link, form, head };
}
function warningForm(source, h) {
  const payload = { caseId: source.caseId, actionIndex: source.actionIndex, caseVersion: source.caseVersion, sourceToken: source.sourceToken };
  return note('请核对实际已成立的一般问题和原门店警告决定。记录编号用于回溯实际决定，不代表已上传文件。') +
    h.form('penalty.warning-record', payload, field('实际警告决定来源编号', 'reference') + field('实际警告决定发生时间', 'occurredAt', 'datetime-local', 'required') + text('本人可见的事实与警告依据') + text('内部核实备注（本人不可见，可选）', 'internalNote', false), '确认原一般警告入档', `case:${source.caseId}:${source.actionIndex}`, h.path(), '确认这是原案件已核实的一般问题及实际门店警告决定？原专项将按真实记录核验。');
}
function penaltyDetail(x, actor, h) {
  if (!x.sourceValid) return panel('原决定来源待核对', note(x.reason, true));
  const d = x.decision;
  let body = rowFacts(x, actor, h) + rowFactDecision('原门店警告决定', d);
  if (d.internalNote) body += prose('内部核实备注', d.internalNote);
  let html = panel('一般警告原档', body);
  if (x.canAppeal) html += panel('本人一次申诉', note('每笔原警告可由实际技师本人申诉一次，集团客服复核并保留原决定。') + h.form('penalty.appeal', { id: x.id, version: x.version, sourceToken: x.sourceToken }, text('本人申诉事实与理由'), '提交一次申诉', x.id, h.path(x.id), '确认提交本人这笔原警告的一次申诉？'));
  if (x.appeal) {
    const a = x.appeal;
    let facts = row('本人申诉时间', e(date(a.createdAt))) + prose('本人申诉理由', a.reason) + row('申诉作者', e(author(a.by)));
    if (a.review) facts += rowFactDecision(a.review.decision === 'maintain' ? '集团已维持警告' : '集团已撤回警告', a.review) + (a.review.internalNote ? prose('内部复核备注', a.review.internalNote) : '');
    else facts += note('本人申诉已记录，待集团实际复核；没有默认等待期限。');
    html += panel('申诉及集团复核', facts);
  }
  if (x.canReview) {
    const choices = '<label class="field"><span>实际集团复核决定</span><select name="decision" required><option value="" selected>请选择实际复核决定</option><option value="maintain">维持原警告</option><option value="revoke">撤回原警告</option></select></label>';
    html += panel('集团实际复核', h.form('penalty.appeal-review', { id: x.id, version: x.version, sourceToken: x.sourceToken }, choices + field('实际集团复核来源编号', 'reference') + field('实际复核发生时间', 'occurredAt', 'datetime-local', 'required') + text('本人可见的集团复核依据') + text('内部复核备注（本人不可见，可选）', 'internalNote', false), '记录实际集团复核', x.id, h.path(x.id), '确认已实际复核原本人申诉并明确维持或撤回？原警告事实将继续保留。'));
  }
  html += panel('处理留痕', x.history.map(item => `<p>${e(date(item.at))} · ${e(author(item.by))} · ${e(item.reason)}</p>`).join(''));
  return html;
}
function rowFacts(x, actor, h) {
  return row('当前状态', `<span class="tag ${x.status === 'revoked' ? 'success' : x.status === 'appeal_pending' ? 'warning' : ''}">${e(x.statusLabel)}</span>`) + row('原技师', e(x.techId)) + row('原门店', e(x.storeId)) + row('原预约', h.link(x.bookingId, `/${actor.role}/bookings/${encodeURIComponent(x.bookingId)}`)) + row('原投诉专项', h.link(`${x.source.caseId} · ${x.source.actionIndex + 1}`, `/${actor.role}/care/case/${encodeURIComponent(x.source.caseId)}`));
}
function rowFactDecision(title, d) { return row(title, e(d.reference)) + row('实际发生时间', e(date(d.occurredAt))) + prose('本人可见的事实与依据', d.reason) + row('实际记录作者', e(author(d.by))); }

export function technicianPenaltyUiView(s, rawActor, parts, ui = {}) {
  if (parts?.[0] !== 'penalties') return null;
  if (parts.length > 2) return panel('页面不存在', note('请从原处罚档案打开。'));
  const view = technicianPenaltyView(s, rawActor);
  if (!view.canEnter) return panel('无权查看技师处罚档案', note(view.reason, true));
  const actor = resolveAccountActor(s, rawActor), h = helpers(actor), id = parts[1];
  if (id) {
    const row = view.penalties.find(x => x.id === id);
    if (!row) return panel('记录不存在或无权查看', note('请核对原技师、门店和当前工作身份。'));
    return h.head('一般警告与本人申诉', row.statusLabel, h.link('返回原档案', h.path(), 'secondary')) + penaltyDetail(row, actor, h) + policyNote();
  }
  const list = view.penalties.length ? `<div class="table-wrap"><table><thead><tr><th>原警告</th><th>原技师</th><th>原门店</th><th>当前状态</th><th>查看</th></tr></thead><tbody>${view.penalties.map(x => `<tr><td>${e(x.id)}</td><td>${e(x.techId || '来源待核')}</td><td>${e(x.storeId || '来源待核')}</td><td>${e(x.statusLabel)}</td><td>${h.link('查看原记录', h.path(x.id))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">暂无本人或当前岗位可读的一般警告记录。</p>';
  const candidates = view.sourceCases.map(source => panel(`原投诉 ${source.caseId} · 待登记一般警告`, row('原技师', e(source.techId)) + row('原门店', e(source.storeId)) + warningForm(source, h))).join('');
  return h.head('一般警告与本人申诉', '按原案件和实际作者记录一般警告，保留本人一次申诉与集团复核。') + panel('原警告档案', list) + candidates + policyNote();
}

// Matches the existing qualificationCarePanel argument order for shared care integration.
export function technicianPenaltyCarePanel(s, rawActor, c, ui = {}) {
  const view = technicianPenaltyView(s, rawActor);
  if (!view.canEnter || !c?.id) return '';
  const actor = resolveAccountActor(s, rawActor), h = helpers(actor);
  const bodies = (c.specialistActions || []).flatMap((action, index) => {
    if (action.kind !== 'penalty') return [];
    const result = technicianPenaltyCaseResolution(s, c.id, index), row = view.penalties.find(x => x.id === result.penaltyId);
    if (row) return [note(row.statusLabel, !row.sourceValid) + h.link('查看原一般警告与申诉', h.path(row.id), 'secondary')];
    const source = view.sourceCases.find(x => x.caseId === c.id && x.actionIndex === index);
    return source ? [warningForm(source, h)] : [];
  });
  return bodies.length ? panel('处罚专项原记录', bodies.join('') + policyNote()) : '';
}
