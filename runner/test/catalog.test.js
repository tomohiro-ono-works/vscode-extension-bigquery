'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const c=require('../src/catalog');
const base={project:'demo-project',dataset:'mart',name:'sales'};
const sample=JSON.stringify({tableReference:{projectId:base.project,datasetId:base.dataset,tableId:base.name},description:'売上のデータセット',schema:{fields:[{name:'customer_id',type:'STRING',description:'顧客ID'},{name:'sales_amount',type:'NUMERIC',description:'売上金額'},{name:'notes',type:'STRING'}]}});
test('validates project and data IDs and parses BigQuery metadata descriptions',()=>{
 const t=c.parseTable(sample,base);assert.equal(t.description,'売上のデータセット');assert.equal(t.columns[1].description,'売上金額');assert.equal(t.columns[1].type,'NUMERIC');
 assert.throws(()=>c.parseTable(sample,{...base,name:'wrong'}),/did not match/i);
 assert.throws(()=>c.checkProject('foo;&&'),/Invalid/i);
 assert.throws(()=>c.checkId('sale;rm','table'),/Unsupported/i);
});
test('reads bq JSON list results and removes duplicate entries',()=>{
 assert.deepEqual(c.listDatasets(JSON.stringify([{datasetReference:{datasetId:'mart'}},{datasetReference:{datasetId:'mart'}},{datasetReference:{datasetId:'warehouse'}}])),['mart','warehouse']);
 assert.deepEqual(c.listTables(JSON.stringify([{tableReference:{tableId:'sales'}},{tableReference:{tableId:'orders'}}])),['orders','sales']);
 assert.throws(()=>c.listTables('{}'),/Expected a list/);
});
test('merges table registrations without duplicates and serializes descriptions',()=>{
 let catalog=c.upsertTable({tables:[]},c.parseTable(sample,base));
 catalog=c.upsertTable(catalog,{...base,description:'編集後',columns:[{name:'customer_id',type:'STRING',description:'修正済み'}]});
 assert.equal(catalog.tables.length,1);assert.equal(catalog.tables[0].columns.length,1);assert.equal(catalog.tables[0].description,'編集後');
 const yaml=c.catalogToYaml(catalog);
 assert.match(yaml,/description: "編集後"/);assert.match(yaml,/description: "修正済み"/);
 assert.deepEqual(JSON.parse(JSON.stringify(catalog)),catalog);
});
test('matches registered table names after FROM and JOIN',()=>{
 const catalog={tables:[c.parseTable(sample,base)]};
 assert.deepEqual(c.getSuggestions(catalog,'SELECT * FROM sa',16).map(x=>x.insertText),['`demo-project.mart.sales`']);
 assert.deepEqual(c.getSuggestions(catalog,'SELECT * FROM nonexistent',25),[]);
});
test('column suggestions require a recognized table alias and include descriptions',()=>{
 const catalog={tables:[c.parseTable(sample,base)]};
 const sql='SELECT s.\nFROM `demo-project.mart.sales` AS s\nWHERE s.c';
 const suggestions=c.getSuggestions(catalog,sql,sql.length);
 assert.equal(suggestions.length,1);assert.equal(suggestions[0].label,'customer_id');assert.equal(suggestions[0].description,'顧客ID');
 const noAlias='SELECT x.\nFROM `demo-project.mart.sales` AS s';
 assert.deepEqual(c.getSuggestions(catalog,noAlias,noAlias.indexOf('x.')+2),[]);
 const unqualified='SELECT cu FROM `demo-project.mart.sales` AS s';
 assert.deepEqual(c.getSuggestions(catalog,unqualified,unqualified.length),[]);
});
test('untrusted persisted catalog entries cannot insert arbitrary invalid identifiers',()=>{
 const cleaned=c.normalizeCatalog({tables:[{...base,columns:[{name:'good',description:'okay'},{name:'x; DROP TABLE users',description:'bad'}]},{project:'fake;cmd',dataset:'oops',name:'wrong'}]});
 assert.equal(cleaned.tables.length,1);assert.equal(cleaned.tables[0].columns.length,1);
});
