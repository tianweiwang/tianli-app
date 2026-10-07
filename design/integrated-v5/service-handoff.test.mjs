import test from 'node:test';
import assert from 'node:assert/strict';
import {upgradeHandoffs,recipientView,recipientCommand,captureBookingHandoff,handoffView,handoffSources,handoffCommand} from './service-handoff.mjs';

const now = Date.parse('2026-10-03T10:00:00+08:00'), HOUR = 3600000;
const user = {role:'user',userId:'u1'}, other = {role:'user',userId:'u2'};
const tech = {role:'tech',techId:'t1'}, local = {role:'store',storeId:'s1'}, manager = {role:'manager',storeId:'s1'}, support = {role:'group',job:'support'};
let requestSeq = 0;
function seed() { return {now,seq:0,users:[{id:'u1'},{id:'u2'}],stores:[{id:'s1'},{id:'s2'}],techs:[{id:'t1',storeId:'s1'},{id:'t2',storeId:'s1'}],bookings:[],logs:[]}; }
const ctx = s => ({id:prefix=>prefix+(++s.seq),fail:message=>{throw new Error(message)},log:(_,message)=>s.logs.push(message)});
function run(s,a,type,p={}) { const next = structuredClone(s), input = {requestId:'HREQ'+(++requestSeq),...p}; if(type.startsWith('recipient.')) recipientCommand(next,a,type,input,ctx(next)); else handoffCommand(next,a,type,input,ctx(next)); return next; }
function recipient(s=seed(),p={},a=user) { return run(s,a,'recipient.save',{kind:'family',name:'家人甲',relationship:'母亲',consent:true,...p}); }
const profile = s => s.recipients.find(r=>r.userId==='u1');
const record = (s,id='B1') => s.serviceHandoffs.find(r=>r.bookingId===id);
function capture(s,p={},b={}) {
  const next=structuredClone(s), order={id:'B1',userId:'u1',storeId:'s1',techId:'t1',status:'confirmed',startAt:now,startedAt:null,completedAt:null,stoppedAt:null,round:{deadline:now+HOUR},events:[],...b};
  const r=profile(next);
  captureBookingHandoff(next,user,order,{recipientId:r.id,recipientVersion:r.version,recipientConfirmed:true,attention:'肩部请轻柔',preference:'交流前先询问',...p},ctx(next));
  next.bookings.push(order); return next;
}
function fixture() { return capture(recipient()); }
function start(s) { const next=structuredClone(s); next.bookings[0].status='active';next.bookings[0].startedAt=now-HOUR;return next; }
function done(s) { const next=start(s);next.bookings[0].status='done';next.bookings[0].completedAt=now;return next; }
function command(s,type,p={},a=tech) { return run(s,a,'handoff.'+type,{bookingId:'B1',version:record(s).version,...p}); }
function note(s,p={},a=tech) { return command(s,'note',{observation:'已按用户当次确认轻柔调整',nextAdvice:'下次先重新确认力度',occurredAt:now-1000,...p},a); }
function accept(s,p={}) { return command(s,'decide',{noteId:record(s).notes.at(-1).id,decision:'accept',...p},user); }

