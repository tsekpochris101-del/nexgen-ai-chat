import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  ArrowUp,
  BarChart3,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Feather,
  FileText,
  GitBranch,
  Hash,
  Lightbulb,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  PlugZap,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserRound,
  Wrench,
  X,
  Moon
} from "lucide-react";

const starterPrompts = [
  { icon: Feather, label: "Explain something", prompt: "Explain how neural networks learn, in plain language." },
  { icon: FileText, label: "Help me write", prompt: "Help me write a short, friendly email announcing a product update." },
  { icon: Sparkles, label: "Brainstorm ideas", prompt: "Brainstorm five names for a new productivity app." },
  { icon: Hash, label: "Learn something new", prompt: "Teach me one interesting fact about space, and why it matters." }
];

const repeatStyleChoices = [
  { key: "concise", label: "Keep it concise" },
  { key: "examples", label: "Keep the examples" },
  { key: "structured", label: "Keep the steps" },
  { key: "plain_language", label: "Keep the simple wording" },
  { key: "warm_tone", label: "Keep this warm tone" }
];

const adjustStyleChoices = [
  { key: "concise", label: "Make answers shorter" },
  { key: "detailed", label: "Add more detail" },
  { key: "examples", label: "Add useful examples" },
  { key: "fewer_examples", label: "Use fewer examples" },
  { key: "structured", label: "Use steps or bullets" },
  { key: "plain_language", label: "Use simpler wording" },
  { key: "professional_tone", label: "Use a professional tone" },
  { key: "casual_tone", label: "Use a more casual tone" }
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "Something went wrong.");
  return payload;
}

function safeFileName(value, fallback) {
  const normalized = String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || fallback;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extractImageDescription(value) {
  return String(value || "")
    .trim()
    .replace(/^(please\s+)?(generate|create|make|draw|design|show me|give me)\s+(an?\s+)?(image|picture|photo|illustration|portrait|poster|logo|artwork)\s*(of|showing|depicting|that shows)?\s*/i, "")
    .trim() || String(value || "").trim();
}

function pdfEscape(value) {
  return String(value || "").replace(/[^\x20-\x7E]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfText(value, width = 92) {
  return String(value || "").split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [""];
    const words = line.trim().split(/\s+/);
    const wrapped = [];
    let current = "";
    words.forEach((word) => {
      if (!current) current = word;
      else if ((current + " " + word).length <= width) current += " " + word;
      else { wrapped.push(current); current = word; }
    });
    if (current) wrapped.push(current);
    return wrapped;
  });
}

function buildConversationPdf(title, messages) {
  const lines = ["nexGen conversation", title || "Untitled conversation", new Date().toLocaleString(), ""];
  messages.forEach((message) => {
    lines.push((message.role === "assistant" ? "nexGen" : "You") + ":");
    lines.push(...wrapPdfText(message.content));
    lines.push("");
  });
  const chunks = [];
  for (let index = 0; index < lines.length; index += 46) chunks.push(lines.slice(index, index + 46));
  const pageRefs = chunks.map((_, index) => String(4 + index * 2) + " 0 R");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [" + pageRefs.join(" ") + "] /Count " + chunks.length + " >> endobj",
    "3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj"
  ];
  chunks.forEach((chunk, index) => {
    const contentId = 4 + index * 2;
    const pageId = contentId + 1;
    const stream = ["BT", "/F1 16 Tf", "50 790 Td"];
    chunk.forEach((line, lineIndex) => {
      stream.push("(" + pdfEscape(line) + ") Tj");
      if (lineIndex === 0) stream.push("/F1 10 Tf");
      else stream.push("0 -15 Td");
    });
    stream.push("ET");
    const content = stream.join("\n");
    objects.push(contentId + " 0 obj << /Length " + content.length + " >> stream\n" + content + "\nendstream\nendobj");
    objects.push(pageId + " 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " + contentId + " 0 R >> endobj");
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object) => { offsets.push(pdf.length); pdf += object + "\n"; });
  const xrefOffset = pdf.length;
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) pdf += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";
  return new Blob([pdf], { type: "application/pdf" });
}

function detectRequestType(value) {
  const text = String(value || "").toLowerCase().trim();
  const imageRequest = /\b(generate|create|make|draw|design|show|paint|illustrate|render)\b[\s\S]{0,80}\b(image|picture|photo|illustration|portrait|poster|logo|artwork)\b|^\s*(image|picture|photo|illustration)\s+of\b/.test(text);
  if (imageRequest) return "image";
  const pdfRequest = /\b(create|generate|make|write|prepare|export|download|turn|convert)\b[\s\S]{0,80}\b(pdf|report|document|resume|invoice|study guide|ebook|proposal)\b|\b(pdf|report|document|resume|invoice|study guide|ebook|proposal)\b[\s\S]{0,80}\b(for|about|on|from)\b/.test(text);
  if (pdfRequest) return "pdf";
  return "chat";
}

