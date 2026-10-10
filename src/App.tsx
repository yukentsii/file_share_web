import { useState, useRef, useEffect, useCallback, Fragment } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type Route = "main" | "admin" | "video"
type UploadPhase = "idle" | "expanded" | "uploading" | "complete"
type DownloadPhase = "idle" | "expanded" | "loading" | "error" | "ready"
type LimitMode = "unlimited" | "custom"

interface AuthUser {
  id: string
  username: string
  role?: string
}

interface AdminUser {
  id: string
  username: string
  role: string
  status: "active" | "disabled"
  created_at: number
  last_login: number | null
}

interface FileRow {
  id: string
  name: string
  originalName: string
  ext: string
  size: string
  sizeBytes: number
  uploadedAt: string
  maxDownloads: number | null
  usedDownloads: number
  status: "active" | "expired"
  code: string
}

interface ReadyFile {
  name: string
  originalName: string
  ext: string
  size: string
  code: string
  maxDownloads: number | null
  usedDownloads: number
  status: "active" | "expired"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`
  return `${n} B`
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return "Finishing upload..."
  if (seconds < 60) return `~${seconds}s remaining`
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `~${mins}m ${secs}s remaining` : `~${mins}m remaining`
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return mins > 0 ? `~${hours}h ${mins}m remaining` : `~${hours}h remaining`
}

function getInitialCodeFromUrl(): string {
  const path = window.location.pathname
  const match = path.match(/^\/d\/([A-Za-z0-9]{3}-?[A-Za-z0-9]{3})$/)
  if (match) {
    const raw = match[1].toUpperCase()
    return raw.includes("-") ? raw : `${raw.slice(0, 3)}-${raw.slice(3)}`
  }
  const params = new URLSearchParams(window.location.search)
  const codeParam = params.get("code")
  if (codeParam) {
    const raw = codeParam.toUpperCase().replace(/[^A-Z0-9]/g, "")
    if (raw.length === 6) return `${raw.slice(0, 3)}-${raw.slice(3)}`
  }
  return ""
}

// ─── Icons (inline SVG) ───────────────────────────────────────────────────────

const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 10V3M5 6l3-3 3 3" />
    <path d="M2 11v1.5A1.5 1.5 0 003.5 14h9A1.5 1.5 0 0014 12.5V11" />
  </svg>
)

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v7M5 7l3 3 3-3" />
    <path d="M2 11v1.5A1.5 1.5 0 003.5 14h9A1.5 1.5 0 0014 12.5V11" />
  </svg>
)

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="7.5" height="7.5" rx="1.2" />
    <path d="M2 9V2.5A.5.5 0 012.5 2H9" />
  </svg>
)

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 3.5h10M5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M3 3.5l.75 7a.5.5 0 00.5.5h5.5a.5.5 0 00.5-.5L11 3.5" />
  </svg>
)

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s ease" }}
  >
    <path d="M3 5l4 4 4-4" />
  </svg>
)

const LinkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5.5 7.5a3 3 0 004.2.3l1.5-1.5a3 3 0 00-4.2-4.2L5.8 3.3" />
    <path d="M7.5 5.5a3 3 0 00-4.2-.3L1.8 6.7a3 3 0 004.2 4.2l1.2-1.2" />
  </svg>
)

const SunIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
)

const MoonIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
)

function ThemeToggle({ theme, toggleTheme }: { theme: "light" | "dark"; toggleTheme: () => void }) {
  const isDark = theme === "dark"
  return (
    <div className="theme-toggle-container">
      <button
        onClick={toggleTheme}
        className="theme-toggle-track"
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        title={`Switch to ${isDark ? "light" : "dark"} mode`}
      >
        <span style={{ paddingLeft: 6, display: "flex", alignItems: "center", color: "#F59E0B", opacity: isDark ? 0.35 : 0.9, transition: "opacity 0.2s ease" }}>
          <SunIcon />
        </span>
        <span style={{ paddingRight: 6, display: "flex", alignItems: "center", color: "#F9F8F6", opacity: isDark ? 0.9 : 0.35, transition: "opacity 0.2s ease" }}>
          <MoonIcon />
        </span>
        <div className="theme-toggle-thumb">
          {isDark ? <MoonIcon /> : <SunIcon />}
        </div>
      </button>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PillButton({
  children, onClick, dark = false, small = false, disabled = false, style: extraStyle = {}
}: {
  children: React.ReactNode
  onClick?: () => void
  dark?: boolean
  small?: boolean
  disabled?: boolean
  style?: React.CSSProperties
}) {
  return (
    <button
      className="btn-press"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: small ? "7px 16px" : "10px 22px",
        borderRadius: 9999,
        border: dark ? "none" : "1px solid var(--border-card)",
        background: dark ? "var(--btn-primary-bg)" : "var(--btn-secondary-bg)",
        color: dark ? "var(--btn-primary-text)" : "var(--btn-secondary-text)",
        fontSize: small ? 12 : 13,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        transition: "transform 0.1s ease, opacity 0.12s ease, background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease",
        ...extraStyle
      }}
    >
      {children}
    </button>
  )
}

function SegmentToggle({ value, onChange }: { value: LimitMode; onChange: (v: LimitMode) => void }) {
  return (
    <div style={{
      display: "inline-flex",
      border: "1px solid var(--border-card)",
      borderRadius: 9999,
      overflow: "hidden",
      background: "var(--bg-subtle)",
      transition: "background-color 0.2s ease, border-color 0.2s ease",
    }}>
      {(["unlimited", "custom"] as LimitMode[]).map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            padding: "7px 18px",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "inherit",
            border: "none",
            cursor: "pointer",
            borderRadius: 9999,
            background: value === opt ? "var(--btn-primary-bg)" : "transparent",
            color: value === opt ? "var(--btn-primary-text)" : "var(--text-secondary)",
            transition: "background 0.18s ease, color 0.18s ease",
            letterSpacing: "0.02em",
          }}
        >
          {opt === "unlimited" ? "unlimited" : "custom limit"}
        </button>
      ))}
    </div>
  )
}

// ─── Inline Login Form ────────────────────────────────────────────────────────

function InlineLoginForm({
  onLogin,
  title = "sign in to continue",
  subtitle = "enter your credentials to proceed",
}: {
  onLogin: (u: string, p: string) => Promise<{ success: boolean; error?: string }>
  title?: string
  subtitle?: string
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!username.trim() || !password) {
      setError("enter both username and password")
      return
    }
    setLoading(true)
    setError(null)
    const res = await onLogin(username.trim(), password)
    if (!res.success) {
      setError(res.error || "invalid credentials")
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 18,
          color: "var(--text-primary)",
          letterSpacing: "-0.02em",
          marginBottom: 4,
          textTransform: "lowercase",
        }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", textTransform: "lowercase" }}>
          {subtitle}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="username"
          autoCapitalize="none"
          autoCorrect="off"
          style={{
            width: "100%",
            padding: "11px 14px",
            border: "1px solid var(--input-border)",
            borderRadius: 10,
            fontSize: 13,
            fontFamily: "inherit",
            background: "var(--input-bg)",
            color: "var(--text-primary)",
            outline: "none",
            transition: "border-color 0.15s ease",
            textTransform: "lowercase",
          }}
          onFocus={e => (e.currentTarget.style.borderColor = "var(--input-border-focus)")}
          onBlur={e => (e.currentTarget.style.borderColor = "var(--input-border)")}
        />

        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="password"
          style={{
            width: "100%",
            padding: "11px 14px",
            border: "1px solid var(--input-border)",
            borderRadius: 10,
            fontSize: 13,
            fontFamily: "inherit",
            background: "var(--input-bg)",
            color: "var(--text-primary)",
            outline: "none",
            transition: "border-color 0.15s ease",
          }}
          onFocus={e => (e.currentTarget.style.borderColor = "var(--input-border-focus)")}
          onBlur={e => (e.currentTarget.style.borderColor = "var(--input-border)")}
        />
      </div>

      {error && (
        <div style={{
          fontSize: 12,
          color: "var(--color-danger, #9B2335)",
          background: "rgba(155, 35, 53, 0.08)",
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid rgba(155, 35, 53, 0.2)",
          textTransform: "lowercase",
        }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn-press"
        style={{
          width: "100%",
          padding: "11px",
          background: "var(--btn-primary-bg)",
          color: "var(--btn-primary-text)",
          border: "none",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: loading ? "wait" : "pointer",
          letterSpacing: "0.01em",
          transition: "opacity 0.15s ease",
          opacity: loading ? 0.7 : 1,
          marginTop: 2,
        }}
      >
        {loading ? "signing in..." : "sign in"}
      </button>
    </form>
  )
}

// ─── Upload Module ─────────────────────────────────────────────────────────────

function UploadModule({
  phase,
  setPhase,
  currentUser,
  onLogin,
  accessToken,
  onLogout,
}: {
  phase: UploadPhase
  setPhase: (p: UploadPhase) => void
  currentUser: AuthUser | null
  onLogin: (u: string, p: string) => Promise<{ success: boolean; error?: string }>
  accessToken: string | null
  onLogout: () => void
}) {
  const [limitMode, setLimitMode] = useState<LimitMode>("unlimited")
  const [limitCount, setLimitCount] = useState(3)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [uploadedBytes, setUploadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)
  const [code, setCode] = useState("")
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [copied, setCopied] = useState<"code" | "link" | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const isExpanded = phase !== "idle"

  const performUpload = (file: File) => {
    setUploadError(null)
    setPhase("uploading")
    setProgress(0)
    setUploadedBytes(0)
    setTotalBytes(file.size)
    setSpeed(0)

    const formData = new FormData()
    formData.append("file", file)
    if (limitMode === "custom") {
      formData.append("maxDownloads", limitCount.toString())
    }

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    let lastTime = Date.now()
    let lastLoaded = 0

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const currentTime = Date.now()
        const timeDiff = (currentTime - lastTime) / 1000 // seconds
        if (timeDiff >= 0.2 || e.loaded === e.total) {
          const loadedDiff = e.loaded - lastLoaded
          const currentSpeed = (loadedDiff / timeDiff) / (1024 * 1024) // MB/s
          setSpeed(currentSpeed)
          lastTime = currentTime
          lastLoaded = e.loaded
        }
        setUploadedBytes(e.loaded)
        setTotalBytes(e.total)
        setProgress((e.loaded / e.total) * 100)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText)
          if (res.success) {
            setCode(res.code)
            setProgress(100)
            setTimeout(() => setPhase("complete"), 250)
          } else {
            setUploadError(res.error || "Upload failed")
            setPhase("expanded")
          }
        } catch {
          setUploadError("Invalid server response")
          setPhase("expanded")
        }
      } else if (xhr.status === 401) {
        setUploadError("session expired. please sign in again.")
        onLogout()
        setPhase("expanded")
      } else {
        setUploadError(`server error (${xhr.status})`)
        setPhase("expanded")
      }
    }

    xhr.onerror = () => {
      setUploadError("network connection error")
      setPhase("expanded")
    }

    xhr.open("POST", "/api/upload", true)
    if (accessToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`)
    }
    xhr.send(formData)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      performUpload(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      performUpload(file)
    }
  }

  const copy = (type: "code" | "link") => {
    const directUrl = `${window.location.origin}/d/${code}`
    const text = type === "code" ? code : directUrl
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(type)
    setTimeout(() => setCopied(null), 1800)
  }

  const toggleExpand = () => {
    if (phase === "idle") setPhase("expanded")
    else if (phase === "expanded") setPhase("idle")
  }

  const cancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort()
      xhrRef.current = null
    }
    setProgress(0)
    setUploadedBytes(0)
    setSpeed(0)
    setPhase("expanded")
    if (fileRef.current) fileRef.current.value = ""
  }

  const uploadedDisplay = fmtBytes(uploadedBytes)
  const totalDisplay = fmtBytes(totalBytes || 1)
  const eta = speed > 0 && totalBytes > uploadedBytes
    ? Math.max(0, Math.round((totalBytes - uploadedBytes) / (speed * 1024 * 1024)))
    : 0

  return (
    <div className="main-card" style={{
      boxShadow: isExpanded ? "0 8px 48px rgba(0,0,0,0.06)" : "0 1px 4px rgba(0,0,0,0.03)",
    }}>
      {/* Header row */}
      <button
        onClick={toggleExpand}
        className="card-header-btn"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            width: 32, height: 32, borderRadius: "50%",
            border: "1px solid var(--icon-border)", display: "flex", alignItems: "center",
            justifyContent: "center", color: "var(--icon-color)", background: "var(--icon-bg)", flexShrink: 0,
            transition: "background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease",
          }}>
            <UploadIcon />
          </span>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              Upload a file
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 1 }}>
              {phase === "complete" ? "Transfer complete — share your code" :
               phase === "uploading" ? `${uploadedDisplay} / ${totalDisplay}` :
               "share anything, with anyone"}
            </div>
          </div>
        </div>
        <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center" }}>
          <ChevronIcon open={isExpanded} />
        </span>
      </button>

      {/* Accordion body */}
      <div className={`accordion-grid${isExpanded ? " open" : ""}`}>
        <div className="accordion-inner">
          <div className="accordion-content card-inner-padding">

            {/* ── Uploading state ── */}
            {phase === "uploading" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div>
                  <div style={{
                    height: 2, background: "var(--progress-track)", borderRadius: 9999, overflow: "hidden"
                  }}>
                    <div style={{
                      height: "100%", width: `${progress}%`,
                      background: "var(--progress-fill)", borderRadius: 9999,
                      transition: "width 0.2s ease",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {uploadedDisplay} <span style={{ color: "var(--text-muted)" }}>/</span> {totalDisplay}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {speed > 0 ? `${speed.toFixed(1)} MB/s` : "uploading..."}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {formatEta(eta)}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {Math.round(progress)}%
                    </span>
                    <button
                      onClick={cancelUpload}
                      style={{
                        fontSize: 11,
                        color: "#9B2335",
                        background: "rgba(155, 35, 53, 0.06)",
                        border: "1px solid rgba(155, 35, 53, 0.15)",
                        borderRadius: 9999,
                        padding: "3px 10px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontWeight: 500,
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(155, 35, 53, 0.12)"}
                      onMouseLeave={e => e.currentTarget.style.background = "rgba(155, 35, 53, 0.06)"}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Complete state ── */}
            {phase === "complete" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.1em", marginBottom: 10, textTransform: "lowercase" }}>
                    share code
                  </div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "clamp(2rem, 5vw, 3rem)",
                    fontWeight: 500,
                    letterSpacing: "0.14em",
                    color: "var(--text-primary)",
                    lineHeight: 1,
                  }}>
                    {code}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <PillButton onClick={() => copy("code")} small>
                    <CopyIcon />
                    {copied === "code" ? "copied!" : "copy code"}
                  </PillButton>
                  <PillButton onClick={() => copy("link")} small>
                    <LinkIcon />
                    {copied === "link" ? "copied!" : "copy direct link"}
                  </PillButton>
                </div>
                <div style={{ textAlign: "center" }}>
                  <button
                    onClick={() => { setPhase("idle"); setProgress(0); if (fileRef.current) fileRef.current.value = "" }}
                    style={{
                      fontSize: 12, color: "var(--text-secondary)", background: "none",
                      border: "none", cursor: "pointer", fontFamily: "inherit",
                      textDecoration: "underline", textUnderlineOffset: 3,
                    }}
                  >
                    upload another
                  </button>
                </div>
              </div>
            )}

            {/* ── Expanded / idle-expanded state ── */}
            {phase !== "uploading" && phase !== "complete" && (
              !currentUser ? (
                <InlineLoginForm
                  onLogin={onLogin}
                  title="sign in to send files"
                  subtitle="enter your username and password to start transferring files"
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {uploadError && (
                    <div style={{
                      fontSize: 12, color: "#9B2335", background: "rgba(155, 35, 53, 0.06)",
                      padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(155, 35, 53, 0.15)"
                    }}>
                      {uploadError}
                    </div>
                  )}

                  {/* Drop zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: `1.5px dashed ${dragging ? "var(--text-primary)" : "var(--border-dashed)"}`,
                      borderRadius: 14,
                      padding: "36px 24px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      background: dragging ? "var(--bg-hover)" : "var(--bg-subtle)",
                      transition: "border-color 0.18s ease, background-color 0.18s ease",
                    }}
                  >
                    <span style={{ color: "var(--text-secondary)" }}><UploadIcon /></span>
                    <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 400 }}>
                      choose file or drag here
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      any format · up to 20 gb
                    </span>
                    <input
                      ref={fileRef}
                      type="file"
                      style={{ display: "none" }}
                      onChange={handleFileInput}
                    />
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: "var(--border-subtle)" }} />

                  {/* download limit */}
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, letterSpacing: "0.02em" }}>
                      download limit
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <SegmentToggle value={limitMode} onChange={setLimitMode} />
                      {limitMode === "custom" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button
                            onClick={() => setLimitCount(v => Math.max(1, v - 1))}
                            style={{
                              width: 28, height: 28, borderRadius: 9999,
                              border: "1px solid var(--border-card)", background: "var(--bg-card)",
                              fontSize: 16, cursor: "pointer", display: "flex",
                              alignItems: "center", justifyContent: "center", color: "var(--text-primary)",
                              transition: "background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease",
                            }}
                          >−</button>
                          <span style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 15, fontWeight: 500, color: "var(--text-primary)",
                            minWidth: 28, textAlign: "center",
                          }}>{limitCount}</span>
                          <button
                            onClick={() => setLimitCount(v => v + 1)}
                            style={{
                              width: 28, height: 28, borderRadius: 9999,
                              border: "1px solid var(--border-card)", background: "var(--bg-card)",
                              fontSize: 16, cursor: "pointer", display: "flex",
                              alignItems: "center", justifyContent: "center", color: "var(--text-primary)",
                              transition: "background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease",
                            }}
                          >+</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Download Module ───────────────────────────────────────────────────────────

function DownloadModule({
  phase,
  setPhase,
  initialCode = ""
}: {
  phase: DownloadPhase
  setPhase: (p: DownloadPhase) => void
  initialCode?: string
}) {
  const [chars, setChars] = useState(() => {
    if (initialCode && initialCode.length >= 7) {
      return initialCode.split("")
    }
    return ["", "", "", "-", "", "", ""]
  })
  const [readyFile, setReadyFile] = useState<ReadyFile | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>("invalid code or file expired")
  const [downloading, setDownloading] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const isExpanded = phase !== "idle"

  const codePositions = [0, 1, 2, 4, 5, 6]

  const lookupFile = useCallback(async (codeToLookup: string) => {
    setPhase("loading")
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(codeToLookup)}`)
      const data = await res.json()
      if (res.ok && data.success && data.file) {
        setReadyFile({
          name: data.file.originalName,
          originalName: data.file.originalName,
          ext: data.file.ext,
          size: data.file.size,
          code: data.file.code,
          maxDownloads: data.file.maxDownloads,
          usedDownloads: data.file.usedDownloads,
          status: data.file.status,
        })
        setPhase("ready")
      } else {
        setErrorMessage(data.error || "invalid code or file expired")
        setPhase("error")
      }
    } catch {
      setErrorMessage("network error verifying code")
      setPhase("error")
    }
  }, [setPhase])

  // If initialCode provided from URL, query immediately on mount
  useEffect(() => {
    if (initialCode && initialCode.length >= 7) {
      setPhase("expanded")
      lookupFile(initialCode)
    }
  }, [initialCode, lookupFile, setPhase])

  const fillCode = useCallback((raw: string) => {
    const urlMatch = raw.match(/\/d\/([A-Za-z0-9]{3}-?[A-Za-z0-9]{3})/i)
    const cleanStr = (urlMatch ? urlMatch[1] : raw).replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6)
    if (!cleanStr) return

    const next = ["", "", "", "-", "", "", ""]
    let charIdx = 0
    for (let i = 0; i < 7; i++) {
      if (i === 3) continue
      if (charIdx < cleanStr.length) {
        next[i] = cleanStr[charIdx]
        charIdx++
      }
    }
    setChars(next)

    if (cleanStr.length >= 6) {
      const entered = `${next[0]}${next[1]}${next[2]}-${next[4]}${next[5]}${next[6]}`
      lookupFile(entered)
    } else {
      const nextPos = cleanStr.length <= 3 ? cleanStr.length : cleanStr.length + 1
      inputRefs.current[Math.min(nextPos, 6)]?.focus()
    }
  }, [lookupFile])

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData("text")
    if (text) {
      fillCode(text)
    }
  }

  const handleChar = (pos: number, val: string) => {
    const cleanStr = val.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
    if (cleanStr.length > 1) {
      fillCode(cleanStr)
      return
    }

    const ch = cleanStr.slice(-1)
    const next = [...chars]
    next[pos] = ch
    setChars(next)

    if (ch && pos < 6) {
      const nextPos = pos === 2 ? 4 : pos + 1
      if (nextPos <= 6) inputRefs.current[nextPos]?.focus()
    }

    // Check code
    const entered = `${next[0]}${next[1]}${next[2]}-${next[4]}${next[5]}${next[6]}`
    if (next[0] && next[1] && next[2] && next[4] && next[5] && next[6]) {
      lookupFile(entered)
    } else if (phase === "error") {
      setPhase("expanded")
    }
  }

  const handleKey = (pos: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace") {
      if (chars[pos]) {
        const next = [...chars]
        next[pos] = ""
        setChars(next)
        if (phase === "error") setPhase("expanded")
      } else {
        const prevPos = pos === 4 ? 2 : pos - 1
        if (prevPos >= 0) inputRefs.current[prevPos]?.focus()
      }
    }
  }

  const triggerDownload = () => {
    if (!readyFile) return
    setDownloading(true)
    const link = document.createElement("a")
    link.href = `/api/files/${encodeURIComponent(readyFile.code)}/download`
    link.download = readyFile.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => setDownloading(false), 2000)
  }

  const reset = () => {
    setChars(["", "", "", "-", "", "", ""])
    setReadyFile(null)
    setPhase("expanded")
    setTimeout(() => inputRefs.current[0]?.focus(), 50)
  }

  return (
    <div className="main-card" style={{
      boxShadow: isExpanded ? "0 8px 48px rgba(0,0,0,0.06)" : "0 1px 4px rgba(0,0,0,0.03)",
    }}>
      {/* Header row */}
      <button
        onClick={() => setPhase(phase === "idle" ? "expanded" : "idle")}
        className="card-header-btn"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            width: 32, height: 32, borderRadius: "50%",
            border: "1px solid var(--icon-border)", display: "flex", alignItems: "center",
            justifyContent: "center", color: "var(--icon-color)", background: "var(--icon-bg)", flexShrink: 0,
            transition: "background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease",
          }}>
            <DownloadIcon />
          </span>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              Download a file
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 1 }}>
              {phase === "ready" && readyFile ? readyFile.name : "enter a share code to receive a file"}
            </div>
          </div>
        </div>
        <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center" }}>
          <ChevronIcon open={isExpanded} />
        </span>
      </button>

      {/* Accordion body */}
      <div className={`accordion-grid${isExpanded ? " open" : ""}`}>
        <div className="accordion-inner">
          <div className="accordion-content card-inner-padding">

            {/* ── Ready state ── */}
            {phase === "ready" && readyFile && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{
                  border: "1px solid var(--border-card)", borderRadius: 14, padding: "20px 22px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "var(--bg-subtle)",
                  transition: "background-color 0.2s ease, border-color 0.2s ease",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                    <div style={{
                      padding: "5px 10px", borderRadius: 6,
                      background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11, fontWeight: 500, letterSpacing: "0.06em",
                      textTransform: "lowercase", flexShrink: 0
                    }}>
                      .{readyFile.ext}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 500, color: "var(--text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                      }}>
                        {readyFile.name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        {readyFile.size}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <PillButton dark onClick={triggerDownload} disabled={downloading}>
                    <DownloadIcon />
                    {downloading ? "downloading..." : "download file"}
                  </PillButton>
                  <button
                    onClick={reset}
                    style={{
                      fontSize: 12, color: "var(--text-secondary)", background: "none",
                      border: "none", cursor: "pointer", fontFamily: "inherit",
                      textDecoration: "underline", textUnderlineOffset: 3,
                    }}
                  >
                    use a different code
                  </button>
                </div>
              </div>
            )}

            {/* ── Code Input state ── */}
            {phase !== "ready" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {phase === "loading" ? "Searching for file..." : "Enter share code"}
                </div>
                <div className="char-inputs-container">
                  {codePositions.map((pos, i) => (
                    <Fragment key={pos}>
                      <input
                        ref={el => { inputRefs.current[pos] = el }}
                        className={`char-box${chars[pos] ? " filled" : ""}`}
                        value={chars[pos]}
                        onPaste={handlePaste}
                        onChange={e => handleChar(pos, e.target.value)}
                        onKeyDown={e => handleKey(pos, e)}
                        onFocus={() => { if (phase === "error") setPhase("expanded") }}
                        autoFocus={i === 0 && phase === "expanded"}
                        disabled={phase === "loading"}
                      />
                      {i === 2 && (
                        <span className="char-separator">
                          –
                        </span>
                      )}
                    </Fragment>
                  ))}
                </div>
                {phase === "error" && (
                  <div style={{ fontSize: 12, color: "#9B2335", letterSpacing: "0.01em" }}>
                    {errorMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────

function MainView({
  setRoute,
  initialCode = "",
  currentUser,
  onLogin,
  onLogout,
  accessToken,
}: {
  setRoute: (r: Route) => void
  initialCode?: string
  currentUser: AuthUser | null
  onLogin: (u: string, p: string) => Promise<{ success: boolean; error?: string }>
  onLogout: () => void
  accessToken: string | null
}) {
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle")
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>(initialCode ? "expanded" : "idle")
  const [installPrompt, setInstallPrompt] = useState<any>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  const handleInstallClick = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === "accepted") {
      setInstallPrompt(null)
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-page)",
      display: "flex",
      flexDirection: "column",
      transition: "background-color 0.25s ease",
    }}>
      {/* Center stage */}
      <main className="main-stage">
        <div className="card-container">
          {/* Eyebrow */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h1 style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: "clamp(1.75rem, 4vw, 2.25rem)",
              color: "var(--text-primary)",
              fontWeight: 400,
              margin: 0,
              letterSpacing: "-0.03em",
              lineHeight: 1.15,
              transition: "color 0.25s ease",
            }}>
              send files, simply.
            </h1>
          </div>

          <UploadModule
            phase={uploadPhase}
            setPhase={setUploadPhase}
            currentUser={currentUser}
            onLogin={onLogin}
            accessToken={accessToken}
            onLogout={onLogout}
          />
          <DownloadModule phase={downloadPhase} setPhase={setDownloadPhase} initialCode={initialCode} />
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        display: "flex", justifyContent: "center", alignItems: "center",
        padding: "20px 40px",
        gap: 24,
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", transition: "color 0.25s ease" }}>minimalist file transfer</span>
        <button
          onClick={() => {
            window.history.pushState({}, "", "/video")
            setRoute("video")
          }}
          style={{
            fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none",
            cursor: "pointer", fontFamily: "inherit", transition: "color 0.25s ease",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}
        >
          download video?
        </button>
        {installPrompt && (
          <button
            onClick={handleInstallClick}
            style={{
              fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none",
              cursor: "pointer", fontFamily: "inherit", transition: "color 0.25s ease",
            }}
          >
            install app
          </button>
        )}
        <button
          onClick={() => {
            window.history.pushState({}, "", "/admin")
            setRoute("admin")
          }}
          style={{
            fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none",
            cursor: "pointer", fontFamily: "inherit", transition: "color 0.25s ease",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}
        >
          admin
        </button>
        {currentUser && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              logged in as <strong style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{currentUser.username}</strong>
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>•</span>
            <button
              onClick={onLogout}
              style={{
                fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none",
                cursor: "pointer", fontFamily: "inherit", textDecoration: "underline",
                transition: "color 0.2s ease",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}
            >
              sign out
            </button>
          </div>
        )}
      </footer>
    </div>
  )
}

// ─── Admin Login ──────────────────────────────────────────────────────────────

function AdminLogin({ onAuth, setRoute }: { onAuth: (token: string) => void; setRoute: (r: Route) => void }) {
  const [pw, setPw] = useState("")
  const [err, setErr] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!pw || loading) return
    setLoading(true)
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      })
      const data = await res.json()
      if (res.ok && data.success && data.token) {
        sessionStorage.setItem("transfer_admin_token", data.token)
        onAuth(data.token)
      } else {
        setErr(true)
        setTimeout(() => setErr(false), 1800)
      }
    } catch {
      setErr(true)
      setTimeout(() => setErr(false), 1800)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg-page)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px",
      transition: "background-color 0.25s ease",
    }}>
      <div style={{
        width: "100%", maxWidth: 360,
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        borderRadius: 20,
        padding: "40px 36px",
        boxShadow: "var(--card-shadow-expanded)",
        transition: "background-color 0.25s ease, border-color 0.25s ease",
      }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 22, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 6,
          }}>
            admin access
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            enter your admin password to continue
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="Password"
            autoFocus
            style={{
              width: "100%",
              padding: "12px 16px",
              border: `1px solid ${err ? "#9B2335" : "var(--input-border)"}`,
              borderRadius: 10,
              fontSize: 14,
              fontFamily: "inherit",
              background: "var(--input-bg)",
              color: "var(--text-primary)",
              outline: "none",
              transition: "border-color 0.15s ease, background-color 0.2s ease, color 0.2s ease",
            }}
          />
          {err && (
            <div style={{ fontSize: 12, color: "#9B2335" }}>
              Incorrect password
            </div>
          )}
          <button
            onClick={submit}
            disabled={loading}
            className="btn-press"
            style={{
              width: "100%", padding: "12px",
              background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)",
              border: "none", borderRadius: 10,
              fontSize: 14, fontWeight: 500,
              fontFamily: "inherit", cursor: loading ? "wait" : "pointer",
              letterSpacing: "0.01em",
              transition: "background-color 0.2s ease, color 0.2s ease",
            }}
          >
            {loading ? "Verifying..." : "continue"}
          </button>
          <button
            onClick={() => {
              window.history.pushState({}, "", "/")
              setRoute("main")
            }}
            className="btn-press"
            style={{
              width: "100%", padding: "8px",
              background: "none", color: "var(--text-secondary)",
              border: "none", borderRadius: 10,
              fontSize: 13, fontWeight: 400,
              fontFamily: "inherit", cursor: "pointer",
              transition: "color 0.2s ease",
            }}
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────

function AdminDashboard({ setRoute, token }: { setRoute: (r: Route) => void; token: string }) {
  const [tab, setTab] = useState<"files" | "users">("files")
  const [files, setFiles] = useState<FileRow[]>([])
  const [stats, setStats] = useState({ totalFiles: 0, totalSizeBytes: 0, activeTransfers: 0 })
  const [copied, setCopied] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUsername, setNewUsername] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [addUserError, setAddUserError] = useState<string | null>(null)
  const [addUserLoading, setAddUserLoading] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editPassword, setEditPassword] = useState("")

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setUsers(data.users || [])
      }
    } catch (err) {
      console.error("Failed to load users:", err)
    } finally {
      setLoadingUsers(false)
    }
  }, [token])

  useEffect(() => {
    if (tab === "users") {
      fetchUsers()
    }
  }, [tab, fetchUsers])

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername.trim() || !newPassword) {
      setAddUserError("username and password are required")
      return
    }
    setAddUserLoading(true)
    setAddUserError(null)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: "user" })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setNewUsername("")
        setNewPassword("")
        setShowAddUser(false)
        fetchUsers()
      } else {
        setAddUserError(data.error || "failed to create user")
      }
    } catch {
      setAddUserError("network error creating user")
    } finally {
      setAddUserLoading(false)
    }
  }

  const toggleUserStatus = async (user: AdminUser) => {
    const nextStatus = user.status === "active" ? "disabled" : "active"
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: nextStatus })
      })
      if (res.ok) {
        fetchUsers()
      }
    } catch (err) {
      console.error("Failed to update user status:", err)
    }
  }

  const handleResetPassword = async (userId: string) => {
    if (!editPassword || editPassword.length < 4) {
      alert("password must be at least 4 characters")
      return
    }
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: editPassword })
      })
      if (res.ok) {
        setEditingUserId(null)
        setEditPassword("")
        alert("password updated successfully")
        fetchUsers()
      } else {
        const d = await res.json()
        alert(d.error || "failed to update password")
      }
    } catch {
      alert("network error updating password")
    }
  }

  const handleDeleteUser = async (user: AdminUser) => {
    if (!window.confirm(`are you sure you want to delete user "${user.username}"?`)) return
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        fetchUsers()
      }
    } catch (err) {
      console.error("Failed to delete user:", err)
    }
  }

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/files", {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setFiles(data.files || [])
        if (data.stats) setStats(data.stats)
      }
    } catch (err) {
      console.error("Failed to load admin files:", err)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  const deleteFile = async (id: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this file?")) return
    try {
      const res = await fetch(`/api/admin/files/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        setFiles(f => f.filter(r => r.id !== id))
        fetchFiles()
      }
    } catch (err) {
      console.error("Failed to delete file:", err)
    }
  }

  const copyLink = (fileCode: string) => {
    const directUrl = `${window.location.origin}/d/${fileCode}`
    navigator.clipboard.writeText(directUrl).catch(() => {})
    setCopied(fileCode)
    setTimeout(() => setCopied(null), 1600)
  }

  const updateLimitApi = async (id: string, maxDownloads: number | null) => {
    try {
      const res = await fetch(`/api/admin/files/${encodeURIComponent(id)}/limit`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ maxDownloads })
      })
      const data = await res.json()
      if (res.ok && data.success && data.file) {
        setFiles(rows => rows.map(r => r.id === id ? data.file : r))
        fetchFiles()
      }
    } catch (err) {
      console.error("Failed to update limit:", err)
    }
  }

  const adjustLimit = (id: string, delta: number) => {
    const target = files.find(f => f.id === id)
    if (!target || target.maxDownloads === null) return
    const newLimit = Math.max(target.usedDownloads, target.maxDownloads + delta)
    updateLimitApi(id, newLimit)
  }

  const toggleunlimited = (id: string) => {
    const target = files.find(f => f.id === id)
    if (!target) return
    const newLimit = target.maxDownloads === null ? 5 : null
    updateLimitApi(id, newLimit)
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)", transition: "background-color 0.25s ease" }}>
      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "24px 32px",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <button
          onClick={() => {
            window.history.pushState({}, "", "/")
            setRoute("main")
          }}
          className="btn-press"
          style={{
            display: "flex", alignItems: "center", gap: 12,
            background: "none", border: "none", cursor: "pointer",
            padding: 0, textAlign: "left",
          }}
          title="Return to Transfer home"
        >
          <div style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 20, color: "var(--text-primary)", letterSpacing: "-0.02em",
          }}>
            Transfer
          </div>
          <span style={{
            fontSize: 11, color: "var(--text-secondary)", borderLeft: "1px solid var(--border-card)",
            paddingLeft: 12, letterSpacing: "0.06em",
          }}>
            ADMIN
          </span>
        </button>
      </header>

      <main style={{ padding: "32px 24px", maxWidth: 1080, margin: "0 auto" }}>
        {/* Tab Switcher */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 28,
          borderBottom: "1px solid var(--border-subtle)", paddingBottom: 14,
        }}>
          <button
            onClick={() => setTab("files")}
            style={{
              background: tab === "files" ? "var(--btn-primary-bg)" : "transparent",
              color: tab === "files" ? "var(--btn-primary-text)" : "var(--text-secondary)",
              border: "1px solid",
              borderColor: tab === "files" ? "transparent" : "var(--border-subtle)",
              borderRadius: 8,
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            files ({files.length})
          </button>
          <button
            onClick={() => setTab("users")}
            style={{
              background: tab === "users" ? "var(--btn-primary-bg)" : "transparent",
              color: tab === "users" ? "var(--btn-primary-text)" : "var(--text-secondary)",
              border: "1px solid",
              borderColor: tab === "users" ? "transparent" : "var(--border-subtle)",
              borderRadius: 8,
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            users ({users.length})
          </button>
        </div>

        {tab === "files" ? (
          <>
            {/* Stats row */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16, marginBottom: 32,
        }}>
          {[
            { label: "Total Files", value: stats.totalFiles.toString() },
            { label: "Storage Used", value: fmtBytes(stats.totalSizeBytes) },
            { label: "Active Transfers", value: stats.activeTransfers.toString() },
          ].map(s => (
            <div key={s.label} style={{
              background: "var(--bg-card)", border: "1px solid var(--border-card)",
              borderRadius: 14, padding: "20px 24px",
              transition: "background-color 0.25s ease, border-color 0.25s ease",
            }}>
              <div style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 28, color: "var(--text-primary)",
                letterSpacing: "-0.03em", lineHeight: 1,
              }}>
                {s.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6, letterSpacing: "0.04em" }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border-card)",
          borderRadius: 16, overflow: "hidden",
          transition: "background-color 0.25s ease, border-color 0.25s ease",
        }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 680 }}>
              {/* Table head */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.3fr 0.8fr 1fr 0.8fr 1fr",
                padding: "14px 24px",
                borderBottom: "1px solid var(--border-subtle)",
                gap: 8,
              }}>
                {["File Name", "Uploaded", "Size", "Downloads", "Status", "Actions"].map(h => (
                  <span key={h} style={{
                    fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
                    letterSpacing: "0.08em", textTransform: "lowercase",
                  }}>
                    {h}
                  </span>
                ))}
              </div>

              {/* Rows */}
              {loading ? (
                <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
                  Loading files...
                </div>
              ) : files.map((file, i) => (
                <div
                  key={file.id}
                  className="table-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1.3fr 0.8fr 1fr 0.8fr 1fr",
                    padding: "16px 24px",
                    borderBottom: i < files.length - 1 ? "1px solid var(--border-subtle)" : "none",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {/* File name + ext */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{
                      fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                      color: "var(--text-secondary)", background: "var(--bg-subtle)",
                      padding: "2px 6px", borderRadius: 4,
                      flexShrink: 0, letterSpacing: "0.04em",
                    }}>
                      .{file.ext}
                    </span>
                    <span style={{
                      fontSize: 13, color: "var(--text-primary)", fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {file.name}
                    </span>
                  </div>

                  {/* Upload date */}
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {file.uploadedAt}
                  </span>

                  {/* Size */}
                  <span style={{
                    fontSize: 12, color: "var(--text-secondary)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {file.size}
                  </span>

                  {/* download limit */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {file.maxDownloads === null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {file.usedDownloads} / ∞
                        </span>
                        <button
                          onClick={() => toggleunlimited(file.id)}
                          style={{
                            fontSize: 10, color: "var(--text-muted)", background: "none",
                            border: "none", cursor: "pointer", fontFamily: "inherit",
                            padding: "1px 4px", textDecoration: "underline"
                          }}
                          title="Set custom limit"
                        >
                          set
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button
                          onClick={() => adjustLimit(file.id, -1)}
                          style={{
                            width: 20, height: 20, borderRadius: 9999,
                            border: "1px solid var(--border-card)", background: "var(--bg-card)",
                            fontSize: 13, cursor: "pointer", display: "flex",
                            alignItems: "center", justifyContent: "center", color: "var(--text-primary)",
                            lineHeight: 1,
                          }}
                        >−</button>
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 12, color: "var(--text-primary)", minWidth: 36,
                          textAlign: "center",
                        }}>
                          {file.usedDownloads} / {file.maxDownloads}
                        </span>
                        <button
                          onClick={() => adjustLimit(file.id, 1)}
                          style={{
                            width: 20, height: 20, borderRadius: 9999,
                            border: "1px solid var(--border-card)", background: "var(--bg-card)",
                            fontSize: 13, cursor: "pointer", display: "flex",
                            alignItems: "center", justifyContent: "center", color: "var(--text-primary)",
                            lineHeight: 1,
                          }}
                        >+</button>
                        <button
                          onClick={() => toggleunlimited(file.id)}
                          style={{
                            fontSize: 10, color: "var(--text-muted)", background: "none",
                            border: "none", cursor: "pointer", fontFamily: "inherit",
                            padding: "1px 4px", marginLeft: 2
                          }}
                          title="Make unlimited"
                        >
                          ∞
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      color: file.status === "active" ? "#3B7A57" : "var(--text-secondary)",
                      background: file.status === "active" ? "rgba(59,122,87,0.12)" : "var(--bg-subtle)",
                      padding: "3px 8px", borderRadius: 9999,
                      letterSpacing: "0.03em",
                    }}>
                      {file.status === "active" ? "Active" : "Expired"}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <button
                      onClick={() => copyLink(file.code)}
                      title="Copy link"
                      style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: "none", background: "none", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: copied === file.code ? "#3B7A57" : "var(--text-secondary)",
                        transition: "color 0.15s ease, background 0.12s ease",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-subtle)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      {copied === file.code ? "✓" : <LinkIcon />}
                    </button>
                    <button
                      onClick={() => deleteFile(file.id)}
                      title="Delete"
                      style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: "none", background: "none", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "var(--text-muted)",
                        transition: "color 0.15s ease, background 0.12s ease",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(155, 35, 53, 0.12)"; e.currentTarget.style.color = "#9B2335" }}
                      onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)" }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}

              {!loading && files.length === 0 && (
                <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  no files stored
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    ) : (
      <div>
        {/* Top Bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20, flexWrap: "wrap", gap: 12,
        }}>
          <div>
            <div style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 22, color: "var(--text-primary)", letterSpacing: "-0.02em",
            }}>
              user management
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              manage accounts authorized to upload files and download videos
            </div>
          </div>

          <button
            onClick={() => { setShowAddUser(!showAddUser); setAddUserError(null); }}
            className="btn-press"
            style={{
              background: "var(--btn-primary-bg)",
              color: "var(--btn-primary-text)",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{showAddUser ? "✕ cancel" : "+ add user"}</span>
          </button>
        </div>

        {/* Add User Card */}
        {showAddUser && (
          <form onSubmit={handleAddUser} style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-card)",
            borderRadius: 16,
            padding: "20px 24px",
            marginBottom: 24,
            boxShadow: "var(--card-shadow)",
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>
              create new user
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 12 }}>
              <input
                type="text"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                placeholder="username"
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--input-border)",
                  background: "var(--input-bg)",
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="password"
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--input-border)",
                  background: "var(--input-bg)",
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            </div>
            {addUserError && (
              <div style={{ fontSize: 12, color: "var(--color-danger, #9B2335)", marginBottom: 12 }}>
                {addUserError}
              </div>
            )}
            <button
              type="submit"
              disabled={addUserLoading}
              style={{
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-text)",
                border: "none",
                borderRadius: 8,
                padding: "8px 18px",
                fontSize: 12,
                fontWeight: 600,
                cursor: addUserLoading ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {addUserLoading ? "creating..." : "create account"}
            </button>
          </form>
        )}

        {/* Users Table */}
        <div style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          borderRadius: 16,
          overflow: "hidden",
        }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 640 }}>
              {/* Table Header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1.8fr 1fr 1.2fr 1.2fr 1.8fr",
                padding: "14px 24px",
                borderBottom: "1px solid var(--border-subtle)",
                gap: 8,
              }}>
                {["username", "status", "created", "last login", "actions"].map(h => (
                  <span key={h} style={{
                    fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
                    letterSpacing: "0.08em", textTransform: "lowercase",
                  }}>
                    {h}
                  </span>
                ))}
              </div>

              {/* Rows */}
              {loadingUsers ? (
                <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
                  loading users...
                </div>
              ) : users.length === 0 ? (
                <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  no users created yet. click "+ add user" above to create the first account.
                </div>
              ) : users.map((u, i) => (
                <div
                  key={u.id}
                  className="table-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.8fr 1fr 1.2fr 1.2fr 1.8fr",
                    padding: "16px 24px",
                    borderBottom: i < users.length - 1 ? "1px solid var(--border-subtle)" : "none",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {/* Username */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                      {u.username}
                    </span>
                    {u.role === "admin" && (
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 4,
                        background: "var(--bg-subtle)", color: "var(--text-secondary)",
                        border: "1px solid var(--border-subtle)",
                      }}>
                        admin
                      </span>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 9999, fontWeight: 500,
                      background: u.status === "active" ? "rgba(59, 122, 87, 0.08)" : "rgba(155, 35, 53, 0.08)",
                      color: u.status === "active" ? "#3B7A57" : "var(--color-danger, #9B2335)",
                      border: `1px solid ${u.status === "active" ? "rgba(59, 122, 87, 0.2)" : "rgba(155, 35, 53, 0.2)"}`,
                    }}>
                      {u.status}
                    </span>
                  </div>

                  {/* Created */}
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </span>

                  {/* Last Login */}
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
                    {u.last_login ? new Date(u.last_login).toLocaleDateString() : "never"}
                  </span>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {editingUserId === u.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="password"
                          placeholder="new password"
                          value={editPassword}
                          onChange={e => setEditPassword(e.target.value)}
                          style={{
                            width: 100, padding: "4px 8px", borderRadius: 6,
                            border: "1px solid var(--input-border)", background: "var(--input-bg)",
                            color: "var(--text-primary)", fontSize: 11,
                          }}
                        />
                        <button
                          onClick={() => handleResetPassword(u.id)}
                          style={{
                            background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)",
                            border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer",
                          }}
                        >
                          save
                        </button>
                        <button
                          onClick={() => { setEditingUserId(null); setEditPassword(""); }}
                          style={{
                            background: "none", border: "none", color: "var(--text-muted)",
                            fontSize: 11, cursor: "pointer",
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingUserId(u.id); setEditPassword(""); }}
                        style={{
                          background: "none", border: "1px solid var(--border-subtle)",
                          borderRadius: 6, padding: "3px 8px", fontSize: 11,
                          color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        reset password
                      </button>
                    )}

                    <button
                      onClick={() => toggleUserStatus(u)}
                      style={{
                        background: "none", border: "1px solid var(--border-subtle)",
                        borderRadius: 6, padding: "3px 8px", fontSize: 11,
                        color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      {u.status === "active" ? "disable" : "enable"}
                    </button>

                    <button
                      onClick={() => handleDeleteUser(u)}
                      title="delete user"
                      style={{
                        background: "none", border: "none",
                        cursor: "pointer", color: "var(--text-muted)",
                        padding: "4px", display: "flex", alignItems: "center",
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}
  </main>
    </div>
  )
}

// ─── Admin View ───────────────────────────────────────────────────────────────

function AdminView({ setRoute }: { setRoute: (r: Route) => void }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem("transfer_admin_token"))

  return token
    ? <AdminDashboard setRoute={setRoute} token={token} />
    : <AdminLogin onAuth={(tok) => setToken(tok)} setRoute={setRoute} />
}

// ─── Video Downloader View ────────────────────────────────────────────────────

interface VideoQuality {
  id: string
  label: string
  ext: string
  estSize?: string
  desc: string
}

interface VideoMetadata {
  title: string
  thumbnail: string
  duration: number
  durationFormatted: string
  uploader: string
  extractor: string
  qualities: VideoQuality[]
}

function VideoDownloaderView({
  setRoute,
  currentUser,
  onLogin,
  onLogout,
  authFetch,
}: {
  setRoute: (r: Route) => void
  currentUser: AuthUser | null
  onLogin: (u: string, p: string) => Promise<{ success: boolean; error?: string }>
  onLogout: () => void
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
}) {
  const [url, setUrl] = useState("")
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [video, setVideo] = useState<VideoMetadata | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  interface DownloadState {
    quality: VideoQuality
    jobId: string
    status: "starting" | "downloading" | "processing" | "ready" | "error" | "cancelled"
    percent: number
    speed: string
    eta: string
    totalSize: string
    stage: string
    error?: string
  }

  const [downloadState, setDownloadState] = useState<DownloadState | null>(null)
  const pollRef = useRef<number | null>(null)

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setUrl(text)
        setError(null)
      }
    } catch {
      inputRef.current?.focus()
    }
  }

  const fetchVideoInfo = async () => {
    if (!url.trim()) return
    setFetching(true)
    setError(null)
    setVideo(null)
    setDownloadState(null)

    try {
      const res = await authFetch("/api/video/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error || "unable to extract video from this link. make sure the video is public.")
      } else {
        setVideo(data.video)
      }
    } catch (e: any) {
      setError("network error connecting to video extraction server.")
    } finally {
      setFetching(false)
    }
  }

  const handleDownload = async (quality: VideoQuality) => {
    if (!video) return
    setError(null)

    setDownloadState({
      quality,
      jobId: "",
      status: "starting",
      percent: 0,
      speed: "",
      eta: "",
      totalSize: "",
      stage: "starting download on server...",
    })

    try {
      const res = await authFetch("/api/video/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          quality: quality.id,
          title: video.title,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success || !data.jobId) {
        setDownloadState(prev => prev ? { ...prev, status: "error", error: data.error || "failed to start download" } : null)
        return
      }

      const jobId = data.jobId
      setDownloadState(prev => prev ? { ...prev, jobId } : null)

      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = window.setInterval(async () => {
        try {
          const sRes = await fetch(`/api/video/status/${jobId}`)
          const sData = await sRes.json()
          if (!sRes.ok || !sData.success) {
            if (pollRef.current) clearInterval(pollRef.current)
            setDownloadState(prev => prev ? { ...prev, status: "error", error: sData.error || "download failed" } : null)
            return
          }

          setDownloadState(prev => {
            if (!prev) return null
            return {
              ...prev,
              status: sData.status,
              percent: typeof sData.percent === "number" ? sData.percent : 0,
              speed: sData.speed || "",
              eta: sData.eta || "",
              totalSize: sData.totalSize || "",
              stage: sData.stage || "",
              error: sData.error,
            }
          })

          if (sData.status === "ready") {
            if (pollRef.current) clearInterval(pollRef.current)
            const a = document.createElement("a")
            a.href = sData.downloadUrl
            a.download = sData.fileName || ""
            document.body.appendChild(a)
            a.click()
            a.remove()
          } else if (sData.status === "error" || sData.status === "cancelled") {
            if (pollRef.current) clearInterval(pollRef.current)
          }
        } catch {
          // ignore transient poll error
        }
      }, 700)

    } catch (e: any) {
      setDownloadState(prev => prev ? { ...prev, status: "error", error: "network error communicating with server" } : null)
    }
  }

  const handleCancel = async () => {
    if (pollRef.current) clearInterval(pollRef.current)
    const jId = downloadState?.jobId
    setDownloadState(null)
    if (jId) {
      try {
        await fetch(`/api/video/cancel/${jId}`, { method: "POST" })
      } catch {}
    }
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-page)",
      color: "var(--text-primary)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      position: "relative",
      transition: "background-color 0.25s ease, color 0.25s ease",
    }}>
      {/* Top Left Branding - Clickable to return */}
      <div
        onClick={() => {
          window.history.pushState({}, "", "/")
          setRoute("main")
        }}
        style={{
          position: "fixed", top: 20, left: 24, zIndex: 50,
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          userSelect: "none",
        }}
        title="return to file transfer"
      >
        <div style={{
          width: 20, height: 20, borderRadius: 5, background: "var(--text-primary)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 11, color: "var(--bg-page)",
          transition: "background-color 0.25s ease, color 0.25s ease",
        }}>
          T
        </div>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", transition: "color 0.25s ease" }}>
          Transfer
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", transition: "color 0.25s ease" }}>•</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", transition: "color 0.25s ease" }}>
          Download videos, simply.
        </span>
      </div>

      {/* Center Content */}
      <main style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 20px 40px",
        maxWidth: 580,
        margin: "0 auto",
        width: "100%",
      }}>
        {/* Title */}
        <h1
          className="font-serif"
          style={{
            fontSize: "clamp(30px, 6vw, 42px)",
            fontWeight: 400,
            color: "var(--text-primary)",
            textAlign: "center",
            marginBottom: 32,
            letterSpacing: "-0.02em",
            transition: "color 0.25s ease",
          }}
        >
          download videos, simply.
        </h1>

        {!currentUser ? (
          <div style={{
            width: "100%", maxWidth: 440,
            background: "var(--bg-card)",
            border: "1px solid var(--border-card)",
            borderRadius: 20,
            padding: "36px 32px",
            boxShadow: "var(--card-shadow-expanded)",
            transition: "background-color 0.25s ease, border-color 0.25s ease",
          }}>
            <InlineLoginForm
              onLogin={onLogin}
              title="sign in to download videos"
              subtitle="enter your credentials to unlock video downloads"
            />
          </div>
        ) : (
          <>
            {/* URL Input Box */}
        <div style={{
          width: "100%",
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          borderRadius: 20,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          boxShadow: "var(--card-shadow)",
          transition: "border-color 0.25s ease, background-color 0.25s ease",
        }}>
          <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", flexShrink: 0 }}>
            <LinkIcon />
          </div>

          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={e => {
              setUrl(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && !fetching && url.trim()) {
                fetchVideoInfo()
              }
            }}
            placeholder="paste video link"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 14,
              color: "var(--text-primary)",
              fontFamily: "inherit",
              minWidth: 0,
            }}
          />

          {/* Paste button if empty, or Clear button if filled */}
          {!url.trim() ? (
            <button
              onClick={handlePaste}
              type="button"
              style={{
                background: "var(--bg-subtle)",
                border: "none",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                color: "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontFamily: "inherit",
                transition: "color 0.15s ease, background-color 0.15s ease",
                flexShrink: 0,
              }}
              title="Paste link from clipboard"
            >
              <CopyIcon />
              <span>Paste</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setUrl("")
                setError(null)
                setVideo(null)
              }}
              type="button"
              style={{
                background: "none",
                border: "none",
                padding: "4px 8px",
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              title="Clear input"
            >
              ✕
            </button>
          )}

          {/* Fetch Button */}
          <button
            onClick={fetchVideoInfo}
            disabled={fetching || !url.trim()}
            style={{
              background: "var(--btn-primary-bg)",
              color: "var(--btn-primary-text)",
              border: "none",
              borderRadius: 10,
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: fetching || !url.trim() ? "not-allowed" : "pointer",
              opacity: fetching || !url.trim() ? 0.45 : 1,
              transition: "opacity 0.2s ease, transform 0.1s ease",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            {fetching ? "fetching..." : "fetch"}
          </button>
        </div>



        {/* Error Notification */}
        {error && (
          <div style={{
            width: "100%",
            marginTop: 20,
            padding: "14px 18px",
            borderRadius: 14,
            background: "rgba(155, 35, 53, 0.08)",
            border: "1px solid rgba(155, 35, 53, 0.25)",
            color: "var(--color-danger, #9B2335)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}>
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 14 }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Fetching Loading Animation */}
        {fetching && (
          <div style={{
            width: "100%",
            marginTop: 24,
            padding: "28px 20px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-card)",
            borderRadius: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            boxShadow: "var(--card-shadow)",
          }}>
            <div style={{
              width: 24, height: 24,
              borderRadius: "50%",
              border: "2px solid var(--border-subtle)",
              borderTopColor: "var(--text-primary)",
              animation: "spin 0.8s linear infinite",
            }} />
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              analyzing video details and qualities...
            </span>
          </div>
        )}

        {/* Video Result Card */}
        {video && !fetching && (
          <div style={{
            width: "100%",
            marginTop: 24,
            background: "var(--bg-card)",
            border: "1px solid var(--border-card)",
            borderRadius: 20,
            overflow: "hidden",
            boxShadow: "var(--card-shadow-expanded)",
            transition: "all 0.25s ease",
          }}>
            {/* Header info */}
            <div style={{
              padding: "18px 20px",
              display: "flex",
              gap: 16,
              alignItems: "center",
              borderBottom: "1px solid var(--border-subtle)",
            }}>
              {video.thumbnail && (
                <div style={{ position: "relative", width: 110, height: 68, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: "var(--bg-subtle)" }}>
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
                  />
                  {video.durationFormatted && (
                    <span style={{
                      position: "absolute", bottom: 4, right: 4,
                      background: "rgba(0,0,0,0.75)",
                      color: "#FFFFFF",
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 5px",
                      borderRadius: 4,
                      lineHeight: 1,
                    }}>
                      {video.durationFormatted}
                    </span>
                  )}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "lowercase",
                    letterSpacing: "0.06em",
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "var(--bg-subtle)",
                    color: "var(--text-secondary)",
                  }}>
                    {video.extractor}
                  </span>
                  {video.uploader && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {video.uploader}
                    </span>
                  )}
                </div>
                <h2 style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  margin: 0,
                  lineHeight: 1.35,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>
                  {video.title}
                </h2>
              </div>
            </div>

            {/* Quality Options Grid OR Progress Bar Layout */}
            {downloadState ? (
              <div style={{ padding: "20px 22px" }}>
                {/* Header with chosen format and cancel button */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}>
                      {downloadState.quality.label}
                    </span>
                    <span style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "var(--bg-subtle)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                    }}>
                      {downloadState.quality.ext}
                    </span>
                    {downloadState.quality.estSize && (
                      <span style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        ({downloadState.quality.estSize})
                      </span>
                    )}
                  </div>

                  {downloadState.status !== "ready" ? (
                    <button
                      onClick={handleCancel}
                      type="button"
                      style={{
                        background: "rgba(155, 35, 53, 0.08)",
                        color: "var(--color-danger, #9B2335)",
                        border: "1px solid rgba(155, 35, 53, 0.2)",
                        borderRadius: 8,
                        padding: "5px 12px",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: "inherit",
                        transition: "all 0.15s ease",
                      }}
                      title="cancel download"
                    >
                      <span>✕</span>
                      <span>cancel</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setDownloadState(null)}
                      type="button"
                      style={{
                        background: "var(--bg-subtle)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 8,
                        padding: "5px 12px",
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      choose another format
                    </button>
                  )}
                </div>

                {/* Progress Bar Track & Fill */}
                <div style={{
                  background: "var(--progress-track)",
                  height: 8,
                  borderRadius: 999,
                  overflow: "hidden",
                  position: "relative",
                  marginBottom: 14,
                }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.max(3, downloadState.percent)}%`,
                    background: downloadState.status === "ready" ? "#3B7A57" : "var(--progress-fill)",
                    borderRadius: 999,
                    transition: "width 0.3s ease, background-color 0.3s ease",
                  }} />
                </div>

                {/* Metrics Row: Percentage, Stage, Speed, ETA */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  flexWrap: "wrap",
                  gap: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 600,
                      fontSize: 13,
                      color: downloadState.status === "ready" ? "#3B7A57" : "var(--text-primary)",
                    }}>
                      {downloadState.status === "ready" ? "100%" : `${Math.floor(downloadState.percent)}%`}
                    </span>
                    <span>•</span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {downloadState.status === "ready" ? "download complete! saving file..." : downloadState.stage}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {downloadState.speed && (
                      <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {downloadState.speed.toLowerCase()}
                      </span>
                    )}
                    {downloadState.eta && (
                      <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                        eta {downloadState.eta.toLowerCase()}
                      </span>
                    )}
                    {downloadState.totalSize && (
                      <span style={{ color: "var(--text-muted)" }}>
                        {downloadState.totalSize.toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Error message if failed */}
                {downloadState.status === "error" && (
                  <div style={{
                    marginTop: 14,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: "rgba(155, 35, 53, 0.08)",
                    border: "1px solid rgba(155, 35, 53, 0.2)",
                    color: "var(--color-danger, #9B2335)",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <span>{downloadState.error || "download failed"}</span>
                    <button
                      onClick={() => setDownloadState(null)}
                      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", textDecoration: "underline" }}
                    >
                      try again
                    </button>
                  </div>
                )}

                {/* Prompt to download another video */}
                {downloadState.status === "ready" && (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                    <button
                      onClick={() => {
                        setVideo(null)
                        setDownloadState(null)
                        setUrl("")
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: 12,
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textDecoration: "underline",
                      }}
                    >
                      download another video
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: "18px 20px" }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "lowercase",
                  letterSpacing: "0.05em",
                  display: "block",
                  marginBottom: 12,
                }}>
                  select download format
                </span>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
                  {video.qualities.map(q => (
                    <button
                      key={q.id}
                      onClick={() => handleDownload(q)}
                      style={{
                        background: "var(--bg-subtle)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 12,
                        padding: "12px 14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 0.15s ease",
                        fontFamily: "inherit",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = "var(--border-card)"
                        e.currentTarget.style.transform = "translateY(-1px)"
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = "var(--border-subtle)"
                        e.currentTarget.style.transform = "none"
                      }}
                    >
                      <div>
                        <div style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}>
                          <span>{q.label}</span>
                          <span style={{
                            fontSize: 10,
                            padding: "1px 5px",
                            borderRadius: 4,
                            background: "var(--bg-page)",
                            color: "var(--text-secondary)",
                            textTransform: "lowercase",
                            border: "1px solid var(--border-subtle)",
                          }}>
                            {q.ext}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          {q.desc}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: 12 }}>
                        {q.estSize && (
                          <span style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: "var(--text-secondary)",
                            fontFamily: "'JetBrains Mono', monospace",
                          }}>
                            {q.estSize}
                          </span>
                        )}
                        <div style={{ color: "var(--text-secondary)" }}>
                          <DownloadIcon />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Reset button */}
                <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                  <button
                    onClick={() => {
                      setVideo(null)
                      setUrl("")
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: 12,
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textDecoration: "underline",
                      transition: "color 0.15s ease",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                  >
                    download another video
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </>
    )}
  </main>

  {/* Footer */}
  <footer style={{
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "20px 40px",
    gap: 24,
    flexWrap: "wrap",
  }}>
    <span style={{ fontSize: 11, color: "var(--text-muted)", transition: "color 0.25s ease" }}>
      minimalist file transfer
    </span>
    <button
      onClick={() => {
        window.history.pushState({}, "", "/")
        setRoute("main")
      }}
      style={{
        fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none",
        cursor: "pointer", fontFamily: "inherit", transition: "color 0.25s ease",
      }}
      onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
      onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}
    >
      transfer files?
    </button>
    <button
      onClick={() => {
        window.history.pushState({}, "", "/admin")
        setRoute("admin")
      }}
      style={{
        fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none",
        cursor: "pointer", fontFamily: "inherit", transition: "color 0.25s ease",
      }}
      onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
      onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}
    >
      admin
    </button>
    {currentUser && (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          logged in as <strong style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{currentUser.username}</strong>
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>•</span>
        <button
          onClick={onLogout}
          style={{
            fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none",
            cursor: "pointer", fontFamily: "inherit", textDecoration: "underline",
            transition: "color 0.2s ease",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}
        >
          sign out
        </button>
      </div>
    )}
  </footer>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [initialCode] = useState(() => getInitialCodeFromUrl())
  const [route, setRoute] = useState<Route>(() => {
    const path = window.location.pathname
    if (path === "/admin") return "admin"
    if (path === "/video" || path === "/download-video") return "video"
    return "main"
  })

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("transfer_theme")
      if (saved === "dark" || saved === "light") return saved
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return "light"
  })

  // Auth State
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState<boolean>(true)

  // Auto-login (otologin) on mount via Refresh Token
  useEffect(() => {
    const restoreSession = async () => {
      const storedRefreshToken = localStorage.getItem("transfer_refresh_token")
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ refreshToken: storedRefreshToken || undefined }),
        })
        const data = await res.json()
        if (res.ok && data.success && data.accessToken) {
          setAccessToken(data.accessToken)
          if (data.refreshToken) {
            localStorage.setItem("transfer_refresh_token", data.refreshToken)
          }
          if (data.user) {
            setCurrentUser(data.user)
          }
        } else {
          localStorage.removeItem("transfer_refresh_token")
          setCurrentUser(null)
          setAccessToken(null)
        }
      } catch {
        // network / offline
      } finally {
        setAuthChecking(false)
      }
    }
    restoreSession()
  }, [])

  const handleLogin = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (res.ok && data.success && data.accessToken) {
        setAccessToken(data.accessToken)
        setCurrentUser(data.user)
        if (data.refreshToken) {
          localStorage.setItem("transfer_refresh_token", data.refreshToken)
        }
        return { success: true }
      } else {
        return { success: false, error: data.error || "login failed" }
      }
    } catch {
      return { success: false, error: "network error connecting to authentication server" }
    }
  }

  const handleLogout = async () => {
    const storedRefreshToken = localStorage.getItem("transfer_refresh_token")
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ refreshToken: storedRefreshToken || undefined }),
      })
    } catch {
      // ignore
    } finally {
      localStorage.removeItem("transfer_refresh_token")
      setCurrentUser(null)
      setAccessToken(null)
    }
  }

  const authFetch = useCallback(async (url: string, init: RequestInit = {}): Promise<Response> => {
    let token = accessToken
    const headers = new Headers(init.headers || {})
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
    let res = await fetch(url, { ...init, headers })
    if (res.status === 401) {
      const storedRefresh = localStorage.getItem("transfer_refresh_token")
      try {
        const refreshRes = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ refreshToken: storedRefresh || undefined }),
        })
        const refreshData = await refreshRes.json()
        if (refreshRes.ok && refreshData.success && refreshData.accessToken) {
          token = refreshData.accessToken
          setAccessToken(token)
          if (refreshData.refreshToken) {
            localStorage.setItem("transfer_refresh_token", refreshData.refreshToken)
          }
          if (refreshData.user) {
            setCurrentUser(refreshData.user)
          }
          headers.set("Authorization", `Bearer ${token}`)
          res = await fetch(url, { ...init, headers })
        } else {
          handleLogout()
        }
      } catch {
        handleLogout()
      }
    }
    return res
  }, [accessToken])

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
    localStorage.setItem("transfer_theme", theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(t => (t === "dark" ? "light" : "dark"))
  }

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname
      if (path === "/admin") setRoute("admin")
      else if (path === "/video" || path === "/download-video") setRoute("video")
      else setRoute("main")
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  return (
    <>
      <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
      {route === "admin" ? (
        <AdminView setRoute={setRoute} />
      ) : route === "video" ? (
        <VideoDownloaderView
          setRoute={setRoute}
          currentUser={currentUser}
          onLogin={handleLogin}
          onLogout={handleLogout}
          authFetch={authFetch}
        />
      ) : (
        <MainView
          setRoute={setRoute}
          initialCode={initialCode}
          currentUser={currentUser}
          onLogin={handleLogin}
          onLogout={handleLogout}
          accessToken={accessToken}
        />
      )}
    </>
  )
}

