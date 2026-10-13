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

export function pairingAuthorizationForDevice(key,cardDevice,connectedDevice,saved){
  const selected=pairingKeyForDevice(key,cardDevice,connectedDevice,saved);
  const matchingCard=!!key&&(!cardDevice||cardDevice===connectedDevice);
  return{key:selected,remember:!!selected&&(matchingCard||!!saved)};
}

// Only a key accepted by the connected companion is written to its own entry.
export async function rememberVerifiedPairing(store,connection,key,remember=true){
  const info=connection.info,epoch=connection.connectionEpoch;
  if(!connection.connected||!connection.authorized||!info?.device_id||!/^[a-f0-9]{64}$/i.test(key||''))throw new Error('請先完成這台吊飾的授權。');
  await store.put('key:'+info.device_id,remember?key:null);
  return connection.connected&&connection.authorized&&connection.info===info&&connection.connectionEpoch===epoch&&remember;
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
