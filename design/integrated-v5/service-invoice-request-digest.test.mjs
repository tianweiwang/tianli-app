import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { invoiceCommand, upgradeInvoices, serviceInvoiceUploadScope } from './service-invoices.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { closedRightsBinding } from './privacy-closed-rights.mjs';

const user = { role: 'user', userId: 'u1' }, other = { role: 'user', userId: 'u2' };
const tech = { role: 'tech', techId: 'lin' }, local = { role: 'store', storeId: 'xingfu' };
const finance = { role: 'group', job: 'finance' }, support = { role: 'group', job: 'support' };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const serialized = value => JSON.stringify(canonical(value));
const digest = value => 'sha256:' + createHash('sha256').update(serialized(value), 'utf8').digest('hex');
const title = { kind: 'company', title: 'C09摘要抬头🧾有限公司', taxId: '91320100000000000X', email: 'c09-digest-canary@example.test' };
// Domain metadata fixture; this test does not claim app upload or actual Blob I/O.
const pdf = Buffer.from('%PDF-1.4\nC09 invoice digest fixture\n%%EOF');
const file = { ref: 'invoice-file:' + createHash('sha256').update(pdf).digest('hex'), name: 'C09文件名凭证🧾.pdf', type: 'application/pdf', size: pdf.length };

function harness() {
  let state = seed(), seq = 0;
  const h = {
    get s() { return state; },
    get b() { return state.bookings.at(-1); },
    get inv() { return state.serviceInvoices.at(-1); },
    run(type, payload = {}, actor = user) {
      let result;
      state = reduce(state, actor, type, { requestId: 'invoice-digest-' + ++seq, ...payload }, value => { result = value; });
      return result;
    },
    done() {
      const startAt = state.now + 4 * 3600000;
      h.run('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', startAt, mode: 'specified', genderPreference: 'any', contactName: 'C09原预约本人', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true });
      const id = h.b.id;
      h.run('booking.pay', { id, outcome: 'success' });
      h.run('booking.accept', { id }, tech);
      h.run('clock.advance', { minutes: 240 }, finance);
      h.run('booking.start', { id }, tech);
      h.run('clock.advance', { minutes: h.b.duration }, finance);
      h.run('booking.finish', { id, mode: 'normal' }, tech);
      assert.equal(h.b.status, 'done');
      assert.ok(h.b.completedAt <= state.now);
      return id;
    },
    apply(requestId = 'apply-once', extra = {}) {
      const payload = { bookingId: h.b.id, ...title, requestId, ...extra };
      h.run('invoice.apply', payload);
      return payload;
    },
    staff(job = 'store-finance', storeId = 'xingfu') {
      const admin = h.run('account.enter', { accountId: 'DEMO-ADMIN', grantId: 'DEMO-ADMIN-GRANT' });
      let account = h.run('account.create', { name: 'C09原在岗作者-' + job, reason: '原发票请求摘要验收' }, admin);
      account = h.run('account.grant', { id: account.id, version: account.version, job, ...(job.startsWith('store-') ? { storeId } : {}), reason: '原岗位授权' }, admin);
      const grantId = account.grants.at(-1).id;
      const entry = h.run('account.enter', { accountId: account.id, grantId });
      return { admin, accountId: account.id, grantId, actor: resolveAccountActor(state, entry) };
    },
    close() {
      h.run('privacy.request', { version: 0, reason: 'C09原本人申请关闭', acknowledged: true });
      const closure = state.privacyClosures.at(-1);
      h.run('privacy.close', { id: closure.id, version: closure.version, reason: '正常关闭保留原票权益', custodian: '原集团客服', acknowledged: true }, support);
      assert.equal(state.privacyProfiles.find(row => row.userId === user.userId).status, 'use_closed');
    }
  };
  h.done();
  return h;
}
function funds(s) {
  return structuredClone({ bookings: s.bookings, goods: s.goods, bills: s.bills, recoveries: s.recoveries, serviceFinanceEntries: s.serviceFinanceEntries, techIncomeEntries: s.techIncomeEntries, serviceCommissions: s.serviceCommissions });
}
function oldPlaintext(s, requestId, type, payload, actor) {
  const row = s.serviceInvoiceRequests.find(value => value.requestId === requestId);
  row.fingerprint = serialized({ type, payload });
  delete row.digestAlgorithm; delete row.digestVersion; delete row.type;
  if (actor) row.actor = JSON.stringify(actor);
  return row;
}
function replay(s, actor, type, payload) { return reduce(s, actor, type, payload); }

