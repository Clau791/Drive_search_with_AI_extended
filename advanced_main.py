from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from openai import OpenAI
import os, json
import numpy as np
from googleapiclient.discovery import build  # type: ignore
from google.oauth2 import service_account  # type: ignore
from dotenv import load_dotenv

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
    raise RuntimeError("OPENAI_API_KEY nu este setat. Pune-l în .env sau ca variabilă de mediu.")
client = OpenAI(api_key=api_key)

# === Config Google Drive ===
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
creds = service_account.Credentials.from_service_account_file("service.json", scopes=SCOPES)
drive_service = build("drive", "v3", credentials=creds)

# === Load embeddings.json pentru Aplicația 2 ===
try:
    with open("embeddings.json", "r", encoding="utf-8") as f:
        docs = json.load(f)
except FileNotFoundError:
    docs = []
    print("⚠️ embeddings.json nu a fost găsit. Aplicația 2 nu va funcționa.")

# === Modele ===
class AskRequest(BaseModel):
    query: str
    use_semantic_search: bool = False  # checkbox pentru a alege aplicația 2

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
    mode: str  # "drive" sau "semantic"
    files: Optional[List[DocumentOutDrive]] = None
    results: Optional[List[DocumentOutSemantic]] = None

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
    # 1. Interpretare cu GPT
    prompt = f"""
    Utilizatorul a cerut: "{query}".
    Extrage instrucțiuni pentru căutare în Google Drive.
    Răspunde DOAR cu JSON valid, fără text în plus:
    {{
    "keywords": ["..."],
    "date_after": "YYYY-MM-DD" sau null,
    "date_before": "YYYY-MM-DD" sau null,
    "order": "asc/desc"
    }}
    """
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Ești un asistent care generează query-uri pentru Google Drive API."},
            {"role": "user", "content": prompt},
        ]
    )
    content = resp.choices[0].message.content
    
    # 2. Parsează JSON
    keywords, date_after, date_before, order = [], None, None, "desc"
    try:
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("` \n")
            if content.startswith("json"):
                content = content[4:]
        plan = json.loads(content)
        keywords = plan.get("keywords", [])
        date_after = plan.get("date_after")
        date_before = plan.get("date_before")
        order = plan.get("order", "desc")
    except Exception as e:
        print("Eroare la parsare GPT:", e, "Răspuns brut:", content)
        keywords = [query]
    
    # 3. Construiește query
    q = build_drive_query(keywords, date_after, date_before)
    
    # 4. Căutare în Drive
    results = drive_service.files().list(
        q=q,
        orderBy=f"createdTime {order}",
        fields="files(id, name, mimeType, webViewLink, webContentLink, createdTime)",
        pageSize=50
    ).execute()
    files = results.get("files", [])
    print("=== Rezultate brute ===", results)
    
    return AskResponse(
        gpt_answer=content,
        mode="drive",
        files=[DocumentOutDrive(**f) for f in files]
    )

# === Aplicația 2: Semantic Search ===
async def semantic_search(query: str):
    # 1. Rafinare query
    refine_prompt = f"""
    Utilizatorul a întrebat: "{query}".
    Rescrie această cerere într-o formă mai clară, cuvinte cheie și eventual date.
    Răspunde DOAR cu un JSON valid de forma:
    {{
      "refined": "cererea reformulată pentru căutare semantică"
    }}
    """

    refine_resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Ești un asistent care clarifică interogările pentru căutare semantică."},
            {"role": "user", "content": refine_prompt},
        ]
    )

    refined_query = query
    try:
        refined_content = refine_resp.choices[0].message.content.strip()
        refined_json = json.loads(refined_content)
        refined_query = refined_json.get("refined", query)
    except Exception as e:
        print("⚠️ Eroare la parsarea răspunsului GPT pentru query rafinat:", e)

    # 2. Creează embedding
    query_emb = client.embeddings.create(
        model="text-embedding-3-small",
        input=refined_query
    ).data[0].embedding

    # 3. Calculează similaritatea
    scored = []
    for d in docs:
        score = cosine_similarity(query_emb, d["embedding"])
        scored.append({
            "name": d["name"],
            "text": d.get("text", ""),
            "score": float(score)
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_docs = scored

    # 4. Răspuns GPT
    context = "\n\n".join([f"{d['name']}: {d['text']}" for d in top_docs])
    answer_prompt = f"""
    Întrebare utilizator: {query}
    Cerere rafinată: {refined_query}

    Ai la dispoziție următoarele documente:
    {context}

    Formulează un răspuns clar și scurt folosind aceste documente.
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
        results=[DocumentOutSemantic(**d) for d in top_docs]
    )

# === Endpoint Principal ===
@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    if req.use_semantic_search:
        # Aplicația 2: Semantic Search
        return await semantic_search(req.query)
    else:
        # Aplicația 1: Google Drive Search (default)
        return await drive_search(req.query)