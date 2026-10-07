import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceReviewCommand, serviceReviewView, technicianReviewSummary } from './service-reviews.mjs';
import { reviewUiView, reviewBookingPanel, technicianReviewsPanel } from './review-ui.mjs';

const DAY=86400000, NOW=Date.parse('2026-10-03T10:00:00+08:00');
const user={role:'user',userId:'u1'},tech={role:'tech',techId:'t1'},store={role:'store',storeId:'s1'},manager={role:'manager',storeId:'s1'},group={role:'group',job:'support'};
const e=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const decode=value=>value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,char=>({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[char]));
function ui(query='') {return {esc:e,date:value=>Number.isFinite(value)?new Date(value).toISOString():'—',query:new URLSearchParams(query),link:(label,path,kind='')=>`<a href="#${e(path)}" class="${e(kind)}">${label}</a>`,tag:(label,kind='')=>`<span class="tag ${e(kind)}">${e(label)}</span>`,empty:(title,detail='')=>`<section><h2>${e(title)}</h2><p>${e(detail)}</p></section>`,field:(label,name,value='',type='text',attrs='')=>`<label class="field"><span>${e(label)}</span><input type="${e(type)}" name="${e(name)}" value="${e(value)}" ${attrs}></label>`,select:(label,name,options,value='')=>`<label class="field"><span>${e(label)}</span><select name="${e(name)}">${options.map(option=>`<option value="${e(option.value)}" ${String(option.value)===String(value)?'selected':''}>${e(option.label)}</option>`).join('')}</select></label>`};}
function seed(){return {now:NOW,seq:0,users:[{id:'u1'},{id:'u2'}],stores:[{id:'s1',name:'原服务门店'},{id:'s2',name:'其他门店'}],techs:[{id:'t1',name:'林师傅',storeId:'s1',rating:4.9,count:100},{id:'t2',name:'陈师傅',storeId:'s2'}],bookings:[{id:'b1',userId:'u1',techId:'t1',storeId:'s1',completedAt:NOW-DAY,status:'done',extensions:[],refunds:[]}]};}
let n=0;
function run(s,actor,type,p) {const next=structuredClone(s);serviceReviewCommand(next,actor,type,{requestId:'ui-'+(++n),...p},{fail:message=>{throw new Error(message);},id:prefix=>prefix+(++next.seq),log:()=>{}});return next;}
const last=s=>s.serviceReviews.at(-1);
const create=(s=seed(),p={})=>run(s,user,'review.create',{bookingId:'b1',score:2,tags:['准时','沟通好'],text:'PENDING-PRIVATE <script>alert(1)</script>',...p});
const detail=(s,actor,id=last(s).id)=>reviewUiView(s,actor,['reviews',id],ui());
function forms(html,command) {return [...html.matchAll(/<form\b([^>]+)>/g)].map(([,tag])=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,decode(value)]))).filter(item=>item['data-command']===command);}
function payload(html,command) {const form=forms(html,command)[0];assert.ok(form,`缺少${command}表单`);return JSON.parse(form['data-payload']);}
function submit(s,actor,html,command,values) {return run(s,actor,command,{...payload(html,command),...values});}

