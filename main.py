from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from openai import OpenAI
import os, json
from googleapiclient.discovery import build
from google.oauth2 import service_account
from dotenv import load_dotenv

# === Config FastAPI ===
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # frontend
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

# === Modele ===
class AskRequest(BaseModel):
    query: str

class DocumentOut(BaseModel):
    id: str
    name: str
    mimeType: str
    webViewLink: str
    webContentLink: Optional[str] = None
    createdTime: Optional[str] = None

class AskResponse(BaseModel):
    gpt_answer: str
    files: List[DocumentOut]

# === Helpers ===
def build_drive_query(keywords: List[str], date_after: Optional[str], date_before: Optional[str]) -> str:
    conditions = ["trashed = false"]

    # keywords
    if keywords:
        kw_conditions = [f"name contains '{kw}'" for kw in keywords]
        conditions.append("(" + " or ".join(kw_conditions) + ")")

    # date after
    if date_after:
        conditions.append(f"modifiedTime >= '{date_after}T00:00:00Z'")

    # date before
    if date_before:
        conditions.append(f"modifiedTime <= '{date_before}T23:59:59Z'")

    q = " and ".join(conditions)
    print("=== Drive Query ===", q)   # 👈 log query ca să vezi exact ce trimitem
    return q


# === Endpoint ===
@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    # 1. Interpretare cu GPT
    prompt = f"""
    Utilizatorul a cerut: "{req.query}".
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

    # 2. Parsează JSON din răspunsul GPT
    keywords, date_after, date_before, order = [], None, None, "desc"
    try:
        content = resp.choices[0].message.content.strip()
        if content.startswith("```"):  # dacă GPT a pus cod fence
            content = content.strip("` \n")
            if content.startswith("json"):
                content = content[4:]
        plan = json.loads(content)
        keywords = plan.get("keywords", [])
        date_after = plan.get("date_after")
        date_before = plan.get("date_before")
        order = plan.get("order", "desc")
    except Exception as e:
        print("Eroare la parsare GPT:", e, "Răspuns brut:", resp.choices[0].message.content)
        keywords = [req.query]


    # 3. Construiește query
    q = build_drive_query(keywords, date_after, date_before)

    # 4. Căutare în Drive
    results = drive_service.files().list(
        q=q,
        orderBy=f"createdTime {order}",
        fields="files(id, name, mimeType, webViewLink, webContentLink, createdTime)",
        pageSize=5
    ).execute()

    files = results.get("files", [])
    print("=== Rezultate brute ===", results)

    return AskResponse(
        gpt_answer=content,
        files=[DocumentOut(**f) for f in files]
    )
