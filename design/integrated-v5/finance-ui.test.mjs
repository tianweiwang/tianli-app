import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { financeView, financeBookingPanel } from './finance-ui.mjs';
import { upgradeServiceFinance, captureBookingFinance, captureExtensionFinance, syncServiceFinance, serviceFinanceCommand, serviceFinanceView, serviceFinanceSummary } from './service-finance.mjs';
import { upgradeTechIncome, captureTechIncome, syncTechIncome, techIncomeCommand } from './tech-income.mjs';
import { upgradeServicePromotion, servicePromotionCommand, captureServicePromotion, captureExtensionPromotion, syncServicePromotion, servicePromotionBalanceToken } from './service-promotion.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';

const NOW=Date.parse('2026-10-03T10:00:00+08:00'),DAY=86400000;
const finance={role:'group',job:'finance'},store={role:'store',storeId:'s1'},manager={role:'manager',storeId:'s1'},tech={role:'tech',techId:'t1'};
const owner={role:'user',userId:'u2'},customer={role:'user',userId:'u1'},support={role:'group',job:'support'};
// Real synthetic PDF bytes for scoped file prevalidation, not a bank receipt or
// an application upload/preview check. Booking fixtures remain isolated units.
const proofBytes=new TextEncoder().encode('%PDF-1.4\nFinance UI isolated synthetic source\n%%EOF');
const proofFile={ref:'invoice-file:'+createHash('sha256').update(proofBytes).digest('hex'),name:'财务UI合成依据.pdf',type:'application/pdf',size:proofBytes.length};
const proofBlob=new Blob([proofBytes],{type:proofFile.type});
const decode=v=>v.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function forms(html,command) {return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,attrs,body])=>({attrs,body,command:/data-command="([^"]+)"/.exec(attrs)?.[1],payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1] || '{}'))})).filter(f=>f.command===command);}
function fixture() {
  let s={schema:5,seq:0,now:NOW,users:[{id:'u1',serviceBinding:{status:'unbound',recordedAt:NOW}}],stores:[{id:'s1',name:'幸福里门店'},{id:'s2',name:'银杏门店'}],services:[{id:'relax',name:'舒缓放松'},{id:'neck',name:'肩颈舒缓'}],techs:[{id:'t1',name:'林师傅',storeId:'s1'},{id:'t2',name:'周师傅',storeId:'s1'},{id:'t3',name:'马师傅',storeId:'s2'}],bookings:[],safety:[],logs:[],bookingRules:{maxDays:7}};
  upgradeServiceFinance(s); upgradeTechIncome(s); upgradeServicePromotion(s); let requests=0;
  const ctx=(state,evidence=[])=>({id:prefix=>prefix+(++state.seq),fail:message=>{throw Error(message);},log:()=>{},serviceFinanceSummary,validateEvidenceRefs:rows=>rows.length>0&&rows.every(row=>evidence.some(file=>['ref','name','type','size'].every(key=>row[key]===file[key])))});
  const sync=()=>{syncServicePromotion(s,ctx(s));syncServiceFinance(s,ctx(s));syncTechIncome(s,ctx(s));syncServicePromotion(s,ctx(s));};
  const run=(type,payload={},actor=finance,evidence=[])=>{const next=structuredClone(s);const command=type.startsWith('finance.')?serviceFinanceCommand:type.startsWith('service-promotion.')?servicePromotionCommand:techIncomeCommand;const result=command(next,actor,type,{requestId:'ui-'+(++requests),...payload},ctx(next,evidence));s=next;sync();return result;};
  const promo=(op,payload={},actor=finance)=>{const row=[...s.servicePromoters,...s.servicePromotionInvites,...s.servicePromotionWithdrawals,...s.servicePromotionRecoveries].find(x=>x.id===(payload.id||payload.promoterId)),version=op==='enter'?s.users.find(u=>u.id===actor.userId)?.serviceBinding?.version || 0:row?.version || 0;return run('service-promotion.'+op,{version,...payload},actor);};
  const proofRun=async(type,payload={},actor=finance)=>{const row=[...s.servicePromoters,...s.servicePromotionInvites,...s.servicePromotionWithdrawals,...s.servicePromotionRecoveries,...s.serviceFinanceRecoveries].find(x=>x.id===(payload.id||payload.promoterId)),p={version:row?.version||0,requestId:'ui-proof-'+(++requests),reference:'ACTUAL-UI-'+requests,occurredAt:s.now,file:proofFile,reason:'本地实际字节预校验，不代替真实渠道凭证',...payload};const verified=await prepareServicePromotionEvidence(s,actor,type,p,{readFile:async file=>{assert.equal(file.ref,proofFile.ref);return proofBlob;}});return run(type,p,actor,verified.evidenceRefs);};
  const view=(actor=finance,parts=['service-finance'],q='')=>financeView(s,actor,parts,{query:new URLSearchParams(q)});
  return {get s(){return s;},get b(){return s.bookings.at(-1);},get entry(){return serviceFinanceView(s,finance).entries.at(-1);},get income(){return s.techIncomeEntries.at(-1);},run,view,sync,promo,proofRun,
    rules(){run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:s.now,version:0,reason:'明确Demo规则'});run('tech-income.rule-publish',{storeId:'s1',serviceId:'all',rateBps:4000,refundPolicy:'proportional',rounding:'floor',effectiveAt:s.now,version:0,reason:'明确Demo提成规则'});},
    book(extra={}) {const id='B'+(s.bookings.length+1),b={id,userId:'u1',storeId:'s1',serviceId:'relax',techId:'t1',createdAt:s.now,status:'confirmed',startedAt:s.now,completedAt:null,payment:{id:'P-'+id,status:'success',paidAt:s.now,amountCents:29800,refundedCents:0},extensions:[],refunds:[],disputes:[],...extra};s.bookings.push(b);if(s.servicePromoters.length)captureServicePromotion(s,b,ctx(s));captureBookingFinance(s,b,ctx(s));captureTechIncome(s,b,ctx(s));sync();return b;},
    extension(){const p={id:'X-'+this.b.id,status:'success',createdAt:s.now,paidAt:s.now,amountCents:14900,refundedCents:0,duration:30};this.b.extensions.push(p);if(s.servicePromoters.length)captureExtensionPromotion(s,this.b,p,ctx(s));captureExtensionFinance(s,this.b,p,ctx(s));sync();return p;},
    async promotion(){this.rules();s.users[0].serviceBinding={status:'unbound',origin:'demo-initial',recordedAt:s.now,version:0};s.users.push({id:'u2',serviceBinding:{status:'unbound',origin:'demo-initial',recordedAt:s.now,version:0}});await proofRun('service-promotion.agreement-publish',{promoterType:'store-promoter',title:'本地验证实际协议',body:'本地验证本人接受、核验和原款来源；不是正式经营协议。',effectiveAt:s.now},support);promo('invite',{userId:'u2',promoterType:'store-promoter',expiresAt:s.now+DAY,reason:'本人原门店邀请'},{role:'store',job:'store-manager',storeId:'s1'});const invite=s.servicePromotionInvites.at(-1);promo('invite-confirm',{id:invite.id,decision:'accept',agreementAccepted:true,agreementId:invite.agreementSnapshot.id,reason:'本人核实原协议'},owner);const promoter=s.servicePromoters.at(-1);await proofRun('service-promotion.identity-review',{id:promoter.id,decision:'verified'},support);promo('transfer-authorize',{id:promoter.id,enabled:true,reason:'本人明确本地验证授权'},owner);promo('rule-publish',{promoterType:'store-promoter',firstBps:2000,repeatBps:1000,storeCostBps:5000,csRounding:'floor',concurrency:'completed-created-id',lateFullRefund:'reassign',effectiveAt:s.now,basis:'明确本地验证规则，正式经营另验'});promo('enter',{promoterId:promoter.id},customer);return s.servicePromoters.find(x=>x.id===promoter.id);},
    finish(){this.b.status='done';this.b.completedAt=s.now;sync();},
    advance(days){s.now+=days*DAY;sync();},
    settle(){this.advance(2);for(const x of [...serviceFinanceView(s,finance).entries]){let current=serviceFinanceView(s,finance).entries.find(v=>v.id===x.id);if(current.canSplit)run('finance.split-start',{id:current.id,version:current.version,outcome:'success'});current=serviceFinanceView(s,finance).entries.find(v=>v.id===x.id);if(current.canFinish)run('finance.finish-start',{id:current.id,version:current.version,outcome:'success'});}sync();},
    payout(){const payload=forms(view(store,['service-finance','payouts']),'tech-income.payout')[0].payload;return run('tech-income.payout',{...payload,proof:'BANK-UI-001',paidAt:s.now,reason:'实际线下转账登记'},store);}
  };
}

