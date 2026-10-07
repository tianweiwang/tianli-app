import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { privacyUseClosed, assertPrivacyCommand } from './privacy.mjs';
import { closedRightsBinding, closedRightsView } from './privacy-closed-rights.mjs';
import { servicePromotionBalanceToken } from './service-promotion.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';
import { customerView } from './customer.mjs';

const person={role:'user',userId:'u2'},customer={role:'user',userId:'u1'};
const finance={role:'group',job:'finance'},support={role:'group',job:'support'},manager={role:'store',job:'store-manager',storeId:'xingfu'};
const DAY=86400000;
const closedUi={money:n=>`¥${(n/100).toFixed(2)}`,date:t=>new Date(t).toISOString(),link:(label,path)=>`<a href="#${path}">${label}</a>`,getDraft(){throw new Error('关闭本人入口不得创建新预约草稿');},field(){throw new Error('关闭本人不得调用普通新业务表单');},button(){throw new Error('关闭本人不得调用普通新业务按钮');}};
const bytes=new TextEncoder().encode('%PDF-1.4\nC09 SYNTHETIC DEMO - NOT AN IDENTITY OR PAYMENT DOCUMENT\n%%EOF');
const blob=new Blob([bytes],{type:'application/pdf'});
const file={ref:'invoice-file:'+createHash('sha256').update(bytes).digest('hex'),name:'C09-合成验收.pdf',type:blob.type,size:blob.size};
function harness(){
  let s=seed(),n=0;
  const h={get s(){return s;},promoter(){return s.servicePromoters.find(r=>r.personKind==='user'&&r.personId==='u2');},withdrawal(){return s.servicePromotionWithdrawals.at(-1);},
    proof(){return{reference:'C09-TECH-'+(++n),occurredAt:s.now,file,reason:'合成文件实际读取，只用于本地原命令验收'};},
    async run(type,p={},actor=finance){
      const row=[...(s.servicePromoters||[]),...(s.servicePromotionInvites||[]),...(s.servicePromotionWithdrawals||[]),...(s.serviceFinanceEntries||[]),...(s.privacyClosures||[])].find(x=>x.id===(p.id||p.promoterId));
      const payload={requestId:'C09-SHARED-'+(++n),version:row?.version||0,...p};
      const evidence=await prepareServicePromotionEvidence(s,actor,type,payload,{readFile:async descriptor=>{assert.equal(descriptor.ref,file.ref);return blob;}});
      let result;s=reduce(s,actor,type,payload,r=>result=r,evidence);return result;
    },
    async setup(){
      await h.run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:1000,effectiveAt:s.now,version:0,reason:'明确合成验收H，不发布正式费率'});
      await h.run('service-promotion.agreement-publish',{promoterType:'store-promoter',title:'C09本地技术协议',body:'仅验收原本人权益保留，不构成真实合同。',effectiveAt:s.now,...h.proof()},support);
      await h.run('service-promotion.invite',{userId:'u2',promoterType:'store-promoter',expiresAt:s.now+DAY,reason:'本地原门店邀请'},manager);
      const invite=s.servicePromotionInvites.at(-1);
      await h.run('service-promotion.invite-confirm',{id:invite.id,decision:'accept',agreementAccepted:true,agreementId:invite.agreementSnapshot.id,reason:'本人接受技术样例'},person);
      await h.run('service-promotion.identity-review',{id:h.promoter().id,decision:'verified',...h.proof()},support);
      await h.run('service-promotion.rule-publish',{promoterType:'store-promoter',firstBps:1000,repeatBps:500,storeCostBps:5000,csRounding:'floor',concurrency:'completed-created-id',lateFullRefund:'keep-first-slot',effectiveAt:s.now,version:0,basis:'明确本次技术样例，正式业务规则待定'});
      await h.run('service-promotion.enter',{promoterId:h.promoter().id,version:s.users[0].serviceBinding.version},customer);
      const startAt=Math.ceil((s.now+4*3600000)/1800000)*1800000;
      await h.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt,mode:'specified',genderPreference:'any',contactName:'合成顾客',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true},customer);
      const id=s.bookings.at(-1).id;await h.run('booking.pay',{id,outcome:'success'},customer);await h.run('booking.accept',{id},{role:'tech',techId:'lin'});
      await h.run('clock.advance',{minutes:(startAt-s.now)/60000});await h.run('booking.start',{id},{role:'tech',techId:'lin'});
      await h.run('clock.advance',{minutes:60});await h.run('booking.finish',{id,mode:'normal'},{role:'tech',techId:'lin'});await h.run('clock.advance',{minutes:2881});
      let entry=s.serviceFinanceEntries.find(x=>x.bookingId===id);
      await h.run('finance.split-start',{id:entry.id,version:entry.version,outcome:'success',...h.proof()});entry=s.serviceFinanceEntries.find(x=>x.id===entry.id);
      await h.run('finance.finish-start',{id:entry.id,version:entry.version,outcome:'success',...h.proof()});
      const commission=s.serviceCommissions.find(x=>x.bookingId===id),promoter=h.promoter();
      await h.run('service-promotion.withdraw-create',{promoterId:promoter.id,version:promoter.version,amountCents:commission.commissionCents,balanceToken:servicePromotionBalanceToken(s,promoter.id)},person);
      const w=h.withdrawal();await h.run('service-promotion.withdraw-pay',{id:w.id,outcome:'awaiting_user',confirmExpiresAt:s.now+DAY,reference:'C09-PENDING-ORIGINAL',occurredAt:s.now,reason:'原渠道技术样例待本人确认'});
      return id;
    },
    async close(){
      const requested=await h.run('privacy.request',{version:(s.privacyProfiles||[]).find(p=>p.userId==='u2')?.version||0,reason:'合成本人申请关闭普通使用',acknowledged:true},person);
      const payload={requestId:'C09-ONE-CLOSE',id:requested.id,version:requested.version,reason:'仅本地合成关闭验收，旧资金权益保留',custodian:'演示客服',acknowledged:true};
      await h.run('privacy.close',payload,support);return payload;
    }
  };return h;
}

