import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseCommand } from '../src/core/context.js';
import { Registry } from '../src/core/registry.js';
import { JsonStore } from '../src/storage/jsonStore.js';
import { fillDefaults, defaultGroupSettings } from '../src/storage/db.js';
import { GroupCache } from '../src/core/groupCache.js';
import { makeEnv, msg, P, GROUP, BOT_LID, makeGroupMeta } from './helpers.js';
import { renderTemplate } from '../src/modules/welcome/index.js';
import { findViolatingLinks, badWordRegex } from '../src/modules/protection/filters.js';

test('parseCommand', () => {
  assert.deepEqual(parseCommand('.kick @bob spamming', '.'), { name: 'kick', args: ['@bob', 'spamming'], raw: '@bob spamming' });
  assert.equal(parseCommand('. kick', '.'), null);
  assert.equal(parseCommand('hello', '.'), null);
  assert.equal(parseCommand('.', '.'), null);
  assert.equal(parseCommand('!HELP', '!')?.name, 'help');
  assert.equal(parseCommand('..x', '..')?.name, 'x');
});

test('registry rejects duplicate commands/aliases', () => {
  const r = new Registry();
  const c = (name: string, aliases: string[] = []) => ({ name, aliases, description: '', defaultRole: 'user' as const, run: async () => {} });
  r.register({ name: 'a', description: '', commands: [c('x', ['y'])] });
  assert.throws(() => r.register({ name: 'b', description: '', commands: [c('y')] }), /Duplicate/);
});

test('JsonStore persists atomically and survives corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-'));
  const f = path.join(dir, 'a.json');
  const s = new JsonStore(f, { n: 1, list: [] as string[] });
  s.data.n = 5; s.flush();
  assert.equal(new JsonStore(f, { n: 1, list: [] }).data.n, 5);
  fs.writeFileSync(f, '{broken');
  const s2 = new JsonStore(f, { n: 1, list: [] });
  assert.equal(s2.data.n, 1);
  assert.ok(fs.readdirSync(dir).some((x) => x.includes('corrupt')));
});

test('fillDefaults adds new settings to old group data without clobbering', () => {
  const old: any = { antilink: { enabled: true }, maxWarns: 5 };
  fillDefaults(old, defaultGroupSettings());
  assert.equal(old.antilink.enabled, true);
  assert.equal(old.antilink.mode, 'whatsapp');
  assert.equal(old.maxWarns, 5);
  assert.equal(old.antisticker.enabled, false);
});

test('GroupCache computes admin sets (both PN and LID forms) and bot admin', () => {
  const gc = new GroupCache();
  const info = gc.build({ user: { id: '2349000000000:7@s.whatsapp.net', lid: '999111222333444:7@lid' } } as any, makeGroupMeta(true));
  assert.ok(info.adminKeys.has(P.alice.lid) && info.adminKeys.has(`${P.alice.pn}@s.whatsapp.net`));
  assert.ok(!info.adminKeys.has(P.bob.lid));
  assert.ok(info.superKeys.has(P.carl.lid));
  assert.equal(info.botIsAdmin, true);
  assert.equal(gc.build({ user: { id: '2349000000000:7@s.whatsapp.net', lid: '999111222333444:7@lid' } } as any, makeGroupMeta(false)).botIsAdmin, false);
});

test('link detection', () => {
  assert.equal(findViolatingLinks('join chat.whatsapp.com/ABCDEFGHIJKL now', 'whatsapp', []).length, 1);
  assert.equal(findViolatingLinks('visit example.com', 'whatsapp', []).length, 0);
  assert.equal(findViolatingLinks('visit example.com/page', 'all', []).length, 1);
  assert.equal(findViolatingLinks('see https://good.org/x', 'all', ['good.org']).length, 0);
  assert.equal(findViolatingLinks('i like node.js and e.g. this', 'all', []).length, 0);
});

test('bad word regex is boundary + diacritic aware', () => {
  const re = badWordRegex(['dam', 'café'])!;
  assert.ok(re.test('you dam fool'));
  assert.ok(!re.test('damage'));
  assert.ok(re.test('CAFE time'.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()));
});

