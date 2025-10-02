from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Literal
from openai import OpenAI
import os, json, re
import numpy as np
from googleapiclient.discovery import build  # type: ignore
from google.oauth2 import service_account  # type: ignore
from dotenv import load_dotenv
import asyncio
from datetime import datetime

from pdf_extractor import sync_pdfs

# === Config FastAPI ===
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Config OpenAI ===
load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("OPENAI_API_KEY nu este setat.")
client = OpenAI(api_key=api_key)

# === Config Google Drive ===
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
creds = service_account.Credentials.from_service_account_file("service.json", scopes=SCOPES)
drive_service = build("drive", "v3", credentials=creds)

# === Load embeddings ===
docs = []
EMBEDDINGS_FILE = "embeddings.json"

def load_embeddings():
    global docs
    try:
        with open(EMBEDDINGS_FILE, "r", encoding="utf-8") as f:
            docs = json.load(f)
            print(f"✅ Încărcat {len(docs)} documente din {EMBEDDINGS_FILE}")
    except FileNotFoundError:
        docs = []
        print("⚠️ embeddings.json nu a fost găsit.")

load_embeddings()

# === MIME Types Mapping ===
MIME_TYPE_MAP = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "zip": "application/zip",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png"
}

# === Helper pentru parsare JSON robust ===
def extract_json_from_response(content: str) -> dict:
    """Extrage JSON dintr-un răspuns GPT care poate conține markdown sau text extra."""
    if not content:
        return {}
    
    content = content.strip()
    
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    
    if "```" in content:
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
    
    match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    
    start = content.find('{')
    end = content.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(content[start:end+1])
        except json.JSONDecodeError:
            pass
    
    print(f"⚠️ Nu s-a putut parsa JSON din: {content[:200]}...")
    return {}

def escape_drive_query(text: str) -> str:
    """Escape ghilimele simple pentru Drive API query."""
    return text.replace("'", "\\'")

def build_drive_query_extended(
    query: str = "",
    mime_types: List[str] = None,
    date_after: Optional[str] = None,
    date_before: Optional[str] = None,
    folder_id: Optional[str] = None,
    use_fulltext: bool = True
) -> str:
    """
    Construiește query pentru Google Drive API cu filtre extinse.
    
    Args:
        query: Textul căutării
        mime_types: Lista de extensii (pdf, docx, etc.)
        date_after: Data minimă (YYYY-MM-DD)
        date_before: Data maximă (YYYY-MM-DD)
        folder_id: ID-ul folderului (opțional)
        use_fulltext: Dacă să includă fullText contains
    """
    conditions = ["trashed = false"]
    
    # Query text (name + fullText)
    if query and query.strip():
        escaped_query = escape_drive_query(query.strip())
        if use_fulltext:
            conditions.append(f"(name contains '{escaped_query}' or fullText contains '{escaped_query}')")
        else:
            conditions.append(f"name contains '{escaped_query}'")
    
    # MIME types
    if mime_types and len(mime_types) > 0:
        mime_conditions = []
        for ext in mime_types:
            mime = MIME_TYPE_MAP.get(ext.lower())
            if mime:
                mime_conditions.append(f"mimeType = '{mime}'")
        
        if mime_conditions:
            conditions.append("(" + " or ".join(mime_conditions) + ")")
    
    # Date filters
    if date_after:
        conditions.append(f"modifiedTime >= '{date_after}T00:00:00Z'")
    
    if date_before:
        conditions.append(f"modifiedTime <= '{date_before}T23:59:59Z'")
    
    # Folder
    if folder_id:
        conditions.append(f"'{folder_id}' in parents")
    
    q = " and ".join(conditions)
    return q

