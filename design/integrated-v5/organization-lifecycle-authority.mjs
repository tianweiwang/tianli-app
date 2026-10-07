import { resolveAccountActor, staffGrantActive, staffGrantCapabilities, actorAccountFields } from './staff-accounts.mjs';
import { lifecycleFingerprint, lifecycleCaseImpact } from './organization-lifecycle-projection.mjs';

const clone=v=>structuredClone(v),list=v=>Array.isArray(v)?v:[],unique=(rows,id)=>{const found=list(rows).filter(x=>x?.id===id);return found.length===1?found[0]:null;};
const plain=v=>Array.isArray(v)?v.map(plain):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,plain(v[k])])):v;
const source=v=>JSON.stringify(plain(v));
const time=v=>Number.isSafeInteger(v)&&v>=0;
function fail(ctx,message){ctx?.fail?.(message);throw new Error(message);}
function required(v,label,ctx){if(typeof v!=='string'||!v.trim()||v.trim().length>1000)fail(ctx,'请填写'+label);return v.trim();}
const by=a=>({role:a.role,job:a.job||null,...actorAccountFields(a)});
const CARE=['booking.special-aftersale','booking.dispute-review','booking.assistance-close','care.case-respond','care.case-close','care.case-note','care.followup-record','care.followup-close'];
const ORIGINAL_FINANCE=['invoice.issue','invoice.reject','invoice.red','invoice.replace-file','tech-income.payout','tech-income.difference-record','booking.refund-pay','booking.refund-query','booking.payment-query','booking.extension-query','bill.confirm','bill.dispute','bill.dispute-lines','bill.offset-confirm','service-extra.evidence-submit','service-extra.refund-shortage','service-extra.recharge','service-extra.offset-confirm'];
const GROUP_FINANCE=['booking.refund-pay','booking.refund-query','finance.split-start','finance.split-query','finance.finish-start','finance.finish-query','finance.return-start','finance.return-query','finance.recovery-receive','service-promotion.withdraw-pay','service-promotion.withdraw-query','service-promotion.recovery-receive','service-promotion.recovery-return'];
export function lifecycleHandoverCommands(job){return clone(job==='support'?CARE:job==='finance'?GROUP_FINANCE:job==='store-finance'?ORIGINAL_FINANCE:[]);}
const originalCase=c=>({id:c.id,kind:c.kind,techId:c.techId||null,storeId:c.storeId||null,fromStoreId:c.fromStoreId,effectiveAt:c.effectiveAt,reference:c.reference});
function caseFor(s,c){return c&&unique(s.organizationLifecycleCases,c.id)===c && ['transfer','departure','store-close'].includes(c.kind) && time(c.effectiveAt) && c.effectiveAt<=s.now && ['effective','completed'].includes(c.stage);}
function responsibilities(s,c,impact){
  impact ??= lifecycleCaseImpact(s,c.id);
  const stores=new Set(c.kind==='store-close'?[c.storeId]:[c.fromStoreId]);
  for(const row of [...(impact.bookings||[]),...Object.values(impact.settlement?.groups||{}).flat()])if(row.storeId)stores.add(row.storeId);
  return [...stores].filter(Boolean).sort();
}
function ending(s,c,account,g){return c.kind==='store-close'?g.role==='store'&&g.storeId===c.storeId:c.kind==='departure'?account.techId===c.techId||g.techId===c.techId:(account.techId===c.techId||g.techId===c.techId)&&g.role==='store'&&g.storeId===c.fromStoreId;}
function duty(s,a){const t=a?.techId&&unique(s.techs,a.techId),e=a?.employment,event=list(a?.history).find(x=>x?.action==='account.employment'&&x.at===e?.recordedAt&&source(x.employment)===source(e)&&x.by?.role==='group'&&x.by.job==='account-admin'&&x.by.accountId===e?.by?.accountId);return Boolean(e?.status==='active'&&e.reference&&time(e.verifiedAt)&&e.verifiedAt<=s.now&&event&&(!a.techId||t?.active&&t.lifecycleStatus!=='left'));}
function handoverLive(s,c,h){
  if(!caseFor(s,c))return false;
  const a=unique(s.staffAccounts,h.accountId),g=unique(a?.grants,h.grantId),caps=staffGrantCapabilities(g);
  return Boolean(h.status==='accepted'&&h.acceptedBy?.accountId===h.accountId&&h.acceptedBy?.grantId===h.grantId&&time(h.acceptedAt)&&h.acceptedAt>=h.createdAt&&h.acceptedAt<=s.now&&h.acceptanceReference&&h.caseSource===source(originalCase(c))&&duty(s,a)&&staffGrantActive(s,a,g)&&a.version===h.acceptedAccountVersion&&source(g)===h.grantSource&&source(a.employment)===h.employmentSource&&time(g.createdAt)&&g.createdAt<=c.effectiveAt&&Array.isArray(h.allowedCommands)&&h.allowedCommands.length&&h.allowedCommands.every(x=>caps.commands.includes(x))&&!(c.kind==='departure'&&(a.techId===c.techId||g.techId===c.techId)));
}
function employmentSnapshot(a){return {id:a.id,version:a.version,enabled:a.enabled,techId:a.techId||null,employment:a.employment||null,grants:clone(a.grants||[])};}