function CreativeResult({ imageUrl, prompt, loading, error, onClose, onDownload }) {
  if (!imageUrl && !loading && !error) return null;
  return <section className="creative-result"><div className="creative-card"><div className="creative-heading"><div><span className="eyebrow">Free AI image</span><strong>{loading ? "Creating your image…" : error ? "Image generation needs a retry" : "Your generated image"}</strong><small>{prompt}</small></div><button className="icon-button" onClick={onClose} aria-label="Close generated image"><X size={17} /></button></div>{loading ? <div className="creative-loading"><span className="pulse-dot" /><span>Generating a free image from your prompt…</span></div> : error ? <p className="creative-error">{error}</p> : <><img className="creative-image" src={imageUrl} alt={prompt} /><div className="creative-actions"><button className="button outline-button" onClick={onDownload}><Download size={15} /> Download PNG</button><small>No watermark, logo, or signature is added.</small></div></>}</div></section>;
}

function PdfResult({ url, filename, onClose }) {
  if (!url) return null;
  return <section className="creative-result"><div className="creative-card file-result"><div className="creative-heading"><div><span className="eyebrow">Generated PDF</span><strong>Your document is ready</strong><small>{filename}</small></div><button className="icon-button" onClick={onClose} aria-label="Close generated PDF"><X size={17} /></button></div><p className="file-result-message">The AI-written content is inside this PDF. Download it again whenever you need it.</p><a className="button primary file-download" href={url} download={filename}><Download size={15} /> Download PDF</a></div></section>;
}

function Logo({ compact = false }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span className="brand-name">nexGen</span>}
    </div>
  );
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (mode === "signup" && form.password !== form.confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const result = await api(`/api/auth/${mode === "signup" ? "signup" : "login"}`, {
        method: "POST",
        body: JSON.stringify(form)
      });
      onAuthenticated(result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-orb orb-one" />
      <div className="auth-orb orb-two" />
      <section className="auth-card">
        <div className="auth-intro">
          <Logo />
          <span className="eyebrow">Your intelligent AI companion</span>
          <h1>Ideas in.<br /><em>Clarity out.</em></h1>
          <p>Ask better questions, make progress faster, and keep every useful thought in one calm workspace.</p>
          <div className="auth-signal"><span /><span /><span /><span /><b>Private by design</b></div>
        </div>
        <div className="auth-form-wrap">
          <div className="auth-tabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Log in</button>
            <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
          </div>
          <div className="form-heading"><span className="eyebrow">Welcome back</span><h2>{mode === "login" ? "Pick up where you left off." : "Make room for better thinking."}</h2></div>
          <form onSubmit={submit}>
            {mode === "signup" && <label>Name<input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" /></label>}
            <label>Email<input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" required /></label>
            <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" required /></label>
            {mode === "signup" && <label>Confirm password<input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} placeholder="Repeat your password" required /></label>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="button primary full" disabled={busy}>{busy ? "One moment…" : mode === "login" ? "Enter nexGen" : "Create your account"}<ArrowUp size={17} /></button>
          </form>
          <p className="form-footnote">By continuing, you agree to use nexGen responsibly. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
        </div>
      </section>
    </main>
  );
}

function MarkdownMessage({ content }) {
  const [copied, setCopied] = useState("");
  const copy = async (value) => {
    await navigator.clipboard?.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(""), 1600);
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        code({ inline, className, children, ...props }) {
          const value = String(children).replace(/\n$/, "");
          const language = className?.replace("language-", "") || "text";
          if (inline) return <code className="inline-code" {...props}>{children}</code>;
          return <div className="code-block"><div className="code-head"><span>{language}</span><button onClick={() => copy(value)}>{copied === value ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button></div><pre><code>{value}</code></pre></div>;
        },
        table({ children }) {
          return <div className="markdown-table"><table>{children}</table></div>;
        },
        a({ children, href, ...props }) {
          const safeHref = /^https?:\/\//i.test(href || "") ? href : undefined;
          return <a href={safeHref} target="_blank" rel="noreferrer" {...props}>{children}</a>;
        }
      }}
    >{content}</ReactMarkdown>
  );
}

function ResponseFeedback({ messageId, savedKey, saving, onSave }) {
  const [mode, setMode] = useState("");
  const choices = mode === "repeat" ? repeatStyleChoices : adjustStyleChoices;
  return <div className="response-feedback">
    <span className="feedback-label">Tune future replies</span>
    <button type="button" className={`feedback-trigger ${mode === "repeat" ? "selected" : ""}`} onClick={() => setMode((current) => current === "repeat" ? "" : "repeat")} aria-expanded={mode === "repeat"}><ThumbsUp size={13} /> Helpful</button>
    <button type="button" className={`feedback-trigger ${mode === "adjust" ? "selected" : ""}`} onClick={() => setMode((current) => current === "adjust" ? "" : "adjust")} aria-expanded={mode === "adjust"}><ThumbsDown size={13} /> Adjust</button>
    {mode && <div className="feedback-options" role="group" aria-label={mode === "repeat" ? "Choose what to repeat" : "Choose how to adjust future replies"}>{choices.map((choice) => <button type="button" key={choice.key} disabled={saving} className={savedKey === choice.key ? "saved" : ""} onClick={() => onSave(messageId, choice.key)}>{choice.label}</button>)}</div>}
    {savedKey && <small className="feedback-saved" role="status">Preference saved for future replies</small>}
  </div>;
}