test('财务视图只匹配service-finance，用户与集团其他岗位无入口或财务深链',()=>{
  const f=fixture(); assert.equal(financeView(f.s,finance,['invoices']),null);
  for(const actor of [{role:'user',userId:'u1'},{role:'group',job:'support'},{role:'group',job:'warehouse'},{role:'group',job:'operations'}]) {assert.match(f.view(actor),/无权/);assert.equal(financeBookingPanel(f.s,actor,{id:'B1'}),'');}
  for(const actor of [tech,manager]) assert.match(f.view(actor,['service-finance','rules']),/无权/);
});

test('初始规则比例为空，字段按分和万分比提交，发布表单不生成随机请求标识',()=>{
  const f=fixture(),html=f.view(finance,['service-finance','rules']),split=forms(html,'finance.rule-publish')[0],income=forms(html,'tech-income.rule-publish')[0];
  assert.match(html,/初始财务规则为空/);assert.match(split.body,/name="groupBps" value=""[^>]*data-unit="percent"/);assert.match(split.body,/name="storeBps" value=""/);assert.match(income.body,/name="rateBps" value=""/);
  assert.match(split.body,/>发布分成规则<\/button>/);assert.match(income.body,/>发布提成规则<\/button>/);assert.doesNotMatch(html,/发布 Demo (分成|提成)规则/);
  assert.equal(split.payload.version,0);assert.equal(income.payload.version,0);assert.equal(split.payload.requestId,undefined);assert.match(split.attrs,/data-live-version="0"/);assert.match(split.attrs,/data-management-form=/);assert.match(split.body,/management-grid/);assert.equal(f.view(finance,['service-finance','rules']),html);
});

