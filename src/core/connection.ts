/**
 * @module core/connection
 * Boots everything and keeps the WhatsApp connection alive.
 *
 *  startBot()
 *   ├─ builds the long-lived singletons ONCE: Db, Registry(+modules), Policy, Identity, GroupCache, SentIds, Dispatcher
 *   └─ connectOnce() on every (re)connect:
 *        raw socket (Baileys) ─► capture original groupParticipantsUpdate ─► wrapSocket (baileys-antiban)
 *        env.sock = raw, env.safe = wrapped, dispatcher.attach(raw)
 *
 * Login: QR in terminal, or a pairing CODE when PAIRING_NUMBER is set.
 * Reconnect: exponential backoff (max 60s). 401 (logged out) / 440 (replaced) stop the process on purpose.
 * Docs: docs/01-CORE.md#connection , docs/07-ANTIBAN-INTEGRATION.md
 */
import makeWASocket, {
  Browsers, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, useMultiFileAuthState,
} from 'baileys';
import qrcode from 'qrcode-terminal';
import { config } from '../config.js';
import { Db } from '../storage/db.js';
import { Registry } from './registry.js';
import { Policy } from '../permissions/policy.js';
import { Identity } from './identity.js';
import { GroupCache } from './groupCache.js';
import { SentIds } from './sentIds.js';
import { Dispatcher } from './dispatcher.js';
import { wireAntiban } from './antibanSetup.js';
import type { BotEnv } from './types.js';
import { allModules } from '../modules/index.js';
import { baileysLog, makeLog } from './logger.js';

const log = makeLog('conn');

export function createEnvBase() {
  const db = new Db(config.dataDir);
  const registry = new Registry();
  allModules.forEach((m) => registry.register(m));
  const identity = new Identity(db);
  const groups = new GroupCache();
  groups.onLearn = (lid, pn) => identity.learn(lid, pn);
  const policy = new Policy(db, registry);
  return { db, registry, identity, groups, policy, sent: new SentIds(), config, startedAt: Date.now() };
}

export async function startBot() {
  if (!config.ownerNumbers.length && !config.ownerLids.length) {
    if (!config.selfIsOwner) {
      log.error('No owner configured. Set OWNER_NUMBERS in .env (or SELF_IS_OWNER=true).');
      process.exit(1);
    }
    log.warn('OWNER_NUMBERS is empty — only messages sent from the bot\'s own account will count as owner.');
  }

  const base = createEnvBase();
  const env = base as unknown as BotEnv;
  const dispatcher = new Dispatcher(env);
  for (const m of env.registry.modules) m.init?.(env);
  let attempt = 0;
  let stopping = false;

  const shutdown = (code = 0) => {
    if (stopping) return;
    stopping = true;
    log.info('Shutting down, flushing data…');
    try { env.db.flush(); } catch (e) { log.error('flush failed', e); }
    try { env.sock?.end(undefined); } catch { /* already closed */ }
    setTimeout(() => process.exit(code), 300);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));
  process.on('uncaughtException', (e) => log.error('uncaughtException', e));

  async function connectOnce(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLog) },
      logger: baileysLog,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      cachedGroupMetadata: async (jid) => env.groups.peek(jid),
      getMessage: async () => undefined,
    });

    const { safe, participantsUpdate } = wireAntiban(sock);
    env.sock = sock;
    env.safe = safe;
    env.participantsUpdate = participantsUpdate;

    sock.ev.on('creds.update', saveCreds);
    dispatcher.attach(sock);

    let pairingAsked = false;
    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        if (config.pairingNumber && !state.creds.registered) {
          if (!pairingAsked) {
            pairingAsked = true;
            try {
              const code = await sock.requestPairingCode(config.pairingNumber);
              log.info(`PAIRING CODE: ${code}  (WhatsApp → Linked devices → Link with phone number)`);
            } catch (err) { log.error('requestPairingCode failed:', err); }
          }
        } else {
          log.info('Scan this QR with WhatsApp → Linked devices:');
          qrcode.generate(u.qr, { small: true });
        }
      }

      if (u.connection === 'open') {
        attempt = 0;
        log.info(`Connected as ${sock.user?.id} — prefix "${env.db.global.data.prefix ?? config.prefix}"`);
      }

      if (u.connection === 'close') {
        const code = (u.lastDisconnect?.error as any)?.output?.statusCode as number | undefined;
        if (stopping) return;
        if (code === DisconnectReason.loggedOut) {
          log.error('Logged out from WhatsApp. Delete the auth folder and start again to re-link.');
          return shutdown(1);
        }
        if (code === DisconnectReason.connectionReplaced) {
          log.error('Connection replaced: another instance is using this session. Stopping.');
          return shutdown(1);
        }
        const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(60_000, 1000 * 2 ** Math.min(attempt++, 6));
        log.warn(`Connection closed (code ${code ?? '?'}). Reconnecting in ${Math.round(delay / 1000)}s…`);
        setTimeout(() => connectOnce().catch((e) => { log.error('reconnect failed', e); }), delay);
      }
    });
  }

  await connectOnce();
}
