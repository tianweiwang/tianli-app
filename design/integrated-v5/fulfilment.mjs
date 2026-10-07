// Independent fulfilment and safety facts; caller commits a deep-copy transaction.
import { actorAccountFields, resolveAccountActor } from './staff-accounts.mjs';
const MIN = 60000;
const clone = v => structuredClone(v);
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const signature = v => JSON.stringify(canonical(v));
// Synchronous SHA-256 keeps reduce transactional in both browsers and Node.
// Only digests survive; the canonical request text is never stored in state.
function sha256(value) {
  const input=new TextEncoder().encode(value), length=Math.ceil((input.length+9)/64)*64, bytes=new Uint8Array(length), data=new DataView(bytes.buffer);
  bytes.set(input);bytes[input.length]=0x80;data.setUint32(length-8,Math.floor(input.length/0x20000000));data.setUint32(length-4,(input.length*8)>>>0);
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2],h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),r=(n,b)=>(n>>>b)|(n<<(32-b));
  for(let offset=0;offset<length;offset+=64){for(let i=0;i<16;i++)w[i]=data.getUint32(offset+i*4);for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(r(x,7)^r(x,18)^(x>>>3))+w[i-7]+(r(y,17)^r(y,19)^(y>>>10)))>>>0;}
    let [a,b,c,d,f,g,j,l]=h;for(let i=0;i<64;i++){const t1=(l+(r(f,6)^r(f,11)^r(f,25))+((f&g)^(~f&j))+k[i]+w[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;l=j;j=g;g=f;f=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,f,g,j,l].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
  }return h.map(n=>n.toString(16).padStart(8,'0')).join('');
}
const digest=v=>sha256(signature(v));
const requestIdentity=a=>Object.fromEntries(['role','id','job','accountId','grantId'].filter(k=>a[k]!=null).map(k=>[k,a[k]]));
const TYPES = new Set(['fulfilment.policy-publish','fulfilment.duty-save','fulfilment.location-consent','fulfilment.fact-record','fulfilment.fact-confirm','fulfilment.fact-verify','fulfilment.fact-correct','fulfilment.departure-history','fulfilment.departure-confirm','fulfilment.departure-contact','fulfilment.departure-escalate','fulfilment.departure-takeover','fulfilment.departure-help','fulfilment.departure-resolve','fulfilment.notice-record','fulfilment.notice-ack']);
export const FULFILMENT_FACT_KINDS = ['location','departure','arrival','contact','cancel','late','noshow','exception'];
const END = new Set(['done','interrupted','cancelled','closed']);
const support = a => a?.role === 'group' && (!a.job || ['all','support'].includes(a.job));
const local = (a,b) => ['store','manager'].includes(a?.role) && a.storeId === b?.storeId && (!a.accountId || a.job === 'store-manager');
const tech = (a,b) => a?.role === 'tech' && a.techId === b?.techId;
const user = (a,b) => a?.role === 'user' && a.userId === b?.userId;
const author = a => ({ role:a.role,id:a.userId || a.techId || a.storeId || a.accountId || 'group',job:a.job || null,...actorAccountFields(a) });
function fail(ctx,message) { if (ctx?.fail) ctx.fail(message); throw new Error(message); }
function text(v,label,ctx,max=1000,required=true) { if (v!=null && typeof v!=='string') fail(ctx,`${label}格式无效`); const out=String(v??'').trim(); if ((required&&!out)||out.length>max) fail(ctx,`请填写${label}（最多${max}字）`); return out; }
function bool(v,label,ctx) { if (![true,false,'true','false'].includes(v)) fail(ctx,`请明确选择${label}`); return v===true || v==='true'; }
function integer(v,label,ctx,min=0) { if (!['number','string'].includes(typeof v)||!String(v).trim()||!Number.isSafeInteger(Number(v))||Number(v)<min) fail(ctx,`${label}无效`); return Number(v); }
function timestamp(v,label,ctx) {
  if (typeof v==='number' && Number.isSafeInteger(v) && Number.isFinite(new Date(v).getTime())) return v;
  if (typeof v!=='string') fail(ctx,`${label}无效`);
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(v);
  if (!m || +m[2]<1 || +m[2]>12 || +m[3]<1 || +m[3]>new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate() || +m[4]>23 || +m[5]>59 || +(m[6]||0)>59) fail(ctx,`${label}无效`);
  const value=Date.parse(m[7]?v:`${v}+08:00`); if (!Number.isSafeInteger(value)) fail(ctx,`${label}无效`); return value;
}
function occurred(v,s,b,ctx,minimum=b.createdAt || 0) { const n=timestamp(v,'实际发生时间',ctx); if (n>s.now || n<minimum) fail(ctx,'实际发生时间须在预约建立后且不晚于当前时间'); return n; }
function checkVersion(v,current,ctx) { if (integer(v,'记录版本',ctx)!==current) fail(ctx,'记录已更新，请刷新核对后重试'); }
function id(s,ctx,prefix) { return ctx?.id ? ctx.id(prefix) : `${prefix}${s.seq=(s.seq||0)+1}`; }
function history(s,row,a,action,details={}) { row.version++; row.updatedAt=s.now; row.history.push({at:s.now,by:author(a),action,version:row.version,...clone(details)}); }
function request(s,a,type,p,ctx) { const requestId=text(p.requestId,'本次提交标识',ctx,200), actorDigest=digest(requestIdentity(author(a))), fingerprint=digest({type,p}), prior=(s.fulfilmentRequests || []).find(r=>r.actorDigest===actorDigest && r.requestId===requestId); if (prior && prior.fingerprint!==fingerprint) fail(ctx,'同一提交标识不能用于不同内容'); return {requestId,actorDigest,fingerprint,prior}; }
const minimalResult=result=>Object.fromEntries(['id','bookingId','version','status','kind'].filter(k=>result?.[k]!=null).map(k=>[k,result[k]]));
function remembered(s,r,result) { const output=minimalResult(result); s.fulfilmentRequests.push({requestId:r.requestId,actorDigest:r.actorDigest,fingerprint:r.fingerprint,digestAlgorithm:'SHA-256',recordedAt:s.now,result:output}); return clone(output); }
const booking = (s,id) => (s.bookings || []).find(b=>b.id===id);
const recordFor = (s,id) => (s.fulfilmentRecords || []).find(r=>r.bookingId===id);
const departureFor = (s,id) => (s.fulfilmentDepartures || []).find(r=>r.bookingId===id);
function readable(s,a,b) { if (!b) return false; return support(a) || local(a,b) || user(a,b) || tech(a,b) || a.role==='tech' && ((recordFor(s,b.id)?.facts || []).some(f=>f.techId===a.techId) || departureFor(s,b.id)?.techId===a.techId); }
function staff(a,b,ctx) { if (!(support(a)||local(a,b))) fail(ctx,'仅本店主管或集团客服可以核实本预约'); }
export function upgradeFulfilment(s) { for (const key of ['fulfilmentRecords','fulfilmentDepartures','fulfilmentPolicies','fulfilmentDutyRosters','fulfilmentRequests','fulfilmentLocationConsents','fulfilmentNotices']) s[key]??=[]; for(const r of s.fulfilmentRequests){if(typeof r.content==='string'){r.fingerprint=sha256(r.content);r.digestAlgorithm='SHA-256';delete r.content;}if(typeof r.who==='string'){let identity;try{identity=requestIdentity(JSON.parse(r.who));}catch{identity={legacyUnknown:r.who};}r.actorDigest=digest(identity);delete r.who;}r.result=minimalResult(r.result);}return s; }
export function fulfilmentBindingToken(b) { return b ? digest({id:b.id,storeId:b.storeId,techId:b.techId,status:b.status,startAt:b.startAt,startedAt:b.startedAt || null,completedAt:b.completedAt || null,stoppedAt:b.stoppedAt || null,cancelledAt:b.cancelledAt || null,change:b.change ? {id:b.change.id,status:b.change.status,techId:b.change.techId,startAt:b.change.startAt} : null}) : ''; }
function bind(p,b,ctx) { if (p.bookingToken!==fulfilmentBindingToken(b)) fail(ctx,'预约安排或实际状态已变化，请刷新核对后操作'); }
function policyFor(s,storeId) { const eligible=(s.fulfilmentPolicies || []).filter(p=>p.effectiveAt<=s.now && (p.storeId===storeId || p.storeId===null)); return eligible.filter(p=>p.storeId===storeId).sort((a,b)=>b.version-a.version)[0] || eligible.filter(p=>p.storeId===null).sort((a,b)=>b.version-a.version)[0] || null; }
function historicalPolicy(s,storeId,at) { const eligible=(s.fulfilmentPolicies || []).filter(p=>p.effectiveAt<=at&&p.publishedAt<=at&&(p.storeId===storeId||p.storeId===null)); return eligible.filter(p=>p.storeId===storeId).sort((a,b)=>b.version-a.version)[0] || eligible.filter(p=>p.storeId===null).sort((a,b)=>b.version-a.version)[0] || null; }
function enabledGrant(s,accountId,grantId) { const a=(s.staffAccounts || []).find(a=>a.id===accountId && a.enabled), g=a?.grants.find(g=>g.id===grantId && g.enabled); return a && g && (g.role==='group' && g.job==='support' || g.role==='store' && g.job==='store-manager') ? {account:a,grant:g} : null; }
function rosterValid(s,row) { const v=enabledGrant(s,row.accountId,row.grantId); return !!(row.enabled && v && (row.scope==='group' ? v.grant.role==='group' : v.grant.role==='store' && v.grant.storeId===row.storeId)); }
function duties(s,b,scope) { return (s.fulfilmentDutyRosters || []).filter(r=>rosterValid(s,r) && r.startAt<=s.now && s.now<r.endAt && (scope ? r.scope===scope : r.scope==='group' || r.storeId===b.storeId)); }
function onDuty(s,a,b) { return !!a.accountId && duties(s,b).some(r=>r.accountId===a.accountId && r.grantId===a.grantId); }
function validOwner(s,row) { const value=row.owner && enabledGrant(s,row.owner.accountId,row.owner.grantId); return !!value && value.account.version===row.owner.accountVersion; }
const consentFor = (s,techId) => (s.fulfilmentLocationConsents || []).find(c=>c.techId===techId);
function position(s,a,b,p,ctx,techId=b.techId) {
  const mode=p.positionMode || 'none'; if (!['none','manual','gps','failed'].includes(mode)) fail(ctx,'请选择有效位置记录方式');
  const place=text(p.place,'实际地点说明',ctx,500,mode==='manual'||mode==='gps'), result={mode,place};
  if (mode==='failed') result.failureReason=text(p.positionFailure,'定位失败及人工替代说明',ctx,500);
  const hasLat=p.lat!=null && p.lat!=='', hasLng=p.lng!=null && p.lng!=='';
  if (hasLat!==hasLng || mode==='gps' && !hasLat) fail(ctx,'请成对记录有效经纬度；无法定位时请选择失败');
  if (hasLat) { const consent=consentFor(s,techId), sampleAt=mode==='failed'?occurred(p.lastKnownAt,s,b,ctx):p.occurredAt==null?s.now:occurred(p.occurredAt,s,b,ctx); if (!consent?.active || consent.consentedAt>sampleAt) fail(ctx,'请先由技师单独同意位置用途；不能补造采样前的同意'); const lat=Number(p.lat),lng=Number(p.lng); if (typeof p.lat==='boolean'||typeof p.lng==='boolean'||!Number.isFinite(lat)||lat< -90||lat>90||!Number.isFinite(lng)||lng< -180||lng>180) fail(ctx,'经纬度无效'); if (!['gps','failed'].includes(mode)) fail(ctx,'手工说明不自动视为定位坐标'); result.lat=lat; result.lng=lng; result.consentVersion=consent.version; if (mode==='failed') result.lastKnownAt=sampleAt; }
  return result;
}
function factInput(s,a,b,p,ctx,techId=b.techId) {
  if (!FULFILMENT_FACT_KINDS.includes(p.kind)) fail(ctx,'请选择有效履约事实类型');
  const time=occurred(p.occurredAt,s,b,ctx); if (['late','noshow'].includes(p.kind) && time<b.startAt) fail(ctx,'迟到或爽约事实不能早于预约开始时间');
  const pos=position(s,a,b,p,ctx,techId), out={kind:p.kind,techId,occurredAt:time,recordedAt:s.now,recordedBy:author(a),evidence:text(p.evidence,'事实依据与说明',ctx),position:pos};
  if (p.kind==='location') { if (!['inside','outside','unknown'].includes(p.coverage)) fail(ctx,'请明确覆盖核验结果'); out.coverage={result:p.coverage,basis:text(p.coverageBasis,'实际覆盖核验依据',ctx),storeSnapshot:clone((s.stores || []).find(x=>x.id===b.storeId) ? Object.fromEntries(['id','name','version','lat','lng','radiusKm'].map(k=>[k,(s.stores || []).find(x=>x.id===b.storeId)[k] ?? null])) : {id:b.storeId})}; if (pos.mode==='none' && p.coverage!=='unknown') fail(ctx,'没有实际地点依据，不能确认覆盖'); }
  return out;
}
function collector(a,b,policy) { if (!policy) return false; return support(a) || tech(a,b) && ['tech-only','tech-store-confirm'].includes(policy.collectorMode) || local(a,b) && ['store-only','tech-store-confirm'].includes(policy.collectorMode); }
function sourceIssues(s,b) { return [...(s.safety || []).filter(h=>h.bookingId===b.id && h.status!=='closed').map(h=>({kind:'safety',id:h.id})), ...(b.disputes || []).filter(d=>!['closed','resolved'].includes(d.status)).map(d=>({kind:'dispute',id:d.id}))]; }
function needsReview(row) { return !!row.help || ['escalated','handling','awaiting_verification'].includes(row.status); }
function updateFactState(fact) { const decision=fact.verifications.at(-1)?.decision; fact.status=fact.confirmationState==='pending'?'pending-tech':fact.confirmationState==='rejected'||decision==='disputed'?'disputed':decision==='verified'?'verified':fact.confirmationState==='accepted'?'confirmed':'reported'; }