test('规则范围与版本跟随已选scope，发布不会使用别范围的旧版本',()=>{
  const f=fixture();f.rules();f.run('finance.rule-publish',{scope:'store-service',storeId:'s1',serviceId:'relax',groupBps:800,storeBps:300,effectiveAt:f.s.now,version:0,reason:'本店项目规则'});
  const html=f.view(finance,['service-finance','rules'],'scope=store-service&storeId=s1&serviceId=relax&techStoreId=s1&techServiceId=all');
  assert.deepEqual(forms(html,'finance.rule-publish')[0].payload,{scope:'store-service',storeId:'s1',serviceId:'relax',version:1});
  assert.deepEqual(forms(html,'tech-income.rule-publish')[0].payload,{storeId:'s1',serviceId:'all',version:1});
});

test('同页试算调用模型且不发布，错误与空规则不假装计算成功',()=>{
  const f=fixture(),before=JSON.stringify(f.s);
  const html=f.view(finance,['service-finance','rules'],'trialAmount=298&trialGroupRate=10&trialStoreRate=5&trialType=group&trialTechAmount=298&trialRefund=98&trialRate=40&trialPolicy=proportional&trialRounding=floor');
  assert.match(html,/试算集团金额[\s\S]*?¥29.80/);assert.match(html,/试算门店金额[\s\S]*?¥268.20/);assert.match(html,/试算提成[\s\S]*?¥80.00/);assert.equal(JSON.stringify(f.s),before);
  assert.match(f.view(finance,['service-finance','rules'],'trialTechAmount=298&trialRefund=299&trialRate=40&trialPolicy=proportional&trialRounding=floor'),/请明确金额/);
});

test('历史快照缺失保留待核对而非自然客户零佣金或可发放',()=>{
  const f=fixture();f.book();delete f.b.serviceFinanceSnapshot;delete f.b.techIncomeSnapshot;f.s.serviceFinanceEntries=[];f.s.techIncomeEntries=[];f.finish();f.advance(2);
  const ledger=f.view();assert.match(ledger,/规则待核对|归属.*待核对/);assert.match(ledger,/仅含依据完整记录/);
  const detail=f.view(finance,['service-finance','entry',f.entry.id]);assert.match(detail,/缺少历史客户归属/);assert.match(detail,/不能使用现行规则补算旧单/);assert.equal(forms(detail,'finance.split-start').length,0);
  const income=f.view(tech,['service-finance','income']);assert.match(income,/缺少有效接单提成规则快照/);assert.doesNotMatch(income,/当前应计<\/span><span>¥0.00/);assert.equal(forms(f.view(store,['service-finance','payouts']),'tech-income.payout').length,0);
});

test('逐笔主单加时金额、期限及原预约链接可追溯，分账成功和完结分别处理',()=>{
  const f=fixture();f.rules();f.book();f.extension();f.finish();f.advance(2);
  assert.equal(serviceFinanceView(f.s,finance).entries.length,2);assert.match(f.view(),/P-B1/);assert.match(f.view(),/X-B1/);
  const x=f.entry,html=f.view(finance,['service-finance','entry',x.id]);assert.match(html,/强制分账日/);assert.match(html,/已确认待退占额/);assert.match(html,/#\/group\/bookings\/B1/);assert.match(html,/本次模拟渠道结果/);
  const split=forms(html,'finance.split-start')[0];f.run(split.command,{...split.payload,outcome:'success',reason:'本地模拟成功'});
  const next=f.view(finance,['service-finance','entry',x.id]);assert.equal(forms(next,'finance.split-start').length,0);const finish=forms(next,'finance.finish-start')[0];assert.ok(finish);f.run(finish.command,{...finish.payload,outcome:'success',reason:'本地模拟完结'});assert.match(f.view(finance,['service-finance','entry',x.id]),/分账已完结/);
});

test('渠道未知仅提供原请求查询，查询成功后再进入完结',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.advance(2);f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'processing'});
  const html=f.view(finance,['service-finance','entry',f.entry.id]);assert.equal(forms(html,'finance.split-start').length,0);assert.equal(forms(html,'finance.finish-start').length,0);assert.equal(forms(html,'finance.split-query').length,1);assert.match(html,/渠道结果待查询/);
  const p=forms(html,'finance.split-query')[0].payload;f.run('finance.split-query',{...p,outcome:'success'});assert.equal(forms(f.view(finance,['service-finance','entry',f.entry.id]),'finance.finish-start').length,1);
});

