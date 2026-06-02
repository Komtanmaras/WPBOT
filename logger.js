/**
 * Production'da da gorunen operasyonel loglar + DEBUG ile detay.
 */

const debugEnabled = process.env.DEBUG === 'true';

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function info(...args) {
  console.log(`[${timestamp()}]`, ...args);
}

function warn(...args) {
  console.warn(`[${timestamp()}]`, ...args);
}

function error(...args) {
  console.error(`[${timestamp()}]`, ...args);
}

function debug(...args) {
  if (debugEnabled) {
    console.log(`[${timestamp()}] [DEBUG]`, ...args);
  }
}

module.exports = { info, warn, error, debug, isDebug: () => debugEnabled };
