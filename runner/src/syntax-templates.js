'use strict';

// SQL syntax snippets complement (and do not replace) the separate GoogleSQL
// Language extension. They are also available in VSCode's plain SQL mode.
const {lexSql,activeQueryTokens}=require('./sql-scope');
const CREATE_TEMPLATES=Object.freeze([
  {label:'CREATE TEMP TABLE',insertText:'CREATE TEMP TABLE ${1:table_name} AS\n${2:SELECT * FROM source_table};'},
  {label:'CREATE TEMP FUNCTION',insertText:'CREATE TEMP FUNCTION ${1:function_name}(${2:arguments}) AS (${3:expression});'},
  {label:'CREATE OR REPLACE TABLE',insertText:'CREATE OR REPLACE TABLE `${1:project}.${2:dataset}.${3:table_name}` AS\n${4:SELECT * FROM source_table};'},
  {label:'CREATE OR REPLACE FUNCTION',insertText:'CREATE OR REPLACE FUNCTION `${1:project}.${2:dataset}.${3:function_name}`(${4:arguments}) AS (${5:expression});'},
  {label:'CREATE OR REPLACE PROCEDURE',insertText:'CREATE OR REPLACE PROCEDURE `${1:project}.${2:dataset}.${3:procedure_name}`(${4:arguments})\nBEGIN\n  ${5:statement};\nEND;'},
  {label:'CREATE OR REPLACE TABLE FUNCTION',insertText:'CREATE OR REPLACE TABLE FUNCTION `${1:project}.${2:dataset}.${3:function_name}`(${4:arguments}) AS (\n  ${5:SELECT * FROM source_table}\n);'},
  {label:'CREATE OR REPLACE VIEW',insertText:'CREATE OR REPLACE VIEW `${1:project}.${2:dataset}.${3:view_name}` AS\n${4:SELECT * FROM source_table};'},
  {label:'CREATE TABLE',insertText:'CREATE TABLE `${1:project}.${2:dataset}.${3:table_name}` AS\n${4:SELECT * FROM source_table};'}
]);

function getCreateSuggestions(source,position) {
  const text=String(source??'');
  const before=text.slice(0,position);
  // Permit indentation and a CREATE phrase on its own line, but do not suggest
  // CREATE inside a SELECT expression, identifier, string, or comment.
  const match=/(?:^|[;\r\n])([ \t]*(C[A-Za-z]{0,5}(?:[ \t]+[A-Za-z]*){0,4}))$/i.exec(before);
  if(!match) return [];
  const parsed=lexSql(text);
  if(parsed.excluded.some(([from,to])=>from<position&&position<=to))return [];
  // A line beginning with 'c' in SELECT/WHERE is a column reference, not
  // a CREATE statement. Keep column completion precedence inside SELECT blocks.
  if(activeQueryTokens(parsed,position).some(t=>t.kind==='word'&&t.value.toUpperCase()==='SELECT'))return [];
  const phrase=match[2].trim().replace(/\s+/g,' ').toUpperCase();
  if(phrase.length<2) return [];
  return CREATE_TEMPLATES.filter(t=>t.label.startsWith(phrase)).map(t=>({
    label:t.label,kind:'snippet',type:'GoogleSQL CREATE syntax',
    insertText:t.insertText,description:'CREATE文全体を挿入するテンプレート',
    replace:match[2].length,filterText:phrase
  }));
}
module.exports={CREATE_TEMPLATES,getCreateSuggestions};