// Recover only existing ending and technician evidence. A current assignment,
// planned start or an operator-provided techId alone is insufficient provenance.
export function fulfilmentEndingSource(s,b) {
  const missing=reason=>({available:false,reason,sourceToken:null});
  if(!b||!['done','interrupted'].includes(b.status))return missing('尚无原服务完成或中止事实');
  const interrupted=Number.isSafeInteger(b.stoppedAt),endingAt=interrupted?b.stoppedAt:b.completedAt,endingKind=interrupted?'interrupted':b.finishMode==='early'?'early':b.finishMode==='normal'?'normal':null;
  if(!Number.isSafeInteger(endingAt)||endingAt>s.now||endingAt<(b.createdAt || 0))return missing('原实际结束时间缺失或无效，不能用预约时间替代');
  if(!endingKind)return missing('原结束类型缺失，须先核对原事实');
  if(!interrupted&&(!Number.isSafeInteger(b.startedAt)||b.startedAt>endingAt||b.startedAt<(b.createdAt || 0)))return missing('原实际服务开始时间缺失或无效');
  let proof;
  if(interrupted){const dispute=(b.disputes || []).find(x=>x.kind==='interruption'&&x.stoppedAt===endingAt&&x.createdBy?.role==='tech'&&typeof x.createdBy.id==='string'&&x.createdBy.id);if(dispute)proof={kind:'original-interruption',reference:dispute.id,techId:dispute.createdBy.id,at:dispute.createdAt || endingAt};}
  if(!proof){const events=(b.events || []).filter(x=>x.at===endingAt&&x.actor==='tech'&&typeof x.actorId==='string'&&x.actorId&&(interrupted?String(x.text || '').startsWith('已中止服务，等待核实：'):x.text===(b.finishReason || '正常完成')));const identities=new Set(events.map(x=>x.actorId));if(identities.size>1)return missing('原结束作者存在冲突，须先核对');if(events.length)proof={kind:'original-ending-event',reference:events.at(-1).id || `${b.id}:ending:${endingAt}`,techId:events.at(-1).actorId,at:endingAt};}
  if(!proof){const snapshots=[...(b.techIncomeSnapshots || []),...(b.techIncomeSnapshot?[b.techIncomeSnapshot]:[])].filter(x=>x.bookingId===b.id&&x.storeId===b.storeId&&typeof x.techId==='string'&&x.techId&&Number.isSafeInteger(x.capturedAt)&&x.capturedAt<=(b.startedAt || endingAt)&&x.capturedAt>=(b.createdAt || 0));const source=snapshots.at(-1);if(source)proof={kind:'original-technician-snapshot',reference:source.id,techId:source.techId,at:source.capturedAt};}
  if(!proof)return missing('原服务技师来源不足：须有原中止作者、结束事件或接单技师快照；不能凭当前分配补造');
  const source={bookingId:b.id,storeId:b.storeId,userId:b.userId,techId:proof.techId,endingKind,endingAt,startedAt:b.startedAt || null,sourceKind:proof.kind,sourceReference:proof.reference,sourceRecordedAt:proof.at};
  return {available:true,...source,sourceToken:digest(source)};
}
function newDeparture(s,actor,b,source,type,policy,ctx) {
  const row={id:id(s,ctx,'EXIT'),bookingId:b.id,storeId:source.storeId,techId:source.techId,userId:source.userId,endingKind:source.endingKind,endingAt:source.endingAt,endingSourceSnapshot:clone(source),sourceType:type,sourceStatus:b.status,createdAt:s.now,updatedAt:s.now,version:0,status:'pending',safeLeftFact:null,policySnapshot:policy?clone(policy):null,contactDueAt:policy?.departureContactMinutes!=null?source.endingAt+policy.departureContactMinutes*MIN:null,escalationDueAt:policy?.escalateMinutes!=null?source.endingAt+policy.escalateMinutes*MIN:null,contacts:[],escalations:[],history:[],owner:null,linkedSources:sourceIssues(s,b)};
  row.history.push({at:s.now,by:author(actor),action:type==='historical-recognition'?'绑定原结束与原技师来源，登记历史待核实事项':'依据新服务结束事实建立待确认记录',version:0});s.fulfilmentDepartures.push(row);return row;
}

