# 小伴自訂域名

正式控制網址：`https://quadcopteronline.org/`。網站維持 GitHub Actions → GitHub Pages 部署，Cloudflare 僅管理 DNS。

## DNS 記錄

| 類型 | 名稱 | 內容 | 代理狀態 |
| --- | --- | --- | --- |
| A | @ | 185.199.108.153 | DNS only |
| A | @ | 185.199.109.153 | DNS only |
| A | @ | 185.199.110.153 | DNS only |
| A | @ | 185.199.111.153 | DNS only |
| CNAME | www | bvlgarissk.github.io | DNS only |

GitHub 儲存庫的 Pages → Custom domain 設為 `quadcopteronline.org`，TLS 憑證由 GitHub Pages 簽發，完成後啟用 Enforce HTTPS。本專案使用自訂 GitHub Actions 工作流程，域名設定由 Pages API／設定頁管理；不用提交 `CNAME` 檔案。

## 配對網址

新版卡片格式：`https://quadcopteronline.org/#device=<device-id>&key=<64hex>`。只有網址變更，使用同一塊吊飾原有的一般碼／管理員碼。實際 key 與 QR 只保存在本機，不提交到 GitHub。

網頁的「取得朋友配對 QR」會使用當前網址產生卡片，於正式新網域操作即可產生新網址。現有韌體透過 USB 印出的連結仍使用原 GitHub Pages 網址；由 GitHub 轉址到新站，不需要為了更換網址更新韌體。

## 本機作品移轉

IndexedDB 依網頁來源隔離。GitHub Pages 與新網域使用不同作品庫，草稿、播放清單與記住的授權碼不會自動搬移；原資料沒有被清除。

若手機上原網址的分頁仍開著，在「裝置 → 匯出備份」下載 JSON，再於新網址「裝置 → 匯入備份」。備份不包含授權碼，請在新站重新掃配對卡。吊飾 Flash 內的作品與設定不受網址變更影響。

若已關閉舊分頁且需要讀取原來源的 IndexedDB，可暫時移除 Pages 自訂域名，恢復原網址以匯出備份；完成後再綁回域名。不要清除瀏覽器網站資料。

## 官方設定文件

- [GitHub Pages 自訂域名與 DNS](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [Cloudflare DNS 記錄](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)
