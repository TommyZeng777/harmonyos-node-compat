# harmonyos-node-compat

让 npm 上为 Node 编写的库（OpenAI SDK、zod 等）直接跑在鸿蒙 ThreadWorker 里：补齐 fetch、Buffer、URL、TextEncoder 等缺失 API，行为与 Node 逐项对齐。

*Run Node-targeted npm packages inside a HarmonyOS ThreadWorker — fetch (with SSE streaming), Buffer, URL, TextEncoder and more, each verified against Node.*

## 适合谁用

- 想在鸿蒙应用里直接调用 OpenAI 兼容接口或 AI SDK，并且需要流式输出；
- 想把现成的 npm 库搬到鸿蒙上，但遇到 `xxx is not defined`，或者结果和 Node 不一致；
- 想知道鸿蒙 Worker 和 Node 到底有哪些行为差异（见 [docs/platform-differences.md](docs/platform-differences.md)）。

## 平台支持

- **HarmonyOS**：已在 HarmonyOS 7.0（模拟器 7.0.0.106、平板 7.0.0.109）上实测。
- **OpenHarmony**：未验证。`src/` 里的 JS 只依赖 `@kit.ArkTS` 和 `@kit.CryptoArchitectureKit` 提供的基础能力，理论上可用；但示例网络宿主 `harmony/NativeFetchHost.ets` 使用的是 HarmonyOS 专有的 RCP（`@kit.RemoteCommunicationKit`），在 OpenHarmony 上需要改用 `@kit.NetworkKit` 的 http 实现。欢迎提交验证结果。

## 为什么需要它

ThreadWorker 的全局作用域几乎是空的：没有 `TextEncoder`、`URL`、`fetch`、`AbortController`、`structuredClone` 等。ArkTS 提供的替代品在边界输入上又和 Node 不一致，比如 `encode('')` 返回 `undefined`，`new URL('乱写')` 不抛错。这类差异通常不会直接报错，而是悄悄产生错误的数据。完整清单见 [docs/platform-differences.md](docs/platform-differences.md)。

## 提供什么

| 模块 | 内容 |
| --- | --- |
| `harmonyos-node-compat` | `installWorkerPlatform()`：一次性补齐缺失的全局对象，已有且行为正确的保持不动 |
| `./buffer` | Node `Buffer` 子集：utf8、hex、base64、base64url、latin1、ascii、utf16le；遇到不支持的编码直接报错 |
| `./path` | `node:path` posix 实现，按 Node 源码算法移植 |
| `./crypto` | `randomUUID`、`createHash('sha256')` |
| `./fetch`、`./network-bridge` | 基于 ArkTS 宿主的 `fetch()`，支持 SSE 流式响应、取消和空闲超时；`pinnedAddresses` 选项可以连接指定 IP（用于 DNS 校验后防 SSRF） |
| `./network-error` | 把 RCP 错误码归类为 TRANSPORT、TIMEOUT、TLS_CERTIFICATE 等 |
| `./conformance` | 120 项平台自检，每项附 Node 的标准答案，可以在设备上直接运行 |
| `./sdk-patches/*` | 构建期源码补丁：OpenAI SDK 的 URL 查询构造、pi-ai 的长字符串优化 |
| `harmony/` | ArkTS 侧示例：Worker 入口、基于 RCP 的网络宿主 `NativeFetchHost.ets`、DNS 解析 `NativeDns.ets` |

## 用法

### 1. Worker 里的 JavaScript

参考 [examples/worker-main.mjs](examples/worker-main.mjs)：

```js
import {installWorkerPlatform, connectNetworkBridge} from 'harmonyos-node-compat';

export function mount(port, primitives) {
  installWorkerPlatform(primitives);          // 必须先于任何依赖这些全局对象的代码
  const bridge = connectNetworkBridge({
    request: text => port.postMessage({type: 'network', text}),
    cancel: id => port.postMessage({type: 'network-cancel', id}),
  });
  globalThis.fetch = bridge.fetch;
  port.onmessage = e => { if (e.data?.type === 'network-event') bridge.receive(e.data.event); /* ... */ };
}
```

