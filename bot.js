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
const { normalizePhone } = require('./personas');
const { runStartup, parseStartupMode, phonesMatch, resolveIdToPhone } = require('./startup');

historyStore.setMaxMessages(parseInt(process.env.HISTORY_SIZE, 10) || 50);

const config = {
  targetPersonNumber: normalizePhone(process.env.TARGET_PERSON_NUMBER || ''),
  targetPersonName: process.env.TARGET_PERSON_NAME || 'Hasan Burak Koç',
  targetPersonLid: (process.env.TARGET_PERSON_LID || '').trim(),
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

let engine = null;

async function getSenderLabel(msg) {
  if (msg.fromMe) return config.userName;
  try {
    const contact = await msg.getContact();
    return (
      contact.pushname ||
      contact.name ||
      config.targetPersonName ||
      contact.number ||
      'Biri'
    );
  } catch {
    return config.targetPersonName || 'Biri';
  }
}

/**
 * DM'de gonderen telefonu coz (from / LID / contact).
 */
async function resolveChatPhone(msg) {
  // Ozel sohbette mesaj genelde msg.from = numara@c.us
  const from = msg.from || '';
  if (from.endsWith('@c.us') || from.endsWith('@s.whatsapp.net')) {
    return normalizePhone(from.split('@')[0]);
  }

  if (from.includes('@lid')) {
    try {
      const results = await client.getContactLidAndPhone([from]);
      const pn = results[0]?.pn;
      if (pn) return normalizePhone(pn.split('@')[0]);
    } catch {
      // devam
    }
  }

  try {
    const contact = await msg.getContact();
    if (contact?.number) return normalizePhone(contact.number);
    if (contact?.id?.user) return normalizePhone(contact.id.user);
  } catch {
    // devam
  }

  const authorId = msg.author || msg._data?.author;
  if (authorId) {
    return normalizePhone(String(authorId).split('@')[0]);
  }

  return normalizePhone(from.split('@')[0]);
}

function isPrivateChat(msg) {
  const id = msg.from || '';
  return !id.endsWith('@g.us') && !id.endsWith('@broadcast');
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
  const ai = createAiClient(deepseek, loadAiOptionsFromEnv(config));

  engine = createEngine({
    config,
    ai,
    client,
    helpers: {
      debug: config.debug,
    },
  });

  console.log(`[BOT] Baglandi. Rol: ${config.userName}`);
  console.log(
    `[BOT] Mod: 1-1 | Hedef: ${config.targetPersonName} (${config.targetPersonNumber})`,
  );
  console.log(
    `[BOT] Gecikme normal: ${TIMING.normalMin / 1000}s - ${TIMING.normalMax / 1000}s | hizli: ${TIMING.fastMin / 1000}s - ${TIMING.fastMax / 1000}s`,
  );
  console.log(`[BOT] Baslangic modu: ${parseStartupMode()}`);

  // Store hazir olsun diye kisa bekle
  await new Promise((r) => setTimeout(r, 4000));

  try {
    await runStartup({
      client,
      config,
      engine,
      getSenderLabel,
      resolveChatPhone,
    });
  } catch (err) {
    console.error('[STARTUP] Hata:', err && (err.stack || err.message || err));
  }
});

client.on('auth_failure', (msg) => {
  console.error('[HATA] Kimlik dogrulama basarisiz:', msg);
});

client.on('disconnected', (reason) => {
  console.log('[BOT] Baglanti koptu:', reason);
});

async function processPrivateMessage(msg) {
  // Grup / status yok
  if (msg.from?.endsWith('@g.us') || msg.from?.endsWith('@broadcast')) {
    if (config.debug) console.log('[DEBUG] Grup/status yok sayildi');
    return;
  }

  const body = msg.body?.trim();
  // fromMe: sohbet karsi tarafta (to), gelen: from
  const chatId = msg.fromMe ? msg.to || msg.from : msg.from;
  if (!chatId || chatId.endsWith('@g.us')) return;

  // LID / telefon coz
  let resolvedPhone = await resolveIdToPhone(client, chatId);
  if (!resolvedPhone && !msg.fromMe) {
    resolvedPhone = await resolveChatPhone(msg);
  }

  // Env LID eslesmesi
  const lidUser = String(chatId).split('@')[0];
  const envLid = (config.targetPersonLid || '').replace(/@lid$/i, '');
  const lidMatch =
    envLid && (lidUser === envLid || String(chatId) === config.targetPersonLid);

  const isTarget =
    lidMatch ||
    phonesMatch(resolvedPhone, config.targetPersonNumber) ||
    phonesMatch(lidUser, config.targetPersonNumber);

  if (!isTarget) {
    if (config.debug) {
      console.log(
        `[DEBUG] Hedef degil, atlandi: ${resolvedPhone || chatId}`,
      );
    }
    return;
  }

  if (body) {
    const sender = await getSenderLabel(msg);
    historyStore.addMessage(chatId, {
      sender,
      body,
      fromMe: msg.fromMe,
      authorPhone: msg.fromMe ? null : resolvedPhone || config.targetPersonNumber,
      timestamp: Date.now(),
    });
  }

  if (msg.fromMe) {
    if (body && engine) engine.onBotSentMessage(chatId);
    return;
  }

  if (!body) return;
  if (!engine) return;

  await engine.onIncomingMessage(
    msg,
    body,
    chatId,
    resolvedPhone || config.targetPersonNumber,
  );
}

client.on('message_create', async (msg) => {
  try {
    await processPrivateMessage(msg);
  } catch (error) {
    console.error('[HATA]', error.message);
  }
});

if (!config.targetPersonNumber && !config.targetPersonLid) {
  console.error('[HATA] TARGET_PERSON_NUMBER veya TARGET_PERSON_LID .env icinde tanimli olmali.');
  process.exit(1);
}

console.log('[BOT] Baslatiliyor (1-1 mod)...');
console.log(`[BOT] Hedef: ${config.targetPersonName} / ${config.targetPersonNumber}`);
client.initialize();
