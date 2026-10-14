// Capacity comes from the device's media filesystem, not the phone or RAM.
export function storageUsage(info) {
  const free=info?.storage_free,total=info?.storage_total;
  if(!Number.isSafeInteger(free)||!Number.isSafeInteger(total)||total<=0||free<0||free>total)return null;
  const used=total-free;
  return {free,total,used,usedPercent:used/total*100};
}
