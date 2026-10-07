// Pure internal inventory. No value in this directory authorizes deletion.
import { lifecycleFingerprint } from './organization-lifecycle-projection.mjs';
import { closedRightsView, closedRightsBinding } from './privacy-closed-rights.mjs';
import { resolveAccountActor, canAccountView } from './staff-accounts.mjs';
import { serviceFinanceTaskBinding } from './service-finance-tasks.mjs';
import { qualityPolicyStream } from './quality-policy.mjs';
const hash = value => lifecycleFingerprint(value);
const rows = (s, key) => Array.isArray(s?.[key]) ? s[key] : [];
const operational = new Set(['privacyUploadReservations', 'privacyCleanupPolicies', 'privacyCleanupPolicySources']);
const refPattern = /invoice-file:[a-f0-9]{64}|media:[a-zA-Z0-9-]+/g;
const unique = (list, id, label) => { const found = list.filter(x => x?.id === id); if (!id || found.length !== 1) throw Error(label + '不存在或不唯一'); return found[0]; };
const pathKey = parts => JSON.stringify(parts);
const time = n => Number.isSafeInteger(n) && n >= 0;
const privateKeys = new Set(['name','contactName','phone','phone_enc','phoneMasked','realName','identityNumber','openid','unionid','province','city','district','detail','attention','preference','relationship','description','evidence','publicReply','internalNote','text','note','reason','location','latitude','longitude','lat','lng','title','taxNo','taxId','email','reference','proof','observation','nextAdvice','conclusion','assessor','batch','intakeReason','disableReason','rejectReason','completionReason']);
const requestKeys = new Set(['fingerprint','requestSignature','signature','actor','actorDigest','actorKey']);
const personalPromotion = new Set(['servicePromoters','servicePromotionInvites','serviceCommissions','servicePromotionWithdrawals','servicePromotionRecoveries','servicePromotionOffsets']);
const techPersonal = new Set(['techs','techQualifications','techIncomeEntries','techIncomeDifferences','techIncomeAdjustments','techIncomePayouts','organizationIdentityLinks','organizationLifecycleCases']);
const relationKeys = {bookingId:['bookings'],orderId:['goods'],promoterId:['servicePromoters'],commissionId:['serviceCommissions'],recipientId:['recipients'],invoiceId:['serviceInvoices'],reviewId:['serviceReviews'],accessId:['sensitiveAccessLogs'],profileId:['techQualifications'],differenceId:['techIncomeDifferences'],paymentId:['bookings.payment','bookings.extensions','goods.payment'],refundId:['bookings.refunds','goods.refunds'],sourceBookingId:['bookings'],sourceNoteId:['serviceHandoffs.notes']};
const children = {bookings:['payment','extensions','refunds','rounds','round','change','changeHistory','assistance','disputes'],goods:['payment','cases','refunds','incidents','goodsDeliveryFacts','shipment'],fulfilmentRecords:['facts'],serviceHandoffs:['notes'],serviceRefundShortages:['advances'],techQualifications:['assessments','grants','holds'],techIncomeDifferences:['records']};
const requestSources = {
  serviceInvoiceRequests:['serviceInvoices'],commerceInvoiceRequests:['commerceInvoices'],serviceCareRequests:['serviceCareCases','serviceCareFollowups'],serviceReviewRequests:['serviceReviews'],handoffRequests:['recipients','bookings'],sensitiveAccessRequests:['sensitiveAccessLogs'],
  techIncomeRequests:['techIncomeEntries','techIncomeDifferences','techIncomeDifferences.records','techIncomeAdjustments','techIncomePayouts','techIncomeRules'],fulfilmentRequests:['fulfilmentRecords','fulfilmentRecords.facts','fulfilmentDepartures','fulfilmentNotices'],serviceExtraRequests:['serviceExtraEvidence','serviceRefundShortages','serviceRefundShortages.advances','serviceExtraRecoveries','serviceExtraOffsets'],workEscalationRequests:['workEscalations'],
  goodsExceptionRequests:['goods','goods.cases','goods.incidents','goods.goodsDeliveryFacts'],goodsSettlementRequests:['bills','goodsOffsetPlans','recoveries'],servicePromotionRequests:['servicePromoters','servicePromotionInvites','serviceCommissions','servicePromotionWithdrawals','servicePromotionRecoveries','servicePromotionOffsets','servicePromotionRisks','servicePromotionFirsts','users'],techQualificationRequests:['techQualifications','techQualifications.assessments','techQualifications.grants','techQualifications.holds'],technicianPenaltyRequests:['technicianPenalties'],organizationLifecycleRequests:['organizationLifecycleCases','organizationIdentityLinks'],privacyRequests:['privacyClosures','privacyProfiles','users'],serviceFinanceRequests:['serviceFinanceEntries','serviceFinanceRecoveries']
};
const taskSources = {dispatch:['bookings.rounds','bookings.round'],change:['bookings.change','bookings.changeHistory'],assistance:['bookings.assistance'],dispute:['bookings.disputes'],safety:['safety'],care:['serviceCareCases'],followup:['serviceCareFollowups'],invoice:['serviceInvoices'],'goods-shipping':['goods'],'goods-aftersale':['goods.cases'],'goods-exception':['goods.incidents'],'goods-logistics':['goods','goods.goodsDeliveryFacts','goods.shipment','goods.cases'],fulfilment:['fulfilmentRecords.facts'],'safe-departure':['fulfilmentDepartures'],'service-extra-evidence':['serviceExtraEvidence'],'service-extra-shortage':['serviceRefundShortages'],'service-extra-recovery':['serviceExtraRecoveries'],'service-extra-offset':['serviceExtraOffsets'],'technician-penalty-appeal':['technicianPenalties']};
const invoiceRequestTypes=new Set(['apply','resubmit','reapply','issue','reject','red','replace-file'].map(x=>'invoice.'+x));
const commerceRequestTypes=new Set(['rule-publish','apply-goods','apply-fee','resubmit','reapply','issue','reject','red','replace-file'].map(x=>'commerce-invoice.'+x));
function requestDigest(container,key,value,record) {
  if(typeof value!=='string')return false;
  if(['serviceInvoiceRequests','commerceInvoiceRequests'].includes(container))return key==='fingerprint'&&record?.digestVersion===1&&record.digestAlgorithm==='SHA-256'&&(container==='serviceInvoiceRequests'?invoiceRequestTypes:commerceRequestTypes).has(record.type)&&/^sha256:[a-f0-9]{64}$/.test(value);
  if(['organizationLifecycleRequests','technicianPenaltyRequests'].includes(container)&&['signature','actorKey'].includes(key)&&/^sha256:[a-f0-9]{64}$/.test(value))return true;
  return record?.digestAlgorithm==='SHA-256'&&['fingerprint','actorDigest'].includes(key)&&/^[a-f0-9]{64}$/.test(value);
}