def check_drive_sync() -> dict:
    """Verifică sincronizarea Drive cu embeddings.json"""
    load_embeddings()
    try:
        results = drive_service.files().list(
            q="mimeType='application/pdf' and trashed = false",
            fields="files(id, name, modifiedTime)",
            pageSize=1000
        ).execute()
        
        drive_files = results.get("files", [])
        drive_ids = {f["id"]: f for f in drive_files}
        local_ids = {doc["id"]: doc for doc in docs}
        
        missing_in_local = set(drive_ids.keys()) - set(local_ids.keys())
        extra_in_local = set(local_ids.keys()) - set(drive_ids.keys())
        
        modified = []
        for file_id in set(drive_ids.keys()) & set(local_ids.keys()):
            drive_modified = drive_ids[file_id].get("modifiedTime", "")
            local_modified = local_ids[file_id].get("modifiedTime", "")
            if drive_modified and local_modified and drive_modified > local_modified:
                modified.append({
                    "id": file_id,
                    "name": drive_ids[file_id]["name"],
                    "drive_modified": drive_modified,
                    "local_modified": local_modified
                })
        
        is_synced = len(missing_in_local) == 0 and len(extra_in_local) == 0 and len(modified) == 0
        
        result = {
            "is_synced": is_synced,
            "drive_total": len(drive_ids),
            "local_total": len(local_ids),
            "missing_in_local": len(missing_in_local),
            "extra_in_local": len(extra_in_local),
            "modified": len(modified),
            "details": {
                "missing_files": [{"id": id, "name": drive_ids[id]["name"]} for id in list(missing_in_local)[:5]],
                "extra_files": [{"id": id, "name": local_ids[id]["name"]} for id in list(extra_in_local)[:5]],
                "modified_files": modified[:5]
            }
        }
        
        if not is_synced:
            print("⚠️ DIFERENȚE DETECTATE - se rulează sincronizarea...")
            sync_result = sync_pdfs()
            load_embeddings()
            return sync_result
        
        print("✅ Drive și embeddings.json sunt sincronizate!")
        return result
        
    except Exception as e:
        print(f"❌ Eroare verificare sincronizare: {e}")
        return {"is_synced": None, "error": str(e)}

# === Modele Pydantic ===
class SearchFilters(BaseModel):
    mime_types: Optional[List[str]] = None
    date_after: Optional[str] = None
    date_before: Optional[str] = None
    folder_id: Optional[str] = None

class DriveSearchRequest(BaseModel):
    query: str
    page_size: Optional[int] = 50
    page_token: Optional[str] = None
    filters: Optional[SearchFilters] = None

class DriveSearchResponse(BaseModel):
    files: List[dict]
    nextPageToken: Optional[str] = None
    query_used: str

class HybridSearchRequest(BaseModel):
    query: str
    filters: Optional[SearchFilters] = None
    top_n: Optional[int] = 10

class HybridResult(BaseModel):
    source: Literal["drive", "local"]
    id: str
    name: str
    mimeType: Optional[str] = None
    webViewLink: Optional[str] = None
    modifiedTime: Optional[str] = None
    size: Optional[int] = None
    snippet: Optional[str] = None
    score_semantic: Optional[float] = None
    title_hit: Optional[bool] = None

class HybridSearchResponse(BaseModel):
    mode: str = "hybrid"
    query: str
    gpt_answer: str
    results: List[HybridResult]
    counts: dict
    query_used: Optional[str] = None

class AskRequest(BaseModel):
    query: str
    use_semantic_search: bool = False

class DocumentOutDrive(BaseModel):
    id: str
    name: str
    mimeType: str
    webViewLink: str
    webContentLink: Optional[str] = None
    createdTime: Optional[str] = None

class DocumentOutSemantic(BaseModel):
    name: str
    text: str
    score: float

class AskResponse(BaseModel):
    gpt_answer: str
    refined_query: Optional[str] = None
    mode: str
    files: Optional[List[DocumentOutDrive]] = None
    results: Optional[List[DocumentOutSemantic]] = None
    sync_status: Optional[dict] = None

