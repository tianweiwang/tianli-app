// Goods remain group-fulfilled. Promotion attribution never grants fulfilment rights.
import { goodsShippingBlocked } from './goods-exceptions.mjs';
const terminal = new Set(['done','closed','rejected','refunded','completed','resolved']);
export function goodsTaskRows(s) {
  const rows=[];
  for(const o of s.goods || []) {
    const active=(o.cases || []).filter(c=>!terminal.has(c.status));
    const base={storeId:o.source?.storeId || null,sourceId:o.id,requiredRoute:'goods',routes:{group:`/group/goods/${encodeURIComponent(o.id)}`,store:`/store/goods/${encodeURIComponent(o.id)}`},manageRoles:['group'],assignmentMode:'task',createdAt:o.createdAt,dueAt:null};
    if(o.payment?.status==='success' || ['paid','shipped','received','closed'].includes(o.status)) {
      const shipped=!!o.shipment || ['shipped','received'].includes(o.status),ended=['closed','cancelled'].includes(o.status);
      const blocked=goodsShippingBlocked(o),status=shipped||ended?'done':blocked?'waiting':'open';
      rows.push({...base,id:`goods:${o.id}:ship`,category:'goods-shipping',title:'商品发货',status,statusLabel:shipped?'已发货':ended?'订单已结束':blocked?'售后处理后再发货':'待集团发货',sourceToken:JSON.stringify([o.status,o.payment?.status,active.map(c=>[c.id,c.status])]),allowedJobs:{group:['warehouse'],store:['store-manager','store-finance']},commands:['goods.ship']});
    }
    for(const c of o.cases || []) {
      const refund=(o.refunds || []).find(r=>r.caseId===c.id),finished=terminal.has(c.status);
      let jobs=['support'],commands=[],status=finished?'done':'waiting',label='等待用户寄回';
      if(c.status==='requested') {status='open';label='待客服受理';commands=['goods.case-review'];}
      if(c.status==='partial_received') {status='open';label='部分实收已登记，待客服协商';commands=['goods.partial-propose'];}
      if(c.status==='partial_confirmation') {label='等待用户确认部分退货方案';}
      if(['returning','returned','awaiting_return_disposition'].includes(c.status)) {status='open';label=c.status==='awaiting_return_disposition'?'待仓储处置':'待验收入库';jobs=['warehouse'];commands=['goods.inspect'];}
      if(c.status==='inspection_review') {status='open';label='待客服复核验收申诉';commands=['goods.inspection-resolve'];}
      if(c.status==='awaiting_return_to_customer') {status='open';label='待仓储返还货物';jobs=['warehouse'];commands=['goods.return-back'];}
      if(c.status==='inspection_disputed') label='等待用户确认验收';
      if(c.status==='return_to_customer_shipping') {label='等待用户确认返还收货';jobs=['warehouse'];}
      if(['refund_ready','refund_failed','refunding','processing','refund_processing'].includes(c.status)) {
        jobs=['finance'];status='open';
        const processing=['refunding','processing','refund_processing'].includes(c.status)||refund?.status==='processing';
        label=processing?'退款处理中，待查询':c.status==='refund_failed'?'退款失败，待重试':'待执行退款';commands=[processing?'goods.refund-query':'goods.refund'];
      }
      if(finished) {label=c.status==='rejected'?'申请已驳回':'售后已结束';jobs=['support','warehouse','finance'];}
      rows.push({...base,id:`goods-case:${c.id}:handling`,category:'goods-aftersale',title:'商品售后',sourceId:c.id,orderId:o.id,createdAt:c.createdAt,status,statusLabel:label,sourceToken:JSON.stringify([c.status,c.version||0,refund?.status,refund?.id]),allowedJobs:{group:jobs,store:['store-manager','store-finance']},commands});
    }
    for(const incident of o.incidents || []) {
      const status=incident.status==='done'?'done':incident.status==='open'?'open':'waiting';
      const label={open:'待集团协调',awaiting_user:'等待用户确认处理方案',waiting:'持续跟进，等待履约或售后结果',done:'原业务结果已确认'}[incident.status] || '待集团核实';
      rows.push({...base,id:`goods-incident:${incident.id}:handling`,category:'goods-exception',title:'物流与退货异常',sourceId:incident.id,orderId:o.id,createdAt:incident.createdAt,dueAt:Number.isFinite(incident.dueAt)?incident.dueAt:null,status,statusLabel:label,sourceToken:JSON.stringify([incident.version,incident.status,incident.caseId,incident.proposal?.status,incident.proposal?.resolution,incident.dueAt]),allowedJobs:{group:['support','warehouse'],store:['store-manager','store-finance']},commands:status==='done'?[]:['goods.incident-note','goods.incident-propose']});
    }
  }
  return rows;
}
