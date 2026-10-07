// Audited classification only. The caller commits this command in the original cloned transaction.
import { resolveAccountActor, actorAccountFields, assertAccountCommand, canAccountCommand, canAccountView } from './staff-accounts.mjs';
import { serviceFinanceCashSource, serviceFinanceComposition, serviceFinanceCompositionAllocationSources, serviceFinanceCompositionToken, serviceFinanceCompositionCandidates, serviceFinanceCompositionFingerprint as digest } from './service-finance-composition.mjs';

const clone=x=>structuredClone(x),types=new Set(['finance.composition-confirm','finance.composition-reconcile']),proofs=new WeakMap();
const same=(a,b)=>digest(a)===digest(b),money=x=>Number.isSafeInteger(x)&&x>=0;
const actorFacts=a=>({role:a.role,job:a.job,id:a.accountId||'group',...actorAccountFields(a)});
function fail(message){throw new Error(message);}
function text(x,label,max=1000){if(typeof x!=='string'||!x.trim()||x.trim().length>max)fail(`请填写${label}`);return x.trim();}
function integer(x,label){if(!['string','number'].includes(typeof x)||!String(x).trim()||!money(Number(x)))fail(`${label}无效`);return Number(x);}
function unique(rows,id,label){if(!Array.isArray(rows))fail(`${label}来源容器无效`);const matches=rows.filter(r=>r?.id===id);if(typeof id!=='string'||matches.length!==1)fail(`${label}缺失或编号不唯一`);return matches[0];}
function authorize(s,rawActor,type,p={}){
  const actor=resolveAccountActor(s,rawActor);
  if(actor.role!=='group'||!['finance','all'].includes(actor.job)||!canAccountView(actor,'service-finance'))fail('仅集团财务可核定原服务现金组成');
  if(type)assertAccountCommand(actor,type,p,s);
  return actor;
}
function context(s,entryId,key){
  const entry=unique(s.serviceFinanceEntries,entryId,'原资金条目'),booking=unique(s.bookings,entry.bookingId,'原预约');
  unique(s.stores,entry.storeId,'原门店');
  const payment=unique([booking.payment,...(booking.extensions||[])].filter(Boolean),entry.paymentId,'原支付');
  if(s.serviceFinanceEntries.filter(e=>e?.bookingId===entry.bookingId&&e?.paymentId===entry.paymentId).length!==1)fail('同一原支付的资金条目重复，先核原账');
  if(booking.storeId!==entry.storeId||payment.status!=='success'||entry.kind!==(payment===booking.payment?'main':'extension'))fail('原资金、主款/加钟与门店串号');
  if(!Number.isSafeInteger(entry.version)||entry.version<0||entry.version===Number.MAX_SAFE_INTEGER)fail('原资金版本缺失或不可递增');
  if(s.serviceFinanceCompositions!==undefined&&!Array.isArray(s.serviceFinanceCompositions)||s.serviceFinanceRequests!==undefined&&!Array.isArray(s.serviceFinanceRequests))fail('原核定或提交来源容器无效');
  const fact=serviceFinanceCashSource(s,entryId,key),candidates=serviceFinanceCompositionCandidates(s,entryId,key);
  if(fact.source.kind==='recovery'){
    const debt=unique(s.serviceFinanceRecoveries,fact.source.recoveryId,'原追偿'),record=unique(debt.records,fact.source.recordId,'原实际回款');
    if(record.id!==fact.source.sourceId)fail('原回款记录串号');
  }
  const refs=new Map();
  for(const other of s.serviceFinanceEntries||[])for(const tx of [other.split,...(other.splitHistory||[]),...(other.returns||[])].filter(Boolean)){
    if(tx.id===fact.source.sourceId||tx.requestNo===fact.actualReference){const value={entryId:other.id,id:tx.id,requestNo:tx.requestNo,kind:tx.kind,amountCents:tx.amountCents,status:tx.status,completedAt:tx.completedAt,createdAt:tx.createdAt};refs.set(digest(value),value);}
  }
  for(const debt of s.serviceFinanceRecoveries||[])for(const record of debt.records||[])if(record.reference===fact.actualReference){const value={entryId:debt.entryId,debtId:debt.id,id:record.id,reference:record.reference,amountCents:record.amountCents,occurredAt:record.occurredAt};refs.set(digest(value),value);}
  if(refs.size>1)fail('原现金编号或凭据号在其他来源重复冲突');
  return{entry,booking,payment,fact,candidates};
}
function sourceToken(s,c){
  const confirmations=s.serviceFinanceCompositions||[],identifiers=new Set(c.candidates.candidates.flatMap(x=>[x.row.id,x.row.requestId]).filter(Boolean));
  return digest({entry:c.entry,booking:c.booking,fact:c.fact,candidates:c.candidates,
    linkedConfirmations:confirmations.filter(r=>identifiers.has(r.id)||identifiers.has(r.requestId)),
    cashToken:serviceFinanceCompositionToken(s,c.entry.id),recoveries:(s.serviceFinanceRecoveries||[]).filter(r=>r.entryId===c.entry.id),
    invoices:(s.commerceInvoices||[]).filter(i=>i.category==='fee'&&i.storeId===c.entry.storeId),
    rules:(s.commerceInvoiceRules||[]).filter(r=>r.category==='fee'&&(!r.storeId||r.storeId===c.entry.storeId))});
}
function current(s,actor,entryId,key){const c=context(s,entryId,key);return{...c,actor,sourceToken:sourceToken(s,c)};}
function evidence(value){
  let rows=value;if(typeof rows==='string'){try{rows=JSON.parse(rows);}catch{fail('实际证据附件格式无效');}}
  if(!Array.isArray(rows)||!rows.length||rows.length>10)fail('请提供实际逐笔分类证据附件');
  const out=rows.map(f=>{if(!f||!/^invoice-file:[a-f0-9]{64}$/.test(f.ref||'')||!['application/pdf','image/png','image/jpeg'].includes(f.type)||!Number.isSafeInteger(f.size)||f.size<=0||f.size>5*1024*1024)fail('实际证据须为有效PDF或图片，最大5 MiB');return{ref:f.ref,name:text(f.name,'证据文件名',255),type:f.type,size:f.size};});
  if(new Set(out.map(f=>f.ref)).size!==out.length)fail('实际证据引用重复');return out;
}
function request(s,a,type,p){
  const requestId=text(p.requestId,'稳定提交标识',300),actorDigest=digest(actorFacts(a)),fingerprint=digest({type,p});
  const found=(s.serviceFinanceRequests||[]).filter(r=>r.requestId===requestId);
  if(found.length>1)fail('原提交标识重复冲突');const old=found[0];
  if(old&&(old.type!==type||old.actorDigest!==actorDigest||old.fingerprint!==fingerprint))fail('同一提交标识不能用于不同财务核定内容或账号');
  return{requestId,actorDigest,fingerprint,old};
}
function binding(s,rawActor,type,p){
  if(!types.has(type))fail('现金组成核定命令无效');const actor=authorize(s,rawActor,type,p),c=current(s,actor,p.id,p.sourceKey),req=request(s,actor,type,p);
  let previous=null;
  if(req.old){previous=unique(s.serviceFinanceCompositions,req.old.resultId,'原核定结果');if(req.old.resultToken!==digest(previous))fail('原核定结果冻结摘要已变化或缺失');if(previous.sourceFactsToken!==c.fact.sourceFactsToken||previous.actualAt!==c.fact.actualAt||previous.actualReference!==c.fact.actualReference||previous.source.entryId!==p.id||previous.requestId!==req.requestId)fail('原核定结果与当前现金事实已变化');}
  return{actor:actorFacts(actor),sourceToken:c.sourceToken,type,payload:digest(p),previous:previous&&digest(previous)};
}

