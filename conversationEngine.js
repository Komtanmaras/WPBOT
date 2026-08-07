const historyStore = require('./historyStore');
const { getReplySystemPrompt } = require('./prompts');
const { humanizeReply, clampLength } = require('./humanize');
const { getPersonaReplyBlock } = require('./personas');

const TIMING = {
  normalMin: parseInt(process.env.MIN_DELAY_MS, 10) || 15000,
  normalMax: parseInt(process.env.MAX_DELAY_MS, 10) || 120000,
  fastMin: parseInt(process.env.MIN_FAST_DELAY_MS, 10) || 10000,
  fastMax: parseInt(process.env.MAX_FAST_DELAY_MS, 10) || 60000,
  fastWindow: parseInt(process.env.FAST_REPLY_WINDOW_MS, 10) || 120000,
  debounceMs: parseInt(process.env.MESSAGE_DEBOUNCE_MS, 10) || 3500,
  replyContextSize: parseInt(process.env.REPLY_CONTEXT_SIZE, 10) || 30,
  replyMaxChars: parseInt(process.env.REPLY_MAX_CHARS, 10) || 280,
};

const queues = new Map();

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getQueue(chatId) {
  if (!queues.has(chatId)) {
    queues.set(chatId, {
      generation: 0,
      timer: null,
      debounceTimer: null,
      pendingMsg: null,
      pendingBody: null,
      pendingAuthorPhone: null,
      lastBotReplyAt: 0,
      processing: false,
    });
  }
  return queues.get(chatId);
}

/**
 * 1-1 mod: hedef kisiden gelen her mesaja cevap.
 */
function createEngine({ config, ai, client, helpers }) {
  const { debug } = helpers;

  const callName =
    (config.targetPersonName || '').trim().split(/\s+/)[0] || 'arkadasin';
  const replySystemPrompt = getReplySystemPrompt(
    config.userName,
    config.personalityNotes,
    callName,
  );

  function pickDelay(triggerType) {
    if (triggerType === 'fast') {
      return randomBetween(TIMING.fastMin, TIMING.fastMax);
    }
    return randomBetween(TIMING.normalMin, TIMING.normalMax);
  }

  function applyFastTimingIfNeeded(chatId, trigger) {
    const queue = getQueue(chatId);
    const inFastWindow =
      queue.lastBotReplyAt > 0 && Date.now() - queue.lastBotReplyAt < TIMING.fastWindow;

    if (!inFastWindow) return trigger;

    return {
      type: 'fast',
      reason: `yazdiktan sonra 2dk icinde (${trigger.reason})`,
    };
  }

  function invalidatePending(chatId) {
    const queue = getQueue(chatId);
    if (queue.timer) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }
    queue.generation++;
  }

  async function generateAndSend(chatId, generation) {
    const queue = getQueue(chatId);

    if (generation !== queue.generation) {
      if (debug) console.log('[DEBUG] Gecersiz nesil, gonderilmiyor');
      return;
    }

    if (queue.processing) return;
    queue.processing = true;

    try {
      const history = historyStore.getHistory(chatId);
      const contextText = historyStore.formatForPrompt(
        historyStore.getLastMessages(chatId, TIMING.replyContextSize),
      );
      const latestInHistory = history[history.length - 1];
      const replyToBody =
        latestInHistory && !latestInHistory.fromMe
          ? latestInHistory.body
          : queue.pendingBody;

      const authorPhone =
        (latestInHistory && !latestInHistory.fromMe && latestInHistory.authorPhone) ||
        queue.pendingAuthorPhone ||
        config.targetPersonNumber;
      const personaBlock = getPersonaReplyBlock(authorPhone);

      if (generation !== queue.generation) return;

      if (debug && personaBlock) {
        console.log('[DEBUG] Kisi profili prompta eklendi');
      }

      let replyText = await ai.reply([
        { role: 'system', content: replySystemPrompt },
        {
          role: 'user',
          content: `Sohbet gecmisi (eski + yeni):\n${contextText || '(yok)'}\n\nEn son mesaj (buna gore cevap ver):\n${replyToBody}${personaBlock}`,
        },
      ]);

      if (generation !== queue.generation) {
        if (debug) console.log('[DEBUG] API sonrasi yeni mesaj geldi, iptal');
        return;
      }

      if (!replyText) {
        console.log('[!] Bos cevap.');
        return;
      }

      replyText = humanizeReply(replyText);
      replyText = clampLength(replyText, TIMING.replyMaxChars);

      console.log(`[<] ${replyText}`);
      await client.sendMessage(chatId, replyText);

      historyStore.addMessage(chatId, {
        sender: config.userName,
        body: replyText,
        fromMe: true,
        timestamp: Date.now(),
      });

      queue.lastBotReplyAt = Date.now();
      console.log('[+] Gonderildi.\n');
    } finally {
      queue.processing = false;
    }
  }

  async function scheduleReply(chatId, body, trigger) {
    const queue = getQueue(chatId);
    const generation = queue.generation;
    const delayMs = pickDelay(trigger.type);

    console.log(`\n[+] Cevap planlandi (${trigger.type}: ${trigger.reason})`);
    console.log(`[+] Mesaj: ${body}`);
    console.log(`[*] ${(delayMs / 1000).toFixed(1)} sn sonra gonderilecek...`);

    queue.timer = setTimeout(() => {
      queue.timer = null;
      generateAndSend(chatId, generation).catch((err) => {
        console.error('[HATA] Gonderim:', err.message);
      });
    }, delayMs);
  }

  async function processAfterDebounce(chatId) {
    const queue = getQueue(chatId);
    const body = queue.pendingBody;

    if (!body) return;

    invalidatePending(chatId);

    let trigger = { type: 'mandatory', reason: '1-1 her mesaj' };
    trigger = applyFastTimingIfNeeded(chatId, trigger);

    if (debug) {
      console.log(`[DEBUG] Tetik: ${trigger.type} (${trigger.reason}) | ${body}`);
    }

    await scheduleReply(chatId, body, trigger);
  }

  function onIncomingMessage(msg, body, chatId, authorPhone = null) {
    const queue = getQueue(chatId);
    queue.pendingMsg = msg;
    queue.pendingBody = body;
    queue.pendingAuthorPhone = authorPhone;

    if (queue.debounceTimer) {
      clearTimeout(queue.debounceTimer);
    }

    queue.debounceTimer = setTimeout(() => {
      queue.debounceTimer = null;
      processAfterDebounce(chatId).catch((err) => {
        console.error('[HATA] Islem:', err.message);
      });
    }, TIMING.debounceMs);
  }

  function onBotSentMessage(chatId) {
    const queue = getQueue(chatId);
    queue.lastBotReplyAt = Date.now();
  }

  function setLastBotReplyAt(chatId, timeMs) {
    const queue = getQueue(chatId);
    queue.lastBotReplyAt = timeMs || Date.now();
  }

  return { onIncomingMessage, onBotSentMessage, setLastBotReplyAt };
}

module.exports = { createEngine, TIMING };
