# Resume Job Agent Browser Bridge

This unpacked Chrome extension connects the local Resume Job Agent discovery page to a visible, signed-in BOSS tab. An AI search request opens an ordinary BOSS result page and imports only the visible job cards one at a time. It never reads or sends cookies, passwords, QR codes, account details, or application data, and it does not auto-apply, auto-chat, bypass verification, scroll, or paginate.

## Install locally

1. In Chrome, open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `apps/browser-bridge` folder.
3. Open Resume Job Agent in that same Chrome profile.
4. Keep one signed-in BOSS tab open. On 岗位发现, enter one sentence and click **开始寻找**. The extension opens the visible result page and streams its visible cards into Resume Matcher.

Authorization is kept only in the running local backend and expires after eight hours or a backend restart. The extension checks visible login controls on user-opened source tabs and returns only a yes/no result; it does not inspect cookies or send page text.
