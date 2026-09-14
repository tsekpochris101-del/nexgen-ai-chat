import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import pg from "pg";
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

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL || "";
const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  max: 5,
  idleTimeoutMillis: 10000,
  ssl: databaseUrl.includes("sslmode=require") || isProduction ? { rejectUnauthorized: false } : undefined
}) : null;
let schemaPromise;
const schemaSql = [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)",
  "CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations (user_id, updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')), content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages (conversation_id, created_at)"
].join(";\n");

async function ensureSchema() {
  if (!pool) return;
  if (!schemaPromise) schemaPromise = pool.query(schemaSql).catch((error) => { schemaPromise = null; throw error; });
  await schemaPromise;
}

const users = new Map();
const sessions = new Map();
const conversations = new Map();
const messages = new Map();
const maintenanceRequests = [];
const changeRequests = [];
const roadmap = [
  { id: "roadmap_1", title: "Persistent conversation storage", category: "Reliability", priority: "High", status: "Done", description: "Users, sessions, conversations, and messages now persist in managed Neon Postgres." },
  { id: "roadmap_2", title: "Streaming responses", category: "AI experience", priority: "High", status: "Exploring", description: "Show model output as it arrives with cancellation and retry controls." },
  { id: "roadmap_3", title: "Team workspaces", category: "Collaboration", priority: "Medium", status: "Planned", description: "Shared spaces, roles, invitations, and organization-level controls." },
  { id: "roadmap_4", title: "Usage analytics", category: "Operations", priority: "Medium", status: "Exploring", description: "Track response latency, model usage, search usage, and product adoption." },
  { id: "roadmap_5", title: "File uploads and knowledge bases", category: "AI experience", priority: "High", status: "Planned", description: "Upload PDFs, documents, and images; extract text, cite sources, and build private searchable knowledge spaces." },
  { id: "roadmap_6", title: "Voice chat and hands-free mode", category: "AI experience", priority: "High", status: "Exploring", description: "Talk with nexGen using speech input and spoken replies, with interruption handling and adjustable voice settings." },
  { id: "roadmap_7", title: "Camera and image understanding", category: "Multimodal", priority: "High", status: "Idea", description: "Capture an image with a camera or upload one for visual analysis, OCR, troubleshooting, and creative feedback." },
  { id: "roadmap_8", title: "Conversation export and sharing", category: "Collaboration", priority: "Medium", status: "Planned", description: "Share selected conversations securely and export them as Markdown, PDF, or a clean document." },
  { id: "roadmap_9", title: "Model picker and response controls", category: "AI experience", priority: "Medium", status: "Idea", description: "Let users choose the model and tune tone, length, creativity, and citation preferences." },
  { id: "roadmap_10", title: "Smart reminders and follow-ups", category: "Productivity", priority: "Medium", status: "Idea", description: "Turn useful conversations into reminders, tasks, and scheduled follow-ups." },
  { id: "roadmap_11", title: "Privacy center and data export", category: "Trust and safety", priority: "High", status: "Planned", description: "Give users clear controls to download, delete, and manage their account and conversation data." },
  { id: "roadmap_12", title: "Mobile companion app", category: "Platform", priority: "Medium", status: "Idea", description: "Bring voice, camera capture, chat history, and push notifications to iOS and Android." }
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

function mapUserRow(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, passwordHash: row.password_hash, role: row.role, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at };
}

function findUserById(userId) {
  return [...users.values()].find((user) => user.id === userId);
}

async function loadUserByEmail(email) {
  if (!pool) return users.get(email);
  await ensureSchema();
  const result = await pool.query("SELECT id, name, email, password_hash, role, created_at FROM users WHERE email = $1", [email]);
  return mapUserRow(result.rows[0]);
}

async function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  if (pool) {
    await ensureSchema();
    await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expiresAt]);
  } else {
    sessions.set(token, { userId, createdAt: Date.now() });
  }
  res.cookie("nexgen_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/"
  });
}

async function clearSession(res, token) {
  if (token) {
    if (pool) { await ensureSchema(); await pool.query("DELETE FROM sessions WHERE token = $1", [token]); }
    else sessions.delete(token);
  }
  res.clearCookie("nexgen_session", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" });
}

function getSessionToken(req) {
  const raw = req.headers.cookie || "";
  const match = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith("nexgen_session="));
  return match?.slice("nexgen_session=".length) || null;
}

