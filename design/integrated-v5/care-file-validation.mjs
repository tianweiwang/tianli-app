// Reads actual local photo bytes; returned evidence exists only for the outer source transaction.
import { careCommand, careEvidenceRefs, careEvidenceFile } from './service-care.mjs';
import { resolveAccountActor, assertAccountCommand } from './staff-accounts.mjs';
import { assertPrivacyCommand, privacyUseClosed } from './privacy.mjs';
import { closedRightsBinding } from './privacy-closed-rights.mjs';
import { readInvoiceFile, validateInvoiceFile } from './invoice-files.mjs';

const copy = x => structuredClone(x), fail = message => { throw new Error(message); };
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(key => [key,canonical(x[key])])) : x;
const sig = x => JSON.stringify(canonical(x));
const same = (a,b) => sig(a) === sig(b);
function identity(a) {
  return a.role === 'user' ? {role:a.role,userId:a.userId} : a.role === 'tech' ? {role:a.role,techId:a.techId} : {role:a.role,job:a.job || null,storeId:a.storeId || null,accountId:a.accountId || null,grantId:a.grantId || null,sessionId:a.sessionId || null};
}
function unique(list,id,label) {
  const matches = (list || []).filter(x => x.id === id);
  if (typeof id !== 'string' || !id || id.trim() !== id || matches.length !== 1) fail(`${label}缺失或编号不唯一`);
  return matches[0];
}
const defaultUserScope = (s,a,kind,id) => { if (privacyUseClosed(s,a.userId)) closedRightsBinding(s,a,kind,id); };
function authorMatches(by,a) {
  const id = a.role === 'user' ? a.userId : a.role === 'tech' ? a.techId : ['store','manager'].includes(a.role) ? a.storeId : 'group';
  return by?.role === a.role && by.id === id && by.accountId === a.accountId && by.grantId === a.grantId;
}
function plan(context,type,p,files,assertCommandScope,assertUserScope) {
  if (!context?.state || !context.actor) fail('当前投诉图片核验上下文已失效');
  const s = context.state, actor = resolveAccountActor(s,context.actor);
  assertAccountCommand(actor,type);
  const checked = assertCommandScope(s,actor,type,p);
  if (checked === false) fail('原投诉图片命令范围核验拒绝');
  if (checked?.then) fail('投诉图片命令范围核验必须同步完成');
  const original = type === 'care.case-statement' ? unique(s.serviceCareCases,p.id,'原案件') : null;
  const b = unique(s.bookings,original?.bookingId || p.bookingId,'原预约');
  // Original behavior runs in an isolated copy only. No preview state or request is committed.
  const isolated = copy(s);
  const row = careCommand(isolated,actor,type,p,{fail,id:prefix=>prefix+(++isolated.seq),log(){},validateEvidenceRefs:()=>true});
  const replay = (isolated.serviceCareRequests || []).length === (s.serviceCareRequests || []).length;
  let slots = [];
  if (replay && files.length) {
    const live = unique(s.serviceCareCases,row.id,'原重放案件');
    if (type === 'care.case-create') slots = files.map((file,index)=>({slot:`evidence:${index}`,file}));
    else {
      const statements = (live.statements || []).filter(x=>x.requestId === p.requestId && authorMatches(x.by,actor));
      if (statements.length !== 1) fail('原图片补充的稳定来源缺失或不唯一');
      slots = files.map((file,index)=>({slot:`statement:${statements[0].id}:${index}`,file}));
    }
    for (const item of slots) {
      const actual = careEvidenceFile(s,actor,live.id,item.slot,{assertUserScope});
      if (!same(careEvidenceRefs([actual])[0],item.file)) fail('原重放图片槽或元数据已变化');
      item.sourceToken = actual.sourceToken;
    }
  }
  return {binding:{actor:identity(actor),booking:copy(b),case:original?copy(original):null,replay,resultId:replay?row.id:null,slots,closed:actor.role === 'user'?privacyUseClosed(s,actor.userId):null,requestRows:(s.serviceCareRequests || []).filter(x=>x.requestId === p.requestId).map(copy)},actor};
}

export async function prepareCareEvidence(s,rawActor,type,p = {},{
  readFile = readInvoiceFile, validateFile = validateInvoiceFile,
  currentContext = () => ({state:s,actor:rawActor}),
  assertCommandScope = assertPrivacyCommand, assertUserScope = defaultUserScope
} = {}) {
  if (!['care.case-create','care.case-statement'].includes(type)) return {evidenceRefs:[]};
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('原投诉图片载荷格式无效');
  const payload = copy(p), files = careEvidenceRefs(payload.evidenceRefs);
  if (typeof currentContext !== 'function' || typeof assertCommandScope !== 'function') fail('当前投诉图片原来源核验尚未接入');
  const requested = identity(resolveAccountActor(s,rawActor));
  const initial = plan(currentContext(),type,payload,files,assertCommandScope,assertUserScope), baseline = copy(initial.binding);
  if (!same(requested,baseline.actor)) fail('投诉图片核验身份已改变');
  const recheck = () => {
    if (!same(baseline,plan(currentContext(),type,payload,files,assertCommandScope,assertUserScope).binding)) fail('当前账号、原案件、预约或图片槽在核验期间已变化');
  };
  const evidenceRefs = [];
  if (files.length && (typeof readFile !== 'function' || typeof validateFile !== 'function')) fail('投诉图片实际文件读取或验证尚未接入');
  for (const file of files) {
    recheck(); const blob = await readFile(copy(file)); recheck();
    if (!(blob instanceof Blob) || blob.size !== file.size || blob.type !== file.type) fail('实际投诉图片缺失或元数据与文件不一致');
    const bytes = await validateFile(blob); recheck();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.size) fail('实际投诉图片验证没有返回原文件字节');
    const digest = await crypto.subtle.digest('SHA-256',bytes); recheck();
    const hash = [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
    if (`invoice-file:${hash}` !== file.ref) fail('实际投诉图片摘要与原附件引用不一致');
    evidenceRefs.push(copy(file));
  }
  recheck(); return {evidenceRefs};
}
