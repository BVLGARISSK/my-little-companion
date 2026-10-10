const DB_NAME='little-companion-v1';
export class DraftStore {
  async init(){
    this.db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>req.result.createObjectStore('drafts');
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(new Error('請關閉另一個小伴分頁後重新整理'));
    });
    this.db.onversionchange=()=>this.db.close();
    return this;
  }
  async get(key){return new Promise((resolve,reject)=>{const req=this.db.transaction('drafts').objectStore('drafts').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async put(key,value){return new Promise((resolve,reject)=>{const tx=this.db.transaction('drafts','readwrite');tx.objectStore('drafts').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error('草稿儲存失敗'));});}
}
