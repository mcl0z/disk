import { Database } from '../utils/db.js';
import bcrypt from 'bcryptjs';

export class OldChatAuth {
    constructor(env) {
        this.apiBase = env.OLDCHAT_API_BASE || 'http://60.205.94.101:8080';
        this.db = new Database(env.BLOG_KV);
    }

    async callOldChatLogin(identifier, password, deviceId = 'blog-service') {
        const url = `${this.apiBase}/v1/auth/login`;
        const payload = {
            identifier,
            password,
            device_id: deviceId,
            device_name: 'NwelyBlog',
            platform: 'web',
            app_version: '1.0.0'
        };

        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.error('OldChat 登录请求网络错误:', err);
            throw new Error('OldChat 服务器连接失败');
        }

        const responseText = await response.text();
        const contentType = response.headers.get('content-type') || '';

        // 尝试解析 JSON（无论状态码）
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (err) {
            // 不是 JSON，记录日志并抛出友好错误
            console.error('OldChat 响应非 JSON', {
                status: response.status,
                contentType,
                body: responseText.substring(0, 500)
            });
            // 根据状态码给出更具体的错误提示
            if (response.status === 403) {
                throw new Error('OldChat 账号或密码错误，请检查');
            } else {
                throw new Error(`OldChat 服务返回了非 JSON 响应 (HTTP ${response.status})`);
            }
        }

        // 如果状态码不是 2xx，但返回了 JSON 错误信息
        if (!response.ok) {
            const errorMsg = data.error || data.message || `HTTP ${response.status}`;
            console.error('OldChat 登录失败:', { status: response.status, error: errorMsg, data });
            throw new Error(errorMsg);
        }

        return data;
    }

    async handleLogin(identifier, password, deviceId) {
        const oldchatData = await this.callOldChatLogin(identifier, password, deviceId);
        const oldchatUser = oldchatData.user;
        const oldchatUid = oldchatUser.uid;

        let userId = await this.db.getUserIdByOldChat(oldchatUid);
        let user = null;

        if (userId) {
            user = await this.db.getUserById(userId);
        } else {
            if (oldchatUser.email) {
                user = await this.db.getUserByEmail(oldchatUser.email);
            }
            if (user) {
                await this.db.createOldChatUser(oldchatUid, user.id);
                if (!user.avatar && oldchatUser.avatar_url) {
                    await this.db.updateUser(user.id, { avatar: oldchatUser.avatar_url });
                }
                if (!user.bio && oldchatUser.signature) {
                    await this.db.updateUser(user.id, { bio: oldchatUser.signature });
                }
            } else {
                const randomPassword = crypto.randomUUID();
                const hashedPassword = await bcrypt.hash(randomPassword, 10);
                let username = oldchatUser.username || `oldchat_${oldchatUid.slice(0, 8)}`;
                let existingUser = await this.db.getUserByUsername(username);
                if (existingUser) {
                    username = `${username}_${Math.random().toString(36).substring(2, 6)}`;
                }
                user = await this.db.createUser({
                    username,
                    email: oldchatUser.email || null,
                    password: hashedPassword,
                    role: 'user',
                    avatar: oldchatUser.avatar_url || null,
                    bio: oldchatUser.signature || null
                });
                await this.db.createOldChatUser(oldchatUid, user.id);
            }
        }

        const token = await this.db.createSession(user.id);
        return { user, token };
    }
}