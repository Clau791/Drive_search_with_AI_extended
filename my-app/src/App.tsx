import React, { useState } from "react";

/**
 * Tipuri pentru răspunsul de la backend (/ask)
 */
export interface DocumentOutDrive {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  webContentLink?: string;
  createdTime?: string;
}

export interface DocumentOutSemantic {
  name: string;
  text: string;
  score: number;
}

export interface AskResponse {
  gpt_answer: string;
  refined_query?: string;
  mode: "drive" | "semantic";
  files?: DocumentOutDrive[];
  results?: DocumentOutSemantic[];
}

/**
 * Baza de API
 */
const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

/**
 * Helper fetch cu tipare TS + tratare erori
 */
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export default function App(): React.ReactElement {
  const [query, setQuery] = useState<string>("");
  const [useSemanticSearch, setUseSemanticSearch] = useState<boolean>(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const data = await postJSON<AskResponse>(`${API_BASE}/ask`, { 
        query,
        use_semantic_search: useSemanticSearch
      });
      setResponse(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 8px 24px rgba(0,0,0,.06)",
          padding: 24,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
          🔎 Document Search (Drive + Semantic)
        </h1>
        <p style={{ color: "#556", marginBottom: 16 }}>
          Scrie o cerere în limbaj natural. Alege modul de căutare dorit.
        </p>

        <form
          onSubmit={handleSearch}
          style={{ marginBottom: 16 }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex: ultima factură de la furnizorul X"
              style={{
                flex: 1,
                padding: "10px 12px",
                border: "1px solid #d0d7de",
                borderRadius: 12,
              }}
            />
            <button
              type="submit"
              style={{
                padding: "10px 16px",
                borderRadius: 12,
                background: "#2563eb",
                color: "#fff",
                border: 0,
                cursor: "pointer",
              }}
            >
              Caută
            </button>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              padding: "8px 12px",
              background: useSemanticSearch ? "#dbeafe" : "#f1f5f9",
              borderRadius: 8,
              width: "fit-content",
              transition: "background 0.2s",
            }}
          >
            <input
              type="checkbox"
              checked={useSemanticSearch}
              onChange={(e) => setUseSemanticSearch(e.target.checked)}
              style={{ cursor: "pointer", width: 16, height: 16 }}
            />
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              {useSemanticSearch ? "🧠 Căutare Semantică" : "📁 Căutare Google Drive"}
            </span>
          </label>
        </form>

        {loading && <p style={{ color: "#64748b" }}>Se caută documente...</p>}
        {error && (
          <div style={{
            padding: 12,
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 12,
            color: "#dc2626",
            marginBottom: 16
          }}>
            <strong>Eroare:</strong> {error}
          </div>
        )}

        {response && (
          <>
            {/* Răspuns GPT */}
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: response.mode === "semantic" ? "#f0fdf4" : "#eff6ff",
                borderRadius: 12,
                border: `1px solid ${response.mode === "semantic" ? "#bbf7d0" : "#bfdbfe"}`,
              }}
            >
              <div style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                marginBottom: 8
              }}>
                <strong style={{ fontSize: 16 }}>
                  {response.mode === "semantic" ? "🧠 Răspuns Semantic" : "📁 Răspuns Drive"}
                </strong>
                <span style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  background: response.mode === "semantic" ? "#86efac" : "#93c5fd",
                  borderRadius: 6,
                  fontWeight: 600
                }}>
                  {response.mode.toUpperCase()}
                </span>
              </div>
              {response.refined_query && (
                <div style={{
                  fontSize: 13,
                  color: "#059669",
                  marginBottom: 8,
                  fontStyle: "italic"
                }}>
                  Query rafinat: {response.refined_query}
                </div>
              )}
              <pre style={{ 
                whiteSpace: "pre-wrap", 
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.6
              }}>
                {response.gpt_answer}
              </pre>
            </div>

            {/* Rezultate Google Drive */}
            {response.mode === "drive" && response.files && response.files.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
                  📄 Documente găsite ({response.files.length})
                </h3>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {response.files.map((doc, idx) => (
                    <li
                      key={doc.id ?? idx}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600 }}>
                            {doc.name}
                          </div>
                          <div style={{ color: "#64748b", fontSize: 14 }}>
                            {doc.mimeType}
                            {doc.createdTime
                              ? ` · ${new Date(doc.createdTime).toLocaleString()}`
                              : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 12 }}>
                          {doc.webViewLink && (
                            <a
                              href={doc.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              style={{ 
                                color: "#2563eb",
                                textDecoration: "none",
                                fontWeight: 500
                              }}
                            >
                              Deschide
                            </a>
                          )}
                          {doc.webContentLink && (
                            <a
                              href={doc.webContentLink}
                              target="_blank"
                              rel="noreferrer"
                              style={{ 
                                color: "#16a34a",
                                textDecoration: "none",
                                fontWeight: 500
                              }}
                            >
                              Descarcă
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Rezultate Semantic Search */}
            {response.mode === "semantic" && response.results && response.results.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
                  🎯 Documente relevante ({response.results.length})
                </h3>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {response.results.map((doc, idx) => (
                    <li
                      key={idx}
                      style={{
                        border: "1px solid #d1fae5",
                        borderRadius: 12,
                        padding: 12,
                        background: doc.score > 0.8 ? "#ecfdf5" : "#fff",
                      }}
                    >
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "start",
                        marginBottom: 8
                      }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>
                          {doc.name}
                        </div>
                        <div style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          background: doc.score > 0.8 ? "#34d399" : "#9ca3af",
                          color: "#fff",
                          borderRadius: 6,
                          fontWeight: 600
                        }}>
                          {(doc.score * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div style={{
                        fontSize: 14,
                        color: "#334155",
                        lineHeight: 1.6,
                        maxHeight: 120,
                        overflow: "auto"
                      }}>
                        {doc.text.substring(0, 300)}
                        {doc.text.length > 300 ? "..." : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Mesaj când nu sunt rezultate */}
            {response.mode === "drive" && (!response.files || response.files.length === 0) && (
              <p style={{ color: "#94a3b8", marginTop: 16, textAlign: "center" }}>
                Nu s-au găsit documente în Google Drive.
              </p>
            )}
            {response.mode === "semantic" && (!response.results || response.results.length === 0) && (
              <p style={{ color: "#94a3b8", marginTop: 16, textAlign: "center" }}>
                Nu s-au găsit documente relevante.
              </p>
            )}
          </>
        )}

        {!loading && !response && !error && (
          <div style={{ 
            textAlign: "center", 
            padding: 32,
            color: "#94a3b8"
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <p>Începe o căutare pentru a vedea rezultate.</p>
          </div>
        )}
      </div>
    </div>
  );
}