async function requireAuth(req, res, next) {
  try {
    const token = getSessionToken(req);
    let user = null;
    if (pool) {
      await ensureSchema();
      const result = await pool.query("SELECT u.id, u.name, u.email, u.password_hash, u.role, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > NOW()", [token || ""]);
      user = mapUserRow(result.rows[0]);
    } else {
      const session = token && sessions.get(token);
      user = session && findUserById(session.userId);
    }
    if (!user) return json(res, 401, { error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } });
    req.user = user;
    req.sessionToken = token;
    next();
  } catch (error) {
    console.error("Authentication lookup failed:", error.message);
    return json(res, 503, { error: { code: "AUTH_STORAGE_UNAVAILABLE", message: "Authentication is temporarily unavailable." } });
  }
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

function conversationFromRow(row, messageRows = []) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    messageIds: messageRows.map((message) => message.id),
    messageCount: Number(row.message_count ?? messageRows.length),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    messages: messageRows
  };
}

async function loadConversation(conversationId, userId) {
  if (!pool) {
    const conversation = conversationForUser(conversations.get(conversationId), userId);
    if (!conversation) return null;
    return { ...conversation, messages: conversation.messageIds.map((messageId) => messages.get(messageId)).filter(Boolean) };
  }
  await ensureSchema();
  const conversationResult = await pool.query("SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at, COUNT(m.id)::int AS message_count FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id WHERE c.id = $1 AND c.user_id = $2 GROUP BY c.id", [conversationId, userId]);
  const row = conversationResult.rows[0];
  if (!row) return null;
  const messageResult = await pool.query("SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC", [conversationId]);
  const messageRows = messageResult.rows.map((message) => ({ id: message.id, conversationId: message.conversation_id, role: message.role, content: message.content, createdAt: message.created_at instanceof Date ? message.created_at.toISOString() : message.created_at }));
  return conversationFromRow(row, messageRows);
}