export function serviceFinanceCompositionReview(s,rawActor,entryId,key){
  const actor=authorize(s,rawActor),blank={entryId,sourceKey:key,canConfirm:false,canReconcile:false,blockers:[]};
  try{
    const c=current(s,actor,entryId,key),projection=serviceFinanceComposition(s,entryId),row=projection.rows.find(r=>r.id===c.fact.id),known=c.candidates.candidates.some(x=>x.row.status==='known');
    const sourceErrors=c.candidates.errors.filter(e=>!e.includes('尚无已核H/Cs')&&!e.includes('冲突H/Cs核定'));
    const ready=c.fact.status==='success'&&c.fact.normalCents>0,conflict=known&&(!row||sourceErrors.length>0);
    const state=!ready?'query-original':sourceErrors.length&&sourceErrors.some(e=>e.includes('更正链')||e.includes('重复编号')||e.includes('现有原现金'))?'source-incomplete':row?'confirmed':conflict?'composition-conflict':'confirmable';
    const reasons=!ready?['仅核定实际成功且正常金额为正的原现金']:sourceErrors;
    return clone({...blank,entryVersion:c.entry.version,source:c.fact.source,facts:c.fact,state,
      blockers:reasons.map(reason=>({kind:state,sourceId:key,path:`serviceFinanceEntries:${entryId}/${key}`,reason,nextRoute:`/group/service-finance/entry/${encodeURIComponent(entryId)}`})),
      candidates:c.candidates.candidates.map(x=>({...x.ref,status:x.row.status,hCents:x.row.hCents??null,csCents:x.row.csCents??null,method:x.row.method})),supersedes:c.candidates.active,
      returnSources:projection.returnSources,allocationSources:ready&&c.fact.direction==='return'?serviceFinanceCompositionAllocationSources(s,entryId,key):[],invoiceImpacts:(s.commerceInvoices||[]).filter(i=>i.category==='fee'&&i.storeId===c.entry.storeId).map(i=>({id:i.id,version:i.version,month:i.month,status:i.status})),
      sourceToken:c.sourceToken,canConfirm:state==='confirmable'&&canAccountCommand(actor,'finance.composition-confirm'),canReconcile:['confirmed','composition-conflict'].includes(state)&&canAccountCommand(actor,'finance.composition-reconcile')});
  }catch(error){return{...blank,state:'source-incomplete',sourceToken:null,blockers:[{kind:'source-incomplete',sourceId:key,path:`serviceFinanceEntries:${entryId}`,reason:error.message,nextRoute:`/group/service-finance/entry/${encodeURIComponent(entryId)}`}]};}
}

