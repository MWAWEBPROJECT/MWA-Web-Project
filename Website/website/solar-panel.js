import { calculatePrayerTimes, MWA_LOCATION } from '../../Centralised Calendar/src/utils/prayerTimes.js';

// The arc is a schematic of today's daylight at the MWA centre, rather than a compass view.
export function sunState(now = new Date()) {
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: MWA_LOCATION.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
 }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
 const date = `${parts.year}-${parts.month}-${parts.day}`;
 const times = calculatePrayerTimes(date);
 const minutes = value => { const [h,m] = value.split(':').map(Number); return h*60+m; };
 const current = Number(parts.hour)*60+Number(parts.minute)+Number(parts.second)/60;
 const sunrise = minutes(times.sunrise), sunset = minutes(times.sunset);
 const progress = Math.max(0,Math.min(1,(current-sunrise)/(sunset-sunrise)));
 const visible = current >= sunrise && current <= sunset;
 return { date, times, visible, progress, x:34+592*progress, y:111-316*progress*(1-progress),
  label:visible?(current<minutes(times.zohrain)?'Morning sun':'Afternoon sun'):'Sun below the horizon' };
}

export function updateSun(now = new Date()) {
 const panel = document.querySelector('.sun-journey');
 if (!panel) return;
 const state = sunState(now), marker = panel.querySelector('.sun-motion');
 marker.setAttribute('transform',`translate(${state.x} ${state.y})`);
 marker.style.opacity = state.visible ? '1' : '0';
 const format = value => {const [h,m] = value.split(':').map(Number); return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'am':'pm'}`;};
 for(const [key,prayer] of [['prayer_0','fajr'],['prayer_2','zohrain'],['prayer_4','maghreb']]){const node=document.querySelector('[data-prayer-time="'+key+'"]');if(node)node.textContent=format(state.times[prayer]);}
 document.querySelector('#solar-sunrise').textContent = format(state.times.sunrise);
 document.querySelector('#solar-sunset').textContent = format(state.times.sunset);
 document.querySelector('#solar-status').textContent = state.label;
 panel.setAttribute('aria-label',`Kemps Creek NSW 2178. ${state.label}. Sunrise ${format(state.times.sunrise)}, sunset ${format(state.times.sunset)}. Current local time ${new Intl.DateTimeFormat('en-AU',{timeZone:MWA_LOCATION.timeZone,hour:'numeric',minute:'2-digit'}).format(now)}.`);
}

if (typeof document !== 'undefined') {
 updateSun();
 setInterval(updateSun,60000);
 window.addEventListener('mwa-content-rendered',()=>updateSun());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateSun();});
}
