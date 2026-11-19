import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const here=path.dirname(fileURLToPath(import.meta.url));
const result=await build({entryPoints:[path.join(here,'GalleryPage.jsx')],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',plugins:[{name:'gallery-fixtures',setup(b){
 b.onResolve({filter:/^@calendar\/contexts\/AuthContext\.jsx$/},()=>({path:'auth',namespace:'fixture'}));
 b.onResolve({filter:/^@calendar\/firebase\/firebase\.js$/},()=>({path:'firebase',namespace:'fixture'}));
 b.onResolve({filter:/^@calendar\/components\/AdminBackButton\.jsx$/},()=>({path:'back',namespace:'fixture'}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({contents:p==='auth'?'export const useAuth=()=>globalThis.__gallerySession;':p==='firebase'?'export const auth={currentUser:null};':p==='back'?'export default function Back(){return null;}':'',loader:'js'}));
}}]});
const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
test('Gallery Administration renders for assigned Super Admin',()=>{globalThis.__gallerySession={loading:false,isAdmin:true,user:{uid:'admin'},canAccess:id=>id==='gallery'};const html=renderToStaticMarkup(React.createElement(mod.exports.AdminGallery));assert.match(html,/Gallery Administration/);assert.match(html,/Library/);assert.match(html,/Upload/);});
test('Unassigned admin sees no Gallery Administration controls',()=>{globalThis.__gallerySession={loading:false,isAdmin:true,user:{uid:'other'},canAccess:()=>false};const html=renderToStaticMarkup(React.createElement(mod.exports.AdminGallery));assert.match(html,/does not have access/);assert.doesNotMatch(html,/Upload/);});
