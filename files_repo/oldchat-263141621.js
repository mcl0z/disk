#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import chalk from 'chalk';

const API_BASE = 'http://60.205.94.101:8080';
const BURN_ALLOWED = new Set([5, 10, 20, 30, 60, 300]);
const CONFIG_PATH = path.join(os.homedir(), '.oldchat.json');

const state = {
  accessToken: '',
  refreshToken: '',
  user: null,
  friends: [],
  groups: [],
  friendMap: new Map(),
  groupMap: new Map(),
  groupMemberMap: new Map(),
  unreadDirect: new Map(),
  unreadGroup: new Map(),
  lastNotifiedUnreadTotal: 0,
  active: null,
  messages: [],
  ws: null,
  wsConnected: false,
  sessionId: '',
  encKey: null,
  macKey: null,
  refreshInFlight: false,
  pollTimer: null,
  quoteDraft: null,
  burnConsumed: new Map(),
  redPacketDone: new Map(),
};

function loadStorage() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      state.accessToken = data.accessToken || '';
      state.refreshToken = data.refreshToken || '';
      state.user = data.user || null;
    }
  } catch (err) {}
}

function saveStorage() {
  try {
    const data = {
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      user: state.user,
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBurnSeconds(sec) {
  const n = Number(sec) || 0;
  return BURN_ALLOWED.has(n) ? n : 0;
}

function isBurnEnabled(sec) {
  return normalizeBurnSeconds(sec) > 0;
}

function isBurnLockedMessage(msg) {
  if (!msg) return false;
  const type = (msg.msg_type || 'text').toLowerCase();
  return type !== 'recall' && isBurnEnabled(msg.burn_after_seconds);
}

function formatTime(ts) {
  if (!ts) return '';
  const millis = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(millis);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function displayNameForUID(uid) {
  if (!uid) return '';
  const upper = uid.toUpperCase();
  return state.friendMap.get(upper)?.name || upper;
}

function base64ToBytes(str) {
  return new Uint8Array(Buffer.from(str, 'base64'));
}
function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}
function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}
async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, data);
  return new Uint8Array(sig);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function pkcs7Unpad(data) {
  if (!data.length) return data;
  const pad = data[data.length - 1];
  if (pad <= 0 || pad > 16) return data;
  return data.slice(0, data.length - pad);
}

async function apiRequest(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = options.headers || {};
  if (options.auth !== false && state.accessToken) {
    headers['Authorization'] = `Bearer ${state.accessToken}`;
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? (options.body instanceof FormData ? options.body : JSON.stringify(options.body)) : undefined,
  });
  if (res.status === 401 && options.auth !== false && state.refreshToken) {
    const refreshed = await refreshToken();
    if (refreshed) return apiRequest(path, options);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { ok: true, data };
}

async function refreshToken() {
  if (state.refreshInFlight) return false;
  state.refreshInFlight = true;
  try {
    const resp = await apiRequest('/v1/auth/refresh', {
      method: 'POST',
      body: { refresh_token: state.refreshToken },
      auth: false,
    });
    if (resp.data?.access_token) {
      state.accessToken = resp.data.access_token;
      if (resp.data.refresh_token) state.refreshToken = resp.data.refresh_token;
      saveStorage();
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    state.refreshInFlight = false;
  }
}

async function login(identifier, password) {
  const body = {
    identifier,
    password,
    device_id: `term-${crypto.randomUUID()}`,
    device_name: 'Linux Terminal',
    platform: 'terminal',
    app_version: '1.0',
  };
  const resp = await apiRequest('/v1/auth/login', { method: 'POST', body, auth: false });
  state.accessToken = resp.data.access_token;
  state.refreshToken = resp.data.refresh_token;
  state.user = resp.data.user;
  saveStorage();
  console.log(chalk.green('✓ 登录成功'), `欢迎 ${state.user.display_name || state.user.username}`);
}

async function logout() {
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  state.accessToken = '';
  state.refreshToken = '';
  state.user = null;
  state.active = null;
  state.messages = [];
  state.quoteDraft = null;
  state.wsConnected = false;
  state.lastNotifiedUnreadTotal = 0;
  saveStorage();
  console.log(chalk.yellow('已登出'));
}

async function loadFriends() {
  const resp = await apiRequest('/v1/friends');
  const friends = resp.data.friends || [];
  state.friends = friends.map(f => ({
    uid: (f.uid || f.id || '').toUpperCase(),
    name: f.display_name || f.username || f.uid || f.id,
  })).filter(f => f.uid);
  state.friendMap.clear();
  state.friends.forEach(f => state.friendMap.set(f.uid, f));
}

async function loadGroups() {
  const resp = await apiRequest('/v1/groups/list');
  const groups = resp.data.groups || [];
  state.groups = groups.map(g => ({
    id: (g.group_id || g.id || '').toUpperCase(),
    name: g.name || g.group_id,
  })).filter(g => g.id);
  state.groupMap.clear();
  state.groups.forEach(g => state.groupMap.set(g.id, g));
}

async function loadGroupMembers(groupId) {
  if (!groupId) return;
  const resp = await apiRequest(`/v1/groups/members?group_id=${encodeURIComponent(groupId)}`);
  const members = resp.data.members || [];
  const map = new Map();
  members.forEach(m => {
    const uid = (m.uid || '').toUpperCase();
    if (uid) map.set(uid, m.display_name || m.username || uid);
  });
  state.groupMemberMap.set(groupId, map);
}

function parseMessagePayload(body) {
  const out = { v: 0, text: '', mediaKind: '', voiceText: '', quote: null, mentions: [], forward: null };
  if (body == null) return out;
  let obj;
  try { obj = JSON.parse(body); } catch { return out; }
  if (typeof obj !== 'object') return out;
  out.v = Number(obj.v || 0);
  out.text = String(obj.text || obj.title || '');
  out.mediaKind = String(obj.media_kind || '');
  out.voiceText = String(obj.voice_text || '');
  if (obj.quote && typeof obj.quote === 'object') {
    out.quote = {
      id: String(obj.quote.id || ''),
      from_uid: String(obj.quote.from_uid || ''),
      from_name: String(obj.quote.from_name || ''),
      type: String(obj.quote.type || ''),
      text: String(obj.quote.text || ''),
      media_kind: String(obj.quote.media_kind || ''),
    };
  }
  if (Array.isArray(obj.mentions)) {
    out.mentions = obj.mentions.map(m => ({ uid: String(m.uid).toUpperCase(), name: String(m.name) }));
  }
  return out;
}

function quotePreviewText(type, mediaKind, text) {
  if (text?.trim()) return text;
  type = (type || '').toLowerCase();
  if (type === 'image') return mediaKind === 'emoji' ? '[表情]' : '[图片]';
  if (type === 'voice') return '[语音]';
  if (type === 'video') return '[视频]';
  if (type === 'resource') return '[文件]';
  if (type === 'red_packet') return '[红包]';
  return '';
}

function parseRedPacketBody(body) {
  const payload = { packetId: '', title: '', totalAmount: 0, totalCount: 0, status: '', remainingCount: null };
  if (!body) return payload;
  try {
    const obj = typeof body === 'string' ? JSON.parse(body) : body;
    payload.packetId = String(obj.packet_id || '');
    payload.title = String(obj.text || obj.title || '');
    payload.totalAmount = Number(obj.total_amount) || 0;
    payload.totalCount = Number(obj.total_count) || 0;
    payload.status = String(obj.status || '');
    if (obj.remaining_count !== undefined) payload.remainingCount = Number(obj.remaining_count) || 0;
  } catch {
    payload.title = String(body);
  }
  return payload;
}

function isRedPacketDone(packetId, redPacket) {
  if (state.redPacketDone.has(packetId)) return true;
  if (!redPacket) return false;
  if ((redPacket.status || '').toLowerCase() === 'done') return true;
  if (redPacket.remainingCount != null && redPacket.remainingCount <= 0) return true;
  return false;
}

function formatMessage(msg) {
  const myUid = state.user?.uid?.toUpperCase() || '';
  const fromUid = (msg.from_uid || '').toUpperCase();
  const isMine = fromUid === myUid;
  const sender = isMine ? '你' : (displayNameForUID(fromUid) || fromUid);
  const time = formatTime(msg.created_at || msg.createdAt);
  const type = (msg.msg_type || 'text').toLowerCase();
  const payload = parseMessagePayload(msg.body);

  let content = '';
  const burnLocked = isBurnLockedMessage(msg);
  const consumed = state.burnConsumed.has(msg.id);

  if (burnLocked && !consumed) {
    content = chalk.red('[阅后即焚] 输入 /burn <消息id> 查看');
  } else if (burnLocked && consumed) {
    content = chalk.gray(isMine ? '你发送的阅后即焚消息已销毁' : '该阅后即焚消息已销毁');
  } else if (type === 'image') {
    content = chalk.blue('[图片]') + ' ' + (msg.media_url || '');
  } else if (type === 'video') {
    content = chalk.blue('[视频]') + ' ' + (msg.media_url || '');
  } else if (type === 'voice') {
    const sec = Math.max(1, Math.round((Number(msg.duration_ms) || 0) / 1000));
    content = chalk.cyan(`[语音] ${sec}秒`);
  } else if (type === 'resource') {
    content = chalk.magenta('[文件]') + ' ' + (msg.media_url || '');
  } else if (type === 'red_packet') {
    const red = parseRedPacketBody(msg.body);
    const done = isRedPacketDone(red.packetId, red);
    content = (done ? chalk.gray('[红包已领完]') : chalk.yellow('[红包]')) + ' ' + (red.title || '恭喜发财');
  } else if (type === 'recall') {
    content = chalk.gray(payload.text || (isMine ? '你撤回了一条消息' : '对方撤回了一条消息'));
  } else {
    content = payload.text || msg.body || '';
  }

  if (!burnLocked && payload.quote) {
    const quote = payload.quote;
    const quoteSender = quote.from_name || quote.from_uid || '未知';
    const quoteText = quotePreviewText(quote.type, quote.media_kind, quote.text);
    content = chalk.dim(`[引用 ${quoteSender}: ${quoteText}]`) + '\n' + content;
  }

  const prefix = `${chalk.gray(`[${time}]`)} ${chalk.bold(sender)}:`;
  return `${prefix} ${content}`;
}

async function loadDirectMessages(uid) {
  const resp = await apiRequest(`/v1/direct/messages/v2?with_uid=${encodeURIComponent(uid)}&limit=50`);
  state.messages = (resp.data.messages || []).sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  printMessages();
}

async function loadGroupMessages(groupId) {
  const resp = await apiRequest(`/v1/groups/messages/v2?group_id=${encodeURIComponent(groupId)}&limit=50`);
  state.messages = (resp.data.messages || []).sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  printMessages();
}

function printMessages() {
  console.log(chalk.cyan('\n--- 历史消息 ---'));
  state.messages.forEach(msg => console.log(formatMessage(msg)));
  console.log(chalk.cyan('--- 以上是历史 ---\n'));
}

async function sendMessage(text) {
  if (!state.active) {
    console.log(chalk.red('请先使用 /open 打开一个会话'));
    return;
  }
  const plain = text.trim();
  if (!plain) return;

  let body = plain;
  if (state.quoteDraft) {
    const payload = {
      v: 2,
      text: plain,
      quote: {
        id: state.quoteDraft.id,
        from_uid: state.quoteDraft.from_uid,
        from_name: state.quoteDraft.from_name,
        type: state.quoteDraft.type,
        text: state.quoteDraft.text,
      }
    };
    body = JSON.stringify(payload);
    state.quoteDraft = null;
  }

  const burnAfter = normalizeBurnSeconds(0);

  try {
    let resp;
    if (state.active.type === 'direct') {
      resp = await apiRequest('/v1/direct/send', {
        method: 'POST',
        body: { to_uid: state.active.id, body, msg_type: 'text', burn_after_seconds: burnAfter }
      });
    } else {
      resp = await apiRequest('/v1/groups/message/send', {
        method: 'POST',
        body: { group_id: state.active.id, body, msg_type: 'text', burn_after_seconds: burnAfter }
      });
    }
    const msg = resp.data;
    state.messages.push(msg);
    console.log(formatMessage(msg));
  } catch (err) {
    console.log(chalk.red('发送失败:'), err.message);
  }
}

async function markDirectRead(uid) {
  try { await apiRequest('/v1/direct/read', { method: 'POST', body: { with_uid: uid } }); } catch {}
}
async function markGroupRead(groupId) {
  try { await apiRequest('/v1/groups/read', { method: 'POST', body: { group_id: groupId } }); } catch {}
}

async function openRedPacket(packetId, msg) {
  try {
    const detail = await apiRequest(`/v1/redpackets/${encodeURIComponent(packetId)}`);
    const red = detail.data;
    const done = (red.status || '').toLowerCase() === 'done' || (red.remaining_count || 0) <= 0;
    if (done) state.redPacketDone.set(packetId, true);

    console.log(chalk.yellow(`红包: ${red.title || '恭喜发财'}`));
    console.log(`金额: ${red.total_amount} 旧币, 个数: ${red.total_count}, 剩余: ${red.remaining_count || 0}`);

    if (red.can_claim) {
      const answer = await question('是否领取？(y/n) ');
      if (answer.toLowerCase() === 'y') {
        const claim = await apiRequest('/v1/redpackets/claim', { method: 'POST', body: { packet_id: packetId } });
        console.log(chalk.green(`领取成功 +${claim.data.amount} 旧币`));
        if (claim.data.remaining_count <= 0) state.redPacketDone.set(packetId, true);
      }
    } else {
      console.log('无法领取（可能已领完或无权）');
    }
  } catch (err) {
    console.log(chalk.red('红包操作失败:'), err.message);
    if (err.data && typeof err.data === 'string' && err.data.includes('red_packet_empty')) {
      state.redPacketDone.set(packetId, true);
    }
  }
}

async function viewBurnMessage(msgId) {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg) { console.log('消息不存在'); return; }
  if (!isBurnLockedMessage(msg) || state.burnConsumed.has(msgId)) {
    console.log('该消息不可查看或已销毁');
    return;
  }
  const payload = parseMessagePayload(msg.body);
  console.log(chalk.red('--- 阅后即焚内容 (10秒后销毁) ---'));
  console.log(payload.text || msg.body);
  console.log(chalk.red('--------------------------------'));
  state.burnConsumed.set(msgId, true);
  setTimeout(() => {
    console.log(chalk.gray('阅后即焚消息已销毁'));
  }, 10000);
}

async function fetchUnread() {
  if (!state.accessToken) return;
  try {
    const direct = await apiRequest('/v1/direct/unread', { method: 'POST', body: { limit: 50 } });
    const dMap = new Map();
    (direct.data.messages || []).forEach(msg => {
      const peer = (msg.peer_uid || '').toUpperCase();
      if (peer) dMap.set(peer, (dMap.get(peer) || 0) + 1);
    });
    state.unreadDirect = dMap;

    const group = await apiRequest('/v1/groups/unread', { method: 'POST', body: { limit: 50 } });
    const gMap = new Map();
    (group.data.messages || []).forEach(msg => {
      const gid = (msg.group_id || '').toUpperCase();
      if (gid) gMap.set(gid, (gMap.get(gid) || 0) + 1);
    });
    state.unreadGroup = gMap;

    const total = [...dMap.values()].reduce((a, b) => a + b, 0) +
                  [...gMap.values()].reduce((a, b) => a + b, 0);

    if (total > 0 && total > state.lastNotifiedUnreadTotal) {
      console.log(chalk.yellow(`\n[通知] 您有 ${total} 条未读消息（输入 /unread 查看详情）`));
      state.lastNotifiedUnreadTotal = total;
    } else if (total === 0) {
      state.lastNotifiedUnreadTotal = 0;
    }
  } catch {}
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  const interval = state.wsConnected ? 45000 : 15000;
  state.pollTimer = setInterval(fetchUnread, interval);
}

async function ensureSession() {
  if (state.sessionId && state.encKey && state.macKey) return;
  if (!crypto.subtle) throw new Error('WebCrypto not available');

  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const spki = await crypto.subtle.exportKey('spki', keys.publicKey);
  const clientPub = bytesToBase64(new Uint8Array(spki));

  const resp = await apiRequest('/v1/auth/handshake', {
    method: 'POST',
    body: { client_pub: clientPub },
    auth: false,
  });
  const serverPubBytes = base64ToBytes(resp.data.server_pub);
  const serverPub = await crypto.subtle.importKey('spki', serverPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: serverPub }, keys.privateKey, 256);
  const secretBytes = new Uint8Array(secret);

  state.sessionId = resp.data.session_id;
  state.encKey = await sha256(concatBytes(secretBytes, new TextEncoder().encode('enc')));
  state.macKey = await sha256(concatBytes(secretBytes, new TextEncoder().encode('mac')));
}