export function authorizedServiceFinanceCompositionFile(s,rawActor,id,slot,ref){
  authorize(s,rawActor);const row=unique(s.serviceFinanceCompositions,id,'原组成核定');
  if(!row.source||!['split','return','recovery'].includes(row.source.kind))fail('原组成核定来源缺失');
  const key=row.source.kind==='recovery'?`recovery:${row.source.recoveryId}:${row.source.recordId}`:`${row.source.kind}:${row.source.sourceId}`,c=context(s,row.source.entryId,key);
  if(['entryId','bookingId','paymentId','storeId','kind','sourceId','recoveryId','recordId'].some(k=>(row.source[k]??null)!==(c.fact.source[k]??null)))fail('原核定与实际现金来源串号');
  const match=/^evidence:(0|[1-9]\d*)$/.exec(String(slot)),file=match&&row.evidenceRefs?.[Number(match[1])];
  if(!file||file.ref!==ref)fail('原组成核定附件槽已变化或不存在');return clone(evidence([file])[0]);
}

// The original prepared object, not a copied payload flag, proves this exact preflight read.
export async function prepareServiceFinanceCompositionEvidence(s,rawActor,type,p,{readFile,getState=()=>s}={}){
  const payload=clone(p),first=binding(getState(),rawActor,type,payload),refs=evidence(payload.evidenceRefs);
  if(typeof readFile!=='function')fail('实际组成证据文件读取尚未接入');
  const recheck=()=>{if(!same(first,binding(getState(),rawActor,type,payload)))fail('账号、原现金或证据在读取期间已变化');};
  for(const file of refs){
    recheck();const blob=await readFile(clone(file));recheck();
    if(!(blob instanceof Blob)||blob.size!==file.size||blob.type!==file.type)fail('实际证据不存在或元数据不符');
    const bytes=new Uint8Array(await blob.arrayBuffer());recheck();
    const valid=file.type==='application/pdf'?new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'&&new TextDecoder().decode(bytes.slice(-1024)).includes('%%EOF'):file.type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
    if(!valid)fail('实际证据格式不符或文件截断');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');recheck();
    if('invoice-file:'+hash!==file.ref)fail('实际证据字节与原引用不符');
  }
  const prepared={evidenceRefs:clone(refs)};proofs.set(prepared,{binding:first,refs:clone(refs)});return prepared;
}
export function createServiceFinanceCompositionEvidenceValidator(prepared){
  const verified=proofs.get(prepared);if(!verified)fail('实际组成证据预校验缺失或被复制');
  return(s,actor,type,p,refs)=>same(verified.refs,refs)&&same(verified.binding,binding(s,actor,type,p));
}

