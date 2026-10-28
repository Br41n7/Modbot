import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, msg, P, GROUP, pnJ } from './helpers.js';

const say = (t: Awaited<ReturnType<typeof makeEnv>>, from: any, text: string, extra: any = {}) =>
  t.dispatcher.handleMessage(msg({ from, text, ...extra }));

// ───────────────────────── anti-sticker (the headline feature) ─────────────────────────
test('antisticker: admin turns it on → member stickers are deleted, admins/owner exempt', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.antisticker on');
  assert.equal(t.env.db.settings(GROUP).antisticker.enabled, true);
  t.reset();

  await t.dispatcher.handleMessage(msg({ from: P.bob, sticker: true, id: 'STK1' }));
  assert.equal(t.deletes().length, 1);
  assert.equal(t.deletes()[0].id, 'STK1');
  assert.equal(t.deletes()[0].participant, P.bob.lid);

  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.alice, sticker: true }));  // group admin
  await t.dispatcher.handleMessage(msg({ from: P.owen, sticker: true }));   // bot owner
  await t.dispatcher.handleMessage(msg({ from: P.sam, sticker: true }));    // bot superadmin
  assert.equal(t.deletes().length, 0);

  await say(t, P.alice, '.exemptadmins off');
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.alice, sticker: true }));
  assert.equal(t.deletes().length, 1, 'admins are no longer exempt');
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.owen, sticker: true }));
  assert.equal(t.deletes().length, 0, 'owner is always exempt');

  await say(t, P.alice, '.antisticker off');
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.bob, sticker: true }));
  assert.equal(t.deletes().length, 0);
});

test('antisticker: bot not admin → cannot delete, warns the group only once', async () => {
  const t = await makeEnv({ botAdmin: false });
  t.env.db.settings(GROUP).antisticker.enabled = true;
  await t.dispatcher.handleMessage(msg({ from: P.bob, sticker: true }));
  await t.dispatcher.handleMessage(msg({ from: P.bob, sticker: true }));
  assert.equal(t.deletes().length, 0);
  assert.equal(t.texts().filter((x) => /not a group admin/.test(x)).length, 1);
});

test('blocktype image/unblocktype', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.blocktype image');
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.bob, image: true, text: 'pic' }));
  assert.equal(t.deletes().length, 1);
  await say(t, P.alice, '.unblocktype image');
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.bob, image: true }));
  assert.equal(t.deletes().length, 0);
});

// ───────────────────────── other filters ─────────────────────────
test('antilink: whatsapp invites removed; allow-list; warn action escalates to kick', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.antilink on whatsapp warn');
  const s = t.env.db.settings(GROUP);
  assert.equal(s.antilink.enabled, true); assert.equal(s.antilink.action, 'warn');
  s.maxWarns = 2;
  t.reset();
  await say(t, P.bob, 'free stuff chat.whatsapp.com/ABCDEFGHIJKLMN');
  assert.equal(t.deletes().length, 1);
  assert.match(t.texts().join(' '), /Warning 1\/2/);
  await say(t, P.bob, 'again chat.whatsapp.com/ABCDEFGHIJKLMN');
  assert.equal(t.of('participantsUpdate').length, 1);
  assert.deepEqual(t.of('participantsUpdate')[0]!.args, [GROUP, [P.bob.lid], 'remove']);
  assert.equal(Object.keys(t.env.db.group(GROUP).warns).length, 0, 'counter reset after removal');

  await say(t, P.alice, '.antilink allow chat.whatsapp.com/ABCDEFGHIJKLMN');
  t.reset();
  await say(t, P.zed, 'ours: chat.whatsapp.com/ABCDEFGHIJKLMN');
  assert.equal(t.deletes().length, 0);
});

test('antispam: more than max in window triggers action', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.antispam on 3 10 delete');
  t.reset();
  for (let i = 0; i < 4; i++) await say(t, P.bob, `msg ${i}`);
  assert.equal(t.deletes().length, 1);
  t.reset();
  for (let i = 0; i < 10; i++) await say(t, P.alice, `admin msg ${i}`);
  assert.equal(t.deletes().length, 0, 'admins exempt');
});

test('antibadword add/list/enforce', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.antibadword add idiot');
  await say(t, P.alice, '.antibadword on');
  t.reset();
  await say(t, P.bob, 'you are an IDIOT');
  assert.equal(t.deletes().length, 1);
  t.reset();
  await say(t, P.bob, 'idiotic is fine (different word)');
  assert.equal(t.deletes().length, 0);
});

