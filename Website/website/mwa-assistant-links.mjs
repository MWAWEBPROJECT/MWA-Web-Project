// Only same-origin absolute paths from the server-owned catalogue are actionable.
export function safeAssistantHref(href){
 return typeof href==='string' && href.startsWith('/') && !href.startsWith('//') && !/[\\\r\n]/.test(href);
}