test('C09 服务发票真实申请保存版本SHA，完整canonical与原生crypto相符，不复制抬头邮箱', () => {
  for (const text of ['ASCII invoice', '中文发票抬头', 'emoji🧾𠮷', '长文'.repeat(50)]) {
    const h = harness(), beforeFunds = funds(h.s);
    const p = h.apply('sha-standard', { kind: 'personal', title: text, taxId: '', requestNote: { z: [1, { b: text, a: null }], a: 'nested' } });
    const row = h.s.serviceInvoiceRequests.at(-1);
    assert.deepEqual(Object.keys(row).sort(), ['requestId','actor','type','fingerprint','digestAlgorithm','digestVersion','invoiceId','at'].sort());
    assert.equal(row.digestAlgorithm, 'SHA-256'); assert.equal(row.digestVersion, 1);
    assert.equal(row.fingerprint, digest({ type: 'invoice.apply', payload: p }));
    assert.equal(row.invoiceId, h.inv.id); assert.equal(row.at, h.s.now); assert.equal(row.type, 'invoice.apply');
    assert.deepEqual(JSON.parse(row.actor), { role: 'user', job: null, id: 'u1' });
    assert.doesNotMatch(JSON.stringify(row), /c09-digest-canary|requestNote|nested|payload|taxId|email|title/);
    assert.equal(h.inv.title, text); assert.equal(h.inv.email, title.email);
    assert.deepEqual(funds(h.s), beforeFunds);
  }
});

test('C09 摘要请求JSON持久回读及反向键序重放，只回原票且不重造历史或款项', () => {
  const h = harness(), p = h.apply(), before = structuredClone(h.s), loaded = JSON.parse(JSON.stringify(h.s));
  const after = replay(loaded, { ...user, job: 'finance', techId: 'zhou', storeId: 'silver' }, 'invoice.apply', Object.fromEntries(Object.entries(p).reverse()));
  assert.deepEqual(after.serviceInvoices, before.serviceInvoices);
  assert.deepEqual(after.serviceInvoiceRequests, before.serviceInvoiceRequests);
  assert.deepEqual(funds(after), funds(loaded));
  for (const changed of [{ ...p, title: '不同抬头' }, { ...p, email: 'different@example.test' }, { ...p, taxId: '91320100000000000Y' }]) assert.throws(() => replay(after, user, 'invoice.apply', changed), /同一提交标识/);
  assert.deepEqual(loaded, JSON.parse(JSON.stringify(before)));
});

test('C09 原工作账号开票和补传记录只存摘要，真实作者及结果保留', () => {
  const h = harness(); h.apply(); const member = h.staff();
  const p = { id: h.inv.id, version: h.inv.version, ticketNumber: 'C09-BLUE-001', file, requestId: 'issue-with-file' };
  h.run('invoice.issue', p, member.actor);
  const issued = structuredClone(h.inv), row = h.s.serviceInvoiceRequests.at(-1), author = JSON.parse(row.actor);
  assert.equal(row.fingerprint, digest({ type: 'invoice.issue', payload: p }));
  assert.equal(author.accountId, member.accountId); assert.equal(author.grantId, member.grantId); assert.equal(author.accountName, member.actor.accountName);
  assert.equal(author.job, null); assert.equal(author.role, 'store'); assert.equal(author.id, 'xingfu');
  assert.doesNotMatch(JSON.stringify(row), /C09文件名|C09-BLUE|invoice-file:|ticketNumber|payload/);
  h.run('invoice.issue', p, member.actor); assert.deepEqual(h.inv, issued);
  assert.equal(h.s.serviceInvoiceRequests.length, 2);
  const replacement = { ...file, name: 'C09补传文件名.pdf' }, replace = { id: h.inv.id, version: h.inv.version, slot: 'issued', reason: '原票补传原因', file: replacement, requestId: 'replace-with-file' };
  const beforeFunds = funds(h.s); h.run('invoice.replace-file', replace, member.actor);
  const newRow = h.s.serviceInvoiceRequests.at(-1);
  assert.equal(newRow.fingerprint, digest({ type: 'invoice.replace-file', payload: replace }));
  assert.doesNotMatch(JSON.stringify(newRow), /C09补传文件名|原票补传原因|invoice-file:/);
  assert.equal(h.inv.issued.file.name, replacement.name); assert.deepEqual(funds(h.s), beforeFunds);
});