// ───────────────────────── admin commands & safety rules ─────────────────────────
test('kick: works on members, refuses owner / creator / equal rank / self / non-members', async () => {
  const t = await makeEnv();
  await say(t, P.alice, `.kick @${P.bob.lid.split('@')[0]}`, { mentions: [P.bob.lid] });
  assert.deepEqual(t.of('participantsUpdate')[0]!.args, [GROUP, [P.bob.lid], 'remove']);

  t.reset();
  await say(t, P.alice, '.kick @owen', { mentions: [P.owen.lid] });
  assert.equal(t.of('participantsUpdate').length, 0);
  assert.match(t.texts().join(' '), /bot owner/);

  t.reset();
  await say(t, P.alice, '.kick @carl', { mentions: [P.carl.lid] });
  assert.equal(t.of('participantsUpdate').length, 0);

  t.reset();
  await say(t, P.alice, '.kick @alice', { mentions: [P.alice.lid] });
  assert.equal(t.of('participantsUpdate').length, 0);
  assert.match(t.texts().join(' '), /same or higher rank/);

  t.reset();
  await say(t, P.alice, `.kick @bot`, { mentions: [BOT_LID_] });
  assert.equal(t.of('participantsUpdate').length, 0);

  // superadmin CAN remove a group admin; reply-target and typed number also work
  t.reset();
  await say(t, P.sam, '.kick', { quoteFrom: P.alice.lid });
  assert.deepEqual(t.of('participantsUpdate')[0]!.args, [GROUP, [P.alice.lid], 'remove']);
  t.reset();
  await say(t, P.alice, `.kick ${P.zed.pn}`);
  assert.deepEqual(t.of('participantsUpdate')[0]!.args, [GROUP, [P.zed.lid], 'remove'], 'number is mapped to the LID participant id');
});
const BOT_LID_ = '999111222333444@lid';

test('kick needs bot admin; members cannot use admin commands', async () => {
  const t = await makeEnv({ botAdmin: false });
  await say(t, P.alice, '.kick @bob', { mentions: [P.bob.lid] });
  assert.match(t.texts()[0]!, /need to be a group admin/);
  const t2 = await makeEnv();
  await say(t2, P.bob, '.kick @zed', { mentions: [P.zed.lid] });
  assert.match(t2.texts()[0]!, /group admins/);
  assert.equal(t2.of('participantsUpdate').length, 0);
});

test('promote/demote use the bypass path with the right action', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.promote @zed', { mentions: [P.zed.lid] });
  assert.deepEqual(t.of('participantsUpdate')[0]!.args, [GROUP, [P.zed.lid], 'promote']);
  t.reset();
  await say(t, P.alice, '.demote @alice', { mentions: [P.alice.lid] });
  assert.equal(t.of('participantsUpdate').length, 0);
  t.reset();
  await say(t, P.sam, '.demote @alice', { mentions: [P.alice.lid] });
  assert.deepEqual(t.of('participantsUpdate')[0]!.args, [GROUP, [P.alice.lid], 'demote']);
});

test('warn → limit → auto-kick; unwarn; resetwarn; warns', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.warnlimit 3');
  for (let i = 1; i <= 2; i++) await say(t, P.alice, '.warn @zed flooding', { mentions: [P.zed.lid] });
  assert.match(t.texts().at(-1)!, /Warning 2\/3/);
  await say(t, P.alice, '.unwarn @zed', { mentions: [P.zed.lid] });
  assert.match(t.texts().at(-1)!, /1\/3/);
  await say(t, P.alice, '.warns @zed', { mentions: [P.zed.lid] });
  assert.match(t.texts().at(-1)!, /1\/3/);
  await say(t, P.alice, '.warn @zed', { mentions: [P.zed.lid] });
  await say(t, P.alice, '.warn @zed', { mentions: [P.zed.lid] });
  assert.equal(t.of('participantsUpdate').length, 1);
  assert.match(t.texts().at(-1)!, /removed/);
  await say(t, P.alice, '.warn @owen', { mentions: [P.owen.lid] });
  assert.match(t.texts().at(-1)!, /owner/);
});

