// Staff-account screens reuse the existing forms and panels. No real sign-in is performed.
import { STAFF_JOBS, resolveAccountActor, canAccountView, staffGrantActive, staffSettlementGrantLive } from './staff-accounts.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { lifecycleHandoverCommands } from './organization-lifecycle-authority.mjs';
import { lifecycleCaseImpact, lifecycleFingerprint } from './organization-lifecycle-projection.mjs';
import { createLifecycleContext } from './engine.mjs';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const d=v=>v==null?'—':new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const panel=(title,body)=>`<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const note=(body,warning=false)=>`<p class="notice${warning?' warning':''}" role="status">${e(body)}</p>`;
const empty=(title,body='')=>`<section class="panel empty"><h2>${e(title)}</h2><p>${e(body)}</p></section>`;
const head=(title,body,tools='')=>`<header class="page-head"><div><h1>${e(title)}</h1><p>${e(body)}</p></div><div class="actions">${tools}</div></header>`;
const field=(label,name,value='',attrs='required maxlength="40"')=>`<label class="field"><span>${e(label)}</span><input type="text" name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
const reason=()=>`<label class="field wide"><span>操作原因</span><textarea name="reason" rows="3" required maxlength="300"></textarea></label>`;
const select=(label,name,options)=>`<label class="field"><span>${e(label)}</span><select name="${e(name)}" required><option value="">请选择</option>${options.map(([v,t])=>`<option value="${e(v)}">${e(t)}</option>`).join('')}</select></label>`;
const link=(label,path,cls='')=>`<a class="${e(cls)}" href="#${e(path)}">${e(label)}</a>`;
const badge=(label,ok)=>`<span class="tag ${ok?'success':'warning'}">${e(label)}</span>`;
const table=(headers,rows)=>rows.length?`<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="muted">暂无记录。</p>';
const ROUTE_NAMES={tasks:'统一待办',accounts:'账号与权限',catalog:'商品管理',categories:'商品分类',services:'预约项目',stores:'门店资料',technicians:'技师档案',qualifications:'服务准入',rules:'预约规则',inventory:'商品库存',goods:'商品订单',returns:'商品售后',bookings:'预约订单',operations:'经营待办',busy:'店内忙碌',schedule:'排班与请假',safety:'客服与安全',bills:'商品佣金账单',recoveries:'商品佣金追回',invoices:'服务发票','service-finance':'服务财务',care:'投诉与回访',reviews:'评价与申诉',privacy:'隐私办理'};
export function accountExitActions(a,{closedStore=false}={}) {
  const backend=a.role==='store'?'门店':'集团';
  const closed=a.role==='store'&&(closedStore||a.lifecyclePurpose==='lifecycle-settlement');
  return `<button type="button" class="secondary" data-command="ui.account-exit" data-payload="{&quot;destination&quot;:&quot;dashboard&quot;}">${closed?'返回岗位入口':`返回${backend}后台`}</button><button type="button" class="secondary" data-command="ui.account-exit" data-payload="{&quot;destination&quot;:&quot;work-login&quot;}">切换岗位</button>`+(closed?'<button type="button" class="secondary" data-command="ui.account-exit" data-payload="{&quot;destination&quot;:&quot;home&quot;}">返回演示首页</button>':'');
}
export function accountEntryLink(a) {
  if (!['group','store'].includes(a.role)) return '';
  const entry=link(a.sessionId?'当前工作账号':'后台岗位演示',`/${a.role}/work-login`,'guide-link');
  return a.sessionId?`<div class="actions">${entry}${accountExitActions(a)}</div>`:entry;
}
export function accountExitTarget(s,a,destination='dashboard') {
  const session=(s.staffSessions || []).find(x=>x.id===a.sessionId);
  const grant=(s.staffAccounts || []).find(x=>x.id===session?.accountId)?.grants.find(x=>x.id===session.grantId);
  const context=grant || a,role=context.role==='store'?'store':'group';
  const stores=(s.stores || []).filter(x=>x.id===context.storeId),closed=role==='store'&&stores.length===1&&(stores[0].lifecycleStatus==='closed'||stores[0].closedAt!=null);
  if(closed&&destination==='home')return {actor:{role:'user',storeId:context.storeId},path:'/user/home'};
  if(closed)return {actor:{role:'store',storeId:context.storeId},path:'/store/work-login'};
  return {actor:{role,...(role==='store'?{storeId:context.storeId}:{})},path:`/${role}/${destination==='work-login'?'work-login':'dashboard'}`};
}
// Recovery for the existing free Demo selector; never downgrade a work identity.
export function accountSessionErrorView(s,a,message) {
  const free=a&&!a.sessionId&&!a.accountId&&!a.grantId&&['store','manager'].includes(a.role);
  const original=free&&typeof a.storeId==='string'&&a.storeId.trim()&&Array.isArray(s?.stores)?s.stores.filter(x=>x?.id===a.storeId):[];
  if(original.length===1&&(original[0].lifecycleStatus==='closed'||original[0].closedAt!=null)){
    const choices=s.stores.filter(store=>{
      if(typeof store?.id!=='string'||!store.id.trim()||s.stores.filter(x=>x?.id===store.id).length!==1)return false;
      try{resolveAccountActor(s,{...a,storeId:store.id});return true;}catch{return false;}
    });
    const picker=choices.length?`<div class="management-grid"><label class="field wide"><span>切换演示门店</span><select data-identity="storeId"><option value="" selected disabled>请选择其他门店</option>${choices.map(store=>`<option value="${e(store.id)}">${e(store.name||store.id)}</option>`).join('')}</select></label></div>`:note('暂无可切换的其他门店，可返回演示首页。');
    return `<section class="panel management-panel"><h1>当前门店已关闭</h1>${note(message,true)}<p>当前处于自由演示模式。选择其他门店后可继续演示；原门店的历史事项请从岗位入口办理。</p>${picker}<div class="actions">${link('进入原门店岗位入口','/store/work-login','secondary')}${link('返回演示首页','/user/home','secondary')}</div></section>`;
  }
  const target=accountExitTarget(s,a);
  return `<section class="panel"><h1>工作会话已失效</h1>${note(message,true)}<p>可返回岗位入口或切换有效岗位。未提交的工作草稿保留在原会话中，不会自动提交。</p><div class="actions">${accountExitActions(target.actor,{closedStore:target.path==='/store/work-login'})}</div></section>`;
}
// Page affordance only: this never grants a work identity or business access.
export function accountWorkLoginProjection(s,rawActor,route=[]) {
  if(route.length!==1||route[0]!=='work-login'||rawActor?.role!=='store'||rawActor.sessionId||rawActor.accountId||rawActor.grantId)return null;
  if(!Array.isArray(s?.stores))throw Error('原门店来源无法读取。');
  const stores=s.stores.filter(x=>x.id===rawActor.storeId);
  if(stores.length>1)throw Error('原门店来源冲突，请核对后重新进入。');
  if(stores.length!==1||!(stores[0].lifecycleStatus==='closed'||stores[0].closedAt!=null))return null;
  if(!Array.isArray(s.staffAccounts)||!Array.isArray(s.organizationAuthorityHandovers)||!Array.isArray(s.organizationLifecycleCases))throw Error('原工作账号及限定承接来源无法读取。');
  const ids=new Set(),entries=[];
  for(const account of s.staffAccounts){
    if(!account?.id||ids.has(account.id)||!Array.isArray(account.grants))throw Error('原工作账号来源缺失或冲突。');
    ids.add(account.id);const grants=new Set();
    for(const grant of account.grants){
      if(!grant?.id||grants.has(grant.id))throw Error('原岗位授权来源缺失或冲突。');
      grants.add(grant.id);
      if(grant.role==='store'&&grant.storeId===rawActor.storeId&&grant.purpose==='lifecycle-settlement'&&staffGrantActive(s,account,grant)&&staffSettlementGrantLive(s,account,grant))entries.push({accountId:account.id,grantId:grant.id});
    }
  }
  return {actor:{role:'store',storeId:rawActor.storeId},closedStore:true,entries};
}
// Only the app's exact account.enter call may use the existing public Demo
// entry actor. It is never saved as the current actor or used for another command.
export function accountEnterActor(s,rawActor,path,p={}) {
  const entry=accountWorkLoginProjection(s,rawActor,path==='/store/work-login'?['work-login']:[]);
  if(!entry)return resolveAccountActor(s,rawActor);
  if(!entry.entries.some(x=>x.accountId===p.accountId&&x.grantId===p.grantId))throw Error('请选择本门店当前有效的原事项承接岗位。');
  return {role:'group'};
}
function form(actor,command,payload,fields,label,key,next,confirm='') {
  const scope=[actor.accountId || 'demo',actor.sessionId || '',actor.grantId || '',key].join(':');
  return `<form class="management-form" data-management-form="${e(`account:${scope}`)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}"${next?` data-next="${e(next)}"`:''}${confirm?` data-confirm="${e(confirm)}"`:''}><div class="management-grid">${fields}</div>${command==='account.enter'?'':'<p class="management-draft-note small muted" role="status">未提交内容保留在当前账号的本标签页，提交成功后清除。</p>'}<div class="actions"><button type="submit" class="primary">${e(label)}</button>${command==='account.enter'?'':'<button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button>'}</div></form>`;
}
const storeName=(s,id)=>s.stores?.find(x=>x.id===id)?.name || id;
const scopeName=(s,g)=>g.role==='group'?'全集团':storeName(s,g.storeId);
function identityPanel(s,a) {
  if (!Array.isArray(s.techs)||!Array.isArray(s.users)||!s.techs.length) return '';
  const links=s.organizationIdentityLinks || [],unique=(rows,id)=>typeof id==='string'&&id.trim()&&rows.filter(x=>x.id===id).length===1;
  const linked=s.techs.filter(t=>t.userId||links.some(x=>x.techId===t.id));
  const techs=s.techs.filter(t=>unique(s.techs,t.id)&&Number.isSafeInteger(t.version)&&t.version>=0&&!t.userId&&!links.some(x=>x.techId===t.id));
  const users=s.users.filter(u=>unique(s.users,u.id)&&!privacyUseClosed(s,u.id)&&!s.techs.some(t=>t.userId===u.id)&&!links.some(x=>x.userId===u.id));
  const rows=linked.map(t=>{
    const sources=links.filter(x=>x.techId===t.id),source=sources.length===1?sources[0]:null,userId=t.userId||source?.userId;
    return [`${e(t.name || t.id)}<small>${e(t.id)}</small>`,e(userId || '来源待核对'),e(source&&source.userId===t.userId&&source.id===t.identityLinkId?source.id:'已有本人来源，保留原记录')];
  });
  const fields=`<label class="field"><span>技师主体</span><select name="techId" required data-lifecycle-identity-tech><option value="">请选择</option>${techs.map(t=>`<option value="${e(t.id)}" data-subject-version="${t.version}">${e(t.name || t.id)} · ${e(t.id)}</option>`).join('')}</select></label><input type="hidden" name="version" value="">`+select('本人普通用户','userId',users.map(u=>[u.id,(u.name || u.id)+' · '+u.id]))+field('明确本人核验来源','reference','','required maxlength="200"')+`<label class="field"><span>核验实际发生时间</span><input type="datetime-local" name="occurredAt" required step="1"></label>`+reason();
  return panel('技师本人关联',note('依据已发生的本人核验，明确关联技师和普通用户。已有来源保留，不能通过此表单重绑。')+table(['技师','本人用户编号','原关联来源'],rows)+(techs.length&&users.length?form(a,'lifecycle.identity-link',{},fields,'登记本人关联','identity-link','/group/accounts'):note('暂无可新关联的唯一技师或普通用户，请核对原主体记录。')));
}
const unique=(rows,id)=>typeof id==='string'&&id.trim()&&(rows || []).filter(x=>x.id===id).length===1;
const kindName=kind=>({transfer:'调店',departure:'离职','store-close':'关停'}[kind] || '组织办理');
const handoverState=status=>({pending:'待目标本人确认',accepted:'本人已确认',cancelled:'管理员已撤回',retained:'保留限定原事项承接'}[status] || '原来源待核对');
function employmentPanel(s,a,account,path) {
  const choices=(s.techs || []).filter(t=>unique(s.techs,t.id)&&t.lifecycleStatus!=='left'&&!(s.staffAccounts || []).some(x=>x.id!==account.id&&x.techId===t.id));
  const techField=account.techId?`<p class="small muted wide">原关联技师：${e(account.techId)}，保留原主体。</p>`:`<label class="field"><span>明确关联技师（可不选）</span><select name="techId"><option value="">不关联技师</option>${choices.map(t=>`<option value="${e(t.id)}">${e(t.name || t.id)} · ${e(t.id)}</option>`).join('')}</select></label>`;
  const fields=select('实际人员状态','employmentStatus',[['active','实际在岗'],['ended','工作已结束']])+field('人员状态核验来源','reference','','required maxlength="300"')+`<label class="field"><span>核验实际发生时间</span><input type="datetime-local" name="verifiedAt" required step="1" data-lifecycle-employment-time></label>`+techField+reason();
  return panel('人员在岗来源',note(account.employment?`当前原状态：${account.employment.status==='active'?'已登记在岗':'工作已结束'}；来源 ${account.employment.reference}，发生于 ${d(account.employment.verifiedAt)}。`:'尚无实际人员在岗来源，账号启用和岗位授权不代替在岗核验。')+form(a,'account.employment',{id:account.id,version:account.version},fields,'登记人员状态',`${account.id}:employment`,path,'确认登记实际人员状态？原工作会话将失效，原岗位须重新进入；已有本人及业务记录保留。'));
}
function handoverPanel(s,a,account,path) {
  const records=(s.organizationAuthorityHandovers || []).filter(x=>x.accountId===account.id),liveCases=(s.organizationLifecycleCases || []).filter(c=>unique(s.organizationLifecycleCases,c.id)&&c.stage==='effective'&&c.status==='effective'&&Number.isSafeInteger(c.effectiveAt)&&c.effectiveAt<=s.now);
  const rows=records.map(h=>{
    const c=liveCases.find(c=>c.id===h.caseId),g=account.grants.find(g=>g.id===h.grantId);
    return [e(h.id),`${e(h.caseId)}<small>${e(kindName(c?.kind))}</small>`,`${e(STAFF_JOBS[g?.job]?.label || h.grantId)}<small>${e(h.grantId)} · ${e(storeName(s,h.storeId))}</small>`,e(handoverState(h.status)),c&&['pending','accepted'].includes(h.status)?form(a,'account.handover-cancel',{id:h.id,version:h.version},reason(),'撤回原承接',`${account.id}:handover-cancel:${h.id}`,path,'确认撤回本条原承接？原接受历史保留，本案须重新登记并由目标本人确认。'):'<span class="muted">原承接历史保留</span>'];
  });
  const employment=account.employment,tech=account.techId&&(s.techs || []).find(t=>t.id===account.techId),actualDuty=(!account.techId||unique(s.techs,account.techId)&&tech?.active&&tech.lifecycleStatus!=='left')&&employment?.status==='active'&&Number.isSafeInteger(employment.verifiedAt)&&employment.verifiedAt<=s.now&&employment.reference&&(account.history || []).some(h=>h.action==='account.employment'&&h.at===employment.recordedAt&&h.by?.role==='group'&&h.by.job==='account-admin'&&h.by.accountId===employment.by?.accountId&&lifecycleFingerprint(h.employment)===lifecycleFingerprint(employment));
  let entries='';
  if(actualDuty)for(const c of liveCases){
    let impact;try{impact=lifecycleCaseImpact(s,c.id,createLifecycleContext());}catch{continue;}
    if(impact.blockers.some(x=>x.kind==='lifecycle-case-source'))continue;
    const stores=[...new Set([c.fromStoreId,...impact.bookings.map(x=>x.storeId),...Object.values(impact.settlement.groups).flat().map(x=>x.storeId)].filter(id=>id&&unique(s.stores,id)))];
    for(const g of account.grants){
      const commands=lifecycleHandoverCommands(g.job),endingTech=account.techId===c.techId||g.techId===c.techId;
      if(!commands.length||!staffGrantActive(s,account,g)||!Number.isSafeInteger(g.createdAt)||g.createdAt>c.effectiveAt||c.kind==='departure'&&endingTech||c.kind==='transfer'&&endingTech&&g.role==='store'&&g.storeId===c.fromStoreId)continue;
      const available=stores.filter(id=>(g.role!=='store'||g.storeId===id)&&!records.some(h=>h.caseId===c.id&&h.grantId===g.id&&h.storeId===id&&h.status!=='cancelled'));
      if(!available.length)continue;
      const fields=select('本案原责任门店','storeId',available.map(id=>[id,storeName(s,id)+' · '+id]))+field('原主体明确承接来源','reference','','required maxlength="300"')+reason();
      entries+=`<section class="stack"><h3>${e(kindName(c.kind))} · ${e(c.id)} · ${e(STAFF_JOBS[g.job].label)}</h3><p class="small muted">已有岗位 ${e(g.id)}，本案版本 ${c.version}。登记后由目标本人以此岗位确认；只收窄原事项能力。</p>`+form(a,'account.handover',{version:account.version,caseId:c.id,caseVersion:c.version,accountId:account.id,accountVersion:account.version,grantId:g.id,allowedCommands:commands},fields,'登记原事项承接',`${account.id}:handover:${c.id}:${c.version}:${g.id}`,path,'确认依据原主体来源登记已有岗位承接？须目标本人实际确认，不增加新岗位或营业能力。')+'</section>';
    }
  }
  return panel('原事项承接',note('每个原责任门店分别落实已有客服、集团财务及原店财务岗位。原在岗、版本及授权均在登记时重验。')+table(['承接记录','原组织案','原岗位及责任店','状态','办理'],rows)+(entries||note(actualDuty?'暂无可登记的生效案与原岗位组合，请核对原案、授权及已有承接。':'先登记真实在岗来源，再用已有岗位登记原事项承接。')));
}
function selfHandoverPanel(s,a) {
  const records=(s.organizationAuthorityHandovers || []).filter(h=>h.accountId===a.accountId&&h.grantId===a.grantId);
  if(!records.length)return '';
  return panel('本人原事项承接',records.map(h=>{
    const c=(s.organizationLifecycleCases || []).find(c=>c.id===h.caseId),pending=h.status==='pending'&&c?.stage==='effective'&&unique(s.organizationLifecycleCases,c.id);
    return `<section class="stack"><h3>${e(h.id)} · ${e(h.caseId)}</h3><p>${e(storeName(s,h.storeId))} · ${e(STAFF_JOBS[a.job]?.label)} · ${e(handoverState(h.status))}</p>`+(pending?note('请本人核对实际原事项承接。提交时再次核验当前账号、在岗来源及此岗位；管理员登记不等同本人接受。')+form(a,'account.handover-accept',{id:h.id,version:h.version},field('本人实际接受来源','reference','','required maxlength="300"')+reason(),'本人确认承接',`accept:${h.id}`,`/${a.role}/work-login`):note('保留原记录，后续事项按原岗位和本案范围办理。'))+'</section>';
  }).join(''));
}
function sessionPanel(s,a) {
  const session=s.staffSessions.find(x=>x.id===a.sessionId);
  return panel('当前工作身份',`<dl class="kv-grid"><div><dt>操作人</dt><dd>${e(a.accountName)} · ${e(a.accountId)}</dd></div><div><dt>当前岗位</dt><dd>${e(STAFF_JOBS[a.job]?.label)}</dd></div><div><dt>授权范围</dt><dd>${e(a.role==='group'?'全集团':storeName(s,a.storeId))}</dd></div><div><dt>进入时间</dt><dd>${e(d(session?.issuedAt))}</dd></div></dl>`+note(a.lifecyclePurpose==='lifecycle-settlement'?'当前岗位仅办理本案原事项。返回岗位入口或演示首页会结束当前会话，保留原门店归属；再次进入须重新核验原承接来源。':'一个会话只使用当前岗位授权。返回后台可结束岗位演示，继续浏览其他模块；切换岗位可重新选择授权。未提交草稿保留，停用或授权变更后会话立即失效。')+`<div class="actions">${accountExitActions(a)}</div>`)+selfHandoverPanel(s,a);
}
function login(s,a,adminOnly=false,entry=null) {
  if (!['group','store'].includes(a.role)) return head('工作账号在后台使用','请从对应后台进入，员工账号由集团统一管理。')+`<div class="actions">${link('进入集团后台','/group/accounts','primary')}${link('进入门店后台','/store/work-login','secondary')}</div>`;
  if(a.sessionId) return head('工作账号', '当前使用明确的账号及岗位处理业务。')+sessionPanel(s,a);
  const title=entry?'门店原事项岗位入口':adminOnly?'账号与权限':a.role==='group'?'集团后台岗位演示':'门店后台岗位演示';
  const list=(s.staffAccounts || []).map(account=>{
    const grants=(account.grants || []).filter(g=>entry?entry.entries.some(x=>x.accountId===account.id&&x.grantId===g.id):g.enabled && STAFF_JOBS[g.job]?.role===g.role && g.role===a.role && (g.role!=='store'||(g.storeId===a.storeId && s.stores?.some(x=>x.id===g.storeId))) && (!adminOnly || g.job==='account-admin'));
    if(!grants.length) return '';
    return panel(`${account.name} · ${account.id}`,`<p>${badge(account.enabled?'账号已启用':'账号已停用',account.enabled)}</p>`+grants.map(g=>`<section class="stack"><h3>${e(STAFF_JOBS[g.job].label)}</h3><p class="muted">${e(scopeName(s,g))}</p>${account.enabled?form(a,'account.enter',{accountId:account.id,grantId:g.id},'',`以${STAFF_JOBS[g.job].label}进入`,`${account.id}:${g.id}`,adminOnly?'/group/accounts':`/${g.role}/dashboard`):note('账号已停用，不能进入。',true)}</section>`).join(''));
  }).join('');
  return head(title,entry?`选择${storeName(s,a.storeId)}已明确承接的原事项岗位。`:adminOnly?'使用已授权的账号管理员岗位，管理集团及门店员工。':a.role==='store'?`选择${storeName(s,a.storeId) || '当前门店'}的已授权岗位。`:'选择集团岗位，在集团后台处理对应业务。',entry?link('返回演示首页','/user/home','secondary'):link('返回工作台',`/${a.role}/dashboard`,'secondary'))+note(entry?'这是本地 Demo岗位入口，不校验真实员工身份，也不连接生产登录。门店已关闭，进入后仅可办理本案明确承接的原事项。':'这是本地 Demo，可自由选择已启用的样例账号，不校验真实员工身份，也不连接生产登录。进入岗位后，可从顶部返回后台继续完整演示。',true)+(list||empty('暂无可用岗位',a.role==='store'?'请核对当前门店；账号与授权由集团后台统一维护。':'请由集团账号管理员核对岗位授权。'));
}
function dashboard(s,a) {
  const entries=Object.entries(ROUTE_NAMES).filter(([path])=>canAccountView(a,path));
  return head(a.role==='group'?'集团工作台':'门店工作台',`当前岗位：${STAFF_JOBS[a.job].label}。按已授权范围处理业务。`)+sessionPanel(s,a)+panel('当前可办理事项',`<div class="menu-list">${entries.map(([path,label])=>link(label,`/${a.role}/${path}`)).join('')}</div>`);
}
function history(account) {
  const actions={'account.create':'开通账号','account.grant':'新增授权','account.revoke':'撤销授权','account.status':'变更启停','account.employment':'登记人员在岗来源'};
  return panel('账号处理记录',table(['时间','处理事项','操作人','原因'],[...(account.history || [])].reverse().map(h=>[e(d(h.at)),e(actions[h.action] || h.action),e(h.by?.accountName || h.by?.accountId || '演示系统'),e(h.reason)])));
}
function detail(s,a,account) {
  const path='/group/accounts/'+encodeURIComponent(account.id),current=account.id===a.accountId;
  const grantRows=account.grants.map(g=>[e(STAFF_JOBS[g.job]?.label || g.job),e(scopeName(s,g)),badge(g.enabled?'授权有效':'已撤销',g.enabled),g.enabled?form(a,'account.revoke',{id:account.id,version:account.version,grantId:g.id},reason(),'撤销此授权',`${account.id}:revoke:${g.id}`,path,'确认撤销该岗位？该账号全部旧会话将立即失效，历史业务记录保留。'):'<span class="muted">保留原授权记录</span>']);
  return head(account.name,`${account.id} · 资料版本 ${account.version}`,link('返回账号列表','/group/accounts','secondary'))+panel('账号状态',`<p>${badge(account.enabled?'已启用':'已停用',account.enabled)}</p>`+note(current?'正在管理本人账号。修改本人授权将结束当前工作会话；至少保留一位有效账号管理员。':'停用会撤销该账号的所有工作会话；恢复后需重新进入。业务订单、资金及历史记录保留。')+form(a,'account.status',{id:account.id,version:account.version,enabled:!account.enabled},reason(),account.enabled?'停用账号':'恢复账号',`${account.id}:status`,path,`确认${account.enabled?'停用':'恢复'}该工作账号？`))+panel('岗位与数据范围',table(['岗位','范围','状态','操作'],grantRows))+panel('增加集团岗位',note('集团岗位按全集团授权；账号管理员仅管理账号和授权，业务财务需分别授权。')+form(a,'account.grant',{id:account.id,version:account.version},select('集团岗位','job',Object.entries(STAFF_JOBS).filter(([,x])=>x.role==='group').map(([id,x])=>[id,x.label]))+reason(),'新增集团授权',`${account.id}:grant-group`,path,'确认增加此集团岗位授权？该账号原会话将失效，需重新选择岗位进入。'))+panel('增加门店岗位',form(a,'account.grant',{id:account.id,version:account.version},select('门店岗位','job',Object.entries(STAFF_JOBS).filter(([,x])=>x.role==='store').map(([id,x])=>[id,x.label]))+select('授权门店','storeId',(s.stores || []).map(x=>[x.id,x.name]))+reason(),'新增门店授权',`${account.id}:grant-store`,path,'确认增加此门店岗位授权？此授权仅限所选门店，不扩大其他岗位范围。'))+employmentPanel(s,a,account,path)+handoverPanel(s,a,account,path)+history(account);
}
export function accountUiView(s,rawActor,route=[],ui={}) {
  if (!['work-login','accounts'].includes(route[0]) && !(rawActor?.sessionId && ['dashboard','home'].includes(route[0]))) return null;
  let actor;
  try {const entry=accountWorkLoginProjection(s,rawActor,route);if(entry)return login(s,entry.actor,false,entry);actor=resolveAccountActor(s,rawActor);} catch(error) {return accountSessionErrorView(s,rawActor,error.message);}
  if (route[0]==='work-login') return route.length===1?login(s,actor):empty('页面不存在');
  if (['dashboard','home'].includes(route[0])) return dashboard(s,actor);
  if (!actor?.sessionId && actor.role==='group' && (!actor.job || actor.job==='all') && route.length===1) return login(s,actor,true);
  if (!actor?.sessionId || actor.role!=='group' || actor.job!=='account-admin') return empty('当前岗位无权管理工作账号','账号与权限由集团后台内的账号管理员办理。');
  if (route.length>2) return empty('页面不存在');
  if (route[1]) {const account=(s.staffAccounts || []).find(x=>x.id===route[1]);return account?detail(s,actor,account):empty('工作账号不存在');}
  const rows=(s.staffAccounts || []).map(a=>[`${e(a.name)}<small>${e(a.id)}</small>`,badge(a.enabled?'已启用':'已停用',a.enabled),e(a.grants.filter(g=>g.enabled).map(g=>`${STAFF_JOBS[g.job]?.label || g.job} · ${scopeName(s,g)}`).join('；') || '待授权'),link('查看及授权','/group/accounts/'+encodeURIComponent(a.id),'secondary')]);
  return head('账号与权限','账号与岗位分开记录；授权变更即时撤销旧会话。')+note('本地账号演示不包含真实登录、密码、短信、服务端鉴权或生产权限配置。')+panel('员工账号',table(['账号','状态','有效授权','操作'],rows))+identityPanel(s,actor)+panel('开通工作账号',form(actor,'account.create',{},field('员工姓名或称呼','name')+reason(),'开通账号','create','/group/accounts','确认开通工作账号？账号须另行授予岗位后才能进入工作会话。'));
}
