import './mobile-menu.css';
export function initMobileMenu(){
 const trigger=document.getElementById('menu'),navigation=document.querySelector('.header-navigation'),home=document.querySelector('.home-header'),member=document.querySelector('.header-in [data-action="login"]'),admin=document.querySelector('.header-in .admin-header-slot');
 if(!trigger||!navigation||!home||!member||!admin)return;
 const drawer=document.createElement('dialog');drawer.id='mwa-mobile-menu';drawer.className='mwa-mobile-menu';drawer.setAttribute('aria-labelledby','mwa-mobile-menu-title');
 drawer.innerHTML='<div class="mobile-menu-heading"><div><small>MUHAMMADI WELFARE ASSOCIATION</small><h2 id="mwa-mobile-menu-title">Explore MWA</h2></div><button type="button" aria-label="Close navigation">×</button></div><div class="mobile-menu-scroll"><div class="mobile-menu-pages"></div><div class="mobile-menu-account"><h3>Your account</h3></div></div>';
 document.body.append(drawer);
 const pages=drawer.querySelector('.mobile-menu-pages'),accounts=drawer.querySelector('.mobile-menu-account'),closeButton=drawer.querySelector('[aria-label="Close navigation"]');
 const items=[[home,pages],[navigation,pages],[member,accounts],[admin,accounts]].map(([node,target])=>{const marker=document.createComment('mobile menu return point');node.before(marker);return {node,target,marker};});
 const media=matchMedia('(max-width:960px)');let previousOverflow='';
 trigger.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
 trigger.setAttribute('aria-label','Open navigation');trigger.setAttribute('aria-controls',drawer.id);trigger.setAttribute('aria-haspopup','dialog');
 const appearance=document.getElementById('appearance-open'),label=document.createElement('span');label.className='mobile-appearance-label';label.textContent='Appearance & text size';appearance.append(label);
 function close(restore=true){if(!drawer.open)return;drawer.close();document.body.style.overflow=previousOverflow;trigger.setAttribute('aria-expanded','false');if(restore&&media.matches)trigger.focus({preventScroll:true});}
 function open(){if(!media.matches||drawer.open)return;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';drawer.showModal();trigger.setAttribute('aria-expanded','true');closeButton.focus();}
 trigger.onclick=open;closeButton.onclick=()=>close();drawer.addEventListener('cancel',event=>{event.preventDefault();close();});
 drawer.addEventListener('click',event=>{if(event.target===drawer){const box=drawer.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();}});
 // Close before existing handlers open login/appearance dialogs or sign out.
 drawer.addEventListener('click',event=>{if(event.target.closest('.mobile-menu-scroll a,.mobile-menu-scroll button'))close();},true);
 function currentHome(){if(location.pathname==='/'&&(!location.hash||location.hash==='#main'))home.setAttribute('aria-current','page');else home.removeAttribute('aria-current');}
 window.addEventListener('hashchange',()=>{close(false);currentHome();});currentHome();
 function layout(){close(false);for(const {node,target,marker} of items){if(media.matches)target.append(node);else marker.after(node);}document.getElementById('nav').classList.remove('open');trigger.setAttribute('aria-expanded','false');}
 media.addEventListener('change',layout);layout();
}
