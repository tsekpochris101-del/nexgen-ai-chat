import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigins = (process.env.APP_ORIGIN || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by APP_ORIGIN"));
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

const users = new Map();
const sessions = new Map();
const conversations = new Map();
const messages = new Map();
const maintenanceRequests = [];
const changeRequests = [];
const roadmap = [
  { id: "roadmap_1", title: "Persistent conversation storage", category: "Reliability", priority: "High", status: "Planned", description: "Move users, sessions, conversations, and messages into a managed database." },
  { id: "roadmap_2", title: "Streaming responses", category: "AI experience", priority: "High", status: "Exploring", description: "Show model output as it arrives with cancellation and retry controls." },
  { id: "roadmap_3", title: "Team workspaces", category: "Collaboration", priority: "Medium", status: "Planned", description: "Shared spaces, roles, invitations, and organization-level controls." },
  { id: "roadmap_4", title: "Usage analytics", category: "Operations", priority: "Medium", status: "Exploring", description: "Track response latency, model usage, search usage, and product adoption." },
  { id: "roadmap_5", title: "Files and knowledge bases", category: "AI experience", priority: "Low", status: "Idea", description: "Attach documents and let users create private, searchable knowledge spaces." }
];

const json = (res, status, body) => res.status(status).json(body);
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function roleForEmail(email) {
  return email.toLowerCase() === (process.env.ADMIN_EMAIL || "").trim().toLowerCase() ? "admin" : "member";
}

function findUserById(userId) {
  return [...users.values()].find((user) => user.id === userId);
}

function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, createdAt: Date.now() });
  res.cookie("nexgen_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/"
  });
}

function clearSession(res, token) {
  if (token) sessions.delete(token);
  res.clearCookie("nexgen_session", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" });
}

function getSessionToken(req) {
  const raw = req.headers.cookie || "";
  const match = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith("nexgen_session="));
  return match?.slice("nexgen_session=".length) || null;
}

function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  const session = token && sessions.get(token);
  const user = session && findUserById(session.userId);
  if (!user) return json(res, 401, { error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } });
  req.user = user;
  req.sessionToken = token;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return json(res, 403, { error: { code: "FORBIDDEN", message: "Admin access required." } });
  next();
}

function cleanText(value, max = 12000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function adminItem(type, body, user) {
  return {
    id: id(type),
    title: cleanText(body?.title, 120),
    description: cleanText(body?.description, 1000),
    priority: cleanText(body?.priority, 20) || "Medium",
    status: "Open",
    createdBy: user.email,
    createdAt: now(),
    updatedAt: now()
  };
}

function conversationForUser(conversation, userId) {
  return conversation && conversation.userId === userId ? conversation : null;
}

function serializeConversation(conversation, includeMessages = false) {
  const result = {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messageIds.length
  };
  if (includeMessages) {
    result.messages = conversation.messageIds.map((messageId) => messages.get(messageId)).filter(Boolean);
  }
  return result;
}

function shouldSearchWeb(content, requested) {
  if (requested) return true;
  return /\b(latest|current|today|now|recent|news|weather|price|prices|stock|stocks|score|scores|2026|this week|look up|search the web|what happened)\b/i.test(content);
}

async function searchWeb(query) {
  try {
    const requestBody = {
      query,
      type: "auto",
      numResults: 5,
      contents: { highlights: true }
    };
    if (!process.env.EXA_API_KEY) return [];
    const response = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY },
        body: JSON.stringify(requestBody)
      });
    if (!response.ok) throw new Error(`Exa returned ${response.status}`);
    const payload = await response.json();
    return (payload.results || []).map((result) => ({
      title: result.title || result.url,
      url: result.url,
      publishedDate: result.publishedDate,
      highlights: result.highlights || []
    })).filter((result) => result.url);
  } catch (error) {
    console.error("Web search failed:", error.message);
    return [];
  }
}

function sourceContext(sources) {
  if (!sources.length) return "";
  return `\n\nLive web sources are available below. Use them for current facts, do not invent details, and cite relevant claims with [1], [2], etc.\n${sources.map((source, index) => `[${index + 1}] ${source.title} — ${source.url}\n${source.highlights.slice(0, 2).join(" ")}`).join("\n\n")}`;
}

function sourceLinks(sources) {
  if (!sources.length) return "";
  return `\n\n**Sources**\n${sources.map((source, index) => `- [${index + 1}. ${source.title}](${source.url})`).join("\n")}`;
}

