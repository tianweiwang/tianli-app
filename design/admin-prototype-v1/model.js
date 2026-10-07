'use strict';
window.Admin = (() => {
  const key='tianli-admin-v1';
  let state;
  try {state=JSON.parse(localStorage.getItem(key));} catch(error) {console.warn('演示存储读取失败，将使用初始资料。',error.message);}
  if(!state||state.schema!==1) state=AdminData.seed();
  const find=(type,id)=>state[type].find(row=>row.id===id);
  const fail=message=>{throw new Error(message);};
  const money=value=>'¥'+(Number(value||0)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const save=()=>localStorage.setItem(key,JSON.stringify(state));
  const visible=row=>state.session?.role==='hq'||row.store===state.session?.store;
  const orders=()=>state.orders.filter(visible);
  const actor=()=>state.session?.role==='hq'?'周运营 · 集团':'何店长 · 幸福里门店';
  const check=row=>{if(!state.session||!row||!visible(row))fail('无权访问这条记录，请确认当前门店。');};
  const audit=(text,id='')=>{state.audit.unshift({at:state.now,actor:actor(),text,id,store:state.session?.role==='store'?state.session.store:null});};
  const event=(o,text)=>{o.logs.unshift({at:state.now,text,actor:actor()});audit(text,o.id);};
  const snapshots=()=>{state.techPayouts??=[];state.orders.forEach(o=>{o.itemSnapshot??={...find('items',o.item)};o.ruleSnapshot??={...state.rules};if(o.status!=='待分配')o.techSnapshot??={rate:state.rules.techRate,transport:1000,version:state.rules.version};});state.techs.forEach(t=>{t.certificate??='TL-DEMO-'+t.id;});};
  snapshots();
  const item=o=>o.itemSnapshot;
  const duration=o=>item(o).duration+(o.extraMinutes||0);
  const end=o=>o.start+duration(o)*60000;
  const currentBlock=o=>state.safety.some(x=>x.order===o.id&&(x.status!=='已结案'||x.unresolved))||state.cases.some(x=>x.order===o.id&&!['已完成','已撤销'].includes(x.status))||o.refundPending>0;
  const displayStatus=o=>currentBlock(o)&&!['已取消','已关闭'].includes(o.status)?(state.safety.some(x=>x.order===o.id&&(x.status!=='已结案'||x.unresolved))?'客服处理中':o.status):o.status;
  const day=at=>new Date(at+28800000).toISOString().slice(0,10);
  const shiftRange=(date,value)=>{const match=/^(\d{2}:\d{2})[–-](\d{2}:\d{2})$/.exec(value);if(!match)return null;const start=Date.parse(date+'T'+match[1]+':00+08:00'),finish=Date.parse(date+'T'+match[2]+':00+08:00');return Number.isFinite(start)&&finish>start?[start,finish]:null;};
  const shiftAt=(t,date)=>t.shifts?.[date]||t.shift;
  const shareBlock=o=>currentBlock(o)?'售后、安全或退款阻断':o.status!=='已完成'?'尚未完成服务':state.now<o.completedAt+o.ruleSnapshot.afterHours*3600000?'售后期未结束':'';
  const techCommission=o=>o.status==='已完成'&&o.paid>o.refund?Math.floor((o.paid-o.refund)*(o.techSnapshot?.rate??40)/100)+(o.techSnapshot?.transport??1000):0;
  const techAmount=id=>state.orders.filter(o=>o.tech===id).reduce((sum,o)=>sum+techCommission(o),0);
  const invoiceRefund=o=>state.invoices.filter(i=>i.order===o.id).forEach(i=>{if(i.status==='已开票')i.status='待红冲';});
  const techReason=(t,o)=>{
    if(!t)return '未选择技师';
    const store=find('stores',o.store);if(store.status!=='营业中')return '门店未营业';
    if(store.suspension&&store.suspension.start<end(o)&&store.suspension.end>o.start)return '预约时段门店暂停营业';
    if(t.store!==o.store)return '不属于当前门店';
    if(t.status!=='在岗')return t.status==='请假'?'请假中':'当前不可接单';
    if(!t.skills.includes(o.item))return '未开通该项目';
    if(Date.parse(t.insurance+'T23:59:59+08:00')<end(o))return '保单未覆盖预约时间';
    if(!t.insurance)return '尚未补齐保单';
    const range=shiftRange(day(o.start),shiftAt(t,day(o.start))),business=shiftRange(day(o.start),store.open);
    if(!range||o.start<range[0]||end(o)>range[1])return '不在技师排班时段';
    if(!business||o.start<business[0]||end(o)>business[1])return '不在营业时段';
    if(state.leaves.some(l=>l.tech===t.id&&l.status==='已批准'&&l.start<end(o)&&l.end>o.start))return '该时段请假';
    const buffer=state.rules.buffer*60000;
    if(state.orders.some(x=>x.id!==o.id&&x.tech===t.id&&!['已完成','已取消','已关闭'].includes(x.status)&&x.start-buffer<end(o)+buffer&&end(x)+buffer>o.start-buffer))return '时段冲突（含缓冲）';
    if(state.orders.some(x=>{if(x.id===o.id||!x.proposal)return false;const proposed={...x,start:x.proposal.start||x.start};return (x.proposal.tech||x.tech)===t.id&&proposed.start-buffer<end(o)+buffer&&end(proposed)+buffer>o.start-buffer;}))return '已有待确认预约占用';
    return '';
  };
  const round=(o,trigger)=>{o.round++;o.roundStart=state.now;o.deadline=Math.min(state.now+state.rules.dispatchMinutes*60000,o.start-3600000);event(o,'新派单轮生效 · '+trigger);};
  const fullRefund=(o,reason)=>{o.status='已取消';o.proposal=null;const remaining=o.paid-o.refund-o.refundPending;if(remaining>0)o.refundPending+=remaining;event(o,reason+'，已提交全额退款');};
  const expire=()=>{
    state.orders.forEach(o=>{
      if(o.status==='待分配'&&state.now>=o.deadline){fullRefund(o,'本轮派单期限已到');return;}
      if(o.proposal&&state.now>=o.proposal.expires){if(o.proposal.type==='assign')fullRefund(o,'指定改派确认超时');else{o.proposal=null;event(o,'门店改约超时，保持原约');}}
    });
    state.safety.forEach(s=>{if(['待接报','已升级'].includes(s.status)){if(state.now-s.created>=360000)s.status='无人响应';else if(state.now-s.created>=180000)s.status='已升级';}});
  };
  const split=(total,lines)=>{
    const sum=lines.reduce((a,l)=>a+l.request,0);if(!Number.isInteger(total)||total<0||total>sum)fail('协商金额需在0元至申请总额之间。');
    if(!sum)return lines.map(l=>({...l,amount:0}));
    const r=lines.map((l,index)=>({...l,index,amount:Math.floor(total*l.request/sum),remainder:(total*l.request)%sum}));
    let left=total-r.reduce((a,l)=>a+l.amount,0);
    for(const l of [...r].sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){if(left<=0)break;l.amount++;left--;}
    return r;
  };
  const dispatch=(o,tech)=>{const t=find('techs',tech);if(!t)fail('请选择技师。');const reason=techReason(t,o);if(reason)fail(reason);if(!o.techSnapshot||o.tech!==tech)o.techSnapshot={rate:state.rules.techRate,transport:1000,version:state.rules.version};o.tech=tech;o.status='已确认';o.proposal=null;event(o,'门店分配生效 · '+t.name+' · 无需再次确认');};
  function command(type,p={}) {
    if(type==='login'){state.session={role:p.role,store:'s1'};save();return;}
    if(type==='logout'){state.session=null;save();return;}
    if(type==='reset'){const session=state.session;state=AdminData.seed();state.session=session;snapshots();save();return;}
    if(!state.session)fail('请先选择演示账号。');
    expire();
    const o=p.order?find('orders',p.order):null;if(o)check(o);
    if(type==='advance'){state.now+=Number(p.minutes)*60000;expire();audit('演示时间推进 '+p.minutes+' 分钟');}
    else if(type==='assign'){
      if(!o||!['待分配','已确认'].includes(o.status)||o.proposal||o.departed)fail('预约状态已变化，请刷新。');
      if(o.status==='待分配'&&state.now>=o.deadline)fail('派单期限已到，已进入退款。');
      const tech=find('techs',p.tech);if(!tech)fail('请选择技师。');const reason=techReason(tech,o);if(reason)fail(reason);
      if(o.mode==='specified'&&p.tech!==o.tech){o.proposal={type:'assign',tech:p.tech,created:state.now,expires:o.status==='待分配'?Math.min(state.now+900000,o.deadline):state.now+900000};event(o,'已发送指定改派确认，原安排保持至用户决定');}
      else {const changed=o.status==='已确认'&&p.tech!==o.tech;if(changed)round(o,'就近安排改派');if((changed||o.status==='待分配')&&state.now>=o.deadline)fullRefund(o,'本轮期限已到');else dispatch(o,p.tech);}
    }
    else if(type==='reschedule'){
      if(!o||!['待分配','已确认'].includes(o.status)||o.proposal||o.departed)fail('当前预约不支持改约。');
      const start=Date.parse(p.start);if(!Number.isFinite(start)||start<state.now+state.rules.earliestHours*3600000||start>o.paidAt+o.ruleSnapshot.maxDays*86400000)fail('请选择当前最早可约时间之后、首次支付7天内的时段。');
      const hour=new Date(start+28800000).getUTCHours(),price=hour>=21?item(o).night:item(o).price;
      if(price!==item(o).price)fail('本期只能改到同价时段。');
      if(hour<9||hour>=23)fail('请选择营业时段。');
      const candidate={...o,start};const reason=techReason(find('techs',o.tech),candidate);if(reason)fail(reason);
      o.proposal={type:'reschedule',start,created:state.now,expires:state.now+900000};event(o,'门店提出改约，等待用户确认');
    }
    else if(type==='decision'){
      if(!o?.proposal)fail('当前没有待确认提案。');const proposal=o.proposal;
      if(p.accept){if(proposal.type==='assign'){if(o.status==='已确认')round(o,'用户确认指定改派');if(state.now>=o.deadline){fullRefund(o,'新派单轮已过截止');}else dispatch(o,proposal.tech);}
        else {const candidate={...o,start:proposal.start};const reason=techReason(find('techs',o.tech),candidate);if(reason)fail(reason);o.start=proposal.start;o.proposal=null;o.status='待分配';round(o,'用户确认改约');expire();}}
      else if(proposal.type==='assign')fullRefund(o,'用户拒绝指定改派');else{o.proposal=null;event(o,'用户拒绝门店改约，原约保持');}
    }
    else if(type==='cancel'){if(!o||!['待分配','已确认'].includes(o.status))fail('该预约需走客服处理。');if(!p.reason?.trim())fail('请填写取消原因。');fullRefund(o,p.reason.trim());}
    else if(type==='refund-result'){if(!o||o.refundPending<=0)fail('暂无待执行退款。');if(p.success){o.refund+=o.refundPending;o.refundPending=0;o.refundFailed=false;invoiceRefund(o);event(o,'渠道退款成功');}else{event(o,'渠道退款失败，转财务待处理');o.refundFailed=true;}}
    else if(type==='leave'){
      const l=find('leaves',p.id);check(l);if(l.status!=='待审批')fail('该请假已处理。');if(p.accept){if(l.type==='普通请假'&&state.orders.some(x=>x.tech===l.tech&&!['已完成','已取消','已关闭'].includes(x.status)&&x.start<l.end&&end(x)>l.start))fail('普通请假须先协调受影响预约，当前不能批准。');l.status='已批准';state.orders.filter(x=>x.tech===l.tech&&x.status==='已确认'&&!x.departed&&x.start<l.end&&end(x)>l.start).forEach(x=>{x.status='待分配';x.proposal=null;round(x,'紧急请假重派');});expire();}else{if(!p.reason?.trim())fail('请填写驳回原因。');l.status='已驳回';l.result=p.reason;}audit('请假'+(p.accept?'批准':'驳回'),l.id);
    }
    else if(type==='case-plan'){
      const c=find('cases',p.id),co=find('orders',c?.order);check(co);if(!['待门店处理','集团介入中'].includes(c.status))fail('该案件已有处理方案。');
      if(p.action==='reject'){if(!p.reason?.trim())fail('请填写驳回理由。');c.status=state.session.role==='hq'?'已完成':'待用户确认';c.plan={kind:'reject',reason:p.reason,total:0,lines:[]};}
      else{const total=Number(p.amount);const lines=split(total,co.payments);if(lines.some(l=>l.amount>l.paid-l.refunded))fail('超过尚可退金额。');c.plan={kind:'refund',total,lines:lines.map(l=>({...l,status:'待执行'})),reason:p.reason||'按协商方案处理'};c.status=state.session.role==='hq'?(total?'退款处理中':'已完成'):'待用户确认';if(state.session.role==='hq')co.refundPending=total;}
      event(co,'售后方案已提交 · '+(c.plan.kind==='reject'?'驳回':money(c.plan.total)));
    }
    else if(type==='case-decision'){
      const c=find('cases',p.id),co=find('orders',c?.order);check(co);if(c.status!=='待用户确认')fail('当前无需用户确认。');
      if(!p.accept){c.status='集团介入中';event(co,'用户申请集团介入');}else if(c.plan.kind==='reject'||c.plan.total===0){c.status='已完成';event(co,'用户接受处理结果');}else{c.status='退款处理中';co.refundPending=c.plan.total;event(co,'用户接受退款方案，金额已固定');}
    }
    else if(type==='case-refund'){
      const c=find('cases',p.id),co=find('orders',c?.order);check(co);if(!['退款处理中','退款待处理'].includes(c.status))fail('当前没有待执行的退款方案。');
      c.plan.lines.forEach((l,index)=>{if(l.status==='成功')return;if(p.failSecond&&index===1){l.status='失败';return;}l.status='成功';co.payments.find(x=>x.id===l.id).refunded+=l.amount;co.refund+=l.amount;co.refundPending-=l.amount;});
      invoiceRefund(co);c.status=c.plan.lines.every(l=>l.status==='成功')?'已完成':'退款待处理';event(co,c.status==='已完成'?'分笔退款全部到账':'部分退款成功，其余待重试');
    }
    else if(type==='safety-claim'||type==='safety-close'){
      const s=find('safety',p.id);check(s);const so=find('orders',s.order);
      if(type==='safety-claim'){if(s.status==='已结案')fail('事件已结案。');s.status='处理中';s.handler=actor();audit('接报安全事件',s.id);}
      else{if(s.status!=='处理中')fail('请先接报处理。');if(!p.result?.trim())fail('请填写处理结果。');s.status='已结案';s.result=p.result;s.unresolved=!!p.unresolved;event(so,'安全事件结案'+(s.unresolved?'，服务争议继续处理':'，已核实无未解争议'));}
    }
    else if(type==='share'){
      if(state.session.role!=='hq')fail('仅集团财务可处理分账。');const block=shareBlock(o);if(block)fail(block);if(o.sharing==='已分账')fail('本单已完成分账。');o.sharing='已分账';event(o,'分账重试成功，剩余资金已解冻');
    }
    else if(type==='rules'){
      const vals=Object.fromEntries(Object.entries(p.values).map(([k,v])=>[k,Number(v)]));if(Object.values(vals).some(v=>!Number.isFinite(v)||v<0))fail('请填写有效的非负数。');
      const permitted=state.session.role==='hq'?['hqRate','storeRate','commission','maxDays','afterHours','earliestHours']:['techRate','compensation','radius','buffer'];if(Object.keys(vals).some(k=>!permitted.includes(k)))fail('无权修改该规则。');
      if(Object.entries(vals).some(([k,v])=>/Rate$|commission|compensation/.test(k)&&v>100))fail('比例须在0%至100%之间。');if('radius'in vals&&vals.radius<=0)fail('服务半径须大于0。');
      if('hqRate'in vals&&vals.hqRate+vals.commission>30)fail('集团抽成与门店承担佣金合计不能超过30%。');
      if('maxDays'in vals&&vals.maxDays+vals.afterHours/24+10>25)fail('最远可约天数 + 售后天数 + 10天须不超过25天。');
      if('earliestHours'in vals&&vals.earliestHours*60<state.rules.dispatchMinutes+60)fail('最早可约须覆盖派单期限及开始前60分钟。');
      Object.assign(state.rules,vals);state.rules.version++;audit('发布规则版本 v'+state.rules.version);
    }
    else if(type==='store-edit'){
      const s=find('stores',p.id);if(state.session.role!=='hq'&&p.id!==state.session.store)fail('只能修改本店。');if(!s||!p.name?.trim()||!p.address?.trim()||!(Number(p.radius)>0))fail('请补齐有效的门店名称、地址及服务半径。');
      const range=shiftRange(day(state.now),p.open);if(!range)fail('营业时间格式为09:00–23:00。');
      Object.assign(s,{name:p.name.trim(),address:p.address.trim(),radius:Number(p.radius),open:p.open});audit('更新门店资料',s.id);
    }
    else if(type==='pause-store'){
      const s=find('stores',p.id);if(!s||state.session.role!=='hq'&&p.id!==state.session.store)fail('无权操作该门店。');if(!p.reason?.trim())fail('请填写营业调整原因。');
      if(p.status==='营业中'){s.suspension=null;if(s.status==='暂停营业')s.status='营业中';}
      else {const start=Date.parse(p.start+':00+08:00'),finish=Date.parse(p.end+':00+08:00');if(!Number.isFinite(start)||!Number.isFinite(finish)||finish<=start)fail('请填写有效的暂停起止时间。');if(start<state.now+(state.session.role==='hq'?0:86400000))fail('门店暂停须至少提前24小时设置。');s.suspension={start,end:finish,reason:p.reason.trim()};}
      audit(p.status==='营业中'?'取消暂停安排':'保存暂停营业时段',s.id);
    }
    else if(type==='shift'){
      const t=state.techs.find(t=>t.name===p.tech&&visible(t));check(t);const range=shiftRange(p.date,p.shift);if(!range)fail('请填写有效排班，如09:00–23:00。');if(p.date<day(state.now))fail('历史排班仅供查看。');
      if(state.orders.some(x=>x.tech===t.id&&day(x.start)===p.date&&!['已取消','已关闭','已完成'].includes(x.status)&&(x.start<range[0]||end(x)>range[1])))fail('该排班不能覆盖已有预约，请先处理受影响预约。');
      t.shifts??={};t.shifts[p.date]=p.shift;audit('更新 '+t.name+' '+p.date+' 排班',t.id);
    }
    else if(type==='tech'){
      if(state.session.role!=='hq')fail('技师档案须集团审核。');const t=find('techs',p.id);if(!t)fail('档案不存在。');
      const insurance=p.insurance||t.insurance,certificate=p.certificate?.trim()||t.certificate;
      if(p.status==='在岗'&&(!insurance||!Number.isFinite(Date.parse(insurance))||Date.parse(insurance+'T23:59:59+08:00')<state.now||!certificate))fail('请先补齐有效证书与保单。');
      if(['停单','离职'].includes(p.status)&&!p.note?.trim())fail('请填写状态调整依据。');
      t.insurance=insurance;t.certificate=certificate;if(p.skills)t.skills=p.skills==='全部项目'?['full','neck']:p.skills==='舒缓放松'?['full']:['neck'];t.status=p.status;t.note=p.note;if(t.status==='在岗'&&t.shift==='待审核')t.shift='09:00–23:00';
      if(['停单','离职'].includes(t.status))state.orders.filter(o=>o.tech===t.id&&o.status==='已确认'&&!o.departed).forEach(o=>{o.status='待分配';o.proposal=null;round(o,'技师状态变更重派');});expire();audit('技师审核 · '+p.status,t.id);
    }
    else if(type==='import-tech'){
      if(state.session.role!=='hq')fail('仅集团可导入名单。');const names=[...new Set((p.names||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];if(!names.length||names.length>50||names.some(n=>n.length>20))fail('请填写1至50位姓名，每行不超过20字。');
      names.forEach(name=>state.techs.push({id:'t'+(state.techs.length+1),name,store:'s3',gender:'待补充',skills:[],status:'资料审核',insurance:'',certificate:false,rating:'新技师',orders:0,shift:'待审核'}));audit('导入 '+names.length+' 位待审核技师');
    }
    else if(type==='update'){
      const allowed=['stores','techs','items','invoices','reviews','recoveries','withdrawals','promoters','users','accounts'];if(!allowed.includes(p.collection))fail('操作对象不支持。');
      const row=find(p.collection,p.id);if(!row)fail('记录不存在。');if(row.store)check(row);
      if(['stores','techs','items','withdrawals','users','accounts'].includes(p.collection)&&state.session.role!=='hq')fail('当前账号无此权限。');
      if(p.collection==='withdrawals'&&['成功','已撤销'].includes(row.status)&&row.status!==p.values.status)fail('最终结果已固定，不可改为其他状态。');
      if(p.collection==='invoices'){const io=find('orders',row.order);if(p.values.status==='已开票'){if(row.status==='待红冲')fail('原发票尚未红冲。');if(io.refundPending)fail('请等待退款结果固定后开票。');p.values.amount=io.paid-io.refund;}if(p.values.status==='已红冲'&&row.status!=='待红冲')fail('当前没有待红冲发票。');}
      Object.assign(row,p.values);audit(p.description||'更新记录',p.id);
    }
    else if(type==='add-promoter'){if(!p.name?.trim())fail('请填写姓名。');state.promoters.push({id:'PR'+(state.promoters.length+1001),name:p.name.trim(),store:state.session.role==='store'?'s1':null,type:state.session.role==='store'?'门店推广员':'集团推广员',customers:0,commission:0,status:'待签约'});audit('发出推广员邀请');}
    else if(type==='paid-tech'){const t=find('techs',p.tech);check(t);if(!p.proof?.trim())fail('请填写发放凭证编号。');if(state.paidTech.includes(p.tech))fail('该提成已标记发放。');const amount=techAmount(t.id);if(amount<=0)fail('当前无可登记的提成。');state.techPayouts.push({tech:t.id,amount,proof:p.proof,at:state.now});state.paidTech.push(p.tech);audit('提成已发放 '+money(amount)+' · 凭证 '+p.proof,p.tech);}
    else if(type==='duty'){if(!p.value?.trim())fail('请填写值班人员。');state.duty=p.value.trim();audit('更新值班安排');}
    else fail('未识别的操作。');
    save();
  }
  return {get state(){return state;},find,visible,orders,money,check,actor,item,end,duration,currentBlock,shareBlock,techCommission,techAmount,displayStatus,techReason,command,split,day,shiftAt,save,audit};
})();
