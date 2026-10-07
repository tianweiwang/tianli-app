import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacyUploadTabs, PRIVACY_UPLOAD_TAB_MARKER } from './privacy-upload-tabs.mjs';
import { lifecycleFingerprint as hash } from './organization-lifecycle-projection.mjs';
import { createIndexedDBStandin } from './privacy-cleanup-test-fixture.mjs';
import { createPrivacyCleanupStorage } from './privacy-cleanup-storage.mjs';
import { saveInvoiceFile } from './invoice-files.mjs';
import { saveMedia } from './media.mjs';

// Two distinct document Storage instances, one injected original-origin lock.
// Native session/ledger/IDB are synthetic; Blob/SHA and original file producers
// are real. No browser, real business storage, policy or delete call.
const idb = createIndexedDBStandin(), originalIDB = globalThis.indexedDB;
globalThis.indexedDB = idb.indexedDB;
const ORIGIN = 'https://synthetic-tabs.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=', 'base64');
test.beforeEach(() => { idb.setHook(null); for (const db of idb.databases.values()) for (const store of db.stores.values()) store.clear(); idb.events.length = 0; });
test.after(() => { globalThis.indexedDB = originalIDB; });
class Session {
  constructor(copy) { this.values = new Map(copy?.values || []); this.events = []; this.hook = null; }
  get length() { return this.values.size; }
  key(index) { this.hook?.('key'); return [...this.values.keys()][index] ?? null; }
  getItem(key) { this.events.push({ op: 'get', key }); this.hook?.('get', key); return this.values.get(key) ?? null; }
  setItem(key, value) { this.events.push({ op: 'set', key }); this.hook?.('set', key); this.values.set(key, String(value)); }
  removeItem(key) { this.events.push({ op: 'remove', key }); this.hook?.('remove', key); this.values.delete(key); }
}
const draft = (userId = 'u1', bookingId = 'B1', extra = {}) => JSON.stringify({ userId, bookingId, contactName: 'PRIVATE-CONTACT-13800001111', ...extra });
async function fixture() {
  const invoice = await saveInvoiceFile(new File(['%PDF-1.4\nSYNTHETIC\n%%EOF'], 'PRIVATE-FILE.pdf', { type: 'application/pdf' }));
  const media = await saveMedia(new Blob([PNG], { type: 'image/png' }));
  let state = { schema: 5, now: 1000, users: [{ id: 'u1' }, { id: 'u2' }], stores: [{ id: 's1' }], techs: [{ id: 't1' }], bookings: [{ id: 'B1', userId: 'u1' }, { id: 'B2', userId: 'u2' }], originalFiles: [{ file: invoice }, { image: media }] };
  const fileStore = createPrivacyCleanupStorage({ indexedDB: idb.indexedDB, originScope: ORIGIN });
  let held = false, queue = Promise.resolve(), docSeq = 0;
  const h = { invoice, media, events: [], commitHook: null, listHook: null, get state() { return state; }, set state(value) { state = structuredClone(value); } };
  h.withMutation = callback => {
    const next = queue.then(async () => { assert.equal(held, false); held = true; try { return await callback(); } finally { held = false; } });
    queue = next.catch(() => {}); return next;
  };
  h.document = ({ storage = new Session(), id, scopeOverride, contextOverride, initialOverride } = {}) => {
    const prefix = 'DOC-' + (++docSeq); let seq = 0;
    const dep = {
      withMutation: h.withMutation, load: () => structuredClone(state), sessionStorage: storage,
      currentContext: () => contextOverride?.() || { actor: { role: 'user', userId: 'u1' }, originScope: ORIGIN, writerProtocolVersion: 1 },
      scopeForDraft: c => {
        if (scopeOverride) return scopeOverride(c);
        if (!/^(booking|management|request):/.test(c.key)) throw Error('unknown original key');
        const value = JSON.parse(c.value), root = state.bookings.find(row => row.id === value.bookingId);
        if (!root || root.userId !== value.userId) throw Error('original root mismatch');
        return { kind: c.key.startsWith('request:') ? 'request-key' : c.key.startsWith('management:') ? 'management-draft' : 'booking-draft', disposition: 'scoped', source: { kind: 'booking', id: root.id }, sourceToken: root, subjects: [{ kind: 'user', id: root.userId }], roots: [{ kind: 'booking', id: root.id }] };
      },
      commit: async (next, { expectedStateToken }) => { assert.equal(held, true); assert.equal(hash(state), expectedStateToken); h.events.push({ op: 'commit', status: next.privacyUploadTabs.at(-1)?.status }); h.commitHook?.(next); state = structuredClone(next); },
      listStoredRefs: async library => { assert.equal(held, true); await h.listHook?.(library); return fileStore.listStoredRefs(library); },
      initialHandover: c => { if (initialOverride) return initialOverride(c); const source = c.state.privacyUploadProtocolSources?.[0]; return source ? { id: source.id, version: source.version, sourceToken: hash(source) } : null; },
      revisionPlan: c => { const plan = c.state.privacyUploadTabRevisions?.at(-1); return plan ? { id: plan.id, version: plan.version, sourceToken: hash(plan) } : null; },
      id: id || (() => prefix + '-' + (++seq))
    };
    return { tabs: createPrivacyUploadTabs(dep), storage, deps: dep };
  };
  h.handover = () => {
    const source = { id: 'SYNTHETIC-PROTOCOL-SOURCE', version: (state.privacyUploadProtocolSources?.[0]?.version || 0) + 1, originScope: ORIGIN, protocolVersion: 1, writerProtocolVersion: 1, status: 'verified',
      legacyCensus: { kind: 'controlled-protocol-handover', referenceDigest: hash('synthetic controlled-origin evidence'), sourceToken: hash('actual test writers and session scans'), verifiedAt: state.now }, knownInstances: state.privacyUploadTabs.map(({ tabId, instanceId }) => ({ tabId, instanceId })), legacySources: [], unknownSources: [] };
    state.privacyUploadProtocolSources = [source];
  };
  h.plan = (docs, specs) => {
    state.privacyUploadTabRevisions = [{ id: 'SYNTHETIC-REVISION', version: 1, revision: 2, originScope: ORIGIN, protocolVersion: 1, status: 'requested', scope: { subjects: [{ kind: 'user', id: 'u1' }], roots: [{ kind: 'booking', id: 'B1' }] },
      targets: specs.map(({ document, key, treatment = 'remove', expectedValueDigest = null }) => ({ ...docs[document].tabs.identity(), keyDigest: hash(key), treatment, expectedValueDigest })) }];
  };
  return h;
}
const row = (h, document) => h.state.privacyUploadTabs.find(item => item.id === document.tabs.identity().instanceId);

