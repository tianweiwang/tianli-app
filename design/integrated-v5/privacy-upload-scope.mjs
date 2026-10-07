// Trusted current-source adapters only. No writes, byte reads, policy, or new ACL.
import { resolveAccountActor, assertAccountCommand, actorAccountFields } from './staff-accounts.mjs';
import { assertJob, imageSource } from './management.mjs';
import { assertPrivacyCommand, privacyUseClosed } from './privacy.mjs';
import { closedRightsBinding } from './privacy-closed-rights.mjs';
import { careUploadScope, careEvidenceFile } from './service-care.mjs';
import { qualificationUploadScope, qualificationEvidenceFile } from './tech-qualification.mjs';
import { serviceInvoiceUploadScope } from './service-invoices.mjs';
import { commerceInvoiceUploadScope } from './commerce-invoices.mjs';
import { serviceExtraUploadScope } from './service-extra-file-validation.mjs';
import { servicePromotionUploadScope } from './service-promotion-file-validation.mjs';
import { authorizedServiceExtraFile } from './service-finance-extras.mjs';
import { authorizedServicePromotionFile } from './service-promotion.mjs';
import { authorizedInvoiceFile } from './invoice-files.mjs';
import { serviceFinanceCompositionReview, authorizedServiceFinanceCompositionFile } from './service-finance-composition-review.mjs';
import { lifecycleFingerprint as hash } from './organization-lifecycle-projection.mjs';