export function captureFulfilmentTransition(s,actor,before,after,type,ctx={}) {
  if (!after || !before || !['booking.finish','booking.stop'].includes(type)) return null;
  const time=type==='booking.stop' ? after.stoppedAt : after.completedAt;
  if (!Number.isFinite(time) || time>s.now || (type==='booking.stop' ? before.stoppedAt===time : before.completedAt===time) || departureFor(s,after.id)) return departureFor(s,after.id) || null;
  upgradeFulfilment(s); const policy=policyFor(s,after.storeId),source={bookingId:after.id,storeId:after.storeId,userId:after.userId,techId:after.techId,endingKind:type==='booking.stop'?'interrupted':after.finishMode==='early'?'early':'normal',endingAt:time,startedAt:after.startedAt || null,sourceKind:'booking-command',sourceReference:type,sourceRecordedAt:s.now,endedBy:author(actor)};
  return newDeparture(s,actor,after,source,type,policy,ctx);
}

export function tickFulfilment(s,ctx={}) {
  upgradeFulfilment(s);
  for (const row of s.fulfilmentDepartures) {
    if (!['pending','contacting'].includes(row.status) || row.safeLeftFact) continue;
    if (row.contactDueAt!=null && s.now>=row.contactDueAt && !row.contactReminderAt) { row.contactReminderAt=row.contactDueAt; if (row.status==='pending') row.status='contacting'; history(s,row,{role:'system'},'到达已发布的离开联系时间',{dueAt:row.contactDueAt}); }
    if (row.escalationDueAt!=null && s.now>=row.escalationDueAt && !row.escalatedAt) { row.status='escalated'; row.escalatedAt=row.escalationDueAt; row.escalations.push({at:s.now,by:{role:'system',id:'system'},reason:'已到原快照明确配置的升级时间',dueAt:row.escalationDueAt}); history(s,row,{role:'system'},'安全离开待核实，升级集团处理'); }
  }
  return s.fulfilmentDepartures;
}

