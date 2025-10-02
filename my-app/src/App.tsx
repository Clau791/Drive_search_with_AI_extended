import React, { useState, useEffect } from "react";
import { Search, FileText, Brain, Loader2, AlertCircle, CheckCircle, XCircle, Network, Calendar, Filter, X } from "lucide-react";

// === TYPES ===
export interface DocumentOutDrive {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  webContentLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: number;
}

export interface HybridResult {
  source: "drive" | "local";
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: number;
  snippet?: string;
  score_semantic?: number;
  title_hit?: boolean;
}

export interface SearchFilters {
  mime_types?: string[];
  date_after?: string;
  date_before?: string;
}

export interface DriveSearchResponse {
  files: DocumentOutDrive[];
  nextPageToken?: string;
  query_used: string;
}

export interface HybridSearchResponse {
  mode: string;
  query: string;
  gpt_answer: string;
  results: HybridResult[];
  counts: { drive: number; local: number };
  query_used?: string;
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

// === FILE TYPE CONSTANTS ===
const FILE_TYPES = [
  { ext: "pdf", label: "PDF", color: "#ef4444" },
  { ext: "docx", label: "Word", color: "#3b82f6" },
  { ext: "xlsx", label: "Excel", color: "#10b981" },
  { ext: "pptx", label: "PowerPoint", color: "#f59e0b" },
  { ext: "txt", label: "Text", color: "#6b7280" },
];

// === COMPONENTS ===
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
        }} />
      )}
      <span style={{ fontSize: 13, color, fontWeight: 500 }}>
        {message || text}
      </span>
    </div>
  );
};