const copy=value=>structuredClone(value),same=(a,b)=>hash(a)===hash(b),rows=(s,k)=>Array.isArray(s?.[k])?s[k]:[];
const fail=message=>{throw new Error(message);};
function unique(list,id,label,key='id'){const found=list.filter(row=>row?.[key]===id);if(typeof id!=='string'||!id||found.length!==1)fail(`${label}缺失或编号不唯一。`);return found[0];}
function selection(value){if(!value||!['tabId','instanceId','generation'].every(key=>typeof value[key]==='string'&&value[key].trim()&&value[key]===value[key].trim())||!/^sha256:[a-f0-9]{64}$/.test(value.formKeyDigest||''))fail('当前实际标签/表单/选择代次尚未接入。');return copy({tabId:value.tabId,instanceId:value.instanceId,generation:value.generation,formKeyDigest:value.formKeyDigest});}
const userScope=(s,a,kind,id)=>{if(privacyUseClosed(s,a.userId))closedRightsBinding(s,a,kind,id);};
const addSubject=(out,kind,id)=>{if(id&&!out.some(item=>item.kind===kind&&item.id===id))out.push({kind,id});};
const legacyProofs=new WeakMap();
const catalogKinds={products:'catalog-product',skus:'catalog-sku',stores:'catalog-store',services:'catalog-service',regions:'catalog-region'};
function legacySource(s,rawActor,path) {
  const actor=resolveAccountActor(s,rawActor);
  if(!Array.isArray(path)||!catalogKinds[path[0]]||!Number.isSafeInteger(path[1])||path[1]<0
    ||!(path.length===3&&path[2]==='image'||path[0]==='products'&&path.length===4&&path[2]==='gallery'&&Number.isSafeInteger(path[3])&&path[3]>=0&&path[3]<4))fail('旧inline须定位原账本已知公共图片准确叶。');
  const row=rows(s,path[0])[path[1]];unique(rows(s,path[0]),row?.id,'原公共图片来源');
  const inline=value(s,path);if(typeof inline!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(inline)||imageSource(inline)!==inline)fail('准确公共槽没有完整原inline图片。');
  const source={kind:catalogKinds[path[0]],id:row.id};
  return {actor,source,path:copy(path),inline,sourceToken:hash({source,row,path,inline})};
}
// Root keeps this opaque proof in the actual selection closure. A page payload
// cannot manufacture it. Only original inline bytes are decoded; no put occurs.
export async function preparePrivacyInlineUpload({currentContext,path,selection:chosen}={}) {
  if(typeof currentContext!=='function')fail('原迁移当前上下文尚未接入。');
  const read=()=>{const ctx=currentContext();if(ctx?.viewError||!ctx?.state)fail('原迁移账本读取失败。');return legacySource(ctx.state,ctx.actor,path);};
  const first=read(),selected=selection(chosen),comma=first.inline.indexOf(','),type=first.inline.slice(5,first.inline.indexOf(';'));
  const bytes=Uint8Array.from(atob(first.inline.slice(comma+1)),char=>char.charCodeAt(0));
  if(!bytes.length)fail('原inline不是非空实际图片。');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const latest=read();if(first.sourceToken!==latest.sourceToken||!same(first.actor,latest.actor))fail('原迁移来源或当前身份已变化。');
  const proof=Object.freeze({source:copy(first.source),path:copy(path),ref:'media:'+digest});
  legacyProofs.set(proof,{...first,selection:selected,type,size:bytes.length});
  return {file:new File([bytes],'旧公共图片迁移',{type}),proof};
}
function subjects(source,row) {
  const out=[];for(const item of [source?.booking,source?.root,source?.person,source?.promoter,row]) {
    if(!item)continue;
    if(item.personKind&&item.personId)addSubject(out,item.personKind,item.personId);
    if(item.userId)addSubject(out,'user',item.userId);
    if(item.techId)addSubject(out,'tech',item.techId);
    if(item.storeId)addSubject(out,'store',item.storeId);
    if(item.ownerStoreId)addSubject(out,'store',item.ownerStoreId);
  }
  return out.length?out:[{kind:'group',id:'group'}];
}
function plan(s,rawActor,type,p,options) {
  if(type==='media.legacy-externalize') {
    const saved=legacyProofs.get(options.legacyProof);if(!saved)fail('原inline字节等价核验尚未接入。');
    const actual=legacySource(s,rawActor,saved.path),selected=selection(options.selection);
    if(actual.sourceToken!==saved.sourceToken||!same(selected,saved.selection))fail('原inline来源或选择代次已变化。');
    return {actor:actual.actor,target:{container:saved.path[0],id:actual.source.id,path:saved.path,legacyProof:options.legacyProof},scope:{purpose:'legacy-inline-image',library:'media',command:type,source:actual.source,sourceToken:saved.sourceToken,subjects:[{kind:'public',id:actual.source.id}],selection:selected}};
  }
  const actor=resolveAccountActor(s,rawActor);assertAccountCommand(actor,type,p,s);assertJob(actor,type);assertPrivacyCommand(s,actor,type,p);
  let purpose,source,actual,subject,library='invoice',target;
  if(type==='care.case-create'||type==='care.case-statement') {
    actual=careUploadScope(s,actor,type,p,{assertUserScope:userScope});
    const row=type==='care.case-statement'?unique(rows(s,'serviceCareCases'),p.id,'原案件'):null,
      b=unique(rows(s,'bookings'),row?.bookingId||p.bookingId,'原预约');
    purpose='care-evidence';source={kind:'booking',id:b.id};subject=subjects({booking:b});target={container:'serviceCareCases',id:row?.id||null};
  } else if(type.startsWith('qualification.')) {
    actual=qualificationUploadScope(s,actor,type,p);purpose='qualification-evidence';source={kind:actual.profile?'qualification-profile':'qualification-draft',id:actual.profile?.id||actual.person.id};
    subject=[{kind:'tech',id:actual.person.id},{kind:'store',id:actual.store.id}];target={container:'techQualifications',id:actual.profile?.id||actual.person.id};
  } else if(type.startsWith('invoice.')) {
    actual=serviceInvoiceUploadScope(s,actor,type,p);purpose='service-invoice';source={kind:'service-invoice',id:actual.row.id};subject=subjects(actual.source,actual.row);target={container:'serviceInvoices',id:actual.row.id,slot:actual.slot};
  } else if(type.startsWith('commerce-invoice.')) {
    actual=commerceInvoiceUploadScope(s,actor,type,p);purpose='commerce-invoice';source={kind:'commerce-invoice',id:actual.row.id};subject=actual.row.category==='goods'?subjects(actual.source,actual.row):[{kind:'store',id:actual.row.storeId},{kind:'group',id:'group'}];target={container:'commerceInvoices',id:actual.row.id,slot:actual.slot};
  } else if(type.startsWith('service-extra.')) {
    actual=serviceExtraUploadScope(s,actor,type,p);purpose='service-extra';const command=type.slice(14);
    const root=command==='evidence-submit'||command==='refund-shortage'?{kind:'booking',id:actual.source.booking.id}:command==='recovery-receive'?{kind:'service-extra-recovery',id:actual.row.id}:command==='offset-return'?{kind:'service-extra-offset',id:actual.row.id}:{kind:'service-refund-shortage',id:actual.row.id};
    source=root;subject=subjects(actual.source,actual.row);target={container:command==='evidence-submit'?'serviceExtraEvidence':command==='recovery-receive'?'serviceExtraRecoveries':command==='offset-return'?'serviceExtraOffsets':'serviceRefundShortages',id:['evidence-submit','refund-shortage'].includes(command)?null:actual.row.id};
  } else if(['finance.composition-confirm','finance.composition-reconcile'].includes(type)) {
    actual=serviceFinanceCompositionReview(s,actor,p.id,p.sourceKey);
    if(!actual[type==='finance.composition-confirm'?'canConfirm':'canReconcile']||Number(p.version)!==actual.entryVersion||p.sourceToken!==actual.sourceToken)fail('原现金组成来源、版本或财务办理权限已变化。');
    if(options.field!=='file')fail('不是原现金组成证据选择字段。');
    const entry=unique(rows(s,'serviceFinanceEntries'),p.id,'原资金条目'),booking=unique(rows(s,'bookings'),entry.bookingId,'原预约');
    purpose='service-finance';source={kind:'service-finance-entry',id:entry.id};subject=subjects({booking},entry);target={container:'serviceFinanceCompositions',id:null,cashSource:actual.source};
  } else if(type.startsWith('service-promotion.')||type==='finance.recovery-receive') {
    actual=servicePromotionUploadScope(s,actor,type,p);purpose=type==='finance.recovery-receive'?'service-finance':'service-promotion';
    const command=type.slice(18),container=type==='finance.recovery-receive'?'serviceFinanceRecoveries':command==='agreement-publish'?'servicePromotionAgreements':command==='identity-review'?'servicePromoters':command==='risk-review'?'servicePromotionRisks':command.startsWith('withdraw-')?'servicePromotionWithdrawals':'servicePromotionRecoveries';
    const kind={serviceFinanceRecoveries:'service-finance-recovery',servicePromotionAgreements:'service-promotion-agreement',servicePromoters:'service-promoter',servicePromotionRisks:'service-promotion-risk',servicePromotionWithdrawals:'service-promotion-withdrawal',servicePromotionRecoveries:'service-promotion-recovery'}[container];
    if(command==='agreement-publish'&&(typeof p.requestId!=='string'||!p.requestId.trim()))fail('新协议上传须有原表单实际requestId。');
    source={kind,id:actual.row?.id||'draft:'+p.requestId};subject=subjects(actual.source,actual.row);target={container,id:actual.row?.id||null};
  } else if(type==='manage.product-save') {
    if(actor.role!=='group')fail('原公共商品图由集团管理岗位维护。');
    if(!['image','gallery0','gallery1','gallery2','gallery3'].includes(options.field))fail('不是原公共商品图选择字段。');
    actual=p.id?unique(rows(s,'products'),p.id,'原商品'):null;
    if(actual&&(!['number','string'].includes(typeof p.version)||!String(p.version).trim()||!Number.isSafeInteger(Number(p.version))||Number(p.version)!==actual.version))fail('原商品版本已变化，请刷新选择。');
    if(!actual&&(typeof p.requestId!=='string'||!p.requestId.trim()))fail('新商品图须绑定原表单实际requestId。');
    source={kind:actual?'catalog-product':'catalog-draft',id:actual?.id||p.requestId};purpose='catalog-image';library='media';subject=[{kind:'public',id:source.id}];target={container:'products',id:actual?.id||null,field:options.field};
    actual={product:actual,skus:actual?rows(s,'skus').filter(row=>row.productId===actual.id):[],requestId:actual?null:p.requestId,field:options.field};
  } else if(type==='lifecycle.identity-link')fail('原实名链接只有文字依据，没有真实上传或文件槽。');
  else fail('该原命令没有已接入的真实上传用途。');
  // Only true source selectors belong here. Body decisions/ticket/reason can be
  // filled after a selection without turning the selection into a new source.
  const keys=type.startsWith('service-extra.')?['kind','refundId','advanceId']:type==='service-promotion.agreement-publish'?['promoterType']:[];
  const anchors=Object.fromEntries(keys.map(key=>[key,p[key]??null]));
  return {actor,target,scope:{purpose,library,command:type,source,sourceToken:hash({type,actual,anchors,field:options.field||null}),subjects:subject,selection:selection(options.selection)}};
}
export function privacyUploadScope(s,rawActor,type,p={},options={}) {return plan(s,rawActor,type,p,options).scope;}

