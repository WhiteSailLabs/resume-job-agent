const SOURCES = [
  { id: 'boss', host: 'zhipin.com' },
  { id: 'liepin', host: 'liepin.com' },
  { id: 'zhilian', host: 'zhaopin.com' },
  { id: '51job', host: '51job.com' },
];
const PENDING_KEY = 'pending-source-authorization';
const PENDING_TTL_MS = 2 * 60 * 1000;

function sourceForUrl(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return SOURCES.find(({ host }) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return undefined;
  }
}

function visibleLoginProbe() {
  // Return a boolean only. The local Agent never receives DOM text, cookies,
  // passwords, QR data, account names, or any other page content.
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const controls = [...document.querySelectorAll('a,button')]
    .filter(visible)
    .map((element) => ({ text: (element.textContent || '').trim(), href: element.getAttribute('href') || '' }));
  const hasLogout = controls.some(({ text, href }) => /退出登录|退出账号|登出/.test(text) || /logout|signout/i.test(href));
  const hasAccountArea = controls.some(({ text, href }) =>
    /我的|个人中心|消息|在线沟通|账号设置/.test(text) || /chat|account|profile/i.test(href)
  );
  const hasLoginOnly = controls.some(({ text, href }) =>
    /^(登录|注册|登录\/注册)$/.test(text) || /login|signin/i.test(href)
  );
  return hasLogout || (hasAccountArea && !hasLoginOnly);
}

async function setBadge(tabId, text, color) {
  if (!tabId) return;
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
}

async function detectLoggedIn(tab) {
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: visibleLoginProbe,
  });
  return result.some((frame) => frame.result === true);
}

async function notifyAgent(tab, source) {
  const loggedIn = await detectLoggedIn(tab);
  const response = await fetch('http://127.0.0.1:8000/api/v1/jobs/browser-authorizations/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: source.id, page_url: tab.url, logged_in: loggedIn }),
  });
  if (!response.ok) throw new Error(`authorization failed (${response.status})`);
  await setBadge(tab.id, loggedIn ? '✓' : '!', loggedIn ? '#16794c' : '#b42318');
  return loggedIn;
}

function captureVisibleBossJob() {
  // This function runs only after an explicit click in Resume Matcher. It
  // reads neither cookies nor account/profile fields; it selects visible job
  // title, company, location and JD sections from the current detail page.
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const text = (element) => (element?.innerText || element?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  const firstText = (selectors) => {
    for (const selector of selectors) {
      const element = [...document.querySelectorAll(selector)].find(visible);
      const value = text(element);
      if (value) return value;
    }
    return '';
  };
  const title = firstText(['h1', '[class*="job-name"]', '[class*="jobName"]']);
  const company = firstText(['[class*="company-name"]', '[class*="companyName"]', '[class*="company-info"] a']);
  const location = firstText(['[class*="job-area"]', '[class*="jobArea"]', '[class*="job-location"]']);
  const headings = [...document.querySelectorAll('h2,h3,h4,div,span,p')]
    .filter(visible)
    .filter((element) => /^(职位描述|岗位职责|任职要求|职位要求|工作内容)$/.test(text(element)));
  const sections = headings.map((heading) => {
    const container = heading.parentElement?.parentElement || heading.parentElement;
    return text(container);
  }).filter((value) => value.length >= 80);
  const jd = [...new Set(sections)].join('\n\n').slice(0, 30000);
  if (!title || jd.length < 120) {
    throw new Error('未在当前页面识别到完整职位 JD；请确认打开的是职位详情页并展开职位描述。');
  }
  return {
    title: title.split('\n')[0].slice(0, 200),
    company: (company.split('\n')[0] || 'BOSS直聘职位').slice(0, 200),
    location: (location.split('\n')[0] || '未注明').slice(0, 120),
    jd,
  };
}

async function captureCurrentBossJob(resumeId) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const source = sourceForUrl(tab?.url || '');
  if (!tab?.id || source?.id !== 'boss' || !/job_detail|job-detail/i.test(tab.url || '')) {
    throw new Error('请先在 Chrome 当前标签页打开一条 BOSS 职位详情，再点击导入。');
  }
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureVisibleBossJob });
  const captured = results.find((result) => result.result)?.result;
  if (!captured) throw new Error('当前职位页没有可读取的 JD。');
  // A successful explicit capture from a visible BOSS detail page is the
  // authorization signal. No cookie, profile value, or account text is read.
  const authorization = await fetch('http://127.0.0.1:8000/api/v1/jobs/browser-authorizations/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'boss', page_url: tab.url, logged_in: true }),
  });
  if (!authorization.ok) throw new Error(`连接本地 Agent 失败（${authorization.status}）`);
  const response = await fetch('http://127.0.0.1:8000/api/v1/jobs/discovery/browser-capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'boss', page_url: tab.url, resume_id: resumeId || null, ...captured }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail?.message || payload.detail || `导入失败（${response.status}）`);
  await setBadge(tab.id, 'JD', '#16794c');
  return payload;
}

