const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const runtime = path.resolve(__dirname, '../../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react'));
const Renderer = require(path.join(runtime, 'react-test-renderer'));
const {act} = Renderer;
const root = path.resolve(__dirname, '..');
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const entry = (id,patch={})=>({id,staff:id,at:'2026-10-18T00:00:00Z',tag:'일반',text:`original ${id}`,...patch});
function harness(initial=[entry('a'),entry('b',{pinned:true,pinOrder:0}),entry('c',{pinned:true,pinOrder:1})], options={}) {
 const modules=new Map();let value,tree,props={readOnly:false,...options},inheritedDisabled=false;
 function load(relative) {
  if(modules.has(relative))return modules.get(relative).exports;
  const module={exports:{}};modules.set(relative,module);
  const source=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  const requireFile=name=>{
   if(name==='react')return React;
   if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
   if(name==='@/lib/store')return{useStoreSession:()=>({profile:{displayName:'editor'}})};
   if(name==='@/components/ui/Primitives')return{Button:({children,...rest})=>React.createElement('button',rest,children)};
   if(name==='./shared')return{SectionCard:({title,children})=>React.createElement('section',{'aria-label':title},children),compactTextareaClass:''};
   if(name==='@/lib/format')return{fmtDateTime:value=>value};
   if(name.startsWith('@/')||name.startsWith('.')){const file=name.startsWith('@/')?name.slice(2):path.posix.join(path.posix.dirname(relative),name);return load(file+(fs.existsSync(path.join(root,file+'.tsx'))?'.tsx':'.ts'));}
   throw Error('External dependency/network forbidden: '+name);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`,{React,Date,Math,Map,Set,Number,crypto:require('node:crypto').webcrypto},{filename:relative})(requireFile,module,module.exports);
  return module.exports;
 }
 const Component=load('components/ui/consultation/ConsultationMemoSection.tsx').ConsultationMemoSection;
 function Wrapper(){const [log,setLog]=React.useState(initial);value=log;return React.createElement(Component,{...props,memoLog:log,setMemoLog:setLog});}
 const findLabel=label=>tree.root.findAll(node=>node.props['aria-label']===label)[0];
 return{
  get tree(){return tree;},get value(){return value;},get order(){return tree.root.findAll(node=>node.type==='li'&&node.props['data-memo-id']).map(node=>node.props['data-memo-id']);},
  findLabel, button:label=>tree.root.findAllByType('button').find(node=>text(node)===label),
  mount:()=>act(()=>{tree=Renderer.create(React.createElement(Wrapper),{createNodeMock:()=>({closest:()=>inheritedDisabled?{}:null})});}),
  update:patch=>{props={...props,...patch};act(()=>tree.update(React.createElement(Wrapper)));},
  inherit:value=>{inheritedDisabled=value;},close:()=>act(()=>tree.unmount()),
 };
}

test('editing streams the exact current text into parent draft with one history item, and cancel restores original metadata',()=>{
 const original=[entry('a',{tag:'재통화'}),entry('b')],before=JSON.stringify(original);const h=harness(original);h.mount();
 act(()=>h.findLabel('새 상담 메모').props.onChange({target:{value:'preserved new draft'}}));
 act(()=>h.findLabel('a 메모 수정').props.onClick());
 for(let i=0;i<100;i++)act(()=>h.findLabel('a 메모 내용 수정').props.onChange({target:{value:` typing ${i} `}}));
 assert.equal(h.value[0].text,' typing 99 ');assert.equal(h.value[0].editHistory.length,1);assert.equal(h.value[0].editHistory[0].text,'original a');
 assert.equal(h.value[0].tag,'재통화');assert.equal(h.value[0].staff,'a');assert.equal(h.value[0].at,original[0].at);
 assert.deepEqual(h.value.map(x=>x.id),['a','b']);assert.equal(h.findLabel('새 상담 메모').props.value,'preserved new draft');
 act(()=>h.button('편집 취소').props.onClick());assert.equal(JSON.stringify(h.value),before);
 act(()=>h.findLabel('a 메모 수정').props.onClick());act(()=>h.findLabel('a 메모 내용 수정').props.onChange({target:{value:'applied'}}));act(()=>h.button('편집 적용').props.onClick());
 assert.equal(h.value[0].text,'applied');assert.equal(h.value[0].editHistory.length,1);assert.equal(JSON.stringify(original),before);h.close();
});

test('soft delete and restore retain raw chronology, row count, tag and pin metadata',()=>{
 const original=[entry('a'),entry('b',{pinned:true,pinOrder:0,tag:'부재중'})];const h=harness(original);h.mount();
 act(()=>h.findLabel('b 메모 삭제').props.onClick());assert.equal(h.value.length,2);assert.ok(h.value[1].deletedAt);assert.equal(h.value[1].deletedBy,'editor');assert.deepEqual(h.order,['a']);
 assert.match(text(h.tree.toJSON()),/삭제한 메모 1건/);assert.ok(h.findLabel('상담메모 (1)'));
 act(()=>h.findLabel('b 삭제한 메모 복원').props.onClick());assert.equal(JSON.stringify(h.value),JSON.stringify(original));assert.deepEqual(h.order,['b','a']);h.close();
});

test('fixed right-edge pin checkbox, pointer reorder and keyboard buttons change metadata only',()=>{
 const h=harness();h.mount();assert.deepEqual(h.order,['b','c','a']);
 const row=h.tree.root.findAll(node=>node.props['data-memo-id']==='b')[0];assert.match(row.props.className,/grid-cols-\[minmax\(0,1fr\)_30px\]/);assert.equal(row.children.at(-1).type,'label');
 assert.equal(h.findLabel('b 고정 메모 위로').props.disabled,true);
 const keyboardButton=h.findLabel('b 고정 메모 아래로');
 act(()=>keyboardButton.props.onClick());assert.deepEqual(h.order,['c','b','a']);assert.deepEqual(h.value.map(x=>x.id),['a','b','c']);
 assert.equal(h.findLabel('b 고정 메모 아래로'),keyboardButton); // Stable keys preserve the focused control.
 const transfer={effectAllowed:'',dropEffect:'',setData(){}};let prevented=0;
 act(()=>h.findLabel('b 고정 메모 끌어서 순서 변경').props.onDragStart({preventDefault:()=>prevented++,dataTransfer:transfer}));
 act(()=>h.tree.root.findAll(node=>node.props['data-memo-id']==='c')[0].props.onDrop({preventDefault:()=>prevented++,dataTransfer:transfer}));
 assert.deepEqual(h.order,['b','c','a']);assert.equal(transfer.effectAllowed,'move');assert.equal(prevented,1);
 assert.deepEqual(h.value.map(x=>x.id),['a','b','c']);assert.ok(h.value.every(x=>x.at==='2026-10-18T00:00:00Z'&&x.text===`original ${x.id}`));
 act(()=>h.findLabel('b 메모 상단 고정').props.onChange({target:{checked:false}}));assert.deepEqual(h.order,['c','a','b']);assert.equal(h.tree.root.findAll(node=>node.type==='button'&&node.props.draggable).length,0);h.close();
});

test('read-only and inherited disabled fieldsets block pin and active drag/drop without changing raw data',()=>{
 const h=harness();h.mount();const before=JSON.stringify(h.value);const transfer={setData(){}};
 act(()=>h.findLabel('b 고정 메모 끌어서 순서 변경').props.onDragStart({preventDefault(){},dataTransfer:transfer}));
 h.update({readOnly:true});assert.equal(h.findLabel('b 메모 상단 고정').props.disabled,true);
 act(()=>h.findLabel('b 메모 상단 고정').props.onChange({target:{checked:false}}));
 act(()=>h.tree.root.findAll(node=>node.props['data-memo-id']==='c')[0].props.onDrop({preventDefault(){},dataTransfer:transfer}));
 assert.equal(JSON.stringify(h.value),before);assert.equal(h.findLabel('b 메모 수정'),undefined);
 h.update({readOnly:false});h.inherit(true);
 act(()=>h.findLabel('b 메모 수정').props.onClick());assert.equal(h.findLabel('b 메모 내용 수정'),undefined);
 act(()=>h.findLabel('b 메모 상단 고정').props.onChange({target:{checked:false}}));assert.equal(JSON.stringify(h.value),before);h.close();
});

test('ambiguous legacy IDs cannot overwrite multiple entries and rapid additions use unique IDs with existing tag policy',()=>{
 const h=harness([entry('same',{staff:'first'}),entry('same',{staff:'second'})]);h.mount();const before=JSON.stringify(h.value);
 assert.equal(h.findLabel('first 메모 수정').props.disabled,true);act(()=>h.findLabel('first 메모 수정').props.onClick());assert.equal(h.findLabel('first 메모 내용 수정'),undefined);assert.equal(JSON.stringify(h.value),before);
 assert.match(text(h.tree.toJSON()),/식별자 확인 필요/);
 for(const value of ['one','two']){act(()=>h.findLabel('새 상담 메모').props.onChange({target:{value}}));act(()=>h.button(' 추가').props.onClick());}
 assert.notEqual(h.value[0].id,h.value[1].id);assert.equal(h.value[0].tag,'부재중');assert.equal(h.value[1].tag,'부재중');h.close();
 const legacy=harness([],{generalMemoTag:'일반'});legacy.mount();act(()=>legacy.findLabel('새 상담 메모').props.onChange({target:{value:'legacy'}}));act(()=>legacy.button(' 추가').props.onClick());assert.equal(legacy.value[0].tag,'일반');legacy.close();
});
