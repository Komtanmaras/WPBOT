/**
 * Acilista hedef kisiyle 1-1 sohbet gecmisini yukler.
 * STARTUP_MODE: idle | sync | reply_last
 */

const historyStore = require('./historyStore');
const { normalizePhone } = require('./personas');

const MODES = ['idle', 'sync', 'reply_last'];

function parseStartupMode() {
  const argIdx = process.argv.indexOf('--startup');
  if (argIdx >= 0 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1].toLowerCase().trim();
  }
  return (process.env.STARTUP_MODE || 'idle').toLowerCase().trim();
}

function isValidMode(mode) {
  return MODES.includes(mode);
}

function messageTimestampMs(msg) {
  const t = msg.timestamp;
  if (!t) return Date.now();
  return t < 1e12 ? t * 1000 : t;
}

function phoneSuffix(value) {
  const n = normalizePhone(value);
  return n.length >= 10 ? n.slice(-10) : n;
}

function phonesMatch(a, b) {
  const sa = phoneSuffix(a);
  const sb = phoneSuffix(b);
  if (!sa || !sb) return false;
  return sa === sb || sa.endsWith(sb) || sb.endsWith(sa);
}

/** Hedef isim: tam ad veya ilk+son kelime (orn. Hasan ... Koç). */
function nameMatchesTarget(name, targetPersonName) {
  if (!name || !targetPersonName) return false;
  const n = name.toLocaleLowerCase('tr-TR').trim();
  const t = targetPersonName.toLocaleLowerCase('tr-TR').trim();
  if (n === t || n.includes(t)) return true;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return n.includes(parts[0]) && n.includes(parts[parts.length - 1]);
  }
  return n.includes(parts[0]);
}

async function resolveIdToPhone(client, chatId) {
  if (!chatId) return null;
  const id = String(chatId);
  const user = id.split('@')[0];

  if (id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net')) {
    return normalizePhone(user);
  }

  // @lid veya uzun LID user
  try {
    const lidId = id.includes('@') ? id : `${user}@lid`;
    const results = await client.getContactLidAndPhone([lidId]);
    const pn = results?.[0]?.pn;
    if (pn) return normalizePhone(String(pn).split('@')[0]);
  } catch {
    // devam
  }

  try {
    const contact = await client.getContactById(id.includes('@') ? id : `${user}@c.us`);
    if (contact?.number) return normalizePhone(contact.number);
  } catch {
    // devam
  }

  return normalizePhone(user);
}

/**
 * Tum ozel sohbetleri LID / telefon / isim olarak yazar.
 */
