# Café Brief：咖啡店营销创意助手

**在线体验：https://luyujun74-creator.github.io/cafe-brief/**

面向海外独立咖啡店的工作流原型：输入已确认的商品、价格和活动信息，得到 4:5 海报排版、英文 Instagram 文案和 15 秒拍摄分镜，经过事实规则检查和人工确认后导出。

本项目借助 AI 协作开发。商家用户价值和营销效果尚未实测，没有真实商家的采用或提效数据。

## 四种模式

| 模式 | 说明 |
|---|---|
| 模板演示（默认） | 无需密钥，文案来自固定模板，页面标注“未调用模型” |
| 免费公共模型 | 无需密钥，一键调用第三方 Pollinations 的匿名开源模型；限速，可用性不作保证。检查不通过时最多自动修订两轮 |
| 网页版大模型 | 复制指令到 ChatGPT、Claude 等网页版，再粘贴回复；页面不直接连接这些网站，由你手动传递 |
| 自己的 API 密钥 | 填写 OpenAI Chat Completions 格式接口、模型名和密钥；同样最多自动修订两轮 |

另有[聊天指令版](agent-instructions.md)，可复制到聊天模型使用；[评测任务](eval-tasks.md)列出了预期结果。

## 边界

- 海报是原图排版，不是 AI 生图；分镜是拍摄方案，不是视频成片。
- 规则检查只识别部分数字、币种和敏感宣称，不能替代人工核对。
- 真实模式需要服务允许网页直接调用（跨域）；不允许的服务会报错，不会切回模板。
- 网站没有后端。图片只在你的浏览器内处理；调用模型时，文字事实直接发送给对应服务，密钥只发送到你填写的地址。密钥只留在页面内存，刷新即清除，不写入导出文件。
- 审核记录也只在页面内存中，用于防止导出过期内容，不是防篡改凭证。

## 结构

- `docs/`：网站（GitHub Pages 从这里发布），`engine.js` 是生成、检查和导出逻辑。
- `reference/`：最初的 Python 实现，作为对照基准。
- `tests/`：测试。

## 测试

```bash
python3 tests/differential.py          # JS 与 Python 规则逐项对照
node --test tests/engine.test.cjs      # 模型流程、审核记录、密钥不外泄（注入回复）
node tests/ui-regression.cjs && node tests/app-regression.cjs
BASE_URL=https://luyujun74-creator.github.io/cafe-brief/ node tests/e2e.cjs   # 需要 playwright
```