test('group settings commands: mute/unmute/link/del/tagall/setrules', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.mute');
  assert.deepEqual(t.of('groupSettingUpdate')[0]!.args, [GROUP, 'announcement']);
  await say(t, P.alice, '.unmute');
  assert.deepEqual(t.of('groupSettingUpdate')[1]!.args, [GROUP, 'not_announcement']);
  await say(t, P.alice, '.link');
  assert.match(t.texts().at(-1)!, /chat\.whatsapp\.com\/ABCDEF1234567/);

  t.reset();
  await say(t, P.alice, '.del', { quoteFrom: P.bob.lid });
  assert.equal(t.deletes().length, 2);
  assert.equal(t.deletes()[0].id, 'QUOTED1');

  t.reset();
  await say(t, P.alice, '.tagall hello');
  const sent = t.sent().at(-1)!;
  assert.equal(sent.mentions.length, 7);

  await say(t, P.alice, '.setrules Be kind');
  await say(t, P.bob, '.rules');
  assert.match(t.texts().at(-1)!, /Be kind/);
});

test('add is superadmin-only by default and maps WhatsApp status codes', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.add 2348012345678');
  assert.match(t.texts().at(-1)!, /superadmins/);
  await say(t, P.sam, '.add 2348012345678');
  assert.deepEqual(t.of('participantsUpdate')[0]!.args, [GROUP, [pnJ('2348012345678')], 'add']);
  assert.match(t.texts().at(-1)!, /added/);
});

test('welcome & goodbye via group-participants.update', async () => {
  const t = await makeEnv();
  await say(t, P.alice, '.setwelcome Hey {user}, welcome to {group}!');
  await say(t, P.alice, '.welcome on');
  t.reset();
  await t.dispatcher.onParticipants({ id: GROUP, action: 'add', participants: [{ id: P.zed.lid, phoneNumber: pnJ(P.zed.pn) } as any] });
  assert.match(t.texts()[0]!, /Hey @666666666666666, welcome to Test Group!/);
  assert.deepEqual(t.sent()[0]!.mentions, [P.zed.lid]);
  t.reset();
  await t.dispatcher.onParticipants({ id: GROUP, action: 'add', participants: [{ id: '999111222333444@lid' } as any] });
  assert.equal(t.sent().length, 0, 'does not greet itself');
  t.reset();
  await t.dispatcher.onParticipants({ id: GROUP, action: 'remove', participants: [{ id: P.zed.lid } as any] });
  assert.equal(t.sent().length, 0, 'goodbye is off by default');
});

// ───────────────────────── owner / policy ─────────────────────────
test('owner policy: userfeatures / superfeatures / setrole / locks', async () => {
  const t = await makeEnv();

  // members cannot configure protections
  await say(t, P.bob, '.antisticker on');
  assert.equal(t.env.db.settings(GROUP).antisticker.enabled, false);

  // non-owners cannot touch policy (even superadmins)
  await say(t, P.sam, '.setrole kick user');
  assert.match(t.texts().at(-1)!, /Owner only/);
  await say(t, P.alice, '.userfeatures add antisticker');
  assert.match(t.texts().at(-1)!, /Owner only/);

  // owner lets ordinary users use antisticker
  await say(t, P.owen, '.userfeatures add antisticker');
  assert.match(t.texts().at(-1)!, /can now be used by users/);
  await say(t, P.bob, '.antisticker on');
  assert.equal(t.env.db.settings(GROUP).antisticker.enabled, true);
  await say(t, P.owen, '.userfeatures remove antisticker');
  await say(t, P.bob, '.antisticker off');
  assert.equal(t.env.db.settings(GROUP).antisticker.enabled, true, 'bob lost the right again');

  // superadmin features: ban is owner-only by default; owner delegates it
  await say(t, P.sam, `.ban @zed`, { mentions: [P.zed.lid] });
  assert.match(t.texts().at(-1)!, /Owner only/);
  await say(t, P.owen, '.superfeatures add ban');
  await say(t, P.sam, `.ban @zed spam`, { mentions: [P.zed.lid] });
  assert.ok(t.env.db.global.data.banned[P.zed.pn]);
  t.reset();
  await say(t, P.zed, '.ping');
  assert.equal(t.sent().length, 0, 'banned user is ignored');
  await say(t, P.owen, '.superfeatures remove ban');
  await say(t, P.sam, '.unban @zed', { mentions: [P.zed.lid] });
  assert.match(t.texts().at(-1)!, /Owner only/);
  await say(t, P.owen, '.unban @zed', { mentions: [P.zed.lid] });
  assert.equal(t.env.db.global.data.banned[P.zed.pn], undefined);

  // setrole: owner can tighten a command; locked commands cannot be changed
  await say(t, P.owen, '.setrole kick superadmin');
  t.reset();
  await say(t, P.alice, '.kick @zed', { mentions: [P.zed.lid] });
  assert.match(t.texts().at(-1)!, /superadmins/);
  assert.equal(t.of('participantsUpdate').length, 0);
  await say(t, P.sam, '.kick @zed', { mentions: [P.zed.lid] });
  assert.equal(t.of('participantsUpdate').length, 1);
  await say(t, P.owen, '.resetrole kick');
  await say(t, P.owen, '.setrole setrole user');
  assert.match(t.texts().at(-1)!, /owner-locked/);
  await say(t, P.owen, '.setrole nonsense user');
  assert.match(t.texts().at(-1)!, /Usage/);
});

