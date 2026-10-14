import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  ArrowUp,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileDown,
  Image as ImageIcon,
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
const textFileExtensions = new Set(["txt", "md", "csv", "json", "log", "yaml", "yml", "xml"]);
const maxTextAttachments = 3;
const maxAttachmentCharacters = 8000;
const maxMessageCharacters = 12000;

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

function CreativeResult({ imageUrl, prompt, loading, error, onClose, onDownload }) {
  if (!imageUrl && !loading && !error) return null;
  return <section className="creative-result"><div className="creative-card"><div className="creative-heading"><div><span className="eyebrow">Free AI image</span><strong>{loading ? "Creating your image…" : error ? "Image generation needs a retry" : "Your generated image"}</strong><small>{prompt}</small></div><button className="icon-button" onClick={onClose} aria-label="Close generated image"><X size={17} /></button></div>{loading ? <div className="creative-loading"><span className="pulse-dot" /><span>Generating a free image from your prompt…</span></div> : error ? <p className="creative-error">{error}</p> : <><img className="creative-image" src={imageUrl} alt={prompt} /><div className="creative-actions"><button className="button outline-button" onClick={onDownload}><Download size={15} /> Download PNG</button><small>No watermark, logo, or signature is added.</small></div></>}</div></section>;
}

function ImageSearchResults({ query, results, loading, error, onClose }) {
  if (!query && !loading && !error) return null;
  return <section className="image-search-result" aria-label="Image search results">
    <div className="creative-card">
      <div className="creative-heading">
        <div>
          <span className="eyebrow">Image search · Wikimedia Commons</span>
          <strong>{loading ? "Finding images…" : error ? "Image search needs a retry" : `Images for “${query}”`}</strong>
          <small>Open a result to review its source and reuse license.</small>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close image search results"><X size={17} /></button>
      </div>
      {loading ? <div className="creative-loading" role="status"><span className="pulse-dot" /><span>Searching Wikimedia Commons…</span></div>
        : error ? <p className="creative-error" role="alert">{error}</p>
          : results.length ? <div className="image-search-grid">{results.map((result) => <a className="image-search-item" href={result.pageUrl} target="_blank" rel="noreferrer" key={result.pageUrl}>
            <img src={result.thumbnail} alt={result.title} loading="lazy" />
            <span className="image-search-copy">
              <strong>{result.title}</strong>
              <small>{result.author ? `By ${result.author}` : "Contributor details on source page"}</small>
              <small>{result.license}</small>
              <span className="image-search-source">View source <span aria-hidden="true">↗</span></span>
            </span>
          </a>)}</div>
            : <p className="image-search-empty">No matching images found. Try a shorter or more specific search.</p>}
      {!loading && !error && results.length > 0 && <p className="image-search-credit">Images from Wikimedia Commons. Check each source page for attribution and license terms.</p>}
    </div>
  </section>;
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
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = async (value) => {
    try {
      let copiedValue = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          copiedValue = true;
        } catch { /* Try the legacy browser copy path below. */ }
      }
      if (!copiedValue) {
        const field = document.createElement("textarea");
        field.value = value;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        try {
          field.select();
          copiedValue = document.execCommand("copy");
        } finally {
          field.remove();
        }
      }
      if (!copiedValue) throw new Error("Clipboard is unavailable.");
      setCopied(value);
      setCopyFailed(false);
    } catch {
      setCopied("");
      setCopyFailed(true);
    }
    window.setTimeout(() => { setCopied(""); setCopyFailed(false); }, 1600);
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
          return <div className="code-block"><div className="code-head"><span>{language}</span><button type="button" onClick={() => copy(value)} aria-label={copyFailed ? "Copy failed" : copied === value ? "Copied code" : "Copy code"}>{copyFailed ? "Copy failed" : copied === value ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button></div><pre><code>{value}</code></pre></div>;
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

function Avatar({ assistant = false, name = "" }) {
  return assistant ? <span className="avatar ai-avatar"><span /><span /><span /></span> : <span className="avatar user-avatar">{name.slice(0, 1).toUpperCase()}</span>;
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

function Composer({ value, setValue, onSend, generating, onStop, webSearch, setWebSearch, onGenerateImage, onSearchImages, imageSearchLoading, onDownloadPdf, hasConversation }) {
  const ref = useRef(null);
  const fileInput = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState("");
  useEffect(() => { if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = Math.min(ref.current.scrollHeight, 150) + "px"; } }, [value]);
  const attachFiles = async (event) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (!files.length) return;

    const errors = [];
    const slots = Math.max(0, maxTextAttachments - attachments.length);
    if (files.length > slots) errors.push(`You can attach up to ${maxTextAttachments} text files.`);
    let characterCount = attachments.reduce((total, item) => total + item.content.length, 0);
    const added = [];
    for (const file of files.slice(0, slots)) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!textFileExtensions.has(extension)) {
        errors.push(`${file.name} is not a supported text file.`);
        continue;
      }
      if (file.size > 128 * 1024) {
        errors.push(`${file.name} is larger than the 128 KB limit.`);
        continue;
      }
      try {
        const content = await file.text();
        if (characterCount + content.length > maxAttachmentCharacters) {
          errors.push(`Attached text must total no more than ${maxAttachmentCharacters.toLocaleString()} characters.`);
          continue;
        }
        const id = `${file.name}:${file.lastModified}:${file.size}`;
        if (attachments.some((item) => item.id === id) || added.some((item) => item.id === id)) continue;
        added.push({ id, name: file.name, content });
        characterCount += content.length;
      } catch {
        errors.push(`Could not read ${file.name}.`);
      }
    }
    if (added.length) setAttachments((current) => [...current, ...added]);
    setAttachmentError(errors.join(" "));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (generating) return;
    const content = [
      value.trim(),
      ...attachments.map(({ name, content: fileContent }) => `[Attached file: ${name}]\n${fileContent}`)
    ].filter(Boolean).join("\n\n");
    if (!content) return;
    if (content.length > maxMessageCharacters) {
      setAttachmentError(`The message and attached text must total no more than ${maxMessageCharacters.toLocaleString()} characters.`);
      return;
    }
    const sent = await onSend(content);
    if (sent) {
      setAttachments([]);
      setAttachmentError("");
    } else if (value.trim()) setValue(value);
  };
  return <form className="composer" onSubmit={submit}>
    <input ref={fileInput} className="file-input-hidden" type="file" multiple accept=".txt,.md,.csv,.json,.log,.yaml,.yml,.xml,text/plain,text/markdown,text/csv,application/json,application/xml" onChange={attachFiles} />
    {attachments.length > 0 && <div className="composer-attachments" aria-label="Attached files">{attachments.map((attachment) => <span className="attachment-chip" key={attachment.id}><span>{attachment.name}</span><button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} aria-label={`Remove ${attachment.name}`}><X size={13} /></button></span>)}</div>}
    {attachmentError && <p className="attachment-error" role="alert">{attachmentError}</p>}
    <textarea ref={ref} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }} placeholder="Message nexGen…" rows={1} aria-label="Message nexGen" readOnly={generating} />
    <div className="composer-actions"><div className="composer-left"><span>Shift + Enter for a new line</span><button type="button" className="web-toggle" onClick={onGenerateImage} disabled={generating || !value.trim()} title="Generate a free AI image from your prompt"><ImageIcon size={13} /> Image</button><button type="button" className="web-toggle image-search-toggle" onClick={onSearchImages} disabled={generating || imageSearchLoading || !value.trim()} title="Search Wikimedia Commons for images related to your prompt"><ImageIcon size={13} /> Find images</button><button type="button" className="web-toggle" onClick={onDownloadPdf} disabled={generating || !hasConversation} title="Download this conversation as a PDF"><FileDown size={13} /> PDF</button><button type="button" className={"web-toggle " + (webSearch ? "active" : "")} onClick={() => setWebSearch(!webSearch)} aria-pressed={webSearch}><Search size={13} /> Web</button></div><div><button type="button" className="icon-button composer-tool" onClick={() => fileInput.current?.click()} disabled={generating} aria-label="Attach a text file" title="Attach a text file (TXT, Markdown, CSV, JSON, LOG, YAML, or XML)"><Plus size={18} /></button>{generating ? <button type="button" className="send-button stop" onClick={onStop} aria-label="Stop generating"><Square size={16} fill="currentColor" /></button> : <button className="send-button" disabled={!value.trim() && attachments.length === 0} aria-label="Send message"><ArrowUp size={17} /></button>}</div></div>
  </form>;
}

