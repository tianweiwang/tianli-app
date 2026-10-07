// Actual file reads for one current service-extra command. No ledger writes or lasting authorization.
import { resolveAccountActor, assertAccountCommand } from './staff-accounts.mjs';
import { authorizedServiceExtraFile, serviceExtraSourceToken } from './service-finance-extras.mjs';

const COMMANDS = new Set(['evidence-submit','evidence-review','policy-publish','refund-shortage','recharge','advance-decision','advance-confirm','advance-cancel','advance-pay','advance-query','advance-reconcile','recovery-receive','offset-propose','offset-confirm','offset-cancel','offset-pay','offset-query','offset-return']);
const LIMIT = 5 * 1024 * 1024;
const TYPES = new Set(['application/pdf','image/png','image/jpeg']);
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const finance = actor => actor?.role === 'group' && ['finance','all'].includes(actor.job);
const local = (actor,row) => actor?.role === 'store' && actor.job === 'store-finance' && actor.storeId === row?.storeId;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function metadata(raw) {
  if (!raw || typeof raw !== 'object' || !/^invoice-file:[a-f0-9]{64}$/.test(raw.ref || '') || !TYPES.has(raw.type)) fail('证据须引用实际PDF或PNG、JPEG文件。');
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 255) fail('实际证据文件名无效。');
  if (!['string','number'].includes(typeof raw.size) || !String(raw.size).trim() || !Number.isSafeInteger(Number(raw.size)) || Number(raw.size) < 1 || Number(raw.size) > LIMIT) fail('实际证据文件大小无效。');
  return {ref:raw.ref,name:raw.name.trim(),type:raw.type,size:Number(raw.size)};
}
function references(value) {
  let rows = value;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { fail('实际附件引用格式无效。'); } }
  if (!Array.isArray(rows) || !rows.length || rows.length > 10) fail('请提供实际证据附件。');
  return rows.map(metadata);
}
function unique(rows) {
  const result = new Map();
  for (const file of rows) {
    const old = result.get(file.ref);
    if (old && !same(old,file)) fail('同一附件引用的元数据冲突，请重新核对。');
    result.set(file.ref,file);
  }
  return [...result.values()];
}
function checkSignature(buffer,type) {
  const bytes = new Uint8Array(buffer);
  const valid = type === 'application/pdf'
    ? new TextDecoder().decode(bytes.slice(0,5)) === '%PDF-' && new TextDecoder().decode(bytes.slice(-1024)).includes('%%EOF')
    : type === 'image/png'
      ? [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (!valid) fail('实际证据内容与PDF或图片格式不符，请重新上传完整文件。');
}
function boundSource(state,row) {
  const booking = (state.bookings || []).find(item => item.id === row?.bookingId);
  const payment = [booking?.payment,...(booking?.extensions || [])].find(item => item?.id === row?.paymentId);
  if (!booking || !payment || !row?.storeId || row.storeId !== booking.storeId || row.userId != null && row.userId !== booking.userId || !(state.stores || []).some(item => item.id === booking.storeId)) fail('原服务资金事项或支付、门店来源缺失或已变化。');
  return {booking,payment};
}
function context(state,rawActor,command,p) {
  const actor = resolveAccountActor(state,rawActor);
  assertAccountCommand(actor,`service-extra.${command}`);
  let row, source;
  if (command === 'evidence-submit' || command === 'refund-shortage') {
    const booking = (state.bookings || []).find(item => item.id === p.bookingId);
    const payment = [booking?.payment,...(booking?.extensions || [])].find(item => item?.id === p.paymentId);
    row = booking;
    if (!booking || !payment || !(state.stores || []).some(item => item.id === booking.storeId)) fail('原预约或支付来源不存在。');
    source = {booking,payment};
  } else if (command === 'evidence-review') {
    row = (state.serviceExtraEvidence || []).find(item => item.id === p.id);
  } else if (command.startsWith('advance-') || command === 'recharge') {
    row = (state.serviceRefundShortages || []).find(item => item.id === p.id);
  } else if (command === 'recovery-receive') {
    row = (state.serviceExtraRecoveries || []).find(item => item.id === p.id);
  } else if (command.startsWith('offset-')) {
    row = command === 'offset-propose' ? (state.serviceFinanceEntries || []).find(item => item.id === p.entryId) : (state.serviceExtraOffsets || []).find(item => item.id === p.id);
  }
  const allowed = command === 'advance-confirm' ? actor?.role === 'user' && row && row.userId === actor.userId
    : command === 'evidence-submit' || command === 'recharge' || command === 'offset-confirm' ? row && local(actor,row)
    : command === 'refund-shortage' ? row && (finance(actor) || local(actor,row)) : finance(actor);
  if (!allowed) fail('当前岗位或资源范围无权办理该服务资金事项。');
  if (command !== 'policy-publish' && !row) fail('服务资金事项不存在。');
  if (row && !source) source = boundSource(state,row);
  if (command === 'advance-confirm' && source.booking.userId !== actor.userId) fail('该直接款不是本人的原退款事项。');
  if (command === 'policy-publish' && p.storeId && !(state.stores || []).some(item => item.id === p.storeId)) fail('规则门店不存在。');
  return {actor,row,source};
}
// Selection reuses the original owner/source context, before form facts are
// complete. It neither applies evidence nor records a successful transfer.
export function serviceExtraUploadScope(state,rawActor,type,p={}) {
  const command=typeof type==='string'&&type.startsWith('service-extra.')?type.slice(14):'';
  if(!['evidence-submit','refund-shortage','recharge','advance-pay','advance-query','advance-reconcile','recovery-receive','offset-return'].includes(command)
    ||command==='advance-reconcile'&&p.action!=='return')fail('该原服务资金表单没有新增文件用途。');
  const actual=context(state,rawActor,command,p),expected=['evidence-submit','refund-shortage'].includes(command)?0:actual.row.version;
  if(!['number','string'].includes(typeof p.version)||!String(p.version).trim()||!Number.isSafeInteger(Number(p.version))||Number(p.version)!==expected)fail('原服务资金版本已变化，请刷新选择。');
  for(const [list,id,label] of [[state.bookings,actual.source.booking.id,'原预约'],[state.stores,actual.source.booking.storeId,'原门店'],[state.users,actual.source.booking.userId,'原本人'],[[actual.source.booking.payment,...(actual.source.booking.extensions||[])].filter(Boolean),actual.source.payment.id,'原支付']])if((list||[]).filter(row=>row?.id===id).length!==1)fail(`${label}缺失或编号不唯一。`);
  const collection=command==='recovery-receive'?'serviceExtraRecoveries':command==='offset-return'?'serviceExtraOffsets':command.startsWith('advance-')||command==='recharge'?'serviceRefundShortages':null;
  if(collection&&(state[collection]||[]).filter(row=>row?.id===actual.row.id).length!==1)fail('原资金事项编号缺失或不唯一。');
  if(['evidence-submit','refund-shortage'].includes(command)&&p.sourceToken!==serviceExtraSourceToken(state,actual.source.booking.id,actual.source.payment.id))fail('原支付、退款或资金来源已变化，请刷新选择。');
  if(command==='evidence-submit') {
    if(!['payment','split','source','rule'].includes(p.kind))fail('请选择原依据类型。');
    const entries=(state.serviceFinanceEntries||[]).filter(row=>row.bookingId===actual.source.booking.id&&row.paymentId===actual.source.payment.id);
    if(entries.length>1||!entries.length&&p.kind!=='payment'||!['number','string'].includes(typeof p.sourceVersion)||!String(p.sourceVersion).trim()||!Number.isSafeInteger(Number(p.sourceVersion))||Number(p.sourceVersion)!==(entries[0]?.version||0))fail('原资金行或来源版本已变化。');
  }
  const advance=command.startsWith('advance-')?(actual.row.advances||[]).filter(row=>row.id===p.advanceId):[];
  if(command.startsWith('advance-')&&advance.length!==1)fail('原垫付款编号缺失或不唯一。');
  let counterpart=null;
  if(command==='offset-return') {
    const entries=(state.serviceFinanceEntries||[]).filter(row=>row.id===actual.row.entryId),debts=(state.serviceExtraRecoveries||[]).filter(row=>row.id===actual.row.recoveryId);
    if(entries.length!==1||debts.length!==1||entries[0].bookingId!==actual.source.booking.id||entries[0].paymentId!==actual.source.payment.id||entries[0].storeId!==actual.row.storeId||debts[0].storeId!==actual.row.storeId||debts[0].payer!==`store:${actual.row.storeId}`||debts[0].payee!=='group')fail('原追收方案、原资金行或同店垫付债来源缺失或串号。');
    counterpart={entry:entries[0],debt:debts[0],debtSource:boundSource(state,debts[0])};
  }
  return clone({...actual,advance:advance[0]||null,counterpart,sourceToken:serviceExtraSourceToken(state,actual.source.booking.id,actual.source.payment.id)});
}
function plan(state,rawActor,command,p) {
  const {actor,row,source} = context(state,rawActor,command,p);
  let rows = [], slots = [];
  if (command === 'evidence-review' && p.decision === 'approve') {
    rows = references(row.evidenceRefs);
    slots = rows.map((file,index) => ({id:row.id,slot:`evidence:${index}`,file}));
  } else if (command === 'advance-reconcile' && p.action === 'confirm-refund') {
    const advance = row.advances?.find(item => item.id === p.advanceId);
    if (!advance || advance.path !== 'direct-user' || advance.execution?.status !== 'success') fail('原实际成功直接款来源不存在。');
    rows = references(advance.execution.proof?.evidenceRefs);
    slots = rows.map((file,index) => ({id:row.id,slot:`advance:${advance.id}:${index}`,file}));
  } else if (['evidence-submit','refund-shortage','recharge','recovery-receive','offset-return'].includes(command)
      || ['advance-pay','advance-query'].includes(command) && p.outcome === 'success'
      || command === 'advance-reconcile' && p.action === 'return') {
    rows = references(p.evidenceRefs ?? (p.file ? [p.file] : null));
  }
  for (const slot of slots) {
    const original = authorizedServiceExtraFile(state,actor,slot.id,slot.slot,slot.file.ref);
    if (!same(metadata(original),slot.file)) fail('原实际证据已变化，请刷新核对。');
  }
  const files = unique(rows);
  // Capture the authoritative binding/versions, not only a caller's role or a file reference.
  const sourceSnapshot = source && {bookingId:source.booking.id,storeId:source.booking.storeId,userId:source.booking.userId,payment:source.payment};
  const binding = {actor,row,source:sourceSnapshot,slots,files};
  return {files,binding};
}

export async function prepareServiceExtraEvidence(state,actor,type,p = {},{readFile} = {}) {
  if (typeof type !== 'string' || !type.startsWith('service-extra.')) return {evidenceRefs:[]};
  const command = type.slice(14);
  if (!COMMANDS.has(command)) fail('未知服务资金事项命令。');
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('服务资金事项内容格式无效。');
  const payload = clone(p), initial = plan(state,actor,command,payload);
  const baseline = clone(initial.binding), evidenceRefs = [];
  const recheck = () => {
    const current = plan(state,actor,command,payload);
    if (!same(baseline,current.binding)) fail('账号、原事项或实际证据已变化，请刷新核对。');
  };
  if (initial.files.length && typeof readFile !== 'function') fail('实际证据文件读取尚未接入，不能登记或批准成功事实。');
  for (const file of initial.files) {
    recheck();
    const blob = await readFile(clone(file));
    recheck();
    if (typeof Blob !== 'function' || !(blob instanceof Blob)) fail('实际证据文件不存在或读取结果不是文件。');
    if (blob.size !== file.size || blob.type !== file.type) fail('实际证据元数据与文件不一致，请重新上传。');
    const bytes = await blob.arrayBuffer();
    recheck();
    checkSignature(bytes,file.type);
    if (!globalThis.crypto?.subtle?.digest) fail('当前运行环境无法核验实际附件摘要。');
    const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
    recheck();
    if (`invoice-file:${digest}` !== file.ref) fail('实际证据内容与原文件引用不一致，请重新上传。');
    evidenceRefs.push(clone(file));
  }
  return {evidenceRefs};
}
