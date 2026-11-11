const menu=document.getElementById('mwa-support-menu');
document.addEventListener('click',event=>{if(menu?.open&&(!menu.contains(event.target)||event.target.closest('a')))menu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary').focus();}});

document.addEventListener('click',event=>{const cancel=event.target.closest('[data-form-cancel]');if(!cancel)return;const form=cancel.closest('form');if(!form||!confirm('Cancel this form? Unsaved entries will be cleared.'))return;form.reset();if(form.id==='demo-form')document.getElementById('close-modal')?.click();else document.querySelector('.home-header')?.click();});

if(new URLSearchParams(location.search).get('appearance')==='open')requestAnimationFrame(()=>document.getElementById('appearance-open')?.click());
