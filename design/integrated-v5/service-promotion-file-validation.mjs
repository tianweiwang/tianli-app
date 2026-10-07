// Actual files for a current promotion command; returns a transaction-local collection only.
import { resolveAccountActor, assertAccountCommand, actorAccountFields } from './staff-accounts.mjs';
import { authorizedServicePromotionFile } from './service-promotion.mjs';
import { createTechHistoricalRightsAdapters } from './tech-historical-rights.mjs';

const COMMANDS = new Set(['risk-review','policy-publish','rule-publish','agreement-publish','invite','invite-confirm','disable','identity-review','transfer-authorize','enter','clear-expired','withdraw-create','withdraw-pay','withdraw-query','withdraw-confirm','withdraw-cancel','recovery-receive','recovery-return','recovery-loss']);
const PROOF = new Set(['risk-review','agreement-publish','identity-review','withdraw-pay','withdraw-query','recovery-receive','recovery-return','recovery-loss']);
const TYPES = new Set(['application/pdf','image/png','image/jpeg']), LIMIT = 5 * 1024 * 1024;
const clone = x => structuredClone(x), rows = (s,k) => Array.isArray(s[k]) ? s[k] : [];
const fail = message => { throw new Error(message); };
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k,canonical(x[k])])) : x;
const signature = x => JSON.stringify(canonical(x)), same = (a,b) => signature(a) === signature(b);
const group = (a,jobs) => a?.role === 'group' && jobs.includes(a.job), finance = a => group(a,['finance','all']), support = a => group(a,['support','all']), operations = a => group(a,['operations','all']), manager = a => a?.role === 'store' && a.job === 'store-manager';
const owned = (a,r) => Boolean(r && a?.role === r.personKind && (a.role === 'user' ? a.userId : a.techId) === r.personId);
const personKey = r => `${r.personKind}:${r.personId}`;
const who = a => ({role:a.role,job:a.job || null,id:a.userId || a.techId || a.storeId || 'group',...actorAccountFields(a)});
const financeWho = a => ({role:a.role,job:a.job || null,id:a.role === 'group' ? 'group' : a.storeId || a.userId || a.techId,...actorAccountFields(a)});
const requestId = (p,max=120) => { if (typeof p.requestId !== 'string' || !p.requestId.trim() || p.requestId.trim().length > max) fail('请填写原操作的稳定提交标识。'); return p.requestId.trim(); };
function unique(list,id,label) { const found = list.filter(x => x?.id === id); if (typeof id !== 'string' || !id.trim() || found.length !== 1) fail(`${label}缺失或编号不唯一。`); return found[0]; }
function metadata(x) {
  if (!x || typeof x !== 'object' || !/^invoice-file:[a-f0-9]{64}$/.test(x.ref || '') || !TYPES.has(x.type)) fail('证据须引用实际PDF或PNG、JPEG文件。');
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.trim().length > 255) fail('实际证据文件名无效。');
  if (!['number','string'].includes(typeof x.size) || !String(x.size).trim() || !Number.isSafeInteger(Number(x.size)) || Number(x.size) < 1 || Number(x.size) > LIMIT) fail('实际证据文件大小无效。');
  return {ref:x.ref,name:x.name.trim(),type:x.type,size:Number(x.size)};
}
function references(value) { let list = value; if (typeof list === 'string') { try { list = JSON.parse(list); } catch { fail('实际附件引用格式无效。'); } } if (!Array.isArray(list) || !list.length || list.length > 10) fail('请提供实际证据附件。'); return list.map(metadata); }
function dedup(list) { const found = new Map(); for (const f of list) { if (found.has(f.ref) && !same(found.get(f.ref),f)) fail('同一实际附件引用的元数据冲突。'); found.set(f.ref,f); } return [...found.values()]; }
async function digestBytes(bytes) { if (!globalThis.crypto?.subtle?.digest) fail('当前运行环境无法核验实际附件摘要。'); return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(x => x.toString(16).padStart(2,'0')).join(''); }
const digest = x => digestBytes(new TextEncoder().encode(signature(x)));
function checkSignature(buffer,type) {
  const bytes = new Uint8Array(buffer);
  const valid = type === 'application/pdf' ? new TextDecoder().decode(bytes.slice(0,5)) === '%PDF-' && new TextDecoder().decode(bytes.slice(-1024)).includes('%%EOF') : type === 'image/png' ? [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (!valid) fail('实际证据内容与PDF或图片格式不符。');
}
function boundPromoter(s,r) {
  if (!r || !['user','tech'].includes(r.personKind)) fail('原个人推广身份来源缺失。');
  const person = unique(rows(s,r.personKind === 'user' ? 'users' : 'techs'),r.personId,'原推广本人');
  if (!['store','group'].includes(r.ownerType) || r.ownerType === 'store' && !rows(s,'stores').some(x => x.id === r.ownerStoreId)) fail('原推广所属方缺失。');
  return {promoter:r,person}; // The person's current store does not replace an old promoter's owner.
}
function paymentSource(s,bookingId,paymentId) {
  const booking = unique(rows(s,'bookings'),bookingId,'原服务订单'), payment = unique([booking.payment,...(booking.extensions || [])].filter(Boolean),paymentId,'原服务支付');
  if (!rows(s,'stores').some(x => x.id === booking.storeId) || !rows(s,'users').some(x => x.id === booking.userId)) fail('原服务门店或预约本人来源缺失。');
  return {booking,payment};
}
function snapshotSource(s,b,p) {
  const snapshot = p === b.payment ? b.servicePromotionSnapshot : p.servicePromotionSnapshot || b.servicePromotionSnapshot;
  if (!snapshot?.promoter?.id) fail('原服务支付的个人推广快照缺失。');
  const promoter = unique(rows(s,'servicePromoters'),snapshot.promoter.id,'原推广身份'); boundPromoter(s,promoter);
  if (snapshot.promoter.personKind !== promoter.personKind || snapshot.promoter.personId !== promoter.personId || snapshot.promoter.ownerType !== promoter.ownerType || snapshot.promoter.ownerStoreId !== promoter.ownerStoreId) fail('原订单推广快照与真实身份、所属方不一致。');
  return {snapshot,promoter};
}
function commissionSource(s,c) {
  const source = paymentSource(s,c.bookingId,c.paymentId), promotion = snapshotSource(s,source.booking,source.payment);
  if (c.promoterId !== promotion.promoter.id || c.personKey !== personKey(promotion.promoter) || c.storeId !== source.booking.storeId || c.userId != null && c.userId !== source.booking.userId || c.sourceSnapshot?.promoter?.id && c.sourceSnapshot.promoter.id !== c.promoterId) fail('原佣金与服务支付或推广身份串号。');
  return {commission:c,...source,...promotion};
}
function financeContext(s,rawActor,p,selection=false) {
  const debt = rows(s,'serviceFinanceRecoveries').find(x => x.id === p.id), entry = debt && rows(s,'serviceFinanceEntries').find(x => x.id === debt.entryId), b = entry && rows(s,'bookings').find(x => x.id === entry.bookingId);
  // Non-promotion legacy receipts stay with the original finance command.
  if (!entry?.servicePromotionSnapshot?.promoter && !b?.servicePromotionSnapshot?.promoter && !(b?.extensions || []).some(x => x.id === entry?.paymentId && x.servicePromotionSnapshot?.promoter)) { if (debt?.reasonCode === 'finished-adjustment') fail('原推广补差追偿的真实快照来源缺失。'); return null; }
  const actor = resolveAccountActor(s,rawActor); assertAccountCommand(actor,'finance.recovery-receive'); if (!finance(actor)) fail('当前岗位无权核验个人推广关联的原服务财务追偿。');
  unique(rows(s,'serviceFinanceRecoveries'),p.id,'原服务财务追偿'); unique(rows(s,'serviceFinanceEntries'),debt.entryId,'原服务资金行');
  const source = paymentSource(s,entry.bookingId,entry.paymentId), promotion = snapshotSource(s,source.booking,source.payment);
  if (debt.bookingId !== entry.bookingId || debt.paymentId !== entry.paymentId || debt.storeId !== entry.storeId || entry.storeId !== source.booking.storeId || entry.userId != null && entry.userId !== source.booking.userId || entry.servicePromotionSnapshot?.promoter?.id && entry.servicePromotionSnapshot.promoter.id !== promotion.promoter.id) fail('原财务追偿与服务支付、推广来源串号。');
  if (!['unshared-release','offline-adjustment','return-failed'].includes(debt.type) || debt.payer !== (debt.type === 'unshared-release' ? `store:${debt.storeId}` : 'group') || debt.payee !== (debt.type === 'unshared-release' ? 'group' : `store:${debt.storeId}`)) fail('原服务财务追偿收付双方缺少依据。');
  return {actor,row:debt,source:{entry,...source,...promotion},requestRows:selection?[]:rows(s,'serviceFinanceRequests').filter(x => x.requestId === requestId(p,500))};
}
function context(s,rawActor,command,p,selection=false) {
  const actor = resolveAccountActor(s,rawActor); assertAccountCommand(actor,`service-promotion.${command}`);
  let r, invite, w, d, risk, row, source;
  if (p.promoterId || ['disable','identity-review','transfer-authorize'].includes(command)) r = rows(s,'servicePromoters').find(x => x.id === (p.promoterId || p.id));
  if (command === 'invite-confirm') invite = rows(s,'servicePromotionInvites').find(x => x.id === p.id);
  if (command.startsWith('withdraw-') && command !== 'withdraw-create') w = rows(s,'servicePromotionWithdrawals').find(x => x.id === p.id);
  if (command.startsWith('recovery-')) d = rows(s,'servicePromotionRecoveries').find(x => x.id === p.id);
  if (command === 'risk-review') risk = rows(s,'servicePromotionRisks').find(x => x.id === p.id);
  const subject = w ? rows(s,'servicePromoters').find(x => x.id === w.promoterId) : invite || r;
  const historicalOwner=actor.role==='user'&&subject?.personKind==='tech'&&['withdraw-create','withdraw-confirm','withdraw-cancel'].includes(command)
    ? createTechHistoricalRightsAdapters().assertCommand(s,actor,`service-promotion.${command}`,p) : null;
  const ownerMatches=owned(actor,subject)||Boolean(historicalOwner?.allowed&&historicalOwner.techId===subject?.personId);
  const allowed = command === 'risk-review' ? risk && support(actor) : ['policy-publish','rule-publish','withdraw-pay','withdraw-query','recovery-receive','recovery-return','recovery-loss'].includes(command) ? finance(actor) : command === 'agreement-publish' ? support(actor) || operations(actor) : command === 'invite' ? operations(actor) || manager(actor) : command === 'invite-confirm' ? invite && owned(actor,invite) : command === 'disable' ? r && (operations(actor) || manager(actor) && r.ownerType === 'store' && r.ownerStoreId === actor.storeId) : command === 'identity-review' ? r && support(actor) : command==='transfer-authorize' ? r&&owned(actor,r) : command==='withdraw-create' ? r&&ownerMatches : ['withdraw-confirm','withdraw-cancel'].includes(command) ? w && ownerMatches : ['enter','clear-expired'].includes(command) ? actor?.role === 'user' && rows(s,'users').some(x => x.id === actor.userId) : false;
  if (!allowed) fail('当前岗位或本人范围无权办理服务推广事项。');
  if (r) { unique(rows(s,'servicePromoters'),r.id,'原推广身份'); source = boundPromoter(s,r); row = r; if (['disable','identity-review','transfer-authorize'].includes(command) && p.id && p.id !== r.id) fail('原推广身份编号串号。'); }
  if (invite) { unique(rows(s,'servicePromotionInvites'),invite.id,'原邀请'); unique(rows(s,'users'),invite.personId,'原邀请本人'); row = invite; }
  if (risk) {
    unique(rows(s,'servicePromotionRisks'),risk.id,'原异常审核'); const b = unique(rows(s,'bookings'),risk.bookingId,'原风险服务订单'), pay = b.payment; if (!pay) fail('原风险支付来源缺失。'); source = { ...paymentSource(s,b.id,pay.id),...snapshotSource(s,b,pay) };
    if (risk.promoterId !== source.promoter.id || risk.userId !== b.userId || risk.storeId !== b.storeId || risk.source?.reference !== risk.reference || risk.source?.kind !== risk.kind) fail('原风险审核与真实订单来源串号。'); row = risk;
  }
  if (w) {
    unique(rows(s,'servicePromotionWithdrawals'),w.id,'原个人提现'); const promoter = unique(rows(s,'servicePromoters'),w.promoterId,'原提现身份'); const owner = boundPromoter(s,promoter);
    if (w.personKind !== promoter.personKind || w.personId !== promoter.personId || w.personKey !== personKey(promoter) || w.ownerType !== promoter.ownerType || w.ownerStoreId !== promoter.ownerStoreId || !Array.isArray(w.allocations) || !w.allocations.length) fail('原提现本人、所属方或佣金明细来源缺失。');
    const commissions = w.allocations.map(a => commissionSource(s,unique(rows(s,'serviceCommissions'),a.commissionId,'原提现佣金')));
    if (commissions.some(c => c.commission.personKey !== w.personKey)) fail('原提现混入另一人的佣金来源。'); source = {...owner,commissions}; row = w;
  }
  if (d) {
    unique(rows(s,'servicePromotionRecoveries'),d.id,'原个人退佣扣回'); const c = unique(rows(s,'serviceCommissions'),d.commissionId,'原退佣来源'); source = commissionSource(s,c);
    if (d.bookingId !== c.bookingId || d.paymentId !== c.paymentId || d.promoterId !== c.promoterId || d.personKey !== c.personKey || d.storeId !== c.storeId) fail('原退佣扣回与佣金支付来源串号。'); row = d;
  }
  if (['disable','identity-review','transfer-authorize','withdraw-create'].includes(command) && !r || command.startsWith('withdraw-') && command !== 'withdraw-create' && !w || command.startsWith('recovery-') && !d) fail('服务推广资金来源不存在。');
  if (command === 'agreement-publish' && !['staff','store-promoter','group-promoter'].includes(p.promoterType)) fail('实际协议推广类型无效。');
  if (manager(actor) && !rows(s,'stores').some(x => x.id === actor.storeId)) fail('原所属门店不存在。');
  return {actor,row:row || null,source:source || null,requestRows:!selection&&PROOF.has(command) ? rows(s,'servicePromotionRequests').filter(x => x.requestId === requestId(p)) : []};
}
// Read-only selection. Original preparation retains its full proof/request
// checks; an empty ticket/reference/decision does not create a business result.
export function servicePromotionUploadScope(s,rawActor,type,p={}) {
  const financeMode=type==='finance.recovery-receive',command=typeof type==='string'&&type.startsWith('service-promotion.')?type.slice(18):'';
  if(!financeMode&&!PROOF.has(command))fail('该原推广表单没有新增实际文件用途。');
  const actual=financeMode?financeContext(s,rawActor,p,true):context(s,rawActor,command,p,true);
  if(!actual)fail('该原财务事项没有个人推广实际文件用途。');
  const prior=command==='agreement-publish'?rows(s,'servicePromotionAgreements').filter(row=>row.promoterType===p.promoterType).sort((a,b)=>b.version-a.version)[0]:actual.row;
  const expected=prior?.version||0;
  if(!['number','string'].includes(typeof p.version)||!String(p.version).trim()||!Number.isSafeInteger(Number(p.version))||Number(p.version)!==expected)fail('原推广或财务版本已变化，请刷新选择。');
  if(command==='agreement-publish'&&prior)unique(rows(s,'servicePromotionAgreements'),prior.id,'原协议版本');
  return clone({...actual,priorAgreement:command==='agreement-publish'?prior||null:null});
}
function proofMatches(facts,p,expected) {
  const at = typeof p.occurredAt === 'number' ? p.occurredAt : typeof p.occurredAt === 'string' ? Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(p.occurredAt) ? p.occurredAt : `${p.occurredAt}+08:00`) : NaN;
  return facts && facts.reference === p.reference?.trim() && facts.occurredAt === at && (facts.reason ?? null) === (p.reason?.trim() || null) && same(references(facts.evidenceRefs),expected);
}
function reviewPosition(row,historyKey,currentKey,action,previous,actor) {
  const audits = (row.history || []).filter(h => h.action === action), index = audits.findIndex(h => h.version === previous.result.version && h.at === previous.at && same(h.by,who(actor)));
  if (index < 0 || audits.filter(h => h.version === previous.result.version).length !== 1) fail('原审核提交缺少对应的实际版本历史。');
  const history = row[historyKey] || [], absolute = history.length + 1 - audits.length + index;
  if (absolute < 0 || absolute > history.length) fail('原审核附件历史不完整。');
  return {facts:absolute === history.length ? row[currentKey] : history[absolute],index:absolute === history.length ? null : absolute};
}
function replaySlots(s,c,command,p,previous,expected) {
  const {actor,row} = c; let holder, id = row?.id, prefix;
  if (!previous.result || typeof previous.result.id !== 'string') fail('原提交结果来源缺失。');
  if (command === 'agreement-publish') { holder = unique(rows(s,'servicePromotionAgreements'),previous.result.id,'原协议版本'); id = holder.id; prefix = 'agreement'; if (holder.version !== previous.result.version || holder.promoterType !== p.promoterType || holder.title !== p.title?.trim() || holder.body !== p.body?.trim()) fail('原协议提交内容或版本已变化。'); }
  else if (command === 'risk-review' || command === 'identity-review') {
    if (previous.result.id !== row.id) fail('原审核结果与提交来源串号。');
    const risk = command === 'risk-review', located = reviewPosition(row,risk ? 'reviewHistory' : 'identityHistory',risk ? 'review' : 'identity',risk ? '审核原异常佣金资格，保留实际支付及归属' : '核验个人实名来源，不存身份证正文',previous,actor); holder = located.facts;
    prefix = risk ? located.index == null ? 'risk-review' : `risk-history:${located.index}` : located.index == null ? 'identity' : `identity-history:${located.index}`;
    if (!holder || (risk ? holder.decision : holder.status) !== p.decision) fail('原审核结论与实际附件槽不一致。');
  } else if (command.startsWith('withdraw-')) {
    if (previous.result.id !== row.id) fail('原提现结果与提交来源串号。');
    const audits = (row.history || []).filter(h => h.action === '登记或查询原个人转账实际结果，成功才记已付'), index = audits.findIndex(h => h.version === previous.result.version && h.at === previous.at && same(h.by,who(actor)));
    const result = row.execution?.results?.[index];
    if (index < 0 || !result || result.at !== previous.at || result.operation !== (command === 'withdraw-query' ? 'query' : 'pay') || result.outcome !== p.outcome || !same(result.by,who(actor))) fail('原转账结果缺少对应的实际版本历史。');
    holder = p.outcome === 'success' ? row.execution.proof : result.facts; prefix = p.outcome === 'success' ? 'payment' : `result:${index}`;
  } else {
    if (previous.result.id !== row.id) fail('原扣回结果与提交来源串号。');
    const found = (row.records || []).filter(r => r.reference === p.reference?.trim() && r.at === previous.at && r.kind === (command === 'recovery-return' ? 'return' : command === 'recovery-loss' ? 'loss' : 'cash') && r.amountCents === Number(p.amountCents) && same(r.by,who(actor)));
    if (found.length !== 1) fail('原收付或审批提交缺少唯一实际记录。'); holder = found[0]; unique(row.records,holder.id,'原收付记录'); prefix = `record:${holder.id}`;
  }
  if (!proofMatches(holder,p,expected)) fail('原实际证据或核对依据与提交内容不一致。');
  return expected.map((file,index) => ({domain:'service-promotion',id,slot:`${prefix}:${index}`,file}));
}
function plan(s,rawActor,command,p,key,financeMode=false) {
  const c = financeMode ? financeContext(s,rawActor,p) : context(s,rawActor,command,p);
  if (!c) return {files:[],binding:null};
  let previous, slots = [], expected = [];
  if (financeMode) {
    const found = c.requestRows.filter(r => r.actor === signature(financeWho(c.actor)));
    if (found.length > 1) fail('原服务财务提交标识不唯一。'); previous = found[0];
    if (previous && previous.fingerprint !== signature({type:'finance.recovery-receive',p})) fail('同一提交标识不能用于不同服务资金内容。');
  } else {
    const found = c.requestRows.filter(r => r.actorDigest === key.actorDigest);
    if (found.length > 1) fail('原推广提交标识不唯一。'); previous = found[0];
    if (previous && previous.fingerprint !== key.fingerprint) fail('同一提交标识不能用于不同服务推广内容。');
  }
  const required = financeMode || !command.startsWith('withdraw-') || p.outcome === 'success';
  if (required || p.file || p.evidenceRefs) expected = references(p.evidenceRefs ?? (p.file ? [p.file] : null));
  if (previous && expected.length) {
    if (financeMode) {
      if (previous.resultId !== c.row.id) fail('原服务财务提交与追偿来源串号。');
      const found = (c.row.records || []).filter(r => r.requestId === requestId(p,500));
      if (found.length !== 1 || found[0].reference !== p.reference?.trim() || found[0].amountCents !== Number(p.amountCents) || found[0].at !== previous.at || !same(found[0].actor,financeWho(c.actor)) || !proofMatches(found[0],p,expected)) fail('原财务追偿提交缺少对应的实际文件记录。');
      const record = found[0]; unique(c.row.records,record.id,'原财务回款记录');
      slots = expected.map((file,index) => ({domain:'service-finance',id:c.row.id,slot:`recovery:${record.id}:${index}`,file}));
    } else slots = replaySlots(s,c,command,p,previous,expected);
  }
  if (previous && !expected.length && previous.result?.id !== c.row?.id) fail('原提交结果与当前实际事项串号。');
  for (const slot of slots) {
    const actual = slot.domain === 'service-promotion' ? authorizedServicePromotionFile(s,c.actor,slot.id,slot.slot,slot.file.ref) : c.row.records.find(r => r.id === slot.slot.split(':')[1])?.evidenceRefs?.[Number(slot.slot.split(':')[2])];
    if (!same(metadata(actual),slot.file)) fail('原实际证据当前授权槽已变化。');
  }
  const files = dedup(expected); return {files,binding:{...c,previous:previous || null,slots,files}};
}
export async function prepareServicePromotionEvidence(s,rawActor,type,p = {},{readFile} = {}) {
  const financeMode = type === 'finance.recovery-receive';
  if (!financeMode && (typeof type !== 'string' || !type.startsWith('service-promotion.'))) return {evidenceRefs:[]};
  const command = financeMode ? 'recovery-receive' : type.slice(18); if (!financeMode && !COMMANDS.has(command)) fail('未知服务推广事项命令。');
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('服务推广事项内容格式无效。');
  const payload = clone(p), first = financeMode ? financeContext(s,rawActor,payload) : context(s,rawActor,command,payload);
  if (!first || !financeMode && !PROOF.has(command)) return {evidenceRefs:[]};
  const baselineContext = clone(first); const key = financeMode ? null : {actorDigest:await digest(who(first.actor)),fingerprint:await digest({type,p:payload})};
  const refreshed = financeMode ? financeContext(s,rawActor,payload) : context(s,rawActor,command,payload);
  if (!same(baselineContext,refreshed)) fail('账号或原推广事项在核验期间已变化。');
  const initial = plan(s,rawActor,command,payload,key,financeMode), baseline = clone(initial.binding), evidenceRefs = [];
  const recheck = () => { if (!same(baseline,plan(s,rawActor,command,payload,key,financeMode).binding)) fail('账号、原事项或实际证据在核验期间已变化。'); };
  if (initial.files.length && typeof readFile !== 'function') fail('实际证据文件读取尚未接入，不能假称已核验。');
  for (const file of initial.files) {
    recheck(); const blob = await readFile(clone(file)); recheck();
    if (typeof Blob !== 'function' || !(blob instanceof Blob)) fail('实际证据文件不存在或读取结果不是文件。');
    if (blob.size !== file.size || blob.type !== file.type) fail('实际证据元数据与文件不一致。');
    const bytes = await blob.arrayBuffer(); recheck(); checkSignature(bytes,file.type); const hash = await digestBytes(bytes); recheck();
    if (`invoice-file:${hash}` !== file.ref) fail('实际证据内容与原文件引用不一致。'); evidenceRefs.push(clone(file));
  }
  return {evidenceRefs};
}