function value(s,path){return path.reduce((item,key)=>item?.[key],s);}
function newFilePaths(before,after,path,ref) {
  const found=[];
  function visit(item,current) {
    if(item&&typeof item==='object'&&!Array.isArray(item)&&item.ref===ref){if(!same(value(before,current)??null,item))found.push(current);return;}
    if(typeof item==='string'&&item===ref){if(value(before,current)!==item)found.push(current);return;}
    if(Array.isArray(item))item.forEach((child,i)=>visit(child,[...current,i]));
    else if(item&&typeof item==='object')for(const [key,child] of Object.entries(item))visit(child,[...current,key]);
  }
  visit(value(after,path),path);return found;
}
function proof(before,after,actor,type,p,result,target) {
  if(type==='manage.product-save'&&!result) {
    const candidates=p.id?rows(after,'products').filter(row=>row.id===p.id):rows(after,'products').filter(row=>!rows(before,'products').some(old=>old.id===row.id));
    if(candidates.length!==1)fail('原商品提交没有唯一实际新结果。');result=candidates[0];
  }
  if(!result||typeof result.id!=='string')fail('原命令实际结果编号缺失。');
  const row=unique(rows(after,target.container),result.id,'原命令结果');
  if(target.id&&row.id!==target.id)fail('原命令结果与上传原根串号。');
  if(type.startsWith('service-promotion.')) {
    const minimal={id:row.id,version:row.version,...(result.keptExisting!=null?{keptExisting:result.keptExisting}:{})};
    if(!same(result,minimal))fail('原推广命令最小结果与当前实际记录不一致。');
  } else if(!same(row,result))fail('原命令结果与当前实际记录不一致。');
  if(!Number.isSafeInteger(row.version)||row.version<1)fail('原结果版本缺失。');
  const previous=rows(before,target.container).find(item=>item.id===row.id);
  if(previous&&row.version<=previous.version)fail('原命令没有生成本次新版本。');
  const requestContainer=type.startsWith('care.')?'serviceCareRequests':type.startsWith('qualification.')?'techQualificationRequests':type.startsWith('invoice.')?'serviceInvoiceRequests':type.startsWith('commerce-invoice.')?'commerceInvoiceRequests':type.startsWith('service-extra.')?'serviceExtraRequests':type.startsWith('service-promotion.')?'servicePromotionRequests':type.startsWith('finance.')?'serviceFinanceRequests':'managementRequests';
  if(typeof p.requestId!=='string'||!p.requestId.trim())fail('原提交requestId缺失。');
  const old=rows(before,requestContainer),requests=rows(after,requestContainer).filter(item=>item.requestId===p.requestId&&!old.some(existing=>same(existing,item)));
  if(requests.length!==1)fail('本次原提交没有唯一新增请求事实。');
  const request=requests[0],resultId=request.invoiceId||request.profileId||request.resultId||request.result?.id||request.id;
  if(type!=='manage.product-save'&&resultId!==row.id)fail('原请求结果与本次原附件根串号。');
  const expected={type,...(type.startsWith('invoice.')?{payload:p}:{p})},fingerprint=request.fingerprint||request.signature;
  let verified=false;
  if(typeof fingerprint==='string') {
    if(/^(?:sha256:)?[a-f0-9]{64}$/.test(fingerprint))verified=fingerprint.replace(/^sha256:/,'')===hash(expected).slice(7);
    else try{verified=same(JSON.parse(fingerprint),expected);}catch{}
  }
  if(!verified)fail('原提交内容摘要与本次操作不一致。');
  const fields=actorAccountFields(actor),id=actor.role==='group'?'group':actor.role==='user'?actor.userId:actor.role==='tech'?actor.techId:actor.storeId;
  let expectedAuthor;
  if(type.startsWith('care.')||type.startsWith('invoice.')||type.startsWith('qualification.'))expectedAuthor={role:actor.role,job:actor.role==='group'?actor.job||null:null,id,...fields};
  else if(type.startsWith('commerce-invoice.'))expectedAuthor={role:actor.role,job:actor.job||null,id:actor.accountId||id,...fields};
  else if(['finance.composition-confirm','finance.composition-reconcile'].includes(type))expectedAuthor={role:actor.role,job:actor.job,id:actor.accountId||'group',...fields};
  else if(type.startsWith('service-promotion.'))expectedAuthor={role:actor.role,job:actor.job||null,id:actor.userId||actor.techId||actor.storeId||'group',...fields};
  else expectedAuthor={role:actor.role,job:actor.job||null,id,...fields};
  if(type==='manage.product-save') {
    const key=`${actor.role}:${actor.storeId||''}:${actor.job||''}`+(fields.accountId?`:${fields.accountId}:${fields.grantId}`:'');
    if(request.actor!==key)fail('原公共图提交作者不一致。');
  } else if(request.actorDigest) {
    if(String(request.actorDigest).replace(/^sha256:/,'')!==hash(expectedAuthor).slice(7))fail('原提交作者摘要不一致。');
  } else {
    try{if(!same(JSON.parse(request.actor),expectedAuthor))fail('原提交作者不一致。');}catch{fail('原提交作者不一致。');}
  }
  if(type.startsWith('commerce-invoice.')) {
    const audit=row.history?.at(-1);
    if(audit?.version!==row.version||!same(audit.actor,expectedAuthor))fail('原集团票据新增办理记录作者不一致。');
  }
  return row;
}
function slotFor(s,a,type,row,path,ref) {
  const tail=path.slice(2),index=tail.at(-1);
  if(type.startsWith('care.')) {
    const slot=tail[0]==='evidenceRefs'?`evidence:${index}`:tail[0]==='statements'&&tail[2]==='evidenceRefs'?`statement:${row.statements[tail[1]].id}:${index}`:null;
    if(!slot)fail('不是原案件本次真实图片槽。');careEvidenceFile(s,a,row.id,slot,{assertUserScope:userScope});return slot;
  }
  if(type.startsWith('qualification.')) {
    let slot;
    if(tail[0]==='history')slot=`history:${row.history[tail[1]].version}:${index}`;
    else if(tail[0]==='assessments')slot=`assessment:${row.assessments[tail[1]].id}:${index}`;
    else if(tail[0]==='grants')slot=`${tail[2]==='review'?'review':'request'}:${row.grants[tail[1]].id}:${index}`;
    else if(tail[0]==='holds')slot=`${tail[2]==='resolution'?'resume':'pause'}:${row.holds[tail[1]].id}:${index}`;
    if(!slot)fail('不是原资格记录实际凭证槽。');qualificationEvidenceFile(s,a,row.id,slot);return slot;
  }
  if(type.startsWith('invoice.')||type.startsWith('commerce-invoice.')) {
    const slot=type.endsWith('.issue')?'issued':type.endsWith('.red')?'red':null;
    const current=slot||(['issued','red'].includes(tail[0])?tail[0]:tail[0]==='history'?row.history[tail[1]].slot:null);
    if(!current)fail('原票本次附件槽不明确。');authorizedInvoiceFile(s,a,row.id,current,ref,type.startsWith('invoice.')?'service':'commerce');return tail[0]==='history'?`history:${row.history[tail[1]].version}:${tail.slice(2).join(':')}`:current;
  }
  if(type.startsWith('service-extra.')) {
    let slot;
    if(tail[0]==='evidenceRefs')slot=`evidence:${index}`;
    else if(tail[0]==='failureEvidence')slot=`failure:${index}`;
    else if(tail[0]==='recharges')slot=`recharge:${row.recharges[tail[1]].id}:${index}`;
    else if(tail[0]==='records')slot=`record:${row.records[tail[1]].id}:${index}`;
    else if(tail[0]==='returnRecords')slot=`return:${row.returnRecords[tail[1]].id}:${index}`;
    else if(tail[0]==='advances')slot=tail[2]==='reconciliationRecords'?`advance-return:${row.advances[tail[1]].id}:${row.advances[tail[1]].reconciliationRecords[tail[3]].id}:${index}`:`advance:${row.advances[tail[1]].id}:${index}`;
    if(!slot)fail('原资金本次凭证槽不明确。');authorizedServiceExtraFile(s,a,row.id,slot,ref);return slot;
  }
  if(type.startsWith('service-promotion.')) {
    let slot;
    if(tail[0]==='evidenceRefs')slot=`agreement:${index}`;
    else if(tail[0]==='identity')slot=`identity:${index}`;
    else if(tail[0]==='review')slot=`risk-review:${index}`;
    else if(tail[0]==='execution')slot=tail[1]==='results'?`result:${tail[2]}:${index}`:`payment:${index}`;
    else if(tail[0]==='records')slot=`record:${row.records[tail[1]].id}:${index}`;
    if(!slot)fail('原推广本次实际凭证槽不明确。');authorizedServicePromotionFile(s,a,row.id,slot,ref);return slot;
  }
  if(type==='finance.recovery-receive') {
    if(tail[0]!=='records')fail('不是原财务追偿本次真实材料槽。');const slot=`recovery:${row.records[tail[1]].id}:${index}`;authorizedInvoiceFile(s,a,row.id,slot,ref,'service-finance');return slot;
  }
  if(['finance.composition-confirm','finance.composition-reconcile'].includes(type)) {
    if(tail.length!==2||tail[0]!=='evidenceRefs')fail('不是原现金组成本次实际证据槽。');
    const slot=`evidence:${index}`;authorizedServiceFinanceCompositionFile(s,a,row.id,slot,ref);return slot;
  }
  if(type==='manage.product-save')return tail.join(':');
  fail('原附件用途未接入。');
}
export function privacyUploadAttachmentSlots(before,after,rawActor,type,p={},commandResult,reservation,{field,galleryFields,legacyProof}={}) {
  if(!reservation||reservation.command!==type||reservation.status!=='saved'||reservation.usable!==true)fail('原上传登记或本次原命令不匹配。');
  const original=plan(before,rawActor,type,p,{selection:reservation.selection,field,legacyProof});
  if(!same(original.scope.source,reservation.source)||hash(original.scope.sourceToken)!==reservation.sourceToken||!same({subjects:original.scope.subjects},reservation.subjectBinding))fail('原上传来源与本次原命令根已变化。');
  if(type==='media.legacy-externalize') {
    const expected=legacyProofs.get(legacyProof),path=original.target.path;
    if(reservation.ref!==legacyProof.ref||reservation.file?.type!==expected.type||reservation.file?.size!==expected.size||value(after,path)!==legacyProof.ref)fail('原inline替换与实际原字节不等价。');
    const reverted=copy(after);let parent=reverted;for(const key of path.slice(0,-1))parent=parent[key];parent[path.at(-1)]=expected.inline;
    if(!same(reverted,before))fail('原inline外化修改了准确叶以外的原业务事实。');
    return [{source:original.scope.source,slot:path.slice(2).join(':'),path:copy(path),sourceToken:hash({source:original.scope.source,path,ref:reservation.ref})}];
  }
  const row=proof(before,after,original.actor,type,p,commandResult,original.target),position=rows(after,original.target.container).indexOf(row),base=[original.target.container,position];
  if(type.startsWith('care.')){const b=unique(rows(before,'bookings'),original.scope.source.id,'原预约');if(row.bookingId!==b.id||row.userId!==b.userId||row.storeId!==b.storeId||row.techId!==b.techId)fail('原案件结果不属于上传原预约。');}
  if(type.startsWith('qualification.')){if(row.techId!==p.techId||row.storeId!==(p.storeId||unique(rows(before,'techs'),p.techId,'原技师').storeId))fail('原资格结果归属串号。');}
  if(type==='service-extra.evidence-submit'||type==='service-extra.refund-shortage'){if(row.bookingId!==p.bookingId||row.paymentId!==p.paymentId)fail('原资金新结果与上传原支付串号。');}
  if(type==='service-promotion.agreement-publish'&&row.promoterType!==p.promoterType)fail('原协议类型串号。');
  if(['finance.composition-confirm','finance.composition-reconcile'].includes(type)&&(!same(row.source,original.target.cashSource)||row.source?.entryId!==p.id))fail('原组成结果与本次上传现金来源串号。');
  let paths=newFilePaths(before,after,base,reservation.ref);
  if(type.startsWith('invoice.')||type.startsWith('commerce-invoice.')) {
    const slot=original.target.slot,main=[...base,slot,'file'];
    // Same bytes can be a new explicit replacement. Preserve the fresh current
    // slot and its new audit copy; previousFile remains an old protected use.
    if(value(after,main)?.ref===reservation.ref&&!paths.some(path=>same(path,main)))paths.push(main);
    paths=paths.filter(path=>path[2]!=='history'||!path.includes('previousFile'));
  }
  if(type.startsWith('service-promotion.')) {
    paths=paths.filter(path=>!['identityHistory','reviewHistory'].includes(path[2]));
    const main=type==='service-promotion.identity-review'?[...base,'identity','evidenceRefs']:type==='service-promotion.risk-review'?[...base,'review','evidenceRefs']:null;
    if(main)for(let i=0;i<(value(after,main)||[]).length;i++){const path=[...main,i];if(value(after,path)?.ref===reservation.ref&&!paths.some(old=>same(old,path)))paths.push(path);}
    if(['service-promotion.withdraw-pay','service-promotion.withdraw-query'].includes(type))for(let i=0;i<(row.execution?.proof?.evidenceRefs||[]).length;i++){const path=[...base,'execution','proof','evidenceRefs',i];if(value(after,path)?.ref===reservation.ref&&!paths.some(old=>same(old,path)))paths.push(path);}
  }
  if(type==='manage.product-save') {
    let desired=['image'];
    if(field!=='image') {
      if(!Array.isArray(galleryFields)||galleryFields.length!==4||galleryFields.some(item=>typeof item!=='string')||!same(galleryFields.filter(Boolean),p.gallery))fail('原详情图四槽与实际提交packing尚未核验。');
      const chosen=Number(field.slice(7));if(galleryFields[chosen]!==reservation.ref)fail('原选择详情图与提交槽不一致。');
      desired=['gallery',galleryFields.slice(0,chosen).filter(Boolean).length];
    }
    paths=paths.filter(path=>same(path.slice(2),desired));
    const main=[...base,...desired];if(value(after,main)===reservation.ref&&!paths.some(path=>same(path,main)))paths.push(main);
    if(field==='image')for(let i=0;i<rows(after,'skus').length;i++)if(after.skus[i].productId===row.id&&after.skus[i].image===reservation.ref&&value(before,['skus',i,'image'])!==reservation.ref)paths.push(['skus',i,'image']);
  }
  if(!paths.length)fail('本次原命令没有新增该实际文件槽。');
  for(const path of paths){const file=value(after,path);if(typeof file!=='string'&&(file?.ref!==reservation.ref||file.type!==reservation.file?.type||file.size!==reservation.file?.size))fail('原新槽元数据与本次实际登记不一致。');}
  const attachedKind={serviceCareCases:'care-case',techQualifications:'qualification-profile',serviceExtraEvidence:'service-extra-evidence',serviceRefundShortages:'service-refund-shortage',serviceFinanceCompositions:'service-finance-composition',products:'catalog-product'}[original.target.container]||original.scope.source.kind;
  const result=paths.map(path=>({source:{kind:attachedKind,id:row.id},slot:path[0]==='skus'?'materialized-image:'+after.skus[path[1]].id:slotFor(after,original.actor,type,row,path,reservation.ref),path,sourceToken:hash({row,path,file:value(after,path)})}));
  if(type==='service-extra.offset-return') {
    const prior=unique(rows(before,'serviceExtraRecoveries'),row.recoveryId,'原垫付债'),debt=unique(rows(after,'serviceExtraRecoveries'),row.recoveryId,'当前原垫付债');
    const old=rows(before,'serviceExtraOffsets').find(x=>x.id===row.id),records=(row.returnRecords||[]).filter(record=>!(old?.returnRecords||[]).some(existing=>existing.id===record.id)&&record.evidenceRefs?.some(file=>file.ref===reservation.ref));
    if(records.length!==1||debt.storeId!==prior.storeId||debt.bookingId!==prior.bookingId||debt.paymentId!==prior.paymentId||debt.version<=prior.version||debt.receivedCents!==prior.receivedCents-records[0].amountCents)fail('原退回与原垫付债实际资金副本不一致。');
    const matches=(debt.records||[]).filter(record=>record.id===records[0].id);if(matches.length!==1||!same(matches[0],records[0])||(prior.records||[]).some(record=>record.id===records[0].id))fail('原退回凭证的债务副本缺失或不唯一。');
    const pos=rows(after,'serviceExtraRecoveries').indexOf(debt),recordIndex=debt.records.indexOf(matches[0]);
    for(let i=0;i<matches[0].evidenceRefs.length;i++)if(matches[0].evidenceRefs[i].ref===reservation.ref) {
      const path=['serviceExtraRecoveries',pos,'records',recordIndex,'evidenceRefs',i],file=value(after,path);
      if(file.type!==reservation.file.type||file.size!==reservation.file.size)fail('原债务副本元数据与实际登记不一致。');
      result.push({source:{kind:'service-extra-recovery',id:debt.id},slot:slotFor(after,original.actor,type,debt,path,reservation.ref),path,sourceToken:hash({debt,path,file})});
    }
  }
  if(['service-extra.advance-pay','service-extra.advance-query'].includes(type)) {
    const advances=(row.advances||[]).filter(item=>item.id===p.advanceId);
    if(advances.length!==1)fail('本次原垫付款来源缺失或不唯一。');
    const advance=advances[0];
    if(advance.path==='direct-user'&&advance.status==='succeeded'&&advance.execution?.status==='success') {
      const prior=unique(rows(before,'bookings'),row.bookingId,'原直接退款预约'),booking=unique(rows(after,'bookings'),row.bookingId,'当前直接退款预约');
      const oldRefund=unique(prior.refunds||[],row.refundId,'原退款'),refund=unique(booking.refunds||[],row.refundId,'当前原退款');
      const oldPart=unique(oldRefund.executions||[],row.paymentId,'原退款执行','paymentId'),part=unique(refund.executions||[],row.paymentId,'当前原退款执行','paymentId');
      const oldPayment=unique([prior.payment,...(prior.extensions||[])].filter(Boolean),row.paymentId,'原付款'),payment=unique([booking.payment,...(booking.extensions||[])].filter(Boolean),row.paymentId,'当前原付款');
      const facts=advance.execution.proof,expected={advanceId:advance.id,paymentId:payment.id,refundNo:row.refundNo,amountCents:advance.amountCents,reference:facts?.reference,evidenceRefs:facts?.evidenceRefs,occurredAt:facts?.occurredAt,recordedAt:after.now,by:{role:original.actor.role,job:original.actor.job,...actorAccountFields(original.actor)}};
      const matches=(refund.offlinePaymentFacts||[]).filter(item=>item.advanceId===advance.id);
      if(booking.userId!==prior.userId||booking.storeId!==prior.storeId||row.userId!==booking.userId||row.storeId!==booking.storeId||advance.userDecision?.userId!==booking.userId||advance.userDecision?.decision!=='accept'||oldPart.status!=='failed'||part.status!=='success'||part.directAdvanceId!==advance.id||part.paymentPath!=='direct-user'||part.refundNo!==row.refundNo||oldPart.refundNo!==row.refundNo||advance.amountCents!==row.refundCents||part.amountCents!==advance.amountCents||payment.refundedCents!==oldPayment.refundedCents+advance.amountCents||matches.length!==1||!same(matches[0],expected)||(oldRefund.offlinePaymentFacts||[]).some(item=>item.advanceId===advance.id))fail('原直接退款的实际新凭证副本或本款资金来源不一致。');
      const bookingIndex=rows(after,'bookings').indexOf(booking),refundIndex=booking.refunds.indexOf(refund),factIndex=refund.offlinePaymentFacts.indexOf(matches[0]);
      for(let i=0;i<(facts.evidenceRefs||[]).length;i++)if(facts.evidenceRefs[i].ref===reservation.ref) {
        const path=['bookings',bookingIndex,'refunds',refundIndex,'offlinePaymentFacts',factIndex,'evidenceRefs',i],file=value(after,path);
        if(file.type!==reservation.file.type||file.size!==reservation.file.size)fail('原直接退款副本元数据与实际登记不一致。');
        // The original advance file ACL already authorized the primary proof.
        // This exact storage copy is an attachment fact, never a new read ACL.
        result.push({source:{kind:'booking',id:booking.id},slot:`refund:${refund.id}:direct:${advance.id}:${i}`,path,sourceToken:hash({bookingId:booking.id,refundId:refund.id,fact:matches[0],path})});
      }
    }
  }
  return result;
}
