import {UUID,PROTOCOL,fragmentMessage,MessageAssembler,dataPacket,authProof} from './protocol.js';
import {crc32,encodeOLA} from './media.js';

export class CompanionBLE extends EventTarget {
  constructor(){super();this.pending=new Map();this.assembler=new MessageAssembler();this.nextId=1;this.maxWrite=20;this.authorized=false;this.busy=false;this.info=null;this.latestAck=null;}
  get connected(){return !!this.device?.gatt?.connected;}
  emit(name,detail){this.dispatchEvent(new CustomEvent(name,{detail}));}
  async connect(){
    if(!globalThis.navigator?.bluetooth)throw new Error('請在 iPhone 的 Bluefy 開啟這個網址，才可以使用藍牙。');
    if(!globalThis.isSecureContext)throw new Error('藍牙需要 HTTPS 網址。');
    if(this.connected)this.disconnect();
    this.device=await navigator.bluetooth.requestDevice({filters:[{services:[UUID.service]}]});
    this.device.addEventListener('gattserverdisconnected',()=>this.onDisconnect());
    try{
      const server=await this.device.gatt.connect(),service=await server.getPrimaryService(UUID.service);
      this.control=await service.getCharacteristic(UUID.control);this.data=await service.getCharacteristic(UUID.data);
      this.events=await service.getCharacteristic(UUID.event);this.infoChar=await service.getCharacteristic(UUID.info);
      const value=await this.infoChar.readValue();this.info=JSON.parse(new TextDecoder().decode(value));
      if(this.info.protocol!==PROTOCOL||typeof this.info.device_id!=='string'||!this.info.device_id.length)throw new Error('這台吊飾的韌體還不支援目前網頁。');
      this.maxWrite=Number.isInteger(this.info.max_write_bytes)?Math.max(20,Math.min(244,this.info.max_write_bytes)):20;
      this.events.addEventListener('characteristicvaluechanged',e=>this.onEvent(e.target.value));
      await this.events.startNotifications();this.emit('state',{connected:true,authorized:false,info:this.info});return this.info;
    }catch(error){this.disconnect();throw error;}
  }
  onDisconnect(){
    this.authorized=false;this.info=null;this.assembler.clear();this.latestAck=null;
    for(const p of this.pending.values())p.reject(new Error('連線中斷；已完成的作品會留在吊飾。'));this.pending.clear();
    this.ackWaiter?.reject(new Error('連線中斷，重新連線後可再同步。'));this.ackWaiter=null;
    this.emit('state',{connected:false,authorized:false,info:null});
  }
  disconnect(){if(this.device?.gatt?.connected)this.device.gatt.disconnect();else this.onDisconnect();}
  onEvent(value){
    try{
      const message=this.assembler.accept(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
      if(!message)return;
      if(message.kind!==2)throw new Error('裝置回覆類型錯誤');
      if(message.id===0){
        if(message.value.event==='upload_ack'){
          const ack=message.value;
          if(!Number.isInteger(ack.offset)||ack.offset<0)return;
          this.latestAck=ack;
          if(this.ackWaiter&&ack.transfer_id===this.ackWaiter.id&&ack.offset>=this.ackWaiter.target)this.ackWaiter.resolve(ack.offset);
        }
        this.emit('event',message.value);return;
      }
      const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);
      message.value.ok===true?pending.resolve(message.value):pending.reject(new Error(message.value.message||message.value.error||'吊飾拒絕了這個操作'));
    }catch(error){this.emit('error',error);}
  }
  async request(op,fields={},timeout=12000){
    if(!this.connected)throw new Error('先連接小夥伴，再把作品送過去。');
    const id=this.nextId;this.nextId=this.nextId%65535+1;
    let timer;
    const response=new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
    });
    // Attach the rejection handler before writing to avoid unhandled timeout/disconnect rejection.
    response.catch(()=>{});
    try{
      for(const packet of fragmentMessage({op,...fields},id,this.maxWrite)){
        if(this.control.writeValueWithResponse)await this.control.writeValueWithResponse(packet);else await this.control.writeValue(packet);
      }
      // At a 20-byte ATT value, sending a large playlist can itself take over 12 seconds.
      // The reply deadline begins after the final control fragment has been written.
      if(this.pending.has(id))timer=setTimeout(()=>{const pending=this.pending.get(id);this.pending.delete(id);pending?.reject(new Error('小伴沒有回覆，請重新連線後再試。'));},timeout);
      return await response;
    }finally{clearTimeout(timer);this.pending.delete(id);}
  }
  async authorize(key){
    const clientNonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    const challenge=await this.request('AUTH_CHALLENGE',{client_nonce:clientNonce});
    const proof=await authProof(key,this.info.device_id,clientNonce,challenge.server_nonce);
    await this.request('AUTH',{client_nonce:clientNonce,proof});this.authorized=true;
    this.emit('state',{connected:true,authorized:true,info:this.info});
  }
  requireAuth(){if(!this.connected||!this.authorized)throw new Error('請先連線，並在裝置頁輸入小卡上的授權碼。');}
  capability(name){this.requireAuth();if(!this.info?.capabilities?.includes(name))throw new Error('吊飾韌體還沒開放這個功能。');}
  async command(op,fields={},cap){this.requireAuth();if(this.busy)throw new Error('正在同步作品，完成後再控制小伴。');if(cap)this.capability(cap);return this.request(op,fields);}
  waitForAck(id,target){
    if(this.latestAck?.transfer_id===id&&this.latestAck.offset>=target)return Promise.resolve(this.latestAck.offset);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.ackWaiter=null;reject(new Error('ACK_TIMEOUT'));},7000);
      this.ackWaiter={id,target,resolve:value=>{clearTimeout(timer);this.ackWaiter=null;resolve(value);},reject:error=>{clearTimeout(timer);this.ackWaiter=null;reject(error);}};
    });
  }
  cancel(){this.cancelRequested=true;}
  async upload(asset,onProgress=()=>{}){
    this.capability('media');if(this.busy)throw new Error('另一個傳送工作還沒完成。');
    this.busy=true;this.cancelRequested=false;this.latestAck=null;
    const bytes=encodeOLA(asset.frames,asset.fps);let transferId;
    try{
      const begin=await this.request('UPLOAD_BEGIN',{id:asset.id,kind:asset.kind,name:asset.name,length:bytes.length,crc32:crc32(bytes)});
      transferId=begin.transfer_id;let offset=begin.offset;
      if(!Number.isInteger(transferId)||transferId<1||transferId>65535||!Number.isInteger(offset)||offset<0||offset>bytes.length)throw new Error('吊飾上傳狀態錯誤');
      const chunk=this.maxWrite-8,windowSize=Math.max(1,Math.min(8,Number(begin.window_packets)||1));let retries=0;
      while(offset<bytes.length){
        if(this.cancelRequested)throw new Error('已取消傳送');
        const start=offset,target=Math.min(bytes.length,start+chunk*windowSize);
        const ackPromise=this.waitForAck(transferId,target);ackPromise.catch(()=>{});
        for(let pos=start;pos<target;pos+=chunk){
          if(this.cancelRequested)throw new Error('已取消傳送');
          const packet=dataPacket(transferId,pos,bytes.slice(pos,Math.min(target,pos+chunk)));
          if(this.data.writeValueWithoutResponse)await this.data.writeValueWithoutResponse(packet);else await this.data.writeValue(packet);
        }
        try{const ack=await ackPromise;if(ack>bytes.length)throw new Error('吊飾確認位置錯誤');offset=ack;retries=0;}
        catch(error){
          if(error.message!=='ACK_TIMEOUT'||++retries>3)throw error;
          const status=await this.request('UPLOAD_STATUS',{transfer_id:transferId});
          if(!Number.isInteger(status.offset)||status.offset<start||status.offset>target)throw new Error('續傳位置錯誤');offset=status.offset;
        }
        onProgress(offset/bytes.length,offset,bytes.length);
      }
      if(this.cancelRequested)throw new Error('已取消傳送');
      await this.request('UPLOAD_END',{transfer_id:transferId},30000);onProgress(1,bytes.length,bytes.length);
    }catch(error){
      if(this.cancelRequested&&this.connected&&transferId){try{await this.request('UPLOAD_CANCEL',{transfer_id:transferId});}catch{}}
      throw error;
    }finally{this.ackWaiter?.reject(new Error('傳送結束'));this.ackWaiter=null;this.busy=false;}
  }
}
