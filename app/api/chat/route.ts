import { NextRequest, NextResponse } from "next/server";
import { getChatCompletion } from "@/lib/openai";
import { buildSystemPrompt } from "@/lib/prompts";
import { parseContact, parseName, isLikelyName } from "@/lib/contact-parser";
import {
  buildLeadSummary,
  buildRawConversation,
  extractBusinessFromMessages,
  extractTaskFromMessages,
  extractInterestFromMessages,
} from "@/lib/lead-summary";
import { sendLeadToGoogleSheets } from "@/lib/google-sheets";
import { sendTelegramNotification } from "@/lib/telegram";
import { logger } from "@/lib/logger";
import { ChatApiRequest, ChatStage, CollectedData, ChatMessage } from "@/lib/types";

function determineLeadStatus(data: CollectedData, messageCount: number): string {
  if (data.contact && data.consentGiven) return "hot";
  if (data.contact) return "hot";
  if (data.request && data.request.length > 50) return "warm";
  if (messageCount >= 4) return "warm";
  return "cold";
}

const CONTACT_REFUSAL_PATTERNS = [
  /не\s*хочу\s*(давать|оставлять)/i,
  /без\s*контакт/i,
  /не\s*буду\s*(давать|оставлять)/i,
  /не\s*оставлю/i,
  /не\s*дам\s*(номер|телефон|контакт|тг|telegram)/i,
  /не\s*хочу\s*(номер|телефон|контакт|тг|telegram)/i,
  /нет,?\s*(спасибо|не надо|не хочу)/i,
];

function isContactRefusal(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return CONTACT_REFUSAL_PATTERNS.some((p) => p.test(lower));
}

const NEW_LEAD_PATTERNS = [
  /нов(ая|ую)\s*заявк/i,
  /друг(ой|ую|ая)\s*(проект|задач)/i,
  /начать\s*заново/i,
  /оформ\w*\s*нов/i,
  /ещё\s*одн/i,
  /еще\s*одн/i,
  /это\s*друг(ой|ое)/i,
];

function isNewLeadIntent(text: string): boolean {
  return NEW_LEAD_PATTERNS.some((p) => p.test(text.toLowerCase().trim()));
}

function wasAskingForName(messages: { role: string; content: string }[]): boolean {
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (!lastAssistant) return false;
  const lower = lastAssistant.content.toLowerCase();
  return (
    lower.includes("как к вам") ||
    lower.includes("как вас зовут") ||
    lower.includes("как можно обращаться") ||
    lower.includes("ваше имя") ||
    lower.includes("представьтесь")
  );
}

