import React, { useState, useEffect } from "react";
import { Search, FileText, Brain, Loader2, AlertCircle, CheckCircle, XCircle } from "lucide-react";

/**
 * Tipuri pentru răspunsul de la backend
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

export interface SyncStatus {
  is_synced: boolean | null;
  drive_total?: number;
  local_total?: number;
  missing_in_local?: number;
  extra_in_local?: number;
  modified?: number;
  error?: string;
}

export interface AskResponse {
  gpt_answer: string;
  refined_query?: string;
  mode: "drive" | "semantic";
  files?: DocumentOutDrive[];
  results?: DocumentOutSemantic[];
  sync_status?: SyncStatus;
}

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

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
 * Status Indicator Component
 */
const StatusIndicator: React.FC<{ status: 'idle' | 'syncing' | 'processing' | 'success' | 'error'; message?: string }> = ({ status, message }) => {
  const config = {
    idle: { color: '#94a3b8', icon: null, text: 'Gata' },
    syncing: { color: '#f59e0b', icon: Loader2, text: 'Sincronizare Drive...' },
    processing: { color: '#3b82f6', icon: Loader2, text: 'Procesare cerere...' },
    success: { color: '#10b981', icon: CheckCircle, text: 'Complet' },
    error: { color: '#ef4444', icon: XCircle, text: 'Eroare' }
  };

  const { color, icon: Icon, text } = config[status];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {Icon && (
        <Icon 
          size={16} 
          color={color} 
          style={{ animation: status === 'syncing' || status === 'processing' ? 'spin 1s linear infinite' : 'none' }}
        />
      )}
      {!Icon && (
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          animation: status === 'syncing' || status === 'processing' ? 'pulse 2s ease-in-out infinite' : 'none'
        }} />
      )}
      <span style={{ fontSize: 13, color, fontWeight: 500 }}>
        {message || text}
      </span>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

/**
 * Search Bar Component
 */
const SearchBar: React.FC<{
  query: string;
  setQuery: (q: string) => void;
  useSemanticSearch: boolean;
  setUseSemanticSearch: (v: boolean) => void;
  onSearch: () => void;
  loading: boolean;
}> = ({ query, setQuery, useSemanticSearch, setUseSemanticSearch, onSearch, loading }) => {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSearch();
    }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={20}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94a3b8'
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ex: ultima factură de la furnizorul X sau contracte din 2024"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 12px 12px 44px',
              border: '2px solid #e2e8f0',
              borderRadius: 12,
              fontSize: 15,
              transition: 'all 0.2s',
              outline: 'none',
            }}
            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>
        <button
          onClick={onSearch}
          disabled={loading || !query.trim()}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            background: loading || !query.trim() ? '#cbd5e1' : '#2563eb',
            color: '#fff',
            border: 0,
            cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          {loading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={18} />}
          Caută
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            padding: '10px 16px',
            background: !useSemanticSearch ? '#dbeafe' : '#f1f5f9',
            borderRadius: 10,
            border: !useSemanticSearch ? '2px solid #3b82f6' : '2px solid transparent',
            transition: 'all 0.2s',
            flex: 1
          }}
        >
          <input
            type="radio"
            checked={!useSemanticSearch}
            onChange={() => setUseSemanticSearch(false)}
            style={{ cursor: 'pointer', width: 18, height: 18 }}
          />
          <FileText size={18} color={!useSemanticSearch ? '#2563eb' : '#64748b'} />
          <span style={{ fontSize: 14, fontWeight: 600, color: !useSemanticSearch ? '#1e40af' : '#475569' }}>
            Căutare Google Drive
          </span>
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            padding: '10px 16px',
            background: useSemanticSearch ? '#dcfce7' : '#f1f5f9',
            borderRadius: 10,
            border: useSemanticSearch ? '2px solid #10b981' : '2px solid transparent',
            transition: 'all 0.2s',
            flex: 1
          }}
        >
          <input
            type="radio"
            checked={useSemanticSearch}
            onChange={() => setUseSemanticSearch(true)}
            style={{ cursor: 'pointer', width: 18, height: 18 }}
          />
          <Brain size={18} color={useSemanticSearch ? '#059669' : '#64748b'} />
          <span style={{ fontSize: 14, fontWeight: 600, color: useSemanticSearch ? '#065f46' : '#475569' }}>
            Căutare Semantică
          </span>
        </label>
      </div>
    </div>
  );
};

