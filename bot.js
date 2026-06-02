const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
require('dotenv').config();

if (process.env.DEBUG !== 'true') {
  process.env.OPENAI_LOG = '';
}

const historyStore = require('./historyStore');
const { createEngine, TIMING } = require('./conversationEngine');
const { createAiClient, loadAiOptionsFromEnv } = require('./aiClient');
const { normalizePhone, findPersona } = require('./personas');
const { runStartup, parseStartupMode } = require('./startup');
const logger = require('./logger');

historyStore.setMaxMessages(parseInt(process.env.HISTORY_SIZE, 10) || 15);

const config = {
  targetGroupName: process.env.TARGET_GROUP_NAME,
  targetGroupId: process.env.TARGET_GROUP_ID,
  userName: process.env.USER_NAME || 'Kullanici',
  nameAliases: (process.env.USER_NAME_ALIASES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  deepSeekApiKey: process.env.DEEPSEEK_API_KEY,
  deepSeekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  personalityNotes: process.env.PERSONALITY_NOTES || '',
  debug: process.env.DEBUG === 'true',
};

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: config.deepSeekApiKey,
});

let myWid = null;
let myPhoneUser = null;
let engine = null;

function getNameVariants() {
  const names = new Set([config.userName, ...config.nameAliases]);
  const base = config.userName.toLocaleLowerCase('tr-TR');
  names.add(base);
  names.add(
    base
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c'),
  );
  return [...names].filter(Boolean);
}

function isCalledByName(text) {
  if (!text) return false;
  const lower = text.toLocaleLowerCase('tr-TR');
  return getNameVariants().some((name) => lower.includes(name.toLocaleLowerCase('tr-TR')));
}

const PERSONAL_QUESTION_PATTERNS = [
  'nasılsın',
  'nasilsin',
  'naber',
  'nbr',
  'ne haber',
  'napiyorsun',
  'ne yapıyorsun',
  'ne yapıyon',
  'iyi misin',
  'nasılsınız',
  'ne var ne yok',
  'naber nasılsın',
];

function isPersonalQuestion(text) {
  if (!text) return false;
  const lower = text.toLocaleLowerCase('tr-TR');
  return PERSONAL_QUESTION_PATTERNS.some((p) => lower.includes(p));
}

const GROUP_SOCIAL_PATTERNS = [
  'naber',
  'nbr',
  'selam',
  'selamlar',
  'günaydın',
  'gunaydin',
  'iyi geceler',
  'iyi akşamlar',
  'arkadaşlar',
  'arkadaslar',
  'millete',
  'herkese',
  'nasılsınız',
  'nasilsiniz',
  'ne haber',
  'ne var ne yok',
  'naber millet',
  'naber arkadaşlar',
];

function isGroupSocialOpener(text) {
  if (!text) return false;
  const lower = text.toLocaleLowerCase('tr-TR').trim();
  if (lower.length > 120) return false;
  if (isCalledByName(text)) return true;
  return GROUP_SOCIAL_PATTERNS.some((p) => lower.includes(p));
}

function isFollowUpDirectedAtMe(history) {
  if (!history.length) return false;
  const latest = history[history.length - 1];
  if (!isPersonalQuestion(latest?.body)) return false;

  const windowMs = 120000;
  const now = Date.now();

  for (let i = history.length - 2; i >= 0 && i >= history.length - 6; i--) {
    const m = history[i];
    if (m.fromMe) continue;
    if (m.timestamp && now - m.timestamp > windowMs) break;
    if (isCalledByName(m.body)) return true;
  }
  return false;
}

function isTagged(msg) {
  if (!myWid || !msg.mentionedIds?.length) return false;
  return msg.mentionedIds.some(
    (id) => id === myWid || (myPhoneUser && id.includes(myPhoneUser)),
  );
}

async function isReplyToMe(msg) {
  if (!msg.hasQuotedMsg) return false;
  try {
    const quoted = await msg.getQuotedMessage();
    return quoted?.fromMe === true;
  } catch {
    return false;
  }
}

function isTargetGroup(chat) {
  if (config.targetGroupId) {
    const chatId = chat.id?._serialized || chat.id;
    if (chatId === config.targetGroupId) return true;
  }
  if (!config.targetGroupName) return false;
  const chatName = (chat.name || '').trim().toLowerCase();
  const targetName = config.targetGroupName.trim().toLowerCase();
  return chatName === targetName;
}

async function getSenderLabel(msg) {
  if (msg.fromMe) return config.userName;
  try {
    const contact = await msg.getContact();
    return contact.pushname || contact.name || contact.number || 'Biri';
  } catch {
    return 'Biri';
  }
}

