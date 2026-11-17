#!/usr/bin/env node
/**
 * qa-report 瀏覽器驅動程式。
 *
 * 以 DevTools 協定操作本機已安裝的 Edge／Chrome，提供 qa-report skill 所需的頁面操作。
 * 設計限制：
 *   - 只用 Node 內建模組，不依賴任何 npm 套件。
 *   - 與瀏覽器之間走行程間管道（--remote-debugging-pipe），不開任何 TCP port。
 *   - 每次使用一次性的空白 profile，結束時整個刪除，不讀取使用者既有的瀏覽器資料。
 *   - 只允許瀏覽白名單內的主機，預設僅本機。
 *   - 閒置逾時自動結束，不留常駐程序。
 *
 * 用法：
 *   node browser-driver.mjs start --out <截圖目錄> [--allow host1,host2] [--viewport 390x844] [--headed] [--browser <路徑>]
 *   node browser-driver.mjs open <url>
 *   node browser-driver.mjs click <selector>
 *   node browser-driver.mjs fill <selector> <值｜env:變數名> [--typed]
 *   node browser-driver.mjs press <Enter|Tab|Escape|Delete|Backspace|ArrowDown|ArrowUp>
 *   node browser-driver.mjs wait <selector｜毫秒>
 *   node browser-driver.mjs text | elements | console | network | back | reload | status
 *   node browser-driver.mjs shot <檔名> [--full]
 *   node browser-driver.mjs run <steps.json>
 *   node browser-driver.mjs hasenv <變數名>
 *   node browser-driver.mjs stop
 *
 * selector 可用 CSS selector，或以 text= 開頭依可見文字比對（例如 text=登入）。
 * 密碼欄位預設只接受 env: 形式的值。使用者在對話中直接提供測試密碼時，
 * 指令要加 --typed 表示這是刻意的；步驟檔會留在報告目錄，所以不接受 --typed。
 *
 * @author hao.hsieh
 * @since 2026-11-16
 *
 * 異動歷史：
 *   2026-11-16 初版
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.join(os.tmpdir(), 'qa-report-driver');
const CURRENT_FILE = path.join(ROOT_DIR, 'current.json');
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 100;
const START_TIMEOUT_MS = 20 * 1000;
const COMMAND_TIMEOUT_MS = 90 * 1000;
const ACTION_TIMEOUT_MS = 60 * 1000;
const STOP_WAIT_MS = 8 * 1000;
const LOAD_TIMEOUT_MS = 30 * 1000;
const SETTLE_MAX_MS = 5000;
const SETTLE_QUIET_MS = 400;
const TEXT_LIMIT = 15000;
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const DEFAULT_VIEWPORT = { width: 1366, height: 768 };
const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const KEYS = {
  Enter: { code: 13, text: '\r' },
  Tab: { code: 9 },
  Escape: { code: 27 },
  Delete: { code: 46 },
  Backspace: { code: 8 },
  ArrowDown: { code: 40 },
  ArrowUp: { code: 38 },
};

/**
 * 在頁面內執行的元素定位函式，以字串注入。
 * mode：rect 取座標、focus 聚焦並全選、option 設定下拉選單值。
 */
const PAGE_LOCATE = `(function (sel, mode, value) {
  function visible(el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }
  var el = null;
  if (sel.indexOf('text=') === 0) {
    var want = sel.slice(5).trim();
    var all = document.querySelectorAll('button,a,label,input[type=button],input[type=submit],[role=button],[role=link],[role=tab],[role=menuitem],li,span,div,td,th,h1,h2,h3,h4,p');
    var bestLen = Infinity;
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (!visible(c)) continue;
      var t = (c.innerText || c.value || '').trim();
      if (t.indexOf(want) === -1) continue;
      if (t.length < bestLen) { bestLen = t.length; el = c; }
    }
  } else {
    el = document.querySelector(sel);
  }
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  var r = el.getBoundingClientRect();
  var out = { found: true, visible: visible(el), x: r.left + r.width / 2, y: r.top + r.height / 2,
    tag: el.tagName.toLowerCase(), type: el.type || '', disabled: !!el.disabled };
  if (mode === 'focus') {
    el.focus();
    if (typeof el.select === 'function') el.select();
    else if (el.isContentEditable) document.execCommand('selectAll');
  }
  if (mode === 'option') {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    out.value = el.value;
  }
  return out;
})`;