test('scoped restore reads one proven original key while unknown sibling and global coverage stay pending', async () => {
  const h = await fixture(), a = h.document();
  a.storage.setItem('management:known', draft('u1', 'B1', {file:h.invoice}));a.storage.setItem('unknown:old','PRIVATE-UNKNOWN');await a.tabs.register();
  const actual=a.storage.getItem('management:known'),result=await a.tabs.restoreScoped(['management:known'],s=>s.getItem('management:known'));
  assert.equal(result.result,actual);assert.equal(row(h,a).ackRevision,null);assert.equal(row(h,a).manifest.complete,false);
  const receipt=row(h,a).scopedReceipts.find(x=>x.id===result.receipt.receiptId);
  assert.equal(receipt.readbackVerified,true);assert.equal(receipt.acknowledged,false);assert.equal(receipt.entries[0].refs[0].ref,h.invoice.ref);
  assert.equal(hash(receipt),result.receipt.sourceToken);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE-|13800001111/);
  assert.equal((await a.tabs.coverage()).uploadsComplete,false);
});

test('scoped restore is read only, checks exact revision target and rejects changed source after await', async () => {
  const h=await fixture(),a=h.document();a.storage.setItem('booking:a',draft());await a.tabs.register();
  h.plan([a],[{document:0,key:'booking:a'}]);await assert.rejects(a.tabs.restoreScoped(['booking:a']),e=>e.code==='revision_pending');
  h.plan([a],[{document:0,key:'booking:a',treatment:'retain',expectedValueDigest:hash(draft())}]);
  const ok=await a.tabs.restoreScoped(['booking:a'],s=>{assert.equal(s.setItem,undefined);assert.throws(()=>s.getItem('booking:other'));return s.getItem('booking:a');});assert.equal(ok.result,draft());
  const count=row(h,a).scopedReceipts.length;
  await assert.rejects(a.tabs.restoreScoped(['booking:a'],async s=>{const value=s.getItem('booking:a');await Promise.resolve();h.state.bookings[0].version=2;return value;}),e=>e.code==='context_changed');
  assert.equal(row(h,a).scopedReceipts.length,count);
});

