import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money } from './engine.mjs';
import { operationsView, operationsSummary } from './operations-ui.mjs';

const MINUTE = 60000, DAY = 86400000;
const store = {role:'store',storeId:'xingfu'}, tech = {role:'tech',techId:'lin',storeId:'xingfu'}, support = {role:'group',job:'support'};
const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const unescape = value => value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, item => ({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[item]));
const ui = (query = '') => ({
  esc:e,money,date:at => at ? new Date(at).toISOString() : '—',query:new URLSearchParams(query),
  link:(label,path,kind='') => `<a class="${e(kind)}" href="#${e(path)}">${label}</a>`,
  field:(label,name,value='',type='text',attrs='') => `<label class="field"><span>${e(label)}</span><input name="${e(name)}" type="${e(type)}" value="${e(value)}" ${attrs}></label>`,
  select:(label,name,options,value) => `<label><span>${e(label)}</span><select name="${e(name)}">${options.map(x => `<option value="${e(x.value)}" ${x.value===value?'selected':''}>${e(x.label)}</option>`).join('')}</select></label>`,
  tag:(label,kind='') => `<span class="tag ${e(kind)}">${e(label)}</span>`,
  empty:(label,detail='') => `<section><h2>${e(label)}</h2><p>${e(detail)}</p></section>`,
});
function forms(html, command) {
  return [...html.matchAll(/<form\b([^>]+)>/g)].map(([,tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v]) => [k,unescape(v)]))).filter(x => x['data-command']===command);
}
function appointment(s,id,patch={}) {
  const b={id,userId:'u1',storeId:'xingfu',serviceId:'relax',techId:'lin',status:'confirmed',startAt:s.now+4*60*MINUTE,duration:60,mode:'specified',genderPreference:'any',extensions:[],refunds:[],disputes:[],assistance:[],events:[],payment:{id:'P-'+id,status:'success',amountCents:29800,refundedCents:0},priceCents:29800,...patch};
  s.bookings.push(b); return b;
}
function registerBusy(s,actor=tech,values={}) {
  return reduce(s,actor,'booking.busy-create',{techId:actor.techId || 'lin',startAt:s.now,endAt:s.now+60*MINUTE,reason:'接待店内顾客',requestId:'ui-busy-'+s.seq,...values});
}
function renderedMetric(html, filter) {
  return Number(html.match(new RegExp(`href="#[^"]+\\?filter=${filter}">(\\d+)<`))?.[1]);
}

test('经营页面仅匹配自身路由并防止无权身份深链读取人员与待办', () => {
  const s=seed(); appointment(s,'SECRET-BOOKING');
  for(const actor of [{role:'user',userId:'u1'},{role:'group',job:'finance'},{role:'group',job:'warehouse'},{role:'group',job:'operations'}]) {
    for(const route of ['busy','operations']) {
      const html=operationsView(s,actor,[route],ui());
      assert.match(html,/没有此页面权限/); assert.doesNotMatch(html,/SECRET-BOOKING|林师傅/);
    }
    assert.equal(operationsSummary(s,actor,ui()),'');
  }
  assert.equal(operationsView(s,store,['bookings'],ui()),null);
});

test('每个经营指标数字链接都有包含指标名称与数量的可访问名称', () => {
  const s=seed(); appointment(s,'TODAY');
  for(const html of [operationsView(s,store,['operations'],ui()),operationsSummary(s,store,ui())]) {
    const links=[...html.matchAll(/<a\b[^>]*href="#[^"]+\?filter=[^"]+"[^>]*>\d+<\/a>/g)].map(x=>x[0]);
    assert.equal(links.length,10);
    for(const link of links) assert.match(link,/aria-label="[^"\d]+ \d+ 项，查看明细"/);
    assert.match(html,/aria-label="今日预约 1 项，查看明细"/);
  }
});

