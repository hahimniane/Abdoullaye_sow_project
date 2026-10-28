// Sample WhatsApp conversations for the consoles' local preview
// (`?preview=1&console=business` / `?preview=1` on localhost), so Support's
// WhatsApp threads - badges, state filter, ticks, notes, files, the packages
// header, the composer and Laawol's inbox switch - can be checked in a
// browser without a signed-in user or a server. Never read outside preview.
//
// The rows have the shapes the server writes (functions
// whatsapp_conversations.js); answers to the callables come from an
// in-memory state that lives as long as the page.

type Row = Record<string, unknown> & { id: string };

const MINUTE = 60_000;

function ago(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

const BUSINESS_ID = "preview-business";

const threads: Row[] = [
  {
    id: "wa_preview-business_224621000001",
    caseType: "whatsapp",
    channel: "whatsapp",
    inbox: BUSINESS_ID,
    businessId: BUSINESS_ID,
    businessName: "Nensona Shipping",
    customerName: "Awa Diallo",
    subject: "Awa Diallo",
    whatsappPhone: "+224621000001",
    customerPhone: "+224621000001",
    whatsappState: "needs_reply",
    status: "waiting_for_business",
    lastMessage: "Bonjour, mon baril est arrivé ?",
    lastMessageAt: ago(4),
    updatedAt: ago(4),
    unreadCount: 2,
    whatsappLang: "fr",
  },
  {
    id: "wa_preview-business_13475550101",
    caseType: "whatsapp",
    channel: "whatsapp",
    inbox: BUSINESS_ID,
    businessId: BUSINESS_ID,
    businessName: "Nensona Shipping",
    customerName: "Ibrahima Sow",
    subject: "Ibrahima Sow",
    whatsappPhone: "+13475550101",
    customerPhone: "+13475550101",
    whatsappState: "waiting_customer",
    status: "waiting_for_customer",
    lastMessage: "Voice note",
    lastMessageAt: ago(90),
    updatedAt: ago(90),
    updatesStopped: true,
    whatsappLang: "en",
  },
  {
    id: "wa_preview-business_224622000002",
    caseType: "whatsapp",
    channel: "whatsapp",
    inbox: BUSINESS_ID,
    businessId: BUSINESS_ID,
    businessName: "Nensona Shipping",
    customerName: "Mariama Bah",
    subject: "Mariama Bah",
    whatsappPhone: "+224622000002",
    customerPhone: "+224622000002",
    whatsappState: "done",
    status: "resolved",
    lastMessage: "Merci beaucoup !",
    lastMessageAt: ago(60 * 26),
    updatedAt: ago(60 * 26),
    whatsappLang: "fr",
  },
  {
    id: "wa_laawol_224623000003",
    caseType: "whatsapp",
    channel: "whatsapp",
    inbox: "laawol",
    businessId: "",
    businessName: "Laawol",
    suggestedBusinessId: "keren",
    suggestedBusinessName: "Keren Cargo",
    customerName: "+224623000003",
    subject: "+224623000003",
    whatsappPhone: "+224623000003",
    customerPhone: "+224623000003",
    whatsappState: "choosing",
    status: "waiting_for_customer",
    escalationStatus: "escalated",
    lastMessage: "Hello?",
    lastMessageAt: ago(30),
    updatedAt: ago(30),
    whatsappLang: "en",
  },
];

const support = (id: string, extra: Record<string, unknown>): Row => ({
  id,
  readBy: {},
  deletedForUsers: {},
  ...extra,
});

const messages: Record<string, Row[]> = {
  "wa_preview-business_224621000001": [
    support("m1", {
      senderRole: "customer", senderName: "Awa Diallo", messageType: "text",
      content: "Bonjour, je voulais savoir où en est mon envoi.", createdAt: ago(60 * 25),
      metadata: { channel: "whatsapp", whatsapp: { direction: "in" } },
    }),
    support("m2", {
      senderRole: "system", senderName: "Automatic reply", messageType: "system", senderId: "whatsapp:auto",
      content: "Merci pour votre message. Nensona Shipping vous répond bientôt. Suivi : https://laawol.app/t/NEN-4821",
      createdAt: ago(60 * 25 - 1),
      metadata: { channel: "whatsapp", auto: true, whatsapp: { direction: "out", status: "read" } },
    }),
    support("m3", {
      senderRole: "business", senderId: "preview-business-user", senderName: "Mamadou (Nensona Shipping)", messageType: "text",
      content: "Bonjour Awa, votre baril est sur le conteneur MSCU 123456-7. Il arrive à Conakry la semaine prochaine.",
      createdAt: ago(60 * 24),
      metadata: { channel: "whatsapp", whatsappLabel: "Mamadou (Nensona Shipping)", whatsapp: { direction: "out", status: "delivered" } },
    }),
    support("m4", {
      senderRole: "business", senderId: "preview-business-user", senderName: "Mamadou", messageType: "text",
      content: "She paid the balance in cash on Monday.",
      createdAt: ago(60 * 23),
      metadata: { channel: "whatsapp", note: true },
    }),
    support("m5", {
      senderRole: "customer", senderName: "Awa Diallo", messageType: "image",
      content: "Photo", createdAt: ago(50),
      metadata: {
        channel: "whatsapp", whatsapp: { direction: "in" }, mimeType: "image/jpeg", fileName: "",
        fileUrl: "data:image/svg+xml;utf8," + encodeURIComponent(
          "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='140'><rect width='220' height='140' fill='#cbd5e1'/><text x='110' y='76' font-size='14' text-anchor='middle' fill='#334155'>receipt.jpg</text></svg>",
        ),
        caption: "Le reçu",
      },
    }),
    support("m6", {
      senderRole: "customer", senderName: "Awa Diallo", messageType: "voice",
      content: "Voice note", createdAt: ago(48),
      metadata: { channel: "whatsapp", whatsapp: { direction: "in" }, mimeType: "audio/ogg", fileUrl: "", mediaDeleted: true },
    }),
    support("m7", {
      senderRole: "business", senderId: "preview-business-user", senderName: "Mamadou (Nensona Shipping)", messageType: "file",
      content: "invoice.pdf", createdAt: ago(20),
      metadata: {
        channel: "whatsapp", whatsappLabel: "Mamadou (Nensona Shipping)", mimeType: "application/pdf", fileName: "invoice.pdf",
        fileUrl: "#preview-invoice", whatsapp: { direction: "out", status: "failed", error: "Message undeliverable" },
      },
    }),
    support("m8", {
      senderRole: "customer", senderName: "Awa Diallo", messageType: "text",
      content: "Bonjour, mon baril est arrivé ?", createdAt: ago(4),
      metadata: { channel: "whatsapp", whatsapp: { direction: "in" } },
    }),
  ],
  "wa_preview-business_13475550101": [
    support("n1", {
      senderRole: "customer", senderName: "Ibrahima Sow", messageType: "text",
      content: "STOP", createdAt: ago(60 * 30),
      metadata: { channel: "whatsapp", whatsapp: { direction: "in" } },
    }),
    support("n2", {
      senderRole: "business", senderId: "preview-business-user", senderName: "Mamadou (Nensona Shipping)", messageType: "text",
      content: "Your car is ready for pickup at the Conakry office.", createdAt: ago(90),
      metadata: { channel: "whatsapp", whatsappLabel: "Mamadou (Nensona Shipping)", whatsapp: { direction: "out", status: "waiting_for_reply", stopped: true } },
    }),
  ],
  "wa_preview-business_224622000002": [
    support("p1", {
      senderRole: "customer", senderName: "Mariama Bah", messageType: "text",
      content: "Merci beaucoup !", createdAt: ago(60 * 26),
      metadata: { channel: "whatsapp", whatsapp: { direction: "in" } },
    }),
  ],
  "wa_laawol_224623000003": [
    support("q1", {
      senderRole: "customer", senderName: "+224623000003", messageType: "text",
      content: "Hello?", createdAt: ago(31),
      metadata: { channel: "whatsapp", whatsapp: { direction: "in" } },
    }),
    support("q2", {
      senderRole: "system", senderName: "Automatic reply", messageType: "system", senderId: "whatsapp:auto",
      content: "Which business is this about? Reply 1 for Nensona Shipping, 2 for Keren Cargo.", createdAt: ago(30),
      metadata: { channel: "whatsapp", auto: true, whatsapp: { direction: "out", status: "sent" } },
    }),
  ],
};

const packages: Record<string, unknown[]> = {
  "wa_preview-business_224621000001": [
    { id: "l1", trackingCode: "NEN-4821", kind: "barrel", description: "2 barrels", containerId: "c1", containerStatus: "shipped", destination: "Guinea", role: "receiver" },
    { id: "l2", trackingCode: "NEN-5110", kind: "box", description: "Box of clothes", containerId: "", containerStatus: "", destination: "Guinea", role: "receiver" },
  ],
};

let inboxMode = "laawol_only";

/** The sample conversations a console's list would read. */
export function previewWhatsAppThreads(scope: "business" | "admin", view: "cases" | "whatsapp"): Row[] {
  if (scope === "business") return threads.filter((row) => row.businessId === BUSINESS_ID);
  return view === "whatsapp" ? threads : threads.filter((row) => row.escalationStatus === "escalated");
}

export function previewWhatsAppMessages(caseId: string): Row[] {
  return messages[caseId] ?? [];
}

/**
 * What the server would answer, so buttons show their real progress and
 * result. Nothing is stored except the inbox mode.
 */
export async function previewWhatsAppCall(name: string, payload: Record<string, unknown>): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (name === "whatsappConversation") {
    switch (payload.action) {
      case "packages":
        return { success: true, packages: packages[String(payload.caseId)] ?? [] };
      case "mode":
        return { success: true, mode: inboxMode };
      case "setMode":
        inboxMode = String(payload.mode);
        return { success: true, mode: inboxMode };
      case "handoffOptions":
        return {
          success: true,
          options: [
            { businessId: "laawol", businessName: "Laawol" },
            { businessId: "keren", businessName: "Keren Cargo" },
          ].filter((option) => !String(payload.caseId).startsWith(`wa_${option.businessId}_`)),
        };
      case "handoff":
        return { success: true, caseId: String(payload.caseId) };
      case "open":
        return { success: true, caseId: threads[0].id };
      default:
        return { success: true };
    }
  }
  if (name === "sendSupportMessage" || name === "uploadSupportAttachmentMetadata") {
    return { success: true, delivery: "waiting" };
  }
  return { success: true };
}
