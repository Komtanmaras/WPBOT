/**
 * DeepSeek API sarmalayicisi: token ayarlari, thinking kapali, cache metrikleri.
 */

function extractAssistantText(message) {
  if (!message) return '';
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (content) return content;
  return '';
}

function createAiClient(openaiClient, options = {}) {
  const {
    model,
    nonThinkingModel = 'deepseek-chat',
    debug = false,
    decisionMaxTokens = 64,
    replyMaxTokens = 1024,
    decisionTemperature = 0.35,
    replyTemperature = 0.9,
  } = options;

  function logCacheUsage(usage, label) {
    if (!debug || !usage) return;
    const hit = usage.prompt_cache_hit_tokens ?? 0;
    const miss = usage.prompt_cache_miss_tokens ?? 0;
    if (hit > 0 || miss > 0) {
      console.log(`[CACHE] ${label}: hit=${hit} miss=${miss}`);
    }
  }

  function buildRequestBody({ messages, maxTokens, temperature, useModel }) {
    return {
      model: useModel,
      messages,
      max_tokens: maxTokens,
      temperature,
      extra_body: {
        thinking: { type: 'disabled' },
      },
    };
  }

  async function callApi(body, label) {
    const completion = await openaiClient.chat.completions.create(body);
    logCacheUsage(completion.usage, label);

    const message = completion.choices[0]?.message;
    const text = extractAssistantText(message);
    const reasoningTokens =
      completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

    return { completion, text, reasoningTokens, message };
  }

  async function complete({ messages, maxTokens, temperature, label = 'api' }) {
    let result = await callApi(
      buildRequestBody({ messages, maxTokens, temperature, useModel: model }),
      label,
    );

    if (!result.text && result.reasoningTokens > 0) {
      if (debug) {
        console.log(
          `[WARN] ${label}: thinking tokenlari cevabi yedi (${result.reasoningTokens}), deepseek-chat ile tekrar deneniyor...`,
        );
      }
      result = await callApi(
        buildRequestBody({
          messages,
          maxTokens,
          temperature,
          useModel: nonThinkingModel,
        }),
        `${label}-retry`,
      );
    }

    if (!result.text && debug) {
      console.log(`[WARN] ${label}: hala bos cevap (model: ${model})`);
    }

    return result.text;
  }

  async function decide(messages) {
    return complete({
      messages,
      maxTokens: decisionMaxTokens,
      temperature: decisionTemperature,
      label: 'karar',
    });
  }

  async function reply(messages) {
    return complete({
      messages,
      maxTokens: replyMaxTokens,
      temperature: replyTemperature,
      label: 'cevap',
    });
  }

  return { decide, reply, complete };
}

function loadAiOptionsFromEnv(config) {
  return {
    model: config.deepSeekModel,
    nonThinkingModel: process.env.DEEPSEEK_NON_THINKING_MODEL || 'deepseek-chat',
    debug: config.debug,
    decisionMaxTokens: parseInt(process.env.DECISION_MAX_TOKENS, 10) || 64,
    replyMaxTokens: parseInt(process.env.REPLY_MAX_TOKENS, 10) || 1024,
    decisionTemperature: parseFloat(process.env.DECISION_TEMPERATURE) || 0.35,
    replyTemperature: parseFloat(process.env.REPLY_TEMPERATURE) || 0.9,
  };
}

module.exports = { createAiClient, loadAiOptionsFromEnv };
