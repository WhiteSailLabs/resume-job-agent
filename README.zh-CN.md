# Resume Job Agent｜求职简历 Agent

[English](README.md) · [安装说明](SETUP.zh-CN.md) · [安全说明](.github/SECURITY.md)

Resume Job Agent 是一个本地优先的求职工作流：一句话寻找岗位、审核完整 JD、根据主简历批量生成岗位定制简历，并在简历库中继续用 AI 微调和导出 PDF。

项目以成熟开源项目 [Resume Matcher](https://github.com/srbhr/Resume-Matcher) 为产品基础，复用其简历数据、编辑、预览和 PDF 导出能力；国内岗位发现通过独立适配层接入 [jobfindsme](https://github.com/russeell/jobfindsme)，没有另造一套平行简历系统。

## 用户流程

1. 上传并管理多个原始简历，指定一份主简历。
2. 用一句话描述目标岗位，或粘贴一个岗位详情链接。
3. 查看岗位来源、地点和完整 JD，批量审核需要定制的岗位。
4. 直接批量生成，每个岗位对应一份可恢复、可重试的定制简历。
5. 查看 AI 的改写规划与质量检查，并通过对话继续微调。
6. 用红蓝差异预览确认修改，再保存和导出 PDF。

## 当前岗位来源

| 来源 | 状态 | 说明 |
| --- | --- | --- |
| 岗位详情链接导入 | 稳定 | 推荐路径，一次导入一个明确链接。 |
| BOSS 直聘检索 | 实验功能 | 使用可见、由用户授权的 Chrome，会受登录和安全验证影响。 |
| 猎聘、智联、前程无忧 | 规划中 | 不返回伪造结果，未完成时会在界面如实显示。 |

项目不会绕过验证码、安全验证、登录和访问频率限制，也不会自动投递或给招聘者发消息。

## 快速启动

需要 Python 3.13+、Node.js 22+、`uv`、`pnpm`；PDF 导出还需要 Chrome/Chromium。

```bash
git clone https://github.com/WhiteSailLabs/resume-job-agent.git
cd resume-job-agent
./scripts/start-local.sh
```

打开 <http://127.0.0.1:3000>，然后在“设置”中配置 LLM。API Key 会加密保存在本地数据目录，不会进入 Git。

手动安装、Docker、ARK Agent Plan 与 BOSS 使用说明见 [SETUP.zh-CN.md](SETUP.zh-CN.md)。

## 隐私边界

- 简历、JD、生成文件和模型密钥默认只保存在本机。
- 只有在用户选择模型并发起 AI 操作时，简历与 JD 才会发送到对应模型服务商。
- BOSS 集成只读取专用或明确授权的 Chrome 可见页面，不导出密码和 Cookie。
- 当前版本没有账号系统和多用户隔离，请勿直接暴露在公网。

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

## 开源来源

本项目是 Resume Matcher 的 Apache-2.0 衍生项目。岗位发现通过固定版本的 MIT 协议 jobfindsme 依赖接入。具体归属和版本见 [NOTICE](NOTICE)。