test('scoped restore does not treat missing revision targets or damaged file references as safe',async()=>{
  const h=await fixture(),a=h.document();a.storage.setItem('booking:a',draft());await a.tabs.register();h.plan([a],[]);
  await assert.rejects(a.tabs.restoreScoped(['booking:a']),e=>e.code==='revision_pending');
  h.state.privacyUploadTabRevisions=[];a.storage.setItem('booking:a',draft('u1','B1',{file:'invoice-file:broken'}));
  await assert.rejects(a.tabs.restoreScoped(['booking:a']),e=>e.code==='session_unverified');
  assert.equal(row(h,a).scopedReceipts,undefined);
});

test('a fresh document records the exact inherited known receipt without inheriting identity or ack',async()=>{
  const h=await fixture(),a=h.document();a.storage.setItem('booking:a',draft());await a.tabs.register();const prior=structuredClone(row(h,a));
  const b=h.document({storage:new Session(a.storage)});await b.tabs.register();const restored=await b.tabs.restoreScoped(['booking:a']);
  const receipt=row(h,b).scopedReceipts.find(x=>x.id===restored.receipt.receiptId);
  assert.equal(receipt.predecessor.instanceId,a.tabs.identity().instanceId);assert.equal(receipt.predecessor.manifestDigest,prior.manifest.digest);
  assert.equal(receipt.predecessor.receiptId,prior.receipts.at(-1).id);assert.notEqual(receipt.instanceId,receipt.predecessor.instanceId);
  assert.deepEqual(row(h,a),prior);assert.equal(row(h,b).ackRevision,null);
});

test('limited technical transition permits the original invalid-session exit without ack or general business writes',async()=>{
  const h=await fixture(),actorKey='tianli-integrated-v5-actor',taskKey='tianli-integrated-v5-task-return:original',raw={role:'store',storeId:'s1',sessionId:'REVOKED'},a=h.document({contextOverride:()=>({actor:raw,originScope:ORIGIN,writerProtocolVersion:1}),scopeOverride:c=>({kind:'task-context',disposition:'technical',source:{kind:'task-return',id:'original'},sourceToken:{store:c.state.stores[0],key:c.key},subjects:[{kind:'store',id:'s1'}],roots:[]})});
  a.storage.setItem(actorKey,JSON.stringify(raw));a.storage.setItem(taskKey,'PRIVATE-TASK');a.storage.setItem('unknown:keep','PRIVATE-KEEP');
  const target=JSON.stringify({role:'store',storeId:'s1'});
  a.deps.technicalTransition=({state,kind})=>({kind,source:{kind:'account-exit',id:'REVOKED'},sourceToken:{raw,target,store:state.stores[0]},actorValue:target,path:'/store/work-login',tasks:[{key:taskKey,valueDigest:hash('PRIVATE-TASK')}]});
  const result=await a.tabs.transition('account-exit');assert.equal(result.path,'/store/work-login');assert.equal(a.storage.getItem(actorKey),target);assert.equal(a.storage.getItem(taskKey),null);assert.equal(a.storage.getItem('unknown:keep'),'PRIVATE-KEEP');
  assert.equal(row(h,a).status,'pending');assert.equal(row(h,a).ackRevision,null);assert.doesNotMatch(JSON.stringify(row(h,a).technicalReceipts),/PRIVATE-|REVOKED/);
  await assert.rejects(a.tabs.mutate('write',s=>s.setItem('booking:x',draft())));
});

