# dsh-norm-spec

DeepSeek Harness (dsh) 的 Cordis 插件适配器，为 [norm-spec](https://github.com/CyanoOrg/norm-spec)
约定提供：按会话的 `.norm` 约定注入与编辑后软性约定校验，
由 canonical Rust 引擎支撑。

## 为什么

约定只有在 agent 工作时到达它才有意义。磁盘上一棵通过校验的 `.norm`
树本身是惰性的；常见的替代——一份常驻指令文件——花 token 重建同样的
歧义，而其效力随距离与竞争上下文衰减。

本适配器按缓存想要的方式递送约定知识：

> 把作用于当前工作目录的约定分页递送到 agent 行动时刻的感知点，
> 并在编辑后据此核对。

递送是宿主相关的。DSH rc.6 唯一的注入口（`agent/pre-step`）写入会话
日志，因此提醒是 durable 的：注入一次、未变化时被抑制（SHA-1
digest）、收集到的约定变化时**通过单一槽位原地取代**（`surfaceOp`
 replace）。模型永远不会携带过期约定，占用有界——无论会话跨目录
漂移多久。同一套格式与语义运行在不同宿主上的另一个适配器是
[pi-norm-spec](https://github.com/CyanoOrg/pi-norm-spec)——递送层是
宿主相关的部分，这条边界正是意义所在。

**状态：`0.1.0` stable，已发布到 npm：
[`@cyanoorg/dsh-norm-spec`](https://www.npmjs.com/package/@cyanoorg/dsh-norm-spec)。
支持的 DSH 宿主：`@deepseek-ai/dsh@0.1.0-rc.6`。**

## 安装

```bash
dsh plugin add @cyanoorg/dsh-norm-spec --profile <name>
```

就这样：包内携带密封的 upstream norm-spec payload 与原生 bridge，
运行时从安装树内解析——不查 PATH、不需要环境变量。平台二进制通过
npm `optionalDependencies`（`darwin-arm64`、`darwin-x64`、
`linux-x64`、`win32-x64`）分发，npm 自动选择匹配项。

## 它做什么

- 每个 DSH agent 会话（`agent/session-start`）启动一个经过校验的
  `dsh-norm-bridge` 子进程，面向密封的 upstream norm-spec payload。
- 在 `agent/pre-step` 把收集到的 `.norm` 约定注入为一条 durable 的
  `<system-reminder>` 用户消息，最具体的优先——与 dsh 自身
  `agent-instructions` 相同的注入惯用法。提醒在会话表面至多占用一个
  槽位：未变化的约定被 digest 抑制，变化的约定原地取代前一条
  （单槽替换，D008）。
- `write`/`edit` 工具成功后，通过 `tools/post-execute` 追加有界的
  严格校验反馈（软反馈；从不阻断或回滚）。
- 注册原生 `norm_validate` / `norm_collect` / `norm_scan` 工具与一个
  `dsh-norm-spec` skill，模型可按需主动查询约定。
- 从不写自定义 DSH 会话事件类型；从不回退到 PATH 上的 `norm`。

## 本地开发

```bash
# Rust 门禁
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features

# TypeScript
npm install
npm run typecheck
npm test
```

开发时可用 `DSH_NORM_BRIDGE` 与 `DSH_NORM_PAYLOAD` 环境变量覆盖
打包运行时解析；打包安装从不使用它们。发布流程（五包发布、
dist-tag 策略、发布后验证）见 `docs/RELEASE-SOP.md`。

## 文档

- `docs/ARCHITECTURE.md`——Rust/TypeScript 边界与 DSH 宿主面
- `docs/BRIDGE-PROTOCOL.md`——`dsh-norm-spec/bridge/v1` 进程契约
- `docs/decisions.md`——决策记录 D001–D012
- `docs/RELEASE-SOP.md`——发布与出版流程
- `docs/planning/status.md`——实时开发状态
- `ROADMAP.md`——里程碑规划

## 许可证

MIT