export function fulfilmentBlockers(s,bookingId) {
  const row=departureFor(s,bookingId); if (!row || ['confirmed','resolved'].includes(row.status)) return [];
  return needsReview(row) || row.policySnapshot?.blockUnconfirmed ? [`安全离开 ${row.id} 尚未核实${row.owner && !validOwner(s,row)?'，原责任授权失效':''}`] : [];
}

export function fulfilmentCommand(s,actor,type,p={},ctx={}) {
  if (!TYPES.has(type)) fail(ctx,'不支持的履约操作');
  actor=resolveAccountActor(s,actor); upgradeFulfilment(s);
  const administrative=['fulfilment.policy-publish','fulfilment.duty-save'].includes(type);
  const b=administrative ? null : booking(s,p.bookingId);
  if (administrative ? !support(actor) && !(type==='fulfilment.duty-save' && ['store','manager'].includes(actor.role) && (!actor.accountId||actor.job==='store-manager')) : !readable(s,actor,b)) fail(ctx,'预约不存在或当前岗位无权处理');
  const req=request(s,actor,type,p,ctx); if (req.prior) return clone(req.prior.result);
  if (b) bind(p,b,ctx);
  if (type==='fulfilment.policy-publish') {
    const storeId=p.storeId || null; if (storeId && !(s.stores || []).some(x=>x.id===storeId)) fail(ctx,'适用门店不存在');
    const previous=s.fulfilmentPolicies.filter(x=>x.storeId===storeId).sort((a,b)=>b.version-a.version)[0]; checkVersion(p.version,previous?.version || 0,ctx);
    if (!['tech-only','store-only','tech-store-confirm'].includes(p.collectorMode)||!['appointment-exception','none'].includes(p.noticeMode)) fail(ctx,'请明确采集分工与用户通知方式');
    const contact=p.departureContactMinutes==null||p.departureContactMinutes===''?null:integer(p.departureContactMinutes,'安全联系分钟',ctx), escalation=p.escalateMinutes==null||p.escalateMinutes===''?null:integer(p.escalateMinutes,'集团升级分钟',ctx);
    if ((contact===null)!==(escalation===null)||contact!=null && escalation<contact) fail(ctx,'明确计时须同时填写联系和升级时间，升级时间不得更早');
    const row={id:id(s,ctx,'FULP'),storeId,version:(previous?.version||0)+1,collectorMode:p.collectorMode,noticeMode:p.noticeMode,departureContactMinutes:contact,escalateMinutes:escalation,blockUnconfirmed:bool(p.blockUnconfirmed,'普通未确认是否暂停结算',ctx),basis:text(p.basis,'规则依据',ctx),reason:text(p.reason,'发布说明',ctx),effectiveAt:timestamp(p.effectiveAt,'生效时间',ctx),publishedAt:s.now,publishedBy:author(actor)};
    s.fulfilmentPolicies.push(row); return remembered(s,req,row);
  }
  if (type==='fulfilment.duty-save') {
    const existing=p.id?s.fulfilmentDutyRosters.find(x=>x.id===p.id):null; if (p.id&&!existing) fail(ctx,'值班记录不存在'); checkVersion(p.version,existing?.version || 0,ctx);
    const enabled=bool(p.enabled,'值班是否启用',ctx),closingInvalid=existing&&!enabled&&p.accountId===existing.accountId&&p.grantId===existing.grantId;
    const v=enabledGrant(s,p.accountId,p.grantId) || closingInvalid&&{account:{id:existing.accountId,name:existing.accountName},grant:{id:existing.grantId,role:existing.scope==='group'?'group':'store',storeId:existing.storeId}}; if (!v) fail(ctx,'请选择已启用的客服或门店主管工作授权');
    const scope=p.scope,storeId=scope==='store'?p.storeId:null; if (!['group','store'].includes(scope)||scope==='store'&&!(s.stores || []).some(x=>x.id===storeId)) fail(ctx,'请明确值班范围');
    if (!support(actor) && (scope!=='store'||storeId!==actor.storeId||existing && existing.storeId!==actor.storeId)) fail(ctx,'只能管理本店值班');
    if (scope==='group'?v.grant.role!=='group':v.grant.role!=='store'||v.grant.storeId!==storeId) fail(ctx,'值班范围与工作授权不一致');
    const startAt=timestamp(p.startAt,'值班开始',ctx),endAt=timestamp(p.endAt,'值班结束',ctx); if (endAt<=startAt) fail(ctx,'值班结束须晚于开始');
    const row=existing || {id:id(s,ctx,'DUTY'),version:0,history:[],createdAt:s.now}; const data={scope,storeId,accountId:v.account.id,grantId:v.grant.id,accountName:v.account.name,startAt,endAt,enabled};
    const reason=text(p.reason,'值班安排依据',ctx),previous=existing?Object.fromEntries(Object.keys(data).map(k=>[k,existing[k]])):null; if (!existing) s.fulfilmentDutyRosters.push(row); Object.assign(row,data); history(s,row,actor,'保存值班安排',{reason,previous,current:data}); return remembered(s,req,row);
  }
  if (type==='fulfilment.location-consent') {
    if (actor.role!=='tech'||!readable(s,actor,b)||(s.techs || []).every(t=>t.id!==actor.techId)) fail(ctx,'仅技师本人可以决定位置用途');
    let row=consentFor(s,actor.techId); checkVersion(p.version,row?.version || 0,ctx); const active=bool(p.active,'是否同意位置用途',ctx),basis=text(p.basis,'位置用途与撤回说明',ctx);
    row??={id:id(s,ctx,'LOC'),techId:actor.techId,version:0,history:[]}; if (!consentFor(s,actor.techId)) s.fulfilmentLocationConsents.push(row); row.active=active; if (active) row.consentedAt=s.now; else row.withdrawnAt=s.now; row.basis=basis; history(s,row,actor,active?'单独同意履约位置用途':'撤回履约位置用途',{basis}); return remembered(s,req,row);
  }
  if (type.startsWith('fulfilment.fact-')) {
    let row=recordFor(s,b.id); if (row && row.storeId!==b.storeId) fail(ctx,'原履约门店绑定已变化，须先核实历史来源'); const facts=row?.facts || [], source=p.factId?facts.find(f=>f.id===p.factId):null; checkVersion(p.version,row?.version || 0,ctx);
    if (type==='fulfilment.fact-record'||type==='fulfilment.fact-correct') {
      const policy=policyFor(s,b.storeId); if (!policy) fail(ctx,'本店尚未发布采集分工，不能把待定规则当已启用');
      const correcting=type==='fulfilment.fact-correct'; if (correcting && (!source || source.replacedBy)) fail(ctx,'原事实不存在或已经更正');
      const ownOld=correcting && actor.role==='tech' && source.techId===actor.techId && source.recordedBy.id===actor.techId;
      if (!(collector(actor,b,policy)||ownOld)) fail(ctx,'当前身份无权登记这条履约事实');
      const data=factInput(s,actor,b,{...p,...(correcting?{kind:source.kind}: {})},ctx,correcting?source.techId:b.techId);
      const correctionReason=correcting?text(p.reason,'更正依据',ctx):null;
      if (!row) { row={id:id(s,ctx,'FUL'),bookingId:b.id,storeId:b.storeId,userId:b.userId,version:0,facts:[],history:[],createdAt:s.now}; s.fulfilmentRecords.push(row); }
      const needsConfirmation=local(actor,b)&&policy.collectorMode==='tech-store-confirm';
      const fact={id:id(s,ctx,'FACT'),...data,source:local(actor,b)?'store-supplement':support(actor)?'support-investigation':'technician',policyVersion:policy.version,status:needsConfirmation?'pending-tech':'reported',confirmationState:needsConfirmation?'pending':null,confirmations:[],verifications:[],replacesFactId:correcting?source.id:null};
      if (correcting) { source.replacedBy=fact.id; source.replacementReason=correctionReason; source.replacedAt=s.now; }
      row.facts.push(fact); history(s,row,actor,correcting?'追加更正事实并保留原记录':'登记履约事实',{factId:fact.id,reason:correctionReason}); return remembered(s,req,fact);
    }
    if (!source || source.replacedBy) fail(ctx,'事实不存在或已被更正，请核对新记录');
    if (type==='fulfilment.fact-confirm') {
      if (actor.role!=='tech'||actor.techId!==source.techId||source.confirmationState!=='pending') fail(ctx,'仅原技师可以确认等待确认的门店补录');
      if (!['accept','reject'].includes(p.decision)) fail(ctx,'请选择同意或驳回'); source.confirmations.push({decision:p.decision,reason:text(p.reason,'确认意见',ctx),at:s.now,by:author(actor)}); source.confirmationState=p.decision==='accept'?'accepted':'rejected'; updateFactState(source); history(s,row,actor,'技师确认门店补录',{factId:source.id,decision:p.decision});
    } else {
      if (!support(actor)) fail(ctx,'仅集团客服可以核实履约事实'); if (!['verified','disputed'].includes(p.decision)) fail(ctx,'请选择核实或保留分歧');
      source.verifications.push({decision:p.decision,evidence:text(p.evidence,'核实证据',ctx),at:s.now,by:author(actor)}); updateFactState(source); history(s,row,actor,'客服核实履约事实',{factId:source.id,decision:p.decision});
    }
    return remembered(s,req,source);
  }
  if (type==='fulfilment.notice-record') {
    staff(actor,b,ctx); const policy=policyFor(s,b.storeId); if (!policy || policy.noticeMode!=='appointment-exception') fail(ctx,'预约联系与异常通知方式尚未发布启用');
    if (!['contact','exception'].includes(p.kind)||!['phone','sms','subscription','in-app'].includes(p.channel)||!['success','failed','unknown'].includes(p.outcome)) fail(ctx,'请明确通知类型、方式与实际结果');
    checkVersion(p.version,(s.fulfilmentNotices || []).filter(n=>n.bookingId===b.id).length,ctx);
    const row={id:id(s,ctx,'NOTICE'),bookingId:b.id,storeId:b.storeId,userId:b.userId,kind:p.kind,channel:p.channel,outcome:p.outcome,summary:text(p.summary,'实际告知内容',ctx,500),evidence:text(p.evidence,'通知实际结果依据',ctx,500),occurredAt:occurred(p.occurredAt,s,b,ctx),recordedAt:s.now,recordedBy:author(actor),policyVersion:policy.version,version:0,history:[],ack:null}; s.fulfilmentNotices.push(row); return remembered(s,req,row);
  }
  if (type==='fulfilment.notice-ack') {
    const row=s.fulfilmentNotices.find(n=>n.id===p.noticeId&&n.bookingId===b.id); if (!user(actor,b)||!row) fail(ctx,'仅预约本人可以确认已读'); checkVersion(p.version,row.version,ctx); if (row.ack) fail(ctx,'该通知已确认'); row.ack={at:s.now,by:author(actor)}; history(s,row,actor,'预约本人确认已读'); return remembered(s,req,row);
  }
  if(type==='fulfilment.departure-history'){
    staff(actor,b,ctx);const existing=departureFor(s,b.id);checkVersion(p.version,existing?.version || 0,ctx);if(existing)fail(ctx,'已有独立安全离开来源，请继续原记录核实，不得另建');
    const source=fulfilmentEndingSource(s,b);if(!source.available)fail(ctx,source.reason);if(p.endingSourceToken!==source.sourceToken)fail(ctx,'原结束或原技师来源已变化，请刷新核对后补认');
    const sourceEvidence=text(p.sourceEvidence,'原结束与原技师来源核对依据',ctx),reason=text(p.reason,'历史补认说明',ctx),row=newDeparture(s,actor,b,source,'historical-recognition',historicalPolicy(s,b.storeId,source.endingAt),ctx);
    row.historicalRecognition={occurredAt:source.endingAt,recordedAt:s.now,by:author(actor),sourceEvidence,reason};return remembered(s,req,row);
  }
  const row=departureFor(s,b.id); if (!row||p.departureId!==row.id||row.storeId!==b.storeId) fail(ctx,'本预约尚无新的安全离开记录或门店绑定已变化'); checkVersion(p.version,row.version,ctx);
  if (['confirmed','resolved'].includes(row.status)) fail(ctx,'安全离开已有核实结果，更正请走事实核实流程');
  if (type==='fulfilment.departure-confirm') {
    if (actor.role!=='tech'||actor.techId!==row.techId) fail(ctx,'仅实际服务技师可以确认安全离开');
    if (row.safeLeftFact) fail(ctx,'已有实际安全离开确认，请由责任人核实原事实，不得覆盖');
    if (!bool(p.safeLeft,'实际已经安全离开',ctx)) fail(ctx,'尚未安全离开请联系值班或求助');
    row.safeLeftFact={occurredAt:occurred(p.occurredAt,s,b,ctx,row.endingAt),recordedAt:s.now,by:author(actor),evidence:text(p.evidence,'安全离开事实说明',ctx),position:position(s,actor,b,p,ctx,row.techId)}; row.status=needsReview(row)?'awaiting_verification':'confirmed'; history(s,row,actor,'技师记录实际安全离开');
  } else if (type==='fulfilment.departure-help') {
    if (actor.role!=='tech'||actor.techId!==row.techId||row.safeLeftFact) fail(ctx,'仅尚未确认安全离开的本单技师可以求助');
    const help={reason:text(p.reason,'求助情况',ctx),at:s.now,by:author(actor),position:position(s,actor,b,p,ctx,row.techId)}; row.help??=help; row.helpRecords??=[]; row.helpRecords.push(help); row.status='escalated'; row.escalatedAt??=s.now; history(s,row,actor,'离开前求助，保留110直接求助出口');
  } else {
    staff(actor,b,ctx);
    if (type==='fulfilment.departure-contact') {
      if (!['phone','sms','subscription','in-app'].includes(p.channel)||!['success','failed','unknown'].includes(p.outcome)||!['safe-left','not-left','unknown'].includes(p.safetyOutcome)) fail(ctx,'请记录实际联系方式、联系结果和核实状态');
      if (p.outcome!=='success'&&p.safetyOutcome!=='unknown') fail(ctx,'未联系成功不能记录已经安全离开');
      row.contacts.push({at:s.now,occurredAt:occurred(p.occurredAt,s,b,ctx,row.endingAt),by:author(actor),channel:p.channel,outcome:p.outcome,safetyOutcome:p.safetyOutcome,evidence:text(p.evidence,'实际联系与核实依据',ctx)}); if (row.status==='pending') row.status='contacting'; history(s,row,actor,'记录安全离开联系结果');
    } else if (type==='fulfilment.departure-escalate') {
      const reason=text(p.reason,'升级依据',ctx); row.status='escalated'; row.escalatedAt??=s.now; row.escalations.push({at:s.now,by:author(actor),reason}); history(s,row,actor,'人工升级安全离开核实',{reason});
    } else if (type==='fulfilment.departure-takeover') {
      if (!actor.accountId || !onDuty(s,actor,b) || row.escalatedAt!=null&&!support(actor)) fail(ctx,'接管须使用相应当前有效值班工作账号，升级后由集团接管'); const reason=text(p.reason,'接管依据',ctx); row.owner={...actorAccountFields(actor),accountVersion:(s.staffAccounts || []).find(a=>a.id===actor.accountId).version,claimedAt:s.now}; row.status='handling'; history(s,row,actor,'当前有效值班人员接管',{reason});
    } else if (type==='fulfilment.departure-resolve') {
      if (row.escalatedAt!=null&&!support(actor)) fail(ctx,'升级后的安全事项由集团核实结案');
      if (needsReview(row)&&(!validOwner(s,row)||row.owner.accountId!==actor.accountId||row.owner.grantId!==actor.grantId)) fail(ctx,'高风险或求助事项须由当前有效接管责任人核实结案');
      if (!['tech-confirmation','contact-confirmation','onsite-verification'].includes(p.method)) fail(ctx,'请选择实际安全核实方式');
      if (p.method==='tech-confirmation'&&!row.safeLeftFact) fail(ctx,'尚无技师安全离开确认');
      if (p.method==='contact-confirmation'&&!row.contacts.some(c=>c.outcome==='success'&&c.safetyOutcome==='safe-left')) fail(ctx,'尚无实际联系成功并确认安全离开的事实');
      const time=occurred(p.occurredAt,s,b,ctx,row.endingAt), evidence=text(p.evidence,'安全结案核实依据',ctx); if (p.method==='tech-confirmation'&&time!==row.safeLeftFact.occurredAt) fail(ctx,'结案安全时间应沿用原技师确认事实');
      row.resolution={method:p.method,occurredAt:time,evidence,recordedAt:s.now,by:author(actor),remainingSourceIssues:sourceIssues(s,b)}; row.status='resolved'; row.resolvedAt=s.now; history(s,row,actor,'根据实际安全事实核实结案');
    }
  }
  return remembered(s,req,row);
}