const FiltersPanel: React.FC<{
  filters: SearchFilters;
  setFilters: (f: SearchFilters) => void;
  show: boolean;
}> = ({ filters, setFilters, show }) => {
  if (!show) return null;

  const toggleFileType = (ext: string) => {
    const current = filters.mime_types || [];
    const updated = current.includes(ext)
      ? current.filter(e => e !== ext)
      : [...current, ext];
    setFilters({ ...filters, mime_types: updated });
  };

  return (
    <div style={{
      background: '#f8fafc',
      border: '2px solid #e2e8f0',
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Filter size={18} color="#64748b" />
        <strong style={{ fontSize: 14, color: '#475569' }}>Filtre Avansate</strong>
      </div>

      {/* Date Filters */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: '#64748b', marginBottom: 6, display: 'block' }}>
          <Calendar size={14} style={{ display: 'inline', marginRight: 4 }} />
          Perioadă
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input
            type="date"
            value={filters.date_after || ''}
            onChange={(e) => setFilters({ ...filters, date_after: e.target.value })}
            placeholder="De la"
            style={{
              padding: '8px 12px',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 13,
            }}
          />
          <input
            type="date"
            value={filters.date_before || ''}
            onChange={(e) => setFilters({ ...filters, date_before: e.target.value })}
            placeholder="Până la"
            style={{
              padding: '8px 12px',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 13,
            }}
          />
        </div>
      </div>

      {/* File Types */}
      <div>
        <label style={{ fontSize: 13, color: '#64748b', marginBottom: 6, display: 'block' }}>
          <FileText size={14} style={{ display: 'inline', marginRight: 4 }} />
          Tip Fișier
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILE_TYPES.map(({ ext, label, color }) => {
            const selected = (filters.mime_types || []).includes(ext);
            return (
              <button
                key={ext}
                onClick={() => toggleFileType(ext)}
                style={{
                  padding: '6px 12px',
                  border: `2px solid ${selected ? color : '#e2e8f0'}`,
                  background: selected ? `${color}15` : '#fff',
                  color: selected ? color : '#64748b',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Clear Filters */}
      {(filters.mime_types?.length || filters.date_after || filters.date_before) && (
        <button
          onClick={() => setFilters({})}
          style={{
            marginTop: 12,
            padding: '6px 12px',
            background: '#fee2e2',
            color: '#dc2626',
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <X size={14} />
          Șterge Filtre
        </button>
      )}
    </div>
  );
};

const SearchBar: React.FC<{
  query: string;
  setQuery: (q: string) => void;
  mode: "drive" | "semantic" | "hybrid";
  setMode: (m: "drive" | "semantic" | "hybrid") => void;
  onSearch: () => void;
  loading: boolean;
  showFilters: boolean;
  setShowFilters: (v: boolean) => void;
}> = ({ query, setQuery, mode, setMode, onSearch, loading, showFilters, setShowFilters }) => {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSearch();
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
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
        
        {mode === 'drive' && (
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              padding: '12px 16px',
              borderRadius: 12,
              background: showFilters ? '#dbeafe' : '#f1f5f9',
              color: showFilters ? '#2563eb' : '#64748b',
              border: showFilters ? '2px solid #3b82f6' : '2px solid #e2e8f0',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
            }}
          >
            <Filter size={18} />
            Filtre
          </button>
        )}
        
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

      {/* Mode Selector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <ModeButton
          active={mode === 'drive'}
          onClick={() => setMode('drive')}
          icon={FileText}
          label="Drive"
          color="#2563eb"
        />
        <ModeButton
          active={mode === 'semantic'}
          onClick={() => setMode('semantic')}
          icon={Brain}
          label="Semantic"
          color="#10b981"
        />
        <ModeButton
          active={mode === 'hybrid'}
          onClick={() => setMode('hybrid')}
          icon={Network}
          label="Hibrid"
          color="#8b5cf6"
        />
      </div>
    </div>
  );
};

const ModeButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.FC<any>;
  label: string;
  color: string;
}> = ({ active, onClick, icon: Icon, label, color }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      cursor: 'pointer',
      padding: '10px 16px',
      background: active ? `${color}15` : '#f1f5f9',
      borderRadius: 10,
      border: active ? `2px solid ${color}` : '2px solid transparent',
      transition: 'all 0.2s',
    }}
  >
    <Icon size={18} color={active ? color : '#64748b'} />
    <span style={{ fontSize: 14, fontWeight: 600, color: active ? color : '#475569' }}>
      {label}
    </span>
  </button>
);

const HybridResults: React.FC<{ 
  response: HybridSearchResponse;
  onLoadMore?: () => void;
  hasMore?: boolean;
}> = ({ response, onLoadMore, hasMore }) => {
  return (
    <div>
      {/* GPT Answer */}
      <div style={{
        padding: 20,
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
        borderRadius: 16,
        border: '2px solid #c4b5fd',
        marginBottom: 24,
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Network size={20} color="#8b5cf6" />
            <strong style={{ fontSize: 17, color: '#6b21a8' }}>Răspuns Hibrid</strong>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{
              fontSize: 12,
              padding: "4px 10px",
              background: '#3b82f6',
              color: '#fff',
              borderRadius: 6,
              fontWeight: 700,
            }}>
              {response.counts.drive} Drive
            </span>
            <span style={{
              fontSize: 12,
              padding: "4px 10px",
              background: '#10b981',
              color: '#fff',
              borderRadius: 6,
              fontWeight: 700,
            }}>
              {response.counts.local} Local
            </span>
          </div>
        </div>
        
        {response.query_used && (
          <div style={{
            fontSize: 11,
            color: '#7c3aed',
            marginBottom: 12,
            padding: '6px 10px',
            background: '#faf5ff',
            borderRadius: 6,
            fontFamily: 'monospace',
            border: '1px solid #e9d5ff',
            overflow: 'auto',
          }}>
            Query: {response.query_used}
          </div>
        )}
        
        <div style={{ 
          whiteSpace: "pre-wrap", 
          fontSize: 15,
          lineHeight: 1.7,
          color: '#1e293b',
          background: 'rgba(255,255,255,0.7)',
          padding: 16,
          borderRadius: 10
        }}>
          {response.gpt_answer}
        </div>
      </div>

      {/* Results */}
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#1e293b' }}>
        Toate Rezultatele ({response.results.length})
      </h3>
      
      <div style={{ display: 'grid', gap: 12 }}>
        {response.results.map((result, idx) => (
          <HybridResultCard key={result.id + idx} result={result} />
        ))}
      </div>

      {hasMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          style={{
            width: '100%',
            marginTop: 16,
            padding: '12px',
            background: '#f1f5f9',
            border: '2px solid #e2e8f0',
            borderRadius: 12,
            color: '#475569',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          Încarcă Mai Multe
        </button>
      )}
    </div>
  );
};

const HybridResultCard: React.FC<{ result: HybridResult }> = ({ result }) => {
  const isDrive = result.source === 'drive';
  const sourceColor = isDrive ? '#3b82f6' : '#10b981';
  
  return (
    <div style={{
      border: `2px solid ${result.score_semantic && result.score_semantic > 0.8 ? '#86efac' : '#e2e8f0'}`,
      borderRadius: 14,
      padding: 16,
      background: '#fff',
      transition: 'all 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 11,
              padding: "4px 8px",
              background: sourceColor,
              color: '#fff',
              borderRadius: 6,
              fontWeight: 700,
              textTransform: 'uppercase',
            }}>
              {result.source}
            </span>
            
            {result.title_hit && (
              <span style={{
                fontSize: 11,
                padding: "4px 8px",
                background: '#fbbf24',
                color: '#78350f',
                borderRadius: 6,
                fontWeight: 700,
              }}>
                Titlu
              </span>
            )}
            
            {result.score_semantic !== null && result.score_semantic !== undefined && (
              <span style={{
                fontSize: 11,
                padding: "4px 8px",
                background: result.score_semantic > 0.8 ? '#10b981' : result.score_semantic > 0.6 ? '#f59e0b' : '#6b7280',
                color: '#fff',
                borderRadius: 6,
                fontWeight: 700,
              }}>
                {(result.score_semantic * 100).toFixed(0)}%
              </span>
            )}
          </div>
          
          <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
            {result.name}
          </div>
          
          <div style={{ color: '#64748b', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {result.mimeType && <span>{result.mimeType.split('/').pop()?.toUpperCase()}</span>}
            {result.size && (
              <>
                <span>•</span>
                <span>{(result.size / 1024).toFixed(0)} KB</span>
              </>
            )}
            {result.modifiedTime && (
              <>
                <span>•</span>
                <span>{new Date(result.modifiedTime).toLocaleDateString('ro-RO')}</span>
              </>
            )}
          </div>
          
          {result.snippet && (
            <div style={{
              marginTop: 8,
              fontSize: 13,
              color: '#475569',
              lineHeight: 1.5,
              padding: 10,
              background: '#f8fafc',
              borderRadius: 8,
              maxHeight: 80,
              overflow: 'auto',
            }}>
              {result.snippet}
            </div>
          )}
        </div>
        
        {result.webViewLink && (
          <a
            href={result.webViewLink}
            target="_blank"
            rel="noreferrer"
            style={{
              color: '#fff',
              background: sourceColor,
              textDecoration: 'none',
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 13,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            Deschide
          </a>
        )}
      </div>
    </div>
  );
};

const DriveResults: React.FC<{ 
  response: DriveSearchResponse;
  onLoadMore?: () => void;
}> = ({ response, onLoadMore }) => {
  return (
    <div>
      {response.query_used && (
        <div style={{
          fontSize: 11,
          color: '#64748b',
          marginBottom: 12,
          padding: '8px 12px',
          background: '#f8fafc',
          borderRadius: 8,
          fontFamily: 'monospace',
          border: '1px solid #e2e8f0',
          overflow: 'auto',
        }}>
          Query: {response.query_used}
        </div>
      )}
      
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={22} color="#2563eb" />
        Documente găsite ({response.files.length})
      </h3>
      
      <div style={{ display: 'grid', gap: 12 }}>
        {response.files.map((doc) => (
          <div
            key={doc.id}
            style={{
              border: '2px solid #e2e8f0',
              borderRadius: 14,
              padding: 16,
              background: '#fff',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                  {doc.name}
                </div>
                <div style={{ color: '#64748b', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{doc.mimeType.split('/').pop()?.toUpperCase()}</span>
                  {doc.size && (
                    <>
                      <span>•</span>
                      <span>{(doc.size / 1024).toFixed(0)} KB</span>
                    </>
                  )}
                  {doc.modifiedTime && (
                    <>
                      <span>•</span>
                      <span>{new Date(doc.modifiedTime).toLocaleDateString('ro-RO')}</span>
                    </>
                  )}
                </div>
              </div>
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
                  transition: 'all 0.2s',
                }}
              >
                Deschide
              </a>
            </div>
          </div>
        ))}
      </div>

      {response.nextPageToken && onLoadMore && (
        <button
          onClick={onLoadMore}
          style={{
            width: '100%',
            marginTop: 16,
            padding: '12px',
            background: '#dbeafe',
            border: '2px solid #3b82f6',
            borderRadius: 12,
            color: '#1e40af',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          Încarcă Mai Multe
        </button>
      )}
    </div>
  );
};

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

// === MAIN APP ===
export default function App() {
  const [query, setQuery] = useState<string>("");
  const [mode, setMode] = useState<"drive" | "semantic" | "hybrid">("drive");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState<boolean>(false);
  
  const [driveResponse, setDriveResponse] = useState<DriveSearchResponse | null>(null);
  const [hybridResponse, setHybridResponse] = useState<HybridSearchResponse | null>(null);
  
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [processStatus, setProcessStatus] = useState<'idle' | 'syncing' | 'processing' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!loading) {
      setProcessStatus(error ? 'error' : (driveResponse || hybridResponse) ? 'success' : 'idle');
    }
  }, [loading, error, driveResponse, hybridResponse]);

  async function handleSearch() {
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    setDriveResponse(null);
    setHybridResponse(null);
    setProcessStatus('processing');
    
    try {
      if (mode === 'drive') {
        const data = await postJSON<DriveSearchResponse>(`${API_BASE}/drive-search`, {
          query,
          filters: filters.mime_types?.length || filters.date_after || filters.date_before ? filters : undefined,
          page_size: 50,
        });
        setDriveResponse(data);
      } else if (mode === 'hybrid') {
        const data = await postJSON<HybridSearchResponse>(`${API_BASE}/hybrid-search`, {
          query,
          filters: filters.mime_types?.length || filters.date_after || filters.date_before ? filters : undefined,
          top_n: 10,
        });
        setHybridResponse(data);
      } else {
        // Semantic - folosim vechiul endpoint
        const data = await postJSON<any>(`${API_BASE}/ask`, {
          query,
          use_semantic_search: true,
        });
        // Convert to hybrid format for consistency
        setHybridResponse({
          mode: 'semantic',
          query,
          gpt_answer: data.gpt_answer,
          results: [],
          counts: { drive: 0, local: data.results?.length || 0 },
        });
      }
      
      setProcessStatus('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setProcessStatus('error');
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadMore() {
    if (!driveResponse?.nextPageToken || loading) return;
    
    setLoading(true);
    try {
      const data = await postJSON<DriveSearchResponse>(`${API_BASE}/drive-search`, {
        query,
        filters: filters.mime_types?.length || filters.date_after || filters.date_before ? filters : undefined,
        page_token: driveResponse.nextPageToken,
        page_size: 50,
      });
      
      setDriveResponse({
        ...data,
        files: [...driveResponse.files, ...data.files],
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 24 }}>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      
      <div style={{
        maxWidth: 1100,
        margin: "0 auto",
        background: "#fff",
        borderRadius: 20,
        boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        padding: 32,
      }}>
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
            Căutare Documente
          </h1>
          <p style={{ fontSize: 15, color: '#64748b', marginBottom: 12 }}>
            Caută în Google Drive și baza de date locală
          </p>
          <StatusIndicator status={processStatus} />
        </div>

        {/* Search Interface */}
        <SearchBar
          query={query}
          setQuery={setQuery}
          mode={mode}
          setMode={setMode}
          onSearch={handleSearch}
          loading={loading}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
        />

        {/* Filters */}
        {mode === 'drive' && (
          <FiltersPanel
            filters={filters}
            setFilters={setFilters}
            show={showFilters}
          />
        )}

        {/* Error Display */}
        {error && <ErrorAlert error={error} />}

        {/* Results */}
        {driveResponse && (
          <DriveResults
            response={driveResponse}
            onLoadMore={handleLoadMore}
          />
        )}

        {hybridResponse && (
          <HybridResults
            response={hybridResponse}
          />
        )}
      </div>
    </div>
  );
}