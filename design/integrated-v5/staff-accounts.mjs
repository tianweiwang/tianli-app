// Local staff-session demonstration. This does not authenticate a real employee.
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const fingerprint = v => JSON.stringify(canonical(v));
const required = (v,label,max=300) => { if (typeof v !== 'string' || !v.trim() || v.trim().length > max) fail(`请填写${label}（最多${max}字）。`); return v.trim(); };
const nextId = (s,ctx,prefix) => ctx?.id ? ctx.id(prefix) : prefix + (++s.seq);
const admin = a => Boolean(a?.sessionId && a.accountId && a.role === 'group' && a.job === 'account-admin');
const managed = a => Boolean(a?.sessionId || a?.accountId);
export const STAFF_JOBS = {
  'account-admin': { label:'账号管理员',role:'group' },
  operations: { label:'集团运营',role:'group' },
  warehouse: { label:'集团仓储',role:'group' },
  finance: { label:'集团财务',role:'group' },
  support: { label:'集团客服',role:'group' },
  'store-manager': { label:'门店主管',role:'store' },
  'store-finance': { label:'门店财务',role:'store' }
};
const ROUTES = {
  'account-admin':['accounts'],
  operations:['tasks','catalog','categories','services','stores','technicians','qualifications','rules'],
  warehouse:['tasks','inventory','goods','returns'],
  finance:['tasks','bookings','booking','goods','bills','recoveries','invoices','service-finance'],
  support:['tasks','operations','busy','bookings','booking','safety','goods','returns','care','reviews','qualifications','handoffs','privacy'],
  'store-manager':['tasks','operations','busy','bookings','booking','schedule','safety','goods','services','stores','technicians','qualifications','care','reviews','handoffs'],
  'store-finance':['tasks','bookings','booking','goods','bills','recoveries','invoices','service-finance']
};
const BOOKING_STAFF = ['booking.schedule-save','booking.busy-create','booking.busy-extend','booking.busy-end','booking.leave-review','booking.help-ack','booking.help-close','booking.payment-query','booking.extension-query','booking.cancel','booking.assign','booking.propose-reschedule','booking.dispute-review','booking.dispute-close','booking.assistance-close','booking.refund-review'];
const CARE_STAFF = ['care.case-create','care.case-respond','care.case-statement','care.case-note','care.case-link','care.case-close','care.followup-create','care.followup-record','care.followup-link','care.followup-close','care.task-assign','care.task-claim'];
const COMMANDS = {
  'account-admin': new Set(['account.create','account.grant','account.revoke','account.status']),
  operations: new Set(['manage.product-save','manage.sku-save','manage.product-status','manage.category-save','manage.service-save','manage.store-save','manage.store-status','manage.tech-import','manage.tech-save','manage.tech-review','manage.rules-save','qualification.assess','qualification.request','qualification.review','qualification.pause','qualification.resume']),
  warehouse: new Set(['manage.inventory','goods.ship','goods.inspect','goods.return-back','goods.inspect-partial','goods.incident-open','goods.incident-note']),
  finance: new Set(['goods.refund','goods.refund-query','bill.create','bill.resolve','bill.pay','bill.query','recovery.receive','booking.refund-pay','booking.refund-query','finance.rule-publish','finance.split-start','finance.split-query','finance.finish-start','finance.finish-query','finance.return-start','finance.return-query','finance.recovery-receive','tech-income.rule-publish']),
  support: new Set([...BOOKING_STAFF,...CARE_STAFF,'booking.special-aftersale','goods.case-review','goods.inspection-resolve','goods.incident-open','goods.incident-note','goods.incident-propose','goods.partial-propose','review.moderate-text','review.hide','review.appeal-final','qualification.pause','handoff.note','privacy.close','privacy.followup','sensitive.reveal']),
  'store-manager': new Set([...BOOKING_STAFF,...CARE_STAFF,'manage.store-save','manage.tech-save','manage.tech-import','qualification.assess','qualification.request','qualification.pause','review.appeal-store','handoff.note']),
  'store-finance': new Set(['bill.confirm','bill.dispute','invoice.issue','invoice.reject','invoice.red','invoice.replace-file','tech-income.payout','tech-income.difference-record','booking.refund-pay','booking.refund-query','booking.payment-query','booking.extension-query'])
};
for (const command of ['account.employment','account.handover','account.handover-cancel']) COMMANDS['account-admin'].add(command);
for (const commands of Object.values(COMMANDS)) commands.add('account.handover-accept');
for (const command of ['bill.split','bill.offset-propose','bill.offset-cancel','bill.offset-pay','bill.offset-query']) COMMANDS.finance.add(command);
for (const command of ['finance.composition-confirm','finance.composition-reconcile']) COMMANDS.finance.add(command);
for (const command of ['bill.dispute-lines','bill.offset-confirm']) COMMANDS['store-finance'].add(command);
COMMANDS.operations.add('goods-logistics.policy-publish'); ROUTES.operations.push('goods-logistics');
for(const job of ['warehouse','support']) COMMANDS[job].add('goods-logistics.delivery-record');
COMMANDS.support.add('goods-logistics.delivery-verify'); COMMANDS.support.add('goods.incident-verify');
for (const command of ['evidence-review','policy-publish','refund-shortage','advance-decision','advance-cancel','advance-pay','advance-query','advance-reconcile','recovery-receive','offset-propose','offset-cancel','offset-pay','offset-query','offset-return']) COMMANDS.finance.add('service-extra.'+command);
for (const command of ['evidence-submit','refund-shortage','recharge','offset-confirm']) COMMANDS['store-finance'].add('service-extra.'+command);
for (const command of ['rule-publish','issue','reject','red','replace-file']) COMMANDS.finance.add('commerce-invoice.'+command);
for (const command of ['apply-fee','resubmit','reapply']) COMMANDS['store-finance'].add('commerce-invoice.'+command);
ROUTES.finance.push('commodity-invoices','fee-invoices','commerce-invoice-rules');
ROUTES['store-finance'].push('fee-invoices');
for(const command of ['policy-publish','rule-publish','withdraw-pay','withdraw-query','recovery-receive','recovery-return','recovery-loss']) COMMANDS.finance.add('service-promotion.'+command);
for(const command of ['identity-review','risk-review','agreement-publish']) COMMANDS.support.add('service-promotion.'+command);
for(const command of ['invite','disable','agreement-publish']) COMMANDS.operations.add('service-promotion.'+command);
for(const command of ['invite','disable']) COMMANDS['store-manager'].add('service-promotion.'+command);
for(const job of ['finance','support','operations','store-manager','store-finance']) ROUTES[job].push('service-promotion');
ROUTES.support.push('fulfilment');
ROUTES['store-manager'].push('fulfilment');
for(const command of ['policy-publish','duty-save','fact-record','fact-verify','fact-correct','departure-history','departure-contact','departure-escalate','departure-takeover','departure-resolve','notice-record']) COMMANDS.support.add('fulfilment.'+command);
for(const command of ['duty-save','fact-record','fact-correct','departure-history','departure-contact','departure-escalate','departure-takeover','departure-resolve','notice-record']) COMMANDS['store-manager'].add('fulfilment.'+command);
COMMANDS['account-admin'].add('lifecycle.identity-link');
for(const action of ['transfer-plan','departure-start','store-close-start','cancel-plan','complete']) COMMANDS.operations.add('lifecycle.'+action);
for(const action of ['store-pause','store-pause-emergency','store-pause-cancel','store-resume']) COMMANDS.operations.add('lifecycle.'+action);
for(const action of ['store-pause','store-pause-cancel']) COMMANDS['store-manager'].add('lifecycle.'+action);
ROUTES.support.push('penalties'); ROUTES['store-manager'].push('penalties');
COMMANDS.support.add('penalty.appeal-review'); COMMANDS['store-manager'].add('penalty.warning-record');
ROUTES.support.push('quality-policies');
COMMANDS.support.add('quality.policy-publish'); COMMANDS.support.add('quality.policy-withdraw');
for (const [job, commands] of Object.entries(COMMANDS)) if (job !== 'account-admin') { commands.add('work.claim'); commands.add('work.assign'); commands.add('report.export'); for(const action of ['decline','raise','takeover']) commands.add('work-escalation.'+action); ROUTES[job].push('reports','work-escalations'); }
export function actorAccountFields(actor) {
  return actor?.accountId && actor?.sessionId ? {accountId:actor.accountId,accountName:actor.accountName,grantId:actor.grantId} : {};
}
export function upgradeAccounts(s) {
  if (s.staffAccounts == null) s.staffAccounts = [{id:'DEMO-ADMIN',name:'演示账号管理员',enabled:true,version:1,createdAt:s.now,createdBy:{role:'system'},grants:[{id:'DEMO-ADMIN-GRANT',job:'account-admin',role:'group',storeId:null,enabled:true,createdAt:s.now}],history:[],bootstrap:true}];
  s.staffSessions ??= []; s.staffAccountRequests ??= []; s.staffAccountLog ??= []; s.organizationAuthorityHandovers ??= [];
  return s;
}
const grantTimeActive = (s,g) => (g.validFrom == null || Number.isSafeInteger(g.validFrom) && g.validFrom >= 0 && g.validFrom <= s.now) && (g.validTo == null || Number.isSafeInteger(g.validTo) && g.validTo >= 0 && g.validTo > s.now);
const unique = (rows,id) => {const found=(Array.isArray(rows)?rows:[]).filter(x=>x?.id===id);return found.length===1?found[0]:null;};
export function staffGrantCapabilities(grant) {
  const definition=STAFF_JOBS[grant?.job];
  return definition && definition.role===grant.role ? {commands:[...COMMANDS[grant.job]],routes:[...ROUTES[grant.job]],role:grant.role,job:grant.job,storeId:grant.storeId || null} : {commands:[],routes:[]};
}
export function staffGrantActive(s,account,grant) {
  const tech=account?.techId && unique(s.techs,account.techId);
  return Boolean(account?.enabled && account.employment?.status!=='ended' && (!account.techId || tech && tech.lifecycleStatus!=='left') && grant?.enabled && STAFF_JOBS[grant.job] && STAFF_JOBS[grant.job].role===grant.role && grantTimeActive(s,grant) && (grant.role!=='store' || unique(s.stores,grant.storeId)));
}
export function staffSettlementGrantLive(s,account,grant) {
  const h=unique(s.organizationAuthorityHandovers,grant?.handoverId),c=unique(s.organizationLifecycleCases,grant?.sourceCaseId);
  const basis=c&&{id:c.id,kind:c.kind,techId:c.techId||null,storeId:c.storeId||null,fromStoreId:c.fromStoreId,effectiveAt:c.effectiveAt,reference:c.reference},receipt=c?.authorityExitReceipt;
  return Boolean(staffGrantActive(s,account,grant) && account.employment?.status==='active' && h?.status==='retained' && h.accountId===account.id && h.grantId===grant.id && h.caseId===c?.id && c.kind==='store-close' && ['effective','completed'].includes(c.stage) && c.storeId===grant.storeId && h.caseSource===fingerprint(basis) && receipt?.caseId===c.id && receipt.retainedGrantIds?.includes(grant.id) && Number.isSafeInteger(receipt.at) && receipt.at<=s.now && h.retainedAt===receipt.at && grant.responsibilityAt===c.effectiveAt && h.retainedGrantSource===fingerprint(grant) && h.retainedEmploymentSource===fingerprint(account.employment));
}
export function resolveAccountActor(s,actor) {
  if (!actor?.sessionId) {
    if (actor?.accountId || actor?.grantId) fail('工作会话缺失，请从工作账号入口重新进入。');
    if (actor?.role==='tech' && unique(s.techs,actor.techId)?.lifecycleStatus==='left') fail('技师已离职，原工作身份已结束。');
    if (['store','manager'].includes(actor?.role)) {const store=unique(s.stores,actor.storeId);if(store?.lifecycleStatus==='closed'||store?.closedAt!=null)fail('门店已关闭，请使用明确承接的原事项工作账号。');}
    return actor;
  }
  const session = (s.staffSessions || []).find(x => x.id === actor.sessionId);
  if (!session || session.revokedAt != null || (session.expiresAt != null && session.expiresAt <= s.now)) fail('工作会话已失效，请退出后重新进入。');
  const account = unique(s.staffAccounts,session.accountId);
  const grant = unique(account?.grants,session.grantId);
  if (grant?.role === 'store' && !(s.stores || []).some(x => x.id === grant.storeId)) fail('授权门店不存在，原工作会话已失效。');
  if (!staffGrantActive(s,account,grant) || session.accountVersion !== account.version) fail('账号或授权已变更，原工作会话已失效。');
  const store=grant.role==='store' && unique(s.stores,grant.storeId),restricted=grant.purpose==='lifecycle-settlement';
  if (restricted && !staffSettlementGrantLive(s,account,grant) || store && (store.lifecycleStatus==='closed'||store.closedAt!=null) && !restricted) fail('原营业工作授权已结束或承接来源失效。');
  return {role:grant.role,job:grant.job,...(grant.role === 'store' ? {storeId:grant.storeId} : {}),accountId:account.id,accountName:account.name,grantId:grant.id,sessionId:session.id,...(restricted?{lifecyclePurpose:grant.purpose,lifecycleCaseId:grant.sourceCaseId,allowedCommands:clone(grant.allowedCommands),allowedRoutes:clone(grant.allowedRoutes),responsibilityAt:grant.responsibilityAt,originalBookingIds:clone(grant.originalBookingIds),originalGoodsIds:clone(grant.originalGoodsIds)}: {})};
}
export function canAccountView(actor,routeName) {
  if (!managed(actor)) return true;
  if (!actor?.accountId || !actor?.sessionId || STAFF_JOBS[actor.job]?.role !== actor.role) return false;
  return ['work-login','dashboard','home','guide'].includes(routeName) || Boolean(ROUTES[actor.job]?.includes(routeName) && (!actor.lifecyclePurpose || actor.allowedRoutes?.includes(routeName)));
}
function originalSettlementGoods(s,actor,id) {
  const original=unique(s.goods,id);
  return Boolean(original && actor.originalGoodsIds?.includes(id) && original.source?.storeId===actor.storeId && Number.isSafeInteger(original.createdAt) && original.createdAt<=actor.responsibilityAt);
}
function originalSettlementRecovery(s,actor,id) {
  const original=unique(s.recoveries,id);
  return Boolean(original && original.storeId===actor.storeId && originalSettlementGoods(s,actor,original.orderId));
}
function originalSettlementOffset(s,actor,id,billId) {
  const original=unique(s.goodsOffsetPlans,id);
  return Boolean(original && original.storeId===actor.storeId && (!billId || original.billId===billId)
    && originalSettlementSource(s,actor,'bill.confirm',{id:original.billId})
    && original.items?.length && original.items.every(i=>originalSettlementGoods(s,actor,i.orderId))
    && original.allocations?.length && original.allocations.every(a=>originalSettlementRecovery(s,actor,a.recoveryId)));
}
function originalSettlementSource(s,actor,type,p) {
  const originalBooking=id=>{const b=unique(s.bookings,id);return Boolean(b && actor.originalBookingIds?.includes(id) && b.storeId===actor.storeId && Number.isSafeInteger(b.createdAt) && b.createdAt<=actor.responsibilityAt);};
  if (type.startsWith('booking.')) return originalBooking(p.id);
  if (type.startsWith('invoice.')) return originalBooking(unique(s.serviceInvoices,p.id)?.bookingId);
  if (type.startsWith('care.case-')) return originalBooking(unique(s.serviceCareCases,p.id)?.bookingId || p.bookingId);
  if (type.startsWith('care.followup-')) return originalBooking(unique(s.serviceCareFollowups,p.id)?.bookingId || p.bookingId);
  if (type.startsWith('tech-income.')) {
    const entries=Array.isArray(p.lines) ? p.lines.map(line=>unique(s.techIncomeEntries,line.entryId)) : [];
    if (type==='tech-income.difference-record') {const d=unique(s.techIncomeDifferences,p.id);return Boolean(d && d.storeId===actor.storeId && originalBooking(d.bookingId));}
    return entries.length>0 && entries.every(e=>e?.storeId===actor.storeId && e.techId===p.techId && e.month===p.month && originalBooking(e.bookingId));
  }
  if (type.startsWith('bill.')) {
    const b=unique(s.bills,p.id||p.billId);
    if(!(b && b.storeId===actor.storeId && b.items?.length && b.items.every(i=>originalSettlementGoods(s,actor,i.orderId))))return false;
    return !type.startsWith('bill.offset-') || type==='bill.offset-propose' || originalSettlementOffset(s,actor,p.planId,b.id);
  }
  if(type.startsWith('service-extra.')){const record=[...(s.serviceRefundShortages||[]),...(s.serviceExtraOffsets||[])].find(x=>x.id===p.id);return originalBooking(record?.bookingId||p.bookingId);}
  return false;
}
// Interface affordance only. Actual writes still require their payload and source.
export function canAccountCommand(actor,type) {
  if(!actor||!['user','tech','store','manager','group'].includes(actor.role))return false;
  if (!managed(actor)) return true;
  if (!actor?.accountId || !actor?.sessionId || STAFF_JOBS[actor.job]?.role!==actor.role) return false;
  return type==='account.leave' || Boolean(COMMANDS[actor.job]?.has(type) && (!actor.lifecyclePurpose || actor.allowedCommands?.includes(type)));
}
// Use on raw source rows before producing lists, summaries or file references.
export function canAccountReadSource(s,rawActor,kind,row) {
  let actor;try{actor=resolveAccountActor(s,rawActor);}catch{return false;}
  if(!actor?.lifecyclePurpose)return true;
  if(!actor.accountId||!actor.sessionId)return false;
  const containers={booking:['bookings'],goods:['goods'],'goods-recovery':['recoveries'],'goods-offset':['goodsOffsetPlans'],invoice:['serviceInvoices'],'care-case':['serviceCareCases'],'care-followup':['serviceCareFollowups'],'tech-income':['techIncomeEntries','techIncomeAdjustments','techIncomeDifferences','techIncomePayouts'],'service-finance':['serviceFinanceEntries','serviceFinanceRecoveries'],'service-extra':['serviceExtraEvidence','serviceExtraOffsets','serviceRefundShortages','serviceExtraRecoveries'],bill:['bills']};
  const originals=(containers[kind]||[]).flatMap(name=>(s[name]||[]).filter(x=>x.id===row?.id));if(originals.length!==1)return false;
  const original=originals[0];
  if(kind==='goods')return originalSettlementGoods(s,actor,original.id);
  if(kind==='goods-recovery')return originalSettlementRecovery(s,actor,original.id);
  if(kind==='goods-offset')return originalSettlementOffset(s,actor,original.id);
  if(kind==='bill')return originalSettlementSource(s,actor,'bill.confirm',{id:original.id});
  if(kind==='tech-income'&&Array.isArray(original.lines))return originalSettlementSource(s,actor,'tech-income.payout',{techId:original.techId,month:original.month,lines:original.lines});
  return originalSettlementSource(s,actor,'booking.payment-query',{id:kind==='booking'?original.id:original.bookingId});
}
export function assertAccountCommand(actor,type,p={},s) {
  if(s)actor=resolveAccountActor(s,actor);
  if (!managed(actor)) return;
  if (!actor?.accountId || !actor?.sessionId || STAFF_JOBS[actor.job]?.role !== actor.role) fail('工作身份无效，请重新进入。');
  if (type === 'account.leave') return;
  if (!COMMANDS[actor.job]?.has(type)) fail('当前工作岗位无权执行此操作；请使用已获授权的岗位。');
  if (actor.lifecyclePurpose) {
    if (!s || !actor.allowedCommands?.includes(type) || !originalSettlementSource(s,actor,type,p)) fail('限定承接仅可办理本案原来源事项，不能使用新单、其他主体或配置操作。');
  }
}
function checkVersion(row,p) { if (!['number','string'].includes(typeof p.version) || !String(p.version).trim() || !Number.isSafeInteger(Number(p.version)) || Number(p.version) !== row.version) fail('账号资料已更新或缺少版本，请核对最新资料后重试。'); }
function by(a) { return {...actorAccountFields(a),role:a.role,job:a.role === 'group' || a.accountId ? a.job || null : null,id:a.accountId || (a.role === 'user' ? a.userId : a.role === 'tech' ? a.techId : a.role === 'group' ? 'group' : a.storeId)}; }
function revokeSessions(s,account,reason) {
  for (const session of s.staffSessions.filter(x => x.accountId === account.id && x.revokedAt == null)) {session.revokedAt=s.now;session.revokeReason=reason;}
}
function preserveAdministrator(s,id,nextEnabled,revokedGrantId) {
  const remains = s.staffAccounts.some(a => a.grants.some(g => g.job==='account-admin' && staffGrantActive(s,a.id===id?{...a,enabled:nextEnabled}:a,a.id===id&&g.id===revokedGrantId?{...g,enabled:false}:g)));
  if (!remains) fail('至少保留一个已启用的账号管理员，请先授权另一账号。');
}
function log(s,row,a,type,reason,ctx,details={}) {
  const entry={id:nextId(s,ctx,'AL'),accountId:row.id,at:s.now,action:type,reason,by:by(a),version:row.version,...clone(details)};
  row.history.push(entry); s.staffAccountLog.push(clone(entry));
  ctx?.log?.(row,`工作账号 ${type} · ${row.id}`);
}
export function accountCommand(s,rawActor,type,p={},ctx={}) {
  upgradeAccounts(s);
  if (!['account.enter','account.leave','account.create','account.grant','account.revoke','account.status','account.employment','account.handover','account.handover-accept','account.handover-cancel'].includes(type)) fail('不支持的工作账号操作。');
  const a = resolveAccountActor(s,rawActor);
  if (['account.handover','account.handover-accept','account.handover-cancel'].includes(type)) {
    if (typeof ctx.lifecycleAuthorityCommand!=='function') fail('原事项承接登记尚未接齐。');
    return ctx.lifecycleAuthorityCommand(s,a,type,p,ctx);
  }
  if (type === 'account.leave') {
    if (!a?.sessionId) fail('当前没有工作会话。');
    const session=s.staffSessions.find(x=>x.id===a.sessionId);session.revokedAt=s.now;session.revokeReason='本人退出演示工作会话';
    s.staffAccountLog.push({id:nextId(s,ctx,'AL'),accountId:a.accountId,at:s.now,action:type,by:by(a),reason:session.revokeReason});
    return {left:true,sessionId:a.sessionId};
  }
  if (type === 'account.enter' && a?.sessionId) fail('请先退出当前工作会话，再选择另一个账号或授权岗位。');
  if (type !== 'account.enter' && !admin(a)) fail('仅已进入的账号管理员可以维护工作账号。');
  const requestId=required(p.requestId,'本次操作标识'),who=type === 'account.enter' ? 'demo-entry' : a.accountId, digest=fingerprint({type,p});
  const previous=s.staffAccountRequests.find(r=>r.actor===who && r.requestId===requestId);
  if (previous) {
    if (previous.fingerprint !== digest) fail('同一提交标识不能用于不同账号操作。');
    if (type === 'account.enter') resolveAccountActor(s,{sessionId:previous.result.sessionId});
    return clone(previous.result);
  }
  let result;
  if (type === 'account.enter') {
    const account=s.staffAccounts.find(x=>x.id===p.accountId),grant=account?.grants.find(x=>x.id===p.grantId);
    if (!staffGrantActive(s,account,grant)) fail('账号或岗位未启用、已结束或不在有效期，请选择当前有效授权。');
    if (grant.role !== STAFF_JOBS[grant.job].role || (grant.role==='store' && !(s.stores || []).some(x=>x.id===grant.storeId))) fail('账号授权范围无效。');
    const store=grant.role==='store' && unique(s.stores,grant.storeId);
    if ((grant.purpose==='lifecycle-settlement' && !staffSettlementGrantLive(s,account,grant)) || store && (store.lifecycleStatus==='closed'||store.closedAt!=null) && grant.purpose!=='lifecycle-settlement') fail('原营业授权已结束或限定承接来源失效。');
    const session={id:nextId(s,ctx,'WS'),accountId:account.id,grantId:grant.id,accountVersion:account.version,issuedAt:s.now,revokedAt:null};
    s.staffSessions.push(session);result={sessionId:session.id,accountId:account.id};
    s.staffAccountLog.push({id:nextId(s,ctx,'AL'),accountId:account.id,at:s.now,action:type,by:{...actorAccountFields(resolveAccountActor(s,result)),role:grant.role,job:grant.job},reason:'显式选择本地演示账号及授权岗位',grantId:grant.id});
  } else {
    const reason=required(p.reason,'操作原因');
    if (type === 'account.create') {
      const name=required(p.name,'员工姓名或称呼',40);
      const account={id:nextId(s,ctx,'WA'),name,enabled:true,version:1,createdAt:s.now,createdBy:by(a),grants:[],history:[]};
      s.staffAccounts.push(account);log(s,account,a,type,reason,ctx);result=clone(account);
    } else {
      const account=s.staffAccounts.find(x=>x.id===p.id);if (!account) fail('工作账号不存在。');checkVersion(account,p);
      let details={};
      if (type === 'account.grant') {
        const definition=STAFF_JOBS[p.job];if (!definition) fail('请选择有效岗位；全能演示身份不能授予工作账号。');
        const storeId=definition.role === 'store' ? required(p.storeId,'授权门店',80) : null;
        if (storeId && !(s.stores || []).some(x=>x.id===storeId)) fail('授权门店不存在。');
        if (storeId) {const store=unique(s.stores,storeId);if(['closing','closed'].includes(store?.lifecycleStatus)||store?.closedAt!=null)fail('关停或关闭门店不能新增营业工作授权。');}
        if (definition.role === 'group' && p.storeId) fail('集团岗位范围为全集团，请清空门店选择。');
        if (account.grants.some(g=>g.enabled && g.job===p.job && g.storeId===storeId)) fail('该账号已有相同的有效授权。');
        const interval={};for(const key of ['validFrom','validTo']) if(p[key]!=null){if(!['number','string'].includes(typeof p[key])||!String(p[key]).trim()||!Number.isSafeInteger(Number(p[key]))||Number(p[key])<0)fail('授权生效或结束时间无效。');interval[key]=Number(p[key]);}
        if(interval.validTo!=null && interval.validTo<=(interval.validFrom??s.now))fail('授权结束须晚于生效时间。');
        const grant={id:nextId(s,ctx,'WG'),job:p.job,role:definition.role,storeId,enabled:true,createdAt:s.now,createdBy:by(a),...interval};
        account.grants.push(grant);details={grant:clone(grant)};
      } else if (type === 'account.revoke') {
        const grant=account.grants.find(x=>x.id===p.grantId);if (!grant?.enabled) fail('该岗位授权不存在或已撤销。');
        preserveAdministrator(s,account.id,account.enabled,grant.id);
        grant.enabled=false;grant.revokedAt=s.now;grant.revokedBy=by(a);details={grantId:grant.id,job:grant.job,storeId:grant.storeId};
      } else if (type==='account.employment') {
        if(!['active','ended'].includes(p.employmentStatus))fail('请选择实际在岗或结束状态。');
        const verifiedAt=Number(p.verifiedAt);if(!['number','string'].includes(typeof p.verifiedAt)||!String(p.verifiedAt).trim()||!Number.isSafeInteger(verifiedAt)||verifiedAt<0||verifiedAt>s.now)fail('在岗核验发生时间无效。');
        const reference=required(p.reference,'实际人员在岗来源');
        if(p.techId && (!unique(s.techs,p.techId)||account.techId && account.techId!==p.techId || s.staffAccounts.some(x=>x.id!==account.id&&x.techId===p.techId)))fail('技师关联来源不存在、已有关联或不能静默改绑。');
        if(p.employmentStatus==='active' && unique(s.techs,p.techId||account.techId)?.lifecycleStatus==='left')fail('已离职技师不能重新开启工作在岗状态。');
        if(p.employmentStatus==='ended' && !s.staffAccounts.some(x=>x.id!==account.id&&x.enabled&&x.employment?.status!=='ended'&&x.grants.some(g=>g.enabled&&g.job==='account-admin'&&grantTimeActive(s,g))))fail('结束人员工作前须保留其他有效账号管理员。');
        if(p.techId)account.techId=p.techId;
        account.employment={status:p.employmentStatus,reference,verifiedAt,recordedAt:s.now,by:by(a)};details={employment:clone(account.employment),techId:account.techId||null};
      } else {
        if (![true,false,'true','false'].includes(p.enabled)) fail('请选择启用或停用。');
        const enabled=p.enabled===true || p.enabled==='true';
        if (account.enabled===enabled) fail('账号已经处于该状态。');
        preserveAdministrator(s,account.id,enabled);details={before:account.enabled,after:enabled};account.enabled=enabled;
      }
      account.version++;account.updatedAt=s.now;revokeSessions(s,account,'工作账号或授权已变更');log(s,account,a,type,reason,ctx,details);result=clone(account);
    }
  }
  s.staffAccountRequests.push({requestId,actor:who,fingerprint:digest,result:clone(result),at:s.now});
  return result;
}