test('失败未到普通重试时间显示人工勾选，五次后仍用原号且硬阻断不能绕过',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.advance(2);f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'failed'});
  const request=f.entry.split.requestNo,first=f.view(finance,['service-finance','entry',f.entry.id]);assert.match(first,/下次普通重试时间/);assert.match(forms(first,'finance.split-start')[0].body,/name="manual" value="true" required/);
  for(let n=0;n<4;n++)f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'failed',manual:true,reason:'人工核实原笔失败'});
  const after=f.view(finance,['service-finance','entry',f.entry.id]);assert.match(after,/已尝试 5 次/);assert.equal(f.entry.split.requestNo,request);assert.equal(forms(after,'finance.split-start').length,1);
  f.b.refunds=[{status:'processing',executions:[{paymentId:f.b.payment.id,status:'processing',amountCents:1000}]}];f.sync();assert.equal(forms(f.view(finance,['service-finance','entry',f.entry.id]),'finance.split-start').length,0);
});

test('门店只能读取本店，集团财务写资金，店长摘要无规则、凭证或交易明细入口',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.settle();f.payout();
  const storeHtml=f.view(store,['service-finance','entry',f.entry.id]);assert.match(storeHtml,/支付及分账金额/);assert.doesNotMatch(storeHtml,/data-command="finance\./);
  assert.match(f.view({role:'store',storeId:'s2'},['service-finance','entry',f.entry.id]),/不存在或无权/);
  const managerHtml=f.view(manager);assert.match(managerHtml,/本店资金摘要/);assert.doesNotMatch(managerHtml,/BANK-UI|分成规则版本|href="#\/manager\/service-finance\/(entry|income|payouts)/);assert.match(f.view(manager,['service-finance','entry',f.entry.id]),/无权/);
});

test('技师只本人收入及发放记录，不显示其他技师、分账细节或财务操作',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.settle();f.payout();f.book({techId:'t2'});f.finish();f.settle();
  const html=f.view(tech,['service-finance','income']);assert.match(html,/林师傅/);assert.doesNotMatch(html,/周师傅|B2|集团客户档|finance.split|finance.rule/);assert.match(html,/接单提成快照 v1 · 40%/);
  assert.match(f.view(tech,['service-finance','payouts']),/BANK-UI-001/);assert.doesNotMatch(f.view(tech,['service-finance','payouts']),/data-command="tech-income.payout"/);
  assert.equal(financeBookingPanel(f.s,tech,f.b),'');
});

test('月度发放只锁当前可发明细及版本，重复后不再出现且同月新增收入仍可发',()=>{
  const f=fixture();f.rules();f.book();f.extension();f.finish();f.settle();
  const first=forms(f.view(store,['service-finance','payouts']),'tech-income.payout')[0];assert.equal(first.payload.lines.length,2);assert.equal(first.payload.techId,'t1');assert.equal(first.payload.month,'2026-10');assert.equal(first.payload.amountCents,undefined);assert.match(first.body,/¥178.80/);assert.match(first.body,/实际转账凭证编号/);
  f.payout();assert.equal(forms(f.view(store,['service-finance','payouts']),'tech-income.payout').length,0);
  f.book();f.finish();f.settle();const second=forms(f.view(store,['service-finance','payouts']),'tech-income.payout')[0];assert.equal(second.payload.lines.length,1);assert.ok(second.payload.lines.every(x=>!first.payload.lines.some(y=>y.entryId===x.entryId)));
});

test('已发后退款展示差额并由门店登记实际追回，保留原发放不自动抵扣下月',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.settle();f.payout();f.b.payment.refundedCents=9800;f.sync();
  const html=f.view(store,['service-finance','income']);assert.match(html,/已多发，待核实追回/);assert.match(html,/¥39.20/);assert.match(html,/不自动抵扣下一月/);
  const form=forms(html,'tech-income.difference-record')[0];assert.equal(form.payload.kind,'recover');f.run(form.command,{...form.payload,amountCents:3920,proof:'RECOVER-UI-001',occurredAt:f.s.now,reason:'已实际追回'},store);
  const after=f.view(store,['service-finance','income']);assert.match(after,/RECOVER-UI-001/);assert.match(after,/已结清/);assert.equal(forms(after,'tech-income.difference-record').length,0);assert.equal(f.s.techIncomePayouts[0].amountCents,11920);
});

test('提成重新待核对时保留金额明确为上次已知，不能标成当前应计或发放',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.settle();const original=f.income.amountCents;delete f.b.techIncomeSnapshot;f.sync();assert.equal(f.income.status,'pending');assert.equal(f.income.amountCents,original);
  const html=f.view(tech,['service-finance','income']);assert.match(html,/上次已知应计，待核对/);assert.match(html,/汇总不完整/);assert.equal(forms(f.view(store,['service-finance','payouts']),'tech-income.payout').length,0);
});

test('回退失败及线下追偿保留独立来源、凭证和金额，不提供门店集团回收动作',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.settle();f.b.payment.refundedCents=9800;f.sync();f.run('finance.return-start',{id:f.entry.id,version:f.entry.version,outcome:'failed'});
  const html=f.view(finance,['service-finance','recoveries']);assert.match(html,/回退失败/);assert.match(html,/¥9.80/);assert.match(html,/集团 → 幸福里门店/);assert.doesNotMatch(html,/group → store:s1/);const form=forms(html,'finance.recovery-receive')[0];assert.ok(form);assert.equal(form.payload.version,f.s.serviceFinanceRecoveries[0].version);
  f.run(form.command,{...form.payload,amountCents:980,reference:'OFFLINE-UI-001',reason:'核对线下实际到账'});assert.match(f.view(finance,['service-finance','recoveries']),/OFFLINE-UI-001/);
  assert.equal(forms(f.view(store,['service-finance','recoveries']),'finance.recovery-receive').length,0);
});

