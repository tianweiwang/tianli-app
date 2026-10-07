// Pure task projections. Source booking records remain the only business state.
const token = value => JSON.stringify(value);
const finite = value => Number.isFinite(value) ? value : null;
const supportJobs = {group:['support'],store:['store-manager']};
const financeJobs = {group:['finance'],store:['store-finance']};
function row(b,kind,sourceId,stage,fields) {
  return {id:`booking-${kind}:${sourceId}:${stage}`,category:kind==='round'?'dispatch':kind,sourceId,bookingId:b.id,storeId:b.storeId,status:'done',statusLabel:'已结束',createdAt:null,dueAt:null,assignmentMode:'task',requiredRoute:'bookings',routes:{group:`/group/bookings/${encodeURIComponent(b.id)}`,store:`/store/bookings/${encodeURIComponent(b.id)}`},allowedJobs:supportJobs,manageRoles:['group','store'],commands:[],...fields};
}
export function bookingTaskRows(s) {
  const rows=[];
  for(const b of s.bookings || []) {
    const rounds=new Map((b.rounds || []).filter(x=>x?.id).map(x=>[x.id,x]));
    if(b.round?.id) rounds.set(b.round.id,b.round);
    for(const r of rounds.values()) {
      const active=b.status==='waiting'&&b.round?.id===r.id;
      const waiting=active&&(b.confirmationPhase==='tech'||b.change?.status==='pending');
      rows.push(row(b,'round',r.id,'dispatch',{title:'预约派单与确认',status:active?(waiting?'waiting':'open'):'done',statusLabel:active?(b.change?.status==='pending'?'等待用户确认变更':waiting?'等待技师确认':'待门店派单'):'本轮派单已结束',createdAt:finite(r.startedAt),dueAt:active&&b.confirmationPhase==='tech'?finite(r.techDeadline):finite(r.deadline),sourceToken:token([b.id,r.id,active,b.status,b.confirmationPhase,r.deadline,r.techDeadline,r.completedAt,b.techId,b.change?.id,b.change?.status]),manageRoles:['store'],commands:active&&!waiting?['booking.assign']:[],routes:{group:`/group/bookings/${encodeURIComponent(b.id)}`,store:`/store/bookings/${encodeURIComponent(b.id)}${active&&!waiting?'/assign':''}`}}));
    }
    const changes=new Map((b.changeHistory || []).filter(x=>x?.id).map(x=>[x.id,x]));if(b.change?.id) changes.set(b.change.id,b.change);
    for(const c of changes.values()) rows.push(row(b,'change',c.id,'confirm',{title:c.kind==='reassign'?'指定技师变更确认':'预约时间变更确认',status:c.status==='pending'?'waiting':'done',statusLabel:c.status==='pending'?'等待用户确认':'变更已结束',createdAt:finite(c.createdAt),dueAt:finite(c.expiresAt),sourceToken:token([c.id,c.status,c.expiresAt,c.decidedAt,c.techId,c.startAt]),manageRoles:[]}));
    for(const a of b.assistance || []) rows.push(row(b,'assistance',a.id,'reply',{title:'普通门店协助',status:a.status==='open'?'open':'done',statusLabel:a.status==='open'?'待回复':'已回复',createdAt:finite(a.createdAt),sourceToken:token([a.id,a.status,a.createdAt,a.closedAt]),commands:a.status==='open'?['booking.assistance-close']:[]}));
    for(const r of b.refunds || []) {
      const review=['requested','escalated'].includes(r.status),waiting=r.status==='offered'||r.status==='rejected'&&r.deadline!=null;
      rows.push(row(b,'refund',r.id,'review',{title:'预约售后审核',status:review?'open':waiting?'waiting':'done',statusLabel:r.status==='requested'?'待门店审核':r.status==='escalated'?'待集团裁决':waiting?'等待用户确认':'审核阶段已结束',createdAt:finite(r.createdAt),dueAt:finite(r.deadline),sourceToken:token([r.id,r.status,r.version,r.deadline,r.final,r.acceptedVersion]),manageRoles:r.status==='escalated'?['group']:['store'],commands:review?['booking.refund-review']:[]}));
      const executions=[...(r.executions || [])];
      // Approved lines can precede lazy execution-record migration. Project the
      // same stable refund number/state without writing migration from a view.
      for(const line of r.lines || []) if(!executions.some(x=>x.paymentId===line.paymentId)) executions.push({...line,refundNo:`${r.id}-${line.paymentId}`,status:line.amountCents===0?'success':['processing','failed','success'].includes(r.status)?r.status:'approved',attempts:r.attempts || 0,createdAt:r.createdAt,...(r.status==='success'?{completedAt:r.completedAt || r.updatedAt || r.createdAt}:{})});
      for(const x of executions) {
        const executable=['approved','processing','failed'].includes(r.status),done=x.status==='success'||['success','withdrawn'].includes(r.status)||r.status==='rejected'&&!r.deadline;
        const command=x.status==='processing'?'booking.refund-query':'booking.refund-pay';
        rows.push(row(b,'refund',`${r.id}:${x.paymentId}`,'execute',{title:x.paymentId===b.payment?.id?'主预约原路退款':'加时原路退款',sourceId:x.refundNo || `${r.id}:${x.paymentId}`,refundId:r.id,paymentId:x.paymentId,status:done?'done':executable?'open':'waiting',statusLabel:done?(x.status==='success'?'退款成功':'退款执行已结束'):!executable?'等待退款方案确认':x.status==='processing'?'退款结果待查询':x.status==='failed'?'退款失败待重试':'待执行退款',createdAt:finite(x.createdAt??r.createdAt),sourceToken:token([r.id,x.paymentId,r.status,r.version,x.status,x.attempts,x.updatedAt,x.completedAt]),allowedJobs:financeJobs,commands:!done&&executable?[command]:[]}));
      }
    }
    for(const d of b.disputes || []) {
      const open=['verifying','open'].includes(d.status),done=['resolved','closed'].includes(d.status);
      rows.push(row(b,'dispute',d.id,'resolve',{title:d.kind==='interruption'?'服务中止核实':'独立服务争议',status:done?'done':open?'open':'waiting',statusLabel:done?'争议已处理':d.status==='verifying'?'待核实中止事实':d.status==='open'?'待处理争议':d.status==='awaiting-user'?'等待用户确认退款':'等待关联退款完成',createdAt:finite(d.createdAt),dueAt:finite(d.deadline),sourceToken:token([d.id,d.status,d.deadline,d.escalatedTo,d.overdueAt,d.refundId,d.reviewedAt,d.resolvedAt,d.closedAt]),commands:open?[d.kind==='interruption'?'booking.dispute-review':'booking.dispute-close']:[]}));
    }
  }
  for(const h of s.safety || []) {
    const b=(s.bookings || []).find(x=>x.id===h.bookingId);if(!b) continue;
    const closed=h.status==='closed',acknowledged=h.acknowledgedAt!=null;
    const responsible=h.responsibility||(acknowledged?h.acknowledgedBy:null);
    rows.push(row(b,'safety',h.id,'handle',{title:'安全求助处理',status:closed?'done':'open',statusLabel:closed?'安全事件已结案':acknowledged?'已接报，待处置':h.stage==='unanswered'?'升级后仍未接报':h.stage==='escalated'?'已升级集团，待接报':'待接报',createdAt:finite(h.createdAt),dueAt:acknowledged||closed?null:h.stage==='pending'?finite(h.ackDeadline):finite(h.escalationDeadline),sourceToken:token([h.id,h.status,h.stage,h.ackDeadline,h.escalationDeadline,h.acknowledgedAt,h.closedAt,h.disputeId,responsible?.accountId,responsible?.grantId,responsible?.accountVersion,h.responsibility?.version]),requiredRoute:'safety',assignmentMode:'source',nativeOwnerName:h.responsibility?.name || h.responsibleName || '',nativeOwnerAccountId:responsible?.accountId&&responsible?.grantId?responsible.accountId:null,nativeOwnerGrantId:responsible?.accountId&&responsible?.grantId?responsible.grantId:null,nativeOwnerAccountVersion:responsible?.accountVersion??null,commands:closed?[]:acknowledged?['booking.help-close']:['booking.help-ack','booking.help-close']}));
  }
  return rows;
}