test('technical transition rejects arbitrary keys and changed original source; preparing failure leaves actor intact',async()=>{
  const h=await fixture(),a=h.document(),actorKey='tianli-integrated-v5-actor',initial=JSON.stringify({role:'user',userId:'u1'});a.storage.setItem(actorKey,initial);
  let wrong=true;
  a.deps.technicalTransition=({state,kind})=>({kind,source:{kind:'account-exit',id:'ORIGINAL'},sourceToken:state.stores[0],actorValue:JSON.stringify({role:'store',storeId:'s1'}),path:'/store/work-login',tasks:wrong?[{key:'management:other',valueDigest:hash('other')}]:[]});
  await assert.rejects(a.tabs.transition('account-exit'),e=>e.code==='target_out_of_scope');assert.equal(a.storage.getItem(actorKey),initial);
  wrong=false;h.commitHook=()=>{throw Error('isolated preparing failure');};await assert.rejects(a.tabs.transition('account-exit'));assert.equal(a.storage.getItem(actorKey),initial);
  h.commitHook=null;let changed=false;a.storage.hook=(op,key)=>{if(op==='set'&&key===actorKey&&!changed){changed=true;h.state.stores[0].version=2;}};
  await assert.rejects(a.tabs.transition('account-exit'),e=>e.code==='result_unverified');assert.equal(row(h,a).status,'pending');assert.equal(row(h,a).ackRevision,null);
});

test('closed-store login draft transition writes only the two original login keys and keeps actor, unknown values and ack unchanged',async()=>{
  const h=await fixture(),raw={role:'store',storeId:'s1'},a=h.document({contextOverride:()=>({actor:raw,originScope:ORIGIN,writerProtocolVersion:1})});
  h.state.stores[0].lifecycleStatus='closed';h.state.staffAccounts=[{id:'ORIGINAL-ACCOUNT',grants:[{id:'ORIGINAL-GRANT'}]}];
  const actorKey='tianli-integrated-v5-actor';a.storage.setItem(actorKey,JSON.stringify(raw));a.storage.setItem('unknown:keep','PRIVATE-KEEP');
  // Trusted original account getter contract only; actual accountEnterActor is
  // exercised in the app tests, not replaced by this isolated protocol fixture.
  a.deps.technicalTransition=({state,kind})=>({kind,source:{kind:'staff-account',id:'ORIGINAL-ACCOUNT'},sourceToken:[state.stores[0],state.staffAccounts[0]],actorValue:JSON.stringify(raw),path:'/store/work-login',tasks:[],login:{accountId:'ORIGINAL-ACCOUNT',grantId:'ORIGINAL-GRANT',requestId:'ORIGINAL-REQUEST'}});
  await a.tabs.transition('account-entry-draft');
  const actual=[...a.storage.values.keys()].filter(key=>key.includes('-management:')||key.includes('-request:'));
  assert.equal(actual.length,2);assert.equal(a.storage.getItem(actorKey),JSON.stringify(raw));assert.equal(a.storage.getItem('unknown:keep'),'PRIVATE-KEEP');
  assert.equal(row(h,a).status,'pending');assert.equal(row(h,a).ackRevision,null);assert.equal(row(h,a).technicalReceipts.at(-1).writtenKeys.length,2);assert.doesNotMatch(JSON.stringify(row(h,a).technicalReceipts),/ORIGINAL-ACCOUNT|ORIGINAL-REQUEST|PRIVATE-KEEP/);
  await assert.rejects(a.tabs.mutate('write',s=>s.setItem('booking:x',draft())));
});

