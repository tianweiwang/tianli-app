import { lifecycleCasesView, lifecycleCompletionView, lifecyclePauseImpact, lifecyclePauseView } from './organization-lifecycle.mjs';
import { lifecycleImpact } from './organization-lifecycle-projection.mjs';
import { createLifecycleContext } from './engine.mjs';
import { canManageView } from './management.mjs';
import { canAccountView, resolveAccountActor } from './staff-accounts.mjs';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const d=value=>value==null?'待核对':new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const panel=(title,body)=>`<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const notice=body=>`<p class="notice" role="status">${e(body)}</p>`;
const link=(title,path)=>`<a href="#${e(path)}">${e(title)}</a>`;
const field=(label,name,type='text',attrs='')=>`<label class="field"><span>${e(label)}</span><input name="${e(name)}" type="${e(type)}" required ${attrs}></label>`;
const table=(head,rows)=>rows.length?`<div class="table-wrap"><table><thead><tr>${head.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="muted">暂无记录。</p>';
function form(scope,command,payload,fields,label,next) {
  return `<form class="management-form" data-management-form="${e('lifecycle:'+scope+':'+command)}" data-command="${e(command)}" data-live-version="${payload.version??''}" data-payload="${e(JSON.stringify({...payload,requestId:crypto.randomUUID()}))}" data-next="${e(next)}"><div class="management-grid">${fields}<label class="field wide"><span>办理依据</span><textarea name="reason" required maxlength="1000" rows="3"></textarea></label></div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${e(label)}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
}
function pausePanel(s,actor,view,store,next,ctx) {
  if(!view.canPause)return '';
  const impact=lifecyclePauseImpact(s,store.id,{startAt:s.now,endAt:null},ctx),active=view.cases.filter(c=>c.kind==='store-pause'&&!['cancelled','completed'].includes(c.stage));
  // The full impact above binds form concurrency. Coordination only concerns
  // actual unfinished pause intervals; ordinary future bookings remain in the
  // separate original organization impact and settlement.
  const rows=[...new Map(active.flatMap(c=>lifecyclePauseImpact(s,store.id,{startAt:c.startAt,endAt:c.endAt},ctx).bookings).map(b=>[JSON.stringify([b.sourceId,b.proposed,b.changeId,b.startAt,b.endAt]),b])).values()];
  let html=panel('停业时段与原预约协调',notice('只列与本店未结束停业时段重叠的原安排或拟安排。普通计划须至少提前24小时；本店改约须本人确认，无法改约沿原门店原因取消并全额退款。已开始履约保持原流程。')+(rows.length?table(['原预约','原时段','当前办理'],rows.map(b=>[e(b.sourceId)+(b.proposed?'<small>本人待确认的拟安排</small>':''),e(d(b.startAt))+' → '+e(d(b.endAt)),e(b.reason)])):notice('当前没有受未结束停业时段影响的预约。')));
  for(const c of active){
    if(c.stage==='planned'&&c.startAt>s.now)html+=panel('撤回未生效停业计划',form(store.id+':'+c.id,'lifecycle.store-pause-cancel',{id:c.id,version:c.version,sourceToken:impact.sourceToken},`<p class="small muted wide">原计划 ${e(c.id)}：${e(d(c.startAt))} → ${e(d(c.endAt))}。撤回保留原记录和本人决定。</p>`,'撤回停业计划',next));
    if(c.stage==='effective'){
      const resume=lifecyclePauseView(s,c.id,ctx);
      html+=panel('原停业恢复核验',notice(c.endAt==null?'原计划未填写结束时间，须集团实际核验恢复。':'到原结束时间重新核营业条件；条件未齐或另行停用保持暂停。')+(resume.blockers.length?table(['原事项','当前恢复原因'],resume.blockers.map(b=>[e(b.sourceId),e(b.reason)])):notice('当前原营业条件齐全，仍按原案恢复来源办理。'))+(view.canPlan&&resume.canResume?form(store.id+':'+c.id,'lifecycle.store-resume',{id:c.id,version:resume.version,sourceToken:resume.sourceToken},field('集团实际恢复来源','reference','text','maxlength="200"'),'核验并恢复营业',next):''));
    }
  }
  if(store.active&&store.reviewStatus==='approved'&&!['closing','closed'].includes(store.lifecycleStatus)&&store.closedAt==null){
    const common=field('实际停业来源','reference','text','maxlength="200"');
    html+=panel('登记停业时段',form(store.id,'lifecycle.store-pause',{storeId:store.id,version:store.version,sourceToken:impact.sourceToken},field('停业开始时间','startAt','datetime-local','step="1"')+field('停业结束时间','endAt','datetime-local','step="1"')+common,'登记停业计划',next));
    if(view.canPlan)html+=panel('集团紧急暂停',form(store.id,'lifecycle.store-pause-emergency',{storeId:store.id,version:store.version,sourceToken:impact.sourceToken},`<label class="field"><span>预计结束时间（未定可空）</span><input name="endAt" type="datetime-local" step="1"></label>`+common+'<p class="small muted wide">集团依据实际紧急原因立即暂停。原履约、本人改约及退款继续原流程。</p>','立即暂停预约营业',next));
  }
  return html;
}

export function organizationLifecyclePanel(s,rawActor,scope) {
  const actor=resolveAccountActor(s,rawActor),view=lifecycleCasesView(s,actor,scope),tech=scope.techId&&(s.techs||[]).find(t=>t.id===scope.techId),subject=tech||(s.stores||[]).find(t=>t.id===scope.storeId),base='/'+actor.role,next=base+(tech?'/technicians/'+subject.id:'/stores/'+subject.id);
  const stage={planned:'尚未生效',effective:'组织已生效，原事项继续办理',cancelled:'计划已撤回',completed:'办理完成'},kind={transfer:'调店',departure:'离职办理','store-close':'关停办理','store-pause':'停业时段'};
  let html=panel('组织办理记录',notice(view.lifecycleStatus==='closing'?'关停中：停止新预约和新推广，原履约、售后及账款继续办理。':view.lifecycleStatus==='closed'?'门店已关闭：原营业权限结束，原订单与原主体历史事项沿限定承接办理。':view.lifecycleStatus==='departure'?'离职办理中：停止新接单，原未出发预约需协调，已开始履约沿原流程完成。':view.lifecycleStatus==='left'?'已离职：工作身份及新接单能力已结束。本人原提成、推广资金和历史权利保留，使用已核实关联的普通用户身份从原本人入口办理。':'变更按记录中的实际生效时间办理，原订单与资金来源保留。')+table(['办理','原店 → 新店','生效时间 / 当前阶段'],view.cases.map(c=>[`${e(kind[c.kind]||c.kind)}<small>${e(c.id)}</small>`,`${e(c.fromStoreId||'—')} → ${e(c.toStoreId||'—')}`,`${e(d(c.effectiveAt))}<small>${e(stage[c.stage]||c.stage)}</small>${c.effectBlockedReason?`<p class="notice warning" role="status">${c.kind==='store-pause'?'上次自动核验：':''}${e(c.effectBlockedReason)}${c.kind==='store-pause'?`<small>核验时间：${e(d(c.effectBlockedAt))}</small>`:''}</p>`:''}`])));
  const ctx=createLifecycleContext();if(!tech)html+=pausePanel(s,actor,view,subject,next,ctx);
  if (!view.canPlan) return html;
  const impact=lifecycleImpact(s,scope,ctx),blockers=impact.blockers||impact.settlement?.blockers||[];
  const sourceLink=row=>{const name=String(row.path||'').split('/')[2];return row.path&&canManageView(actor,name)&&canAccountView(actor,name)?link('查看原来源',row.path):'<span class="muted">由原业务岗位继续办理</span>';};
  html+=panel('原事项协调与清算',notice('组织变更不代替原改约、改派、退款、提成发放或追偿。以下按当前来源重新核验。')+table(['原事项','待办原因','办理入口'],blockers.map(row=>[e(row.sourceId||row.kind||'待核对'),e(row.reason||'原事项未办结'),sourceLink(row)])));
  for (const c of view.cases.filter(c=>c.kind!=='store-pause'&&c.stage==='planned'&&(c.effectiveAt>s.now||c.effectBlockedReason))) html+=panel('撤回未生效计划',form(subject.id+':'+c.id,'lifecycle.cancel-plan',{id:c.id,version:c.version,sourceToken:impact.sourceToken},'<p class="small muted wide">只撤回本条尚未实际生效的计划；已接订单和原账保持。</p>','撤回原计划',next));
  for (const c of view.cases.filter(c=>c.kind!=='store-pause'&&c.stage==='effective')) {
    const completion=lifecycleCompletionView(s,c.id,ctx);
    html+=panel('完成'+(kind[c.kind]||'组织办理'),notice('本案按原生效范围核验协调、资金及实际岗位承接。新店后续预约继续按其原流程办理。')+(completion.canComplete?form(subject.id+':'+c.id,'lifecycle.complete',{id:c.id,version:completion.version,sourceToken:completion.sourceToken},`<p class="small muted wide">本案 ${e(c.id)} 当前原来源已核齐。提交时再次核验；结束原工作权限并保留本人及原主体历史权利。</p>`,'完成本案办理',next):notice('本案尚有原事项待办，请由对应原岗位处理后重新核对。')+table(['原事项','当前阻断原因','办理入口'],completion.blockers.map(row=>[e(row.sourceId||row.kind||'待核对'),e(row.reason||'原来源待核对'),sourceLink(row)]))));
  }
  if (view.cases.some(c=>c.kind!=='store-pause'&&!['completed','cancelled'].includes(c.stage))) return html+notice('原办理尚未结束。请继续处理本案原事项并核对实际承接。');
  const common=field('组织办理来源编号','reference','text','maxlength="200"');
  if (tech && tech.lifecycleStatus!=='left') {
    const destinations=(s.stores||[]).filter(x=>x.id!==tech.storeId&&x.closedAt==null&&!['closing','closed'].includes(x.lifecycleStatus));
    if (destinations.length) html+=panel('登记调店计划',form(tech.id,'lifecycle.transfer-plan',{techId:tech.id,version:tech.version,sourceToken:impact.sourceToken},`<label class="field"><span>迁入门店</span><select name="toStoreId" required data-lifecycle-destination>${destinations.map(x=>`<option value="${e(x.id)}" data-subject-version="${x.version}">${e(x.name)}</option>`).join('')}</select></label><input type="hidden" name="targetVersion" value="${destinations[0].version}">${field('集团指定生效时间','effectiveAt','datetime-local','step="1"')}${common}<p class="small muted wide">原店生效前已接的预约保留原店履约与提成。迁入店项目须按原考核流程重新授权。</p>`,'登记调店计划',next));
    html+=panel('开始离职办理',form(tech.id,'lifecycle.departure-start',{techId:tech.id,version:tech.version,sourceToken:impact.sourceToken},common+'<p class="small muted wide">先停止新接单，再协调原预约及提成清算。开始办理保留原工作记录与本人资金权利。</p>','登记离职办理',next));
  } else if (!tech && subject.closedAt==null&&!['closing','closed'].includes(subject.lifecycleStatus)) html+=panel('开始关停办理',form(subject.id,'lifecycle.store-close-start',{storeId:subject.id,version:subject.version,sourceToken:impact.sourceToken},common+'<p class="small muted wide">停止新预约和新推广，原单继续履约。资金、售后、发票及原主体承接未核齐前保持关停中。</p>','登记关停办理',next));
  return html;
}