async function generateAssistantReply(history, sources = []) {
  const system = {
    role: "system",
    content: "You are nexGen, a fast, thoughtful general-purpose AI assistant created by Tsekpo Chris, a self-taught programmer. If asked who created you, who made you, or who your creator is, say clearly that you were created by Tsekpo Chris, a self-taught programmer. Be clear, concise, useful, and warm. Use Markdown when it improves readability. Avoid unnecessary preamble."
  };
  const searchInstruction = sources.length ? {
    role: "system",
    content: sourceContext(sources)
  } : null;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const latest = history.at(-1)?.content || "that";
    return `## nexGen is ready\n\nYou asked about **${latest.slice(0, 120)}**.\n\nThis is a development response because \`GROQ_API_KEY\` is not configured yet. Add the key to \`.env\` to connect the chat to Groq.\n\n- Created by Tsekpo Chris, a self-taught programmer\n- Your conversation is being persisted in the development store\n- Server-side authentication is active\n- Markdown and code blocks are supported${sourceLinks(sources)}`;
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      messages: [system, ...(searchInstruction ? [searchInstruction] : []), ...history.slice(-20).map(({ role, content }) => ({ role, content }))],
      temperature: 0.6,
      max_tokens: 1600
    })
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const payload = await response.json();
  return `${payload.choices?.[0]?.message?.content || "I wasn't able to generate a response."}${sourceLinks(sources)}`;
}

app.get("/api/health", (_req, res) => json(res, 200, { ok: true, providerConfigured: Boolean(process.env.GROQ_API_KEY) }));