test('real own-session readback stores only digests, typed roots and current refs; default coverage has no authorization', async () => {
  const h = await fixture(), a = h.document();
  a.storage.setItem('booking:PRIVATE-KEY-13800001111', draft('u1', 'B1', { file: h.invoice }));
  await a.tabs.register();
  const stored = JSON.stringify(h.state.privacyUploadTabs);
  for (const secret of ['PRIVATE-KEY', 'PRIVATE-CONTACT', '13800001111', 'PRIVATE-FILE.pdf']) assert.ok(!stored.includes(secret));
  assert.equal(row(h, a).manifest.entries.find(item => item.kind === 'booking-draft').refs[0].ref, h.invoice.ref);
  const result = await a.tabs.coverage({ ready: true, tabIds: ['invented'] });
  assert.equal(result.ledgerComplete, false); assert.equal(result.uploadsComplete, false); assert.equal(result.deleteAllowed, false);
  assert.ok(result.blockers.some(item => item.kind === 'handover_pending'));
});

test('two actual documents get unique identities; copied session marker never inherits an old ack', async () => {
  const h = await fixture(), a = h.document(); a.storage.setItem('booking:a', draft()); await a.tabs.register();
  const b = h.document({ storage: new Session(a.storage) });
  h.plan([a, b], [{ document: 0, key: 'booking:a' }]);
  await a.tabs.mutate('cleanup', storage => storage.removeItem('booking:a'));
  await b.tabs.register(); h.handover();
  assert.notDeepEqual(a.tabs.identity(), b.tabs.identity());
  assert.equal(row(h, a).ackRevision, 2); assert.equal(row(h, b).ackRevision, null);
  assert.ok(row(h, b).inheritedMarkerDigest); assert.equal((await a.tabs.coverage()).uploadsComplete, false);
});

test('duplicate document or tab identifiers refuse registration before replacing the inherited marker', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register();
  const ids = [a.tabs.identity().tabId, a.tabs.identity().instanceId], b = h.document({ storage: new Session(a.storage), id: () => ids.shift() });
  const before = b.storage.getItem(PRIVACY_UPLOAD_TAB_MARKER), state = structuredClone(h.state);
  await assert.rejects(b.tabs.register(), error => error.code === 'instance_conflict');
  assert.equal(b.storage.getItem(PRIVACY_UPLOAD_TAB_MARKER), before); assert.deepEqual(h.state, state);
});

test('every original session write durably invalidates the old ack before I/O, then actual readback restores it', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register(); h.handover();
  a.storage.hook = op => { if (op === 'set') assert.equal(row(h, a).status, 'pending'); };
  await a.tabs.mutate('write', storage => storage.setItem('booking:new', draft()));
  assert.equal(row(h, a).status, 'acknowledged'); assert.equal(row(h, a).ackRevision, 1);
  assert.equal(row(h, a).manifest.entries.find(item => item.kind === 'booking-draft').valueDigest, hash(a.storage.getItem('booking:new')));
});

test('preparing commit failure prevents the original session write', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register();
  h.commitHook = () => { throw Error('synthetic before write commit failure'); };
  await assert.rejects(a.tabs.mutate('write', storage => storage.setItem('booking:new', draft())));
  assert.equal(a.storage.getItem('booking:new'), null);
});

test('result commit failure leaves real session change and durable pending visible to another document', async () => {
  const h = await fixture(), a = h.document(), b = h.document(); await a.tabs.register(); await b.tabs.register(); h.handover();
  let writes = 0; h.commitHook = () => { if (++writes === 2) throw Error('synthetic result journal failure'); };
  await assert.rejects(a.tabs.mutate('write', storage => storage.setItem('booking:new', draft())), error => error.code === 'result_unverified');
  assert.ok(a.storage.getItem('booking:new')); assert.equal(row(h, a).status, 'pending'); assert.equal(row(h, a).ackRevision, null);
  h.commitHook = null; assert.equal((await b.tabs.coverage()).uploadsComplete, false);
});

