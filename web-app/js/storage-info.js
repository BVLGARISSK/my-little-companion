// Capacity comes from the device's media filesystem, not the phone or RAM.
export function storageUsage(info) {
  const free=info?.storage_free,total=info?.storage_total;
  if(!Number.isSafeInteger(free)||!Number.isSafeInteger(total)||total<=0||free<0||free>total)return null;
  const used=total-free;
  return {free,total,used,usedPercent:used/total*100};
}

export function memoryUsage(info) {
  if(info?.ram_scope!=='internal_8bit_heap')return null;
  const value=storageUsage({storage_free:info.ram_free,storage_total:info.ram_total}),largest=info.ram_largest_block;
  if(!value||!Number.isSafeInteger(largest)||largest<0||largest>value.free)return null;
  return {...value,largest};
}