export function serviceFinanceCompositionReviewCommand(s,rawActor,type,p={},ctx={}){
  if(!types.has(type))return undefined;
  const actor=authorize(s,rawActor,type,p),c=current(s,actor,p.id,p.sourceKey),req=request(s,actor,type,p),refs=evidence(p.evidenceRefs);
  if(typeof ctx.validateCompositionEvidence!=='function'||ctx.validateCompositionEvidence(s,actor,type,p,refs)!==true)fail('缺少本次实际文件读取和来源绑定的可信核验');
  if(req.old){const row=unique(s.serviceFinanceCompositions,req.old.resultId,'原核定结果');binding(s,rawActor,type,p);return clone(row);}
  if((s.serviceFinanceCompositions||[]).some(row=>row.requestId===req.requestId))fail('独立历史核定已使用本提交标识，不能跨原source重复');
  if(integer(p.version,'原资金版本')!==c.entry.version||p.sourceToken!==c.sourceToken)fail('原现金、核定或票据依据已变化，请刷新核对');
  if(c.fact.status!=='success'||c.fact.normalCents<=0||!Number.isSafeInteger(c.fact.actualAt))fail('只能核定真实成功且正常金额为正的原现金');
  if(p.method!==undefined&&p.method!=='verified-history'||p.allocationPolicySnapshot!==undefined||p.allocationAuthorityId!==undefined)fail('正式分配批准来源尚未接入，不默认批准混合分配');
  const hCents=integer(p.hCents,'本笔H'),csCents=integer(p.csCents,'本笔Cs'),retainedCsCents=p.retainedCsCents==null?null:integer(p.retainedCsCents,'保留Cs');
  if(!Number.isSafeInteger(hCents+csCents)||hCents+csCents!==c.fact.normalCents||retainedCsCents!==null&&retainedCsCents>csCents)fail('H/Cs合计须精确等于原正常现金，保留额不能超过Cs');
  const basisReference=text(p.basisReference,'逐笔历史分类凭据号',120),basisDescription=text(p.basisDescription,'逐笔历史分类依据'),reason=text(p.reason,'核对原因');
  let allocations=p.allocations;if(typeof allocations==='string'){try{allocations=JSON.parse(allocations);}catch{fail('原收入份额格式无效');}}
  if(!Array.isArray(allocations))fail('请提供原收入份额数组');
  allocations=allocations.map(x=>({incomeSourceId:text(x?.incomeSourceId,'原收入编号',300),incomeRequestNo:text(x?.incomeRequestNo,'原收入凭据号',120),hCents:integer(x?.hCents,'原收入H份额'),csCents:integer(x?.csCents,'原收入Cs份额')}));
  const active=c.candidates.active,known=c.candidates.candidates.some(x=>x.row.status==='known');
  if(type==='finance.composition-confirm'&&(known||p.supersedes!==undefined))fail('原款已有核定或显式更正，请从原更正入口核对');
  let reconciliation,version=1;
  if(type==='finance.composition-reconcile'){
    if(!active.length||!Array.isArray(p.supersedes)||!same([...p.supersedes].sort((a,b)=>a.key.localeCompare(b.key)),[...active].sort((a,b)=>a.key.localeCompare(b.key))))fail('更正必须精确引用全部当前候选及版本');
    if(c.candidates.errors.some(e=>e.includes('更正链')||e.includes('重复编号')||e.includes('现有原现金')))fail('原核定链或来源已损坏，先核原账');
    if(c.candidates.selected&&!c.candidates.errors.length&&same({hCents,csCents,retainedCsCents,allocations},{hCents:c.candidates.selected.hCents,csCents:c.candidates.selected.csCents,retainedCsCents:c.candidates.selected.retainedCsCents??null,allocations:c.candidates.selected.allocations}))fail('组成与有效原核定相同，无需重复更正');
    version=1+Math.max(0,...active.map(x=>x.version??0));reconciliation={schema:1,supersedes:clone(p.supersedes)};
  }
  if(typeof ctx.id!=='function')fail('原核定唯一编号生成尚未接入');
  // Validate a trial append before any original state/container write or id allocation.
  const row={schema:1,...c.fact,id:'__composition_trial__',requestId:req.requestId,version,status:'known',hCents,csCents,retainedCsCents,allocations,method:'verified-history',allocationPolicySnapshot:null,
    by:actorFacts(actor),recordedAt:s.now,basisReference,basisDescription,reason,evidenceRefs:refs,...(reconciliation?{reconciliation}:{})};
  const trial=clone(s);trial.serviceFinanceCompositions??=[];trial.serviceFinanceCompositions.push(row);
  const projected=serviceFinanceComposition(trial,p.id),checked=projected.rows.find(x=>x.id===c.fact.id);
  if(!checked||checked.hCents!==hCents||checked.csCents!==csCents)fail(projected.errors[0]||'本笔组成、原收入份额或未知占额仍待核对');
  row.id=ctx.id('SFC');if(typeof row.id!=='string'||!row.id||row.id==='__composition_trial__'||(s.serviceFinanceCompositions||[]).some(x=>x.id===row.id))fail('原核定编号重复或无效');
  s.serviceFinanceCompositions??=[];s.serviceFinanceRequests??=[];s.serviceFinanceCompositions.push(row);
  c.entry.version++;(c.entry.history??=[]).push({at:s.now,version:c.entry.version,action:type==='finance.composition-reconcile'?'更正原现金组成，保留原账和旧核定':'核定历史现金组成，保留原账',actor:actorFacts(actor),compositionId:row.id,sourceKey:c.fact.id,reason});
  const resultRequest={requestId:req.requestId,type,actorDigest:req.actorDigest,fingerprint:req.fingerprint,digestAlgorithm:'SHA-256',resultId:row.id,at:s.now};
  s.serviceFinanceRequests.push(resultRequest);
  ctx.log?.(row,'原现金组成核定 '+row.id);
  resultRequest.resultToken=digest(row);return clone(row);
}
