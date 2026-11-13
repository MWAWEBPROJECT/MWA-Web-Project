// One-page annual overview, with a complete programme appendix if summaries overflow.
import {W,H,SCALE,MARGIN,BODY_BOTTOM,SANS,resolvePdfTheme,pdfLogo,makeCanvas,ensureFonts,font,fit,wrap,rounded,startPage,drawHeader,drawFooter,tableHead,prepareItems,paginateItems,drawItems,savePages,text} from './pdfBranding.js';
export {W,H,SCALE,MARGIN,SANS};
const TOP=214,GAP=14,COLS=3;

function planMonth(ctx,month,width,height,weeks){
 const rowH=weeks>5?19:21;const listTop=52+weeks*rowH+11;
 font(ctx,9.5);
 const lines=month.list.flatMap(entry=>wrap(ctx,`${entry.days} · ${entry.text}`,width-22));
 const notes=month.notes.flatMap(note=>wrap(ctx,'* '+note,width-22));
 const capacity=Math.max(0,Math.floor((height-listTop-9)/12));
 const overflow=lines.length+notes.length>capacity;
 const shown=overflow?[...lines,...notes].slice(0,Math.max(0,capacity-1)):[...lines,...notes];
 return {rowH,listTop,shown,overflow,weeks};
}
function drawMonth(ctx,month,plan,x,y,w,h,theme,decorative){
 ctx.fillStyle=decorative?theme.soft:'#fff';rounded(ctx,x,y,w,h,10);ctx.fill();ctx.strokeStyle=theme.line;ctx.lineWidth=.8;ctx.stroke();
 if(decorative){ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.strokeStyle=theme.primary;ctx.globalAlpha=.12;for(const r of [25,35,45]){ctx.beginPath();ctx.arc(x+w-12,y+35,r,Math.PI,2*Math.PI);ctx.stroke()}ctx.restore()}
 ctx.textAlign='left';ctx.fillStyle=theme.ink;fit(ctx,month.name,w-22,16,600,12);ctx.fillText(text(month.name),x+11,y+22);ctx.fillStyle=theme.muted;fit(ctx,month.sub,w-22,8.8,400,7.5);ctx.fillText(text(month.sub),x+11,y+36);
 const col=(w-18)/7;ctx.textAlign='center';font(ctx,8.2,500);['Mo','Tu','We','Th','Fr','Sa','Su'].forEach((day,index)=>ctx.fillText(day,x+9+col*(index+.5),y+49));
 for(let wi=0;wi<plan.weeks;wi++){const wy=y+54+wi*plan.rowH;(month.weeks[wi]||[]).forEach((cell,index)=>{if(!cell)return;const cx=x+9+col*(index+.5);if(cell.highlighted){ctx.fillStyle=theme.programmeTone.background;rounded(ctx,cx-col/2+1,wy,col-2,plan.rowH-1,4);ctx.fill()}ctx.fillStyle=cell.highlighted?theme.programmeTone.foreground:theme.ink;font(ctx,plan.rowH>19?14:12.8,600);ctx.fillText(cell.big,cx,wy+10.8);ctx.fillStyle=cell.highlighted?theme.programmeTone.foreground:theme.muted;font(ctx,7.5);ctx.fillText(cell.small,cx,wy+18)});}
 ctx.textAlign='left';ctx.fillStyle=theme.muted;font(ctx,9.5);let ly=y+plan.listTop+5;plan.shown.forEach(line=>{ctx.fillText(line,x+11,ly);ly+=12});if(plan.overflow){ctx.fillStyle=theme.accent;font(ctx,9.2,500);ctx.fillText('More programmes - see following pages',x+11,ly)}
}
function appendixItems(model){return model.months.flatMap(month=>[...(month.programmes||[]).map(event=>({...event,title:event.pending?event.title+' (Pending)':event.title})),...month.notes.map((note,index)=>({id:month.name+'-note-'+index,note:month.name+': '+note}))])}
export function yearPdfFilename(model){return `MWA-Calendar-${model.basis==='hijri'?'Hijri':'Gregorian'}-${model.title}.pdf`}

export async function renderYearCalendarPdf(model,filename,opts={}){
 const [{jsPDF},logo]=await Promise.all([import('jspdf'),pdfLogo(opts),ensureFonts()]);
 const theme=resolvePdfTheme(opts),decorative=opts.template==='decorative';
 const first=makeCanvas(opts);const rows=Math.ceil(model.months.length/COLS),width=(W-2*MARGIN-(COLS-1)*GAP)/COLS,height=(BODY_BOTTOM-TOP-(rows-1)*GAP)/rows;
 const plans=model.months.map((month,index)=>{const peers=model.months.slice(Math.floor(index/COLS)*COLS,Math.floor(index/COLS)*COLS+COLS);return planMonth(first.ctx,month,width,height,Math.max(...peers.map(peer=>peer.weeks.length)))});
 const overflow=plans.some(plan=>plan.overflow);const departmentId=(opts.departments||[]).find(d=>String(d.name).trim().toLowerCase()==='mwa programs')?.id;
 const fullItems=appendixItems(model);const appendix=fullItems.length?paginateItems(prepareItems(first.ctx,fullItems),247):[];
 const count=1+appendix.length,audit=[],canvases=[first.canvas];
 startPage(first.ctx,theme,decorative);drawHeader(first.ctx,logo,theme,{kicker:`${model.basis==='hijri'?'Hijri':'Gregorian'} annual events calendar`,title:model.title+(model.basis==='hijri'?' AH':''),subtitle:model.subtitle,detail:`${model.eventCount} confirmed programme(s) · Highlighted dates: MWA programmes${appendix.length?' · Full programme follows':''}`},decorative);
 model.months.forEach((month,index)=>drawMonth(first.ctx,month,plans[index],MARGIN+(index%COLS)*(width+GAP),TOP+Math.floor(index/COLS)*(height+GAP),width,height,theme,decorative));
 drawFooter(first.ctx,theme,1,count,opts.generatedAt);
 appendix.forEach((page,index)=>{const {canvas,ctx}=makeCanvas(opts);startPage(ctx,theme,decorative);drawHeader(ctx,logo,theme,{kicker:'Annual programme - full listing',title:model.title+(model.basis==='hijri'?' AH':''),subtitle:model.subtitle,detail:'Programme dates correspond to the annual overview. Times are Australia/Sydney.'},decorative);tableHead(ctx,theme,211,decorative);drawItems(ctx,theme,page,decorative,audit);drawFooter(ctx,theme,index+2,count,opts.generatedAt);canvases.push(canvas)});
 const pdf=new jsPDF({unit:'mm',format:opts.paperSize==='a3'?'a3':'a4',orientation:'portrait',compress:true});
 savePages(pdf,canvases,opts,filename||yearPdfFilename(model),`Muhammadi Welfare Association - ${model.basis==='hijri'?'Hijri':'Gregorian'} Annual Events Calendar ${model.title}`);
 if(opts.returnCanvas)return first.canvas;
 if(opts.returnDocument)return {pdf,canvases,pageCount:count,audit,theme,overflow,summaryPlans:plans,eventCount:model.eventCount};
 return count;
}
