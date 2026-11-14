'use strict';
// One four-level Explorer-style hierarchy; searches are inline child controls,
// never a replacement for the tree. No remote values are inserted as HTML.
(() => {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('tree');
  const opened = new Set();
  const drafts = new Map();
  const filters = new Map();
  const working = new Set();
  let model = {projects:[]};
  let initialState = false;

  const iconPaths = {
    add: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    cloud: '<path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 8 21h10a4 4 0 0 0 2-4.42Z"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    field: '<path d="m12 2 9 5-9 5-9-5 9-5ZM3 7v10l9 5 9-5V7M12 12v10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    edit: '<path d="m4 20 4-.7L19 8.3 15.7 5 4.7 16l-.7 4ZM13.5 7.2l3.3 3.3M3 21h18"/>',
    trash: '<path d="M4 7h16M10 4h4M6 7l1 14h10l1-14M10 11v7M14 11v7"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 5l2-3M20 20v-5h-5"/>',
    save: '<path d="M4 3h14l3 3v15H3V3h1ZM7 3v6h10V3M7 21v-8h10v8"/>'
  };
  const make = (tag, klass='', value) => {
    const node=document.createElement(tag);
    if (klass) node.className=klass;
    if (value !== undefined) node.textContent=String(value);
    return node;
  };
  function icon(name, klass='') {
    const wrapper=make('span',`icon ${klass}`);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('width','16');svg.setAttribute('height','16');
    svg.setAttribute('stroke','currentColor');svg.setAttribute('fill','none');
    svg.setAttribute('stroke-width','1.65');svg.setAttribute('stroke-linecap','round');
    svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
    // All SVG path strings are compile-time constants, never BigQuery metadata.
    svg.innerHTML=iconPaths[name] || iconPaths.field;
    wrapper.append(svg);
    return wrapper;
  }
  const append=(parent,child)=>{parent.append(child);return child;};
  const send=(command,data={})=>vscode.postMessage({command,...data});
  const depthStyle=(element,depth)=>{element.style.paddingLeft=`${Math.min(depth*18+3,57)}px`;};
  function toolButton(name,title,handler,klass='') {
    const btn=make('button',`icon-button ${klass}`);
    btn.type='button';btn.title=title;btn.setAttribute('aria-label',title);
    btn.append(icon(name));
    btn.addEventListener('click',e=>{e.stopPropagation();handler();});
    return btn;
  }
  function branch(parent,{key,label,depth,kind,summary='',tooltip='',registered=false,onExpand,contextActions}) {
    const section=append(parent,make('section','tree-node'));
    const row=append(section,make('div',`tree-row kind-${kind}`));
    depthStyle(row,depth);
    const twist=append(row,toolButton('chevron',opened.has(key)?'折りたたむ':'展開する',toggle,'twist'));
    if(opened.has(key)) twist.classList.add('expanded');
    // Table checkbox belongs directly after the disclosure arrow, as in v0.3.5.
    if(registered !== null) { /* actual checkboxes inserted through contextActions */ }
    const kindIcon=icon(kind==='project'?'cloud':kind==='dataset'?'database':'table','node-icon');
    const name=make('button','node-label',label);
    name.type='button';name.title=tooltip||label;
    name.addEventListener('click',toggle);
    // Context callback may inject the table checkbox before the icon.
    if(contextActions)contextActions(row,'before');
    append(row,kindIcon);append(row,name);
    if(summary)append(row,make('span','meta registered-meta',summary));
    if(contextActions)contextActions(row,'after');
    const children=append(section,make('div','tree-children'));
    children.hidden=!opened.has(key);
    function toggle() {
      if(opened.has(key))opened.delete(key);
      else {opened.add(key); if(onExpand)onExpand();}
      render();
    }
    return children;
  }
  function checkbox(row,checked,description,onChange) {
    const input=append(row,make('input','tree-checkbox'));
    input.type='checkbox';input.checked=checked;
    input.title=description;input.setAttribute('aria-label',description);
    input.addEventListener('click',e=>e.stopPropagation());
    input.addEventListener('change',()=>{input.disabled=true;onChange(input.checked);});
    return input;
  }
  function searchField(parent,key,command,data,placeholder,depth) {
    const area=append(parent,make('div','search-block'));depthStyle(area,depth);
    const wrap=append(area,make('div','search-wrap'));
    append(wrap,icon('search','search-icon'));
    const input=append(wrap,make('input','search-input'));
    input.type='search';input.value=drafts.get(key)||'';
    input.autocomplete='off';input.spellcheck=false;
    input.placeholder=placeholder;
    input.setAttribute('aria-label',placeholder+key);
    const hint=append(area,make('div','search-hint',working.has(key)?'検索中…':'3文字以上・Enterで検索'));
    input.addEventListener('input',()=>drafts.set(key,input.value));
    input.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing)return;
      event.preventDefault();
      const value=input.value.trim();
      if(value.length<3) {hint.textContent='3文字以上入力してください';hint.classList.add('invalid');return;}
      working.add(key);hint.textContent='検索中…';
      send(command,{...data,term:value});
    });
    return area;
  }
  function columnRow(parent,project,dataset,table,c) {
    const row=append(parent,make('div','tree-row kind-column'));
    depthStyle(row,3);
    append(row,make('span','leaf-spacer'));
    checkbox(row,c.registered,`${c.name}を補完候補に登録`,checked=>send('toggleColumn',{project,dataset,table,column:c.name,checked}));
    append(row,icon('field','column-icon'));
    const name=append(row,make('span','column-label',c.name));name.title=c.description||c.name;
    if(c.type)append(row,make('span','meta column-type',c.type));
    if(c.registered)append(row,toolButton('edit',`${c.name}のDescriptionを編集`,()=>send('editDescription',{project,dataset,table,column:c.name}),'on-hover'));
  }
  function tableBranch(parent,project,dataset,t) {
    const key=`t:${project}/${dataset}/${t.name}`;
    const content=branch(parent,{key,label:t.name,depth:2,kind:'table',tooltip:t.description||t.name,
      summary:t.registered?`登録済 · ${t.registeredCount}列`:'',
      onExpand:()=>{if(!t.loaded)send('loadColumns',{project,dataset,table:t.name});},
      contextActions:(row,where)=>{
        if(where==='before')checkbox(row,t.registered,`${t.name}を補完対象のテーブルに登録`,checked=>send('toggleTable',{project,dataset,table:t.name,checked}));
        if(where==='after' && t.registered){
          append(row,toolButton('edit',`${t.name}のDescriptionを編集`,()=>send('editDescription',{project,dataset,table:t.name}),'on-hover'));
          append(row,toolButton('trash',`${t.name}の登録を解除`,()=>send('toggleTable',{project,dataset,table:t.name,checked:false}),'on-hover'));
        }
      }});
    if(!opened.has(key))return;
    const filterKey=`f:${project}/${dataset}/${t.name}`;
    const area=append(content,make('div','search-block column-filter'));depthStyle(area,3);
    const wrap=append(area,make('div','search-wrap'));append(wrap,icon('search','search-icon'));
    const input=append(wrap,make('input','search-input'));input.type='search';
    input.autocomplete='off';input.placeholder='カラム検索（任意）';
    input.setAttribute('aria-label','カラム検索'+filterKey);input.value=filters.get(filterKey)||'';
    input.addEventListener('input',()=>{filters.set(filterKey,input.value);render();});
    const term=(filters.get(filterKey)||'').toLowerCase();
    const found=t.columns.filter(c=>c.name.toLowerCase().includes(term));
    for(const c of found)columnRow(content,project,dataset,t.name,c);
    if(!t.loaded && !t.columns.length)append(content,make('div','status-line','カラムを取得しています…'));
    if(t.loaded && !found.length)append(content,make('div','status-line','該当するカラムはありません'));
  }
  function datasetBranch(parent,project,d) {
    const key=`d:${project}/${d.name}`;
    const content=branch(parent,{key,label:d.name,depth:1,kind:'dataset'});
    if(!opened.has(key))return;
    searchField(content,`st:${project}/${d.name}`,'searchTables',{project,dataset:d.name},'テーブル名を検索',2);
    if(d.search)append(content,make('div','result-line',`「${d.search.word}」：${d.search.names.length}件`));
    for(const t of d.tables)tableBranch(content,project,d.name,t);
  }
  function projectBranch(parent,p) {
    const key=`p:${p.name}`;
    const content=branch(parent,{key,label:p.name,depth:0,kind:'project',contextActions:(row,where)=>{
      if(where==='after')append(row,toolButton('trash',`${p.name}を削除`,()=>send('removeProject',{project:p.name}),'on-hover'));
    }});
    if(!opened.has(key))return;
    searchField(content,`sd:${p.name}`,'searchDatasets',{project:p.name},'データセット名を検索',1);
    if(p.search)append(content,make('div','result-line',`「${p.search.word}」：${p.search.names.length}件${p.search.truncated?'（取得上限あり）':''}`));
    for(const d of p.datasets)datasetBranch(content,p.name,d);
  }
  function toolbar() {
    const area=append(root,make('div','inline-toolbar'));
    const addBtn=append(area,make('button','add-project'));
    addBtn.type='button';addBtn.title='Google CloudプロジェクトIDを登録';
    append(addBtn,icon('add'));append(addBtn,make('span','', 'プロジェクトを追加'));
    addBtn.addEventListener('click',()=>send('addProject'));
    append(area,toolButton('refresh','検索結果をクリア（登録は維持）',()=>send('refresh'),'toolbar-refresh'));
    return area;
  }
  function render() {
    const active=document.activeElement;
    const focusId=active?.getAttribute('aria-label');
    const cursor=active && typeof active.selectionStart==='number'?active.selectionStart:null;
    const scroll=root.scrollTop;
    root.replaceChildren();
    toolbar();
    if(!model.projects.length)append(root,make('p','empty','＋ からプロジェクトを登録してください。'));
    for(const project of model.projects)projectBranch(root,project);
    root.scrollTop=scroll;
    if(focusId){
      for(const input of root.querySelectorAll('input')){
        if(input.getAttribute('aria-label')===focusId){
          input.focus({preventScroll:true});
          if(cursor!==null)try{input.setSelectionRange(cursor,cursor);}catch{}
          break;
        }
      }
    }
  }
  window.addEventListener('message',event=>{
    const data=event.data;
    if(!data||typeof data!=='object')return;
    if(data.type==='state'){
      const known=new Set(model.projects.map(p=>p.name));
      model=data;
      if(initialState){for(const p of model.projects)if(!known.has(p.name))opened.add(`p:${p.name}`);}
      initialState=true;
      working.clear();render();
    } else if(data.type==='error'){
      working.clear();
      const alert=append(root,make('div','error-line',data.message||'検索に失敗しました'));
      alert.setAttribute('role','alert');
    }
  });
  render(); // Usable even before the extension host returns its first snapshot.
  send('ready');
})();
