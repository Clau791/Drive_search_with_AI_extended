import json
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from openai import OpenAI
import os
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
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# === Load embeddings.json ===
with open("embeddings.json", "r", encoding="utf-8") as f:
    docs = json.load(f)

# === Helpers ===
def cosine_similarity(a: List[float], b: List[float]) -> float:
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# === Models ===
class AskRequest(BaseModel):
    query: str

class DocumentOut(BaseModel):
    name: str
    text: str
    score: float

class AskResponse(BaseModel):
    gpt_answer: str
    refined_query: str
    results: List[DocumentOut]

# === Endpoint ===
@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    # 1. Cere lui GPT să interpreteze cererea utilizatorului
    refine_prompt = f"""
    Utilizatorul a întrebat: "{req.query}".
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

    refined_query = req.query
    try:
        refined_content = refine_resp.choices[0].message.content.strip()
        refined_json = json.loads(refined_content)
        refined_query = refined_json.get("refined", req.query)
    except Exception as e:
        print("⚠️ Eroare la parsarea răspunsului GPT pentru query rafinat:", e)

    # 2. Creează embedding pentru query rafinat
    query_emb = client.embeddings.create(
        model="text-embedding-3-small",
        input=refined_query
    ).data[0].embedding

    # 3. Calculează similaritatea cu fiecare document
    scored = []
    for d in docs:
        score = cosine_similarity(query_emb, d["embedding"])
        scored.append({
            "name": d["name"],
            "text": d.get("text", ""),
            "score": float(score)
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_docs = scored[:3]

    # 4. Cere lui GPT să răspundă folosind documentele
    context = "\n\n".join([f"{d['name']}: {d['text']}" for d in top_docs])
    answer_prompt = f"""
    Întrebare utilizator: {req.query}
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
        results=[DocumentOut(**d) for d in top_docs]
    )
