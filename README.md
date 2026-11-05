# Café Brief · 商品包装工作台

上传一张商品照，填名称和价格，生成可用于美团和自有店铺的整套素材：主图、方图、Banner、竖版海报和上架文案。可以换风格、改文字、再来一版、下载。

在线体验：https://luyujun74-creator.github.io/cafe-brief/

## 工作方式

1. 浏览器把照片缩到长边 1280 后上传给后台。
2. 豆包文本模型根据你填写的信息写卖点和文案。
3. Seedream 以照片为参考生成场景图。
4. 价格、优惠、商品名由浏览器绘制成可编辑文字层，不交给图片模型；营销宣称只能来自用户输入。

## 结构

| 路径 | 作用 |
| --- | --- |
| `docs/` | 前端，由 GitHub Pages 托管。`config.js` 的 `apiBase` 指向后台，只放地址，不放密钥 |
| `worker/` | Cloudflare Worker 后台：代理模型、次数限制、频控、解锁 |
| `worker/schema.sql` | D1 表结构 |
| `tests/` | 后台单元测试和真实浏览器回归测试 |

`apiBase` 为空时，页面只运行离线示例，并明确标注未调用模型。

## 次数限制

每个网络（按 IP）可免费包装 3 次；一次完整包装用 1 次，“再来一版”也用 1 次。超过后输入解锁密码可不限次数。密码只在服务端以哈希保存和校验。

## 部署后台

```bash
cp wrangler.toml.example wrangler.toml      # 填 D1 数据库 ID 和 ALLOWED_ORIGINS
npx wrangler d1 create cafe-brief
npx wrangler d1 execute cafe-brief --remote --file worker/schema.sql
npx wrangler secret put ARK_API_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_PASSWORD_SALT
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler deploy
```

然后把 Worker 地址写入 `docs/config.js`。所有密钥只放在 Worker 的 secrets 里，不要提交到仓库。

## 测试

```bash
node --test tests/worker.test.mjs
NODE_PATH=<含 playwright-core 的 node_modules> node tests/browser.test.cjs [截图目录]
```
