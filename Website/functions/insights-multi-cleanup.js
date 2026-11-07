const Snapshot=require('./insights-multi-snapshot');

async function run(db,{enabled=false,logger=console,cleanup=Snapshot.cleanupBatch}={}){
 if(!enabled)return {enabled:false};
 try{
  const result=await cleanup(db);
  logger.info('Temporary multi-event snapshot cleanup',result);
  return {enabled:true,...result};
 }catch(error){
  logger.error('Temporary multi-event snapshot cleanup failed',error);
  throw error;
 }
}
module.exports={run};
