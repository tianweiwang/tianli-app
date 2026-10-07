import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvoiceFile, invoiceFileName, authorizedInvoiceFile } from './invoice-files.mjs';
const file = { ref: 'invoice-file:' + 'a'.repeat(64), name: 'demo.pdf', type: 'application/pdf', size: 30 };
const s = { serviceInvoices: [{ id:'I1', userId:'u1', storeId:'s1', issued:{file} }] };
test('invoice attachments reject empty, oversized, unsupported and mismatched bytes', async () => {
  for (const blob of [new Blob([], {type:'application/pdf'}), new Blob(['<html></html>'], {type:'text/html'}), new Blob(['<html>fake.pdf</html>'], {type:'application/pdf'}), new Blob(['%PDF-1.4 incomplete'], {type:'application/pdf'}), new Blob([new Uint8Array(5*1024*1024+1)], {type:'image/png'})]) await assert.rejects(validateInvoiceFile(blob));
  assert.ok((await validateInvoiceFile(new Blob(['%PDF-1.4\nDemo file\n%%EOF'],{type:'application/pdf'}))).length);
  await assert.rejects(validateInvoiceFile(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'})), /无法解码/);
  await assert.rejects(validateInvoiceFile(new Blob([new Uint8Array([255,216,255,255,217])],{type:'image/jpeg'})), /无法解码/);
});
test('invoice attachment links require allowed actor and current record reference', () => {
  assert.equal(authorizedInvoiceFile(s,{role:'user',userId:'u1'},'I1','issued',file.ref),file);
  assert.equal(authorizedInvoiceFile(s,{role:'store',storeId:'s1'},'I1','issued',file.ref),file);
  assert.equal(authorizedInvoiceFile(s,{role:'group',job:'finance'},'I1','issued',file.ref),file);
  for(const actor of [{role:'tech',techId:'t1'},{role:'manager',storeId:'s1'},{role:'user',userId:'u2'},{role:'store',storeId:'s2'},{role:'group',job:'support'}]) assert.throws(()=>authorizedInvoiceFile(s,actor,'I1','issued',file.ref));
  assert.throws(()=>authorizedInvoiceFile(s,{role:'user',userId:'u1'},'I1','red',file.ref));
  assert.throws(()=>authorizedInvoiceFile(s,{role:'user',userId:'u1'},'I1','issued','invoice-file:'+'b'.repeat(64)));
});
test('invoice filenames remove path separators and control characters', () => {
  const name = invoiceFileName('../已开/票据\\红冲\u0000.pdf');
  assert.ok(!/[\\/\x00-\x1f]/.test(name)); assert.ok(invoiceFileName('x'.repeat(300)).length <= 150);
});
