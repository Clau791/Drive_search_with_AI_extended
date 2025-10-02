# analyses the drive for pdfs and creates embeddings for them in embeddings.json

import io
import json
import os
from openai import OpenAI
from tomlkit import date
from googleapiclient.discovery import build  # type: ignore
from googleapiclient.http import MediaIoBaseDownload  # type: ignore
from google.oauth2 import service_account  # type: ignore
from dotenv import load_dotenv
import PyPDF2  # type: ignore
from datetime import datetime

def sync_pdfs(api_key: str = None, service_account_file: str = "service.json", embeddings_file: str = "embeddings.json") -> dict:
    start_time = datetime.now()
    """
    Sincronizează PDF-urile din Google Drive cu embeddings.json
    
    Args:
        api_key: OpenAI API key (opțional, va fi citit din .env dacă nu e furnizat)
        service_account_file: Path la fișierul service account Google
        embeddings_file: Path la fișierul JSON de output
    
    Returns:
        dict cu status și statistici
    """
    # === Config OpenAI ===
    if not api_key:
        load_dotenv()
        api_key = os.getenv("OPENAI_API_KEY")
    
    if not api_key:
        return {"status": "error", "error": "OPENAI_API_KEY nu este setat"}
    
    client = OpenAI(api_key=api_key)

    # === Config Google Drive ===
    SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
    
    try:
        creds = service_account.Credentials.from_service_account_file(service_account_file, scopes=SCOPES)
        drive_service = build("drive", "v3", credentials=creds)
    except Exception as e:
        return {"status": "error", "error": f"Eroare autentificare Google Drive: {str(e)}"}

    # === Citește toate PDF-urile din Drive ===
    print("📂 Se caută PDF-urile din Google Drive...")
    try:
        results = drive_service.files().list(
            q="mimeType='application/pdf' and trashed = false",
            fields="files(id, name, mimeType, createdTime, modifiedTime, webViewLink)",
            pageSize=1000
        ).execute()
    except Exception as e:
        return {"status": "error", "error": f"Eroare citire Drive: {str(e)}"}

    files = results.get("files", [])
    print(f"📊 Găsite {len(files)} PDF-uri în Drive")

    # === Încarcă embeddings existente ===
    existing = []
    existing_map = {}

    if os.path.exists(embeddings_file):
        with open(embeddings_file, "r", encoding="utf-8") as a:
            try:
                existing = json.load(a)
                existing_map = {item["id"]: item for item in existing}
                print(f"🔍 Am găsit {len(existing_map)} PDF-uri deja procesate în {embeddings_file}")
            except json.JSONDecodeError:
                print(f"⚠️ {embeddings_file} este gol sau invalid, voi procesa toate PDF-urile.")
    else:
        print(f"🔍 {embeddings_file} nu există, voi procesa toate PDF-urile.")

    # === Determină ce trebuie procesat ===
    to_process = []
    for pdf in files:
        pdf_id = pdf["id"]
        if pdf_id not in existing_map:
            # PDF nou
            to_process.append(pdf)
        elif pdf.get("modifiedTime") and existing_map[pdf_id].get("modifiedTime"):
            # Verifică dacă a fost modificat
            if pdf["modifiedTime"] > existing_map[pdf_id]["modifiedTime"]:
                to_process.append(pdf)
                print(f"🔄 PDF modificat: {pdf['name']}")

    print(f"📂 Mai rămân {len(to_process)} PDF-uri de procesat (noi sau modificate)")

    # === Procesează PDF-urile ===
    indexed = []
    errors = []

    for idx, f in enumerate(to_process, 1):
        file_id = f["id"]
        name = f["name"]
        print(f"[{idx}/{len(to_process)}] ➡️ Descarc și procesez: {name}")

        try:
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
                errors.append({"file": name, "error": str(e)})

            if not text.strip():
                text = "[PDF gol sau fără text selectabil]"

            # === Creează embedding ===
            emb = client.embeddings.create(
                model="text-embedding-3-small",
                input=text[:20000]  # max ~20k caractere
            )
            vector = emb.data[0].embedding

            doc_data = {
                "id": file_id,
                "name": name,
                "mimeType": f.get("mimeType"),
                "createdTime": f.get("createdTime"),
                "modifiedTime": f.get("modifiedTime"),
                "webViewLink": f.get("webViewLink"),
                "text": text[:15000],  # salvează doar un rezumat
                "embedding": vector
            }
            
            indexed.append(doc_data)
            
            # Actualizează în map
            existing_map[file_id] = doc_data
            
        except Exception as e:
            print(f"❌ Eroare procesare {name}: {e}")
            errors.append({"file": name, "error": str(e)})
            continue

    # === Salvează embeddings actualizate ===
    all_data = list(existing_map.values())
    
    try:
        with open(embeddings_file, "w", encoding="utf-8") as f:
            json.dump(all_data, f, ensure_ascii=False, indent=2)
        print(f"✅ {embeddings_file} actualizat cu succes!")
    except Exception as e:
        return {"status": "error", "error": f"Eroare salvare fișier: {str(e)}"}

    # === Return statistici ===
    result = {
        "status": "success",
        "total_in_drive": len(files),
        "total_indexed": len(all_data),
        "newly_processed": len(indexed),
        "errors": len(errors),
        "error_details": errors if errors else None
    }
    
    print(f"\n📊 STATISTICI:")
    print(f"   Total PDF-uri în Drive: {result['total_in_drive']}")
    print(f"   Total în {embeddings_file}: {result['total_indexed']}")
    print(f"   Procesate acum: {result['newly_processed']}")
    if errors:
        print(f"   ⚠️ Erori: {result['errors']}")
    end_time = datetime.now()
    duration = end_time - start_time
    print(f"   ⏱️ Durată: {duration}")
    return result


# === Pentru rulare standalone ===
if __name__ == "__main__":
    result = sync_pdfs()
    
    if result["status"] == "error":
        print(f"\n❌ EROARE: {result['error']}")
        exit(1)
    else:
        print(f"\n✅ Sincronizare completă!")
        if result["newly_processed"] == 0:
            print("   Toate PDF-urile erau deja actualizate.")