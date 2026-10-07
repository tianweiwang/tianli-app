// Actual local qualification files only. No preview copy or evidence is persisted here.
import { qualificationCommand, qualificationEvidenceRefs, qualificationEvidenceFile } from './tech-qualification.mjs';
import { resolveAccountActor, assertAccountCommand } from './staff-accounts.mjs';
import { assertPrivacyCommand } from './privacy.mjs';
import { readInvoiceFile, validateInvoiceFile } from './invoice-files.mjs';

const TYPES = new Set(['qualification.assess','qualification.request','qualification.review','qualification.pause','qualification.resume']);
const copy = value => structuredClone(value), fail = message => { throw new Error(message); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const sig = value => JSON.stringify(canonical(value)), same = (a,b) => sig(a) === sig(b);
const identity = a => ({role:a?.role,job:a?.job || null,storeId:a?.storeId || null,techId:a?.techId || null,userId:a?.userId || null,accountId:a?.accountId || null,grantId:a?.grantId || null,sessionId:a?.sessionId || null});
function unique(rows,id,label) {
  const matches=(rows || []).filter(row=>row.id===id);
  if(typeof id!=='string'||!id||id.trim()!==id||matches.length!==1)fail(`${label}缺失或编号不唯一`);
  return matches[0];
}
function plan(context,type,p,files,assertCommandScope) {
  if(!context?.state||!context.actor)fail('当前资格凭证核验上下文已失效');
  const s=context.state,actor=resolveAccountActor(s,context.actor);
  assertAccountCommand(actor,type);
  const allowed=assertCommandScope(s,actor,type,p);
  if(allowed===false)fail('原资格命令范围核验拒绝');
  if(allowed?.then)fail('资格命令范围核验必须同步完成');
  const person=unique(s.techs,p.techId,'原技师'),storeId=p.storeId||person.storeId,store=unique(s.stores,storeId,'原资格门店');
  const rows=(s.techQualifications || []).filter(row=>row.techId===person.id&&row.storeId===storeId);
  const profileId=p.profileId||(storeId===person.storeId?person.qualificationProfileId:null);
  const profile=profileId?unique(rows,profileId,'原资格档案'):rows.length===1?rows[0]:null;
  if(profile)unique(s.techQualifications,profile.id,'原资格档案');
  // Execute the existing command guard in a detached copy, never an alternate business algorithm.
  const isolated=copy(s),row=qualificationCommand(isolated,actor,type,p,{fail,id:prefix=>prefix+(++isolated.seq),log(){},validateEvidenceRefs:()=>true});
  const replay=(isolated.techQualificationRequests || []).length===(s.techQualificationRequests || []).length;
  let slots=[];
  if(replay&&files.length){
    const requests=(s.techQualificationRequests || []).filter(request=>request.requestId===p.requestId&&request.techId===row.techId&&request.profileId===row.id&&request.fingerprint===sig({type,p}));
    if(requests.length!==1||!Number.isSafeInteger(requests[0].evidenceVersion))fail('原资格文件提交来源缺失或不唯一');
    slots=files.map((file,index)=>({file,slot:`history:${requests[0].evidenceVersion}:${index}`}));
    for(const item of slots){const actual=qualificationEvidenceFile(s,actor,row.id,item.slot);if(!same(qualificationEvidenceRefs([actual])[0],item.file))fail('原资格重放附件槽或元数据已变化');item.sourceToken=actual.sourceToken;}
  }
  const services=(s.services || []).filter(service=>(person.serviceIds || []).includes(service.id)||profile?.assessments?.some(assessment=>assessment.serviceIds?.includes(service.id)));
  return {actor,binding:{actor:identity(actor),person:copy(person),store:copy(store),profiles:copy(rows),services:copy(services),replay,slots,sourceCases:copy((s.serviceCareCases || []).filter(item=>item.id===p.caseId||profile?.holds?.some(hold=>hold.source?.caseId===item.id))),bookings:copy((s.bookings || []).filter(booking=>booking.techId===person.id||booking.change?.techId===person.id)),requests:copy((s.techQualificationRequests || []).filter(request=>request.requestId===p.requestId))}};
}
export async function prepareQualificationEvidence(s,rawActor,type,p={}, {
  readFile=readInvoiceFile,validateFile=validateInvoiceFile,
  currentContext=()=>({state:s,actor:rawActor}),assertCommandScope=assertPrivacyCommand
}={}) {
  if(!TYPES.has(type))return{evidenceRefs:[]};
  if(!p||typeof p!=='object'||Array.isArray(p))fail('原资格凭证载荷格式无效');
  const payload=copy(p),files=qualificationEvidenceRefs(payload.evidenceRefs);
  if(typeof currentContext!=='function'||typeof assertCommandScope!=='function')fail('当前资格凭证原来源核验尚未接入');
  const requested=identity(resolveAccountActor(s,rawActor)),initial=plan(currentContext(),type,payload,files,assertCommandScope),baseline=copy(initial.binding);
  if(!same(requested,baseline.actor))fail('资格凭证核验身份已改变');
  const recheck=()=>{if(!same(baseline,plan(currentContext(),type,payload,files,assertCommandScope).binding))fail('当前账号、技师、资格档案或附件槽在核验期间已变化');};
  if(files.length&&(typeof readFile!=='function'||typeof validateFile!=='function'))fail('资格凭证实际文件读取或验证尚未接入');
  const evidenceRefs=[];
  for(const file of files){
    recheck();const blob=await readFile(copy(file));recheck();
    if(!(blob instanceof Blob)||blob.size!==file.size||blob.type!==file.type)fail('实际资格凭证缺失或元数据与文件不一致');
    const bytes=await validateFile(blob);recheck();
    if(!(bytes instanceof Uint8Array)||bytes.byteLength!==file.size)fail('实际资格凭证验证没有返回原文件字节');
    const digest=await crypto.subtle.digest('SHA-256',bytes);recheck();
    const hash=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
    if(`invoice-file:${hash}`!==file.ref)fail('实际资格凭证摘要与原附件引用不一致');
    evidenceRefs.push(copy(file));
  }
  recheck();return{evidenceRefs};
}
