import {writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import qrcode from '../web-app/vendor/qrcode.js';
import {crc32} from '../web-app/js/media.js';

// Keep this address stable when updating the manual content.
const url='https://quadcopteronline.org/manual/';
const qr=qrcode(0,'M');qr.addData(url,'Byte');qr.make();
const n=qr.getModuleCount(),quiet=4,cell=16,size=(n+quiet*2)*cell;
const pixels=Buffer.alloc((size+1)*size,255);
for(let y=0;y<size;y++){
  pixels[y*(size+1)]=0;
  for(let x=0;x<size;x++){
    const row=Math.floor(y/cell)-quiet,col=Math.floor(x/cell)-quiet;
    if(row>=0&&row<n&&col>=0&&col<n&&qr.isDark(row,col))pixels[y*(size+1)+1+x]=0;
  }
}
function chunk(type,data){
  const label=Buffer.from(type),out=Buffer.alloc(data.length+12);
  out.writeUInt32BE(data.length);label.copy(out,4);data.copy(out,8);
  out.writeUInt32BE(crc32(Buffer.concat([label,data])),8+data.length);return out;
}
const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const svg=qr.createSvgTag({cellSize:cell,margin:quiet*cell,scalable:true});
const card=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1300" viewBox="0 0 1000 1300">
<rect width="1000" height="1300" fill="#fff"/><rect x="26" y="26" width="948" height="1248" rx="34" fill="#faf8f3" stroke="#b8c8aa" stroke-width="3"/>
<g text-anchor="middle" font-family="Microsoft JhengHei, Noto Sans CJK TC, sans-serif" fill="#3f5044">
<text x="500" y="130" font-size="54" font-weight="600">小伴使用說明書</text>
<text x="500" y="194" font-size="29" fill="#748269">掃描查看最新操作指南</text>
</g>
${svg.replace('<svg ','<svg x="170" y="250" width="660" height="660" ')}
<g text-anchor="middle" font-family="Microsoft JhengHei, Noto Sans CJK TC, sans-serif">
<text x="500" y="984" font-size="29" fill="#3f5044">配對連線 · 作品字幕 · 互動省電</text>
<text x="500" y="1046" font-size="27" fill="#748269">內容持續更新，請保留這張卡</text>
<text x="500" y="1130" font-size="28" fill="#3f5044">quadcopteronline.org/manual/</text>
<text x="500" y="1200" font-size="23" fill="#7b8373">控制吊飾請使用另外附上的專屬配對卡</text>
</g></svg>`;
const target=new URL('../web-app/manual/',import.meta.url);
await writeFile(new URL('qr.png',target),png);
await writeFile(new URL('qr.svg',target),svg+'\n');
await writeFile(new URL('qr-card.svg',target),card+'\n');
console.log(JSON.stringify({url,modules:n,quiet_modules:quiet,png_pixels:size,contains_pairing_credentials:false}));
