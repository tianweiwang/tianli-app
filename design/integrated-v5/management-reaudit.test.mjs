import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money } from './engine.mjs';
import { assertJob, canManageView } from './management.mjs';
import { staffView } from './staff.mjs';

const group = { role:'group' }, operations = { role:'group', job:'operations' }, user = { role:'user', userId:'u1' }, manager = { role:'manager', storeId:'xingfu' };
let sequence = 0;
const command = (s, type, payload, actor = group) => reduce(s,actor,'manage.'+type,{...payload,requestId:'management-reaudit-'+(++sequence),reason:'复审修复验证'});
const authorizeTechnician = (s, techId) => {
  const tech=s.techs.find(t=>t.id===techId), profile=()=>s.techQualifications.find(x=>x.techId===techId);
  const q=(type,p)=>{s=reduce(s,group,'qualification.'+type,{techId,version:profile()?.version||0,requestId:'reaudit-qualification-'+(++sequence),reason:'测试独立授权前提',...p});};
  q('assess',{serviceIds:tech.serviceIds,batch:'测试审核名单',assessor:'测试考核人',proof:'TEST-ASSESS',occurredAt:s.now,result:'pass',kind:'mature'});
  q('request',{assessmentId:profile().assessments.at(-1).id});
  q('review',{grantId:profile().grants.at(-1).id,decision:'approve',reviewer:'测试集团审核',proof:'TEST-AUTH'}); return s;
};
const createTechnician = (s = seed()) => {
  s = command(s,'tech-save',{name:'资格技师',phone:'13800009001',gender:'male',storeId:'xingfu',serviceIds:['relax'],lat:31.23,lng:121.47,certificate:'CERT-TEST',insurance:'INS-TEST',validUntil:'2027-12-31'});
  const technician = s.techs.at(-1);
  s = command(s,'tech-review',{id:technician.id,version:technician.version,decision:'approve'});
  assert.throws(()=>createBooking(s,technician.id),/独立服务授权/);
  return authorizeTechnician(s,technician.id);
};
const createBooking = (s, techId, genderPreference = 'male') => reduce(s,user,'booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId,mode:'specified',genderPreference,startAt:'2026-10-02T14:00',contactName:'隐私测试用户',phone:'13800008003',adultConfirmed:true,healthConsent:true,identityVerified:true,requestId:'reaudit-booking-'+(++sequence)});
const confirmBooking = (s, techId) => {
  const id = s.bookings.at(-1).id;
  s = reduce(s,user,'booking.pay',{id,outcome:'success'});
  return reduce(s,{role:'tech',techId},'booking.accept',{id});
};
const pendingBooking = () => {
  let s = confirmBooking(createBooking(seed(),'lin'),'lin');
  return reduce(s,manager,'booking.propose-reschedule',{id:s.bookings[0].id,techId:'zhou',startAt:'2026-10-02T16:00',reason:'改约候选安排'});
};

const esc = v => String(v ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const ui = {
  esc, money, query:new URLSearchParams(), date:v=>v?new Date(v).toISOString():'—',
  link:(label,path)=>`<a href="#${esc(path)}">${label}</a>`,
  button:(label,cmd)=>`<button data-command="${cmd}">${esc(label)}</button>`,
  field:(label,name,value='')=>`<label>${esc(label)}<input name="${name}" value="${esc(value)}"></label>`,
  select:(label,name,options,value)=>`<label>${esc(label)}<select name="${name}">${options.map(o=>`<option value="${o.value}" ${String(value)===String(o.value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`,
  tag:label=>`<span>${esc(label)}</span>`, empty:(label,detail='')=>`<section>${esc(label)} ${esc(detail)}</section>`,
};

test('gender changes cannot invalidate original unpaid, waiting, confirmed or active commitments', () => {
  for (const status of ['unpaid','waiting','confirmed','active']) {
    let s = createTechnician(), technician = s.techs.at(-1);
    s = createBooking(s,technician.id);
    const id = s.bookings.at(-1).id;
    if (status !== 'unpaid') s = reduce(s,user,'booking.pay',{id,outcome:'success'});
    if (['confirmed','active'].includes(status)) s = reduce(s,{role:'tech',techId:technician.id},'booking.accept',{id});
    if (status === 'active') {
      s = reduce(s,group,'clock.advance',{minutes:300});
      s = reduce(s,{role:'tech',techId:technician.id},'booking.start',{id});
    }
    assert.equal(s.bookings.at(-1).status,status);
    const before = structuredClone(s);
    assert.throws(()=>command(s,'tech-save',{...s.techs.at(-1),gender:'female'},manager),/待确认候选.*先按影响清单协调/);
    assert.deepEqual(s,before);
  }
});

test('gender validation includes pending candidate and releases it once the proposal is rejected', () => {
  let s = createTechnician(), technician = s.techs.at(-1);
  s = confirmBooking(createBooking(s,'lin'),'lin');
  const id = s.bookings.at(-1).id;
  s = reduce(s,manager,'booking.propose-reschedule',{id,techId:technician.id,startAt:'2026-10-02T16:00',reason:'需要候选技师'});
  assert.throws(()=>command(s,'tech-save',{...s.techs.at(-1),gender:'female'},manager),/用户偏好/);
  const changeId = s.bookings.at(-1).change.id;
  s = reduce(s,user,'booking.change-answer',{id,changeId,decision:'reject'});
  s = command(s,'tech-save',{...s.techs.at(-1),gender:'female'},manager);
  assert.equal(s.techs.at(-1).gender,'female');
});

test('unrestricted preference and completed commitments allow legitimate gender corrections', () => {
  let s = createTechnician(), technician = s.techs.at(-1);
  s = confirmBooking(createBooking(s,technician.id,'any'),technician.id);
  s = command(s,'tech-save',{...s.techs.at(-1),gender:'female'},manager);
  assert.equal(s.techs.at(-1).gender,'female');
  assert.equal(s.techs.at(-1).active,true);
  let done = createTechnician(); technician = done.techs.at(-1);
  done = confirmBooking(createBooking(done,technician.id),technician.id);
  const id = done.bookings.at(-1).id;
  done = reduce(done,group,'clock.advance',{minutes:300});
  done = reduce(done,{role:'tech',techId:technician.id},'booking.start',{id});
  done = reduce(done,group,'clock.advance',{minutes:60});
  done = reduce(done,{role:'tech',techId:technician.id},'booking.finish',{id,mode:'normal'});
  done = command(done,'tech-save',{...done.techs.at(-1),gender:'female'},manager);
  assert.equal(done.techs.at(-1).gender,'female');
});

test('operations impact links lead to scoped read-only detail and retain booking command restrictions', () => {
  const s = pendingBooking(), booking = s.bookings[0];
  for (const [section,id] of [['technicians','zhou'],['stores','xingfu'],['services','relax']]) {
    const html = staffView(s,operations,[section,id],ui);
    assert.ok(html.includes(`/group/${section}/${id}/impact/${booking.id}`));
    assert.ok(!html.includes(`/group/bookings/${booking.id}`));
    const detail = staffView(s,operations,[section,id,'impact',booking.id],ui);
    assert.match(detail,/在途预约影响详情/);
    assert.match(detail,/门店负责人或集团客服/);
    assert.ok(!detail.includes('<form'));
    assert.ok(!detail.includes('data-command='));
    assert.ok(!detail.includes(booking.phone));
    assert.ok(!detail.includes(booking.contactName));
  }
  assert.equal(canManageView(operations,'bookings'),false);
  assert.match(staffView(s,operations,['bookings',booking.id],ui),/当前岗位无权查看/);
  for (const type of ['booking.assign','booking.cancel','booking.propose-reschedule','booking.refund-review','booking.assistance-close']) assert.throws(()=>assertJob(operations,type),/岗位无权/);
});

test('impact details reject unrelated or stale bookings and enforce local scope', () => {
  const s = pendingBooking(), booking = s.bookings[0];
  for (const route of [['technicians','chen','impact',booking.id],['stores','missing','impact',booking.id],['services','neck','impact',booking.id],['technicians','zhou','impact','BK-missing']]) assert.match(staffView(s,operations,route,ui),/不在当前资料的在途影响范围/);
  const otherStore = s.stores.find(x=>x.id!=='xingfu').id;
  assert.match(staffView(s,{role:'store',storeId:otherStore},['technicians','zhou','impact',booking.id],ui),/不在当前资料的在途影响范围/);
  const own = staffView(s,manager,['technicians','zhou','impact',booking.id],ui);
  assert.ok(own.includes(`/manager/bookings/${booking.id}`));
  assert.match(staffView(s,{role:'group',job:'warehouse'},['technicians','zhou','impact',booking.id],ui),/当前岗位无权查看/);
  const rejected = reduce(s,user,'booking.change-answer',{id:booking.id,changeId:booking.change.id,decision:'reject'});
  assert.match(staffView(rejected,operations,['technicians','zhou','impact',booking.id],ui),/不在当前资料的在途影响范围/);
});

test('candidate list and detail expose both original and proposed appointment times with candidate identity', () => {
  const s = pendingBooking(), b = s.bookings[0];
  for (const route of [['technicians','zhou'],['technicians','zhou','impact',b.id]]) {
    const html = staffView(s,operations,route,ui);
    assert.ok(html.includes(new Date(b.startAt).toISOString()));
    assert.ok(html.includes(new Date(b.change.startAt).toISOString()));
    assert.match(html,/待确认候选/);
  }
  assert.match(staffView(s,operations,['technicians','lin'],ui),/原约技师/);
});

test('inspection appeal resolution belongs to support while warehouse retains initial inspection', () => {
  const support = {role:'group',job:'support'}, warehouse = {role:'group',job:'warehouse'};
  assert.doesNotThrow(()=>assertJob(support,'goods.inspection-resolve'));
  assert.throws(()=>assertJob(warehouse,'goods.inspection-resolve'),/岗位无权/);
  assert.doesNotThrow(()=>assertJob(warehouse,'goods.inspect'));
  assert.throws(()=>assertJob(support,'goods.inspect'),/岗位无权/);
});