export function fulfilmentPolicyView(s,actor) {
  actor=resolveAccountActor(s,actor); const group=support(actor), localActor=['store','manager'].includes(actor.role)&&(!actor.accountId||actor.job==='store-manager');
  if (!group&&!localActor) return null;
  const policies=(s.fulfilmentPolicies || []).filter(p=>group || p.storeId===null || p.storeId===actor.storeId);
  const rosters=(s.fulfilmentDutyRosters || []).filter(r=>group || r.storeId===actor.storeId).map(r=>({...clone(r),valid:rosterValid(s,r),active:rosterValid(s,r)&&r.startAt<=s.now&&s.now<r.endAt}));
  const candidates=(s.staffAccounts || []).filter(a=>a.enabled).flatMap(a=>a.grants.filter(g=>g.enabled&&(g.role==='group'&&g.job==='support'||g.role==='store'&&g.job==='store-manager')&&(group||g.role==='store'&&g.storeId===actor.storeId)).map(g=>({accountId:a.id,accountName:a.name,grantId:g.id,scope:g.role==='group'?'group':'store',storeId:g.storeId || null})));
  return {policies:clone(policies),rosters,candidates,canPublish:group,canDutySave:true,storeIds:group?(s.stores || []).map(x=>x.id):[actor.storeId]};
}
function minimalHistory(rows) { return (rows || []).map(r=>({at:r.at,action:r.action,version:r.version,by:{role:r.by?.role,job:r.by?.job,accountName:r.by?.accountName || null}})); }
export function fulfilmentView(s,actor,bookingId) {
  actor=resolveAccountActor(s,actor); const b=booking(s,bookingId); if (!readable(s,actor,b)) return null;
  const source=recordFor(s,bookingId), row=source?.storeId===b.storeId?source:null, exitSource=departureFor(s,bookingId), exit=exitSource?.storeId===b.storeId?exitSource:null, policy=policyFor(s,b.storeId), own=user(actor,b), currentTech=tech(actor,b);
  const staffReader=support(actor)||local(actor,b), detailed=staffReader&&(support(actor)||!END.has(b.status)||onDuty(s,actor,b)), coordinates=onDuty(s,actor,b)||currentTech&&!END.has(b.status),endingSource=!exit&&staffReader?fulfilmentEndingSource(s,b):null;
  const facts=own?[]:(row?.facts || []).filter(f=>staffReader || actor.role==='tech'&&f.techId===actor.techId).map(f=>{
    const out=clone(f), permittedDetail=detailed || currentTech&&!END.has(b.status)&&f.techId===actor.techId;
    if (!permittedDetail) {out.position={mode:f.position.mode,hidden:true}; delete out.evidence; delete out.coverage; out.confirmations=(f.confirmations || []).map(c=>({decision:c.decision,at:c.at})); out.verifications=(f.verifications || []).map(v=>({decision:v.decision,at:v.at}));}
    else if (!coordinates) {delete out.position.lat; delete out.position.lng; delete out.position.lastKnownAt;}
    out.canConfirm=actor.role==='tech'&&actor.techId===f.techId&&f.status==='pending-tech'&&!f.replacedBy;
    out.canVerify=support(actor)&&!f.replacedBy; out.canCorrect=!f.replacedBy&&!!policy&&(collector(actor,b,policy)||actor.role==='tech'&&f.techId===actor.techId&&f.recordedBy.id===actor.techId); return out;
  });
  const notices=(s.fulfilmentNotices || []).filter(n=>n.bookingId===bookingId).map(n=>own?{id:n.id,kind:n.kind,summary:n.summary,outcome:n.outcome,occurredAt:n.occurredAt,recordedAt:n.recordedAt,version:n.version,ack:clone(n.ack),canAck:!n.ack}:staffReader?{...clone(n),canAck:false}:null).filter(Boolean);
  let departure=null;
  if (exit&&!own&&(staffReader||actor.role==='tech'&&exit.techId===actor.techId)) {
    departure=clone(exit); departure.history=minimalHistory(exit.history); departure.ownerValid=exit.owner?validOwner(s,exit):null; departure.availableDuty=duties(s,b,exit.escalatedAt!=null?'group':undefined).map(r=>({id:r.id,accountName:enabledGrant(s,r.accountId,r.grantId)?.account.name || r.accountName,scope:r.scope}));
    if (!coordinates) { if (departure.safeLeftFact?.position) {delete departure.safeLeftFact.position.lat;delete departure.safeLeftFact.position.lng;delete departure.safeLeftFact.position.lastKnownAt;} if (departure.help?.position) {delete departure.help.position.lat;delete departure.help.position.lng;delete departure.help.position.lastKnownAt;} }
    if (!staffReader) { departure.contacts=(exit.contacts || []).map(c=>({at:c.at,outcome:c.outcome,safetyOutcome:c.safetyOutcome})); departure.escalations=(exit.escalations || []).map(x=>({at:x.at})); departure.owner=exit.owner?{accountName:exit.owner.accountName}:null; delete departure.linkedSources; if(departure.historicalRecognition)departure.historicalRecognition={occurredAt:exit.historicalRecognition.occurredAt,recordedAt:exit.historicalRecognition.recordedAt};if(departure.endingSourceSnapshot)departure.endingSourceSnapshot={endingKind:exit.endingKind,endingAt:exit.endingAt,sourceKind:exit.endingSourceSnapshot.sourceKind}; if (departure.resolution) departure.resolution={occurredAt:departure.resolution.occurredAt,recordedAt:departure.resolution.recordedAt}; }
    if (!coordinates) for (const help of departure.helpRecords || []) {delete help.position.lat;delete help.position.lng;delete help.position.lastKnownAt;}
    if (!staffReader && END.has(b.status)) {if (departure.safeLeftFact) {delete departure.safeLeftFact.evidence; departure.safeLeftFact.position={mode:departure.safeLeftFact.position.mode,hidden:true};} if (departure.help) departure.help.position={mode:departure.help.position.mode,hidden:true}; departure.helpRecords=(departure.helpRecords || []).map(h=>({at:h.at,reason:h.reason,position:{mode:h.position.mode,hidden:true}}));}
    const closed=['confirmed','resolved'].includes(exit.status);
    departure.canConfirm=!closed&&!exit.safeLeftFact&&actor.role==='tech'&&actor.techId===exit.techId;
    departure.canHelp=!closed&&actor.role==='tech'&&actor.techId===exit.techId&&!exit.safeLeftFact;
    departure.canContact=!closed&&staffReader; departure.canEscalate=departure.canContact;
    departure.canTakeover=!closed&&staffReader&&onDuty(s,actor,b)&&(exit.escalatedAt==null||support(actor));
    departure.canResolve=!closed&&staffReader&&(exit.escalatedAt==null||support(actor))&&(!needsReview(exit)||validOwner(s,exit)&&exit.owner.accountId===actor.accountId&&exit.owner.grantId===actor.grantId);
  }
  const consent=actor.role==='tech'?consentFor(s,actor.techId):null;
  return {bookingId,bookingToken:fulfilmentBindingToken(b),storeId:b.storeId,version:row?.version || 0,legacy:!row,facts,history:own?[]:minimalHistory(row?.history),policy:own?null:policy?{version:policy.version,collectorMode:policy.collectorMode,noticeMode:policy.noticeMode}:null,canRecord:!own&&collector(actor,b,policy),canNotify:staffReader&&policy?.noticeMode==='appointment-exception',canLocationConsent:actor.role==='tech',locationConsent:actor.role==='tech'?{version:consent?.version || 0,active:!!consent?.active,basis:consent?.basis || ''}:null,departure,endingSource:clone(endingSource),canRecognizeHistory:!!endingSource?.available,unknownDeparture:!exit&&END.has(b.status)&&!!(b.completedAt||b.stoppedAt),notices,noticeVersion:(s.fulfilmentNotices || []).filter(n=>n.bookingId===bookingId).length,sourceIssues:staffReader?sourceIssues(s,b):[],blockers:staffReader?fulfilmentBlockers(s,bookingId):[]};
}

