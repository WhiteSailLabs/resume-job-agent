# Resume Job Agent

> **岗位发现 → JD 审核 → 一岗一简历**：面向国内求职场景、本地优先、由人确认的 AI 求职工作流。

[English](README.en.md) · [安装说明](SETUP.zh-CN.md) · [参与贡献](.github/CONTRIBUTING.md) · [安全说明](.github/SECURITY.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.13+-3776AB.svg)](apps/backend/pyproject.toml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](apps/frontend/package.json)
[![Local First](https://img.shields.io/badge/data-local--first-16a34a.svg)](#隐私与边界)

市面上的 AI 简历工具，大多只解决了“润色一份简历”。真正求职时，你仍然要在招聘网站、JD、文档和不同版本的简历之间反复切换。

Resume Job Agent 想解决的是**整条投前工作流**：一句话描述目标岗位，收集并审核真实 JD，选择值得申请的岗位，然后基于同一份主简历批量生成有事实依据、可对比、可继续修改的定制简历。

如果你也想要一个**不替你乱投、不编造经历、数据留在本机**的求职 Agent，欢迎点一个 ⭐。你的 Star 会帮助更多贡献者看到这个项目。

## 项目身份与贡献说明

本项目是基于 [Resume Matcher](https://github.com/srbhr/Resume-Matcher) 的二次开发，并有意保留其完整 Git 历史。因此 GitHub Contributors 中会显示 Resume Matcher 的原作者和历史贡献者——他们构建了本项目沿用的简历数据结构、编辑、预览与 PDF 导出基础。

**WhiteSailLabs 在上游基础上新增和重构了：**

- 面向国内招聘场景的一句话岗位发现与岗位链接导入；
- JD 保存、查看、人工审核与批量审批工作流；
- 基于主简历事实边界的批量定制 Agent；
- 可恢复任务进度、质量检查、红蓝差异预览与对话微调；
- 按公司和岗位组织的定制简历库；
- 本地优先的模型配置、密钥加密和招聘网站授权边界。

[jobfindsme](https://github.com/russeell/jobfindsme) 仅通过独立适配层提供国内岗位发现能力，没有替换或复制 Resume Matcher 的核心简历系统。保留历史是为了尊重真实贡献和方便审计，不表示所有历史贡献者都参与了上述新增功能。详细归属见 [NOTICE](NOTICE)。

## 为什么要做它？

| 真实痛点 | 常见产品的处理方式 | Resume Job Agent |
| --- | --- | --- |
| 岗位散落在多个招聘网站 | 用户逐个搜索、复制、建表 | 一句话描述目标，统一进入岗位审核队列 |
| 每份 JD 都要手动复制给 AI | 聊天窗口一次处理一个岗位 | 保存完整 JD，审批后批量进入定制流程 |
| “优化简历”容易变成凭空包装 | 只追关键词和匹配分 | 以主简历为事实边界，保留改写计划与质量检查 |
| 批量生成后版本迅速失控 | 下载目录里堆满 `resume-final-v3.pdf` | 按公司与岗位管理定制简历及历史版本 |
| AI 改了什么看不出来 | 直接覆盖原文 | 红蓝差异预览，确认后再保存 |
| 简历和密钥属于高敏感数据 | 上传到陌生平台长期保存 | 本地优先，密钥加密保存，明确模型数据边界 |
| 全自动爬取/投递容易触发风控 | 黑盒运行，失败原因不透明 | 可见浏览器、用户授权、遇到验证即停止 |

## 它怎么工作？

```text
主简历（事实来源）
      ↓
一句话找岗位 / 粘贴岗位链接
      ↓
实时岗位列表 → 查看完整 JD → 批量审批
      ↓
AI 分析 JD → 规划改写 → 事实一致性检查
      ↓
每个岗位生成一份定制简历
      ↓
差异预览 → 对话微调 → PDF 导出 → 简历库管理
```

## 已实现功能

- **主简历管理**：上传多份原始简历，指定当前主简历。
- **自然语言岗位发现**：用一句话描述职位、城市、经验和来源偏好。
- **岗位链接导入**：粘贴明确的岗位详情链接，保存来源与完整 JD。
- **人工审核队列**：查看岗位、地点、来源和 JD，支持多选与批量审批。
- **可恢复批量定制**：一岗一份简历，展示处理阶段，失败可重试。
- **有依据的 AI 改写**：围绕 JD 调整表达，不允许虚构主简历中不存在的事实。
- **改写计划与质量检查**：保存 Agent 的规划、关键词覆盖和一致性结果。
- **红蓝差异预览**：清楚看到删除与新增内容，再决定是否采纳。
- **对话式微调**：生成后继续用自然语言修改，而不是重新走完整流程。
- **简历库与 PDF**：按岗位管理生成结果、历史版本、预览和导出。
- **本地模型配置**：支持 OpenAI 兼容接口，API Key 加密存放在本地数据目录。

## 岗位来源现状

| 来源 | 状态 | 说明 |
| --- | --- | --- |
| 岗位详情链接导入 | ✅ 稳定 | 当前最可靠的路径，导入用户明确提供的链接 |
| BOSS 直聘检索 | 🧪 实验性 | 使用可见且由用户授权的 Chrome；可能遇到登录或安全验证 |
| 猎聘、智联招聘、前程无忧 | 🗓️ 规划中 | 适配器入口已预留，暂不伪造搜索结果 |

我们不会绕过验证码、安全验证、登录或访问频率限制，也不会自动投递或自动联系招聘者。招聘网站策略随时可能变化，因此每个来源都会独立标注真实运行状态。

## 3 分钟本地启动

需要 Node.js 22+、[`uv`](https://docs.astral.sh/uv/)、[`pnpm`](https://pnpm.io/installation) 和 Git。PDF 导出需要 Chrome/Chromium；系统 Python 较旧时，`uv` 会自动准备 Python 3.13。

```bash
git clone https://github.com/WhiteSailLabs/resume-job-agent.git
cd resume-job-agent
./scripts/start-local.sh
```

打开 <http://127.0.0.1:3000>，在“设置”中配置你的 LLM。手动安装、Docker、ARK Agent Plan 与 BOSS 使用说明见 [SETUP.zh-CN.md](SETUP.zh-CN.md)。

## 项目原则

1. **人始终在回路中**：搜索结果要审核，修改内容要确认，投递不自动执行。
2. **主简历是事实边界**：优化表达可以，捏造经历、数据和技能不可以。
3. **失败必须可见**：登录、验证、模型或来源不可用时，明确告诉用户发生了什么。
4. **本地优先**：尽量减少敏感数据离开本机的范围和时间。
5. **基于成熟开源能力继续演进**：不为了“重写”而抛弃已经验证过的编辑、预览和导出能力。

## 隐私与边界

- 简历、JD、生成文件和模型密钥默认保存在本地数据目录。
- 只有用户主动发起 AI 操作时，必要的简历与 JD 内容才会发送给所选模型服务商。
- BOSS 集成读取可见、明确授权的 Chrome 页面，不导出密码或 Cookie。
- 当前版本没有账号体系和多用户隔离，请勿直接暴露到公网。
- 使用招聘网站功能时，请遵守对应平台条款及适用法律。

## 技术基础

项目以 Resume Matcher 为产品与代码基础，保留其成熟的简历结构、编辑、预览和 PDF 能力；国内岗位发现通过薄适配层接入 jobfindsme。我们保留上游 Git 历史、许可证与贡献记录，详细归属和修改说明见 [NOTICE](NOTICE)。

## 开发与测试

```bash
# 后端
cd apps/backend
uv sync --extra dev
uv run pytest

# 前端
cd apps/frontend
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

## Roadmap

- [ ] 提升 BOSS 连接稳定性与验证后的恢复体验
- [ ] 接入更多国内招聘来源，并逐个展示真实可用状态
- [ ] 完善岗位搜索的流式反馈、去重和收藏
- [ ] 增加完整的首次使用引导和示例数据
- [ ] 补齐公开 CI（当前模板见 `docs/ci-workflow.example.yml`）

## 一起建设

这个项目需要的不只是代码。真实岗位来源适配、简历质量评估、交互设计、文档和测试都欢迎贡献。

- 发现问题：提交 [Issue](https://github.com/WhiteSailLabs/resume-job-agent/issues)
- 想实现功能：先阅读 [贡献指南](.github/CONTRIBUTING.md)
- 觉得方向有价值：点一个 **Star**，让更多求职者和贡献者找到它

Apache-2.0 License · Made for real-world job seekers, with humans in control.
