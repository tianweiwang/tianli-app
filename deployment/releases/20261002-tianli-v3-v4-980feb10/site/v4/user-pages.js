'use strict';
(() => {
  const {page,card,notice,kv,button,link,field,select:selectShared,check,tabs,footer,icon,summary} = window.UI;
  const D = window.BookingData;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => '¥' + Number(n || 0).toFixed(2);
  const service = s => D.service(s.serviceId) || {name:'舒缓放松',duration:60};
  const technician = s => D.tech(s.techId) || {name:'林师傅',id:'lin'};
  const store = s => D.store(s.storeId) || {name:'天俪·幸福里店',id:'xingfu'};
  const region = s => D.region(s.regionId) || {name:'幸福里片区'};
  const dateText = d => String(d || '').replace(/^\d{4}-0?(\d+)-0?(\d+)$/,'$1月$2日');
  const paymentAmount = payment => typeof payment==='number'?payment:Number(payment?.amount || payment?.price || 0);
  const extensionTotal = s => (s.extensionPayments || []).reduce((total,payment) => total + paymentAmount(payment),0);
  const paidTotal = s => s.totalPaid ?? Number(s.price || 0) + extensionTotal(s);
  const net = s => s.netPaid ?? Math.max(0,paidTotal(s)-Number(s.refundAmount || 0));
  const nearbyStores = s => D.stores.map(item=>({...item,distance:D.distance(s.location || D.region(s.regionId),item)})).filter(item=>item.distance<=20).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
  const now = () => window.BookingRuntime?.now?.() ?? Date.now();
  const localDate = timestamp => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp));
  const regionDistance = (item,s) => Number.isFinite(item.distanceKm) ? item.distanceKm.toFixed(1)+'km' : Number.isFinite(item.distance) ? item.distance.toFixed(1)+'km' : s ? D.distance(s.location || D.region(s.regionId),item).toFixed(1)+'km' : '附近';
  const select = (label,name,options,value) => selectShared(label,name,options.map(option=>Array.isArray(option)?option:{id:option.value ?? option.id,name:option.label ?? option.name}),value);
  const wrap = (title,body,foot='',extra={}) => page({title,body:`<div class="detail">${body}</div>`,foot,...extra});
  const actions = (...items) => `<div class="actions">${items.join('')}</div>`;
  const pill = (text,tone='') => `<span class="badge ${tone}">${esc(text)}</span>`;
  const lead = (label,value) => `<div class="lead">${esc(label)}<b>${esc(value)}</b></div>`;
  const status = (title,desc,tone='brand') => `<section class="status-hero tone-${tone}"><h2>${esc(title)}</h2><p>${esc(desc)}</p></section>`;
  const contactButton = () => button('联系门店','contact-store','secondary');
  const appointment = s => summary(s);
  const techMeta = tech => Number(tech.count ?? tech.reviewCount) < 5 ? '新技师 · 评价不足 5 条' : '★'+(tech.rating || '4.9')+' · '+(tech.count || tech.reviewCount || 126)+' 条评价';
  const techItem = (tech,selected='') => `<div class="tech-row"><span class="avatar ${tech.id==='chen'?'chen':tech.id==='zhou'?'zhou':''}">${esc(tech.name?.slice(0,1) || '技')}</span><div class="grow"><div class="name-line"><h3>${esc(tech.name)}</h3>${selected===tech.id?pill('已选','good'):''}</div><p>${regionDistance(tech)} · ${techMeta(tech)}</p><p class="availability">${esc(tech.availableLabel || tech.earliest || '有可约时段')}</p></div>${button('选择','select-tech','secondary',`data-tech="${esc(tech.id)}"`)}</div>`;
  const storeItem = (item,s) => `<div class="list-row"><span class="avatar small-avatar">${icon('store')}</span><div class="grow"><strong>${esc(item.name)}</strong><p>${regionDistance(item,s)} · ${esc(item.hours || item.businessHours || '09:00–23:00')}</p><p>${esc(item.area || '按所选片区显示可约项目')}</p></div>${button(s.storeId===item.id?'已选':'选择','select-store',s.storeId===item.id?'soft':'secondary',`data-store="${esc(item.id)}"`)}</div>`;
  const menu = (label,id,sub='') => `<div class="list-row"><div class="grow"><strong>${esc(label)}</strong>${sub?`<p>${esc(sub)}</p>`:''}</div>${link('查看',id,'secondary')}</div>`;
  const fullHealth = () => card(`<p style="font-size:14px;line-height:24px">请确认本次接受保健服务的人已满 18 周岁。以下情况暂不适合预约：</p><div class="timeline2" style="margin-top:14px">${['孕期','急性损伤或骨折未愈','皮肤破损或传染性皮肤病','发热','严重心脑血管疾病','饮酒后'].map(item=>`<div class="t">${item}</div>`).join('')}</div><p class="small muted" style="margin-top:12px">如情况不确定，请先咨询医生，再决定是否预约。服务不适时应及时告知技师。</p>`,'健康告知');
  const add = (id,group,title,state,caption,renderer,seed={}) => window.defineScreen({id,role:'user',group:'用户 · '+group,title,state,caption,seed},renderer);

  add('u-home','预约','首页','附近可约','定位或手选片区后，按门店、项目、技师和时间完成预约。',s=>wrap('天俪',
    card(`<div class="row between"><div><h3>${esc(region(s).name)}</h3><p class="small muted">${s.locationMode==='gps'?'已定位，优先显示附近可约':'已选片区，可手动更换'}</p></div>${link('切换片区','u-region','secondary')}</div>`) +
    card(`<div class="row between"><div><h3>${esc(store(s).name)}</h3><p class="small muted">当前预约门店 · ${regionDistance(store(s),s)}</p></div>${link('选门店','u-stores','secondary')}</div>`) +
    (s.paid?card(actions(button('新建预约','begin-booking','primary full'))):'') +
    card(D.services.map(item=>`<div class="service-row"><div class="service-art ${item.id==='neck'?'sage':''}">${icon(item.id==='neck'?'activity':'hand')}<span>${item.id==='neck'?'肩颈舒缓':'全身舒缓'}</span></div><div class="grow"><div class="row"><h3>${esc(item.name)}</h3>${pill((item.duration || (item.id==='neck'?45:60))+'分钟')}</div><p class="description">${item.id==='neck'?'适合久坐后的日常放松':'全身舒缓与日常放松'}</p><div class="price-line"><span class="price"><em>¥</em>${D.price(item.id,'14:00')}<small>日间总价</small></span>${button('预约','select-service','primary',`data-service="${esc(item.id)}"`)}</div></div></div>`).join(''),'预约项目') +
    card(D.eligibleTechs(s).slice(0,3).map(tech=>techItem(tech,s.techId)).join(''),'附近可约技师'),'',{brand:true,back:false,tabs:tabs('user','首页')}));

  add('u-region','预约','选择片区','定位 / 手动','定位仅用于附近推荐；拒绝后继续手选，不阻断浏览。',s=>wrap('选择片区',
    notice('gray','map-pin','使用当前位置可以推荐附近门店和技师，也可以手动选择。') +
    card(actions(button('使用当前位置','locate','primary full'))) +
    card(D.regions.map(item=>`<div class="list-row"><div class="grow"><strong>${esc(item.name)}</strong><p>${item.id==='outside'?'查看当前是否有可约门店':'显示这个片区的附近推荐'}</p></div>${button(s.regionId===item.id?'已选':'选择','select-region',s.regionId===item.id?'soft':'secondary',`data-region="${esc(item.id)}"`)}</div>`).join(''),'手动选择片区'),footer(link('返回首页','u-home','secondary'))));

  add('u-location-denied','预约','位置权限','未授权','拒绝定位时仍可选择片区，重新授权有明确用途。',s=>wrap('选择片区',
    status('未开启位置权限','可以手动选择片区，继续查找附近预约。','gray') +
    notice('gray','map-pin-off','位置仅用于附近门店推荐和就近匹配。') +
    card(D.regions.filter(r=>r.id!=='outside').map(item=>`<div class="list-row"><div class="grow">${esc(item.name)}</div>${button('选择','select-region','secondary',`data-region="${esc(item.id)}"`)}</div>`).join(''),'手动选择'),
    footer(button('重新尝试定位','locate'),link('返回首页','u-home','secondary'))),{locationMode:'denied'});

  add('u-no-coverage','预约','当前片区','暂不可约','片区没有可约门店时说明原因并引导换片区。',s=>wrap('当前片区',
    status('这个片区暂不可约','当前没有可提供预约的门店，可更换片区查看。','gray') +
    card(kv('所选片区',esc(region(s).name))) +
    notice('gray','store','平台会按所选片区筛选门店，不会为你跨门店提交预约。'),
    footer(link('更换片区','u-region'))),{regionId:'outside'});

  add('u-stores','预约','选择门店','附近优先','门店列表显示距离、营业时间和可约状态。',s=>wrap('选择门店',
    notice('gray','map-pin','当前片区：'+esc(region(s).name)) + card(nearbyStores(s).map(item=>storeItem(item,s)).join('') || '<p class="small muted">当前片区附近暂无可约门店，请更换片区。</p>','附近门店') +
    card(menu('了解当前门店','u-store-detail','项目、技师与营业时间')),
    footer(link('更换片区','u-region','secondary'))));

  add('u-store-detail','预约','门店详情','项目与技师','门店详情延续价格和具体技师信息，预约归属清楚。',s=>wrap('门店详情',
    card(`<div class="person"><span class="avatar">${icon('store')}</span><div class="grow"><h2>${esc(store(s).name)}</h2><p class="small muted">${regionDistance(store(s),s)} · 可预约</p></div></div>`) +
    card(kv('营业时间',esc(store(s).hours || '09:00–23:00')) + kv('当前片区',esc(region(s).name)) + kv('预约确认','由本店安排技师')) +
    card(D.services.map(item=>`<div class="list-row"><div class="grow"><strong>${esc(item.name)}</strong><p>${item.duration || (item.id==='neck'?45:60)} 分钟 · 日间 ${money(D.price(item.id,'14:00'))}</p></div>${button('预约','select-service','primary',`data-service="${esc(item.id)}"`)}</div>`).join(''),'可约项目') +
    card(D.eligibleTechs(s).map(tech=>techItem(tech,s.techId)).join(''),'本店技师'),footer(contactButton())));

  add('u-service','预约','项目详情','时长与总价','显示完整预约价格、加钟价和健康须知。',s=>wrap('项目详情',
    card(`<div class="compact-service flat"><div class="service-art ${s.serviceId==='neck'?'sage':''}">${icon(s.serviceId==='neck'?'activity':'hand')}<span>${s.serviceId==='neck'?'肩颈舒缓':'全身舒缓'}</span></div><div class="grow"><h2>${esc(service(s).name)}</h2><p>${s.duration || service(s).duration} 分钟</p><span class="price"><em>¥</em>${D.price(s.serviceId,'14:00')}<small>日间总价</small></span></div></div>${kv('预约门店',esc(store(s).name))}${kv('夜间总价',money(D.price(s.serviceId,'21:00')))}${kv('加钟单位','30 分钟 / '+money(Math.round(Number(s.price || D.price(s.serviceId,'14:00'))/Number(s.duration || service(s).duration)*30)))}`) +
    card(`<p style="font-size:14px;line-height:24px">服务前确认身体情况与力度偏好，过程中可以随时反馈。本项目用于日常放松，不提供疾病诊断或治疗。</p>`,'服务说明') +
    card(D.services.filter(item=>item.id!==s.serviceId).map(item=>`<div class="list-row"><div class="grow"><strong>${esc(item.name)}</strong><p>${item.duration} 分钟 · 日间 ${money(D.price(item.id,'14:00'))}</p></div>${button('选择','select-service','secondary',`data-service="${item.id}"`)}</div>`).join(''),'其他可约项目') +
    notice('gray','clock','21:00 起为夜间价格。选时间时会显示完整总价。') +
    card(menu('健康告知','u-health','请确认本次服务的人适合预约')),
    footer(button('选择技师','select-service','primary',`data-service="${s.serviceId}"`))));

  add('u-tech-picker','预约','选择技师','就近 / 指定','就近安排与指定技师各自清楚，付款前显示具体人。',s=>wrap('选择技师',
    card(kv('门店',esc(store(s).name))+kv('项目',esc(service(s).name))) +
    card(select('技师偏好','genderPreference',[{value:'any',label:'不限'},{value:'female',label:'女技师'},{value:'male',label:'男技师'}],s.genderPreference || 'any')) +
    card(`<div class="list-row"><div class="grow"><strong>就近安排</strong><p>按所选片区与可约时间匹配</p></div>${button(s.assignment==='nearby'?'已选':'选择','select-tech',s.assignment==='nearby'?'soft':'primary','data-tech="nearest"')}</div><p class="small muted">确认预约前会显示匹配的具体技师。</p>`) +
    card(D.eligibleTechs(s).map(tech=>techItem(tech,s.techId)).join('') || '<p class="small muted">当前偏好与时间没有可约技师，可更换偏好或时间。</p>','指定本店技师') +
    card(menu('查看所选技师','u-tech-detail',technician(s).name)),footer(link('选择时间','u-slots'))));

  add('u-tech-detail','预约','技师档案','资质与评价','显示培训记录、证书和评价，不以外貌做推荐。',s=>wrap('技师档案',
    card(`<div class="person"><span class="avatar">${esc(technician(s).name.slice(0,1))}</span><div class="grow"><h2>${esc(technician(s).name)}</h2><p class="small muted">${esc(store(s).name)} · ${regionDistance(technician(s),s)}</p><p class="small">${techMeta(technician(s))}</p></div></div>`) +
    card(kv('培训批次',esc(technician(s).trainingBatch || '天俪培训学院 2024 年第 6 期')) + kv('证书编号',esc(technician(s).certificate || 'TL-2024-06-0132')) + kv('擅长项目',esc(technician(s).skills?.join('、') || '肩颈放松、全身放松')),'培训与资质') +
    card(`<div class="list-row"><div class="grow"><span class="star-mini">★★★★★</span><p>力度合适，沟通耐心，过程很细致。</p><p>王** · 9月28日</p></div></div><div class="list-row"><div class="grow"><span class="star-mini">★★★★★</span><p>确认身体情况后才开始，体验很好。</p><p>李** · 9月25日</p></div></div>`,'用户评价'),
    footer(button('预约这位技师','select-tech','primary',`data-tech="${esc(s.techId)}"`))));

  const slotList = (s,isReschedule=false) => {
    const selectedSlot=isReschedule ? s.proposed?.slot || s.slot : s.slot;
    const times=['10:00','10:30','11:00','13:00','13:30','14:00','14:30','15:00','16:00','16:30','19:00','20:00','21:00','22:00'];
    return `<div class="slots">${times.map(time=>{
      const target={...s,date:isReschedule?s.proposed?.date || s.date:s.date,slot:time};
      const price=D.price(s.serviceId,time),start=D.appointmentStart(target),tooEarly=start<now()+2*3600000;
      const anchor=s.paid&&s.paidAt?s.paidAt:now(),tooLate=start>anchor+7*86400000;
      const available=id=>D.available?D.available(target,id):D.eligibleTechs(target).some(tech=>tech.id===id);
      const candidates=D.eligibleTechs(target);
      const hasTech=s.assignment==='nearby'?candidates.some(tech=>available(tech.id)):candidates.some(tech=>tech.id===s.techId)&&available(s.techId);
      const disabled=isReschedule&&price!==s.price||tooEarly||tooLate||!hasTech;
      return button(`<span>${time}</span><small>${disabled?(tooEarly||tooLate?'不可约':isReschedule&&price!==s.price?'价格不同':'已约满'):money(price)}</small>`,'select-slot','slot '+(selectedSlot===time?'on':''),`data-slot="${time}" ${disabled?'disabled':''}`);
    }).join('')}</div>`;
  };
  const dateOptions = s => {
    const first=localDate(now()+2*3600000),anchor=s.paid&&s.paidAt?s.paidAt:now(),last=localDate(anchor+7*86400000),options=[];
    const start=Date.parse(first+'T12:00:00+08:00');
    for(let i=0;i<=7;i++){const value=localDate(start+i*86400000);if(value>last)break;options.push({value,label:dateText(value)});}
    return options;
  };
  const dateButtons = (s,isReschedule=false) => `<div class="date-tabs" style="padding:0 0 12px">${dateOptions(s).slice(0,5).map(item=>button(item.label,'select-date',''+((isReschedule?s.proposed?.date || s.date:s.date)===item.value?'on':''),`data-date="${item.value}"`)).join('')}</div>`;
  add('u-slots','预约','选择时间','总价直接显示','可约时间显示实际价格，已占用时间禁用。',s=>wrap('选择时间',
    card(kv('门店',esc(store(s).name))+kv('项目',esc(service(s).name)+' · '+s.duration+' 分钟')+kv('技师',esc(technician(s).name)+(s.assignment==='nearby'?' · 就近安排':' · 指定')))+
    card(dateButtons(s)+select('预约日期','date',dateOptions(s),s.date)+slotList(s),'可约时间') +
    notice('gray','clock','最早可约时间为 2 小时后，最多可约 7 天内。21:00 起按夜间总价。'),
    footer(lead('已选',dateText(s.date)+' '+s.slot+' · '+money(s.price)),button('填写联系人','submit-slot'))));

  add('u-no-slots','预约','选择时间','暂无可约','时段为空时引导更换日期或技师。',s=>wrap('选择时间',
    status('当前日期暂无可约时间','可以更换日期，或选择本店其他技师。','gray') +
    card(kv('门店',esc(store(s).name))+kv('技师',esc(technician(s).name))+select('预约日期','date',dateOptions(s),s.date)),
    footer(link('更换技师','u-tech-picker','secondary'),link('查看其他时间','u-slots'))));

  add('u-contact','预约','预约联系人','本人 / 家人','联系人使用真实表单，修改与浏览告知后保留草稿。',s=>wrap('预约联系人',
    appointment(s) + card(field('联系人姓名','contactName',s.contact?.name || '', 'required autocomplete="name" maxlength="20"')+field('联系手机号','contactPhone',s.contact?.phone || '', 'type="tel" inputmode="tel" maxlength="11" required')) +
    notice('gray','users','可以为家人预约。请先确认服务对象的意愿及健康情况，使用方便联系到的手机号。'),
    footer(button('保存并继续','submit-contact'))));

  add('u-identity','预约','实名核验','单独同意','首次预约前核验本人身份，敏感信息单独授权。',s=>wrap('实名核验',
    notice('gray','shield-check','首次预约前需要完成实名核验。身份信息仅用于核验，不展示给技师和门店。') +
    card(field('本人姓名','identityName',s.identityName || '', 'required autocomplete="name" maxlength="20"')+field('身份证号','identityNumber','', 'maxlength="18" required placeholder="请输入18位身份证号"')) +
    check('我同意为实名核验处理我的身份证号','identityConsent',false) +
    card(menu('查看单独授权','u-identity-consent','了解使用目的、保留期限和撤回方式')),
    footer(button('授权并提交核验','verify-identity'))));

  add('u-identity-consent','预约','实名信息授权','用途与撤回','授权内容独立显示，可返回填写页面。',s=>wrap('实名信息授权',
    card(`<p style="font-size:14px;line-height:25px">平台为确认预约人身份，需要处理本人姓名和身份证号。身份证号不向技师和门店展示明文。账号存续期间保留，注销后按隐私规则删除或匿名化。</p><p class="small muted" style="margin-top:12px">你可以在“我的—隐私设置”撤回同意。撤回后不能新增预约，已有订单和退款仍可联系门店处理。</p>`,'单独授权 v1.0'),
    footer(link('返回填写并确认','u-identity','secondary'))));

  add('u-health','预约','健康告知','首次完整告知','服务对象满18周岁并且符合健康条件才能继续。',s=>wrap('健康告知',
    fullHealth() + check('我确认本次服务对象已满 18 周岁','adult',s.adult) + check('我已了解告知，确认不属于以上禁忌人群','health',s.health),
    footer(button('确认并继续','confirm-health'))));

  add('u-confirm','预约','确认预约','待支付','付款前持续显示具体人、时间和完整金额，健康未勾选禁付。',s=>wrap('确认预约',
    notice('brand','timer','所选时间为你保留 <b data-countdown="paymentDeadline">15:00</b>，请及时完成支付。') + appointment(s) +
    card(kv('安排方式',s.assignment==='nearby'?'就近安排':'指定技师')+kv('预约总价','<strong>'+money(s.price)+'</strong>')+`<p class="small muted">${s.slot>='21:00'?'当前为夜间总价':'当前为日间总价'}，支付金额为本次项目完整价格。</p>`) +
    card(kv('取消规则','以当前预约可退金额为准')+`<p class="small muted">取消前会显示具体退款金额和扣费。无法自助取消时请联系门店处理。</p>`) +
    check('服务对象已满 18 周岁，并符合健康告知条件','health',s.health) +
    card(menu('查看健康告知','u-health'),menu('修改联系人','u-contact')),
    footer(lead('应付总价',money(s.price)),button('确认并支付','pay','primary',s.health?'':'disabled'))));

  add('u-payment-success','预约','支付结果','支付成功','明确支付成功后仍待技师确认，保留通知与订单入口。',s=>wrap('支付结果',
    status('支付成功','等待技师确认预约。门店未能安排时会自动全额退款。','green') + appointment(s) +
    card(kv('支付金额',money(s.price))+kv('确认时限','10 分钟')+`<p class="small muted">关键进度通过订单消息通知；未订阅时改用短信。</p>`+actions(button('开启预约通知','subscribe','secondary full'))),
    footer(link('返回首页','u-home','secondary'),link('查看预约','u-order-waiting'))),{paid:true,stage:'waiting',finance:'paid'});

  add('u-payment-expired','预约','预约已关闭','支付超时','保留失效的预约信息，重新选择而非复用旧时间。',s=>wrap('预约已关闭',
    status('支付时间已过','本次预约已关闭，请重新选择可约时间。','gray') + appointment(s) +
    notice('gray','info','若你已付款但页面未更新，请联系门店核对支付结果。'),
    footer(contactButton(),link('重新选时间','u-slots'))),{stage:'closed',finance:'unpaid',paid:false});

  const orderState = s => ({draft:'待支付',waiting:'等待确认',confirmed:'预约已确认',active:'预约进行中',completed:'已完成',care:'处理中',cancelled:'已取消',closed:'已关闭',refunded:'已退款'})[s.stage] || '处理中';
  add('u-orders','预约与变更','我的预约','当前预约','订单列表保留阶段、总价和同单入口。',s=>wrap('我的预约',
    card(`<div class="order-top"><span>预约尾号 0132</span>${pill(orderState(s),s.stage==='confirmed'?'good':'')}</div><h3>${esc(service(s).name)} · ${s.duration} 分钟</h3><p class="order-time">${dateText(s.date)} ${s.slot}</p><p class="small muted">${esc(technician(s).name)} · ${esc(store(s).name)}</p>${kv('支付总价',money(s.price))}${actions(link('查看详情','u-order-current','primary full'))}`),
    '',{back:false,tabs:tabs('user','预约')}));
  const order = (title,description,body,s,buttons,tone='brand') => wrap('预约详情',status(title,description,tone)+appointment(s)+body,footer(...buttons));
  add('u-order-waiting','预约与变更','预约详情','等待确认','技师确认有时限，门店安排超时全额退款。',s=>order(s.confirmationPhase==='store'?'门店正在安排':'等待技师确认','未能确认时由门店继续安排；未能完成安排会全额退款。',card(kv('确认剩余时间',`<b data-countdown="${s.confirmationPhase==='store'?'roundDeadline':'confirmDeadline'}">10:00</b>`)+kv('安排方式',s.assignment==='nearby'?'就近安排':'指定技师')+kv('退款规则','未能安排预约则全额退款')),s,[contactButton(),button('取消预约','cancel','secondary')]),{paid:true,stage:'waiting',finance:'paid'});
  add('u-order-confirmed','预约与变更','预约详情','已确认','确认后的改约、取消和联系保留在同一预约。',s=>order('预约已确认','技师已确认，请留意预约时间。',card(kv('改约次数','剩余 '+s.changesLeft+' 次')+kv('实付金额',money(s.price))),s,[contactButton(),link('改约','u-reschedule','secondary'),button('取消预约','cancel','secondary')],'green'),{paid:true,stage:'confirmed',finance:'paid'});
  add('u-order-active','预约与变更','预约详情','进行中','进行中显示计时与加钟记录，付款前显示加钟金额。',s=>order('预约进行中','本次服务已开始，需要调整时请联系门店。',card(kv('已进行',s.elapsed+' 分钟')+kv('预约时长',s.duration+' 分钟')+kv('加钟记录',s.extensionPayments?.length?s.extensionPayments.length+' 次 · '+money(extensionTotal(s)):'暂无')+kv('已付总额',money(paidTotal(s)))+kv('本次加钟','30 分钟 / '+money(Math.round(s.price/s.duration*30)))),s,[contactButton(),button(s.extensionPending?'支付加钟':'申请加钟',s.extensionPending?'pay-extension':'request-extension')],'green'),{paid:true,stage:'active',finance:'paid',elapsed:20});
  add('u-order-completed','预约与变更','预约详情','已完成','完成后可在期限内评价、售后和申请发票。',s=>order('预约已完成','48 小时内可申请售后；评价期限为 7 天。',card(kv('已付总额',money(paidTotal(s)))+kv('退款金额',money(s.refundAmount))),s,[link('售后','u-aftersale-apply','secondary'),link('评价','u-review','secondary'),link('发票','u-invoice','secondary')],'green'),{paid:true,stage:'completed',finance:'pending-settlement'});
  add('u-order-care','预约与变更','预约详情','门店与客服处理中','核实期间不提前判断退款结果。',s=>order('预约情况核实中','门店与客服正在处理，退款结果以处理结论为准。',notice('gray','messages-square','处理中暂停资金结算。你可以联系门店补充情况。'),s,[contactButton(),link('查看处理进度','u-aftersale','secondary')],'warm'),{paid:true,stage:'care',finance:'blocked'});

  add('u-reschedule','预约与变更','改约','同价时段','拟改时间与正式预约分开，确认成功后再释放旧时间。',s=>wrap('改约',
    notice('gray','calendar-days','本单剩余 '+s.changesLeft+' 次改约。只能选择同价时间，成功后需要技师重新确认。') +
    card(kv('原预约',dateText(s.date)+' '+s.slot)+kv('技师',esc(technician(s).name))+kv('价格',money(s.price)))+
    card(dateButtons(s,true)+select('新的预约日期','newDate',dateOptions(s),s.proposed?.date || s.date)+slotList(s,true),'选择新的时间'),
    footer(link('保留原预约','u-order-confirmed','secondary'),button('确认改约','submit-reschedule','primary',s.changesLeft<=0?'disabled':''))),{paid:true,stage:'confirmed',finance:'paid'});

  add('u-reassign','预约与变更','技师调整确认','指定技师变更','指定技师调整须用户确认，拒绝与超时退款明确。',s=>wrap('技师调整确认',
    status('门店申请调整技师','请在 15 分钟内确认；拒绝或超时将取消并全额退款。','warm') + appointment(s) +
    card(kv('原技师',esc(technician(s).name))+kv('拟安排技师',esc(D.tech(s.pendingChange?.techId || s.proposed?.techId || 'chen')?.name || '陈师傅'))+kv('预约时间',dateText(s.date)+' '+s.slot)+kv('价格',money(s.price))),
    footer(button('拒绝并退款','reject-reassign','secondary'),button('同意调整','accept-reassign'))),{paid:true,stage:'confirmed',assignment:'specified',finance:'paid',proposed:{techId:'chen'}});
  add('u-store-reschedule','预约与变更','时间调整确认','门店发起','门店改时间被拒绝或超时，原预约继续有效。',s=>wrap('时间调整确认',
    status('门店申请调整时间','不同意或超时不确认，将保留原预约。','warm') + appointment(s) +
    card(kv('原时间',dateText(s.date)+' '+s.slot)+kv('新时间',dateText(s.pendingChange?.date || s.proposed?.date || s.date)+' '+(s.pendingChange?.slot || s.proposed?.slot || '16:00'))+kv('价格变化','无，仍为 '+money(s.price))+kv('个人改约次数','本次不扣减')),
    footer(button('保留原时间','reject-store-reschedule','secondary'),button('同意调整','accept-store-reschedule'))),{paid:true,stage:'confirmed',finance:'paid',proposed:{slot:'16:00'}});

  add('u-cancel-confirm','退款与售后','取消预约','显示金额','确认前显示已付、扣费和可退金额，按当前条件计算。',s=>wrap('取消预约',
    appointment(s) + card(kv('已支付',money(s.price))+kv('本次扣费',money(s.cancelFee || 0))+kv('本次可退','<strong>'+money(s.cancelRefund ?? Math.max(0,s.price-(s.cancelFee || 0)))+'</strong>'),'退款明细') +
    notice('gray','info','确认取消后发起原路退款，到账以支付渠道最终结果为准。'),
    footer(link('暂不取消','u-order-current','secondary'),button('确认取消','confirm-cancel'))));
  add('u-cancelled','退款与售后','预约详情','已取消','取消结果与资金结算独立显示。',s=>order('预约已取消','本次预约已取消，后续资金结算不会改变这个结果。',card(kv('原支付金额',money(s.price))+kv('扣费',money(Math.max(0,s.price-s.refundAmount)))+kv('退款金额',money(s.refundAmount))+kv('退款状态',s.finance==='refunded'?'已退回':'处理中')),s,[contactButton(),link('查看退款','u-refund-result','secondary')],'gray'),{paid:true,stage:'cancelled',finance:'refunded',refundAmount:238.40});
  add('u-refund-processing','退款与售后','退款进度','处理中','退款已发起与已到账分别展示，失败仍保留联系入口。',s=>wrap('退款进度',
    status('退款处理中','已提交支付渠道，到账时间以渠道最终结果为准。','warm') + appointment(s) +
    card(kv('待退金额',money(s.refundAmount))+kv('退款方式','原路退回')+kv('当前结果','尚未确认到账')),
    footer(contactButton(),button('刷新退款结果','refund-refresh'))),{paid:true,finance:'refund-processing',refundAmount:98});
  add('u-refund-failed','退款与售后','退款进度','退款未完成','退款执行失败保留原结果，重试成功前不显示到账。',s=>wrap('退款进度',
    status('退款暂未完成','退款尚未到账，可以重试或联系门店核实。','warm') + appointment(s) +
    card(kv('待退金额',money(s.refundAmount))+kv('退款方式','原路退回')+kv('失败说明',esc(s.refundFailureReason || '支付渠道暂未完成本次退款'))) +
    notice('gray','info','重新提交后仍需等待支付渠道的最终退款结果。'),
    footer(contactButton(),button('重新提交退款','refund-retry'))),{paid:true,stage:'cancelled',finance:'refund-failed',refundAmount:98});
  add('u-refund-result','退款与售后','退款结果','已到账','展示主订单和加钟退款记录与剩余金额。',s=>wrap('退款结果',
    status('退款已到账','款项已按最终结果原路退回。','green') +
    card(kv('总退款',money((s.refundedByPayment || []).length?s.refundedByPayment.reduce((total,p)=>total+paymentAmount(p),0):s.refundAmount))+kv('退款后实付',money(net(s)))+(s.refundedByPayment || []).map((record,index)=>kv(record.label || (index?'加钟 '+index+' 退款':'主项目退款'),money(paymentAmount(record)))).join(''))+
    appointment(s),footer(contactButton(),link('我的预约','u-orders','secondary'))),{paid:true,finance:'refunded',refundAmount:98});

  const refundFields = s => {
    const mainMax=s.refundBalances?.[0] ?? Math.max(0,Number(s.price || 0)-paymentAmount((s.refundedByPayment || [])[0]));
    return check('申请主项目退款','refundMain',true) + field('主项目退款金额（最多 '+money(mainMax)+'）','refundAmount',s.requestedRefundBreakdown?.[0] ?? 0,`type="number" min="0" max="${mainMax}" step="0.01"`) +
      (s.extensionPayments || []).map((payment,index)=>{
        const available=s.refundBalances?.[index+1] ?? Math.max(0,paymentAmount(payment)-paymentAmount((s.refundedByPayment || [])[index+1]));
        return check('申请加钟 '+(index+1)+' 退款','refundExtension'+(index+1),true)+field('加钟 '+(index+1)+' 退款金额（最多 '+money(available)+'）','extensionRefund'+(index+1),s.requestedRefundBreakdown?.[index+1] ?? 0,`type="number" min="0" max="${available}" step="0.01"`);
      }).join('');
  };
  add('u-aftersale-apply','退款与售后','申请售后','分别填写付款诉求','一次售后包含主单与加钟，分别填写金额和校验。',s=>wrap('申请售后',
    appointment(s) + card(select('问题类型','refundType',[{value:'quality',label:'服务质量'},{value:'duration',label:'时长不足'},{value:'attitude',label:'技师态度'},{value:'other',label:'其他'}],'duration')+check('仅反馈问题，不申请退款','feedbackOnly',false)+refundFields(s)) +
    card(`<label class="card-title" for="refundDescription">问题描述</label><textarea class="runtime-textarea" name="refundDescription" id="refundDescription" required maxlength="500" placeholder="请描述需要处理的情况"></textarea><label class="upload-label">图片（最多6张）<input type="file" name="refundImages" accept="image/*" multiple></label>`) +
    notice('gray','clock','门店 24 小时内处理，超时转集团客服。自助售后期限为完成后 48 小时。'),
    footer(button('提交售后申请','submit-aftersale'))),{paid:true,stage:'completed',finance:'pending-settlement'});
  add('u-aftersale','退款与售后','售后进度','门店 / 集团处理中','处理进度显示当前负责方和时限。',s=>wrap('售后进度',
    status(s.aftersale==='hq'?'集团客服处理中':'门店处理中',s.aftersale==='hq'?'集团客服将在 48 小时内给出处理结论。':'门店将在 24 小时内处理，超时自动转集团。','warm') + appointment(s) +
    card(kv('诉求','退款 '+money(typeof s.requestedRefund==='number'?s.requestedRefund:Number(s.requestedRefund?.main || 0)+Number(s.requestedRefund?.extensions || 0)))+kv('资金状态','暂停结算')+`<p class="small muted">处理未完成前，可以联系门店补充材料。</p>`),
    footer(contactButton())),{paid:true,aftersale:'pending',finance:'blocked',requestedRefund:98});
  add('u-aftersale-confirm','退款与售后','售后进度','用户确认方案','低于诉求的退款先由用户确认，拒绝可申请集团介入。',s=>wrap('售后进度',
    status('门店已回复，请确认','请在 48 小时内确认；超时按平台规则视为接受。','warm') +
    card(kv('你的诉求',money(typeof s.requestedRefund==='number'?s.requestedRefund:s.requestedRefund?.total))+kv('门店方案','部分退款 '+money(s.offeredRefund))+`<p style="font-size:14px;line-height:24px;margin-top:10px">门店说明：已核对服务时长，提出以上退款方案。</p>`) +
    notice('gray','messages-square','接受后执行退款；你不认可方案时，可申请集团客服介入。'),
    footer(button('申请集团介入','request-hq','secondary'),button('接受方案','accept-refund-plan'))),{paid:true,aftersale:'confirm',finance:'blocked',requestedRefund:98,offeredRefund:49.67});
  add('u-aftersale-result','退款与售后','售后结果','已完成 / 驳回','结果与退款执行进度分别展示，驳回显示理由。',s=>wrap('售后结果',
    status(s.aftersale==='rejected'?'申请已驳回':'售后处理已完成',s.aftersale==='rejected'?'处理理由：现有记录无法支持本次退款诉求。':'已形成处理结果，可查看退款进度。',s.aftersale==='rejected'?'gray':'green') +
    card(kv('退款金额',money(s.refundAmount))+kv('当前结果',s.finance==='refunded'?'已退回':s.refundAmount?'退款处理中':'未退款')) + appointment(s),
    footer(contactButton(),link('查看退款','u-refund-result','secondary'))),{paid:true,aftersale:'completed',finance:'refunded',refundAmount:98});
  add('u-review','退款与售后','评价','一次提交','星级、标签和文字使用真实表单，文字审核后显示。',s=>wrap('评价',
    appointment(s) + card(select('星级','reviewRating',[5,4,3,2,1].map(n=>({value:String(n),label:n+' 星'})),'5')+select('体验标签','reviewTag',[{value:'communication',label:'沟通好'},{value:'professional',label:'手法专业'},{value:'punctual',label:'准时'}],'professional')+`<label class="card-title" for="reviewText">文字评价（选填）</label><textarea class="runtime-textarea" name="reviewText" id="reviewText" maxlength="300" placeholder="说说这次预约体验"></textarea>`) +
    notice('gray','message-square','每单只能评价一次，提交后不能修改。文字审核通过后展示。'),
    footer(button('提交评价','submit-review'))),{paid:true,stage:'completed'});

  add('u-my','账户与资金','我的','账户与常用入口','保留预约、实名、隐私、发票与推广资金入口。',s=>wrap('我的',
    card(`<div class="person"><span class="avatar">${esc(s.contact?.name?.slice(0,1) || '王')}</span><div class="grow"><h3>${esc(s.contact?.name || '预约用户')}</h3><p class="small muted">${esc(s.contact?.phone?.replace(/(\d{3})\d{4}(\d{4})/,'$1****$2') || '未填写联系人')}</p>${pill(s.identityVerified?'已实名':'未实名',s.identityVerified?'good':'')}</div></div>`) +
    card(menu('我的预约','u-orders')+menu('联系人信息','u-contact')+menu('实名认证','u-identity')+menu('发票','u-invoice')+menu('推广中心','u-promo')) +
    card(menu('隐私设置','u-privacy')+menu('注销账号','u-delete'))+
    card(actions(contactButton())), '',{back:false,tabs:tabs('user','我的')}));
  add('u-privacy','账户与资金','隐私设置','查看 / 撤回 / 恢复','展示单独同意状态，撤回后限制新增预约。',s=>wrap('隐私设置',
    card(kv('隐私政策版本','v1.0')+kv('实名处理授权',s.consent?'已同意':'已撤回')+kv('实名核验',s.identityVerified?'已通过':'待核验')) +
    card(menu('查看实名授权内容','u-identity-consent')) +
    notice('gray','shield-check','撤回授权后不能新增预约。已存在的订单、退款与售后仍可查看处理。'),
    footer(button(s.consent?'撤回实名授权':'重新授权并核验',s.consent?'privacy-withdraw':'privacy-restore','secondary'))));
  add('u-restricted','账户与资金','账号状态','限制 / 已注销','限制原因可申诉，注销后展示真实账户结果。',s=>wrap(s.account==='deleted'?'账号已注销':'账号限制',
    s.account==='deleted' ? status('账号已注销','账号资料已按隐私规则删除或匿名化。','gray') + card('<p style="font-size:14px;line-height:24px">再次使用需要重新登录并完成实名核验，原推广身份和授权不会自动恢复。</p>') :
    status('账号暂时无法新增预约','限制期间仍可查看历史预约、退款和发票。','gray') +
    card(kv('原因类别',esc(s.restrictionReason || '30 天内爽约 2 次'))+kv('限制到期',esc(s.restrictionEnd || '2026年10月31日'))) +
    notice('gray','headset','如对处理结果有疑问，可以联系门店说明并申请客服复核。'),
    footer(s.account==='deleted'?button('联系平台客服','contact-platform','secondary'):contactButton(),link(s.account==='deleted'?'返回首页':'历史预约',s.account==='deleted'?'u-home':'u-orders','secondary'))),{account:'restricted'});
  add('u-delete','账户与资金','注销账号','未完事项检查','勾选确认后才可注销，未完订单与资金阻止提交。',s=>wrap('注销账号',
    notice('gray','user-round-x','注销后账号资料按隐私规则删除或匿名化，原推广身份和授权不会自动恢复。') +
    card(kv('预约状态',orderState(s))+kv('可提现余额',money(s.balance))+kv('提现状态',s.withdrawal || '无处理中提现')+kv('售后状态',s.aftersale || '无处理中售后')) +
    check('我已了解注销结果，确认申请注销这个账号','deleteConsent',false) +
    `<p class="small muted">请先处理未完成的预约、售后、退款及资金事项，再提交注销。</p>`,
    footer(button('确认注销','delete-account','secondary'))));

  add('u-invoice','账户与资金','申请发票','个人 / 企业','金额按主项目与加钟的退款后净额填写。',s=>wrap('申请发票',
    card(kv('开票金额','<strong>'+money(net(s))+'</strong>')+kv('开票方',esc(store(s).name))+kv('发票类型','电子普通发票')) +
    card(select('抬头类型','invoiceType',[{value:'personal',label:'个人'},{value:'company',label:'企业'}],s.invoiceDetails?.type || 'personal')+field('抬头名称','invoiceTitle',s.invoiceDetails?.title || '', 'required')+field('税号（企业必填）','invoiceTax',s.invoiceDetails?.tax || '', 'maxlength="20"')+field('接收邮箱','invoiceEmail',s.invoiceDetails?.email || '', 'type="email" required'))+
    notice('gray','file-text','完成后 90 天内可申请。开票后退款将由门店红冲，再按退款后净额重新开具。'),
    footer(button('提交开票申请','submit-invoice'))),{paid:true,stage:'completed'});
  add('u-invoice-result','账户与资金','发票详情','申请与处理结果','待开、已开、待红冲及驳回共用同一发票记录。',s=>wrap('发票详情',
    status(({pending:'等待门店开票',issued:'电子发票已开具',red:'原发票待红冲',redone:'已红冲，重新开票中',rejected:'开票申请被驳回'})[s.invoice] || '开票申请已提交',s.invoice==='rejected'?'抬头信息有误，请修改后重新提交。':'可刷新查看门店处理结果。',s.invoice==='issued'?'green':'brand') +
    card(kv('开票方',esc(store(s).name))+kv('退款后开票金额',money(net(s)))+kv('抬头',esc(s.invoiceDetails?.title || s.contact?.name || '个人'))+kv('邮箱',esc(s.invoiceDetails?.email || 'wang@example.com'))),
    footer(contactButton(),s.invoice==='rejected'?link('修改申请','u-invoice'):s.invoice==='issued'?button('查看电子发票','invoice-download'):button('刷新发票状态','invoice-query'))),{paid:true,stage:'completed',invoice:'pending'});
  add('u-promo','账户与资金','推广中心','身份 / 佣金','个人一级推广，客户隐私不向推广员展示。',s=>wrap('推广中心',
    card(kv('推广身份',s.promoter?'门店推广员':'待确认推广邀请')+kv('所属门店',esc(store(s).name))+kv('推广协议',s.promoter?'已签署 v1.0':'待签署')) +
    card(`<p style="font-size:14px;line-height:24px">不做虚假宣传，不宣传疗效，不诱导分享，不私下收款。只做一级推广，退款时按规则调整佣金。</p>`,'推广协议摘要')+
    (s.promoter?card(kv('绑定客户','23 人')+kv('可提现佣金',money(s.balance))+kv('待结算佣金','¥59.60')+kv('待扣回','¥9.80')+`<p class="small muted">不展示客户的手机号等个人信息。佣金售后期满并分账成功后可提现。</p>`)+card(`<div class="person"><div class="qr">${icon('qr-code')}</div><div class="grow"><h3>我的推广卡片</h3><p class="small muted">${esc(store(s).name)} · 本人推广身份</p></div></div>${actions(button('分享预约卡片','promo-share','secondary full'))}`):check('我已阅读推广协议，并确认接受这份邀请','promoAgreement',false)),
    footer(s.promoter?link('提现到微信零钱','u-withdraw'):button('签署并开通','promo-join'))));
  add('u-withdraw','账户与资金','提现','提交 / 收款授权','提现额度完整显示，未授权时可逐笔确认收款。',s=>wrap('提现',
    card(`<p class="small muted">可提现余额</p><div class="money">${money(s.balance)}</div>`)+
    card(kv('收款方式','微信零钱')+kv('实名核验',s.identityVerified?'已通过':'需先完成实名')+check('开通免确认收款授权','transferAuthorized',!!s.transferAuthorized))+
    notice('gray','wallet','最低 ¥10，每天最多 3 次。不开通免确认授权时，每笔需要在微信有效期内确认；逾期撤销后恢复可提现。'),
    footer(button('确认提现','withdraw-submit'))));
  add('u-withdraw-result','账户与资金','提现结果','处理中 / 成功 / 失败 / 撤销','接口受理不等于到账，失败和撤销恢复余额一次。',s=>wrap('提现结果',
    status(({processing:'提现处理中',confirm:'等待确认收款',success:'提现已到账',failed:'提现失败',revoked:'提现已撤销'})[s.withdrawal] || '提现处理中',s.withdrawal==='failed'||s.withdrawal==='revoked'?'本次金额已恢复可提现，可以核对信息后重新申请。':s.withdrawal==='confirm'?'请在微信显示的有效期内确认，逾期会撤销。':'到账以最终转账结果为准。',s.withdrawal==='success'?'green':'brand') +
    card(kv('提现金额',money(s.withdrawalAmount || s.balance))+kv('收款方式','微信零钱')+kv('可提现余额',money(s.balance))) +
    (s.withdrawal==='failed'?notice('gray','circle-alert',esc(s.withdrawFailureReason || '收款实名信息需要核对。')):''),
    footer(link('推广中心','u-promo','secondary'),s.withdrawal==='confirm'?button('确认收款','withdraw-confirm'):button('刷新结果','withdraw-query'))),{withdrawal:'processing',withdrawalAmount:186.40,balance:0});
})();