async function listDmChats(client, config = {}) {
  const util = require('util');
  let chats = [];
  try {
    chats = await client.getChats();
  } catch (err) {
    console.log('[LISTE] getChats basarisiz, getContacts deneniyor...', util.inspect(err));
    try {
      const contacts = await client.getContacts();
      console.log(`[LISTE] ${contacts.length} contact (chat degil):`);
      const lines = [];
      for (const c of contacts) {
        const id = c.id?._serialized || '';
        if (id.endsWith('@g.us') || id.endsWith('@broadcast') || id.endsWith('@newsletter')) continue;
        const phone = c.number ? normalizePhone(c.number) : '';
        const name = c.pushname || c.name || '-';
        const match =
          phonesMatch(phone, config.targetPersonNumber) ||
          nameMatchesTarget(name, config.targetPersonName);
        const line = `  ${match ? '>>>' : '   '} ${name} | tel: ${phone || '-'} | id: ${id}`;
        lines.push(line);
        if (match) console.log(line);
      }
      // hepsini dosyaya yaz, eslesenleri konsola da bas
      const matched = lines.filter((l) => l.includes('>>>'));
      console.log(`[LISTE] Eslesen: ${matched.length}`);
      matched.forEach((l) => console.log(l));
      console.log(`[LISTE] Toplam satir: ${lines.length} (data/dm-list.txt)`);
      const fs = require('fs');
      const path = require('path');
      const out = path.join(__dirname, 'data', 'dm-list.txt');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, lines.join('\n'), 'utf8');
      console.log(`[LISTE] Dosyaya yazildi: ${out}`);
      return [];
    } catch (err2) {
      console.log('[LISTE] getContacts de basarisiz:', util.inspect(err2));
      throw err;
    }
  }

  const dms = chats.filter((c) => !c.isGroup);
  const lines = [];
  lines.push(`[LISTE] ${dms.length} ozel sohbet:`);
  console.log(`\n[LISTE] ${dms.length} ozel sohbet:`);

  const rows = [];
  for (const chat of dms) {
    let id = '?';
    let phone = '';
    let name = '';
    let match = false;
    try {
      id = chat.id?._serialized || String(chat.id);
      name = chat.name || '';
      try {
        const contact = await chat.getContact();
        name = contact.pushname || contact.name || name || '';
        if (contact?.number) phone = normalizePhone(contact.number);
      } catch {
        // isim yok
      }
      if (!phone) {
        try {
          phone = (await resolveIdToPhone(client, id)) || '';
        } catch {
          phone = '';
        }
      }
      match = phonesMatch(phone, config.targetPersonNumber);
      if (!match && name && config.targetPersonName) {
        match = nameMatchesTarget(name, config.targetPersonName);
      }
    } catch (err) {
      lines.push(`  ! hata: ${err && err.message}`);
      continue;
    }

    const mark = match ? '>>>' : '   ';
    const line = `  ${mark} ${name || '-'} | tel: ${phone || '-'} | id: ${id}`;
    lines.push(line);
    console.log(line);
    rows.push({ id, phone, name, match });
  }

  lines.push('[LISTE] Bitti. Hedef >>> ile isaretli olmali.');
  console.log('[LISTE] Bitti. Hedef >>> ile isaretli olmali.\n');

  try {
    const fs = require('fs');
    const path = require('path');
    const out = path.join(__dirname, 'data', 'dm-list.txt');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, lines.join('\n'), 'utf8');
    console.log(`[LISTE] Dosyaya yazildi: ${out}`);
  } catch (err) {
    console.log('[LISTE] Dosya yazilamadi:', err && err.message);
  }

  return rows;
}

async function findTargetDmChat(client, config) {
  const target = config.targetPersonNumber;
  if (!target) return null;

  if (config.targetPersonLid) {
    const lid = config.targetPersonLid.includes('@')
      ? config.targetPersonLid
      : `${config.targetPersonLid}@lid`;
    try {
      const chat = await client.getChatById(lid);
      if (chat && !chat.isGroup) {
        console.log(`[STARTUP] TARGET_PERSON_LID ile bulundu: ${lid}`);
        return chat;
      }
    } catch (err) {
      console.log(`[STARTUP] TARGET_PERSON_LID acilamadi: ${lid} (${err && err.message})`);
    }
  }

  // Once dogrudan telefon ID ile dene (getChats bozulsa bile calisabilir)
  for (const id of [`${normalizePhone(target)}@c.us`, `${phoneSuffix(target)}@c.us`]) {
    try {
      const chat = await client.getChatById(id);
      if (chat && !chat.isGroup) {
        console.log(`[STARTUP] getChatById ile bulundu: ${id}`);
        return chat;
      }
    } catch (err) {
      console.log(`[STARTUP] getChatById denendi ${id}: ${err && err.message}`);
    }
  }

  let chats;
  try {
    chats = await client.getChats();
  } catch (err) {
    console.log('[STARTUP] getChats hata:', err && err.message);
    return null;
  }

  const dms = chats.filter((c) => !c.isGroup);
  const targetName = (config.targetPersonName || '').toLocaleLowerCase('tr-TR');

  for (const chat of dms) {
    try {
      const id = chat.id?._serialized || String(chat.id);
      const user = id.split('@')[0];
      if (phonesMatch(user, target)) return chat;

      const phone = await resolveIdToPhone(client, id);
      if (phonesMatch(phone, target)) return chat;

      const chatName = (chat.name || '').toLocaleLowerCase('tr-TR');
      if (targetName && chatName && nameMatchesTarget(chat.name, config.targetPersonName)) {
        console.log(`[STARTUP] Isimle eslesti: "${chat.name}" (${id})`);
        return chat;
      }
    } catch {
      // bu chat'i atla
    }
  }

  return null;
}

