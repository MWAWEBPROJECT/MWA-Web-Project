import {existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const calendar=existsSync(path.join(root,'calendar-app/src'))?path.join(root,'calendar-app'):path.resolve(root,'../Centralised Calendar');
const vite=path.join(root,'node_modules/vite/bin/vite.js');
const calendarConfig=path.join(root,'calendar.vite.config.js');
for(const [cwd,args] of [[root,['build']],[root,['build','--config',calendarConfig,'--base=/calendar-app/','--outDir',path.join(root,'dist/calendar-app')]]]){
 const result=spawnSync(process.execPath,[vite,...args],{cwd,stdio:'inherit',env:process.env});
 if(result.status!==0)process.exit(result.status||1);
}

// Parse actual output as well as trusting the bundler: catch minifier/hoisting collisions.
for(const file of readdirSync(path.join(root,'dist'),{recursive:true}).filter(f=>f.endsWith('.js'))){
 const result=spawnSync(process.execPath,['--check',path.join(root,'dist',file)],{cwd:root,stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