/**
 * Answer Box Component
 */
const AnswerBox: React.FC<{ response: AskResponse }> = ({ response }) => {
  return (
    <div
      style={{
        padding: 20,
        background: response.mode === "semantic" ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)' : 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
        borderRadius: 16,
        border: `2px solid ${response.mode === "semantic" ? '#86efac' : '#93c5fd'}`,
        marginBottom: 24,
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
      }}
    >
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {response.mode === "semantic" ? <Brain size={20} color="#059669" /> : <FileText size={20} color="#2563eb" />}
          <strong style={{ fontSize: 17, color: response.mode === "semantic" ? '#065f46' : '#1e40af' }}>
            Răspuns {response.mode === "semantic" ? "Semantic" : "Drive"}
          </strong>
        </div>
        <span style={{
          fontSize: 12,
          padding: "6px 12px",
          background: response.mode === "semantic" ? '#10b981' : '#3b82f6',
          color: '#fff',
          borderRadius: 8,
          fontWeight: 700,
          letterSpacing: '0.5px'
        }}>
          {response.mode.toUpperCase()}
        </span>
      </div>
      
      {response.refined_query && (
        <div style={{
          fontSize: 13,
          color: '#059669',
          marginBottom: 12,
          padding: '8px 12px',
          background: '#ecfdf5',
          borderRadius: 8,
          fontStyle: 'italic',
          border: '1px solid #d1fae5'
        }}>
          <strong>Query optimizat:</strong> {response.refined_query}
        </div>
      )}
      
      <div style={{ 
        whiteSpace: "pre-wrap", 
        fontSize: 15,
        lineHeight: 1.7,
        color: '#1e293b',
        background: 'rgba(255,255,255,0.6)',
        padding: 16,
        borderRadius: 10
      }}>
        {response.gpt_answer}
      </div>
    </div>
  );
};

/**
 * Drive Results Component
 */
