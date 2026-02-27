import { Resend } from 'resend';

export class EmailService {
    constructor(env) {
        this.resend = new Resend(env.RESEND_API_KEY);
        this.fromEmail = env.FROM_EMAIL || 'no-reply@nwely.top';
        this.siteUrl = env.SITE_URL || 'http://localhost:8787';
    }

    async sendVerificationCode(email, code, type = '注册') {
        const subject = type === '注册' ? '欢迎注册 Nwely（陌筏）の 博客 - 请验证您的邮箱' : '重置密码 - 验证您的邮箱';
        const html = this.getVerificationEmailTemplate(code, type);
        
        try {
            const { data, error } = await this.resend.emails.send({
                from: `Nwely的博客 <${this.fromEmail}>`,
                to: [email],
                subject: subject,
                html: html
            });

            if (error) {
                console.error('邮件发送失败:', error);
                throw new Error('邮件发送失败');
            }

            return data;
        } catch (error) {
            console.error('邮件服务错误:', error);
            throw error;
        }
    }

    async sendPasswordResetEmail(email, token) {
        const resetLink = `${this.siteUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
        
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                    .container { background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 30px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .header h1 { color: #2563eb; margin: 0; }
                    .button { display: inline-block; background-color: #2563eb; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 500; margin: 20px 0; }
                    .footer { text-align: center; color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px; }
                    .note { background-color: #f3f4f6; border-radius: 4px; padding: 10px; font-size: 14px; color: #4b5563; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header"><h1>重置密码</h1></div>
                    <div class="content">
                        <p>您好，</p>
                        <p>您收到这封邮件是因为我们收到了重置您 Nwely（陌筏）の 博客 账户密码的请求。</p>
                        <p style="text-align: center;"><a href="${resetLink}" class="button">重置密码</a></p>
                        <p>如果按钮无法点击，请复制以下链接：</p>
                        <p style="word-break: break-all; color: #2563eb;">${resetLink}</p>
                        <div class="note"><p>⚠️ 此链接将在1小时后失效。</p></div>
                    </div>
                    <div class="footer"><p>© ${new Date().getFullYear()} Nwely的博客. All rights reserved.</p></div>
                </div>
            </body>
            </html>
        `;

        try {
            const { data, error } = await this.resend.emails.send({
                from: `Nwely的博客 <${this.fromEmail}>`,
                to: [email],
                subject: '重置您的 Nwely（陌筏）の 博客 密码',
                html: html
            });

            if (error) throw new Error('邮件发送失败');
            return data;
        } catch (error) {
            console.error('邮件服务错误:', error);
            throw error;
        }
    }

    getVerificationEmailTemplate(code, type) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                    .container { background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 30px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .header h1 { color: #2563eb; margin: 0; }
                    .code-box { background-color: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
                    .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2563eb; font-family: monospace; }
                    .footer { text-align: center; color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px; }
                    .note { font-size: 14px; color: #6b7280; margin-top: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header"><h1>邮箱验证</h1></div>
                    <div class="content">
                        <p>您好，</p>
                        <p>感谢您${type}Nwely（陌筏）の 博客！请输入以下验证码完成验证：</p>
                        <div class="code-box"><div class="code">${code}</div></div>
                        <p class="note">验证码有效期为10分钟。</p>
                    </div>
                    <div class="footer"><p>© ${new Date().getFullYear()} Nwely的博客. All rights reserved.</p></div>
                </div>
            </body>
            </html>
        `;
    }
}