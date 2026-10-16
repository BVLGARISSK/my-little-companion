import {syncMetadata,validateSyncPlan,requireSyncCapacity} from './smart-sync.js?v=1.4.1';
import {UUID,PROTOCOL,fragmentMessage,MessageAssembler,dataPacket,authProof} from './protocol.js?v=1.4.1';
import {crc32,encodeOLA} from './media.js?v=1.4.1';
import {decryptOwnerPairing} from './administration.js';
import {subtitleRuntime} from './subtitle-format.js?v=1.4.1';
import {memoryUsage} from './storage-info.js?v=1.4.1';

export class CompanionBLE extends EventTarget {
  constructor(){super();this.pending=new Map();this.assembler=new MessageAssembler();this.nextId=1;this.maxWrite=20;this.authorized=false;this.role=null;this.busy=false;this.info=null;this.memory=null;this.memoryRefresh=null;this.latestAck=null;this.authorization=null;this.connectionEpoch=0;}
  get connected(){return !!this.device?.gatt?.connected;}
  emit(name,detail){this.dispatchEvent(new CustomEvent(name,{detail}));}
  refreshInfo(){
    if(!this.connected||!this.infoChar||!this.info||this.busy||this.authorization||this.pending.size||this.infoRefresh)return Promise.resolve(false);
    const epoch=this.connectionEpoch,device=this.device,info=this.info,characteristic=this.infoChar;
    const refresh={promise:null};this.infoRefresh=refresh;
    refresh.promise=Promise.resolve().then(async()=>{
      const value=await characteristic.readValue();
      if(!this.connected||this.connectionEpoch!==epoch||this.device!==device||this.info!==info)return false;
      const next=JSON.parse(new TextDecoder().decode(value));
      if(next.protocol!==PROTOCOL||next.device_id!==info.device_id)throw new Error('裝置資訊不符，請重新連線。');
      // Keep the object identity used by authorization and reset guards.
      Object.assign(info,next);
      this.emit('state',{connected:true,authorized:this.authorized,role:this.role,info});return true;
    }).finally(()=>{if(this.infoRefresh===refresh)this.infoRefresh=null;});
    return refresh.promise;
  }
  refreshMemory(){
    if(this.memoryRefresh)return this.memoryRefresh.promise;
    if(!this.connected||!this.authorized||!this.info?.capabilities?.includes('memory')||this.busy||this.authorization||this.pending.size)return Promise.resolve(false);
    const epoch=this.connectionEpoch,device=this.device,info=this.info;
    const refresh={promise:null};this.memoryRefresh=refresh;
    refresh.promise=Promise.resolve().then(async()=>{
      const value=await this.command('GET_MEMORY',{},'memory');
      if(!this.connected||this.connectionEpoch!==epoch||this.device!==device||this.info!==info)return false;
      if(value.device_id!==info.device_id||!memoryUsage(value))throw new Error('裝置回報的 RAM 資料無效，請稍後更新。');
      this.memory=value;return true;
    }).finally(()=>{
      if(this.memoryRefresh!==refresh)return;
      this.memoryRefresh=null;
      if(this.connected&&this.connectionEpoch===epoch&&this.info===info)this.emit('state',{connected:true,authorized:this.authorized,role:this.role,info});
    });
    this.emit('state',{connected:true,authorized:this.authorized,role:this.role,info});
    return refresh.promise;
  }
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
    this.connectionEpoch++;this.infoRefresh=null;this.memoryRefresh=null;this.memory=null;this.authorization=null;this.authorized=false;this.role=null;this.adminKey=null;this.info=null;this.assembler.clear();this.latestAck=null;
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
      if(message.value.ok===true)pending.resolve(message.value);
      else{
        const code=message.value.error;
        const error=new Error(code==='AUTH'?'授權未通過，可能是舊密鑰或驗證逾時。請重新掃描配對卡，再試一次。':message.value.message||code||'吊飾拒絕了這個操作');
        error.code=code;pending.reject(error);
      }
    }catch(error){this.emit('error',error);}
  }
  async request(op,fields={},timeout=12000){
    // Let an already-started INFO read finish before sending control fragments.
    if(this.infoRefresh){
      const epoch=this.connectionEpoch,device=this.device;
      await this.infoRefresh.promise.catch(()=>{});
      if(this.connectionEpoch!==epoch||this.device!==device)throw new Error('連線已改變，請重新操作。');
    }
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
  authorize(key){
    const epoch=this.connectionEpoch,device=this.device,info=this.info;
    const checkConnection=()=>{if(!this.connected||this.connectionEpoch!==epoch||this.device!==device||this.info!==info)throw new Error('連線中斷，請重新連接後再授權。');};
    if(this.authorization){
      if(this.authorization.key===key)return this.authorization.promise;
      return this.authorization.promise.catch(()=>{}).then(()=>{checkConnection();return this.authorize(key);});
    }
    const pending={key,promise:null};
    pending.promise=(async()=>{
      checkConnection();
      const clientNonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
      const challenge=await this.request('AUTH_CHALLENGE',{client_nonce:clientNonce});checkConnection();
      const proof=await authProof(key,info.device_id,clientNonce,challenge.server_nonce);checkConnection();
      const result=await this.request('AUTH',{client_nonce:clientNonce,proof});checkConnection();
      this.authorized=true;this.role=result.role==='admin'?'admin':'owner';
      this.adminKey=this.role==='admin'?key:null;
      this.emit('state',{connected:true,authorized:true,role:this.role,info});
    })().finally(()=>{if(this.authorization===pending)this.authorization=null;});
    this.authorization=pending;return pending.promise;
  }
  requireAuth(){if(!this.connected||!this.authorized)throw new Error('請先連線，並在裝置頁輸入小卡上的授權碼。');}
  capability(name){this.requireAuth();if(!this.info?.capabilities?.includes(name))throw new Error('吊飾韌體還沒開放這個功能。');}
  async command(op,fields={},cap){this.requireAuth();if(this.busy)throw new Error('正在同步作品，完成後再控制小伴。');if(cap)this.capability(cap);return this.request(op,fields);}
  requireAdmin(cap){this.capability(cap);if(this.role!=='admin')throw new Error('請先掃描管理員 QR 卡，完成管理員授權。');}
  async ownerPairing(){
    this.requireAdmin('owner_pairing');
    const epoch=this.connectionEpoch,info=this.info,key=this.adminKey;
    const result=await this.command('GET_OWNER_PAIRING',{},'owner_pairing');
    const pairing=await decryptOwnerPairing(result,key,info.device_id);
    if(!this.connected||this.connectionEpoch!==epoch||this.info!==info||this.role!=='admin')throw new Error('連線已中斷，請重新讀取配對卡。');
    return pairing;
  }
  async factoryReset(onPrepared=()=>{}){
    this.requireAdmin('factory_reset');if(this.busy)throw new Error('請先完成或取消作品同步。');
    const epoch=this.connectionEpoch,info=this.info;this.busy=true;
    try{
      const prepared=await this.request('FACTORY_RESET_PREPARE');
      if(prepared.device_id!==info.device_id||!/^[a-f0-9]{32}$/.test(prepared.reset_id||''))throw new Error('重設確認資料錯誤，尚未要求清除。');
      const pending={device:info.device_id,id:prepared.reset_id};
      await onPrepared(pending);
      if(!this.connected||this.connectionEpoch!==epoch||this.info!==info)throw new Error('連線已中斷，尚未要求清除。');
      const result=await this.request('FACTORY_RESET',{device_id:pending.device,reset_id:pending.id});
      if(result.reset_id!==pending.id||result.stage!=='restarting')throw new Error('重設狀態尚未確認，請重新連線檢查。');
      return pending;
    }finally{this.busy=false;}
  }
  waitForAck(id,target){
    if(this.latestAck?.transfer_id===id&&this.latestAck.offset>=target)return Promise.resolve(this.latestAck.offset);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.ackWaiter=null;reject(new Error('ACK_TIMEOUT'));},7000);
      this.ackWaiter={id,target,resolve:value=>{clearTimeout(timer);this.ackWaiter=null;resolve(value);},reject:error=>{clearTimeout(timer);this.ackWaiter=null;reject(error);}};
    });
  }
  cancel(){this.cancelRequested=true;}
  async planSync(assets){
    this.capability('smart_sync');if(this.busy)throw new Error('正在傳送作品，請稍後規劃同步。');
    if(assets.length>32||new Set(assets.map(a=>a.id)).size!==assets.length)throw new Error('一次最多同步 32 個不同作品。');
    const device=this.info.device_id,epoch=this.connectionEpoch,works=await Promise.all(assets.map(a=>syncMetadata(a)));
    const groups=[];let group=[];
    for(const work of works){if(new TextEncoder().encode(JSON.stringify({op:'PLAN_SYNC',works:[...group,work]})).length>12000){groups.push(group);group=[];}group.push(work);}if(group.length)groups.push(group);
    const plans=[];for(const part of groups){if(!this.connected||this.connectionEpoch!==epoch)throw new Error('連線已變更，請重新同步。');plans.push(validateSyncPlan(await this.command('PLAN_SYNC',{works:part},'smart_sync'),part,device));}
    if(!plans.length)return {fits:true,needed_bytes:0,free_bytes:0,reserve_bytes:0,existing_works:0,new_works:0,max_works:32,items:[]};
    const plan={...plans[0],items:plans.flatMap(p=>p.items),needed_bytes:plans.reduce((s,p)=>s+p.needed_bytes,0),new_works:plans.reduce((s,p)=>s+p.new_works,0),free_bytes:Math.min(...plans.map(p=>p.free_bytes)),existing_works:Math.max(...plans.map(p=>p.existing_works))};
    plan.fits=(!plan.needed_bytes||plan.free_bytes>=plan.needed_bytes+plan.reserve_bytes)&&plan.existing_works+plan.new_works<=32;return plan;
  }
  async upload(asset,onProgress=()=>{}){
    this.capability('media');if(this.busy)throw new Error('另一個傳送工作還沒完成。');
    const subtitle=asset.kind==='subtitle'?(this.capability('subtitle'),subtitleRuntime(asset.subtitle,asset.frames.length)):undefined;
    this.busy=true;this.cancelRequested=false;this.latestAck=null;
    const bytes=encodeOLA(asset.frames,asset.fps);let transferId;
    try{
      const smart=this.info?.capabilities?.includes('smart_sync')===true,meta=smart?await syncMetadata(asset,bytes):{id:asset.id,kind:asset.kind,name:asset.name,length:bytes.length,crc32:crc32(bytes),...(subtitle?{subtitle}:{})};
      if(smart)requireSyncCapacity(validateSyncPlan(await this.request('PLAN_SYNC',{works:[meta]}),[meta],this.info.device_id));
      const begin=await this.request('UPLOAD_BEGIN',{...meta,...(smart?{skip_if_match:true}:{})});
      if(smart&&begin.skip===true&&begin.verified===true){onProgress(1,bytes.length,bytes.length);return {skipped:true};}
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
      await this.request('UPLOAD_END',{transfer_id:transferId},30000);onProgress(1,bytes.length,bytes.length);return {skipped:false};
    }catch(error){
      if(this.cancelRequested&&this.connected&&transferId){try{await this.request('UPLOAD_CANCEL',{transfer_id:transferId});}catch{}}
      throw error;
    }finally{this.ackWaiter?.reject(new Error('傳送結束'));this.ackWaiter=null;this.busy=false;}
  }
}