test('C09 旧明文和新摘要并存，旧角色残留job读取不迁移历史', () => {
  const h = harness(), apply = h.apply();
  oldPlaintext(h.s, apply.requestId, 'invoice.apply', apply, { role: 'user', job: 'warehouse', id: 'u1' });
  const issue = { id: h.inv.id, version: h.inv.version, ticketNumber: 'C09-LEGACY-BLUE', file, requestId: 'modern-issue' };
  h.run('invoice.issue', issue, local);
  const before = structuredClone(h.s);
  h.run('invoice.apply', Object.fromEntries(Object.entries(apply).reverse()), { ...user, job: 'support' });
  h.run('invoice.issue', issue, { ...local, job: 'operations' });
  assert.deepEqual(h.s.serviceInvoiceRequests, before.serviceInvoiceRequests);
  assert.deepEqual(h.s.serviceInvoices, before.serviceInvoices);
  assert.deepEqual(funds(h.s), funds(before));
  assert.throws(() => replay(h.s, user, 'invoice.apply', { ...apply, title: '异内容旧明文' }), /同一提交标识/);
  assert.equal(Object.hasOwn(h.s.serviceInvoiceRequests[0], 'digestVersion'), false);
});

test('C09 旧工作作者姓名不属于去重key，同account/grant仍回原请求且保留旧作者', () => {
  const h = harness(); h.apply(); const member = h.staff();
  const issue = { id: h.inv.id, version: h.inv.version, ticketNumber: 'C09-NAME-BLUE', file, requestId: 'old-account-name' };
  h.run('invoice.issue', issue, member.actor);
  const oldAuthor = { ...JSON.parse(h.s.serviceInvoiceRequests.at(-1).actor), accountName: '旧库发生时真实作者名称', job: 'support' };
  oldPlaintext(h.s, issue.requestId, 'invoice.issue', issue, oldAuthor);
  const before = structuredClone(h.s);
  h.run('invoice.issue', issue, member.actor);
  assert.deepEqual(h.s.serviceInvoiceRequests, before.serviceInvoiceRequests);
  assert.deepEqual(h.s.serviceInvoices, before.serviceInvoices);
  assert.equal(JSON.parse(h.s.serviceInvoiceRequests.at(-1).actor).accountName, oldAuthor.accountName);
  const modern = structuredClone(h.s);
  modern.serviceInvoiceRequests.at(-1).fingerprint = digest({ type: 'invoice.issue', payload: issue });
  modern.serviceInvoiceRequests.at(-1).digestAlgorithm = 'SHA-256'; modern.serviceInvoiceRequests.at(-1).digestVersion = 1;
  const modernAfter = replay(modern, member.actor, 'invoice.issue', issue);
  assert.deepEqual(modernAfter.serviceInvoiceRequests, modern.serviceInvoiceRequests);
  assert.deepEqual(modernAfter.serviceInvoices, modern.serviceInvoices);
});

