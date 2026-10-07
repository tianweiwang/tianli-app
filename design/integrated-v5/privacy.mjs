// Local privacy workflow. Closing use never claims historical materials were erased.
import { captureClosedRights, assertClosedRightsCommand } from './privacy-closed-rights.mjs';
import { deactivateServicePromoter } from './service-promotion.mjs';
const clone = value => structuredClone(value);
const truth = value => value === true || value === 'true' || value === 'on';
const support = a => a?.role === 'group' && (!a.job || ['all','support'].includes(a.job));
const actorInfo = a => ({role:a.role, id:a.accountId || a.userId || a.techId || a.storeId || 'group', job:a.job || null});
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
const signature = v => JSON.stringify(canonical(v));
const fail = message => {throw new Error(message);};
const txt = (v,label,max=500) => {const x=String(v ?? '').trim();if(typeof v!=='string'||!x||x.length>max)fail(`请填写${label}（最多${max}字）`);return x;};
const userFor = (s,id) => (s.users || []).find(x=>x.id===id);
const profileFor = (s,id) => (s.privacyProfiles || []).find(x=>x.userId===id);
const version = (value,expected) => {if(typeof value==='boolean'||value==null||String(value).trim()===''||!Number.isSafeInteger(Number(value))||Number(value)!==expected)fail('隐私记录已更新或缺少版本，请刷新核对后重试');};
const newId = (s,ctx,prefix) => ctx?.id ? ctx.id(prefix) : prefix+(s.seq=(s.seq || 0)+1);
export const PRIVACY_POLICY = 'DEMO-PRIVACY-1';
export function upgradePrivacy(s) {s.privacyProfiles ??= [];s.privacyClosures ??= [];s.privacyRequests ??= [];return s;}
export function privacyProfile(s,userId) {return clone(profileFor(s,userId) || {userId,version:0,status:'active',identityConsent:null,history:[],createdAt:null});}
export function privacyUseClosed(s,userId) {
  return (s.users || []).some(x=>x.id===userId&&x.status==='closed') ||
    (s.privacyProfiles || []).some(x=>x.userId===userId&&x.status==='use_closed') ||
    (s.privacyClosures || []).some(x=>x.userId===userId&&x.status==='use_closed');
}
function ensureProfile(s,userId) {upgradePrivacy(s);let p=profileFor(s,userId);if(!p){p=privacyProfile(s,userId);p.createdAt=s.now;s.privacyProfiles.push(p);}return p;}
function audit(s,row,actor,action,ctx,details={}) {row.version++;row.updatedAt=s.now;(row.history ??= []).push({at:s.now,by:actorInfo(actor),action,...clone(details)});ctx?.log?.(row,`隐私办理 ${action} · ${row.id || row.userId}`);}
function consent(s,actor,p,ctx) {const profile=ensureProfile(s,actor.userId);profile.identityConsent={purpose:'identity',policyVersion:PRIVACY_POLICY,agreed:true,agreedAt:s.now,revokedAt:null};audit(s,profile,actor,'同意身份核验演示',ctx,{policyVersion:PRIVACY_POLICY,purpose:'identity',agreed:true,...(p.bookingRequestId?{bookingRequestId:p.bookingRequestId}:{})});return profile;}
export function assertPrivacyCommand(s,actor,type,p={}) {
  if(['account.enter','account.leave'].includes(type))return;
  if(actor?.role!=='user') return;
  if(!userFor(s,actor.userId))fail('用户不存在');
  const profile=profileFor(s,actor.userId);
  if(privacyUseClosed(s,actor.userId)) {
    const binding=assertClosedRightsCommand(s,actor,type,p);
    if(!binding)fail('账号使用已关闭，原权益关闭依据待人工核查；不能恢复普通使用');
    return binding;
  }
  if(type==='booking.create'&&p.requestId&&(s.bookings || []).some(b=>b.userId===actor.userId&&b.requestId===p.requestId))return;
  if(type==='booking.create' && (profile || Object.hasOwn(p,'privacyVersion') || Object.hasOwn(p,'privacyConsent'))){
    version(p.privacyVersion,profile?.version || 0);
    if(!truth(p.privacyConsent))fail('请在原预约确认步骤明确同意本次身份核验演示；旧草稿不能恢复已撤回授权');
  }
}
export function captureBookingPrivacy(s,actor,p={},ctx) {
  if(p.requestId&&profileFor(s,actor.userId)?.history?.some(x=>x.bookingRequestId===p.requestId))return privacyProfile(s,actor.userId);
  assertPrivacyCommand(s,actor,'booking.create',p);
  if(!Object.hasOwn(p,'privacyVersion')&&!Object.hasOwn(p,'privacyConsent'))return null;
  version(p.privacyVersion,privacyProfile(s,actor.userId).version);if(!truth(p.privacyConsent))fail('请明确同意本次身份核验演示');
  return consent(s,actor,{bookingRequestId:p.requestId},ctx);
}
export function privacyBlockers(s,userId,role='user') {
  const out=[], add=(code,id,label,path)=>out.push({code,id,label,path});
  const bookingPath=id=>`/${role}/${role==='user'?'booking':'bookings'}/${encodeURIComponent(id)}`;
  const bookings=(s.bookings || []).filter(b=>b.userId===userId), ids=new Set(bookings.map(b=>b.id));
  for(const b of bookings){
    const path=bookingPath(b.id);
    if(!['done','cancelled','closed'].includes(b.status))add('booking',b.id,'预约尚未结束',path);
    if([b.payment,...(b.extensions || [])].some(p=>p?.status==='processing'))add('payment',b.id,'预约支付结果待核查',path);
    if((b.refunds || []).some(r=>['requested','offered','approved','processing','failed','escalated'].includes(r.status)||(r.status==='rejected'&&r.deadline)||(!['withdrawn','closed','rejected'].includes(r.status)&&(r.executions || []).some(e=>e.amountCents>0&&['approved','processing','failed'].includes(e.status)))))add('refund',b.id,'预约退款或售后尚未办结',path);
    if((b.disputes || []).some(d=>!['resolved','closed'].includes(d.status)))add('dispute',b.id,'服务争议尚未结案',path);
  }
  for(const h of s.safety || [])if(ids.has(h.bookingId)&&(h.status!=='closed'||(h.unresolvedDispute&&!bookings.find(b=>b.id===h.bookingId)?.disputes?.some(d=>d.safetyId===h.id||d.id===h.disputeId))))add('safety',h.id,'安全事项或后续争议待核对',bookingPath(h.bookingId));
  for(const c of s.serviceCareCases || [])if(ids.has(c.bookingId)&&!['closed','withdrawn'].includes(c.status))add('care',c.id,'质量反馈尚未办结',`/${role}/care/case/${encodeURIComponent(c.id)}`);
  for(const r of s.serviceReviews || [])if(r.userId===userId&&['store_pending','group_pending'].includes(r.appeal?.status))add('review',r.id,'评价申诉正在核实，需先完成人工处理',`/${role}/reviews/${encodeURIComponent(r.id)}`);
  for(const o of (s.goods || []).filter(o=>o.userId===userId)){
    const path=`/${role}/goods/${encodeURIComponent(o.id)}`;
    if(!['received','cancelled','closed'].includes(o.status))add('goods',o.id,'商品履约尚未结束',path);
    if(o.payment?.status==='processing')add('goods-payment',o.id,'商品支付结果待核查',path);
    if((o.cases || []).some(c=>!['rejected','done','closed'].includes(c.status))||(o.refunds || []).some(r=>!['success','closed','withdrawn'].includes(r.status)))add('goods-case',o.id,'商品售后、退货或退款尚未办结',path);
    for(const incident of o.incidents || [])if(incident.status!=='done')add('goods-incident',incident.id,'商品异常或本人处理方案尚未办结',path);
  }
  for(const i of s.serviceInvoices || [])if(i.userId===userId&&['pending','red_pending'].includes(i.status))add('invoice',i.id,'发票开具或红冲尚未完成',role==='group'?bookingPath(i.bookingId):`/${role}/invoices/${encodeURIComponent(i.id)}`);
  for(const i of s.commerceInvoices || [])if(i.category==='goods'&&i.userId===userId&&!i.replacedById&&['pending','red_pending'].includes(i.status)&&(s.goods || []).some(o=>o.id===i.orderId&&o.userId===userId))add('goods-invoice',i.id,'商品发票开具或红冲尚未完成',role==='group'?`/group/goods/${encodeURIComponent(i.orderId)}`:`/${role}/commodity-invoices/${encodeURIComponent(i.id)}`);
  for(const issue of s.serviceRefundShortages || []){
    const b=bookings.find(b=>b.id===issue.bookingId);if(!b||issue.userId!==userId||issue.storeId!==b.storeId)continue;
    const part=b.refunds?.find(r=>r.id===issue.refundId)?.executions?.find(x=>x.paymentId===issue.paymentId&&x.refundNo===issue.refundNo&&x.amountCents===issue.refundCents);
    const unknown=(b.refunds || []).some(r=>r.executions?.some(x=>x.status==='processing')||r.status==='processing'&&!r.executions?.length);
    for(const advance of issue.advances || []){
      if(advance.path!=='direct-user')continue;
      if(advance.execution?.status==='processing')add('direct-refund-query',advance.id,'本人直接退款结果尚未核查',bookingPath(b.id));
      else if(advance.status==='needs-review'&&advance.execution?.status==='success')add('direct-refund-review',advance.id,'本人直接退款与原退款的重复款尚未核清',bookingPath(b.id));
      else if(advance.status==='awaiting_user'&&part?.status==='failed'&&!unknown)add('direct-refund-confirm',advance.id,'本人直接退款方案尚未确认',bookingPath(b.id));
    }
  }
  return out;
}
function retention(s,userId,custodian){
  const bookings=(s.bookings || []).filter(x=>x.userId===userId),ids=new Set(bookings.map(x=>x.id).filter(Boolean));
  const goods=(s.goods || []).filter(x=>x.userId===userId),goodsIds=new Set(goods.map(x=>x.id).filter(Boolean));
  const related=x=>ids.has(x.bookingId), invoices=(s.commerceInvoices || []).filter(x=>x.category==='goods'&&x.userId===userId&&goodsIds.has(x.orderId));
  const fulfilment=[...(s.fulfilmentRecords || []),...(s.fulfilmentDepartures || []),...(s.fulfilmentNotices || [])].filter(related);
  const extras=[...(s.serviceExtraEvidence || []),...(s.serviceRefundShortages || []),...(s.serviceExtraRecoveries || []),...(s.serviceExtraOffsets || [])].filter(related);
  const sourceIds=rows=>new Set(rows.flat().map(x=>x?.id).filter(Boolean));
  const sources={
    dispatch:sourceIds(bookings.flatMap(b=>[b.round,...(b.rounds || [])])),change:sourceIds(bookings.flatMap(b=>[b.change,...(b.changeHistory || [])])),
    assistance:sourceIds(bookings.flatMap(b=>b.assistance || [])),dispute:sourceIds(bookings.flatMap(b=>b.disputes || [])),
    refund:new Set(bookings.flatMap(b=>(b.refunds || []).flatMap(r=>(r.executions || []).map(x=>x.refundNo||`${r.id}:${x.paymentId}`)))),
    safety:sourceIds((s.safety || []).filter(related)),care:sourceIds((s.serviceCareCases || []).filter(related)),followup:sourceIds((s.serviceCareFollowups || []).filter(related)),
    invoice:sourceIds((s.serviceInvoices || []).filter(x=>x.userId===userId)),
    'goods-shipping':goodsIds,'goods-aftersale':sourceIds(goods.flatMap(o=>o.cases || [])),'goods-exception':sourceIds(goods.flatMap(o=>o.incidents || [])),
    'goods-logistics':sourceIds(goods.flatMap(o=>[o,...(o.goodsDeliveryFacts || []),o.shipment,...(o.cases || []).flatMap(c=>[c,c.returnShipment,c.backShipment])])),
    fulfilment:sourceIds((s.fulfilmentRecords || []).filter(related).flatMap(r=>r.facts || [])),'safe-departure':sourceIds((s.fulfilmentDepartures || []).filter(related)),
    'service-extra-evidence':sourceIds(extras.filter(x=>(s.serviceExtraEvidence || []).includes(x))),
    'service-extra-shortage':sourceIds(extras.filter(x=>(s.serviceRefundShortages || []).includes(x))),
    'service-extra-recovery':sourceIds(extras.filter(x=>(s.serviceExtraRecoveries || []).includes(x))),
    'service-extra-offset':sourceIds(extras.filter(x=>(s.serviceExtraOffsets || []).includes(x)))
  };
  const work=(s.workEscalations || []).filter(x=>sources[x.sourceSnapshot?.category]?.has(x.sourceSnapshot?.sourceId));
  const invoiceIds=sourceIds(invoices),fulfilmentIds=sourceIds(fulfilment),extraIds=sourceIds(extras),workIds=sourceIds(work),exceptionIds=sourceIds(goods.flatMap(o=>[o,...(o.cases || []),...(o.incidents || [])]));
  const requestCount=(s.commerceInvoiceRequests || []).filter(x=>invoiceIds.has(x.resultId)).length+(s.fulfilmentRequests || []).filter(x=>ids.has(x.result?.bookingId)||fulfilmentIds.has(x.result?.id)).length+(s.serviceExtraRequests || []).filter(x=>extraIds.has(x.id)).length+(s.workEscalationRequests || []).filter(x=>workIds.has(x.result?.id)).length+(s.goodsExceptionRequests || []).filter(x=>exceptionIds.has(x.id)).length;
  const personalPromoters=(s.servicePromoters || []).filter(x=>x.personKind==='user'&&x.personId===userId),personalPromoterIds=sourceIds(personalPromoters);
  const personalRows=[...personalPromoters,...(s.servicePromotionInvites || []).filter(x=>x.userId===userId),...(s.serviceCommissions || []).filter(x=>x.personKey===`user:${userId}`||personalPromoterIds.has(x.promoterId)),...(s.servicePromotionWithdrawals || []).filter(x=>x.personKey===`user:${userId}`||x.personKind==='user'&&x.personId===userId),...(s.servicePromotionRecoveries || []).filter(x=>x.personKey===`user:${userId}`||personalPromoterIds.has(x.promoterId))];
  const customerRows=[...(s.serviceCommissions || []).filter(x=>x.userId===userId),...(s.servicePromotionFirsts || []).filter(x=>x.userId===userId),...(s.servicePromotionRisks || []).filter(x=>x.userId===userId||ids.has(x.bookingId))];
  const careRows=(s.serviceCareCases || []).filter(related),careIds=sourceIds(careRows);
  const carePhotos=careRows.flatMap(row=>[...(row.evidenceRefs || []),...(row.statements || []).flatMap(x=>x.evidenceRefs || [])]);
  const careRequests=(s.serviceCareRequests || []).filter(x=>careIds.has(x.resultId));
  const promotionIds=sourceIds([...personalRows,...customerRows]);
  const promotionRequests=(s.servicePromotionRequests || []).filter(x=>promotionIds.has(x.result?.id)).length;
  const subject=userFor(s,userId),customerSnapshots=bookings.reduce((n,b)=>n+(b.servicePromotionSnapshot?1:0)+(b.extensions || []).filter(x=>x.servicePromotionSnapshot).length,0)+(subject?.serviceBinding?1:0)+(subject?.serviceBindingHistory || []).length;
  return [
    {kind:'service',label:'预约交易、原联系人快照与履约材料',count:bookings.length},
    {kind:'goods',label:'商品交易、收货快照与售后材料',count:goods.length},
    {kind:'invoices',label:'发票资料、修改历史及独立保存的附件',count:(s.serviceInvoices || []).filter(x=>x.userId===userId).length},
    {kind:'handoffs',label:'服务对象历史、交接与已确认事项',count:(s.serviceHandoffs || []).filter(x=>x.userId===userId||ids.has(x.bookingId)).length+(s.recipients || []).filter(x=>x.userId===userId).length},
    {kind:'support',label:'评价、反馈、安全事项与处理记录',count:[...(s.serviceReviews || []),...(s.serviceCareCases || []),...(s.serviceCareFollowups || []),...(s.safety || [])].filter(x=>x.userId===userId||ids.has(x.bookingId)).length},
    {kind:'care-evidence',label:'原投诉与补充图片、独立文件及共享引用待核',count:carePhotos.length},
    {kind:'care-evidence-requests',label:'原投诉图片提交去重副本及各标签页未提交图片引用待核',count:careRequests.length},
    {kind:'commerce-invoices',label:'商品发票、原票红冲及补传历史与附件',count:invoices.length},
    {kind:'fulfilment',label:'实际履约、内部位置、安全离开及通知记录',count:fulfilment.length},
    {kind:'goods-facts',label:'商品异常、送达核实及收货地址更正历史',count:goods.reduce((n,o)=>n+(o.incidents || []).length+(o.goodsDeliveryFacts || []).length+(o.addressHistory || []).length,0)},
    {kind:'service-extras',label:'特殊服务资金依据、本人直接款与关联追收材料',count:extras.length},
    {kind:'work-escalations',label:'关联事项责任升级、接管及办理历史',count:work.length},
    {kind:'source-requests',label:'上述来源的提交去重及请求副本',count:requestCount},
    {kind:'service-personal-promotion',label:'本人个人服务推广身份、核验历史、原佣金、提现及扣回材料',count:personalRows.length},
    {kind:'service-customer-promotion',label:'本人作为客户的服务归属快照、首单与佣金来源；款项仍属原推广个人',count:customerRows.length+customerSnapshots},
    {kind:'service-promotion-requests',label:'关联服务推广提交去重副本及原文件共享引用待核',count:promotionRequests},
    {kind:'audit',label:'授权、操作、请求去重记录及各标签页缓存',count:null}
  ].filter(x=>x.count===null||x.count>0).map(x=>({...x,status:'pending_review',custodian,basis:null,deadline:null,reviewNote:'人工暂存待核对范围、最终依据与期限；尚未执行清理'}));
}
function closureView(s,closure){
  const result=clone(closure);if(closure.status!=='use_closed')return result;
  const original=closure.retention || [], supplements=retention(s,closure.userId,closure.custodian).filter(x=>x.count!==null&&!original.some(old=>old.kind===x.kind&&old.count===x.count)).map(x=>({...x,sourceKind:x.kind,kind:'current-'+x.kind,label:x.label+'（当前来源补充核查）',reviewScope:'current-linked-sources'}));
  result.retentionSnapshot=clone(original);result.retentionSupplements=supplements;result.retention=[...clone(original),...supplements];return result;
}
export function privacyData(s,actor){
  if(actor?.role==='user'&&userFor(s,actor.userId))return {profile:privacyProfile(s,actor.userId),closures:(s.privacyClosures || []).filter(x=>x.userId===actor.userId).map(x=>closureView(s,x)),blockers:privacyBlockers(s,actor.userId),canHandle:false};
  if(support(actor))return {profile:null,closures:(s.privacyClosures || []).map(x=>({...closureView(s,x),blockers:privacyBlockers(s,x.userId,'group')})),blockers:[],canHandle:true};
  return null;
}
export function privacyCommand(s,actor,type,p={},ctx) {
  const commands=['privacy.consent','privacy.withdraw','privacy.request','privacy.retract','privacy.close','privacy.followup'];
  if(!commands.includes(type))fail('不支持的隐私操作');
  const staff=['privacy.close','privacy.followup'].includes(type);
  if(staff?!support(actor):actor?.role!=='user'||!userFor(s,actor.userId))fail('当前身份无权办理此隐私事项');
  if(!staff)assertPrivacyCommand(s,actor,type,p);
  upgradePrivacy(s);
  const requestId=txt(p.requestId,'本次提交标识',300),who=signature(actorInfo(actor)),fingerprint=signature({type,p});
  const previous=s.privacyRequests.find(x=>x.requestId===requestId&&x.actor===who);
  if(previous){if(previous.fingerprint!==fingerprint)fail('同一提交标识不能用于不同隐私操作或内容');return previous.kind==='closure'?s.privacyClosures.find(x=>x.id===previous.id):profileFor(s,previous.id);}
  let result,kind='profile';
  if(['privacy.consent','privacy.withdraw'].includes(type)){
    const old=privacyProfile(s,actor.userId);version(p.version,old.version);
    if(p.purpose&&p.purpose!=='identity')fail('当前仅支持身份核验演示授权；其他用途须按独立流程确认');
    if(type==='privacy.consent'){
      if(!truth(p.agreed))fail('请明确勾选身份核验演示授权');
      result=consent(s,actor,p,ctx);
    }else{
      const reason=txt(p.reason,'撤回原因',300);result=ensureProfile(s,actor.userId);
      result.identityConsent={purpose:'identity',policyVersion:result.identityConsent?.policyVersion || PRIVACY_POLICY,agreed:false,agreedAt:result.identityConsent?.agreedAt || null,revokedAt:s.now};
      audit(s,result,actor,'撤回身份核验演示授权',ctx,{purpose:'identity',reason,agreed:false});
    }
  }else if(type==='privacy.request'){
    const profile=privacyProfile(s,actor.userId);version(p.version,profile.version);
    if(!truth(p.acknowledged))fail('请确认已阅读使用关闭、必要保留和待清理说明');
    if(s.privacyClosures.some(x=>x.userId===actor.userId&&x.status==='requested'))fail('已有待办理的申请，请先查看或撤回');
    const reason=txt(p.reason,'申请说明',300);
    result={id:newId(s,ctx,'PC'),userId:actor.userId,status:'requested',version:1,createdAt:s.now,reason,history:[{at:s.now,by:actorInfo(actor),action:'用户提交使用关闭申请'}],retention:[],followups:[]};
    s.privacyClosures.push(result);audit(s,ensureProfile(s,actor.userId),actor,'提交使用关闭申请',ctx,{closureId:result.id});kind='closure';
  }else{
    result=s.privacyClosures.find(x=>x.id===p.id);
    if(!result||(!staff&&result.userId!==actor.userId))fail('申请不存在或无权办理');
    version(p.version,result.version);kind='closure';
    if(type==='privacy.retract'){
      if(result.status!=='requested')fail('仅待办理申请可以撤回');
      const reason=txt(p.reason,'撤回申请原因',300);result.status='retracted';audit(s,result,actor,'用户撤回申请',ctx,{reason});audit(s,ensureProfile(s,result.userId),actor,'撤回使用关闭申请',ctx,{closureId:result.id});
    }else if(type==='privacy.close'){
      if(result.status!=='requested')fail('当前申请已处理');
      const blockers=privacyBlockers(s,result.userId,'group');if(blockers.length)fail('尚有未结事项：'+blockers.map(x=>`${x.label} ${x.id}`).join('；'));
      const reason=txt(p.reason,'办理依据与说明'),custodian=txt(p.custodian,'后续清理负责人',100);
      if(!truth(p.acknowledged))fail('请确认本次只关闭使用并清理基础资料，历史材料与附件仍待处理');
      result.rights=captureClosedRights(s,result.userId,s.now);
      for(const promoter of s.servicePromoters || [])if(promoter.personKind==='user'&&promoter.personId===result.userId)deactivateServicePromoter(s,promoter.id,'账号使用关闭，原资金权益保留',ctx,actor,false);
      result.retention=retention(s,result.userId,custodian);result.status='use_closed';result.closedAt=s.now;result.custodian=custodian;result.basis=reason;result.cleanupStatus='pending_review';
      const profile=ensureProfile(s,result.userId);profile.status='use_closed';profile.identityConsent={...(profile.identityConsent || {}),purpose:'identity',agreed:false,revokedAt:s.now};audit(s,profile,actor,'账号使用关闭，历史材料待清理',ctx,{closureId:result.id});
      const user=userFor(s,result.userId);user.name='已关闭用户';for(const key of ['phone','phone_enc','openid','unionid','realName','identityNumber'])delete user[key];user.status='closed';
      s.addresses=(s.addresses || []).filter(x=>x.userId!==result.userId);if(s.carts)delete s.carts[result.userId];if(s.promotions)delete s.promotions[result.userId];
      for(const r of s.recipients || [])if(r.userId===result.userId){r.active=false;r.name='已停用对象';r.relationship='';r.version=(r.version || 0)+1;r.updatedAt=s.now;r.privacyClosedAt=s.now;}
      result.cleared=['用户基础称呼与联系方式','本人收货地址簿','购物车与未下单推广来源','服务对象当前称呼与关系及未来使用'];
      audit(s,result,actor,'使用关闭，基础资料已清理，历史材料待处理',ctx,{reason,custodian});
    }else{
      if(result.status!=='use_closed')fail('使用关闭后才能补充清理跟进记录');
      const note=txt(p.note,'处理进度与实际结果',1000),custodian=txt(p.custodian,'后续清理负责人',100);
      result.followups.push({at:s.now,by:actorInfo(actor),note,custodian,status:'pending_review'});result.custodian=custodian;
      audit(s,result,actor,'补充待清理进度',ctx); // No command pretends to finish unverified physical cleanup.
    }
  }
  s.privacyRequests.push({requestId,actor:who,fingerprint,kind,id:kind==='closure'?result.id:result.userId,at:s.now});return result;
}
