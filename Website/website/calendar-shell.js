// Keep calendar styles and booking dialogs isolated while sharing the website origin/session.
import {goAdminBack,recordAdminPage} from '@calendar/utils/adminNavigation.mjs';
export function mountCalendarShell() {
 const route=location.pathname.replace(/\/$/,'');
 if (!['/calendar','/islamic-events','/calendar-management','/tools-automation'].includes(route)) return;
 const islamic=route==='/islamic-events';
 const moduleView=({'/calendar-management':'calendar-management','/tools-automation':'tools'})[route];
 document.body.classList.add('mwa-calendar-page');
 document.querySelector('#main').hidden = true;
 const main = document.createElement('main');
 main.id = 'calendar-main';
 main.tabIndex = -1;
 const frame = document.createElement('iframe');
 frame.id = 'mwa-calendar-frame';
 frame.title = moduleView?(moduleView==='tools'?'MWA Tools & Automation':'MWA Calendar Management'):islamic?'MWA Key Islamic Events':'MWA Events & Bookings Calendar';
 const query=new URLSearchParams(location.search);
 recordAdminPage();
 if(moduleView)query.set('view',moduleView);
 if(islamic)query.set('view','islamic-events');
 query.set('release', __MWA_BUILD_ID__);
 const ready=event=>{if(event.origin===location.origin&&event.source===frame.contentWindow&&event.data?.type==='mwa-page-ready'){window.mwaPageReady?.();window.removeEventListener('message',ready);}};
 window.addEventListener('message',ready);
 window.addEventListener('message',event=>{
  if(event.origin===location.origin&&event.source===frame.contentWindow&&event.data?.type==='mwa-admin-back')goAdminBack();
 });
 frame.src = '/calendar-app/' + (query.size?'?'+query.toString():'') + location.hash;
 main.append(frame);
 document.querySelector('#main').after(main);
 document.querySelector('.skip').setAttribute('href','#calendar-main');
 document.querySelector('.nav a[href="'+route+'/"]')?.setAttribute('aria-current','page');
 const resize = () => document.documentElement.style.setProperty('--mwa-header-height',main.getBoundingClientRect().top+'px');
 new ResizeObserver(resize).observe(document.querySelector('.header'));
 window.addEventListener('resize',resize);
 resize();
}