test('C09 归一后的多条旧作者请求冲突拒绝，不取首条或补造新票', () => {
  const h = harness(); h.apply(); const member = h.staff();
  const issue = { id: h.inv.id, version: h.inv.version, ticketNumber: 'C09-CONFLICT-BLUE', file, requestId: 'name-collision' };
  h.run('invoice.issue', issue, member.actor);
  const old = oldPlaintext(h.s, issue.requestId, 'invoice.issue', issue);
  const duplicate = structuredClone(old), author = JSON.parse(duplicate.actor);
  author.accountName = '历史改名前另一名称'; duplicate.actor = JSON.stringify(author);
  h.s.serviceInvoiceRequests.push(duplicate);
  const before = structuredClone(h.s);
  assert.throws(() => replay(h.s, member.actor, 'invoice.issue', issue), /冲突的原发票请求/);
  assert.deepEqual(h.s, before);
});

test('C09 未知摘要版本/算法、缺元数据和损坏指纹分别拒绝，不能误作旧明文', () => {
  const h = harness(), p = h.apply();
  const probes = [
    [row => row.digestVersion = 2, /摘要版本/],
    [row => row.digestVersion = '1', /摘要版本/],
    [row => delete row.digestVersion, /摘要版本/],
    [row => row.digestAlgorithm = 'SHA-512', /摘要算法/],
    [row => delete row.digestAlgorithm, /摘要算法/],
    [row => row.fingerprint = 'sha256:broken', /摘要损坏/],
    [row => row.fingerprint = serialized({ type: 'invoice.apply', payload: p }), /摘要损坏/],
    [row => { delete row.digestAlgorithm; delete row.digestVersion; }, /明文指纹损坏/],
    [row => { delete row.digestAlgorithm; delete row.digestVersion; row.fingerprint = '{broken'; }, /明文指纹损坏/]
  ];
  for (const [change, expected] of probes) {
    const input = structuredClone(h.s); change(input.serviceInvoiceRequests[0]); const before = structuredClone(input);
    assert.throws(() => replay(input, user, 'invoice.apply', p), expected);
    assert.deepEqual(input, before);
  }
});

test('C09 切人、撤权及失效工作会话在幂等前拒绝，域入口也重核真实账号', () => {
  const h = harness(), apply = h.apply();
  assert.throws(() => replay(h.s, other, 'invoice.apply', apply), /本人/);
  const member = h.staff(), issue = { id: h.inv.id, version: h.inv.version, ticketNumber: 'C09-REVOKE-BLUE', file, requestId: 'revoke-issue' };
  h.run('invoice.issue', issue, member.actor);
  const current = h.s.staffAccounts.find(row => row.id === member.accountId);
  h.run('account.revoke', { id: current.id, version: current.version, grantId: member.grantId, reason: '当前实际撤销原票岗位' }, member.admin);
  const before = structuredClone(h.s);
  assert.throws(() => replay(h.s, member.actor, 'invoice.issue', issue), /失效|变更|授权/);
  assert.throws(() => invoiceCommand(h.s, member.actor, 'invoice.issue', issue, { fail: text => { throw new Error(text); }, id: () => { throw new Error('撤权后不能分配新票'); } }), /失效|变更|授权/);
  assert.deepEqual(h.s, before);
});

test('C09 原请求result缺失/重复/跨本人根拒绝，不从旧回执借用另一个发票', () => {
  const h = harness(), p = h.apply();
  for (const change of [
    s => s.serviceInvoiceRequests[0].invoiceId = 'MISSING-SI',
    s => s.serviceInvoices.push(structuredClone(s.serviceInvoices[0])),
    s => s.serviceInvoices[0].bookingId = 'OTHER-BOOKING',
    s => s.serviceInvoices[0].userId = 'u2',
    s => s.serviceInvoices[0].storeId = 'silver'
  ]) {
    const input = structuredClone(h.s); change(input); const before = structuredClone(input);
    assert.throws(() => replay(input, user, 'invoice.apply', p), /请求结果或本人来源/);
    assert.deepEqual(input, before);
  }
});

