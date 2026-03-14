📘 OAuth 客户端接入指南（第三方应用）
1. 注册客户端
在开始开发前，需要先在博客后台申请一个客户端。目前只有 超级管理员 可以通过管理面板创建 OAuth 客户端（路径：/api/admin/oauth/clients）。
创建后你会得到：

client_id（客户端 ID）

client_secret（客户端密钥，仅显示一次，请妥善保存）

同时需要提供至少一个 重定向 URI（例如 https://yourapp.com/callback），授权成功后将跳转到此地址。

2. OAuth 端点信息
授权端点：https://你的博客域名/oauth/authorize

令牌端点：https://你的博客域名/oauth/token

用户信息端点：https://你的博客域名/oauth/userinfo（需确保博客已实现该接口，或可使用 /api/user/info 通过 access token 获取）

3. 授权流程（Authorization Code Grant）
① 引导用户跳转到授权页面
构造以下 URL，重定向用户：

text
https://你的博客域名/oauth/authorize?
  response_type=code&
  client_id=YOUR_CLIENT_ID&
  redirect_uri=YOUR_REDIRECT_URI&
  scope=profile&
  state=随机字符串（防CSRF）
scope：可选，默认为 profile，可申请其他权限（由服务端决定）。

state：建议携带并验证，防止 CSRF。

② 用户授权后，服务端会重定向回你的 redirect_uri，并附上 code 和 state 参数
text
https://yourapp.com/callback?code=AUTH_CODE&state=YOUR_STATE
请验证 state 是否一致。

③ 用 code 交换 access_token
在后端发起 POST 请求到令牌端点：

text
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=收到的授权码
&redirect_uri=你的重定向URI（必须与第一步一致）
&client_id=你的客户端ID
&client_secret=你的客户端密钥（仅机密客户端需要）
响应示例：

json
{
  "access_token": "xxxx",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "yyyy",
  "scope": "profile"
}
④ 使用 access_token 获取用户信息
携带 access_token 请求用户信息端点：

text
GET /oauth/userinfo
Authorization: Bearer xxxx
响应示例：

json
{
  "sub": "用户唯一标识（如邮箱）",
  "name": "显示名称",
  "email": "邮箱",
  "picture": "头像URL"
}
如果你的博客未实现 /oauth/userinfo，也可以使用 /api/user/info 端点，但注意该端点返回的是博客内部用户结构，可能包含更多字段。使用方式相同：Authorization: Bearer xxx。

⑤ 刷新令牌（可选）
当 access_token 过期时，可以使用 refresh_token 获取新的令牌：

text
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=你的refresh_token
&client_id=你的客户端ID
&client_secret=你的客户端密钥（仅机密客户端需要）
&scope=可选，可缩小权限范围
4. 示例代码（JavaScript + Node.js）
以下是一个简单的 Node.js 示例，使用 express 和 axios：

javascript
const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
const crypto = require('crypto');

const app = express();
const config = {
  clientId: '你的client_id',
  clientSecret: '你的client_secret',
  redirectUri: 'https://yourapp.com/callback',
  authUrl: 'https://你的博客域名/oauth/authorize',
  tokenUrl: 'https://你的博客域名/oauth/token',
  userInfoUrl: 'https://你的博客域名/oauth/userinfo',
};

// 生成随机 state
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// 保存 state 与 session 的映射（实际应使用 session 存储）
const stateStore = {};

// 1. 引导用户登录
app.get('/login', (req, res) => {
  const state = generateState();
  stateStore[state] = true;
  const params = querystring.stringify({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'profile',
    state: state,
  });
  res.redirect(`${config.authUrl}?${params}`);
});

// 2. 回调处理
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!stateStore[state]) {
    return res.status(400).send('Invalid state');
  }
  delete stateStore[state];

  try {
    // 交换 token
    const tokenRes = await axios.post(config.tokenUrl,
      querystring.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenRes.data;

    // 获取用户信息
    const userRes = await axios.get(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const user = userRes.data;

    // 在这里创建或登录你的系统用户
    res.json({ user, token: access_token });
  } catch (err) {
    console.error(err);
    res.status(500).send('登录失败');
  }
});

app.listen(3000, () => console.log('OAuth client running on port 3000'));
5. 注意事项
client_secret 必须保存在后端，绝对不能暴露在客户端（如浏览器、移动 App 中）。

移动端或纯前端应用应使用 PKCE 扩展，但当前博客服务端可能未支持 PKCE，建议你确认后再实现。

重定向 URI 必须与注册时完全一致（包括协议、域名、端口、路径）。

授权码有效期为 10 分钟，access_token 有效期为 1 小时，refresh_token 有效期为 30 天。

如果博客管理员未实现 /oauth/userinfo，可以改用 /api/user/info 端点（返回用户详细信息）。

6. 获取更多帮助
如果你需要修改博客的 OAuth 服务端行为（如增加 scope、添加 userinfo 端点），请联系博客超级管理员。

博客管理后台提供 OAuth 客户端列表，可随时删除或查看已注册的客户端。