test('评价仅匹配自己的路由，各端越权深链不返回记录或操作',()=>{
  const s=create();assert.equal(reviewUiView(s,user,['booking'],ui()),null);
  for(const actor of ['finance','operations','warehouse'].map(job=>({role:'group',job}))) {const html=detail(s,actor);assert.match(html,/无权查看服务评价/);assert.doesNotMatch(html,/PENDING|RV1|b1/);assert.equal(reviewBookingPanel(s,s.bookings[0],actor,ui()),'');}
  for(const actor of [{role:'user',userId:'u2'},{role:'tech',techId:'t2'},{role:'store',storeId:'s2'}]) {assert.match(detail(s,actor),/不存在或无权/);assert.equal(reviewBookingPanel(s,s.bookings[0],actor,ui()),'');}
});
test('原用户预约详情中完成后7天可填写评分、多标签与可选文字，不额外改变预约流程',()=>{
  const s=seed(),html=reviewBookingPanel(s,s.bookings[0],user,ui()),form=forms(html,'review.create')[0];
  assert.match(html,/提交后不能修改/);assert.match(html,/name="score" required/);assert.equal((html.match(/name="tags"/g)||[]).length,3);assert.match(html,/name="text"[^>]*maxlength="1000"/);assert.match(html,/type="submit"/);
  assert.deepEqual(JSON.parse(form['data-payload']),{bookingId:'b1'});assert.match(form['data-management-form'],/review:user:u1:.*b1:review.create/);assert.equal(form['data-next'],'/user/reviews');assert.equal(form['data-live-version'],'');assert.match(html,/management-draft-note/);assert.match(html,/ui.management-discard/);assert.doesNotMatch(html,/requestId/);
  assert.equal(html,reviewBookingPanel(s,s.bookings[0],user,ui()));
  s.now=s.bookings[0].completedAt+7*DAY+1;assert.equal(forms(reviewBookingPanel(s,s.bookings[0],user,ui()),'review.create').length,0);assert.match(reviewBookingPanel(s,s.bookings[0],user,ui()),/7天/);
  s.bookings[0].status='active';assert.equal(reviewBookingPanel(s,s.bookings[0],user,ui()),'');
});
test('真实模型驱动所渲染表单：用户评价→文字通过→技师申诉→初审不支持→集团成立',()=>{
  let s=seed();s=submit(s,user,reviewBookingPanel(s,s.bookings[0],user,ui()),'review.create',{score:'2',tags:['准时','沟通好'],text:'服务感受'});
  assert.deepEqual(last(s).tags,['准时','沟通好']);assert.equal(forms(reviewBookingPanel(s,s.bookings[0],user,ui()),'review.create').length,0);
  let html=detail(s,group);assert.match(html,/Demo 模拟审核回执/);s=submit(s,group,html,'review.moderate-text',{result:'approved',reason:'内部审核依据'});
  assert.match(technicianReviewsPanel(s,'t1',ui()),/服务感受/);
  html=detail(s,tech);const form=forms(html,'review.appeal')[0];assert.equal(form['data-live-version'],String(last(s).version));assert.equal(form['data-next'],'/tech/reviews/'+last(s).id);
  s=submit(s,tech,html,'review.appeal',{reason:'实际已沟通，请复核'});assert.equal(forms(detail(s,group),'review.appeal-final').length,0);
  s=submit(s,manager,detail(s,manager),'review.appeal-store',{opinion:'oppose',reason:'门店不支持，交集团判断'});assert.equal(last(s).appeal.status,'group_pending');assert.match(detail(s,group),/不支持申诉，已交集团终审/);
  s=submit(s,group,detail(s,group),'review.appeal-final',{decision:'uphold',reason:'集团确认申诉成立'});
  assert.equal(last(s).appeal.status,'upheld');assert.equal(technicianReviewSummary(s,'t1').count,0);assert.match(detail(s,tech),/申诉成立/);assert.equal(forms(detail(s,tech),'review.appeal').length,0);assert.doesNotMatch(technicianReviewsPanel(s,'t1',ui()),/服务感受/);
});
test('原文和内部审核说明在详情、处理历史、公开技师页分别隔离并转义',()=>{
  let s=create();
  for(const actor of [tech,store,manager]) {assert.doesNotMatch(detail(s,actor),/PENDING-PRIVATE|&lt;script/);assert.match(detail(s,actor),/文字待审核/);}
  assert.match(detail(s,user),/PENDING-PRIVATE &lt;script&gt;/);assert.doesNotMatch(detail(s,user),/<script>/);
  assert.doesNotMatch(technicianReviewsPanel(s,'t1',ui()),/PENDING|u1|b1|RV1/);
  s=submit(s,group,detail(s,group),'review.moderate-text',{result:'approved',reason:'内部私密-SECRET'});
  for(const actor of [user,tech,store,manager]) assert.doesNotMatch(detail(s,actor),/内部私密-SECRET/);
  assert.match(detail(s,group),/内部私密-SECRET/);assert.match(technicianReviewsPanel(s,'t1',ui()),/PENDING-PRIVATE &lt;script&gt;/);assert.doesNotMatch(technicianReviewsPanel(s,'t1',ui()),/<script>|内部私密|u1|b1/);
});
test('审核异常可从新版本重试，旧表单遭拒绝，不因渲染生成新请求或改业务',()=>{
  let s=create(),oldHtml=detail(s,group);s=submit(s,group,oldHtml,'review.moderate-text',{result:'error',reason:'模拟超时'});
  assert.match(detail(s,group),/审核异常/);assert.equal(forms(detail(s,group),'review.moderate-text').length,1);
  assert.throws(()=>submit(s,group,oldHtml,'review.moderate-text',{result:'approved',reason:'旧表单'}),/已更新/);
  s=submit(s,group,detail(s,group),'review.moderate-text',{result:'blocked',reason:'含隐私'});assert.equal(forms(detail(s,group),'review.moderate-text').length,0);assert.doesNotMatch(detail(s,store),/PENDING/);
  const before=JSON.stringify(s);for(const actor of [user,tech,store,manager,group]) {detail(s,actor);reviewUiView(s,actor,['reviews'],ui());reviewBookingPanel(s,s.bookings[0],actor,ui());}technicianReviewsPanel(s,'t1',ui());assert.equal(JSON.stringify(s),before);
});
test('一次申诉表单遵从模型期限、评分和旧版本，不暴露二次申诉入口',()=>{
  for (const score of [3,4,5]) {const s=create(seed(),{score});assert.equal(forms(detail(s,tech),'review.appeal').length,0);assert.match(detail(s,tech),/1–2星/);}
  let s=create();s.now=last(s).createdAt+7*DAY;assert.equal(forms(detail(s,tech),'review.appeal').length,1);s.now++;assert.equal(forms(detail(s,tech),'review.appeal').length,0);assert.match(detail(s,tech),/7天/);
  s=create();s=submit(s,tech,detail(s,tech),'review.appeal',{reason:'申诉'});s=submit(s,store,detail(s,store),'review.appeal-store',{opinion:'support',reason:'初审'});s=submit(s,group,detail(s,group),'review.appeal-final',{decision:'reject',reason:'终审'});assert.equal(forms(detail(s,tech),'review.appeal').length,0);assert.match(detail(s,tech),/申诉不成立/);
});
test('评价列表支持原预约与状态筛选，待办计数仅表示当前身份可处理',()=>{
  let s=create();assert.equal(serviceReviewView(s,group).summary.pendingText,1);assert.equal(serviceReviewView(s,store).summary.pendingText,0);
  assert.match(reviewUiView(s,user,['reviews'],ui()),/本人已提交 1 条评价/);assert.doesNotMatch(reviewUiView(s,user,['reviews'],ui()),/待文字审核 0|文字审核 0 条/);
  s=submit(s,tech,detail(s,tech),'review.appeal',{reason:'申诉'});assert.equal(serviceReviewView(s,store).summary.pendingStore,1);assert.equal(serviceReviewView(s,group).summary.pendingStore,0);
  assert.match(reviewUiView(s,store,['reviews'],ui('bookingId=b1&status=store_pending')),/RV1/);assert.doesNotMatch(reviewUiView(s,store,['reviews'],ui('bookingId=other')),/href="#\/store\/reviews\/RV1"/);
  s=submit(s,store,detail(s,store),'review.appeal-store',{opinion:'oppose',reason:'初审'});assert.equal(serviceReviewView(s,group).summary.pendingFinal,1);assert.equal(serviceReviewView(s,store).summary.pendingStore,0);assert.match(reviewUiView(s,group,['reviews'],ui('status=group_pending')),/RV1/);
});
test('公开评分没有旧seed伪评价，五条后显示近90天分数，隐藏即时改回新技师',()=>{
  let s=seed();assert.match(technicianReviewsPanel(s,'t1',ui()),/新技师/);assert.doesNotMatch(technicianReviewsPanel(s,'t1',ui()),/4\.9|100 条/);
  s=create(s,{score:5,text:''});for(let n=2;n<=5;n++){s.bookings.push({...s.bookings[0],id:'b'+n});s=create(s,{bookingId:'b'+n,score:5,text:''});}
  assert.match(technicianReviewsPanel(s,'t1',ui()),/5\.0 分 · 近90天 5 条有效评价/);
  s=submit(s,group,detail(s,group),'review.hide',{reason:'独立违规'});assert.match(technicianReviewsPanel(s,'t1',ui()),/新技师/);assert.match(detail(s,user),/评价已隐藏/);assert.doesNotMatch(detail(s,user),/独立违规/);
});