/** 在頁面內列出可操作元素的函式，密碼欄位不回傳值。 */
const PAGE_ELEMENTS = `(function () {
  function visible(el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 5 && el !== document.body) {
      var tag = el.tagName.toLowerCase();
      var sibs = el.parentElement ? Array.prototype.filter.call(el.parentElement.children, function (c) { return c.tagName === el.tagName; }) : [];
      parts.unshift(sibs.length > 1 ? tag + ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')' : tag);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  var nodes = document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=menuitem]');
  var out = [];
  for (var i = 0; i < nodes.length && out.length < 150; i++) {
    var el = nodes[i];
    if (!visible(el)) continue;
    var tag = el.tagName.toLowerCase();
    var text = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    var selector = el.id ? '#' + CSS.escape(el.id)
      : el.name ? tag + '[name="' + el.name + '"]'
      : cssPath(el);
    var item = { tag: tag, selector: selector };
    if (el.type) item.type = el.type;
    if (text) item.text = text;
    if (el.placeholder) item.placeholder = el.placeholder;
    if (el.disabled) item.disabled = true;
    if (el.type === 'checkbox' || el.type === 'radio') item.checked = el.checked;
    else if (el.type === 'password') item.value = el.value ? '<hidden>' : '';
    else if (typeof el.value === 'string' && el.value) item.value = el.value.slice(0, 60);
    out.push(item);
  }
  return out;
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 去除網址中的 query，避免把 token 之類的參數寫進輸出。
 *
 * @param {string} raw 原始網址
 * @return {string} 只含來源與路徑的網址
 */
function stripUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return `${u.protocol}...`;
    return u.origin + u.pathname + u.hash.split('?')[0];
  } catch {
    return String(raw).slice(0, 200);
  }
}

/**
 * 以先寫暫存檔再改名的方式寫入 JSON，避免另一端讀到寫一半的內容。
 *
 * @param {string} file 目標檔案
 * @param {unknown} data 要寫入的資料
 */
function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/**
 * 判斷行程是否仍存在。
 *
 * @param {number} pid 行程代號
 * @return {boolean} 存在時為 true
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** DevTools 協定的管道傳輸層，訊息以 NUL 字元分隔。 */
class CdpPipe {
  /**
   * @param {import('node:stream').Writable} writable 寫往瀏覽器的管道
   * @param {import('node:stream').Readable} readable 讀自瀏覽器的管道
   */
  constructor(writable, readable) {
    this.writable = writable;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closedReason = null;
    writable.on('error', (err) => this.close(`pipe error: ${err.message}`));
    readable.on('error', (err) => this.close(`pipe error: ${err.message}`));
    let buffer = Buffer.alloc(0);
    readable.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let end = buffer.indexOf(0);
      while (end !== -1) {
        const message = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        buffer = buffer.subarray(end + 1);
        this.dispatch(message);
        end = buffer.indexOf(0);
      }
    });
  }

  /**
   * 送出一個協定指令。
   *
   * @param {string} method 指令名稱
   * @param {object} params 指令參數
   * @param {string} [sessionId] 目標分頁的 session
   * @return {Promise<object>} 指令結果
   */
  send(method, params = {}, sessionId) {
    if (this.closedReason) return Promise.reject(new Error(`${method}: ${this.closedReason}`));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.writable.write(`${JSON.stringify(payload)}\0`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  /**
   * 連線中斷時讓所有等待中的指令立刻失敗，避免呼叫端永遠等不到回應。
   *
   * @param {string} reason 中斷原因
   */
  close(reason) {
    if (this.closedReason) return;
    this.closedReason = reason;
    for (const waiter of this.pending.values()) waiter.reject(new Error(`${waiter.method}: ${reason}`));
    this.pending.clear();
  }

  /** @param {object} message 瀏覽器送來的訊息 */
  dispatch(message) {
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }
}

/** 單一測試 session：啟動瀏覽器、執行動作、收集 console 與 network 紀錄。 */
class BrowserSession {
  /**
   * @param {object} config start 指令寫下的設定
   * @param {(message: string) => void} log 寫入 server log 的函式
   */
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.allowed = new Set(config.allow);
    this.consoleEntries = [];
    this.networkIssues = [];
    this.notes = [];
    this.inflight = new Set();
    this.requests = new Map();
    this.requestCount = 0;
  }

  /** 啟動瀏覽器並接上一個空白分頁。 */
  async launch() {
    const args = [
      '--remote-debugging-pipe',
      `--user-data-dir=${this.config.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--no-pings',
      `--window-size=${this.config.viewport.width},${this.config.viewport.height}`,
    ];
    if (!this.config.headed) args.push('--headless=new');
    args.push('about:blank');

    this.child = spawn(this.config.browser, args, {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.once('exit', (code) => this.log(`Browser exited, code=${code}`));
    this.cdp = new CdpPipe(this.child.stdio[3], this.child.stdio[4]);
    this.child.once('exit', () => this.cdp.close('browser exited'));
    this.cdp.listeners.add((message) => this.onEvent(message));

    // 瀏覽器啟動時已帶一個空白分頁，直接接管它；之後才出現的分頁一律視為彈出視窗。
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    const existing = targetInfos.find((info) => info.type === 'page');
    const targetId = existing
      ? existing.targetId
      : (await this.cdp.send('Target.createTarget', { url: 'about:blank' })).targetId;
    this.targetId = targetId;
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });

    await this.page('Page.enable');
    await this.page('Runtime.enable');
    await this.page('Network.enable');
    await this.page('Log.enable');
    await this.page('Fetch.enable', { patterns: [{ resourceType: 'Document' }] });
    await this.page('Emulation.setDeviceMetricsOverride', {
      width: this.config.viewport.width,
      height: this.config.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    this.log(`Browser launched, pid=${this.child.pid}, headed=${this.config.headed}`);
  }

  /**
   * 對受控分頁送出指令。
   *
   * @param {string} method 指令名稱
   * @param {object} [params] 指令參數
   * @return {Promise<object>} 指令結果
   */
  page(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  /**
   * 判斷主機是否在白名單內。
   *
   * @param {string} raw 網址
   * @return {boolean} 允許時為 true
   */
  isAllowed(raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'about:' || u.protocol === 'data:' || u.protocol === 'blob:') return true;
      return this.allowed.has(u.hostname);
    } catch {
      return false;
    }
  }

  /** @param {object} message 瀏覽器事件 */
  onEvent(message) {
    const { method, params } = message;
    if (method === 'Target.targetCreated') {
      this.onTargetCreated(params.targetInfo);
      return;
    }
    if (message.sessionId !== this.sessionId) return;
    switch (method) {
      case 'Fetch.requestPaused':
        this.onRequestPaused(params);
        break;
      case 'Page.javascriptDialogOpening':
        this.onDialog(params);
        break;
      case 'Runtime.consoleAPICalled':
        if (['error', 'warning', 'assert'].includes(params.type)) {
          const text = params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
          this.consoleEntries.push({ level: params.type, text: String(text).slice(0, 500) });
        }
        break;
      case 'Runtime.exceptionThrown': {
        const detail = params.exceptionDetails;
        const text = detail.exception?.description ?? detail.text;
        this.consoleEntries.push({ level: 'exception', text: String(text).slice(0, 500) });
        break;
      }
      case 'Log.entryAdded':
        if (['error', 'warning'].includes(params.entry.level)) {
          this.consoleEntries.push({
            level: params.entry.level,
            text: String(params.entry.text).slice(0, 500),
            source: params.entry.url ? stripUrl(params.entry.url) : undefined,
          });
        }
        break;
      case 'Network.requestWillBeSent':
        this.requestCount++;
        this.requests.set(params.requestId, { url: params.request.url, method: params.request.method });
        if (params.type !== 'EventSource') this.inflight.add(params.requestId);
        break;
      case 'Network.responseReceived':
        if (params.response.status >= 400) {
          const req = this.requests.get(params.requestId);
          this.networkIssues.push({
            method: req?.method,
            url: stripUrl(params.response.url),
            status: params.response.status,
            type: params.type,
          });
        }
        break;
      case 'Network.loadingFinished':
        this.inflight.delete(params.requestId);
        this.requests.delete(params.requestId);
        break;
      case 'Network.loadingFailed': {
        const req = this.requests.get(params.requestId);
        this.inflight.delete(params.requestId);
        this.requests.delete(params.requestId);
        if (!params.canceled && req) {
          this.networkIssues.push({
            method: req.method,
            url: stripUrl(req.url),
            failed: params.blockedReason ?? params.errorText,
            type: params.type,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /** 白名單檢查：只攔頁面導覽，不在白名單的一律擋下。 */
  onRequestPaused(params) {
    const allowed = this.isAllowed(params.request.url);
    if (!allowed) {
      this.notes.push({ kind: 'blocked-navigation', url: stripUrl(params.request.url) });
      this.log(`Navigation blocked by allowlist: ${stripUrl(params.request.url)}`);
    }
    const call = allowed
      ? this.page('Fetch.continueRequest', { requestId: params.requestId })
      : this.page('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' });
    call.catch((err) => this.log(`Fetch handling failed: ${err.message}`));
  }

  /** 原生對話框會卡住頁面，所以自動處理並留下紀錄。alert 與離開確認按確定，其餘按取消。 */
  onDialog(params) {
    const accept = params.type === 'alert' || params.type === 'beforeunload';
    this.notes.push({ kind: `dialog-${params.type}`, message: String(params.message).slice(0, 300), accepted: accept });
    this.page('Page.handleJavaScriptDialog', { accept })
      .catch((err) => this.log(`Dialog handling failed: ${err.message}`));
  }

  /** 新開的分頁不在受控與白名單範圍內，直接關閉並留下紀錄。 */
  onTargetCreated(info) {
    if (info.type !== 'page' || info.targetId === this.targetId) return;
    this.notes.push({ kind: 'popup-closed', url: stripUrl(info.url) });
    this.cdp.send('Target.closeTarget', { targetId: info.targetId })
      .catch((err) => this.log(`Popup close failed: ${err.message}`));
  }

  /**
   * 等待指定事件一次。
   *
   * @param {string} method 事件名稱
   * @param {number} timeoutMs 逾時毫秒
   * @return {Promise<boolean>} 逾時前收到事件為 true
   */
  waitEvent(method, timeoutMs) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== method || message.sessionId !== this.sessionId) return;
        clearTimeout(timer);
        this.cdp.listeners.delete(listener);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.cdp.listeners.delete(listener);
        resolve(false);
      }, timeoutMs);
      this.cdp.listeners.add(listener);
    });
  }

  /** 等到沒有進行中的 request 一小段時間，或達到上限。 */
  async settle() {
    const start = Date.now();
    let quietSince = Date.now();
    while (Date.now() - start < SETTLE_MAX_MS) {
      if (this.inflight.size > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= SETTLE_QUIET_MS) return;
      await sleep(50);
    }
  }

  /**
   * 在頁面內執行運算式並取回結果。
   *
   * @param {string} expression JavaScript 運算式
   * @return {Promise<any>} 運算結果
   */
  async evaluate(expression) {
    const result = await this.page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      throw new Error(`page script failed: ${detail.exception?.description ?? detail.text}`);
    }
    return result.result.value;
  }

  /**
   * 定位元素，找不到或不可見時拋出錯誤。
   *
   * @param {string} selector CSS selector 或 text= 文字比對
   * @param {string} mode rect、focus 或 option
   * @param {string} [value] option 模式要設定的值
   * @return {Promise<object>} 元素座標與狀態
   */
  async locate(selector, mode, value) {
    const args = [selector, mode, value ?? ''].map((a) => JSON.stringify(a)).join(', ');
    const found = await this.evaluate(`${PAGE_LOCATE}(${args})`);
    if (!found.found) throw new Error(`element not found: ${selector}`);
    if (!found.visible) throw new Error(`element not visible: ${selector}`);
    return found;
  }

  /** @return {Promise<{url: string, title: string}>} 目前頁面的網址與標題 */
  async where() {
    const info = await this.evaluate('({ url: location.href, title: document.title })');
    return { url: stripUrl(info.url), title: info.title };
  }

  /**
   * 送出一次按鍵。
   *
   * @param {string} name KEYS 中的按鍵名稱
   */
  async pressKey(name) {
    const key = KEYS[name];
    if (!key) throw new Error(`unsupported key: ${name}. supported: ${Object.keys(KEYS).join(', ')}`);
    const base = { key: name, code: name, windowsVirtualKeyCode: key.code, nativeVirtualKeyCode: key.code };
    await this.page('Input.dispatchKeyEvent', { ...base, type: key.text ? 'keyDown' : 'rawKeyDown', text: key.text });
    await this.page('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  /**
   * 執行一個動作。
   *
   * @param {object} cmd 動作與參數
   * @return {Promise<object>} 動作結果
   */
  async handle(cmd) {
    switch (cmd.action) {
      case 'open': {
        if (!this.isAllowed(cmd.url)) {
          throw new Error(`host not in allowlist: ${stripUrl(cmd.url)}. allowed: ${[...this.allowed].join(', ')}`);
        }
        const loaded = this.waitEvent('Page.loadEventFired', LOAD_TIMEOUT_MS);
        const nav = await this.page('Page.navigate', { url: cmd.url });
        if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
        // 同一份文件內的導覽（只換 hash）不會有 load 事件，不必等。
        const done = nav.loaderId ? await loaded : true;
        await this.settle();
        return { ...(await this.where()), loadEvent: done };
      }
      case 'back':
      case 'reload': {
        const loaded = this.waitEvent('Page.loadEventFired', LOAD_TIMEOUT_MS);
        if (cmd.action === 'reload') await this.page('Page.reload');
        else await this.evaluate('history.back()');
        await Promise.race([loaded, sleep(3000)]);
        await this.settle();
        return this.where();
      }
      case 'click': {
        const el = await this.locate(cmd.selector, 'rect');
        if (el.disabled) throw new Error(`element is disabled: ${cmd.selector}`);
        const point = { x: el.x, y: el.y, button: 'left', clickCount: 1 };
        await this.page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: el.x, y: el.y });
        await this.page('Input.dispatchMouseEvent', { ...point, type: 'mousePressed' });
        await this.page('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased' });
        await sleep(150);
        await this.settle();
        return this.where();
      }
      case 'fill': {
        const probe = await this.locate(cmd.selector, 'rect');
        if (probe.disabled) throw new Error(`element is disabled: ${cmd.selector}`);
        if (probe.type === 'password' && !cmd.fromEnv && !cmd.typed) {
          throw new Error('password fields need env:NAME, or --typed for a test password the user gave in chat');
        }
        if (probe.tag === 'select') {
          const set = await this.locate(cmd.selector, 'option', cmd.value);
          if (set.value !== cmd.value) throw new Error(`option not available: ${cmd.selector}`);
        } else {
          await this.locate(cmd.selector, 'focus');
          if (cmd.value === '') await this.pressKey('Delete');
          else await this.page('Input.insertText', { text: cmd.value });
        }
        await this.settle();
        return this.where();
      }
      case 'press':
        await this.pressKey(cmd.key);
        await sleep(150);
        await this.settle();
        return this.where();
      case 'wait': {
        if (/^\d+$/.test(cmd.target)) {
          await sleep(Math.min(Number(cmd.target), 30000));
          return this.where();
        }
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const args = [cmd.target, 'rect', ''].map((a) => JSON.stringify(a)).join(', ');
          const found = await this.evaluate(`${PAGE_LOCATE}(${args})`);
          if (found.found && found.visible) return this.where();
          await sleep(200);
        }
        throw new Error(`timed out waiting for: ${cmd.target}`);
      }
      case 'text': {
        const text = await this.evaluate('document.body ? document.body.innerText : ""');
        return { ...(await this.where()), truncated: text.length > TEXT_LIMIT, text: text.slice(0, TEXT_LIMIT) };
      }
      case 'elements':
        return { ...(await this.where()), elements: await this.evaluate(PAGE_ELEMENTS) };
      case 'shot': {
        const name = path.basename(String(cmd.name)).replace(/[\\/:*?"<>|\s]/g, '_').replace(/\.png$/i, '');
        const file = path.join(this.config.outDir, `${name}.png`);
        const shot = await this.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!cmd.full });
        fs.mkdirSync(this.config.outDir, { recursive: true });
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        return { ...(await this.where()), file };
      }
      case 'console': {
        const entries = this.consoleEntries.splice(0);
        return { count: entries.length, entries };
      }
      case 'network': {
        const issues = this.networkIssues.splice(0);
        const notes = this.notes.splice(0);
        const total = this.requestCount;
        this.requestCount = 0;
        return { totalRequests: total, issueCount: issues.length, issues, notes };
      }
      case 'status':
        return { ...(await this.where()), allowed: [...this.allowed], outDir: this.config.outDir };
      case 'stop':
        return { stopped: true };
      default:
        throw new Error(`unknown action: ${cmd.action}`);
    }
  }

  /** 關閉瀏覽器，關不掉就強制結束。 */
  async close() {
    if (!this.child || this.child.exitCode !== null) return;
    this.cdp.send('Browser.close').catch(() => {});
    await Promise.race([this.exited, sleep(3000)]);
    if (this.child.exitCode === null) {
      this.log('Browser did not exit in time, killing process');
      this.child.kill();
      await Promise.race([this.exited, sleep(2000)]);
    }
  }
}