export function fulfilmentTaskRows(s) {
  const rows=[];
  for (const record of s.fulfilmentRecords || []) {
    const b=booking(s,record.bookingId); if (!b||b.storeId!==record.storeId) continue;
    for (const f of record.facts) {
      const waiting=f.status==='pending-tech',done=!!f.replacedBy||f.status==='verified';
      rows.push({id:`fulfilment-fact:${f.id}:verify`,category:'fulfilment',title:'实际履约事实核实',sourceId:f.id,bookingId:b.id,storeId:b.storeId,createdAt:f.recordedAt,dueAt:null,status:done?'done':waiting?'waiting':'open',statusLabel:done?'事实核实已结束':waiting?'等待原技师确认补录':f.status==='disputed'?'事实有分歧，待客服核实':'待客服核实',sourceToken:digest([record.version,f.id,f.status,f.replacedBy,b.techId]),requiredRoute:'fulfilment',routes:{group:`/group/fulfilment/${encodeURIComponent(b.id)}`,store:`/store/fulfilment/${encodeURIComponent(b.id)}`},allowedJobs:{group:['support'],store:['store-manager']},manageRoles:['group'],assignmentMode:'task',commands:done?[]:['fulfilment.fact-verify']});
    }
  }
  for (const exit of s.fulfilmentDepartures || []) {
    const b=booking(s,exit.bookingId); if (!b||b.storeId!==exit.storeId) continue; const done=['confirmed','resolved'].includes(exit.status);
    rows.push({id:`fulfilment-exit:${exit.id}:safety`,category:'safe-departure',title:'安全离开确认与核实',sourceId:exit.id,bookingId:b.id,storeId:b.storeId,createdAt:exit.createdAt,dueAt:done?null:exit.escalatedAt!=null?null:exit.contactReminderAt?exit.escalationDueAt:exit.contactDueAt,status:done?'done':'open',statusLabel:done?'安全离开已有实际确认':exit.status==='escalated'?'已升级集团，待接管':exit.status==='awaiting_verification'?'技师已确认，求助仍待核实':'安全离开待确认或核实',sourceToken:digest([exit.version,exit.status,exit.owner,exit.contactDueAt,exit.escalationDueAt]),requiredRoute:'fulfilment',routes:{group:`/group/fulfilment/${encodeURIComponent(b.id)}`,store:`/store/fulfilment/${encodeURIComponent(b.id)}`},allowedJobs:{group:['support'],store:['store-manager']},manageRoles:exit.escalatedAt!=null?['group']:['group','store'],assignmentMode:'source',nativeOwnerName:exit.owner?.accountName || '',nativeOwnerAccountId:exit.owner?.accountId || null,nativeOwnerValid:exit.owner?validOwner(s,exit):null,commands:done?[]:['fulfilment.departure-contact','fulfilment.departure-takeover','fulfilment.departure-resolve']});
  }
  return rows;
}

