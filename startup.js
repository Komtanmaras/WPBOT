/**
 * Bot acilisinda hedef gruptan son mesajlari okur.
 * STARTUP_MODE: idle | sync | reply_last
 */

const historyStore = require('./historyStore');
const logger = require('./logger');

const MODES = ['idle', 'sync', 'reply_last'];

function parseStartupMode() {
  const argIdx = process.argv.indexOf('--startup');
  if (argIdx >= 0 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1].toLowerCase().trim();
  }
  const fromEnv = (process.env.STARTUP_MODE || 'idle').toLowerCase().trim();
  return fromEnv;
}

function isValidMode(mode) {
  return MODES.includes(mode);
}

async function findTargetGroupChat(client, config, isTargetGroup) {
  const chats = await client.getChats();
  const groups = chats.filter((c) => c.isGroup && isTargetGroup(c));
  if (!groups.length) return null;

  if (config.targetGroupId) {
    const byId = groups.find(
      (g) => (g.id?._serialized || g.id) === config.targetGroupId,
    );
    if (byId) return byId;
  }

  return groups[0];
}

function messageTimestampMs(msg) {
  const t = msg.timestamp;
  if (!t) return Date.now();
  return t < 1e12 ? t * 1000 : t;
}

async function runStartup(ctx) {
  const { client, config, engine, isTargetGroup, getSenderLabel, resolveAuthorPhone } =
    ctx;

  const mode = parseStartupMode();
  if (!isValidMode(mode)) {
    logger.warn(`[STARTUP] Gecersiz mod: ${mode}. Kullan: ${MODES.join(', ')}`);
    return;
  }

  if (mode === 'idle') {
    logger.info('[STARTUP] Mod: idle (sadece yeni mesajlar)');
    return;
  }

  logger.info(`[STARTUP] Mod: ${mode}`);

  const chat = await findTargetGroupChat(client, config, isTargetGroup);
  if (!chat) {
    logger.warn('[STARTUP] Hedef grup bulunamadi.');
    return;
  }

  const groupId = chat.id?._serialized || chat.id;
  const limit = parseInt(process.env.STARTUP_FETCH_LIMIT, 10) || parseInt(process.env.HISTORY_SIZE, 10) || 15;

  logger.info(`[STARTUP] "${chat.name}" — son ${limit} mesaj okunuyor...`);

  let messages;
  try {
    messages = await chat.fetchMessages({ limit });
  } catch (err) {
    logger.warn('[STARTUP] Mesajlar alinamadi:', err.message);
    return;
  }

  messages.sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b));

  const entries = [];
  for (const msg of messages) {
    const body = msg.body?.trim();
    if (!body) continue;

    const sender = await getSenderLabel(msg);
    const authorPhone = msg.fromMe ? null : await resolveAuthorPhone(msg);

    entries.push({
      sender,
      body,
      fromMe: msg.fromMe,
      authorPhone,
      timestamp: messageTimestampMs(msg),
    });
  }

  historyStore.setGroupHistory(groupId, entries);
  logger.info(`[STARTUP] Gecmise ${entries.length} mesaj yazildi.`);

  const lastFromMe = [...entries].reverse().find((e) => e.fromMe);
  if (lastFromMe && engine.setLastBotReplyAt) {
    engine.setLastBotReplyAt(groupId, lastFromMe.timestamp);
  }

  if (mode === 'sync') {
    logger.info('[STARTUP] sync tamam — yeni mesajlar dinleniyor.');
    return;
  }

  const maxAge = parseInt(process.env.STARTUP_MAX_AGE_MS, 10) || 600000;
  const now = Date.now();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.fromMe) continue;

    const body = msg.body?.trim();
    if (!body) continue;

    const age = now - messageTimestampMs(msg);
    if (age > maxAge) {
      logger.info(
        `[STARTUP] Son mesaj ${Math.round(age / 1000)} sn once — cok eski (limit ${maxAge / 1000} sn), cevap yok.`,
      );
      return;
    }

    logger.info(`[STARTUP] Son mesaja cevap kuyrugu: "${body.slice(0, 60)}${body.length > 60 ? '...' : ''}"`);
    const authorPhone = await resolveAuthorPhone(msg);
    await engine.onIncomingMessage(msg, body, groupId, authorPhone);
    return;
  }

  logger.info('[STARTUP] Cevap verilecek gelen mesaj yok.');
}

module.exports = { runStartup, parseStartupMode, MODES };