/**
 * 背景服務主迴圈：輪詢 session 目錄中的指令檔，執行後寫回結果檔。
 *
 * @param {string} sessionDir session 目錄
 */
async function serve(sessionDir) {
  const config = JSON.parse(fs.readFileSync(path.join(sessionDir, 'config.json'), 'utf8'));
  const logFile = path.join(sessionDir, 'server.log');
  const log = (message) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  const session = new BrowserSession(config, log);
  let stopReason = 'stop command';

  try {
    await session.launch();
    writeJsonAtomic(path.join(sessionDir, 'ready.json'), { pid: process.pid, browserPid: session.child.pid });
    let lastActivity = Date.now();
    let running = true;
    session.child.once('exit', () => {
      if (running) stopReason = 'browser exited unexpectedly';
      running = false;
    });

    while (running) {
      const pending = fs.readdirSync(sessionDir)
        .filter((name) => /^cmd-\d+\.json$/.test(name))
        .sort();
      if (pending.length === 0) {
        if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
          stopReason = 'idle timeout';
          break;
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const file = path.join(sessionDir, pending[0]);
      const cmd = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.rmSync(file);
      let result;
      try {
        const timeout = sleep(ACTION_TIMEOUT_MS).then(() => {
          throw new Error(`action exceeded ${ACTION_TIMEOUT_MS} ms`);
        });
        result = { ok: true, action: cmd.action, ...(await Promise.race([session.handle(cmd), timeout])) };
      } catch (err) {
        log(`Action failed, action=${cmd.action}, cause=${err.message}`);
        result = { ok: false, action: cmd.action, error: err.message };
      }
      writeJsonAtomic(path.join(sessionDir, pending[0].replace('cmd-', 'res-')), result);
      lastActivity = Date.now();
      if (cmd.action === 'stop') break;
    }
  } catch (err) {
    log(`Server failed, cause=${err.stack ?? err.message}`);
    writeJsonAtomic(path.join(sessionDir, 'error.json'), { error: err.message });
    stopReason = 'startup failure';
  } finally {
    log(`Shutting down, reason=${stopReason}`);
    await session.close();
    // 留一點時間讓 client 讀走最後的結果檔，再刪除整個 session（含 profile）。
    await sleep(1500);
    if (stopReason !== 'startup failure') {
      fs.rmSync(sessionDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      fs.rmSync(CURRENT_FILE, { force: true });
    }
  }
}

/**
 * 解析 --name value 形式的選項。
 *
 * @param {string[]} argv 參數陣列
 * @return {{flags: Record<string, string|boolean>, rest: string[]}} 選項與其餘參數
 */
function parseArgs(argv) {
  const flags = {};
  const rest = [];
  const booleans = new Set(['headed', 'full', 'typed']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (booleans.has(name)) flags[name] = true;
    else flags[name] = argv[++i];
  }
  return { flags, rest };
}

/** @return {{sessionDir: string, pid: number}|null} 目前執行中的 session */
function readCurrent() {
  if (!fs.existsSync(CURRENT_FILE)) return null;
  const current = JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf8'));
  if (isAlive(current.pid) && fs.existsSync(current.sessionDir)) return current;
  fs.rmSync(CURRENT_FILE, { force: true });
  fs.rmSync(current.sessionDir, { recursive: true, force: true });
  return null;
}

/**
 * 啟動背景服務並等它就緒。
 *
 * @param {Record<string, string|boolean>} flags start 的選項
 * @return {Promise<object>} session 資訊
 */
async function start(flags) {
  if (readCurrent()) throw new Error('a session is already running. run "stop" first');
  if (!flags.out) throw new Error('--out <screenshot dir> is required');

  const browser = flags.browser ?? BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!browser || !fs.existsSync(browser)) throw new Error('no Edge or Chrome found. pass --browser <path>');

  const viewport = { ...DEFAULT_VIEWPORT };
  if (flags.viewport) {
    const match = /^(\d+)x(\d+)$/.exec(String(flags.viewport));
    if (!match) throw new Error('--viewport must look like 390x844');
    viewport.width = Number(match[1]);
    viewport.height = Number(match[2]);
  }
  const extraHosts = flags.allow ? String(flags.allow).split(',').map((h) => h.trim()).filter(Boolean) : [];

  const sessionDir = path.join(ROOT_DIR, `s-${Date.now()}`);
  fs.mkdirSync(path.join(sessionDir, 'profile'), { recursive: true });
  const config = {
    browser,
    headed: !!flags.headed,
    viewport,
    allow: [...DEFAULT_ALLOWED_HOSTS, ...extraHosts],
    outDir: path.resolve(String(flags.out)),
    profileDir: path.join(sessionDir, 'profile'),
  };
  fs.writeFileSync(path.join(sessionDir, 'config.json'), JSON.stringify(config));

  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', sessionDir], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(path.join(sessionDir, 'ready.json'))) {
      const { pid, browserPid } = JSON.parse(fs.readFileSync(path.join(sessionDir, 'ready.json'), 'utf8'));
      writeJsonAtomic(CURRENT_FILE, { sessionDir, pid, browserPid });
      return { ok: true, action: 'start', browser: path.basename(browser), allowed: config.allow, outDir: config.outDir, viewport };
    }
    if (fs.existsSync(path.join(sessionDir, 'error.json'))) break;
    await sleep(100);
  }
  const logFile = path.join(sessionDir, 'server.log');
  const tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').slice(-8).join('\n') : '(no log)';
  throw new Error(`browser did not start. log: ${sessionDir}\n${tail}`);
}

