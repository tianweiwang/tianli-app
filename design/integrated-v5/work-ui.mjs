import {workTaskView} from './work-tasks.mjs';
import {STAFF_JOBS,canAccountView} from './staff-accounts.mjs';
import {TASK_CATEGORIES} from './work-task-labels.mjs';
import {workEscalationView} from './work-escalation.mjs';
import {workEscalationPanel} from './work-escalation-ui.mjs';
export {TASK_CATEGORIES} from './work-task-labels.mjs';
export function taskListFilters(q=new URLSearchParams()) {
 return {category:q.get('category')||'',status:q.get('status')||'active',q:(q.get('q')||'').trim(),owner:q.get('owner')||'',store:q.get('store')||''};
}
export function filterWorkTasks(tasks,f,actor) {
 return tasks.filter(t=>(!f.category||t.category===f.category)&&(!f.store||t.storeId===f.store)&&
 (f.status==='all'||(f.status==='active'?t.status!=='done':t.status===f.status))&&
 (!f.owner||(f.owner==='mine'?!!actor.accountId&&t.ownerAccountId===actor.accountId&&t.ownerValid:f.owner==='unassigned'?!t.ownerAccountId&&!t.nativeOwnerName:f.owner==='invalid'?t.ownerValid===false:true))&&
 (!f.q||[t.id,t.title,t.sourceId,t.bookingId,t.orderId].filter(Boolean).join(' ').toLowerCase().includes(f.q.toLowerCase())));
}
export function workTaskSummary(s,a,ui) {
 let model;try {model=workTaskView(s,a);} catch {return '';}
 if(!['group','store'].includes(a.role)||a.job==='account-admin')return '';
 const {esc:e,link:l}=ui,c=model.counts;
 return `<section class="panel"><div class="panel-head"><h2>统一待办</h2>${l('进入待办列表',`/${a.role}/tasks`,'secondary')}</div><div class="panel-body"><p>待处理 ${e(c.open)} 项 · 等待其他方 ${e(c.waiting)} 项 · 已办 ${e(c.done)} 项</p><p class="muted">按当前岗位汇总，进入原业务页面办理。</p></div></section>`;
}
export function workTaskUiView(s,a,route,ui) {
 if(route[0]!=='tasks')return null;
 const {esc:e,date:d,button:b,link:l,select:sel,field,tag}=ui,model=workTaskView(s,a),f=taskListFilters(ui.query),tasks=filterWorkTasks(model.tasks,f,a);
 const labels={active:'未办结',open:'待处理',waiting:'等待其他方',done:'已办 / 已结束',all:'全部状态'};
 const categories=[...new Set(model.tasks.map(t=>t.category))];
 const stores=[...new Set(model.tasks.map(t=>t.storeId).filter(Boolean))];
 const escalationRows=a.accountId&&['group','store'].includes(a.role)&&a.job!=='account-admin'&&canAccountView(a,'tasks')?new Map(workEscalationView(s,a).rows.map(row=>[row.task.id,row])):null;
 const filters=`<form data-command="ui.filter" data-payload="${e(JSON.stringify({path:`/${a.role}/tasks`}))}" class="management-form"><div class="management-grid">${sel('事项类别','category',[{value:'',label:'全部类别'},...categories.map(k=>({value:k,label:TASK_CATEGORIES[k]||k}))],f.category)}${sel('办理状态','status',Object.entries(labels).map(([value,label])=>({value,label})),f.status)}${sel('负责人','owner',[{value:'',label:'全部责任人'},{value:'mine',label:'由我负责'},{value:'unassigned',label:'尚未认领'},{value:'invalid',label:'需重新分派'}],f.owner)}${sel('来源门店','store',[{value:'',label:'全部门店'},...stores.map(id=>({value:id,label:s.stores.find(x=>x.id===id)?.name||id}))],f.store)}${field('业务编号或事项','q',f.q,'search','maxlength="100"')}</div><div class="actions"><button type="submit" class="primary">筛选</button>${l('清除筛选',`/${a.role}/tasks`,'secondary')}</div></form>`;
 const cards=tasks.map(t=>{
   const responsibleJobs=[...new Set((t.manageRoles||[]).flatMap(role=>t.allowedJobs?.[role]||[]))].map(job=>STAFF_JOBS[job]?.label||job).join('、')||(t.status==='done'?'办理已结束':'等待其他方处理');
   const payload={id:t.id,sourceToken:t.sourceToken,version:t.assignmentVersion};
   const assignment=t.canAssign?`<details class="action-details"><summary>分派处理人</summary><form class="management-form" data-management-form="${e('work:'+t.id)}" data-command="work.assign" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(t.assignmentVersion)}"><div class="management-grid"><label class="field"><span>接收岗位</span><select name="target" required><option value="">请选择当前有效授权</option>${(t.candidates||[]).map(c=>`<option value="${e(JSON.stringify([c.accountId,c.grantId]))}">${e(c.name)} · ${e(STAFF_JOBS[c.job]?.label||c.job)}</option>`).join('')}</select></label><label class="field"><span>分派原因</span><input name="reason" required maxlength="300"></label></div><p class="management-draft-note small muted" role="status">未提交内容保留在当前工作身份的本标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="secondary">确认分派</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form></details>`:'';
   const history=(t.history||[]).length?`<details class="action-details"><summary>责任处理记录</summary><ol class="timeline">${[...t.history].reverse().map(h=>`<li><p>${e(d(h.at))} · ${e(h.accountName||h.to?.accountName||h.accountId||'责任调整')}</p><p>${e(h.reason||'认领事项')}</p></li>`).join('')}</ol></details>`:'';
   const escalation=escalationRows?workEscalationPanel(s,a,t,{...ui,escalationEmbedded:true},escalationRows.get(t.id)||null):'';
   return `<article class="panel management-panel" data-task-id="${e(t.id)}"><div class="panel-head"><h2>${e(t.title)} · ${e(t.sourceId)}</h2>${tag(t.statusLabel,t.status==='done'?'success':t.status==='open'?'warning':'')}</div><p class="muted">${e(TASK_CATEGORIES[t.category]||t.category)} · ${e(s.stores.find(x=>x.id===t.storeId)?.name||'集团统一办理')}${t.bookingId&&t.bookingId!==t.sourceId?' · '+e(t.bookingId):''}${t.orderId?' · '+e(t.orderId):''}</p><dl class="kv-grid"><div><dt>负责岗位</dt><dd>${e(responsibleJobs)}</dd></div><div><dt>处理责任</dt><dd>${e(t.status==='done'&&t.ownerLabel==='待认领'?'未登记任务认领':t.ownerLabel||'尚未认领')}</dd></div><div><dt>原办理期限</dt><dd>${t.dueAt==null?'未设定办理期限':e(d(t.dueAt))}${t.dueAt!=null&&t.dueAt<s.now&&t.status!=='done'?' · 已过期':''}</dd></div></dl>${t.assignmentMode==='source'?'<p class="small muted">责任人沿用原业务记录，进入原页面认领或转派。</p>':''}<div class="actions">${b(t.status==='done'?'查看原记录':t.status==='open'&&t.manageRoles?.includes(a.role)?'进入办理':'查看办理进度','ui.task-open',{taskKey:t.id})}${t.canClaim?b('由我认领','work.claim',payload,'secondary'):''}</div>${assignment}${history}${escalation?`<details class="action-details"><summary>责任升级与接管</summary>${escalation}</details>`:''}</article>`;
 }).join('');
 return `<header class="page-head"><div><h1>统一待办</h1><p>办理结果以原业务记录为准，回复或提交退款后仍可跟踪后续进度。</p></div>${l('返回工作台',`/${a.role}/dashboard`,'secondary')}</header><section class="panel management-panel"><p role="status">待处理 ${e(model.counts.open)} 项 · 等待其他方 ${e(model.counts.waiting)} 项 · 已办 ${e(model.counts.done)} 项</p>${filters}</section><p class="muted" role="status">当前筛选 ${tasks.length} 项</p>${cards||ui.empty('当前没有符合条件的事项','可调整筛选条件；新业务会按当前授权范围显示。')}`;
}