export function lifecycleAuthorityCommand(s,rawActor,type,p={},ctx={}){
  const a=resolveAccountActor(s,rawActor),admin=a?.accountId&&a.sessionId&&a.role==='group'&&a.job==='account-admin';
  if(['account.handover','account.handover-cancel'].includes(type)?!admin:type!=='account.handover-accept'||!a?.accountId||!a.sessionId)fail(ctx,'仅账号管理员登记，目标本人实际工作会话确认原事项承接');
  s.organizationAuthorityHandovers ??=[];s.staffAccountRequests ??=[];s.staffAccountLog ??=[];
  const requestId=required(p.requestId,'稳定提交标识',ctx),digest=lifecycleFingerprint({type,p}),who=a.accountId;
  const prior=s.staffAccountRequests.find(r=>r.actor===who&&r.requestId===requestId);
  if(prior){if(prior.fingerprint!==digest)fail(ctx,'同一提交标识不能用于不同承接内容');return clone(prior.result);}
  const reason=required(p.reason,'承接依据',ctx);let h;
  if(type==='account.handover'){
    const c=unique(s.organizationLifecycleCases,p.caseId),account=unique(s.staffAccounts,p.accountId),grant=unique(account?.grants,p.grantId);
    if(!caseFor(s,c)||c.stage!=='effective'||!account||!grant||!duty(s,account)||!staffGrantActive(s,account,grant)||!time(grant.createdAt)||grant.createdAt>c.effectiveAt)fail(ctx,'原办理、在岗或已有岗位授权来源无效，不能创建承接标签');
    if(!['number','string'].includes(typeof p.accountVersion)||!String(p.accountVersion).trim()||Number(p.accountVersion)!==account.version)fail(ctx,'目标账号已更新，请刷新核对原授权');
    if(!['number','string'].includes(typeof p.caseVersion)||!String(p.caseVersion).trim()||Number(p.caseVersion)!==c.version)fail(ctx,'原组织办理已更新，请刷新核对');
    const caps=staffGrantCapabilities(grant),commands=Array.isArray(p.allowedCommands)?[...new Set(p.allowedCommands)]:[];
    if(!commands.length||commands.some(x=>!caps.commands.includes(x)||/^(manage\.|account\.|lifecycle\.)|rule-publish|policy-publish|booking\.(create|assign|propose-reschedule|schedule-save|busy-)/.test(x)))fail(ctx,'承接只能收窄原岗位已有的原事项操作，不得增加营业或配置权限');
    const storeId=required(p.storeId,'原责任门店',ctx);
    if(!responsibilities(s,c).includes(storeId)||grant.role==='store'&&grant.storeId!==storeId||ending(s,c,account,grant)&&c.kind!=='store-close')fail(ctx,'承接不属于原责任门店或目标本人工作授权将结束');
    if(s.organizationAuthorityHandovers.some(x=>x.caseId===c.id&&x.accountId===account.id&&x.grantId===grant.id&&x.storeId===storeId&&x.status!=='cancelled'))fail(ctx,'已有同一原岗位承接，请核对现有记录');
    h={id:ctx.id?ctx.id('OAH'):'OAH'+ ++s.seq,caseId:c.id,caseSource:source(originalCase(c)),accountId:account.id,grantId:grant.id,storeId,allowedCommands:commands,reference:required(p.reference,'原主体明确承接来源',ctx),reason,status:'pending',version:1,createdAt:s.now,createdBy:by(a),grantSource:source(grant),employmentSource:source(account.employment),createdAccountVersion:account.version};
    s.organizationAuthorityHandovers.push(h);
  }else if(type==='account.handover-cancel'){
    h=unique(s.organizationAuthorityHandovers,p.id);const c=unique(s.organizationLifecycleCases,h?.caseId);
    if(!h||!['pending','accepted'].includes(h.status)||!caseFor(s,c)||c.stage!=='effective'||!['number','string'].includes(typeof p.version)||!String(p.version).trim()||Number(p.version)!==h.version)fail(ctx,'承接已经结束、版本变化或组织完成，不能撤回原记录');
    h.status='cancelled';h.version++;h.cancelledAt=s.now;h.cancelledBy=by(a);h.cancelReason=reason;
  }else{
    h=unique(s.organizationAuthorityHandovers,p.id);const c=unique(s.organizationLifecycleCases,h?.caseId),account=unique(s.staffAccounts,h?.accountId),grant=unique(account?.grants,h?.grantId);
    if(!h||!['number','string'].includes(typeof p.version)||!String(p.version).trim()||Number(p.version)!==h.version||h.status!=='pending'||!caseFor(s,c)||c.stage!=='effective'||a.accountId!==h.accountId||a.grantId!==h.grantId||!duty(s,account)||account.version!==h.createdAccountVersion||source(grant)!==h.grantSource||source(account.employment)!==h.employmentSource)fail(ctx,'原承接、版本或目标在岗授权已变化，须核对且由目标本人确认');
    h.status='accepted';h.version++;h.acceptedAt=s.now;h.acceptedBy=by(a);h.acceptedAccountVersion=account.version;h.acceptanceReference=required(p.reference,'本人实际承接确认来源',ctx);
  }
  s.staffAccountLog.push({id:ctx.id?ctx.id('AL'):'AL'+ ++s.seq,accountId:h.accountId,at:s.now,action:type,by:by(a),reason,sourceCaseId:h.caseId,handoverId:h.id});
  const result=clone(h);s.staffAccountRequests.push({actor:who,requestId,fingerprint:digest,result,at:s.now});return result;
}

