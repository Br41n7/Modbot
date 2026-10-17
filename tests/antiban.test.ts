/**
 * Integration tests against the REAL baileys-antiban package (fake Baileys socket underneath).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { config } from '../src/config.js';
import { wireAntiban } from '../src/core/antibanSetup.js';

function fakeRawSock() {
  const calls: any[] = [];
  const ev: any = new EventEmitter();
  ev.process = () => {};
  const sock: any = {
    ev,
    user: { id: '2349000000000:1@s.whatsapp.net' },
    sendMessage: async (jid: string, content: any, options: any) => { calls.push({ m: 'send', jid, content, options }); return { key: { id: `X${calls.length}` } }; },
    groupParticipantsUpdate: async (jid: string, ids: string[], action: string) => { calls.push({ m: 'gpu', action }); return ids.map((id) => ({ status: '200', jid: id })); },
  };
  return { sock, calls };
}

const setup = () => {
  Object.assign(config.antiban, { warmupDays: 0, preset: 'moderate', legitimacySignals: false });
  config.groupOps.addPer10Min = 3; config.groupOps.removePer10Min = 2;
  const f = fakeRawSock();
  const w = wireAntiban(f.sock, { persist: undefined, minDelayMs: 0, maxDelayMs: 1 });
  return { ...f, ...w };
};

test('wrapped sendMessage delivers text with an options object', async () => {
  const { safe, calls } = setup();
  const res: any = await safe.sendMessage('1203@g.us', { text: 'hello' }, {});
  assert.ok(res?.key?.id);
  assert.equal(calls.filter((c) => c.m === 'send')[0].content.text, 'hello');
  (safe as any).antiban?.destroy?.();
});

test('remove is rate-guarded by the library (limit from config)', async () => {
  const { participantsUpdate, sock } = setup();
  await participantsUpdate('g@g.us', ['a@lid'], 'remove');
  await participantsUpdate('g@g.us', ['b@lid'], 'remove');
  await assert.rejects(() => participantsUpdate('g@g.us', ['c@lid'], 'remove'), /limit|rate|Group/i);
  (sock as any).ev.removeAllListeners();
});

test('promote/demote bypass the guard and never consume the add budget', async () => {
  const { participantsUpdate, calls } = setup();
  for (let i = 0; i < 8; i++) await participantsUpdate('g@g.us', ['a@lid'], i % 2 ? 'demote' : 'promote');
  for (let i = 0; i < 3; i++) await participantsUpdate('g@g.us', [`n${i}@s.whatsapp.net`], 'add');
  assert.equal(calls.filter((c) => c.m === 'gpu').length, 11);
});

test('CANARY: baileys-antiban still counts promote as "add" and still crashes without send options', async () => {
  // If this test FAILS after upgrading baileys-antiban, the library fixed the bugs: you may delete the
  // bypass in core/antibanSetup.ts and the "always pass {}" rule in core/context.ts + services/send.ts.
  const { safe, sock } = setup();
  await assert.rejects(() => (safe as any).sendMessage('1203@g.us', { text: 'x' }), /circuitBreaker|undefined/);
  let blocked = false;
  for (let i = 0; i < 5; i++) {
    try { await (sock as any).groupParticipantsUpdate('g@g.us', ['a@lid'], 'promote'); } catch { blocked = true; }
  }
  assert.equal(blocked, true, 'library counts promote in the add bucket (3/10min)');
});
