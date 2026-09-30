# HarmonyOS ThreadWorker 与 Node 的差异

测量环境：HarmonyOS 7.0.0.106（模拟器）与 7.0.0.109（平板），两台结果一致。方法：在 Worker 内运行 `src/conformance.mjs` 的 120 项检查，每项的期望值都是 Node 22 的实际答案。

## Worker 自带什么

装垫片之前，ThreadWorker 的全局作用域里**没有** `TextEncoder`、`TextDecoder`、`URL`、`URLSearchParams`、`crypto`、`atob`/`btoa`、`structuredClone`、`Headers`/`Request`/`Response`、`ReadableStream`、`AbortController`、`queueMicrotask`、`performance`。

ArkTS 的 `@kit.ArkTS`（`util.TextEncoder`、`util.TextDecoder`、`url.URL`、`url.URLSearchParams`）和 `@kit.CryptoArchitectureKit` 提供了对应的原始能力，但行为和 Web/Node 不同，需要包一层。

## 与 Node 不同、本库已补齐的项

| 项 | ArkTS 实际行为 | 会导致的问题 | 本库的处理 |
| --- | --- | --- | --- |
| `TextEncoder.encode('')` | 返回 `undefined` | `Buffer.byteLength('')` 等计算抛错 | 空串返回 `Uint8Array(0)` |
| `TextDecoder.decode(空字节)` | 返回 `undefined` | SSE 解析拿到 `undefined` 行 | 返回 `''` |
| 孤立代理字符编码 | 写出非法 UTF-8 `ED A0 80` | 同一文本在设备和电脑上哈希不同 | 先转成 U+FFFD，与 Node 一致 |
| UTF-8 BOM | 解码后保留 | 读出的文本开头多一个 `﻿` | 每个流去掉一次开头 BOM（`ignoreBOM` 除外） |
| `new URL('无效地址')` | 不抛错，`href` 为空 | zod 等校验把乱写的地址当成有效 | 空 `href` 时抛 `TypeError` |
| `URL.canParse` / `URL.parse` | 不存在 | MCP OAuth 等调用直接报错 | 补齐 |
| `crypto.subtle` | 不存在 | OAuth PKCE（`pkce-challenge` 等）无法计算 | 用原生摘要补 `digest('SHA-256')` |
| `queueMicrotask` | 不存在 | 依赖它的库抛 `ReferenceError` | 补齐，并设为**不可写**（见下文 zone.js） |
| `Error.captureStackTrace` | 不存在 | 部分库（如 domino）直接调用 | 补齐 |
| `Set` 集合方法、`Object.groupBy`、`Map.groupBy` | 不存在 | 较新的库调用时报错 | 补齐 |
| `URLSearchParams` 迭代器 | 不能被 `Object.fromEntries` 消费 | OpenAI SDK 构造请求 URL 失败 | 构建期源码补丁 `sdk-patches/openai-url-query` |

## 已确认、不补的差异

`ACCEPTED_DIFFERENCES` 列出了这些项。如果你的代码依赖其中某一项，需要自己补。

| 项 | 说明 |
| --- | --- |
| `EventTarget` / `Event` / `CustomEvent` | 不存在 |
| 国际化域名（IDN） | `URL` 不把中文域名转成 punycode |
| `Intl.Collator` 的 `numeric` 选项 | 被忽略，`'10'` 排在 `'9'` 前面 |
| `fn.apply(null, null)` | ArkTS 抛 `TypeError: Type of target is not Object`，Node 视同无参数 |

## zone.js 陷阱

zone.js 会包装它能找到的所有**可写**全局函数，并用 `callback.apply(null, null)` 执行被包装的微任务。在 ArkTS 上这个调用会抛错，而且错误发生在微任务里，表现是流式 HTTP 响应"卡住"、永远不结束，没有明显报错。

本库把 `queueMicrotask` 定义为不可写，zone.js 会跳过它。自检里的 `function:apply-null-args` 和 `microtask:not-zone-wrapped` 两项专门检查这个问题。

## ArkTS 上的性能注意

- `TypedArray.from(string, mapper)` 在输入达到数 MB 时会生成巨大的中间对象，让 Worker 卡住。`buffer.mjs` 的 Base64 解码因此改成一次分配。
- 反复 `+=` 拼接长字符串会形成很长的依赖链。`atob`/`btoa` 每 8192 个字符分一段。
- 对一个本来就合法的超长字符串调用 `String.replace` 也会复制整串。`sdk-patches/pi-ai-surrogates` 先检测，确实需要替换时才调用 `replace`。
