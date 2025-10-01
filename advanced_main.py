from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from openai import OpenAI
import os, json, re
import numpy as np
from googleapiclient.discovery import build  # type: ignore
from google.oauth2 import service_account  # type: ignore
from dotenv import load_dotenv

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

# === Helper pentru parsare JSON robust ===
def extract_json_from_response(content: str) -> dict:
    """
    Extrage JSON dintr-un răspuns GPT care poate conține markdown sau text extra.
    Încearcă multiple strategii de parsare.
    """
    if not content:
        return {}
    
    content = content.strip()
    
    # Strategie 1: Verifică dacă e deja JSON valid
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    
    # Strategie 2: Elimină markdown code blocks
    if "```" in content:
        # Caută JSON între ```json și ``` sau între ``` și ```
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
    
    # Strategie 3: Caută primul obiect JSON valid în text
    match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    
    # Strategie 4: Încearcă să elimini toate caracterele înainte de prima { și după ultima }
    start = content.find('{')
    end = content.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(content[start:end+1])
        except json.JSONDecodeError:
            pass
    
    print(f"⚠️ Nu s-a putut parsa JSON din: {content[:200]}...")
    return {}

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

# === Modele ===
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
    conditions = ["trashed = false"]
    if keywords:
        kw_conditions = [f"name contains '{kw}'" for kw in keywords]
        conditions.append("(" + " or ".join(kw_conditions) + ")")
    if date_after:
        conditions.append(f"modifiedTime >= '{date_after}T00:00:00Z'")
    if date_before:
        conditions.append(f"modifiedTime <= '{date_before}T23:59:59Z'")
    q = " and ".join(conditions)
    print("=== Drive Query ===", q)
    return q

# === Aplicația 1: Google Drive Search ===
async def drive_search(query: str):
    prompt = f"""Utilizatorul a cerut: "{query}".
Extrage instrucțiuni pentru căutare în Google Drive.
Răspunde DOAR cu JSON valid (fără markdown, fără text extra):
{{
  "keywords": ["cuvant1", "cuvant2"],
  "date_after": "YYYY-MM-DD" sau null,
  "date_before": "YYYY-MM-DD" sau null,
  "order": "asc" sau "desc",
  "answer": "Răspuns scurt despre ce căutăm"
}}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Ești un asistent care generează query-uri JSON pentru Google Drive API. Răspunzi STRICT în format JSON valid, fără markdown."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3
        )
        content = resp.choices[0].message.content
        
        # Parsare robustă
        plan = extract_json_from_response(content)
        
        keywords = plan.get("keywords", [query])
        date_after = plan.get("date_after")
        date_before = plan.get("date_before")
        order = plan.get("order", "desc")
        answer = plan.get("answer", f"Căutare pentru: {query}")
        
        # Construiește query
        q = build_drive_query(keywords, date_after, date_before)
        
        # Căutare în Drive
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
        # Fallback: căutare simplă
        return AskResponse(
            gpt_answer=f"Căutare simplă pentru: {query}",
            mode="drive",
            files=[]
        )

# === Aplicația 2: Semantic Search ===
async def semantic_search(query: str):
    sync_status = check_drive_sync()
    
    # 1. Rafinare query
    refine_prompt = f"""Utilizatorul a întrebat: "{query}".
Reformulează această cerere pentru căutare semantică mai bună.
Răspunde DOAR cu JSON valid (fără markdown):
{{
  "refined": "cererea reformulată cu cuvinte cheie relevante"
}}"""

    refined_query = query
    try:
        refine_resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Ești un asistent care optimizează query-uri de căutare. Răspunzi STRICT în JSON."},
                {"role": "user", "content": refine_prompt},
            ],
            # temperature=0.3
        )
        
        refined_content = refine_resp.choices[0].message.content
        refined_json = extract_json_from_response(refined_content)
        refined_query = refined_json.get("refined", query)
        
    except Exception as e:
        print(f"⚠️ Eroare rafinare query: {e}")

    # 2. Creează embedding
    try:
        query_emb = client.embeddings.create(
            model="text-embedding-3-small",
            input=refined_query
        ).data[0].embedding
    except Exception as e:
        print(f"❌ Eroare creare embedding: {e}")
        return AskResponse(
            gpt_answer="Eroare la procesarea cererii de căutare semantică.",
            mode="semantic",
            results=[],
            sync_status=sync_status
        )

    # 3. Calculează similaritatea
    scored = []
    for d in docs:
        try:
            score = cosine_similarity(query_emb, d["embedding"])
            scored.append({
                "name": d["name"],
                "text": d.get("text", ""),  
                "score": float(score)
            })
        except Exception as e:
            print(f"⚠️ Eroare la scor document {d.get('name', 'unknown')}: {e}")
            continue

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_docs = scored[:10]  # Top 10 rezultate

    # 4. Răspuns GPT
    context = "\n\n".join([f"{d['name']}: {d['text'][:15000]}" for d in top_docs])
    answer_prompt = f"""
    Întrebare utilizator: {query}
    Cerere rafinată: {refined_query}

    Ai la dispoziție următoarele documente:
    {context}
    
    Instrucțiuni:
        - Folosește informații DIN TOATE documentele relevante.
        - Menționează explicit numele documentelor folosite.
        - Dacă unele documente nu sunt relevante, spune clar.
        - Nu inventa informații care nu apar.
    """

    answer_resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Ești un agent care răspunde pe baza documentelor disponibile."},
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

# === Endpoint Principal ===
@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    try:
        if req.use_semantic_search:
            return await semantic_search(req.query)
        else:
            return await drive_search(req.query)
    except Exception as e:
        print(f"❌ Eroare generală în /ask: {e}")
        return AskResponse(
            gpt_answer=f"Eroare la procesarea cererii: {str(e)}",
            mode="error",
            files=[],
            results=[]
        )