app.post("/api/auth/signup", (req, res) => {
  const name = cleanText(req.body?.name, 80);
  const email = cleanText(req.body?.email, 160).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (name.length < 2) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Enter your name." } });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Enter a valid email address." } });
  if (password.length < 8) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Password must be at least 8 characters." } });
  if (users.has(email)) return json(res, 409, { error: { code: "ACCOUNT_EXISTS", message: "Unable to create an account with those details." } });
  const user = { id: id("user"), name, email, passwordHash: hashPassword(password), role: roleForEmail(email), createdAt: now() };
  users.set(email, user);
  setSession(res, user.id);
  return json(res, 201, { user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const email = cleanText(req.body?.email, 160).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = users.get(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return json(res, 401, { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
  }
  user.role = roleForEmail(user.email);
  setSession(res, user.id);
  return json(res, 200, { user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  clearSession(res, getSessionToken(req));
  return json(res, 200, { ok: true });
});

app.get("/api/auth/session", (req, res) => {
  const token = getSessionToken(req);
  const session = token && sessions.get(token);
  const user = session && findUserById(session.userId);
  return json(res, 200, { user: user ? publicUser(user) : null });
});

app.get("/api/conversations", requireAuth, (req, res) => {
  const query = cleanText(req.query.q, 120);
  const list = [...conversations.values()]
    .filter((conversation) => conversation.userId === req.user.id)
    .filter((conversation) => {
      if (!query) return true;
      const haystack = `${conversation.title} ${conversation.messageIds.map((messageId) => messages.get(messageId)?.content || "").join(" ")}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((conversation) => serializeConversation(conversation));
  return json(res, 200, { conversations: list });
});

app.post("/api/conversations", requireAuth, (req, res) => {
  const conversation = { id: id("conversation"), userId: req.user.id, title: "New conversation", messageIds: [], createdAt: now(), updatedAt: now() };
  conversations.set(conversation.id, conversation);
  return json(res, 201, { conversation: serializeConversation(conversation, true) });
});

app.get("/api/conversations/:conversationId", requireAuth, (req, res) => {
  const conversation = conversationForUser(conversations.get(req.params.conversationId), req.user.id);
  if (!conversation) return json(res, 404, { error: { code: "NOT_FOUND", message: "Conversation not found." } });
  return json(res, 200, { conversation: serializeConversation(conversation, true) });
});

app.patch("/api/conversations/:conversationId", requireAuth, (req, res) => {
  const conversation = conversationForUser(conversations.get(req.params.conversationId), req.user.id);
  if (!conversation) return json(res, 404, { error: { code: "NOT_FOUND", message: "Conversation not found." } });
  const title = cleanText(req.body?.title, 100);
  if (!title) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "A conversation title is required." } });
  conversation.title = title;
  conversation.updatedAt = now();
  return json(res, 200, { conversation: serializeConversation(conversation) });
});

app.delete("/api/conversations/:conversationId", requireAuth, (req, res) => {
  const conversation = conversationForUser(conversations.get(req.params.conversationId), req.user.id);
  if (!conversation) return json(res, 404, { error: { code: "NOT_FOUND", message: "Conversation not found." } });
  conversation.messageIds.forEach((messageId) => messages.delete(messageId));
  conversations.delete(conversation.id);
  return json(res, 200, { ok: true });
});

app.post("/api/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  const conversation = conversationForUser(conversations.get(req.params.conversationId), req.user.id);
  if (!conversation) return json(res, 404, { error: { code: "NOT_FOUND", message: "Conversation not found." } });
  const content = cleanText(req.body?.content);
  if (!content) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Message content is required." } });
  const webSearchRequested = req.body?.webSearch === true;

  const userMessage = { id: id("message"), conversationId: conversation.id, role: "user", content, createdAt: now() };
  messages.set(userMessage.id, userMessage);
  conversation.messageIds.push(userMessage.id);
  if (conversation.title === "New conversation") conversation.title = content.replace(/\s+/g, " ").slice(0, 48) || "New conversation";
  conversation.updatedAt = now();

  try {
    const history = conversation.messageIds.map((messageId) => messages.get(messageId)).filter(Boolean);
    const sources = shouldSearchWeb(content, webSearchRequested) ? await searchWeb(content) : [];
    const assistantMessage = { id: id("message"), conversationId: conversation.id, role: "assistant", content: await generateAssistantReply(history, sources), createdAt: now() };
    messages.set(assistantMessage.id, assistantMessage);
    conversation.messageIds.push(assistantMessage.id);
    conversation.updatedAt = now();
    return json(res, 201, { conversation: serializeConversation(conversation, true) });
  } catch (error) {
    console.error("AI request failed:", error.message);
    return json(res, 502, { error: { code: "AI_PROVIDER_ERROR", message: "nexGen could not complete that response. Try again." } });
  }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, (_req, res) => {
  const allMessages = [...messages.values()];
  return json(res, 200, {
    overview: {
      users: users.size,
      conversations: conversations.size,
      messages: allMessages.length,
      providerConfigured: Boolean(process.env.GROQ_API_KEY)
    }
  });
});

app.get("/api/admin/workspace", requireAuth, requireAdmin, (_req, res) => {
  return json(res, 200, {
    workspace: {
      maintenance: maintenanceRequests,
      changes: changeRequests,
      integrations: [
        { id: "groq", name: "Groq", category: "AI provider", status: process.env.GROQ_API_KEY ? "Connected" : "Needs setup", description: "Powers nexGen assistant responses.", docs: "https://console.groq.com/docs" },
        { id: "exa", name: "Exa", category: "Live web search", status: process.env.EXA_API_KEY ? "Connected" : "Needs setup", description: "Adds current web sources to answers.", docs: "https://docs.exa.ai" },
        { id: "database", name: "Persistent database", category: "Infrastructure", status: "Planned", description: "Required before user data should be treated as production-persistent.", docs: "" },
        { id: "email", name: "Transactional email", category: "Operations", status: "Not connected", description: "Future password resets, verification, and product notifications.", docs: "" }
      ],
      roadmap
    }
  });
});

app.post("/api/admin/maintenance", requireAuth, requireAdmin, (req, res) => {
  const request = adminItem("maintenance", req.body, req.user);
  if (!request.title || !request.description) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Add a title and description." } });
  maintenanceRequests.unshift(request);
  return json(res, 201, { request });
});

app.patch("/api/admin/maintenance/:requestId", requireAuth, requireAdmin, (req, res) => {
  const request = maintenanceRequests.find((item) => item.id === req.params.requestId);
  if (!request) return json(res, 404, { error: { code: "NOT_FOUND", message: "Maintenance request not found." } });
  request.status = cleanText(req.body?.status, 20) || request.status;
  request.updatedAt = now();
  return json(res, 200, { request });
});

app.post("/api/admin/changes", requireAuth, requireAdmin, (req, res) => {
  const request = adminItem("change", req.body, req.user);
  request.area = cleanText(req.body?.area, 80) || "Product";
  if (!request.title || !request.description) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Add a title and description." } });
  changeRequests.unshift(request);
  return json(res, 201, { request });
});

app.patch("/api/admin/changes/:requestId", requireAuth, requireAdmin, (req, res) => {
  const request = changeRequests.find((item) => item.id === req.params.requestId);
  if (!request) return json(res, 404, { error: { code: "NOT_FOUND", message: "Change request not found." } });
  request.status = cleanText(req.body?.status, 20) || request.status;
  request.updatedAt = now();
  return json(res, 200, { request });
});

const distDir = path.join(rootDir, "dist");
if (fs.existsSync(path.join(distDir, "index.html"))) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(distDir, "index.html"));
  });
}

export default app;

if (process.env.VERCEL !== "1") {
  app.listen(PORT, HOST, () => {
    console.log(`nexGen API listening on ${HOST}:${PORT}`);
    if (!process.env.GROQ_API_KEY) console.log("GROQ_API_KEY is not set; using explicit development responses.");
  });
}