import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeServiceReviews, serviceReviewCommand, serviceReviewView, technicianReviewSummary, reviewEligibility, canReadServiceReview, REVIEW_TAGS } from './service-reviews.mjs';
import { bookingSeed, bookingOptions, bookingCommand } from './booking.mjs';

const DAY=86400000, NOW=Date.parse('2026-10-03T10:00:00+08:00');
const user={role:'user',userId:'u1'}, tech={role:'tech',techId:'t1'}, store={role:'store',storeId:'s1'}, manager={role:'manager',storeId:'s1'}, group={role:'group',job:'support'};
function seed() { return {now:NOW,seq:0,users:[{id:'u1'},{id:'u2'}],techs:[{id:'t1',storeId:'s1',rating:4.9,count:100},{id:'t2',storeId:'s2'}],stores:[{id:'s1'},{id:'s2'}],bookings:[{id:'b1',userId:'u1',techId:'t1',storeId:'s1',status:'done',completedAt:NOW-DAY,payment:{status:'success',amountCents:29800,refundedCents:0},extensions:[{id:'e1',status:'success',amountCents:14900}],refunds:[],assistance:[]}],serviceCareCases:[{id:'case1',status:'open'}]}; }
let sequence=0;
function run(s,actor,type,p) {
  const next=structuredClone(s), context={fail:message=>{throw new Error(message);},id:prefix=>prefix+(++next.seq),log:(row,text)=>(row.events??=[]).push({at:next.now,text})};
  serviceReviewCommand(next,actor,type,{requestId:'request-'+(++sequence),...p},context);return next;
}
const row=s=>s.serviceReviews.at(-1);
const create=(s=seed(),p={})=>run(s,user,'review.create',{bookingId:'b1',score:2,tags:['沟通好'],text:'原始文字-PRIVATE',...p});
const change=(s,actor,type,p={})=>run(s,actor,type,{id:row(s).id,version:row(s).version,reason:'处理依据',...p});
const appeal=(s=create())=>change(s,tech,'review.appeal',{reason:'真实服务说明'});
const initial=(s=appeal(),opinion='oppose')=>change(s,store,'review.appeal-store',{opinion,reason:'初审依据'});

