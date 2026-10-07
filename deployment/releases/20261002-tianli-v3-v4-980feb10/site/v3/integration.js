'use strict';
(() => {
  const R=window.PrototypeRuntime, A=R.actions;
  const get=()=>R.getState(), v=R.value;
  const checked=name=>!!document.querySelector(`[name="${name}"]`)?.checked;
  const selected=name=>document.querySelector(`[name="${name}"]:checked`)?.value;
  const phoneOK=phone=>/^1\d{10}$/.test(phone);
  const save=(event,target)=>{R.store(event);if(target)R.go(target);};
  const clockToday='2026-10-02';
  const checkFiles=()=>{
    const files=[...document.querySelectorAll('input[type=file]')];
    if(files.some(input=>input.multiple&&input.files.length>6)){R.toast('图片最多上传6张');return false;}
    return true;
  };
  const formOK=()=>R.validForm()&&checkFiles();
  const add=(name,fn)=>{A[name]=fn;};
  add('select-technician',()=>{const selection=selected('technician')||'nearest';const tech=({nearest:'林师傅',lin:'林师傅',chen:'陈师傅',zhou:'周师傅'})[selection];if(get().paid){get().proposedTech=tech;save('选择拟改技师','u-reschedule');return;}get().assignment=selection==='nearest'?'nearby':'specified';get().tech=tech;save('选择技师','u-slot');});
  add('save-address',()=>{
    if(!formOK())return;if(!phoneOK(v('addressPhone'))){R.toast('请填写11位手机号');return;}
    const address=v('addressBuilding')+' '+v('addressRoom');
    get().draftAddress=address;
    if(!/幸福里|银杏|雅园|阳光/.test(address)){R.go('u-out-of-range');return;}
    get().address=address;get().addressContact=v('addressContact');save('保存地址并校验范围','u-addresses');
  });
  add('select-address',()=>{if(selected('selectedAddress')==='office'){A['select-office-address']();return;}get().address=get().draftAddress||'幸福里小区 2号楼 8层 802室';save('使用上门地址',get().paid?'u-reschedule-address':'u-recipient');});
  add('select-office-address',()=>{get().address='银杏商务楼 6层 602室';save('演示地址在服务范围内',get().paid?'u-reschedule-address':'u-recipient');});
  add('save-recipient',()=>{
    if(!formOK())return;if(!phoneOK(v('recipientPhone'))){R.toast('请填写服务对象11位手机号');return;}
    if(!checked('recipientAdult')||!checked('recipientHealth')){R.go('u-health-ineligible');return;}
    get().recipient={name:v('recipientName'),phone:v('recipientPhone')};get().adult=true;get().eligible=true;
    if(!get().realname){get().identityReturn='u-recipient';R.go('u-realname-form');return;}
    save('保存服务对象',get().healthSeen?'u-confirm':'u-health');
  });
  add('submit-realname',()=>{
    if(!formOK())return;
    if(!checked('identityConsent')){R.toast('请单独同意身份信息处理');return;}
    if(!/^\d{17}[\dXx]$/.test(v('identityNumber'))){R.toast('请填写18位身份证号');return;}
    if(!phoneOK(v('legalPhone'))){R.toast('请填写11位手机号');return;}
    get().realname=true;get().consent=true;get().legalName=v('legalName');
    const next=get().identityReturn||'u-recipient';delete get().identityReturn;save('实名核验演示通过',next);
  });
  add('privacy-withdraw',()=>{get().consent=false;get().realname=false;get().health=false;save('撤回实名处理同意','u-privacy-withdrawn');});
  add('delete-account',()=>{
    const s=get();const active=['waiting','dispatching','accepted','reassign','reschedule','departed','late','arrived','serving','service'].includes(s.stage);
    if(active||['pending','confirm','hq'].includes(s.aftersale)||['sent','escalated','handling','unanswered'].includes(s.sos)){R.toast('请先完成订单、售后及安全事件处理');return;}
    if(s.balance>0||s.withdrawal==='processing'||s.withdrawal==='confirm'){R.toast('请先处理可提现余额或未完成的提现');return;}
    if(!checked('deleteConsent')&&!checked('deleteConfirm')){R.toast('请确认注销影响');return;}
    s.account='deleted';s.consent=false;s.realname=false;s.promoter=false;s.drafts={};save('注销演示账号','u-deleted');
  });
  add('save-emergency-contact',()=>{if(!formOK())return;if(!phoneOK(v('emergencyPhone'))){R.toast('请填写11位手机号');return;}get().emergency={name:v('emergencyName'),relation:v('emergencyRelation'),phone:v('emergencyPhone')};save('保存紧急联系人','u-safety');});
  ['call-emergency','call-store-customer-service','call-group-customer-service','customer-service-message'].forEach(name=>add(name,()=>R.modal('联系客服','原型演示：真实小程序会打开微信客服或电话拨号确认。')));
  add('promo-join-submit',()=>{if(!checked('promoAgreement')){R.toast('请阅读并签署推广协议');return;}if(!get().realname){get().identityReturn='u-promo-join';R.go('u-realname-form');return;}get().promoter=true;get().promoSignedAt=new Date().toISOString();save('签署推广协议并开通身份','u-promo');});
  add('promo-invitation-decline',()=>{get().promoter=false;save('拒绝推广邀请','u-promo-declined');});
  ['promo-share','promo-save-poster'].forEach(name=>add(name,()=>R.modal(name==='promo-share'?'分享小程序卡片':'保存推广海报','原型演示：分享参数关联当前推广身份，实际微信分享和保存图片在小程序实现。')));
  add('invoice-submit',()=>{
    if(get().finishedAt&&R.now()-get().finishedAt>90*86400000){R.toast('发票申请期限已结束');return;}
    if(['pending','issued','red','redone'].includes(get().invoice)){R.toast('该订单已有发票申请，请查看当前状态');R.go(({pending:'u-invoice-pending',issued:'u-invoice-issued',red:'u-invoice-red',redone:'u-invoice-redone'})[get().invoice]);return;}
    if(!formOK())return;if(v('invoiceType')==='company'&&!/^[A-Za-z\d]{15,20}$/.test(v('invoiceTax'))){R.toast('企业开票请填写15至20位税号');return;}
    get().invoiceDetails={type:v('invoiceType'),title:v('invoiceTitle'),tax:v('invoiceTax'),email:v('invoiceEmail')};get().invoice='pending';save('提交发票申请','u-invoice-pending');
  });
  add('invoice-email',()=>R.toast('电子发票已重新发送（演示）'));
  add('invoice-download',()=>R.modal('电子发票','原型示例：开票金额 ¥'+(R.paidTotal()-R.refundTotal()).toFixed(2)+'；真实发票由服务门店上传后查看或下载。'));
  add('withdraw-authorize',()=>{get().transferAuthorized=true;save('免确认收款授权');R.toast('已开通免确认收款（演示）');});
  A['authorize-transfer']=A['withdraw-authorize'];
  add('withdraw-submit',()=>{
    const s=get();if(['processing','confirm'].includes(s.withdrawal)){R.go(s.withdrawal==='confirm'?'u-withdraw-confirm':'u-withdraw-processing');return;}
    if(!s.realname){s.identityReturn='u-withdraw';R.go('u-realname-form');return;}
    if(s.balance<10){R.toast('最低提现金额为10元，当前可提现余额不足');return;}
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(R.now()));if(s.withdrawalDay!==today){s.withdrawalDay=today;s.withdrawalCount=0;}if(s.withdrawalCount>=3){R.toast('今天已提现3次，请明天再试');return;}s.withdrawalCount++;
    s.withdrawalAmount=s.balance;s.balance=0;s.withdrawal=s.transferAuthorized?'processing':'confirm';s.withdrawalRestored=false;
    save('提交提现锁定余额',s.transferAuthorized?'u-withdraw-processing':'u-withdraw-confirm');
  });
  function withdrawalResult(result){
    const s=get();if(!['processing','confirm'].includes(s.withdrawal)){R.go(({success:'u-withdraw-success',failed:'u-withdraw-failed',revoked:'u-withdraw-revoked'})[s.withdrawal]||'u-promo');return;}
    s.withdrawal=result;if((result==='failed'||result==='revoked')&&!s.withdrawalRestored){s.balance=Math.round((s.balance+s.withdrawalAmount)*100)/100;s.withdrawalRestored=true;}
    save('提现最终结果 '+result,({success:'u-withdraw-success',failed:'u-withdraw-failed',revoked:'u-withdraw-revoked'})[result]);
  }
  add('withdraw-query',()=>{if(get().withdrawal==='confirm'){R.go('u-withdraw-confirm');return;}withdrawalResult(get().withdrawalOutcome||get().withdrawOutcome||'success');});
  add('withdraw-confirm-receipt',()=>{if(get().withdrawal!=='confirm'){R.toast('该提现无需重复确认');return;}get().withdrawal='processing';save('用户确认收款，等待到账结果','u-withdraw-processing');});
  add('reschedule-address-check',()=>{
    if(!formOK())return;const address=v('rescheduleCommunity')+' '+v('rescheduleDetail');get().proposedAddress=address;
    if(!/幸福里|银杏|雅园|阳光/.test(address)){R.go('u-reschedule-address-outside');return;}get().addressInRange=true;R.toast('校验通过：仍在原门店服务范围内');
  });
  add('reschedule-address-submit',()=>{
    if(!formOK())return;A['reschedule-address-check']();if(R.getScreen()==='u-reschedule-address-outside')return;
    if(get().changes<=0||!['accepted','waiting','dispatching'].includes(get().stage)){R.go('u-reschedule-limit');return;}
    get().address=get().proposedAddress;get().changes--;get().stage='waiting';R.startDispatchRound('用户确认改地址');if(!R.dispatchAvailable())return;save('改地址重新校验并派单','u-o-waiting');
  });
  add('aftersale-accept-rejection',()=>{get().aftersale='rejected-accepted';get().finance='pending-settlement';delete get().deadlines.aftersaleConfirm;save('用户接受门店驳回','u-aftersale-accepted-rejection');});
  add('extend-retry',()=>A['request-extend']());
  add('contact-customer-service',()=>R.go('u-customer-service'));add('contact-group-admin',()=>R.toast('原型演示：联系集团管理员确认本店权限。'));
  add('contact-support',()=>R.go('u-customer-service'));add('contact-store',()=>R.modal('联系门店','原型演示：打开门店联系通道。'));
  add('contact-customer',()=>A['call-customer']());add('dial-110',()=>A['sos-call-110']());add('store-sos-ack',()=>A['sos-ack']());
  add('store-refund-retry',()=>{get().finance='refund-processing';save('余额已补足，重新执行退款');R.toast('演示余额已补足，退款已重新提交渠道，尚未确认成功。');});
  add('coverage-area',()=>R.modal('已开通区域','演示门店覆盖幸福里、银杏商务楼、雅园、阳光花园。其他地址可先保存，再查看服务范围校验结果。'));
  add('restriction-rules',()=>R.modal('账号限制规则','爽约和违规行为经核实后按平台规则处理。账号页面显示原因类别与到期日，可通过客服申诉一次。'));
  add('store-account',()=>R.modal('当前门店账号','张店长 · 天俪示例门店。当前账号只展示本店订单、告警和排班。'));
  add('user-material-submit',()=>{if(!formOK())return;get().userMaterial=v('userMaterial');save('提交用户补充材料',get().stage==='service'?'u-o-service':'u-order-current');});
  add('approve-leave',()=>{const s=get();if(s.leave==='approved'){R.go('s-leave-approved');return;}s.leave='approved';s.leaveAffectedOrder=s.stage==='accepted'&&R.leaveOverlapsOrder(s.tech);if(s.leaveAffectedOrder){s.stage='dispatching';R.startDispatchRound('已接未出发订单批准请假');delete s.deadlines.accept;if(!R.dispatchAvailable())return;}save(s.leaveAffectedOrder?'批准请假，已接未出发订单移入派单池':'批准请假，当前订单不受影响','s-leave-approved');});
  add('reject-leave',()=>R.go('s-leave-reject'));
  function staffSubmit(name){
    const s=get(),cfg=window.STAFF_ACTIONS[name];if(!cfg)return;
    if(name==='store-noshow-reject'){if(!v('noshowStoreReason')){R.toast('请填写核实说明');return;}}
    else if(!formOK())return;
    if(name==='staff-identity-submit'){
      if(!/^\d{17}[\dXx]$/.test(v('identityNo'))){R.toast('请填写18位身份证号');return;}
      s.staffIdentity=true;
    }
    if(name==='staff-onboarding-submit'){
      if(!s.staffIdentity){R.toast('请先完成实名与人脸核身');return;}
      if(v('insuranceStart')>v('insuranceEnd')||v('insuranceEnd')<clockToday){R.toast('保单生效和到期日期无效');return;}
      s.staffOnboarding='reviewing';
    }
    if(name==='staff-roster-save'){
      const start=v('rosterStart'),end=v('rosterEnd'),a=v('breakStart'),b=v('breakEnd');
      if(start>=end||start>'13:30'||end<'18:30'){R.toast('排班必须覆盖已有订单及前后路程');return;}
      if((a&&!b)||(!a&&b)||(a&&b&&(a>=b||(a<'15:30'&&b>'13:30')||(a<'18:30'&&b>'16:30')))){R.toast('休息时段不能覆盖已接订单');return;}
      s.roster={date:v('rosterDate'),start,end,breakStart:a,breakEnd:b};
    }
    if(name==='staff-leave-submit'){
      if(v('leaveDate')+'T'+v('leaveStart')>=v('leaveEndDate')+'T'+v('leaveEnd')){R.toast('请假结束必须晚于开始');return;}
      if(v('leaveType')==='urgent'&&v('leaveDate')!==clockToday){R.toast('紧急请假仅支持演示当天10月2日');return;}
      s.leave='pending';s.leaveDetails={tech:s.tech,date:v('leaveDate'),endDate:v('leaveEndDate'),start:v('leaveStart'),end:v('leaveEnd'),type:v('leaveType'),reason:v('leaveReason')};
    }
    if(name==='staff-noshow-submit'||name==='store-noshow-approve'){
      if(s.deadlines.noshow&&s.deadlines.noshow>R.now()){R.toast('到达未满15分钟，不能判定爽约');return;}
      s.noshow=name==='staff-noshow-submit'?'pending':'approved';
      if(name==='store-noshow-approve'){s.stage='cancelled';s.refundAmount=R.cancellationAmounts().refund;s.refundReason='店长核实用户爽约，扣费20%';s.finance='refund-processing';}
    }
    if(name==='store-noshow-reject'){s.noshow='rejected';s.stage='arrived';}
    if(name==='staff-review-appeal-submit'||name==='staff-penalty-appeal-submit'){
      const kind=name.includes('review')?'review':'penalty';s.appeals=s.appeals||{};
      if(s.appeals[kind]){R.toast('这条记录已申诉，不能重复提交');return;}s.appeals[kind]='pending';
    }
    if(name==='store-reassign-designated'||name==='store-reassign-nearby'){
      if(!['accepted','waiting','dispatching'].includes(s.stage)){R.toast('订单已出发或状态已变化，不能改派');return;}
      const from=s.stage;if(from!=='accepted'&&!R.dispatchAvailable())return;
      const nextTech=selected('nextTech')==='zhou'?'周师傅':'陈师傅';if(!R.techAvailable(nextTech)){R.toast('该技师已请假，请选择可用技师');return;}
      s.previousTech=s.tech;s.tech=nextTech;s.assignment=name.includes('designated')?'specified':'nearby';
      if(s.assignment==='specified'){s.reassignFrom=from;s.stage='reassign';delete s.deadlines.accept;R.setDeadline('reassign',15);if(from!=='accepted')s.deadlines.reassign=Math.min(s.deadlines.reassign,s.dispatchRoundExpiresAt);}
      else R.completeDispatch();
    }
    if(name==='store-reschedule-submit'){
      const d=v('storeRescheduleDate');if(d<'2026-10-02'||d>'2026-10-08'){R.toast('新时间必须在可约范围内');return;}
      s.proposedDate=d.replace(/^2026-0?(\d+)-0?(\d+)$/,'$1月$2日');s.proposedSlot=v('storeRescheduleSlot');s.proposedTech=v('storeRescheduleTech')==='chen'?'陈师傅':'林师傅';s.stage='reschedule';R.setDeadline('storeReschedule',15);
    }
    if(name==='store-aftersale-reject'){s.aftersale='reject-confirm';s.rejectionReason=v('aftersaleRejectReason');R.setDeadline('aftersaleConfirm',2880);}
    if(name==='store-leave-reject'){s.leave='rejected';s.leaveRejection=v('leaveRejectReason');}
    save(name,cfg.target);
  }
  Object.keys(window.STAFF_ACTIONS).forEach(name=>add(name,()=>staffSubmit(name)));
  ['tech-sort-distance','tech-sort-rating', 'commission-filter-all','commission-filter-pending','commission-filter-available','commission-filter-paid','commission-filter-clawback'].forEach(name=>add(name,button=>{
    button.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===button));
    if(name.startsWith('commission-filter')){
      const label=({pending:'待结算',available:'可提现',paid:'已提现',clawback:'待扣回'})[name.split('-').pop()];
      document.querySelectorAll('.u-status-filters').forEach(filters=>filters.closest('.card')?.nextElementSibling?.querySelectorAll('.list-row').forEach(row=>row.hidden=!!label&&!row.innerText.includes(label)));
    }else{const card=button.closest('.card');const rows=[...card.querySelectorAll('.u-option')];if(name.endsWith('rating'))rows.reverse();rows.forEach(row=>card.insertBefore(row,card.querySelector('.actions')));}
  }));
  const originalHydrate=R.hydrate;
  R.hydrate=(app,screen)=>{
    originalHydrate(app,screen);
    const s=get();
    if(screen==='u-aftersale-apply'&&R.isLive()){
      const balances=R.refundableBalances(),amount=app.querySelector('[name="refundAmount"]');amount.max=balances[0];
      app.querySelector('[data-refund-main-cap]').textContent='主订单尚可退 ¥'+balances[0].toFixed(2);
      app.querySelector('[data-extension-refunds]').innerHTML=R.extensionPayments().map((paid,i)=>`<label class="check-row"><input type="checkbox" name="refundExtension${i+1}">加钟子订单 ${i+1} · 尚可退 ¥${balances[i+1].toFixed(2)}</label><label class="field"><span>退款金额</span><input class="runtime-input" name="extensionRefund${i+1}" type="number" min="0" max="${balances[i+1]}" step="0.01" value="0.00" disabled></label>`).join('')+(s.extension?'<p class="small muted">主订单和加钟款分别原路退款、分别调整分成。</p>':'');
    }
    if(screen==='u-my')app.querySelector('.detail')?.insertAdjacentHTML('beforeend',`<div class="card">${B('切换技师身份','secondary full','data-go="t-work"')}</div>`);
    if(screen==='t-profile')app.querySelector('.detail')?.insertAdjacentHTML('beforeend',`<div class="card"><div class="actions">${B('推广中心','secondary','data-go="u-promo"')}${B('切换用户身份','secondary','data-go="u-my"')}</div></div>`);
    if(screen==='u-promo')app.querySelector('.detail')?.insertAdjacentHTML('beforeend',`<div class="card"><div class="actions">${B('查看佣金状态','secondary','data-go="u-commission"')}${B('查看推广协议','secondary','data-go="u-promo-agreement"')}</div></div>`);
    app.querySelectorAll('input,textarea,select').forEach(input=>{
      const saved=s.drafts?.[screen]?.[input.name];if(saved!==undefined && input.type!=='file'){if(input.type==='checkbox')input.checked=!!saved;else if(input.type==='radio')input.checked=input.value===saved;else input.value=saved;}
    });
    if(!R.isLive())return;
    if(s.leave==='approved'&&s.leaveDetails?.tech){
      const candidates=[...app.querySelectorAll('[name="nextTech"],.sheet .choice')];
      for(const node of candidates){const tech=node.matches('input')?({chen:'陈师傅',zhou:'周师傅'})[node.value]:node.textContent.includes('陈师傅')?'陈师傅':node.textContent.includes('周师傅')?'周师傅':'';if(tech&& !R.techAvailable(tech)){node.disabled=true;node.checked=false;node.classList.remove('selected');const host=node.closest('label')||node;host.querySelector('.badge')?.replaceChildren(document.createTextNode('已请假'));host.querySelector('small')?.replaceChildren(document.createTextNode('请假已批准，本时段不可派单'));}}
      const radio=app.querySelector('[name="nextTech"]:checked');if(!radio){const available=app.querySelector('[name="nextTech"]:not(:disabled)');if(available)available.checked=true;}
      if(screen==='s-pick'&&!app.querySelector('.sheet .choice.selected')){const available=app.querySelector('.sheet .choice:not(:disabled)');if(available){available.classList.add('selected');available.querySelector('.radio')?.classList.add('on');}}
    }
    app.querySelectorAll('.kv').forEach(row=>{
      const key=row.firstElementChild?.textContent.trim();const value=row.lastElementChild;
      if(!value)return;
      if(key==='预约时间'||key==='上门时间')value.textContent=s.date+' '+s.slot+' · '+s.duration+'分钟';
      if(key==='上门地址')value.textContent=s.address;
      if(key==='服务对象')value.textContent=s.recipient.name+' '+s.recipient.phone.replace(/(\d{3})\d{4}(\d{4})/,'$1****$2');
      if(key==='实付金额'||key==='原支付金额')value.textContent='¥'+s.price.toFixed(2);
      if(key==='退款后实际支付'||key==='实际支付')value.textContent='¥'+(R.paidTotal()-R.refundTotal()).toFixed(2);
      if(key==='本次退款')value.textContent='¥'+s.refundAmount.toFixed(2);
      if(key==='开票金额')value.textContent='¥'+(R.paidTotal()-R.refundTotal()).toFixed(2);
      if(key==='提现金额')value.textContent='¥'+(s.withdrawalAmount||s.balance).toFixed(2);
      if(key==='实名核验'&&s.staffIdentity)value.textContent='已通过';
      if(key==='订单编号')value.textContent=s.orderNo;
      if(key==='中止原因')value.textContent=s.terminationReason||'安全求助，等待核实';
      if(key==='用户诉求'||key==='你的诉求')value.textContent=s.requestedRefund?'退款 ¥'+s.requestedRefund.toFixed(2):'仅反馈问题';
      if(key==='门店方案')value.textContent='退款 ¥'+s.offeredRefund.toFixed(2);
      if(s.invoiceDetails){if(key==='抬头')value.textContent=s.invoiceDetails.title;if(key==='税号')value.textContent=s.invoiceDetails.tax||'个人抬头无需税号';if(key==='接收邮箱')value.textContent=s.invoiceDetails.email;}
    });
    if(screen==='u-recipient'){
      const saved=s.drafts?.[screen]||{};
      for(const [name,fallback]of [['recipientName',s.recipient.name],['recipientPhone',s.recipient.phone],['recipientAdult',s.adult],['recipientHealth',s.eligible]]){const input=app.querySelector(`[name="${name}"]`);if(saved[name]===undefined){if(input.type==='checkbox')input.checked=fallback;else input.value=fallback;}}
    }
    if(screen==='u-health-unchecked'){
      const checkbox=app.querySelector('[name="healthConfirmed"]');if(checkbox)checkbox.checked=s.health;
      const pay=app.querySelector('[data-action="pay"]');if(pay)pay.disabled=!s.health;
    }
    if(screen==='u-slot')app.querySelectorAll('.slot').forEach(button=>{const slot=button.childNodes[0].textContent.trim(),price=s.service==='neck'?(slot>='21:00'?228:198):(slot>='21:00'?328:298);const small=button.querySelector('small');if(small&&/¥/.test(small.textContent))small.textContent='¥'+price;});
    if(screen==='u-my'&&!s.realname)app.querySelector('.badge')?.replaceChildren(document.createTextNode('未实名'));
    if(screen==='u-o-departed')app.querySelectorAll('.sheet .kv').forEach(row=>{const key=row.firstElementChild?.textContent;if(key==='扣除费用')row.lastElementChild.textContent='−¥'+(s.price*.2).toFixed(2);if(key==='退款金额')row.lastElementChild.textContent='¥'+(s.price*.8).toFixed(2);});
    if(/^[ts]-noshow-(confirm|wait|result)$/.test(screen)){const amounts=R.cancellationAmounts();app.querySelectorAll('.kv').forEach(row=>{const key=row.firstElementChild.textContent;if(['扣费','用户扣费'].includes(key))row.lastElementChild.textContent='¥'+amounts.fee.toFixed(2);if(['退款','原路退款'].includes(key))row.lastElementChild.textContent='¥'+amounts.refund.toFixed(2)+(key==='退款'?' · 处理中':'');if(key==='技师补偿')row.lastElementChild.textContent='¥'+amounts.compensation.toFixed(2)+' · 待结算';});app.querySelectorAll('.staff-note').forEach(el=>el.textContent=el.textContent.replace(/扣费\s*¥\d+(?:\.\d+)?/g,'扣费 ¥'+amounts.fee.toFixed(2)).replace(/退款\s*¥\d+(?:\.\d+)?/g,'退款 ¥'+amounts.refund.toFixed(2)));}
    if(screen==='s-leave-approved'&&s.leaveAffectedOrder!==undefined){const p=app.querySelector('.status-hero>p');if(p)p.textContent=s.leaveAffectedOrder?'请假已批准，本单尚未出发，已移入待派单池。':'请假已批准；本单不属于该技师已接未出发的订单，履约状态保持。';app.querySelectorAll('.kv').forEach(row=>{if(row.firstElementChild.textContent==='受影响订单')row.lastElementChild.textContent=s.leaveAffectedOrder?'0132 · '+s.date+' '+s.slot:'本单不受影响';});}
    if(['s-reassign-designated','s-reassign-nearby','s-reassign-wait','s-reassign-result'].includes(screen)){
      app.querySelectorAll('.kv').forEach(row=>{const key=row.firstElementChild.textContent;if(key==='原技师')row.lastElementChild.textContent=s.previousTech||s.tech;if(key==='待确认技师'||key==='技师')row.lastElementChild.textContent=s.tech;});
      if(screen==='s-reassign-result')app.querySelector('.status-hero>p').textContent='门店已确认'+s.tech+'履约，订单进入已接单，已通知用户与技师。';
    }
    if(screen==='s-sos-closed'||screen==='u-sos-closed'){const p=app.querySelector('.status-hero>p');if(p)p.textContent=s.sosUnresolved?'安全事件已结案；订单争议仍待核实，保留当前履约和退款结果。':'安全事件已结案；无其他争议，按当前履约状态继续处理。';app.querySelector('.runtime-result,.textarea')?.replaceChildren(document.createTextNode(s.sosResult||'已完成联系与处理。'));app.querySelectorAll('.kv').forEach(row=>{if(row.firstElementChild.textContent==='关联订单')row.lastElementChild.textContent='尾号 0132 · '+(({departed:'已出发',arrived:'已到达',serving:'服务中',service:'客服介入',completed:s.sosUnresolved?'已完成 · 争议待核实':'已完成',settled:'已完成',cancelled:'已取消',refunded:'已退款'})[s.stage]||'处理中');});}
    if(screen==='u-aftersale-result'&&s.aftersaleNoRefund){
      app.querySelector('.status-hero h2').textContent='售后已完成';
      app.querySelector('.status-hero>p').textContent='本次售后按确认结果完成，未产生退款交易。';
      const card=app.querySelector('.detail>.card');
      card.querySelector('.card-title').textContent='处理结果';
      card.querySelector('.textarea').textContent='反馈与处理记录已保留。';
      card.querySelector('.small.muted')?.remove();
      const timeline=app.querySelector('.timeline2');
      if(timeline)timeline.textContent='售后已完成，本次退款 ¥0.00。';
      const order=app.querySelector('.action-footer [data-go]');
      if(order)order.dataset.go='u-order-current';
    }
    if(s.service==='neck'&&!['u-home','u-out-of-range'].includes(screen))app.querySelectorAll('.service-art').forEach(el=>{el.classList.add('sage');el.innerHTML=I('activity')+'<span>肩颈舒缓</span>';});
    if(screen==='u-o-reassign'){
      app.querySelector('.side.old .name').textContent=s.previousTech||'林师傅';app.querySelector('.side.new .name').textContent=s.tech;
    }
    if(['u-sos','t-sos'].includes(screen)){
      const label=({departed:'技师已出发',late:'技师超时未到',arrived:'技师已到达',serving:'服务中',service:'客服核实中',completed:'服务已完成'})[s.stage]||'当前订单';
      if(screen==='u-sos'){app.querySelector('.status-hero h2').textContent=label;app.querySelector('.status-hero>p').textContent='关联订单0132，求助将通知本单服务门店和集团值班人员。';}
    }
    if(screen==='u-o-done'&&s.finishedAt&&R.now()-s.finishedAt>2*3600000)app.querySelector('.action-footer [data-go="u-sos"]')?.remove();
    if(screen==='u-o-settled'&&s.finishedAt&&R.now()-s.finishedAt>7*86400000)app.querySelector('.action-footer [data-go="u-review"]')?.remove();
    if(['u-refund-processing','u-refund-received','u-o-refunded','u-o-cancelled'].includes(screen)){
      const p=app.querySelector('.status-hero>p');if(p&&/¥\d/.test(p.textContent))p.textContent=p.textContent.replace(/¥\d+(?:\.\d+)?/g,'¥'+s.refundAmount.toFixed(2));
      if(p&&screen==='u-refund-processing')p.textContent='本次退款 ¥'+s.refundAmount.toFixed(2)+' 已提交，正在等待支付渠道结果；尚未确认退款成功。';
    }
    if(screen.startsWith('u-withdraw-')){
      const paragraphs=app.querySelectorAll('.u-result p,.notice>div');paragraphs.forEach(p=>p.textContent=p.textContent.replace(/¥186\.40/g,'¥'+s.withdrawalAmount.toFixed(2)));
    }
    if(['u-invoice-red','u-invoice-redone'].includes(screen)){
      app.querySelectorAll('.kv').forEach(row=>{const key=row.firstElementChild.textContent;if(key.includes('退款金额'))row.lastElementChild.textContent='¥'+R.refundTotal().toFixed(2);if(key.includes('原发票金额'))row.lastElementChild.textContent='¥'+R.paidTotal().toFixed(2);if(key.includes('重新开票')||key.includes('退款后金额'))row.lastElementChild.textContent='¥'+(R.paidTotal()-R.refundTotal()).toFixed(2);});
      const p=app.querySelector('.u-result p');if(p)p.textContent=screen==='u-invoice-red'?'订单已退款 ¥'+R.refundTotal().toFixed(2)+'，门店将处理原发票红冲。':'原发票已红冲，退款后的 ¥'+(R.paidTotal()-R.refundTotal()).toFixed(2)+' 正在重新开票。';
    }
    if(screen==='u-o-store-reschedule'){
      const newSide=app.querySelector('.side.new');if(newSide)newSide.innerHTML=`<small>新时间</small><div class="when">${s.proposedSlot||'16:00'} · ${s.duration}分钟</div><small>${s.proposedDate||s.date}</small>`;
    }
    if(screen==='u-promo'){
      app.querySelectorAll('.stat-card').forEach(card=>{if(card.innerText.includes('可提现'))card.querySelector('strong').textContent='¥'+s.balance.toFixed(2);});
      app.querySelector('.action-footer .lead b').textContent='¥'+s.balance.toFixed(2);
      if(!s.promoter)app.querySelector('.detail').insertAdjacentHTML('afterbegin',notice('gray','mail','当前尚未开通推广身份，请先确认邀请并签署协议。')+B('查看推广邀请','secondary full','data-go="u-promo-join"'));
    }
    if(screen==='u-withdraw'){
      app.querySelector('.money').textContent='¥'+s.balance.toFixed(2);
      if(!s.realname){app.querySelector('.vs.done strong').textContent='需要实名核验';app.querySelector('.vs.done p').textContent='提现前请完成核验';}
      if(s.transferAuthorized){app.querySelector('.vs.now strong').textContent='免确认收款已开通';app.querySelector('.vs.now p').textContent='本次到账仍以最终转账结果为准';}
    }
    if(screen==='u-delete-account'){
      app.querySelectorAll('.kv').forEach(row=>{if(row.innerText.includes('余额'))row.lastElementChild.textContent='可提现 ¥'+s.balance.toFixed(2);});
      const button=app.querySelector('[data-action="delete-account"]');if(button && (s.balance>0||s.withdrawal==='processing'))button.insertAdjacentHTML('beforebegin',notice('warm','wallet','请先处理可提现余额与未完成的提现，再注销账号。'));
    }
    if(screen==='t-finish'){
      app.querySelector('.timer-big').textContent=String(s.elapsed).padStart(2,'0')+':00';
      const normal=app.querySelector('.sheet .choice');normal.disabled=s.elapsed<s.duration+(s.extendedMinutes||0);
      if(!normal.disabled)normal.querySelector('small').textContent='已服务满预约时长';
      app.querySelector('.choice.selected small').textContent='已服务 '+s.elapsed+' 分钟，预约 '+(s.duration+(s.extendedMinutes||0))+' 分钟';
    }
    if(screen==='t-o-arrived'&&(s.noshowEligible||s.deadlines.noshow<=R.now())){
      const button=app.querySelector('.grid-actions button');button.disabled=false;button.dataset.go='t-noshow-confirm';button.querySelector('small').textContent='已满15分钟，可提交核实';
    }
    if(screen==='u-invoice-form'&&s.invoiceDetails){for(const [name,key]of [['invoiceType','type'],['invoiceTitle','title'],['invoiceTax','tax'],['invoiceEmail','email']])app.querySelector(`[name="${name}"]`).value=s.invoiceDetails[key];}
    if(screen==='s-aftersale'){const offer=app.querySelector('[name="refundOffer"]');if(offer)offer.max=s.requestedRefund;}
    app.querySelectorAll('[data-action="approve-requested-refund"]').forEach(button=>button.textContent=s.requestedRefund?'同意退款 ¥'+s.requestedRefund.toFixed(2):'确认反馈处理结果');
    if(screen==='u-o-aftersale')app.querySelectorAll('.timeline2 .t').forEach(el=>el.innerHTML=el.innerHTML.replace(/申请退款\s*¥\d+(?:\.\d+)?/g,s.requestedRefund?'申请退款 ¥'+s.requestedRefund.toFixed(2):'仅反馈问题'));
    if(['u-refund-processing','u-refund-received'].includes(screen)){const first=app.querySelector('.timeline2 .t');if(first)first.innerHTML=(first.querySelector('time')?.outerHTML||'')+(s.refundReason||'退款申请已确认');}
    app.querySelectorAll('[data-go="u-invoice"],[data-go="u-invoice-form"]').forEach(button=>{if(['pending','issued','red','redone'].includes(s.invoice))button.dataset.go=({pending:'u-invoice-pending',issued:'u-invoice-issued',red:'u-invoice-red',redone:'u-invoice-redone'})[s.invoice];});
    if(screen.startsWith('u-sos-')){app.querySelectorAll('[data-go="u-o-service"]').forEach(button=>button.dataset.go=s.sosInitiatorRole==='tech'?'t-order-current':'u-order-current');const b=app.querySelector('.card-title .badge');if(b)b.textContent=({departed:'已出发',arrived:'已到达',serving:'服务中',service:'客服介入',completed:'已完成'})[s.stage]||'订单处理中';}
    if(screen==='u-review'){const stars=app.querySelector('.stars');stars.innerHTML=[1,2,3,4,5].map(n=>`<button type="button" aria-label="${n}星" data-action="review-star" data-rating="${n}" style="border:0;background:none;color:${n<=(s.reviewRating||5)?'#b07a1c':'#b9bec4'};padding:4px">${I('star')}</button>`).join('');}
    app.querySelectorAll('[data-go="u-aftersale-hq"]').forEach(button=>{delete button.dataset.go;button.dataset.action='request-hq';});
    if(s.refundBreakdown?.length>1&&['u-refund-processing','u-refund-received','u-o-refunded'].includes(screen))app.querySelector('.detail')?.insertAdjacentHTML('afterbegin',`<div class="card"><div class="card-title">分别退款</div>${s.refundBreakdown.map((amount,i)=>kv(i===0?'主订单':'加钟子订单 '+i,'¥'+amount.toFixed(2))).join('')}</div>`);
    if(['s-aftersale','u-o-aftersale','u-aftersale-confirm'].includes(screen)&&s.requestedRefundBreakdown){const d=s.requestedRefundBreakdown;app.querySelector('.detail')?.insertAdjacentHTML('afterbegin',`<div class="card"><div class="card-title">申请范围 · 合计 ¥${s.requestedRefund.toFixed(2)}</div>${kv('主订单退款诉求','¥'+d.main.toFixed(2))}${d.extensions.map((amount,i)=>kv('加钟子订单 '+(i+1),'¥'+amount.toFixed(2))).join('')}</div>`);}
    const timerKeys={'u-confirm':'payment','u-health':'payment','u-health-unchecked':'payment','u-o-waiting':'accept','t-work':'accept','u-o-reassign':'reassign','s-reassign-wait':'reassign','u-o-store-reschedule':'storeReschedule','s-reschedule-wait':'storeReschedule','t-extension-wait':'extend','u-o-extend':'extend','u-o-aftersale':'storeAftersale','s-aftersale':'storeAftersale','u-aftersale-confirm':'aftersaleConfirm','u-aftersale-rejected':'aftersaleConfirm','s-aftersale-wait':'aftersaleConfirm'};
    const key=timerKeys[screen];if(key&&s.deadlines[key]){let node=[...app.querySelectorAll('b,.timer')].find(el=>/\d+分\d+秒|\d+小时\d+分/.test(el.textContent));if(!node){const host=app.querySelector('.status-hero>p,.detail,.booking-content');if(host){host.insertAdjacentHTML('beforeend',`<p class="small muted">剩余 <b data-countdown="${key}"></b></p>`);node=host.querySelector('[data-countdown]');}}if(node){node.dataset.countdown=key;const seconds=Math.ceil((s.deadlines[key]-R.now())/1000);node.textContent=Math.max(0,Math.floor(seconds/60))+'分'+String(Math.max(0,seconds%60)).padStart(2,'0')+'秒';}}
  };
  // 原状态画面可以点击；点击时以当前画面的状态初始化这条演示路径。
  const staticSeed=()=>{
    if(R.isLive())return;
    const screen=R.getScreen(),s=get();
    const stage={'u-o-accepted':'accepted','t-o-accepted':'accepted','t-location':'accepted','u-o-departed':'departed','u-o-late':'late','u-o-arrived':'arrived','t-o-arrived':'arrived','u-o-serving':'serving','t-o-serving':'serving','t-finish':'serving','t-terminate':'serving','u-o-done':'completed','u-sos':'serving','t-sos':'serving','u-o-waiting':'waiting','s-pick':'dispatching','u-o-reassign':'reassign','u-o-store-reschedule':'reschedule'}[screen];
    if(stage){s.stage=stage;s.paid=true;s.finance='paid';s.realname=true;s.health=true;if(stage==='completed')s.finishedAt=R.now();}
    if(['u-promo','u-withdraw','u-withdraw-processing'].includes(screen)){s.realname=true;if(screen==='u-withdraw-processing'){s.withdrawal='processing';s.withdrawalAmount=s.balance;s.balance=0;}}
    if(screen==='u-confirm'){s.realname=true;s.health=true;s.adult=true;s.eligible=true;}
    if(screen==='t-finish')s.elapsed=45;
    if(screen==='u-health'){s.adult=true;s.eligible=true;s.realname=true;}
  };
  document.addEventListener('click',event=>{if(event.target.closest('[data-go],[data-action]'))staticSeed();},true);
  document.addEventListener('input',event=>{
    const input=event.target;if(!input.name||/identity|certificateFile|policyFile|uniformFile/i.test(input.name)||input.type==='file')return;
    const s=get();s.drafts=s.drafts||{};s.drafts[R.getScreen()]=s.drafts[R.getScreen()]||{};
    s.drafts[R.getScreen()][input.name]=input.type==='checkbox'?input.checked:input.value;
  });
  document.addEventListener('change',event=>{
    const input=event.target;
    if(input.name==='healthConfirmed'){get().health=input.checked;const pay=document.querySelector('[data-action="pay"]');if(pay)pay.disabled=!input.checked;R.store();}
    if(input.type==='file'){const summary=document.querySelector(`[data-file-summary="${input.name}"]`);if(summary){summary.hidden=false;summary.textContent=[...input.files].map(file=>file.name).join('、');}}
    if(input.name==='invoiceType'){const tax=document.querySelector('[name="invoiceTax"]');tax.required=input.value==='company';}
    if(input.name==='refundMain')document.querySelector('[name="refundAmount"]').disabled=!input.checked;
    if(input.name.startsWith('refundExtension')){const number=input.name.slice('refundExtension'.length);document.querySelector(`[name="extensionRefund${number}"]`).disabled=!input.checked;}
  });
  const healthConfirm=A['health-confirm'];A['health-confirm']=()=>{if(get().adult&&get().eligible)get().healthSeen=true;healthConfirm();};
  // 常用表单动作和边界检查由统一处理器执行。
  A['close-sheet']=()=>document.querySelector('.overlay')?.remove();A.back=R.back;
  A['select-option']=button=>{
    const parent=button.closest('.slots,.date-tabs,.segmented,.chips,.sheet-body,.filterbar')||button.parentElement;
    if(button.closest('.filterbar')){
      parent.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===button));
      const label=button.innerText.trim();document.querySelectorAll('.order-card').forEach(card=>{
        const text=card.innerText;card.hidden=label.startsWith('全部')?false:label.startsWith('待评价')?!text.includes('待评价'):label.startsWith('售后')?!text.includes('售后'):label.startsWith('进行中')?/已完成|已取消|已关闭|售后中/.test(text):label.startsWith('待确认')?!text.includes('待接单'):false;
      });return;
    }
    if(R.getScreen()==='u-review'&&button.classList.contains('chip')){button.classList.toggle('on');return;}
    if(R.getScreen()==='u-aftersale-apply'&&button.closest('.segmented')){get().aftersaleOnlyFeedback=button.innerText==='仅反馈问题';document.querySelectorAll('[name="refundAmount"],[name^="extensionRefund"],[name="refundMain"],[name^="refundExtension"]').forEach(input=>input.disabled=get().aftersaleOnlyFeedback||(input.type!=='checkbox'&&(input.name==='refundAmount'?!checked('refundMain'):!checked('refundExtension'+input.name.slice('extensionRefund'.length)))));}
    if(button.closest('.date-tabs')){parent.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===button));const date=button.innerText.split('\n').pop().replace(/(\d+)\/(\d+)/,'$1月$2日');if(get().paid)get().proposedDate=date;else get().date=date;R.store();return;}
    if(button.classList.contains('slot')){const slot=button.childNodes[0].textContent.trim();if(get().paid)get().proposedSlot=slot;else{get().slot=slot;get().price=get().service==='neck'?(slot>='21:00'?228:198):(slot>='21:00'?328:298);}parent.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===button));const lead=document.querySelector('.action-footer .lead b');if(lead)lead.textContent=(get().paid?get().proposedDate||get().date:get().date)+' '+slot+' · ¥'+get().price;R.store();return;}
    parent.querySelectorAll('button').forEach(b=>b.classList.remove('on','selected'));button.classList.add(button.classList.contains('choice')?'selected':'on');
    parent.querySelectorAll('.radio').forEach(r=>r.classList.toggle('on',r.closest('button')===button));
  };
  A.explain=button=>R.toast('演示操作：'+(button?.innerText||'已选择'));
  A['review-star']=button=>{get().reviewRating=Number(button.dataset.rating);R.store();R.hydrate(document.getElementById('app'),'u-review');lucide.createIcons();};
  document.addEventListener('DOMContentLoaded',()=>{
    const ids=['u-promo','t-profile','s-alerts'];
    if(document.getElementById('app'))render();
  });
  window.PrototypeRuntime.withdrawalResult=withdrawalResult;
})();