function SettingsDialog({ user, darkMode, onToggleTheme, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1}>
      <div className="settings-heading"><div><span className="eyebrow">Your workspace</span><h2 id="settings-title">Settings</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close settings"><X size={18} /></button></div>
      <div className="settings-profile"><span className="avatar user-avatar"><UserRound size={16} /></span><div><strong>{user.name}</strong><small>{user.email}</small></div><span className="settings-role">{user.role}</span></div>
      <div className="settings-row"><div><strong>Appearance</strong><small>Choose the theme used on this device.</small></div><button type="button" className="settings-theme-button" onClick={onToggleTheme} aria-pressed={darkMode}>{darkMode ? <Sun size={16} /> : <Moon size={16} />}<span>{darkMode ? "Dark mode" : "Light mode"}</span></button></div>
      <div className="settings-row"><div><strong>Privacy &amp; data</strong><small>Review how your data is handled or delete your account.</small></div><nav className="settings-links" aria-label="Privacy and account links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/delete-account">Delete account</a></nav></div>
      <div className="settings-footer"><button type="button" className="button primary small-button" onClick={onClose}>Done</button></div>
    </section>
  </div>;
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
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [imageSearchResults, setImageSearchResults] = useState([]);
  const [imageSearchLoading, setImageSearchLoading] = useState(false);
  const [imageSearchError, setImageSearchError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    try { return window.localStorage.getItem("nexgen-theme") === "dark"; }
    catch { return false; }
  });
  const messageRequest = useRef(null);

  const loadConversations = async (search = query) => {
    const data = await api(`/api/conversations${search ? `?q=${encodeURIComponent(search)}` : ""}`);
    setConversations(data.conversations);
    return data.conversations;
  };

  useEffect(() => { api("/api/auth/session").then((data) => setUser(data.user)).catch(() => {}).finally(() => setCheckingSession(false)); }, []);
  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    try { window.localStorage.setItem("nexgen-theme", darkMode ? "dark" : "light"); }
    catch { /* Theme still works for this session when storage is disabled. */ }
  }, [darkMode]);
  useEffect(() => { if (user) loadConversations(""); }, [user]);
  useEffect(() => { if (!user) return; const timer = setTimeout(() => loadConversations(query).catch(() => {}), 180); return () => clearTimeout(timer); }, [query, user]);
  useEffect(() => { const handler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); createConversation(); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); });

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
    const content = (prefilled ?? draft).trim();
    if (!content || generating) return false;
    let conversation = activeConversation;
    let controller;
    try {
      if (!conversation) {
        const data = await api("/api/conversations", { method: "POST", body: "{}" });
        conversation = data.conversation;
        setActiveId(conversation.id);
        setActiveConversation(conversation);
        setConversations((items) => [conversation, ...items]);
      }
      setDraft("");
      controller = new AbortController();
      messageRequest.current = controller;
      setGenerating(true);
      const data = await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ content, webSearch }), signal: controller.signal });
      setWebSearch(false);
      setActiveConversation(data.conversation);
      setConversations((items) => [data.conversation, ...items.filter((item) => item.id !== data.conversation.id)]);
      return true;
    } catch (error) {
      if (error.name === "AbortError") {
        if (conversation) {
          try {
            await new Promise((resolve) => window.setTimeout(resolve, 120));
            const data = await api(`/api/conversations/${conversation.id}`);
            setActiveConversation(data.conversation);
          } catch { /* Keep the current transcript if the request was canceled before saving. */ }
        }
        setToast("Response stopped.");
      } else {
        setToast(error.message);
      }
      setTimeout(() => setToast(""), 3200);
      return false;
    } finally {
      if (controller && messageRequest.current === controller) messageRequest.current = null;
      if (controller) setGenerating(false);
    }
  };

  const stopGeneration = () => messageRequest.current?.abort();

  const searchImages = async () => {
    const searchQuery = draft.trim();
    if (searchQuery.length < 2) {
      setToast("Enter at least two characters to search for images.");
      setTimeout(() => setToast(""), 3200);
      return;
    }
    setImageSearchQuery(searchQuery);
    setImageSearchResults([]);
    setImageSearchError("");
    setImageSearchLoading(true);
    closeImage();
    try {
      const data = await api(`/api/images/search?q=${encodeURIComponent(searchQuery)}`);
      setImageSearchResults(data.results || []);
    } catch (error) {
      setImageSearchError(error.message);
    } finally {
      setImageSearchLoading(false);
    }
  };

  const generateImage = () => {
    const prompt = draft.trim();
    if (!prompt) { setToast("Write an image description first."); setTimeout(() => setToast(""), 3200); return; }
    closeImageSearch();
    setImagePrompt(prompt);
    setImageUrl("");
    setImageError("");
    setImageLoading(true);
    const imageUrlToLoad = "https://image.pollinations.ai/prompt/" + encodeURIComponent("Create a polished, safe, high-quality image based on this description. Do not add any watermark, logo, signature, or text unless explicitly requested: " + prompt) + "?width=1024&height=1024&nologo=true&safe=true";
    const preview = new window.Image();
    preview.onload = () => { setImageUrl(imageUrlToLoad); setImageLoading(false); };
    preview.onerror = () => { setImageError("The free image service did not respond. Try the same prompt again."); setImageLoading(false); };
    preview.src = imageUrlToLoad;
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
  const closeImageSearch = () => { setImageSearchQuery(""); setImageSearchResults([]); setImageSearchError(""); setImageSearchLoading(false); };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setUser(null); setConversations([]); setActiveConversation(null); setActiveId(null);
    } catch (error) {
      setToast(error.message);
      setTimeout(() => setToast(""), 3200);
    }
  };

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
    <Sidebar user={user} conversations={conversations} activeId={activeId} query={query} setQuery={setQuery} onNew={() => { setActiveView("chat"); createConversation(); }} onSelect={(id) => { setActiveView("chat"); selectConversation(id); }} onDelete={deleteConversation} onLogout={logout} onDeleteAccount={deleteAccount} onAdmin={() => { setActiveView("admin"); setMobileOpen(false); }} onSettings={() => { setSettingsOpen(true); setMobileOpen(false); }} open={mobileOpen} onClose={() => setMobileOpen(false)} />
    {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
    <main className="chat-shell">
      {activeView === "admin" ? <AdminDashboard onBack={() => setActiveView("chat")} /> : <>
        <header className="topbar"><button type="button" className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="mobile-logo"><Logo compact /></div><div className="conversation-heading">{activeConversation ? <><span className="eyebrow">Conversation</span><strong>{activeConversation.title}</strong></> : <><span className="eyebrow">Monday, September 07</span><strong>Good afternoon, {displayName}</strong></>}</div><div className="topbar-actions"><button type="button" className="theme-button icon-button" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setDarkMode((current) => !current)}><Sun size={17} /><Moon size={17} /></button><button type="button" className="avatar user-avatar small" aria-label="Account settings" onClick={() => setSettingsOpen(true)}>{user.name.slice(0, 1).toUpperCase()}</button></div></header>
        <section className="conversation-view">
          {!activeConversation || activeConversation.messages?.length === 0 ? <EmptyState onPrompt={(prompt) => { setDraft(prompt); }} /> : <div className="message-list">{activeConversation.messages.map((message) => <article className={`message-row ${message.role}`} key={message.id}><Avatar assistant={message.role === "assistant"} name={user.name} /><div className="message-content"><div className="message-meta"><strong>{message.role === "assistant" ? "nexGen" : user.name}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>{message.role === "assistant" ? <MarkdownMessage content={message.content} /> : <p>{message.content}</p>}</div></article>)}{generating && <article className="message-row assistant"><Avatar assistant /><div className="message-content"><div className="message-meta"><strong>nexGen</strong></div><div className="thinking"><span /><span /><span /></div></div></article>}</div>}
        <ImageSearchResults query={imageSearchQuery} results={imageSearchResults} loading={imageSearchLoading} error={imageSearchError} onClose={closeImageSearch} />
        <CreativeResult imageUrl={imageUrl} prompt={imagePrompt} loading={imageLoading} error={imageError} onClose={closeImage} onDownload={downloadImage} />
        </section>
        <div className="composer-wrap"><Composer value={draft} setValue={setDraft} onSend={sendMessage} generating={generating} onStop={stopGeneration} webSearch={webSearch} setWebSearch={setWebSearch} onGenerateImage={generateImage} onSearchImages={searchImages} imageSearchLoading={imageSearchLoading} onDownloadPdf={downloadPdf} hasConversation={Boolean(activeConversation?.messages?.length)} /><p className="disclaimer">nexGen can make mistakes. Check important information.</p></div>
      </>}
    </main>
    {settingsOpen && <SettingsDialog user={user} darkMode={darkMode} onToggleTheme={() => setDarkMode((current) => !current)} onClose={() => setSettingsOpen(false)} />}
    {toast && <div className="toast" role="alert">{toast}<button type="button" onClick={() => setToast("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
  </div>;
}

export default App;