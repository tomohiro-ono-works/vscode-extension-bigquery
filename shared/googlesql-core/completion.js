'use strict';

const fs = require('node:fs');
const path = require('node:path');
const snippetsData = require('./dictionaries/snippets.json');

// Each dictionary is loaded once per extension host, never per keystroke.
function readWords(filename) {
  const file = path.join(__dirname, 'dictionaries', filename);
  const names = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map(x => x.trim()).filter(x => x && !x.startsWith('#'));
  if (names.some(x => !/^[A-Z_][A-Z0-9_.]*$/.test(x)) || new Set(names).size !== names.length)
    throw new Error('Invalid or duplicate GoogleSQL dictionary entries: ' + filename);
  return Object.freeze(names.slice().sort());
}

const catalog = Object.freeze({
  keywords: readWords('keywords.txt'),
  functions: readWords('functions.txt')
});
const phraseOnly = new Set(['CREATE','ORDER','GROUP','ON','PARTITION','CLUSTER']);
const snippets = Object.freeze(snippetsData.map(x => Object.freeze({label:x.label,insertText:x.insertText})));
function getCatalog() {
  return catalog;
}

/** Return candidate matches in precedence order. VSCode still owns the popup and word suggestions. */
function findCompletions(input) {
  const word = String(input ?? '').toUpperCase();
  if (!word) return [];
  const allowFunctions = word.length >= 2;
  const allowSubstring = word.length >= 3;
  const all = [
    ...catalog.keywords.filter((label) => !phraseOnly.has(label) && label !== 'JOIN')
      .map((label) => ({label,kind:'keyword'})),
    ...snippets.map((entry) => ({...entry,kind:'snippet'})),
    ...(allowFunctions ? catalog.functions.map((label) => ({label,kind:'function'})) : [])
  ];
  const candidates = new Map();
  for (const entry of all) {
    const matchKind = entry.label.startsWith(word) ? 'prefix'
      : allowSubstring && entry.label.includes(word) ? 'substring' : null;
    if (!matchKind) continue;
    // Some grammar terms are both SQL keywords and callable functions; prefer the callable form.
    const existing = candidates.get(entry.label);
    if (!existing || entry.kind === 'function') candidates.set(entry.label,{...entry,matchKind});
  }
  return [...candidates.values()].sort((a,b) =>
    Number(a.matchKind !== 'prefix') - Number(b.matchKind !== 'prefix')
      || a.label.localeCompare(b.label,'en'));
}

module.exports = {getCatalog,findCompletions};
