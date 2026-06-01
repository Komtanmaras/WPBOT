/**
 * AI cevabini hafifce dogallastirir (deterministik).
 */

const SUFFIXES = [' ya', ' işte', ' yani'];

function humanizeReply(text) {
  if (!text || typeof text !== 'string') return text;

  let out = text.trim();

  out = out.replace(/^["'""]+|["'""]+$/g, '').trim();
  out = out.replace(/\s+/g, ' ');

  if (out.length > 3 && out === out.toUpperCase() && /[A-ZÇĞİÖŞÜ]/.test(out)) {
    out = out.charAt(0) + out.slice(1).toLocaleLowerCase('tr-TR');
  }

  if (Math.random() < 0.15 && out.length < 80 && !out.endsWith(' ya') && !out.endsWith(' işte')) {
    const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
    if (!out.toLowerCase().endsWith(suffix.trim())) {
      out += suffix;
    }
  }

  return out.trim();
}

function clampLength(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars).trim();
}

module.exports = { humanizeReply, clampLength };
