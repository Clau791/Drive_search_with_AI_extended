# analyses the drive for pdfs and creates embeddings for them in embeddings.json

import io
import json
import os
from openai import OpenAI
from googleapiclient.discovery import build  # type: ignore
from googleapiclient.http import MediaIoBaseDownload  # type: ignore
from google.oauth2 import service_account # type: ignore
from dotenv import load_dotenv
import PyPDF2 # type: ignore

# === Config OpenAI ===
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# === Config Google Drive ===
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
creds = service_account.Credentials.from_service_account_file("service.json", scopes=SCOPES)
drive_service = build("drive", "v3", credentials=creds)

# === Citește toate PDF-urile din Drive ===
print("📂 Se caută PDF-urile din Google Drive...")
results = drive_service.files().list(
    q="mimeType='application/pdf' and trashed = false",
    fields="files(id, name, mimeType, createdTime)",
    pageSize=50  # max page size
).execute()

files = results.get("files", [])

indexed = []

for f in files:
    file_id = f["id"]
    name = f["name"]
    print(f"➡️ Descarc și procesez: {name}")

    # === Descarcă PDF ===
    request = drive_service.files().get_media(fileId=file_id)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()

    fh.seek(0)

    # === Extrage text din PDF ===
    text = ""
    try:
        reader = PyPDF2.PdfReader(fh)
        for page in reader.pages:
            text += page.extract_text() or ""
    except Exception as e:
        print(f"⚠️ Nu am putut extrage text din {name}: {e}")
        text = "[Eroare la citirea PDF-ului]"

    if not text.strip():
        text = "[PDF gol sau fără text selectabil]"

    # === Creează embedding ===
    emb = client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:20000]  # max 25000 caractere (aprox. 6250 cuvinte)
    )
    vector = emb.data[0].embedding

    indexed.append({
        "id": file_id,
        "name": name,
        "mimeType": f.get("mimeType"),
        "createdTime": f.get("createdTime"),
        "text": text[:15000],  # salvează doar un rezumat al textului pentru JSON
        "embedding": vector
    })

# === Salvează embeddings ===
with open("embeddings.json", "w", encoding="utf-8") as f:
    json.dump(indexed, f, ensure_ascii=False, indent=2)

print("✅ embeddings.json generat cu succes pentru toate PDF-urile!")
