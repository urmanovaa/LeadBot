import { logger } from "./logger";

export interface TelegramLeadData {
  name: string;
  contact: string;
  contactType: string;
  business: string;
  task: string;
  interest: string;
  leadStatus: string;
  consentGiven: boolean;
  summary: string;
}

function formatLeadMessage(data: TelegramLeadData): string {
  const lines = [
    "Новая заявка LeadBot AI",
    "",
    `Имя: ${data.name}`,
    `Контакт: ${data.contact}`,
    `Тип контакта: ${data.contactType}`,
    `Бизнес: ${data.business}`,
    `Задача: ${data.task}`,
    `Интерес: ${data.interest}`,
    `Статус: ${data.leadStatus}`,
    `Согласие: ${data.consentGiven ? "да" : "нет"}`,
    "",
    "Кратко:",
    data.summary,
  ];

  return lines.join("\n");
}

export async function sendTelegramNotification(
  leadData: TelegramLeadData
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  logger.info("telegram_notification_sent", {
    step: "start",
    hasToken: !!token,
    hasChatId: !!chatId,
    chatIdValue: chatId ? `${chatId.slice(0, 3)}...` : "missing",
  });

  if (!token || !chatId) {
    logger.warn("telegram_skipped_missing_env", {
      hasToken: !!token,
      hasChatId: !!chatId,
    });
    return false;
  }

  const text = formatLeadMessage(leadData);

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      logger.error("telegram_notification_failed", {
        status: response.status,
        description: (body as Record<string, unknown>)?.description || "unknown",
      });
      return false;
    }

    logger.info("telegram_notification_sent", {
      step: "done",
      chatId,
      leadName: leadData.name,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("abort");
    logger.error("telegram_notification_failed", {
      error: message,
      isTimeout,
    });
    return false;
  }
}
