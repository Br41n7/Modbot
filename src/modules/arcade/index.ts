/** Original cyber/neon fun, games, sticker and lightweight group utilities. */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadMediaMessage } from 'baileys';
import type { BotModule, Command, Ctx, Filter } from '../../core/types.js';
import { JsonStore } from '../../storage/jsonStore.js';
import { config } from '../../config.js';

const neon = (title: string, body: string) => `╭━━━〔 ⚡ N E O N 〔${title}〕 ⚡〕━━━╮\n${body}\n╰━━━━━━━━━━━━━━━━━━━━━━╯`;
const jokes = [
  'My code works. I have no idea why. I am not touching it. 😭',
  'There are 10 kinds of people: those who understand binary and those who do not.',
  'A programmer went broke because he used up all his cache. 💸',
  'Debugging: being the detective in a crime movie where you are also the criminal.',
];
const truths = ['What is one skill you wish you could master overnight?', 'What is the funniest misunderstanding you have had?', 'What is one goal you rarely tell people about?'];
const dares = ['Send a wholesome compliment to someone here.', 'Describe your day using only three emojis.', 'Share a song you can listen to on repeat.'];
const riddles = [
  { q: 'I have keys but no locks, space but no room. You can enter, but cannot go outside. What am I?', a: 'keyboard' },
  { q: 'The more you take, the more you leave behind. What are they?', a: 'footsteps' },
  { q: 'What has a face and two hands but no arms or legs?', a: 'clock' },
];
const answers8 = ['Definitely yes. ✨', 'The signs point to yes.', 'Not looking good, chief.', 'Ask again after a snack.', 'High probability. ⚡', 'I would not bet on it.'];

