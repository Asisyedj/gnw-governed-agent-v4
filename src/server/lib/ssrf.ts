import { isPrivateOrLocalHost, assertHttpsUrl } from "../security.js";
export function isPrivateAddress(host:string):boolean{return isPrivateOrLocalHost(host);}
export function isSafeExternalUrl(rawUrl:string):boolean{try{const u=assertHttpsUrl(rawUrl);return !isPrivateOrLocalHost(u.hostname);}catch{return false;}}
export function assertSafeUrl(rawUrl:string):void{if(!isSafeExternalUrl(rawUrl))throw new Error(`[GNW] SSRF blocked — unsafe outbound URL: ${rawUrl}`);}