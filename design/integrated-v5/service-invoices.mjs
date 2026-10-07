// Service invoices use successful payment/refund facts; rendering never mutates them.
import { actorAccountFields, resolveAccountActor, canAccountReadSource, assertAccountCommand } from './staff-accounts.mjs';
const DAY = 86400000;
const OPEN_REFUNDS = new Set(['requested', 'offered', 'approved', 'processing', 'failed', 'escalated']);
const MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const USER_COMMANDS = new Set(['invoice.apply', 'invoice.resubmit', 'invoice.reapply']);
const STORE_COMMANDS = new Set(['invoice.issue', 'invoice.reject', 'invoice.red', 'invoice.replace-file']);
const clone = value => structuredClone(value);
const actorRecord = actor => ({ role: actor.role, job: actor.role === 'group' ? actor.job || null : null, id: actor.role === 'user' ? actor.userId : ['store', 'manager'].includes(actor.role) ? actor.storeId : actor.role === 'system' ? 'system' : 'group', ...actorAccountFields(actor) });
const signature = value => JSON.stringify(canonical(value));
function requestActorKey(value) {
  try {
    const actor = typeof value === 'string' ? JSON.parse(value) : value;
    return actor ? signature({ role: actor.role, job: actor.role === 'group' ? actor.job || null : null, id: actor.id, ...(actor.accountId ? {accountId:actor.accountId,grantId:actor.grantId} : {}) }) : '';
  } catch { return ''; }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
// Hash the original canonical request facts; a digest never supplies authority.
function sha256(text) {
  const input = new TextEncoder().encode(text), length = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(length), data = new DataView(bytes.buffer);
  bytes.set(input); bytes[input.length] = 0x80;
  data.setUint32(length - 8, Math.floor(input.length / 0x20000000)); data.setUint32(length - 4, (input.length * 8) >>> 0);
  const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], words = new Uint32Array(64);
  const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = data.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = (words[i - 16] + (rotate(x,7) ^ rotate(x,18) ^ (x >>> 3)) + words[i - 7] + (rotate(y,17) ^ rotate(y,19) ^ (y >>> 10))) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i++) {
      const first = (h + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) >>> 0;
      const second = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h=g; g=f; f=e; e=(d+first)>>>0; d=c; c=b; b=a; a=(first+second)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((value,i) => hash[i] = (hash[i] + value) >>> 0);
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}
const requestDigest = value => 'sha256:' + sha256(signature(value));
function matchesRequest(request, value, ctx) {
  const versioned = Object.hasOwn(request, 'digestAlgorithm') || Object.hasOwn(request, 'digestVersion');
  if (!versioned) {
    let legacy;
    try { legacy = JSON.parse(request.fingerprint); } catch { ctx.fail('原发票请求明文指纹损坏，请核对原请求记录'); }
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy) || typeof legacy.type !== 'string' || !legacy.payload || typeof legacy.payload !== 'object' || Array.isArray(legacy.payload)) ctx.fail('原发票请求明文指纹损坏，请核对原请求记录');
    return signature(legacy) === signature(value);
  }
  if (request.digestVersion !== 1) ctx.fail('原发票请求摘要版本缺失或未知，请核对原请求记录');
  if (request.digestAlgorithm !== 'SHA-256') ctx.fail('原发票请求摘要算法缺失或未知，请核对原请求记录');
  if (!/^sha256:[a-f0-9]{64}$/.test(request.fingerprint || '')) ctx.fail('原发票请求摘要损坏，请核对原请求记录');
  return request.fingerprint === requestDigest(value);
}
function required(value, label, ctx, limit = 300) {
  const result = String(value ?? '').trim();
  if (!result || result.length > limit) ctx.fail(`请填写${label}（最多${limit}字）`);
  return result;
}
export function upgradeInvoices(s) {
  s.serviceInvoices ??= [];
  s.serviceInvoiceRequests ??= [];
  return s;
}
export function canReadInvoice(actor, invoice, s) {
  if(s){try{actor=resolveAccountActor(s,actor);}catch{return false;}}
  if (!actor || !invoice) return false;
  if(actor.lifecyclePurpose && (!s || !canAccountReadSource(s,actor,'invoice',invoice)))return false;
  if (actor.role === 'user') return actor.userId === invoice.userId;
  if (['store', 'manager'].includes(actor.role)) return actor.storeId === invoice.storeId;
  return actor.role === 'group' && (!actor.job || ['all', 'finance'].includes(actor.job));
}
export function invoiceSummary(s, booking) {
  const payments = [booking?.payment, ...(booking?.extensions || [])].filter(Boolean);
  const paymentSnapshot = payments.filter(payment => payment.status === 'success').map(payment => ({
    paymentId: payment.id, kind: payment === booking.payment ? 'main' : 'extension',
    amountCents: Number(payment.amountCents || 0), refundedCents: Number(payment.refundedCents || 0),
    netCents: Number(payment.amountCents || 0) - Number(payment.refundedCents || 0)
  }));
  const paid = paymentSnapshot.reduce((total, item) => total + item.amountCents, 0);
  const refunded = paymentSnapshot.reduce((total, item) => total + item.refundedCents, 0);
  const unresolved = (booking?.refunds || []).some(refund => OPEN_REFUNDS.has(refund.status) || (refund.status === 'rejected' && refund.deadline) ||
    (!['withdrawn', 'closed', 'rejected'].includes(refund.status) && (refund.executions || []).some(part => part.amountCents > 0 && ['approved', 'processing', 'failed'].includes(part.status))));
  const unknownPayment = payments.some(payment => payment.status === 'processing');
  const validAmounts = paymentSnapshot.every(item => Number.isSafeInteger(item.amountCents) && Number.isSafeInteger(item.refundedCents) && item.amountCents >= 0 && item.refundedCents >= 0 && item.refundedCents <= item.amountCents) && Number.isSafeInteger(paid) && Number.isSafeInteger(refunded);
  const completed = Boolean(booking?.status === 'done' && Number.isFinite(booking.completedAt) && booking.completedAt <= s.now);
  const windowEndsAt = completed ? booking.completedAt + 90 * DAY : null;
  const blockedReason = !validAmounts ? '支付退款金额异常，请先核对资金记录' : unknownPayment ? '支付结果尚未确认，请先查询原笔支付' : unresolved ? '存在未结退款申请，请先完成退款处理' : '';
  return { paid, refunded, net: paid - refunded, paidCents: paid, refundedCents: refunded, netCents: paid - refunded, blocked: Boolean(blockedReason), blockedReason, completed, withinWindow: Boolean(completed && s.now <= windowEndsAt), windowEndsAt, paymentSnapshot };
}
function history(s, invoice, action, actor, ctx, details = {}) {
  invoice.updatedAt = s.now;
  invoice.history ??= [];
  invoice.history.push({ action, at: s.now, actor: actorRecord(actor), status: invoice.status, version: invoice.version, amount: invoice.amount, ...clone(details) });
  ctx?.log?.(invoice, `服务发票${action} · ${invoice.id}${details.reason ? ` · ${details.reason}` : ''}`);
}
export function syncInvoices(s, ctx) {
  upgradeInvoices(s);
  for (const invoice of s.serviceInvoices) {
    const booking = (s.bookings || []).find(item => item.id === invoice.bookingId);
    if (!booking) continue;
    const summary = invoiceSummary(s, booking);
    if (invoice.status === 'pending' && signature(invoice.paymentSnapshot) !== signature(summary.paymentSnapshot)) {
      const before = { amount: invoice.amount, paymentSnapshot: clone(invoice.paymentSnapshot) };
      invoice.amount = summary.net;
      invoice.paymentSnapshot = clone(summary.paymentSnapshot);
      invoice.version++;
      history(s, invoice, '净额更新', { role: 'system' }, ctx, { before, paymentSnapshot: summary.paymentSnapshot });
    } else if (invoice.status === 'issued' && invoice.paymentSnapshot.some(covered => {
      const payment = summary.paymentSnapshot.find(item => item.paymentId === covered.paymentId);
      return payment && payment.refundedCents > covered.refundedCents;
    })) {
      invoice.status = 'red_pending';
      invoice.version++;
      history(s, invoice, '退款成功，待红冲', { role: 'system' }, ctx, { netCents: summary.net, paymentSnapshot: summary.paymentSnapshot });
    }
  }
  return s;
}
function titleFields(p, ctx) {
  if (!['personal', 'company'].includes(p.kind)) ctx.fail('请选择个人或企业抬头');
  const title = required(p.title, '发票抬头', ctx, 120);
  const email = required(p.email, '接收邮箱', ctx, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ctx.fail('请填写有效的接收邮箱');
  const taxId = p.kind === 'company' ? required(p.taxId, '企业税号', ctx, 20) : '';
  if (p.kind === 'company' && !/^[a-zA-Z0-9]{15,20}$/.test(taxId)) ctx.fail('企业税号须为15至20位字母或数字');
  return { kind: p.kind, title, taxId, email };
}
function fileFields(file, ctx) {
  if (!file || !/^invoice-file:[a-f0-9]{64}$/.test(file.ref || '') || !MIME.has(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 5 * 1024 * 1024) ctx.fail('请选择有效的PDF、PNG或JPEG凭证，单文件不超过5 MiB');
  return { ref: file.ref, name: required(file.name, '凭证文件名', ctx, 255), type: file.type, size: file.size };
}
function uniqueTicketNumber(s, invoice, value, label, ctx) {
  const ticketNumber = required(value, label, ctx, 100);
  if (s.serviceInvoices.some(item => item.storeId === invoice.storeId && [item.issued, item.red].some(ticket => ticket?.ticketNumber === ticketNumber))) ctx.fail('该票号在本服务门店已使用，请核对原票据记录');
  return ticketNumber;
}
function versionCheck(invoice, p, ctx) {
  if (!Number.isSafeInteger(Number(p.version)) || Number(p.version) !== invoice.version) ctx.fail('发票记录已更新或缺少版本，请刷新后重试');
}
export function serviceInvoiceUploadScope(s, rawActor, type, p = {}) {
  const ctx = { fail: message => { throw new Error(message); } };
  if (!['invoice.issue', 'invoice.red', 'invoice.replace-file'].includes(type)) ctx.fail('当前操作不支持服务发票附件选择');
  const actor = resolveAccountActor(s, rawActor);
  assertAccountCommand(actor, type, p, s);
  const unique = (rows, id, label) => {
    const found = (Array.isArray(rows) ? rows : []).filter(row => row?.id === id);
    if (typeof id !== 'string' || !id || found.length !== 1) ctx.fail(`原${label}缺失或编号冲突，请核对原来源`);
    return found[0];
  };
  const invoice = unique(s.serviceInvoices, p.id, '服务发票');
  const booking = unique(s.bookings, invoice.bookingId, '预约');
  unique(s.users, invoice.userId, '本人用户');
  unique(s.stores, invoice.storeId, '服务门店');
  if (actor.role !== 'store' || actor.storeId !== invoice.storeId || actor.storeId !== booking.storeId || invoice.userId !== booking.userId) ctx.fail('仅原服务门店后台可以选择本票附件');
  versionCheck(invoice, p, ctx);
  const summary = invoiceSummary(s, booking);
  let slot;
  if (type === 'invoice.issue') {
    if (invoice.status !== 'pending') ctx.fail('只有待开票申请可以选择开票附件');
    available(summary, ctx); slot = 'issued';
  } else if (type === 'invoice.red') {
    if (invoice.status !== 'red_pending' || !invoice.issued) ctx.fail('当前发票没有待红冲附件事项');
    slot = 'red';
  } else {
    if (!['issued', 'red'].includes(p.slot) || !invoice[p.slot]) ctx.fail('没有可补传的原票据凭证');
    slot = p.slot;
  }
  return clone({ actor, row: invoice, source: { booking, summary }, slot });
}
function legalChain(s, invoice, booking) {
  const visited = new Set();
  let root = invoice;
  while (root?.replacesId) {
    if (visited.has(root.id)) return false;
    visited.add(root.id);
    const previous = s.serviceInvoices.find(item => item.id === root.replacesId);
    if (!previous || previous.replacedById !== root.id || previous.bookingId !== invoice.bookingId || previous.userId !== invoice.userId || previous.storeId !== invoice.storeId) return false;
    root = previous;
  }
  return Boolean(root && root.createdAt >= booking.completedAt && root.createdAt <= booking.completedAt + 90 * DAY);
}
function available(summary, ctx) {
  if (!summary.completed) ctx.fail('预约完成后才能申请服务发票');
  if (summary.blocked) ctx.fail(summary.blockedReason);
  if (summary.net <= 0) ctx.fail('当前净实付为零，不能申请或开具发票');
}
function newRecord(s, booking, summary, fields, actor, ctx, requestId, replacesId = null) {
  const invoice = {
    id: ctx.id('SI'), bookingId: booking.id, userId: booking.userId, storeId: booking.storeId,
    version: 1, status: 'pending', ...fields, amount: summary.net, paymentSnapshot: clone(summary.paymentSnapshot),
    issued: null, red: null, replacesId, replacedById: null, requestId, rejectReason: '', createdAt: s.now, updatedAt: s.now, history: []
  };
  s.serviceInvoices.push(invoice);
  history(s, invoice, replacesId ? '净额重开申请' : '申请', actor, ctx, { ...fields, paymentSnapshot: summary.paymentSnapshot });
  return invoice;
}
export function invoiceCommand(s, actor, type, p, ctx) {
  upgradeInvoices(s);
  if (!USER_COMMANDS.has(type) && !STORE_COMMANDS.has(type)) ctx.fail('不支持的发票操作');
  actor = resolveAccountActor(s, actor);
  assertAccountCommand(actor, type, p, s);
  let invoice = type === 'invoice.apply' ? null : s.serviceInvoices.find(item => item.id === p.id);
  const booking = (s.bookings || []).find(item => item.id === (invoice?.bookingId || p.bookingId));
  // Ownership and writing role are checked before returning a prior successful request.
  if (!booking || (type !== 'invoice.apply' && !invoice)) ctx.fail('预约或发票记录不存在');
  if (USER_COMMANDS.has(type)) {
    if (actor.role !== 'user' || actor.userId !== booking.userId || !s.users?.some(user => user.id === actor.userId) || (invoice && actor.userId !== invoice.userId)) ctx.fail('仅预约本人可以申请或修改发票');
  } else if (actor.role !== 'store' || actor.storeId !== invoice.storeId || actor.storeId !== booking.storeId || !s.stores?.some(store => store.id === actor.storeId)) ctx.fail('仅服务门店后台可以办理本店发票');
  const requestId = required(p.requestId, '本次操作的唯一提交标识', ctx);
  const author = signature(actorRecord(actor)), who = requestActorKey(author), requestFacts = { type, payload: p };
  const requests = s.serviceInvoiceRequests.filter(item => requestActorKey(item.actor) === who && item.requestId === requestId);
  if (requests.length > 1) ctx.fail('同一作者及提交标识存在冲突的原发票请求，请核对原请求记录');
  const request = requests[0];
  if (request) {
    if (!matchesRequest(request, requestFacts, ctx)) ctx.fail('同一提交标识不能用于不同发票操作或内容');
    const results = s.serviceInvoices.filter(item => item.id === request.invoiceId);
    if (results.length !== 1 || results[0].bookingId !== booking.id || results[0].userId !== booking.userId || results[0].storeId !== booking.storeId) ctx.fail('原发票请求结果或本人来源缺失、冲突，请核对原记录');
    return results[0];
  }
  syncInvoices(s, ctx);
  const summary = invoiceSummary(s, booking);
  if (invoice) versionCheck(invoice, p, ctx);
  if (type === 'invoice.apply') {
    available(summary, ctx);
    if (!summary.withinWindow) ctx.fail('发票申请期限已结束，请查看原有发票记录');
    if (s.serviceInvoices.some(item => item.bookingId === booking.id)) ctx.fail('该预约已有发票申请，请查看原记录或修改后重提');
    invoice = newRecord(s, booking, summary, titleFields(p, ctx), actor, ctx, requestId);
  } else if (type === 'invoice.resubmit') {
    if (invoice.status !== 'rejected' || invoice.replacedById) ctx.fail('只有已驳回的当前申请可以修改重提');
    available(summary, ctx);
    if (!summary.withinWindow && !(invoice.replacesId && legalChain(s, invoice, booking))) ctx.fail('发票申请期限已结束');
    Object.assign(invoice, titleFields(p, ctx), { amount: summary.net, paymentSnapshot: clone(summary.paymentSnapshot), status: 'pending', rejectReason: '' });
    invoice.version++;
    history(s, invoice, '修改重提', actor, ctx, { kind: invoice.kind, title: invoice.title, taxId: invoice.taxId, email: invoice.email, paymentSnapshot: summary.paymentSnapshot });
  } else if (type === 'invoice.issue') {
    if (invoice.status !== 'pending') ctx.fail('只有待开票申请可以开具发票');
    available(summary, ctx);
    invoice.issued = { ticketNumber: uniqueTicketNumber(s, invoice, p.ticketNumber, '发票号码', ctx), file: fileFields(p.file, ctx), at: s.now };
    invoice.amount = summary.net; invoice.paymentSnapshot = clone(summary.paymentSnapshot);
    invoice.status = 'issued'; invoice.version++;
    history(s, invoice, '开具', actor, ctx, { issued: invoice.issued, paymentSnapshot: invoice.paymentSnapshot });
  } else if (type === 'invoice.reject') {
    if (invoice.status !== 'pending') ctx.fail('只有待开票申请可以驳回');
    invoice.rejectReason = required(p.reason, '驳回原因', ctx);
    invoice.status = 'rejected'; invoice.version++;
    history(s, invoice, '驳回', actor, ctx, { reason: invoice.rejectReason });
  } else if (type === 'invoice.red') {
    if (invoice.status !== 'red_pending' || !invoice.issued) ctx.fail('当前发票没有待红冲事项');
    invoice.red = { ticketNumber: uniqueTicketNumber(s, invoice, p.ticketNumber, '红冲票号', ctx), file: fileFields(p.file, ctx), at: s.now };
    invoice.status = 'red'; invoice.version++;
    history(s, invoice, '红冲', actor, ctx, { red: invoice.red, netCents: summary.net });
  } else if (type === 'invoice.replace-file') {
    if (!['issued', 'red'].includes(p.slot) || !invoice[p.slot]) ctx.fail('没有可补传的原票据凭证');
    const reason = required(p.reason, '补传凭证原因', ctx), file = fileFields(p.file, ctx);
    const previousFile = clone(invoice[p.slot].file);
    invoice[p.slot].file = file; invoice.version++;
    history(s, invoice, '补传凭证', actor, ctx, { reason, slot: p.slot, previousFile, file });
  } else if (type === 'invoice.reapply') {
    if (invoice.status !== 'red' || !invoice.red || invoice.replacedById) ctx.fail('原票红冲完成且尚未重开时才能申请净额重开');
    available(summary, ctx);
    if (!legalChain(s, invoice, booking)) ctx.fail('原发票链缺少有效的申请记录');
    if (s.serviceInvoices.some(item => item.bookingId === booking.id && item.id !== invoice.id && !['red', 'rejected'].includes(item.status))) ctx.fail('该预约已有正在办理或生效的发票');
    const previous = invoice, fields = titleFields(p, ctx);
    invoice = newRecord(s, booking, summary, fields, actor, ctx, requestId, previous.id);
    previous.replacedById = invoice.id; previous.version++;
    history(s, previous, '关联净额重开申请', actor, ctx, { replacedById: invoice.id });
  }
  s.serviceInvoiceRequests.push({ requestId, actor: author, type, fingerprint: requestDigest(requestFacts), digestAlgorithm: 'SHA-256', digestVersion: 1, invoiceId: invoice.id, at: s.now });
  return invoice;
}
