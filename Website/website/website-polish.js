// Accessible shared chrome and swipeable pathways; no booking or login logic.
const track=document.querySelector('#pathway-track');
if(track){
 const cards=[...track.querySelectorAll('.path-card')];
 const dots=[...document.querySelectorAll('[data-pathway]')];
 const previous=document.querySelector('#pathway-prev'),next=document.querySelector('#pathway-next');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let active=0,frame;
 const offsets=()=>cards.map(card=>Math.min(card.offsetLeft-cards[0].offsetLeft,track.scrollWidth-track.clientWidth));
 function sync(){const positions=offsets();active=positions.reduce((best,x,i)=>Math.abs(x-track.scrollLeft)<=Math.abs(positions[best]-track.scrollLeft)?i:best,0);previous.disabled=track.scrollLeft<=2;next.disabled=track.scrollLeft>=track.scrollWidth-track.clientWidth-2;dots.forEach((dot,i)=>dot.setAttribute('aria-current',String(i===active)));document.querySelector('#pathway-position').textContent=`${active+1} / ${cards.length}`;}
 function go(i){const target=Math.max(0,Math.min(cards.length-1,i));track.scrollTo({left:offsets()[target],behavior:reduced.matches?'instant':'smooth'});}
 previous.addEventListener('click',()=>go(active-1));next.addEventListener('click',()=>go(active+1));dots.forEach((dot,i)=>dot.addEventListener('click',()=>go(i)));
 track.addEventListener('scroll',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(sync)},{passive:true});
 track.addEventListener('keydown',event=>{if(event.target!==track)return;const keys={ArrowLeft:active-1,ArrowRight:active+1,Home:0,End:cards.length-1};if(event.key in keys){event.preventDefault();go(keys[event.key]);}});
 track.addEventListener('focusin',event=>{const card=event.target.closest('.path-card');if(card){const box=card.getBoundingClientRect(),viewport=track.getBoundingClientRect();if(box.left<viewport.left||box.right>viewport.right+2)go(cards.indexOf(card));}});
 new ResizeObserver(sync).observe(track);sync();
}
const nav=document.querySelector('#nav');
function updateCurrentLink(){for(const link of nav.querySelectorAll('a')){const url=new URL(link.href);const current=url.pathname===location.pathname&&(url.hash?url.hash===location.hash:!location.hash);if(current)link.setAttribute('aria-current',url.hash?'location':'page');else link.removeAttribute('aria-current');}}
window.addEventListener('hashchange',updateCurrentLink);updateCurrentLink();
document.querySelector('a[href="/#community-news"]')?.addEventListener('click',()=>{document.querySelector('[data-panel="2"]')?.click();});

const chromeHeader=document.querySelector('.header');new ResizeObserver(()=>document.documentElement.style.setProperty('--mwa-chrome-height',chromeHeader.getBoundingClientRect().height+'px')).observe(chromeHeader);

// Reveal the specific carousel card, correcting asynchronous layout shifts briefly.
let stopPathwayFocus=()=>{};
function focusLinkedPathway(){
 stopPathwayFocus();if(location.hash!=='#tutoring')return;
 const target=document.getElementById('tutoring');if(!target)return;
 const align=()=>target.scrollIntoView({block:'start',inline:'start',behavior:'instant'});
 const observer=new ResizeObserver(align);observer.observe(document.body);
 const events=['wheel','touchstart','pointerdown','keydown'];
 const stop=()=>{observer.disconnect();clearTimeout(timer);events.forEach(name=>window.removeEventListener(name,stop));};
 const timer=setTimeout(stop,10000);stopPathwayFocus=stop;
 events.forEach(name=>window.addEventListener(name,stop,{once:true,passive:true}));requestAnimationFrame(align);
}
window.addEventListener('hashchange',focusLinkedPathway);focusLinkedPathway();
