// Runs only on the local Resume Matcher jobs page. It turns the user's click
// on a source-login button into one pending browser authorization; it never
// reads page text, credentials, cookies, or any third-party page content.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const payload = event.data;
  if (
    payload?.channel === 'resume-matcher-browser-bridge' &&
    payload.type === 'bridge-health-check'
  ) {
    chrome.runtime.sendMessage({ type: 'bridge-health-check' }, (response) => {
      if (chrome.runtime.lastError || response?.ready !== true) return;
      window.postMessage(
        { channel: 'resume-matcher-browser-bridge', type: 'bridge-ready' },
        window.location.origin
      );
    });
    return;
  }
  if (
    payload?.channel === 'resume-matcher-browser-bridge' &&
    payload.type === 'check-source-connections'
  ) {
    chrome.runtime.sendMessage({ type: 'check-source-connections' });
    return;
  }
  if (
    payload?.channel === 'resume-matcher-browser-bridge' &&
    payload.type === 'start-boss-search'
  ) {
    chrome.runtime.sendMessage(
      { type: 'start-boss-search', query: payload.query, resumeId: payload.resumeId || null },
      (response) => {
        if (chrome.runtime.lastError || response?.ok !== true) {
          window.postMessage(
            {
              channel: 'resume-matcher-browser-bridge',
              type: 'boss-search-error',
              error: chrome.runtime.lastError?.message || response?.error || '搜索未能启动',
            },
            window.location.origin
          );
        }
      }
    );
    return;
  }
  if (
    payload?.channel === 'resume-matcher-browser-bridge' &&
    payload.type === 'capture-current-boss-job'
  ) {
    chrome.runtime.sendMessage(
      { type: 'capture-current-boss-job', resumeId: payload.resumeId || null },
      (response) => {
        window.postMessage(
          {
            channel: 'resume-matcher-browser-bridge',
            type: 'boss-job-capture-result',
            ok: response?.ok === true,
            payload: response?.payload,
            error: chrome.runtime.lastError?.message || response?.error,
          },
          window.location.origin
        );
      }
    );
    return;
  }
  if (
    !payload ||
    payload.channel !== 'resume-matcher-browser-bridge' ||
    payload.type !== 'authorize-source' ||
    !['boss', 'liepin', 'zhilian', '51job'].includes(payload.source)
  ) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'open-source-login', source: payload.source });
});

// Announce readiness as well as responding to the page's handshake. This
// handles a local React page that mounts while Chrome is still attaching the
// content script after an unpacked-extension reload.
const announceReady = () =>
  window.postMessage(
    { channel: 'resume-matcher-browser-bridge', type: 'bridge-ready' },
    window.location.origin
  );
announceReady();
window.setInterval(announceReady, 1500);

// On page load the Agent asks the bridge to inspect only the visible login
// indicators of already-open source tabs. No source-page text is returned.
chrome.runtime.sendMessage({ type: 'check-source-connections' });

chrome.runtime.onMessage.addListener((message) => {
  if (!['boss-search-progress', 'boss-search-complete', 'boss-search-error'].includes(message?.type)) return;
  window.postMessage(
    { channel: 'resume-matcher-browser-bridge', ...message },
    window.location.origin
  );
});