chrome.action.onClicked.addListener((tab) => {
  void setBadge(tab.id, '…', '#1d4ed8');
  void captureCurrentBossJob(null)
    .then(async () => {
      await chrome.action.setTitle({ tabId: tab.id, title: 'JD 已导入 Resume Matcher' });
    })
    .catch(async (error) => {
      await setBadge(tab.id, '!', '#b42318');
      await chrome.action.setTitle({
        tabId: tab.id,
        title: error instanceof Error ? error.message : '导入失败',
      });
    });
});

async function armSource(source) {
  await chrome.storage.session.set({ [PENDING_KEY]: { source, expiresAt: Date.now() + PENDING_TTL_MS } });
}

async function reportIfArmed(tab) {
  const currentSource = sourceForUrl(tab.url || '');
  if (!currentSource) return;
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const pending = stored[PENDING_KEY];
  if (!pending || pending.source !== currentSource.id || pending.expiresAt < Date.now()) return;
  try {
    if (await notifyAgent(tab, currentSource)) await chrome.storage.session.remove(PENDING_KEY);
  } catch {
    await setBadge(tab.id, '!', '#b42318');
  }
}

async function checkOpenSourceTabs() {
  const tabs = await chrome.tabs.query({});
  const sourceTabs = new Map();
  for (const tab of tabs) {
    const source = sourceForUrl(tab.url || '');
    if (!source || !tab.id) continue;
    const current = sourceTabs.get(source.id) || { source, tabs: [] };
    current.tabs.push(tab);
    sourceTabs.set(source.id, current);
  }

  for (const { source, tabs: matchingTabs } of sourceTabs.values()) {
    try {
      // A site can have both a logged-in job tab and a separate login tab.
      // Treat the source as connected when any visible user-opened tab shows a
      // signed-in state. A later login screen must never overwrite that result.
      let signedInTab;
      for (const tab of matchingTabs) {
        if (await detectLoggedIn(tab)) {
          signedInTab = tab;
          break;
        }
      }
      await notifyAgent(signedInTab || matchingTabs[0], source);
    } catch {
      // A protected page or a temporarily unavailable local backend simply
      // remains unconnected; the next 3-second app refresh can retry later.
    }
  }
}

async function broadcastToApp(message) {
  const appTabs = await chrome.tabs.query({ url: ['http://127.0.0.1/*', 'http://localhost/*'] });
  await Promise.all(appTabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)));
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('BOSS 搜索页加载超时'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      cleanup();
      resolve(tab);
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error('BOSS 搜索标签页已关闭，请重新连接后再试'));
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

function captureVisibleBossJobCards() {
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  if (location.href.includes('_security_check') || /安全验证|访问验证|滑动验证/.test(document.body?.innerText || '')) {
    return { verificationRequired: true, jobs: [] };
  }
  const anchors = [...document.querySelectorAll('a[href*="/job_detail/"]')].filter(visible);
  const seen = new Set();
  const jobs = [];
  for (const anchor of anchors) {
    const originalUrl = new URL(anchor.href, location.href).href.split('#')[0];
    if (seen.has(originalUrl)) continue;
    const card = anchor.closest('li, article, [class*="job-card"], [class*="job-list"], [class*="job-item"]') || anchor.parentElement?.parentElement;
    const pick = (selectors) => {
      for (const selector of selectors) {
        const element = card?.querySelector(selector);
        const value = clean(element?.innerText || element?.textContent);
        if (value) return value;
      }
      return '';
    };
    const title = pick(['[class*="job-name"]', '[class*="job-title"]', '.job-name']) || clean(anchor.textContent);
    const company = pick(['[class*="company-name"]', '[class*="company"] a', '[class*="company"]']);
    const locationText = pick(['[class*="job-area"]', '[class*="location"]', '[class*="area"]']);
    if (!title || !company) continue;
    seen.add(originalUrl);
    jobs.push({
      title: title.slice(0, 200),
      company: company.slice(0, 200),
      location: (locationText || '未注明').slice(0, 120),
      originalUrl,
      summary: clean(card?.innerText || '').slice(0, 2000) || '职位列表摘要',
    });
  }
  return { verificationRequired: false, jobs };
}

