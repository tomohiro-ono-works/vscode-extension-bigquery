'use strict';

const grammar = require('../../syntaxes/googlesql.tmLanguage.json');

/** Read the alternatives from the existing TextMate rules; never maintain a second SQL dictionary. */
function namesFromScope(scope) {
  const expression = grammar.patterns.find((pattern) => pattern.name === scope)?.match;
  if (!expression) throw new Error(`Missing GoogleSQL grammar scope: ${scope}`);
  const begin = expression.indexOf('(?:');
  const end = expression.indexOf(')',begin + 3);
  if (begin < 0 || end < 0) throw new Error(`Unsupported GoogleSQL grammar scope: ${scope}`);
  return expression.slice(begin + 3,end).split('|').map((name) =>
    name.replace(/\\\./g,'.').toUpperCase());
}

const catalog = Object.freeze({
  keywords: Object.freeze([...new Set(namesFromScope('keyword.control.googlesql'))].sort()),
  functions: Object.freeze([...new Set([
    ...namesFromScope('support.function.builtin.googlesql'),
    ...namesFromScope('support.function.namespace.googlesql')
  ])].sort())
});

// Preserve the grammar's complete dictionary while replacing partial clause
// completions with selectable, tab-navigable GoogleSQL syntax templates.
const phraseOnly = new Set(['CREATE','ORDER','GROUP','ON','PARTITION','CLUSTER']);
const snippets = Object.freeze([
  {label:'CREATE TEMP TABLE',insertText:'CREATE TEMP TABLE ${1:table_name} AS\n${2:SELECT * FROM source_table};'},
  {label:'CREATE TEMP FUNCTION',insertText:'CREATE TEMP FUNCTION ${1:function_name}(${2:arguments}) AS (${3:expression});'},
  {label:'CREATE OR REPLACE TABLE',insertText:'CREATE OR REPLACE TABLE `${1:project}.${2:dataset}.${3:table_name}` AS\n${4:SELECT * FROM source_table};'},
  {label:'CREATE OR REPLACE FUNCTION',insertText:'CREATE OR REPLACE FUNCTION ${1:project}.${2:dataset}.${3:function_name}(${4:arguments}) AS (${5:expression});'},
  {label:'CREATE OR REPLACE PROCEDURE',insertText:'CREATE OR REPLACE PROCEDURE ${1:project}.${2:dataset}.${3:procedure_name}(${4:arguments})\nBEGIN\n  ${5:statement};\nEND;'},
  {label:'CREATE OR REPLACE TABLE FUNCTION',insertText:'CREATE OR REPLACE TABLE FUNCTION ${1:project}.${2:dataset}.${3:function_name}(${4:arguments}) AS (\n  ${5:SELECT * FROM table_name}\n);'},
  {label:'CREATE OR REPLACE VIEW',insertText:'CREATE OR REPLACE VIEW ${1:project}.${2:dataset}.${3:view_name} AS\n${4:SELECT * FROM table_name};'},
  {label:'PARTITION BY',insertText:'PARTITION BY ${1:column_name}'},
  {label:'CLUSTER BY',insertText:'CLUSTER BY ${1:column_name}'},
  {label:'GROUP BY ALL',insertText:'GROUP BY ALL'},
  {label:'ORDER BY',insertText:'ORDER BY ${1:expression}'},
  {label:'JOIN',insertText:'JOIN ${1:table_name}\n  ON ${2:left_column} = ${3:right_column}'}
].map(Object.freeze));

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
