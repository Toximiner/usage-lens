import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
let config={enable:true,displayMode:'codeLens',languages:['python'],files:{includeInitPy:true},performance:{maxFileSizeKB:10240},exclude:[],references:{showZero:false,minCount:0,filterDefinitions:true,filterImports:false,filterSelf:false},lenses:{showImplementations:false},clickAction:'peek'};
class Range {constructor(line){this.start={line,character:0};this.end={line,character:10};} intersection(other){return this.start.line===other.start.line?this:undefined;} contains(pos){return pos.line===this.start.line;}}
const uri={toString:()=> 'file:///fictional/library.py'};
const doc={uri,languageId:'python',version:1,lineAt:n=>({text:n===8?'from library import Book':'Book()'})};
const sym=(line,name,kind='function')=>({kind,name,range:new Range(line),selectionRange:new Range(line)});
let symbols=[sym(0,'unused'),sym(1,'used')], replies=new Map(),requests=0;
const loc=line=>({uri,range:new Range(line)});
const vscode={CodeLens:class {constructor(range){this.range=range;}},InlayHint:class{constructor(position,label){this.position=position;this.label=label;}},InlayHintLabelPart:class{constructor(value){this.value=value;}},EventEmitter:class{event=()=>({dispose(){}});fire(){}dispose(){}},workspace:{textDocuments:[doc],openTextDocument:async()=>doc},commands:{executeCommand:async(_cmd,_uri,pos)=>{requests++;const value=replies.get(pos.line);if(value instanceof Error)throw value;return value??[];}}};
const bundled=await build({entryPoints:['src/provider.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['vscode'],plugins:[{name:'test-environment',setup(b){
 b.onResolve({filter:/^\.\/(config|symbols|classifier|pythonFiles|pathMatcher)$/},a=>({path:a.path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:({
 './config':'export const getConfig=()=>globalThis.testConfig(); export const isImportCategoryEnabled=()=>true;',
 './symbols':'export const getEligibleSymbols=async()=>globalThis.testSymbols();',
 './classifier':'export const classifyLocation=()=>"project";',
 './pythonFiles':'export const isDocumentOverSizeLimit=async()=>false;export const isInitPy=()=>false;',
 './pathMatcher':'export const isExcluded=()=>false;'
 })[a.path]}));
}}]});
const context={exports:{},module:{exports:{}},require:id=>{assert.equal(id,'vscode');return vscode;},testConfig:()=>config,testSymbols:()=>symbols};vm.runInNewContext(bundled.outputFiles[0].text,context);
const {PythonCodeLensProvider}=context.module.exports;
const token={isCancellationRequested:false};
let provider=new PythonCodeLensProvider();replies=new Map([[0,[loc(0)]],[1,[loc(1),loc(8),loc(9)]]]);
let lenses=await provider.provideCodeLenses(doc,token);
assert.equal(lenses.length,1);assert.equal(lenses[0].range.start.line,1);assert.equal(lenses[0].command.title,'2 usages');assert.ok(lenses.every(l=>l.command.title));
console.log('PASS: hidden zero contributes no lens/row; imports counted; declaration excluded; positive lens is fully resolved.');
config.references.minCount=3;provider.refresh();assert.equal((await provider.provideCodeLenses(doc,token)).length,0);config.references.minCount=0;
console.log('PASS: minimum count removes complete lenses.');
config.references.showZero=true;provider.refresh();lenses=await provider.provideCodeLenses(doc,token);assert.equal(lenses.length,2);assert.equal((await provider.resolveCodeLens(lenses[0],token)).command.title,'0 usages');config.references.showZero=false;
console.log('PASS: opt-in zero counters retain original behavior.');
provider=new PythonCodeLensProvider();symbols=[sym(2,'late')];replies=new Map();assert.equal((await provider.provideCodeLenses(doc,token)).length,0);replies.set(2,[loc(8)]);assert.equal((await provider.provideCodeLenses(doc,token))[0].command.title,'1 usage');
console.log('PASS: early empty server response is queried again without manual cache reset.');
provider.refresh();replies.set(2,new Error('Server starting'));assert.equal((await provider.provideCodeLenses(doc,token)).length,0);replies.set(2,[loc(8)]);assert.equal((await provider.provideCodeLenses(doc,token)).length,1);
console.log('PASS: provider errors create no blank rows and allow retry.');
assert.equal((await provider.provideCodeLenses(doc,{isCancellationRequested:true})).length,0);
console.log('PASS: cancellation returns no stale lenses.');