test('忙碌历史区分门店后台、店长代录和本人技师操作并保留稳定身份编号', () => {
  let s=registerBusy(seed(),store);
  const id=s.busyRecords[0].id;
  s=reduce(s,{role:'manager',storeId:'xingfu'},'booking.busy-extend',{id,version:s.busyRecords[0].version,endAt:s.now+90*MINUTE,reason:'店长核实后延长'});
  s=reduce(s,tech,'booking.busy-end',{id,version:s.busyRecords[0].version,reason:'本人确认结束'});
  const html=operationsView(s,support,['busy'],ui());
  assert.match(html,/操作者：门店后台代录 · 天俪·幸福里门店（xingfu）/);
  assert.match(html,/操作者：店长代录 · 天俪·幸福里门店（xingfu）/);
  assert.match(html,/操作者：本人技师 · 林师傅（lin）/);
  assert.match(html,/店长核实后延长/); assert.match(html,/本人确认结束/);
});

test('忙碌表单使用同一草稿和请求编号，当前身份只能选本人或本店人员', () => {
  const s=seed();
  const first=operationsView(s,store,['busy'],ui()), again=operationsView(s,store,['busy'],ui());
  assert.equal(first,again);
  const [form]=forms(first,'booking.busy-create');
  assert.ok(form['data-management-form']); assert.equal(form['data-next'],'/store/busy');
  assert.ok(JSON.parse(form['data-payload']).requestId);
  assert.match(first,/management-draft-note/); assert.match(first,/name="reason"[^>]*required/);
  assert.match(first,/value="lin"/); assert.match(first,/value="chen"/); assert.doesNotMatch(first,/value="ma"/);
  const mine=operationsView(s,tech,['busy'],ui());
  assert.match(mine,/value="lin"/); assert.doesNotMatch(mine,/value="chen"/);
});

test('逾期忙碌保留占用与延长结束表单，集团客服只读跟进', () => {
  let s=registerBusy(seed());
  s.now+=61*MINUTE;
  const local=operationsView(s,store,['busy'],ui());
  assert.match(local,/超时待确认/); assert.match(local,/仍保留占用/);
  const [extend]=forms(local,'booking.busy-extend'),[end]=forms(local,'booking.busy-end');
  assert.deepEqual(JSON.parse(extend['data-payload']),{id:s.busyRecords[0].id,version:s.busyRecords[0].version});
  assert.deepEqual(JSON.parse(end['data-payload']),{id:s.busyRecords[0].id,version:s.busyRecords[0].version});
  assert.equal(forms(operationsView(s,support,['busy'],ui()),'booking.busy-create').length,0);
  assert.equal(forms(operationsView(s,support,['busy'],ui()),'booking.busy-end').length,0);
  assert.match(operationsView(s,support,['busy'],ui()),/集团客服只读追踪/);
});

test('忙碌记录按本人和门店过滤，不通过页面暴露别店历史原因', () => {
  let s=registerBusy(seed());
  s=registerBusy(s,{role:'tech',techId:'ma',storeId:'silver'},{reason:'别店私有原因'});
  const own=operationsView(s,store,['busy'],ui()), other=operationsView(s,{role:'store',storeId:'silver'},['busy'],ui());
  assert.match(own,/接待店内顾客/); assert.doesNotMatch(own,/别店私有原因/);
  assert.match(other,/别店私有原因/); assert.doesNotMatch(other,/接待店内顾客/);
});

