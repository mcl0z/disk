// ========== 密码哈希 ==========
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ========== 生成随机 token ==========
function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// ========== 从 token 获取用户 ==========
async function getUserFromToken(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return await env.USERS.get(`token:${token}`);
}

// ========== 获取用户完整信息 ==========
async function getUserInfo(email, env) {
  const userData = await env.USERS.get(`user:${email}`);
  return userData ? JSON.parse(userData) : null;
}

// ========== 获取用户角色 ==========
async function getUserRole(email, env) {
  const user = await getUserInfo(email, env);
  return user ? user.role : null;
}

// ========== 检查是否是超级管理员 ==========
async function isSuperAdmin(email, env) {
  const role = await getUserRole(email, env);
  return role === 'superadmin';
}

// ========== 检查是否至少是管理员 ==========
async function isAtLeastAdmin(email, env) {
  const role = await getUserRole(email, env);
  return role === 'admin' || role === 'superadmin';
}

// ========== 检查用户是否被封禁 ==========
async function isUserBanned(email, env) {
  const user = await getUserInfo(email, env);
  if (!user || !user.bannedUntil) return false;
  return new Date(user.bannedUntil) > new Date();
}

// ========== 获取客户端IP ==========
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 
         request.headers.get('X-Forwarded-For')?.split(',')[0] || 
         'unknown';
}

// ========== 检查IP注册限制 ==========
async function checkIPLimit(ip, env) {
  const today = new Date().toISOString().split('T')[0];
  const key = `reg:${ip}:${today}`;
  const count = await env.USERS.get(key, 'json') || 0;
  if (count >= 1) return false;
  await env.USERS.put(key, JSON.stringify(count + 1), { expirationTtl: 86400 });
  return true;
}

// ========== 密码强度检查 ==========
function validatePassword(password) {
  if (password.length < 6) return '密码长度至少6位';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return '密码必须同时包含字母和数字';
  return null;
}

// ========== 头像大小限制（500KB）==========
const MAX_AVATAR_SIZE = 500 * 1024;

// ========== 文章分区常量 ==========
const CATEGORIES = ['小说', '软件', '破解', '逆向', '新人报道', '其他'];

// ========== 发送邮箱常量 ==========
const SENDER_EMAIL = 'no-reply@coloryi.top';

// ========== 验证码相关函数 ==========
function generateCaptcha() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ========== 使用 Resend 发送邮件（直接提供 HTML 内容） ==========
async function sendEmail(to, subject, html, env) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: SENDER_EMAIL,
      to: [to],
      subject: subject,
      html: html,
    }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend error: ${res.status} ${error}`);
  }
  return res.json();
}

// ========== 生成注册验证码邮件 HTML ==========
function getCaptchaEmailHtml(code) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>注册验证码</title>
        <style>
            body { font-family: sans-serif; background: #f4f7fc; padding: 20px; }
            .container { max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .header { background: #1e88e5; padding: 24px; text-align: center; color: white; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 32px 24px; }
            .code-box { background: #f0f7ff; border: 1px solid #d0e2f2; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
            .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e88e5; }
            .note { font-size: 14px; color: #5e7a93; line-height: 1.6; text-align: center; }
            .footer { background: #f8fafd; padding: 20px; font-size: 12px; color: #8a9db0; text-align: center; border-top: 1px solid #e6edf4; }
            .footer a { color: #1e88e5; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Coloryi | 轻蓝博客</h1>
            </div>
            <div class="content">
                <p style="font-size: 16px;">您好，</p>
                <p style="font-size: 16px;">您正在注册 Coloryi 轻蓝博客，您的验证码为：</p>
                <div class="code-box">
                    <div class="code">${code}</div>
                </div>
                <p class="note">
                    验证码 5 分钟内有效，请勿泄露给他人。<br>
                    如果您没有请求此操作，请忽略本邮件。
                </p>
            </div>
            <div class="footer">
                <p>© 2026 Coloryi · 自动发送，请勿回复</p>
                <p><a href="https://blog.coloryi.top">返回博客</a></p>
            </div>
        </div>
    </body>
    </html>
  `;
}