test('账本区分渠道与线下收付，主单线下退回和加时渠道回退可核对至集团应收',()=>{
  const f=fixture();f.rules();f.run('finance.rule-publish',{scope:'global',groupBps:1500,storeBps:500,effectiveAt:f.s.now,version:1,reason:'明确演示比例'});f.book();f.extension();f.finish();f.settle();f.b.payment.refundedCents=9800;f.b.extensions[0].refundedCents=4900;f.sync();
  const main=serviceFinanceView(f.s,finance).entries.find(x=>x.kind==='main');f.run('finance.return-start',{id:main.id,version:main.version,outcome:'failed'});
  const recovery=f.s.serviceFinanceRecoveries.find(x=>x.entryId===main.id);f.run('finance.recovery-receive',{id:recovery.id,version:recovery.version,amountCents:1470,reference:'OFFLINE-MAIN-1470',reason:'已实际退回门店'});
  const extension=serviceFinanceView(f.s,finance).entries.find(x=>x.kind==='extension');f.run('finance.return-start',{id:extension.id,version:extension.version,outcome:'success'});
  const view=serviceFinanceView(f.s,finance),offline=view.entries.reduce((n,x)=>n+x.externalToStoreCents,0);assert.equal(view.summary.netCents,30000);assert.equal(view.summary.targetGroupCents,4500);assert.equal(view.summary.splitPaidCents,6705);assert.equal(view.summary.returnedCents,735);assert.equal(offline,1470);assert.equal(view.summary.splitPaidCents-view.summary.returnedCents-offline,view.summary.targetGroupCents);
  for(const actor of [finance,store]) {const html=f.view(actor);assert.match(html,/渠道已分账 ¥67.05/);assert.match(html,/渠道已回退 ¥7.35/);assert.match(html,/线下已退门店 ¥14.70/);assert.match(html,/<small>线下已退门店 ¥14.70<\/small>/);assert.match(html,/线下已付集团 ¥0.00/);}
  assert.match(f.view(finance),/aria-label="线下已退门店 ¥14.70，查看明细"[^>]*href="#\/group\/service-finance\/recoveries"/);assert.doesNotMatch(f.view(manager),/渠道已分账|渠道已回退|线下已退门店|线下已付集团/);
  const late=fixture();late.rules();late.book();late.finish();late.advance(30);const r=late.s.serviceFinanceRecoveries[0];late.run('finance.recovery-receive',{id:r.id,version:r.version,amountCents:2980,reference:'OFFLINE-TO-GROUP',reason:'门店已实际补付集团'});assert.match(late.view(),/线下已付集团 ¥29.80/);assert.match(late.view(),/<small>线下已付集团 ¥29.80<\/small>/);
});

test('纯渲染不改变任何账本且特殊字符转义，原预约面板只读不插入新步骤',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.settle();f.s.techs[0].name='<script>alert(1)</script>';f.s.serviceFinanceRules[0].reason='<img onerror=boom>';
  const before=JSON.stringify(f.s);for(const actor of [finance,store,manager,tech])for(const part of ['ledger','rules','income','payouts','recoveries'])f.view(actor,['service-finance',part]);
  const panel=financeBookingPanel(f.s,store,f.b);assert.match(panel,/服务资金/);assert.doesNotMatch(panel,/data-command=/);assert.equal(JSON.stringify(f.s),before);assert.match(f.view(tech,['service-finance','income']),/&lt;script&gt;/);assert.doesNotMatch(f.view(finance,['service-finance','rules']),/<img onerror/);
});

async function promotionPair(){
  const f=fixture();await f.promotion();
  f.book({payment:{id:'P-B1',status:'success',paidAt:f.s.now,amountCents:20000,refundedCents:0}});f.finish();
  f.book({payment:{id:'P-B2',status:'success',paidAt:f.s.now,amountCents:20000,refundedCents:0}});f.finish();f.advance(2);
  return f;
}
function refundFirst(f){
  // Original UI unit fixtures represent persisted refund facts. Split/query/
  // finish/recovery facts below are created by their real domain commands.
  const first=f.s.bookings[0];first.payment.refundedCents=first.payment.amountCents;first.refunds.push({id:'RF-ORIGINAL-B1',status:'success',executions:[{paymentId:first.payment.id,status:'success',amountCents:first.payment.amountCents,completedAt:f.s.now}]});f.sync();
}
const detail=f=>f.view(finance,['service-finance','entry',f.entry.id]);

