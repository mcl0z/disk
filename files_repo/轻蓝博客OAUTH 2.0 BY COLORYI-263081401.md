OAuth 客户端搭建教程
本文档将指导您如何创建一个第三方应用（OAuth 客户端），使用 Coloryi 博客的 OAuth 2.0 服务进行用户登录，并获取用户的博客文章。

1. 了解 OAuth 流程
Coloryi 博客实现了标准的 授权码模式（Authorization Code Grant），流程如下：

客户端将用户重定向到博客的授权端点。

用户登录并授权应用访问其数据。

博客将用户重定向回客户端，并附带一个授权码（code）。

客户端使用授权码、客户端 ID 和客户端密钥向博客的令牌端点换取访问令牌（access_token）和刷新令牌（refresh_token）。

客户端使用访问令牌调用博客的 API（如获取用户文章）。

2. 在博客后台创建 OAuth 客户端
首先，您需要拥有博客的 超级管理员 权限，才能创建 OAuth 客户端。

登录博客，进入 个人中心，点击 管理（或直接访问 /admin 页面）。

在管理面板中，点击 🔑 OAuth应用 标签页。

点击 创建新客户端 按钮。

填写表单：

应用名称：您的应用名称，如 “我的小工具”。

重定向 URI：您的应用中用于接收授权码的 URL。每行一个，例如 http://localhost:3000/callback（开发环境）和 https://yourapp.com/callback（生产环境）。必须与您实际使用的回调地址完全匹配。

权限范围：默认 profile 即可获取用户基本信息。如果需要获取用户文章，保持 profile 即可（目前文章接口与 profile 范围绑定）。

机密客户端：通常保持勾选，表示您的应用可以安全保存 client_secret（适用于后端应用）。如果是纯前端应用（如 SPA），可以取消勾选，但需要注意安全性。

点击 创建，系统会生成 Client ID 和 Client Secret。请立即保存 Client Secret，关闭弹窗后将无法再次查看。

3. 客户端应用开发示例
下面以 Node.js + Express 为例，展示如何实现 OAuth 客户端。您也可以使用其他语言或框架，核心步骤相同。

3.1 环境准备
确保您的开发环境已安装 Node.js，并新建一个项目：

bash
mkdir my-oauth-client
cd my-oauth-client
npm init -y
npm install express axios dotenv
创建 .env 文件保存敏感信息：

text
CLIENT_ID=your_client_id_here
CLIENT_SECRET=your_client_secret_here
REDIRECT_URI=http://localhost:3000/callback
BLOG_AUTH_URL=https://blog.coloryi.top/oauth/authorize
BLOG_TOKEN_URL=https://blog.coloryi.top/oauth/token
BLOG_API_BASE=https://blog.coloryi.top/api
SESSION_SECRET=random_string_for_session
3.2 实现授权跳转
创建 index.js，实现一个简单的 Express 服务器，处理两个路由：/login 用于发起授权，/callback 用于接收授权码。

javascript
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');

const app = express();

// 使用 session 存储用户状态（简化示例，生产环境建议使用数据库）
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // 开发环境设为 false，生产环境需启用 HTTPS 并设为 true
}));

// 主页
app.get('/', (req, res) => {
  if (req.session.user) {
    res.send(`欢迎回来，${req.session.user.displayName}！<br><a href="/posts">查看我的文章</a> | <a href="/logout">登出</a>`);
  } else {
    res.send('<a href="/login">使用博客账号登录</a>');
  }
});

// 发起登录
app.get('/login', (req, res) => {
  const state = Math.random().toString(36).substring(7); // 简单生成随机 state，防止 CSRF
  req.session.oauthState = state;
  const authUrl = `${process.env.BLOG_AUTH_URL}?` +
    `client_id=${encodeURIComponent(process.env.CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=profile` +
    `&state=${encodeURIComponent(state)}`;
  res.redirect(authUrl);
});

// 回调地址，接收授权码
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // 检查错误
  if (error) {
    return res.status(400).send(`授权失败：${error}`);
  }

  // 验证 state 防止 CSRF
  if (state !== req.session.oauthState) {
    return res.status(400).send('state 不匹配，可能遭受 CSRF 攻击');
  }

  if (!code) {
    return res.status(400).send('缺少授权码');
  }

  try {
    // 用授权码换取访问令牌
    const tokenRes = await axios.post(process.env.BLOG_TOKEN_URL, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.REDIRECT_URI,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const { access_token, refresh_token, expires_in, scope } = tokenRes.data;

    // 保存令牌到 session（生产环境应考虑加密存储）
    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;
    req.session.tokenExpires = Date.now() + expires_in * 1000;

    // 可选：立即获取用户基本信息
    const userRes = await axios.get(`${process.env.BLOG_API_BASE}/user/info`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    req.session.user = userRes.data;

    res.redirect('/');
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('令牌交换失败：' + (err.response?.data?.error || err.message));
  }
});