function determineNextStage(
  currentStage: ChatStage,
  userText: string,
  data: CollectedData,
  messageCount: number,
  allMessages: { role: string; content: string }[]
): { stage: ChatStage; data: CollectedData } {
  const updatedData = { ...data };

  const askedForName = wasAskingForName(allMessages);

  if (askedForName && !updatedData.name && isLikelyName(userText)) {
    const capitalized = userText.trim().charAt(0).toUpperCase() + userText.trim().slice(1).toLowerCase();
    updatedData.name = capitalized;
  } else {
    const name = parseName(userText);
    if (name && !updatedData.name) {
      updatedData.name = name;
    }
  }

  const contact = parseContact(userText);
  if (contact) {
    updatedData.contact = contact.contact;
    updatedData.contactType = contact.contactType;
    if (contact.name) updatedData.name = contact.name;
  }

  const isNameOrContact = !!(
    (askedForName && updatedData.name && !data.name) ||
    contact
  );

  if (!isNameOrContact) {
    if (!updatedData.request) {
      updatedData.request = userText;
    } else if (currentStage === "qualification") {
      updatedData.request += ` | ${userText}`;
    }
  }

  switch (currentStage) {
    case "greeting":
      return { stage: "qualification", data: updatedData };

    case "qualification":
      if (isContactRefusal(userText)) {
        updatedData.contactDeclined = true;
        return { stage: "contact_request", data: updatedData };
      }
      if (updatedData.contact) {
        updatedData.contactDeclined = false;
        return { stage: "consent_request", data: updatedData };
      }
      if (messageCount >= 4) {
        return { stage: "contact_request", data: updatedData };
      }
      return { stage: "qualification", data: updatedData };

    case "contact_request":
      if (updatedData.contact) {
        updatedData.contactDeclined = false;
        return { stage: "consent_request", data: updatedData };
      }
      if (isContactRefusal(userText)) {
        updatedData.contactDeclined = true;
        return { stage: "contact_request", data: updatedData };
      }
      return { stage: "contact_request", data: updatedData };

    case "consent_request": {
      const consentKeywords = [
        "подтверждаю",
        "согласен",
        "согласна",
        "да",
        "ок",
        "хорошо",
        "принимаю",
      ];
      const isConsent = consentKeywords.some((kw) =>
        userText.toLowerCase().includes(kw)
      );
      if (isConsent || updatedData.consentGiven) {
        updatedData.consentGiven = true;
        return { stage: "completed", data: updatedData };
      }
      return { stage: "consent_request", data: updatedData };
    }

    case "completed":
      if (isNewLeadIntent(userText) && updatedData.leadSubmitted) {
        const freshData: CollectedData = {};
        return { stage: "greeting", data: freshData };
      }
      return { stage: "completed", data: updatedData };

    default:
      return { stage: currentStage, data: updatedData };
  }
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    const body: ChatApiRequest = await request.json();
    const { messages, stage, collectedData } = body;

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: "No messages" }, { status: 400 });
    }

    const lastUserMessage =
      messages.filter((m) => m.role === "user").pop()?.content ?? "";
    const userMessageCount = messages.filter((m) => m.role === "user").length;

    logger.info("chat_message_received", {
      stage,
      userMessageCount,
      messageLength: lastUserMessage.length,
    });

    const { stage: nextStage, data: updatedData } = determineNextStage(
      stage,
      lastUserMessage,
      collectedData,
      userMessageCount,
      messages
    );

    if (nextStage !== stage) {
      logger.info("stage_transition", { from: stage, to: nextStage });
    }

    if (updatedData.contactDeclined && !collectedData.contactDeclined) {
      logger.info("contact_declined", {});
    }

    if (isNewLeadIntent(lastUserMessage) && stage === "completed") {
      logger.info("new_lead_intent", {});
    }

    const systemPrompt = buildSystemPrompt(nextStage, updatedData);

    const chatMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const tLlm = Date.now();
    let reply: string;
    try {
      reply = await getChatCompletion(systemPrompt, chatMessages);
      logger.info("perf_timing", { step: "openai_response_ms", ms: Date.now() - tLlm });
    } catch (err) {
      logger.error("openai_request_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: "AI service error" },
        { status: 500 }
      );
    }

    const shouldSaveLead =
      nextStage === "completed" &&
      updatedData.consentGiven &&
      !updatedData.leadSubmitted &&
      stage !== "completed";

    if (shouldSaveLead) {
      logger.info("consent_given", { name: updatedData.name });

      const chatMessageObjects: ChatMessage[] = messages.map((m, i) => ({
        id: String(i),
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: Date.now(),
      }));

      const business = extractBusinessFromMessages(chatMessageObjects);
      const task = extractTaskFromMessages(chatMessageObjects);
      const interest = extractInterestFromMessages(chatMessageObjects);
      const summary = buildLeadSummary(task, business, interest, updatedData);
      const rawConversation = buildRawConversation(chatMessageObjects);
      const leadStatus = determineLeadStatus(updatedData, userMessageCount);

      updatedData.summary = summary;

      const leadPayload = {
        name: updatedData.name || "не указано",
        contact: updatedData.contact || "не указан",
        contactType: updatedData.contactType || "unknown",
        request: task,
        summary,
        consentGiven: true,
        source: "website-chat",
        rawConversation,
      };

      const tSheets = Date.now();
      const sheetsResult = await sendLeadToGoogleSheets(leadPayload);
      logger.info("perf_timing", { step: "google_sheets_ms", ms: Date.now() - tSheets });

      if (sheetsResult.success) {
        logger.info("lead_saved_to_sheet", { name: leadPayload.name });
        updatedData.leadSubmitted = true;

        const tTg = Date.now();
        try {
          const tgResult = await sendTelegramNotification({
            name: leadPayload.name,
            contact: leadPayload.contact,
            contactType: leadPayload.contactType,
            business,
            task,
            interest,
            leadStatus,
            consentGiven: true,
            summary,
          });
          logger.info("perf_timing", {
            step: "telegram_ms",
            ms: Date.now() - tTg,
            sent: tgResult,
          });
        } catch (tgErr) {
          logger.error("telegram_notification_failed", {
            error: tgErr instanceof Error ? tgErr.message : String(tgErr),
            ms: Date.now() - tTg,
          });
        }
      } else {
        logger.error("lead_save_failed", { error: sheetsResult.error });
      }

      reply = "Спасибо, заявка принята. Менеджер свяжется с вами в ближайшее время. Если у вас есть дополнительные вопросы — пишите, буду рад помочь.";
    }

    if (stage === "completed" && nextStage === "completed" && updatedData.leadSubmitted) {
      logger.info("completed_guard_blocked", {});
    }

    logger.info("perf_timing", { step: "total_request_ms", ms: Date.now() - t0 });

    return NextResponse.json({
      reply,
      stage: nextStage,
      collectedData: updatedData,
    });
  } catch (error) {
    logger.error("openai_request_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