test('C09 正常关闭后原票补正摘要重放保留旧权利，普通旧申请及原支付变化仍拒绝', () => {
  const h = harness(), apply = h.apply();
  h.run('invoice.reject', { id: h.inv.id, version: h.inv.version, reason: '原票抬头须本人补正', requestId: 'reject-before-close' }, local);
  h.close();
  const binding = closedRightsBinding(h.s, user, 'service-invoice', h.inv.id);
  assert.equal(binding.rootId, h.b.id); assert.equal(binding.userId, 'u1');
  assert.throws(() => replay(h.s, user, 'invoice.apply', apply), /已关闭|既有权益/);
  const p = { id: h.inv.id, bookingId: binding.rootId, userId: binding.userId, storeId: binding.storeId, version: h.inv.version, ...title, title: '关闭后原票补正🧾', requestId: 'closed-resubmit' };
  const beforeFunds = funds(h.s); h.run('invoice.resubmit', p);
  assert.equal(h.inv.status, 'pending'); assert.equal(h.s.serviceInvoiceRequests.at(-1).fingerprint, digest({ type: 'invoice.resubmit', payload: p }));
  const after = structuredClone(h.s); h.run('invoice.resubmit', p);
  assert.deepEqual(h.s.serviceInvoices, after.serviceInvoices); assert.deepEqual(h.s.serviceInvoiceRequests, after.serviceInvoiceRequests);
  assert.deepEqual(funds(h.s), beforeFunds);
  assert.throws(() => replay(h.s, other, 'invoice.resubmit', p), /本人|无权/);
  const changed = structuredClone(h.s); changed.bookings.at(-1).payment.id = 'UNBOUND-PAYMENT'; const before = structuredClone(changed);
  assert.throws(() => replay(changed, user, 'invoice.resubmit', p), /原支付|快照/);
  assert.deepEqual(changed, before);
});

test('C09 容器升级保持旧请求逐字不变，不自动迁移或删除明文', () => {
  const h = harness(), p = h.apply(); oldPlaintext(h.s, p.requestId, 'invoice.apply', p);
  const before = structuredClone(h.s); upgradeInvoices(h.s); upgradeInvoices(h.s);
  assert.deepEqual(h.s, before);
});

test('C09 原票附件scope纯读实际本店和当前版本，不要求尚未填写的票号原因文件', () => {
  const h = harness(); h.apply(); const member = h.staff(), before = structuredClone(h.s);
  const scope = serviceInvoiceUploadScope(h.s, member.actor, 'invoice.issue', { id: h.inv.id, version: h.inv.version });
  assert.equal(scope.actor.accountId, member.accountId); assert.equal(scope.row.id, h.inv.id);
  assert.equal(scope.source.booking.id, h.b.id); assert.equal(scope.source.summary.netCents, 29800); assert.equal(scope.slot, 'issued');
  assert.deepEqual(h.s, before);
  scope.row.title = '调用者不得回写原票'; scope.source.booking.status = 'cancelled'; scope.actor.accountName = '调用者副本';
  assert.deepEqual(h.s, before);
  for (const actor of [user, other, { role: 'store', storeId: 'silver' }, finance]) assert.throws(() => serviceInvoiceUploadScope(h.s, actor, 'invoice.issue', { id: h.inv.id, version: h.inv.version }), /原服务门店/);
  assert.throws(() => serviceInvoiceUploadScope(h.s, member.actor, 'invoice.issue', { id: h.inv.id, version: h.inv.version - 1 }), /已更新/);
  assert.throws(() => serviceInvoiceUploadScope(h.s, member.actor, 'invoice.apply', { id: h.inv.id, version: h.inv.version }), /不支持/);
});