// This is a source directory, not a permission or mutation adapter. Relations
// use original typed IDs; names, the current store, and booking.techId never
// establish an ordinary user's technician identity.
function sourceDirectory(s,userId) {
  const nodes=[],index=new Map(),issues=[],techOwners=new Map();
  const add=(container,row,path,parent=null,allowArray=false)=>{if(!row||typeof row!=='object'||Array.isArray(row)&&!allowArray)return;const node={container,row,path,parent};nodes.push(node);if(typeof row.id==='string'&&row.id){const key=container+'\0'+row.id;index.set(key,[...(index.get(key)||[]),node]);}return node;};
  for(const [container,list] of Object.entries(s)) {
    if(['carts','promotions'].includes(container)&&list&&typeof list==='object'&&!Array.isArray(list)){for(const [owner,value] of Object.entries(list)){const node=add(container,value,[container,owner],null,true);if(node)node.subjectUserId=owner;}continue;}
    if(!Array.isArray(list)||operational.has(container)||/requests$/i.test(container))continue;
    for(const [i,row] of list.entries()) {const node=add(container,row,[container,i]);if(!node)continue;
      for(const key of children[container]||[]) {const value=row[key],parts=Array.isArray(value)?value.map((x,j)=>[x,j]):value?[[value,null]]:[];
        for(const [child,j] of parts){if(key==='round'&&(row.rounds||[]).some(x=>x.id===child.id))continue;const nested=add(container+'.'+key,child,[...node.path,key,...(j===null?[]:[j])],node);
          if(nested&&container==='goods'&&key==='cases')for(const field of ['returnShipment','backShipment'])if(child[field])add('goods.cases.'+field,child[field],[...nested.path,field],nested);
        }
      }
    }
  }
  const locate=(containers,id)=>containers.flatMap(key=>index.get(key+'\0'+id)||[]);
  for(const t of rows(s,'techs')) {
    const linked=rows(s,'organizationIdentityLinks').filter(x=>x.techId===t.id),candidates=new Set([t.userId,...linked.map(x=>x.userId)].filter(Boolean));
    const ownerId=[...candidates][0],duplicate=rows(s,'techs').filter(x=>x.id===t.id).length!==1,mapped=rows(s,'techs').filter(x=>x.userId===ownerId||rows(s,'organizationIdentityLinks').some(l=>l.userId===ownerId&&l.techId===x.id));
    let reason=!candidates.size?'技师原本人持久映射未定位，不把客户当资金owner':duplicate||mapped.length!==1||candidates.size!==1||rows(s,'users').filter(u=>u.id===ownerId).length!==1?'技师本人持久来源重复、缺失或冲突':null;
    if(linked.length||t.identityLinkId!=null) {const l=linked[0],a=l?.createdBy;
      if(linked.length!==1||rows(s,'organizationIdentityLinks').filter(x=>x.userId===ownerId).length!==1||!l||l.userId!==ownerId||t.identityLinkId!=null&&t.identityLinkId!==l.id||typeof l.reference!=='string'||!l.reference.trim()||!time(l.occurredAt)||!time(l.createdAt)||l.occurredAt>l.createdAt||l.createdAt>s.now||a?.role!=='group'||a?.job!=='account-admin'||!a.accountId)reason='技师本人映射缺少唯一原核验来源/时间/作者';
    } else if(t.userId!==ownerId)reason='技师本人原来源缺失';
    techOwners.set(t.id,{userIds:[...candidates],reason});
  }
  const memo=new Map(),resolving=new Set();
  function resolve(node) {
    if(memo.has(node))return memo.get(node);
    if(resolving.has(node))return {relations:[],blockers:['原来源关系循环待核对']};resolving.add(node);
    const r=node.row,relations=[],blockers=[],top=node.container.split('.')[0];
    if(top==='qualityPolicies'){
      // A policy's subject enum is a group rule category, never a user ID.
      // The original getter validates its complete publication/request chain.
      try{qualityPolicyStream(s,r.scope);}catch{blockers.push('原质量政策发布/撤回及请求来源不完整，不能推定资料主体');}
      const result={relations,blockers};resolving.delete(node);memo.set(node,result);return result;
    }
    if(top!=='logs'&&r.id!=null&&(index.get(node.container+'\0'+r.id)||[]).length!==1)blockers.push('原来源容器内编号重复，不能确认唯一原事实');
    const addRelation=(id,role,basis)=>{if(typeof id==='string'&&id)relations.push({userId:id,role,basis});};
    const merge=(other,basis)=>{for(const rel of other.relations)relations.push({...rel,basis:basis+'→'+rel.basis});blockers.push(...other.blockers);};
    function link(containers,id,key) {if(id==null||id===''||key==='recipientId'&&id==='visit')return;const found=locate(containers,id);if(found.length!==1){blockers.push(key+'原来源缺失或不唯一');return;}merge(resolve(found[0]),key);}
    if(node.parent)merge(resolve(node.parent),'原嵌套来源');
    if(top==='users')addRelation(r.id,'account','users.id');
    else if(typeof r.userId==='string')addRelation(r.userId,top==='organizationIdentityLinks'?'identity':'customer',top+'.userId');
    if(node.subjectUserId)addRelation(node.subjectUserId,'account',top+'原userId目录key');
    if(top==='logs') {const sources=nodes.filter(x=>x.container!=='logs'&&x.row.id===r.id);if(sources.length===1)merge(resolve(sources[0]),'原log.entity.id');else blockers.push('原日志entity.id缺失或跨域不唯一，不能猜来源');if(r.actor==='user')addRelation(r.actorId,'event-author','原log.actor/actorId');}
    if(personalPromotion.has(top)) {
      if(r.personKind==='user')addRelation(r.personId,'personal-owner','personKind/personId');
      if(typeof r.personKey==='string'&&r.personKey.startsWith('user:'))addRelation(r.personKey.slice(5),'personal-owner','personKey');
      if(r.personKind==='tech'||typeof r.personKey==='string'&&r.personKey.startsWith('tech:')){const id=r.personKind==='tech'?r.personId:r.personKey.slice(5),owner=techOwners.get(id);if(owner){for(const uid of owner.userIds)addRelation(uid,'technician-owner','持久技师本人');if(owner.reason)blockers.push(owner.reason);}else blockers.push('原tech个人owner来源缺失');}
    }
    if(techPersonal.has(top)||top==='technicianPenalties') {const id=top==='techs'?r.id:r.techId,owner=techOwners.get(id);if(owner){for(const uid of owner.userIds)addRelation(uid,'technician-owner','持久技师本人');if(owner.reason)blockers.push(owner.reason);}else if(id!=null)blockers.push('原tech个人owner来源缺失');}
    for(const [key,containers] of Object.entries(relationKeys))if(Object.hasOwn(r,key))link(containers,r[key],key);
    if(r.entryId!=null)link(top.startsWith('techIncome')?['techIncomeEntries']:['serviceFinanceEntries'],r.entryId,'entryId');
    if(r.recoveryId!=null)link(top==='servicePromotionOffsets'?['servicePromotionRecoveries']:top==='serviceExtraOffsets'?['serviceExtraRecoveries']:['recoveries'],r.recoveryId,'recoveryId');
    if(r.caseId!=null)link(top.startsWith('service')||top==='technicianPenalties'?['serviceCareCases']:['goods.cases'],r.caseId,'caseId');
    if(top==='techIncomePayouts')for(const line of r.lines||[])link(['techIncomeEntries'],line.entryId,'payout.line.entryId');
    if(['bills','goodsOffsetPlans'].includes(top))for(const line of r.items||[])link(['goods'],line.orderId,'goods-bill.item.orderId');
    if(top==='servicePromotionWithdrawals')for(const allocation of r.allocations||[])link(['serviceCommissions'],allocation.commissionId,'withdrawal.allocation.commissionId');
    if(top==='workEscalations') {
      const src=r.sourceSnapshot;
      if(['service-finance-entry','service-finance-recovery'].includes(src?.category)){
        const recovery=src.category==='service-finance-recovery',container=recovery?'serviceFinanceRecoveries':'serviceFinanceEntries',found=locate([container],src.sourceId),row=found.length===1?found[0].row:null;
        // Even inconsistent roots remain located with blockers; no record is
        // silently dropped or granted a cleanup decision by this directory.
        link([container],src.sourceId,'sourceSnapshot.sourceId');
        const original=row&&serviceFinanceTaskBinding(s,recovery?row.entryId:row.id,recovery?{recoveryId:row.id}:{}),taskId='service-finance:'+(recovery?'recovery:':'entry:')+src.sourceId;
        if(!original||r.id!==taskId||src.taskId!==taskId||src.storeId!==original.storeId)blockers.push('原普通服务事项与唯一entry/booking/payment/store来源不一致');
      }else{const containers=taskSources[src?.category];if(!containers)blockers.push('原专项category未知，不能猜root');else link(containers,src.sourceId,'sourceSnapshot.sourceId');}
    }
    const personal=new Set(relations.filter(x=>x.role==='personal-owner'||x.role==='technician-owner').map(x=>x.userId));
    for(const [key,container] of [['bookingId','bookings'],['orderId','goods']])if(r.userId!=null&&r[key]!=null){const roots=locate([container],r[key]);if(roots.length===1&&roots[0].row.userId!==r.userId)blockers.push('原客户/userId与交易root冲突');}
    if(personal.size>1)blockers.push('原个人资金owner与promoter/commission来源冲突');
    const result={relations:[...new Map(relations.map(x=>[hash(x),x])).values()],blockers:[...new Set(blockers)]};resolving.delete(node);memo.set(node,result);return result;
  }
  for(const node of nodes)resolve(node);
  function requestBinding(container,row) {
    const relations=[],blockers=[],sources=[];let expected=requestSources[container];
    if(container==='qualityPolicyRequests'){
      const found=locate(['qualityPolicies'],row.result?.id);
      try{
        if(found.length!==1)throw Error('missing policy');
        qualityPolicyStream(s,found[0].row.scope);
        // sourceRows also checks this exact request's type, digest version,
        // original author, timestamp, fingerprint and unique result event.
        sources.push({container:'qualityPolicies',id:found[0].row.id,path:found[0].path});
      }catch{blockers.push('质量政策请求与唯一原发布/撤回事实不匹配，保留待核');}
      return{relations,blockers,sources,owned:false,groupSource:blockers.length===0};
    }
    if(container==='handoffRequests')expected=row.kind==='recipient'?['recipients']:['bookings'];
    if(container==='serviceCareRequests')expected=row.entity==='followup'?['serviceCareFollowups']:['serviceCareCases'];
    if(container==='privacyRequests')expected=row.kind==='closure'?['privacyClosures']:['users'];
    if(container==='commerceInvoiceRequests') {
      let type=row.type;
      if(!Object.hasOwn(row,'digestVersion')&&!Object.hasOwn(row,'digestAlgorithm'))try{type=JSON.parse(row.fingerprint)?.type;}catch{}
      expected=type==='commerce-invoice.rule-publish'?['commerceInvoiceRules']:['commerceInvoices'];
    }
    const merge=node=>{sources.push({container:node.container,id:node.row.id,path:node.path});const value=resolve(node);relations.push(...value.relations);blockers.push(...value.blockers);};
    function exact(containers,id,key) {if(id==null)return;const found=locate(containers,id);if(found.length!==1){blockers.push(key+'请求原来源缺失或不唯一');return;}merge(found[0]);}
    const resultId=row.invoiceId??row.reviewId??row.accessId??row.resultId??row.result?.id??row.id;
    if(expected&&resultId!=null)exact(expected,resultId,'result');
    else if(!expected)blockers.push('请求容器尚无原producer映射');
    if(container==='techQualificationRequests'&&row.profileId!=null)exact(['techQualifications'],row.profileId,'profileId');
    let parsedAny=false;
    for(const [key,value] of Object.entries(row))if(requestKeys.has(key)&&typeof value==='string') {
      if(requestDigest(container,key,value,row))continue;
      let parsed;try{parsed=JSON.parse(value);}catch{blockers.push(key+'明文请求结构损坏或摘要版本未知');continue;}
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){blockers.push(key+'请求结构未知');continue;}parsedAny=true;
      if(['actor','actorDigest','actorKey'].includes(key)){if(parsed.role==='user'&&(parsed.id===userId||parsed.userId===userId))relations.push({userId,role:'request-author',basis:'原actor精确user'});continue;}
      const p=parsed.p??parsed.payload??(container==='sensitiveAccessRequests'&&key==='fingerprint'?parsed:null);
      if(!p||typeof p!=='object'||Array.isArray(p)||container!=='sensitiveAccessRequests'&&typeof parsed.type!=='string'){blockers.push(key+'缺少原type/payload结构，不能把正文当目标编号');continue;}
      for(const [field,containers] of Object.entries(relationKeys))if(Object.hasOwn(p,field))exact(containers,p[field],field);
      if(p.id!=null&&expected)exact(expected,p.id,'payload.id');
      if(p.userId===userId)relations.push({userId,role:'request-target',basis:'原payload.userId'});
    }
    if(!sources.length&&!relations.length)blockers.push(parsedAny?'请求没有可核唯一原来源':'请求来源未定位，不反解摘要或猜本人');
    for(const source of sources)if(sources.some(other=>other.container===source.container&&other.id!==source.id))blockers.push('同一原域请求result与payload目标串号，须核对原成功来源');
    const personal=new Set(relations.filter(x=>['personal-owner','technician-owner'].includes(x.role)).map(x=>x.userId));if(personal.size>1)blockers.push('请求个人资金owner来源冲突，不能按一人清理');
    const owned=relations.some(x=>x.userId===userId);return {relations,blockers:[...new Set(blockers)],sources,owned};
  }
  for(const node of nodes){const binding=resolve(node);if(binding.blockers.length&&binding.relations.some(x=>x.userId===userId))issues.push({container:node.container,path:node.path,sourceId:node.row.id??null,reasons:binding.blockers});}
  return {nodes,resolve,requestBinding,issues};
}