test('增量容器迁移不补造旧技师汇总评价，重复迁移稳定，读取纯计算',()=>{
  const s=seed(),original=structuredClone(s);
  assert.deepEqual(technicianReviewSummary(s,'t1'),{count:0,rating:null,label:'新技师',publicReviews:[]});
  serviceReviewView(s,group);reviewEligibility(s,s.bookings[0],user);assert.deepEqual(s,original);
  upgradeServiceReviews(s);const first=JSON.stringify(s);upgradeServiceReviews(s);assert.equal(JSON.stringify(s),first);assert.equal(s.serviceReviews.length,0);assert.equal(s.techs[0].count,100);
});
test('主预约完成后7天包含边界且一次不可修改，加时不是可评价主单',()=>{
  let s=seed();s.now=s.bookings[0].completedAt+7*DAY;
  const end=create(s);assert.equal(row(end).createdAt,s.now);assert.equal(row(end).bookingId,'b1');
  assert.throws(()=>create(end),/已评价/);
  s.now++;assert.throws(()=>create(s),/7天/);
  assert.throws(()=>create(seed(),{bookingId:'e1'}),/仅预约本人/);
  assert.throws(()=>run(end,user,'review.edit',{id:row(end).id,score:5}),/不支持/);
});
test('未完成、缺完成时刻、未来完成、跨用户和缺履约归属拒绝',()=>{
  for (const patch of [{status:'active'},{completedAt:null},{completedAt:NOW+1}]) {const s=seed();Object.assign(s.bookings[0],patch);assert.throws(()=>create(s),/完成/);}
  assert.throws(()=>run(seed(),{role:'user',userId:'u2'},'review.create',{bookingId:'b1',score:5}),/本人/);
  const s=seed();delete s.bookings[0].techId;assert.throws(()=>create(s),/缺少实际服务/);
});
test('评分范围、固定标签、文字长度校验；标签去重且无文字不需审核',()=>{
  for (const score of ['',0,6,2.5,'bad',true,[1]]) assert.throws(()=>create(seed(),{score}),/1至5星/);
  for (const tags of ['准时',['任意标签']]) assert.throws(()=>create(seed(),{tags}),/有效.*标签/);
  assert.throws(()=>create(seed(),{text:'字'.repeat(1001)}),/1000/);
  const s=create(seed(),{score:'5',tags:[REVIEW_TAGS[0],REVIEW_TAGS[0]],text:'  '});
  assert.deepEqual(row(s).tags,['准时']);assert.equal(row(s).textAudit.status,'no_text');assert.equal(serviceReviewView(s,group).reviews[0].canModerate,false);
});
test('退款不伪造评价剥夺，创建不更改预约、资金和独立案件',()=>{
  const s=seed();s.bookings[0].payment.refundedCents=29800;const bookings=structuredClone(s.bookings),cases=structuredClone(s.serviceCareCases);
  const next=create(s);assert.deepEqual(next.bookings,bookings);assert.deepEqual(next.serviceCareCases,cases);
});
test('文字待审核不公开，原作者与集团可见原文，审核依据只给集团',()=>{
  let s=create();
  assert.equal(technicianReviewSummary(s,'t1').publicReviews[0].text,'');
  for (const actor of [tech,store,manager]) assert.doesNotMatch(JSON.stringify(serviceReviewView(s,actor)),/原始文字-PRIVATE/);
  assert.equal(serviceReviewView(s,user).reviews[0].text,'原始文字-PRIVATE');assert.equal(serviceReviewView(s,group).reviews[0].text,'原始文字-PRIVATE');
  s=change(s,group,'review.moderate-text',{result:'approved',reason:'内部审核私密依据'});
  assert.equal(technicianReviewSummary(s,'t1').publicReviews[0].text,'原始文字-PRIVATE');
  for (const actor of [user,tech,store,manager]) assert.doesNotMatch(JSON.stringify(serviceReviewView(s,actor)),/内部审核私密依据/);
  assert.match(JSON.stringify(serviceReviewView(s,group)),/内部审核私密依据/);
  assert.doesNotMatch(JSON.stringify(row(s).events),/原始文字|私密/);
});
test('模拟审核异常可重试，通过与未通过为终态，未通过只展示星级标签',()=>{
  let s=change(create(),group,'review.moderate-text',{result:'error',reason:'模拟渠道异常'});
  assert.equal(serviceReviewView(s,group).reviews[0].canModerate,true);
  s=change(s,group,'review.moderate-text',{result:'blocked',reason:'含隐私'});
  assert.equal(serviceReviewView(s,group).reviews[0].canModerate,false);assert.equal(technicianReviewSummary(s,'t1').count,1);assert.equal(technicianReviewSummary(s,'t1').publicReviews[0].text,'');
  assert.throws(()=>change(s,group,'review.moderate-text',{result:'approved'}),/只有待审核/);
});
test('90天有效评价为同一纯评分依据：不足5条新技师，5条出分，过期和未来排除',()=>{
  let s=create();
  for(let n=2;n<=6;n++) {s.bookings.push({...structuredClone(s.bookings[0]),id:'b'+n});s=create(s,{bookingId:'b'+n,score:n===6?1:5});}
  s.serviceReviews[0].createdAt=s.now-90*DAY; // inclusive oldest row
  s.serviceReviews[5].createdAt=s.now-90*DAY-1;
  let summary=technicianReviewSummary(s,'t1');assert.equal(summary.count,5);assert.equal(summary.rating,4.4);
  s.serviceReviews[1].createdAt=s.now+1;summary=technicianReviewSummary(s,'t1');assert.equal(summary.count,4);assert.equal(summary.rating,null);
  for(const publicRow of summary.publicReviews) assert.deepEqual(Object.keys(publicRow).sort(),['createdAt','id','score','tags','text']);
});
test('差评申诉仅本人实际技师、1–2星、评价后7天内一次',()=>{
  let s=create();s.now=row(s).createdAt+7*DAY;const filed=appeal(s);assert.equal(row(filed).appeal.status,'store_pending');
  assert.throws(()=>appeal(filed),/一次/);s.now++;assert.throws(()=>appeal(s),/7天/);
  for (const score of [3,4,5]) assert.throws(()=>appeal(create(seed(),{score})),/1–2星/);
  assert.throws(()=>change(create(),{role:'tech',techId:'t2'},'review.appeal'),/无权/);
  assert.throws(()=>change(create(),store,'review.appeal'),/实际服务技师/);
});
test('技师转店仍按实际服务技师与原门店处理，跨店不能抢初审',()=>{
  let s=appeal();s.techs[0].storeId='s2';
  assert.equal(canReadServiceReview(tech,row(s)),true);assert.equal(serviceReviewView(s,tech).reviews.length,1);
  assert.throws(()=>change(s,{role:'store',storeId:'s2'},'review.appeal-store',{opinion:'support'}),/无权/);
  s=change(s,manager,'review.appeal-store',{opinion:'oppose'});assert.equal(row(s).appeal.status,'group_pending');assert.equal(row(s).storeId,'s1');
});
test('门店支持或不支持都进入集团终审，不能跳过初审；申诉成立即时移出评分',()=>{
  for (const opinion of ['support','oppose']) {
    let s=appeal();assert.equal(technicianReviewSummary(s,'t1').count,1);
    assert.throws(()=>change(s,group,'review.appeal-final',{decision:'uphold'}),/门店初审/);
    s=initial(s,opinion);assert.equal(row(s).appeal.status,'group_pending');assert.equal(technicianReviewSummary(s,'t1').count,1);
    assert.throws(()=>change(s,store,'review.appeal-final',{decision:'uphold'}),/仅集团/);
    s=change(s,group,'review.appeal-final',{decision:'uphold'});assert.equal(row(s).appeal.status,'upheld');assert.equal(technicianReviewSummary(s,'t1').count,0);assert.equal(row(s).hiddenReasons[0].kind,'appeal');
    assert.throws(()=>change(s,group,'review.appeal-final',{decision:'reject'}),/门店初审/);assert.throws(()=>appeal(s),/一次/);
  }
});
test('终审驳回不能恢复独立违规隐藏，成立也保留两种依据',()=>{
  for (const decision of ['reject','uphold']) {
    let s=change(initial(),group,'review.hide',{reason:'违规隐藏-PRIVATE'});s=change(s,group,'review.appeal-final',{decision});
    assert.equal(technicianReviewSummary(s,'t1').count,0);assert.ok(row(s).hiddenReasons.some(item=>item.kind==='content'));assert.equal(row(s).hiddenReasons.length,decision==='uphold'?2:1);
    assert.doesNotMatch(JSON.stringify(serviceReviewView(s,user)),/违规隐藏-PRIVATE|初审依据|处理依据/);
    assert.doesNotMatch(JSON.stringify(serviceReviewView(s,tech)),/违规隐藏-PRIVATE/);
  }
});
test('未隐藏的终审不成立保留评分，但不得二次申诉',()=>{
  const s=change(initial(),group,'review.appeal-final',{decision:'reject'});assert.equal(technicianReviewSummary(s,'t1').count,1);assert.equal(row(s).appeal.status,'rejected');assert.throws(()=>appeal(s),/一次/);
});
test('各端读写权限和深链一致，集团财务运营仓储无评价权限',()=>{
  const s=create();
  for(const actor of [{role:'user',userId:'u2'},{role:'tech',techId:'t2'},{role:'store',storeId:'s2'},{role:'manager',storeId:'s2'},...['finance','operations','warehouse'].map(job=>({role:'group',job}))]) {
    assert.equal(serviceReviewView(s,actor).reviews.length,0);assert.equal(canReadServiceReview(actor,row(s)),false);assert.throws(()=>change(s,actor,'review.moderate-text',{result:'approved'}),/无权/);
  }
  assert.equal(canReadServiceReview({role:'user'},{}),false);
  for(const actor of [{role:'group'},{role:'group',job:'all'},group]) assert.equal(serviceReviewView(s,actor).reviews.length,1);
});
test('成功请求跨刷新幂等，字段顺序不影响重放，同号改内容拒绝，权限先于幂等',()=>{
  const p={bookingId:'b1',score:2,tags:[],text:'测试',requestId:'stable'};
  let s=run(seed(),user,'review.create',p);const before=JSON.stringify(s);
  s=run(JSON.parse(before),{...user,job:'finance'},'review.create',{text:'测试',tags:[],score:2,bookingId:'b1',requestId:'stable'});assert.equal(JSON.stringify(s),before);
  assert.throws(()=>run(s,user,'review.create',{...p,score:5}),/同一提交标识/);
  assert.throws(()=>run(s,{role:'user',userId:'u2'},'review.create',p),/仅预约本人/);
  const command={id:row(s).id,version:row(s).version,result:'approved',reason:'审核完成',requestId:'audit-stable'};
  s=run(s,group,'review.moderate-text',command);const updated=JSON.stringify(s);s=run(JSON.parse(updated),group,'review.moderate-text',command);assert.equal(JSON.stringify(s),updated);
});
test('版本冲突与错误结果不会覆盖旧记录，最终状态与读取不更改主业务',()=>{
  let s=create(),version=row(s).version;const original=structuredClone(s.bookings);
  s=change(s,group,'review.moderate-text',{result:'error'});const before=JSON.stringify(s);
  assert.throws(()=>change(s,group,'review.hide',{version}),/已更新/);assert.throws(()=>change(s,group,'review.moderate-text',{result:'maybe'}),/模拟文字审核结果/);assert.equal(JSON.stringify(s),before);
  s=appeal(s);s=initial(s);s=change(s,group,'review.appeal-final',{decision:'uphold'});assert.deepEqual(s.bookings,original);assert.equal(s.serviceCareCases[0].status,'open');
  const frozen=JSON.stringify(s);for(const actor of [user,tech,store,group]) serviceReviewView(s,actor);technicianReviewSummary(s,'t1');assert.equal(JSON.stringify(s),frozen);
});