test('C03 财务原支付详情和账本分列H/C/Cs及补差，未知来源不显示零佣金',async()=>{
  const f=await promotionPair(),x=f.entry;assert.equal(x.platformCents,1000);assert.equal(x.commissionCents,2000);assert.equal(x.promotionStoreCents,1000);assert.equal(x.targetGroupCents,2000);
  for(const html of [detail(f),f.view()]){assert.match(html,/平台服务费H/);assert.match(html,/个人推广佣金C/);assert.match(html,/门店承担(?:推广佣金)?Cs/);assert.match(html,/¥10.00/);assert.match(html,/¥20.00/);assert.match(html,/原服务款仍可按条件补分账/);}
  assert.match(detail(f),/平台服务费H<\/span><span>¥10.00/);assert.match(detail(f),/个人推广佣金C<\/span><span>¥20.00/);assert.match(detail(f),/客户归属快照/);assert.doesNotMatch(detail(f),/推广来源待核对/);
  delete f.b.servicePromotionSnapshot;f.sync();const unknown=detail(f);assert.match(unknown,/个人推广佣金C<\/span><span>待核对/);assert.match(unknown,/门店承担推广佣金Cs<\/span><span>待核对/);assert.doesNotMatch(unknown,/个人推广佣金C<\/span><span>¥0.00/);assert.equal(forms(unknown,'finance.split-start').length,0);
});

test('C03 首单重算只办理新差额，原成功笔保留，未知补笔按transactionId查询原额',async()=>{
  const f=await promotionPair();f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'success'});const original=structuredClone(f.entry.split);refundFirst(f);assert.equal(f.entry.pendingAdditionalCents,1000);assert.equal(f.entry.additionalPath,'channel');
  const start=forms(detail(f),'finance.split-start')[0];assert.ok(start);assert.match(detail(f),/补充分账明确差额/);f.run(start.command,{...start.payload,outcome:'processing',reason:'补笔原结果未知'});
  const pending=structuredClone(f.entry.split),html=detail(f);assert.equal(pending.amountCents,1000);assert.equal(f.entry.splitPaidCents,2000);assert.match(html,new RegExp(original.requestNo));assert.match(html,/累计分账原笔/);assert.equal(forms(html,'finance.split-start').length,0);assert.equal(forms(html,'finance.finish-start').length,0);
  const queries=forms(html,'finance.split-query');assert.equal(queries.length,1);assert.equal(queries[0].payload.transactionId,pending.id);assert.match(queries[0].attrs,new RegExp(pending.id));f.run(queries[0].command,{...queries[0].payload,outcome:'success',reason:'按原补笔查询成功'});
  assert.equal(f.entry.splitPaidCents,3000);assert.equal(f.entry.platformCents,1000);assert.equal(f.entry.splitHistory[0].requestNo,original.requestNo);assert.equal(f.entry.splitHistory[0].amountCents,original.amountCents);assert.equal(f.entry.split.amountCents,pending.amountCents);assert.equal(forms(detail(f),'finance.finish-start').length,1);
});

test('C03 历史目录里的未知原分账仍可查询，不用当前split或当前新目标替代原笔',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.advance(2);f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'processing'});const tx=structuredClone(f.entry.split),entry=f.s.serviceFinanceEntries.find(x=>x.id===f.entry.id);
  // Isolated loaded archive shape: a real command-created pending transaction
  // was retained in history. No success fact or request number is fabricated.
  entry.splitHistory.push(entry.split);entry.split=null;const before=structuredClone(f.s),html=detail(f),query=forms(html,'finance.split-query')[0];assert.deepEqual(f.s,before);assert.equal(query.payload.transactionId,tx.id);assert.match(html,new RegExp(tx.requestNo));assert.equal(forms(html,'finance.split-start').length,0);
  f.run(query.command,{...query.payload,outcome:'success',reason:'查询历史原笔'});assert.equal(f.entry.splitHistory[0].status,'success');assert.equal(f.entry.splitHistory[0].amountCents,tx.amountCents);assert.equal(f.entry.splitHistory[0].requestNo,tx.requestNo);assert.equal(f.entry.splitPaidCents,tx.amountCents);
});

