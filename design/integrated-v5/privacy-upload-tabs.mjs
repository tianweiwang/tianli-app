// Internal protocol only. Root supplies the existing KEY lock, original source
// guards and this document's real Storage. No policy or delete authorization.
import { resolveAccountActor } from './staff-accounts.mjs';
import { collectPrivacyFileReferences } from './privacy-cleanup-inventory.mjs';
import { lifecycleFingerprint as hash } from './organization-lifecycle-projection.mjs';

export const PRIVACY_UPLOAD_TAB_PROTOCOL = 1;
export const PRIVACY_UPLOAD_TAB_MARKER = 'tianli-integrated-v5-privacy-tab-instance';
const clone = value => structuredClone(value);
const digest = value => /^sha256:[a-f0-9]{64}$/.test(value || '');
const same = (a, b) => hash(a) === hash(b);
const kinds = new Set(['booking-draft', 'management-draft', 'request-key', 'actor-session', 'task-context', 'result-key']);
const mutations = new Set(['write', 'replace', 'remove', 'restore', 'cleanup']);
const codes = new Set(['invalid_context', 'source_missing', 'ledger_unavailable', 'scope_missing', 'runtime_missing', 'protocol_missing', 'actor_unavailable', 'session_unavailable', 'session_unverified', 'instance_conflict', 'instance_changed', 'commit_unverified', 'revision_missing', 'revision_pending', 'marker_protected', 'target_out_of_scope', 'context_changed', 'writer_failed']);
const safeCode = (error, fallback) => codes.has(error?.code) ? error.code : fallback;
const refPatterns = { invoice: /^invoice-file:[a-f0-9]{64}$/, media: /^media:[a-f0-9]{64}$/ };
const fail = (code, message, facts) => { const error = Error(message); error.code = code; if (facts) error.facts = clone(facts); throw error; };
const rows = s => s.privacyUploadTabs || [];
function selectionFacts(key,value,kind) {
  if(kind!=='management-draft')return [];
  let draft;try{draft=JSON.parse(value);}catch{return [];}
  if(draft?.uploadSelections==null)return [];
  if(!Array.isArray(draft.uploadSelections))fail('session_unverified','原附件侧记无法核实。');
  return draft.uploadSelections.filter(item=>item?.published===true&&item.released===false).map(item=>{
    if(!Number.isSafeInteger(item.version)||item.version<1||!['evidenceRefs','file','image','gallery0','gallery1','gallery2','gallery3'].includes(item.field)||!Object.values(refPatterns).some(pattern=>pattern.test(item.ref||'')))fail('session_unverified','原附件侧记来源缺失。');
    // The original single-file forms persist four hidden file* fields. Their
    // registry field is "file", while its exact stored reference is fileRef.
    const fields=(Array.isArray(draft.values)?draft.values:[]).filter(field=>field.name===(item.field==='file'?'fileRef':item.field));
    if(fields.length!==1||!collectPrivacyFileReferences({value:fields[0].value}).references.some(ref=>ref.ref===item.ref))fail('session_unverified','原附件侧记与实际表单字段不一致。');
    return{reservationId:text(item.id,'原上传登记'),version:item.version,ref:item.ref,field:item.field,instanceId:text(item.instanceId,'原选择实例'),generation:text(item.generation,'原选择代次'),formKeyDigest:hash(key)};
  });
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200 || /[\x00-\x1f]/.test(value)) fail('invalid_context', `${label}无效。`);
  return value;
}
function unique(list, id, label) {
  const found = (list || []).filter(row => row?.id === id);
  if (found.length !== 1) fail('source_missing', `${label}缺失或不唯一。`);
  return found[0];
}
function ledger(s) {
  if (!s || typeof s !== 'object' || !Number.isSafeInteger(s.now) || s.now < 0) fail('ledger_unavailable', '当前真实账本无法读取。');
  for (const key of ['privacyUploadTabs', 'privacyUploadTabRevisions', 'privacyUploadProtocolSources']) if (s[key] != null && !Array.isArray(s[key])) fail('ledger_unavailable', '原标签协议资料损坏。');
  return s;
}
function qualitySelectorsValid(s,command,value){
  const publish=command==='quality.policy-publish',required=publish?['scope','expectedVersion','sourceToken']:['id','version','revision','sourceToken'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,'requestId'].includes(key))||!digest(value.sourceToken))return false;
  const id=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=300&&!/[\x00-\x1f]/.test(value);
  if(Object.hasOwn(value,'requestId')&&!id(value.requestId))return false;
  if(!publish)return id(value.id)&&Number.isSafeInteger(value.version)&&value.version>0&&Number.isSafeInteger(value.revision)&&value.revision>0;
  if(!Number.isSafeInteger(value.expectedVersion)||value.expectedVersion<0)return false;
  const scope=value.scope,keys=['subject','domain','storeIds','serviceIds'];
  if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.getPrototypeOf(scope)!==Object.prototype||Object.keys(scope).length!==keys.length||keys.some(key=>!Object.hasOwn(scope,key))||!['tech','user'].includes(scope.subject)||scope.domain!=='service-order')return false;
  return [['storeIds','stores'],['serviceIds','services']].every(([key,container])=>scope[key]===null||Array.isArray(scope[key])&&scope[key].length>0&&new Set(scope[key]).size===scope[key].length&&scope[key].every(value=>id(value)&&Array.isArray(s[container])&&s[container].filter(row=>row?.id===value).length===1));
}
function source(value) {
  if (!value || typeof value.kind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.kind)) fail('scope_missing', '原草稿来源类别缺失。');
  return { kind: value.kind, id: text(value.id, '原草稿来源编号') };
}
function subjects(s, list) {
  if (!Array.isArray(list) || !list.length) fail('scope_missing', '草稿真实主体来源缺失。');
  const result = list.map(item => {
    if (!['user', 'tech', 'store', 'group', 'public'].includes(item?.kind)) fail('scope_missing', '草稿主体类别无效。');
    const id = text(item.id, '原主体编号');
    if (['user', 'tech', 'store'].includes(item.kind)) unique(s[{ user: 'users', tech: 'techs', store: 'stores' }[item.kind]], id, '草稿原主体');
    if (item.kind === 'group' && id !== 'group') fail('scope_missing', '集团主体来源无效。');
    return { kind: item.kind, id };
  });
  if (new Set(result.map(hash)).size !== result.length) fail('scope_missing', '草稿主体重复。');
  return result;
}

