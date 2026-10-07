import test from 'node:test';
import assert from 'node:assert/strict';
import { servicePromotionUi } from './service-promotion-ui.mjs';
import { upgradeServicePromotion, servicePromotionCommand, syncServicePromotion, captureServicePromotion, captureServicePromotionRisk, captureTechServicePromoter, servicePromotionView, closeStoreServicePromoters } from './service-promotion.mjs';
const DAY=86400000,user={role:'user',userId:'u1'},customer={role:'user',userId:'u2'},ops={role:'group',job:'operations'},support={role:'group',job:'support'},finance={role:'group',job:'finance'},manager={role:'store',job:'store-manager',storeId:'a'},localFinance={role:'store',job:'store-finance',storeId:'a'};
const file={ref:`invoice-file:${'d'.repeat(64)}`,name:'实际领域契约依据.pdf',type:'application/pdf',size:512};
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=v=>v.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,c=>({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[c]));
const ui={esc:e,money:n=>`¥${(n/100).toFixed(2)}`,date:t=>Number.isSafeInteger(t)?new Date(t).toISOString():'—',query:new URLSearchParams(),field:(label,name,value='',type='text',attrs='')=>`<label class="field"><span>${e(label)}</span><input name="${e(name)}" value="${e(value)}" type="${e(type)}" ${attrs}></label>`,select:(label,name,opts,value)=>`<label class="field"><span>${e(label)}</span><select name="${e(name)}">${opts.map(o=>`<option value="${e(o.value)}"${String(o.value)===String(value)?' selected':''}>${e(o.label)}</option>`).join('')}</select></label>`,empty:(label,detail='')=>`<section><h2>${e(label)}</h2><p>${e(detail)}</p></section>`,link:(label,path,kind='')=>`<a href="#${e(path)}" class="${e(kind)}">${label}</a>`};
function forms(html,command){return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,raw,body])=>{const attrs=Object.fromEntries([...raw.matchAll(/([\w-]+)=("[^"]*"|'[^']*')/g)].map(([,k,v])=>[k,decode(v.slice(1,-1))]));return{attrs,body,command:attrs['data-command'],payload:JSON.parse(attrs['data-payload']||'{}')};}).filter(f=>!command||f.command==='service-promotion.'+command);}
const options={canCommand:()=>true};
function fixture(){
  // These focused tests exercise UI/domain payloads. The original finance
  // summary and file reader are explicit adapters, not shared runtime proof.
  let s={schema:5,seq:0,now:Date.parse('2026-10-04T12:00:00+08:00'),users:['u1','u2','u3'].map(id=>({id,serviceBinding:{status:'unbound',recordedAt:Date.parse('2026-10-04T12:00:00+08:00'),version:0}})),stores:[{id:'a',active:true},{id:'b',active:true}],techs:[{id:'lin',storeId:'a'}],bookings:[],serviceFinanceRules:[{id:'H',version:1,groupBps:1000,storeBps:500,effectiveAt:0}]},n=0;
  upgradeServicePromotion(s);const f={get s(){return s;},get p(){return s.servicePromoters[0];},get i(){return s.servicePromotionInvites.at(-1);},get c(){return s.serviceCommissions.at(-1);},get w(){return s.servicePromotionWithdrawals.at(-1);},get d(){return s.servicePromotionRecoveries.at(-1);},ctx:{validateEvidenceRefs:refs=>refs.every(f=>JSON.stringify(f)===JSON.stringify(file)),serviceFinanceSummary:(state,id)=>{const b=state.bookings.find(b=>b.id===id);return{canPayTech:b?.fundsSettled!==false&&b?.status==='done'&&state.now>=b.completedAt+2*DAY,unknownRefund:false,blockers:[]};}},proof(){return{file,reference:`ACTUAL-${++n}`,occurredAt:s.now,reason:'实际文件与原来源核对'};},page(section='promoters',id='',actor=user,query=ui.query){return servicePromotionUi(s,['service-promotion',section,...(id?[id]:[])],actor,{...ui,query},options);},write(type,p={},actor=finance){const next=structuredClone(s),result=servicePromotionCommand(next,actor,type,{requestId:`promotion-ui-${++n}`,...p},f.ctx);s=next;return result;},submit(form,p={},actor=finance){assert.ok(form,'当前授权页面须提供此实际动作表单');return f.write(form.command,{...form.payload,...p},actor);},agreement(type='store-promoter'){const a=forms(f.page('agreements','',support),'agreement-publish').find(f=>f.payload.promoterType===type);return f.submit(a,{title:'实际原协议<img>',body:'实际不做虚假宣传协议<script>原条款</script>',effectiveAt:s.now,...f.proof()},support);},invite(type='store-promoter'){f.agreement(type);const form=forms(f.page('invites','',type==='group-promoter'?ops:manager),'invite').find(f=>f.payload.promoterType===type);return f.submit(form,{userId:'u1',expiresAt:s.now+DAY,reason:'本人邀请的实际依据'},type==='group-promoter'?ops:manager);},accept(){return f.submit(forms(f.page('invites',f.i.id),'invite-confirm')[0],{decision:'accept',agreementAccepted:'on',reason:'本人阅读原协议并接受'},user);},review(){return f.submit(forms(f.page('promoters',f.p.id,support),'identity-review')[0],{decision:'verified',...f.proof()},support);},rule(){return f.submit(forms(f.page('rules','',finance),'rule-publish').find(f=>f.payload.promoterType==='store-promoter'),{firstBps:2000,repeatBps:1000,storeCostBps:5000,csRounding:'floor',concurrency:'completed-created-id',lateFullRefund:'reassign',effectiveAt:s.now,basis:'隔离演示明确配置，正式政策另定'},finance);},activate(){f.invite();f.accept();f.review();f.rule();f.submit(forms(f.page('binding','',customer),'enter')[0],{promoterId:f.p.id},customer);f.submit(forms(f.page('promoters',f.p.id),'transfer-authorize')[0],{enabled:'true',reason:'本人明确本地演示免确认收款授权'},user);},earning(id='B1',amount=20000,storeId='a',extra={}){const b={id,userId:'u2',storeId,status:'confirmed',createdAt:s.now,completedAt:null,payment:{id:'P-'+id,status:'success',amountCents:amount,refundedCents:0,paidAt:s.now},extensions:[],refunds:[],serviceFinanceSnapshot:{source:{},rule:{groupBps:1000,storeBps:500}},...extra};s.bookings.push(b);captureServicePromotion(s,b,f.ctx);b.status='done';b.completedAt=s.now;syncServicePromotion(s,f.ctx);s.now+=2*DAY+1;syncServicePromotion(s,f.ctx);return f.c;},withdraw(amount=4000){return f.submit(forms(f.page('promoters',f.p.id),'withdraw-create')[0],{amountCents:amount},user);},pay(outcome='processing',extra={}){return f.submit(forms(f.page('withdrawals',f.w.id,finance),'withdraw-pay')[0],{outcome,...f.proof(),...extra},finance);},query(outcome='success'){return f.submit(forms(f.page('withdrawals',f.w.id,finance),'withdraw-query')[0],{outcome,...f.proof()},finance);},refund(amount=10000,id='B1',at=s.now){const b=s.bookings.find(b=>b.id===id);b.payment.refundedCents+=amount;b.refunds.push({id:'RF-'+ ++n,status:'success',executions:[{paymentId:b.payment.id,status:'success',amountCents:amount,completedAt:at}]});syncServicePromotion(s,f.ctx);}};return f;
}

test('C03 界面只纯读授权投影，无客户列表/姓名电话地址，跨店与无岗位不显示身份',()=>{
  const f=fixture();f.activate();f.earning();f.s.users[1].name='客户绝不能返回的姓名';f.s.users[1].phone='18800000000';f.s.users[1].address='客户私密地址';const before=structuredClone(f.s);
  for(const section of ['promoters','commissions','withdrawals','recoveries','rules','agreements'])assert.doesNotMatch(f.page(section),/客户绝不能返回|18800000000|客户私密地址/);
  assert.match(f.page('promoters',f.p.id),/1 人/);assert.match(f.page('promoters',f.p.id,{role:'store',job:'store-manager',storeId:'b'}),/不存在或超出/);assert.match(f.page('promoters','',{role:'group',job:'warehouse'}),/无权/);assert.match(f.page('withdrawals','',ops),/无权/);assert.deepEqual(f.s,before);
});

test('C03 佣金规则四类型固定版本，比例/Cs/D06为空且实际表单能发布原类型',()=>{
  const f=fixture(),fs=forms(f.page('rules','',finance),'rule-publish');assert.equal(fs.length,4);assert.deepEqual(new Set(fs.map(x=>x.payload.promoterType)),new Set(['tech','staff','store-promoter','group-promoter']));
  for(const form of fs){for(const name of ['firstBps','repeatBps','storeCostBps'])assert.match(form.body,new RegExp(`name="${name}" value=""[^>]*data-unit="percent"`));for(const name of ['concurrency','lateFullRefund','csRounding'])assert.match(form.body,new RegExp(`<select required name="${name}"><option value="" selected>`));assert.equal(form.payload.version,0);}
  f.rule();const old=fs.find(x=>x.payload.promoterType==='store-promoter');assert.throws(()=>f.submit(old,{firstBps:2000,repeatBps:1000,storeCostBps:5000},finance),/版本/);assert.equal(forms(f.page('rules','',finance),'rule-publish').find(x=>x.payload.promoterType==='store-promoter').payload.version,1);assert.match(f.page('rules','',finance),/不等于正式政策批准/);
});

test('C03 原协议实际上传表单与正文转义，缺实际文件不显示发布成功',()=>{
  const f=fixture(),form=forms(f.page('agreements','',support),'agreement-publish').find(f=>f.payload.promoterType==='store-promoter');assert.match(form.body,/data-invoice-upload/);for(const name of ['fileRef','fileName','fileType','fileSize'])assert.match(form.body,new RegExp(`name="${name}"`));assert.match(form.body,/name="body" required/);assert.match(form.body,/name="occurredAt"[^>]*required/);
  assert.throws(()=>f.submit(form,{title:'原协议',body:'原条款',effectiveAt:f.s.now,reference:'来源',occurredAt:f.s.now,reason:'实际核验'},support),/实际证据文件/);f.agreement();const a=f.s.servicePromotionAgreements[0],html=f.page('agreements',a.id,support);assert.match(html,/实际原协议&lt;img&gt;/);assert.doesNotMatch(html,/<script>|<img>/);assert.match(html,/data-invoice-domain="service-promotion"/);assert.match(html,/data-invoice-slot="agreement:0"/);assert.match(html,/class="btn secondary" data-invoice-action="view"/);
});

test('C03 邀请与本人原版本确认表单走通，接受协议不直接充当实名',()=>{
  const f=fixture();f.invite();const i=f.i,html=f.page('invites',i.id),form=forms(html,'invite-confirm')[0];assert.equal(form.payload.id,i.id);assert.equal(form.payload.agreementId,i.agreementSnapshot.id);assert.match(form.body,/name="agreementAccepted"/);assert.match(form.body,/name="reason" required/);assert.match(html,/原条款&lt;\/script&gt;/);assert.equal(forms(f.page('invites',i.id,customer),'invite-confirm').length,0);
  assert.throws(()=>f.submit(form,{decision:'accept',reason:'未确认原协议'},user),/原协议/);f.accept();assert.equal(f.p.status,'identity-pending');assert.equal(forms(f.page('promoters',f.p.id),'withdraw-create').length,0);assert.match(f.page('promoters',f.p.id),/待实际核验/);assert.throws(()=>f.submit(form,{decision:'reject',reason:'过期旧页'},user),/版本/);
});

test('C03 身份证据仅客服有实际预览槽，本人和财务只有核验状态；停用保留历史余额',()=>{
  const f=fixture();f.activate();f.earning();const supportHtml=f.page('promoters',f.p.id,support);assert.match(supportHtml,/data-invoice-slot="identity:0"/);for(const a of [user,finance,manager])assert.doesNotMatch(f.page('promoters',f.p.id,a),/data-invoice-slot="identity:|file:/);
  const disable=forms(f.page('promoters',f.p.id,manager),'disable')[0];f.submit(disable,{kind:'exit',reason:'实际停止推广，旧款继续结算'},manager);assert.equal(f.p.status,'disabled');assert.match(f.page('promoters',f.p.id),/原已发生款项和可提现余额保留/);assert.equal(forms(f.page('promoters',f.p.id),'withdraw-create').length,1);assert.equal(forms(f.page('promoters',f.p.id),'disable').length,0);assert.match(f.page('promoters',f.p.id),/历史记录/);
});

test('C03 服务绑定实际入口需本人提交，原有效绑定不被后扫覆盖且历史明确',()=>{
  const f=fixture();f.activate();const query=new URLSearchParams({promoterId:f.p.id}),html=f.page('binding','',customer,query),form=forms(html,'enter')[0],before=structuredClone(f.s.users[1].serviceBinding);assert.match(form.body,new RegExp(`name="promoterId" value="${f.p.id}"`));assert.equal(form.payload.version,before.version);f.submit(form,{storeId:'b'},customer);assert.deepEqual(f.s.users[1].serviceBinding,before);assert.match(f.page('binding','',customer),/先绑先得/);assert.match(f.page('binding','',customer),/不改变已下订单/);assert.match(f.page('binding','',customer),/原归属.*新归属/);assert.equal(forms(f.page('binding','',finance),'enter').length,0);
});

test('C03 原佣金未知金额显示待核对，主款/加钟和首单复购留原明细，不提供手改佣金',()=>{
  const f=fixture();f.invite();f.accept();f.review();f.submit(forms(f.page('binding','',customer),'enter')[0],{promoterId:f.p.id},customer);f.earning();const html=f.page('commissions',f.c.id);assert.match(html,/待核对/);assert.match(html,/原认定待核对/);assert.match(html,/主订单支付/);assert.equal(forms(html).length,0);assert.doesNotMatch(html,/NaN|¥null/);assert.match(f.page('commissions',f.c.id,{role:'store',job:'store-finance',storeId:'b'}),/不存在或超出/);
});

test('C03 本人提现表单携带真实余额token及身份版本，并发旧页面拒绝而非再取款',()=>{
  const f=fixture();f.activate();f.earning();const form=forms(f.page('promoters',f.p.id),'withdraw-create')[0];assert.equal(form.payload.version,f.p.version);assert.match(form.payload.balanceToken,/^[a-f0-9]{64}$/);assert.match(form.body,/name="amountCents" value=""[^>]*data-unit="yuan"/);assert.match(form.body,/min="10" max="40"/);f.submit(form,{amountCents:4000},user);assert.equal(f.w.status,'requested');assert.equal(f.s.servicePromotionWithdrawals.length,1);assert.throws(()=>f.submit(form,{amountCents:4000},user),/余额.*变化/);assert.equal(forms(f.page('promoters',f.p.id),'withdraw-create').length,0);assert.doesNotMatch(f.page('promoters',f.p.id,localFinance),/个人佣金余额|上海自然日已创建申请/);
});

test('C03 未知转账只原筆查询，失败重试保持原商户单且每日计次不增加',()=>{
  const f=fixture();f.activate();f.earning();f.withdraw();const initial=forms(f.page('withdrawals',f.w.id,finance),'withdraw-pay')[0];assert.match(initial.body,/name="reason" required/);f.pay();const no=f.w.execution.requestNo,unknown=f.page('withdrawals',f.w.id,finance);assert.equal(forms(unknown,'withdraw-pay').length,0);assert.equal(forms(unknown,'withdraw-query').length,1);assert.match(unknown,/不代表实际到账/);assert.equal(forms(f.page('withdrawals',f.w.id),'withdraw-cancel').length,0);f.query('failed');assert.equal(forms(f.page('withdrawals',f.w.id,finance),'withdraw-pay').length,1);f.pay();assert.equal(f.w.execution.requestNo,no);assert.equal(f.s.servicePromotionWithdrawals.length,1);f.query();assert.equal(f.w.status,'paid');assert.match(f.page('withdrawals',f.w.id,finance),/data-invoice-slot="payment:0"/);assert.equal(forms(f.page('withdrawals',f.w.id,finance),'withdraw-query').length,0);
});

test('C03 非免确认收款只本人接受后查询真实到账，超时页面不伪撤销',()=>{
  const f=fixture();f.activate();f.submit(forms(f.page('promoters',f.p.id),'transfer-authorize')[0],{enabled:'false',reason:'本人保留逐笔确认'},user);f.earning();f.withdraw();const initial=forms(f.page('withdrawals',f.w.id,finance),'withdraw-pay')[0];assert.doesNotMatch(initial.body,/value="success"/);f.pay('awaiting_user',{confirmExpiresAt:f.s.now+DAY});const form=forms(f.page('withdrawals',f.w.id),'withdraw-confirm')[0];assert.ok(form);assert.equal(forms(f.page('withdrawals',f.w.id,customer),'withdraw-confirm').length,0);f.submit(form,{decision:'accept',reason:'本人明确同意原笔收款'},user);assert.equal(f.w.status,'processing');assert.equal(f.w.execution.completedAt,undefined);assert.match(forms(f.page('withdrawals',f.w.id,finance),'withdraw-query')[0].body,/value="success"/);f.query();assert.equal(f.w.status,'paid');
  const q=fixture();q.activate();q.submit(forms(q.page('promoters',q.p.id),'transfer-authorize')[0],{enabled:'false',reason:'本人逐笔确认'},user);q.earning();q.withdraw();q.pay('awaiting_user',{confirmExpiresAt:q.s.now+1000});q.s.now+=1001;assert.equal(forms(q.page('withdrawals',q.w.id),'withdraw-confirm').length,0);assert.match(q.page('withdrawals',q.w.id),/不能补造成功或撤销/);assert.equal(q.w.status,'awaiting_user');
});

test('C03 退后原债展示实际回款与后续佣金抵扣，财务按原version登记且本人无写权',()=>{
  const f=fixture();f.activate();f.earning();f.withdraw();f.pay();f.query();f.refund();let html=f.page('recoveries',f.d.id);assert.match(html,/¥20.00/);assert.equal(forms(html,'recovery-receive').length,0);assert.match(html,/后续佣金抵扣及撤回/);
  const before=forms(f.page('recoveries',f.d.id,finance),'recovery-receive')[0];assert.equal(before.payload.version,f.d.version);assert.match(before.body,/max="20"/);assert.equal(forms(f.page('recoveries',f.d.id,finance),'recovery-loss').length,0);f.submit(before,{amountCents:500,...f.proof()},finance);assert.match(f.page('recoveries',f.d.id),/实际收回/);assert.match(f.page('recoveries',f.d.id),/¥15.00/);assert.match(f.page('recoveries',f.d.id,finance),/data-invoice-slot="record:[^:]+:0"/);assert.throws(()=>f.submit(before,{amountCents:500,...f.proof()},finance),/版本/);
  f.earning('B2',10000);assert.match(f.page('recoveries',f.d.id),/当前有效/);assert.match(f.page('recoveries',f.d.id),/SPC/);assert.doesNotMatch(f.page('recoveries',f.d.id),/invoice-file:/);
});

test('C03 控件采用原表单与按钮，状态反馈无操作语义，能力拒绝不显示动作',()=>{
  const f=fixture();f.activate();const html=f.page('promoters',f.p.id);assert.match(html,/class="management-form"/);assert.match(html,/data-live-version=/);assert.match(html,/type="submit" class="btn primary"/);assert.match(html,/class="notice" role="status"/);assert.doesNotMatch(html,/class="notice"[^>]*(?:data-command|role="button")/);
  const denied=servicePromotionUi(f.s,['service-promotion','promoters',f.p.id],user,ui,{canCommand:()=>false});assert.equal(forms(denied).length,0);assert.match(denied,/返回本类列表/);assert.match(denied,/返回工作首页/);assert.equal(forms(f.page('promoters',f.p.id,customer)).length,0);
});

test('C03 实际未知和失败可只留真实原因，缺成功凭据不会被表单或领域假记已付',()=>{
  const f=fixture();f.activate();f.earning();f.withdraw();const form=forms(f.page('withdrawals',f.w.id,finance),'withdraw-pay')[0];
  for(const name of ['reference','occurredAt'])assert.doesNotMatch(form.body,new RegExp(`name="${name}"[^>]*required`));assert.match(form.body,/实际成功时必填/);assert.match(form.body,/name="reason" required/);
  f.submit(form,{outcome:'processing',reason:'原渠道尚未返回明确结果'},finance);const no=f.w.execution.requestNo;assert.equal(f.w.status,'processing');assert.equal(f.w.execution.proof,undefined);assert.equal(f.w.execution.completedAt,undefined);assert.equal(f.w.execution.results[0].facts,undefined);
  const query=forms(f.page('withdrawals',f.w.id,finance),'withdraw-query')[0];assert.throws(()=>f.submit(query,{outcome:'success',reason:'还没有成功文件'},finance),/实际技术号或凭证编号/);assert.equal(f.w.status,'processing');assert.equal(f.w.execution.requestNo,no);
  assert.throws(()=>f.submit(query,{outcome:'failed'},finance),/失败或撤销原因/);f.submit(query,{outcome:'failed',reason:'原渠道明确账号信息不匹配'},finance);assert.equal(f.w.status,'failed');assert.equal(f.w.execution.proof,undefined);assert.match(f.page('withdrawals',f.w.id,finance),/明确账号信息不匹配/);assert.equal(f.s.servicePromotionWithdrawals.length,1);
});

test('C03 非成功原受理证据独立留槽并转义，仅集团财务能读取原文件',()=>{
  const f=fixture();f.activate();f.earning();f.withdraw();const time=f.s.now;
  f.submit(forms(f.page('withdrawals',f.w.id,finance),'withdraw-pay')[0],{outcome:'processing',file,reference:'受理号<img>',occurredAt:time,reason:'原受理事实<script>'},finance);const html=f.page('withdrawals',f.w.id,finance);
  assert.match(html,/data-invoice-slot="result:0:0"/);assert.match(html,/查看原转账核对依据/);assert.match(html,/受理号&lt;img&gt;/);assert.match(html,/原受理事实&lt;script&gt;/);assert.match(html,new RegExp(ui.date(time)));assert.doesNotMatch(html,/<img>|<script>/);assert.equal(f.w.status,'processing');assert.equal(f.w.execution.proof,undefined);
  for(const actor of [user,localFinance])assert.doesNotMatch(f.page('withdrawals',f.w.id,actor),/result:0:0|受理号|原受理事实|invoice-file:/);
});

test('C03 同人跨店整笔提现仅本店承担行投影，不展示个人全域金额或渠道信息',()=>{
  const f=fixture();f.activate();f.earning();f.earning('B2',20000,'b');f.withdraw(6000);f.pay();assert.equal(f.w.amountCents,6000);assert.match(f.page('withdrawals',f.w.id),/¥60.00/);
  const list=f.page('withdrawals','',localFinance),detail=f.page('withdrawals',f.w.id,localFinance);
  for(const html of [list,detail]){assert.match(html,/本店承担行/);assert.match(html,/¥40.00/);assert.match(html,/¥20.00/);assert.doesNotMatch(html,/¥60.00|SPNO|原商户转账单号|计次日期|name="amountCents"|data-command="service-promotion\./);}
  assert.equal(forms(detail).length,0);assert.match(f.page('withdrawals',f.w.id,{...localFinance,storeId:'b'}),/不存在或超出/);
});

test('C03 90天人工损失按原债状态提供入口，实际收回和损失分别留金额与文件',()=>{
  const f=fixture();f.activate();f.earning();f.withdraw();f.pay();f.query();f.refund();f.submit(forms(f.page('recoveries',f.d.id,finance),'recovery-receive')[0],{amountCents:500,...f.proof()},finance);
  assert.equal(forms(f.page('recoveries',f.d.id,finance),'recovery-loss').length,0);f.s.now=f.d.dueAt;const form=forms(f.page('recoveries',f.d.id,finance),'recovery-loss')[0];assert.match(form.body,/max="15"/);f.submit(form,{amountCents:1500,...f.proof()},finance);
  const html=f.page('recoveries',f.d.id,finance);assert.match(html,/实际收回/);assert.match(html,/按原承担方记损失/);assert.match(html,/¥5.00/);assert.match(html,/¥15.00/);assert.equal(f.d.status,'loss');assert.equal(f.d.receivedCents,500);assert.equal(forms(html,'recovery-receive').length,0);assert.equal(forms(f.page('recoveries',f.d.id),'recovery-loss').length,0);
});

test('C03 详情返回原模块且不可用伪ID装作配置或归属详情',()=>{
  const f=fixture();f.activate();assert.match(f.page('promoters',f.p.id),/href="#\/user\/service-promotion\/binding\?promoterId=/);assert.match(f.page('binding','forged',customer),/无权/);assert.match(f.page('rules','forged',finance),/无权/);
});

test('C03 原首单实际全退晚核对产生超收待退，原回款保留并由财务原表单实际退回',()=>{
  const f=fixture();f.activate();f.earning('B0',20000,'a',{fundsSettled:false});const firstRefundAt=f.s.bookings[0].completedAt+DAY;f.earning('B1');f.withdraw(2000);f.pay();f.query();f.refund(10000);assert.equal(f.d.amountCents,1000);
  f.submit(forms(f.page('recoveries',f.d.id,finance),'recovery-receive')[0],{amountCents:1000,...f.proof()},finance);const cashId=f.d.records[0].id;f.refund(20000,'B0',firstRefundAt);assert.equal(f.d.returnPendingCents,1000);
  const form=forms(f.page('recoveries',f.d.id,finance),'recovery-return')[0];assert.match(form.body,/max="10"/);assert.match(f.page('recoveries',f.d.id),/超收待实际退回/);assert.equal(forms(f.page('recoveries',f.d.id),'recovery-return').length,0);f.submit(form,{amountCents:1000,...f.proof()},finance);
  assert.equal(f.d.records[0].id,cashId);assert.equal(f.d.records.length,2);assert.equal(f.d.returnPendingCents,0);assert.equal(f.d.status,'closed');assert.match(f.page('recoveries',f.d.id),/实际退回本人/);assert.match(f.page('recoveries',f.d.id,finance),/data-invoice-slot="record:[^:]+:0"/);
});

test('C03 历史来源待核对时不提供旧额收款认损出口，原佣金核对链接和实际历史保留',()=>{
  const f=fixture();f.activate();f.earning();f.withdraw();f.pay();f.query();f.refund();f.submit(forms(f.page('recoveries',f.d.id,finance),'recovery-receive')[0],{amountCents:500,...f.proof()},finance);
  // Imported legacy snapshot with missing original completion time; this does
  // not simulate a successful business command or alter runtime storage.
  f.s.bookings[0].completedAt=null;f.s.now=f.d.dueAt;syncServicePromotion(f.s,f.ctx);assert.equal(f.d.status,'needs-review');const html=f.page('recoveries',f.d.id,finance);
  assert.match(html,/原佣金来源尚未核清/);assert.match(html,new RegExp(`href="#/group/service-promotion/commissions/${f.d.commissionId}"`));assert.match(html,/实际收回/);assert.equal(forms(html,'recovery-receive').length,0);assert.equal(forms(html,'recovery-return').length,0);assert.equal(forms(html,'recovery-loss').length,0);
});

test('C03 已认损后原债重算以带符号账务调整留痕，原认损额和实际收付区别展示',()=>{
  const f=fixture();f.activate();f.earning('B0',20000,'a',{fundsSettled:false});const firstRefundAt=f.s.bookings[0].completedAt+DAY;f.earning('B1');f.withdraw(2000);f.pay();f.query();f.refund(10000);f.s.now=f.d.dueAt;
  f.submit(forms(f.page('recoveries',f.d.id,finance),'recovery-loss')[0],{amountCents:1000,...f.proof()},finance);const originalId=f.d.records[0].id;f.refund(20000,'B0',firstRefundAt);assert.equal(f.d.records[0].id,originalId);assert.equal(f.d.records[0].amountCents,1000);assert.equal(f.d.records[1].kind,'loss-adjustment');
  const html=f.page('recoveries',f.d.id);assert.match(html,/按原承担方记损失/);assert.match(html,/原债务重算调整损失/);assert.match(html,/¥-10.00/);assert.match(html,/真实款项 \/ 损失账务金额/);assert.equal(f.d.receivedCents,0);assert.equal(f.d.status,'closed');assert.equal(forms(html).length,0);
});

test('C03 财务明确期限和提现配置只影响新事实，旧申请快照与原绑定截止保持',()=>{
  const f=fixture();f.activate();f.earning();const oldBalanceForm=forms(f.page('promoters',f.p.id),'withdraw-create')[0],originalExpiry=f.s.users[1].serviceBinding.expiresAt;f.withdraw(1000);const oldId=f.w.id;
  const policy=forms(f.page('rules','',finance),'policy-publish')[0];assert.equal(policy.payload.version,0);for(const name of ['bindingDays','minWithdrawCents','dailyLimit'])assert.match(policy.body,new RegExp(`name="${name}" value=""`));assert.match(policy.body,/name="minWithdrawCents"[^>]*data-unit="yuan"/);assert.match(f.page('rules','',finance),/原需求默认值/);
  f.submit(policy,{bindingDays:180,minWithdrawCents:2000,dailyLimit:2,effectiveAt:f.s.now,basis:'本轮有实际依据的期限与提现Demo配置'},finance);assert.equal(f.s.users[1].serviceBinding.expiresAt,originalExpiry);assert.match(f.page('rules','',finance),/180 天 \/ ¥20.00 \/ 2 次/);assert.throws(()=>f.submit(oldBalanceForm,{amountCents:1000},user),/余额.*变化/);
  const next=forms(f.page('promoters',f.p.id),'withdraw-create')[0];assert.match(next.body,/min="20" max="30"/);f.submit(next,{amountCents:2000},user);assert.match(f.page('withdrawals',oldId),/¥10.00 门槛 \/ 上海自然日 3 次/);assert.match(f.page('withdrawals',f.w.id),/¥20.00 门槛 \/ 上海自然日 2 次/);assert.match(f.page('withdrawals'),/最多成功创建2笔/);assert.equal(forms(f.page('promoters',f.p.id),'withdraw-create').length,0);
  const later={role:'user',userId:'u3'};f.submit(forms(f.page('binding','',later),'enter')[0],{promoterId:f.p.id},later);assert.equal(f.s.users[2].serviceBinding.expiresAt,f.s.now+180*DAY);
  assert.equal(forms(f.page('rules'),'policy-publish').length,0);assert.equal(forms(f.page('rules'),'rule-publish').length,0);assert.equal(forms(f.page('agreements'),'agreement-publish').length,0);assert.match(f.page('rules','',finance),/本轮有实际依据/);
});

test('C03 真实受控风险源仅客服看原依据，本人和财务只见本人范围进度',()=>{
  const f=fixture();f.activate();f.earning();const facts={kind:'suspicious-first',reference:'RISK-SOURCE<img>',evidenceIds:['SOURCE-DEVICE-PRIVATE','SOURCE-ADDRESS-PRIVATE'],at:f.s.now};
  // The controlled test adapter attests one exact source fixture; it does not
  // claim a live device/identity system or allow an end-user risk marking form.
  assert.throws(()=>captureServicePromotionRisk(f.s,'B1',facts,f.ctx),/真实识别源/);f.ctx.validateRiskSource=(s,b,x)=>b.id==='B1'&&JSON.stringify(x)===JSON.stringify(facts);const r=captureServicePromotionRisk(f.s,'B1',facts,f.ctx);syncServicePromotion(f.s,f.ctx);
  const html=f.page('risks',r.id,support);assert.match(html,/RISK-SOURCE&lt;img&gt;/);assert.match(html,/SOURCE-DEVICE-PRIVATE/);assert.match(html,/SOURCE-ADDRESS-PRIVATE/);assert.match(html,/待人工审核/);assert.match(html,/主款和加钟佣金继续待核对/);assert.ok(forms(html,'risk-review')[0]);
  for(const actor of [user,finance]){const min=f.page('risks',r.id,actor);assert.match(min,/B1/);assert.match(min,/待人工审核/);assert.doesNotMatch(min,/RISK-SOURCE|SOURCE-DEVICE-PRIVATE|SOURCE-ADDRESS-PRIVATE|invoice-file:/);assert.equal(forms(min).length,0);}
  assert.match(f.page('risks',r.id,customer),/不存在或超出/);assert.match(f.page('risks',r.id,manager),/无权/);assert.equal(forms(f.page('promoters',f.p.id),'withdraw-create').length,0);assert.match(f.page('commissions',f.c.id),/异常首单尚未人工审核/);
});

test('C03 客服审核和带新依据复核保存原版本及附件历史，不制造退款或原订单变更',()=>{
  const f=fixture();f.activate();f.earning();const facts={kind:'duplicate-identity',reference:'ACTUAL-RISK',evidenceIds:['SOURCE-IDENTITY-PRIVATE'],at:f.s.now};f.ctx.validateRiskSource=(s,b,x)=>b.id==='B1'&&x.reference===facts.reference;const r=captureServicePromotionRisk(f.s,'B1',facts,f.ctx);syncServicePromotion(f.s,f.ctx);const booking=structuredClone(f.s.bookings[0]),binding=structuredClone(f.s.users[1].serviceBinding),old=forms(f.page('risks',r.id,support),'risk-review')[0];assert.equal(old.payload.version,r.version);
  assert.throws(()=>f.submit(old,{decision:'approved',reference:'还未有实际文件',occurredAt:f.s.now,reason:'待核验'},support),/实际证据文件/);f.submit(old,{decision:'approved',...f.proof()},support);assert.match(f.page('risks',r.id,support),/人工审核通过/);assert.match(f.page('risks',r.id,support),/data-invoice-slot="risk-review:0"/);assert.equal(forms(f.page('promoters',f.p.id),'withdraw-create').length,1);assert.throws(()=>f.submit(old,{decision:'rejected',...f.proof()},support),/版本/);
  f.submit(forms(f.page('risks',r.id,support),'risk-review')[0],{decision:'rejected',...f.proof()},support);const html=f.page('risks',r.id,support);assert.match(html,/人工审核未通过/);assert.match(html,/data-invoice-slot="risk-history:0:0"/);assert.match(html,/按新实际依据复核原案/);assert.equal(f.c.commissionCents,0);assert.deepEqual(f.s.bookings[0],booking);assert.deepEqual(f.s.users[1].serviceBinding,binding);assert.equal(f.s.bookings[0].refunds.length,0);assert.doesNotMatch(f.page('risks',r.id,user),/invoice-file:|ACTUAL-RISK|实际文件与原来源核对/);
});

test('C03 有待核风险的原店关闭只停身份回集团，原风险与审核历史仍可只读办理',()=>{
  const f=fixture();f.activate();f.earning();const facts={kind:'suspicious-first',reference:'CLOSE-RISK',evidenceIds:['CLOSE-ORIGINAL-SOURCE'],at:f.s.now};f.ctx.validateRiskSource=()=>true;const r=captureServicePromotionRisk(f.s,'B1',facts,f.ctx);syncServicePromotion(f.s,f.ctx);const before=structuredClone(f.s.servicePromotionRisks);
  closeStoreServicePromoters(f.s,'a',f.ctx);assert.deepEqual(f.s.servicePromotionRisks,before);assert.equal(f.s.users[1].serviceBinding.ownerType,'group');assert.match(f.page('risks',r.id,user),/待人工审核/);assert.ok(forms(f.page('risks',r.id,support),'risk-review')[0]);assert.match(f.page('promoters',f.p.id),/已停用/);
});

test('C03 跨店新佣金抵原店债务时，本款成本与原债务扣回归属分别呈现',()=>{
  const f=fixture();f.activate();f.earning();f.withdraw();f.pay();f.query();f.refund();f.earning('B2',10000,'b');const html=f.page('recoveries',f.d.id);
  assert.match(html,/本款承担 \/ 原债务扣回归属/);assert.match(html,/本款门店 \/ 集团 ¥0.00 \/ ¥10.00/);assert.match(html,/原债务门店 \/ 集团 ¥5.00 \/ ¥5.00/);assert.equal(f.s.servicePromotionOffsets[0].sourceStoreCents,0);assert.equal(f.s.servicePromotionOffsets[0].storeCents,500);assert.match(f.page('recoveries',f.d.id,localFinance),/尚无后续佣金抵扣记录/);
});

test('C03 受控正式上岗源开通技师推广后，已生效身份与首次提现实名分开展示且原门控保留',()=>{
  const f=fixture(),tech={role:'tech',techId:'lin'},facts={eligible:true,techId:'lin',storeId:'a',reference:'PRIVATE-QUALIFICATION-PROOF',verifiedAt:f.s.now,grantId:'PRIVATE-QUALIFICATION-GRANT'};
  // This UI test calls the real controlled capture hook, never inserts an
  // active promoter by hand. The original shared qualification command chain
  // is covered independently by service-promotion-integration.test.mjs.
  assert.throws(()=>captureTechServicePromoter(f.s,'lin',{...facts,eligible:false},f.ctx),/正式上岗资格依据/);
  const r=captureTechServicePromoter(f.s,'lin',facts,f.ctx);assert.equal(r.origin,'qualified-tech');assert.equal(r.status,'active');assert.equal(r.identity,null);
  const view=servicePromotionView(f.s,tech);assert.equal(view.promoters[0].status,'active');assert.equal(view.promoters[0].identity,null);assert.equal(view.promoters[0].eligibility,undefined);assert.equal(view.promoters[0].origin,undefined);
  const before=structuredClone(f.s),notice='推广身份已生效，首次提现须另行完成实际实名核验。';
  for(const actor of [tech,manager,support,finance]){const html=f.page('promoters',r.id,actor);assert.match(html,/首次提现实名核验/);assert.match(html,/<span class="tag">已生效<\/span>/);assert.ok(html.includes(`<p class="notice" role="status">${notice}</p>`));assert.doesNotMatch(html,/PRIVATE-QUALIFICATION/);assert.equal(forms(html,'withdraw-create').length,0);}
  assert.deepEqual(f.s,before);assert.ok(forms(f.page('promoters',r.id,support),'identity-review')[0]);assert.ok(forms(f.page('promoters',r.id,tech),'transfer-authorize')[0]);
  assert.throws(()=>f.write('service-promotion.withdraw-create',{promoterId:r.id,version:r.version,amountCents:1000},tech),/首次提现须实际实名核验/);
  const pending=fixture();pending.invite();pending.accept();assert.ok(!pending.page('promoters',pending.p.id).includes(notice));
  const verified=fixture();verified.activate();assert.ok(!verified.page('promoters',verified.p.id).includes(notice));assert.match(verified.page('promoters',verified.p.id),/首次提现实名核验[\s\S]*实际依据已核验/);
});

test('C03 原笔未知查询后按原渠道进入本人确认，同笔截止和次数保留、本人接受后才给实际成功查询',()=>{
  const f=fixture();f.activate();f.submit(forms(f.page('promoters',f.p.id),'transfer-authorize')[0],{enabled:'false',reason:'本人明确逐笔确认收款'},user);f.earning();f.withdraw();f.pay('processing');
  const original={id:f.w.execution.id,requestNo:f.w.execution.requestNo,attempts:f.w.execution.attempts},query=forms(f.page('withdrawals',f.w.id,finance),'withdraw-query')[0],deadline=f.s.now+DAY;
  assert.match(query.body,/value="awaiting_user">原渠道要求本人确认收款/);assert.doesNotMatch(query.body,/value="success"/);assert.match(query.body,/name="confirmExpiresAt" value="" type="datetime-local"/);assert.doesNotMatch(query.body,/name="confirmExpiresAt"[^>]*required/);assert.equal(forms(f.page('withdrawals',f.w.id,manager),'withdraw-query').length,0);assert.equal(forms(f.page('withdrawals',f.w.id),'withdraw-query').length,0);
  f.submit(query,{outcome:'awaiting_user',confirmExpiresAt:deadline,reason:'原渠道查询明确要求本人确认'},finance);assert.equal(f.w.status,'awaiting_user');assert.equal(f.w.confirmExpiresAt,deadline);assert.deepEqual({id:f.w.execution.id,requestNo:f.w.execution.requestNo,attempts:f.w.execution.attempts},original);assert.equal(f.s.servicePromotionWithdrawals.length,1);assert.equal(servicePromotionView(f.s,user).balances[0].dailyCreated,1);
  const waitingQuery=forms(f.page('withdrawals',f.w.id,finance),'withdraw-query')[0];assert.doesNotMatch(waitingQuery.body,/value="awaiting_user"|name="confirmExpiresAt"|value="success"/);assert.throws(()=>f.submit(waitingQuery,{outcome:'awaiting_user',confirmExpiresAt:deadline+DAY,reason:'不能借新查询延长原截止'},finance),/不能|只允许|原|确认|无效/);assert.equal(f.w.confirmExpiresAt,deadline);assert.throws(()=>f.submit(waitingQuery,{outcome:'success',...f.proof()},finance),/本人确认/);
  const personal=forms(f.page('withdrawals',f.w.id),'withdraw-confirm')[0];assert.ok(personal);assert.equal(forms(f.page('withdrawals',f.w.id,customer),'withdraw-confirm').length,0);f.submit(personal,{decision:'accept',reason:'本人明确确认该原笔收款'},user);
  const finalQuery=forms(f.page('withdrawals',f.w.id,finance),'withdraw-query')[0];assert.match(finalQuery.body,/value="success"/);assert.doesNotMatch(finalQuery.body,/value="awaiting_user"|name="confirmExpiresAt"/);f.submit(finalQuery,{outcome:'success',...f.proof()},finance);assert.equal(f.w.status,'paid');assert.equal(f.w.confirmExpiresAt,deadline);assert.deepEqual({id:f.w.execution.id,requestNo:f.w.execution.requestNo,attempts:f.w.execution.attempts},original);assert.equal(f.s.servicePromotionWithdrawals.length,1);assert.equal(servicePromotionView(f.s,user).balances[0].dailyCreated,1);
  const exempt=fixture();exempt.activate();exempt.earning();exempt.withdraw();exempt.pay('processing');const exemptQuery=forms(exempt.page('withdrawals',exempt.w.id,finance),'withdraw-query')[0];assert.match(exemptQuery.body,/value="success"/);assert.doesNotMatch(exemptQuery.body,/value="awaiting_user"|name="confirmExpiresAt"/);
});

test('C03 客服入口明确首单认定与风险来源，不绘制无权限的个人资金表格或操作',()=>{
  const f=fixture();f.activate();f.earning();const before=structuredClone(f.s),view=servicePromotionView(f.s,support);assert.equal(view.commissions.length,0);assert.ok(view.firsts.length);
  const html=f.page('commissions','',support);assert.match(html,/<h1>首单认定记录<\/h1>/);assert.match(html,/>首单认定记录<\/a>/);assert.match(html,/B1/);assert.match(html,/查看原异常佣金审核/);assert.doesNotMatch(html,/佣金明细|首单与复购逐款明细|查看原佣金来源|可用 \/ 占款 \/ 已付|¥40\.00/);assert.equal(forms(html).length,0);assert.match(f.page('commissions',f.c.id,support),/当前客服只可查看原首单认定记录/);assert.match(f.page('commissions','',finance),/<h1>佣金明细<\/h1>/);assert.match(f.page('commissions','',finance),/首单与复购逐款明细/);assert.deepEqual(f.s,before);
  const facts={kind:'suspicious-first',reference:'ACTUAL-FIRST-SOURCE',evidenceIds:['ACTUAL-FIRST-EVIDENCE'],at:f.s.now};f.ctx.validateRiskSource=(s,b,x)=>b.id==='B1'&&x.reference===facts.reference;const risk=captureServicePromotionRisk(f.s,'B1',facts,f.ctx);const riskHtml=f.page('risks',risk.id,support);assert.match(riskHtml,/核对原首单认定记录/);assert.doesNotMatch(riskHtml,/查看原佣金逐款明细/);assert.match(riskHtml,/href="#\/group\/service-promotion\/commissions"/);assert.ok(forms(riskHtml,'risk-review')[0]);assert.match(f.page('risks',risk.id,finance),/查看原佣金逐款明细/);
});

test('C03 成功原结果逐行展示实际凭据，旧成功行只指向已有原附件、缺依据继续待核对',()=>{
  const f=fixture();f.activate();f.earning();f.withdraw();f.pay('processing');const query=forms(f.page('withdrawals',f.w.id,finance),'withdraw-query')[0],proof={...f.proof(),reference:'SUCCESS-ACTUAL<img>'};f.submit(query,{outcome:'success',...proof},finance);
  const index=f.w.execution.results.length-1,result=f.w.execution.results[index];assert.equal(result.outcome,'success');assert.equal(result.facts.reference,proof.reference);assert.equal(result.facts.occurredAt,proof.occurredAt);assert.deepEqual(result.facts.evidenceRefs,[file]);
  const html=f.page('withdrawals',f.w.id,finance);assert.match(html,/原笔查询 · 实际转账成功/);assert.doesNotMatch(html,/原笔查询 · success/);assert.match(html,/SUCCESS-ACTUAL&lt;img&gt;/);assert.ok(html.includes(ui.date(proof.occurredAt)));assert.match(html,new RegExp(`data-invoice-slot="result:${index}:0"`));assert.match(html,/data-invoice-slot="payment:0"/);
  for(const actor of [user,localFinance])assert.doesNotMatch(f.page('withdrawals',f.w.id,actor),/SUCCESS-ACTUAL|data-invoice-slot="result:|data-invoice-slot="payment:|原成功凭据见下方附件/);
  // Read-only compatibility snapshots remove only historical evidence fields;
  // the success was produced above by the original command, never by this UI.
  delete f.w.execution.results[index].facts;const old=structuredClone(f.s),legacy=f.page('withdrawals',f.w.id,finance);assert.match(legacy,/原成功凭据见下方附件/);assert.match(legacy,/data-invoice-slot="payment:0"/);assert.doesNotMatch(legacy,new RegExp(`data-invoice-slot="result:${index}:`));assert.equal(f.w.execution.results[index].facts,undefined);assert.deepEqual(f.s,old);
  delete f.w.execution.proof;const missing=structuredClone(f.s),unverified=f.page('withdrawals',f.w.id,finance);assert.match(unverified,/此行凭据待核对/);assert.doesNotMatch(unverified,/原成功凭据见下方附件|data-invoice-slot="payment:0"/);assert.equal(f.w.status,'paid');assert.deepEqual(f.s,missing);
});
