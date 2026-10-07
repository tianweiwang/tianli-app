// Quality policy HTML only. Current source and authority come from the original domain.
import { qualityPolicyView } from './quality-policy.mjs';
import { qualityPolicyScopeFromQuery, qualityPolicyScopeQuery, qualityPolicyTriggerDefinitions } from './quality-policy-form.mjs';
import { lifecycleFingerprint as hash } from './organization-lifecycle-projection.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const path = '/group/quality-policies';
const panel = (title, body) => `<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const note = (body, warning = false) => `<p class="notice${warning ? ' warning' : ''}" role="status">${e(body)}</p>`;
const link = (title, target, cls = 'secondary') => `<a class="${e(cls)}" href="#${e(target)}">${e(title)}</a>`;
const row = (title, body) => `<div class="row quality-policy-row"><span class="muted">${e(title)}</span><span>${e(body)}</span></div>`;
const date = time => time == null ? '无结束时间' : new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const triggers = {
  'tech-noshow': '技师爽约', 'tech-general-series': '累计一般警告', 'tech-severe-event': '技师严重事件调查',
  'user-interruption': '用户中断服务', 'user-abuse': '用户辱骂或安全事件', 'user-noshow-series': '用户爽约连续成立', 'user-malicious-refund': '用户恶意退款争议'
};
const sources = {
  'verified-fulfilment-responsibility': ['已核实的履约责任', ['tech-noshow', 'user-noshow-series']],
  'established-care': ['已成立的投诉案件', ['tech-noshow', 'tech-severe-event', 'user-interruption', 'user-abuse', 'user-malicious-refund']],
  'effective-general-warning': ['仍有效的一般警告', ['tech-general-series']],
  'established-safety': ['已成立的安全事件', ['tech-severe-event', 'user-abuse']],
  'established-dispute': ['已成立的争议事件', ['tech-severe-event', 'user-interruption', 'user-malicious-refund']]
};
const modes = { 'retraining-and-release': '完成复训、项目授权后解除', 'lifecycle-decision': '调查后按人员异动流程决定', expiry: '期限届满结束', 'explicit-release': '审核通过后解除' };
const units = { days: '天', hours: '小时', minutes: '分钟', milliseconds: '毫秒（保留原精确值）' };
const effects = { 'stop-new-service': '暂停接新服务单', 'investigation-stop-new-service': '调查期间暂停接新服务单', 'restrict-new-service': '限制新服务预约' };
function field(title, name, value = '', type = 'text', attrs = 'required maxlength="300"') { return `<label class="field"><span>${e(title)}</span><input name="${e(name)}" type="${e(type)}" value="${e(value)}" ${attrs}></label>`; }
function select(title, name, options, value = '', attrs = 'required', control = true) { return `<label class="field"><span>${e(title)}</span><select name="${e(name)}" ${attrs}${control ? ' data-quality-policy-control' : ''}><option value=""${!value ? ' selected' : ''}>请选择${e(title)}</option>${Object.entries(options).map(([id, label]) => `<option value="${e(id)}"${value === id ? ' selected' : ''}>${e(label)}</option>`).join('')}</select></label>`; }
function multi(title, name, rows, values = [], attrs = '') { return `<label class="field wide"><span>${e(title)}</span><select name="${e(name)}" multiple ${attrs}>${rows.map(x => `<option value="${e(x.id)}"${values.includes(x.id) ? ' selected' : ''}>${e(x.name || x.title || x.id)} · ${e(x.id)}</option>`).join('')}</select><span class="small muted">可多选；使用指定范围时须至少选择一项。</span></label>`; }
function section(name, body, active) { return `<fieldset class="wide" data-quality-policy-section="${e(name)}"${active ? '' : ' hidden disabled'}><div class="management-grid">${body}</div></fieldset>`; }
function form(view, command, payload, fields, title, key, next, confirm) { return `<form class="management-form" data-management-form="${e(`quality:${view.actor.accountId}:${view.actor.grantId}:${key}:${command}`)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.sourceToken)}" data-next="${e(next)}" data-confirm="${e(confirm)}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页；版本更新后请重新打开此页核对。</p><div class="actions"><button type="submit" class="primary">${e(title)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`; }
function scopeUrl(scope, editRule = null) {
  const query = qualityPolicyScopeQuery({ subject: scope.subject, storeMode: scope.storeIds === null ? 'all' : 'selected', storeIds: scope.storeIds, serviceMode: scope.serviceIds === null ? 'all' : 'selected', serviceIds: scope.serviceIds });
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '')); if (editRule) params.set('editRule', editRule);
  return path + '?' + params.toString();
}
function scopeLabel(s, scope) { const names = (ids, rows) => ids === null ? '全部' : ids.map(id => rows.find(x => x.id === id)?.name || rows.find(x => x.id === id)?.title || id).join('、'); return `${scope.subject === 'tech' ? '技师' : '用户'} · 门店：${names(scope.storeIds, s.stores || [])} · 服务项目：${names(scope.serviceIds, s.services || [])}`; }
function chooser(s, scope) {
  const fields = select('规则主体', 'subject', { tech: '技师', user: '用户' }, scope?.subject || '', 'required', false) + select('门店范围', 'storeMode', { all: '全部门店', selected: '指定门店' }, scope ? scope.storeIds === null ? 'all' : 'selected' : '', 'required', false) + multi('指定门店（仅在指定范围时使用）', 'storeIds', s.stores || [], scope?.storeIds || []) + select('项目范围', 'serviceMode', { all: '全部服务项目', selected: '指定服务项目' }, scope ? scope.serviceIds === null ? 'all' : 'selected' : '', 'required', false) + multi('指定服务项目（仅在指定范围时使用）', 'serviceIds', s.services || [], scope?.serviceIds || []);
  return panel('规则范围', `<form data-command="ui.filter" data-quality-policy-scope data-payload="${e(JSON.stringify({ path }))}"><div class="management-grid">${fields}</div><div class="actions"><button type="submit" class="primary">查看此范围并编辑</button></div></form>`);
}
function ruleFacts(s, rule) {
  const c = rule.counting;
  const interval = ms => { const x = intervals(ms); return `${x.value} ${units[x.unit]}`; };
  const projects = ids => ids.map(id => { const service = s.services.find(x => x.id === id), name = service?.name || service?.title; return name ? `${name} · ${id}` : id; }).join('、');
  return row('规则编号', rule.id) + row('触发事件', triggers[rule.trigger] || rule.trigger) + row('成立依据', rule.sourceKinds.map(x => sources[x]?.[0] || x).join('、')) + (c ? row('成立计次', `${c.minimum} 个不同成立记录；窗口 ${interval(c.windowMs)}；${c.timeBasis === 'occurredAt' ? '事件发生时间' : '成立时间'}`) + row('撤回与更正', `${c.withdrawn === 'exclude' ? '撤回不计' : '保留原成立计次'}；${c.corrected === 'current-only' ? '仅计当前更正' : '保留原成立计次'}`) : row('成立口径', '单个已核实事件')) + row('执行动作', effects[rule.effect.kind]) + row('执行结束', rule.effect.endMode === 'duration' ? `期限 ${interval(rule.effect.durationMs)}` : '人工审核') + row('恢复或解除方式', modes[rule.restoration.mode]) + (rule.restoration.mode === 'retraining-and-release' ? row('复训项目', rule.restoration.serviceIds === null ? '按该规则范围' : projects(rule.restoration.serviceIds)) : '') + row('本人申诉', `一次；${rule.appeal.execution === 'continues' ? '申诉期间继续执行' : '复核前暂缓执行'}`);
}
function intervals(ms) { for (const [unit, value] of [['days', 86400000], ['hours', 3600000], ['minutes', 60000]]) if (ms % value === 0) return { value: String(ms / value), unit }; return { value: String(ms), unit: 'milliseconds' }; }
function editor(s, view, editing) {
  const scope = view.stream.scope, latest = view.policies.toSorted((a, b) => b.version - a.version)[0], retained = latest?.rules || [], original = editing ? retained.find(r => r.id === editing) : null;
  if (editing && !original) return panel('规则不存在', note('此规则不在该范围的最新版本中，请重新选择。', true));
  const r = original, d = qualityPolicyTriggerDefinitions[r?.trigger], window = r?.counting ? intervals(r.counting.windowMs) : {}, duration = r?.effect.durationMs ? intervals(r.effect.durationMs) : {};
  const triggerChoices = Object.fromEntries(Object.entries(triggers).filter(([id]) => qualityPolicyTriggerDefinitions[id].subject === scope.subject));
  const sourceChoices = `<fieldset class="wide"><legend>成立依据（须明确选择）</legend>${Object.entries(sources).filter(([, [, allowed]]) => allowed.some(t => qualityPolicyTriggerDefinitions[t].subject === scope.subject)).map(([id, [label, allowed]]) => `<label class="field"${r && !allowed.includes(r.trigger) ? ' hidden' : ''}><span><input type="checkbox" name="sourceKinds" value="${e(id)}" data-quality-policy-source="${e(allowed.join(' '))}"${r?.sourceKinds.includes(id) ? ' checked' : ''}${r && !allowed.includes(r.trigger) ? ' disabled' : ''}> ${e(label)}</span></label>`).join('')}</fieldset>`;
  let fields = field('规则编号', 'ruleId', r?.id || '', 'text', `required maxlength="100"${r ? ' readonly' : ''}`) + select('触发事件', 'trigger', triggerChoices, r?.trigger || '') + `<p class="small muted wide" role="status" data-quality-policy-effect>${e(d ? effects[d.effect] : scope.subject === 'tech' ? '此类规则用于暂停接新服务单；严重事件按调查及人员异动流程决定。' : '此类规则用于限制新服务预约。')}</p>` + sourceChoices;
  fields += section('counting', field('成立次数（同一记录不重复计次）', 'minimum', r?.counting?.minimum || '', 'number', 'required min="1" step="1"') + field('统计窗口数值', 'windowDays', window.value || '', 'number', 'required min="0" step="any"') + select('统计窗口单位', 'windowUnit', units, window.unit || '') + select('计次时间', 'timeBasis', { occurredAt: '事件发生时间', establishedAt: '事件成立时间' }, r?.counting?.timeBasis || '') + select('撤回后如何计次', 'withdrawn', { exclude: '撤回记录不计', 'count-original': '保留原成立计次' }, r?.counting?.withdrawn || '') + select('更正后如何计次', 'corrected', { 'current-only': '仅计当前有效更正', 'count-original': '保留原成立计次' }, r?.counting?.corrected || ''), !!d?.series);
  fields += select('结束方式', 'endMode', { duration: '显式期限', 'manual-review': '实际人工审核' }, r?.effect.endMode || '') + section('duration', field('限制期限数值', 'durationDays', duration.value || '', 'number', 'required min="0" step="any"') + select('限制期限单位', 'durationUnit', units, duration.unit || ''), r?.effect.endMode === 'duration');
  fields += select('恢复或解除方式', 'restorationMode', scope.subject === 'tech' ? { 'retraining-and-release': modes['retraining-and-release'], 'lifecycle-decision': modes['lifecycle-decision'] } : { expiry: modes.expiry, 'explicit-release': modes['explicit-release'] }, r?.restoration.mode || '') + section('retraining', select('复训项目范围', 'retrainingMode', { all: '规则范围内全部项目', selected: '指定项目' }, r ? r.restoration.serviceIds === null ? 'all' : 'selected' : ''), d?.restoration === 'retraining-and-release') + section('retrainingIds', multi('复训项目', 'retrainingServiceIds', (s.services || []).filter(x => scope.serviceIds === null || scope.serviceIds.includes(x.id)), r?.restoration.serviceIds || []), d?.restoration === 'retraining-and-release' && r?.restoration.serviceIds !== null);
  fields += select('一次申诉期间的执行', 'appealExecution', { continues: '继续执行，等待复核', 'suspend-until-review': '复核前暂缓执行' }, r?.appeal.execution || '') + field('新版本生效时间（北京时间）', 'validFrom', '', 'datetime-local', 'required step="0.001"') + select('规则版本有效期', 'validUntilMode', { none: '无预设结束时间', date: '明确结束时间' }) + section('validTo', field('规则结束时间（北京时间）', 'validTo', '', 'datetime-local', 'required step="0.001"'), false) + field('依据编号或引用', 'reference') + field('依据版本', 'basisVersion') + field('决定时间（北京时间）', 'occurredAt', '', 'datetime-local', 'required step="0.001"');
  const kept = retained.filter(x => x.id !== editing), preserved = kept.length ? kept.map(x => `<li>${e(x.id)} · ${e(triggers[x.trigger])}</li>`).join('') : '<li>本范围没有其他规则。</li>';
  const base = { scope, expectedVersion: view.stream.version, sourceToken: view.stream.sourceToken, retainedRules: structuredClone(retained), editingRuleId: editing || null };
  return panel(editing ? '修订规则并发布新版本' : '新增规则并发布新版本', row('规则范围', scopeLabel(s, scope)) + row('当前版本', String(view.stream.version)) + (latest ? row('最新版本状态', latest.status === 'withdrawn' ? '已撤回' : latest.validFrom > s.now ? '已发布，尚待生效' : '已发布') : note('此范围尚未发布规则，请按已确认的决定填写。')) + `<h3>新版本将保留以下规则</h3><ul>${preserved}</ul>` + note(editing ? '只修订所选规则，其他规则保持不变。请填写本次发布的生效时间与依据。' : '新规则将追加到现有规则，新版本同时保留全部现有规则。') + form(view, 'quality.policy-publish', base, fields, '发布新版本', hash(scope) + ':' + (editing || 'new'), scopeUrl(scope), '确认发布此范围的新版本，并保留列表中的全部规则？请先核对依据与生效时间。'));
}
function policyDetail(s, view, policy) {
  let body = row('规则范围', scopeLabel(s, policy.scope)) + row('版本与状态', `第 ${policy.version} 版 · ${policy.status === 'withdrawn' ? '已撤回' : policy.validFrom > s.now ? '尚待生效' : policy.validTo !== null && policy.validTo <= s.now ? '已过期' : '已发布'}`) + row('生效时间', date(policy.validFrom)) + row('结束时间', date(policy.validTo)) + row('依据', policy.basis.reference + ' · ' + policy.basis.version) + row('决定时间', date(policy.basis.occurredAt)) + row('发布人', `${policy.publication.by.accountId} · ${policy.publication.by.grantId}`) + row('发布时间', date(policy.publication.at)) + policy.rules.map(r => panel(`规则 ${r.id}`, ruleFacts(s, r))).join('');
  if (policy.withdrawal) body += panel('撤回记录', row('撤回决定时间', date(policy.withdrawal.occurredAt)) + row('依据', policy.withdrawal.reference + ' · ' + policy.withdrawal.basisVersion) + row('撤回人', policy.withdrawal.by.accountId) + row('撤回原因', policy.withdrawal.reason));
  let html = panel('发布记录', body);
  if (policy.status === 'published') html += panel('撤回此版本', note('撤回后保留完整历史；旧版本不会自动重新生效。') + form(view, 'quality.policy-withdraw', { id: policy.id, version: policy.version, revision: policy.revision, sourceToken: policy.sourceToken }, field('撤回依据编号或引用', 'reference') + field('撤回依据版本', 'basisVersion') + field('撤回决定时间（北京时间）', 'occurredAt', '', 'datetime-local', 'required step="0.001"') + `<label class="field wide"><span>撤回原因</span><textarea name="reason" required maxlength="1000" rows="3"></textarea></label>`, '撤回此版本', policy.id, path + '/' + encodeURIComponent(policy.id), '确认撤回此政策版本？发布与撤回历史将保留，旧版本不会自动重新生效。'));
  return html;
}
export function qualityPolicyUiView(s, rawActor, parts, ui = {}) {
  if (parts?.[0] !== 'quality-policies') return null;
  if (parts.length > 2) return panel('页面不存在', note('请从质量规则列表打开。', true));
  const gate = qualityPolicyView(s, rawActor);
  if (!gate.canEnter) return panel('无权查看质量规则', note(gate.reason, true));
  const head = `<header class="page-head"><div><h1>质量规则</h1><p>集团客服负责发布与撤回，版本历史保留。</p></div><div class="actions">${link('返回规则列表', path)}</div></header>`;
  const pending = note('请按已确认的经营规则填写，次数、期限和生效时间均需明确。未发布有效规则时不能执行停单或用户限制。');
  if (parts[1]) { const policy = gate.policies.find(x => x.id === parts[1]); return head + (policy ? policyDetail(s, gate, policy) : panel('记录不存在', note('请重新打开发布记录。', true))) + pending; }
  let selected;
  try { selected = qualityPolicyScopeFromQuery(ui.query); } catch (error) { return head + panel('范围查询无效', note(error.message, true)) + chooser(s) + pending; }
  if (!selected && ui.query?.has?.('editRule')) return head + panel('无法修订', note('请先选择规则范围。', true)) + chooser(s) + pending;
  const view = selected ? qualityPolicyView(s, rawActor, { scope: selected }) : gate;
  if (!view.canEnter) return head + panel('记录暂无法读取', note(view.reason, true)) + pending;
  const list = view.policies.length ? `<div class="table-wrap"><table><thead><tr><th>记录编号</th><th>范围</th><th>版本</th><th>规则</th><th>发布记录</th></tr></thead><tbody>${view.policies.toSorted((a, b) => b.version - a.version).map(x => `<tr><td>${e(x.id)}</td><td>${e(scopeLabel(s, x.scope))}</td><td>${e(x.version)} · ${x.status === 'withdrawn' ? '已撤回' : '已发布'}</td><td>${e(x.rules.length)} 条</td><td>${link('查看发布与撤回', path + '/' + encodeURIComponent(x.id))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">暂无此范围的发布记录。</p>';
  let html = head + chooser(s, selected) + panel('发布记录', list);
  if (selected) {
    html += note(view.current.available ? `此范围当前生效：${view.current.policy.id} · 第${view.current.policy.version}版。` : view.current.reason, !view.current.available);
    const latest = view.policies.toSorted((a, b) => b.version - a.version)[0], editValues = ui.query?.getAll?.('editRule') || [], editing = ui.query?.get?.('editRule') ?? null;
    if (editValues.length > 1 || editing === '') return html + panel('无法修订', note('请选择一条规则。', true)) + pending;
    if (latest) html += panel('新增或修订', `<div class="actions">${link('新增规则', scopeUrl(selected))}${latest.rules.map(r => link('修订 ' + r.id, scopeUrl(selected, r.id))).join('')}</div>`);
    html += editor(s, view, editing);
  }
  return html + pending;
}