test('welcome template', () => {
  assert.equal(renderTemplate('Hi {user} to {group} ({count})', { user: '@1', group: 'G', rules: '', count: 7 }), 'Hi @1 to G (7)');
});

test('roles: owner/superadmin/admin/user resolved from LID senders via participantAlt', async () => {
  const t = await makeEnv();
  const roleOf = async (p: { lid: string; pn: string }) => {
    t.reset();
    await t.dispatcher.handleMessage(msg({ from: p, text: '.whoami' }));
    return /Role: \*(\w+)\*/.exec(t.texts()[0] ?? '')?.[1];
  };
  assert.equal(await roleOf(P.owen), 'owner');
  assert.equal(await roleOf(P.sam), 'superadmin');
  assert.equal(await roleOf(P.alice), 'admin');
  assert.equal(await roleOf(P.bob), 'user');
  // LID learned and persisted
  assert.equal(t.env.db.global.data.lidMap['444444444444444'], P.owen.pn);
});

test('owner via OWNER_LIDS and via fromMe (SELF_IS_OWNER)', async () => {
  const t = await makeEnv();
  const { config } = t.env;
  config.ownerNumbers = []; config.ownerLids = ['222222222222222']; // bob's LID
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.bob, text: '.whoami' }));
  assert.match(t.texts()[0]!, /Role: \*owner\*/);
  config.ownerLids = [];
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: 'bot', text: '.whoami', id: 'PHONE1' }));
  assert.match(t.texts()[0]!, /Role: \*owner\*/);
  config.selfIsOwner = false;
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: 'bot', text: '.whoami', id: 'PHONE2' }));
  assert.match(t.texts()[0]!, /Role: \*admin\*/); // no special rights; it is just a group admin here
});

test('ignores: own echoes, old messages, fromMe in other private chats, banned users', async () => {
  const t = await makeEnv();
  t.env.sent.add('ECHO1');
  await t.dispatcher.handleMessage(msg({ from: P.bob, text: '.ping', id: 'ECHO1' }));
  await t.dispatcher.handleMessage(msg({ from: P.bob, text: '.ping', ageSec: 3600 }));
  await t.dispatcher.handleMessage(msg({ from: 'bot', text: '.ping', chat: '2348099999999@s.whatsapp.net', fromMe: true }));
  assert.equal(t.sent().length, 0);
  t.env.db.global.data.banned[P.bob.pn] = { reason: 'x', by: 'o', at: 0 };
  await t.dispatcher.handleMessage(msg({ from: P.bob, text: '.ping' }));
  assert.equal(t.sent().length, 0);
  await t.dispatcher.handleMessage(msg({ from: P.zed, text: '.ping' }));
  assert.equal(t.sent().length, 1);
});

test('duplicate deliveries of the same message id are handled once', async () => {
  const t = await makeEnv();
  const m = msg({ from: P.bob, text: '.ping', id: 'DUP1' });
  await t.dispatcher.handleMessage(m);
  await t.dispatcher.handleMessage(m);
  assert.equal(t.sent().length, 1);
});

test('every chat send passes an options object (baileys-antiban crashes on undefined)', async () => {
  const t = await makeEnv();
  await t.dispatcher.handleMessage(msg({ from: P.bob, text: '.ping' }));
  await t.dispatcher.handleMessage(msg({ from: P.bob, text: '.rules' }));
  for (const c of t.calls.filter((x) => x.m === 'sendMessage')) assert.equal(typeof c.args[2], 'object');
});

test('cooldown throttles non-owners only', async () => {
  const t = await makeEnv();
  t.env.config.cooldownMs = 60_000;
  await t.dispatcher.handleMessage(msg({ from: P.bob, text: '.ping' }));
  await t.dispatcher.handleMessage(msg({ from: P.bob, text: '.ping' }));
  assert.equal(t.sent().length, 1);
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.owen, text: '.ping' }));
  await t.dispatcher.handleMessage(msg({ from: P.owen, text: '.ping' }));
  assert.equal(t.sent().length, 2);
});

void GROUP; void BOT_LID;
