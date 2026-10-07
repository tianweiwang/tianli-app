// Full contact details are returned for this action only, never copied to audit state.
import { actorAccountFields, resolveAccountActor, assertAccountCommand } from './staff-accounts.mjs';
const clone = value => structuredClone(value);
const support = actor => actor?.role === 'group' && (actor.job === 'support' || (!actor.accountId && !actor.sessionId && (!actor.job || actor.job === 'all')));
const fail = (ctx, message) => { ctx?.fail?.(message); throw new Error(message); };
function required(value, label, ctx, limit=300) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length>limit) fail(ctx, `请填写${label}（最多${limit}字）`);
  return value.trim();
}
export function maskPhone(value) {
  const phone=String(value ?? '');
  return /^\d{11}$/.test(phone)?phone.slice(0,3)+'****'+phone.slice(-4):phone?'已隐藏联系方式':'';
}
export function projectBookingContact(booking, actor) {
  if (actor?.role==='user' && actor.userId===booking.userId) return {phone:booking.phone,phoneAccess:'owner',contactMethod:'联系预约人'};
  if (actor?.role==='tech') return {phone:'',phoneAccess:'platform',contactMethod:'通过平台联系'};
  return {phone:maskPhone(booking.phone),phoneAccess:'masked',contactMethod:'通过平台联系'};
}
export function upgradeSensitiveAccess(s) { s.sensitiveAccessLogs ??= []; s.sensitiveAccessRequests ??= []; return s; }
export function sensitiveAccessCommand(s, rawActor, type, p={}, ctx={}) {
  const actor=resolveAccountActor(s,rawActor);
  assertAccountCommand(actor,type);
  if (type!=='sensitive.reveal' || !support(actor)) fail(ctx,'仅集团客服可以按处理需要查看完整联系方式');
  const booking=(s.bookings || []).find(item=>item.id===p.bookingId);
  if (!booking) fail(ctx,'预约不存在或已不可查看');
  const reason=required(p.reason,'查看完整联系方式的原因',ctx,500), requestId=required(p.requestId,'本次查看的唯一提交标识',ctx);
  if (!/^1\d{10}$/.test(String(booking.phone || ''))) fail(ctx,'预约未保存有效完整联系方式，请核对原记录');
  // A typed reason may repeat a number. Do not copy that number to retained logs.
  const safeReason=reason.split(booking.phone).join(maskPhone(booking.phone)).replace(/\b1\d{10}\b/g,match=>maskPhone(match));
  const account=actorAccountFields(actor), by={role:actor.role,job:actor.job || null,id:'group',...account};
  const who=JSON.stringify({role:actor.role,job:actor.job || null,...account.accountId?{accountId:account.accountId,grantId:account.grantId}:{}});
  const fingerprint=JSON.stringify({bookingId:booking.id,reason:safeReason});
  upgradeSensitiveAccess(s);
  const previous=s.sensitiveAccessRequests.find(item=>item.actor===who && item.requestId===requestId);
  if (previous && previous.fingerprint!==fingerprint) fail(ctx,'同一提交标识不能用于不同联系方式查看内容');
  if (!previous) {
    const access={id:ctx.id?ctx.id('SA'):`SA${s.seq=(s.seq || 0)+1}`,bookingId:booking.id,at:s.now,reason:safeReason,by,phoneMasked:maskPhone(booking.phone),field:'booking.phone'};
    s.sensitiveAccessLogs.push(access);
    s.sensitiveAccessRequests.push({actor:who,requestId,fingerprint,accessId:access.id,at:s.now});
    ctx.log?.(access,`按原因查看预约联系方式 · ${booking.id}`);
  }
  return {bookingId:booking.id,phone:booking.phone,name:booking.contactName || ''};
}
export function sensitiveAccessView(s, rawActor) {
  const actor=resolveAccountActor(s,rawActor);
  if (!support(actor)) return {canReveal:false,records:[]};
  return {canReveal:true,records:clone(s.sensitiveAccessLogs || []).sort((a,b)=>b.at-a.at || a.id.localeCompare(b.id))};
}
