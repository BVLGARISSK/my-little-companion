const MANUAL_URL='https://quadcopteronline.org/manual/';
document.getElementById('copy-manual-url').addEventListener('click',async()=>{
  const status=document.getElementById('copy-status');
  try{await navigator.clipboard.writeText(MANUAL_URL);status.textContent='已複製說明書網址。';}
  catch{status.textContent='請長按上方網址，選擇複製連結。';}
});