/**
 * 把一個動作交給背景服務並等待結果。
 *
 * @param {object} cmd 動作與參數
 * @return {Promise<object>} 動作結果
 */
async function dispatch(cmd, timeoutMs = COMMAND_TIMEOUT_MS) {
  const current = readCurrent();
  if (!current) throw new Error('no session running. run "start" first');
  const id = `${Date.now()}${String(process.hrtime.bigint() % 1000n).padStart(3, '0')}`;
  const resFile = path.join(current.sessionDir, `res-${id}.json`);
  writeJsonAtomic(path.join(current.sessionDir, `cmd-${id}.json`), cmd);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(resFile)) {
      const result = JSON.parse(fs.readFileSync(resFile, 'utf8'));
      fs.rmSync(resFile, { force: true });
      return result;
    }
    if (!isAlive(current.pid)) throw new Error('session ended before the action finished');
    await sleep(50);
  }
  throw new Error(`action timed out: ${cmd.action}`);
}

/**
 * 結束 session。背景服務沒有在時限內自行結束時，強制終止它與瀏覽器並清掉 session 目錄，
 * 確保卡住的 session 一定關得掉。
 *
 * @return {Promise<object>} 結束結果
 */
async function stop() {
  const current = readCurrent();
  if (!current) return { ok: true, action: 'stop', stopped: false, note: 'no session running' };
  let forced = false;
  try {
    await dispatch({ action: 'stop' }, STOP_WAIT_MS);
  } catch {
    // 服務沒回應時改走下方的強制結束。
  }
  const deadline = Date.now() + STOP_WAIT_MS;
  while (isAlive(current.pid) && Date.now() < deadline) await sleep(100);
  if (isAlive(current.pid)) {
    forced = true;
    for (const pid of [current.pid, current.browserPid]) {
      try {
        if (pid) process.kill(pid);
      } catch {
        // 行程已不存在。
      }
    }
    await sleep(500);
  }
  fs.rmSync(current.sessionDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  fs.rmSync(CURRENT_FILE, { force: true });
  return { ok: true, action: 'stop', stopped: true, forced };
}

/**
 * 把指令列參數轉成動作物件。fill 的值以 env: 開頭時改讀環境變數，避免密碼出現在指令列。
 *
 * @param {string} action 動作名稱
 * @param {string[]} rest 位置參數
 * @param {Record<string, string|boolean>} flags 選項
 * @return {object} 動作物件
 */
function buildCommand(action, rest, flags) {
  const need = (count, usage) => {
    if (rest.length < count) throw new Error(`usage: ${usage}`);
  };
  switch (action) {
    case 'open':
      need(1, 'open <url>');
      return { action, url: rest[0] };
    case 'click':
      need(1, 'click <selector>');
      return { action, selector: rest[0] };
    case 'fill':
      need(2, 'fill <selector> <value|env:NAME> [--typed]');
      return { action, selector: rest[0], value: resolveValue(rest[1]), fromEnv: isEnvRef(rest[1]), typed: !!flags.typed };
    case 'press':
      need(1, 'press <key>');
      return { action, key: rest[0] };
    case 'wait':
      need(1, 'wait <selector|ms>');
      return { action, target: rest[0] };
    case 'shot':
      need(1, 'shot <name> [--full]');
      return { action, name: rest[0], full: !!flags.full };
    case 'text':
    case 'elements':
    case 'console':
    case 'network':
    case 'back':
    case 'reload':
    case 'status':
      return { action };
    default:
      throw new Error(`unknown action: ${action}`);
  }
}

/**
 * @param {unknown} value 指令或步驟檔中的值
 * @return {boolean} 是否為 env: 形式
 */
function isEnvRef(value) {
  return typeof value === 'string' && value.startsWith('env:');
}

/**
 * @param {string} value 原始值，或 env:變數名
 * @return {string} 實際要輸入的值
 */
function resolveValue(value) {
  if (!isEnvRef(value)) return value;
  const name = value.slice(4);
  if (process.env[name] === undefined) throw new Error(`environment variable not set: ${name}`);
  return process.env[name];
}

/** 指令列進入點。 */
async function main() {
  const [action, ...argv] = process.argv.slice(2);
  if (action === 'serve') {
    await serve(argv[0]);
    // 動作逾時用的計時器可能還在，明確結束行程，不讓背景服務多留。
    process.exit(0);
  }
  const { flags, rest } = parseArgs(argv);
  let output;
  try {
    if (!action) throw new Error('missing action. see the header of this file for usage');
    if (action === 'start') {
      output = await start(flags);
    } else if (action === 'stop') {
      output = await stop();
    } else if (action === 'hasenv') {
      if (!rest[0]) throw new Error('usage: hasenv <NAME>');
      output = { ok: true, action, name: rest[0], set: !!process.env[rest[0]] };
    } else if (action === 'run') {
      if (!rest[0]) throw new Error('usage: run <steps.json>');
      const steps = JSON.parse(fs.readFileSync(rest[0], 'utf8'));
      const results = [];
      for (const step of steps) {
        const cmd = step.action === 'fill'
          ? { ...step, value: resolveValue(step.value), fromEnv: isEnvRef(step.value), typed: false }
          : step;
        const result = await dispatch(cmd);
        results.push(result);
        if (!result.ok) break;
      }
      output = { ok: results.every((r) => r.ok), action: 'run', results };
    } else {
      output = await dispatch(buildCommand(action, rest, flags));
    }
  } catch (err) {
    output = { ok: false, action: action ?? null, error: err.message };
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
}

await main();