test('C03 多笔成功分账回退必须选择原id与请求号，未知回退占原源而不冒充成功',async()=>{
  const f=await promotionPair();f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'success'});refundFirst(f);f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'success'});assert.equal(f.entry.splitTransactions.filter(x=>x.status==='success').length,2);
  f.b.payment.refundedCents=10000;f.b.refunds.push({id:'RF-ORIGINAL-B2',status:'success',executions:[{paymentId:f.b.payment.id,status:'success',amountCents:10000,completedAt:f.s.now}]});f.sync();assert.equal(f.entry.pendingReturnCents,1500);
  const newForms=forms(detail(f),'finance.return-start');assert.equal(newForms.length,2);assert.notEqual(newForms[0].attrs,newForms[1].attrs);
  for(const form of newForms){const src=f.entry.returnSources.find(x=>x.splitId===form.payload.splitId);assert.ok(src);assert.equal(form.payload.splitRequestNo,src.splitRequestNo);assert.match(form.body,new RegExp(`max="${src.returnableCents/100}"`));assert.match(form.body,/name="amountCents" value=""[^>]*required/);}
  assert.throws(()=>f.run('finance.return-start',{...newForms[0].payload,splitRequestNo:'DIFFERENT-ORIGINAL',amountCents:500,outcome:'success'}),/原.*分账|来源|请求号/);
  const smaller=newForms.find(form=>f.entry.returnSources.find(src=>src.splitId===form.payload.splitId).returnableCents===1000);assert.throws(()=>f.run('finance.return-start',{...smaller.payload,amountCents:1001,outcome:'success'}),/金额|份额|无效/);
  f.run(newForms[0].command,{...newForms[0].payload,amountCents:500,outcome:'processing'});assert.equal(f.entry.returnedCents,0);assert.equal(f.entry.returnSources.find(x=>x.splitId===newForms[0].payload.splitId).reservedCents,500);assert.equal(forms(detail(f),'finance.return-start').length,0);
  const query=forms(detail(f),'finance.return-query')[0];assert.equal(query.payload.splitId,newForms[0].payload.splitId);assert.equal(query.payload.splitRequestNo,newForms[0].payload.splitRequestNo);f.run(query.command,{...query.payload,outcome:'success'});assert.equal(f.entry.returnedCents,500);assert.equal(f.entry.returns[0].splitRequestNo,newForms[0].payload.splitRequestNo);
  const current=structuredClone(f.s);assert.throws(()=>f.run('finance.return-start',{...newForms[1].payload,amountCents:100,outcome:'success'}),/更新|版本/);assert.deepEqual(f.s,current);
});

test('C03 已完结后差额仅去原追偿，推广源必需毫秒时间/真实文件，原现金记录分列发生与登记',async()=>{
  const f=await promotionPair();f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'success'});f.run('finance.finish-start',{id:f.entry.id,version:f.entry.version,outcome:'success'});refundFirst(f);assert.equal(f.entry.additionalPath,'recovery');assert.equal(f.entry.pendingAdditionalCents,1000);
  const html=detail(f);assert.equal(forms(html,'finance.split-start').length,0);assert.match(html,/原分账已完结或原服务款已释放/);const recovery=serviceFinanceView(f.s,finance).recoveries.find(x=>x.entryId===f.entry.id&&x.type==='unshared-release');assert.equal(recovery.requiresPromotionEvidence,true);
  const form=forms(f.view(finance,['service-finance','recoveries'],'id='+recovery.id),'finance.recovery-receive')[0];assert.equal(form.payload.id,recovery.id);assert.match(form.body,/name="occurredAt" value="" required step="0.001"/);assert.match(form.body,/type="file" data-invoice-upload accept="application\/pdf,image\/png,image\/jpeg" required/);for(const field of ['fileRef','fileName','fileType','fileSize'])assert.match(form.body,new RegExp(`name="${field}"`));assert.equal(form.payload.requestId,undefined);
  assert.throws(()=>f.run(form.command,{...form.payload,amountCents:1000,reference:'NO-FILE',reason:'缺实际文件'}),/原文件/);
  f.s.now+=1000;const occurredAt=f.s.now-877,local=new Date(occurredAt+8*3600000).toISOString().slice(0,-1);await f.proofRun(form.command,{...form.payload,amountCents:1000,occurredAt:local,reference:'UI-RECOVERY-ACTUAL'});const record=f.s.serviceFinanceRecoveries.find(x=>x.id===recovery.id).records[0];assert.equal(record.occurredAt,occurredAt);assert.equal(record.at,f.s.now);assert.equal(record.recordedAt,f.s.now);assert.equal(f.entry.pendingAdditionalCents,0);
  const history=f.view(finance,['service-finance','recoveries'],'id='+recovery.id);assert.match(history,/实际发生时间/);assert.match(history,/\.123/);assert.match(history,/登记时间/);assert.match(history,new RegExp(`data-invoice-slot="recovery:${record.id}:0"`));assert.match(history,/data-invoice-domain="service-finance"/);assert.doesNotMatch(history,/data-invoice-domain="service-extra"/);assert.equal(forms(history,'finance.recovery-receive').length,0);
});

test('C03 旧非推广追偿保持原字段，当前来源未知或渠道未知不沿旧open债画回款动作',()=>{
  const f=fixture();f.rules();f.book();f.finish();f.advance(30);const recovery=f.s.serviceFinanceRecoveries.find(x=>x.type==='unshared-release');const before=forms(f.view(finance,['service-finance','recoveries']),'finance.recovery-receive')[0];assert.ok(before);assert.doesNotMatch(before.body,/name="occurredAt"|data-invoice-upload/);assert.equal(serviceFinanceView(f.s,finance).recoveries[0].requiresPromotionEvidence,false);
  delete f.s.serviceFinanceEntries[0].ruleSnapshot;const unknown=f.view(finance,['service-finance','recoveries']);assert.equal(forms(unknown,'finance.recovery-receive').length,0);assert.match(unknown,/应追金额<\/span><span>待核对/);assert.match(unknown,/尚未结清<\/span><span>待核对/);assert.match(unknown,/关联支付明细/);assert.equal(recovery.receivedCents,0);
  for(const actor of [store,manager,tech,{role:'group',job:'operations'},{role:'group',job:'support'}])assert.equal(forms(f.view(actor,['service-finance','recoveries']),'finance.recovery-receive').length,0);
  const pending=fixture();pending.rules();pending.book();pending.finish();pending.settle();pending.b.payment.refundedCents=9800;pending.sync();pending.run('finance.return-start',{id:pending.entry.id,version:pending.entry.version,outcome:'failed'});const original=pending.entry.returns[0];pending.run('finance.return-start',{id:pending.entry.id,version:pending.entry.version,returnId:original.id,splitId:original.splitId,splitRequestNo:original.splitRequestNo,manual:true,outcome:'processing',reason:'原失败回退人工重试，结果未知'});assert.equal(pending.entry.unknownChannel,true);assert.equal(forms(pending.view(finance,['service-finance','recoveries']),'finance.recovery-receive').length,0);assert.equal(pending.s.serviceFinanceRecoveries[0].receivedCents,0);
});