test('正常原reduce关闭捕获个人旧佣金/提现，停用未来推广且不没收原资金',async()=>{
  const h=harness(),bookingId=await h.setup(),w=structuredClone(h.withdrawal()),originalBooking=structuredClone(h.s.bookings.find(b=>b.id===bookingId));
  const oldCommission=structuredClone(h.s.serviceCommissions),promoterId=h.promoter().id;
  const closePayload=await h.close(),c=h.s.privacyClosures.find(x=>x.id===closePayload.id);
  assert.equal(c.rights.capturedAt,c.closedAt);assert.equal(c.rights.servicePromotion.userId,'u2');assert.equal(c.rights.servicePromotion.withdrawals[0].id,w.id);
  assert.ok(c.retention.some(x=>x.kind==='service-personal-promotion'&&x.count>=3&&x.basis===null&&x.deadline===null));
  assert.ok(c.retention.some(x=>x.kind==='service-promotion-requests'&&x.count>0));
  assert.doesNotMatch(JSON.stringify(c.retention),/13800000001|invoice-file:|C09-PENDING-ORIGINAL/);
  assert.equal(h.promoter().status,'disabled');assert.equal(h.promoter().forfeitBookingIds,undefined);
  assert.equal(h.s.users[0].serviceBinding.promoterId,null);assert.equal(h.s.users[0].serviceBinding.ownerStoreId,'xingfu');
  assert.deepEqual(h.s.servicePromotionWithdrawals,[w]);assert.deepEqual(h.s.serviceCommissions,oldCommission);assert.deepEqual(h.s.bookings.find(b=>b.id===bookingId),originalBooking);
  assert.equal(closedRightsBinding(h.s,person,'service-withdrawal',w.id).rootId,promoterId);
  const entry=customerView(h.s,person,['rights'],closedUi),detail=customerView(h.s,person,['service-promotion','withdrawals',w.id],closedUi);
  assert.match(entry,new RegExp(w.id));assert.match(entry,/个人服务佣金/);
  assert.match(detail,new RegExp(w.id));assert.match(detail,/service-promotion\.withdraw-confirm/);assert.match(detail,/返回既有权益/);
  assert.doesNotMatch(entry+detail,/申请提现|service-promotion\.withdraw-create|C09-PENDING-ORIGINAL|invoice-file:|138000/);
  const before=structuredClone(h.s);await h.run('privacy.close',closePayload,support);assert.deepEqual(h.s,{...before,revision:before.revision+1});
});

test('原闭户本人接受仍经原提现阶段/版本/请求，财务查同笔成功且不能新建业务',async()=>{
  const h=harness();await h.setup();await h.close();const w=structuredClone(h.withdrawal()),profile=h.s.privacyProfiles.find(p=>p.userId==='u2');
  const payload={id:w.id,version:w.version,requestId:'C09-ORIGINAL-DECISION',decision:'accept',reason:'关闭后处理本人原收款确认'};
  await assert.rejects(h.run('service-promotion.withdraw-confirm',{...payload,version:w.version-1},person),/版本/);
  await assert.rejects(h.run('service-promotion.withdraw-confirm',payload,customer),/无权|本人/);
  await h.run('service-promotion.withdraw-confirm',payload,person);const accepted=structuredClone(h.s);await h.run('service-promotion.withdraw-confirm',payload,person);assert.deepEqual(h.s,{...accepted,revision:accepted.revision+1});
  assert.equal(h.withdrawal().status,'processing');assert.equal(h.withdrawal().execution.id,w.execution.id);assert.equal(h.withdrawal().execution.requestNo,w.execution.requestNo);assert.equal(h.withdrawal().execution.attempts,1);
  await h.run('service-promotion.withdraw-query',{id:w.id,outcome:'success',...h.proof()});
  assert.equal(h.withdrawal().status,'paid');assert.equal(h.withdrawal().amountCents,w.amountCents);assert.equal(h.s.privacyProfiles.find(p=>p.userId==='u2').version,profile.version);
  assert.ok(closedRightsView(h.s,person).items.some(x=>x.kind==='service-withdrawal'&&x.id===w.id&&x.status==='paid'));
  const paidDetail=customerView(h.s,person,['service-promotion','withdrawals',w.id],closedUi);
  assert.match(paidDetail,/实际转账成功/);assert.doesNotMatch(paidDetail,/<form\b|data-command=/);
  for(const[type,p]of [['booking.create',{}],['goods.submit',{}],['privacy.consent',{version:profile.version,agreed:true}],['service-promotion.withdraw-create',{promoterId:w.promoterId}],['service-promotion.enter',{promoterId:w.promoterId}],['service-promotion.transfer-authorize',{id:w.promoterId,enabled:true}]])await assert.rejects(h.run(type,p,person),/使用已关闭/);
});