async function decryptEnvelope(payload) {
  if (!state.encKey || !state.macKey) return null;
  let env;
  try { env = JSON.parse(payload); } catch { return null; }
  if (!env.iv || !env.data || !env.mac) return null;
  const iv = base64ToBytes(env.iv);
  const ciphertext = base64ToBytes(env.data);
  const mac = base64ToBytes(env.mac);
  const expected = await hmacSha256(state.macKey, concatBytes(iv, ciphertext));
  if (!timingSafeEqual(mac, expected)) return null;

  const key = await crypto.subtle.importKey('raw', state.encKey, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ciphertext);
  const plainBytes = pkcs7Unpad(new Uint8Array(plain));
  return new TextDecoder().decode(plainBytes);
}

async function connectWS() {
  if (!state.accessToken) return;
  try {
    await ensureSession();
  } catch (err) {
    console.log(chalk.yellow('加密握手失败，将使用轮询'), err.message);
    state.wsConnected = false;
    return;
  }

  const wsUrl = `${API_BASE.replace('http', 'ws')}/v1/ws?token=${encodeURIComponent(state.accessToken)}&sid=${encodeURIComponent(state.sessionId)}`;
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.on('open', () => {
    state.wsConnected = true;
    console.log(chalk.green('WebSocket 已连接'));
    startPolling();
  });

  ws.on('close', () => {
    state.wsConnected = false;
    console.log(chalk.yellow('WebSocket 已断开'));
    startPolling();
  });

  ws.on('error', (err) => {
    console.log(chalk.red('WebSocket 错误:'), err.message);
  });

  ws.on('message', async (data) => {
    const text = data.toString();
    let msg;
    try { msg = JSON.parse(text); } catch {}
    if (!msg) {
      const decrypted = await decryptEnvelope(text);
      if (decrypted) {
        try { msg = JSON.parse(decrypted); } catch {}
      }
    }
    if (!msg) return;
    handleWSMessage(msg);
  });
}