test('partial writer failure records actual manifest, retains pending and stores no free error text/code', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register();
  await assert.rejects(a.tabs.mutate('write', storage => { storage.setItem('booking:new', draft()); const error = Error('PRIVATE-ERROR'); error.code = 'PRIVATE-CODE'; throw error; }), error => error.code === 'writer_failed');
  assert.equal(row(h, a).status, 'pending'); assert.ok(row(h, a).manifest.entries.some(item => item.keyDigest === hash('booking:new')));
  assert.ok(!JSON.stringify(h.state.privacyUploadTabs).includes('PRIVATE-ERROR')); assert.ok(!JSON.stringify(h.state.privacyUploadTabs).includes('PRIVATE-CODE'));
});

test('denied session read and unknown legacy scope remain pending rather than acknowledging an empty session', async () => {
  const h = await fixture(), a = h.document(); a.storage.setItem('unlocated:old', 'PRIVATE-LEGACY'); await a.tabs.register();
  assert.equal(row(h, a).status, 'pending'); h.handover(); assert.equal((await a.tabs.coverage()).uploadsComplete, false);
  const b = h.document(); b.storage.hook = op => { if (op === 'get') throw Error('synthetic denied session'); };
  await assert.rejects(b.tabs.register()); assert.equal(row(h, b).status, 'pending'); assert.equal(row(h, b).manifest, null);
});

test('inline bytes in a known original draft remain pending even when they are not a supported image format', async () => {
  const h = await fixture(), a = h.document();
  a.storage.setItem('booking:inline', draft('u1', 'B1', { oldFile: 'data:application/pdf;base64,JVBERi0xLjQ=' }));
  assert.equal((await a.tabs.register()).status, 'pending');
  assert.ok(row(h, a).manifest.issues.some(issue => issue.code === 'legacy_inline_pending'));
  h.handover(); assert.equal((await a.tabs.coverage()).uploadsComplete, false);
});

test('an unlocated old-protocol marker cannot disappear into a fresh baseline ack', async () => {
  const h = await fixture(), a = h.document();
  a.storage.setItem(PRIVACY_UPLOAD_TAB_MARKER, JSON.stringify({ protocolVersion: 0, tabId: 'OLD-UNKNOWN', instanceId: 'OLD-UNKNOWN-DOCUMENT' }));
  const first = await a.tabs.register();
  assert.equal(first.status, 'pending'); assert.equal(row(h, a).inheritedUnknown, true);
  h.handover(); assert.equal((await a.tabs.acknowledge()).status, 'pending');
  const receipt = row(h, a).receipts.at(-1), source = h.state.privacyUploadProtocolSources[0];
  source.legacySources = [{ id: row(h, a).inheritedMarkerDigest, tabId: a.tabs.identity().tabId, instanceId: a.tabs.identity().instanceId, status: 'readback_verified', receiptId: receipt.id, sourceToken: hash(receipt) }];
  assert.equal((await a.tabs.acknowledge()).status, 'acknowledged');
});

test('changing current actor while the original async writer is pending rejects further native writes', async () => {
  const h = await fixture(); let userId = 'u1';
  const a = h.document({ contextOverride: () => ({ actor: { role: 'user', userId }, originScope: ORIGIN, writerProtocolVersion: 1 }) }); await a.tabs.register();
  await assert.rejects(a.tabs.mutate('write', async storage => { await Promise.resolve(); userId = 'u2'; storage.setItem('booking:own', draft()); }), error => error.code === 'context_changed');
  assert.equal(a.storage.getItem('booking:own'), null); assert.equal(row(h, a).status, 'pending');
});

test('register result commit failure cannot lose the unknown inherited marker after native replacement', async () => {
  const h = await fixture(), a = h.document();
  a.storage.setItem(PRIVACY_UPLOAD_TAB_MARKER, 'UNKNOWN-OLD-PROTOCOL');
  h.commitHook = next => { if (next.privacyUploadTabs.at(-1).manifest) throw Error('synthetic register result commit failure'); };
  await assert.rejects(a.tabs.register());
  assert.notEqual(a.storage.getItem(PRIVACY_UPLOAD_TAB_MARKER), 'UNKNOWN-OLD-PROTOCOL');
  assert.equal(row(h, a).inheritedUnknown, true); assert.equal(row(h, a).inheritedMarkerDigest, hash('UNKNOWN-OLD-PROTOCOL'));
  h.commitHook = null; h.handover();
  assert.equal((await a.tabs.acknowledge()).status, 'pending'); assert.equal(row(h, a).ackRevision, null);
});