test('关闭本人拒绝或明确未成功撤销仍保留原申请和计次，不伪造渠道撤销',async()=>{
  const h=harness();await h.setup();await h.close();let w=h.withdrawal();const initialCount=w.countDate;
  await h.run('service-promotion.withdraw-confirm',{id:w.id,decision:'reject',reason:'本人拒绝原渠道收款'},person);
  assert.equal(h.withdrawal().status,'cancel_requested');assert.equal(h.withdrawal().countDate,initialCount);
  await assert.rejects(h.run('service-promotion.withdraw-cancel',{id:w.id,reason:'未知时直接取消'},person),/未知|查询|未成功/);
  await h.run('service-promotion.withdraw-query',{id:w.id,outcome:'failed',reference:'C09-ORIGINAL-FAIL',occurredAt:h.s.now,reason:'查询原笔明确失败'});
  w=h.withdrawal();await h.run('service-promotion.withdraw-cancel',{id:w.id,reason:'本人撤销原失败申请'},person);
  assert.equal(h.withdrawal().status,'cancelled');assert.equal(h.withdrawal().countDate,initialCount);assert.equal(h.withdrawal().execution.attempts,1);
});

test('过期、原申请金额被改及旧回执无财务快照均不能借关闭权益续办',async()=>{
  const h=harness();await h.setup();await h.close();const w=h.withdrawal(),before=structuredClone(h.s);
  const expired=structuredClone(before);expired.now=w.confirmExpiresAt;
  assert.throws(()=>reduce(expired,person,'service-promotion.withdraw-confirm',{id:w.id,version:w.version,requestId:'expired',decision:'accept',reason:'过期'}),/有效|期限/);
  const changed=structuredClone(before);changed.servicePromotionWithdrawals[0].amountCents++;assert.throws(()=>reduce(changed,person,'service-promotion.withdraw-confirm',{id:w.id,version:w.version,requestId:'changed',decision:'accept',reason:'串额'}),/金额|快照|守恒/);
  const legacy=structuredClone(before);delete legacy.privacyClosures[0].rights;assert.throws(()=>reduce(legacy,person,'service-promotion.withdraw-confirm',{id:w.id,version:w.version,requestId:'legacy',decision:'accept',reason:'旧回执'}),/快照|人工/);
  assert.deepEqual(h.s,before);
});

test('任一关闭信号都封闭普通命令，冲突或缺依据不得降回active',()=>{
  const samples=[s=>s.users[0].status='closed',s=>s.privacyProfiles=[{userId:'u1',status:'active'},{userId:'u1',status:'use_closed'}],s=>s.privacyClosures=[{id:'old',userId:'u1',status:'use_closed'}]];
  for(const mutate of samples){const s=seed();mutate(s);assert.equal(privacyUseClosed(s,'u1'),true);const before=structuredClone(s);
    for(const type of ['booking.create','goods.submit','privacy.consent','booking.refund-request'])assert.throws(()=>assertPrivacyCommand(s,customer,type,{id:'missing'}),/关闭|依据|核查/);
    assert.doesNotThrow(()=>assertPrivacyCommand(s,customer,'account.enter',{}));assert.equal(privacyUseClosed(s,'u2'),false);assert.deepEqual(s,before);
  }
});

test('普通客服关闭失败保持原申请/来源与客户绑定，没有半次快照或停用',async()=>{
  const h=harness();await h.setup();const requested=await h.run('privacy.request',{version:0,reason:'本地失败原事务验收',acknowledged:true},person),before=structuredClone(h.s);
  await assert.rejects(h.run('privacy.close',{id:requested.id,version:requested.version,reason:'本地',custodian:'',acknowledged:true},support),/负责人/);
  assert.deepEqual(h.s,before);assert.equal(h.promoter().status,'active');assert.equal(h.s.privacyClosures[0].rights,undefined);
});