async function findSignedInBossTab() {
  const tabs = await chrome.tabs.query({ url: ['https://*.zhipin.com/*'] });
  for (const tab of tabs) {
    if (tab.id && await detectLoggedIn(tab).catch(() => false)) return tab;
  }
  return undefined;
}

async function startBossSearch(query, resumeId) {
  if (!query || query.trim().length < 2) throw new Error('请先输入想找的岗位');
  const bossTab = await findSignedInBossTab();
  if (!bossTab?.id) throw new Error('没有检测到已登录的 BOSS 页面，请先在当前 Chrome 登录 BOSS');
  await notifyAgent(bossTab, { id: 'boss', host: 'zhipin.com' });

  const planResponse = await fetch('http://127.0.0.1:8000/api/v1/jobs/discovery/browser-search-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, resume_id: resumeId || null }),
  });
  const planPayload = await planResponse.json().catch(() => ({}));
  if (!planResponse.ok) throw new Error(planPayload.detail || `无法解析搜索要求（${planResponse.status}）`);
  const searches = planPayload.data?.searches || [];
  let collected = 0;
  const seen = new Set();

  for (let searchIndex = 0; searchIndex < searches.length; searchIndex += 1) {
    const search = searches[searchIndex];
    await broadcastToApp({
      type: 'boss-search-progress',
      phase: `正在打开${search.location || ''}岗位页`,
      count: collected,
    });
    const loading = waitForTabComplete(bossTab.id);
    await chrome.tabs.update(bossTab.id, { url: search.url, active: true });
    const loadedTab = await loading;
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const results = await chrome.scripting.executeScript({ target: { tabId: bossTab.id }, func: captureVisibleBossJobCards });
    const capture = results.find((result) => result.result)?.result;
    if (capture?.verificationRequired) throw new Error('BOSS 要求安全验证，已停止搜索，请在页面完成验证后重试');
    for (const job of capture?.jobs || []) {
      if (seen.has(job.originalUrl)) continue;
      seen.add(job.originalUrl);
      const response = await fetch('http://127.0.0.1:8000/api/v1/jobs/discovery/browser-list-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'boss', page_url: loadedTab.url || search.url, resume_id: resumeId || null, original_url: job.originalUrl, title: job.title, company: job.company, location: job.location, summary: job.summary }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `保存岗位失败（${response.status}）`);
      collected += 1;
      await broadcastToApp({ type: 'boss-search-progress', phase: '正在收集岗位', count: collected, job: payload.data });
    }
  }
  await broadcastToApp({ type: 'boss-search-complete', count: collected });
  return { count: collected };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'bridge-health-check') {
    sendResponse({ ready: true });
    return;
  }
  if (message?.type === 'capture-current-boss-job') {
    void captureCurrentBossJob(message.resumeId)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '导入失败' }));
    return true;
  }
  if (message?.type === 'start-boss-search') {
    void startBossSearch(message.query, message.resumeId)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch(async (error) => {
        const text = error instanceof Error ? error.message : '搜索失败';
        await broadcastToApp({ type: 'boss-search-error', error: text });
        sendResponse({ ok: false, error: text });
      });
    return true;
  }
  if (message?.type === 'open-source-login') {
    const source = SOURCES.find((item) => item.id === message.source);
    if (!source) {
      sendResponse({ ok: false, error: '不支持的招聘网站' });
      return;
    }
    const sourceUrl = source.id === 'boss'
      ? 'https://www.zhipin.com/web/geek/jobs'
      : `https://www.${source.host}/`;
    void armSource(source.id)
      .then(() => chrome.tabs.create({ url: sourceUrl, active: true }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '打开失败' }));
    return true;
  }
  if (message?.type === 'arm-source-authorization') void armSource(message.source);
  if (message?.type === 'check-source-connections') void checkOpenSourceTabs();
});

// No page clicking, typing, scraping, or navigation is performed. The bridge
// merely evaluates visible login controls on a user-opened source tab and
// forwards the boolean result to the local Agent.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') void reportIfArmed({ ...tab, id: tabId });
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await reportIfArmed(tab);
});