# === Helpers ===
def cosine_similarity(a: List[float], b: List[float]) -> float:
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def build_drive_query(keywords: List[str], date_after: Optional[str], date_before: Optional[str]) -> str:
    """Legacy function - kept for backward compatibility"""
    conditions = ["trashed = false"]
    if keywords:
        kw_conditions = [f"name contains '{kw}'" for kw in keywords]
        conditions.append("(" + " or ".join(kw_conditions) + ")")
    if date_after:
        conditions.append(f"modifiedTime >= '{date_after}T00:00:00Z'")
    if date_before:
        conditions.append(f"modifiedTime <= '{date_before}T23:59:59Z'")
    q = " and ".join(conditions)
    return q

# === NEW ENDPOINT: /drive-search ===
@app.post("/drive-search", response_model=DriveSearchResponse)
async def drive_search_endpoint(req: DriveSearchRequest):
    """
    Endpoint dedicat pentru căutare în Google Drive cu filtre avansate.
    Returnează doar metadata, fără descărcare de fișiere.
    """
    try:
        filters = req.filters or SearchFilters()
        
        # Construiește query
        q = build_drive_query_extended(
            query=req.query,
            mime_types=filters.mime_types,
            date_after=filters.date_after,
            date_before=filters.date_before,
            folder_id=filters.folder_id,
            use_fulltext=True
        )
        
        print(f"=== Drive Search Query === {q}")
        
        # Apel Drive API
        params = {
            "q": q,
            "orderBy": "modifiedTime desc",
            "fields": "nextPageToken, files(id, name, mimeType, webViewLink, webContentLink, createdTime, modifiedTime, size)",
            "pageSize": req.page_size or 50
        }
        
        if req.page_token:
            params["pageToken"] = req.page_token
        
        results = drive_service.files().list(**params).execute()
        
        files = results.get("files", [])
        next_page_token = results.get("nextPageToken")
        
        return DriveSearchResponse(
            files=files,
            nextPageToken=next_page_token,
            query_used=q
        )
        
    except Exception as e:
        print(f"❌ Eroare în /drive-search: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# === NEW ENDPOINT: /hybrid-search ===
@app.post("/hybrid-search", response_model=HybridSearchResponse)
async def hybrid_search_endpoint(req: HybridSearchRequest):
    """
    Endpoint pentru căutare hibridă: combină Drive metadata + semantic search local.
    Fuzionează rezultatele și le ordonează după relevanță.
    """
    try:
        # Rulează ambele căutări în paralel
        drive_task = asyncio.create_task(search_drive_internal(req.query, req.filters))
        semantic_task = asyncio.create_task(search_semantic_internal(req.query, req.top_n or 10))
        
        drive_results, semantic_results = await asyncio.gather(drive_task, semantic_task)
        
        # Fuzionare rezultate
        merged = []
        seen_ids = set()
        
        # Adaugă rezultate semantice (prioritate)
        for sem_result in semantic_results:
            doc_id = sem_result.get("id", sem_result["name"])
            if doc_id not in seen_ids:
                seen_ids.add(doc_id)
                merged.append(HybridResult(
                    source="local",
                    id=doc_id,
                    name=sem_result["name"],
                    mimeType=sem_result.get("mimeType"),
                    webViewLink=sem_result.get("webViewLink"),
                    modifiedTime=sem_result.get("modifiedTime"),
                    size=sem_result.get("size"),
                    snippet=sem_result.get("text", "")[:300],
                    score_semantic=sem_result["score"],
                    title_hit=False
                ))
        
        # Adaugă rezultate Drive (dacă nu sunt duplicate)
        for drive_file in drive_results:
            if drive_file["id"] not in seen_ids:
                seen_ids.add(drive_file["id"])
                
                # Check dacă query match-uiește în titlu
                query_lower = req.query.lower()
                name_lower = drive_file["name"].lower()
                title_hit = query_lower in name_lower
                
                merged.append(HybridResult(
                    source="drive",
                    id=drive_file["id"],
                    name=drive_file["name"],
                    mimeType=drive_file.get("mimeType"),
                    webViewLink=drive_file.get("webViewLink"),
                    modifiedTime=drive_file.get("modifiedTime"),
                    size=drive_file.get("size"),
                    snippet=None,
                    score_semantic=None,
                    title_hit=title_hit
                ))
        
        # Sortare: semantic score desc > title_hit > modifiedTime desc
        def sort_key(item):
            score = item.score_semantic or 0
            title = 1 if item.title_hit else 0
            time = item.modifiedTime or ""
            return (-score, -title, time)
        
        merged.sort(key=sort_key, reverse=True)
        
        # Generează răspuns GPT bazat pe top rezultate
        gpt_answer = await generate_hybrid_answer(req.query, merged[:5])
        
        drive_count = sum(1 for r in merged if r.source == "drive")
        local_count = sum(1 for r in merged if r.source == "local")
        
        return HybridSearchResponse(
            query=req.query,
            gpt_answer=gpt_answer,
            results=merged,
            counts={"drive": drive_count, "local": local_count},
            query_used=build_drive_query_extended(
                req.query, 
                req.filters.mime_types if req.filters else None,
                req.filters.date_after if req.filters else None,
                req.filters.date_before if req.filters else None
            )
        )
        
    except Exception as e:
        print(f"❌ Eroare în /hybrid-search: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# === Helper Functions for Hybrid Search ===
async def search_drive_internal(query: str, filters: Optional[SearchFilters]) -> List[dict]:
    """Căutare Drive internă (folosită de hybrid)"""
    try:
        f = filters or SearchFilters()
        q = build_drive_query_extended(
            query=query,
            mime_types=f.mime_types,
            date_after=f.date_after,
            date_before=f.date_before,
            folder_id=f.folder_id,
            use_fulltext=True
        )
        
        results = drive_service.files().list(
            q=q,
            orderBy="modifiedTime desc",
            fields="files(id, name, mimeType, webViewLink, webContentLink, modifiedTime, size)",
            pageSize=20
        ).execute()
        
        return results.get("files", [])
    except Exception as e:
        print(f"⚠️ Eroare search_drive_internal: {e}")
        return []

async def search_semantic_internal(query: str, top_n: int = 10) -> List[dict]:
    """Căutare semantică internă (folosită de hybrid)"""
    try:
        # Creare embedding
        query_emb = client.embeddings.create(
            model="text-embedding-3-small",
            input=query
        ).data[0].embedding
        
        # Calculare similaritate
        scored = []
        for d in docs:
            try:
                score = cosine_similarity(query_emb, d["embedding"])
                scored.append({
                    "id": d.get("id", d["name"]),
                    "name": d["name"],
                    "text": d.get("text", ""),
                    "score": float(score),
                    "mimeType": d.get("mimeType"),
                    "webViewLink": d.get("webViewLink"),
                    "modifiedTime": d.get("modifiedTime"),
                    "size": d.get("size")
                })
            except Exception as e:
                print(f"⚠️ Eroare scor pentru {d.get('name')}: {e}")
                continue
        
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:top_n]
        
    except Exception as e:
        print(f"⚠️ Eroare search_semantic_internal: {e}")
        return []

async def generate_hybrid_answer(query: str, top_results: List[HybridResult]) -> str:
    """Generează răspuns GPT bazat pe rezultatele hibride"""
    try:
        context_parts = []
        for i, result in enumerate(top_results[:5], 1):
            source_label = "Drive" if result.source == "drive" else "Local"
            snippet = result.snippet or "(metadata only)"
            context_parts.append(f"{i}. [{source_label}] {result.name}: {snippet[:200]}")
        
        context = "\n".join(context_parts)
        
        prompt = f"""Utilizatorul a căutat: "{query}"

Am găsit următoarele documente relevante:
{context}

Oferă un răspuns concis care:
- Rezumă ce documente sunt disponibile
- Menționează explicit numele documentelor
- Indică dacă sunt din Drive sau indexul local
- Sugerează care sunt cele mai relevante"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Ești un asistent care rezumă rezultate de căutare."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3
        )
        
        return response.choices[0].message.content
        
    except Exception as e:
        print(f"⚠️ Eroare generare răspuns: {e}")
        return f"Am găsit {len(top_results)} documente relevante pentru căutarea ta."

# === LEGACY ENDPOINTS (păstrate pentru backward compatibility) ===
async def drive_search(query: str):
    """Legacy drive search - păstrat pentru /ask endpoint"""
    prompt = f"""Utilizatorul a cerut: "{query}".
Extrage instrucțiuni pentru căutare în Google Drive.
Răspunde DOAR cu JSON valid:
{{
  "keywords": ["cuvant1"],
  "date_after": "YYYY-MM-DD" sau null,
  "date_before": "YYYY-MM-DD" sau null,
  "order": "desc",
  "answer": "Răspuns scurt"
}}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Ești un asistent JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3
        )
        content = resp.choices[0].message.content
        plan = extract_json_from_response(content)
        
        keywords = plan.get("keywords", [query])
        date_after = plan.get("date_after")
        date_before = plan.get("date_before")
        order = plan.get("order", "desc")
        answer = plan.get("answer", f"Căutare pentru: {query}")
        
        q = build_drive_query(answer, date_after, date_before)
        
        results = drive_service.files().list(
            q=q,
            orderBy=f"createdTime {order}",
            fields="files(id, name, mimeType, webViewLink, webContentLink, createdTime)",
            pageSize=50
        ).execute()
        files = results.get("files", [])
        
        return AskResponse(
            gpt_answer=answer,
            mode="drive",
            files=[DocumentOutDrive(**f) for f in files]
        )
        
    except Exception as e:
        print(f"❌ Eroare drive_search: {e}")
        return AskResponse(
            gpt_answer=f"Căutare simplă pentru: {query}",
            mode="drive",
            files=[]
        )

