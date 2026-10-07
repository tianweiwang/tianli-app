// Additive schema-5 management model. Existing orders and stock are never reset.
import { upgradeQualifications, qualificationEligibility } from './tech-qualification.mjs';
import { actorAccountFields } from './staff-accounts.mjs';
import { assertLifecycleStoreStatus } from './organization-lifecycle-pause.mjs';
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const str = (v, label, max = 300, optional = false) => { const t = String(v ?? '').trim(); if ((!t && !optional) || t.length > max) fail(`请填写${label}（最多${max}字）。`); return t; };
const num = (v, label, min = 0, max = 100000000) => { if (v === '' || v == null || !Number.isSafeInteger(Number(v)) || Number(v) < min || Number(v) > max) fail(`${label}须为${min}至${max}的整数。`); return Number(v); };
const bool = v => v === true || v === 'true' || v === 'on';
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
const OPEN = ['unpaid', 'waiting', 'confirmed', 'active'];
export const JOBS = { all: '集团管理员', operations: '商品与门店运营', warehouse: '仓储', finance: '财务', support: '客服' };
export const DEFAULT_RULES = { version: 1, earliestHours: 2, maxDays: 7, dispatchMinutes: 30, beforeStartMinutes: 60, extensionLimit: 2, extensionHoldMinutes: 5 };
const views = { operations: ['dashboard', 'tasks', 'catalog', 'categories', 'services', 'stores', 'technicians', 'qualifications', 'rules', 'management-log'], warehouse: ['dashboard', 'tasks', 'inventory', 'goods', 'returns', 'management-log'], finance: ['dashboard', 'tasks', 'bookings', 'goods', 'bills', 'recoveries', 'invoices', 'service-finance', 'management-log'], support: ['dashboard', 'tasks', 'operations', 'busy', 'bookings', 'safety', 'goods', 'returns', 'care', 'reviews', 'qualifications', 'handoffs', 'privacy', 'management-log'] };
export function canManageView(actor, route) {
  if(route==='quality-policies')return actor.role==='group'&&actor.job==='support'&&Boolean(actor.accountId&&actor.grantId&&actor.sessionId)&&!actor.lifecyclePurpose;
  if(route==='penalties')return ['tech','manager'].includes(actor.role)||actor.role==='group'&&(!actor.job||['all','support'].includes(actor.job))||actor.role==='store'&&(!actor.job||['all','store-manager'].includes(actor.job));
  if(route==='service-promotion') return ['user','tech'].includes(actor.role)||actor.role==='group'&&['all','finance','support','operations'].includes(actor.job)||actor.role==='store'&&['store-manager','store-finance'].includes(actor.job);
  return actor.role !== 'group' || !actor.job || actor.job === 'all' || (views[actor.job] || []).includes(route) || (route === 'fulfilment' && actor.job === 'support') || (route === 'goods-logistics' && actor.job === 'operations') || (['commodity-invoices','fee-invoices','commerce-invoice-rules'].includes(route) && actor.job === 'finance') || (['reports','work-escalations'].includes(route) && Boolean(views[actor.job])) || route === 'guide';
}
export function assertJob(actor, type) {
  if(type.startsWith('quality.')) {
    if(!['quality.policy-publish','quality.policy-withdraw'].includes(type)||actor.role!=='group'||actor.job!=='support'||!actor.accountId||!actor.grantId||!actor.sessionId||actor.lifecyclePurpose)fail('当前岗位无权发布或撤回质量政策。');
    return;
  }
  if(type.startsWith('penalty.')) {
    if(actor.role==='group' && (type!=='penalty.appeal-review'||actor.job&&!['all','support'].includes(actor.job)))fail('当前岗位无权办理技师处罚申诉。');
    return;
  }
  if (type.startsWith('lifecycle.')) {
    if (['lifecycle.store-pause','lifecycle.store-pause-cancel'].includes(type) && ['store','manager'].includes(actor.role) && (!actor.job || actor.job==='store-manager')) return;
    const expected=type==='lifecycle.identity-link'?'account-admin':'operations';
    if (actor.role!=='group' || (actor.job && actor.job!=='all' && actor.job!==expected)) fail('当前岗位无权办理此组织变更。'); return;
  }
  if (actor.role !== 'group' || !actor.job || actor.job === 'all' || type === 'clock.advance') return;
  if (type === 'report.export') { if (!views[actor.job]) fail('当前岗位无权导出经营报表。'); return; }
  if (type.startsWith('work-escalation.')) { if (!views[actor.job]) fail('当前岗位无权协调待办责任。'); return; }
  if (type.startsWith('commerce-invoice.')) { if (actor.job !== 'finance') fail('当前岗位无权办理集团票据。'); return; }
  if (type.startsWith('service-extra.')) { if (actor.job !== 'finance') fail('当前岗位无权办理服务资金特殊事项。'); return; }
  if (type.startsWith('service-promotion.')) {
    const command=type.slice('service-promotion.'.length), jobs=['policy-publish','rule-publish','withdraw-pay','withdraw-query','recovery-receive','recovery-return','recovery-loss'].includes(command)?['finance']:['identity-review','risk-review'].includes(command)?['support']:command==='agreement-publish'?['support','operations']:['invite','disable'].includes(command)?['operations']:[];
    if(!jobs.includes(actor.job)) fail('当前岗位无权办理此服务推广操作。'); return;
  }
  if (type.startsWith('fulfilment.')) { if (actor.job !== 'support') fail('当前岗位无权办理履约与安全事项。'); return; }
  if (type.startsWith('goods-logistics.')) { const jobs=type==='goods-logistics.policy-publish'?['operations']:type==='goods-logistics.delivery-verify'?['support']:type==='goods-logistics.delivery-record'?['warehouse','support']:[]; if(!jobs.includes(actor.job)) fail('当前岗位无权发布物流配置或登记核实送达。'); return; }
  if (['goods.incident-open','goods.incident-note'].includes(type)) { if (!['support','warehouse'].includes(actor.job)) fail('当前演示岗位无权跟进商品异常。'); return; }
  if (['goods.incident-propose','goods.incident-verify','goods.partial-propose'].includes(type)) { if (actor.job !== 'support') fail('当前演示岗位无权核实或协商商品异常方案。'); return; }
  if (type === 'goods.inspect-partial') { if (actor.job !== 'warehouse') fail('当前演示岗位无权登记退货实收。'); return; }
  if (['work.claim','work.assign'].includes(type)) { if (!views[actor.job]) fail('当前岗位无权分派待办。'); return; }
  if (type === 'sensitive.reveal' || type.startsWith('privacy.')) { if (actor.job !== 'support') fail('当前岗位无权办理隐私或查看完整联系方式。'); return; }
  if (type.startsWith('handoff.')) { if (actor.job !== 'support') fail('当前演示岗位无权处理服务交接。'); return; }
  if (type.startsWith('qualification.')) { if (actor.job !== 'operations' && !(actor.job === 'support' && type === 'qualification.pause')) fail('当前演示岗位无权执行此资格操作。'); return; }
  if (/^(finance\.|tech-income\.)/.test(type)) { if (actor.job !== 'finance') fail('当前演示岗位无权执行服务资金操作。'); return; }
  if (/^(review\.|care\.)/.test(type)) { if (actor.job !== 'support') fail('当前演示岗位无权处理评价与质量反馈。'); return; }
  const job = type.startsWith('manage.inventory') ? 'warehouse' : type.startsWith('manage.') ? 'operations' : ['goods.ship', 'goods.inspect', 'goods.return-back'].includes(type) ? 'warehouse' : /^(bill\.|recovery\.|goods.refund|booking.refund-pay|booking.refund-query)/.test(type) ? 'finance' : /^(goods.case-review|goods.inspection-resolve|booking\.|goods.appeal)/.test(type) ? 'support' : null;
  if (job !== actor.job) fail('当前演示岗位无权执行此操作，请切换有权限的集团岗位。');
}
export function imageSource(value) {
  const v = str(value, '图片地址', 420000, true);
  if (!v) return '';
  if (/^media:[a-zA-Z0-9-]+$/.test(v) || /^\.\.\/reference-demos\/franchise-demo\/products\/[\w-]+\.svg$/.test(v) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return v;
  fail('图片请使用提供的商品素材或上传 PNG、JPG、WebP（单张最多300KB）。');
}
export function upgradeManagement(s) {
  if (s.managementVersion === 1) return s;
  s.categories ??= [{ id: 'daily', name: '日常护理', sort: 10, active: true, version: 1, events: [] }, { id: 'food', name: '营养食品', sort: 20, active: true, version: 1, events: [] }];
  s.products ??= [];
  for (const sku of s.skus) {
    sku.productId ??= ['oil', 'oil-small'].includes(sku.id) ? 'product-oil' : `product-${sku.id}`;
    sku.enabled ??= sku.active; sku.version ??= 1; sku.lowStock ??= 5;
    let category = s.categories.find(c => c.name === sku.category);
    if (!category) { category = { id: `category-${s.categories.length + 1}`, name: sku.category || '其他', sort: 30, active: true, version: 1, events: [] }; s.categories.push(category); }
    if (!s.products.some(p => p.id === sku.productId)) s.products.push({ id: sku.productId, name: sku.name, categoryId: category.id, image: sku.image || '', gallery: [], description: sku.description || '商品由集团统一销售及发货，请按商品包装说明使用。', status: sku.active ? 'published' : 'draft', version: 1, updatedAt: s.now, history: [], events: [] });
  }
  s.inventoryLedger ??= s.skus.map(k => ({ id: `opening-${k.id}`, skuId: k.id, kind: 'opening', before: 0, delta: k.stock, after: k.stock, at: s.now, reference: '旧版存档结转', reason: '管理功能启用时的实物余额；此前流水保留在原订单中', actor: 'system' }));
  s.managementRequests ??= [];
  s.bookingRules ??= { ...DEFAULT_RULES, history: [], events: [] };
  for (const service of s.services) { service.version ??= 1; service.active ??= true; service.extensionMinutes ??= 30; service.description ??= service.id === 'neck' ? '适合久坐后的日常放松' : '全身舒缓与日常放松'; service.events ??= []; service.history ??= []; }
  for (const store of s.stores) { store.version ??= 1; store.radiusKm ??= 20; store.reviewStatus ??= 'approved'; store.events ??= []; }
  for (const tech of s.techs) { tech.version ??= 1; tech.reviewStatus ??= 'approved'; tech.events ??= []; }
  for (const b of s.bookings) {
    b.serviceSnapshot ??= serviceSnapshot(s.services.find(x => x.id === b.serviceId));
    b.rulesSnapshot ??= { ...DEFAULT_RULES };
    b.storeSnapshot ??= { name: s.stores.find(x => x.id === b.storeId)?.name };
    b.techSnapshot ??= { name: s.techs.find(x => x.id === b.techId)?.name };
  }
  s.managementVersion = 1;
  return s;
}
export function serviceSnapshot(x) {
  if (!x) return null;
  return Object.fromEntries(['id', 'name', 'duration', 'priceCents', 'nightCents', 'extensionMinutes', 'extensionCents', 'description', 'version'].map(k => [k, x[k]]));
}
export function stockSummary(s, skuId) {
  const k = s.skus.find(x => x.id === skuId);
  const orders = s.goods.filter(o => ['unpaid', 'paid'].includes(o.status)).map(o => ({ id: o.id, status: o.status, qty: o.lines.filter(l => l.skuId === skuId).reduce((v, l) => v + l.qty - (l.cancelledQty || 0), 0) })).filter(x => x.qty > 0);
  const unpaid = orders.filter(o => o.status === 'unpaid').reduce((v, o) => v + o.qty, 0), paid = orders.filter(o => o.status === 'paid').reduce((v, o) => v + o.qty, 0);
  return { physical: k?.stock || 0, unpaid, paid, held: unpaid + paid, available: (k?.stock || 0) - unpaid - paid, orders };
}
export function stockMove(s, sku, delta, kind, reference, reason, actor, ctx) {
  const before = sku.stock;
  sku.stock += delta; sku.stockVersion = (sku.stockVersion || 1) + 1;
  s.inventoryLedger.push({ id: ctx.id('ST'), skuId: sku.id, kind, before, delta, after: sku.stock, reference, reason, at: s.now, actor: actor.role === 'group' ? actor.job || 'all' : actor.role, ...actorAccountFields(actor) });
}
export function technicianImportPreview(s, storeId, content) {
  const lines = String(content || '').trim().split(/\r?\n/).filter(x=>x.trim());
  if (/^姓名[\t,]/.test(lines[0] || '')) lines.shift();
  if (!lines.length || lines.length > 50) return { rows: [], errors: ['请填写1至50行人员资料。'] };
  const store = s.stores.find(x=>x.id===storeId), seen = new Set();
  const rows = lines.map((line,i) => {
    const [name,phone,gender,projects,certificate,insurance,validUntil,...extra] = line.split(line.includes('\t')?'\t':',').map(v=>v.trim());
    const serviceIds = (projects||'').split(/[;；]/).filter(Boolean), errors = [];
    if (extra.length || !name || name.length>40) errors.push('姓名或列数无效');
    if (!/^1\d{10}$/.test(phone||'')) errors.push('手机号须11位');
    if (seen.has(phone) || s.techs.some(x=>x.phone===phone)) errors.push('手机号重复'); seen.add(phone);
    if (!['男','女','male','female'].includes(gender)) errors.push('性别填男或女');
    if (!store || !serviceIds.length || serviceIds.some(id=>!store.serviceIds.includes(id))) errors.push('项目须属于所选门店');
    if (validUntil && !validDate(validUntil)) errors.push('日期使用有效的YYYY-MM-DD');
    return { line:i+1, name, phone, gender:['男','male'].includes(gender)?'male':'female',serviceIds,certificate:certificate||'',insurance:insurance||'',validUntil:validUntil||'',errors };
  });
  return { rows, errors: rows.flatMap(r=>r.errors.map(message=>`第${r.line}行：${message}`)) };
}
// A pending offer reserves its candidate as well as retaining the old arrangement.
// All organization edits must protect both commitments until the offer is resolved.
const arrangements = b => b.change?.status === 'pending' ? [b, { ...b, ...b.change }] : [b];
export function affectedBookings(s, key, id) { return s.bookings.filter(b => OPEN.includes(b.status) && arrangements(b).some(a => a[key] === id)); }
export function storeOpeningReadiness(s, store) {
  if (!store) return { ready: false, missing: ['门店档案'], technicianIds: [] };
  const missing = [];
  for (const [key, label] of [['contact', '负责人'], ['phone', '电话'], ['qualification', '资质'], ['merchantNo', '收款主体']]) if (!String(store[key] || '').trim()) missing.push(label);
  const serviceIds = (store.serviceIds || []).filter(id => s.services.some(x => x.id === id && x.active !== false));
  if (!serviceIds.length) missing.push('启用的预约项目');
  const technicianIds = s.techs.filter(t => t.storeId === store.id && t.active && t.reviewStatus === 'approved' && t.certificate && t.insurance && validDate(t.validUntil) && Date.parse(t.validUntil + 'T23:59:59+08:00') >= s.now && t.serviceIds.some(id => serviceIds.includes(id) && qualificationEligibility(s,t.id,id).allowed)).map(t => t.id);
  if (!technicianIds.length) missing.push('至少1名在岗、资料及独立项目资格通过、证书及保单有效的技师');
  return { ready: missing.length === 0, missing, technicianIds };
}
export function productImpact(s, productId) {
  const ids = s.skus.filter(k => k.productId === productId).map(k => k.id);
  return { carts: Object.values(s.carts).filter(c => c.some(l => ids.includes(l.skuId))).length, orders: s.goods.filter(o => o.lines.some(l => ids.includes(l.skuId)) && !['closed', 'cancelled'].includes(o.status)).length };
}
function materialize(s, product) {
  for (const k of s.skus.filter(k => k.productId === product.id)) Object.assign(k, { name: product.name, category: s.categories.find(c => c.id === product.categoryId)?.name || '', image: product.image, description: product.description, active: product.status === 'published' && k.enabled });
}
function validProduct(s, product) {
  str(product.name, '商品名称', 60); str(product.description, '商品详情', 3000);
  if (!product.image) fail('发布前请添加商品主图。');
  if (!s.categories.some(c => c.id === product.categoryId && c.active)) fail('发布前请选择已启用的分类。');
  const skus = s.skus.filter(k => k.productId === product.id && k.enabled);
  if (!skus.length) fail('发布前请新增至少一条启用的商品规格。');
  for (const k of skus) { str(k.spec, '规格名称', 50); num(k.priceCents, '售价（分）', 1); num(k.commissionBps, '佣金比例（基点）', 0, 10000); }
}
const simpleSnapshot = entity => Object.fromEntries(Object.entries(entity).filter(([k]) => !['history', 'events'].includes(k)));
export function managementCommand(s, actor, type, p, ctx) {
  upgradeQualifications(s);
  const group = actor.role === 'group', local = ['store', 'manager'].includes(actor.role);
  if (!group && !(local && ['manage.store-save', 'manage.tech-save', 'manage.tech-import'].includes(type))) fail('当前身份无权管理这些资料。');
  assertJob(actor, type);
  const requestId = str(p.requestId, '本次操作标识', 150);
  const identity = actorAccountFields(actor), actorKey = `${actor.role}:${actor.storeId || ''}:${actor.job || ''}` + (identity.accountId ? `:${identity.accountId}:${identity.grantId}` : '');
  const signature = JSON.stringify({ type, p });
  const old = s.managementRequests.find(r => r.requestId === requestId && r.actor === actorKey);
  if (old) { if (old.signature !== signature) fail('操作标识已使用，请刷新后重试。'); return; }
  const reason = str(p.reason, '操作原因');
  const version = entity => { if (entity && Number(p.version) !== entity.version) fail('资料已被其他页面更新。已保留本页草稿，请核对最新版本后重新编辑。'); };
  const save = (entity, message) => { entity.version = (entity.version || 0) + 1; entity.updatedAt = s.now; ctx.log(entity, `${message} · ${reason}`); };
  const history = entity => { entity.history ??= []; entity.history.push({ version: entity.version, at: s.now, actor: actor.job || actor.role, ...identity, reason, data: simpleSnapshot(entity) }); };
  const productHistory = entity => { entity.history ??= []; entity.history.push({ version: entity.version, at: s.now, actor: actor.job || actor.role, ...identity, reason, data: { ...simpleSnapshot(entity), skus: s.skus.filter(k => k.productId === entity.id).map(simpleSnapshot) } }); };
  const ids = value => [...new Set(Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean))];
  const services = value => { const list = ids(value); if (list.some(id => !s.services.some(x => x.id === id))) fail('包含不存在的预约项目。'); return list; };
  const locate = (arr, id, label) => { const entity = arr.find(x => x.id === id); if (!entity) fail(`${label}不存在。`); return entity; };
  const guardOpen = (key, id) => { const open = affectedBookings(s, key, id); if (open.length) fail(`还有${open.length}笔在途预约，请先按影响清单处理后再停用或更换归属。`); };
  const coord = (value, label, min, max) => { const n = Number(value); if (value === '' || !Number.isFinite(n) || n < min || n > max) fail(`${label}无效。`); return n; };
  if (type === 'manage.product-save') {
    let entity = p.id ? locate(s.products, p.id, '商品') : null; version(entity);
    const data = { name: str(p.name, '商品名称', 60, true), categoryId: String(p.categoryId || ''), description: str(p.description, '商品详情', 3000, true), image: imageSource(p.image), gallery: (p.gallery || []).filter(Boolean).map(imageSource) };
    if (data.gallery.length > 4) fail('最多添加4张详情图片。');
    if (data.categoryId && !s.categories.some(c => c.id === data.categoryId)) fail('分类不存在。');
    if (!entity) { entity = { id: ctx.id('PD'), status: 'draft', version: 0, events: [], history: [] }; s.products.push(entity); } else productHistory(entity);
    Object.assign(entity, data); if (entity.status === 'published') validProduct(s, entity);
    save(entity, '保存商品资料'); materialize(s, entity);
  } else if (type === 'manage.sku-save') {
    const product = locate(s.products, p.productId, '商品'); version(product);
    let k = p.id ? locate(s.skus, p.id, '规格') : null;
    if (k && k.productId !== product.id) fail('规格不属于该商品。');
    const spec = str(p.spec, '规格名称', 50);
    if (s.skus.some(x => x.productId === product.id && x.id !== p.id && x.spec.toLowerCase() === spec.toLowerCase())) fail('该商品内规格名称不能重复。');
    const data = { spec, priceCents: num(p.priceCents, '售价（分）', 1), commissionBps: num(p.commissionBps, '佣金比例（基点）', 0, 10000), enabled: bool(p.enabled), lowStock: num(p.lowStock, '低库存提醒值', 0, 100000) };
    productHistory(product);
    if (!k) { k = { id: ctx.id('SKU'), productId: product.id, stock: 0, stockVersion: 1, version: 0 }; s.skus.push(k); }
    Object.assign(k, data); k.version++;
    if (product.status === 'published') validProduct(s, product);
    save(product, `维护规格 ${spec}，售价及佣金仅对新订单生效`); materialize(s, product);
  } else if (type === 'manage.product-status') {
    const entity = locate(s.products, p.id, '商品'); version(entity);
    if (!['published', 'offline'].includes(p.status)) fail('销售状态无效。');
    if (p.status === 'published') validProduct(s, entity);
    productHistory(entity); entity.status = p.status; save(entity, p.status === 'published' ? '发布商品' : '下架商品，历史订单保留履约'); materialize(s, entity);
  } else if (type === 'manage.category-save') {
    let entity = p.id ? locate(s.categories, p.id, '分类') : null; version(entity);
    const name = str(p.name, '分类名称', 30), active = bool(p.active);
    if (s.categories.some(c => c.id !== p.id && c.name === name)) fail('分类名称已存在。');
    if (!active && s.products.some(x => x.categoryId === p.id && x.status === 'published')) fail('此分类仍有关联的上架商品，请先迁移分类或下架相关商品。');
    if (!entity) { entity = { id: ctx.id('CT'), version: 0, events: [] }; s.categories.push(entity); }
    Object.assign(entity, { name, active, sort: num(p.sort, '分类排序', 0, 9999) }); save(entity, '维护商品分类');
    for (const product of s.products.filter(x => x.categoryId === entity.id)) materialize(s, product);
  } else if (type === 'manage.inventory') {
    const k = locate(s.skus, p.skuId, '规格');
    if (Number(p.stockVersion) !== (k.stockVersion || 1)) fail('库存已变化，请核对最新账面数量后重新提交。');
    if (!['receive', 'count', 'damage'].includes(p.kind)) fail('库存操作无效。');
    const quantity = num(p.quantity, p.kind === 'count' ? '实盘数' : '数量', p.kind === 'count' ? 0 : 1);
    const delta = p.kind === 'count' ? quantity - k.stock : p.kind === 'damage' ? -quantity : quantity;
    if (k.stock + delta < stockSummary(s, k.id).held) fail('调整后实物少于有效订单占用，需先协调缺货订单，不能直接扣减。');
    stockMove(s, k, delta, p.kind, str(p.reference, '入库来源或盘点凭证', 100), reason, actor, ctx);
    ctx.log({ id: k.id }, `库存${{ receive: '入库', count: '盘点', damage: '报损' }[p.kind]} ${delta > 0 ? '+' : ''}${delta}，结存${k.stock} · ${reason}`);
  } else if (type === 'manage.service-save') {
    let x = p.id ? locate(s.services, p.id, '预约项目') : null; version(x);
    const data = { name: str(p.name, '项目名称', 40), duration: num(p.duration, '项目分钟数', 15, 240), priceCents: num(p.priceCents, '日间价格（分）', 1), nightCents: num(p.nightCents, '夜间价格（分）', 1), extensionMinutes: num(p.extensionMinutes, '加时分钟数', 15, 120), extensionCents: p.extensionCents === '' || p.extensionCents == null ? null : num(p.extensionCents, '加时价格（分）', 1), description: str(p.description, '项目说明', 1000), active: bool(p.active) };
    if (data.duration % 15 || data.extensionMinutes % 15) fail('项目时长和加时单位须为15分钟的整数倍。');
    if (!x) { x = { id: ctx.id('SV'), version: 0, history: [], events: [] }; s.services.push(x); } else history(x);
    Object.assign(x, data); save(x, '保存预约项目，新价格对新预约生效');
  } else if (type === 'manage.store-save') {
    let x = p.id ? locate(s.stores, p.id, '门店') : null; version(x);
    if (x?.lifecycleStatus==='closed' || x?.closedAt!=null) fail('已关闭门店档案只读，历史事项由原主体限定承接。');
    if (!group && (!x || x.id !== actor.storeId)) fail('只能维护本店资料。');
    const serviceIds = services(p.serviceIds), region = locate(s.regions, p.regionId, '片区');
    const data = { name: str(p.name, '门店名称', 60), address: str(p.address, '门店地址', 150), phone: str(p.phone, '联系电话', 30), contact: str(p.contact, '负责人', 40), regionId: region.id, lat: coord(p.lat, '纬度', -90, 90), lng: coord(p.lng, '经度', -180, 180), serviceIds, radiusKm: coord(p.radiusKm, '服务半径', 0.1, 200), bufferMinutes: num(p.bufferMinutes, '后置缓冲分钟', 0, 120), qualification: str(p.qualification, '资质记录', 150, true), merchantNo: str(p.merchantNo, '收款主体记录', 100, true) };
    if (x && affectedBookings(s, 'storeId', x.id).some(b => arrangements(b).some(a => a.storeId === x.id && !serviceIds.includes(a.serviceId)) || data.bufferMinutes !== x.bufferMinutes)) fail('门店有在途预约，不能移除对应项目或改变缓冲，请先处理影响订单。');
    if (x?.active) {
      if (!data.qualification || !data.merchantNo || !serviceIds.some(id => s.services.some(v => v.id === id && v.active !== false))) fail('营业门店须保留完整资质、收款主体和启用的预约项目；请补齐资料，或先暂停营业再编辑。');
      if (['qualification', 'merchantNo'].some(key => x[key] && x[key] !== data[key])) fail('变更营业门店的资质或收款主体前，请先暂停营业；保存后需由集团重新审核营业。');
    }
    if (!x) { x = { id: ctx.id('STORE'), version: 0, active: false, promotionDisabled: true, reviewStatus: 'pending', events: [] }; s.stores.push(x); }
    const sensitiveChanged = ['qualification', 'merchantNo'].some(key => x[key] !== data[key]);
    Object.assign(x, data); if (!x.active && sensitiveChanged) { x.reviewStatus = 'pending'; x.promotionDisabled = true; } save(x, '保存门店资料');
  } else if (type === 'manage.store-status') {
    const x = locate(s.stores, p.id, '门店'); version(x);
    if (['closing','closed'].includes(x.lifecycleStatus) || x.closedAt!=null) fail('门店正在关停或已关闭，不能从营业维护重开。');
    if (!['open', 'pause', 'promotion-on', 'promotion-off'].includes(p.status)) fail('门店操作无效。');
    assertLifecycleStoreStatus(s,x.id,p.status);
    if (p.status === 'open') { const readiness = storeOpeningReadiness(s, x); if (!readiness.ready) fail('营业前请补齐：' + readiness.missing.join('、') + '。'); x.active = true; x.reviewStatus = 'approved'; }
    if (p.status === 'pause') { guardOpen('storeId', x.id); x.active = false; }
    if (p.status.startsWith('promotion')) { if (p.status === 'promotion-on' && x.reviewStatus !== 'approved') fail('门店资料审核通过后才能启用推广。'); x.promotionDisabled = p.status === 'promotion-off'; }
    save(x, `${{open:'门店审核通过并营业',pause:'暂停预约营业','promotion-on':'启用商品推广','promotion-off':'停止商品推广'}[p.status]}，已锁定商品来源保留`);
  } else if (type === 'manage.tech-import') {
    const store = locate(s.stores,p.storeId,'门店'); if(!group && store.id!==actor.storeId)fail('只能导入本店技师。');
    const preview = technicianImportPreview(s,store.id,p.content); if(preview.errors.length)fail(preview.errors.join('；'));
    for(const row of preview.rows) managementCommand(s,actor,'manage.tech-save',{...row,storeId:store.id,lat:store.lat,lng:store.lng,requestId:requestId+'-'+row.line,reason},ctx);
  } else if (type === 'manage.tech-save') {
    let x = p.id ? locate(s.techs, p.id, '技师') : null; version(x);
    const store = locate(s.stores, p.storeId, '门店'), serviceIds = services(p.serviceIds);
    if (store.lifecycleStatus==='closed' || store.closedAt!=null || x?.lifecycleStatus==='left' || !x && store.lifecycleStatus==='closing') fail('已结束工作主体不能继续维护或新增人员。');
    if (!group && (store.id !== actor.storeId || (x && x.storeId !== actor.storeId))) fail('只能维护本店技师。');
    if (x && store.id !== x.storeId) fail('跨店调动须走调店流程，本页保留原所属门店。');
    if (serviceIds.some(id => !store.serviceIds.includes(id))) fail('技师项目须属于门店经营项目。');
    if (x && affectedBookings(s, 'techId', x.id).some(b => arrangements(b).some(a => a.techId === x.id && !serviceIds.includes(a.serviceId)))) fail('有在途预约使用此项目，不能直接移除资格。');
    const phone = str(p.phone, '手机号', 11); if (!/^1\d{10}$/.test(phone)) fail('请输入11位手机号。');
    if (s.techs.some(t => t.id !== p.id && t.phone === phone)) fail('手机号已对应另一位技师，请核对档案。');
    if (!['male', 'female'].includes(p.gender)) fail('请选择性别。');
    if (x && x.gender !== p.gender && affectedBookings(s, 'techId', x.id).some(b => arrangements(b).some(a => a.techId === x.id && a.genderPreference && a.genderPreference !== 'any' && a.genderPreference !== p.gender))) fail('性别变更不符合在途预约或待确认候选的用户偏好，请先按影响清单协调预约，再修改档案。');
    const data = { name: str(p.name, '技师姓名', 40), phone, gender: p.gender, storeId: store.id, serviceIds, lat: coord(p.lat, '纬度', -90, 90), lng: coord(p.lng, '经度', -180, 180), certificate: str(p.certificate, '证书记录', 150, true), insurance: str(p.insurance, '保单记录', 150, true), validUntil: str(p.validUntil, '资质有效期', 10, true) };
    if (data.validUntil && !validDate(data.validUntil)) fail('资质有效期无效。');
    if (!x) { x = { id: ctx.id('TECH'), qualificationRequired: true, legacyQualifiedServiceIds: [], active: false, reviewStatus: 'pending', version: 0, rating: null, count: 0, events: [] }; s.techs.push(x); s.schedules ??= {}; s.schedules[x.id] = { start:'09:00',end:'23:00',breakStart:'12:00',breakEnd:'13:00',dates:{} }; }
    const credentialsChanged = ['certificate', 'insurance', 'validUntil'].some(k => x[k] !== data[k]);
    if (credentialsChanged && x.active) guardOpen('techId', x.id);
    Object.assign(x, data); if (credentialsChanged || x.reviewStatus === 'rejected') { x.reviewStatus = 'pending'; x.active = false; }
    save(x, credentialsChanged ? '技师资质更新，等待集团审核' : '保存技师档案');
  } else if (type === 'manage.tech-review') {
    if (s.techs.find(t=>t.id===p.id)?.lifecycleStatus==='left') fail('离职已完成，不能从资料审核重新启用工作身份。');
    const x = locate(s.techs, p.id, '技师'); version(x);
    if (!['approve', 'reject', 'pause'].includes(p.decision)) fail('审核决定无效。');
    if (p.decision === 'approve') {
      if (!x.certificate || !x.insurance || !validDate(x.validUntil) || Date.parse(x.validUntil + 'T23:59:59+08:00') < s.now) fail('请补齐有效证书、保单及未到期的资质日期。');
      const store = s.stores.find(t => t.id === x.storeId);
      if (!store || !x.serviceIds.some(id => store.serviceIds.includes(id) && s.services.some(v => v.id === id && v.active !== false))) fail('请先配置所属门店及匹配的启用项目；技师可先通过资料审核，门店营业后接单。');
      x.reviewStatus = 'approved'; x.active = true;
    } else { guardOpen('techId', x.id); x.active = false; if (p.decision === 'reject') x.reviewStatus = 'rejected'; }
    save(x, `技师${{ approve: '资料审核通过；接单还须核验独立项目授权', reject: '审核驳回', pause: '暂停新单' }[p.decision]}`);
  } else if (type === 'manage.rules-save') {
    const x = s.bookingRules; version(x);
    const earliestHours = num(p.earliestHours, '最早可约小时', 2, 24), maxDays = num(p.maxDays, '最远预约天数', 1, 13);
    if (earliestHours >= maxDays * 24) fail('最早可约时间须小于最远可约范围。');
    history(x); Object.assign(x, { earliestHours, maxDays }); save(x, '发布预约规则版本；已生成预约沿用原规则');
  } else fail('管理操作不存在。');
  s.managementRequests.push({ requestId, actor: actorKey, ...identity, signature });
}