// ========== 生成两步验证码邮件 HTML ==========
function get2FAEmailHtml(code) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>两步验证码</title>
        <style>
            body { font-family: sans-serif; background: #f4f7fc; padding: 20px; }
            .container { max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .header { background: #1e88e5; padding: 24px; text-align: center; color: white; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 32px 24px; }
            .code-box { background: #f0f7ff; border: 1px solid #d0e2f2; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
            .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e88e5; }
            .note { font-size: 14px; color: #5e7a93; line-height: 1.6; text-align: center; }
            .footer { background: #f8fafd; padding: 20px; font-size: 12px; color: #8a9db0; text-align: center; border-top: 1px solid #e6edf4; }
            .footer a { color: #1e88e5; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Coloryi | 轻蓝博客</h1>
            </div>
            <div class="content">
                <p style="font-size: 16px;">您好，</p>
                <p style="font-size: 16px;">您正在进行两步验证，您的验证码为：</p>
                <div class="code-box">
                    <div class="code">${code}</div>
                </div>
                <p class="note">
                    验证码 5 分钟内有效，请勿泄露给他人。<br>
                    如果您没有请求此操作，请忽略本邮件。
                </p>
            </div>
            <div class="footer">
                <p>© 2026 Coloryi · 自动发送，请勿回复</p>
                <p><a href="https://blog.coloryi.top">返回博客</a></p>
            </div>
        </div>
    </body>
    </html>
  `;
}

async function checkCaptchaLimit(email, env, prefix = 'captcha') {
  const key = `${prefix}:${email}`;
  const data = await env.USERS.get(key, 'json');
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  if (!data) return { allowed: true, count: 0 };
  if (now - data.lastSendAt > oneDay) data.count = 0;
  return { allowed: data.count < 3, count: data.count };
}

async function storeCaptcha(email, code, env, prefix = 'captcha', ttl = 24 * 60 * 60) {
  const key = `${prefix}:${email}`;
  const now = Date.now();
  const data = await env.USERS.get(key, 'json') || { count: 0, lastSendAt: 0 };
  const oneDay = 24 * 60 * 60 * 1000;
  if (now - data.lastSendAt > oneDay) {
    data.count = 1;
  } else {
    data.count = (data.count || 0) + 1;
  }
  data.lastSendAt = now;
  data.code = code;
  data.createdAt = now;
  await env.USERS.put(key, JSON.stringify(data), { expirationTtl: ttl });
}

async function verifyCaptcha(email, code, env, prefix = 'captcha') {
  const key = `${prefix}:${email}`;
  const data = await env.USERS.get(key, 'json');
  if (!data) return false;
  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  if (now - data.createdAt > fiveMin) return false;
  return data.code === code;
}

async function deleteCaptcha(email, env, prefix = 'captcha') {
  const key = `${prefix}:${email}`;
  await env.USERS.delete(key);
}

// ========== 等级经验计算 ==========
const EXP_LEVELS = [0, 100, 300, 600, 1000, 1500]; // LV1~6
function getLevelFromExp(exp) {
  let level = 1;
  for (let i = EXP_LEVELS.length - 1; i >= 0; i--) {
    if (exp >= EXP_LEVELS[i]) {
      level = i + 1;
      break;
    }
  }
  return level;
}

// ========== 重置每日赠送计数 ==========
function resetDailyGivenIfNeeded(user) {
  const today = new Date().toISOString().split('T')[0];
  if (user.lastGivenResetDate !== today) {
    user.todayGivenCoins = 0;
    user.lastGivenResetDate = today;
  }
  return user;
}

// ========== 重置每日分享计数 ==========
function resetDailyShareIfNeeded(user) {
  const today = new Date().toISOString().split('T')[0];
  if (user.lastShareDate !== today) {
    user.todayShared = 0;
    user.lastShareDate = today;
  }
  return user;
}

// ========== 路由处理 ==========
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 处理分享链接和用户主页
  if (path === '/' && method === 'GET') {
    const postId = url.searchParams.get('post');
    const username = url.searchParams.get('user');
    if (postId) {
      return handleSharedPostView(request, env);
    } else if (username) {
      return handleUserProfileView(request, env);
    }
  }

  // API 路由
  if (path === '/api/signup' && method === 'POST') return handleSignup(request, env);
  if (path === '/api/login' && method === 'POST') return handleLogin(request, env);
  if (path === '/api/user/info' && method === 'GET') return handleUserInfo(request, env);
  if (path === '/api/user/update-displayname' && method === 'POST') return handleUpdateDisplayName(request, env);
  if (path === '/api/user/change-password' && method === 'POST') return handleChangePassword(request, env);
  if (path === '/api/user/request-delete' && method === 'POST') return handleUserRequestDelete(request, env);
  if (path === '/api/user/avatar' && method === 'POST') return handleUploadAvatar(request, env);
  if (path === '/api/send-captcha' && method === 'POST') return handleSendCaptcha(request, env);
  if (path === '/api/user/claim-daily-coin' && method === 'POST') return handleClaimDailyCoin(request, env);
  if (path === '/api/user/gift-coin' && method === 'POST') return handleGiftCoin(request, env);
  if (path === '/api/user/share-post' && method === 'POST') return handleSharePost(request, env);
  // 签到和购买会员
  if (path === '/api/user/sign' && method === 'POST') return handleSign(request, env);
  if (path === '/api/user/buy-membership' && method === 'POST') return handleBuyMembership(request, env);
  // 管理员设置会员
  if (path === '/api/admin/user/set-membership' && method === 'POST') return handleAdminSetMembership(request, env);
  if (path === '/api/admin/user/set-coins' && method === 'POST') return handleAdminSetCoins(request, env);

  // 2FA 相关 API
  if (path === '/api/user/enable-2fa' && method === 'POST') return handleEnable2FA(request, env);
  if (path === '/api/user/disable-2fa' && method === 'POST') return handleDisable2FA(request, env);
  if (path === '/api/user/send-2fa-code' && method === 'POST') return handleSend2FACode(request, env);
  if (path === '/api/user/verify-2fa' && method === 'POST') return handleVerify2FA(request, env);

  if (path === '/api/posts' && method === 'GET') return handleGetAllPosts(request, env);
  if (path === '/api/user/posts' && method === 'GET') return handleGetUserPosts(request, env);
  if (path === '/api/posts' && method === 'POST') return handleCreatePost(request, env);
  if (path === '/api/posts/delete' && method === 'POST') return handleDeletePost(request, env);
  if (path === '/api/admin/post/pin' && method === 'POST') return handlePinPost(request, env);
  if (path === '/api/admin/post/category' && method === 'POST') return handleUpdatePostCategory(request, env);

  if (path === '/api/comments' && method === 'GET') return handleGetComments(request, env);
  if (path === '/api/comments' && method === 'POST') return handleCreateComment(request, env);

  if (path === '/api/admin/users' && method === 'GET') return handleAdminGetUsers(request, env);
  if (path === '/api/admin/user/delete' && method === 'POST') return handleAdminDeleteUser(request, env);
  if (path === '/api/admin/reset-password' && method === 'POST') return handleAdminResetPassword(request, env);
  if (path === '/api/admin/set-role' && method === 'POST') return handleAdminSetRole(request, env);
  if (path === '/api/admin/approve-delete' && method === 'POST') return handleAdminApproveDelete(request, env);
  if (path === '/api/admin/user/ban' && method === 'POST') return handleBanUser(request, env);

  if (path === '/api/feedback' && method === 'POST') return handleSubmitFeedback(request, env);
  if (path === '/api/user/feedbacks' && method === 'GET') return handleGetUserFeedbacks(request, env);
  if (path === '/api/admin/feedback' && method === 'GET') return handleGetAllFeedback(request, env);
  if (path === '/api/admin/feedback/mark-read' && method === 'POST') return handleMarkFeedbackRead(request, env);
  if (path === '/api/admin/feedback/update' && method === 'POST') return handleUpdateFeedback(request, env);
  if (path === '/api/admin/feedback/delete' && method === 'POST') return handleDeleteFeedback(request, env);

  if (path === '/api/report' && method === 'POST') return handleSubmitReport(request, env);
  if (path === '/api/admin/reports' && method === 'GET') return handleGetAllReports(request, env);
  if (path === '/api/admin/report/process' && method === 'POST') return handleProcessReport(request, env);

  if (path === '/api/announcement' && method === 'GET') return handleGetAnnouncement(request, env);
  if (path === '/api/announcement' && method === 'POST') return handleSetAnnouncement(request, env);
  if (path === '/api/announcement/read' && method === 'POST') return handleMarkAnnouncementRead(request, env);

  return new Response(getFrontendHTML(), {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// ========== 处理分享链接的游客视图 ==========
async function handleSharedPostView(request, env) {
  const url = new URL(request.url);
  const postId = url.searchParams.get('post');
  if (!postId) {
    return new Response('文章ID不存在', { status: 400 });
  }

  const postData = await env.POSTS.get(`post:${postId}`, 'json');
  if (!postData) {
    return new Response('文章不存在', { status: 404 });
  }

  const author = await getUserInfo(postData.author, env);
  const authorDisplayName = author ? (author.displayName || author.username) : postData.author;
  const authorAvatar = author ? author.avatar : null;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${postData.title} - Coloryi分享</title>
        <link rel="icon" href="https://docs.coloryi.top/favicon.ico">
        <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        <style>
            body { font-family: sans-serif; background: #e6f0fa; padding: 20px; margin: 0; }
            .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #e0edf5; }
            .avatar { width: 48px; height: 48px; border-radius: 50%; background: #e6eef9; display: flex; align-items: center; justify-content: center; font-size: 24px; cursor: pointer; }
            .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
            .meta { flex: 1; }
            .author { font-weight: bold; font-size: 1.2rem; }
            .date { color: #5e7a93; font-size: 0.9rem; }
            .title { font-size: 2rem; margin: 20px 0; }
            .content { line-height: 1.8; }
            .footer { margin-top: 30px; text-align: center; color: #5e7a93; }
            .btn { display: inline-block; padding: 8px 16px; background: #1e88e5; color: white; text-decoration: none; border-radius: 6px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="avatar" onclick="window.location.href='/?user=${encodeURIComponent(author ? author.username : '')}'">
                    ${authorAvatar ? `<img src="${authorAvatar}" alt="avatar">` : (authorDisplayName ? authorDisplayName.charAt(0) : '?')}
                </div>
                <div class="meta">
                    <div class="author">${authorDisplayName}</div>
                    <div class="date">${new Date(postData.createdAt).toLocaleString()}</div>
                </div>
            </div>
            <h1 class="title">${postData.title}</h1>
            <div class="content" id="content">加载中...</div>
            <div class="footer">
                <a href="https://blog.coloryi.top" class="btn">前往 Coloryi 博客</a>
            </div>
        </div>
        <script>
            const content = ${JSON.stringify(postData.content)};
            const format = ${JSON.stringify(postData.format)};
            document.getElementById('content').innerHTML = format === 'markdown' ? marked.parse(content) : content;
        </script>
    </body>
    </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

// ========== 处理用户个人主页 ==========
async function handleUserProfileView(request, env) {
  const url = new URL(request.url);
  const username = url.searchParams.get('user');
  if (!username) {
    return new Response('用户名不存在', { status: 400 });
  }

  const email = await env.USERS.get(`username:${username.toLowerCase()}`);
  if (!email) {
    return new Response('用户不存在', { status: 404 });
  }

  const user = await getUserInfo(email, env);
  if (!user) {
    return new Response('用户不存在', { status: 404 });
  }

  const postsList = await env.POSTS.list({ prefix: 'post:' });
  const userPosts = [];
  for (const key of postsList.keys) {
    const postData = await env.POSTS.get(key.name, 'json');
    if (postData && postData.author === email) {
      userPosts.push(postData);
    }
  }
  userPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const postsHtml = userPosts.map(post => `
    <div class="post-card" onclick="window.location.href='/?post=${post.id}'">
      <div class="post-id">#${post.id.substring(0, 8)}</div>
      <div><span class="post-category">${post.category || '其他'}</span></div>
      <h3 class="post-title">${post.title}</h3>
      <div class="post-content">${post.content.replace(/<[^>]*>/g, '').slice(0, 100)}...</div>
      <div class="post-meta">
        <span>📅 ${new Date(post.createdAt).toLocaleDateString()}</span>
        <span>🪙 ${post.receivedCoins || 0}</span>
      </div>
    </div>
  `).join('') || '<p>该用户暂无文章</p>';

  const expLevels = [0, 100, 300, 600, 1000, 1500];
  const level = user.role === 'superadmin' ? 6 : (user.level || 1);
  const exp = user.role === 'superadmin' ? 1500 : (user.exp || 0);
  let nextExp = level < 6 ? expLevels[level] : expLevels[5];
  let prevExp = level > 1 ? expLevels[level-1] : 0;
  let percent = level < 6 ? ((exp - prevExp) / (nextExp - prevExp)) * 100 : 100;

  let membershipText = '无会员';
  if (user.role === 'superadmin') {
    membershipText = '超级大会员（管理员）';
  } else if (user.membership === 'super') {
    membershipText = '超级大会员';
  } else if (user.membership === 'regular') {
    membershipText = '大会员';
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${user.displayName || user.username} 的个人主页 - Coloryi</title>
        <link rel="icon" href="https://docs.coloryi.top/favicon.ico">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: sans-serif; background: #e6f0fa; padding: 20px; }
            .container { max-width: 1200px; margin: 0 auto; }
            .profile-header { background: white; border-radius: 8px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            .avatar { width: 80px; height: 80px; border-radius: 50%; background: #e6eef9; display: flex; align-items: center; justify-content: center; font-size: 40px; margin-right: 20px; overflow: hidden; }
            .avatar img { width: 100%; height: 100%; object-fit: cover; }
            .flex { display: flex; align-items: center; gap: 20px; }
            .role-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; margin-left: 6px; }
            .role-superadmin { background: #ffd700; color: #1e2a3a; }
            .role-admin { background: #1e88e5; color: white; }
            .role-user { background: #b0bec5; color: #1e2a3a; }
            .level-badge { background: #4caf50; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; margin-left: 6px; }
            .membership-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; margin-left: 6px; }
            .membership-super { background: #9c27b0; color: white; }
            .membership-regular { background: #2196f3; color: white; }
            .membership-none { background: #9e9e9e; color: white; }
            .exp-bar-container { width: 100%; height: 10px; background: #e0e0e0; border-radius: 5px; margin: 10px 0; }
            .exp-bar-fill { height: 100%; background: #4caf50; border-radius: 5px; width: ${percent}%; }
            .posts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
            .post-card { background: white; border-radius: 8px; padding: 20px; cursor: pointer; transition: box-shadow 0.2s; }
            .post-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            .post-id { font-size: 0.7rem; color: #5e7a93; margin-bottom: 5px; }
            .post-category { display: inline-block; background: #e1f5fe; color: #0288d1; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; margin-right: 8px; }
            .post-title { font-size: 1.2rem; margin-bottom: 10px; }
            .post-content { color: #2c3e50; margin-bottom: 16px; overflow: hidden; max-height: 100px; }
            .post-meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; color: #5e7a93; border-top: 1px solid #e0edf5; padding-top: 12px; }
            .back-btn { margin-bottom: 20px; display: inline-block; padding: 8px 16px; background: #1e88e5; color: white; text-decoration: none; border-radius: 6px; }
        </style>
    </head>
    <body>
        <div class="container">
            <a href="https://blog.coloryi.top" class="back-btn">← 返回首页</a>
            <div class="profile-header">
                <div class="flex">
                    <div class="avatar">
                        ${user.avatar ? `<img src="${user.avatar}" alt="avatar">` : (user.displayName ? user.displayName.charAt(0) : '?')}
                    </div>
                    <div>
                        <h2>${user.displayName || user.username} 
                            <span class="role-badge ${user.role === 'superadmin' ? 'role-superadmin' : (user.role === 'admin' ? 'role-admin' : 'role-user')}">
                                ${user.role === 'superadmin' ? '超级管理员' : (user.role === 'admin' ? '管理员' : '普通用户')}
                            </span>
                            <span class="level-badge">Lv${level}</span>
                            <span class="membership-badge ${user.role === 'superadmin' ? 'membership-super' : (user.membership === 'super' ? 'membership-super' : (user.membership === 'regular' ? 'membership-regular' : 'membership-none'))}">
                                ${membershipText}
                            </span>
                        </h2>
                        <p>用户名：${user.username}</p>
                        <p>注册时间：${new Date(user.createdAt).toLocaleDateString()}</p>
                        <div style="margin-top: 10px;">
                            <div class="level-info">
                                <span>经验 ${exp}</span>
                            </div>
                            <div class="exp-bar-container">
                                <div class="exp-bar-fill" style="width:${percent}%"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <h3>📝 ${user.displayName || user.username} 的文章</h3>
            <div class="posts-grid">
                ${postsHtml}
            </div>
        </div>
    </body>
    </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

// ========== 注册（增加会员字段和2FA字段） ==========
async function handleSignup(request, env) {
  try {
    const { username, email, password, confirmPassword, captcha } = await request.json();
    if (!username || !email || !password || !confirmPassword || !captcha) {
      return new Response(JSON.stringify({ error: '所有字段必填，包括验证码' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const valid = await verifyCaptcha(email, captcha, env);
    if (!valid) {
      return new Response(JSON.stringify({ error: '验证码错误或已过期' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    await deleteCaptcha(email, env);

    if (password !== confirmPassword) {
      return new Response(JSON.stringify({ error: '两次输入的密码不一致' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const pwdError = validatePassword(password);
    if (pwdError) {
      return new Response(JSON.stringify({ error: pwdError }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return new Response(JSON.stringify({ error: '用户名须为3-20位字母、数字或下划线' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const allowedDomains = ['outlook.com', 'qq.com', '163.com', 'gmail.com', 'live.cn'];
    const domain = email.split('@')[1];
    if (!domain || !allowedDomains.includes(domain)) {
      return new Response(JSON.stringify({ error: '邮箱后缀仅支持 outlook.com / qq.com / 163.com / gmail.com / live.cn' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const ip = getClientIP(request);
    const ipAllowed = await checkIPLimit(ip, env);
    if (!ipAllowed) {
      return new Response(JSON.stringify({ error: '同一IP一天内只能注册一个账号' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    const usernameLower = username.toLowerCase();

    const existingUsername = await env.USERS.get(`username:${usernameLower}`);
    if (existingUsername) {
      return new Response(JSON.stringify({ error: '用户名已存在' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }

    const existingEmail = await env.USERS.get(`user:${email}`);
    if (existingEmail) {
      return new Response(JSON.stringify({ error: '邮箱已存在' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }

    const passwordHash = await hashPassword(password);
    
    const userList = await env.USERS.list({ prefix: 'user:' });
    const isFirstUser = userList.keys.length === 0;
    const role = isFirstUser ? 'superadmin' : 'user';
    
    const user = { 
      username,
      usernameLower,
      displayName: username,
      email, 
      passwordHash, 
      createdAt: new Date().toISOString(),
      role,
      deleteRequested: false,
      deleteRequestedAt: null,
      readAnnouncements: [],
      avatar: null,
      bannedUntil: null,
      bannedReason: null,
      coins: 0,
      exp: 0,
      level: 1,
      lastDailyCoinTime: null,
      todayGivenCoins: 0,
      lastGivenResetDate: null,
      todayShared: 0,
      lastShareDate: null,
      membership: 'none',
      lastSignDate: null,
      // 2FA 相关字段
      twoFactorEnabled: false,
      trustedDevices: [] // 存储 { ip, expireAt }
    };
    
    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    await env.USERS.put(`username:${usernameLower}`, email);
    
    const token = generateToken();
    await env.USERS.put(`token:${token}`, email, { expirationTtl: 60 * 60 * 24 * 30 });

    return new Response(JSON.stringify({ token, role }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 发送验证码（注册用） ==========
async function handleSendCaptcha(request, env) {
  try {
    const { email } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: '邮箱不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: '邮箱格式不正确' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const limit = await checkCaptchaLimit(email, env);
    if (!limit.allowed) {
      return new Response(JSON.stringify({ error: '今天已经发送了3次验证码，请明天再试' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    const code = generateCaptcha();
    await storeCaptcha(email, code, env);

    const subject = '您的博客注册验证码';
    const html = getCaptchaEmailHtml(code);
    await sendEmail(email, subject, html, env);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('发送验证码失败详细错误:', e);
    return new Response(JSON.stringify({ error: '发送失败，请稍后重试' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 登录（支持2FA） ==========
async function handleLogin(request, env) {
  try {
    const { login, password } = await request.json();
    if (!login || !password) {
      return new Response(JSON.stringify({ error: '用户名/邮箱和密码必填' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    let email;
    if (login.includes('@')) {
      email = login;
    } else {
      const usernameLower = login.toLowerCase();
      email = await env.USERS.get(`username:${usernameLower}`);
    }

    if (!email) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const user = JSON.parse(userData);
    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) {
      return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (user.bannedUntil && new Date(user.bannedUntil) > new Date()) {
      return new Response(JSON.stringify({ error: `账号已被封禁至 ${new Date(user.bannedUntil).toLocaleString()}` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const ip = getClientIP(request);

    // 检查信任设备
    if (user.twoFactorEnabled) {
      const now = Date.now();
      const trusted = (user.trustedDevices || []).some(d => d.ip === ip && new Date(d.expireAt) > now);
      if (trusted) {
        // 信任设备直接登录
        const token = generateToken();
        await env.USERS.put(`token:${token}`, email, { expirationTtl: 60 * 60 * 24 * 30 });
        return new Response(JSON.stringify({ token, role: user.role }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else {
        // 需要2FA
        return new Response(JSON.stringify({ require2fa: true, email }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // 未开启2FA，直接登录
    const token = generateToken();
    await env.USERS.put(`token:${token}`, email, { expirationTtl: 60 * 60 * 24 * 30 });
    return new Response(JSON.stringify({ token, role: user.role }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 获取用户信息 ==========
async function handleUserInfo(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const user = await getUserInfo(email, env);
  
  if (user.role === 'superadmin') {
    user.level = 6;
    user.exp = 1500;
  }
  
  return new Response(JSON.stringify({ 
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email,
    createdAt: user.createdAt,
    role: user.role,
    deleteRequested: user.deleteRequested || false,
    deleteRequestedAt: user.deleteRequestedAt || null,
    readAnnouncements: user.readAnnouncements || [],
    avatar: user.avatar || null,
    bannedUntil: user.bannedUntil || null,
    bannedReason: user.bannedReason || null,
    coins: user.coins || 0,
    exp: user.exp || 0,
    level: user.level || 1,
    todayGivenCoins: user.todayGivenCoins || 0,
    lastGivenResetDate: user.lastGivenResetDate || null,
    lastDailyCoinTime: user.lastDailyCoinTime || null,
    todayShared: user.todayShared || 0,
    lastShareDate: user.lastShareDate || null,
    membership: user.membership || 'none',
    lastSignDate: user.lastSignDate || null,
    twoFactorEnabled: user.twoFactorEnabled || false
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ========== 上传头像 ==========
async function handleUploadAvatar(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { avatar } = await request.json();
    if (!avatar) {
      return new Response(JSON.stringify({ error: '头像数据不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const estimatedSize = Math.ceil(avatar.length * 0.75);
    if (estimatedSize > MAX_AVATAR_SIZE) {
      return new Response(JSON.stringify({ error: '头像大小不能超过500KB' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    user.avatar = avatar;
    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 修改显示名称 ==========
async function handleUpdateDisplayName(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { displayName } = await request.json();
    if (!displayName || displayName.length < 1 || displayName.length > 30) {
      return new Response(JSON.stringify({ error: '显示名称长度须为1-30个字符' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    user.displayName = displayName;
    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true, displayName }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 用户修改密码 ==========
async function handleChangePassword(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { oldPassword, newPassword, confirmPassword } = await request.json();
    if (!oldPassword || !newPassword || !confirmPassword) {
      return new Response(JSON.stringify({ error: '所有字段必填' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (newPassword !== confirmPassword) {
      return new Response(JSON.stringify({ error: '两次新密码不一致' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const pwdError = validatePassword(newPassword);
    if (pwdError) {
      return new Response(JSON.stringify({ error: pwdError }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    const oldHash = await hashPassword(oldPassword);
    if (oldHash !== user.passwordHash) {
      return new Response(JSON.stringify({ error: '旧密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    user.passwordHash = await hashPassword(newPassword);
    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 用户申请注销 ==========
async function handleUserRequestDelete(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { password } = await request.json();
    if (!password) {
      return new Response(JSON.stringify({ error: '密码不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) {
      return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    user.deleteRequested = true;
    user.deleteRequestedAt = new Date().toISOString();
    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 领取每日免费币 ==========
async function handleClaimDailyCoin(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    const today = new Date().toISOString().split('T')[0];
    const lastClaimDate = user.lastDailyCoinTime ? user.lastDailyCoinTime.split('T')[0] : null;
    if (lastClaimDate === today) {
      return new Response(JSON.stringify({ error: '今天已经领取过了' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    user.coins = (user.coins || 0) + 1;
    user.lastDailyCoinTime = new Date().toISOString();
    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true, coins: user.coins }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 赠送硬币 ==========
async function handleGiftCoin(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { postId, amount } = await request.json();
    if (!postId || ![1, 2].includes(amount)) {
      return new Response(JSON.stringify({ error: '参数错误，amount须为1或2' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const postData = await env.POSTS.get(`post:${postId}`, 'json');
    if (!postData) {
      return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (postData.author === email) {
      return new Response(JSON.stringify({ error: '不能给自己的文章赠送' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const giverData = await env.USERS.get(`user:${email}`);
    if (!giverData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const giver = JSON.parse(giverData);

    resetDailyGivenIfNeeded(giver);

    if (giver.coins < amount) {
      return new Response(JSON.stringify({ error: '硬币不足' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (giver.todayGivenCoins + amount > 5) {
      return new Response(JSON.stringify({ error: '今日赠送已达上限（5个币）' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    giver.coins -= amount;
    giver.todayGivenCoins += amount;

    if (giver.role !== 'superadmin') {
      const expGain = amount * 10;
      giver.exp = (giver.exp || 0) + expGain;
      giver.level = getLevelFromExp(giver.exp);
    } else {
      giver.exp = 1500;
      giver.level = 6;
    }

    await env.USERS.put(`user:${email}`, JSON.stringify(giver));

    const authorData = await env.USERS.get(`user:${postData.author}`);
    if (authorData) {
      const author = JSON.parse(authorData);
      author.coins = (author.coins || 0) + amount;
      await env.USERS.put(`user:${postData.author}`, JSON.stringify(author));
    }

    postData.receivedCoins = (postData.receivedCoins || 0) + amount;
    await env.POSTS.put(`post:${postId}`, JSON.stringify(postData));

    return new Response(JSON.stringify({ 
      success: true, 
      newCoins: giver.coins, 
      newExp: giver.exp, 
      newLevel: giver.level,
      receivedCoins: postData.receivedCoins 
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 分享文章 ==========
async function handleSharePost(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { postId } = await request.json();
    if (!postId) {
      return new Response(JSON.stringify({ error: '缺少文章ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const postData = await env.POSTS.get(`post:${postId}`, 'json');
    if (!postData) {
      return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);

    resetDailyShareIfNeeded(user);

    if (user.todayShared >= 1) {
      return new Response(JSON.stringify({ error: '今日已经分享过文章' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (user.role !== 'superadmin') {
      const expGain = 5;
      user.exp = (user.exp || 0) + expGain;
      user.level = getLevelFromExp(user.exp);
    } else {
      user.exp = 1500;
      user.level = 6;
    }
    user.todayShared = (user.todayShared || 0) + 1;
    user.lastShareDate = new Date().toISOString().split('T')[0];

    await env.USERS.put(`user:${email}`, JSON.stringify(user));

    return new Response(JSON.stringify({
      success: true,
      newExp: user.exp,
      newLevel: user.level
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 签到 ==========
async function handleSign(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);

    const today = new Date().toISOString().split('T')[0];
    if (user.lastSignDate === today) {
      return new Response(JSON.stringify({ error: '今天已经签到过了' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (user.role === 'superadmin') {
      user.lastSignDate = today;
      await env.USERS.put(`user:${email}`, JSON.stringify(user));
      return new Response(JSON.stringify({
        success: true,
        newExp: 1500,
        newLevel: 6,
        expGain: 0
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    let expGain = 5;
    if (user.membership === 'super') {
      expGain += 20;
    } else if (user.membership === 'regular') {
      expGain += 15;
    }

    user.exp = (user.exp || 0) + expGain;
    user.level = getLevelFromExp(user.exp);
    user.lastSignDate = today;

    await env.USERS.put(`user:${email}`, JSON.stringify(user));

    return new Response(JSON.stringify({
      success: true,
      newExp: user.exp,
      newLevel: user.level,
      expGain
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 购买会员 ==========
async function handleBuyMembership(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { membershipType } = await request.json();
    if (!membershipType || !['regular', 'super'].includes(membershipType)) {
      return new Response(JSON.stringify({ error: '会员类型无效' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);

    const cost = membershipType === 'regular' ? 100 : 200;
    if (user.coins < cost) {
      return new Response(JSON.stringify({ error: `硬币不足，需要 ${cost} 硬币` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    user.coins -= cost;
    user.membership = membershipType;

    await env.USERS.put(`user:${email}`, JSON.stringify(user));

    return new Response(JSON.stringify({ 
      success: true, 
      newCoins: user.coins,
      membership: user.membership
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 管理员设置会员 ==========
async function handleAdminSetMembership(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!(await isSuperAdmin(email, env))) {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { targetEmail, membershipType } = await request.json();
    if (!targetEmail || !membershipType || !['none', 'regular', 'super'].includes(membershipType)) {
      return new Response(JSON.stringify({ error: '参数错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${targetEmail}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    user.membership = membershipType;
    await env.USERS.put(`user:${targetEmail}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 管理员修改硬币余额 ==========
async function handleAdminSetCoins(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!(await isSuperAdmin(email, env))) {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { targetEmail, newCoins } = await request.json();
    if (!targetEmail || newCoins === undefined || newCoins < 0) {
      return new Response(JSON.stringify({ error: '缺少目标邮箱或币数无效' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${targetEmail}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    user.coins = newCoins;
    await env.USERS.put(`user:${targetEmail}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true, newCoins }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 2FA：开启 ==========
async function handleEnable2FA(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { password } = await request.json();
    if (!password) {
      return new Response(JSON.stringify({ error: '密码不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) {
      return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    user.twoFactorEnabled = true;
    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 2FA：关闭 ==========
async function handleDisable2FA(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法操作' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { password } = await request.json();
    if (!password) {
      return new Response(JSON.stringify({ error: '密码不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) {
      return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    user.twoFactorEnabled = false;
    // 关闭时清空信任设备
    user.trustedDevices = [];
    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 2FA：发送验证码 ==========
async function handleSend2FACode(request, env) {
  try {
    const { email } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: '邮箱不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: '邮箱格式不正确' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const limit = await checkCaptchaLimit(email, env, '2fa');
    if (!limit.allowed) {
      return new Response(JSON.stringify({ error: '今天已经发送了3次验证码，请明天再试' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    const code = generateCaptcha();
    await storeCaptcha(email, code, env, '2fa', 5 * 60); // 5分钟有效期

    const subject = '您的两步验证码';
    const html = get2FAEmailHtml(code);
    await sendEmail(email, subject, html, env);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('发送2FA验证码失败详细错误:', e);
    return new Response(JSON.stringify({ error: '发送失败，请稍后重试' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 2FA：验证并登录 ==========
async function handleVerify2FA(request, env) {
  try {
    const { email, code, trustDevice } = await request.json();
    if (!email || !code) {
      return new Response(JSON.stringify({ error: '邮箱和验证码必填' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const valid = await verifyCaptcha(email, code, env, '2fa');
    if (!valid) {
      return new Response(JSON.stringify({ error: '验证码错误或已过期' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    await deleteCaptcha(email, env, '2fa');

    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);

    if (trustDevice) {
      const ip = getClientIP(request);
      const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30天后
      if (!user.trustedDevices) user.trustedDevices = [];
      // 移除旧记录
      user.trustedDevices = user.trustedDevices.filter(d => d.ip !== ip);
      user.trustedDevices.push({ ip, expireAt });
      await env.USERS.put(`user:${email}`, JSON.stringify(user));
    }

    const token = generateToken();
    await env.USERS.put(`token:${token}`, email, { expirationTtl: 60 * 60 * 24 * 30 });

    return new Response(JSON.stringify({ token, role: user.role }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 创建文章 ==========
async function handleCreatePost(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法发布文章' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const user = await getUserInfo(email, env);
  if (user.deleteRequested) {
    return new Response(JSON.stringify({ error: '您的账号正在注销审核中，无法发布新文章' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { title, content, format, category } = await request.json();
    if (!title || !content || !format || !category) {
      return new Response(JSON.stringify({ error: '标题、内容、格式和分区必填' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!CATEGORIES.includes(category)) {
      return new Response(JSON.stringify({ error: '无效的分区' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const id = crypto.randomUUID();
    const post = {
      id,
      title,
      content,
      format,
      category,
      author: email,
      createdAt: new Date().toISOString(),
      pinned: false,
      pinnedAt: null,
      receivedCoins: 0
    };
    await env.POSTS.put(`post:${id}`, JSON.stringify(post));
    const enrichedPost = { ...post, authorDisplayName: user.displayName || user.username, authorRole: user.role };
    return new Response(JSON.stringify({ post: enrichedPost }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 获取所有文章 ==========
async function handleGetAllPosts(request, env) {
  const allPosts = [];
  const postsList = await env.POSTS.list({ prefix: 'post:' });
  for (const key of postsList.keys) {
    const postData = await env.POSTS.get(key.name, 'json');
    if (postData) allPosts.push(postData);
  }
  allPosts.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) {
      return new Date(b.pinnedAt) - new Date(a.pinnedAt);
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const authorEmails = [...new Set(allPosts.map(p => p.author))];
  const authorInfo = {};
  await Promise.all(authorEmails.map(async email => {
    const user = await getUserInfo(email, env);
    authorInfo[email] = user ? { 
      displayName: user.displayName || user.username, 
      role: user.role, 
      avatar: user.avatar, 
      username: user.username,
      membership: user.membership || 'none'
    } : { displayName: email, role: 'user', avatar: null, username: null, membership: 'none' };
  }));
  const enrichedPosts = allPosts.map(post => ({
    ...post,
    authorDisplayName: authorInfo[post.author]?.displayName || post.author,
    authorRole: authorInfo[post.author]?.role || 'user',
    authorAvatar: authorInfo[post.author]?.avatar || null,
    authorUsername: authorInfo[post.author]?.username || null,
    authorMembership: authorInfo[post.author]?.membership || 'none',
    receivedCoins: post.receivedCoins || 0
  }));
  return new Response(JSON.stringify({ posts: enrichedPosts }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ========== 获取当前用户的文章 ==========
async function handleGetUserPosts(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const userPosts = [];
  const postsList = await env.POSTS.list({ prefix: 'post:' });
  for (const key of postsList.keys) {
    const postData = await env.POSTS.get(key.name, 'json');
    if (postData && postData.author === email) userPosts.push(postData);
  }
  userPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const user = await getUserInfo(email, env);
  const ownDisplayName = user ? (user.displayName || user.username) : email;
  const ownRole = user ? user.role : 'user';
  const ownAvatar = user ? user.avatar : null;
  const enrichedPosts = userPosts.map(post => ({ 
    ...post, 
    authorDisplayName: ownDisplayName, 
    authorRole: ownRole, 
    authorAvatar: ownAvatar,
    authorUsername: user ? user.username : null,
    authorMembership: user ? (user.membership || 'none') : 'none',
    receivedCoins: post.receivedCoins || 0
  }));
  return new Response(JSON.stringify({ posts: enrichedPosts }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ========== 删除文章 ==========
async function handleDeletePost(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { postId } = await request.json();
    if (!postId) {
      return new Response(JSON.stringify({ error: '缺少文章ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const postData = await env.POSTS.get(`post:${postId}`, 'json');
    if (!postData) {
      return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const requesterRole = await getUserRole(email, env);
    const isAdminOrSuper = requesterRole === 'admin' || requesterRole === 'superadmin';
    if (requesterRole === 'admin') {
      const authorRole = await getUserRole(postData.author, env);
      if (authorRole === 'superadmin') {
        return new Response(JSON.stringify({ error: '管理员不能删除超级管理员的文章' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (postData.author !== email && !isAdminOrSuper) {
      return new Response(JSON.stringify({ error: '没有权限删除' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    await env.POSTS.delete(`post:${postId}`);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 置顶/取消置顶文章 ==========
async function handlePinPost(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'admin' && requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { postId, pin } = await request.json();
    if (!postId) {
      return new Response(JSON.stringify({ error: '缺少文章ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const postData = await env.POSTS.get(`post:${postId}`, 'json');
    if (!postData) {
      return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (requesterRole === 'admin') {
      const authorRole = await getUserRole(postData.author, env);
      if (authorRole === 'superadmin') {
        return new Response(JSON.stringify({ error: '管理员不能置顶超级管理员的文章' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    }
    postData.pinned = pin;
    postData.pinnedAt = pin ? new Date().toISOString() : null;
    await env.POSTS.put(`post:${postId}`, JSON.stringify(postData));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 管理员修改文章分区 ==========
async function handleUpdatePostCategory(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'admin' && requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { postId, category } = await request.json();
    if (!postId || !category) {
      return new Response(JSON.stringify({ error: '缺少文章ID或分区' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!CATEGORIES.includes(category)) {
      return new Response(JSON.stringify({ error: '无效的分区' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const postData = await env.POSTS.get(`post:${postId}`, 'json');
    if (!postData) {
      return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (requesterRole === 'admin') {
      const authorRole = await getUserRole(postData.author, env);
      if (authorRole === 'superadmin') {
        return new Response(JSON.stringify({ error: '管理员不能修改超级管理员的文章分区' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    }
    postData.category = category;
    await env.POSTS.put(`post:${postId}`, JSON.stringify(postData));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 评论相关 ==========
async function handleGetComments(request, env) {
  const url = new URL(request.url);
  const postId = url.searchParams.get('postId');
  if (!postId) {
    return new Response(JSON.stringify({ error: '缺少文章ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const commentList = await env.POSTS.list({ prefix: `comment:${postId}:` });
  const comments = [];
  for (const key of commentList.keys) {
    const commentData = await env.POSTS.get(key.name, 'json');
    if (commentData) comments.push(commentData);
  }
  comments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const authorEmails = [...new Set(comments.map(c => c.author))];
  const authorInfo = {};
  await Promise.all(authorEmails.map(async email => {
    const user = await getUserInfo(email, env);
    authorInfo[email] = user ? { displayName: user.displayName || user.username, avatar: user.avatar, username: user.username, membership: user.membership || 'none' } : { displayName: email, avatar: null, username: null, membership: 'none' };
  }));
  const enrichedComments = comments.map(c => ({
    ...c,
    authorDisplayName: authorInfo[c.author]?.displayName || c.author,
    authorAvatar: authorInfo[c.author]?.avatar || null,
    authorUsername: authorInfo[c.author]?.username || null,
    authorMembership: authorInfo[c.author]?.membership || 'none'
  }));
  return new Response(JSON.stringify({ comments: enrichedComments }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function handleCreateComment(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法评论' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { postId, content } = await request.json();
    if (!postId || !content || content.trim().length === 0) {
      return new Response(JSON.stringify({ error: '文章ID和评论内容不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const postData = await env.POSTS.get(`post:${postId}`, 'json');
    if (!postData) {
      return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = await getUserInfo(email, env);
    const id = crypto.randomUUID();
    const comment = {
      id,
      postId,
      author: email,
      content: content.trim(),
      createdAt: new Date().toISOString()
    };
    const key = `comment:${postId}:${Date.now()}:${id}`;
    await env.POSTS.put(key, JSON.stringify(comment));
    const enrichedComment = {
      ...comment,
      authorDisplayName: user.displayName || user.username,
      authorAvatar: user.avatar || null,
      authorUsername: user.username,
      authorMembership: user.membership || 'none'
    };
    return new Response(JSON.stringify({ comment: enrichedComment }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 反馈 ==========
async function handleSubmitFeedback(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (await isUserBanned(email, env)) {
    return new Response(JSON.stringify({ error: '账号已被封禁，无法提交反馈' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { content } = await request.json();
    if (!content || content.trim().length === 0) {
      return new Response(JSON.stringify({ error: '反馈内容不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const user = await getUserInfo(email, env);
    const id = crypto.randomUUID();
    const feedback = {
      id,
      author: email,
      authorDisplayName: user.displayName || user.username,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      read: false,
      status: 'pending',
      adminReply: null
    };
    const key = `feedback:${Date.now()}:${id}`;
    await env.POSTS.put(key, JSON.stringify(feedback));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// 用户查看自己的反馈
async function handleGetUserFeedbacks(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const feedbackList = await env.POSTS.list({ prefix: 'feedback:' });
  const feedbacks = [];
  for (const key of feedbackList.keys) {
    const data = await env.POSTS.get(key.name, 'json');
    if (data && data.author === email) feedbacks.push(data);
  }
  feedbacks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return new Response(JSON.stringify({ feedbacks }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// 管理员获取所有反馈（仅超级管理员）
async function handleGetAllFeedback(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!(await isSuperAdmin(email, env))) {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const feedbackList = await env.POSTS.list({ prefix: 'feedback:' });
  const feedbacks = [];
  for (const key of feedbackList.keys) {
    const data = await env.POSTS.get(key.name, 'json');
    if (data) feedbacks.push(data);
  }
  feedbacks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return new Response(JSON.stringify({ feedbacks }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// 管理员标记反馈已读（仅超级管理员）
async function handleMarkFeedbackRead(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!(await isSuperAdmin(email, env))) {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { feedbackId } = await request.json();
    if (!feedbackId) {
      return new Response(JSON.stringify({ error: '缺少反馈ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const feedbackList = await env.POSTS.list({ prefix: 'feedback:' });
    let targetKey = null;
    for (const key of feedbackList.keys) {
      const data = await env.POSTS.get(key.name, 'json');
      if (data && data.id === feedbackId) {
        targetKey = key.name;
        break;
      }
    }
    if (!targetKey) {
      return new Response(JSON.stringify({ error: '反馈不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const feedback = await env.POSTS.get(targetKey, 'json');
    feedback.read = true;
    await env.POSTS.put(targetKey, JSON.stringify(feedback));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// 管理员更新反馈状态和回复（仅超级管理员）
async function handleUpdateFeedback(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!(await isSuperAdmin(email, env))) {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { feedbackId, status, adminReply } = await request.json();
    if (!feedbackId) {
      return new Response(JSON.stringify({ error: '缺少反馈ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const feedbackList = await env.POSTS.list({ prefix: 'feedback:' });
    let targetKey = null;
    for (const key of feedbackList.keys) {
      const data = await env.POSTS.get(key.name, 'json');
      if (data && data.id === feedbackId) {
        targetKey = key.name;
        break;
      }
    }
    if (!targetKey) {
      return new Response(JSON.stringify({ error: '反馈不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const feedback = await env.POSTS.get(targetKey, 'json');
    if (status) feedback.status = status;
    if (adminReply !== undefined) feedback.adminReply = adminReply;
    await env.POSTS.put(targetKey, JSON.stringify(feedback));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// 管理员删除反馈（仅超级管理员）
async function handleDeleteFeedback(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!(await isSuperAdmin(email, env))) {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { feedbackId } = await request.json();
    if (!feedbackId) {
      return new Response(JSON.stringify({ error: '缺少反馈ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const feedbackList = await env.POSTS.list({ prefix: 'feedback:' });
    let targetKey = null;
    for (const key of feedbackList.keys) {
      const data = await env.POSTS.get(key.name, 'json');
      if (data && data.id === feedbackId) {
        targetKey = key.name;
        break;
      }
    }
    if (!targetKey) {
      return new Response(JSON.stringify({ error: '反馈不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    await env.POSTS.delete(targetKey);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 举报 ==========
async function handleSubmitReport(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { postId, reason } = await request.json();
    if (!postId || !reason || reason.trim().length === 0) {
      return new Response(JSON.stringify({ error: '文章ID和举报原因不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const postData = await env.POSTS.get(`post:${postId}`, 'json');
    if (!postData) {
      return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = await getUserInfo(email, env);
    const id = crypto.randomUUID();
    const report = {
      id,
      postId,
      reporter: email,
      reporterDisplayName: user.displayName || user.username,
      reason: reason.trim(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      processedBy: null,
      processedAt: null,
      banDuration: null,
      adminNote: null
    };
    const key = `report:${postId}:${Date.now()}:${id}`;
    await env.POSTS.put(key, JSON.stringify(report));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// 管理员获取所有举报（仅超级管理员）
async function handleGetAllReports(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!(await isSuperAdmin(email, env))) {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const reportList = await env.POSTS.list({ prefix: 'report:' });
  const reports = [];
  for (const key of reportList.keys) {
    const data = await env.POSTS.get(key.name, 'json');
    if (data) reports.push(data);
  }
  reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return new Response(JSON.stringify({ reports }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// 管理员处理举报（仅超级管理员）
async function handleProcessReport(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!(await isSuperAdmin(email, env))) {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { reportId, action, banDays, adminNote } = await request.json();
    if (!reportId) {
      return new Response(JSON.stringify({ error: '缺少举报ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const reportList = await env.POSTS.list({ prefix: 'report:' });
    let targetKey = null;
    for (const key of reportList.keys) {
      const data = await env.POSTS.get(key.name, 'json');
      if (data && data.id === reportId) {
        targetKey = key.name;
        break;
      }
    }
    if (!targetKey) {
      return new Response(JSON.stringify({ error: '举报不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const report = await env.POSTS.get(targetKey, 'json');
    const postData = await env.POSTS.get(`post:${report.postId}`, 'json');
    if (!postData) {
      return new Response(JSON.stringify({ error: '被举报的文章已不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const targetUserEmail = postData.author;
    if (action === 'ban') {
      if (!banDays || banDays <= 0) {
        return new Response(JSON.stringify({ error: '请指定封禁天数' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      const bannedUntil = new Date();
      bannedUntil.setDate(bannedUntil.getDate() + banDays);
      const userData = await env.USERS.get(`user:${targetUserEmail}`);
      if (userData) {
        const user = JSON.parse(userData);
        user.bannedUntil = bannedUntil.toISOString();
        user.bannedReason = adminNote || '违反社区规定';
        await env.USERS.put(`user:${targetUserEmail}`, JSON.stringify(user));
      }
      report.status = 'resolved';
      report.banDuration = banDays;
    } else if (action === 'resolve') {
      report.status = 'resolved';
    } else if (action === 'reject') {
      report.status = 'rejected';
    } else {
      return new Response(JSON.stringify({ error: '无效的操作' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    report.processedBy = email;
    report.processedAt = new Date().toISOString();
    report.adminNote = adminNote || null;
    await env.POSTS.put(targetKey, JSON.stringify(report));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 管理员直接封禁用户 ==========
async function handleBanUser(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { targetEmail, banDays, reason } = await request.json();
    if (!targetEmail || !banDays || banDays <= 0) {
      return new Response(JSON.stringify({ error: '缺少目标用户或封禁天数' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${targetEmail}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    const bannedUntil = new Date();
    bannedUntil.setDate(bannedUntil.getDate() + banDays);
    user.bannedUntil = bannedUntil.toISOString();
    user.bannedReason = reason || '管理员封禁';
    await env.USERS.put(`user:${targetEmail}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 管理员获取所有用户 ==========
async function handleAdminGetUsers(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'admin' && requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const userList = await env.USERS.list({ prefix: 'user:' });
  const users = [];
  for (const key of userList.keys) {
    const userData = await env.USERS.get(key.name, 'json');
    if (userData) {
      const { passwordHash, ...safeUser } = userData;
      users.push(safeUser);
    }
  }
  return new Response(JSON.stringify({ users, requesterRole, currentUserEmail: email }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ========== 管理员删除用户 ==========
async function handleAdminDeleteUser(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'admin' && requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { targetEmail } = await request.json();
    if (!targetEmail) {
      return new Response(JSON.stringify({ error: '缺少目标用户邮箱' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (requesterRole === 'admin') {
      const targetRole = await getUserRole(targetEmail, env);
      if (targetRole === 'superadmin' || targetRole === 'admin') {
        return new Response(JSON.stringify({ error: '管理员不能删除其他管理员或超级管理员' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (targetEmail === email) {
      return new Response(JSON.stringify({ error: '不能删除自己' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const postsList = await env.POSTS.list({ prefix: 'post:' });
    for (const key of postsList.keys) {
      const postData = await env.POSTS.get(key.name, 'json');
      if (postData && postData.author === targetEmail) await env.POSTS.delete(key.name);
    }
    const user = await getUserInfo(targetEmail, env);
    if (user) {
      await env.USERS.delete(`username:${user.usernameLower}`);
      await env.USERS.delete(`user:${targetEmail}`);
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 管理员修改密码 ==========
async function handleAdminResetPassword(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'admin' && requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { targetEmail, newPassword } = await request.json();
    if (!targetEmail || !newPassword) {
      return new Response(JSON.stringify({ error: '缺少目标用户或新密码' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const pwdError = validatePassword(newPassword);
    if (pwdError) {
      return new Response(JSON.stringify({ error: pwdError }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (requesterRole === 'admin') {
      const targetRole = await getUserRole(targetEmail, env);
      if (targetRole === 'superadmin' || targetRole === 'admin') {
        return new Response(JSON.stringify({ error: '管理员不能修改其他管理员或超级管理员的密码' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    }
    const userData = await env.USERS.get(`user:${targetEmail}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    user.passwordHash = await hashPassword(newPassword);
    await env.USERS.put(`user:${targetEmail}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 超级管理员设置角色 ==========
async function handleAdminSetRole(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { targetEmail, newRole } = await request.json();
    if (!targetEmail || !newRole) {
      return new Response(JSON.stringify({ error: '缺少目标用户或新角色' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (newRole !== 'admin' && newRole !== 'user') {
      return new Response(JSON.stringify({ error: '角色只能为 admin 或 user' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (targetEmail === email) {
      return new Response(JSON.stringify({ error: '不能修改自己的角色' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${targetEmail}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    user.role = newRole;
    if (newRole === 'superadmin') {
      user.level = 6;
      user.exp = 1500;
    }
    await env.USERS.put(`user:${targetEmail}`, JSON.stringify(user));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 管理员审核注销 ==========
async function handleAdminApproveDelete(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'admin' && requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { targetEmail, approve } = await request.json();
    if (!targetEmail) {
      return new Response(JSON.stringify({ error: '缺少目标用户邮箱' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${targetEmail}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    if (!user.deleteRequested) {
      return new Response(JSON.stringify({ error: '该用户未申请注销' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (requesterRole === 'admin') {
      const targetRole = user.role;
      if (targetRole === 'superadmin' || targetRole === 'admin') {
        return new Response(JSON.stringify({ error: '管理员不能审核其他管理员或超级管理员的注销' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (approve) {
      const postsList = await env.POSTS.list({ prefix: 'post:' });
      for (const key of postsList.keys) {
        const postData = await env.POSTS.get(key.name, 'json');
        if (postData && postData.author === targetEmail) await env.POSTS.delete(key.name);
      }
      await env.USERS.delete(`username:${user.usernameLower}`);
      await env.USERS.delete(`user:${targetEmail}`);
    } else {
      user.deleteRequested = false;
      user.deleteRequestedAt = null;
      await env.USERS.put(`user:${targetEmail}`, JSON.stringify(user));
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 公告：获取 ==========
async function handleGetAnnouncement(request, env) {
  const announcementData = await env.POSTS.get('announcement:current', 'json');
  if (!announcementData) return new Response(JSON.stringify({ exists: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ exists: true, ...announcementData }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ========== 公告：超级管理员设置 ==========
async function handleSetAnnouncement(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const requesterRole = await getUserRole(email, env);
  if (requesterRole !== 'superadmin') {
    return new Response(JSON.stringify({ error: '需要超级管理员权限' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { title, content, type } = await request.json();
    if (!title || !content || !type || (type !== 'mandatory' && type !== 'optional')) {
      return new Response(JSON.stringify({ error: '标题、内容和类型（mandatory/optional）必填' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const id = crypto.randomUUID();
    const announcement = { id, title, content, type, createdAt: new Date().toISOString(), createdBy: email };
    await env.POSTS.put('announcement:current', JSON.stringify(announcement));
    return new Response(JSON.stringify({ success: true, announcement }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 公告：用户标记已读 ==========
async function handleMarkAnnouncementRead(request, env) {
  const email = await getUserFromToken(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { announcementId } = await request.json();
    if (!announcementId) {
      return new Response(JSON.stringify({ error: '缺少公告ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userData = await env.USERS.get(`user:${email}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const user = JSON.parse(userData);
    if (!user.readAnnouncements) user.readAnnouncements = [];
    if (!user.readAnnouncements.includes(announcementId)) {
      user.readAnnouncements.push(announcementId);
      await env.USERS.put(`user:${email}`, JSON.stringify(user));
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== 前端页面（完整 HTML，包含2FA界面和动画） ==========
function getFrontendHTML() {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>Coloryi | 轻蓝博客</title>',
    '  <link rel="icon" href="https://docs.coloryi.top/favicon.ico">',
    '  <link href="https://cdn.quilljs.com/1.3.6/quill.snow.css" rel="stylesheet">',
    '  <link rel="stylesheet" href="https://unpkg.com/easymde/dist/easymde.min.css">',
    '  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>',
    '  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">',
    '  <style>',
    '    * { margin: 0; padding: 0; box-sizing: border-box; }',
    '    body {',
    '      font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;',
    '      background: #e6f0fa;',
    '      color: #1e2a3a;',
    '      line-height: 1.6;',
    '      padding: 20px;',
    '      min-height: 100vh;',
    '      display: flex;',
    '      flex-direction: column;',
    '    }',
    '    .container { max-width: 1200px; margin: 0 auto; width: 100%; flex: 1; }',
    '    .card, .navbar, .post-card, .modal-content {',
    '      background: white;',
    '      border-radius: 8px;',
    '      border: none;',
    '      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);',
    '    }',
    '    .navbar {',
    '      padding: 16px 24px;',
    '      margin-bottom: 24px;',
    '      display: flex;',
    '      justify-content: space-between;',
    '      align-items: center;',
    '      flex-wrap: wrap;',
    '      gap: 16px;',
    '    }',
    '    .nav-links { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }',
    '    .nav-item {',
    '      position: relative;',
    '      display: inline-block;',
    '    }',
    '    .unread-dot {',
    '      position: absolute;',
    '      top: -2px;',
    '      right: -2px;',
    '      width: 10px;',
    '      height: 10px;',
    '      background: #ff4444;',
    '      border-radius: 50%;',
    '      border: 2px solid white;',
    '    }',
    '    .btn {',
    '      padding: 8px 16px;',
    '      border: none;',
    '      border-radius: 6px;',
    '      font-size: 14px;',
    '      font-weight: 500;',
    '      cursor: pointer;',
    '      background: #e6eef9;',
    '      color: #1e2a3a;',
    '      transition: none;',
    '    }',
    '    .btn:hover { background: #d0def0; }',
    '    .btn-primary { background: #1e88e5; color: white; }',
    '    .btn-primary:hover { background: #1565c0; }',
    '    .btn-danger { background: #e53935; color: white; }',
    '    .btn-danger:hover { background: #c62828; }',
    '    .btn-success { background: #43a047; color: white; }',
    '    .btn-success:hover { background: #2e7d32; }',
    '    .btn-warning { background: #ff9800; color: white; }',
    '    .btn-warning:hover { background: #f57c00; }',
    '    .btn-info { background: #26c6da; color: white; }',
    '    .btn-info:hover { background: #00acc1; }',
    '    .hidden { display: none !important; }',
    '    input, textarea, select {',
    '      width: 100%;',
    '      padding: 10px 12px;',
    '      border: 1px solid #d0ddee;',
    '      border-radius: 6px;',
    '      font-size: 14px;',
    '      margin-bottom: 16px;',
    '      background: white;',
    '    }',
    '    .posts-grid {',
    '      display: grid;',
    '      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));',
    '      gap: 20px;',
    '      margin-top: 20px;',
    '    }',
    '    .post-card {',
    '      padding: 20px;',
    '      cursor: pointer;',
    '      transition: box-shadow 0.2s;',
    '      position: relative;',
    '    }',
    '    .post-card:hover {',
    '      box-shadow: 0 4px 12px rgba(0,0,0,0.1);',
    '    }',
    '    .post-pinned {',
    '      position: absolute;',
    '      top: 10px;',
    '      right: 10px;',
    '      background: #ffd700;',
    '      color: #1e2a3a;',
    '      padding: 2px 8px;',
    '      border-radius: 12px;',
    '      font-size: 0.7rem;',
    '      font-weight: bold;',
    '    }',
    '    .post-id {',
    '      font-size: 0.7rem;',
    '      color: #5e7a93;',
    '      margin-bottom: 5px;',
    '    }',
    '    .post-category {',
    '      display: inline-block;',
    '      background: #e1f5fe;',
    '      color: #0288d1;',
    '      padding: 2px 8px;',
    '      border-radius: 12px;',
    '      font-size: 0.7rem;',
    '      font-weight: bold;',
    '      margin-right: 8px;',
    '    }',
    '    .post-title { font-size: 1.2rem; margin-bottom: 10px; }',
    '    .post-content { ',
    '      color: #2c3e50;',
    '      margin-bottom: 16px;',
    '      overflow: hidden;',
    '      max-height: 100px;',
    '    }',
    '    .post-meta {',
    '      display: flex;',
    '      justify-content: space-between;',
    '      align-items: center;',
    '      font-size: 0.9rem;',
    '      color: #5e7a93;',
    '      border-top: 1px solid #e0edf5;',
    '      padding-top: 12px;',
    '    }',
    '    .post-author {',
    '      display: flex;',
    '      align-items: center;',
    '      gap: 6px;',
    '      cursor: pointer;',
    '    }',
    '    .post-author:hover .author-name {',
    '      text-decoration: underline;',
    '    }',
    '    .author-avatar {',
    '      width: 24px;',
    '      height: 24px;',
    '      border-radius: 50%;',
    '      background: #e6eef9;',
    '      display: flex;',
    '      align-items: center;',
    '      justify-content: center;',
    '      font-size: 14px;',
    '      overflow: hidden;',
    '    }',
    '    .author-avatar img {',
    '      width: 100%;',
    '      height: 100%;',
    '      object-fit: cover;',
    '    }',
    '    .role-badge {',
    '      display: inline-block;',
    '      padding: 2px 8px;',
    '      border-radius: 12px;',
    '      font-size: 0.7rem;',
    '      font-weight: bold;',
    '      margin-left: 6px;',
    '      line-height: 1.4;',
    '    }',
    '    .role-superadmin { background: #ffd700; color: #1e2a3a; }',
    '    .role-admin { background: #1e88e5; color: white; }',
    '    .role-user { background: #b0bec5; color: #1e2a3a; }',
    '    .membership-badge {',
    '      display: inline-block;',
    '      padding: 2px 8px;',
    '      border-radius: 12px;',
    '      font-size: 0.7rem;',
    '      font-weight: bold;',
    '      margin-left: 6px;',
    '      line-height: 1.4;',
    '    }',
    '    .membership-super { background: #9c27b0; color: white; }',
    '    .membership-regular { background: #2196f3; color: white; }',
    '    .membership-none { background: #9e9e9e; color: white; }',
    '    .level-badge {',
    '      display: inline-block;',
    '      background: #4caf50;',
    '      color: white;',
    '      padding: 2px 8px;',
    '      border-radius: 12px;',
    '      font-size: 0.7rem;',
    '      font-weight: bold;',
    '      margin-left: 6px;',
    '    }',
    '    .modal {',
    '      display: none;',
    '      position: fixed;',
    '      top: 0; left: 0; width: 100%; height: 100%;',
    '      background: rgba(0,0,0,0.3);',
    '      align-items: center;',
    '      justify-content: center;',
    '      z-index: 1000;',
    '    }',
    '    .modal.active { display: flex; }',
    '    .modal-content {',
    '      padding: 24px;',
    '      max-width: 800px;',
    '      width: 90%;',
    '      max-height: 80vh;',
    '      overflow-y: auto;',
    '      position: relative;',
    '      animation: fadeIn 0.3s ease;',
    '    }',
    '    .modal-close {',
    '      position: absolute;',
    '      top: 12px;',
    '      right: 16px;',
    '      font-size: 24px;',
    '      cursor: pointer;',
    '      color: #999;',
    '      background: none;',
    '      border: none;',
    '      padding: 4px;',
    '      line-height: 1;',
    '      z-index: 10;',
    '    }',
    '    .modal-close:hover { color: #333; }',
    '    .editor-switch {',
    '      display: flex;',
    '      gap: 15px;',
    '      margin-bottom: 20px;',
    '      align-items: center;',
    '      background: #f0f4f9;',
    '      padding: 8px 16px;',
    '      border-radius: 40px;',
    '      width: fit-content;',
    '    }',
    '    .editor-switch label {',
    '      display: flex;',
    '      align-items: center;',
    '      gap: 6px;',
    '      cursor: pointer;',
    '      padding: 6px 16px;',
    '      border-radius: 30px;',
    '      transition: all 0.2s;',
    '      font-weight: 500;',
    '    }',
    '    .editor-switch input[type="radio"] {',
    '      margin-right: 4px;',
    '      accent-color: #1e88e5;',
    '    }',
    '    .editor-switch label:has(input:checked) {',
    '      background: white;',
    '      box-shadow: 0 2px 6px rgba(0,0,0,0.1);',
    '    }',
    '    #quill-editor { height: 300px; margin-bottom: 16px; }',
    '    #markdown-editor { margin-bottom: 16px; }',
    '    .hidden-editor { display: none; }',
    '    .flex { display: flex; gap: 12px; align-items: center; }',
    '    .flex-between { display: flex; justify-content: space-between; align-items: center; }',
    '    .mt-4 { margin-top: 20px; }',
    '    .text-center { text-align: center; }',
    '    .badge {',
    '      background: #1e88e5;',
    '      color: white;',
    '      padding: 4px 8px;',
    '      border-radius: 4px;',
    '      font-size: 12px;',
    '    }',
    '    .badge-warning {',
    '      background: #ff9800;',
    '    }',
    '    .time-display {',
    '      font-size: 0.95rem;',
    '      color: #2c3e50;',
    '      background: #e6eef9;',
    '      padding: 6px 12px;',
    '      border-radius: 20px;',
    '    }',
    '    .user-list, .feedback-list, .reports-list {',
    '      margin-top: 20px;',
    '    }',
    '    .user-item, .feedback-item, .report-item {',
    '      display: flex;',
    '      justify-content: space-between;',
    '      align-items: center;',
    '      padding: 10px;',
    '      border-bottom: 1px solid #e0edf5;',
    '    }',
    '    .feedback-item.unread {',
    '      background: #f0f7ff;',
    '      font-weight: bold;',
    '    }',
    '    .feedback-content, .report-content {',
    '      max-width: 60%;',
    '      word-break: break-word;',
    '    }',
    '    .feedback-meta, .report-meta {',
    '      font-size: 0.8rem;',
    '      color: #5e7a93;',
    '    }',
    '    .status-badge {',
    '      padding: 2px 6px;',
    '      border-radius: 4px;',
    '      font-size: 0.7rem;',
    '      font-weight: bold;',
    '    }',
    '    .status-pending { background: #ff9800; color: white; }',
    '    .status-processing { background: #1e88e5; color: white; }',
    '    .status-resolved { background: #43a047; color: white; }',
    '    .status-rejected { background: #757575; color: white; }',
    '    .comments-section {',
    '      margin-top: 20px;',
    '      border-top: 1px solid #e0edf5;',
    '      padding-top: 20px;',
    '    }',
    '    .comment-item {',
    '      display: flex;',
    '      gap: 12px;',
    '      margin-bottom: 16px;',
    '      padding: 10px;',
    '      background: #f8fafd;',
    '      border-radius: 8px;',
    '    }',
    '    .comment-avatar {',
    '      width: 32px;',
    '      height: 32px;',
    '      border-radius: 50%;',
    '      background: #e6eef9;',
    '      display: flex;',
    '      align-items: center;',
    '      justify-content: center;',
    '      font-size: 16px;',
    '      cursor: pointer;',
    '      overflow: hidden;',
    '    }',
    '    .comment-avatar img {',
    '      width: 100%;',
    '      height: 100%;',
    '      object-fit: cover;',
    '    }',
    '    .comment-content {',
    '      flex: 1;',
    '    }',
    '    .comment-author {',
    '      font-weight: bold;',
    '      margin-right: 8px;',
    '      cursor: pointer;',
    '    }',
    '    .comment-author:hover {',
    '      text-decoration: underline;',
    '    }',
    '    .comment-time {',
    '      font-size: 0.8rem;',
    '      color: #5e7a93;',
    '    }',
    '    .comment-text {',
    '      margin-top: 4px;',
    '    }',
    '    .avatar-upload {',
    '      display: flex;',
    '      align-items: center;',
    '      gap: 20px;',
    '      margin: 20px 0;',
    '    }',
    '    .avatar-preview {',
    '      width: 80px;',
    '      height: 80px;',
    '      border-radius: 50%;',
    '      background: #e6eef9;',
    '      display: flex;',
    '      align-items: center;',
    '      justify-content: center;',
    '      font-size: 40px;',
    '      overflow: hidden;',
    '    }',
    '    .avatar-preview img {',
    '      width: 100%;',
    '      height: 100%;',
    '      object-fit: cover;',
    '    }',
    '    /* 公告横幅 */',
    '    .announcement-banner {',
    '      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);',
    '      color: white;',
    '      padding: 12px 24px;',
    '      border-radius: 8px;',
    '      margin-bottom: 20px;',
    '      display: flex;',
    '      align-items: center;',
    '      justify-content: space-between;',
    '      box-shadow: 0 4px 6px rgba(0,0,0,0.1);',
    '    }',
    '    .announcement-banner.mandatory {',
    '      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);',
    '    }',
    '    .announcement-banner .content {',
    '      flex: 1;',
    '    }',
    '    .announcement-banner .title {',
    '      font-weight: bold;',
    '      font-size: 1.1rem;',
    '      margin-bottom: 4px;',
    '    }',
    '    .announcement-banner .text {',
    '      opacity: 0.9;',
    '    }',
    '    .announcement-banner .close-btn {',
    '      background: rgba(255,255,255,0.2);',
    '      border: none;',
    '      color: white;',
    '      width: 30px;',
    '      height: 30px;',
    '      border-radius: 50%;',
    '      cursor: pointer;',
    '      display: flex;',
    '      align-items: center;',
    '      justify-content: center;',
    '      font-size: 18px;',
    '      transition: background 0.2s;',
    '    }',
    '    .announcement-banner .close-btn:hover {',
    '      background: rgba(255,255,255,0.3);',
    '    }',
    '    .exp-bar-container {',
    '      width: 100%;',
    '      height: 10px;',
    '      background: #e0e0e0;',
    '      border-radius: 5px;',
    '      margin: 5px 0;',
    '    }',
    '    .exp-bar-fill {',
    '      height: 100%;',
    '      background: #4caf50;',
    '      border-radius: 5px;',
    '      width: 0%;',
    '    }',
    '    .level-info {',
    '      display: flex;',
    '      justify-content: space-between;',
    '      align-items: center;',
    '      margin-bottom: 5px;',
    '    }',
    '    .coin-display {',
    '      display: inline-block;',
    '      background: #ffd700;',
    '      color: #1e2a3a;',
    '      padding: 4px 10px;',
    '      border-radius: 20px;',
    '      font-weight: bold;',
    '      margin-left: 10px;',
    '    }',
    '    /* 原版页脚样式 */',
    '    .footer {',
    '      text-align: center;',
    '      padding: 20px 0;',
    '      margin-top: 40px;',
    '      color: #5e7a93;',
    '      font-size: 0.9rem;',
    '      border-top: 1px solid #d0ddee;',
    '    }',
    '    .footer a {',
    '      color: #1e88e5;',
    '      text-decoration: none;',
    '    }',
    '    .footer a:hover {',
    '      text-decoration: underline;',
    '    }',
    '    /* 会员商店样式 */',
    '    .shop-card {',
    '      border: 1px solid #e0e0e0;',
    '      border-radius: 8px;',
    '      padding: 16px;',
    '      margin: 10px 0;',
    '      display: flex;',
    '      justify-content: space-between;',
    '      align-items: center;',
    '    }',
    '    .shop-card.super { background: #f3e5f5; }',
    '    .shop-card.regular { background: #e3f2fd; }',
    '    /* 自定义复选框样式（更大更美观） */',
    '    .checkbox-custom {',
    '      display: inline-flex;',
    '      align-items: center;',
    '      cursor: pointer;',
    '      user-select: none;',
    '      margin: 5px 0;',
    '    }',
    '    .checkbox-custom input[type="checkbox"] {',
    '      position: absolute;',
    '      opacity: 0;',
    '      cursor: pointer;',
    '      height: 0;',
    '      width: 0;',
    '    }',
    '    .checkbox-custom .checkmark {',
    '      display: inline-block;',
    '      width: 24px;',
    '      height: 24px;',
    '      background: #fff;',
    '      border: 2px solid #1e88e5;',
    '      border-radius: 6px;',
    '      margin-right: 10px;',
    '      transition: background 0.2s, border-color 0.2s;',
    '      box-shadow: 0 2px 4px rgba(0,0,0,0.1);',
    '      position: relative;',
    '    }',
    '    .checkbox-custom input:checked ~ .checkmark {',
    '      background: #1e88e5;',
    '      border-color: #1e88e5;',
    '    }',
    '    .checkbox-custom input:checked ~ .checkmark::after {',
    '      content: "";',
    '      position: absolute;',
    '      left: 8px;',
    '      top: 3px;',
    '      width: 6px;',
    '      height: 12px;',
    '      border: solid white;',
    '      border-width: 0 3px 3px 0;',
    '      transform: rotate(45deg);',
    '    }',
    '    .checkbox-custom:hover .checkmark {',
    '      border-color: #1565c0;',
    '    }',
    '    /* 容器切换动画 */',
    '    .page {',
    '      transition: opacity 0.3s ease, transform 0.3s ease;',
    '    }',
    '    .page.fade-out {',
    '      opacity: 0;',
    '      transform: scale(0.98);',
    '    }',
    '    .page.fade-in {',
    '      opacity: 1;',
    '      transform: scale(1);',
    '    }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="container">',
    '    <!-- 公告横幅 -->',
    '    <div id="announcement-banner" class="announcement-banner hidden">',
    '      <div class="content">',
    '        <div class="title" id="announcement-title"></div>',
    '        <div class="text" id="announcement-text"></div>',
    '      </div>',
    '      <button class="close-btn" onclick="closeAnnouncement()" id="announcement-close-btn">✕</button>',
    '    </div>',
    '',
    '    <div class="navbar">',
    '      <div class="flex">',
    '        <h2>Coloryi | 轻蓝博客</h2>',
    '        <span id="role-badge-nav" style="display: none;"></span>',
    '        <span id="level-badge-nav" class="level-badge" style="display: none;">Lv1</span>',
    '        <span id="coin-badge-nav" class="coin-display" style="display: none;">🪙 0</span>',
    '      </div>',
    '      <div class="flex">',
    '        <div class="time-display" id="current-time"></div>',
    '        <div class="nav-links">',
    '          <button class="btn" onclick="showHome()">🏠 首页</button>',
    '          <button class="btn hidden" id="profile-btn" onclick="showProfile()">👤 个人中心</button>',
    '          <button class="btn btn-primary hidden" id="new-post-btn" onclick="showNewPost()">✍️ 写文章</button>',
    '          <div class="nav-item" id="admin-btn-container">',
    '            <button class="btn hidden" id="admin-btn" onclick="showAdminPanel()">👑 管理</button>',
    '            <span class="unread-dot hidden" id="admin-unread-dot"></span>',
    '          </div>',
    '          <button class="btn hidden" id="login-btn" onclick="showLogin()">登录</button>',
    '          <button class="btn hidden" id="signup-btn" onclick="showSignup()">注册</button>',
    '          <button class="btn hidden" id="logout-btn" onclick="logout()">登出</button>',
    '          <button class="btn hidden" id="feedback-btn" onclick="showFeedbackModal()">💬 反馈</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 首页 -->',
    '    <div id="home-page" class="page">',
    '      <div class="flex-between">',
    '        <h3>📰 最新文章</h3>',
    '        <div class="category-filters">',
    '          <button class="btn category-btn active" onclick="filterByCategory(\'全部\')">全部</button>',
    '          <button class="btn category-btn" onclick="filterByCategory(\'小说\')">小说</button>',
    '          <button class="btn category-btn" onclick="filterByCategory(\'软件\')">软件</button>',
    '          <button class="btn category-btn" onclick="filterByCategory(\'破解\')">破解</button>',
    '          <button class="btn category-btn" onclick="filterByCategory(\'逆向\')">逆向</button>',
    '          <button class="btn category-btn" onclick="filterByCategory(\'新人报道\')">新人报道</button>',
    '          <button class="btn category-btn" onclick="filterByCategory(\'其他\')">其他</button>',
    '        </div>',
    '      </div>',
    '      <div id="posts-container" class="posts-grid"></div>',
    '    </div>',
    '',
    '    <!-- 个人中心（含会员商店、签到和2FA开关） -->',
    '    <div id="profile-page" class="page hidden">',
    '      <div class="card" style="padding: 20px;">',
    '        <div class="flex-between">',
    '          <h3>👤 个人资料</h3>',
    '          <span id="profile-role-badge"></span>',
    '        </div>',
    '        <div class="avatar-upload">',
    '          <div class="avatar-preview" id="avatar-preview">',
    '            <span id="avatar-emoji">😊</span>',
    '          </div>',
    '          <div>',
    '            <button class="btn btn-primary" onclick="uploadAvatar()">上传头像</button>',
    '            <input type="file" id="avatar-input" accept="image/*" style="display: none;" onchange="handleAvatarFile()">',
    '            <p class="text-muted" style="font-size:0.8rem; margin-top:5px;">支持 JPG/PNG，不超过500KB</p>',
    '          </div>',
    '        </div>',
    '',
    '        <!-- 等级与经验条 -->',
    '        <div style="margin: 20px 0; padding: 10px; background: #f5f9ff; border-radius: 8px;">',
    '          <div class="level-info">',
    '            <span>等级 <span id="profile-level">1</span> / 6</span>',
    '            <span>经验 <span id="profile-exp">0</span></span>',
    '          </div>',
    '          <div class="exp-bar-container">',
    '            <div class="exp-bar-fill" id="profile-exp-bar" style="width:0%"></div>',
    '          </div>',
    '          <div class="flex-between" style="margin-top:10px;">',
    '            <span>🪙 硬币: <span id="profile-coins">0</span></span>',
    '            <button class="btn btn-success" id="claim-daily-btn" onclick="claimDailyCoin()">领取每日币</button>',
    '          </div>',
    '        </div>',
    '',
    '        <!-- 会员信息与签到 -->',
    '        <div style="margin: 20px 0; padding: 10px; background: #fff3e0; border-radius: 8px;">',
    '          <div class="flex-between">',
    '            <span>会员等级: <span id="profile-membership">无会员</span></span>',
    '            <button class="btn btn-primary" id="sign-btn" onclick="sign()">每日签到</button>',
    '          </div>',
    '          <div id="sign-message" style="font-size:0.9rem; margin-top:5px;"></div>',
    '        </div>',
    '',
    '        <!-- 2FA 开关 -->',
    '        <div style="margin: 20px 0; padding: 10px; background: #e8f0fe; border-radius: 8px;">',
    '          <div class="flex-between">',
    '            <span>两步验证 (2FA)</span>',
    '            <label class="switch">',
    '              <input type="checkbox" id="twofa-toggle" onchange="toggle2FA()">',
    '              <span class="slider round"></span>',
    '            </label>',
    '          </div>',
    '          <p style="font-size:0.8rem; margin-top:5px;">开启后登录需验证邮箱验证码，可信任设备30天免验证。</p>',
    '        </div>',
    '',
    '        <!-- 会员商店 -->',
    '        <div style="margin: 20px 0;">',
    '          <h4>🛒 会员商店</h4>',
    '          <div class="shop-card regular">',
    '            <div>',
    '              <strong>大会员</strong> <span class="membership-badge membership-regular">普通会员</span><br>',
    '              <small>每日签到额外 +15 经验</small>',
    '            </div>',
    '            <div>',
    '              <span>100 币</span>',
    '              <button class="btn btn-primary" onclick="buyMembership(\'regular\')">购买</button>',
    '            </div>',
    '          </div>',
    '          <div class="shop-card super">',
    '            <div>',
    '              <strong>超级大会员</strong> <span class="membership-badge membership-super">超级会员</span><br>',
    '              <small>每日签到额外 +20 经验</small>',
    '            </div>',
    '            <div>',
    '              <span>200 币</span>',
    '              <button class="btn btn-primary" onclick="buyMembership(\'super\')">购买</button>',
    '            </div>',
    '          </div>',
    '        </div>',
    '',
    '        <p id="profile-username"></p>',
    '        <p id="profile-email"></p>',
    '        <div class="flex" style="margin:10px 0;">',
    '          <input type="text" id="profile-displayname" placeholder="显示名称" style="flex:1;">',
    '          <button class="btn btn-primary" onclick="updateDisplayName()">更新显示名</button>',
    '        </div>',
    '        <p id="profile-join-date"></p>',
    '        <p id="profile-delete-status"></p>',
    '        <div id="profile-actions" style="display: flex; gap: 10px; margin-top: 10px;">',
    '          <button class="btn btn-warning" onclick="showRequestDelete()" id="request-delete-btn">申请注销账号</button>',
    '          <button class="btn btn-primary" onclick="showChangePassword()">修改密码</button>',
    '        </div>',
    '      </div>',
    '      <div class="flex-between" style="margin-top: 24px;" id="my-posts-header">',
    '        <h3>📝 我的文章</h3>',
    '        <div class="flex">',
    '          <button class="btn btn-success" onclick="showMyFeedbacks()">查看我的反馈</button>',
    '          <button class="btn btn-success" onclick="showNewPost()">➕ 写新文章</button>',
    '        </div>',
    '      </div>',
    '      <div id="user-posts-container" class="posts-grid"></div>',
    '      <div id="my-feedbacks-container" class="hidden" style="margin-top:24px;">',
    '        <div class="flex-between">',
    '          <h3>💬 我的反馈</h3>',
    '          <button class="btn btn-secondary" onclick="hideFeedbacks()">返回文章列表</button>',
    '        </div>',
    '        <div id="feedbacks-list" class="feedback-list"></div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 管理面板 -->',
    '    <div id="admin-page" class="page hidden">',
    '      <div style="display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap;">',
    '        <button class="btn btn-primary" onclick="switchAdminTab(\'users\')">用户管理</button>',
    '        <button class="btn btn-primary" id="admin-feedback-tab-btn" onclick="switchAdminTab(\'feedback\')" style="display:none;">反馈管理</button>',
    '        <button class="btn btn-primary" id="admin-reports-tab-btn" onclick="switchAdminTab(\'reports\')" style="display:none;">举报管理</button>',
    '        <button class="btn btn-primary" id="admin-announcement-tab-btn" onclick="switchAdminTab(\'announcement\')" style="display:none;">公告管理</button>',
    '      </div>',
    '      <div id="admin-users-tab">',
    '        <div class="card" style="padding: 20px;">',
    '          <h3>👑 用户管理</h3>',
    '          <div id="user-list" class="user-list">加载中...</div>',
    '        </div>',
    '      </div>',
    '      <div id="admin-feedback-tab" class="hidden">',
    '        <div class="card" style="padding: 20px;">',
    '          <h3>💬 反馈管理</h3>',
    '          <div id="admin-feedback-list" class="feedback-list">加载中...</div>',
    '        </div>',
    '      </div>',
    '      <div id="admin-reports-tab" class="hidden">',
    '        <div class="card" style="padding: 20px;">',
    '          <h3>🚨 举报管理</h3>',
    '          <div id="reports-list" class="reports-list">加载中...</div>',
    '        </div>',
    '      </div>',
    '      <div id="admin-announcement-tab" class="hidden">',
    '        <div class="card" style="padding: 20px;">',
    '          <h3>📢 公告管理</h3>',
    '          <input type="text" id="announcement-title-input" placeholder="公告标题">',
    '          <textarea id="announcement-content-input" placeholder="公告内容" rows="4"></textarea>',
    '          <div class="flex">',
    '            <label><input type="radio" name="announcement-type" value="optional" checked> 选读</label>',
    '            <label><input type="radio" name="announcement-type" value="mandatory"> 必读</label>',
    '          </div>',
    '          <button class="btn btn-primary" onclick="setAnnouncement()">发布公告</button>',
    '          <div id="announcement-message"></div>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 登录模态框（修改：支持2FA两步） -->',
    '    <div class="modal" id="login-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeLoginModal()">✕</button>',
    '        <h3 style="margin-bottom: 20px;">登录</h3>',
    '        <div id="login-step1">',
    '          <input type="text" id="login-username" placeholder="用户名 / 邮箱">',
    '          <input type="password" id="login-password" placeholder="密码">',
    '          <div id="login-message"></div>',
    '          <div class="flex" style="justify-content: flex-end;">',
    '            <button class="btn" onclick="closeLoginModal()">取消</button>',
    '            <button class="btn btn-primary" onclick="loginStep1()">下一步</button>',
    '          </div>',
    '        </div>',
    '        <div id="login-step2" class="hidden">',
    '          <p>请输入发送到您邮箱的验证码</p>',
    '          <input type="text" id="login-2fa-code" placeholder="6位验证码">',
    '          <div class="flex" style="margin-bottom:10px;">',
    '            <button class="btn btn-sm" onclick="send2FACode()" id="send-2fa-btn">发送验证码</button>',
    '            <span style="margin-left:10px;" id="countdown-2fa"></span>',
    '          </div>',
    '          <label class="checkbox-custom">',
    '            <input type="checkbox" id="trust-device">',
    '            <span class="checkmark"></span>',
    '            信任此设备30天',
    '          </label>',
    '          <div id="login-2fa-message"></div>',
    '          <div class="flex" style="justify-content: flex-end; margin-top:20px;">',
    '            <button class="btn" onclick="backToStep1()">返回</button>',
    '            <button class="btn btn-primary" onclick="loginStep2()">验证并登录</button>',
    '          </div>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 2FA密码验证模态框（用于开启/关闭） -->',
    '    <div class="modal" id="twofa-password-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'twofa-password-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">验证密码</h3>',
    '        <input type="password" id="twofa-password" placeholder="请输入当前密码">',
    '        <div id="twofa-password-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'twofa-password-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="confirm2FAToggle()">确认</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 注册模态框（不变） -->',
    '    <div class="modal" id="signup-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'signup-modal\')">✕</button>',
    '        <h3 style="margin-bottom: 20px;">注册</h3>',
    '        <input type="text" id="signup-username" placeholder="用户名（3-20位字母/数字/下划线）">',
    '        <input type="email" id="signup-email" placeholder="邮箱（支持 outlook/qq/163/gmail/live.cn）">',
    '        <input type="password" id="signup-password" placeholder="密码（至少6位，含字母和数字）">',
    '        <input type="password" id="signup-confirm" placeholder="确认密码">',
    '        <div class="flex" style="margin-bottom: 16px;">',
    '          <input type="text" id="signup-captcha" placeholder="验证码" style="flex:1; margin-right:8px;">',
    '          <button class="btn btn-primary" id="send-captcha-btn" onclick="sendCaptcha()" style="white-space: nowrap;">发送验证码</button>',
    '        </div>',
    '        <div id="signup-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'signup-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="signup()">注册</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 反馈模态框 -->',
    '    <div class="modal" id="feedback-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'feedback-modal\')">✕</button>',
    '        <h3 style="margin-bottom: 20px;">💬 发送反馈</h3>',
    '        <textarea id="feedback-content" placeholder="请输入您的反馈意见..." rows="6" style="width:100%;"></textarea>',
    '        <div id="feedback-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'feedback-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="submitFeedback()">提交</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 举报模态框 -->',
    '    <div class="modal" id="report-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'report-modal\')">✕</button>',
    '        <h3 style="margin-bottom: 20px;">🚨 举报文章</h3>',
    '        <p>请选择举报原因：</p>',
    '        <select id="report-reason" class="form-control" style="margin-bottom:16px;">',
    '          <option value="违规内容">违规内容</option>',
    '          <option value="垃圾广告">垃圾广告</option>',
    '          <option value="人身攻击">人身攻击</option>',
    '          <option value="侵权">侵权</option>',
    '          <option value="其他">其他</option>',
    '        </select>',
    '        <textarea id="report-detail" placeholder="详细说明（可选）" rows="3" style="width:100%;"></textarea>',
    '        <div id="report-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'report-modal\')">取消</button>',
    '          <button class="btn btn-danger" onclick="submitReport()">提交举报</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 新建文章模态框 -->',
    '    <div class="modal" id="newpost-modal">',
    '      <div class="modal-content" style="max-width: 900px;">',
    '        <button class="modal-close" onclick="closeModal(\'newpost-modal\')">✕</button>',
    '        <h3 style="margin-bottom: 20px;">发布文章</h3>',
    '        <input type="text" id="post-title" placeholder="标题">',
    '        <div style="margin-bottom: 16px;">',
    '          <label style="display: block; margin-bottom: 5px; font-weight: 500;">选择分区：</label>',
    '          <select id="post-category" class="form-control" style="width: 100%;">',
    '            <option value="小说">小说</option>',
    '            <option value="软件">软件</option>',
    '            <option value="破解">破解</option>',
    '            <option value="逆向">逆向</option>',
    '            <option value="新人报道">新人报道</option>',
    '            <option value="其他" selected>其他</option>',
    '          </select>',
    '        </div>',
    '        <div class="editor-switch">',
    '          <label><input type="radio" name="editorMode" value="richtext" checked> 富文本</label>',
    '          <label><input type="radio" name="editorMode" value="markdown"> Markdown</label>',
    '        </div>',
    '        <div id="quill-editor"></div>',
    '        <div id="markdown-editor" class="hidden-editor"><textarea id="markdown-textarea" style="height:300px;"></textarea></div>',
    '        <div id="post-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'newpost-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="createPost()">发布</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 文章详情模态框 -->',
    '    <div class="modal" id="post-detail-modal">',
    '      <div class="modal-content" style="max-width: 800px;">',
    '        <button class="modal-close" onclick="closeModal(\'post-detail-modal\')">✕</button>',
    '        <div style="margin-bottom: 10px; color: #5e7a93; font-size: 0.8rem; display: flex; justify-content: space-between; align-items: center;">',
    '          <span>ID: <span id="detail-id"></span></span>',
    '          <span>分区: <span id="detail-category"></span>',
    '          <span id="detail-category-edit" style="margin-left: 10px;"></span>',
    '        </div>',
    '        <h2 id="detail-title" style="margin-bottom: 10px;"></h2>',
    '        <div class="post-meta" style="margin-bottom: 20px;">',
    '          <span id="detail-author" class="post-author" onclick="goToUserProfile(currentDetailAuthorUsername)">',
    '            <span id="detail-avatar"></span>',
    '            <span id="detail-author-name"></span>',
    '            <span id="detail-role-badge"></span>',
    '            <span id="detail-membership-badge"></span>',
    '          </span>',
    '          <span id="detail-time"></span>',
    '          <div>',
    '            <button class="btn btn-sm btn-info" onclick="sharePost()">🔗 分享</button>',
    '            <button class="btn btn-sm btn-danger hidden" id="detail-report-btn" onclick="showReportModal(currentDetailPostId)">举报</button>',
    '          </div>',
    '        </div>',
    '        <div style="background: #f0f7ff; padding: 10px; border-radius: 6px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">',
    '          <span>🪙 收到打赏: <strong id="detail-received-coins">0</strong> 个硬币</span>',
    '          <div id="gift-coin-buttons" style="display: none;">',
    '            <span>今日剩余可送: <span id="today-remaining">0</span>/5</span>',
    '            <button class="btn btn-success btn-sm" onclick="giftCoin(1)">送1币 (+10经验)</button>',
    '            <button class="btn btn-success btn-sm" onclick="giftCoin(2)">送2币 (+20经验)</button>',
    '          </div>',
    '        </div>',
    '        <div id="detail-content" style="line-height:1.8;"></div>',
    '        <div class="comments-section" id="comments-section">',
    '          <h4>评论 <span id="comment-count">0</span></h4>',
    '          <div id="comments-list" style="margin-bottom: 20px;"></div>',
    '          <div class="flex" style="gap:10px;">',
    '            <textarea id="comment-input" placeholder="写下你的评论..." rows="2" style="flex:1;"></textarea>',
    '            <button class="btn btn-primary" onclick="submitComment()">发布评论</button>',
    '          </div>',
    '        </div>',
    '        <div style="margin-top:20px; text-align:right;">',
    '          <button class="btn" onclick="closeModal(\'post-detail-modal\')">关闭</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 管理员修改分区模态框 -->',
    '    <div class="modal" id="edit-category-modal">',
    '      <div class="modal-content" style="max-width: 400px;">',
    '        <button class="modal-close" onclick="closeModal(\'edit-category-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">修改文章分区</h3>',
    '        <p id="edit-category-post-info"></p>',
    '        <select id="edit-category-select" class="form-control" style="margin-bottom:16px;">',
    '          <option value="小说">小说</option>',
    '          <option value="软件">软件</option>',
    '          <option value="破解">破解</option>',
    '          <option value="逆向">逆向</option>',
    '          <option value="新人报道">新人报道</option>',
    '          <option value="其他">其他</option>',
    '        </select>',
    '        <div id="edit-category-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'edit-category-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="submitCategoryEdit()">确认修改</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 申请注销模态框 -->',
    '    <div class="modal" id="delete-request-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'delete-request-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">申请注销账号</h3>',
    '        <p>注销后您的所有文章将被删除，且需管理员审核。</p>',
    '        <input type="password" id="delete-password" placeholder="请输入密码以确认">',
    '        <div id="delete-request-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'delete-request-modal\')">取消</button>',
    '          <button class="btn btn-danger" onclick="submitDeleteRequest()">提交申请</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 用户修改密码模态框 -->',
    '    <div class="modal" id="change-password-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'change-password-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">修改密码</h3>',
    '        <input type="password" id="old-password" placeholder="旧密码">',
    '        <input type="password" id="new-password" placeholder="新密码（至少6位，含字母数字）">',
    '        <input type="password" id="confirm-password" placeholder="确认新密码">',
    '        <div id="change-password-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'change-password-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="changePassword()">确认修改</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 管理员修改密码模态框 -->',
    '    <div class="modal" id="reset-password-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'reset-password-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">重置用户密码</h3>',
    '        <p id="reset-target-email"></p>',
    '        <input type="password" id="reset-new-password" placeholder="新密码（至少6位，含字母数字）">',
    '        <div id="reset-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'reset-password-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="adminResetPassword()">确认重置</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 超级管理员设置角色模态框 -->',
    '    <div class="modal" id="set-role-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'set-role-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">设置用户角色</h3>',
    '        <p id="set-role-target-email"></p>',
    '        <select id="set-role-select">',
    '          <option value="user">普通用户</option>',
    '          <option value="admin">管理员</option>',
    '        </select>',
    '        <div id="set-role-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'set-role-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="adminSetRole()">确认</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 管理员修改余额模态框 -->',
    '    <div class="modal" id="set-coins-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'set-coins-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">修改用户硬币</h3>',
    '        <p id="set-coins-target-email"></p>',
    '        <input type="number" id="set-coins-amount" placeholder="新币数" min="0" step="1">',
    '        <div id="set-coins-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'set-coins-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="adminSetCoins()">确认修改</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 管理员设置会员模态框 -->',
    '    <div class="modal" id="set-membership-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'set-membership-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">修改用户会员</h3>',
    '        <p id="set-membership-target-email"></p>',
    '        <select id="set-membership-select">',
    '          <option value="none">无会员</option>',
    '          <option value="regular">大会员</option>',
    '          <option value="super">超级大会员</option>',
    '        </select>',
    '        <div id="set-membership-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'set-membership-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="adminSetMembership()">确认修改</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 管理员处理举报模态框 -->',
    '    <div class="modal" id="process-report-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'process-report-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">处理举报</h3>',
    '        <p id="process-report-info"></p>',
    '        <div class="flex" style="margin-bottom:16px;">',
    '          <select id="process-action" class="form-control">',
    '            <option value="resolve">标记为已处理（不封禁）</option>',
    '            <option value="reject">驳回举报</option>',
    '            <option value="ban">封禁用户</option>',
    '          </select>',
    '        </div>',
    '        <div id="ban-days-input" style="display:none; margin-bottom:16px;">',
    '          <input type="number" id="ban-days" placeholder="封禁天数" min="1" value="7">',
    '        </div>',
    '        <textarea id="process-note" placeholder="处理备注（可选）" rows="3" style="width:100%;"></textarea>',
    '        <div id="process-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'process-report-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="processReport()">确认处理</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- 管理员回复反馈模态框 -->',
    '    <div class="modal" id="reply-feedback-modal">',
    '      <div class="modal-content">',
    '        <button class="modal-close" onclick="closeModal(\'reply-feedback-modal\')">✕</button>',
    '        <h3 style="margin-bottom:20px;">回复反馈</h3>',
    '        <p id="reply-feedback-info"></p>',
    '        <textarea id="reply-content" placeholder="管理员回复" rows="4" style="width:100%;"></textarea>',
    '        <div id="reply-message"></div>',
    '        <div class="flex" style="justify-content: flex-end;">',
    '          <button class="btn" onclick="closeModal(\'reply-feedback-modal\')">取消</button>',
    '          <button class="btn btn-primary" onclick="submitFeedbackReply()">发送回复</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '',
    '  <!-- 原版页脚 -->',
    '  <div class="footer">',
    '    © 2026 Coloryi · 版本 V26.2.27 · 预告：可能接入OldChat BBS——<a href="https://oldchat.blog" target="_blank">oldchat.blog</a> · 友情链接 <a href="https://friends.coloryi.top" target="_blank">friends.coloryi.top</a>',
    '  </div>',
    '',
    '  <!-- 第三方库 -->',
    '  <script src="https://cdn.quilljs.com/1.3.6/quill.min.js"></script>',
    '  <script src="https://unpkg.com/easymde/dist/easymde.min.js"></script>',
    '  <script>',
    '    const API_BASE = \'/api\';',
    '    let token = localStorage.getItem(\'token\');',
    '    let currentUserRole = null;',
    '    let currentUserEmail = null;',
    '    let currentUserReadAnnouncements = [];',
    '    let allPosts = [];',
    '    let quill;',
    '    let easyMDE;',
    '    let currentEditorMode = \'richtext\';',
    '    let currentResetEmail = \'\';',
    '    let currentSetRoleEmail = \'\';',
    '    let currentSetCoinsEmail = \'\';',
    '    let currentSetMembershipEmail = \'\';',
    '    let currentDetailPostId = null;',
    '    let currentDetailAuthorUsername = null;',
    '    let currentReportPostId = null;',
    '    let currentFeedbackId = null;',
    '    let currentReportId = null;',
    '    let currentAnnouncementId = null;',
    '    let currentEditCategoryPostId = null;',
    '    let currentCategory = \'全部\';',
    '    let currentUserCoins = 0;',
    '    let currentUserExp = 0;',
    '    let currentUserLevel = 1;',
    '    let currentUserTodayGiven = 0;',
    '    let currentUserMembership = \'none\';',
    '    let currentUser2FAEnabled = false;',
    '    let loginTempEmail = null;',
    '    let countdownInterval = null;',
    '',
    '    function updateTime() {',
    '      const now = new Date();',
    '      const year = now.getFullYear();',
    '      const month = String(now.getMonth() + 1).padStart(2, \'0\');',
    '      const day = String(now.getDate()).padStart(2, \'0\');',
    '      const weekdays = [\'周日\', \'周一\', \'周二\', \'周三\', \'周四\', \'周五\', \'周六\'];',
    '      const weekday = weekdays[now.getDay()];',
    '      const hours = String(now.getHours()).padStart(2, \'0\');',
    '      const minutes = String(now.getMinutes()).padStart(2, \'0\');',
    '      const seconds = String(now.getSeconds()).padStart(2, \'0\');',
    '      document.getElementById(\'current-time\').textContent = ',
    '        `${year}-${month}-${day} ${weekday} ${hours}:${minutes}:${seconds}`;',
    '    }',
    '    setInterval(updateTime, 1000);',
    '    updateTime();',
    '',
    '    function showMessage(elementId, text, type) {',
    '      const element = document.getElementById(elementId);',
    '      if (element) {',
    '        element.innerHTML = `<div class="message ${type}" style="padding:10px; border-radius:6px; margin:10px 0; background:${type===\'error\'?\'#ffebee\':\'#e8f5e8\'}">${text}</div>`;',
    '      }',
    '    }',
    '',
    '    function closeModal(id) {',
    '      document.getElementById(id).classList.remove(\'active\');',
    '    }',
    '',
    '    function showModal(id) {',
    '      document.getElementById(id).classList.add(\'active\');',
    '    }',
    '',
    '    function getRoleBadgeHtml(role) {',
    '      if (role === \'superadmin\') return \'<span class="role-badge role-superadmin">超级管理员</span>\';',
    '      if (role === \'admin\') return \'<span class="role-badge role-admin">管理员</span>\';',
    '      return \'<span class="role-badge role-user">普通用户</span>\';',
    '    }',
    '',
    '    function getMembershipBadgeHtml(membership) {',
    '      if (membership === \'super\') return \'<span class="membership-badge membership-super">超级大会员</span>\';',
    '      if (membership === \'regular\') return \'<span class="membership-badge membership-regular">大会员</span>\';',
    '      return \'<span class="membership-badge membership-none">无会员</span>\';',
    '    }',
    '',
    '    function goToUserProfile(username) {',
    '      if (username) {',
    '        window.location.href = `/?user=${encodeURIComponent(username)}`;',
    '      }',
    '    }',
    '',
    '    async function apiCall(url, options = {}) {',
    '      const headers = { \'Content-Type\': \'application/json\', ...options.headers };',
    '      if (token) headers[\'Authorization\'] = `Bearer ${token}`;',
    '      try {',
    '        const res = await fetch(API_BASE + url, { ...options, headers });',
    '        const data = await res.json();',
    '        return { ok: res.ok, status: res.status, data };',
    '      } catch (e) {',
    '        return { ok: false, data: { error: \'网络错误\' } };',
    '      }',
    '    }',
    '',
    '    async function sendCaptcha() {',
    '      const email = document.getElementById(\'signup-email\').value.trim();',
    '      if (!email) {',
    '        showMessage(\'signup-message\', \'请先填写邮箱\', \'error\');',
    '        return;',
    '      }',
    '      const btn = document.getElementById(\'send-captcha-btn\');',
    '      btn.disabled = true;',
    '      btn.textContent = \'发送中...\';',
    '      const { ok, data } = await apiCall(\'/send-captcha\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ email })',
    '      });',
    '      if (ok) {',
    '        showMessage(\'signup-message\', \'验证码已发送，请查收邮件\', \'success\');',
    '        let seconds = 60;',
    '        const timer = setInterval(() => {',
    '          seconds--;',
    '          if (seconds <= 0) {',
    '            clearInterval(timer);',
    '            btn.disabled = false;',
    '            btn.textContent = \'发送验证码\';',
    '          } else {',
    '            btn.textContent = `重新发送(${seconds}s)`;',
    '          }',
    '        }, 1000);',
    '      } else {',
    '        btn.disabled = false;',
    '        btn.textContent = \'发送验证码\';',
    '        showMessage(\'signup-message\', data.error || \'发送失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function initUser() {',
    '      if (!token) return;',
    '      try {',
    '        const res = await fetch(\'/api/user/info\', {',
    '          headers: { \'Authorization\': \'Bearer \' + token }',
    '        });',
    '        if (res.ok) {',
    '          const data = await res.json();',
    '          currentUserRole = data.role;',
    '          currentUserEmail = data.email;',
    '          currentUserReadAnnouncements = data.readAnnouncements || [];',
    '          currentUserCoins = data.coins || 0;',
    '          currentUserExp = data.exp || 0;',
    '          currentUserLevel = data.level || 1;',
    '          currentUserTodayGiven = data.todayGivenCoins || 0;',
    '          currentUserMembership = data.membership || \'none\';',
    '          currentUser2FAEnabled = data.twoFactorEnabled || false;',
    '          updateUI();',
    '          if (currentUserRole === \'superadmin\' || currentUserRole === \'admin\') {',
    '            checkAdminNotifications();',
    '          }',
    '          if (data.avatar) {',
    '            document.getElementById(\'avatar-preview\').innerHTML = `<img src="${data.avatar}" alt="avatar">`;',
    '          } else {',
    '            document.getElementById(\'avatar-preview\').innerHTML = `<span id="avatar-emoji">😊</span>`;',
    '          }',
    '          document.getElementById(\'coin-badge-nav\').textContent = `🪙 ${currentUserCoins}`;',
    '          document.getElementById(\'coin-badge-nav\').style.display = \'inline-block\';',
    '          document.getElementById(\'level-badge-nav\').textContent = `Lv${currentUserLevel}`;',
    '          document.getElementById(\'level-badge-nav\').style.display = \'inline-block\';',
    '          // 更新2FA开关状态',
    '          const toggle = document.getElementById(\'twofa-toggle\');',
    '          if (toggle) toggle.checked = currentUser2FAEnabled;',
    '        } else {',
    '          localStorage.removeItem(\'token\');',
    '          token = null;',
    '        }',
    '      } catch (e) {',
    '        console.error(\'获取用户信息失败\', e);',
    '      }',
    '    }',
    '',
    '    async function checkAdminNotifications() {',
    '      if (currentUserRole !== \'superadmin\' && currentUserRole !== \'admin\') return;',
    '      try {',
    '        const [feedbackRes, reportsRes, usersRes] = await Promise.all([',
    '          apiCall(\'/admin/feedback\'),',
    '          apiCall(\'/admin/reports\'),',
    '          apiCall(\'/admin/users\')',
    '        ]);',
    '        let hasUnread = false;',
    '        if (feedbackRes.ok && feedbackRes.data.feedbacks) {',
    '          hasUnread = feedbackRes.data.feedbacks.some(fb => !fb.read);',
    '        }',
    '        if (!hasUnread && reportsRes.ok && reportsRes.data.reports) {',
    '          hasUnread = reportsRes.data.reports.some(r => r.status === \'pending\');',
    '        }',
    '        if (!hasUnread && usersRes.ok && usersRes.data.users) {',
    '          hasUnread = usersRes.data.users.some(u => u.deleteRequested);',
    '        }',
    '        const dot = document.getElementById(\'admin-unread-dot\');',
    '        if (hasUnread) {',
    '          dot.classList.remove(\'hidden\');',
    '        } else {',
    '          dot.classList.add(\'hidden\');',
    '        }',
    '      } catch (e) {',
    '        console.error(\'检查通知失败\', e);',
    '      }',
    '    }',
    '',
    '    // 页面切换动画',
    '    function switchPage(showId, hideIds) {',
    '      const showEl = document.getElementById(showId);',
    '      hideIds.forEach(id => {',
    '        const el = document.getElementById(id);',
    '        if (el && !el.classList.contains(\'hidden\')) {',
    '          el.classList.add(\'fade-out\');',
    '          setTimeout(() => {',
    '            el.classList.add(\'hidden\');',
    '            el.classList.remove(\'fade-out\');',
    '          }, 300);',
    '        }',
    '      });',
    '      setTimeout(() => {',
    '        showEl.classList.remove(\'hidden\');',
    '        showEl.classList.add(\'fade-in\');',
    '        setTimeout(() => showEl.classList.remove(\'fade-in\'), 300);',
    '      }, 300);',
    '    }',
    '',
    '    function showHome() {',
    '      switchPage(\'home-page\', [\'profile-page\', \'admin-page\']);',
    '      loadAllPosts();',
    '    }',
    '',
    '    async function showProfile() {',
    '      switchPage(\'profile-page\', [\'home-page\', \'admin-page\']);',
    '      document.getElementById(\'user-posts-container\').classList.remove(\'hidden\');',
    '      document.getElementById(\'my-posts-header\').classList.remove(\'hidden\');',
    '      document.getElementById(\'my-feedbacks-container\').classList.add(\'hidden\');',
    '      const res = await fetch(\'/api/user/info\', {',
    '        headers: { \'Authorization\': \'Bearer \' + token }',
    '      });',
    '      if (res.ok) {',
    '        const data = await res.json();',
    '        document.getElementById(\'profile-username\').textContent = `👤 用户名：${data.username}`;',
    '        document.getElementById(\'profile-email\').textContent = `📧 邮箱：${data.email}`;',
    '        document.getElementById(\'profile-displayname\').value = data.displayName || \'\';',
    '        document.getElementById(\'profile-join-date\').textContent = `📅 注册时间：${new Date(data.createdAt).toLocaleString()}`;',
    '        document.getElementById(\'profile-role-badge\').innerHTML = getRoleBadgeHtml(data.role);',
    '        currentUserReadAnnouncements = data.readAnnouncements || [];',
    '        if (data.deleteRequested) {',
    '          document.getElementById(\'profile-delete-status\').textContent = `⚠️ 注销申请已提交，等待管理员审核（申请时间：${new Date(data.deleteRequestedAt).toLocaleString()})`;',
    '          document.getElementById(\'request-delete-btn\').disabled = true;',
    '        } else {',
    '          document.getElementById(\'profile-delete-status\').textContent = \'\';',
    '          document.getElementById(\'request-delete-btn\').disabled = false;',
    '        }',
    '        const exp = data.exp || 0;',
    '        const level = data.level || 1;',
    '        const coins = data.coins || 0;',
    '        const membership = data.membership || \'none\';',
    '        currentUser2FAEnabled = data.twoFactorEnabled || false;',
    '        document.getElementById(\'twofa-toggle\').checked = currentUser2FAEnabled;',
    '        document.getElementById(\'profile-level\').textContent = level;',
    '        document.getElementById(\'profile-exp\').textContent = exp;',
    '        document.getElementById(\'profile-coins\').textContent = coins;',
    '        let membershipText = \'无会员\';',
    '        if (data.role === \'superadmin\') membershipText = \'超级大会员（管理员）\';',
    '        else if (membership === \'super\') membershipText = \'超级大会员\';',
    '        else if (membership === \'regular\') membershipText = \'大会员\';',
    '        document.getElementById(\'profile-membership\').textContent = membershipText;',
    '        const expLevels = [0, 100, 300, 600, 1000, 1500];',
    '        let nextExp = level < 6 ? expLevels[level] : expLevels[5];',
    '        let prevExp = level > 1 ? expLevels[level-1] : 0;',
    '        let percent = level < 6 ? ((exp - prevExp) / (nextExp - prevExp)) * 100 : 100;',
    '        document.getElementById(\'profile-exp-bar\').style.width = percent + \'%\';',
    '        const lastClaim = data.lastDailyCoinTime ? data.lastDailyCoinTime.split(\'T\')[0] : null;',
    '        const today = new Date().toISOString().split(\'T\')[0];',
    '        const claimBtn = document.getElementById(\'claim-daily-btn\');',
    '        if (lastClaim === today) {',
    '          claimBtn.disabled = true;',
    '          claimBtn.textContent = \'今日已领\';',
    '        } else {',
    '          claimBtn.disabled = false;',
    '          claimBtn.textContent = \'领取每日币\';',
    '        }',
    '        const lastSign = data.lastSignDate ? data.lastSignDate.split(\'T\')[0] : null;',
    '        const signBtn = document.getElementById(\'sign-btn\');',
    '        if (lastSign === today) {',
    '          signBtn.disabled = true;',
    '          signBtn.textContent = \'今日已签\';',
    '        } else {',
    '          signBtn.disabled = false;',
    '          signBtn.textContent = \'每日签到\';',
    '        }',
    '      }',
    '      loadUserPosts();',
    '    }',
    '',
    '    async function showAdminPanel() {',
    '      switchPage(\'admin-page\', [\'home-page\', \'profile-page\']);',
    '      const isSuper = currentUserRole === \'superadmin\';',
    '      document.getElementById(\'admin-feedback-tab-btn\').style.display = isSuper ? \'inline-block\' : \'none\';',
    '      document.getElementById(\'admin-reports-tab-btn\').style.display = isSuper ? \'inline-block\' : \'none\';',
    '      document.getElementById(\'admin-announcement-tab-btn\').style.display = isSuper ? \'inline-block\' : \'none\';',
    '      switchAdminTab(\'users\');',
    '    }',
    '',
    '    function switchAdminTab(tab) {',
    '      document.getElementById(\'admin-users-tab\').classList.add(\'hidden\');',
    '      document.getElementById(\'admin-feedback-tab\').classList.add(\'hidden\');',
    '      document.getElementById(\'admin-reports-tab\').classList.add(\'hidden\');',
    '      document.getElementById(\'admin-announcement-tab\').classList.add(\'hidden\');',
    '      if (tab === \'users\') {',
    '        document.getElementById(\'admin-users-tab\').classList.remove(\'hidden\');',
    '        loadUsers();',
    '      } else if (tab === \'feedback\') {',
    '        document.getElementById(\'admin-feedback-tab\').classList.remove(\'hidden\');',
    '        loadAdminFeedback();',
    '      } else if (tab === \'reports\') {',
    '        document.getElementById(\'admin-reports-tab\').classList.remove(\'hidden\');',
    '        loadReports();',
    '      } else if (tab === \'announcement\') {',
    '        document.getElementById(\'admin-announcement-tab\').classList.remove(\'hidden\');',
    '      }',
    '    }',
    '',
    '    // 登录两步',
    '    function showLogin() {',
    '      document.getElementById(\'login-username\').value = \'\';',
    '      document.getElementById(\'login-password\').value = \'\';',
    '      document.getElementById(\'login-message\').innerHTML = \'\';',
    '      document.getElementById(\'login-step1\').classList.remove(\'hidden\');',
    '      document.getElementById(\'login-step2\').classList.add(\'hidden\');',
    '      document.getElementById(\'login-2fa-code\').value = \'\';',
    '      document.getElementById(\'login-2fa-message\').innerHTML = \'\';',
    '      document.getElementById(\'trust-device\').checked = false;',
    '      showModal(\'login-modal\');',
    '    }',
    '',
    '    function closeLoginModal() {',
    '      closeModal(\'login-modal\');',
    '      if (countdownInterval) clearInterval(countdownInterval);',
    '    }',
    '',
    '    async function loginStep1() {',
    '      const login = document.getElementById(\'login-username\').value.trim();',
    '      const password = document.getElementById(\'login-password\').value;',
    '      if (!login || !password) {',
    '        showMessage(\'login-message\', \'请输入用户名/邮箱和密码\', \'error\');',
    '        return;',
    '      }',
    '      const { ok, data } = await apiCall(\'/login\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ login, password })',
    '      });',
    '      if (ok) {',
    '        if (data.require2fa) {',
    '          loginTempEmail = data.email;',
    '          document.getElementById(\'login-step1\').classList.add(\'hidden\');',
    '          document.getElementById(\'login-step2\').classList.remove(\'hidden\');',
    '        } else {',
    '          token = data.token;',
    '          localStorage.setItem(\'token\', token);',
    '          currentUserRole = data.role;',
    '          closeLoginModal();',
    '          updateUI();',
    '          loadAllPosts();',
    '          checkAnnouncement();',
    '        }',
    '      } else {',
    '        showMessage(\'login-message\', data.error || \'登录失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function send2FACode() {',
    '      if (!loginTempEmail) return;',
    '      const btn = document.getElementById(\'send-2fa-btn\');',
    '      btn.disabled = true;',
    '      const { ok, data } = await apiCall(\'/user/send-2fa-code\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ email: loginTempEmail })',
    '      });',
    '      if (ok) {',
    '        showMessage(\'login-2fa-message\', \'验证码已发送\', \'success\');',
    '        let seconds = 60;',
    '        countdownInterval = setInterval(() => {',
    '          seconds--;',
    '          document.getElementById(\'countdown-2fa\').textContent = seconds > 0 ? `${seconds}秒后重试` : \'\';',
    '          if (seconds <= 0) {',
    '            clearInterval(countdownInterval);',
    '            btn.disabled = false;',
    '            document.getElementById(\'countdown-2fa\').textContent = \'\';',
    '          }',
    '        }, 1000);',
    '      } else {',
    '        btn.disabled = false;',
    '        showMessage(\'login-2fa-message\', data.error || \'发送失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function loginStep2() {',
    '      const code = document.getElementById(\'login-2fa-code\').value.trim();',
    '      const trust = document.getElementById(\'trust-device\').checked;',
    '      if (!code) {',
    '        showMessage(\'login-2fa-message\', \'请输入验证码\', \'error\');',
    '        return;',
    '      }',
    '      const { ok, data } = await apiCall(\'/user/verify-2fa\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ email: loginTempEmail, code, trustDevice: trust })',
    '      });',
    '      if (ok) {',
    '        token = data.token;',
    '        localStorage.setItem(\'token\', token);',
    '        currentUserRole = data.role;',
    '        closeLoginModal();',
    '        updateUI();',
    '        loadAllPosts();',
    '        checkAnnouncement();',
    '      } else {',
    '        showMessage(\'login-2fa-message\', data.error || \'验证失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    function backToStep1() {',
    '      document.getElementById(\'login-step1\').classList.remove(\'hidden\');',
    '      document.getElementById(\'login-step2\').classList.add(\'hidden\');',
    '      if (countdownInterval) clearInterval(countdownInterval);',
    '    }',
    '',
    '    // 2FA开关',
    '    function toggle2FA() {',
    '      showModal(\'twofa-password-modal\');',
    '      document.getElementById(\'twofa-password\').value = \'\';',
    '      document.getElementById(\'twofa-password-message\').innerHTML = \'\';',
    '    }',
    '',
    '    async function confirm2FAToggle() {',
    '      const password = document.getElementById(\'twofa-password\').value;',
    '      if (!password) {',
    '        showMessage(\'twofa-password-message\', \'请输入密码\', \'error\');',
    '        return;',
    '      }',
    '      const enable = !currentUser2FAEnabled;',
    '      const url = enable ? \'/user/enable-2fa\' : \'/user/disable-2fa\';',
    '      const { ok, data } = await apiCall(url, {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ password })',
    '      });',
    '      if (ok) {',
    '        currentUser2FAEnabled = enable;',
    '        document.getElementById(\'twofa-toggle\').checked = enable;',
    '        closeModal(\'twofa-password-modal\');',
    '        alert(enable ? \'两步验证已开启\' : \'两步验证已关闭\');',
    '      } else {',
    '        showMessage(\'twofa-password-message\', data.error || \'操作失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function sign() {',
    '      const { ok, data } = await apiCall(\'/user/sign\', { method: \'POST\' });',
    '      if (ok) {',
    '        showMessage(\'sign-message\', `签到成功！获得 ${data.expGain} 经验，当前经验 ${data.newExp}，等级 ${data.newLevel}`, \'success\');',
    '        document.getElementById(\'sign-btn\').disabled = true;',
    '        document.getElementById(\'sign-btn\').textContent = \'今日已签\';',
    '        document.getElementById(\'profile-exp\').textContent = data.newExp;',
    '        document.getElementById(\'profile-level\').textContent = data.newLevel;',
    '        document.getElementById(\'level-badge-nav\').textContent = `Lv${data.newLevel}`;',
    '      } else {',
    '        showMessage(\'sign-message\', data.error || \'签到失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function buyMembership(type) {',
    '      const { ok, data } = await apiCall(\'/user/buy-membership\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ membershipType: type })',
    '      });',
    '      if (ok) {',
    '        alert(`购买成功！剩余硬币：${data.newCoins}`);',
    '        showProfile();',
    '        document.getElementById(\'coin-badge-nav\').textContent = `🪙 ${data.newCoins}`;',
    '      } else {',
    '        alert(data.error || \'购买失败\');',
    '      }',
    '    }',
    '',
    '    function showSetMembershipModal(email, currentMembership) {',
    '      currentSetMembershipEmail = email;',
    '      document.getElementById(\'set-membership-target-email\').textContent = `目标用户：${email}`;',
    '      document.getElementById(\'set-membership-select\').value = currentMembership || \'none\';',
    '      document.getElementById(\'set-membership-message\').innerHTML = \'\';',
    '      showModal(\'set-membership-modal\');',
    '    }',
    '',
    '    async function adminSetMembership() {',
    '      const membershipType = document.getElementById(\'set-membership-select\').value;',
    '      const { ok, data } = await apiCall(\'/admin/user/set-membership\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ targetEmail: currentSetMembershipEmail, membershipType })',
    '      });',
    '      if (ok) {',
    '        alert(\'会员修改成功\');',
    '        closeModal(\'set-membership-modal\');',
    '        loadUsers();',
    '      } else {',
    '        showMessage(\'set-membership-message\', data.error || \'修改失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function showMyFeedbacks() {',
    '      document.getElementById(\'user-posts-container\').classList.add(\'hidden\');',
    '      document.getElementById(\'my-posts-header\').classList.add(\'hidden\');',
    '      document.getElementById(\'my-feedbacks-container\').classList.remove(\'hidden\');',
    '      const { ok, data } = await apiCall(\'/user/feedbacks\');',
    '      if (ok && data.feedbacks) {',
    '        let html = \'\';',
    '        data.feedbacks.forEach(fb => {',
    '          const statusClass = `status-${fb.status}`;',
    '          html += `',
    '            <div class="feedback-item">',
    '              <div class="feedback-content">',
    '                <div>${fb.content}</div>',
    '                <div class="feedback-meta">${new Date(fb.createdAt).toLocaleString()}</div>',
    '                ${fb.adminReply ? `<div class="admin-reply" style="margin-top:5px; padding:5px; background:#f0f0f0;">管理员回复：${fb.adminReply}</div>` : \'\'}',
    '              </div>',
    '              <div>',
    '                <span class="status-badge ${statusClass}">${fb.status}</span>',
    '              </div>',
    '            </div>',
    '          `;',
    '        });',
    '        document.getElementById(\'feedbacks-list\').innerHTML = html || \'<p>暂无反馈</p>\';',
    '      }',
    '    }',
    '',
    '    function hideFeedbacks() {',
    '      document.getElementById(\'user-posts-container\').classList.remove(\'hidden\');',
    '      document.getElementById(\'my-posts-header\').classList.remove(\'hidden\');',
    '      document.getElementById(\'my-feedbacks-container\').classList.add(\'hidden\');',
    '    }',
    '',
    '    function showSignup() {',
    '      document.getElementById(\'signup-username\').value = \'\';',
    '      document.getElementById(\'signup-email\').value = \'\';',
    '      document.getElementById(\'signup-password\').value = \'\';',
    '      document.getElementById(\'signup-confirm\').value = \'\';',
    '      document.getElementById(\'signup-captcha\').value = \'\';',
    '      document.getElementById(\'signup-message\').innerHTML = \'\';',
    '      const btn = document.getElementById(\'send-captcha-btn\');',
    '      btn.disabled = false;',
    '      btn.textContent = \'发送验证码\';',
    '      showModal(\'signup-modal\');',
    '    }',
    '',
    '    function showNewPost() {',
    '      document.getElementById(\'post-title\').value = \'\';',
    '      document.getElementById(\'post-category\').value = \'其他\';',
    '      document.querySelector(\'input[name="editorMode"][value="richtext"]\').checked = true;',
    '      switchEditor(\'richtext\');',
    '      showModal(\'newpost-modal\');',
    '    }',
    '',
    '    function showFeedbackModal() {',
    '      document.getElementById(\'feedback-content\').value = \'\';',
    '      document.getElementById(\'feedback-message\').innerHTML = \'\';',
    '      showModal(\'feedback-modal\');',
    '    }',
    '',
    '    function showReportModal(postId) {',
    '      currentReportPostId = postId;',
    '      document.getElementById(\'report-reason\').value = \'违规内容\';',
    '      document.getElementById(\'report-detail\').value = \'\';',
    '      showModal(\'report-modal\');',
    '    }',
    '',
    '    function showRequestDelete() {',
    '      document.getElementById(\'delete-password\').value = \'\';',
    '      document.getElementById(\'delete-request-message\').innerHTML = \'\';',
    '      showModal(\'delete-request-modal\');',
    '    }',
    '',
    '    function showChangePassword() {',
    '      document.getElementById(\'old-password\').value = \'\';',
    '      document.getElementById(\'new-password\').value = \'\';',
    '      document.getElementById(\'confirm-password\').value = \'\';',
    '      document.getElementById(\'change-password-message\').innerHTML = \'\';',
    '      showModal(\'change-password-modal\');',
    '    }',
    '',
    '    function showResetPasswordModal(email) {',
    '      currentResetEmail = email;',
    '      document.getElementById(\'reset-target-email\').textContent = `目标用户：${email}`;',
    '      document.getElementById(\'reset-new-password\').value = \'\';',
    '      document.getElementById(\'reset-message\').innerHTML = \'\';',
    '      showModal(\'reset-password-modal\');',
    '    }',
    '',
    '    function showSetRoleModal(email, currentRole) {',
    '      currentSetRoleEmail = email;',
    '      document.getElementById(\'set-role-target-email\').textContent = `目标用户：${email}`;',
    '      document.getElementById(\'set-role-select\').value = currentRole === \'admin\' ? \'admin\' : \'user\';',
    '      document.getElementById(\'set-role-message\').innerHTML = \'\';',
    '      showModal(\'set-role-modal\');',
    '    }',
    '',
    '    function showSetCoinsModal(email, currentCoins) {',
    '      currentSetCoinsEmail = email;',
    '      document.getElementById(\'set-coins-target-email\').textContent = `目标用户：${email}`;',
    '      document.getElementById(\'set-coins-amount\').value = currentCoins;',
    '      document.getElementById(\'set-coins-message\').innerHTML = \'\';',
    '      showModal(\'set-coins-modal\');',
    '    }',
    '',
    '    async function adminSetCoins() {',
    '      const newCoins = parseInt(document.getElementById(\'set-coins-amount\').value);',
    '      if (isNaN(newCoins) || newCoins < 0) {',
    '        showMessage(\'set-coins-message\', \'请输入有效的非负数\', \'error\');',
    '        return;',
    '      }',
    '      const { ok, data } = await apiCall(\'/admin/user/set-coins\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ targetEmail: currentSetCoinsEmail, newCoins })',
    '      });',
    '      if (ok) {',
    '        alert(\'余额修改成功\');',
    '        closeModal(\'set-coins-modal\');',
    '        loadUsers();',
    '        if (currentSetCoinsEmail === currentUserEmail) {',
    '          currentUserCoins = newCoins;',
    '          document.getElementById(\'coin-badge-nav\').textContent = `🪙 ${newCoins}`;',
    '        }',
    '      } else {',
    '        showMessage(\'set-coins-message\', data.error || \'修改失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    function showReplyFeedback(feedbackId, authorName) {',
    '      currentFeedbackId = feedbackId;',
    '      document.getElementById(\'reply-feedback-info\').textContent = `回复给：${authorName}`;',
    '      document.getElementById(\'reply-content\').value = \'\';',
    '      showModal(\'reply-feedback-modal\');',
    '    }',
    '',
    '    function showProcessReport(reportId, postId) {',
    '      currentReportId = reportId;',
    '      document.getElementById(\'process-report-info\').textContent = `处理举报（文章ID：${postId}）`;',
    '      document.getElementById(\'process-action\').value = \'resolve\';',
    '      document.getElementById(\'ban-days-input\').style.display = \'none\';',
    '      document.getElementById(\'process-note\').value = \'\';',
    '      showModal(\'process-report-modal\');',
    '    }',
    '',
    '    function showEditCategoryModal(postId, currentCategory) {',
    '      currentEditCategoryPostId = postId;',
    '      document.getElementById(\'edit-category-post-info\').textContent = `正在修改文章 ID: ${postId}`;',
    '      document.getElementById(\'edit-category-select\').value = currentCategory;',
    '      document.getElementById(\'edit-category-message\').innerHTML = \'\';',
    '      showModal(\'edit-category-modal\');',
    '    }',
    '',
    '    function sharePost() {',
    '      if (!currentDetailPostId) return;',
    '      const url = `${window.location.origin}/?post=${currentDetailPostId}`;',
    '      navigator.clipboard.writeText(url).then(() => {',
    '        alert(`文章链接已复制到剪贴板：${url}`);',
    '        if (token) {',
    '          apiCall(\'/user/share-post\', {',
    '            method: \'POST\',',
    '            body: JSON.stringify({ postId: currentDetailPostId })',
    '          }).then(({ ok, data }) => {',
    '            if (ok) {',
    '              alert(`分享成功！获得5经验，当前经验 ${data.newExp}，等级 ${data.newLevel}`);',
    '              currentUserExp = data.newExp;',
    '              currentUserLevel = data.newLevel;',
    '              document.getElementById(\'level-badge-nav\').textContent = `Lv${data.newLevel}`;',
    '            }',
    '          });',
    '        }',
    '      }).catch(() => {',
    '        alert(\'复制失败，请手动复制链接\');',
    '      });',
    '    }',
    '',
    '    async function claimDailyCoin() {',
    '      const { ok, data } = await apiCall(\'/user/claim-daily-coin\', { method: \'POST\' });',
    '      if (ok) {',
    '        alert(`领取成功！当前硬币：${data.coins}`);',
    '        showProfile();',
    '        document.getElementById(\'coin-badge-nav\').textContent = `🪙 ${data.coins}`;',
    '      } else {',
    '        alert(data.error || \'领取失败\');',
    '      }',
    '    }',
    '',
    '    async function giftCoin(amount) {',
    '      if (!currentDetailPostId) return;',
    '      const { ok, data } = await apiCall(\'/user/gift-coin\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ postId: currentDetailPostId, amount })',
    '      });',
    '      if (ok) {',
    '        alert(`赠送成功！获得经验 ${amount*10}，当前经验 ${data.newExp}，等级 ${data.newLevel}`);',
    '        document.getElementById(\'detail-received-coins\').textContent = data.receivedCoins;',
    '        currentUserCoins = data.newCoins;',
    '        currentUserExp = data.newExp;',
    '        currentUserLevel = data.newLevel;',
    '        currentUserTodayGiven += amount;',
    '        document.getElementById(\'coin-badge-nav\').textContent = `🪙 ${data.newCoins}`;',
    '        document.getElementById(\'level-badge-nav\').textContent = `Lv${data.newLevel}`;',
    '        updateTodayRemaining();',
    '      } else {',
    '        alert(data.error || \'赠送失败\');',
    '      }',
    '    }',
    '',
    '    function updateTodayRemaining() {',
    '      const remaining = 5 - currentUserTodayGiven;',
    '      document.getElementById(\'today-remaining\').textContent = remaining >= 0 ? remaining : 0;',
    '    }',
    '',
    '    function filterByCategory(category) {',
    '      currentCategory = category;',
    '      renderFilteredPosts();',
    '      document.querySelectorAll(\'.category-btn\').forEach(btn => {',
    '        btn.classList.remove(\'active\');',
    '        if (btn.textContent.trim() === category) {',
    '          btn.classList.add(\'active\');',
    '        }',
    '      });',
    '    }',
    '',
    '    function renderFilteredPosts() {',
    '      if (currentCategory === \'全部\') {',
    '        renderPosts(allPosts, \'posts-container\');',
    '      } else {',
    '        const filtered = allPosts.filter(post => post.category === currentCategory);',
    '        renderPosts(filtered, \'posts-container\');',
    '      }',
    '    }',
    '',
    '    async function loadAllPosts() {',
    '      const container = document.getElementById(\'posts-container\');',
    '      container.innerHTML = \'<div class="text-center" style="grid-column:1/-1; padding:40px;">加载中...</div>\';',
    '      const { ok, data } = await apiCall(\'/posts\');',
    '      if (ok) {',
    '        allPosts = data.posts || [];',
    '        renderFilteredPosts();',
    '      } else {',
    '        container.innerHTML = \'<div class="text-center" style="grid-column:1/-1; padding:40px;">加载失败</div>\';',
    '      }',
    '    }',
    '',
    '    async function loadUserPosts() {',
    '      const container = document.getElementById(\'user-posts-container\');',
    '      container.innerHTML = \'<div class="text-center" style="grid-column:1/-1; padding:40px;">加载中...</div>\';',
    '      const { ok, data } = await apiCall(\'/user/posts\');',
    '      if (ok) {',
    '        renderPosts(data.posts || [], \'user-posts-container\', true);',
    '      } else {',
    '        container.innerHTML = \'<div class="text-center" style="grid-column:1/-1; padding:40px;">加载失败</div>\';',
    '      }',
    '    }',
    '',
    '    function renderPosts(posts, containerId, showDelete = false) {',
    '      const container = document.getElementById(containerId);',
    '      if (posts.length === 0) {',
    '        container.innerHTML = \'<div class="text-center" style="grid-column:1/-1; padding:40px;">暂无文章</div>\';',
    '        return;',
    '      }',
    '      let html = \'\';',
    '      posts.forEach(post => {',
    '        let previewContent = post.content.replace(/<[^>]*>/g, \'\').slice(0, 100);',
    '        if (post.format === \'markdown\') previewContent = post.content.slice(0, 100);',
    '        const roleHtml = getRoleBadgeHtml(post.authorRole);',
    '        const membershipHtml = getMembershipBadgeHtml(post.authorMembership);',
    '        const avatarHtml = post.authorAvatar ? `<img src="${post.authorAvatar}" class="author-avatar">` : `<div class="author-avatar">${(post.authorDisplayName || \'?\').charAt(0)}</div>`;',
    '        const pinnedHtml = post.pinned ? \'<span class="post-pinned">📌 置顶</span>\' : \'\';',
    '        const shortId = post.id.substring(0, 8);',
    '        html += `',
    '          <div class="post-card" onclick=\'showPostDetail(${JSON.stringify(post).replace(/\'/g, "\\\\\'")})\'>',
    '            ${pinnedHtml}',
    '            <div class="post-id">#${shortId}</div>',
    '            <div><span class="post-category">${post.category || \'其他\'}</span> <span style="font-size:0.8rem;">🪙 ${post.receivedCoins || 0}</span></div>',
    '            <h3 class="post-title">${post.title}</h3>',
    '            <div class="post-content">${previewContent}...</div>',
    '            <div class="post-meta">',
    '              <div class="post-author" onclick="event.stopPropagation(); goToUserProfile(\'${post.authorUsername}\')">',
    '                ${avatarHtml}',
    '                <span class="author-name">${post.authorDisplayName || post.author} ${roleHtml} ${membershipHtml}</span>',
    '              </div>',
    '              <span>📅 ${new Date(post.createdAt).toLocaleDateString()}</span>',
    '            </div>',
    '        `;',
    '        if (showDelete) {',
    '          html += `<div style="margin-top:12px;"><button class="btn btn-danger" style="width:100%;" onclick="event.stopPropagation(); deletePost(\'${post.id}\')">删除</button></div>`;',
    '        } else {',
    '          if (currentUserRole === \'admin\' || currentUserRole === \'superadmin\') {',
    '            html += `<div style="margin-top:12px; display:flex; gap:5px;">',
    '              <button class="btn btn-danger" style="flex:1;" onclick="event.stopPropagation(); deletePost(\'${post.id}\')">删除</button>',
    '              <button class="btn btn-warning" style="flex:1;" onclick="event.stopPropagation(); pinPost(\'${post.id}\', ${!post.pinned})">${post.pinned ? \'取消置顶\' : \'置顶\'}</button>',
    '            </div>`;',
    '          } else {',
    '            html += `<div style="margin-top:12px;"><button class="btn btn-danger" style="width:100%;" onclick="event.stopPropagation(); showReportModal(\'${post.id}\')">举报</button></div>`;',
    '          }',
    '        }',
    '        html += \'</div>\';',
    '      });',
    '      container.innerHTML = html;',
    '    }',
    '',
    '    async function createPost() {',
    '      const title = document.getElementById(\'post-title\').value;',
    '      const category = document.getElementById(\'post-category\').value;',
    '      let content = \'\';',
    '      const format = currentEditorMode;',
    '      if (format === \'richtext\') {',
    '        if (!quill) { showMessage(\'post-message\', \'编辑器未初始化\', \'error\'); return; }',
    '        content = quill.root.innerHTML;',
    '        if (!title || !content || content === \'<p><br></p>\') {',
    '          showMessage(\'post-message\', \'标题和内容不能为空\', \'error\'); return;',
    '        }',
    '      } else {',
    '        if (!easyMDE) { showMessage(\'post-message\', \'编辑器未初始化\', \'error\'); return; }',
    '        content = easyMDE.value();',
    '        if (!title || !content.trim()) {',
    '          showMessage(\'post-message\', \'标题和内容不能为空\', \'error\'); return;',
    '        }',
    '      }',
    '      const { ok, data } = await apiCall(\'/posts\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ title, content, format, category })',
    '      });',
    '      if (ok) {',
    '        showMessage(\'post-message\', \'发布成功！\', \'success\');',
    '        document.getElementById(\'post-title\').value = \'\';',
    '        document.getElementById(\'post-category\').value = \'其他\';',
    '        if (quill) quill.setText(\'\');',
    '        if (easyMDE) easyMDE.value(\'\');',
    '        setTimeout(() => {',
    '          closeModal(\'newpost-modal\');',
    '          loadAllPosts();',
    '          if (!document.getElementById(\'home-page\').classList.contains(\'hidden\')) loadAllPosts();',
    '          else loadUserPosts();',
    '        }, 1000);',
    '      } else {',
    '        showMessage(\'post-message\', data.error || \'发布失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function deletePost(postId) {',
    '      if (!confirm(\'确定删除这篇文章吗？\')) return;',
    '      const { ok, data } = await apiCall(\'/posts/delete\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ postId })',
    '      });',
    '      if (ok) {',
    '        alert(\'删除成功\');',
    '        loadAllPosts();',
    '        if (!document.getElementById(\'home-page\').classList.contains(\'hidden\')) loadAllPosts();',
    '        else loadUserPosts();',
    '      } else {',
    '        alert(data.error || \'删除失败\');',
    '      }',
    '    }',
    '',
    '    async function pinPost(postId, pin) {',
    '      const { ok, data } = await apiCall(\'/admin/post/pin\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ postId, pin })',
    '      });',
    '      if (ok) {',
    '        loadAllPosts();',
    '      } else {',
    '        alert(data.error || \'操作失败\');',
    '      }',
    '    }',
    '',
    '    function showPostDetail(post) {',
    '      currentDetailPostId = post.id;',
    '      currentDetailAuthorUsername = post.authorUsername;',
    '      document.getElementById(\'detail-id\').textContent = post.id;',
    '      document.getElementById(\'detail-category\').textContent = post.category || \'其他\';',
    '      const editBtnHtml = (currentUserRole === \'admin\' || currentUserRole === \'superadmin\') ?',
    '        `<button class="btn btn-sm btn-primary" onclick="showEditCategoryModal(\'${post.id}\', \'${post.category || \'其他\'}\')">修改分区</button>` : \'\';',
    '      document.getElementById(\'detail-category-edit\').innerHTML = editBtnHtml;',
    '      document.getElementById(\'detail-title\').textContent = post.title;',
    '      const roleHtml = getRoleBadgeHtml(post.authorRole);',
    '      const membershipHtml = getMembershipBadgeHtml(post.authorMembership);',
    '      const avatarHtml = post.authorAvatar ? `<img src="${post.authorAvatar}" style="width:24px;height:24px;border-radius:50%;">` : `<div class="author-avatar">${(post.authorDisplayName || \'?\').charAt(0)}</div>`;',
    '      document.getElementById(\'detail-avatar\').innerHTML = avatarHtml;',
    '      document.getElementById(\'detail-author-name\').textContent = post.authorDisplayName || post.author;',
    '      document.getElementById(\'detail-role-badge\').innerHTML = roleHtml;',
    '      document.getElementById(\'detail-membership-badge\').innerHTML = membershipHtml;',
    '      document.getElementById(\'detail-time\').textContent = `📅 ${new Date(post.createdAt).toLocaleString()}`;',
    '      document.getElementById(\'detail-report-btn\').classList.toggle(\'hidden\', currentUserRole === \'superadmin\' || currentUserRole === \'admin\');',
    '      let contentHtml = post.content;',
    '      if (post.format === \'markdown\') {',
    '        contentHtml = marked.parse(post.content);',
    '      }',
    '      document.getElementById(\'detail-content\').innerHTML = contentHtml;',
    '      document.getElementById(\'detail-received-coins\').textContent = post.receivedCoins || 0;',
    '      if (token && post.author !== currentUserEmail) {',
    '        document.getElementById(\'gift-coin-buttons\').style.display = \'block\';',
    '        updateTodayRemaining();',
    '      } else {',
    '        document.getElementById(\'gift-coin-buttons\').style.display = \'none\';',
    '      }',
    '      loadComments(post.id);',
    '      showModal(\'post-detail-modal\');',
    '    }',
    '',
    '    async function submitCategoryEdit() {',
    '      const newCategory = document.getElementById(\'edit-category-select\').value;',
    '      const { ok, data } = await apiCall(\'/admin/post/category\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ postId: currentEditCategoryPostId, category: newCategory })',
    '      });',
    '      if (ok) {',
    '        alert(\'分区修改成功\');',
    '        closeModal(\'edit-category-modal\');',
    '        loadAllPosts();',
    '        if (currentDetailPostId === currentEditCategoryPostId) {',
    '          document.getElementById(\'detail-category\').textContent = newCategory;',
    '        }',
    '      } else {',
    '        showMessage(\'edit-category-message\', data.error || \'修改失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function loadComments(postId) {',
    '      const res = await fetch(`/api/comments?postId=${postId}`);',
    '      if (res.ok) {',
    '        const data = await res.json();',
    '        const comments = data.comments || [];',
    '        document.getElementById(\'comment-count\').textContent = comments.length;',
    '        let html = \'\';',
    '        comments.forEach(c => {',
    '          const avatarHtml = c.authorAvatar ? `<img src="${c.authorAvatar}" style="width:32px;height:32px;border-radius:50%;">` : `<div class="comment-avatar">${c.authorDisplayName.charAt(0)}</div>`;',
    '          const membershipHtml = getMembershipBadgeHtml(c.authorMembership);',
    '          html += `',
    '            <div class="comment-item">',
    '              <div class="comment-avatar" onclick="goToUserProfile(\'${c.authorUsername}\')">${avatarHtml}</div>',
    '              <div class="comment-content">',
    '                <span class="comment-author" onclick="goToUserProfile(\'${c.authorUsername}\')">${c.authorDisplayName} ${membershipHtml}</span>',
    '                <span class="comment-time">${new Date(c.createdAt).toLocaleString()}</span>',
    '                <div class="comment-text">${c.content}</div>',
    '              </div>',
    '            </div>',
    '          `;',
    '        });',
    '        document.getElementById(\'comments-list\').innerHTML = html || \'<p>暂无评论</p>\';',
    '      }',
    '    }',
    '',
    '    async function submitComment() {',
    '      const content = document.getElementById(\'comment-input\').value.trim();',
    '      if (!content) return alert(\'评论不能为空\');',
    '      if (!currentDetailPostId) return;',
    '      const { ok, data } = await apiCall(\'/comments\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ postId: currentDetailPostId, content })',
    '      });',
    '      if (ok) {',
    '        document.getElementById(\'comment-input\').value = \'\';',
    '        loadComments(currentDetailPostId);',
    '      } else {',
    '        alert(data.error || \'评论失败\');',
    '      }',
    '    }',
    '',
    '    function uploadAvatar() {',
    '      document.getElementById(\'avatar-input\').click();',
    '    }',
    '',
    '    async function handleAvatarFile() {',
    '      const file = document.getElementById(\'avatar-input\').files[0];',
    '      if (!file) return;',
    '      if (file.size > 500 * 1024) {',
    '        alert(\'头像大小不能超过500KB\');',
    '        return;',
    '      }',
    '      const reader = new FileReader();',
    '      reader.onload = async (e) => {',
    '        const base64 = e.target.result;',
    '        const { ok, data } = await apiCall(\'/user/avatar\', {',
    '          method: \'POST\',',
    '          body: JSON.stringify({ avatar: base64 })',
    '        });',
    '        if (ok) {',
    '          alert(\'头像上传成功\');',
    '          document.getElementById(\'avatar-preview\').innerHTML = `<img src="${base64}" alt="avatar">`;',
    '        } else {',
    '          alert(data.error || \'上传失败\');',
    '        }',
    '      };',
    '      reader.readAsDataURL(file);',
    '    }',
    '',
    '    async function updateDisplayName() {',
    '      const displayName = document.getElementById(\'profile-displayname\').value.trim();',
    '      if (!displayName) { alert(\'显示名称不能为空\'); return; }',
    '      const { ok, data } = await apiCall(\'/user/update-displayname\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ displayName })',
    '      });',
    '      if (ok) {',
    '        alert(\'显示名称更新成功\');',
    '        showProfile();',
    '      } else {',
    '        alert(data.error || \'更新失败\');',
    '      }',
    '    }',
    '',
    '    async function changePassword() {',
    '      const oldPassword = document.getElementById(\'old-password\').value;',
    '      const newPassword = document.getElementById(\'new-password\').value;',
    '      const confirmPassword = document.getElementById(\'confirm-password\').value;',
    '      if (!oldPassword || !newPassword || !confirmPassword) {',
    '        showMessage(\'change-password-message\', \'请填写所有字段\', \'error\');',
    '        return;',
    '      }',
    '      if (newPassword !== confirmPassword) {',
    '        showMessage(\'change-password-message\', \'两次新密码不一致\', \'error\');',
    '        return;',
    '      }',
    '      const { ok, data } = await apiCall(\'/user/change-password\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ oldPassword, newPassword, confirmPassword })',
    '      });',
    '      if (ok) {',
    '        alert(\'密码修改成功\');',
    '        closeModal(\'change-password-modal\');',
    '      } else {',
    '        showMessage(\'change-password-message\', data.error || \'修改失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function signup() {',
    '      const username = document.getElementById(\'signup-username\').value.trim();',
    '      const email = document.getElementById(\'signup-email\').value.trim();',
    '      const password = document.getElementById(\'signup-password\').value;',
    '      const confirm = document.getElementById(\'signup-confirm\').value;',
    '      const captcha = document.getElementById(\'signup-captcha\').value.trim();',
    '      ',
    '      if (!username || !email || !password || !confirm || !captcha) {',
    '        showMessage(\'signup-message\', \'请填写所有字段\', \'error\');',
    '        return;',
    '      }',
    '      if (password !== confirm) {',
    '        showMessage(\'signup-message\', \'两次密码不一致\', \'error\');',
    '        return;',
    '      }',
    '      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {',
    '        showMessage(\'signup-message\', \'用户名须为3-20位字母、数字或下划线\', \'error\');',
    '        return;',
    '      }',
    '      ',
    '      const { ok, data } = await apiCall(\'/signup\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ username, email, password, confirmPassword: confirm, captcha })',
    '      });',
    '      ',
    '      if (ok && data.token) {',
    '        token = data.token;',
    '        localStorage.setItem(\'token\', token);',
    '        currentUserRole = data.role;',
    '        closeModal(\'signup-modal\');',
    '        updateUI();',
    '        loadAllPosts();',
    '        checkAnnouncement();',
    '      } else {',
    '        showMessage(\'signup-message\', data.error || \'注册失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    function logout() {',
    '      token = null;',
    '      localStorage.removeItem(\'token\');',
    '      currentUserRole = null;',
    '      updateUI();',
    '      loadAllPosts();',
    '      showHome();',
    '      document.getElementById(\'coin-badge-nav\').style.display = \'none\';',
    '      document.getElementById(\'level-badge-nav\').style.display = \'none\';',
    '    }',
    '',
    '    async function loadUsers() {',
    '      const container = document.getElementById(\'user-list\');',
    '      container.innerHTML = \'加载中...\';',
    '      const { ok, data } = await apiCall(\'/admin/users\');',
    '      if (ok && data.users) {',
    '        const requesterRole = data.requesterRole;',
    '        const isSuper = requesterRole === \'superadmin\';',
    '        let html = \'\';',
    '        data.users.forEach(user => {',
    '          const roleHtml = getRoleBadgeHtml(user.role);',
    '          const membershipHtml = getMembershipBadgeHtml(user.membership || \'none\');',
    '          html += `',
    '            <div class="user-item">',
    '              <div>',
    '                <strong>${user.displayName || user.username}</strong> ${roleHtml} ${membershipHtml}<br>',
    '                <small>用户名: ${user.username}</small><br>',
    '                <small>邮箱: ${user.email}</small><br>',
    '                <small>注册: ${new Date(user.createdAt).toLocaleDateString()}</small><br>',
    '                <small>等级: ${user.level || 1} | 🪙 ${user.coins || 0}</small>',
    '                ${user.deleteRequested ? \'<span class="badge badge-warning">注销申请中</span>\' : \'\'}',
    '              </div>',
    '              <div>',
    '                ${user.email !== data.currentUserEmail ? `',
    '                  <button class="btn btn-danger" onclick="adminDeleteUser(\'${user.email}\')">删除用户</button>',
    '                  <button class="btn btn-primary" onclick="showResetPasswordModal(\'${user.email}\')">修改密码</button>',
    '                ` : \'\'}',
    '                ${requesterRole === \'superadmin\' && user.email !== data.currentUserEmail ? `',
    '                  <button class="btn btn-warning" onclick="showSetRoleModal(\'${user.email}\', \'${user.role}\')">设置角色</button>',
    '                ` : \'\'}',
    '                ${isSuper ? `',
    '                  <button class="btn btn-info" onclick="showSetCoinsModal(\'${user.email}\', ${user.coins || 0})">修改余额</button>',
    '                  <button class="btn btn-primary" onclick="showSetMembershipModal(\'${user.email}\', \'${user.membership || \'none\'}\')">设置会员</button>',
    '                ` : \'\'}',
    '                ${user.deleteRequested && (requesterRole === \'admin\' || requesterRole === \'superadmin\') ? `',
    '                  <button class="btn btn-success" onclick="approveDelete(\'${user.email}\', true)">批准注销</button>',
    '                  <button class="btn" onclick="approveDelete(\'${user.email}\', false)">拒绝注销</button>',
    '                ` : \'\'}',
    '              </div>',
    '            </div>',
    '          `;',
    '        });',
    '        container.innerHTML = html;',
    '      } else {',
    '        container.innerHTML = \'加载失败\';',
    '      }',
    '    }',
    '',
    '    async function adminDeleteUser(targetEmail) {',
    '      if (!confirm(`确定要删除用户 ${targetEmail} 吗？此操作不可撤销。`)) return;',
    '      const { ok, data } = await apiCall(\'/admin/user/delete\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ targetEmail })',
    '      });',
    '      if (ok) {',
    '        alert(\'用户已删除\');',
    '        loadUsers();',
    '      } else {',
    '        alert(data.error || \'删除失败\');',
    '      }',
    '    }',
    '',
    '    async function adminResetPassword() {',
    '      const newPassword = document.getElementById(\'reset-new-password\').value;',
    '      if (!newPassword) {',
    '        showMessage(\'reset-message\', \'请输入新密码\', \'error\');',
    '        return;',
    '      }',
    '      const { ok, data } = await apiCall(\'/admin/reset-password\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ targetEmail: currentResetEmail, newPassword })',
    '      });',
    '      if (ok) {',
    '        alert(\'密码修改成功\');',
    '        closeModal(\'reset-password-modal\');',
    '        loadUsers();',
    '      } else {',
    '        showMessage(\'reset-message\', data.error || \'修改失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function adminSetRole() {',
    '      const newRole = document.getElementById(\'set-role-select\').value;',
    '      const { ok, data } = await apiCall(\'/admin/set-role\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ targetEmail: currentSetRoleEmail, newRole })',
    '      });',
    '      if (ok) {',
    '        alert(\'角色设置成功\');',
    '        closeModal(\'set-role-modal\');',
    '        loadUsers();',
    '      } else {',
    '        showMessage(\'set-role-message\', data.error || \'设置失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function approveDelete(targetEmail, approve) {',
    '      const action = approve ? \'批准\' : \'拒绝\';',
    '      if (!confirm(`确定${action}用户 ${targetEmail} 的注销申请吗？`)) return;',
    '      const { ok, data } = await apiCall(\'/admin/approve-delete\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ targetEmail, approve })',
    '      });',
    '      if (ok) {',
    '        alert(`申请已${action}`);',
    '        loadUsers();',
    '      } else {',
    '        alert(data.error || \'操作失败\');',
    '      }',
    '    }',
    '',
    '    async function submitDeleteRequest() {',
    '      const password = document.getElementById(\'delete-password\').value;',
    '      if (!password) {',
    '        showMessage(\'delete-request-message\', \'请输入密码\', \'error\');',
    '        return;',
    '      }',
    '      const { ok, data } = await apiCall(\'/user/request-delete\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ password })',
    '      });',
    '      if (ok) {',
    '        alert(\'注销申请已提交，等待管理员审核\');',
    '        closeModal(\'delete-request-modal\');',
    '        showProfile();',
    '      } else {',
    '        showMessage(\'delete-request-message\', data.error || \'提交失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function submitFeedback() {',
    '      const content = document.getElementById(\'feedback-content\').value.trim();',
    '      if (!content) {',
    '        showMessage(\'feedback-message\', \'反馈内容不能为空\', \'error\');',
    '        return;',
    '      }',
    '      const { ok, data } = await apiCall(\'/feedback\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ content })',
    '      });',
    '      if (ok) {',
    '        alert(\'反馈已提交，感谢您的建议！\');',
    '        closeModal(\'feedback-modal\');',
    '        if (currentUserRole === \'superadmin\') {',
    '          checkAdminNotifications();',
    '        }',
    '      } else {',
    '        showMessage(\'feedback-message\', data.error || \'提交失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function loadAdminFeedback() {',
    '      const container = document.getElementById(\'admin-feedback-list\');',
    '      container.innerHTML = \'加载中...\';',
    '      const { ok, data } = await apiCall(\'/admin/feedback\');',
    '      if (ok && data.feedbacks) {',
    '        let html = \'\';',
    '        data.feedbacks.forEach(fb => {',
    '          const unreadClass = fb.read ? \'\' : \'unread\';',
    '          const statusClass = `status-${fb.status}`;',
    '          html += `',
    '            <div class="feedback-item ${unreadClass}">',
    '              <div class="feedback-content">',
    '                <strong>${fb.authorDisplayName}</strong> (${fb.author})<br>',
    '                <span>${fb.content}</span>',
    '                <div class="feedback-meta">${new Date(fb.createdAt).toLocaleString()}</div>',
    '                ${fb.adminReply ? `<div>管理员回复：${fb.adminReply}</div>` : \'\'}',
    '              </div>',
    '              <div>',
    '                <span class="status-badge ${statusClass}">${fb.status}</span>',
    '                <button class="btn btn-sm btn-success" onclick="markFeedbackRead(\'${fb.id}\')" ${fb.read ? \'disabled\' : \'\'}>标记已读</button>',
    '                <button class="btn btn-sm btn-primary" onclick="showReplyFeedback(\'${fb.id}\', \'${fb.authorDisplayName}\')">回复</button>',
    '                <button class="btn btn-sm btn-danger" onclick="deleteFeedback(\'${fb.id}\')">删除</button>',
    '              </div>',
    '            </div>',
    '          `;',
    '        });',
    '        container.innerHTML = html || \'<p>暂无反馈</p>\';',
    '      } else {',
    '        container.innerHTML = \'加载失败\';',
    '      }',
    '    }',
    '',
    '    async function markFeedbackRead(feedbackId) {',
    '      const { ok } = await apiCall(\'/admin/feedback/mark-read\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ feedbackId })',
    '      });',
    '      if (ok) {',
    '        loadAdminFeedback();',
    '        checkAdminNotifications();',
    '      }',
    '    }',
    '',
    '    async function submitFeedbackReply() {',
    '      const reply = document.getElementById(\'reply-content\').value.trim();',
    '      if (!reply) return alert(\'回复内容不能为空\');',
    '      const { ok } = await apiCall(\'/admin/feedback/update\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ feedbackId: currentFeedbackId, adminReply: reply, status: \'resolved\' })',
    '      });',
    '      if (ok) {',
    '        closeModal(\'reply-feedback-modal\');',
    '        loadAdminFeedback();',
    '        checkAdminNotifications();',
    '      }',
    '    }',
    '',
    '    async function deleteFeedback(feedbackId) {',
    '      if (!confirm(\'确定删除此反馈吗？\')) return;',
    '      const { ok } = await apiCall(\'/admin/feedback/delete\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ feedbackId })',
    '      });',
    '      if (ok) {',
    '        loadAdminFeedback();',
    '        checkAdminNotifications();',
    '      }',
    '    }',
    '',
    '    async function submitReport() {',
    '      const reason = document.getElementById(\'report-reason\').value;',
    '      const detail = document.getElementById(\'report-detail\').value.trim();',
    '      const finalReason = detail ? `${reason}: ${detail}` : reason;',
    '      const { ok, data } = await apiCall(\'/report\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ postId: currentReportPostId, reason: finalReason })',
    '      });',
    '      if (ok) {',
    '        alert(\'举报已提交，感谢您的反馈\');',
    '        closeModal(\'report-modal\');',
    '        if (currentUserRole === \'superadmin\') {',
    '          checkAdminNotifications();',
    '        }',
    '      } else {',
    '        alert(data.error || \'提交失败\');',
    '      }',
    '    }',
    '',
    '    async function loadReports() {',
    '      const container = document.getElementById(\'reports-list\');',
    '      container.innerHTML = \'加载中...\';',
    '      const { ok, data } = await apiCall(\'/admin/reports\');',
    '      if (ok && data.reports) {',
    '        let html = \'\';',
    '        data.reports.forEach(r => {',
    '          const statusClass = `status-${r.status}`;',
    '          html += `',
    '            <div class="report-item">',
    '              <div class="report-content">',
    '                <strong>举报人：${r.reporterDisplayName}</strong><br>',
    '                <span>文章ID：${r.postId}</span><br>',
    '                <span>原因：${r.reason}</span><br>',
    '                <div class="report-meta">${new Date(r.createdAt).toLocaleString()}</div>',
    '                ${r.adminNote ? `<div>备注：${r.adminNote}</div>` : \'\'}',
    '              </div>',
    '              <div>',
    '                <span class="status-badge ${statusClass}">${r.status}</span>',
    '                <button class="btn btn-sm btn-primary" onclick="showProcessReport(\'${r.id}\', \'${r.postId}\')">处理</button>',
    '              </div>',
    '            </div>',
    '          `;',
    '        });',
    '        container.innerHTML = html || \'<p>暂无举报</p>\';',
    '      } else {',
    '        container.innerHTML = \'加载失败\';',
    '      }',
    '    }',
    '',
    '    document.getElementById(\'process-action\').addEventListener(\'change\', function(e) {',
    '      if (e.target.value === \'ban\') {',
    '        document.getElementById(\'ban-days-input\').style.display = \'block\';',
    '      } else {',
    '        document.getElementById(\'ban-days-input\').style.display = \'none\';',
    '      }',
    '    });',
    '',
    '    async function processReport() {',
    '      const action = document.getElementById(\'process-action\').value;',
    '      const note = document.getElementById(\'process-note\').value.trim();',
    '      const banDays = action === \'ban\' ? parseInt(document.getElementById(\'ban-days\').value) : null;',
    '      const { ok, data } = await apiCall(\'/admin/report/process\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ reportId: currentReportId, action, banDays, adminNote: note })',
    '      });',
    '      if (ok) {',
    '        alert(\'处理成功\');',
    '        closeModal(\'process-report-modal\');',
    '        loadReports();',
    '        checkAdminNotifications();',
    '      } else {',
    '        alert(data.error || \'处理失败\');',
    '      }',
    '    }',
    '',
    '    async function setAnnouncement() {',
    '      const title = document.getElementById(\'announcement-title-input\').value.trim();',
    '      const content = document.getElementById(\'announcement-content-input\').value.trim();',
    '      const type = document.querySelector(\'input[name="announcement-type"]:checked\').value;',
    '      if (!title || !content) {',
    '        showMessage(\'announcement-message\', \'标题和内容不能为空\', \'error\');',
    '        return;',
    '      }',
    '      const { ok, data } = await apiCall(\'/announcement\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ title, content, type })',
    '      });',
    '      if (ok) {',
    '        showMessage(\'announcement-message\', \'公告发布成功！\', \'success\');',
    '        document.getElementById(\'announcement-title-input\').value = \'\';',
    '        document.getElementById(\'announcement-content-input\').value = \'\';',
    '      } else {',
    '        showMessage(\'announcement-message\', data.error || \'发布失败\', \'error\');',
    '      }',
    '    }',
    '',
    '    async function checkAnnouncement() {',
    '      try {',
    '        const res = await fetch(\'/api/announcement\');',
    '        if (res.ok) {',
    '          const data = await res.json();',
    '          if (data.exists && data.id) {',
    '            const userRead = currentUserReadAnnouncements.includes(data.id);',
    '            if (!userRead) {',
    '              const banner = document.getElementById(\'announcement-banner\');',
    '              document.getElementById(\'announcement-title\').textContent = data.title;',
    '              document.getElementById(\'announcement-text\').innerHTML = data.content;',
    '              if (data.type === \'mandatory\') {',
    '                banner.classList.add(\'mandatory\');',
    '              } else {',
    '                banner.classList.remove(\'mandatory\');',
    '              }',
    '              banner.classList.remove(\'hidden\');',
    '              currentAnnouncementId = data.id;',
    '            }',
    '          }',
    '        }',
    '      } catch (e) {',
    '        console.error(\'检查公告失败\', e);',
    '      }',
    '    }',
    '',
    '    async function markAnnouncementRead() {',
    '      if (!currentAnnouncementId) return;',
    '      const { ok } = await apiCall(\'/announcement/read\', {',
    '        method: \'POST\',',
    '        body: JSON.stringify({ announcementId: currentAnnouncementId })',
    '      });',
    '      if (ok) {',
    '        closeAnnouncement();',
    '        currentUserReadAnnouncements.push(currentAnnouncementId);',
    '      } else {',
    '        alert(\'标记已读失败，请稍后重试\');',
    '      }',
    '    }',
    '',
    '    function closeAnnouncement() {',
    '      document.getElementById(\'announcement-banner\').classList.add(\'hidden\');',
    '      if (currentAnnouncementId) {',
    '        markAnnouncementRead();',
    '      }',
    '    }',
    '',
    '    function updateUI() {',
    '      const loginBtn = document.getElementById(\'login-btn\');',
    '      const signupBtn = document.getElementById(\'signup-btn\');',
    '      const logoutBtn = document.getElementById(\'logout-btn\');',
    '      const newPostBtn = document.getElementById(\'new-post-btn\');',
    '      const profileBtn = document.getElementById(\'profile-btn\');',
    '      const adminBtn = document.getElementById(\'admin-btn\');',
    '      const feedbackBtn = document.getElementById(\'feedback-btn\');',
    '      const roleBadgeNav = document.getElementById(\'role-badge-nav\');',
    '      if (token && currentUserRole) {',
    '        loginBtn.classList.add(\'hidden\');',
    '        signupBtn.classList.add(\'hidden\');',
    '        logoutBtn.classList.remove(\'hidden\');',
    '        newPostBtn.classList.remove(\'hidden\');',
    '        profileBtn.classList.remove(\'hidden\');',
    '        feedbackBtn.classList.remove(\'hidden\');',
    '        if (currentUserRole === \'superadmin\' || currentUserRole === \'admin\') {',
    '          adminBtn.classList.remove(\'hidden\');',
    '        } else {',
    '          adminBtn.classList.add(\'hidden\');',
    '        }',
    '        roleBadgeNav.style.display = \'inline-block\';',
    '        roleBadgeNav.innerHTML = getRoleBadgeHtml(currentUserRole);',
    '      } else {',
    '        loginBtn.classList.remove(\'hidden\');',
    '        signupBtn.classList.remove(\'hidden\');',
    '        logoutBtn.classList.add(\'hidden\');',
    '        newPostBtn.classList.add(\'hidden\');',
    '        profileBtn.classList.add(\'hidden\');',
    '        adminBtn.classList.add(\'hidden\');',
    '        feedbackBtn.classList.add(\'hidden\');',
    '        roleBadgeNav.style.display = \'none\';',
    '      }',
    '    }',
    '',
    '    function switchEditor(mode) {',
    '      currentEditorMode = mode;',
    '      const quillContainer = document.getElementById(\'quill-editor\');',
    '      const markdownContainer = document.getElementById(\'markdown-editor\');',
    '      if (mode === \'richtext\') {',
    '        quillContainer.classList.remove(\'hidden-editor\');',
    '        markdownContainer.classList.add(\'hidden-editor\');',
    '        if (!quill) {',
    '          quill = new Quill(\'#quill-editor\', {',
    '            theme: \'snow\',',
    '            placeholder: \'写点什么...\',',
    '            modules: {',
    '              toolbar: [',
    '                [\'bold\', \'italic\', \'underline\', \'strike\'],',
    '                [\'blockquote\', \'code-block\'],',
    '                [{ \'header\': 1 }, { \'header\': 2 }],',
    '                [{ \'list\': \'ordered\' }, { \'list\': \'bullet\' }],',
    '                [\'link\', \'image\']',
    '              ]',
    '            }',
    '          });',
    '          const toolbar = quill.getModule(\'toolbar\');',
    '          toolbar.addHandler(\'image\', () => {',
    '            const input = document.createElement(\'input\');',
    '            input.setAttribute(\'type\', \'file\');',
    '            input.setAttribute(\'accept\', \'image/*\');',
    '            input.click();',
    '            input.onchange = async () => {',
    '              const file = input.files[0];',
    '              if (file) {',
    '                if (file.size > 10 * 1024 * 1024) {',
    '                  alert(\'文件过大（超过10MB），可能无法保存\');',
    '                }',
    '                const reader = new FileReader();',
    '                reader.onload = (e) => {',
    '                  const base64 = e.target.result;',
    '                  const range = quill.getSelection();',
    '                  quill.insertEmbed(range.index, \'image\', base64);',
    '                };',
    '                reader.readAsDataURL(file);',
    '              }',
    '            };',
    '          });',
    '        }',
    '      } else {',
    '        quillContainer.classList.add(\'hidden-editor\');',
    '        markdownContainer.classList.remove(\'hidden-editor\');',
    '        if (!easyMDE) {',
    '          easyMDE = new EasyMDE({',
    '            element: document.getElementById(\'markdown-textarea\'),',
    '            spellChecker: false,',
    '            autosave: { enabled: true, uniqueId: \'blog-post\', delay: 1000 },',
    '            toolbar: [\'bold\', \'italic\', \'heading\', \'|\', \'quote\', \'unordered-list\', \'ordered-list\', \'|\', \'link\', \'image\', \'|\', \'preview\', \'side-by-side\', \'fullscreen\', \'|\', \'guide\']',
    '          });',
    '        } else {',
    '          easyMDE.value(\'\');',
    '        }',
    '      }',
    '    }',
    '',
    '    (async function() {',
    '      await initUser();',
    '      updateUI();',
    '      loadAllPosts();',
    '      setTimeout(checkAnnouncement, 500);',
    '    })();',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};