用 esbuild 打包，放到 Worker 目录下：

```sh
npx esbuild examples/worker-main.mjs --bundle --format=esm --target=es2016 \
  --outfile=entry/src/main/ets/workers/WorkerBundle.js
```

> **启动握手**：在 HarmonyOS 上，Worker 启动过程中主动发出的消息可能会丢失。宿主创建 Worker 后应立即发送 `{type: 'ping'}`，Worker 对每个 ping 都回复 `worker-ready`，宿主以收到的第一条为准。示例中的三个文件都已这样实现。

### 2. Worker 入口（ArkTS）

[harmony/WorkerEntry.ts](harmony/WorkerEntry.ts) 把 `util.TextEncoder`、`url.URL`、`cryptoFramework` 等 ArkTS 原始能力传给 `mount()`。

### 3. 主线程的网络宿主（ArkTS）

```ts
import { worker } from '@kit.ArkTS';
import { NativeFetchHost, NetworkEvent } from './NativeFetchHost';

interface WorkerMessage { type: string; text?: string; id?: string; }

const w = new worker.ThreadWorker('entry/ets/workers/WorkerEntry.ts');
const network = new NativeFetchHost((event: NetworkEvent): void => {
  w.postMessage({ type: 'network-event', event: event });
});
w.onmessage = (e): void => {
  const message = e.data as WorkerMessage;
  if (message.type === 'network' && message.text) network.request(message.text);
  else if (message.type === 'network-cancel' && message.id) network.cancel(message.id);
};
```

需要在 `module.json5` 中声明 `ohos.permission.INTERNET`。

## 设计约定

- **以 Node 为准**：测试里的期望值都来自 Node 本身的运行结果，而不是手写的预期。唯一的有意差异（`Request` 的方法名一律转大写）在测试里单独断言。
- **只补缺口**：运行时已有且行为正确的实现保持不动；有但行为不对的（如 `encode('')` 返回 `undefined` 的编码器）会被替换。
- **不静默降级**：不支持的编码、上传类型或 SDK 源码形状变化都会直接报错，不会假装成功。
- **网络限制**：只支持 HTTPS 的 GET/POST，响应体为 JSON 或 SSE；不支持 multipart/Blob 上传。宿主不向 Worker 传递背压，消费方积压超过 4 MB 时请求失败。

## 在设备上自检

```js
import {checkPlatform, ACCEPTED_DIFFERENCES} from 'harmonyos-node-compat/conformance';
const unexpected = checkPlatform().filter(item => !(item.id in ACCEPTED_DIFFERENCES));
// 应为空数组；系统升级后若出现新项，说明平台行为变了
```

## 开发

```sh
npm install
npm test
```

需要 Node ≥ 22。测试全部在 Node 上运行，用模拟的 ArkTS 行为（如 `encode('')` 返回 `undefined`）验证替换逻辑。

### 示例应用

`example-app/` 是一个最小的 HarmonyOS 工程：启动 Worker，运行平台自检，并通过 `NativeFetchHost` 发一个 HTTPS 请求。

```sh
npm run example:prepare          # 打包 Worker 代码，复制 harmony/ 下的文件到示例工程
cd example-app && devecocli build --build-mode debug
```

安装到设备前，需要在 DevEco Studio 里为它配置你自己的签名。

> 示例应用目前只在本机编译通过，尚未在设备上运行。同一套 Worker 启动方式和网络宿主已经在 [dsh-runtime-harmonyos](https://github.com/TommyZeng777/dsh-runtime-harmonyos) 的示例中于 HarmonyOS 模拟器上验证过。

## 许可

MIT，见 [LICENSE](LICENSE)。`src/path.mjs` 移植自 Node.js 的 `lib/path.js`（MIT），署名见 [NOTICE](NOTICE)。
