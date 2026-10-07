import test from 'node:test';
import assert from 'node:assert/strict';
import { closedRightsDetailsUiView } from './privacy-closed-details-ui.mjs';
import { captureClosedRights, assertClosedRightsCommand } from './privacy-closed-rights.mjs';
import { servicePromotionCommand } from './service-promotion.mjs';

const HOUR=3600000,NOW=Date.parse('2026-10-04T12:00:00+08:00'),CLOSED=NOW-HOUR;
const user={role:'user',userId:'u1'},other={role:'user',userId:'u2'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui={esc,date:t=>new Date(t).toISOString(),money:n=>`¥${(n/100).toFixed(2)}`,link:(label,path,cls)=>`<a class="${esc(cls)}" href="#${esc(path)}">${label}</a>`,getDraft(){throw new Error('关闭详情不得创建预约草稿');},field(){throw new Error('关闭详情不得借原完整表单恢复普通交易');}};
function fixture({status='awaiting_user',executionStatus=status,id='SPW1'}={}){
  // Isolated old ledger with a real capture -> Binding -> View path. It is
  // neither a normal close transaction nor proof of a real payment channel.
  const p={id:'SPR1',personKind:'user',personId:'u1',promoterType:'store-promoter',ownerType:'store',ownerStoreId:'s1',createdAt:CLOSED-4*HOUR,status:'disabled',version:3,identity:{status:'verified',evidenceRefs:[{ref:'IDENTITY-MUST-NOT-RETURN'}]},agreementSnapshot:{body:'AGREEMENT-MUST-NOT-RETURN'},transferAuthorization:{exempt:false},history:[]};
  const snapshot={capturedAt:CLOSED-3*HOUR,origin:'booking-create',promoter:Object.fromEntries(['id','personKind','personId','promoterType','ownerType','ownerStoreId'].map(k=>[k,p[k]])),binding:null,rule:null};
  const b={id:'CUSTOMER-BOOKING-MUST-NOT-RETURN',userId:'u3',storeId:'s1',createdAt:CLOSED-3*HOUR,status:'done',completedAt:CLOSED-HOUR,payment:{id:'CUSTOMER-PAYMENT-MUST-NOT-RETURN',status:'success',amountCents:20000,createdAt:CLOSED-3*HOUR},extensions:[],refunds:[],servicePromotionSnapshot:snapshot,phone:'PHONE-MUST-NOT-RETURN',address:{detail:'ADDRESS-MUST-NOT-RETURN'}};
  const c={id:'SPC1',promoterId:p.id,personKey:'user:u1',userId:b.userId,storeId:b.storeId,bookingId:b.id,paymentId:b.payment.id,sourceSnapshot:structuredClone(snapshot),sourceToken:'BALANCE-TOKEN-MUST-NOT-RETURN',createdAt:CLOSED-90*60000,status:'withdrawing',known:true,commissionCents:4000,storeCents:2000,groupCents:2000,financialReady:true,version:4,adjustments:[]};
  const w={id,promoterId:p.id,personKind:'user',personId:'u1',personKey:'user:u1',ownerType:'store',ownerStoreId:'s1',createdAt:CLOSED-20*60000,amountCents:2000,allocations:[{commissionId:c.id,amountCents:2000,storeCents:1000,groupCents:1000,sourceToken:'ALLOCATION-TOKEN-MUST-NOT-RETURN',sourceVersion:2}],status,version:2,countDate:'2026-10-04',policySnapshot:{body:'POLICY-MUST-NOT-RETURN'},authorizationSnapshot:{exempt:false},confirmExpiresAt:NOW+HOUR,execution:executionStatus==null?null:{id:'SPTX1',requestNo:'BANK-NUMBER-MUST-NOT-RETURN',status:executionStatus,attempts:1,completedAt:executionStatus==='success'?NOW-1:undefined,proof:{reference:'BANK-PROOF-MUST-NOT-RETURN',evidenceRefs:[{ref:'FILE-MUST-NOT-RETURN'}]},results:[]},history:[]};
  const d={id:'SPD1',promoterId:p.id,personKey:'user:u1',commissionId:c.id,bookingId:b.id,paymentId:b.payment.id,storeId:b.storeId,createdAt:CLOSED+30*60000,status:'return-pending',version:1,amountCents:800,receivedCents:1000,outstandingCents:0,returnPendingCents:200,storeCents:400,groupCents:400,records:[{id:'SPDR1',kind:'cash',amountCents:1000,reference:'RECOVERY-MUST-NOT-RETURN',evidenceRefs:[{ref:'RECOVERY-FILE-MUST-NOT-RETURN'}]}],history:[]};
  const s={now:NOW,seq:1,users:[{id:'u1',status:'closed'},{id:'u2',status:'closed'},{id:'u3',status:'active',name:'CUSTOMER-NAME-MUST-NOT-RETURN'}],stores:[{id:'s1'}],bookings:[b],goods:[],privacyProfiles:[{userId:'u1',status:'use_closed',history:[{action:'账号使用关闭，历史材料待清理',closureId:'PC1'}]},{userId:'u2',status:'use_closed',history:[{action:'账号使用关闭，历史材料待清理',closureId:'PC2'}]}],privacyClosures:[{id:'PC1',userId:'u1',status:'use_closed',createdAt:CLOSED-HOUR,closedAt:CLOSED},{id:'PC2',userId:'u2',status:'use_closed',createdAt:CLOSED-HOUR,closedAt:CLOSED}],servicePromoters:[p],serviceCommissions:[c],servicePromotionWithdrawals:[w],servicePromotionRecoveries:[d],servicePromotionRequests:[]};
  s.privacyClosures[0].rights=captureClosedRights({...s,now:CLOSED},'u1',CLOSED);return s;
}
const page=(s,section='withdrawals',id=section==='commissions'?'SPC1':section==='recoveries'?'SPD1':s.servicePromotionWithdrawals[0].id,a=user,options={})=>closedRightsDetailsUiView(s,a,['service-promotion',section,encodeURIComponent(id)],ui,options);
const hrefs=html=>[...html.matchAll(/href="#([^"]+)"/g)].map(x=>x[1]);
const decode=v=>v.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,c=>({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[c]));
// Tests read our new form's payload to submit through the original domains;
// production code never scrapes or filters a complete ordinary page's HTML.
function forms(html){return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,raw,body])=>{const attrs=Object.fromEntries([...raw.matchAll(/([\w-]+)=("[^"]*"|'[^']*')/g)].map(([,k,v])=>[k,decode(v.slice(1,-1))]));return{attrs,body,command:attrs['data-command'],payload:JSON.parse(attrs['data-payload'])};});}
function submit(s,form,p={}){const payload={...form.payload,requestId:'closed-details-'+s.seq,...p};assertClosedRightsCommand(s,user,form.command,payload);return servicePromotionCommand(s,user,form.command,payload,{id:prefix=>prefix+(++s.seq),log(){}});}

test('C09 财务详情每次核验真实旧来源，佣金和扣回只读最小金额状态及返回',()=>{
  const s=fixture(),before=structuredClone(s),c=page(s,'commissions'),d=page(s,'recoveries');assert.match(c,/原个人服务佣金/);assert.match(c,/SPR1/);assert.match(c,/¥40\.00/);assert.match(d,/原应扣回[\s\S]*¥8\.00/);assert.match(d,/原实际已收回[\s\S]*¥10\.00/);assert.match(d,/原超收待退[\s\S]*¥2\.00/);assert.equal(forms(c).length,0);assert.equal(forms(d).length,0);
  for(const html of [c,d]){assert.deepEqual(hrefs(html),['/user/rights','/user/privacy']);assert.doesNotMatch(html,/MUST-NOT-RETURN|<form\b|<input\b|data-command=|balanceToken|data-invoice-|申请提现|service-promotion\/promoters/);}assert.deepEqual(s,before);
});

test('C09 原收款表单固定旧SPW及当前版本，本人接受只进原未知查询、原样重放不新增申请',()=>{
  const s=fixture(),html=page(s),form=forms(html)[0];assert.equal(form.command,'service-promotion.withdraw-confirm');assert.deepEqual(form.payload,{id:'SPW1',version:2});assert.match(form.body,/name="decision" required/);assert.match(form.body,/value="accept"/);assert.match(form.body,/value="reject"/);assert.match(form.body,/name="reason" required/);assert.doesNotMatch(form.body,/amountCents|confirmExpiresAt|<input|type="file"/);assert.match(html,/data-live-version="2"/);
  const payload={decision:'accept',reason:'本人确认原笔收款',requestId:'closed-details-accept'};submit(s,form,payload);assert.equal(s.servicePromotionWithdrawals[0].status,'processing');assert.equal(s.servicePromotionWithdrawals[0].amountCents,2000);assert.equal(s.servicePromotionWithdrawals[0].execution.attempts,1);assert.equal(s.servicePromotionWithdrawals.length,1);assert.equal(s.users[0].status,'closed');
  const accepted=structuredClone(s);submit(s,form,payload);assert.deepEqual(s,accepted);assert.equal(forms(page(s)).length,0);assert.match(page(s),/原笔结果待查询/);assert.doesNotMatch(page(s),/实际转账成功/);assert.throws(()=>submit(s,form,{...payload,reason:'同请求改了本人决定'}),/同|重复|内容|请求/);
});

test('C09 本人拒绝沿原命令进入原撤销结果查询，不能由关闭详情假撤销或付钱',()=>{
  const s=fixture();submit(s,forms(page(s))[0],{decision:'reject',reason:'本人拒绝该原笔收款'});assert.equal(s.servicePromotionWithdrawals[0].status,'cancel_requested');assert.equal(s.servicePromotionWithdrawals[0].amountCents,2000);assert.equal(forms(page(s)).length,0);assert.match(page(s),/原撤销结果待查询/);assert.doesNotMatch(page(s),/实际转账成功|原申请或渠道已撤销/);
});

test('C09 原requested和failed仅撤销旧申请，计次与原来源保留，未知与终态不画动作',()=>{
  for(const status of ['requested','failed']){const s=fixture({status,executionStatus:status==='requested'?null:'failed'}),w=s.servicePromotionWithdrawals[0],createdAt=w.createdAt,countDate=w.countDate,form=forms(page(s))[0];assert.equal(form.command,'service-promotion.withdraw-cancel');submit(s,form,{reason:'本人撤销明确未成功的旧申请'});assert.equal(w.status,'cancelled');assert.equal(w.createdAt,createdAt);assert.equal(w.countDate,countDate);assert.equal(s.servicePromotionWithdrawals.length,1);assert.equal(forms(page(s)).length,0);}
  for(const [status,executionStatus] of [['processing','processing'],['cancel_requested','processing'],['paid','success'],['cancelled','cancelled'],['failed','processing']]){const s=fixture({status,executionStatus}),html=page(s);assert.equal(forms(html).length,0);assert.match(html,/¥20\.00/);assert.doesNotMatch(html,/withdraw-pay|withdraw-query|withdraw-create/);if(status==='paid'){assert.match(html,/实际转账成功/);assert.ok(html.includes(ui.date(NOW-1)));}}
});

test('C09 过期、未知版本和旧页面拒绝仍由原时限版本守卫决定，详情不延长截止',()=>{
  const s=fixture(),old=forms(page(s))[0];s.now=NOW+HOUR;assert.equal(forms(page(s)).length,0);assert.match(page(s),/期限缺失或已过/);assert.throws(()=>submit(s,old,{decision:'accept',reason:'不能过期确认'}),/确认阶段/);assert.equal(s.servicePromotionWithdrawals[0].confirmExpiresAt,NOW+HOUR);
  const fresh=fixture(),stale=forms(page(fresh))[0];fresh.servicePromotionWithdrawals[0].version++;assert.equal(forms(page(fresh))[0].payload.version,3);assert.throws(()=>submit(fresh,stale,{decision:'accept',reason:'不能提交旧页面版本'}),/版本/);fresh.servicePromotionWithdrawals[0].version=null;assert.equal(forms(page(fresh)).length,0);assert.match(page(fresh),/版本待人工核对/);
});

test('C09 当前金额未知留原实收，未核佣金和扣回金额不会被当零或新提现能力',()=>{
  const s=fixture();s.serviceCommissions[0].known=false;s.serviceCommissions[0].status='needs-review';s.servicePromotionRecoveries[0].status='needs-review';const c=page(s,'commissions'),d=page(s,'recoveries');assert.match(c,/金额待人工核对/);assert.match(d,/金额待人工核对/);assert.match(d,/原实际已收回[\s\S]*¥10\.00/);assert.doesNotMatch(c+d,/¥40\.00|¥8\.00|¥2\.00|¥0\.00|<form\b|data-command=/);
});

test('C09 原来源变化、缺关闭快照或另一本人不能从深链看到未核财务记录',()=>{
  for(const mutate of [s=>delete s.privacyClosures[0].rights.servicePromotion,s=>s.servicePromoters[0].ownerStoreId='missing',s=>s.servicePromotionWithdrawals[0].amountCents=2100,s=>s.serviceCommissions[0].paymentId='WRONG',s=>s.privacyClosures.push({...s.privacyClosures[0],id:'PC-CONFLICT'})]){const s=fixture();mutate(s);const before=structuredClone(s),html=page(s);assert.match(html,/待人工核验/);assert.doesNotMatch(html,/SPW1|SPC1|SPR1|¥|<form\b|data-command=/);assert.deepEqual(hrefs(html),['/user/rights','/user/privacy']);assert.deepEqual(s,before);}
  assert.match(page(fixture(),'withdrawals','SPW1',other),/待人工核验/);assert.doesNotMatch(page(fixture(),'withdrawals','SPW1',other),/SPW1|SPR1|¥/);
});

test('C09 任一关闭信号继续封闭，普通active才返回null，未支持交易路径无普通页面或草稿',()=>{
  const s=fixture();s.privacyProfiles[0].status='active';const html=page(s);assert.match(html,/待人工核验/);assert.doesNotMatch(html,/SPW1|¥|<form\b/);assert.equal(closedRightsDetailsUiView(s,{role:'group',job:'finance'},['service-promotion','withdrawals','SPW1'],ui),null);
  s.users[0].status='active';s.privacyClosures[0].status='requested';assert.equal(page(s),null);
  const closed=fixture();for(const route of [['booking','CUSTOMER-BOOKING-MUST-NOT-RETURN'],['goods','checkout'],['service-promotion','binding'],['service-promotion','withdrawals'],['service-promotion','withdrawals','SPW1','pay']]){const body=closedRightsDetailsUiView(closed,user,route,ui);assert.match(body,/请从既有权益查询原记录/);assert.deepEqual(hrefs(body),['/user/rights','/user/privacy']);assert.doesNotMatch(body,/MUST-NOT-RETURN|<form\b|预约草稿|支付预约/);}
});

test('C09 失效会话不显示私密源，原命令能力门控拒绝后仍只读本人金额',()=>{
  const s=fixture(),invalid=page(s,'withdrawals','SPW1',{...user,accountId:'revoked',sessionId:'dead'});assert.match(invalid,/会话已失效/);assert.doesNotMatch(invalid,/SPW1|SPR1|¥/);const denied=page(s,'withdrawals','SPW1',user,{canCommand:()=>false});assert.equal(forms(denied).length,0);assert.match(denied,/¥20\.00/);assert.throws(()=>assertClosedRightsCommand(s,user,'service-promotion.withdraw-confirm',{id:'SPW1',version:2,decision:'accept',reason:'原决定',bookingId:'CUSTOMER-BOOKING-MUST-NOT-RETURN'}),/其他来源|内部证明/);
});

test('C09 原编号转义且静态反馈无按钮语义，查询各状态不写原关闭与资金事实',()=>{
  const s=fixture({id:'SPW"><script>unsafe</script>'}),before=structuredClone(s),html=page(s);assert.match(html,/SPW&quot;&gt;&lt;script&gt;/);assert.doesNotMatch(html,/<script>|MUST-NOT-RETURN|data-invoice-/);assert.match(html,/class="btn secondary"/);assert.match(html,/type="submit" class="btn primary"/);
  for(const [,attrs] of html.matchAll(/<p\b([^>]*class="notice[^>]*)>/g)){assert.match(attrs,/role="status"/);assert.doesNotMatch(attrs,/data-command|role="button"|tabindex/);}assert.deepEqual(s,before);
});
