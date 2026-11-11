import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
// Bundle the actual browser algorithms into the deployable functions directory.
// Regenerated before every website build and functions deployment; do not edit output.
await build({stdin:{contents:`export {calculatePrayerTimes,MWA_LOCATION} from '../Centralised Calendar/src/utils/prayerTimes.js';export {HIJRI_MONTHS,getHijriParts,getHijriMonthLength,adjustedIslamicToGregorian} from '../Centralised Calendar/src/services/hijriService.js';`,resolveDir:root,loader:'js'},bundle:true,platform:'node',format:'cjs',outfile:path.join(root,'functions/generated/calendar-runtime.cjs'),banner:{js:'// Generated from canonical Calendar algorithms by sync-ai-calendar.mjs.'}});
