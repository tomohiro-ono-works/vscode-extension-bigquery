'use strict';

const grammar = require('../syntaxes/googlesql.tmLanguage.json');

// Colors sampled from the reference screenshot. These override the current
// VSCode color theme in GoogleSQL editors only.
const PALETTE = Object.freeze({
  keyword: {color:'#7B30D0',fontStyle:'italic'},
  type: {color:'#7B30D0',fontStyle:'italic'},
  comment: {color:'#7B30D0',backgroundColor:'#EDDEFF',fontStyle:'italic'},
  function: {color:'#D33E82',fontStyle:'italic'},
  number: {color:'#D33E82'},
  string: {color:'#D33E82',backgroundColor:'#FCF5F8'},
  parameter: {color:'#D33E82',backgroundColor:'#FCF5F8'},
  relation: {color:'#3E8FF1',backgroundColor:'#F4F8FC',fontStyle:'italic',textDecoration:'underline'}
});

function matcher(scope) {
  const pattern = grammar.patterns.find((entry) => entry.name === scope).match;
  const body = pattern.startsWith('(?i:') && pattern.endsWith(')')
    ? pattern.slice(4,-1) : pattern;
  return new RegExp(body,'i');
}

// Keep terminology aligned with the maintained TextMate grammar rather than
// copying the SQL keyword and type dictionaries into another source file.
const keywords = matcher('keyword.control.googlesql');
const types = matcher('storage.type.googlesql');
const builtins = new RegExp('^' + matcher('support.function.builtin.googlesql').source,'i');

const identifierStart = /[A-Za-z_]/;
const identifierChar = /[A-Za-z0-9_]/;
const relationChar = /[A-Za-z0-9_.:-]/;
const numbers = /^(?:0x[0-9a-f]+|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?)/i;
const relationAfter = new Set(['WITH','FROM','JOIN','INTO','UPDATE','TABLE','VIEW']);

function stringStart(text,i) {
  let q = text[i];
  let prefixLength = 0;
  if (/[rRbB]/.test(q)) {
    const candidate = text.slice(i,i+2).toLowerCase();
    if ((candidate === 'rb' || candidate === 'br') && /['"]/.test(text[i+2] || '')) {
      prefixLength = 2;
    } else if (/['"]/.test(text[i+1] || '')) {
      prefixLength = 1;
    } else {
      return null;
    }
    q = text[i+prefixLength];
  }
  if (q !== "'" && q !== '"') return null;
  const quoteAt = i + prefixLength;
  const mark = text.slice(quoteAt,quoteAt+3) === q.repeat(3) ? q.repeat(3) : q;
  return {prefixLength,mark};
}

/** One-pass lexical scanner: no SQL execution, AST or schema queries. */
function tokenize(source) {
  const text = String(source ?? '');
  const tokens = [];
  let expectRelation = false;
  let i = 0;
  const add = (kind,start,end) => {
    if (end > start) tokens.push({kind,start,end});
  };

  while (i < text.length) {
    const start = i;
    const c = text[i];

    if ((c === '-' && text[i+1] === '-') || c === '#') {
      const nextLine = text.indexOf('\n',i);
      i = nextLine < 0 ? text.length : nextLine;
      add('comment',start,i);
      continue;
    }
    if (c === '/' && text[i+1] === '*') {
      const close = text.indexOf('*/',i+2);
      i = close < 0 ? text.length : close+2;
      add('comment',start,i);
      continue;
    }

    const quoted = (c === "'" || c === '"' || /[rRbB]/.test(c)) ? stringStart(text,i) : null;
    if (quoted) {
      const markStart = start + quoted.prefixLength;
      const mark = quoted.mark;
      i = markStart + mark.length;
      while (i < text.length) {
        if (text[i] === '\\') {
          i = Math.min(i+2,text.length);
        } else if (text.startsWith(mark,i)) {
          i += mark.length;
          break;
        } else {
          i++;
        }
      }
      add('string',start,i);
      expectRelation = false;
      continue;
    }

    if (c === '`') {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') i = Math.min(i+2,text.length);
        else if (text[i] === '`') {i++;break;}
        else i++;
      }
      add('relation',start,i);
      expectRelation = false;
      continue;
    }

    if (c === '@') {
      i++;
      if (text[i] === '@') i++;
      while (i < text.length && (identifierChar.test(text[i]) || text[i] === '.')) i++;
      add('parameter',start,i);
      continue;
    }

    if (/[0-9]/.test(c)) {
      const numeric = numbers.exec(text.slice(i));
      if (numeric) {
        i += numeric[0].length;
        add('number',start,i);
        continue;
      }
    }

    if (identifierStart.test(c)) {
      i++;
      while (i < text.length && identifierChar.test(text[i])) i++;
      const word = text.slice(start,i);
      const upper = word.toUpperCase();

      if (expectRelation && upper !== 'RECURSIVE') {
        if (upper !== 'UNNEST' && upper !== 'SELECT') {
          while (i < text.length && relationChar.test(text[i])
            && !(text[i] === '-' && text[i+1] === '-')) i++;
          add('relation',start,i);
          expectRelation = false;
          continue;
        }
        expectRelation = false;
      }

      const nextIsCall = /^\s*\(/.test(text.slice(i));
      if (nextIsCall && (!keywords.test(word) || builtins.test(text.slice(start)))) {
        add('function',start,i);
      } else if (types.test(word)) {
        add('type',start,i);
      } else if (keywords.test(word)) {
        add('keyword',start,i);
      }
      if (relationAfter.has(upper)) expectRelation = true;
      continue;
    }

    i++;
  }
  return tokens;
}

module.exports = {PALETTE,tokenize};