function Avatar({ assistant = false, name = "" }) {
  return assistant ? <span className="avatar ai-avatar"><span /><span /><span /></span> : <span className="avatar user-avatar">{name.slice(0, 1).toUpperCase()}</span>;
}

function SettingsModal({ user, onClose, onLogout }) {
  const [memory, setMemory] = useState({ enabled: false, preferences: [] });
  const [preferencesText, setPreferencesText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    api("/api/auth/memory")
      .then(({ memory: loaded }) => {
        setMemory(loaded);
        setPreferencesText((loaded.preferences || []).join("\n"));
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleMemory = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { memory: updated } = await api("/api/auth/memory", {
        method: "PATCH",
        body: JSON.stringify({ enabled: !memory.enabled })
      });
      setMemory(updated);
      setPreferencesText((updated.preferences || []).join("\n"));
      setNotice(updated.enabled ? "Private personalization is on." : "Personalization is off. Saved preferences remain until you clear them.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const savePreferences = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { memory: updated } = await api("/api/auth/memory", {
        method: "PATCH",
        body: JSON.stringify({ preferences: preferencesText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })
      });
      setMemory(updated);
      setPreferencesText((updated.preferences || []).join("\n"));
      setNotice("Your response preferences were saved.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const clearMemory = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { memory: updated } = await api("/api/auth/memory", { method: "DELETE" });
      setMemory(updated);
      setPreferencesText("");
      setNotice("Learned preferences were cleared.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-heading"><div><span className="eyebrow">Preferences</span><h2 id="settings-title">Settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={18} /></button></div><div className="settings-section"><span className="settings-label">Account</span><div className="settings-account"><span className="avatar user-avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div></div><div className="settings-section"><div className="memory-heading"><div><span className="settings-label">Private personalization</span><p>Let nexGen adapt future responses to your communication preferences, such as answer length, examples, tone, and formatting.</p></div><button type="button" role="switch" aria-checked={memory.enabled} className={`memory-switch ${memory.enabled ? "enabled" : ""}`} onClick={toggleMemory} disabled={loading || saving} aria-label="Enable private personalization"><span /></button></div><small className="privacy-note">When enabled, recent user inputs may be sent to Groq to extract short response-style preferences. Only those preferences are saved separately for this account; raw messages remain in chat history, not in the memory profile. This does not train a shared model. You can review, edit, clear, or turn it off at any time.</small>{loading ? <div className="settings-loading">Loading personalization settings…</div> : <form className="memory-editor" onSubmit={savePreferences}><label htmlFor="memory-preferences">Saved response preferences <span>(one per line)</span></label><textarea id="memory-preferences" rows={4} value={preferencesText} onChange={(event) => setPreferencesText(event.target.value)} placeholder={"Prefer concise answers\nUse examples for technical explanations"} disabled={saving} /><div className="memory-actions"><button type="button" className="text-button" onClick={clearMemory} disabled={saving || !memory.preferences.length}>Clear learned preferences</button><button className="button primary small-button" disabled={saving || loading}>{saving ? "Saving…" : "Save preferences"}</button></div></form>}</div><div className="settings-section"><span className="settings-label">Privacy & data</span><div className="settings-links"><a href="/privacy">Privacy policy <ArrowUp size={13} /></a><a href="/terms">Terms of service <ArrowUp size={13} /></a><a href="/delete-account">Account deletion <ArrowUp size={13} /></a></div></div>{error && <div className="form-error settings-feedback" role="alert">{error}</div>}{notice && <div className="settings-notice" role="status">{notice}</div>}<div className="settings-actions"><button className="button outline-button" onClick={onClose}>Done</button><button className="button settings-logout" onClick={onLogout}><LogOut size={15} /> Log out</button></div></section></div>;
}

function Sidebar({ user, conversations, activeId, query, setQuery, onNew, onSelect, onDelete, onLogout, onDeleteAccount, onAdmin, onSettings, open, onClose }) {
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand-row"><Logo /><button className="icon-button close-mobile" onClick={onClose} aria-label="Close navigation"><X size={18} /></button></div>
        <button className="button new-chat" onClick={onNew}><Plus size={17} /> New chat <span>⌘ K</span></button>
        <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" /><kbd>⌘ F</kbd></div>
      </div>
      <div className="history">
        <div className="section-label">Recent chats</div>
        {conversations.length === 0 ? <div className="history-empty"><MessageSquare size={18} /><p>{query ? "No matching chats" : "Your conversations will appear here."}</p></div> : conversations.map((conversation) => (
          <div key={conversation.id} className={`history-item ${activeId === conversation.id ? "selected" : ""}`}>
            <button onClick={() => onSelect(conversation.id)}><MessageSquare size={15} /><span>{conversation.title}</span></button>
            <button className="history-more" onClick={() => onDelete(conversation.id)} aria-label={`Delete ${conversation.title}`}><MoreHorizontal size={16} /></button>
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        {user.role === "admin" && <button className="sidebar-action admin-action" onClick={onAdmin}><BarChart3 size={17} /> Admin dashboard</button>}
        <button className="sidebar-action" onClick={onSettings}><Settings size={17} /> Settings</button>
        <button className="sidebar-action" onClick={onDeleteAccount}><Trash2 size={17} /> Delete account</button>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", padding: "4px 4px 10px", fontSize: "11px" }}><a href="/privacy" style={{ color: "inherit" }}>Privacy</a><a href="/terms" style={{ color: "inherit" }}>Terms</a><a href="/delete-account" style={{ color: "inherit" }}>Account deletion</a></div>
        <div className="account-row"><span className="avatar user-avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small></div><button className="icon-button" onClick={onLogout} aria-label="Log out"><LogOut size={16} /></button></div>
      </div>
    </aside>
  );
}

function EmptyState({ onPrompt }) {
  return <div className="empty-state"><div className="welcome-mark"><Sparkles size={22} /></div><span className="eyebrow">Good to see you</span><h1>How can I help?</h1><p>Ask nexGen anything. Start with a thought, a question, or a blank page.</p><div className="prompt-grid">{starterPrompts.map(({ icon: Icon, label, prompt }) => <button className="prompt-card" key={label} onClick={() => onPrompt(prompt)}><span className="prompt-icon"><Icon size={17} /></span><span><strong>{label}</strong><small>{prompt}</small></span><ArrowUp size={16} /></button>)}</div></div>;
}

function AdminRequestCard({ item, onStatusChange }) {
  return <article className="admin-request-card">
    <div className="admin-card-top"><div><span className="admin-card-kicker">{item.area || "Maintenance"} · {item.priority}</span><h3>{item.title}</h3></div><select value={item.status} onChange={(event) => onStatusChange(item.id, event.target.value)} aria-label={`Update ${item.title} status`}><option>Open</option><option>In progress</option><option>Blocked</option><option>Done</option></select></div>
    <p>{item.description}</p>
    <small>Requested by {item.createdBy} · {new Date(item.createdAt).toLocaleDateString()}</small>
  </article>;
}

function IntegrationCard({ integration }) {
  const connected = integration.status === "Connected";
  return <article className="integration-card">
    <div className="integration-icon"><PlugZap size={18} /></div>
    <div className="integration-copy"><div className="integration-title"><h3>{integration.name}</h3><span className={`status-pill ${connected ? "success" : integration.status === "Planned" ? "planned" : "neutral"}`}><span />{integration.status}</span></div><span className="admin-card-kicker">{integration.category}</span><p>{integration.description}</p>{integration.docs && <a href={integration.docs} target="_blank" rel="noreferrer">View provider docs <ArrowUp size={13} /></a>}</div>
  </article>;
}

function AdminDashboard({ onBack }) {
  const [overview, setOverview] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [formType, setFormType] = useState("");
  const [form, setForm] = useState({ title: "", description: "", priority: "Medium", area: "Product" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loadAdminData = () => Promise.all([api("/api/admin/overview"), api("/api/admin/workspace")]).then(([metrics, data]) => { setOverview(metrics.overview); setWorkspace(data.workspace); }).catch((requestError) => setError(requestError.message));
  useEffect(() => { loadAdminData(); }, []);

  const submitRequest = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/admin/${formType}`, { method: "POST", body: JSON.stringify(form) });
      setForm({ title: "", description: "", priority: "Medium", area: "Product" });
      setFormType("");
      await loadAdminData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (type, requestId, status) => {
    try {
      await api(`/api/admin/${type}/${requestId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadAdminData();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const requests = workspace ? [...workspace.maintenance, ...workspace.changes] : [];
  const tabItems = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "requests", label: "Requests", icon: Wrench, count: requests.filter((item) => item.status !== "Done").length },
    { id: "integrations", label: "API integrations", icon: PlugZap },
    { id: "roadmap", label: "Future features", icon: Lightbulb }
  ];

  return <div className="admin-page">
    <div className="admin-header"><div><span className="eyebrow">Admin workspace</span><h1>Run nexGen with intention.</h1><p>Monitor the product, capture maintenance work, and keep the next useful ideas visible.</p></div><button className="button admin-back" onClick={onBack}>Back to chat <ArrowUp size={15} /></button></div>
    <nav className="admin-tabs" aria-label="Admin sections">{tabItems.map(({ id: tabId, label, icon: Icon, count }) => <button key={tabId} className={activeTab === tabId ? "active" : ""} onClick={() => setActiveTab(tabId)}><Icon size={16} />{label}{count > 0 && <span className="tab-count">{count}</span>}</button>)}</nav>
    {error && <div className="form-error admin-error" role="alert">{error}</div>}
    {!workspace || !overview ? <div className="admin-loading"><span className="pulse-dot" /> Loading workspace…</div> : <>
      {activeTab === "overview" && <section className="admin-section">
        <div className="metric-grid">
          <div className="metric-card"><span>Registered users</span><strong>{overview.users}</strong><small>All server-side accounts</small></div>
          <div className="metric-card"><span>Conversations</span><strong>{overview.conversations}</strong><small>Created across the app</small></div>
          <div className="metric-card"><span>Messages</span><strong>{overview.messages}</strong><small>User and assistant messages</small></div>
          <div className="metric-card"><span>AI provider</span><strong>{overview.providerConfigured ? "Live" : "Mock"}</strong><small>{overview.providerConfigured ? "Groq is connected" : "Add a provider key"}</small></div>
        </div>
        <div className="admin-overview-grid">
          <section className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">Needs attention</span><h2>Open requests</h2></div><button className="text-button" onClick={() => setActiveTab("requests")}>View all <ArrowUp size={13} /></button></div>{requests.filter((item) => item.status !== "Done").slice(0, 3).map((item) => <div className="mini-request" key={item.id}><span className={`request-dot ${item.status === "In progress" ? "progress" : ""}`} /><div><strong>{item.title}</strong><small>{item.area || "Maintenance"} · {item.status}</small></div></div>)}{!requests.filter((item) => item.status !== "Done").length && <div className="panel-empty"><CheckCircle2 size={19} /><span>No open requests. The house is in order.</span></div>}</section>
          <section className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">System map</span><h2>Connection health</h2></div><button className="text-button" onClick={() => setActiveTab("integrations")}>Manage <ArrowUp size={13} /></button></div>{workspace.integrations.slice(0, 3).map((integration) => <div className="health-row" key={integration.id}><span className={`health-dot ${integration.status === "Connected" ? "good" : ""}`} /><span>{integration.name}</span><small>{integration.status}</small></div>)}</section>
        </div>
      </section>}
      {activeTab === "requests" && <section className="admin-section">
        <div className="section-toolbar"><div><span className="eyebrow">Operations queue</span><h2>Maintenance & change requests</h2><p>Turn rough edges and product ideas into trackable work.</p></div><div className="request-actions"><button className="button outline-button" onClick={() => setFormType("maintenance")}><Wrench size={15} /> Request maintenance</button><button className="button primary small-button" onClick={() => setFormType("changes")}><GitBranch size={15} /> Request a change</button></div></div>
        {formType && <form className="request-form" onSubmit={submitRequest}><div className="form-heading-row"><div><span className="eyebrow">{formType === "maintenance" ? "Maintenance request" : "Change request"}</span><h3>{formType === "maintenance" ? "What needs attention?" : "What should evolve?"}</h3></div><button type="button" className="icon-button" onClick={() => setFormType("")} aria-label="Close request form"><X size={17} /></button></div><div className="form-row"><label>Title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={formType === "maintenance" ? "Example: Fix login redirect" : "Example: Add team workspaces"} /></label><label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>Low</option><option>Medium</option><option>High</option></select></label></div>{formType === "changes" && <label>Area<select value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })}><option>Product</option><option>UX</option><option>Security</option><option>Infrastructure</option><option>AI experience</option></select></label>}<label>Description<textarea required rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Add enough context for the next person to act." /></label><div className="form-actions"><button type="button" className="button outline-button" onClick={() => setFormType("")}>Cancel</button><button className="button primary small-button" disabled={saving}>{saving ? "Saving…" : "Create request"}<ArrowUp size={14} /></button></div></form>}
        <div className="request-columns"><div><div className="column-heading"><Wrench size={16} /><h3>Maintenance</h3><span>{workspace.maintenance.length}</span></div>{workspace.maintenance.length ? workspace.maintenance.map((item) => <AdminRequestCard item={item} key={item.id} onStatusChange={(id, status) => updateStatus("maintenance", id, status)} />) : <div className="empty-admin-card"><Wrench size={19} /><strong>No maintenance requests</strong><span>Log the first issue when something needs care.</span></div>}</div><div><div className="column-heading"><GitBranch size={16} /><h3>Changes</h3><span>{workspace.changes.length}</span></div>{workspace.changes.length ? workspace.changes.map((item) => <AdminRequestCard item={item} key={item.id} onStatusChange={(id, status) => updateStatus("changes", id, status)} />) : <div className="empty-admin-card"><GitBranch size={19} /><strong>No change requests</strong><span>Capture the next improvement before it gets lost.</span></div>}</div></div>
      </section>}
      {activeTab === "integrations" && <section className="admin-section"><div className="section-toolbar"><div><span className="eyebrow">System map</span><h2>API integrations</h2><p>See what powers nexGen today and what still needs a connection.</p></div><button className="button outline-button" onClick={loadAdminData}><RefreshCw size={15} /> Refresh status</button></div><div className="integration-grid">{workspace.integrations.map((integration) => <IntegrationCard key={integration.id} integration={integration} />)}</div><div className="integration-note"><PlugZap size={17} /><span>Credentials stay server-side. Add new providers through environment variables or a future integrations manager—not in the browser.</span></div></section>}
      {activeTab === "roadmap" && <section className="admin-section"><div className="section-toolbar"><div><span className="eyebrow">Product horizon</span><h2>What could come next</h2><p>A lightweight backlog for capabilities that can make nexGen more durable and useful.</p></div><button className="button outline-button" onClick={() => { setActiveTab("requests"); setFormType("changes"); }}><Plus size={15} /> Add an idea</button></div><div className="roadmap-grid">{workspace.roadmap.map((item) => <article className="roadmap-card" key={item.id}><div className="roadmap-top"><span className="roadmap-category">{item.category}</span><span className={`status-pill ${item.status === "Planned" ? "planned" : "neutral"}`}><span />{item.status}</span></div><h3>{item.title}</h3><p>{item.description}</p><small>{item.priority} priority</small></article>)}</div></section>}
    </>}
  </div>;
}

function Composer({ value, setValue, onSend, generating, onStop, webSearch, setWebSearch, attachments, onAttachFiles, onTakePicture, onRemoveAttachment }) {
  const ref = useRef(null);
  const documentInput = useRef(null);
  const cameraInput = useRef(null);
  const [attachmentMenu, setAttachmentMenu] = useState(false);
  useEffect(() => { if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = Math.min(ref.current.scrollHeight, 150) + "px"; } }, [value]);
  const submit = (event) => { event.preventDefault(); if (!generating && (value.trim() || attachments.length)) onSend(); };
  const chooseDocuments = (event) => { onAttachFiles(Array.from(event.target.files || [])); event.target.value = ""; setAttachmentMenu(false); };
  const choosePicture = (event) => { onAttachFiles(Array.from(event.target.files || [])); event.target.value = ""; setAttachmentMenu(false); };
  return <form className="composer" onSubmit={submit}><input ref={documentInput} className="hidden-file-input" type="file" accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.xlsx,.xls,image/*" multiple onChange={chooseDocuments} /><input ref={cameraInput} className="hidden-file-input" type="file" accept="image/*" capture="environment" onChange={choosePicture} /><div className="attachment-list">{attachments.map((attachment) => <div className="attachment-chip" key={attachment.id}>{attachment.preview ? <img src={attachment.preview} alt="" /> : <FileText size={14} />}<span title={attachment.file.name}>{attachment.file.name}</span><button type="button" onClick={() => onRemoveAttachment(attachment.id)} aria-label={`Remove ${attachment.file.name}`}><X size={13} /></button></div>)}</div><textarea ref={ref} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }} placeholder="Message nexGen…" rows={1} aria-label="Message nexGen" /><div className="composer-actions"><div className="composer-left"><span>Ask a question, or request an image/PDF</span><button type="button" className={"web-toggle " + (webSearch ? "active" : "")} onClick={() => setWebSearch(!webSearch)} aria-pressed={webSearch}><Search size={13} /> Web</button></div><div className="composer-right"><div className="attach-wrap"><button type="button" className="icon-button composer-tool" onClick={() => setAttachmentMenu((open) => !open)} aria-label="Attach a document or take a picture" aria-expanded={attachmentMenu}><Plus size={18} /></button>{attachmentMenu && <div className="attach-menu" role="menu"><button type="button" onClick={() => documentInput.current?.click()}><FileText size={15} /> Upload document or photo</button><button type="button" onClick={() => cameraInput.current?.click()}><Camera size={15} /> Take a picture</button></div>}</div>{generating ? <button type="button" className="send-button stop" onClick={onStop} aria-label="Stop generating"><Square size={16} fill="currentColor" /></button> : <button className="send-button" disabled={!value.trim() && !attachments.length} aria-label="Send message"><ArrowUp size={17} /></button>}</div></div></form>;
}

function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeConversation, setActiveConversation] = useState(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [activeView, setActiveView] = useState("chat");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackSelections, setFeedbackSelections] = useState({});
  const [feedbackSavingId, setFeedbackSavingId] = useState("");

  const saveResponseFeedback = async (messageId, preferenceKey) => {
    setFeedbackSavingId(messageId);
    try {
      await api("/api/auth/memory/feedback", {
        method: "POST",
        body: JSON.stringify({ messageId, preferenceKey })
      });
      setFeedbackSelections((current) => ({ ...current, [messageId]: preferenceKey }));
      setToast("Preference saved for future replies.");
      setTimeout(() => setToast(""), 2600);
    } catch (error) {
      if (error.message.includes("Enable Private personalization")) {
        setSettingsOpen(true);
        setToast("Turn on Private personalization in Settings to save this feedback.");
        setTimeout(() => setToast(""), 4200);
      } else {
        setToast(error.message);
        setTimeout(() => setToast(""), 3200);
      }
    } finally {
      setFeedbackSavingId("");
    }
  };

  const loadConversations = async (search = query) => {
    const data = await api(`/api/conversations${search ? `?q=${encodeURIComponent(search)}` : ""}`);
    setConversations(data.conversations);
    return data.conversations;
  };

  useEffect(() => { api("/api/auth/session").then((data) => setUser(data.user)).catch(() => {}).finally(() => setCheckingSession(false)); }, []);
  useEffect(() => { if (user) loadConversations(""); }, [user]);
  useEffect(() => { if (!user) return; const timer = setTimeout(() => loadConversations(query).catch(() => {}), 180); return () => clearTimeout(timer); }, [query, user]);
  useEffect(() => { const handler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); createConversation(); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); });
  useEffect(() => () => { if (pdfFile?.url) URL.revokeObjectURL(pdfFile.url); }, [pdfFile]);
  useEffect(() => () => { attachments.forEach((attachment) => { if (attachment.preview) URL.revokeObjectURL(attachment.preview); }); }, [attachments]);

  const createConversation = async () => {
    const latest = conversations[0];
    if (latest?.messageCount === 0) { setActiveId(latest.id); setActiveConversation({ ...latest, messages: [] }); setDraft(""); return; }
    const data = await api("/api/conversations", { method: "POST", body: "{}" });
    setConversations((items) => [data.conversation, ...items]);
    setActiveId(data.conversation.id);
    setActiveConversation(data.conversation);
    setDraft("");
    setMobileOpen(false);
  };

  const selectConversation = async (id) => {
    const data = await api(`/api/conversations/${id}`);
    setActiveId(id);
    setActiveConversation(data.conversation);
    setMobileOpen(false);
  };

  const deleteConversation = async (id) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    await api(`/api/conversations/${id}`, { method: "DELETE" });
    const remaining = conversations.filter((item) => item.id !== id);
    setConversations(remaining);
    if (activeId === id) { setActiveId(null); setActiveConversation(null); }
  };

  const sendMessage = async (prefilled) => {
    const typedContent = (prefilled ?? draft).trim();
    const content = typedContent || "Please review the attached file(s) and help me with them.";
    if (!content || generating) return;
    const requestType = detectRequestType(content);
    if (requestType === "image") {
      setDraft("");
      setGenerating(true);
      try {
        await generateImage(content);
      } finally {
        setGenerating(false);
      }
      clearAttachments();
      return;
    }
    const attachmentNote = attachments.length ? `\n\nAttached file(s): ${attachments.map((attachment) => attachment.file.name).join(", ")}.` : "";
    const messageContent = content + attachmentNote;
    let conversation = activeConversation;
    if (!conversation) {
      const data = await api("/api/conversations", { method: "POST", body: "{}" });
      conversation = data.conversation;
      setActiveId(conversation.id);
      setActiveConversation(conversation);
      setConversations((items) => [conversation, ...items]);
    }
    setDraft("");
    setGenerating(true);
    try {
      const data = await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ content: messageContent, webSearch, outputMode: requestType }) });
      setWebSearch(false);
      setActiveConversation(data.conversation);
      setConversations((items) => [data.conversation, ...items.filter((item) => item.id !== data.conversation.id)]);
      if (requestType === "pdf") {
        const filename = safeFileName(data.conversation.title, "nexgen-document") + ".pdf";
        const pdfBlob = buildConversationPdf(data.conversation.title, data.conversation.messages);
        const pdfUrl = URL.createObjectURL(pdfBlob);
        setPdfFile((previous) => {
          if (previous?.url) URL.revokeObjectURL(previous.url);
          return { url: pdfUrl, filename };
        });
        downloadBlob(pdfBlob, filename);
        setToast("Your PDF was generated and downloaded.");
        setTimeout(() => setToast(""), 3200);
      }
      clearAttachments();
    } catch (error) {
      setToast(error.message);
      setTimeout(() => setToast(""), 3200);
    } finally { setGenerating(false); }
  };

  const clearAttachments = () => setAttachments((current) => {
    current.forEach((attachment) => { if (attachment.preview) URL.revokeObjectURL(attachment.preview); });
    return [];
  });

  const addAttachments = (files) => {
    const accepted = [];
    files.forEach((file) => {
      if (file.size > 15 * 1024 * 1024) {
        setToast(`${file.name} is larger than 15 MB.`);
        setTimeout(() => setToast(""), 3200);
        return;
      }
      accepted.push({ id: `${file.name}-${file.lastModified}-${Math.random()}`, file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" });
    });
    if (accepted.length) setAttachments((current) => [...current, ...accepted]);
  };

  const removeAttachment = (attachmentId) => setAttachments((current) => {
    const removed = current.find((attachment) => attachment.id === attachmentId);
    if (removed?.preview) URL.revokeObjectURL(removed.preview);
    return current.filter((attachment) => attachment.id !== attachmentId);
  });

  const generateImage = (requestedPrompt = draft.trim()) => {
    const prompt = requestedPrompt.trim();
    if (!prompt) { setToast("Write an image description first."); setTimeout(() => setToast(""), 3200); return; }
    setImagePrompt(prompt);
    setImageUrl("");
    setImageError("");
    setImageLoading(true);
    const description = extractImageDescription(prompt);
    const imageUrlToLoad = "https://image.pollinations.ai/prompt/" + encodeURIComponent("Match this image description exactly and follow every specified subject, action, setting, color, material, composition, mood, and style detail: " + description + ". Do not add any watermark, logo, signature, label, or generated brand text. If the description explicitly requires a watermark or brand mark, use only the exact text nexGen AI; never use another service or company name.") + "?width=1024&height=1024&nologo=true&safe=true";
    return new Promise((resolve) => {
      const preview = new window.Image();
      preview.onload = () => { setImageUrl(imageUrlToLoad); setImageLoading(false); resolve(true); };
      preview.onerror = () => { setImageError("The free image service did not respond. Try the same prompt again."); setImageLoading(false); resolve(false); };
      preview.src = imageUrlToLoad;
    });
  };

  const downloadImage = async () => {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("Image download failed");
      downloadBlob(await response.blob(), safeFileName(imagePrompt, "nexgen-image") + ".png");
    } catch (_error) {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    }
  };

  const downloadPdf = () => {
    if (!activeConversation?.messages?.length) { setToast("Start a conversation before downloading a PDF."); setTimeout(() => setToast(""), 3200); return; }
    downloadBlob(buildConversationPdf(activeConversation.title, activeConversation.messages), safeFileName(activeConversation.title, "nexgen-conversation") + ".pdf");
    setToast("PDF downloaded.");
    setTimeout(() => setToast(""), 2200);
  };

  const closeImage = () => { setImageUrl(""); setImagePrompt(""); setImageLoading(false); setImageError(""); };
  const closePdf = () => setPdfFile((previous) => {
    if (previous?.url) URL.revokeObjectURL(previous.url);
    return null;
  });

  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); setUser(null); setConversations([]); setActiveConversation(null); setActiveId(null); };

  const deleteAccount = async () => {
    if (!window.confirm("Delete your nexGen account and every conversation? This cannot be undone.")) return;
    try {
      await api("/api/auth/account", { method: "DELETE" });
      setUser(null); setConversations([]); setActiveConversation(null); setActiveId(null);
    } catch (error) {
      setToast(error.message); setTimeout(() => setToast(""), 3200);
    }
  };
  const displayName = useMemo(() => user?.name?.split(" ")[0] || "there", [user]);
  if (checkingSession) return <div className="loading-screen"><Logo /><span className="pulse-dot" /></div>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return <div className="app-shell">
    <Sidebar user={user} conversations={conversations} activeId={activeId} query={query} setQuery={setQuery} onNew={() => { setActiveView("chat"); createConversation(); }} onSelect={(id) => { setActiveView("chat"); selectConversation(id); }} onDelete={deleteConversation} onLogout={logout} onDeleteAccount={deleteAccount} onSettings={() => { setSettingsOpen(true); setMobileOpen(false); }} onAdmin={() => { setActiveView("admin"); setMobileOpen(false); }} open={mobileOpen} onClose={() => setMobileOpen(false)} />
    {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
    <main className="chat-shell">
      {activeView === "admin" ? <AdminDashboard onBack={() => setActiveView("chat")} /> : <>
        <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="mobile-logo"><Logo compact /></div><div className="conversation-heading">{activeConversation ? <><span className="eyebrow">Conversation</span><strong>{activeConversation.title}</strong></> : <><span className="eyebrow">Monday, September 07</span><strong>Good afternoon, {displayName}</strong></>}</div><div className="topbar-actions"><button className="theme-button icon-button" aria-label="Toggle theme" onClick={() => document.body.classList.toggle("dark")}><Sun size={17} /><Moon size={17} /></button><button className="avatar user-avatar small" aria-label="Account">{user.name.slice(0, 1).toUpperCase()}</button></div></header>
        <section className="conversation-view">
          {!activeConversation || activeConversation.messages?.length === 0 ? <EmptyState onPrompt={(prompt) => { setDraft(prompt); }} /> : <div className="message-list">{activeConversation.messages.map((message) => <article className={`message-row ${message.role}`} key={message.id}><Avatar assistant={message.role === "assistant"} name={user.name} /><div className="message-content"><div className="message-meta"><strong>{message.role === "assistant" ? "nexGen" : user.name}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>{message.role === "assistant" ? <><MarkdownMessage content={message.content} /><ResponseFeedback messageId={message.id} savedKey={feedbackSelections[message.id]} saving={feedbackSavingId === message.id} onSave={saveResponseFeedback} /></> : <p>{message.content}</p>}</div></article>)}{generating && <article className="message-row assistant"><Avatar assistant /><div className="message-content"><div className="message-meta"><strong>nexGen</strong></div><div className="thinking"><span /><span /><span /></div></div></article>}</div>}
        <CreativeResult imageUrl={imageUrl} prompt={imagePrompt} loading={imageLoading} error={imageError} onClose={closeImage} onDownload={downloadImage} />
         <PdfResult url={pdfFile?.url} filename={pdfFile?.filename} onClose={closePdf} />
        </section>
          <div className="composer-wrap"><Composer value={draft} setValue={setDraft} onSend={() => sendMessage()} generating={generating} onStop={() => setGenerating(false)} webSearch={webSearch} setWebSearch={setWebSearch} attachments={attachments} onAttachFiles={addAttachments} onTakePicture={addAttachments} onRemoveAttachment={removeAttachment} /><p className="disclaimer">nexGen can make mistakes. Check important information.</p></div>
      </>}
    </main>
    {settingsOpen && <SettingsModal user={user} onClose={() => setSettingsOpen(false)} onLogout={() => { setSettingsOpen(false); logout(); }} />}
    {toast && <div className="toast" role="alert">{toast}<button onClick={() => setToast("")}><X size={15} /></button></div>}
  </div>;
}

export default App;