async def semantic_search(query: str):
    """Legacy semantic search - păstrat pentru /ask endpoint"""
    sync_status = check_drive_sync()
    
    refined_query = query
    try:
        refine_resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Optimizează query-uri."},
                {"role": "user", "content": f'Reformulează: "{query}"'},
            ]
        )
        refined_content = refine_resp.choices[0].message.content
        refined_json = extract_json_from_response(refined_content)
        refined_query = refined_json.get("refined", query)
    except:
        pass

    try:
        query_emb = client.embeddings.create(
            model="text-embedding-3-small",
            input=refined_query
        ).data[0].embedding
    except Exception as e:
        print(f"❌ Eroare embedding: {e}")
        return AskResponse(
            gpt_answer="Eroare la procesare.",
            mode="semantic",
            results=[],
            sync_status=sync_status
        )

    scored = []
    for d in docs:
        try:
            score = cosine_similarity(query_emb, d["embedding"])
            scored.append({
                "name": d["name"],
                "text": d.get("text", ""),
                "score": float(score)
            })
        except:
            continue

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_docs = scored[:10]

    context = "\n\n".join([f"{d['name']}: {d['text'][:15000]}" for d in top_docs])
    answer_prompt = f"""Întrebare: {query}
Query rafinat: {refined_query}

Documente:
{context}

Răspunde pe baza documentelor, menționează numele."""

    answer_resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Răspunzi pe baza documentelor."},
            {"role": "user", "content": answer_prompt},
        ]
    )
    
    answer = answer_resp.choices[0].message.content

    return AskResponse(
        gpt_answer=answer,
        refined_query=refined_query,
        mode="semantic",
        results=[DocumentOutSemantic(**d) for d in top_docs],
        sync_status=sync_status
    )

@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    """Legacy endpoint - păstrat pentru backward compatibility"""
    try:
        if req.use_semantic_search:
            return await semantic_search(req.query)
        else:
            return await drive_search(req.query)
    except Exception as e:
        print(f"❌ Eroare în /ask: {e}")
        return AskResponse(
            gpt_answer=f"Eroare: {str(e)}",
            mode="error",
            files=[],
            results=[]
        )