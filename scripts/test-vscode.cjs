const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async()=>{
 const results={};
 const previousInterpreter=vscode.workspace.getConfiguration().inspect('python.defaultInterpreterPath')?.workspaceValue;
 try {
  if(process.env.USAGE_LENS_PYTHON)await vscode.workspace.getConfiguration().update('python.defaultInterpreterPath',process.env.USAGE_LENS_PYTHON,vscode.ConfigurationTarget.Workspace);
  for(const id of ['ms-python.python','ms-python.vscode-pylance','vscode.typescript-language-features','vscode.css-language-features','Toximiner.universal-usage-lens']) await vscode.extensions.getExtension(id).activate();
  const base=vscode.workspace.workspaceFolders[0].uri.fsPath;
  for(const file of ['library.py','reader.py','catalog.ts','app.tsx','helper.js','widget.jsx','colors.css','nested.pcss']) await vscode.workspace.openTextDocument(path.join(base,file));
  for(const [file,needed] of [['library.py','2 references'],['catalog.ts',null],['app.tsx',null],['helper.js',null],['widget.jsx',null],['colors.css',null],['nested.pcss',null]]){
   const doc=await vscode.workspace.openTextDocument(path.join(base,file));await vscode.window.showTextDocument(doc);
   let lenses=[],symbols=[];
   for(let i=0;i<60;i++){
    await vscode.commands.executeCommand('usageLens.refresh');
    lenses=await vscode.commands.executeCommand('vscode.executeCodeLensProvider',doc.uri,100)||[];
    symbols=await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider',doc.uri)||[];
    if(lenses.length&&(!needed||lenses.some(l=>l.command?.title===needed)))break;
    await new Promise(r=>setTimeout(r,500));
   }
   results[file]={language:doc.languageId,symbols:symbols.map(s=>({name:s.name,kind:s.kind,line:s.selectionRange?.start.line,character:s.selectionRange?.start.character})),lenses:lenses.map(l=>({line:l.range.start.line,title:l.command?.title}))};
   assert.ok(lenses.length,'No positive counts in '+file);
   assert.ok(lenses.every(l=>l.command?.title&&!l.command.title.startsWith('0 ')),'Empty or zero lens in '+file);
   if(file==='library.py'){assert.equal(lenses.length,1);assert.equal(lenses[0].command.title,'2 references');assert.equal(lenses[0].range.start.line,4);}
   if(file==='catalog.ts'){assert.ok(!lenses.some(l=>l.range.start.line===5),'Unused TS function must not reserve a row');assert.ok(lenses.some(l=>l.range.start.line===1&&l.command.title==='2 references'));assert.ok(lenses.some(l=>l.range.start.line===2&&l.command.title==='1 reference'));}
   if(file==='app.tsx'){for(const line of [5,6])assert.ok(lenses.some(l=>l.range.start.line===line&&l.command.title==='1 reference'));}
   if(file==='colors.css')assert.ok(lenses.some(l=>l.range.start.line===1&&l.command.title==='2 references'));
   if(file==='nested.pcss')assert.ok(lenses.some(l=>l.range.start.line===2&&l.command.title==='1 reference'));
   if(file==='helper.js') assert.ok(!lenses.some(l=>l.range.start.line===1),'Unused JS function must not reserve a row');
  }
  console.log(JSON.stringify({success:true,results},null,2));
  if(process.env.USAGE_LENS_TEST_RESULT)fs.writeFileSync(process.env.USAGE_LENS_TEST_RESULT,JSON.stringify({success:true,results},null,2));
 }catch(e){console.error(JSON.stringify({error:e.stack,results},null,2));if(process.env.USAGE_LENS_TEST_RESULT)fs.writeFileSync(process.env.USAGE_LENS_TEST_RESULT,JSON.stringify({error:e.stack,results},null,2));throw e;}finally{if(process.env.USAGE_LENS_PYTHON)await vscode.workspace.getConfiguration().update('python.defaultInterpreterPath',previousInterpreter,vscode.ConfigurationTarget.Workspace);}
};