test('missing or replaced native instance marker cannot gain an ack merely by reading the remaining session', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register(); h.handover();
  a.storage.removeItem(PRIVACY_UPLOAD_TAB_MARKER);
  assert.equal((await a.tabs.acknowledge()).status, 'pending');
  a.storage.setItem(PRIVACY_UPLOAD_TAB_MARKER, JSON.stringify({ ...a.tabs.identity(), instanceId: 'OTHER-DOCUMENT', originScope: ORIGIN }));
  assert.equal((await a.tabs.acknowledge()).status, 'pending'); assert.equal((await a.tabs.coverage()).uploadsComplete, false);
});

test('exact revision scope clears one root, preserves another owner and does not copy old refs into history', async () => {
  const h = await fixture(), a = h.document();
  a.storage.setItem('booking:own', draft('u1', 'B1', { file: h.invoice })); a.storage.setItem('booking:other', draft('u2', 'B2'));
  await a.tabs.register(); h.plan([a], [{ document: 0, key: 'booking:own' }]);
  assert.equal((await a.tabs.acknowledge()).status, 'pending');
  await a.tabs.mutate('cleanup', storage => storage.removeItem('booking:own'));
  assert.equal(row(h, a).ackRevision, 2); assert.ok(a.storage.getItem('booking:other')); assert.equal(a.storage.getItem('booking:own'), null);
  assert.ok(!JSON.stringify(row(h, a)).includes(h.invoice.ref));
  h.handover(); assert.equal((await a.tabs.coverage()).ledgerComplete, true);
});

test('cleanup facade rejects other root/key and wrong rewrite value before native writes', async () => {
  const h = await fixture(), a = h.document(); a.storage.setItem('booking:own', draft()); a.storage.setItem('booking:other', draft('u2', 'B2')); await a.tabs.register();
  const replacement = draft('u1', 'B1', { contactName: 'policy-cleared' });
  h.plan([a], [{ document: 0, key: 'booking:own', treatment: 'rewrite', expectedValueDigest: hash(replacement) }]);
  const other = a.storage.getItem('booking:other'), original = a.storage.getItem('booking:own');
  await assert.rejects(a.tabs.mutate('cleanup', storage => storage.removeItem('booking:other')), error => error.code === 'target_out_of_scope');
  await assert.rejects(a.tabs.mutate('cleanup', storage => storage.setItem('booking:own', 'WRONG')), error => error.code === 'target_out_of_scope');
  assert.equal(a.storage.getItem('booking:other'), other); assert.equal(a.storage.getItem('booking:own'), original);
  await a.tabs.mutate('cleanup', storage => storage.setItem('booking:own', replacement)); assert.equal(row(h, a).ackRevision, 2);
});

test('a stale revision rejects restoring old form values before the restore callback runs', async () => {
  const h = await fixture(), a = h.document(); a.storage.setItem('booking:own', draft()); await a.tabs.register(); h.plan([a], [{ document: 0, key: 'booking:own' }]);
  let ran = false; await assert.rejects(a.tabs.mutate('restore', () => { ran = true; }), error => error.code === 'revision_pending'); assert.equal(ran, false);
});

test('known sleeping documents cannot gain a new revision ack through elapsed time or another document', async () => {
  const h = await fixture(), a = h.document(), b = h.document(); await a.tabs.register(); await b.tabs.register(); h.handover();
  h.plan([a, b], []); await a.tabs.acknowledge(); h.state = { ...h.state, now: 999999999 };
  const result = await a.tabs.coverage(); assert.equal(row(h, b).ackRevision, 1); assert.equal(result.uploadsComplete, false);
  assert.ok(result.blockers.some(item => item.kind === 'tab_pending' && item.sourceId === b.tabs.identity().instanceId));
});

