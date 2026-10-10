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

// A freshly scanned card replaces a stale remembered key after factory reset.
// A card for another device must never be used to authorize this connection.
export function pairingKeyForDevice(key,cardDevice,connectedDevice,saved){
  return key&&(!cardDevice||cardDevice===connectedDevice)?key:saved||'';
}

// Bluefy can reuse a tab and navigate only its fragment without reloading.
// Consume both initial and later QR links; never leave the credential visible.
export function watchPairingLinks(win,onPairing){
  const receive=()=>{
    const pairing=readPairing(win.location.href);
    if(!pairing)return;
    win.history.replaceState(null,'',win.location.pathname+win.location.search);
    onPairing(pairing);
  };
  win.addEventListener('hashchange',receive);
  receive();
  return()=>win.removeEventListener('hashchange',receive);
}
