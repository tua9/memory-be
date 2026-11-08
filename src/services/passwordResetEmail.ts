// Email gửi link đổi mật khẩu. Link do service dựng từ cấu hình đáng tin cậy (CLIENT_URL), không nhận từ client.
export const buildPasswordResetEmail = ({ link, expiresInMinutes }: { link: string; expiresInMinutes: number }) => ({
    subject: "Đặt lại mật khẩu Memio",
    text: [
        "Bạn vừa yêu cầu đổi mật khẩu tài khoản Memio.",
        "Mở liên kết dưới đây để đặt mật khẩu mới:",
        link,
        "",
        `Liên kết chỉ có hiệu lực trong ${expiresInMinutes} phút và chỉ dùng được một lần.`,
        "Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu của bạn không bị thay đổi.",
    ].join("\n"),
    html: `
<div style="background:#f6fcf8;padding:32px 0;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;border:1px solid #e0eee6;">
    <h1 style="margin:0 0 20px;text-align:center;color:#0d631b;font-size:24px;">Memio</h1>
    <p style="color:#2f3a4a;font-size:15px;line-height:1.6;">
      Bạn vừa yêu cầu đổi mật khẩu tài khoản Memio. Nhấn nút bên dưới để đặt mật khẩu mới:
    </p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${link}" style="display:inline-block;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:999px;">
        Đặt mật khẩu mới
      </a>
    </p>
    <p style="color:#586274;font-size:14px;line-height:1.6;">
      Liên kết chỉ có hiệu lực trong <strong>${expiresInMinutes} phút</strong> và chỉ dùng được một lần.
      Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu của bạn không bị thay đổi.
    </p>
    <p style="color:#77839a;font-size:12px;line-height:1.5;word-break:break-all;">
      Nếu nút không bấm được, hãy sao chép liên kết này vào trình duyệt:<br />${link}
    </p>
  </div>
</div>`,
});

