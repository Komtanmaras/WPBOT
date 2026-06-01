const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'data', 'group-history.json');
let maxMessages = parseInt(process.env.HISTORY_SIZE, 10) || 15;

function setMaxMessages(n) {
  maxMessages = n;
}

function load() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch {
    // sifirdan basla
  }
  return {};
}

function save(data) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function addMessage(groupId, entry) {
  const data = load();
  if (!data[groupId]) data[groupId] = [];
  data[groupId].push(entry);
  if (data[groupId].length > maxMessages) {
    data[groupId] = data[groupId].slice(-maxMessages);
  }
  save(data);
  return data[groupId];
}

function getHistory(groupId) {
  return load()[groupId] || [];
}

function getLastMessages(groupId, count = 10) {
  const history = getHistory(groupId);
  return history.slice(-count);
}

function formatForPrompt(history) {
  return history.map((m) => `${m.sender}: ${m.body}`).join('\n');
}

function countMessagesSinceBot(groupId) {
  const history = getHistory(groupId);
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].fromMe) break;
    count++;
  }
  return count;
}

module.exports = {
  addMessage,
  getHistory,
  getLastMessages,
  formatForPrompt,
  countMessagesSinceBot,
  setMaxMessages,
};
