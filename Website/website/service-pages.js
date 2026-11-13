import pages from '../shared/service-pages.json';
import './service-pages.css';
const route=location.pathname.replace(/\/+$/,'');const page=pages.find(p=>route==='/services/'+p.id);
if(page){
 const prefix='service_'+page.id.replaceAll('-','_')+'_';
 const main=document.createElement('main');main.id='service-main';main.className='service-page wrap';main.tabIndex=-1;
 // Markup is static; all CMS content is assigned with textContent, never interpreted as HTML.
 main.innerHTML=`<a class="service-back" href="/#services" aria-label="Back to services" title="Back to services">←</a>
 <nav class="service-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/#services">Services</a></nav>
 <section class="service-hero"><div><div class="eyebrow" data-service="eyebrow"></div><h1 data-service="title"></h1><p class="service-lead" data-service="intro"></p><button type="button" class="btn service-enquire">Make an enquiry <span aria-hidden="true">↗</span></button></div><figure class="service-page-photo"><img loading="eager"><figcaption data-service="photo_alt"></figcaption></figure></section>
 <div class="service-body-grid"><article class="service-prose"><p class="service-opening" data-service="body"></p><h2 data-service="section_title"></h2><p data-service="section_body"></p></article><aside class="service-contact"><div class="eyebrow">GET IN TOUCH</div><h2 data-service="contact_title"></h2><p data-service="contact_body"></p><a class="service-email"></a><a class="service-phone"></a><button type="button" class="btn alt service-enquire">Make an enquiry <span aria-hidden="true">↗</span></button></aside></div>
 <section class="service-more"><h2>Explore our services</h2><div class="service-siblings"></div></section>`;
 document.querySelector('#main').hidden=true;document.querySelector('#main').after(main);document.querySelector('.skip')?.setAttribute('href','#service-main');
 const image=main.querySelector('figure img');image.dataset.cmsPhoto=prefix+'photo';image.dataset.cmsAlt=prefix+'photo_alt';
 for(const other of pages.filter(p=>p.id!==page.id)){const a=document.createElement('a');a.href='/services/'+other.id+'/';a.textContent=other.title+' ↗';main.querySelector('.service-siblings').append(a);}
 for(const button of main.querySelectorAll('.service-enquire'))button.onclick=()=>document.querySelectorAll('#services [data-action="support"]')[pages.indexOf(page)]?.click();
 function render(){const content=window.MWA_PUBLIC_CONTENT||{};const value=key=>content[prefix+key]??page[key]??'';for(const el of main.querySelectorAll('[data-service]')){el.textContent=value(el.dataset.service);el.dataset.cms=prefix+el.dataset.service;}
  const photo=value('photo');main.querySelector('figure').hidden=!photo;main.querySelector('.service-hero').classList.toggle('without-photo',!photo);if(photo){image.src=photo;image.alt=value('photo_alt');}
  const email=main.querySelector('.service-email'),phone=main.querySelector('.service-phone');email.hidden=!value('email');email.textContent=value('email');email.href='mailto:'+value('email');phone.hidden=!value('phone');phone.textContent=value('phone');phone.href='tel:'+value('phone').replace(/[^+0-9]/g,'');document.title=value('title')+' | Muhammadi Welfare Association';
 }
 window.addEventListener('mwa-content-rendered',render);render();window.mwaPageReady?.();
}