async function resolveAuthorPhone(msg) {
  const authorId = msg.author || msg._data?.participant || msg._data?.author;
  if (!authorId) return null;

  if (authorId.endsWith('@c.us') || authorId.endsWith('@s.whatsapp.net')) {
    return normalizePhone(authorId.split('@')[0]);
  }

  if (authorId.includes('@lid')) {
    try {
      const results = await client.getContactLidAndPhone([authorId]);
      const pn = results[0]?.pn;
      if (pn) return normalizePhone(pn.split('@')[0]);
    } catch {
      // devam
    }
  }

  try {
    const contact = await client.getContactById(authorId);
    if (contact?.number) return normalizePhone(contact.number);
    if (contact?.id?.user) return normalizePhone(contact.id.user);
  } catch {
    // devam
  }

  return normalizePhone(authorId.split('@')[0]);
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('\n=== QR KODU TARAYIN ===');
  qrcode.generate(qr, { small: true });
  console.log('=======================\n');
});

client.on('ready', async () => {
  myWid = client.info?.wid?._serialized;
  myPhoneUser = client.info?.wid?.user;

  const ai = createAiClient(deepseek, loadAiOptionsFromEnv(config));

  engine = createEngine({
    config,
    ai,
    client,
    helpers: {
      isCalledByName,
      isTagged,
      isReplyToMe,
      isFollowUpDirectedAtMe,
      isGroupSocialOpener,
    },
  });

  logger.info(`[BOT] Baglandi | Rol: ${config.userName} | Grup: ${config.targetGroupName || config.targetGroupId}`);
  logger.info(
    `[BOT] Gecikme normal: ${TIMING.normalMin / 1000}s-${TIMING.normalMax / 1000}s | hizli: ${TIMING.fastMin / 1000}s-${TIMING.fastMax / 1000}s | DEBUG: ${config.debug}`,
  );

  try {
    const chats = await client.getChats();
    chats
      .filter((c) => c.isGroup)
      .forEach((g) => logger.info(`[GRUP] "${g.name}" | ${g.id?._serialized || g.id}`));
  } catch (err) {
    logger.warn('[BOT] Grup listesi alinamadi:', err.message);
  }

  logger.info(`[BOT] Baslangic modu: ${parseStartupMode()}`);

  try {
    await runStartup({
      client,
      config,
      engine,
      isTargetGroup,
      getSenderLabel,
      resolveAuthorPhone,
    });
  } catch (err) {
    logger.error('[STARTUP] Hata:', err.message);
  }
});

client.on('auth_failure', (msg) => {
  logger.error('[HATA] Kimlik dogrulama basarisiz:', msg);
});

client.on('disconnected', (reason) => {
  logger.warn('[BOT] Baglanti koptu:', reason);
});

async function processGroupMessage(msg) {
  if (!msg.from.endsWith('@g.us')) return;

  const chat = await msg.getChat();
  if (!isTargetGroup(chat)) return;

  const body = msg.body?.trim();
  const groupId = msg.from;

  if (body) {
    const sender = await getSenderLabel(msg);
    const authorPhone = msg.fromMe ? null : await resolveAuthorPhone(msg);
    historyStore.addMessage(groupId, {
      sender,
      body,
      fromMe: msg.fromMe,
      authorPhone,
      timestamp: Date.now(),
    });

    if (!msg.fromMe) {
      const preview = body.length > 100 ? `${body.slice(0, 100)}…` : body;
      const persona = authorPhone ? findPersona(authorPhone) : null;
      const personaTag = persona ? ` | profil: ${persona.name}` : '';
      logger.info(`[MESAJ] ${sender}: ${preview}${personaTag}`);
    } else {
      const preview = body.length > 100 ? `${body.slice(0, 100)}…` : body;
      logger.info(`[BEN] ${preview}`);
    }
  }

  if (msg.fromMe) {
    if (body && engine) engine.onBotSentMessage(groupId);
    return;
  }

  if (!body) return;
  if (!engine) return;

  // Yeni mesaj gelince bekleyen cevabi iptal et, son mesaja gore yeniden planla
  const authorPhone = await resolveAuthorPhone(msg);
  await engine.onIncomingMessage(msg, body, groupId, authorPhone);
}

client.on('message_create', async (msg) => {
  try {
    await processGroupMessage(msg);
  } catch (error) {
    logger.error('[HATA]', error.message);
  }
});

logger.info('[BOT] Baslatiliyor...');
client.initialize();
