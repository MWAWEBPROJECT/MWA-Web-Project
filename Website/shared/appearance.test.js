import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {contrastRatio} from './booking-colours.js';
test('all palettes and modes use readable dark action surfaces and white inactive menu buttons',async()=>{
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,server:{middlewareMode:true},appType:'custom'});
 const previous=globalThis.document,values={};globalThis.document={documentElement:{style:{setProperty:(key,value)=>values[key]=value},dataset:{}}};
 try{
  const {schemes,applyAppearance,actionBackground}=await server.ssrLoadModule('/shared/appearance.js');
  for(const palette of Object.keys(schemes))for(const mode of ['light','dark']){
   applyAppearance({palette,mode},{palette,mode},true);
   assert.ok(contrastRatio(values['--action-background'],'#ffffff')>=4.5,palette+' '+mode);
   assert.ok(contrastRatio(values['--admin-button-ink'],'#ffffff')>=4.5,palette+' inactive');
   assert.ok(contrastRatio(values['--primary'],values['--primary-foreground']==='#fff'?'#ffffff':values['--primary-foreground'])>=4.5,palette+' primary');
  }
  for(const color of ['#ffffff','#ffff00','#99ff99','#000000','#176446'])assert.ok(contrastRatio(actionBackground(color),'#ffffff')>=4.5);
 }finally{globalThis.document=previous;await server.close();}
});