async function listConversationsForUser(userId, query = "") {
  if (!pool) {
    return [...conversations.values()]
      .filter((conversation) => conversation.userId === userId)
      .filter((conversation) => { if (!query) return true; const haystack = (conversation.title + " " + conversation.messageIds.map((messageId) => messages.get(messageId)?.content || "").join(" ")).toLowerCase(); return haystack.includes(query.toLowerCase()); })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  await ensureSchema();
  const result = await pool.query("SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at, COUNT(m.id)::int AS message_count, COALESCE(string_agg(m.content, ' '), '') AS search_text FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.updated_at DESC", [userId]);
  return result.rows.map((row) => ({ ...conversationFromRow(row), searchText: row.search_text || "" })).filter((conversation) => !query || (conversation.title + " " + conversation.searchText).toLowerCase().includes(query.toLowerCase()));
}

function serializeConversation(conversation, includeMessages = false) {
  const result = {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messageCount ?? conversation.messageIds.length
  };
  if (includeMessages) result.messages = conversation.messages?.length ? conversation.messages : conversation.messageIds.map((messageId) => messages.get(messageId)).filter(Boolean);
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

app.get("/api/health", async (_req, res) => {
  try {
    await ensureSchema();
    return json(res, 200, { ok: true, providerConfigured: Boolean(process.env.GROQ_API_KEY), searchProviderConfigured: Boolean(process.env.EXA_API_KEY), databaseConfigured: Boolean(pool) });
  } catch (error) {
    return json(res, 503, { ok: false, providerConfigured: Boolean(process.env.GROQ_API_KEY), searchProviderConfigured: Boolean(process.env.EXA_API_KEY), databaseConfigured: true, databaseReady: false });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const name = cleanText(req.body?.name, 80);
  const email = cleanText(req.body?.email, 160).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (name.length < 2) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Enter your name." } });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Enter a valid email address." } });
  if (password.length < 8) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Password must be at least 8 characters." } });
  try {
    const existing = await loadUserByEmail(email);
    if (existing) return json(res, 409, { error: { code: "ACCOUNT_EXISTS", message: "Unable to create an account with those details." } });
    const user = { id: id("user"), name, email, passwordHash: hashPassword(password), role: roleForEmail(email), createdAt: now() };
    if (pool) { await ensureSchema(); await pool.query("INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)", [user.id, user.name, user.email, user.passwordHash, user.role]); }
    else users.set(email, user);
    await setSession(res, user.id);
    return json(res, 201, { user: publicUser(user) });
  } catch (error) {
    console.error("Signup failed:", error.message);
    return json(res, 503, { error: { code: "AUTH_STORAGE_UNAVAILABLE", message: "Account creation is temporarily unavailable." } });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = cleanText(req.body?.email, 160).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  try {
    const user = await loadUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) return json(res, 401, { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
    user.role = roleForEmail(user.email);
    if (pool) await pool.query("UPDATE users SET role = $1 WHERE id = $2", [user.role, user.id]);
    await setSession(res, user.id);
    return json(res, 200, { user: publicUser(user) });
  } catch (error) {
    console.error("Login failed:", error.message);
    return json(res, 503, { error: { code: "AUTH_STORAGE_UNAVAILABLE", message: "Login is temporarily unavailable." } });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try { await clearSession(res, getSessionToken(req)); return json(res, 200, { ok: true }); }
  catch (error) { console.error("Logout failed:", error.message); return json(res, 503, { error: { code: "AUTH_STORAGE_UNAVAILABLE", message: "Logout is temporarily unavailable." } }); }
});

app.delete("/api/auth/account", requireAuth, async (req, res) => {
  try {
    const token = getSessionToken(req);
    if (pool) {
      await ensureSchema();
      await pool.query("DELETE FROM users WHERE id = $1", [req.user.id]);
    } else {
      for (const [sessionToken, session] of sessions.entries()) if (session.userId === req.user.id) sessions.delete(sessionToken);
      for (const [conversationId, conversation] of conversations.entries()) {
        if (conversation.userId === req.user.id) {
          conversation.messageIds.forEach((messageId) => messages.delete(messageId));
          conversations.delete(conversationId);
        }
      }
      users.delete(req.user.email);
    }
    await clearSession(res, token);
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("Account deletion failed:", error.message);
    return json(res, 503, { error: { code: "ACCOUNT_DELETION_UNAVAILABLE", message: "Account deletion is temporarily unavailable." } });
  }
});

app.get("/api/auth/session", async (req, res) => {
  try {
    const token = getSessionToken(req);
    let user = null;
    if (pool) {
      await ensureSchema();
      const result = await pool.query("SELECT u.id, u.name, u.email, u.password_hash, u.role, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > NOW()", [token || ""]);
      user = mapUserRow(result.rows[0]);
    } else { const session = token && sessions.get(token); user = session && findUserById(session.userId); }
    return json(res, 200, { user: user ? publicUser(user) : null });
  } catch (error) { console.error("Session lookup failed:", error.message); return json(res, 503, { error: { code: "AUTH_STORAGE_UNAVAILABLE", message: "Session lookup is temporarily unavailable." } }); }
});

app.get("/api/conversations", requireAuth, async (req, res) => {
  try { const list = await listConversationsForUser(req.user.id, cleanText(req.query.q, 120)); return json(res, 200, { conversations: list.map((conversation) => serializeConversation(conversation)) }); }
  catch (error) { console.error("Conversation list failed:", error.message); return json(res, 503, { error: { code: "DATA_STORAGE_UNAVAILABLE", message: "Conversations are temporarily unavailable." } }); }
});

app.post("/api/conversations", requireAuth, async (req, res) => {
  try {
    const conversation = { id: id("conversation"), userId: req.user.id, title: "New conversation", messageIds: [], messageCount: 0, createdAt: now(), updatedAt: now(), messages: [] };
    if (pool) { await ensureSchema(); const result = await pool.query("INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3) RETURNING id, user_id, title, created_at, updated_at", [conversation.id, conversation.userId, conversation.title]); return json(res, 201, { conversation: serializeConversation(conversationFromRow(result.rows[0], []), true) }); }
    conversations.set(conversation.id, conversation); return json(res, 201, { conversation: serializeConversation(conversation, true) });
  } catch (error) { console.error("Conversation creation failed:", error.message); return json(res, 503, { error: { code: "DATA_STORAGE_UNAVAILABLE", message: "Conversation creation is temporarily unavailable." } }); }
});

app.get("/api/conversations/:conversationId", requireAuth, async (req, res) => {
  try { const conversation = await loadConversation(req.params.conversationId, req.user.id); if (!conversation) return json(res, 404, { error: { code: "NOT_FOUND", message: "Conversation not found." } }); return json(res, 200, { conversation: serializeConversation(conversation, true) }); }
  catch (error) { console.error("Conversation lookup failed:", error.message); return json(res, 503, { error: { code: "DATA_STORAGE_UNAVAILABLE", message: "Conversation is temporarily unavailable." } }); }
});

app.patch("/api/conversations/:conversationId", requireAuth, async (req, res) => {
  const title = cleanText(req.body?.title, 100);
  if (!title) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "A conversation title is required." } });
  try {
    const conversation = await loadConversation(req.params.conversationId, req.user.id); if (!conversation) return json(res, 404, { error: { code: "NOT_FOUND", message: "Conversation not found." } });
    if (pool) { await pool.query("UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3", [title, conversation.id, req.user.id]); return json(res, 200, { conversation: serializeConversation({ ...conversation, title, updatedAt: now() }) }); }
    conversation.title = title; conversation.updatedAt = now(); return json(res, 200, { conversation: serializeConversation(conversation) });
  } catch (error) { console.error("Conversation update failed:", error.message); return json(res, 503, { error: { code: "DATA_STORAGE_UNAVAILABLE", message: "Conversation update is temporarily unavailable." } }); }
});

