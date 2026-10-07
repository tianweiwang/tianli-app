import test from 'node:test';
import assert from 'node:assert/strict';
import {goodsTaskRows} from './work-goods.mjs';
const order=()=>({id:'GD1',createdAt:10,status:'paid',payment:{status:'success'},source:{storeId:'xingfu'},cases:[],refunds:[]});
test('shipping waits for active aftersale and never assigns fulfilment to promotion store',()=>{
 const o=order();o.cases.push({id:'AS1',status:'requested',createdAt:11,reason:'private body'});
 const rows=goodsTaskRows({goods:[o]});assert.equal(rows[0].status,'waiting');assert.deepEqual(rows[0].manageRoles,['group']);assert.equal(rows[1].status,'open');assert.equal(JSON.stringify(rows).includes('private body'),false);assert.equal(rows[0].dueAt,null);
 o.cases[0].status='rejected';assert.equal(goodsTaskRows({goods:[o]})[0].status,'open');o.status='shipped';assert.equal(goodsTaskRows({goods:[o]})[0].status,'done');
});
test('refund failure and processing keep separate actual finance commands until source completes',()=>{
 const o=order();o.cases=[{id:'AS1',status:'refund_failed'}];let row=goodsTaskRows({goods:[o]})[1];assert.equal(row.status,'open');assert.deepEqual(row.commands,['goods.refund']);assert.deepEqual(row.allowedJobs.group,['finance']);
 o.cases[0].status='refunding';row=goodsTaskRows({goods:[o]})[1];assert.equal(row.status,'open');assert.deepEqual(row.commands,['goods.refund-query']);
 o.cases[0].status='done';assert.equal(goodsTaskRows({goods:[o]})[1].status,'done');
});
test('goods disputes and return disposal stay on original responsible jobs',()=>{
 const o=order();o.cases=[{id:'AS1',status:'inspection_disputed'}];assert.equal(goodsTaskRows({goods:[o]})[1].status,'waiting');
 o.cases[0].status='inspection_review';assert.deepEqual(goodsTaskRows({goods:[o]})[1].commands,['goods.inspection-resolve']);
 o.cases[0].status='awaiting_return_to_customer';assert.deepEqual(goodsTaskRows({goods:[o]})[1].commands,['goods.return-back']);
});
