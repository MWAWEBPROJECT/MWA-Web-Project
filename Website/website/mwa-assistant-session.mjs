// Initial auth readiness is not an identity change; do not erase a guest's first question.
export function watchAssistantIdentity(read,clear){
 const signature=()=>{const value=read();return JSON.stringify([value.uid||null,!!value.isAdmin,[...(value.modules||[])].sort()]);};
 let previous=signature();
 return ()=>{const next=signature();if(next!==previous){previous=next;clear();}};
}
