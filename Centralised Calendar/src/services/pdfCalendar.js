// Branded monthly calendar. Date/event selection remains in pdfModel.js.
import {W,H,SCALE,MARGIN,SANS,resolvePdfTheme,pdfLogo,makeCanvas,ensureFonts,font,fit,wrap,rounded,startPage,drawHeader,drawFooter,tableHead,prepareItems,paginateItems,drawItems,savePages,text} from './pdfBranding.js';

function monthGrid(ctx,sheet,theme,decorative){
 const x=MARGIN,w=W-2*MARGIN,top=218,col=w/7,rowH=sheet.weeks.length>5?41:47;
 ctx.fillStyle=theme.soft;rounded(ctx,x,top,w,25,7);ctx.fill();
 ctx.fillStyle=theme.ink;font(ctx,10,500);ctx.textAlign='center';
 ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach((day,i)=>ctx.fillText(day,x+col*(i+.5),top+17));
 let y=top+29;
 for(const week of sheet.weeks){
  week.forEach((cell,i)=>{if(!cell)return;const cx=x+col*(i+.5);if(cell.highlighted){ctx.fillStyle=theme.primary;rounded(ctx,cx-33,y+1,66,rowH-4,8);ctx.fill()}else if(decorative){ctx.fillStyle=theme.soft;ctx.globalAlpha=.55;rounded(ctx,cx-33,y+1,66,rowH-4,8);ctx.fill();ctx.globalAlpha=1}ctx.fillStyle=cell.highlighted?theme.onPrimary:theme.ink;font(ctx,21,600);ctx.fillText(cell.big,cx,y+23);ctx.fillStyle=cell.highlighted?theme.onPrimary:theme.muted;font(ctx,9.4,400);ctx.fillText(cell.small,cx,y+rowH-8)});
  y+=rowH;
 }
 ctx.textAlign='left';ctx.fillStyle=theme.muted;font(ctx,9.5);
 for(const note of sheet.notes){for(const line of wrap(ctx,'* '+note,w)){y+=13;ctx.fillText(line,x+4,y)}}
 return y+18;
}

function monthlyItems(model,notes){
 const result=[];
 for(const row of model.rows)row.events.forEach((event,index)=>result.push({...event,id:`${row.key}-${index}`,hijriDate:row.hijriDate,gregorianDate:row.gregorianDate,title:event.pending?event.title+' (Pending)':event.title}));
 if(!result.length)result.push({id:'empty',note:'No events scheduled for this selection.'});
 notes.forEach((note,index)=>result.push({id:'note-'+index,note}));return result;
}

export async function renderCalendarPdf(model,filename='MWA-Calendar.pdf',opts={}){
 const [{jsPDF},logo]=await Promise.all([import('jspdf'),pdfLogo(opts),ensureFonts()]);
 const theme=resolvePdfTheme(opts),decorative=opts.template==='decorative';
 const measurement=makeCanvas(opts);const firstHead=monthGrid(measurement.ctx,model.sheet,theme,decorative);
 const items=prepareItems(measurement.ctx,monthlyItems(model,(opts.notes||[]).map(String).map(n=>n.trim()).filter(Boolean)));
 const pages=paginateItems(items,firstHead+36);const canvases=[],audit=[];
 pages.forEach((page,index)=>{const {canvas,ctx}=index?makeCanvas(opts):measurement;startPage(ctx,theme,decorative);drawHeader(ctx,logo,theme,{kicker:index?'Monthly events calendar - continued':'Monthly events calendar',title:model.sheet.name,subtitle:model.sheet.yearLine,detail:index?`${model.eventCount} event(s) · ${text(model.footerLabel)}`:model.sheet.sub+' · '+model.eventCount+' event(s)',arabic:model.arabic},decorative);const head=index?211:monthGrid(ctx,model.sheet,theme,decorative);tableHead(ctx,theme,head,decorative);drawItems(ctx,theme,page,decorative,audit);drawFooter(ctx,theme,index+1,pages.length,opts.generatedAt);canvases.push(canvas)});
 const pdf=new jsPDF({unit:'mm',format:opts.paperSize==='a3'?'a3':'a4',orientation:'portrait',compress:true});
 savePages(pdf,canvases,opts,filename,`Muhammadi Welfare Association - Monthly Events Calendar - ${text(model.footerLabel)}`);
 if(opts.returnCanvas)return canvases.map(canvas=>canvas.toDataURL('image/png'));
 if(opts.returnDocument)return {pdf,canvases,pageCount:pages.length,audit,theme,eventCount:model.eventCount};
 return pages.length;
}
export function pdfFilename(model){return `MWA-Calendar-${model.footerLabel.replace(/\s*-\s*/g,'-').replace(/[^\w/-]+/g,'-').replace(/\//g,'-')}.pdf`}