export function createPrivacyUploadTabs(deps = {}) {
  for (const key of ['withMutation', 'load', 'currentContext', 'scopeForDraft', 'commit', 'listStoredRefs']) if (typeof deps[key] !== 'function') fail('runtime_missing', `标签协议内部${key}尚未接入。`);
  const storage = deps.sessionStorage;
  if (!storage || ['key', 'getItem', 'setItem', 'removeItem'].some(key => typeof storage[key] !== 'function')) fail('runtime_missing', '本document真实sessionStorage尚未接入。');
  const makeId = deps.id || (() => crypto.randomUUID());
  const identity = Object.freeze({ tabId: text(makeId(), '新标签编号'), instanceId: text(makeId(), '新document编号'), protocolVersion: 1 });
  let registered = false;
  const scopedSources=new WeakMap();
  const load = () => ledger(deps.load());
  function context() {
    const state = load(), raw = deps.currentContext();
    if (!raw || raw.viewError || raw.writerProtocolVersion !== 1) fail('protocol_missing', '当前真实writer协议或读取来源未确认。');
    let url; try { url = new URL(raw.originScope); } catch { fail('invalid_context', '当前origin无效。'); }
    if (url.origin !== raw.originScope) fail('invalid_context', '须使用准确当前origin。');
    const actor = resolveAccountActor(state, raw.actor);
    const by = { role: actor?.role };
    if (!['user', 'tech', 'store', 'group', 'manager'].includes(by.role)) fail('actor_unavailable', '当前document身份缺失。');
    for (const key of ['accountId', 'sessionId', 'grantId', 'job']) if (actor[key] != null) by[key] = actor[key];
    if (actor.role === 'user') { unique(state.users, actor.userId, '当前本人'); by.userId = actor.userId; }
    if (actor.role === 'tech') { unique(state.techs, actor.techId, '当前技师'); by.techId = actor.techId; }
    if (['store', 'manager'].includes(actor.role)) { unique(state.stores, actor.storeId, '当前门店'); by.storeId = actor.storeId; }
    return { state, actor, originScope: raw.originScope, writerProtocolVersion: 1, authorDigest: hash(by), identity };
  }
  function normalizeScope(c, key, value, operation) {
    if (key === PRIVACY_UPLOAD_TAB_MARKER) {
      let marker; try { marker = JSON.parse(value); } catch { fail('session_unverified', '本document实际marker无法读取。'); }
      if (!same(marker, { ...identity, originScope: c.originScope })) fail('instance_conflict', '本document实际marker已变化，不能冒用其他实例ack。');
      return { kind: 'protocol-marker', disposition: 'technical', source: { kind: 'document', id: identity.instanceId }, sourceToken: hash(identity), subjects: [], roots: [] };
    }
    const actual = deps.scopeForDraft({ ...c, key, value, operation });
    if (actual?.then || !actual || !kinds.has(actual.kind) || !['scoped', 'technical'].includes(actual.disposition) || actual.sourceToken == null || actual.sourceToken === '') fail('scope_missing', '原草稿用途或完整来源尚未核实。');
    let producer;
    if(actual.producer){
      if(!/^[a-z][a-z0-9-]{0,63}$/.test(actual.producer.type||'')||!digest(actual.producer.authorDigest)||actual.producer.formIdDigest!=null&&!digest(actual.producer.formIdDigest))fail('scope_missing','原writer来源信息损坏。');
      const selectors=actual.producer.selectors;
      const allowed=new Set('id bookingId orderId techId userId storeId toStoreId productId skuId categoryId serviceId accountId grantId caseId incidentId noteId correctionOf leaveId safetyId profileId assessmentId holdId promoterId personId personKind promoterType entryId paymentId refundId advanceId recoveryId factId departureId noticeId sourceId sourceKind sourceKey sourceToken sourceVersion ownerToken assignmentVersion actionIndex caseVersion accountVersion targetVersion version stockVersion requestId slot category month kind action scope path date'.split(' '));
      if(['quality.policy-publish','quality.policy-withdraw'].includes(actual.producer.command)){
        if(!qualitySelectorsValid(c.state,actual.producer.command,selectors))fail('scope_missing','原质量政策writer来源选择器损坏。');
      }else if(selectors!=null&&(!selectors||Array.isArray(selectors)||typeof selectors!=='object'||Object.entries(selectors).some(([key,value])=>key==='lineSources'? !Array.isArray(value)||value.some(line=>!line||Object.keys(line).some(key=>!['entryId','version'].includes(key))||typeof line.entryId!=='string'||line.entryId.length>200||!Number.isSafeInteger(Number(line.version))):!allowed.has(key)||!['string','number','boolean'].includes(typeof value)||String(value).length>300)))fail('scope_missing','原writer来源选择器损坏。');
      producer={type:actual.producer.type,authorDigest:actual.producer.authorDigest,...(actual.producer.command?{command:text(actual.producer.command,'原writer命令')}:{}) ,...(actual.producer.formIdDigest?{formIdDigest:actual.producer.formIdDigest}:{}),...(selectors?{selectors:clone(selectors)}:{})};
    }
    return { kind: actual.kind, disposition: actual.disposition, source: source(actual.source), sourceToken: hash(actual.sourceToken), subjects: subjects(c.state, actual.subjects), roots: (actual.roots || []).map(source),...(producer?{producer}:{}) };
  }
  function snapshot(c, inherited = {}) {
    const keys = [], values = new Map(), entries = [], issues = [];
    const length = storage.length;
    if (!Number.isSafeInteger(length) || length < 0) fail('session_unavailable', '本标签键清单无法读取。');
    for (let i = 0; i < length; i++) {
      const key = storage.key(i);
      if (typeof key !== 'string' || values.has(key)) fail('session_unverified', '本标签键清单重复或读取中变化。');
      const value = storage.getItem(key);
      if (typeof value !== 'string') fail('session_unverified', '本标签实际值读取中变化。');
      keys.push(key); values.set(key, value);
      let scoped; try { scoped = normalizeScope(c, key, value, 'snapshot'); } catch { issues.push({ keyDigest: hash(key), code: 'scope_missing' }); }
      const graph = collectPrivacyFileReferences({ value });
      const refs = graph.references.map(item => ({ ref: item.ref, library: item.library, pathDigest: hash(item.path) }));
      if (graph.issues.length) issues.push({ keyDigest: hash(key), code: 'reference_unverified' });
      if (/\bdata:[a-z0-9.+/-]+(?:;[^,\s]*)?,/i.test(value)) issues.push({ keyDigest: hash(key), code: 'legacy_inline_pending' });
      let selections=[];try{selections=selectionFacts(key,value,scoped?.kind);}catch{issues.push({keyDigest:hash(key),code:'selection_unverified'});}
      entries.push({ keyDigest: hash(key), valueDigest: hash(value), ...(scoped || { kind: 'unknown', disposition: 'pending', subjects: [], roots: [] }), refs,...(selections.length?{selections}:{}) });
    }
    const observed = [];
    for (let i = 0; i < storage.length; i++) observed.push(storage.key(i));
    if (!same([...keys].sort(), observed.sort()) || keys.some(key => storage.getItem(key) !== values.get(key))) fail('session_unverified', '本标签实际回读不一致。');
    if (!values.has(PRIVACY_UPLOAD_TAB_MARKER)) issues.push({ keyDigest: hash(PRIVACY_UPLOAD_TAB_MARKER), code: 'marker_missing' });
    const ownRow = rows(c.state).find(row => row.id === identity.instanceId), marker = { ...ownRow, ...inherited };
    if (marker.inheritedMarkerUnverified || marker.inheritedUnknown) {
      let covered = false;
      try {
        covered = !marker.inheritedMarkerUnverified && handover(c).legacySources.some(legacy => legacy.id === marker.inheritedMarkerDigest && legacy.tabId === identity.tabId && legacy.instanceId === identity.instanceId);
      } catch { /* Unknown inherited source remains pending until actual handover. */ }
      if (!covered) issues.push({ keyDigest: hash(PRIVACY_UPLOAD_TAB_MARKER), code: 'legacy_marker_pending' });
    }
    entries.sort((a, b) => a.keyDigest.localeCompare(b.keyDigest));
    return { entries, issues, complete: !issues.length, digest: hash({ entries, issues }) };
  }
  function own(c) {
    const row = unique(rows(c.state), identity.instanceId, '当前document登记');
    if (!registered || row.instanceId !== identity.instanceId || row.tabId !== identity.tabId || row.originScope !== c.originScope || row.protocolVersion !== 1) fail('instance_conflict', '当前document不能继承或冒用其他标签ack。');
    return row;
  }
  async function persist(c, row, previous, guard=()=>{}) {
    guard();
    const next = clone(c.state), list = next.privacyUploadTabs ??= [];
    if (previous) {
      const original = unique(list, row.id, '原document登记');
      if (!same(original, previous)) fail('instance_changed', '原document登记已更新。');
      list[list.indexOf(original)] = clone(row);
    } else {
      if (list.some(old => old?.id === row.id || old?.instanceId === row.instanceId || old?.tabId === row.tabId)) fail('instance_conflict', '标签或document编号已登记，不能复用旧ack。');
      list.push(clone(row));
    }
    await deps.commit(next, { expectedStateToken: hash(c.state) });
    guard();
    const observed = unique(rows(load()), row.id, '持久document登记');
    if (!same(observed, row)) fail('commit_unverified', '标签登记实际回读不一致。');
    return observed;
  }
  function currentPlan(c) {
    const all = (c.state.privacyUploadTabRevisions || []).filter(row => row.originScope === c.originScope);
    if (!all.length) return { revision: 1, plan: null, targets: [] };
    if (all.some(row => !Number.isSafeInteger(row.revision) || row.revision < 1)) fail('revision_missing', '原草稿revision损坏。');
    const revision = Math.max(...all.map(row => row.revision));
    const pointer = deps.revisionPlan?.(c);
    if (pointer?.then || !pointer || typeof pointer !== 'object') fail('revision_missing', '原限定清理要求尚未接入。');
    const plan = unique(all, pointer.id, '原草稿清理要求');
    if (all.filter(row => row.revision === revision).length !== 1 || !Number.isSafeInteger(plan.version) || plan.version < 1 || plan.version !== pointer.version || hash(plan) !== pointer.sourceToken || plan.revision !== revision || plan.protocolVersion !== 1 || plan.status !== 'requested') fail('revision_missing', '原草稿清理要求或来源已变化。');
    subjects(c.state, plan.scope?.subjects);
    for (const root of plan.scope.roots || []) source(root);
    if (!Array.isArray(plan.targets)) fail('revision_missing', '原草稿目标未定位。');
    if (plan.targets.some(target => rows(c.state).filter(row => row.tabId === target.tabId && row.instanceId === target.instanceId && row.originScope === c.originScope && row.protocolVersion === 1).length !== 1)) fail('revision_missing', '原草稿目标实例缺失或不唯一。');
    const targets = plan.targets.filter(target => target.tabId === identity.tabId && target.instanceId === identity.instanceId);
    if (new Set(targets.map(target => target.keyDigest)).size !== targets.length || targets.some(target => !digest(target.keyDigest) || !['remove', 'rewrite', 'retain'].includes(target.treatment) || (target.treatment === 'remove' ? target.expectedValueDigest !== null : !digest(target.expectedValueDigest)))) fail('revision_missing', '本标签准确清理目标损坏。');
    return { revision, plan, targets };
  }
  function affected(entry, plan) {
    return entry.disposition !== 'technical' && entry.subjects.some(item => plan.scope.subjects.some(subject => same(item, subject))) && (!plan.scope.roots?.length || entry.roots.some(root => plan.scope.roots.some(target => same(root, target))));
  }
  function satisfies(manifest, request) {
    if (!manifest.complete) return false;
    if (!request.plan) return true;
    for (const entry of manifest.entries.filter(entry => affected(entry, request.plan))) if (!request.targets.some(target => target.keyDigest === entry.keyDigest)) return false;
    return request.targets.every(target => {
      const entry = manifest.entries.find(item => item.keyDigest === target.keyDigest);
      if (target.treatment === 'remove') return !entry;
      return entry && affected(entry, request.plan) && entry.valueDigest === target.expectedValueDigest;
    });
  }
  async function finish(c, previous, manifest, operation, errorCode = null, extra = {}, guard=()=>{}) {
    guard();
    let request; try { request = currentPlan(c); } catch { request = { revision: Math.max(1, ...(c.state.privacyUploadTabRevisions || []).map(row => row.revision).filter(value => Number.isSafeInteger(value) && value > 0)), unavailable: true }; }
    const acknowledged = !errorCode && !request.unavailable && satisfies(manifest, request), at = c.state.now;
    const receipt = { id: text(makeId(), '回读回执编号'), revision: request.revision, manifestDigest: manifest.digest, at, readbackVerified: true, acknowledged, authorDigest: c.authorDigest };
    if (rows(c.state).some(row => row.receipts?.some(old => old.id === receipt.id))) fail('instance_conflict', '回读回执编号已使用。');
    const row = { ...clone(previous), ...extra, version: previous.version + 1, status: acknowledged ? 'acknowledged' : 'pending', ackRevision: acknowledged ? request.revision : null, manifest: clone(manifest), observedAt: at,
      operation: { kind: operation, status: errorCode ? 'failed' : 'readback_verified', code: errorCode }, receipts: [...(previous.receipts || []), receipt],
      transitions: [...previous.transitions, { version: previous.version + 1, status: acknowledged ? 'acknowledged' : 'pending', at, manifestDigest: manifest.digest, entryCount: manifest.entries.length, code: errorCode }] };
    const observed = await persist(c, row, previous, guard);
    return { id: observed.id, version: observed.version, status: observed.status, revision: observed.ackRevision, manifestDigest: manifest.digest };
  }
  async function acknowledgeLocked(operation = 'acknowledge',guard=()=>{}) {
    guard();
    const c = context(), row = own(c), actual = snapshot(c);
    return finish(c, row, actual, operation,null,{},guard);
  }
  async function registerLocked(originalContext=context,technical=false,guard=()=>{}) {
      const contextFor=()=>{guard();return originalContext();};
      const c = contextFor();
      let row;
      if (registered) {
        row = own(c);
        if (!row.inheritedMarkerUnverified) return technical?{id:row.id,version:row.version,status:row.status,revision:row.ackRevision}:acknowledgeLocked('register',guard);
      } else {
        row = { id: identity.instanceId, ...identity, originScope: c.originScope, version: 1, status: 'pending', ackRevision: null, manifest: null, inheritedMarkerUnverified: true, registeredAt: c.state.now, authorDigest: c.authorDigest, receipts: [], transitions: [{ version: 1, status: 'pending', at: c.state.now, code: null }] };
        await persist(c, row,undefined,guard); registered = true;
      }
      try {
        const marker = storage.getItem(PRIVACY_UPLOAD_TAB_MARKER);
        let inherited = { inheritedMarkerUnverified: false };
        if (marker != null) {
          let prior; try { prior = JSON.parse(marker); } catch { /* Not a known protocol instance. */ }
          const located = prior?.protocolVersion === 1 && prior.originScope === c.originScope && rows(c.state).filter(old => old.id === prior.instanceId && old.protocolVersion === 1 && old.originScope === c.originScope && old.tabId === prior.tabId && old.instanceId === prior.instanceId).length === 1;
          const previous=located?rows(c.state).find(old=>old.id===prior.instanceId):null,receipt=previous?.receipts?.findLast(item=>item.readbackVerified===true&&item.manifestDigest===previous.manifest?.digest);
          inherited = { ...inherited, inheritedMarkerDigest: hash(marker), inheritedUnknown: !located,
            ...(previous?{inheritedSource:{tabId:previous.tabId,instanceId:previous.instanceId,version:previous.version,manifestDigest:previous.manifest?.digest||null,receiptId:receipt?.id||null,receiptToken:receipt?hash(receipt):null}}:{}) };
        }
        // Persist the observed inherited source before replacing its native value.
        // A failed result journal must never turn an unknown old source into no source.
        const beforeWrite = contextFor(), current = own(beforeWrite);
        await persist(beforeWrite, { ...clone(current), ...inherited, version: current.version + 1, operation: { kind: 'register', status: 'preparing' }, transitions: [...current.transitions, { version: current.version + 1, status: 'pending', at: beforeWrite.state.now, code: null }] }, current,guard);
        guard();storage.setItem(PRIVACY_UPLOAD_TAB_MARKER, JSON.stringify({ ...identity, originScope: c.originScope }));
        const fresh = contextFor();
        // The marker is observed locally; no old instance identifier/ack is adopted.
        return await finish(fresh, unique(rows(fresh.state), row.id, '原document'), snapshot(fresh, inherited), 'register', technical?'technical_transition':null, inherited,guard);
      } catch (error) {
        fail(safeCode(error, 'session_unavailable'), '本document登记尚未完成实际回读，保持pending。', { instanceId: identity.instanceId, status: 'pending', sessionOutcome: 'unverified' });
      }
  }
  async function transition(kind,run=deps.withMutation) {
    if(!['account-exit','account-enter','route-actor','account-entry-draft'].includes(kind)||typeof deps.technicalTransition!=='function')fail('invalid_context','原身份技术过渡来源尚未接入。');
    const guard=()=>run.assertActive?.();
    return run(async()=>{
      const key=deps.key||'tianli-integrated-v5',actorKey=key+'-actor',taskPrefix=key+'-task-return:';
      let completedLoginKeys;
      const read=()=>{
        guard();const state=load(),raw=deps.currentContext();let origin;
        try{origin=new URL(raw?.originScope).origin;}catch{fail('invalid_context','当前技术过渡origin无效。');}
        if(raw.viewError||raw.writerProtocolVersion!==1||origin!==raw.originScope)fail('protocol_missing','技术过渡的真实writer来源未核实。');
        const actual=deps.technicalTransition({state,rawActor:raw.actor,originScope:origin,identity,kind});
        if(!actual||actual.then||actual.kind!==kind||actual.sourceToken==null||typeof actual.actorValue!=='string'||typeof actual.path!=='string'||!/^\/(user|tech|store|group|manager)\//.test(actual.path)||!Array.isArray(actual.tasks))fail('invalid_context','原身份目标或技术过渡来源无效。');
        let target;try{target=JSON.parse(actual.actorValue);}catch{fail('invalid_context','原身份目标无法读取。');}
        if(!target||!['user','tech','store','group','manager'].includes(target.role))fail('invalid_context','原身份目标角色缺失。');
        const tasks=actual.tasks.map(item=>{if(typeof item?.key!=='string'||!item.key.startsWith(taskPrefix)||!digest(item.valueDigest))fail('target_out_of_scope','技术过渡只能移除原任务返回key。');return{key:item.key,valueDigest:item.valueDigest};});
        if(new Set(tasks.map(item=>item.key)).size!==tasks.length)fail('target_out_of_scope','技术过渡任务key重复。');
        let loginWrites=[],loginRemovals=[];
        if(kind==='account-enter'&&actual.login){
          const a=raw.actor,p=actual.login,store=unique(state.stores,a?.storeId,'原关闭门店'),entered=resolveAccountActor(state,target);
          if(a.role!=='store'||a.sessionId||a.accountId||a.grantId||!(store.lifecycleStatus==='closed'||store.closedAt!=null)||entered.role!=='store'||entered.storeId!==a.storeId||entered.lifecyclePurpose!=='lifecycle-settlement'||entered.accountId!==p.accountId||entered.grantId!==p.grantId)fail('source_missing','原限定登录完成来源不一致。');
          const matches=(state.staffAccountRequests||[]).filter(row=>row.requestId===p.requestId&&row.actor==='demo-entry');
          let recorded;try{recorded=JSON.parse(matches[0]?.fingerprint);}catch{}
          if(matches.length!==1||!same(recorded,{type:'account.enter',p})||matches[0].result?.sessionId!==entered.sessionId)fail('source_missing','实际登录请求与返回会话不一致。');
          const formId='account:'+['demo','','',p.accountId+':'+p.grantId].join(':'),actorScope=['','',''].join(':'),managementKey=key+'-management:'+ [actorScope,a.role,a.job||'',a.storeId||'',formId].join(':'),requestKey=key+'-request:'+ [actorScope,'account.enter',a.role,'',a.storeId||'',formId,'',0].join(':');
          const draft=JSON.stringify({values:[],payload:JSON.stringify({accountId:p.accountId,grantId:p.grantId}),uploadSelections:[]});
          completedLoginKeys??=[...(storage.getItem(managementKey)===draft?[{key:managementKey,value:draft}]:[]),{key:requestKey,value:p.requestId}];
          loginRemovals=completedLoginKeys;
        }
        if(kind==='account-entry-draft'){
          const a=raw.actor,login=actual.login,store=unique(state.stores,a?.storeId,'原关闭门店');
          if(a.role!=='store'||a.sessionId||a.accountId||a.grantId||!(store.lifecycleStatus==='closed'||store.closedAt!=null)||actual.path!=='/store/work-login'||!same(target,a)||tasks.length||!login)fail('target_out_of_scope','仅原关闭门店无工作身份的岗位登录草稿可使用此技术写入。');
          const accountId=text(login.accountId,'原登录账号'),grantId=text(login.grantId,'原登录岗位'),requestId=text(login.requestId,'原登录请求');
          const account=unique(state.staffAccounts,accountId,'原登录账号');unique(account.grants,grantId,'原登录岗位');
          if(actual.source?.kind!=='staff-account'||actual.source.id!==accountId)fail('source_missing','登录草稿不是已核原账号来源。');
          const formId='account:'+['demo','','',accountId+':'+grantId].join(':'),actorScope=['','',''].join(':'),managementKey=key+'-management:'+ [actorScope,a.role,a.job||'',a.storeId||'',formId].join(':'),requestKey=key+'-request:'+ [actorScope,'account.enter',a.role,'',a.storeId||'',formId,'',0].join(':');
          const draft=JSON.stringify({values:[],payload:JSON.stringify({accountId,grantId}),uploadSelections:[]});
          const oldRequest=storage.getItem(requestKey);if(oldRequest!==null&&oldRequest!==requestId)fail('context_changed','原登录请求编号已变化。');
          const oldDraft=storage.getItem(managementKey);let knownDraft=oldDraft===null||oldDraft===draft;
          if(!knownDraft)try{const prior=JSON.parse(oldDraft);knownDraft=Array.isArray(prior.values)&&!prior.values.length&&(!prior.uploadSelections||Array.isArray(prior.uploadSelections)&&!prior.uploadSelections.length)&&same(JSON.parse(prior.payload),{accountId,grantId});}catch{}
          loginWrites=[...(knownDraft?[{key:managementKey,value:draft}]:[]),{key:requestKey,value:requestId}];
        }
        const binding={kind,source:source(actual.source),sourceToken:hash(actual.sourceToken),targetDigest:hash(actual.actorValue),pathDigest:hash(actual.path),tasks:tasks.map(item=>({keyDigest:hash(item.key),valueDigest:item.valueDigest})),...(loginWrites.length?{loginWrites:loginWrites.map(item=>({keyDigest:hash(item.key),valueDigest:hash(item.value)}))}:{}),...(loginRemovals.length?{loginRemovals:loginRemovals.map(item=>({keyDigest:hash(item.key),valueDigest:hash(item.value)}))}:{})};
        return{state,actor:raw.actor,originScope:origin,writerProtocolVersion:1,identity,authorDigest:hash({kind,source:binding.source,sourceToken:binding.sourceToken}),binding,actual:{actorValue:actual.actorValue,path:actual.path,target,tasks,loginWrites,loginRemovals}};
      };
      const first=read(),fresh=()=>{const current=read();if(!same(current.binding,first.binding)||current.originScope!==first.originScope)fail('context_changed','原技术过渡来源或目标已变化。');return current;};
      if(!registered)await registerLocked(fresh,true,guard);
      const c=fresh(),previous=own(c);
      for(const task of c.actual.tasks){const value=storage.getItem(task.key);if(hash(value)!==task.valueDigest||normalizeScope(c,task.key,value,'technical-transition').kind!=='task-context')fail('context_changed','原任务返回内容或来源已变化。');}
      await persist(c,{...clone(previous),version:previous.version+1,status:'pending',ackRevision:null,operation:{kind:'technical-transition',status:'preparing',source:clone(c.binding)},transitions:[...previous.transitions,{version:previous.version+1,status:'pending',at:c.state.now,code:null}]},previous,guard);
      try{
        for(const task of first.actual.tasks){fresh();if(hash(storage.getItem(task.key))!==task.valueDigest)fail('context_changed','原任务返回内容已变化。');storage.removeItem(task.key);}
        for(const item of first.actual.loginRemovals){fresh();const value=storage.getItem(item.key);if(value!==null&&value!==item.value)fail('context_changed','原已完成登录草稿已变化。');if(value!==null)storage.removeItem(item.key);}
        if(kind==='account-entry-draft'){for(const item of first.actual.loginWrites){fresh();storage.setItem(item.key,item.value);fresh();}}
        else {fresh();storage.setItem(actorKey,first.actual.actorValue);fresh();}
        for(let i=0;i<2;i++){if(kind!=='account-entry-draft'&&storage.getItem(actorKey)!==first.actual.actorValue||first.actual.tasks.some(task=>storage.getItem(task.key)!==null)||first.actual.loginRemovals.some(item=>storage.getItem(item.key)!==null)||first.actual.loginWrites.some(item=>storage.getItem(item.key)!==item.value))fail('session_unverified','身份技术过渡实际回读不一致。');}
        const current=fresh(),row=own(current),receipt={id:text(makeId(),'技术过渡回执编号'),kind,sourceToken:hash(first.binding),actorValueDigest:first.binding.targetDigest,removedKeyDigests:[...first.binding.tasks,...(first.binding.loginRemovals||[])].map(item=>item.keyDigest),...(first.binding.loginWrites?{writtenKeys:clone(first.binding.loginWrites)}:{}),readbackVerified:true,acknowledged:false,at:current.state.now};
        if(rows(current.state).some(item=>[...(item.receipts||[]),...(item.scopedReceipts||[]),...(item.technicalReceipts||[])].some(old=>old.id===receipt.id)))fail('instance_conflict','技术过渡回执编号已使用。');
        await persist(current,{...clone(row),version:row.version+1,status:'pending',ackRevision:null,technicalReceipts:[...(row.technicalReceipts||[]),receipt],operation:{kind:'technical-transition',status:'readback_verified'},transitions:[...row.transitions,{version:row.version+1,status:'pending',at:current.state.now,code:null}]},row,guard);
        fresh();return{actor:clone(first.actual.target),path:first.actual.path,sessionOutcome:'readback_verified',receiptId:receipt.id};
      }catch(error){fail('result_unverified','原身份技术过渡尚未完整回读；实际写入及pending保留。',{instanceId:identity.instanceId,status:'pending',sessionOutcome:'write_unverified',code:safeCode(error,'writer_failed')});}
    });
  }
  function facade(c, request, kind, guard=()=>{}) {
    const freshContext = () => {
      guard();const fresh = context(); own(fresh);
      if (fresh.authorDigest !== c.authorDigest || fresh.originScope !== c.originScope || currentPlan(fresh).revision !== request.revision) fail('context_changed', '本session原写入身份或revision已变化。');
      return fresh;
    };
    const check = (key, value, remove) => {
      const fresh = freshContext();
      if (key === PRIVACY_UPLOAD_TAB_MARKER) fail('marker_protected', '业务写入不能更改实例marker。');
      if (kind === 'cleanup') {
        if (!request.plan) fail('revision_missing', '准确本标签清理要求尚未接入。');
        const target = request.targets.find(item => item.keyDigest === hash(key));
        if (!target || (remove ? target.treatment !== 'remove' : target.treatment !== 'rewrite' || hash(String(value)) !== target.expectedValueDigest)) fail('target_out_of_scope', '本次清理不能写入其他key或未经核验的新值。');
        const original = storage.getItem(key), probe = remove ? original : String(value);
        if (probe != null) {
          const entry = normalizeScope(fresh, key, probe, kind);
          if (!affected(entry, request.plan)) fail('target_out_of_scope', '本次清理不能处理其他主体或root。');
        }
      } else {
        const probe = remove ? storage.getItem(key) : String(value);
        if (probe != null) normalizeScope(fresh, key, probe, kind);
      }
    };
    return Object.freeze({ get length() { freshContext(); return storage.length; }, key: index => { freshContext(); return storage.key(index); }, getItem: key => { const fresh = freshContext(), value = storage.getItem(key); if (value != null) normalizeScope(fresh, key, value, kind); return value; },
      setItem(key, value) { check(key, value, false); storage.setItem(key, String(value)); }, removeItem(key) { check(key, null, true); storage.removeItem(key); } });
  }
  async function mutate(kind, writer,run=deps.withMutation,planned=[]) {
    if (!mutations.has(kind) || typeof writer !== 'function') fail('invalid_mutation', '原session写入操作缺失。');
    const guard=()=>run.assertActive?.();
    return run(async () => {
      guard();const c = context(), row = own(c), request = currentPlan(c);
      if(!Array.isArray(planned)||new Set(planned.map(item=>item?.key)).size!==planned.length)fail('invalid_mutation','原writer准确写入计划无效。');
      const sources=planned.map(item=>{if(typeof item?.key!=='string'||item.key===PRIVACY_UPLOAD_TAB_MARKER||typeof item.value!=='string')fail('invalid_mutation','原writer写入值来源缺失。');return{keyDigest:hash(item.key),valueDigest:hash(item.value),...normalizeScope(c,item.key,item.value,kind)};});
      if (kind === 'restore' && row.ackRevision !== request.revision) fail('revision_pending', '本标签尚未完成当前要求回读，不能恢复旧表单。');
      const pending = { ...clone(row), version: row.version + 1, status: 'pending', ackRevision: null, operation: { kind, status: 'preparing', revision: request.revision,...(sources.length?{sources}:{}) }, transitions: [...row.transitions, { version: row.version + 1, status: 'pending', at: c.state.now, code: null }] };
      await persist(c, pending, row,guard);
      let result, writerError,writerAlive=true;
      const writerGuard=()=>{guard();if(!writerAlive)fail('context_changed','原session writer上下文已结束。');};
      try { result = await writer(facade(c, request, kind,writerGuard)); } catch (error) { writerError = error; } finally {writerAlive=false;}
      guard();
      try {
        const fresh = context(), current = own(fresh), actual = snapshot(fresh);
        const observed = await finish(fresh, current, actual, kind, writerError ? safeCode(writerError, 'writer_failed') : null,{},guard);
        if (writerError) fail(safeCode(writerError, 'writer_failed'), '原session操作未完整成功；实际回读与pending保留。', { ...observed, sessionOutcome: 'readback_verified' });
        return { ...observed, result };
      } catch (error) {
        if (error.facts) throw error;
        fail('result_unverified', '原session实际结果尚未持久核实，原pending保留；未回滚实际写入。', { instanceId: identity.instanceId, status: 'pending', sessionOutcome: 'write_unverified' });
      }
    });
  }
  async function restoreScoped(keys,reader,run=deps.withMutation) {
    if(!Array.isArray(keys)||!keys.length||new Set(keys).size!==keys.length||keys.some(key=>typeof key!=='string'||!key||key===PRIVACY_UPLOAD_TAB_MARKER)||reader!=null&&typeof reader!=='function')fail('invalid_mutation','须提供准确原草稿key和只读恢复函数。');
    const guard=()=>run.assertActive?.();
    return run(async()=>{
      guard();const first=context();own(first);const request=currentPlan(first),observed=new Map();
      const current=()=>{const fresh=context();own(fresh);if(fresh.authorDigest!==first.authorDigest||fresh.originScope!==first.originScope||!same(currentPlan(fresh),request))fail('context_changed','恢复期间实际身份或清理要求已变化。');normalizeScope(fresh,PRIVACY_UPLOAD_TAB_MARKER,storage.getItem(PRIVACY_UPLOAD_TAB_MARKER),'restore');return fresh;};
      const entryFor=(fresh,key,value)=>{
        const target=request.targets.find(item=>item.keyDigest===hash(key));
        if(value==null){if(target&&target.treatment!=='remove')fail('revision_pending','原要求保留的草稿值缺失。');return{keyDigest:hash(key),valueDigest:null,absent:true};}
        const scoped=normalizeScope(fresh,key,value,'restore'),graph=collectPrivacyFileReferences({value});
        if(graph.issues.length||/\bdata:[a-z0-9.+/-]+(?:;[^,\s]*)?,/i.test(value))fail('session_unverified','原草稿文件引用或旧inline来源尚未核实。');
        const selections=selectionFacts(key,value,scoped.kind),entry={keyDigest:hash(key),valueDigest:hash(value),...scoped,refs:graph.references.map(item=>({ref:item.ref,library:item.library,pathDigest:hash(item.path)})),...(selections.length?{selections}:{})};
        if(target&&(target.treatment==='remove'||target.expectedValueDigest!==entry.valueDigest)||request.plan&&affected(entry,request.plan)&&!target)fail('revision_pending','本草稿尚未完成当前准确清理要求。');
        return entry;
      };
      const original=current(),entries=keys.map(key=>{const value=storage.getItem(key);observed.set(key,value);return entryFor(original,key,value);});
      const recheck=()=>{const fresh=current();for(let i=0;i<keys.length;i++){const key=keys[i],value=storage.getItem(key);if(value!==observed.get(key)||!same(entryFor(fresh,key,value),entries[i]))fail('context_changed','恢复期间原草稿值或来源已变化。');}return fresh;};
      recheck();let alive=true;
      const readonly=Object.freeze({getItem(key){guard();if(!alive||!observed.has(key))fail('target_out_of_scope','只能读取本次已核原草稿。');recheck();return observed.get(key);}});
      let result;try{result=await (reader||((session)=>Object.fromEntries(keys.map(key=>[key,session.getItem(key)]))))(readonly);}finally{alive=false;}
      guard();const fresh=recheck(),previous=own(fresh),receipt={id:text(makeId(),'精确回读回执编号'),...identity,originScope:fresh.originScope,revision:request.revision,authorDigest:fresh.authorDigest,entries:clone(entries),at:fresh.state.now,readbackVerified:true,acknowledged:false,predecessor:clone(previous.inheritedSource||null)};
      if(rows(fresh.state).some(row=>[...(row.receipts||[]),...(row.scopedReceipts||[])].some(old=>old.id===receipt.id)))fail('instance_conflict','精确回读回执编号已使用。');
      await persist(fresh,{...clone(previous),version:previous.version+1,status:'pending',ackRevision:null,scopedReceipts:[...(previous.scopedReceipts||[]),receipt],operation:{kind:'restore-scoped',status:'readback_verified'},transitions:[...previous.transitions,{version:previous.version+1,status:'pending',at:fresh.state.now,code:null}]},previous,guard);
      guard();recheck();const pointer=Object.freeze({instanceId:identity.instanceId,tabId:identity.tabId,receiptId:receipt.id,sourceToken:hash(receipt)});
      scopedSources.set(pointer,()=>{recheck();return clone(pointer);});return{result,receipt:pointer};
    });
  }
  function handover(c) {
    const pointer = deps.initialHandover?.(c);
    if (pointer?.then || !pointer || typeof pointer !== 'object') fail('handover_pending', '初始旧来源和writer协议交接尚未确认。');
    const row = unique(c.state.privacyUploadProtocolSources || [], pointer.id, '原协议交接来源');
    if (!Number.isSafeInteger(row.version) || row.version < 1 || row.version !== pointer.version || hash(row) !== pointer.sourceToken || row.originScope !== c.originScope || row.protocolVersion !== 1 || row.writerProtocolVersion !== 1 || row.status !== 'verified') fail('handover_pending', '原协议交接来源已变化或未确认。');
    const census = row.legacyCensus;
    if (census?.kind !== 'controlled-protocol-handover' || !digest(census.referenceDigest) || !digest(census.sourceToken) || !Number.isSafeInteger(census.verifiedAt) || census.verifiedAt < 0 || census.verifiedAt > c.state.now || !Array.isArray(row.unknownSources) || row.unknownSources.length || !Array.isArray(row.legacySources) || new Set(row.legacySources.map(legacy => legacy.id)).size !== row.legacySources.length) fail('handover_pending', '未知旧标签、writer或旧资料来源仍待核。');
    const known = rows(c.state).filter(item => item.originScope === c.originScope).map(item => ({ tabId: item.tabId, instanceId: item.instanceId })).sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    if (!Array.isArray(row.knownInstances) || !same(known, [...row.knownInstances].sort((a, b) => a.instanceId.localeCompare(b.instanceId)))) fail('handover_pending', '全部已知实例尚未包含在实际交接来源。');
    for (const legacy of row.legacySources) {
      const instance = rows(c.state).find(item => item.tabId === legacy.tabId && item.instanceId === legacy.instanceId), receipt = instance?.receipts?.find(item => item.id === legacy.receiptId);
      if (legacy.status !== 'readback_verified' || !receipt || receipt.readbackVerified !== true || hash(receipt) !== legacy.sourceToken) fail('handover_pending', '旧来源缺实际readback receipt，不能按时间退休。');
    }
    return row;
  }
  async function coverage(run=deps.withMutation) {
    const guard=()=>run.assertActive?.();
    return run(async () => {
      guard();const c = context(), blockers = [], add = (kind, sourceId, path, reason) => blockers.push({ kind, sourceId, path, reason });
      let revision = 1; try { revision = currentPlan(c).revision; } catch { add('revision_pending', 'current', 'privacyUploadTabRevisions', '原限定清理要求缺失或已变化'); }
      try { handover(c); } catch { add('handover_pending', 'origin', 'privacyUploadProtocolSources', '初始旧来源和writer交接未覆盖'); }
      const all = rows(c.state).filter(row => row.originScope === c.originScope);
      if (!all.length || new Set(all.map(row => row.tabId)).size !== all.length || new Set(all.map(row => row.instanceId)).size !== all.length) add('instance_conflict', 'origin', 'privacyUploadTabs', '已知实例缺失或标识重复');
      const tabs = all.map(row => {
        const ok = row.protocolVersion === 1 && row.status === 'acknowledged' && row.ackRevision === revision && row.manifest?.complete === true;
        if (!ok) add('tab_pending', row.id, 'privacyUploadTabs', '旧协议、休眠或当前revision尚未实际回读');
        return { id: row.tabId, instanceId: row.instanceId, revision: row.ackRevision, status: ok ? 'acknowledged' : 'pending', drafts: row.manifest?.entries || [] };
      });
      try { const actual = snapshot(c), row = own(c); if (actual.digest !== row.manifest?.digest) add('session_changed', row.id, 'privacyUploadTabs', '本标签实际值或来源与持久manifest不一致'); } catch { add('session_unverified', identity.instanceId, 'privacyUploadTabs', '当前本session无法完整回读'); }
      const graph = collectPrivacyFileReferences(c.state);
      if (graph.issues.length) add('reference_pending', 'ledger', 'globalRefs', '原全局文件引用仍有未知或损坏来源');
      const registeredRefs = new Set(graph.references.map(item => item.ref));
      for (const row of c.state.privacyUploadReservations || []) if (refPatterns[row.library]?.test(row.ref || '')) registeredRefs.add(row.ref);
      const stored = [], unregisteredStoredRefs = [];
      for (const library of ['invoice', 'media']) {
        try {
          const actual = await deps.listStoredRefs(library);guard();
          if (!Array.isArray(actual)) throw Error('invalid actual file census');
          for (const item of actual) {
            const ref = typeof item === 'string' ? item : item?.ref, valid = refPatterns[library].test(ref || '') && item?.valid !== false;
            stored.push({ library, ref: typeof ref === 'string' ? ref : null, valid });
            if (!valid || !registeredRefs.has(ref)) unregisteredStoredRefs.push({ library, ref: typeof ref === 'string' ? ref : null });
          }
        } catch { add('file_census_pending', library, 'storedRefs', '实际原文件库清单读取未确认'); }
      }
      guard();if (unregisteredStoredRefs.length) add('unregistered_ref', 'origin', 'storedRefs', '实际文件有未登记或未定位用途');
      if (!same(load(), c.state)) add('source_changed', 'ledger', 'sourceToken', '核验期间真实账本已变化');
      const complete = !blockers.length;
      return { originScope: c.originScope, revision, ledgerComplete: complete, uploadsComplete: complete, tabIds: tabs.map(row => row.id), tabs, unregisteredStoredRefs, blockers, deleteAllowed: false,
        sourceToken: hash({ state: hash(c.state), revision, tabs, stored, graph: graph.sourceToken, blockers }) };
    });
  }
  const resumeSource=pointer=>{const source=scopedSources.get(pointer);if(!source)fail('source_missing','精确原草稿回读能力缺失或被复制。');return source();};
  const api=run=>Object.freeze({identity:()=>identity,register:()=>run(()=>registerLocked(context,false,()=>run.assertActive?.())),mutate:(kind,writer,{planned=[]}={})=>mutate(kind,writer,run,planned),restoreScoped:(keys,reader)=>restoreScoped(keys,reader,run),resumeSource,transition:kind=>transition(kind,run),acknowledge:()=>run(()=>acknowledgeLocked('acknowledge',()=>run.assertActive?.())),coverage:()=>coverage(run)});
  // Internal only: the app supplies a closed, short-lived original KEY capability.
  // There is no ambient/global lock flag and no business-payload override.
  return Object.freeze({...api(deps.withMutation),bindMutation:run=>{if(typeof run!=='function')fail('runtime_missing','原持锁能力缺失。');return api(run);}});
}