function handleWSMessage(msg) {
  if (!msg.type) return;
  if (msg.type === 'direct_message') handleDirectMessage(msg.data);
  else if (msg.type === 'group_message') handleGroupMessage(msg.data);
}

function handleDirectMessage(data) {
  const fromUid = (data.from_uid || '').toUpperCase();
  if (state.active && state.active.type === 'direct' && state.active.id === fromUid) {
    state.messages.push(data);
    console.log(formatMessage(data));
    markDirectRead(fromUid);
  } else {
    state.unreadDirect.set(fromUid, (state.unreadDirect.get(fromUid) || 0) + 1);
  }
}

function handleGroupMessage(data) {
  const groupId = (data.group_id || '').toUpperCase();
  if (state.active && state.active.type === 'group' && state.active.id === groupId) {
    state.messages.push(data);
    console.log(formatMessage(data));
    markGroupRead(groupId);
  } else {
    state.unreadGroup.set(groupId, (state.unreadGroup.get(groupId) || 0) + 1);
  }
}

function closeSession() {
  if (!state.active) {
    console.log(chalk.yellow('当前没有打开的会话'));
    return;
  }
  state.active = null;
  state.messages = [];
  state.quoteDraft = null;
  console.log(chalk.green('已退出会话，不再显示实时消息'));
}

