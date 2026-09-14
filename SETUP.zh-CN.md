# 安装说明

## 本地一键启动

先安装 Node.js 22+、[`uv`](https://docs.astral.sh/uv/)、[`pnpm`](https://pnpm.io/installation) 和 Git；需要时 `uv` 会自动准备 Python 3.13。然后执行：

```bash
git clone https://github.com/WhiteSailLabs/resume-job-agent.git
cd resume-job-agent
./scripts/start-local.sh
```

首次运行会安装依赖和用于 PDF 导出的 Playwright Chromium。打开 <http://127.0.0.1:3000>，在“设置”中配置模型。

## 手动启动

终端 1：

```bash
cd apps/backend
uv sync --extra dev
uv run playwright install chromium
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

终端 2：

```bash
cd apps/frontend
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1
```

## 配置模型

设置页支持上游已有服务商和 OpenAI 兼容接口。火山方舟 Agent Plan 可填写：

- 提供商：`OpenAI Compatible`
- Base URL：`https://ark.cn-beijing.volces.com/api/plan/v3`
- 模型：`doubao-seed-evolving`
- API Key：用户自己的 Agent Plan 专属密钥

不要把密钥写进仓库。设置页保存的密钥会加密存放在已被 Git 忽略的 `apps/backend/data/`。

## BOSS 岗位发现（实验功能）

最稳定的方式是“粘贴岗位链接”。自动检索 BOSS 是可选能力，可能遇到登录或安全验证。

1. 进入“岗位发现”。
2. 点击“连接 BOSS”。
3. 如果弹出专用 Chrome，在其中完成登录。
4. 回到应用，等待状态变为“已连接”。
5. 开始检索，保持 Chrome 窗口可见，岗位会逐条进入列表。

适配器不会读取密码、导出 Cookie、绕过验证码、自动投递或自动联系招聘者。若 BOSS 页面变化或阻止访问，请改用岗位链接导入，并只提交脱敏后的错误信息。

`apps/browser-bridge` 还包含供贡献者测试的未打包 Chrome 扩展，默认连接上述本地端口。

## Docker

```bash
docker compose up --build
```

打开 <http://127.0.0.1:3000>。Docker 支持简历流程与 PDF 导出；可见的 BOSS 桌面 Chrome 集成不保证能在容器内工作，容器环境请优先使用链接导入。

## 数据与备份

本地数据位于 `apps/backend/data/`，Docker 使用 `resume-data` 数据卷。升级前请备份。不要把该目录附在 Issue 中，因为其中可能包含简历、JD 和加密后的模型凭据。

## 测试

```bash
cd apps/backend && uv sync --extra dev && uv run pytest
cd ../frontend && pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm build
```
