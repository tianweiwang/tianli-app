// Called only inside the outer work-escalation deep-copy source transaction.
import { workTaskView } from './work-tasks.mjs';
import { resolveAccountActor, assertAccountCommand, actorAccountFields } from './staff-accounts.mjs';
import { assertJob } from './management.mjs';
import { careCommand } from './service-care.mjs';
import { fulfilmentCommand, fulfilmentView, fulfilmentBindingToken } from './fulfilment.mjs';
const copy = x => structuredClone(x), fail = m => { throw Error(m); };
const checkedText = (v, label, max = 500) => { if (typeof v !== 'string' || !v.trim() || v.trim().length > max) fail(`请填写${label}（最多${max}字）`); return v.trim(); };
// Synchronous standard SHA-256 keeps the source transaction atomic and bounds
// child request IDs without truncating or exposing the outer request contents.
function digest(value) {
  const input = new TextEncoder().encode(value), length = Math.ceil((input.length + 9) / 64) * 64, bytes = new Uint8Array(length), data = new DataView(bytes.buffer);
  bytes.set(input); bytes[input.length] = 0x80; data.setUint32(length - 8, Math.floor(input.length / 0x20000000)); data.setUint32(length - 4, (input.length * 8) >>> 0);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2], h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64), r = (n,b) => (n >>> b) | (n << (32-b));
  for (let offset = 0; offset < length; offset += 64) { for (let i = 0; i < 16; i++) w[i] = data.getUint32(offset+i*4); for (let i = 16; i < 64; i++) { const x = w[i-15], y = w[i-2]; w[i] = (w[i-16]+(r(x,7)^r(x,18)^(x>>>3))+w[i-7]+(r(y,17)^r(y,19)^(y>>>10)))>>>0; } let [a,b,c,d,f,g,j,l] = h; for (let i = 0; i < 64; i++) { const t1=(l+(r(f,6)^r(f,11)^r(f,25))+((f&g)^(~f&j))+k[i]+w[i])>>>0, t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0; l=j; j=g; g=f; f=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0; } [a,b,c,d,f,g,j,l].forEach((v,i)=>h[i]=(h[i]+v)>>>0); }
  return h.map(n=>n.toString(16).padStart(8,'0')).join('');
}
function validate(s, rawActor, supplied) {
  const actor = resolveAccountActor(s, rawActor);
  if (!actor?.accountId || !actor.grantId || !actor.sessionId || !['group', 'store'].includes(actor.role)) fail('原责任接管须由实际有效工作账号本人办理');
  assertAccountCommand(actor, 'work-escalation.takeover'); assertJob(actor, 'work-escalation.takeover');
  const task = workTaskView(s, actor).tasks.find(x => x.id === supplied?.id);
  if (!task || task.assignmentMode !== 'source') fail('原责任事项不存在、非原源责任或当前岗位无权访问');
  if (task.status === 'done') fail('原事项已结束，不能接管');
  if (typeof supplied.sourceToken !== 'string' || task.sourceToken !== supplied.sourceToken) fail('原事项阶段或版本已变化，请重新核对');
  if (!task.manageRoles?.includes(actor.role)) fail('当前工作端无本阶段原责任办理权');
  const command = ['care', 'followup'].includes(task.category) ? 'care.task-assign' : task.category === 'safety' ? 'booking.help-close' : task.category === 'safe-departure' ? 'fulfilment.departure-takeover' : null;
  if (!command || !task.commands?.includes(command)) fail('该原源阶段尚未提供受控责任接管');
  assertAccountCommand(actor, command); assertJob(actor, command);
  const booking = (s.bookings || []).find(x => x.id === task.bookingId);
  if (!booking || booking.storeId !== task.storeId) fail('原事项与预约门店绑定待核对');
  let source;
  if (['care', 'followup'].includes(task.category)) {
    source = (task.category === 'care' ? s.serviceCareCases : s.serviceCareFollowups)?.find(x => x.id === task.sourceId);
    if (!source || source.bookingId !== booking.id || source.storeId !== booking.storeId) fail('原质量事项来源或门店已变化');
    if (source.ownerScope !== actor.role) fail('跨负责工作端须先回原办理页按原规则转端；接管保留原阶段与期限');
  } else if (task.category === 'safety') {
    source = (s.safety || []).find(x => x.id === task.sourceId);
    if (!source || source.bookingId !== booking.id || source.storeId != null && source.storeId !== booking.storeId) fail('原安全事件来源或门店待核对');
    if (!Number.isFinite(source.acknowledgedAt) || source.acknowledgedAt > s.now || !source.acknowledgedBy || !['group', 'store', 'manager'].includes(source.acknowledgedBy.role)) fail('原安全事件尚无完整实际接报，请先回原办理页接报');
  } else {
    source = (s.fulfilmentDepartures || []).find(x => x.id === task.sourceId);
    const view = fulfilmentView(s, actor, booking.id);
    if (!source || source.bookingId !== booking.id || source.storeId !== booking.storeId || view?.departure?.id !== source.id) fail('原安全离开来源已变化');
    if (!view.departure.canTakeover) fail('安全离开接管须为当前有效值班本人；升级后由集团值班接管');
  }
  return { actor, task, source, booking };
}
export function nativeTakeoverAvailability(s, actor, task) {
  try { validate(s, actor, task); return { available: true, reason: '' }; } catch (error) { return { available: false, reason: error.message }; }
}
export function takeOver(s, args, ctx = {}) {
  const { actor, task, source, booking } = validate(s, args.actor, args.task), reason = checkedText(args.reason, '实际接管依据'), requestId = checkedText(args.requestId, '唯一提交标识', 260);
  const childRequestId = 'native-work:' + digest(JSON.stringify({ requestId, taskId: task.id, accountId: actor.accountId, grantId: actor.grantId }));
  const beforeAssignments = JSON.stringify(s.workTaskAssignments || []), beforeBookings = JSON.stringify(s.bookings || []), beforeMoney = JSON.stringify([s.goods, s.skus, s.bills, s.serviceFinanceEntries, s.serviceFinanceRecoveries]);
  const author = { role: actor.role, job: actor.job, storeId: actor.storeId || null, ...actorAccountFields(actor) }, accountVersion = s.staffAccounts.find(x => x.id === actor.accountId).version;
  if (['care', 'followup'].includes(task.category)) {
    const before = copy(source.assignee), scope = source.ownerScope;
    careCommand(s, actor, 'care.task-assign', { entity: task.category === 'care' ? 'case' : 'followup', id: source.id, version: source.version, scope, name: actor.accountName, reason, requestId: childRequestId }, ctx);
    source.assignee = { ...source.assignee, accountId: actor.accountId, grantId: actor.grantId, accountVersion, claimedAt: s.now };
    source.version++; source.updatedAt = s.now;
    (source.history ??= []).push({ at: s.now, action: '事项升级由本人接管', by: copy(author), version: source.version, reason, before, after: copy(source.assignee), sourceToken: task.sourceToken });
    ctx.log?.(source, `原质量责任由本人接管 · ${task.id}`);
  } else if (task.category === 'safety') {
    const before = source.responsibility ? copy(source.responsibility) : null;
    source.responsibility = { accountId: actor.accountId, grantId: actor.grantId, accountVersion, name: actor.accountName, at: s.now, version: (source.responsibility?.version || 0) + 1, reason, sourceToken: task.sourceToken };
    (source.events ??= []).push({ at: s.now, text: '事项升级由当前工作账号本人接管', by: copy(author), responsibilityVersion: source.responsibility.version, reason, before, after: copy(source.responsibility) });
    ctx.log?.(source, `原安全责任由本人接管 · ${task.id}`);
  } else {
    fulfilmentCommand(s, actor, 'fulfilment.departure-takeover', { bookingId: booking.id, bookingToken: fulfilmentBindingToken(booking), departureId: source.id, version: source.version, reason, requestId: childRequestId }, ctx);
  }
  const after = workTaskView(s, actor).tasks.find(x => x.id === task.id), actual = task.category === 'safety' ? source.responsibility : task.category === 'safe-departure' ? source.owner : source.assignee;
  if (!after || after.status !== task.status || after.dueAt !== task.dueAt || actual?.accountId !== actor.accountId || actual?.grantId !== actor.grantId || actual?.accountVersion !== accountVersion) fail('原责任接管未保存真实本人或改变了原阶段、期限');
  if (JSON.stringify(s.workTaskAssignments || []) !== beforeAssignments || JSON.stringify(s.bookings || []) !== beforeBookings || JSON.stringify([s.goods, s.skus, s.bills, s.serviceFinanceEntries, s.serviceFinanceRecoveries]) !== beforeMoney) fail('原责任接管不得改动平行负责人、预约或款项库存');
  return { id: task.id, sourceId: task.sourceId, accountId: actor.accountId, grantId: actor.grantId, sourceToken: after.sourceToken };
}
