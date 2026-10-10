// Keep a complete pairing link in memory for a browser handoff, while the app
// removes credentials from the visible address. Never include this in backups.
export function readPairing(href){
  const url=new URL(href),params=new URLSearchParams(url.hash.slice(1));
  const key=params.get('key');
  if(!/^[a-f0-9]{64}$/i.test(key||''))return null;
  const device=params.get('device')||null;
  const fragment=new URLSearchParams();
  if(device)fragment.set('device',device);
  fragment.set('key',key);
  url.hash=fragment.toString();
  return{key,device,url:url.href};
}
