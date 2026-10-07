import test from 'node:test';
import assert from 'node:assert/strict';
import { closedRightsEntry, closedRightsUiView } from './privacy-closed-rights-ui.mjs';
import { captureClosedRights, closedRightsView, assertClosedRightsCommand } from './privacy-closed-rights.mjs';
import { careCommand } from './service-care.mjs';
import { servicePromotionCommand } from './service-promotion.mjs';

const HOUR=3600000,NOW=Date.parse('2026-10-04T12:00:00+08:00'),CLOSED=NOW-HOUR;
const user={role:'user',userId:'u1'},other={role:'user',userId:'u2'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui={esc,date:v=>new Date(v).toISOString(),link:(label,path,cls)=>`<a class="${esc(cls)}" href="#${esc(path)}">${label}</a>`,button(){throw new Error('入口不得创建业务动作');},getDraft(){throw new Error('入口不得创建预约草稿');},field(){throw new Error('入口不得创建业务表单');}};
function fixture(){
  // Isolated historical closed-account snapshot. Sources represent the old
  // ledger, not an end-to-end normal privacy.close or runtime identity proof.
  const booking={id:'B1',userId:'u1',storeId:'s1',createdAt:CLOSED-3*HOUR,completedAt:CLOSED-HOUR,version:2,status:'done',payment:{id:'PB1',status:'success',amountCents:19800,createdAt:CLOSED-3*HOUR},extensions:[],refunds:[{id:'RF1',status:'offered',version:1,requests:[{paymentId:'PB1',amountCents:1000}],lines:[{paymentId:'PB1',amountCents:1000}],executions:[]},{id:'RF2',status:'failed',version:1,requests:[{paymentId:'PB1',amountCents:1000}],executions:[{paymentId:'PB1',refundNo:'RN1',status:'failed',amountCents:1000}]}],phone:'PHONE-MUST-NOT-RETURN',contactName:'CONTACT-MUST-NOT-RETURN',health:'HEALTH-MUST-NOT-RETURN'};
  const goods={id:'G1',userId:'u1',createdAt:CLOSED-2*HOUR,status:'received',version:2,payment:{id:'PG1',status:'success',amountCents:21000},source:{storeId:'s2'},address:{detail:'ADDRESS-MUST-NOT-RETURN'},cases:[{id:'AS1',status:'partial_confirmation',version:1}],incidents:[{id:'IN1',status:'awaiting_user',version:1,caseId:null,proposal:{caseId:null}}]};
  return {now:NOW,seq:1,users:[{id:'u1',status:'closed',name:'NAME-MUST-NOT-RETURN'},{id:'u2',status:'closed'}],bookings:[booking,{...structuredClone(booking),id:'FOREIGN-B',userId:'u2',refunds:[]}],goods:[goods,{...structuredClone(goods),id:'FOREIGN-G',userId:'u2',cases:[],incidents:[]}],privacyProfiles:[{userId:'u1',status:'use_closed',history:[{action:'账号使用关闭，历史材料待清理',closureId:'PC1'}]},{userId:'u2',status:'use_closed',history:[]}],privacyClosures:[{id:'PC1',userId:'u1',status:'use_closed',createdAt:CLOSED-HOUR,closedAt:CLOSED,retention:[{kind:'bookings',count:1}]},{id:'PC2',userId:'u2',status:'use_closed',createdAt:CLOSED-HOUR,closedAt:CLOSED}],serviceInvoices:[{id:'SI1',userId:'u1',storeId:'s1',bookingId:'B1',createdAt:CLOSED-60000,status:'red',version:2,replacedById:'SI2',file:{ref:'FILE-MUST-NOT-RETURN'}},{id:'SI2',userId:'u1',storeId:'s1',bookingId:'B1',createdAt:NOW,status:'rejected',version:1,replacesId:'SI1'}],commerceInvoices:[{id:'GI1',category:'goods',orderId:'G1',userId:'u1',status:'rejected',version:1,createdAt:CLOSED-60000},{id:'FI1',category:'fee',orderId:'G1',storeId:'s1',userId:'u1',status:'issued',version:1,createdAt:CLOSED-60000}],serviceCareCases:[{id:'SC1',userId:'u1',storeId:'s1',bookingId:'B1',source:{kind:'booking',id:'B1'},status:'user_pending',version:1,userDueAt:NOW+HOUR,statements:[],resolutions:[],history:[],publicHistory:[],links:[],specialistActions:[],notes:[],ownerScope:'store',description:'CASE-BODY-MUST-NOT-RETURN'}],serviceRefundShortages:[{id:'SH1',bookingId:'B1',userId:'u1',storeId:'s1',paymentId:'PB1',refundId:'RF2',refundNo:'RN1',status:'awaiting_store',version:3,failureEvidence:{evidenceRefs:[{ref:'BANK-FILE-MUST-NOT-RETURN'}]},advances:[{id:'ADV1',path:'direct-user',status:'awaiting_user',version:1,reason:'INTERNAL-BODY-MUST-NOT-RETURN'}]}],serviceCareRequests:[],logs:[]};
}
const page=(s=fixture(),a=user,route=['rights'])=>closedRightsUiView(s,a,route,ui);
const hrefs=html=>[...html.matchAll(/href="#([^"]+)"/g)].map(x=>x[1]);

function promotionFixture(){
  // Isolated captured historical ledger: actual closedRightsView must verify
  // identity, original customer payment source and immutable withdrawal roots.
  // This is source/UI acceptance, not a normal privacy.close or channel proof.
  const s=fixture();s.stores=[{id:'s1'},{id:'s2'}];s.users.push({id:'u3',status:'active',name:'PROMOTION-CUSTOMER-NAME-MUST-NOT-RETURN'});
  const promoter={id:'SPR1',personKind:'user',personId:'u1',promoterType:'store-promoter',ownerType:'store',ownerStoreId:'s1',createdAt:CLOSED-4*HOUR,version:3,status:'disabled',identity:{status:'verified',evidenceRefs:[{ref:'PROMOTION-IDENTITY-FILE-MUST-NOT-RETURN'}]},agreementSnapshot:{body:'PROMOTION-AGREEMENT-MUST-NOT-RETURN'},transferAuthorization:{exempt:false},history:[]};
  s.servicePromoters=[promoter,{...structuredClone(promoter),id:'FOREIGN-SPR',personId:'u2'}];
  const source={capturedAt:CLOSED-3*HOUR,origin:'booking-create',promoter:Object.fromEntries(['id','personKind','personId','promoterType','ownerType','ownerStoreId'].map(k=>[k,promoter[k]])),binding:null,rule:null,mode:'demo',productionApproved:false};
  const customer={id:'PROMOTION-CUSTOMER-B',userId:'u3',storeId:'s1',status:'done',createdAt:CLOSED-3*HOUR,completedAt:CLOSED-HOUR,payment:{id:'PROMOTION-CUSTOMER-P',status:'success',amountCents:20000,createdAt:CLOSED-3*HOUR},extensions:[],refunds:[],servicePromotionSnapshot:source,phone:'PROMOTION-PHONE-MUST-NOT-RETURN',address:{detail:'PROMOTION-ADDRESS-MUST-NOT-RETURN'}};s.bookings.push(customer);
  const commission={id:'SPC1',promoterId:'SPR1',personKey:'user:u1',userId:customer.userId,storeId:'s1',bookingId:customer.id,paymentId:customer.payment.id,sourceSnapshot:structuredClone(source),sourceToken:'PROMOTION-TOKEN-MUST-NOT-RETURN',createdAt:CLOSED-90*60000,version:4,status:'withdrawing',known:true,commissionCents:4000,storeCents:2000,groupCents:2000,financialReady:true,availableAt:CLOSED-HOUR,adjustments:[]};
  s.serviceCommissions=[commission,{...structuredClone(commission),id:'FOREIGN-SPC',promoterId:'FOREIGN-SPR',personKey:'user:u2'}];
  s.servicePromotionWithdrawals=[{id:'SPW1',promoterId:'SPR1',personKind:'user',personId:'u1',personKey:'user:u1',ownerType:'store',ownerStoreId:'s1',amountCents:2000,allocations:[{commissionId:'SPC1',amountCents:2000,storeCents:1000,groupCents:1000,sourceToken:'ORIGINAL-ALLOCATION-MUST-NOT-RETURN',sourceVersion:2}],status:'awaiting_user',createdAt:CLOSED-20*60000,version:2,countDate:'2026-10-04',policySnapshot:{body:'PROMOTION-POLICY-MUST-NOT-RETURN'},authorizationSnapshot:{exempt:false},confirmExpiresAt:NOW+HOUR,execution:{id:'SPTX1',requestNo:'BANK-REQUEST-MUST-NOT-RETURN',status:'awaiting_user',attempts:1,results:[],proof:{reference:'BANK-REFERENCE-MUST-NOT-RETURN',evidenceRefs:[{ref:'BANK-PROOF-MUST-NOT-RETURN'}]}},history:[]}];
  s.servicePromotionRecoveries=[{id:'SPD1',promoterId:'SPR1',personKey:'user:u1',commissionId:'SPC1',bookingId:customer.id,paymentId:customer.payment.id,storeId:'s1',amountCents:800,receivedCents:1000,outstandingCents:0,returnPendingCents:200,storeCents:400,groupCents:400,createdAt:CLOSED+30*60000,dueAt:NOW+HOUR,version:1,status:'return-pending',records:[{id:'SPDR1',kind:'cash',amountCents:1000,reference:'RECOVERY-REFERENCE-MUST-NOT-RETURN',evidenceRefs:[{ref:'RECOVERY-PROOF-MUST-NOT-RETURN'}]}],history:[]}];
  // A second commission on this payment would invalidate the unique original
  // source, so the unrelated person's fixture uses a separate actual source.
  const foreign=structuredClone(customer);foreign.id='FOREIGN-PROMOTION-B';foreign.payment.id='FOREIGN-PROMOTION-P';foreign.servicePromotionSnapshot.promoter={...source.promoter,id:'FOREIGN-SPR',personId:'u2'};s.bookings.push(foreign);Object.assign(s.serviceCommissions[1],{bookingId:foreign.id,paymentId:foreign.payment.id,sourceSnapshot:structuredClone(foreign.servicePromotionSnapshot)});
  s.servicePromotionRequests=[];s.privacyClosures[0].rights=captureClosedRights({...s,now:CLOSED},'u1',CLOSED);return s;
}

test('C09 权益入口只列核验过的本人旧源和原路径，终态仍保留查询',()=>{
  const s=fixture(),view=closedRightsView(s,user),html=page(s);assert.match(html,/PC1/);assert.match(html,new RegExp(ui.date(CLOSED)));assert.match(html,/原预约及相关事项/);assert.match(html,/原商品及相关事项/);assert.match(html,/已完成/);assert.match(html,/已收货/);
  const valid=new Set(['/user/privacy',...view.items.map(x=>x.path)]);assert.ok(hrefs(html).every(path=>valid.has(path)));for(const path of ['/user/booking/B1','/user/goods/G1','/user/care/case/SC1','/user/invoices/SI2','/user/commodity-invoices/GI1'])assert.ok(hrefs(html).includes(path));assert.doesNotMatch(html,/FOREIGN-B|FOREIGN-G|FI1/);
});

test('C09 原票双向重开链可查询，派生晚于关闭不误作新交易入口',()=>{
  const s=fixture();assert.ok(hrefs(page(s)).includes('/user/invoices/SI2'));s.serviceInvoices[1].replacesId=null;const html=page(s);assert.ok(!hrefs(html).includes('/user/invoices/SI2'));assert.match(html,/待人工核对/);assert.match(html,/首次原票申请时间缺失或晚于关闭/);
});

test('C09 关闭范围候选不画成动作，入口从不调用草稿/表单/重新同意',()=>{
  const s=fixture();assert.ok(closedRightsView(s,user).items.some(x=>x.candidateCommands.length));const html=page(s)+closedRightsEntry(s,user,ui);
  assert.doesNotMatch(html,/<form\b|<input\b|<textarea\b|<button\b|data-command=|data-payload=|booking\.pay|privacy\.consent|candidateCommands|可直接办理|全部删除成功/);assert.match(html,/当前原业务状态、期限和金额核验/);assert.ok(hrefs(html).includes('/user/rights'));assert.ok(!hrefs(html).includes('/user/booking'));assert.ok(!hrefs(html).some(p=>/\/cart|\/addresses|\/recipients|\/checkout|\/payment/.test(p)));
});

test('C09 不展示联系人/健康/收货地址/税票银行附件和内部正文或金额',()=>{
  const html=page();assert.doesNotMatch(html,/MUST-NOT-RETURN|¥|19800|21000|1000|BANK-|tax|email/);assert.match(html,/本人直接退款事项/);assert.match(html,/本人直接退款方案/);
});

test('C09 无有效源时间仅显示人工核查，原业务入口不自动放行且不伪造客服事项',()=>{
  const s=fixture();s.bookings[0].createdAt=null;const before=structuredClone(s),html=page(s);assert.ok(!hrefs(html).includes('/user/booking/B1'));assert.ok(!hrefs(html).includes('/user/care/case/SC1'));assert.ok(hrefs(html).includes('/user/goods/G1'));assert.match(html,/创建时间缺失或晚于关闭/);assert.match(html,/待人工核对/);assert.doesNotMatch(html,/已通知客服|已创建客服事项|已发送消息|data-command=/);assert.deepEqual(s,before);
});

test('C09 缺少唯一关闭依据不显示原源编号，保留原回执核对出口',()=>{
  const s=fixture();s.privacyClosures.push({...s.privacyClosures[0],id:'CONFLICT'});const html=page(s);assert.match(html,/暂无已核验的原业务入口/);assert.match(html,/使用关闭回执缺失或冲突/);assert.ok(hrefs(html).includes('/user/privacy'));assert.doesNotMatch(html,/B1|G1|SC1|SI1|GI1/);
});

test('C09 非关闭用户/工作人员/失效工作会话不能看到旧权益或回执入口',()=>{
  const s=fixture(),actors=[{role:'group',job:'support'},{role:'store',storeId:'s1',job:'store-manager'},{role:'tech',techId:'lin'},{role:'user',userId:'missing'},{...user,accountId:'revoked',sessionId:'dead'}];
  for(const a of actors){assert.equal(closedRightsEntry(s,a,ui),'');const html=page(s,a);assert.match(html,/当前身份无法查看/);assert.doesNotMatch(html,/PC1|B1|G1|href=/);}
  s.privacyProfiles[0].status='active';s.users[0].status='active';assert.equal(closedRightsEntry(s,user,ui),'');assert.match(page(s),/当前身份无法查看/);assert.doesNotMatch(page(s,other),/PC1|B1|G1/);
});

test('C09 新关闭原ID快照与旧时间依据分别展示，读取不回填旧回执',()=>{
  const s=fixture();assert.match(page(s),/已按原创建时间核验/);s.privacyClosures[0].rights=captureClosedRights({...s,now:CLOSED},'u1',CLOSED);const before=structuredClone(s);assert.match(page(s),/已按关闭时原交易记录核验/);assert.deepEqual(s,before);
  const next=structuredClone(s.bookings[0]);next.id='NEW-BACKDATED';next.refunds=[];s.bookings.push(next);assert.ok(!hrefs(page(s)).includes('/user/booking/NEW-BACKDATED'));assert.match(page(s),/不在关闭时的唯一权益快照/);
});

test('C09 原反馈接受后未结退款继续跟进，纯读入口实时重核归属',()=>{
  const s=fixture();assert.match(page(s),/待本人回应/);const payload={id:'SC1',decision:'accept',version:1,reason:'接受原处理结果',requestId:'rights-ui-original-care'};assertClosedRightsCommand(s,user,'care.case-answer',payload);careCommand(s,user,'care.case-answer',payload,{id:p=>p+(++s.seq),log(){}});assert.equal(s.serviceCareCases[0].status,'execution_pending');assert.match(page(s),/关联事项待办结/);assert.doesNotMatch(page(s),/已结案/);assert.ok(hrefs(page(s)).includes('/user/care/case/SC1'));assert.equal(s.privacyProfiles[0].status,'use_closed');assert.equal(s.bookings[0].refunds[0].status,'offered');assert.equal(s.bookings[0].refunds[1].status,'failed');
  s.bookings[0].userId='u2';const html=page(s);assert.ok(!hrefs(html).includes('/user/booking/B1'));assert.ok(!hrefs(html).includes('/user/care/case/SC1'));
});

test('C09 原源编号与回执内容转义，状态与动作按原语义分开',()=>{
  const s=fixture();s.privacyClosures[0].id='PC"><img src=x onerror=alert(1)>';s.privacyProfiles[0].history[0].closureId=s.privacyClosures[0].id;const b={...structuredClone(s.bookings[0]),id:'B"><script>alert(1)</script>',refunds:[],status:'<script>unknown</script>'};s.bookings.push(b);const html=page(s);
  assert.match(html,/PC&quot;&gt;&lt;img/);assert.match(html,/B&quot;&gt;&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img|onerror="/);assert.match(html,/原状态待核对/);assert.match(html,/class="btn secondary" href=/);
  for(const [,attrs] of html.matchAll(/<p\b([^>]*class="notice[^>]*)>/g)){assert.match(attrs,/role="status"/);assert.doesNotMatch(attrs,/data-command|role="button"|tabindex/);}
});

test('C09 空源、未知深链与跨路由返回明确，页面和回执入口均纯读',()=>{
  const s=fixture(),before=structuredClone(s);page(s);closedRightsEntry(s,user,ui);assert.deepEqual(s,before);assert.equal(page(s,user,['privacy']),null);assert.match(page(s,user,['rights','B1']),/页面不存在/);assert.deepEqual(hrefs(page(s,user,['rights','B1'])),['/user/privacy']);
  for(const key of ['bookings','goods','serviceInvoices','commerceInvoices','serviceCareCases','serviceRefundShortages'])s[key]=[];const empty=page(s);assert.match(empty,/暂无已核验的原业务入口/);assert.match(empty,/没有可核验的本人旧交易来源/);assert.deepEqual(hrefs(empty),['/user/privacy']);
});

test('C09 个人服务佣金分组沿真实关闭来源投影，原消费者权益保留且不借佣金查看他人预约',()=>{
  const s=promotionFixture(),before=structuredClone(s),view=closedRightsView(s,user),html=page(s),financial=view.items.filter(x=>x.rootKind==='service-promotion');assert.deepEqual(financial.map(x=>x.kind),['service-commission','service-withdrawal','service-promotion-recovery']);
  assert.match(html,/<h2>个人服务佣金<\/h2>/);assert.match(html,/原个人服务推广身份 SPR1/);assert.match(html,/已按关闭时个人佣金来源核验/);assert.match(html,/原预约及相关事项/);assert.match(html,/原商品及相关事项/);assert.match(html,/原应计佣金[\s\S]*¥40\.00/);assert.match(html,/原提现申请金额[\s\S]*¥20\.00/);assert.match(html,/原实际已收回[\s\S]*¥10\.00/);assert.match(html,/原超收待退[\s\S]*¥2\.00/);assert.match(html,/原渠道本人确认截止/);assert.ok(html.includes(ui.date(NOW+HOUR)));
  for(const path of ['/user/service-promotion/commissions/SPC1','/user/service-promotion/withdrawals/SPW1','/user/service-promotion/recoveries/SPD1'])assert.ok(hrefs(html).includes(path));assert.ok(!hrefs(html).includes('/user/booking/PROMOTION-CUSTOMER-B'));assert.ok(!hrefs(html).includes('/user/service-promotion/promoters/SPR1'));
  assert.doesNotMatch(html,/MUST-NOT-RETURN|FOREIGN-SP|PROMOTION-CUSTOMER-B|PROMOTION-CUSTOMER-P|data-command=|data-invoice-domain|<form\b|<button\b|balanceToken/);assert.deepEqual(s,before);
});

test('C09 个人佣金及扣回金额未知不画成零，原实际收回保留、缺快照继续人工核对',()=>{
  const s=promotionFixture();s.serviceCommissions[0].known=false;s.serviceCommissions[0].status='needs-review';s.servicePromotionRecoveries[0].status='needs-review';const view=closedRightsView(s,user);assert.equal(view.items.find(x=>x.kind==='service-commission').financial.commissionCents,null);assert.equal(view.items.find(x=>x.kind==='service-promotion-recovery').financial.amountCents,null);
  const before=structuredClone(s),html=page(s);assert.match(html,/原佣金来源待核对/);assert.match(html,/原扣回依据待核对/);assert.match(html,/金额待人工核对/);assert.match(html,/原实际已收回[\s\S]*¥10\.00/);assert.doesNotMatch(html,/¥40\.00|¥8\.00|¥2\.00|¥0\.00/);assert.deepEqual(s,before);
  delete s.privacyClosures[0].rights.servicePromotion;const manual=page(s);assert.doesNotMatch(manual,/<h2>个人服务佣金<\/h2>|\/user\/service-promotion\//);assert.match(manual,/个人服务佣金/);assert.match(manual,/原个人提现/);assert.match(manual,/原个人佣金扣回/);assert.match(manual,/个人服务佣金快照缺失/);assert.match(manual,/待人工核对/);assert.ok(hrefs(manual).includes('/user/booking/B1'));assert.ok(hrefs(manual).includes('/user/goods/G1'));
});

test('C09 原提现候选仅为源范围，原本人接受后列表读当前结果且不制造新提现或实际到账',()=>{
  const s=promotionFixture(),item=closedRightsView(s,user).items.find(x=>x.kind==='service-withdrawal');assert.deepEqual(item.candidateCommands,['service-promotion.withdraw-confirm','service-promotion.withdraw-cancel']);assert.match(page(s),/查看原提现记录/);assert.doesNotMatch(page(s),/<form\b|<input\b|data-command=|申请提现|免确认收款授权|进入此服务推广入口/);
  const payload={id:'SPW1',version:2,decision:'accept',reason:'本人确认既有原笔收款',requestId:'closed-rights-ui-original-confirm'};assertClosedRightsCommand(s,user,'service-promotion.withdraw-confirm',payload);servicePromotionCommand(s,user,'service-promotion.withdraw-confirm',payload,{id:p=>p+(++s.seq),log(){}});
  const before=structuredClone(s),html=page(s);assert.equal(s.servicePromotionWithdrawals[0].status,'processing');assert.equal(s.servicePromotionWithdrawals[0].amountCents,2000);assert.equal(s.servicePromotionWithdrawals.length,1);assert.match(html,/原笔结果待查询/);assert.match(html,/原渠道最后记录/);assert.doesNotMatch(html,/实际转账成功|原实际成功发生时间/);assert.ok(hrefs(html).includes(item.path));assert.equal(s.privacyProfiles[0].status,'use_closed');assert.equal(s.users[0].status,'closed');assert.deepEqual(s,before);
});

test('C09 财务源被替换即转人工且反馈静态，失效主体不借旧权益读取金额或来源',()=>{
  const s=promotionFixture();s.servicePromotionWithdrawals[0].amountCents=2100;const html=page(s);assert.match(html,/待人工核对/);assert.ok(!hrefs(html).includes('/user/service-promotion/withdrawals/SPW1'));assert.doesNotMatch(html,/¥21\.00/);assert.ok(hrefs(html).includes('/user/service-promotion/commissions/SPC1'));
  for(const [,attrs] of html.matchAll(/<p\b([^>]*class="notice[^>]*)>/g)){assert.match(attrs,/role="status"/);assert.doesNotMatch(attrs,/data-command|role="button"|tabindex/);}assert.ok(hrefs(html).includes('/user/privacy'));
  for(const actor of [{role:'user',userId:'missing'},{...user,accountId:'gone',sessionId:'dead'},{role:'group',job:'finance'}]){const denied=page(s,actor);assert.match(denied,/当前身份无法查看/);assert.doesNotMatch(denied,/SPC1|SPW1|SPD1|SPR1|¥/);}
  assert.doesNotMatch(page(s,other),/SPC1|SPW1|SPD1|SPR1|¥40\.00|¥20\.00|¥10\.00/);
});
