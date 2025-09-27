import React, { useState } from "react";

/**
 * Tipuri pentru răspunsul de la backend (/ask)
 */
export interface DocumentOut {
  id?: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  webContentLink?: string; // pentru descărcare
  createdTime?: string;
  size?: string;
  summary?: string; // rezumat generat de GPT (opțional)
}

export interface AskResponse {
  gpt_answer: string;
  files: DocumentOut[];
}

/**
 * Baza de API – setează VITE_API_BASE în .env.local (Vite)
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

/**
 * Cheie stabilă pentru .map() chiar dacă backend-ul nu returnează mereu id
 */
function keyFor(doc: DocumentOut, idx: number): string {
  return doc.id ?? doc.webViewLink ?? `${doc.name}-${idx}`;
}

export default function App(): React.ReactElement {
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<DocumentOut[]>([]);
  const [gptAnswer, setGptAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setGptAnswer(null);
    try {
      const data = await postJSON<AskResponse>(`${API_BASE}/ask`, { query });
      setGptAnswer(data.gpt_answer);
      setResults(Array.isArray(data.files) ? data.files : []);
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
          🔎 Document Search (Drive + GPT)
        </h1>
        <p style={{ color: "#556", marginBottom: 16 }}>
          Scrie o cerere în limbaj natural (ex.: „ultima factură de la furnizorul X”).
        </p>

        <form
          onSubmit={handleSearch}
          style={{ display: "flex", gap: 8, marginBottom: 16 }}
        >
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
            }}
          >
            Caută
          </button>
        </form>

        {loading && <p style={{ color: "#64748b" }}>Se caută documente...</p>}
        {error && <p style={{ color: "#dc2626" }}>{error}</p>}

        {gptAnswer && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: "#f1f5f9",
              borderRadius: 12,
            }}
          >
            <strong>Răspuns GPT:</strong>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{gptAnswer}</pre>
          </div>
        )}

        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 8,
          }}
        >
          {results.map((doc, idx) => (
            <li
              key={keyFor(doc, idx)}
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
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {doc.name ?? "(fără nume)"}
                  </div>
                  <div style={{ color: "#64748b", fontSize: 14 }}>
                    {doc.mimeType ?? "unknown"}
                    {doc.createdTime
                      ? ` · ${new Date(doc.createdTime).toLocaleString()}`
                      : ""}
                    {doc.size ? ` · ${doc.size}B` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  {doc.webViewLink ? (
                    <a
                      href={doc.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#2563eb" }}
                    >
                      Deschide
                    </a>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>fără link</span>
                  )}
                  {doc.webContentLink && (
                    <a
                      href={doc.webContentLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#16a34a" }}
                    >
                      Descarcă
                    </a>
                  )}
                </div>
              </div>
              {doc.summary && (
                <div
                  style={{
                    fontSize: 13,
                    color: "#334155",
                    marginTop: 6,
                    background: "#f1f5f9",
                    padding: 8,
                    borderRadius: 8,
                  }}
                >
                  {doc.summary}
                </div>
              )}
            </li>
          ))}
        </ul>

        {!loading && results.length === 0 && !error && (
          <p style={{ color: "#94a3b8", marginTop: 8 }}>
            Nu sunt rezultate încă. Încearcă o căutare.
          </p>
        )}
      </div>
    </div>
  );
}
