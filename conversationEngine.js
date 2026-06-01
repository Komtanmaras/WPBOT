const historyStore = require('./historyStore');
const { getDecisionSystemPrompt, getReplySystemPrompt } = require('./prompts');
const { humanizeReply, clampLength } = require('./humanize');
const { getPersonaReplyBlock } = require('./personas');

const TIMING = {
  normalMin: parseInt(process.env.MIN_DELAY_MS, 10) || 15000,
  normalMax: parseInt(process.env.MAX_DELAY_MS, 10) || 60000,
  fastMin: parseInt(process.env.MIN_FAST_DELAY_MS, 10) || 10000,
  fastMax: parseInt(process.env.MAX_FAST_DELAY_MS, 10) || 60000,
  fastWindow: parseInt(process.env.FAST_REPLY_WINDOW_MS, 10) || 120000,
  minGapAfterBot: parseInt(process.env.MIN_MESSAGES_BEFORE_OPTIONAL, 10) || 1,
  debounceMs: parseInt(process.env.MESSAGE_DEBOUNCE_MS, 10) || 3500,
  decisionContextSize: parseInt(process.env.DECISION_CONTEXT_SIZE, 10) || 10,
  replyContextSize: parseInt(process.env.REPLY_CONTEXT_SIZE, 10) || 15,
  replyMaxChars: parseInt(process.env.REPLY_MAX_CHARS, 10) || 280,
};