// 登出
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.listen(3000, () => {
  console.log('客户端应用运行在 http://localhost:3000');
});
3.3 调用 API 获取用户文章
添加一个 /posts 路由，使用访问令牌获取当前用户的文章。

javascript
app.get('/posts', async (req, res) => {
  if (!req.session.accessToken) {
    return res.redirect('/login');
  }

  // 检查令牌是否过期，若过期则使用刷新令牌（此处简化，未实现自动刷新）
  if (Date.now() > req.session.tokenExpires) {
    // 实际应用中应实现刷新令牌逻辑，此处简单返回提示
    return res.send('访问令牌已过期，请重新登录。 <a href="/login">重新登录</a>');
  }

  try {
    const postsRes = await axios.get(`${process.env.BLOG_API_BASE}/user/posts`, {
      headers: { Authorization: `Bearer ${req.session.accessToken}` }
    });
    const posts = postsRes.data.posts || [];
    let html = '<h2>我的文章</h2><ul>';
    posts.forEach(post => {
      html += `<li><a href="https://blog.coloryi.top/?post=${post.id}" target="_blank">${post.title}</a> (${post.category})</li>`;
    });
    html += '</ul><a href="/">返回首页</a>';
    res.send(html);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('获取文章失败：' + (err.response?.data?.error || err.message));
  }
});
3.4 刷新令牌处理（可选）
在令牌过期时，可以使用刷新令牌获取新的访问令牌。在 /callback 中我们保存了 refresh_token，可以添加一个中间件自动刷新。

javascript
// 刷新令牌函数
async function refreshAccessToken(refreshToken) {
  try {
    const res = await axios.post(process.env.BLOG_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return res.data; // 包含新的 access_token, refresh_token, expires_in
  } catch (err) {
    throw new Error('刷新令牌失败：' + (err.response?.data?.error || err.message));
  }
}

// 在需要令牌的路由中，可以封装一个中间件自动刷新
async function ensureValidToken(req, res, next) {
  if (!req.session.accessToken) {
    return res.redirect('/login');
  }
  if (Date.now() > req.session.tokenExpires - 60000) { // 提前1分钟过期时刷新
    try {
      const newTokens = await refreshAccessToken(req.session.refreshToken);
      req.session.accessToken = newTokens.access_token;
      req.session.refreshToken = newTokens.refresh_token;
      req.session.tokenExpires = Date.now() + newTokens.expires_in * 1000;
    } catch (err) {
      return res.redirect('/login'); // 刷新失败，重新登录
    }
  }
  next();
}

// 使用中间件保护 /posts 路由
app.get('/posts', ensureValidToken, async (req, res) => {
  // ... 获取文章代码
});
4. 部署注意事项
重定向 URI 必须精确匹配：博客服务端会验证 redirect_uri，必须与创建客户端时填写的完全一致（包括协议、域名、路径、端口）。

使用 HTTPS：生产环境中，回调地址必须使用 HTTPS，并且客户端密钥应安全存储（如环境变量、密钥管理服务）。

防止 CSRF：必须验证 state 参数，推荐使用强随机字符串并绑定用户会话。

令牌存储：访问令牌和刷新令牌应安全存储，避免泄露。Web 应用可存储在服务器端会话中；纯前端应用（如 SPA）需考虑使用 PKCE 增强安全性（本教程未涉及，但博客服务端也支持 PKCE，可自行扩展）。

5. 常见问题
Q: 获取令牌时返回 invalid_client？
A: 检查客户端 ID 和密钥是否正确，以及客户端是否为机密类型（需要 client_secret）。

Q: 回调地址返回 invalid_redirect_uri？
A: 确认回调地址与创建客户端时填写的一致（包括结尾斜杠等细微差别）。

Q: 获取用户信息或文章时返回 401？
A: 可能访问令牌已过期或无效。尝试重新登录或实现刷新令牌逻辑。

Q: 如何获取用户的其他信息？
A: 当前博客 API 支持 /api/user/info 获取基本信息，/api/user/posts 获取文章。如需更多权限，可在创建客户端时申请其他 scope（需服务端支持）。

通过以上步骤，您已成功搭建一个 OAuth 客户端应用，能够使用 Coloryi 博客的账号登录并获取用户的文章。您可以根据需要扩展功能，例如展示用户资料、发表评论等（需查看博客 API 文档）。