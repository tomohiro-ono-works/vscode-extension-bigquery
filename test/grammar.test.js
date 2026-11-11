'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const json = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

test('registers independent BigQuery language for bqsql, not all sql', () => {
  const pkg = json('package.json');
  const lang = pkg.contributes.languages.find((item) => item.id === 'googlesql');
  assert.ok(lang);
  assert.deepEqual(lang.extensions, ['.bqsql']);
  assert.equal(pkg.contributes.grammars[0].scopeName, 'source.googlesql');
  assert.equal(pkg.contributes.grammars[0].language, 'googlesql');
  assert.equal(pkg.main,'./src/extension.js');
  assert.ok(pkg.activationEvents.includes('onLanguage:googlesql'));
  assert.equal(pkg.contributes.configuration.properties['bigquerySqlLanguage.referencePalette.enabled'].default,true);
});

test('grammar includes BigQuery keywords, types, builtins and identifier fallbacks', () => {
  const grammar = json('syntaxes/googlesql.tmLanguage.json');
  assert.equal(grammar.scopeName, 'source.googlesql');
  const find = (scope) => grammar.patterns.find((item) => item.name === scope);
  const regex = (scope) => {
    const str = find(scope)?.match;
    assert.ok(str, `missing ${scope}`);
    return new RegExp(str.replace(/^\(\?i:/, '').replace(/\)$/, ''), 'i');
  };
  const keywords = regex('keyword.control.googlesql');
  for (const term of ['QUALIFY', 'UNNEST', 'PIVOT', 'UNPIVOT', 'MERGE', 'DECLARE', 'EXCEPTION', 'EXECUTE', 'IMMEDIATE', 'RECURSIVE', 'ASSERT']) {
    assert.match(term, keywords, term);
  }
  const types = regex('storage.type.googlesql');
  for (const term of ['BIGNUMERIC', 'GEOGRAPHY', 'JSON', 'STRUCT', 'ARRAY', 'RANGE', 'INTERVAL']) {
    assert.match(term, types, term);
  }
  const builtins = regex('support.function.builtin.googlesql');
  for (const term of ['SAFE_CAST(', 'COUNTIF(', 'ARRAY_AGG(', 'DATE_DIFF(', 'ST_GEOGPOINT(', 'REGEXP_EXTRACT_ALL(', 'APPROX_TOP_COUNT(']) {
    assert.match(term, builtins, term);
  }
  assert.ok(find('entity.name.function.googlesql'));
});

test('recognizes GoogleSQL string forms, comments, params, quoted names before keywords', () => {
  const grammar = json('syntaxes/googlesql.tmLanguage.json');
  const patterns = grammar.patterns;
  const names = patterns.map((p) => p.name || p.include);
  assert.ok(names.indexOf('#comments') < names.indexOf('keyword.control.googlesql'));
  assert.ok(names.indexOf('#strings') < names.indexOf('keyword.control.googlesql'));
  assert.ok(names.indexOf('entity.name.quoted.googlesql') < names.indexOf('keyword.control.googlesql'));
  assert.ok(grammar.repository.strings.patterns.some((p) => p.begin?.includes("'''")));
  assert.ok(grammar.repository.strings.patterns.some((p) => p.begin?.includes('"""')));
  assert.ok(grammar.repository.comments.patterns.some((p) => p.name === 'comment.line.number-sign.googlesql'));
  assert.ok(patterns.some((p) => p.name === 'variable.parameter.googlesql'));
  assert.ok(names.indexOf('variable.system.googlesql') < names.indexOf('variable.parameter.googlesql'));
});

test('bracket pairs, smart indentation and comment settings are present', () => {
  const config = json('language-configuration.json');
  assert.ok(config.brackets.some(([left,right]) => left === '(' && right === ')'));
  assert.ok(config.autoClosingPairs.some((pair) => pair.open === '`' && pair.close === '`'));
  const increase = new RegExp(config.indentationRules.increaseIndentPattern);
  const decrease = new RegExp(config.indentationRules.decreaseIndentPattern);
  for (const kw of ['BEGIN','begin','CASE','case']) assert.match(kw,increase);
  for (const kw of ['END','end','ELSE','else']) assert.match(kw,decrease);
  for (const rule of config.onEnterRules) {
    assert.doesNotThrow(() => new RegExp(rule.beforeText));
    if (rule.afterText) assert.doesNotThrow(() => new RegExp(rule.afterText));
  }
  assert.equal(config.comments.lineComment, '--');
});

test('third party license has Microsoft attribution', () => {
  const text = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(text, /Microsoft Corporation/);
  assert.match(text, /MIT License/);
});