const groupQueues = new Map();

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getQueue(groupId) {
  if (!groupQueues.has(groupId)) {
    groupQueues.set(groupId, {
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
  return groupQueues.get(groupId);
}

function parseJoinDecision(content) {
  if (!content) return true;
  const upper = content.toUpperCase();
  if (upper.includes('HAYIR') && !upper.includes('EVET')) return false;
  if (upper.includes('EVET')) return true;
  return true;
}

function createEngine({ config, ai, client, helpers }) {
  const {
    isCalledByName,
    isTagged,
    isReplyToMe,
    isFollowUpDirectedAtMe,
    isGroupSocialOpener,
    debug,
  } = helpers;

  const decisionSystemPrompt = getDecisionSystemPrompt(
    config.userName,
    TIMING.decisionContextSize,
  );
  const replySystemPrompt = getReplySystemPrompt(
    config.userName,
    config.personalityNotes,
  );

  async function shouldJoinConversation(groupId, latestBody) {
    const contextMessages = historyStore.getLastMessages(
      groupId,
      TIMING.decisionContextSize,
    );
    const historyText = historyStore.formatForPrompt(contextMessages);

    const socialHint = isGroupSocialOpener(latestBody)
      ? '\n\n[İPUCU: Bu mesaj grup selamı/sohbet açıcısı gibi — katılmak doğal, eğilimin EVET olsun.]'
      : '';

    const messagesSinceBot = historyStore.countMessagesSinceBot(groupId);
    const recentBotHint =
      messagesSinceBot < 2
        ? '\n[İPUCU: Az önce sen yazmadın veya uzun süredir suskun değilsin — katılabilirsin.]'
        : '';

    try {
      const raw = await ai.decide([
        { role: 'system', content: decisionSystemPrompt },
        {
          role: 'user',
          content: `=== SON ${TIMING.decisionContextSize} MESAJ (eskiden yeniye) ===\n${historyText || '(henüz mesaj yok)'}\n\n=== YENİ MESAJ (karar bunun için) ===\n${latestBody}${socialHint}${recentBotHint}`,
        },
      ]);

      const join = parseJoinDecision(raw);

      if (debug) {
        console.log(`[DEBUG] Katilim AI: "${raw}" → ${join ? 'EVET' : 'HAYIR'}`);
      }

      return join;
    } catch (err) {
      if (debug) console.log('[DEBUG] Katilim karari alinamadi:', err.message);
      return false;
    }
  }

  async function classifyMessage(msg, body, groupId) {
    const history = historyStore.getHistory(groupId);

    if (isCalledByName(body) || isTagged(msg)) {
      return { type: 'mandatory', reason: 'ad/etiket' };
    }

    if (isFollowUpDirectedAtMe(history)) {
      return { type: 'mandatory', reason: 'adin gectikten sonra sana yonelik soru' };
    }

    const queue = getQueue(groupId);
    const inFastWindow =
      queue.lastBotReplyAt > 0 && Date.now() - queue.lastBotReplyAt < TIMING.fastWindow;

    const sinceBot = historyStore.countMessagesSinceBot(groupId);
    if (sinceBot < TIMING.minGapAfterBot) {
      return { type: 'none', reason: `az once yazildi (${sinceBot} mesaj arasi)` };
    }

    if (isGroupSocialOpener(body) && sinceBot >= 1) {
      if (debug) console.log('[DEBUG] Grup selami — dogrudan katilim');
      return { type: 'optional', reason: 'grup selami/sohbet' };
    }

    const join = await shouldJoinConversation(groupId, body);
    if (!join) {
      return { type: 'none', reason: 'AI katilmak istemiyor' };
    }

    return { type: 'optional', reason: 'muhabbete katilim' };
  }

  function pickDelay(triggerType) {
    if (triggerType === 'fast') {
      return randomBetween(TIMING.fastMin, TIMING.fastMax);
    }
    return randomBetween(TIMING.normalMin, TIMING.normalMax);
  }

  function applyFastTimingIfNeeded(groupId, trigger) {
    if (trigger.type === 'none') return trigger;

    const queue = getQueue(groupId);
    const inFastWindow =
      queue.lastBotReplyAt > 0 && Date.now() - queue.lastBotReplyAt < TIMING.fastWindow;

    if (!inFastWindow) return trigger;

    return {
      type: 'fast',
      reason: `yazdiktan sonra 2dk icinde (${trigger.reason})`,
    };
  }

  function invalidatePending(groupId) {
    const queue = getQueue(groupId);
    if (queue.timer) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }
    queue.generation++;
  }

  async function generateAndSend(groupId, generation) {
    const queue = getQueue(groupId);

    if (generation !== queue.generation) {
      if (debug) console.log('[DEBUG] Gecersiz nesil, gonderilmiyor');
      return;
    }

    if (queue.processing) return;
    queue.processing = true;

    try {
      const history = historyStore.getHistory(groupId);
      const contextText = historyStore.formatForPrompt(
        historyStore.getLastMessages(groupId, TIMING.replyContextSize),
      );
      const latestInHistory = history[history.length - 1];
      const replyToBody =
        latestInHistory && !latestInHistory.fromMe
          ? latestInHistory.body
          : queue.pendingBody;

      const authorPhone =
        (latestInHistory && !latestInHistory.fromMe && latestInHistory.authorPhone) ||
        queue.pendingAuthorPhone;
      const personaBlock = getPersonaReplyBlock(authorPhone);

      if (generation !== queue.generation) return;

      if (debug && personaBlock) {
        console.log('[DEBUG] Kisi profili prompta eklendi');
      }

      let replyText = await ai.reply([
        { role: 'system', content: replySystemPrompt },
        {
          role: 'user',
          content: `Son grup mesajlari:\n${contextText || '(yok)'}\n\nEn son mesaj (buna gore cevap ver):\n${replyToBody}${personaBlock}`,
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
      await client.sendMessage(groupId, replyText);

      historyStore.addMessage(groupId, {
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

  async function scheduleReply(groupId, body, trigger) {
    const queue = getQueue(groupId);
    const generation = queue.generation;
    const delayMs = pickDelay(trigger.type);

    console.log(`\n[+] Cevap planlandi (${trigger.type}: ${trigger.reason})`);
    console.log(`[+] Mesaj: ${body}`);
    console.log(`[*] ${(delayMs / 1000).toFixed(1)} sn sonra gonderilecek...`);

    queue.timer = setTimeout(() => {
      queue.timer = null;
      generateAndSend(groupId, generation).catch((err) => {
        console.error('[HATA] Gonderim:', err.message);
      });
    }, delayMs);
  }

  async function processAfterDebounce(groupId) {
    const queue = getQueue(groupId);
    const msg = queue.pendingMsg;
    const body = queue.pendingBody;

    if (!body) return;

    invalidatePending(groupId);

    let trigger = await classifyMessage(msg, body, groupId);
    trigger = applyFastTimingIfNeeded(groupId, trigger);

    if (debug) {
      console.log(`[DEBUG] Tetik: ${trigger.type} (${trigger.reason}) | ${body}`);
    }

    if (trigger.type === 'none') return;

    await scheduleReply(groupId, body, trigger);
  }

  function onIncomingMessage(msg, body, groupId, authorPhone = null) {
    const queue = getQueue(groupId);
    queue.pendingMsg = msg;
    queue.pendingBody = body;
    queue.pendingAuthorPhone = authorPhone;

    if (queue.debounceTimer) {
      clearTimeout(queue.debounceTimer);
    }

    queue.debounceTimer = setTimeout(() => {
      queue.debounceTimer = null;
      processAfterDebounce(groupId).catch((err) => {
        console.error('[HATA] Islem:', err.message);
      });
    }, TIMING.debounceMs);
  }

  function onBotSentMessage(groupId) {
    const queue = getQueue(groupId);
    queue.lastBotReplyAt = Date.now();
  }

  function setLastBotReplyAt(groupId, timeMs) {
    const queue = getQueue(groupId);
    queue.lastBotReplyAt = timeMs || Date.now();
  }

  return { onIncomingMessage, onBotSentMessage, setLastBotReplyAt };
}

module.exports = { createEngine, TIMING };
