import nodemailer, { type Transporter } from "nodemailer";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env.js";
import { PASSWORD_RESET_ERROR_CODES } from "../config/passwordReset.js";
import ApiError from "../utils/ApiError.js";

export interface MailMessage {
    to: string;
    subject: string;
    html: string;
    text: string;
}

// Giao diện tối thiểu để service không phụ thuộc nodemailer; test thay bằng bản giả lập
export interface MailService {
    send(message: MailMessage): Promise<void>;
}

const buildFrom = (): string => {
    const name = env.MAIL_FROM;
    if (!name) return env.SMTP_USER;
    return name.includes("<") || name.includes("@") ? name : `${name} <${env.SMTP_USER}>`;
};

let transporter: Transporter | null = null;
const getTransporter = (): Transporter => {
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
        throw new ApiError(
            StatusCodes.SERVICE_UNAVAILABLE,
            "Email service is not configured",
            [],
            PASSWORD_RESET_ERROR_CODES.EMAIL_NOT_CONFIGURED,
        );
    }
    transporter ??= nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        // Mặc định của nodemailer chờ kết nối tới 2 phút và socket tới 10 phút; SMTP treo thì báo lỗi sớm thay vì giữ request
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
    });
    return transporter;
};

export const smtpMailService: MailService = {
    send: async (message) => {
        const activeTransporter = getTransporter();
        try {
            await activeTransporter.sendMail({ from: buildFrom(), ...message });
        } catch (error) {
            // Chỉ ghi mã lỗi kỹ thuật: nội dung email chứa link đổi mật khẩu nên không được log
            console.error("Email send failed:", (error as { code?: string }).code ?? "UNKNOWN");
            throw new ApiError(
                StatusCodes.BAD_GATEWAY,
                "Could not send the email. Please try again later",
                [],
                PASSWORD_RESET_ERROR_CODES.EMAIL_DELIVERY_FAILED,
            );
        }
    },
};

