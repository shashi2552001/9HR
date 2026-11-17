import nodemailer from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailDispatchResult {
  delivered: boolean;
  mode: 'SMTP' | 'LOG_ONLY';
  message: string;
}

const PLACEHOLDER_VALUES = new Set([
  'temp',
  'placeholder',
  'none',
  'null',
  'undefined',
  'changeme',
  'example',
  'smtp.example.com',
  'my_smtp_host',
  'my_smtp_user',
  'my_smtp_pass',
]);

const isRealConfigValue = (val?: string): boolean => {
  const trimmed = (val || '').trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower) || lower.startsWith('replace_') || lower.startsWith('my_')) {
    return false;
  }
  return true;
};

export const isValidSmtpHost = (host?: string): boolean => {
  if (!isRealConfigValue(host)) return false;
  const normalized = host!.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return true;
  }
  return normalized.includes('.') && !normalized.endsWith('.local');
};

export const isSmtpConfigured = (): boolean =>
  isValidSmtpHost(process.env.SMTP_HOST) &&
  isRealConfigValue(process.env.SMTP_USER) &&
  isRealConfigValue(process.env.SMTP_PASS);

export const sendEmailNotification = async (msg: EmailMessage): Promise<EmailDispatchResult> => {
  if (!isSmtpConfigured()) {
    console.info(`[9HR-MAILER:LOG_ONLY] To=${msg.to} Subject="${msg.subject}"`);
    return {
      delivered: false,
      mode: 'LOG_ONLY',
      message: 'SMTP credentials not configured in environment; notification logged locally.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      auth: {
        user: process.env.SMTP_USER!.trim(),
        pass: process.env.SMTP_PASS!.trim(),
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || '9HR India Portal <noreply@9hrindia.com>',
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html || `<p>${msg.text.replace(/\n/g, '<br/>')}</p>`,
    });

    return {
      delivered: true,
      mode: 'SMTP',
      message: 'Email delivered via SMTP.',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[9HR-MAILER:FALLBACK] SMTP unavailable (${reason}); using local log fallback.`);
    return {
      delivered: false,
      mode: 'LOG_ONLY',
      message: 'SMTP unavailable; notification logged locally.',
    };
  }
};