app.delete("/api/conversations/:conversationId", requireAuth, async (req, res) => {
  try {
    const conversation = await loadConversation(req.params.conversationId, req.user.id); if (!conversation) return json(res, 404, { error: { code: "NOT_FOUND", message: "Conversation not found." } });
    if (pool) await pool.query("DELETE FROM conversations WHERE id = $1 AND user_id = $2", [conversation.id, req.user.id]);
    else { conversation.messageIds.forEach((messageId) => messages.delete(messageId)); conversations.delete(conversation.id); }
    return json(res, 200, { ok: true });
  } catch (error) { console.error("Conversation deletion failed:", error.message); return json(res, 503, { error: { code: "DATA_STORAGE_UNAVAILABLE", message: "Conversation deletion is temporarily unavailable." } }); }
});

app.post("/api/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  const content = cleanText(req.body?.content);
  if (!content) return json(res, 400, { error: { code: "VALIDATION_ERROR", message: "Message content is required." } });
  try {
    const conversation = await loadConversation(req.params.conversationId, req.user.id); if (!conversation) return json(res, 404, { error: { code: "NOT_FOUND", message: "Conversation not found." } });
    const userMessage = { id: id("message"), conversationId: conversation.id, role: "user", content, createdAt: now() };
    if (pool) await pool.query("INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)", [userMessage.id, userMessage.conversationId, userMessage.role, userMessage.content]);
    else { messages.set(userMessage.id, userMessage); conversation.messageIds.push(userMessage.id); }
    const nextTitle = conversation.title === "New conversation" ? content.replace(/\s+/g, " ").slice(0, 48) || "New conversation" : conversation.title;
    if (pool) await pool.query("UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3", [nextTitle, conversation.id, req.user.id]);
    else { conversation.title = nextTitle; conversation.updatedAt = now(); }
    const history = pool ? [...conversation.messages, userMessage] : conversation.messageIds.map((messageId) => messages.get(messageId)).filter(Boolean);
    const sources = shouldSearchWeb(content, req.body?.webSearch === true) ? await searchWeb(content) : [];
    const assistantMessage = { id: id("message"), conversationId: conversation.id, role: "assistant", content: await generateAssistantReply(history, sources), createdAt: now() };
    if (pool) { await pool.query("INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)", [assistantMessage.id, assistantMessage.conversationId, assistantMessage.role, assistantMessage.content]); await pool.query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [conversation.id]); }
    else { messages.set(assistantMessage.id, assistantMessage); conversation.messageIds.push(assistantMessage.id); conversation.updatedAt = now(); }
    const updated = await loadConversation(conversation.id, req.user.id);
    return json(res, 201, { conversation: serializeConversation(updated, true) });
  } catch (error) { console.error("AI request failed:", error.message); return json(res, 502, { error: { code: "AI_PROVIDER_ERROR", message: "nexGen could not complete that response. Try again." } }); }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    let counts = { users: users.size, conversations: conversations.size, messages: messages.size };
    if (pool) { await ensureSchema(); const result = await pool.query("SELECT (SELECT COUNT(*) FROM users)::int AS users, (SELECT COUNT(*) FROM conversations)::int AS conversations, (SELECT COUNT(*) FROM messages)::int AS messages"); counts = result.rows[0]; }
    return json(res, 200, { overview: { ...counts, providerConfigured: Boolean(process.env.GROQ_API_KEY), databaseConfigured: Boolean(pool) } });
  } catch (error) { console.error("Admin overview failed:", error.message); return json(res, 503, { error: { code: "DATA_STORAGE_UNAVAILABLE", message: "Workspace metrics are temporarily unavailable." } }); }
});

app.get("/api/admin/workspace", requireAuth, requireAdmin, (_req, res) => {
  return json(res, 200, {
    workspace: {
      maintenance: maintenanceRequests,
      changes: changeRequests,
      integrations: [
        { id: "groq", name: "Groq", category: "AI provider", status: process.env.GROQ_API_KEY ? "Connected" : "Needs setup", description: "Powers nexGen assistant responses.", docs: "https://console.groq.com/docs" },
        { id: "exa", name: "Exa", category: "Live web search", status: process.env.EXA_API_KEY ? "Connected" : "Needs setup", description: "Adds current web sources to answers.", docs: "https://docs.exa.ai" },
        { id: "database", name: "Persistent database", category: "Infrastructure", status: pool ? "Connected" : "Planned", description: pool ? "Neon Postgres stores accounts, sessions, conversations, and messages." : "Required before user data should be treated as production-persistent.", docs: "https://neon.tech/docs" },
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