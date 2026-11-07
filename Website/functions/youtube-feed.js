const ID=/^[A-Za-z0-9_-]{11}$/;
const CHANNEL='mwa51214';
function completed(items){return items.filter(v=>ID.test(v.id)&&v.status?.privacyStatus==='public'&&v.liveStreamingDetails?.actualEndTime&&Number.isFinite(Date.parse(v.liveStreamingDetails.actualEndTime))).sort((a,b)=>Date.parse(b.liveStreamingDetails.actualEndTime)-Date.parse(a.liveStreamingDetails.actualEndTime)).slice(0,5).map(v=>({id:v.id,title:String(v.snippet?.title||'MWA livestream').slice(0,200),endedAt:v.liveStreamingDetails.actualEndTime,thumbnail:`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,embeddable:v.status.embeddable!==false}));}
async function fetchFeed(key,fetcher=fetch,cachedChannel=null){
 if(!key)throw Error('YouTube feed is not configured.');
 async function api(resource,params){const url=new URL('https://www.googleapis.com/youtube/v3/'+resource);url.search=new URLSearchParams({...params,key});const r=await fetcher(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('YouTube feed is temporarily unavailable.');return r.json();}
 const c=cachedChannel||(await api('channels',{part:'id,contentDetails',forHandle:CHANNEL})).items?.[0];if(!c?.id)throw Error('MWA channel could not be resolved.');
 // Traverse the uploads playlist (one quota unit per page), not expensive search.
 // Scan all available uploads so older-created broadcasts finishing recently count.
 // Never publish a partial top-five if the channel exceeds the bounded scan.
 const playlist=c.contentDetails?.relatedPlaylists?.uploads;
 if(!playlist)throw Error('MWA uploads playlist is unavailable.');
 let pageToken='',videos=[];
 for(let page=0;page<40;page++){
  const found=await api('playlistItems',{part:'contentDetails',playlistId:playlist,maxResults:'50',...(pageToken?{pageToken}:{})});
  const ids=(found.items||[]).map(x=>x.contentDetails?.videoId).filter(x=>ID.test(x));
  if(ids.length){const details=await api('videos',{part:'snippet,status,liveStreamingDetails',id:ids.join(',')});videos.push(...(details.items||[]));}
  pageToken=found.nextPageToken||'';if(!pageToken)break;
 }
 if(pageToken)throw Error('Channel scan limit reached; cached feed preserved.');
 return {items:completed([...new Map(videos.map(v=>[v.id,v])).values()]),channelId:c.id,uploadsPlaylist:playlist,updatedAt:new Date().toISOString(),scanLimited:!!pageToken};
}
async function refresh(db,key){
 const ref=db.doc('_publicFeeds/youtube');
 const lease=await db.runTransaction(async tx=>{const old=(await tx.get(ref)).data()||{};if(old.leaseUntil>Date.now())return false;tx.set(ref,{leaseUntil:Date.now()+240000},{merge:true});return old;});if(!lease)return;
 try{const cached=lease.channelId&&lease.uploadsPlaylist?{id:lease.channelId,contentDetails:{relatedPlaylists:{uploads:lease.uploadsPlaylist}}}:null;const data=await fetchFeed(key,fetch,cached);await ref.set({...data,leaseUntil:0,error:false});}
 catch{await ref.set({leaseUntil:0,error:true,lastAttemptAt:new Date().toISOString()},{merge:true});}
}
async function serve(db,res){const data=(await db.doc('_publicFeeds/youtube').get()).data();res.set('Cache-Control','public,max-age=300');if(!data?.updatedAt)return res.status(503).json({items:[],error:'Recent livestreams will appear when the feed is connected.'});
 const expired=Date.now()-Date.parse(data.updatedAt)>86400000;
 return res.json({items:expired?[]:data.items,updatedAt:data.updatedAt,stale:!!data.error||expired});}
module.exports={completed,fetchFeed,refresh,serve};