function personalExit(s,c,adapters,blockers){
  const t=unique(s.techs,c.techId),u=unique(s.users,t?.userId),link=unique(s.organizationIdentityLinks,t?.identityLinkId),key='tech:'+c.techId;
  if(!t||!u||!link||link.techId!==t.id||link.userId!==u.id||!link.reference||!time(link.occurredAt)||link.occurredAt>s.now||!link.createdBy?.accountId){blockers.push({kind:'historical-identity',reason:'本人历史权利缺少匹配的持久实际身份来源'});return [];}
  const methods=['incomeView','promotionView','assertCommand','authorizeFile'];
  if(methods.some(name=>typeof adapters?.[name]!=='function')){blockers.push({kind:'historical-adapter',reason:'本人原提成、佣金、提现决定及附件实际出口尚未接齐'});return [];}
  const probe=clone(s),tech=unique(probe.techs,t.id);tech.lifecycleStatus='left';tech.active=false;
  const actor={role:'user',userId:u.id},before=source(probe);
  const same=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&new Set(actual.map(x=>x.id)).size===actual.length&&actual.every(x=>expected.some(e=>e.id===x.id));
  try{
    const income=adapters.incomeView(probe,actor,t.id),promotion=adapters.promotionView(probe,actor,t.id);
    const own=(name,predicate)=> (s[name]||[]).filter(predicate);
    for(const name of ['entries','differences','adjustments','payouts'])if(!same(income?.[name],own({entries:'techIncomeEntries',differences:'techIncomeDifferences',adjustments:'techIncomeAdjustments',payouts:'techIncomePayouts'}[name],x=>x.techId===t.id)))throw new Error('原提成来源遗漏或包含他人');
    const promoters=own('servicePromoters',x=>x.personKind==='tech'&&x.personId===t.id);
    for(const [name,container] of [['commissions','serviceCommissions'],['withdrawals','servicePromotionWithdrawals'],['recoveries','servicePromotionRecoveries']])if(!same(promotion?.[name],own(container,x=>x.personKey===key)))throw new Error('原个人资金来源遗漏或包含他人');
    if(!same(promotion?.promoters,promoters))throw new Error('原身份来源遗漏或被新建身份替换');
    for(const p of promoters)for(const type of ['service-promotion.withdraw-create','service-promotion.withdraw-confirm','service-promotion.withdraw-cancel']){
      const capability=adapters.assertCommand(probe,actor,type,{techId:t.id,promoterId:p.id});
      if(capability?.allowed!==true||capability.techId!==t.id||capability.userId!==u.id||capability.personKey!==key)throw new Error('个人原命令未与真实本人及旧personKey接线');
    }
    const collect=value=>{const out=[];const walk=x=>{if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object'){if(/^invoice-file:[a-f0-9]{64}$/.test(x.ref||''))out.push(x.ref);Object.values(x).forEach(walk);}};walk(value);return [...new Set(out)];};
    const visibleRefs=new Set(collect(promotion)),originalRefs=new Set([...collect(promoters),...collect(own('servicePromotionWithdrawals',x=>x.personKey===key)),...collect(own('servicePromotionRecoveries',x=>x.personKey===key)),...visibleRefs]);
    for(const reference of originalRefs){const allowed=adapters.authorizeFile(probe,actor,reference,{techId:t.id});if(typeof allowed?.allowed!=='boolean'||allowed.allowed!==visibleRefs.has(reference)||allowed.reference!==reference||allowed.techId!==t.id||allowed.userId!==u.id||allowed.personKey!==key)throw new Error('原附件授权出口未接齐或扩大原内部审核权限');}
    if(source(probe)!==before)throw new Error('本人权利读取不得改变原事实');
    return [{kind:'tech-history',techId:t.id,userId:u.id,identityLinkId:link.id,personKey:key,entryIds:(income.entries||[]).map(x=>x.id),promoterIds:promoters.map(x=>x.id)}];
  }catch(e){blockers.push({kind:'historical-exit',reason:'本人历史出口未核齐：'+e.message});return [];}
}

export function lifecycleAuthorityPreflight(s,c,options={}){
  const blockers=[],retainedRights=[];
  if(!caseFor(s,c)||c.stage!=='effective')blockers.push({kind:'authority-case',reason:'原组织办理尚未实际生效或来源不唯一，不能结束工作授权'});
  if(!Array.isArray(s.staffAccounts)||!Array.isArray(s.staffSessions)||!Array.isArray(s.organizationAuthorityHandovers))blockers.push({kind:'authority-source',reason:'原账号、会话或承接来源容器缺失，须核对'});
  let impact=null;if(caseFor(s,c))try{impact=options.impact||lifecycleCaseImpact(s,c.id,{goodsSummary:options.goodsSummary});}catch(e){blockers.push({kind:'authority-responsibility',reason:'本案原责任来源无法核验：'+e.message});}
  const stores=caseFor(s,c)?responsibilities(s,c,impact||{}):[],handovers=list(s.organizationAuthorityHandovers).filter(h=>h?.caseId===c?.id),live=handovers.filter(h=>handoverLive(s,c,h));
  if(caseFor(s,c)){
    if(impact?.caseId!==c.id || !c.responsibilityBasis?.sourceToken)blockers.push({kind:'authority-responsibility',reason:'本案原责任范围来源缺失，不能按全人未来原账替代'});
    const roles=stores.flatMap(storeId=>[{kind:'care',job:'support',commands:CARE,storeId},{kind:'group-finance',job:'finance',commands:GROUP_FINANCE,storeId},{kind:'original-finance',job:'store-finance',commands:ORIGINAL_FINANCE,storeId}]);
    for(const role of roles){const matches=live.filter(h=>{const a=unique(s.staffAccounts,h.accountId),g=unique(a?.grants,h.grantId);return g?.job===role.job&&h.storeId===role.storeId&&(g.role!=='store'||g.storeId===role.storeId)&&role.commands.every(x=>h.allowedCommands.includes(x));});if(!matches.length)blockers.push({kind:'handover-'+role.kind,storeId:role.storeId,reason:'原事项缺少在岗、已有岗位授权及本人实际确认的'+role.job+'承接'});else retainedRights.push(...matches.map(h=>({kind:role.kind,handoverId:h.id,accountId:h.accountId,grantId:h.grantId,storeId:h.storeId})));}
    for(const h of handovers)if(h.status!=='cancelled'&&!handoverLive(s,c,h))blockers.push({kind:'handover-invalid',sourceId:h.id,reason:'承接未确认、账号/在岗/岗位权限或原来源已变化'});
    if(c.kind==='departure')retainedRights.push(...personalExit(s,c,options.historicalRightsAdapters,blockers));
    const remain=list(s.staffAccounts).some(a=>list(a?.grants).some(g=>g?.job==='account-admin'&&staffGrantActive(s,a,g)&&!ending(s,c,a,g)));
    if(!remain)blockers.push({kind:'administrator-exit',reason:'工作授权结束后没有有效账号管理员，须先落实其他管理员'});
  }
  const relevant=list(s.staffAccounts).filter(a=>a&& (list(a.grants).some(g=>g&&(ending(s,c||{},a,g)||g.job==='account-admin'))||handovers.some(h=>h.accountId===a.id)));
  const identity= c?.kind==='departure' ? {tech:unique(s.techs,c.techId),links:(s.organizationIdentityLinks||[]).filter(l=>l.techId===c.techId)} : null;
  const facts={case:originalCase(c||{}),impactToken:impact?.sourceToken,accounts:relevant.map(employmentSnapshot),sessions:clone(list(s.staffSessions).filter(x=>x&&relevant.some(a=>a.id===x.accountId))),handovers:clone(handovers),identity,retainedRights,blockers};
  const located=blockers.map(x=>({...x,sourceId:x.sourceId||x.storeId||c?.techId||c?.storeId||c?.id||null,path:x.path||(x.kind.startsWith('historical-')?'/group/technicians/'+encodeURIComponent(c?.techId||''):x.storeId?'/group/stores/'+encodeURIComponent(x.storeId):'/group/accounts')}));
  return {ready:located.length===0,sourceToken:lifecycleFingerprint(facts),blockers:located,retainedRights};
}

export function applyLifecycleAuthorityExit(s,c,ctx={}){
  if(c?.authorityExitReceipt){if(!caseFor(s,c)||c.authorityExitReceipt.caseSourceToken!==lifecycleFingerprint(originalCase(c)))fail(ctx,'原授权结束来源已变化');return clone(c.authorityExitReceipt);}
  const preflight=lifecycleAuthorityPreflight(s,c,{impact:ctx.lifecycleCompletionImpact,historicalRightsAdapters:ctx.historicalRightsAdapters,goodsSummary:ctx.goodsSummary});
  if(!preflight.ready)fail(ctx,preflight.blockers.map(x=>x.reason).join('；'));
  if(ctx.expectedAuthorityToken&&ctx.expectedAuthorityToken!==preflight.sourceToken)fail(ctx,'原承接与工作授权来源已变化，请刷新核对');
  const receipt={caseId:c.id,endedGrantIds:[],revokedSessionIds:[],retainedGrantIds:[],sourceToken:preflight.sourceToken,caseSourceToken:lifecycleFingerprint(originalCase(c)),at:s.now};
  for(const account of s.staffAccounts){
    let changed=false;
    for(const grant of account.grants){
      if(!ending(s,c,account,grant)||!grant.enabled)continue;
      const h=s.organizationAuthorityHandovers.find(x=>x.caseId===c.id&&x.accountId===account.id&&x.grantId===grant.id&&handoverLive(s,c,x));
      if(c.kind==='store-close'&&h){grant.purpose='lifecycle-settlement';grant.sourceCaseId=c.id;grant.handoverId=h.id;grant.responsibilityAt=c.effectiveAt;grant.allowedCommands=clone(h.allowedCommands);grant.originalBookingIds=[...new Set([c.responsibilityBasis,...(c.responsibilityHistory||[])].flatMap(b=>b?.bookingIds||[]))];grant.originalGoodsIds=[...new Set([c.responsibilityBasis,...(c.responsibilityHistory||[])].flatMap(b=>b?.goodsIds||[]))];grant.allowedRoutes=staffGrantCapabilities(grant).routes.filter(x=>['tasks','bookings','booking','goods','bills','recoveries','invoices','service-finance','care','fulfilment','work-escalations','fee-invoices'].includes(x));h.status='retained';h.retainedAt=s.now;h.retainedGrantSource=source(grant);h.retainedEmploymentSource=source(account.employment);receipt.retainedGrantIds.push(grant.id);}
      else{grant.enabled=false;grant.validTo=s.now;grant.revokedAt=s.now;grant.sourceCaseId=c.id;grant.revokeReason='原组织办理完成，工作授权结束';receipt.endedGrantIds.push(grant.id);}
      changed=true;
    }
    if(!changed)continue;
    account.version++;account.updatedAt=s.now;
    if(c.kind==='departure'&&account.techId===c.techId){account.employment={...(account.employment||{}),status:'ended',endedAt:s.now,sourceCaseId:c.id};account.enabled=false;}
    for(const session of s.staffSessions)if(session.accountId===account.id&&session.revokedAt==null){session.revokedAt=s.now;session.revokeReason='原组织办理完成，旧工作会话结束';session.sourceCaseId=c.id;receipt.revokedSessionIds.push(session.id);}
    const event={id:ctx.id?ctx.id('AL'):'AL'+ ++s.seq,accountId:account.id,at:s.now,action:'lifecycle.authority-exit',sourceCaseId:c.id,version:account.version,reason:'按原办理结束营业授权，保留限定原事项承接'};
    (account.history ??=[]).push(clone(event));(s.staffAccountLog ??=[]).push(event);
  }
  c.authorityExitReceipt=clone(receipt);return receipt;
}
