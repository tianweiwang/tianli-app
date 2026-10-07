// Original scope and evidence integrity only. No rate, cash, refund or H/Cs
// calculation lives here; callers retain their original domain projections.
const rows=(s,key)=>Array.isArray(s[key])?s[key]:[];
const id=value=>typeof value==='string'&&Boolean(value.trim());
const unique=(list,key)=>{const found=list.filter(row=>row?.id===key);return id(key)&&found.length===1?found[0]:null;};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>{try{return JSON.stringify(canonical(a??null))===JSON.stringify(canonical(b??null));}catch{return false;}};
const time=(s,value)=>Number.isSafeInteger(value)&&value>=0&&value<=s.now;
const reviewer=value=>value?.role==='group'&&['finance','all'].includes(value.job);
const file=value=>value&&/^invoice-file:[a-f0-9]{64}$/.test(value.ref||'')&&id(value.name)&&['application/pdf','image/png','image/jpeg'].includes(value.type)&&Number.isSafeInteger(value.size)&&value.size>0&&value.size<=5*1024*1024;

function recognized(s,{entry,booking,payment,snapshot},kind,value){
  const evidence=value&&unique(rows(s,'serviceExtraEvidence'),value.evidenceId);
  if(!evidence||evidence.status!=='approved'||evidence.kind!==kind||evidence.bookingId!==booking.id||evidence.paymentId!==payment.id||
    evidence.storeId!==entry.storeId||evidence.userId!==booking.userId||!id(evidence.reference)||!time(s,evidence.createdAt)||
    !time(s,evidence.reviewedAt)||evidence.reviewedAt<evidence.createdAt||value.recognizedAt!==evidence.reviewedAt||
    !reviewer(evidence.reviewedBy)||!Array.isArray(evidence.evidenceRefs)||!evidence.evidenceRefs.length||!evidence.evidenceRefs.every(file))return false;
  const approvals=(evidence.history||[]).filter(h=>h.decision==='approve'&&h.at===evidence.reviewedAt&&same(h.by,evidence.reviewedBy));
  const trails=(entry.historicalEvidence||[]).filter(h=>h.id===evidence.id&&h.kind===kind&&h.recognizedAt===evidence.reviewedAt&&same(h.by,evidence.reviewedBy));
  if(approvals.length!==1||trails.length!==1||(payment.historicalEvidence||[]).filter(key=>key===evidence.id).length!==1)return false;
  if(!(entry.history||[]).some(h=>h.evidenceId===evidence.id&&h.kind===kind&&h.at===evidence.reviewedAt&&same(h.actor,evidence.reviewedBy)))return false;
  // Original C04 cannot overwrite an already known source or existing rule.
  if(kind==='source'&&['known','promotion-pending'].includes(snapshot?.source?.status)||kind==='rule'&&snapshot?.rule!=null)return false;
  const payload=evidence.payload,at=kind==='source'?payload?.capturedAt:payload?.publishedAt;
  if(!payload||!time(s,at)||!Number.isSafeInteger(booking.createdAt)||at>booking.createdAt||evidence.occurredAt!==at)return false;
  const expected={...payload,evidenceId:evidence.id,recognizedAt:evidence.reviewedAt,...(kind==='rule'?{origin:'historical-evidence',mode:'demo',productionApproved:false}:{})};
  return same(value,expected);
}

export function serviceFinanceOriginalSource(s,entryId){
  const entry=unique(rows(s,'serviceFinanceEntries'),entryId),booking=entry&&unique(rows(s,'bookings'),entry.bookingId);
  if(!entry||!booking)return null;
  const payment=unique([booking.payment,...(booking.extensions||[])].filter(Boolean),entry.paymentId);
  const allPayments=rows(s,'bookings').flatMap(b=>[b.payment,...(b.extensions||[])].filter(Boolean));
  if(!payment||payment.status!=='success'||!unique(allPayments,payment.id)||
    rows(s,'serviceFinanceEntries').filter(e=>e?.paymentId===payment.id).length!==1||
    entry.storeId!==booking.storeId||!unique(rows(s,'stores'),entry.storeId)||!unique(rows(s,'users'),booking.userId)||
    entry.userId!=null&&entry.userId!==booking.userId||entry.kind!==(payment===booking.payment?'main':'extension'))return null;
  const snapshot=payment===booking.payment?booking.serviceFinanceSnapshot:payment.serviceFinanceSnapshot;
  const promotion=payment===booking.payment?booking.servicePromotionSnapshot:payment.servicePromotionSnapshot;
  const context={entry,booking,payment,snapshot,promotion};
  const personal=[entry.sourceSnapshot,snapshot?.source,booking.serviceFinanceSnapshot?.source].some(value=>value?.status==='promotion-pending'||value?.promoterId!=null)||
    [promotion,booking.servicePromotionSnapshot].some(value=>value?.promoter!=null||value?.binding?.promoterId!=null);
  const source=entry.sourceSnapshot;
  const sourceShape=source?.status==='unknown'||source?.status==='known'&&['group','store'].includes(source.customerType)&&
    (source.ownerType==='store'?Boolean(unique(rows(s,'stores'),source.ownerStoreId))&&source.customerType===(source.ownerStoreId===booking.storeId?'store':'group'):
      [null,undefined,'group'].includes(source.ownerType)&&!source.ownerStoreId&&source.customerType==='group');
  const sourceMatches=Boolean(snapshot&&same(source,snapshot.source))||recognized(s,context,'source',source);
  const ruleMatches=Boolean(snapshot&&same(entry.ruleSnapshot,snapshot.rule))||recognized(s,context,'rule',entry.ruleSnapshot);
  const consistent=Boolean(sourceShape&&sourceMatches&&ruleMatches&&
    (!snapshot||entry.snapshotCapturedAt==null||entry.snapshotCapturedAt===snapshot.capturedAt)&&
    (payment===booking.payment||!snapshot?.inheritedFromBookingId||snapshot.inheritedFromBookingId===booking.id)&&
    (!promotion?.inheritedFromBookingId||promotion.inheritedFromBookingId===booking.id));
  return{...context,personal,consistent,reason:consistent?'':'原下单来源或规则快照待核对'};
}

export function ordinaryServiceFinanceSource(s,entryId){
  const source=serviceFinanceOriginalSource(s,entryId);return source&&!source.personal?source:null;
}

export function serviceFinanceQueryTransaction(s,entryId,kind,transactionId){
  const source=serviceFinanceOriginalSource(s,entryId);if(!source||!['split','finish','return'].includes(kind))return null;
  const entry=source.entry,list=kind==='split'?[entry.split,...(entry.splitHistory||[])].filter(Boolean):kind==='finish'?[entry.finish].filter(Boolean):entry.returns||[];
  const pending=list.filter(tx=>tx.status==='processing'&&(transactionId==null||tx.id===transactionId));
  if(pending.length!==1)return null;const tx=pending[0];
  const all=rows(s,'serviceFinanceEntries').flatMap(e=>[e.split,...(e.splitHistory||[]),e.finish,...(e.returns||[])].filter(Boolean));
  if(!id(tx.id)||!id(tx.requestNo)||tx.kind!=null&&tx.kind!==kind||
    !Number.isSafeInteger(tx.amountCents)||tx.amountCents<0||
    all.filter(row=>row.id===tx.id).length!==1||all.filter(row=>row.requestNo===tx.requestNo).length!==1)return null;
  return tx;
}
