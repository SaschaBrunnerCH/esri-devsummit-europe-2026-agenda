import { readFile } from 'node:fs/promises';

export const keywordRules = JSON.parse(await readFile(new URL('../../data/keyword-rules.json', import.meta.url), 'utf8'));
const clean = value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const key = value => clean(value).toLowerCase();
const isDelimiter = char => /[,;\n\r·]/u.test(char);

// Delimiters inside quoted phrases or parentheses belong to the phrase.
// Slashes, hyphens, ampersands, and ordinary spaces are never delimiters.
export function splitKeywords(value, rules = keywordRules) {
  if (!value?.trim()) return [];
  const override = rules.exactOverrides.find(entry => entry.text === value.trim());
  if (override) return [...override.tokens];
  const result = [];
  let token = '', depth = 0, quoted = false;
  const flush = () => {
    if (token.trim()) {
      const override = rules.exactOverrides.find(entry => entry.text === token.trim());
      result.push(...(override?.tokens ?? [clean(token)]));
    }
    token = '';
  };
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"') {
      if (quoted && value[index + 1] === '"') { token += '"'; index++; }
      else if (quoted || !token.trim()) quoted = !quoted;
      else token += char;
    } else if (quoted) token += char;
    else if (char === '(') { depth++; token += char; }
    else if (char === ')') {
      if (!depth) throw new Error('Unbalanced keyword parentheses; add a reviewed parsing override.');
      depth--; token += char;
    } else if (isDelimiter(char) && !depth) flush();
    else token += char;
  }
  if (quoted || depth) throw new Error('Unbalanced keyword quoting/parentheses; add a reviewed parsing override.');
  flush();
  return result;
}

export function buildKeywordCatalog(sessions, rules = keywordRules) {
  const aliases = new Map();
  for (const term of rules.terms) {
    for (const value of [term.label, ...term.aliases]) {
      if (aliases.has(key(value)) && key(aliases.get(key(value)).label) !== key(term.label)) throw new Error(`Conflicting configured keyword alias: ${value}`);
      aliases.set(key(value), term);
    }
  }
  const entries = new Map();
  const sessionKeys = new Map();
  const diagnostics = [];
  for (const session of sessions) {
    const keys = new Set();
    for (const attribute of session.attributevalues ?? []) {
      if (attribute.attribute_id !== 'Keywords') continue;
      const tokens = splitKeywords(attribute.value, rules);
      const hasOverride = rules.exactOverrides.some(entry => entry.text === attribute.value.trim());
      if (tokens.length === 1 && /\s/.test(attribute.value.trim()) && !/[,;\n\r·]/u.test(attribute.value)
        && !hasOverride && !aliases.has(key(tokens[0]))) {
        diagnostics.push({ sessionId: session.sessionID, text: attribute.value,
          reason: 'Undelimited phrase preserved as one keyword; inspect before splitting it into multiple terms.' });
      }
      for (const token of tokens) {
        const normalized = key(token);
        const configured = aliases.get(normalized);
        const label = configured?.label ?? clean(token);
        const identity = configured ? key(configured.label) : normalized;
        if (!entries.has(identity)) entries.set(identity, { label, aliases: new Set(configured?.aliases ?? []), sessionIds: new Set() });
        const entry = entries.get(identity);
        if (!configured && clean(token).localeCompare(entry.label, 'en') < 0) entry.label = clean(token);
        entry.aliases.add(clean(token));
        entry.sessionIds.add(session.sessionID);
        keys.add(identity);
      }
    }
    sessionKeys.set(session.sessionID, keys);
  }
  const catalog = [...entries.values()].map(entry => ({
    label: entry.label, aliases: [...entry.aliases].filter(alias => alias !== entry.label).sort(), sessionCount: entry.sessionIds.size,
  })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
  const sessionKeywords = new Map([...sessionKeys].map(([sessionId, keys]) =>
    [sessionId, [...keys].map(identity => entries.get(identity).label).sort()]));
  return { catalog, sessionKeywords, diagnostics };
}