async function runStartup(ctx) {
  const { client, config, engine, getSenderLabel, resolveChatPhone } = ctx;

  const mode = parseStartupMode();
  if (!isValidMode(mode)) {
    console.log(`[STARTUP] Gecersiz mod: ${mode}. Kullan: ${MODES.join(', ')}`);
    return;
  }

  // Her zaman listele (kontrol icin)
  try {
    await listDmChats(client, config);
  } catch (err) {
    console.log('[LISTE] Alinamadi:', err && (err.stack || err.message || String(err)));
  }

  if (mode === 'idle') {
    console.log('[STARTUP] Mod: idle (sadece yeni mesajlar)');
    return;
  }

  console.log(`[STARTUP] Mod: ${mode} (1-1: ${config.targetPersonName || config.targetPersonNumber})`);

  const chat = await findTargetDmChat(client, config);
  if (!chat) {
    console.log(
      '[STARTUP] Hedef kisiyle sohbet bulunamadi. Yukaridaki [LISTE] veya data/dm-list.txt dosyasindan hedef id sini TARGET_PERSON_LID olarak .env ye yaz.',
    );
    return;
  }

  const chatId = chat.id?._serialized || chat.id;
  const limit =
    parseInt(process.env.STARTUP_FETCH_LIMIT, 10) ||
    parseInt(process.env.HISTORY_SIZE, 10) ||
    50;

  console.log(`[STARTUP] "${chat.name || chatId}" — son ${limit} mesaj okunuyor...`);

  let messages;
  try {
    messages = await chat.fetchMessages({ limit });
  } catch (err) {
    console.log('[STARTUP] Mesajlar alinamadi:', err.message);
    return;
  }

  messages.sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b));

  const entries = [];
  for (const msg of messages) {
    const body = msg.body?.trim();
    if (!body) continue;

    const sender = await getSenderLabel(msg);
    const authorPhone = msg.fromMe
      ? null
      : (await resolveChatPhone(msg)) || config.targetPersonNumber;

    entries.push({
      sender,
      body,
      fromMe: msg.fromMe,
      authorPhone,
      timestamp: messageTimestampMs(msg),
    });
  }

  historyStore.setGroupHistory(chatId, entries);
  console.log(`[STARTUP] Gecmise ${entries.length} mesaj yazildi (eski muhabbet dahil).`);

  const lastFive = entries.slice(-5);
  console.log(`[STARTUP] Son ${lastFive.length} mesaj (iki taraf):`);
  for (const e of lastFive) {
    const who = e.fromMe ? config.userName || 'Ben' : e.sender || config.targetPersonName || 'O';
    const side = e.fromMe ? '>>' : '<<';
    const preview = String(e.body || '').replace(/\s+/g, ' ').slice(0, 120);
    console.log(`  ${side} ${who}: ${preview}`);
  }

  const lastFromMe = [...entries].reverse().find((e) => e.fromMe);
  if (lastFromMe && engine.setLastBotReplyAt) {
    engine.setLastBotReplyAt(chatId, lastFromMe.timestamp);
  }

  if (mode === 'sync') {
    console.log('[STARTUP] sync tamam — yeni mesajlar dinleniyor.');
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
      console.log(
        `[STARTUP] Son mesaj ${Math.round(age / 1000)} sn once — cok eski (limit ${maxAge / 1000} sn), cevap yok.`,
      );
      return;
    }

    console.log(
      `[STARTUP] Son mesaja cevap kuyrugu: "${body.slice(0, 60)}${body.length > 60 ? '...' : ''}"`,
    );
    const authorPhone =
      (await resolveChatPhone(msg)) || config.targetPersonNumber;
    await engine.onIncomingMessage(msg, body, chatId, authorPhone);
    return;
  }

  console.log('[STARTUP] Cevap verilecek gelen mesaj yok.');
}

module.exports = {
  runStartup,
  parseStartupMode,
  MODES,
  findTargetDmChat,
  phonesMatch,
  nameMatchesTarget,
  resolveIdToPhone,
  listDmChats,
};