test('initial handshake requires the actual persisted typed source and all known instances, never ready booleans', async () => {
  const h = await fixture(), a = h.document({ initialOverride: () => ({ ready: true, tabIds: ['fake'] }) }); await a.tabs.register(); h.handover();
  assert.equal((await a.tabs.coverage()).ledgerComplete, false);
  const b = h.document(); await b.tabs.register(); assert.equal((await b.tabs.coverage()).ledgerComplete, false);
  h.handover(); assert.equal((await b.tabs.coverage()).ledgerComplete, true);
  h.state.privacyUploadProtocolSources[0].unknownSources = [{ id: 'unknown-old-js' }]; assert.equal((await b.tabs.coverage()).ledgerComplete, false);
});

test('missing source versions and a revision target with no real registered instance keep coverage pending', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register(); h.handover();
  delete h.state.privacyUploadProtocolSources[0].version;
  assert.equal((await a.tabs.coverage()).uploadsComplete, false);
  h.handover(); h.plan([a], []); delete h.state.privacyUploadTabRevisions[0].version;
  assert.equal((await a.tabs.acknowledge()).status, 'pending');
  h.state.privacyUploadTabRevisions[0].version = 1;
  h.state.privacyUploadTabRevisions[0].targets = [{ tabId: 'UNLOCATED-TAB', instanceId: 'UNLOCATED-DOCUMENT', keyDigest: hash('booking:unknown'), treatment: 'remove', expectedValueDigest: null }];
  assert.equal((await a.tabs.acknowledge()).status, 'pending'); assert.equal((await a.tabs.coverage()).uploadsComplete, false);
});

test('legacy protocol and missing readback receipt never count as a verified handover', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register(); h.handover();
  h.state.privacyUploadProtocolSources[0].legacySources = [{ id: 'old', tabId: a.tabs.identity().tabId, instanceId: a.tabs.identity().instanceId, status: 'readback_verified', receiptId: 'missing', sourceToken: hash('claim') }];
  assert.equal((await a.tabs.coverage()).ledgerComplete, false);
  h.handover(); h.state.privacyUploadTabs[0].protocolVersion = 0; assert.equal((await a.tabs.coverage()).ledgerComplete, false);
});

test('actual original two-store census marks unregistered bytes; registered/global refs are covered', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register(); h.handover(); assert.equal((await a.tabs.coverage()).uploadsComplete, true);
  const orphan = await saveMedia(new Blob([PNG, 'new-unused-selection'], { type: 'image/png' }));
  const first = await a.tabs.coverage(); assert.ok(first.unregisteredStoredRefs.some(item => item.ref === orphan)); assert.equal(first.uploadsComplete, false);
  h.state.privacyUploadReservations = [{ id: 'actual-test-registration', library: 'media', ref: orphan }];
  assert.equal((await a.tabs.coverage()).uploadsComplete, true);
});

test('actual library read failure and source mutation during awaited census remain pending', async () => {
  const h = await fixture(), a = h.document(); await a.tabs.register(); h.handover();
  h.listHook = library => { if (library === 'media') throw Error('synthetic original-store read fault'); };
  assert.ok((await a.tabs.coverage()).blockers.some(item => item.kind === 'file_census_pending'));
  h.listHook = library => { if (library === 'invoice') h.state = { ...h.state, now: h.state.now + 1 }; };
  assert.ok((await a.tabs.coverage()).blockers.some(item => item.kind === 'source_changed'));
});

test('coverage is read-only and emits opaque source token without revealing or changing raw session values', async () => {
  const h = await fixture(), a = h.document(); a.storage.setItem('booking:own', draft()); await a.tabs.register(); h.handover();
  const before = structuredClone(h.state), raw = new Map(a.storage.values), result = await a.tabs.coverage();
  assert.deepEqual(h.state, before); assert.deepEqual(a.storage.values, raw); assert.match(result.sourceToken, /^sha256:[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-CONTACT')); assert.equal(result.deleteAllowed, false);
});
