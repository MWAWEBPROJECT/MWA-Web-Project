import logoUrl from '../assets/mwa-logo.png';
import {schemes,defaults,bookingTonePalette,bookingToneIndex,readableInk,contrastRatio} from '@mwa/appearance';

export const W=864,H=1223,SCALE=3,MARGIN=36,BODY_BOTTOM=1128;
export const SANS="'Segoe UI',system-ui,-apple-system,Arial,sans-serif";
export const SITE='refreshed.muhammadiwelfare.org.au/calendar/';
export const text=value=>String(value??'').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\u00a0/g,' ');

export function resolvePdfTheme(opts={}){
 const root=typeof document==='undefined'?null:document.documentElement;
 const palette=schemes[opts.palette]?opts.palette:(root?.dataset.palette||defaults.palette);
 const light=schemes[palette]?.light||schemes.green.light;
 const css=root&&!opts.palette?getComputedStyle(root):null;
 const get=key=>css?.getPropertyValue('--print-'+key).trim()||light[key];
 const theme={palette,primary:get('primary'),ink:get('ink'),muted:get('muted'),soft:get('soft'),line:get('line'),accent:get('accent'),paper:'#ffffff'};
 if(contrastRatio(theme.accent,'#ffffff')<4.5)theme.accent=theme.ink;
 theme.onPrimary=readableInk(theme.primary,theme.ink);
 theme.tones=bookingTonePalette(theme.primary,theme.ink,'#ffffff');
 theme.toneFor=event=>theme.tones[bookingToneIndex((opts.departments||[]).find(d=>d.id===event.departmentId)||{name:event.department})];
 theme.programmeTone=theme.tones[bookingToneIndex((opts.departments||[]).find(d=>String(d.name).trim().toLowerCase()==='mwa programs')||{name:'MWA Programs'})];
 return theme;
}
export function loadImage(src){return new Promise((resolve,reject)=>{const image=new Image();if(/^https?:/.test(src))image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Could not load the MWA logo.'));image.src=src})}
export async function pdfLogo(opts={}){if(opts.logo)return opts.logo;const source=opts.logoSource||(typeof document!=='undefined'?document.querySelector('.brand-logo-tile img')?.src:null)||defaults.logo||logoUrl;try{return await loadImage(source)}catch{return loadImage(logoUrl)}}
export function makeCanvas(opts={}){const canvas=opts.createCanvas?opts.createCanvas(W*SCALE,H*SCALE):document.createElement('canvas');canvas.width=W*SCALE;canvas.height=H*SCALE;const ctx=canvas.getContext('2d');ctx.setTransform(SCALE,0,0,SCALE,0,0);return {canvas,ctx}}
export async function ensureFonts(){if(typeof document!=='undefined'&&document.fonts?.load)await Promise.all([document.fonts.load(`600 24px ${SANS}`),document.fonts.load(`400 12px ${SANS}`)].map(task=>task.catch(()=>null)))}
export function font(ctx,size,weight=400){ctx.font=`${weight} ${size}px ${SANS}`}
export function fit(ctx,value,maxWidth,size=14,weight=400,min=8){let next=size;do{font(ctx,next,weight);if(ctx.measureText(text(value)).width<=maxWidth)break;next-=.5}while(next>min);return next}
export function wrap(ctx,value,width){const out=[];let current='';for(const word of text(value).split(/\s+/)){if(!word)continue;const candidate=current?current+' '+word:word;if(ctx.measureText(candidate).width<=width){current=candidate;continue}if(current){out.push(current);current=''}let piece='';for(const char of word){if(piece&&ctx.measureText(piece+char).width>width){out.push(piece);piece=''}piece+=char}current=piece}if(current)out.push(current);return out}
export function rounded(ctx,x,y,w,h,r=10){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function tracked(ctx,value,x,y,spacing=1){let cursor=x;for(const char of value){ctx.fillText(char,cursor,y);cursor+=ctx.measureText(char).width+spacing}}
export function startPage(ctx,theme,decorative=false){ctx.clearRect(0,0,W,H);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);if(decorative){ctx.strokeStyle=theme.line;ctx.lineWidth=1;rounded(ctx,18,18,W-36,H-36,15);ctx.stroke()}}
export function drawHeader(ctx,logo,theme,info,decorative=false){
 ctx.save();ctx.textBaseline='alphabetic';ctx.textAlign='left';
 const logoH=65,logoW=65*logo.width/logo.height;ctx.drawImage(logo,MARGIN,28,logoW,logoH);
 const x=MARGIN+logoW+14;ctx.fillStyle=theme.ink;fit(ctx,'Muhammadi Welfare Association',W-MARGIN-x-130,24,600,17);ctx.fillText('Muhammadi Welfare Association',x,53);
 ctx.fillStyle=theme.muted;font(ctx,10.2,400);tracked(ctx,'FAITH · KNOWLEDGE · COMMUNITY',x,75,.8);
 ctx.textAlign='right';ctx.fillStyle=theme.muted;font(ctx,8.2,500);ctx.fillText('KEMPS CREEK · NSW',W-MARGIN,50);font(ctx,8.5);ctx.fillText('NSW 2178 · Australia',W-MARGIN,66);
 ctx.strokeStyle=theme.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(MARGIN,108);ctx.lineTo(W-MARGIN,108);ctx.stroke();
 if(decorative){ctx.fillStyle=theme.soft;rounded(ctx,26,120,W-52,83,12);ctx.fill();ctx.save();ctx.strokeStyle=theme.primary;ctx.globalAlpha=.18;for(const radius of [27,40,53,66]){ctx.beginPath();ctx.arc(W-88,178,radius,Math.PI,Math.PI*2);ctx.lineTo(W-88+radius,202);ctx.stroke()}ctx.restore();if(info.arabic){ctx.save();ctx.globalAlpha=.13;ctx.fillStyle=theme.primary;ctx.direction='rtl';ctx.textAlign='center';ctx.font="600 36px 'Segoe UI',Arial,sans-serif";ctx.fillText(info.arabic,W-210,178);ctx.restore()}}
 ctx.textAlign='left';ctx.fillStyle=theme.accent;font(ctx,8.5,600);tracked(ctx,text(info.kicker).toUpperCase(),MARGIN,137,1.1);
 ctx.fillStyle=theme.ink;fit(ctx,info.title,510,32,600,20);ctx.fillText(text(info.title),MARGIN,172);
 ctx.textAlign='right';ctx.fillStyle=theme.ink;fit(ctx,info.subtitle,230,13,500,9);ctx.fillText(text(info.subtitle),W-MARGIN,166);
 ctx.textAlign='left';ctx.fillStyle=theme.muted;fit(ctx,info.detail||'',W-2*MARGIN,10.5,400,8);ctx.fillText(text(info.detail||''),MARGIN,191);
 ctx.restore();
}
export function drawFooter(ctx,theme,page,pages,generatedAt=new Date()){
 ctx.save();ctx.strokeStyle=theme.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(MARGIN,1153);ctx.lineTo(W-MARGIN,1153);ctx.stroke();ctx.textAlign='left';ctx.fillStyle=theme.accent;font(ctx,10.3,500);ctx.fillText(SITE,MARGIN,1175);ctx.fillStyle=theme.muted;font(ctx,8.7);ctx.fillText('81-89 Clifton Avenue, Kemps Creek NSW 2178',MARGIN,1191);font(ctx,8.2);ctx.fillText("Dates follow MWA's moon-sighting adjustments. Confirm current programmes online.",MARGIN,1206);ctx.textAlign='right';font(ctx,8.7);ctx.fillText('Generated '+generatedAt.toLocaleDateString('en-AU',{timeZone:'Australia/Sydney',day:'numeric',month:'short',year:'numeric'}),W-MARGIN,1175);ctx.fillText(`Page ${page} of ${pages}`,W-MARGIN,1191);ctx.restore();
}
const DATE_WIDTH=121,EVENT_X=MARGIN+272,EVENT_WIDTH=W-MARGIN-EVENT_X-12;
export function tableHead(ctx,theme,y,decorative=false){
 ctx.fillStyle=decorative?theme.primary:theme.soft;rounded(ctx,MARGIN,y,W-2*MARGIN,29,7);ctx.fill();ctx.fillStyle=decorative?theme.onPrimary:theme.ink;font(ctx,10.7,600);ctx.textAlign='left';ctx.fillText('Hijri date',MARGIN+12,y+19);ctx.fillText('Calendar date',MARGIN+142,y+19);ctx.fillText('Programme / event description',EVENT_X,y+19);return y+36;
}
export function prepareItems(ctx,items){return items.map(item=>{
 if(item.note){font(ctx,11);const lines=wrap(ctx,item.note,W-2*MARGIN-26);return {...item,lines,height:lines.length*15+22}}
 font(ctx,15,600);const titleLines=wrap(ctx,item.title,EVENT_WIDTH);
 font(ctx,11);const detailLines=wrap(ctx,item.detail||'',EVENT_WIDTH);
 const programmeLines=String(item.programDetails||'').split(/\r?\n/).flatMap(line=>line?wrap(ctx,line,EVENT_WIDTH):['']);
 if(!item.programDetails)programmeLines.length=0;
 font(ctx,9.5,500);const departmentLines=wrap(ctx,item.department||'',EVENT_WIDTH-14);
 font(ctx,11.5,600);const dateLines=wrap(ctx,item.hijriDate||'',DATE_WIDTH),secondaryLines=wrap(ctx,item.gregorianDate||'',DATE_WIDTH);
 const eventH=titleLines.length*20+detailLines.length*15+(programmeLines.length?6+programmeLines.length*15:0)+(departmentLines.length?departmentLines.length*14+7:0);
 return {...item,titleLines,detailLines,programmeLines,departmentLines,dateLines,secondaryLines,height:Math.max(eventH,dateLines.length*16,secondaryLines.length*16)+25};
})}
export function paginateItems(items,firstY,nextY=247){const pages=[{items:[],top:firstY}];let y=firstY;for(const item of items){let page=pages[pages.length-1];if(y+item.height>BODY_BOTTOM&&(page.items.length||y!==nextY)){page={items:[],top:nextY};pages.push(page);y=nextY}if(item.height>BODY_BOTTOM-y)throw Error('A calendar entry is too long to fit on a printed page. Please shorten the entry.');page.items.push(item);y+=item.height}return pages}
export function drawItems(ctx,theme,page,decorative=false,audit=[]){let y=page.top;for(const item of page.items){
 audit.push({id:item.id,title:item.title||item.note,top:y,bottom:y+item.height});
 if(item.note){ctx.fillStyle=theme.soft;rounded(ctx,MARGIN,y,W-2*MARGIN,item.height-5,8);ctx.fill();ctx.fillStyle=theme.muted;font(ctx,11);ctx.textAlign='left';item.lines.forEach((line,i)=>ctx.fillText(line,MARGIN+13,y+19+i*15));y+=item.height;continue}
 if(decorative){ctx.strokeStyle=theme.line;ctx.lineWidth=.8;rounded(ctx,MARGIN,y,W-2*MARGIN,item.height-5,9);ctx.stroke();ctx.fillStyle=theme.primary;rounded(ctx,MARGIN,y+9,3,item.height-23,1);ctx.fill()}else{ctx.strokeStyle=theme.line;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(MARGIN,y+item.height-3);ctx.lineTo(W-MARGIN,y+item.height-3);ctx.stroke()}
 ctx.textAlign='left';ctx.fillStyle=theme.ink;font(ctx,11.5,600);item.dateLines.forEach((line,i)=>ctx.fillText(line,MARGIN+12,y+19+i*16));item.secondaryLines.forEach((line,i)=>ctx.fillText(line,MARGIN+142,y+19+i*16));
 let ey=y+20;ctx.fillStyle=theme.ink;font(ctx,15,600);item.titleLines.forEach(line=>{ctx.fillText(line,EVENT_X,ey);ey+=20});ctx.fillStyle=theme.muted;font(ctx,11);item.detailLines.forEach(line=>{ctx.fillText(line,EVENT_X,ey);ey+=15});
 if(item.programmeLines.length){ey+=6;ctx.fillStyle=theme.ink;item.programmeLines.forEach(line=>{ctx.fillText(line,EVENT_X,ey);ey+=15})}
 if(item.departmentLines.length){ey+=6;const tone=theme.toneFor(item);const h=item.departmentLines.length*14+5;font(ctx,9.5,500);const tagWidth=Math.min(EVENT_WIDTH,Math.max(...item.departmentLines.map(line=>ctx.measureText(line).width))+14);ctx.fillStyle=tone.background;rounded(ctx,EVENT_X,ey-10,tagWidth,h,4);ctx.fill();ctx.fillStyle=tone.foreground;font(ctx,9.5,500);item.departmentLines.forEach(line=>{ctx.fillText(line,EVENT_X+7,ey);ey+=14})}y+=item.height
 }return y}
export function savePages(pdf,canvases,opts,filename,title){const format=opts.paperSize==='a3'?{name:'a3',w:297,h:420}:{name:'a4',w:210,h:297};canvases.forEach((canvas,index)=>{if(index)pdf.addPage(format.name,'portrait');pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,format.w,format.h,undefined,'FAST')});pdf.setProperties({title,author:'Muhammadi Welfare Association',creator:'MWA community website',subject:'Community events calendar'});if(!opts.returnDocument&&!opts.returnCanvas)pdf.save(filename);return canvases.length}