interface ArcadeData {
  afk: Record<string, { since: number; reason: string; name: string }>;
  scores: Record<string, number>;
  riddles: Record<string, { answer: string; asker: string; createdAt: number }>;
}
const store = new JsonStore<ArcadeData>(path.join(config.dataDir, 'arcade.json'), { afk: {}, scores: {}, riddles: {} });
const keyFor = (ctx: Ctx, sender = ctx.sender) => `${ctx.chat}|${sender}`;
const random = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;
const age = (ts: number) => { const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000)); return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`; };

const menu: Command = {
  name: 'neon', aliases: ['funmenu'], defaultRole: 'user', description: 'Show the cyber/neon feature menu.',
  async run(ctx) {
    const p = ctx.prefix;
    await ctx.reply(neon('SYSTEM MENU', [
      '┌─〔 🎮 ARCADE 〕', `│ ${p}riddle • ${p}answer <answer>`, `│ ${p}quiz • ${p}answer <answer>`, `│ ${p}score`, '├─〔 🎭 CHAOS-GOOD 〕',
      `│ ${p}joke • ${p}8ball <question>`, `│ ${p}ship @user @user`, `│ ${p}truth • ${p}dare`,
      '├─〔 🧩 MEDIA 〕', `│ ${p}sticker (send with an image)`, '├─〔 🛰️ GROUP 〕',
      `│ ${p}afk [reason] • ${p}back`, `│ ${p}groupinfo • ${p}rules`, '└─〔 SYSTEM 〕',
      `  ${p}help • ${p}ping`, '', '◇ Be kind. Keep it fun. No spam or disruptive payloads.',
    ].join('\n')));
  },
};

const joke: Command = { name: 'joke', defaultRole: 'user', description: 'Get a random clean joke.', async run(ctx) { await ctx.reply(`⚡ ${random(jokes)}`); } };
const eightBall: Command = { name: '8ball', aliases: ['8b'], defaultRole: 'user', description: 'Ask the neon oracle a question.', usage: '8ball <question>', async run(ctx, _a, raw) { if (!raw) return ctx.reply(`Ask a question: ${ctx.prefix}8ball will I pass my exam?`); await ctx.reply(neon('ORACLE', `> ${raw.slice(0, 250)}\n\n${random(answers8)}`)); } };
const truth: Command = { name: 'truth', defaultRole: 'user', description: 'Get a friendly truth prompt.', async run(ctx) { await ctx.reply(`🎭 TRUTH DROP\n${random(truths)}`); } };
const dare: Command = { name: 'dare', defaultRole: 'user', description: 'Get a safe, friendly dare.', async run(ctx) { await ctx.reply(`🎯 DARE DROP\n${random(dares)}`); } };
const ship: Command = { name: 'ship', defaultRole: 'user', description: 'Generate a harmless compatibility score for two mentioned people.', usage: 'ship @person @person', async run(ctx) {
  const people = ctx.mentioned.slice(0, 2);
  if (people.length !== 2) return ctx.reply(`Mention two people. Usage: ${ctx.prefix}ship @person @person`);
  // Stable score per pair, so the same pair gets the same playful result.
  const pair = [...people].sort().join('|'); let h = 0; for (const ch of pair) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const score = h % 101; const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
  await ctx.reply(neon('COMPATIBILITY SCAN', `💞 @${people[0]!.split('@')[0]} + @${people[1]!.split('@')[0]}\n[${bar}] ${score}%\n${score > 75 ? 'Power duo energy ✨' : score > 45 ? 'Could be a good friendship 🤝' : 'The algorithm says: keep it friendly 😂'}`), people);
} };

const riddle: Command = { name: 'riddle', defaultRole: 'user', description: 'Start a riddle round in this chat.', async run(ctx) {
  const item = random(riddles); store.data.riddles[ctx.chat] = { answer: item.a, asker: ctx.sender, createdAt: Date.now() }; store.save();
  await ctx.reply(`🧩 NEON RIDDLE\n${item.q}\n\nReply with ${ctx.prefix}answer <your answer>.`);
} };
const quizQuestions = [
  { q: 'What does CPU stand for?', a: 'central processing unit' },
  { q: 'Which language runs natively in web browsers: JavaScript, Python, or C?', a: 'javascript' },
  { q: 'How many bits are in one byte?', a: '8' },
];
const quiz: Command = { name: 'quiz', defaultRole: 'user', description: 'Start a quick tech quiz in this chat.', async run(ctx) {
  const item = random(quizQuestions); store.data.riddles[ctx.chat] = { answer: item.a, asker: ctx.sender, createdAt: Date.now() }; store.save();
  await ctx.reply(`🧠 QUICK QUIZ\n${item.q}\n\n${ctx.prefix}answer <your answer>`);
} };
const answer: Command = { name: 'answer', defaultRole: 'user', description: 'Submit your answer to the active riddle or quiz.', usage: 'answer <your answer>', async run(ctx, _args, raw) {
  const round = store.data.riddles[ctx.chat]; if (!round || Date.now() - round.createdAt > 10 * 60_000) return ctx.reply(`No active round. Start one with ${ctx.prefix}riddle or ${ctx.prefix}quiz.`);
  if (!raw) return ctx.reply(`Usage: ${ctx.prefix}answer <your answer>`);
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, ' ');
  if (clean(raw) !== clean(round.answer)) return ctx.reply('❌ Not quite. Try again!');
  delete store.data.riddles[ctx.chat]; const k = keyFor(ctx); store.data.scores[k] = (store.data.scores[k] ?? 0) + 1; store.save();
  await ctx.reply(`⚡ Correct, ${ctx.senderName || 'player'}! +1 point. Your score: ${store.data.scores[k]}.`);
} };
const score: Command = { name: 'score', defaultRole: 'user', description: 'Show your arcade score in this chat.', async run(ctx) { await ctx.reply(`🏆 Your Neon Arcade score: *${store.data.scores[keyFor(ctx)] ?? 0}* point(s).`); } };

const afk: Command = { name: 'afk', defaultRole: 'user', description: 'Mark yourself as away in this chat.', usage: 'afk [reason]', async run(ctx, _args, raw) {
  store.data.afk[keyFor(ctx)] = { since: Date.now(), reason: raw.slice(0, 120) || 'No reason provided', name: ctx.senderName || 'Member' }; store.save();
  await ctx.reply(`🌙 ${ctx.senderName || 'You'} is now AFK. ${raw ? `Reason: ${raw.slice(0, 120)}` : 'Use .back when you return.'}`);
} };
const back: Command = { name: 'back', aliases: ['unafk'], defaultRole: 'user', description: 'Clear your AFK status.', async run(ctx) {
  const k = keyFor(ctx); const old = store.data.afk[k]; if (!old) return ctx.reply('You were not marked AFK.');
  delete store.data.afk[k]; store.save(); await ctx.reply(`⚡ Welcome back${old.name ? `, ${old.name}` : ''}! You were away for ${age(old.since)}.`);
} };

const afkFilter: Filter = { name: 'arcade-afk', description: 'Clear AFK on return and notify when an AFK member is mentioned.', priority: 100, async run(ctx) {
  if (ctx.text.trim().startsWith(ctx.prefix)) return false;
  const ownKey = keyFor(ctx); const own = store.data.afk[ownKey];
  if (own) { delete store.data.afk[ownKey]; store.save(); await ctx.reply(`⚡ Welcome back${own.name ? `, ${own.name}` : ''}! AFK cleared.`); }
  const found = ctx.mentioned.map((jid) => store.data.afk[keyFor(ctx, jid)]).filter(Boolean).slice(0, 3);
  if (found.length) await ctx.reply(`🌙 AFK notice: ${found.map((x) => `${x!.name} — ${x!.reason} (${age(x!.since)} away)`).join('\n')}`);
  return false;
} };

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'ignore' });
    child.once('error', (e) => reject(new Error(`ffmpeg is unavailable. Install it with: pkg install ffmpeg (${e.message})`)));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg conversion failed (exit ${code}). Try a smaller image.`)));
  });
}
const sticker: Command = { name: 'sticker', aliases: ['s'], defaultRole: 'user', description: 'Convert the image in your current message into a sticker.', async run(ctx) {
  const msgType = ctx.type;
  if (msgType !== 'imageMessage') return ctx.reply(`Send an image with caption ${ctx.prefix}sticker. Animated/video sticker conversion is not included in this release.`);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wa-modbot-sticker-'));
  const input = path.join(dir, 'input'); const output = path.join(dir, 'sticker.webp');
  try {
    const buffer = await downloadMediaMessage(ctx.msg, 'buffer', {}) as Buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length > 8 * 1024 * 1024) return ctx.reply('Image is too large. Please use an image under 8 MB.');
    await writeFile(input, buffer);
    await runFfmpeg(['-y', '-i', input, '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000', '-vcodec', 'libwebp', '-lossless', '1', '-q:v', '75', '-preset', 'picture', '-an', '-vsync', '0', output]);
    const webp = await readFile(output); if (webp.length > 1024 * 1024) return ctx.reply('Converted sticker exceeds 1 MB; try a smaller image.');
    const sent = await ctx.env.safe.sendMessage(ctx.chat, { sticker: webp }, {}); ctx.env.sent.add(sent?.key?.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
} };

export const arcadeModule: BotModule = {
  name: 'arcade', description: 'Neon menu, friendly games, fun commands, stickers and AFK status.',
  commands: [menu, joke, eightBall, truth, dare, ship, riddle, quiz, answer, score, afk, back, sticker],
  filters: [afkFilter],
};