test('就近候选展示与实际创建使用相同90天评分；旧seed高分不参与排序',()=>{
  const s={...bookingSeed(),now:NOW,seq:0,users:[{id:'u1'}],bookings:[],serviceReviews:[],logs:[]};
  s.techs=s.techs.filter(item=>['lin','zhou'].includes(item.id));
  Object.assign(s.techs[0],{lat:31.23,lng:121.47,rating:5,count:999});
  Object.assign(s.techs[1],{lat:31.23,lng:121.47,rating:1,count:0});
  for(const [techId,score] of [['lin',3],['zhou',5]]) for(let n=0;n<5;n++) s.serviceReviews.push({id:`${techId}-${n}`,techId,score,tags:[],text:'',createdAt:NOW-DAY,hiddenReasons:[],textAudit:{status:'no_text'}});
  const selection={storeId:'xingfu',serviceId:'relax',regionId:'home',mode:'nearest',genderPreference:'any',startAt:NOW+4*3600000};
  const options=bookingOptions(s,selection);assert.equal(options.valid,true);assert.equal(options.selectedTechId,'zhou');assert.equal(options.candidates.find(item=>item.id==='lin').rating,3);assert.equal(options.candidates.find(item=>item.id==='lin').count,5);
  const next=structuredClone(s),ctx={fail:message=>{throw new Error(message);},id:prefix=>prefix+(++next.seq),log:()=>{}};
  bookingCommand(next,{role:'user',userId:'u1'},'booking.create',{...selection,techId:options.selectedTechId,contactName:'评价验证用户',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true,requestId:'nearest-review-test'},ctx);
  assert.equal(next.bookings.at(-1).techId,options.selectedTechId);
  // Same distance and no valid records: seed 999 ratings do not win over stable ID.
  s.serviceReviews=[];s.techs[0].rating=1;s.techs[1].rating=5;
  assert.equal(bookingOptions(s,selection).selectedTechId,'lin');assert.ok(bookingOptions(s,selection).candidates.every(item=>item.rating===null && item.count===0));
});
