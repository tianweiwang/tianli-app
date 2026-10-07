'use strict';
// 扩展页加载完成后统一编号，原有 56 张的编号保持不变。
(() => {
  const counts = {user: 0, tech: 0, store: 0};
  const prefixes = {user: 'U', tech: 'T', store: 'S'};
  const ids = new Set();
  const files = new Set();
  for (const screen of window.SCREENS) {
    if (ids.has(screen.id)) throw new Error('重复页面 id：' + screen.id);
    ids.add(screen.id);
    screen.no = prefixes[screen.role] + String(++counts[screen.role]).padStart(2, '0');
    screen.file = window.SAFE_EXPORT_NAME(`${screen.no}-${screen.title}${screen.state && screen.state !== '—' ? '-' + screen.state : ''}.png`);
    const fileKey = screen.file.toLocaleLowerCase('en-US');
    if (files.has(fileKey)) throw new Error('重复导出文件名：' + screen.file);
    files.add(fileKey);
  }
  window.SCREEN_COUNTS = counts;
  // 画廊与总览按完整流程排列；只改展示顺序，已有页面编号保持不变。
  const flows = [
    ['用户端 · 预约', ['u-home','u-out-of-range','u-service-detail','u-tech-detail','u-tech-picker','u-slot','u-no-slots','u-addresses','u-address-edit','u-recipient','u-realname','u-realname-form','u-health','u-health-ineligible','u-health-unchecked','u-confirm','u-payment-expired','u-paid','u-o-closed']],
    ['用户端 · 履约与订单', ['u-orders','u-o-waiting','u-o-dispatching','u-o-accepted','u-reschedule','u-reschedule-address','u-reschedule-address-outside','u-reschedule-limit','u-o-reassign','u-o-store-reschedule','u-o-departed','u-o-late','u-o-arrived','u-o-serving','u-o-extend','u-extend-unavailable','u-extend-limit','u-extend-expired','u-sos','u-sos-sent','u-sos-escalated','u-sos-unanswered','u-sos-closed','u-o-service','u-o-done','u-o-settled','u-o-history','u-o-cancelled','u-o-autorefund']],
    ['用户端 · 售后与评价', ['u-aftersale-apply','u-o-aftersale','u-aftersale-confirm','u-aftersale-rejected','u-aftersale-hq','u-aftersale-material','u-aftersale-withdrawn','u-aftersale-accepted-rejection','u-aftersale-result','u-refund-processing','u-refund-received','u-o-refunded','u-review','u-review-result']],
    ['用户端 · 发票', ['u-invoice','u-invoice-form','u-invoice-pending','u-invoice-issued','u-invoice-red','u-invoice-redone','u-invoice-rejected']],
    ['用户端 · 推广与提现', ['u-promo-join','u-promo-agreement','u-promo-declined','u-promo','u-poster','u-commission','u-withdraw','u-withdraw-processing','u-withdraw-confirm','u-withdraw-success','u-withdraw-failed','u-withdraw-revoked']],
    ['用户端 · 账户与安全', ['u-my','u-privacy','u-privacy-detail','u-privacy-withdrawn','u-consent-revoked','u-restricted','u-delete-account','u-deleted','u-safety','u-emergency-contact','u-customer-service']],
    ['技师端 · 入驻与排班', ['t-onboarding-edit','t-identity-consent','t-onboarding','t-onboarding-rejected','t-onboarding-supplement','t-onboarding-approved','t-profile','t-work','t-suspended','t-schedule','t-roster-edit','t-leave-apply','t-leave-approved','t-leave-rejected','t-leaving','t-left']],
    ['技师端 · 履约', ['t-o-accepted','t-location','t-o-departed','t-o-arrived','t-noshow-confirm','t-noshow-wait','t-noshow-result','t-noshow-rejected','t-o-serving','t-extension-wait','t-extension-expired','t-sos','t-terminate','t-finish','t-service-info','t-service-info-sent','t-o-completed','t-complaint-info','t-complaint-sent']],
    ['技师端 · 收入与申诉', ['t-income','t-review-appeal','t-review-appeal-wait','t-review-appeal-accepted','t-review-appeal-rejected','t-penalty-appeal','t-penalty-appeal-wait','t-penalty-appeal-result']],
    ['店长端 · 派单与订单', ['s-dispatch','s-pick','s-orders','s-reassign-designated','s-reassign-nearby','s-reassign-wait','s-reassign-result','s-reassign-refunded','s-reschedule-apply','s-reschedule-wait','s-reschedule-result','s-reschedule-rejected','s-noshow-review','s-noshow-result','s-noshow-rejected','s-aftersale','s-aftersale-wait','s-aftersale-reject','s-aftersale-reject-wait','s-aftersale-supplement','s-aftersale-supplement-sent','s-refund-guide']],
    ['店长端 · 告警与审批', ['s-alerts','s-sos-handling','s-sos-closed','s-schedule','s-leave-approved','s-leave-reject','s-leave-rejected']],
    ['通用状态', ['u-loading','u-empty','u-neterror','t-expired','s-forbidden','s-state-changed']]
  ];
  const byId = new Map(window.SCREENS.map(screen => [screen.id, screen]));
  const mapped = new Set();
  let displayOrder = 0;
  for (const [group, pages] of flows) {
    for (const id of pages) {
      if (!byId.has(id) || mapped.has(id)) throw new Error('流程分组有未知或重复页面：' + id);
      Object.assign(byId.get(id), {group, displayOrder: displayOrder++});
      mapped.add(id);
    }
  }
  if (mapped.size !== byId.size) throw new Error('页面缺少流程分组：' + [...byId.keys()].filter(id => !mapped.has(id)).join('、'));
  window.SCREEN_GROUPS = flows.map(([group]) => group);
})();