function fieldClassification(value,key,path,record) {
  if(key==='actor'&&!/requests$/i.test(path[0])&&['user','tech','store','manager','group','system'].includes(value))return {classification:'retained_fact',status:'retain_required',reason:'保留原事件作者角色枚举，非JSON请求副本'};
  if(requestKeys.has(key)) {
    if(requestDigest(path[0],key,value,record))return {classification:'retained_digest',status:'retain_required',reason:'保留原producer摘要和算法版本，不逆hash推本人'};
    return {classification:'request_plaintext',status:'pending_policy',reason:'原域digestVersion兼容与正式审计期限未齐，不直接清明文去重副本'};
  }
  if(key==='ref'||typeof value==='string'&&/^(invoice-file:|media:)/.test(value))return {classification:'file_reference',status:'pending_review',reason:'原文件用途/共享引用/旧权益与正式保留依据须逐项核，不是字节删除许可'};
  if(['sourceToken','sourceFingerprint','basisSignature','billSource','debtSource','balanceToken'].includes(key)&&typeof value==='string'&&/^[\[{]/.test(value))return {classification:'source_plaintext',status:'pending_policy',reason:'原来源比较明文须先接digestVersion兼容并保留原事实摘要，再按明确政策处理'};
  if(privateKeys.has(key))return {classification:'redaction_candidate',status:value==null||value===''?'cleared_current':'pending_policy',reason:'本字段用途/主体范围/起算事实/正式期限及原事实兼容未齐；仅列清理候选'};
  if(/(^id$|Id$|Ids$|Key$|Token$|Digest$|Signature$|Cents$|At$|Date$|Deadline$|Version$|^version$|^seq$|^requestId$|^requestNo$|^refundNo$|^ticketNumber$|^channelReference$)/.test(key)||typeof value==='number'||typeof value==='boolean'||['role','job','kind','type','status','stage','decision','action','result','level','field','entity','category','origin','mode','digestAlgorithm','by','createdBy','recordedBy'].includes(key))return {classification:'retained_fact',status:'retain_required',reason:'保留原身份/来源ID、金额数量、事实时序状态版本与作者，不重造交易或放宽旧权益'};
  return {classification:'unclassified_content',status:'pending_review',reason:'原自由字段用途或主体未明确，待逐字段核对，不能猜可清'};
}

function describeFields(record,path,binding,graph,items,sourceId,version,kind='historical-field') {
  const active=new WeakSet();let sourceHash;try{sourceHash=hash(record);}catch{sourceHash=null;binding={...binding,blockers:[...binding.blockers,'原历史结构不能生成准确摘要，待人工核对']};}
  function walk(value,current,key,relations=binding.relations) {
    if(value&&typeof value==='object') {if(active.has(value)){items.push({id:'field:'+pathKey(current),kind,path:current,sourceId,classification:'unclassified_content',status:'pending_review',blockers:['原历史结构循环待核'],deleteAllowed:false,sourceToken:hash(current)});return;}
      const nested=[...relations];if(current.length>path.length){if(typeof value.userId==='string')nested.push({userId:value.userId,role:'historical-subject',basis:'原嵌套userId'});if(value.personKind==='user'&&typeof value.personId==='string')nested.push({userId:value.personId,role:'historical-owner',basis:'原嵌套personKind/personId'});if(value.role==='user'&&typeof value.id==='string')nested.push({userId:value.id,role:'event-author',basis:'原嵌套role/id'});}
      active.add(value);for(const [child,next] of Object.entries(value))walk(next,[...current,Array.isArray(value)?Number(child):child],child,nested);active.delete(value);return;}
    const classification=fieldClassification(value,key,current,record),related=graph.references.filter(x=>current.every((v,i)=>v===x.path[i])).map(x=>x.ref),blockers=[...binding.blockers,classification.reason];
    const mixed=relations.some(x=>x.userId!==binding.userId)||current.some(x=>['recipientSnapshot','recipient','address','addressHistory','assignee','by','createdBy','verifiedBy'].includes(x));
    if(mixed&&classification.classification==='redaction_candidate')blockers.push('涉及原客户/个人owner/对象/作者多个主体，须逐字段确认范围，不整行归本人');
    items.push({id:(kind==='request-copy'?'request:':'field:')+pathKey(current),kind,sourceId,path:current,version:version??null,subjectBinding:{userId:binding.userId,closureId:binding.closureId,roles:[...new Set(relations.filter(x=>x.userId===binding.userId).map(x=>x.role))],mixedSubjects:mixed,sourceRelations:relations},valueType:value===null?'null':typeof value,presence:value==null||value===''?'empty':'present',classification:classification.classification,status:binding.blockers.length||mixed&&classification.classification==='redaction_candidate'?'pending_review':classification.status,deleteAllowed:false,refs:[...new Set(related)],blockers,sourceToken:hash({path:current,value,version:version??null,sourceHash,binding:relations})});
  }
  walk(record,path,null);
}

export function collectPrivacyFileReferences(state) {
  const references = [], issues = [], seen = new WeakSet();
  function visit(value, path) {
    if (typeof value === 'string') {
      const refs = [...value.matchAll(refPattern)].map(m => m[0]);
      for (const ref of new Set(refs)) references.push({ ref, library: ref.startsWith('invoice-file:') ? 'invoice' : 'media', path: [...path], sourcePath: pathKey(path), container: path[0] || null });
      if ([...value.matchAll(/invoice-file:|media:/g)].length !== refs.length || refs.some(ref=>ref.startsWith('media:')&&!/^media:[a-f0-9]{64}$/.test(ref))) issues.push({ path: [...path], reason: '未知或损坏的文件引用待核对' });
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) { issues.push({ path: [...path], reason: '源结构循环待核对' }); return; }
    seen.add(value);
    for (const [key, child] of Object.entries(value)) visit(child, [...path, Array.isArray(value) ? Number(key) : key]);
    seen.delete(value); // Repeated actual object references still have distinct source paths.
  }
  for (const [key, value] of Object.entries(state || {})) {
    if (key==='privacyUploadReservations') {
      for (const [index,reservation] of (Array.isArray(value)?value:[]).entries()) {
        for (const [field,child] of Object.entries(reservation||{})) if (!['ref','file'].includes(field)) visit(child,[key,index,field]);
      }
    } else visit(value,[key]); // A published-policy source may itself retain an actual evidence file.
  }
  return { references, issues, sourceToken: hash({ references, issues }) };
}

export function privacyCleanupClosure(state, userId, closureId) {
  const user = unique(rows(state, 'users'), userId, '本人账户'), closure = unique(rows(state, 'privacyClosures'), closureId, '原关闭回执');
  const view = closedRightsView(state, { role: 'user', userId });
  if (user.status !== 'closed' || closure.userId !== userId || closure.status !== 'use_closed' || view?.closureId !== closureId || view.closedAt !== closure.closedAt || !time(closure.closedAt) || closure.closedAt > state.now) throw Error('本人真实使用关闭依据待核对');
  return { user, closure, sourceToken: hash({ userId, closureId, closedAt: closure.closedAt, rights: closure.rights, profile: rows(state, 'privacyProfiles').filter(x => x.userId === userId) }) };
}
export function privacyCleanupCoverage(coverage, originScope) {
  const blockers = [];
  if (!coverage || coverage.originScope !== originScope || coverage.ledgerComplete !== true || coverage.uploadsComplete !== true || !Number.isSafeInteger(coverage.revision) || coverage.revision < 1) blockers.push('当前origin账本/上传覆盖尚未确认');
  if (!Array.isArray(coverage?.unregisteredStoredRefs) || coverage.unregisteredStoredRefs.length) blockers.push('文件库存在未登记/无所有者资料，上传覆盖仍待核对');
  const ids = coverage?.tabIds, tabs = coverage?.tabs;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || !Array.isArray(tabs) || tabs.length !== ids.length || ids.some(id => typeof id !== 'string' || !id || tabs.filter(t => t.id === id && t.status === 'acknowledged' && t.revision === coverage.revision && Array.isArray(t.drafts)).length !== 1)) blockers.push('已知标签/休眠或未确认草稿覆盖尚未齐');
  const graph = collectPrivacyFileReferences({ tabs: tabs || [] });
  if (graph.issues.length) blockers.push('标签存在未知文件引用');
  return { blockers, references: graph.references, sourceToken: hash(coverage ?? null) };
}

function reservationItem(s, r, closure, graph, coverage) {
  const blockers = [], library = r.library, refs = graph.references.filter(x => x.ref === r.ref);
  if (rows(s, 'privacyUploadReservations').filter(x => x.id === r.id).length !== 1) blockers.push('上传登记编号不唯一');
  if (r.closureId !== closure.id || r.userId !== closure.userId || r.status !== 'cancelled' || !time(r.createdAt) || r.createdAt > s.now || !time(r.cancelledAt) || r.cancelledAt < r.createdAt || r.cancelledAt > s.now || !Number.isSafeInteger(r.version) || r.version < 1 || r.cancelledBy?.role !== 'user' || r.cancelledBy.userId !== r.userId) blockers.push('原本人上传取消事实待核对');
  if (!['invoice','media'].includes(library) || !(library === 'invoice' ? /^invoice-file:[a-f0-9]{64}$/ : /^media:[a-f0-9]{64}$/).test(String(r.ref))) blockers.push('准确文件库/ref待核对');
  if (!r.file || r.file.ref !== r.ref || !Number.isSafeInteger(r.file.size) || r.file.size < 1 || r.file.size > 5*1024*1024 || !(library === 'invoice' ? ['application/pdf','image/png','image/jpeg'] : ['image/png','image/jpeg','image/webp']).includes(r.file.type)) blockers.push('原上传文件元数据待核对');
  let rootBinding = null;
  try { if (!['booking','goods'].includes(r.source?.kind)) throw Error('原上传root类别待核对'); rootBinding = closedRightsBinding(s, { role:'user', userId:r.userId }, r.source.kind, r.source.id); if (rootBinding.rootId !== r.source.id) throw Error('原上传root串号'); } catch (error) { blockers.push(error.message); }
  const registrations = rows(s, 'privacyUploadReservations').filter(x => x.ref === r.ref);
  if (registrations.length !== 1) blockers.push('同ref还有其他登记主体或使用用途，不能删除');
  if (refs.length) blockers.push('同ref仍被当前账本/历史/请求或旧权益使用');
  if (graph.issues.length) blockers.push('全局文件引用存在未知来源');
  const cv = privacyCleanupCoverage(coverage, coverage?.originScope);
  blockers.push(...cv.blockers);
  if (cv.references.some(x => x.ref === r.ref)) blockers.push('同ref仍在已知标签草稿中使用');
  const rootRows = rows(s,r.source?.kind==='booking'?'bookings':'goods').filter(x=>x.id===r.source?.id);
  const sourceToken = hash({ reservation:r, closure:{id:closure.id,userId:closure.userId,closedAt:closure.closedAt,rights:closure.rights}, root: rootBinding, rootFacts:hash(rootRows), graph:graph.sourceToken, coverage:cv.sourceToken });
  return { id:'upload:'+r.id, kind:'cancelled-upload', sourceId:r.id, subjectBinding:{userId:r.userId,closureId:closure.id,rootKind:r.source?.kind,rootId:r.source?.id}, library, ref:r.ref, file:r.file ? structuredClone(r.file) : null, version:r.version, path:['privacyUploadReservations',r.id], purpose:'cancelled-unsubmitted-upload', startFact:'upload-cancelled', startAt:r.cancelledAt, sourceToken, status:blockers.length?'pending_review':'pending_policy', blockers, referenceCount:refs.length };
}

export function privacyCleanupInventory(s, userId, closureId, { coverage } = {}) {
  const context = privacyCleanupClosure(s, userId, closureId), graph = collectPrivacyFileReferences(s), items = [];
  const directory=sourceDirectory(s,userId),relationIssues=[...directory.issues],unlocated=[],publicCatalog=/^(?:products|skus|stores|services|regions|staffAccounts|staffSessions|schedules|leaves)$|(?:Rules|Policies|Agreements)$/;
  for(const node of directory.nodes.filter(x=>!x.parent)) {
    const binding=directory.resolve(node);
    if(binding.relations.some(x=>x.userId===userId))describeFields(node.row,node.path,{...binding,userId,closureId},graph,items,node.row.id??null,node.row.version);
    else if((!binding.relations.length||binding.blockers.length||binding.relations.some(x=>rows(s,'users').filter(u=>u.id===x.userId).length!==1))&&(!publicCatalog.test(node.container)||node.container==='qualityPolicies'&&binding.blockers.length))unlocated.push({container:node.container,path:node.path,sourceId:node.row.id??null,status:'pending_review',deleteAllowed:false,reasons:binding.blockers.length?binding.blockers:['原记录没有可核本人关系，不能猜所有者']});
  }
  for (const [container,list] of Object.entries(s)) {
    if (!Array.isArray(list) || !/requests$/i.test(container)) continue;
    for (const [index,record] of list.entries()) {
      if(!record||typeof record!=='object')continue;const binding=directory.requestBinding(container,record),path=[container,index];
      if(binding.owned){describeFields(record,path,{...binding,userId,closureId},graph,items,record.requestId??record.id??null,record.version,'request-copy');if(binding.blockers.length)relationIssues.push({container,path,sourceId:record.requestId??record.id??null,reasons:binding.blockers});}
      else if(!binding.relations.length&&!binding.groupSource)unlocated.push({container,path,sourceId:record.requestId??record.id??null,status:'pending_review',deleteAllowed:false,reasons:binding.blockers});
    }
  }
  for (const r of rows(s,'privacyUploadReservations').filter(x=>x.userId===userId)) items.push(reservationItem(s,r,context.closure,graph,coverage));
  return {userId,closureId,closedAt:context.closure.closedAt,items,relationIssues,unlocated,sourceToken:hash({closure:context.sourceToken,items,relationIssues,unlocated,graph:graph.sourceToken,coverage:coverage??null}),scope:'current-origin; ledger/history/request refs and explicitly acknowledged tabs; no disk/backup/external origins',unregisteredUploads:'pending_owner; no owner inferred from file store',graph};
}

export function privacyCleanupInventoryView(s, rawActor, closureId, options = {}) {
  const actor = resolveAccountActor(s,rawActor), closure=unique(rows(s,'privacyClosures'),closureId,'关闭回执');
  const staff=actor.role==='group' && actor.job==='support' && actor.accountId && actor.sessionId && canAccountView(actor,'privacy');
  if (!staff && !(actor.role==='user' && actor.userId===closure.userId)) throw Error('无权查看此清理目录');
  const inventory=privacyCleanupInventory(s,closure.userId,closureId,options);
  if(staff) {const {graph,...safe}=inventory;return safe;}
  return {closureId,userId:actor.userId,closedAt:inventory.closedAt,scope:inventory.scope,items:inventory.items.map(x=>({id:hash(x.id),kind:x.kind,classification:x.classification??null,status:x.status,reason:x.blockers.join('；')})),unlocatedCount:inventory.unlocated.length,relationIssueCount:inventory.relationIssues.length,unregisteredUploads:inventory.unregisteredUploads};
}