test('C03 实际已付佣金全退后显示尚未扣回的店承担额，原回退不提前退该部分',async()=>{
  const f=await promotionPair();f.settle();const promoter=f.s.servicePromoters.find(x=>x.personId==='u2');f.promo('withdraw-create',{promoterId:promoter.id,amountCents:6000,balanceToken:servicePromotionBalanceToken(f.s,promoter.id)},owner);await f.proofRun('service-promotion.withdraw-pay',{id:f.s.servicePromotionWithdrawals.at(-1).id,outcome:'success'});refundFirst(f);
  const first=serviceFinanceView(f.s,finance).entries.find(x=>x.bookingId==='B1'),html=f.view(finance,['service-finance','entry',first.id]);assert.equal(first.retainedStoreCommissionCents,2000);assert.equal(first.targetGroupCents,2000);assert.equal(first.pendingReturnCents,1000);assert.match(html,/已付尚未扣回的门店承担额<\/span><span>¥20.00/);assert.match(html,/平台服务费H<\/span><span>¥0.00/);assert.match(html,/个人推广佣金C<\/span><span>¥0.00/);
  const source=forms(html,'finance.return-start')[0];assert.match(source.body,/max="10"/);assert.equal(source.payload.splitRequestNo,first.split.requestNo);assert.equal(first.splitPaidCents,3000);assert.equal(first.returnedCents,0);
});

test('C03 明确失败笔金额重算后保留原失败历史，新差额表单不宣称按原旧额重试',async()=>{
  const f=await promotionPair();f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'failed'});const old=structuredClone(f.entry.split);refundFirst(f);assert.equal(f.entry.pendingAdditionalCents,3000);const html=detail(f),form=forms(html,'finance.split-start')[0];assert.match(html,/保留原失败笔并办理新差额/);assert.match(form.body,new RegExp(old.requestNo));assert.match(form.body,/当前明确应补差<\/span><span>¥30.00/);assert.doesNotMatch(form.body,/可按原号重试/);
  f.run(form.command,{...form.payload,manual:true,outcome:'success',reason:'明确核实旧笔失败后办理新差额'});assert.equal(f.entry.splitPaidCents,3000);assert.equal(f.entry.split.amountCents,3000);assert.notEqual(f.entry.split.requestNo,old.requestNo);assert.equal(f.entry.splitHistory[0].requestNo,old.requestNo);assert.equal(f.entry.splitHistory[0].status,'failed');assert.equal(f.entry.splitHistory[0].amountCents,2000);
});

test('C03 财务新增反馈和附件控件沿原语义，内容转义且纯渲染不写资金或文件',async()=>{
  const f=await promotionPair();f.run('finance.split-start',{id:f.entry.id,version:f.entry.version,outcome:'success'});f.run('finance.finish-start',{id:f.entry.id,version:f.entry.version,outcome:'success'});refundFirst(f);const recovery=f.s.serviceFinanceRecoveries.find(x=>x.entryId===f.entry.id);await f.proofRun('finance.recovery-receive',{id:recovery.id,version:recovery.version,amountCents:1000});const current=f.s.serviceFinanceRecoveries.find(x=>x.id===recovery.id);current.records[0].evidenceRefs[0].name='"><img src=x onerror=alert(1)>';current.records[0].reason='<script>unsafe</script>';
  const before=structuredClone(f.s),html=f.view(finance,['service-finance','recoveries']);assert.deepEqual(f.s,before);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script>|data-command="service-extra\./);assert.match(html,/class="btn secondary" data-invoice-action="view"[^>]*disabled/);assert.match(html,/class="btn secondary" data-invoice-action="download"/);
  for(const [,attrs] of html.matchAll(/<p\b([^>]*class="notice[^>]*)>/g)){assert.match(attrs,/role="status"/);assert.doesNotMatch(attrs,/role="button"|data-command|tabindex/);}for(const actor of [store,{role:'store',storeId:'s2'},manager,{role:'group',job:'support'}])assert.doesNotMatch(f.view(actor,['service-finance','recoveries']),/data-invoice-file|data-command="finance\./);
});