const DriveResults: React.FC<{ files: DocumentOutDrive[] }> = ({ files }) => {
  if (!files || files.length === 0) return null;

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={22} color="#2563eb" />
        Documente găsite ({files.length})
      </h3>
      <div style={{ display: 'grid', gap: 12 }}>
        {files.map((doc, idx) => (
          <div
            key={doc.id ?? idx}
            style={{
              border: '2px solid #e2e8f0',
              borderRadius: 14,
              padding: 16,
              background: '#fff',
              transition: 'all 0.2s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3b82f6';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e2e8f0';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                  {doc.name}
                </div>
                <div style={{ color: '#64748b', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>{doc.mimeType.split('/').pop()?.toUpperCase()}</span>
                  {doc.createdTime && (
                    <>
                      <span>•</span>
                      <span>{new Date(doc.createdTime).toLocaleDateString('ro-RO')}</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {doc.webViewLink && (
                  <a
                    href={doc.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{ 
                      color: '#fff',
                      background: '#2563eb',
                      textDecoration: 'none',
                      fontWeight: 600,
                      padding: '8px 16px',
                      borderRadius: 8,
                      fontSize: 13,
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#1d4ed8'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#2563eb'}
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
                      color: '#fff',
                      background: '#10b981',
                      textDecoration: 'none',
                      fontWeight: 600,
                      padding: '8px 16px',
                      borderRadius: 8,
                      fontSize: 13,
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#059669'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#10b981'}
                  >
                    Descarcă
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Semantic Results Component
 */
const SemanticResults: React.FC<{ results: DocumentOutSemantic[] }> = ({ results }) => {
  if (!results || results.length === 0) return null;

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Brain size={22} color="#10b981" />
        Documente relevante ({results.length})
      </h3>
      <div style={{ display: 'grid', gap: 12 }}>
        {results.map((doc, idx) => (
          <div
            key={idx}
            style={{
              border: `2px solid ${doc.score > 0.8 ? '#86efac' : '#e2e8f0'}`,
              borderRadius: 14,
              padding: 16,
              background: doc.score > 0.8 ? '#f0fdf4' : '#fff',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#10b981';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = doc.score > 0.8 ? '#86efac' : '#e2e8f0';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'start',
              marginBottom: 12,
              gap: 12
            }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', flex: 1 }}>
                {doc.name}
              </div>
              <div style={{
                fontSize: 13,
                padding: "6px 12px",
                background: doc.score > 0.8 ? '#10b981' : doc.score > 0.6 ? '#f59e0b' : '#6b7280',
                color: '#fff',
                borderRadius: 8,
                fontWeight: 700,
                whiteSpace: 'nowrap'
              }}>
                {(doc.score * 100).toFixed(0)}% relevant
              </div>
            </div>
            <div style={{
              fontSize: 14,
              color: '#475569',
              lineHeight: 1.6,
              maxHeight: 120,
              overflow: 'auto',
              padding: 12,
              background: 'rgba(255,255,255,0.6)',
              borderRadius: 8
            }}>
              {doc.text.substring(0, 300)}
              {doc.text.length > 300 ? "..." : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Empty State Component
 */
const EmptyState: React.FC = () => (
  <div style={{ 
    textAlign: 'center', 
    padding: '64px 32px',
    color: '#94a3b8'
  }}>
    <div style={{ fontSize: 64, marginBottom: 16 }}>🔍</div>
    <h3 style={{ fontSize: 18, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
      Începe o căutare
    </h3>
    <p style={{ fontSize: 14 }}>
      Scrie o cerere în limbaj natural și alege modul de căutare dorit.
    </p>
  </div>
);

/**
 * Error Alert Component
 */
const ErrorAlert: React.FC<{ error: string }> = ({ error }) => (
  <div style={{
    padding: 16,
    background: '#fee2e2',
    border: '2px solid #fca5a5',
    borderRadius: 12,
    color: '#dc2626',
    marginBottom: 24,
    display: 'flex',
    gap: 12,
    alignItems: 'start'
  }}>
    <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
    <div>
      <strong style={{ display: 'block', marginBottom: 4 }}>Eroare</strong>
      {error}
    </div>
  </div>
);

/**
 * Main App Component
 */
export default function App(): React.ReactElement {
  const [query, setQuery] = useState<string>("");
  const [useSemanticSearch, setUseSemanticSearch] = useState<boolean>(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [processStatus, setProcessStatus] = useState<'idle' | 'syncing' | 'processing' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!loading) {
      setProcessStatus(error ? 'error' : response ? 'success' : 'idle');
    }
  }, [loading, error, response]);

  async function handleSearch(): Promise<void> {
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    setResponse(null);
    setProcessStatus(useSemanticSearch ? 'syncing' : 'processing');
    
    try {
      if (useSemanticSearch) {
        setTimeout(() => setProcessStatus('processing'), 1000);
      }
      
      const data = await postJSON<AskResponse>(`${API_BASE}/ask`, { 
        query,
        use_semantic_search: useSemanticSearch
      });
      
      setResponse(data);
      setProcessStatus('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setProcessStatus('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 24 }}>
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 20,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: 32,
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              padding: 12,
              borderRadius: 12,
              display: 'flex'
            }}>
              <Search size={28} color="#fff" />
            </div>
            Document Search
          </h1>
          <p style={{ color: '#64748b', fontSize: 15, marginBottom: 12 }}>
            Caută documente folosind limbaj natural în Google Drive sau prin căutare semantică avansată.
          </p>
          <StatusIndicator status={processStatus} />
        </div>

        {/* Search Bar */}
        <SearchBar
          query={query}
          setQuery={setQuery}
          useSemanticSearch={useSemanticSearch}
          setUseSemanticSearch={setUseSemanticSearch}
          onSearch={handleSearch}
          loading={loading}
        />

        {/* Error */}
        {error && <ErrorAlert error={error} />}

        {/* Loading */}
        {loading && (
          <div style={{ 
            textAlign: 'center', 
            padding: 48,
            color: '#64748b'
          }}>
            <Loader2 size={48} color="#3b82f6" style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
            <p style={{ fontSize: 15, fontWeight: 500 }}>
              {processStatus === 'syncing' ? 'Sincronizare Drive...' : 'Procesare cerere...'}
            </p>
          </div>
        )}

        {/* Results */}
        {response && (
          <>
            <AnswerBox response={response} />
            
            {response.mode === "drive" && (
              <>
                <DriveResults files={response.files || []} />
                {(!response.files || response.files.length === 0) && (
                  <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>
                    Nu s-au găsit documente în Google Drive.
                  </p>
                )}
              </>
            )}
            
            {response.mode === "semantic" && (
              <>
                <SemanticResults results={response.results || []} />
                {(!response.results || response.results.length === 0) && (
                  <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>
                    Nu s-au găsit documente relevante.
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* Empty State */}
        {!loading && !response && !error && <EmptyState />}
      </div>
    </div>
  );
}