test('冲突原约与待确认候选都能追踪，候选技师无权链接原单详情', () => {
  let s=seed();
  appointment(s,'OWN-ORDER',{startAt:s.now+30*MINUTE});
  appointment(s,'CANDIDATE-ORDER',{techId:'chen',startAt:s.now+3*60*MINUTE,change:{id:'CH1',kind:'reassign',status:'pending',techId:'lin',startAt:s.now+45*MINUTE,expiresAt:s.now+15*MINUTE}});
  s=registerBusy(s);
  const local=operationsView(s,store,['busy'],ui()), mine=operationsView(s,tech,['busy'],ui());
  assert.match(local,/原约安排/); assert.match(local,/待确认候选/);
  assert.match(local,/#\/store\/bookings\/OWN-ORDER/); assert.match(local,/#\/store\/bookings\/CANDIDATE-ORDER/);
  assert.match(mine,/#\/tech\/bookings\/OWN-ORDER/); assert.doesNotMatch(mine,/#\/tech\/bookings\/CANDIDATE-ORDER/);
  assert.match(mine,/请交门店负责人协调此候选安排/);
});

test('超时未结束预约的无限占用边界显示尚未结束，不执行无效日期格式化', () => {
  let s=seed();
  appointment(s,'OVERRUN',{status:'active',startAt:s.now,startedAt:s.now});
  s=registerBusy(s); s.now+=121*MINUTE;
  const html=operationsView(s,store,['busy'],ui());
  assert.match(html,/OVERRUN/); assert.match(html,/尚未结束/); assert.match(html,/超时待确认/);
});

test('今日明日待办按业务日和状态统计，临近截止包含技师确认及变更截止', () => {
  const s=seed();
  appointment(s,'TODAY');
  appointment(s,'TOMORROW',{startAt:s.now+DAY});
  appointment(s,'CANCELLED',{status:'cancelled'});
  appointment(s,'UNPAID',{status:'unpaid',payment:{id:'UNPAID-P',status:'unpaid',amountCents:29800,refundedCents:0}});
  appointment(s,'DISPATCH',{status:'waiting',confirmationPhase:'store',round:{deadline:s.now+5*MINUTE}});
  appointment(s,'TECH-CONFIRM',{status:'waiting',confirmationPhase:'tech',round:{deadline:s.now+30*MINUTE,techDeadline:s.now+8*MINUTE}});
  appointment(s,'CHANGE',{change:{id:'CH',status:'pending',kind:'reschedule',techId:'lin',startAt:s.now+6*60*MINUTE,expiresAt:s.now+9*MINUTE}});
  appointment(s,'OTHER-STORE',{storeId:'silver',techId:'ma'});
  const html=operationsView(s,store,['operations'],ui());
  assert.equal(renderedMetric(html,'today'),4); assert.equal(renderedMetric(html,'tomorrow'),1);
  assert.equal(renderedMetric(html,'waiting'),1); assert.equal(renderedMetric(html,'urgent'),3); assert.equal(renderedMetric(html,'changes'),1);
  assert.doesNotMatch(html,/OTHER-STORE/);
  const changes=operationsView(s,store,['operations'],ui('filter=changes'));
  assert.match(changes,/原约：/); assert.match(changes,/拟约：/); assert.ok(changes.includes(ui().date(s.now+9*MINUTE)));
});

test('售后协助按预约去重，安全按事件统计，过滤能打开对应业务', () => {
  const s=seed();
  appointment(s,'CASE-ORDER',{refunds:[{id:'R1',status:'requested',amountCents:1000},{id:'R2',status:'failed',amountCents:500}],assistance:[{id:'A1',status:'open'},{id:'A2',status:'open'}]});
  s.safety=[{id:'SF1',bookingId:'CASE-ORDER',status:'open',stage:'pending',ackDeadline:s.now+3*MINUTE},{id:'SF2',bookingId:'CASE-ORDER',status:'open',stage:'acknowledged',responsibleName:'值班客服',ackDeadline:s.now+3*MINUTE}];
  const html=operationsView(s,store,['operations'],ui());
  assert.equal(renderedMetric(html,'aftersale'),1); assert.equal(renderedMetric(html,'assistance'),1); assert.equal(renderedMetric(html,'safety'),2);
  assert.match(operationsView(s,store,['operations'],ui('filter=aftersale')),/#\/store\/bookings\/CASE-ORDER/);
  assert.match(operationsView(s,store,['operations'],ui('filter=safety')),/SF1/);
  assert.match(operationsView(s,store,['operations'],ui('filter=safety')),/值班客服/);
  const mine=operationsView(s,tech,['operations'],ui());
  assert.doesNotMatch(mine,/filter=assistance/); assert.doesNotMatch(mine,/普通协助待回复/);
});

test('收付款明确为历史累计，只计成功主单加时和成功退款，不假造提成', () => {
  const s=seed();
  appointment(s,'OLD-DONE',{status:'done',startAt:s.now-2*DAY,completedAt:s.now-DAY,payment:{id:'P1',status:'success',amountCents:29800,refundedCents:9800},extensions:[{id:'EX1',status:'success',amountCents:10000,refundedCents:2000,duration:30},{id:'EX2',status:'processing',amountCents:9000,refundedCents:0,duration:30}]});
  appointment(s,'UNKNOWN',{payment:{id:'P2',status:'processing',amountCents:29800,refundedCents:0}});
  const html=operationsView(s,store,['operations'],ui());
  assert.match(html,/预约历史累计收付款/); assert.match(html,/¥398\.00/); assert.match(html,/¥118\.00/); assert.match(html,/¥280\.00/);
  assert.match(html,/技师提成请查看服务财务与提成账本/); assert.match(html,/#\/store\/operations\?filter=all/);
  assert.doesNotMatch(operationsView(s,tech,['operations'],ui()),/预约历史累计收付款/);
});

test('无占用队列排除休息请假、资格过期及预约占位，不承诺可立即派单', () => {
  let s=seed();
  s.leaves.push({id:'LV',techId:'chen',storeId:'xingfu',status:'approved',startAt:s.now,endAt:s.now+60*MINUTE});
  appointment(s,'NOW',{startAt:s.now,techId:'lin'});
  s.techs.find(t=>t.id==='zhou').validUntil='2026-10-01';
  let html=operationsView(s,store,['operations'],ui('filter=unoccupied'));
  assert.equal(renderedMetric(html,'unoccupied'),0);
  assert.match(html,/不能直接视为可约/);
  s.techs.find(t=>t.id==='zhou').validUntil='2027-10-01';
  html=operationsView(s,store,['operations'],ui('filter=unoccupied'));
  assert.equal(renderedMetric(html,'unoccupied'),1); assert.match(html,/周师傅/);
  s.now+=3*60*MINUTE;
  assert.equal(renderedMetric(operationsView(s,store,['operations'],ui()),'unoccupied'),0);
});

test('集团无占用队列交原服务门店核实，不提供无权访问的集团排班深链', () => {
  const s=seed();
  for(const actor of [support,{role:'group',job:'all'}]) {
    const html=operationsView(s,actor,['operations'],ui('filter=unoccupied'));
    assert.doesNotMatch(html,/#\/group\/schedule/);
    assert.match(html,/联系原服务门店核对排班及实际在岗情况/);
    assert.match(html,/#\/group\/busy/);
  }
  assert.match(operationsView(s,store,['operations'],ui('filter=unoccupied')),/#\/store\/schedule/);
  assert.match(operationsView(s,tech,['operations'],ui('filter=unoccupied')),/#\/tech\/schedule/);
});

test('渲染不会补写数据，原因文本转义，已结束记录不再提供结束或延长', () => {
  let s=registerBusy(seed(),tech,{reason:'<img src=x onerror=alert(1)>'});
  const id=s.busyRecords[0].id;
  s=reduce(s,tech,'booking.busy-end',{id,version:s.busyRecords[0].version,reason:'已核实结束'});
  const snapshot=JSON.stringify(s),html=operationsView(s,store,['busy'],ui());
  assert.equal(JSON.stringify(s),snapshot); assert.doesNotMatch(html,/<img src=x/); assert.match(html,/&lt;img src=x/);
  assert.match(html,/已确认结束/); assert.equal(forms(html,'booking.busy-end').length,0); assert.equal(forms(html,'booking.busy-extend').length,0);
  operationsSummary(s,store,ui());
  assert.equal(JSON.stringify(s),snapshot);
});