test('C09 原票scope缺/重复原invoice booking user store或本人根冲突拒绝', () => {
  const h = harness(); h.apply();
  const changes = [
    s => s.serviceInvoices = [], s => s.serviceInvoices.push(structuredClone(s.serviceInvoices[0])),
    s => s.bookings = [], s => s.bookings.push(structuredClone(s.bookings[0])),
    s => s.users = s.users.filter(row => row.id !== 'u1'), s => s.users.push(structuredClone(s.users.find(row => row.id === 'u1'))),
    s => s.stores = s.stores.filter(row => row.id !== 'xingfu'), s => s.stores.push(structuredClone(s.stores.find(row => row.id === 'xingfu'))),
    s => s.bookings[0].userId = 'u2', s => s.serviceInvoices[0].storeId = 'silver'
  ];
  for (const change of changes) {
    const input = structuredClone(h.s); change(input); const before = structuredClone(input);
    assert.throws(() => serviceInvoiceUploadScope(input, local, 'invoice.issue', { id: h.inv.id, version: h.inv.version }), /缺失|冲突|原服务门店/);
    assert.deepEqual(input, before);
  }
});

test('C09 原票scope沿实际退款红冲与补传槽，净额归零仍保留红冲权', () => {
  const h = harness(); h.apply();
  h.run('invoice.issue', { id: h.inv.id, version: h.inv.version, ticketNumber: 'C09-SCOPE-BLUE', file }, local);
  const beforeIssue = structuredClone(h.s), p = { id: h.inv.id, version: h.inv.version };
  assert.throws(() => serviceInvoiceUploadScope(h.s, local, 'invoice.issue', p), /待开票/);
  assert.throws(() => serviceInvoiceUploadScope(h.s, local, 'invoice.red', p), /待红冲/);
  assert.equal(serviceInvoiceUploadScope(h.s, local, 'invoice.replace-file', { ...p, slot: 'issued' }).slot, 'issued');
  assert.throws(() => serviceInvoiceUploadScope(h.s, local, 'invoice.replace-file', { ...p, slot: 'red' }), /没有可补传/);
  assert.deepEqual(h.s, beforeIssue);
  h.run('booking.refund-request', { id: h.b.id, reason: '原预约全额退款协商', requests: [{ paymentId: h.b.payment.id, amountCents: h.b.payment.amountCents }] });
  const refundId = h.b.refunds.at(-1).id;
  h.run('booking.refund-review', { id: h.b.id, refundId, decision: 'approve', reason: '原门店核实同意全额退款' }, { role: 'manager', storeId: 'xingfu' });
  h.run('booking.refund-pay', { id: h.b.id, refundId, outcome: 'success' }, local);
  assert.equal(h.inv.status, 'red_pending');
  const beforeRed = structuredClone(h.s), redScope = serviceInvoiceUploadScope(h.s, local, 'invoice.red', { id: h.inv.id, version: h.inv.version });
  assert.equal(redScope.slot, 'red'); assert.equal(redScope.source.summary.netCents, 0); assert.deepEqual(h.s, beforeRed);
  h.run('invoice.red', { id: h.inv.id, version: h.inv.version, ticketNumber: 'C09-SCOPE-RED', file }, local);
  assert.equal(h.inv.status, 'red');
  assert.equal(serviceInvoiceUploadScope(h.s, local, 'invoice.replace-file', { id: h.inv.id, version: h.inv.version, slot: 'red' }).slot, 'red');
});

test('C09 原票附件scope当前撤权与未结退款阻断，不伪造可上传状态', () => {
  const h = harness(); h.apply(); const member = h.staff();
  const p = { id: h.inv.id, version: h.inv.version };
  h.run('booking.refund-request', { id: h.b.id, reason: '原退款待核', requests: [{ paymentId: h.b.payment.id, amountCents: 1000 }] });
  assert.throws(() => serviceInvoiceUploadScope(h.s, member.actor, 'invoice.issue', p), /未结退款/);
  const account = h.s.staffAccounts.find(row => row.id === member.accountId);
  h.run('account.revoke', { id: account.id, version: account.version, grantId: member.grantId, reason: '原岗位结束' }, member.admin);
  const before = structuredClone(h.s);
  assert.throws(() => serviceInvoiceUploadScope(h.s, member.actor, 'invoice.issue', p), /失效|变更/);
  assert.deepEqual(h.s, before);
});