test('superadmin management + persistence of policy', async () => {
  const t = await makeEnv();
  await say(t, P.owen, '.addsuper 2348077777777');
  assert.ok(t.env.db.global.data.superadmins.includes('2348077777777'));
  await say(t, P.owen, `.addsuper @zed`, { mentions: [P.zed.lid] }); // resolves LID → phone through participant data
  assert.ok(t.env.db.global.data.superadmins.includes(P.zed.pn));
  await say(t, P.owen, '.supers');
  assert.match(t.texts().at(-1)!, /2348077777777/);
  await say(t, P.owen, '.delsuper 2348077777777');
  assert.ok(!t.env.db.global.data.superadmins.includes('2348077777777'));
  await say(t, P.alice, '.addsuper 2348066666666');
  assert.match(t.texts().at(-1)!, /Owner only/);
  await say(t, P.owen, '.perms');
  assert.match(t.texts().at(-1)!, /Owner only/);
});

test('owner works in private chat; mode private; setprefix; per-group disable', async () => {
  const t = await makeEnv();
  await t.dispatcher.handleMessage(msg({ from: P.owen, text: '.supers', chat: pnJ(P.owen.pn) }));
  assert.equal(t.sent().length, 1);

  // group-only command in DM
  t.reset();
  await t.dispatcher.handleMessage(msg({ from: P.owen, text: '.kick @x', chat: pnJ(P.owen.pn) }));
  assert.match(t.texts()[0]!, /only works in groups/);

  await say(t, P.alice, '.disable ping');
  t.reset();
  await say(t, P.bob, '.ping');
  assert.equal(t.sent().length, 0);
  await say(t, P.alice, '.enable ping');
  t.reset();
  await say(t, P.bob, '.ping');
  assert.equal(t.sent().length, 1);
  await say(t, P.alice, '.disable help');
  assert.match(t.texts().at(-1)!, /can't be disabled/);

  await say(t, P.owen, '.mode private');
  t.reset();
  await say(t, P.bob, '.ping'); await say(t, P.alice, '.ping');
  assert.equal(t.sent().length, 0);
  await say(t, P.sam, '.ping');
  assert.equal(t.sent().length, 1);
  await say(t, P.owen, '.mode public');

  await say(t, P.owen, '.setprefix !');
  t.reset();
  await say(t, P.bob, '.ping'); await say(t, P.bob, '!ping');
  assert.equal(t.sent().length, 1);
});

test('help only lists what the caller may use', async () => {
  const t = await makeEnv();
  await say(t, P.bob, '.help');
  const bobHelp = t.texts().at(-1)!;
  assert.match(bobHelp, /\.ping/); assert.doesNotMatch(bobHelp, /\.kick/); assert.doesNotMatch(bobHelp, /\.addsuper/);
  await say(t, P.alice, '.help');
  const aliceHelp = t.texts().at(-1)!;
  assert.match(aliceHelp, /\.kick/); assert.match(aliceHelp, /\.antisticker/); assert.doesNotMatch(aliceHelp, /\.addsuper/);
  await say(t, P.owen, '.help');
  assert.match(t.texts().at(-1)!, /\.addsuper/);
  await say(t, P.bob, '.help antisticker');
  assert.match(t.texts().at(-1)!, /Auto-delete every sticker/);
});