async function handleCommand(line) {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/login':
      if (parts.length < 3) { console.log('用法: /login <账号> <密码>'); return; }
      await login(parts[1], parts[2]);
      await loadFriends();
      await loadGroups();
      await connectWS();
      startPolling();
      break;

    case '/logout':
      await logout();
      break;

    case '/list':
      if (parts[1] === 'message') {
        if (!state.active) {
          console.log(chalk.red('没有打开的会话，请先使用 /open 打开一个会话'));
        } else {
          if (state.active.type === 'direct') {
            await loadDirectMessages(state.active.id);
          } else {
            await loadGroupMessages(state.active.id);
          }
          console.log(chalk.green('已刷新消息，你现在处于实时接收模式，可直接输入文字发送消息，输入 /close 退出'));
        }
      } else if (parts[1] === 'friends') {
        console.log(chalk.cyan('\n好友列表:'));
        state.friends.forEach(f => {
          const unread = state.unreadDirect.get(f.uid) || 0;
          console.log(`  ${f.name} (${f.uid})${unread ? chalk.yellow(` [${unread}条未读]`) : ''}`);
        });
      } else if (parts[1] === 'groups') {
        console.log(chalk.cyan('\n群组列表:'));
        state.groups.forEach(g => {
          const unread = state.unreadGroup.get(g.id) || 0;
          console.log(`  ${g.name} (${g.id})${unread ? chalk.yellow(` [${unread}条未读]`) : ''}`);
        });
      } else {
        console.log('用法: /list friends|groups|message');
      }
      break;

    case '/unread':
      {
        const dUnread = [...state.unreadDirect.entries()].filter(([_, count]) => count > 0);
        const gUnread = [...state.unreadGroup.entries()].filter(([_, count]) => count > 0);
        if (dUnread.length === 0 && gUnread.length === 0) {
          console.log(chalk.green('没有未读消息'));
        } else {
          if (dUnread.length) {
            console.log(chalk.cyan('\n私聊未读:'));
            dUnread.forEach(([uid, count]) => {
              const name = displayNameForUID(uid) || uid;
              console.log(`  ${name} (${uid}) : ${count}条`);
            });
          }
          if (gUnread.length) {
            console.log(chalk.cyan('\n群组未读:'));
            gUnread.forEach(([gid, count]) => {
              const name = state.groupMap.get(gid)?.name || gid;
              console.log(`  ${name} (${gid}) : ${count}条`);
            });
          }
        }
      }
      break;

    case '/open':
      if (parts.length < 3) { console.log('用法: /open <friend|group> <id>'); return; }
      {
        const type = parts[1] === 'friend' ? 'direct' : 'group';
        const id = parts[2].toUpperCase();
        state.active = { type, id };
        state.quoteDraft = null;
        if (type === 'direct') {
          state.unreadDirect.delete(id);
          await loadDirectMessages(id);
        } else {
          state.unreadGroup.delete(id);
          await loadGroupMembers(id);
          await loadGroupMessages(id);
        }
        console.log(chalk.green(`已切换到 ${type === 'direct' ? '私聊' : '群组'} ${id}，进入实时接收模式`));
      }
      break;

    case '/close':
      closeSession();
      break;

    case '/quote':
      if (parts.length < 2) { console.log('用法: /quote <消息id>'); return; }
      {
        const msgId = parts[1];
        const msg = state.messages.find(m => m.id === msgId);
        if (!msg) { console.log('消息不存在'); return; }
        const payload = parseMessagePayload(msg.body);
        state.quoteDraft = {
          id: msg.id,
          from_uid: msg.from_uid,
          from_name: displayNameForUID(msg.from_uid) || msg.from_uid,
          type: msg.msg_type || 'text',
          text: quotePreviewText(msg.msg_type, payload.mediaKind, payload.text),
        };
        console.log(chalk.green('已设置引用:'), state.quoteDraft.text);
      }
      break;

    case '/burn':
      if (parts.length < 2) { console.log('用法: /burn <消息id>'); return; }
      await viewBurnMessage(parts[1]);
      break;

    case '/redpacket':
    case '/rp':
      if (parts.length < 2) { console.log('用法: /redpacket <红包ID>'); return; }
      await openRedPacket(parts[1], null);
      break;

    case '/exit':
    case '/quit':
      console.log('再见');
      process.exit(0);
      break;

    case '/help':
      console.log(`
可用命令:
  /login <账号> <密码>         登录
  /logout                      登出
  /list friends|groups|message 列出好友/群组/重新加载当前会话消息
  /unread                       查看详细未读消息
  /open friend|group <id>       打开会话并进入实时接收模式
  /close                        退出当前会话，停止实时消息显示
  /quote <消息id>               引用消息
  /burn <消息id>                查看阅后即焚消息
  /redpacket <红包id>           查看/领取红包
  /exit                         退出程序
  /help                         显示帮助
直接输入文本发送消息到当前会话
      `);
      break;

    default:
      if (line.startsWith('/')) {
        console.log('未知命令，输入 /help 查看帮助');
      } else {
        await sendMessage(line);
      }
  }
}

let rl;

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  rl = createInterface({ input: stdin, output: stdout, prompt: chalk.blue('oldchat> ') });

  loadStorage();
  if (state.accessToken && state.user) {
    console.log(chalk.green('检测到已保存的登录信息，尝试自动登录...'));
    try {
      await loadFriends();
      await loadGroups();
      await connectWS();
      startPolling();
      console.log(chalk.green('自动登录成功'));
    } catch (err) {
      console.log(chalk.yellow('自动登录失败，请手动登录'), err.message);
      state.accessToken = '';
      state.refreshToken = '';
      state.user = null;
    }
  }

  console.log(chalk.cyan('旧聊终端版 (输入 /help 查看帮助)'));
  rl.prompt();

  rl.on('line', async (line) => {
    if (line.trim()) {
      try {
        await handleCommand(line);
      } catch (err) {
        console.log(chalk.red('错误:'), err.message);
      }
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n再见');
    process.exit(0);
  });
}

main().catch(console.error);