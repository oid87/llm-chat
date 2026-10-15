# My Local LLM Chat（GitHub Pages 前端）

單一 `index.html` 的靜態聊天頁，部署到 GitHub Pages，透過 HTTPS 隧道連回你 Mac 上的 Bionic（LM Studio 相容 API）。頁面本身不含任何 token。

## 架構

```
瀏覽器 ──HTTPS──> https://<你的使用者>.github.io/<repo>/   （GitHub Pages：只有靜態 HTML）
   │
   └──HTTPS + Bearer token──> https://llm.你的網域.com/v1   （Cloudflare Tunnel）
                                   │
                                   └──> http://localhost:1235  （Bionic，Gemma 4 26B）
```

## 一、Bionic 設定（Developer → Local Server）

1. 開啟 **Enable CORS**，否則瀏覽器會擋下跨網域請求（頁面在 github.io，API 在你的網域）。
2. **目前版本的 Bionic 設定頁沒有 Require Authentication 選項，API 不需要 token 即可呼叫（已用 curl 確認）。** 因此在有任何一道存取門檻之前，不要把 API 直接公開到網際網路，否則拿到網址的人都能用你的 GPU。見下方「安全注意事項」。
3. 記下埠號（目前是 **1235**）。
4. 載入 `google/gemma-4-26b-a4b-qat`。

> 這些選單名稱來自第三方教學，請以你版本的實際介面為準。

## 二、Cloudflare Tunnel（給 HTTPS 網址）

瀏覽器從 HTTPS 頁面呼叫 API 時，API 也必須是 HTTPS，所以不能直接用 `http://100.x.x.x` 或 `http://192.168.x.x`。

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create llm
cloudflared tunnel route dns llm llm.你的網域.com
```

`~/.cloudflared/config.yml`（注意 service 指向 **1235**）：

```yaml
tunnel: llm
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: llm.你的網域.com
    service: http://localhost:1235
  - service: http_status:404
```

啟動並保持執行：

```bash
cloudflared tunnel run llm
```

驗證（應回傳模型列表）：

```bash
curl https://llm.你的網域.com/v1/models -H "Authorization: Bearer <你的token>"
```

## 三、GitHub Pages

1. 在 GitHub 建一個 repo（公開或私人皆可；私人 repo 的 Pages 需要付費方案）。
2. 把 `index.html` 放到 repo 根目錄，commit 並 push。**不要把 token 放進來。**
3. Settings → Pages → Build and deployment：Source 選 **Deploy from a branch**，Branch 選 `main` / `/ (root)`。
4. 幾分鐘後網址為 `https://<使用者>.github.io/<repo>/`。

## 四、第一次使用

1. 打開頁面，展開「連線設定」。
2. Base URL 填 `https://llm.你的網域.com/v1`。
3. Token 填入（只留在這個分頁的記憶體中，重新整理就要重填）。
4. 模型 ID 保持 `google/gemma-4-26b-a4b-qat`。
5. 勾選「記住」只會保存 Base URL 與模型，**不會**保存 token。在共用電腦上請不要勾。

## 注意事項

- **Mac 必須開著、不睡眠、Bionic 的 server 在跑、tunnel 在跑**，否則頁面會顯示「無法連線」。
- Gemma 4 會先串流思考過程（`reasoning_content`），頁面顯示「思考中…」直到正式回答開始，所以第一個字會比較慢。
- **安全性：** 目前 Bionic 不驗證 token，公開的 `https://llm.你的網域.com` 等於公開你的 GPU。在公開之前需要擇一加上門檻：
  - 只用 Tailscale：`tailscale serve` 提供的網址只有同一個 tailnet 的裝置能連，不對公網開放。缺點是使用的裝置都要登入 Tailscale。
  - 公網 + Cloudflare Worker 代理：Worker 檢查自訂密碼標頭後才轉發到隧道，密碼存在 Worker 的環境變數，不在頁面原始碼中。需要自行部署 Worker。
  - Cloudflare Access：可以在隧道網址前加登入，但瀏覽器跨網域呼叫時 Access 的重新導向與 cookie 可能讓請求失敗，此版本未驗證。
- 若想用 Tailscale 而不走公網，瀏覽器不能從 HTTPS 頁面呼叫 `http://100.x.x.x`（混合內容被擋）。需改用 `tailscale serve` 提供 HTTPS 的 `*.ts.net` 網址。
- `phase1/pipeline.py` 不會因此受影響，它仍走 localhost。

## 本地測試紀錄

- Gemma 4 的串流格式（SSE `data:` 行，`delta.reasoning_content` 後接 `delta.content`）已用 curl 驗證。
- 頁面透過本機 CORS 代理（測試用，不是部署方案）對 Bionic 送出一則訊息，收到串流回答。
- 未開 CORS 時，頁面顯示預期的「無法連線」提示。