test('H01 additive migration never infers recipients from old contact names and is repeatable',()=>{
  const s=seed();s.bookings=[{id:'OLD',userId:'u1',storeId:'s1',techId:'t1',contactName:'母亲',phone:'13800000001'}];const before=structuredClone(s.bookings);
  upgradeHandoffs(s);const once=structuredClone(s);upgradeHandoffs(s);
  assert.deepEqual(s,once);assert.deepEqual(s.bookings,before);assert.deepEqual(s.recipients,[]);assert.deepEqual(s.serviceHandoffs,[]);
  const legacy=handoffView(s,user,'OLD');assert.equal(legacy.legacy,true);assert.equal(legacy.recipientSnapshot,null);assert.equal(legacy.canNote,false);
});
test('H01 saved profiles distinguish owner from recipient and preserve immutable prior values in history',()=>{
  let s=recipient();const r=profile(s);assert.equal(r.userId,'u1');assert.equal(r.kind,'family');assert.equal(r.version,1);assert.deepEqual(r.consent,{at:now,userId:'u1'});
  s=run(s,user,'recipient.save',{id:r.id,version:r.version,kind:'family',name:'家人甲新称呼',relationship:'母亲',consent:true});
  assert.equal(profile(s).version,2);assert.equal(profile(s).history[1].previous.name,'家人甲');assert.equal(profile(s).history[1].by.id,'u1');
});
test('H01 only real users own profile CRUD and reads; staff cannot browse family roster',()=>{
  const s=recipient(), r=profile(s);
  for(const actor of [other,tech,local,manager,support,{role:'group',job:'all'},{role:'user',userId:'missing'}]){
    assert.deepEqual(recipientView(s,actor),[]);
    assert.throws(()=>run(s,actor,'recipient.status',{id:r.id,version:1,active:false}),/无权|仅有效/);
  }
});
test('H01 profile validation requires consent and usable kind/name/relationship without identity documents',()=>{
  for(const p of [{consent:false},{kind:'unknown'},{name:''},{name:'甲'.repeat(31)},{relationship:''},{name:{hidden:'x'}}])assert.throws(()=>recipient(seed(),p));
  const s=recipient(seed(),{kind:'self',name:'本人称呼',relationship:''});assert.equal(profile(s).relationship,'本人');assert.equal(profile(s).identityNumber,undefined);
  assert.equal(profile(recipient(seed(),{kind:'other',relationship:'朋友'})).relationship,'朋友');
});
test('H01 equal names do not merge identities, and same-name profiles can belong to different users',()=>{
  let s=recipient();s=recipient(s);s=recipient(s,{},other);
  assert.equal(s.recipients.length,3);assert.equal(new Set(s.recipients.map(r=>r.id)).size,3);assert.equal(recipientView(s,user).length,2);assert.equal(recipientView(s,other).length,1);
});
test('H01 recipient save/status versions reject stale or missing mutations',()=>{
  const s=recipient(),r=profile(s);
  for(const version of [0,undefined,true,'',2])assert.throws(()=>run(s,user,'recipient.status',{id:r.id,version,active:false}),/版本|已更新/);
  assert.throws(()=>run(s,user,'recipient.save',{id:r.id,version:0,kind:'self',name:'本人',consent:true}),/已更新/);
});
test('H01 recipient request ids are durable, content-bound and isolated by user',()=>{
  const s=seed(),p={kind:'family',name:'家人甲',relationship:'母亲',consent:true,requestId:'shared'};
  recipientCommand(s,user,'recipient.save',p,ctx(s));const before=structuredClone(s);recipientCommand(s,user,'recipient.save',p,ctx(s));assert.deepEqual(s,before);
  assert.throws(()=>recipientCommand(s,user,'recipient.save',{...p,name:'不同'},ctx(s)),/同一提交/);
  recipientCommand(s,other,'recipient.save',p,ctx(s));assert.equal(s.recipients.length,2);assert.equal(s.recipients[1].userId,'u2');
});
test('H01 inactive profiles retain historical orders, block new selection and can be restored',()=>{
  let s=fixture();const b=structuredClone(s.bookings[0]),r=profile(s);
  s=run(s,user,'recipient.status',{id:r.id,version:r.version,active:false,reason:'暂不使用'});
  assert.equal(profile(s).active,false);assert.deepEqual(s.bookings[0],b);assert.equal(handoffView(s,user,'B1').legacy,false);assert.match(profile(s).history.at(-1).reason,/暂不使用/);
  assert.throws(()=>capture(s,{}, {id:'B2'}),/已停用/);
  assert.throws(()=>run(s,user,'recipient.save',{id:r.id,version:profile(s).version,kind:'self',name:'新',consent:true}),/已停用/);
  s=run(s,user,'recipient.status',{id:r.id,version:profile(s).version,active:true});assert.ok(capture(s,{}, {id:'B2'}));
});
test('H02 capture uses versioned recipient snapshot and separate confirmed handoff text',()=>{
  const s=fixture(),b=s.bookings[0],h=record(s);
  assert.equal(b.recipientSnapshot.kind,'family');assert.equal(b.recipientSnapshot.name,'家人甲');assert.equal(b.recipientId,profile(s).id);
  assert.equal(b.confirmation,undefined);assert.equal(b.attention,undefined);assert.ok(!JSON.stringify(b).includes('肩部请轻柔'));
  assert.equal(h.confirmation.userId,'u1');assert.equal(h.confirmation.confirmedAt,now);assert.equal(h.confirmation.attention,'肩部请轻柔');
});
test('H02 profile edits never rewrite old order or handoff snapshots and reject old draft version',()=>{
  let s=fixture();const b=structuredClone(s.bookings[0]),h=structuredClone(record(s)),r=profile(s);
  s=run(s,user,'recipient.save',{id:r.id,version:r.version,kind:'family',name:'已修改称呼',relationship:'母亲',consent:true});
  assert.deepEqual(s.bookings[0],b);assert.deepEqual(record(s),h);
  assert.throws(()=>capture(s,{recipientVersion:1},{id:'B2'}),/已更新/);
  s=capture(s,{}, {id:'B2'});assert.equal(s.bookings[1].recipientSnapshot.name,'已修改称呼');
});
test('H02 visit-only recipient is order scoped, never creates a saved roster or reusable source',()=>{
  let s=capture(recipient(),{recipientId:'visit',recipientKind:'other',recipientName:'本次朋友',recipientRelationship:'朋友'});assert.equal(s.recipients.length,1);
  assert.equal(s.bookings[0].recipientSnapshot.saved,false);s=accept(note(done(s)));assert.deepEqual(handoffSources(s,user,'visit','s1'),[]);
});
test('H02 legacy calls add neither recipient snapshots nor fake consent and partial new payload cannot bypass confirmation',()=>{
  const s=seed(),b={id:'B0',userId:'u1',contactName:'旧联系人'};assert.equal(captureBookingHandoff(s,user,b,{contactName:'旧联系人'},ctx(s)),null);assert.deepEqual(b,{id:'B0',userId:'u1',contactName:'旧联系人'});assert.equal(s.serviceHandoffs,undefined);
  for(const p of [{recipientConfirmed:false},{recipientId:''},{recipientConfirmed:true,recipientId:'visit',recipientName:''}])assert.throws(()=>capture(recipient(),p));
});
test('H02 capture rejects other user profiles, disabled recipient and handoff overwrite',()=>{
  let s=recipient(seed(),{},other);s=recipient(s);assert.throws(()=>capture(s,{recipientId:s.recipients[0].id}),/不属于/);
  s=fixture();assert.throws(()=>captureBookingHandoff(s,user,s.bookings[0],{recipientId:profile(s).id,recipientVersion:1,recipientConfirmed:true},ctx(s)),/不能覆盖/);
});
test('H03 handoff views enforce order ownership, current assignment, store and group job',()=>{
  const s=fixture();for(const a of [user,tech,local,manager,support,{role:'group',job:'all'}])assert.ok(handoffView(s,a,'B1'));
  for(const a of [other,{role:'tech',techId:'t2'},{role:'store',storeId:'s2'},{role:'group',job:'finance'},{role:'group',job:'operations'},{role:'group',job:'warehouse'}])assert.equal(handoffView(s,a,'B1'),null);
  assert.equal(handoffView(s,user,'missing'),null);
});
test('H03 only current technician reads; notes do not invalidate read while reassignment does',()=>{
  let s=command(fixture(),'ack');assert.equal(handoffView(s,tech,'B1').hasRead,true);assert.equal(handoffView(s,tech,'B1').canAck,false);
  s=note(start(s));assert.equal(handoffView(s,tech,'B1').hasRead,true);
  s.bookings[0].techId='t2';s.bookings[0].changeHistory=[{id:'C1',status:'accepted'}];assert.equal(handoffView(s,tech,'B1'),null);
  const next={role:'tech',techId:'t2'};assert.equal(handoffView(s,next,'B1').hasRead,false);s=command(s,'ack',{},next);assert.equal(record(s).acks.length,2);
  s.bookings[0].techId='t1';s.bookings[0].changeHistory.push({id:'C2',status:'accepted'});assert.equal(handoffView(s,tech,'B1').canAck,true);
});
test('H03 handoff acknowledgements cannot be made by another role or on cancelled unpaid appointments',()=>{
  const s=fixture();for(const actor of [user,local,manager,support])assert.throws(()=>command(s,'ack',{},actor),/仅当前分配/);
  for(const status of ['unpaid','cancelled','closed']){const x=structuredClone(s);x.bookings[0].status=status;assert.throws(()=>command(x,'ack'),/无需确认/);}
});
test('H03 notes require actual service start, not an upcoming appointment or invented completed status',()=>{
  const s=fixture();assert.throws(()=>note(s),/实际开始服务后/);const x=structuredClone(s);x.bookings[0].status='done';assert.throws(()=>note(x),/实际开始服务后/);
  for(const status of ['active','interrupted','done']){const y=start(s);y.bookings[0].status=status;assert.equal(record(note(y)).notes.length,1);}
});
test('H03 service/coordination records retain real author rather than pretending to be assigned technician',()=>{
  const s=start(fixture());for(const actor of [tech,local,manager,support]){const next=note(s,{},actor);assert.equal(record(next).notes[0].by.role,actor.role);}
  assert.throws(()=>note(s,{},user),/仅当前技师/);assert.throws(()=>note(s,{}, {role:'group',job:'finance'}),/无权/);
});
test('H03 note fact time is real, not future or before service, and date normalization is Shanghai',()=>{
  const s=start(fixture());for(const occurredAt of [now+1,now-2*HOUR,'2026-02-30T10:00','2026-10-03T25:00',NaN])assert.throws(()=>note(s,{occurredAt}),/时间/);
  assert.equal(record(note(s,{occurredAt:'2026-10-03T09:30'})).notes[0].occurredAt,now-HOUR/2);
});
test('H03 correction appends author and reason, preserves original, and invalidates accepted old advice',()=>{
  let s=accept(note(done(fixture()))),h=record(s),old=structuredClone(h.notes[0]);assert.equal(handoffSources(s,user,profile(s).id,'s1').length,1);
  s=note(s,{correctionOf:old.id,reason:'复核后更正力度说明',observation:'更正：当次仅作轻柔说明',nextAdvice:'下次重新询问后确定力度'});h=record(s);
  assert.equal(h.notes.length,2);assert.equal(h.notes[0].observation,old.observation);assert.equal(h.notes[0].decision.decision,'accept');assert.equal(h.notes[0].replacedBy,h.notes[1].id);assert.equal(h.notes[1].status,'pending');assert.deepEqual(handoffSources(s,user,profile(s).id,'s1'),[]);
  assert.throws(()=>command(s,'decide',{noteId:old.id,decision:'accept'},user),/已处理|已被更正/);
  s=accept(s);assert.equal(handoffSources(s,user,profile(s).id,'s1')[0].noteId,record(s).notes[1].id);
});
test('H03 only original author corrects a current record and correction requires its own reason',()=>{
  const s=note(done(fixture())),id=record(s).notes[0].id;
  assert.throws(()=>note(s,{correctionOf:id,reason:'审核'},local),/原记录作者/);
  assert.throws(()=>note(s,{correctionOf:id,reason:''}),/更正原因/);
  assert.throws(()=>note(s,{correctionOf:'missing',reason:'审核'}),/原记录作者/);
});
test('H03 only booking owner decides once; rejection retains record but never creates reusable advice',()=>{
  const s=note(done(fixture())),noteId=record(s).notes[0].id;
  for(const actor of [tech,local,support])assert.throws(()=>command(s,'decide',{noteId,decision:'accept'},actor),/仅预约用户/);
  const rejected=command(s,'decide',{noteId,decision:'reject'},user);assert.equal(record(rejected).notes[0].status,'rejected');assert.deepEqual(handoffSources(rejected,user,profile(s).id,'s1'),[]);
  assert.throws(()=>command(rejected,'decide',{noteId,decision:'accept'},user),/已处理/);
});
test('H04 sources require same owner recipient store plus completed actual service and accepted advice',()=>{
  let s=accept(note(start(fixture())));assert.deepEqual(handoffSources(s,user,profile(s).id,'s1'),[]);s=done(s);assert.equal(handoffSources(s,user,profile(s).id,'s1').length,1);
  assert.deepEqual(handoffSources(s,other,profile(s).id,'s1'),[]);assert.deepEqual(handoffSources(s,user,profile(s).id,'s2'),[]);assert.deepEqual(handoffSources(s,local,profile(s).id,'s1'),[]);
  const different=recipient(s);assert.deepEqual(handoffSources(different,user,different.recipients.at(-1).id,'s1'),[]);
  const noAdvice=accept(note(done(fixture()),{nextAdvice:''}));assert.deepEqual(handoffSources(noAdvice,user,profile(noAdvice).id,'s1'),[]);
});
test('H04 copied suggestion records source and allows user to adapt wording after renewed confirmation',()=>{
  const s=accept(note(done(fixture()))),source=handoffSources(s,user,profile(s).id,'s1')[0];
  const next=capture(s,{sourceBookingId:source.bookingId,sourceNoteId:source.noteId,sourceVersion:source.version,preference:'这次希望力度更轻，先询问'},{id:'B2'}),h=record(next,'B2');
  assert.equal(h.confirmation.sourceNoteId,source.noteId);assert.equal(h.confirmation.sourceVersion,source.version);assert.equal(h.confirmation.preference,'这次希望力度更轻，先询问');assert.equal(h.confirmation.confirmedAt,now);
});
test('H04 stale corrected rejected foreign or cross-store source cannot pass capture even with consent true',()=>{
  const s=accept(note(done(fixture()))),source=handoffSources(s,user,profile(s).id,'s1')[0],p={sourceBookingId:source.bookingId,sourceNoteId:source.noteId,sourceVersion:source.version};
  assert.throws(()=>capture(s,{...p,sourceVersion:source.version-1},{id:'B2'}),/已更新/);
  assert.throws(()=>capture(s,p,{id:'B2',storeId:'s2'}),/历史建议已失效/);
  assert.throws(()=>capture(s,{...p,sourceNoteId:'missing'},{id:'B2'}),/历史建议已失效/);
  const corrected=note(s,{correctionOf:source.noteId,reason:'需更正'});assert.throws(()=>capture(corrected,p,{id:'B2'}),/历史建议已失效/);
});
test('H04 handoff mutations enforce versions and idempotency without duplicating notes or crossing roles',()=>{
  const s=start(fixture()),p={bookingId:'B1',version:1,observation:'事实',occurredAt:now,nextAdvice:'建议',requestId:'same-note'};
  handoffCommand(s,tech,'handoff.note',p,ctx(s));const before=structuredClone(s);handoffCommand(s,tech,'handoff.note',p,ctx(s));assert.deepEqual(s,before);
  assert.throws(()=>handoffCommand(s,tech,'handoff.note',{...p,observation:'另一事实'},ctx(s)),/同一提交/);
  assert.throws(()=>handoffCommand(s,local,'handoff.note',p,ctx(s)),/已更新/);
  handoffCommand(s,local,'handoff.note',{...p,version:record(s).version},ctx(s));assert.equal(record(s).notes.length,2);
  for(const version of [1,undefined,true,''])assert.throws(()=>command(s,'ack',{version}),/版本|已更新/);
});
test('H04 reads are pure copies, all notes visible to owner, and shared logs contain no names or note text',()=>{
  let s=note(done(fixture()),{observation:'秘密客观服务记录',nextAdvice:'仅当次可用建议'},support);const before=structuredClone(s),h=handoffView(s,user,'B1');
  assert.equal(h.notes[0].observation,'秘密客观服务记录');h.notes[0].observation='乱改';recipientView(s,user)[0].name='乱改';handoffSources(s,user,profile(s).id,'s1');assert.deepEqual(s,before);
  const logs=s.logs.join('\n');assert.ok(!logs.includes('秘密客观'));assert.ok(!logs.includes('家人甲'));assert.ok(!logs.includes('肩部请轻柔'));
});
test('H04 no handoff operation changes service status payments deadlines or assignment',()=>{
  let s=done(fixture()),before=structuredClone(s.bookings);s=command(s,'ack');s=accept(note(s));s=note(s,{correctionOf:record(s).notes[0].id,reason:'事实更正'});assert.deepEqual(s.bookings,before);
});
