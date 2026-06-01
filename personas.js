const fs = require('fs');
const path = require('path');

const PERSONAS_FILE = path.join(__dirname, 'data', 'personas.json');

function normalizePhone(value) {
  if (!value) return '';
  let digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length >= 12) return digits;
  if (digits.startsWith('0') && digits.length === 11) return '9' + digits;
  if (digits.length === 10) return '90' + digits;
  return digits;
}

function phoneSuffix(digits) {
  const n = normalizePhone(digits);
  return n.length >= 10 ? n.slice(-10) : n;
}

function loadPersonas() {
  try {
    const raw = fs.readFileSync(PERSONAS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.personas) ? data.personas : [];
  } catch {
    return [];
  }
}

function findPersona(phone) {
  if (!phone) return null;
  const suffix = phoneSuffix(phone);
  if (!suffix) return null;

  for (const persona of loadPersonas()) {
    const phones = persona.phones || [];
    for (const p of phones) {
      if (phoneSuffix(p) === suffix) return persona;
    }
  }
  return null;
}

function getPersonaReplyBlock(phone) {
  const persona = findPersona(phone);
  if (!persona) return '';

  if (persona.mode === 'normal') {
    return `\n\n=== SON MESAJI ATAN: ${persona.name} ===\n${persona.hint}`;
  }

  return `\n\n=== SON MESAJI ATAN: ${persona.name} (arkadaşça takıl, her cevapta değil) ===\n${persona.hint}\n• Bu mesaja uygunsa ara sıra (yaklaşık her 3-4 cevapta bir) kısa bir göndermeli laf ekle; zorlama.\n• Aşağılayıcı veya kırıcı olma; grup içi şaka tonu.`;
}

function getGroupPersonasSummary() {
  const list = loadPersonas();
  if (!list.length) return '';
  return list.map((p) => `- ${p.name}: ${p.mode === 'normal' ? 'normal muhabbet' : 'ara sıra şaka'}`).join('\n');
}

module.exports = {
  normalizePhone,
  findPersona,
  getPersonaReplyBlock,
  getGroupPersonasSummary,
  loadPersonas,
};
