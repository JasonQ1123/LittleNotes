// Explicit operator action only: verify SMTP and optionally send a delivery check.
require('dotenv/config');
const nodemailer = require('nodemailer');
const { isEmail } = require('class-validator');
const recipients = process.argv.slice(2);
async function main() {
  if (
    !/^[A-Za-z0-9_.-]+@163\.com$/i.test(process.env.SMTP_USER || '') ||
    !process.env.SMTP_AUTH_CODE
  )
    throw new Error('请设置 SMTP_USER 和 SMTP_AUTH_CODE');
  if (recipients.length > 2 || recipients.some((email) => !isEmail(email)))
    throw new Error('最多提供两个由你控制的有效收件邮箱（建议 QQ、163 各一个）');
  const transport = nodemailer.createTransport({
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_AUTH_CODE },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    logger: false,
    debug: false,
  });
  try {
    await transport.verify();
    console.log('SMTP TLS 连接与认证成功。此结果不代表邮件可投递。');
    for (const to of recipients)
      await transport.sendMail({
        from: { name: '小纸条', address: process.env.SMTP_USER },
        to,
        subject: '小纸条 · 上线前收信检查',
        text: '这是你主动执行的小纸条收信检查。请确认收件箱（以及垃圾邮件）能够收到这封邮件。确认 QQ 和 163 均能收信后，再启用强制邮箱绑定版本。此邮件不含验证码。',
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    if (recipients.length)
      console.log('测试邮件已交给 SMTP 服务器，请人工确认实际收信；不要仅凭此输出启用新版本。');
  } finally {
    transport.close();
  }
}
main().catch(() => {
  console.error('SMTP 检查未通过。请检查网络、SMTP 开通状态和授权码；未自动重试，也未输出凭证。');
  process.exitCode = 1;
});
