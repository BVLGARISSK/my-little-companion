const MANUAL_URL='https://quadcopteronline.org/manual/';
document.getElementById('copy-manual-url').addEventListener('click',async()=>{
  const status=document.getElementById('copy-status');
  try{await navigator.clipboard.writeText(MANUAL_URL);status.textContent='已複製說明書網址。';}
  catch{status.textContent='請長按上方網址，選擇複製連結。';}
});
document.getElementById('copy-control-url').addEventListener('click',async()=>{
  const url='https://quadcopteronline.org/#device',status=document.getElementById('control-copy-status');
  const fallback=document.getElementById('control-link-fallback'),input=document.getElementById('control-link');
  try{await navigator.clipboard.writeText(url);fallback.hidden=true;status.textContent='已複製控制頁網址。第一次使用請另外掃描吊飾的專屬配對 QR；這個公開網址不含授權碼。';}
  catch{input.value=url;fallback.hidden=false;input.focus();input.select();status.textContent='請長按下方控制頁網址並複製。這個網址不含授權碼。';}
});
