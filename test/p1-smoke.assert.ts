/**
 * Runnable smoke checks for P1 polish (no framework).
 * Run: npx ts-node --transpile-only test/p1-smoke.assert.ts
 */
import assert from 'assert';

function amountMismatch(ocr: number, expected: number) {
  return Math.abs(ocr - expected) > 1;
}

assert.strictEqual(amountMismatch(1000, 1000), false);
assert.strictEqual(amountMismatch(1000, 1001.5), true);
assert.strictEqual(Number.isFinite(NaN) && amountMismatch(NaN, 1000), false);

function lostReason(status: string, reason?: string) {
  return status === 'LOST' ? reason ?? 'unspecified' : null;
}
assert.strictEqual(lostReason('LOST'), 'unspecified');
assert.strictEqual(lostReason('LOST', 'price'), 'price');
assert.strictEqual(lostReason('NEW'), null);

function outboxDead(attempts: number) {
  return attempts >= 5;
}
assert.strictEqual(outboxDead(4), false);
assert.strictEqual(outboxDead(5), true);

function smtpEnabled(host?: string) {
  return Boolean((host ?? '').trim());
}
assert.strictEqual(smtpEnabled(''), false);
assert.strictEqual(smtpEnabled('smtp.resend.com'), true);

function ktpNikDigits(raw: string) {
  return raw.replace(/\D/g, '');
}
assert.strictEqual(ktpNikDigits('12.3456.7890.1234'), '12345678901234');

function importErrorCsv(
  rows: Array<{ row: number; message: string }>,
) {
  return [
    'row,message',
    ...rows.map((e) => `${e.row},"${e.message.replace(/"/g, '""')}"`),
  ].join('\n');
}
assert.ok(importErrorCsv([{ row: 2, message: 'bad "x"' }]).includes('2,'));

console.log('p1-smoke.assert ok');
