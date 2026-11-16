'use strict';

const fs = require('node:fs');
const path = require('node:path');
const BUNDLED_DIRECTORY = path.join(__dirname,'dictionaries');
const DICTIONARY_FILES = Object.freeze(['keywords.txt','functions.txt','snippets.json']);
const phraseOnly = new Set(['CREATE','ORDER','GROUP','ON','PARTITION','CLUSTER']);

function readWords(directory,filename) {
  const names=fs.readFileSync(path.join(directory,filename),'utf8')
    .split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
  if(names.some(x=>!/^[A-Z_][A-Z0-9_.]*$/.test(x))||new Set(names).size!==names.length)
    throw new Error('Invalid or duplicate GoogleSQL dictionary entries: '+filename);
  return Object.freeze(names.slice().sort());
}
function loadSnapshot(directory) {
  const keywords=readWords(directory,'keywords.txt');
  const functions=readWords(directory,'functions.txt');
  const parsed=JSON.parse(fs.readFileSync(path.join(directory,'snippets.json'),'utf8'));
  if(!Array.isArray(parsed)||parsed.some(x=>!x||typeof x.label!=='string'||!x.label.trim()
    ||typeof x.insertText!=='string')||new Set(parsed.map(x=>x.label)).size!==parsed.length)
    throw new Error('Invalid GoogleSQL snippet dictionary');
  return {catalog:Object.freeze({keywords,functions}),
    snippets:Object.freeze(parsed.map(x=>Object.freeze({label:x.label,insertText:x.insertText})))};
}
let {catalog,snippets}=loadSnapshot(BUNDLED_DIRECTORY);
function reloadDictionaries(directory=BUNDLED_DIRECTORY) {
  // Swap only after all files parse successfully; keep prior data if an edit is invalid.
  const next=loadSnapshot(directory);
  catalog=next.catalog;snippets=next.snippets;
  return catalog;
}
function getCatalog(){return catalog;}

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

module.exports = {getCatalog,findCompletions,reloadDictionaries,BUNDLED_DIRECTORY,DICTIONARY_FILES};
