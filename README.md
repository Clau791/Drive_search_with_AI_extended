# Drive_search_with_AI_extended
# 🔎 Document Search (Drive + Semantic)

Această aplicație web permite căutarea documentelor din **Google Drive** și dintr-un set local de documente indexate semantic (`embeddings.json`). Utilizatorul scrie o cerere în limbaj natural, iar aplicația răspunde folosind fie **Google Drive API**, fie **căutare semantică cu GPT**.

---

## 🚀 Funcționalități principale
- **Căutare Google Drive**  
  - Găsește fișiere după nume, tip sau dată.  
  - Permite deschiderea și descărcarea directă a documentelor.  

- **Căutare Semantică (AI)**  
  - Interoghezi documentele cu întrebări naturale (ex.: „ultima factură de la furnizorul X”).  
  - GPT rafinează cererea și caută documente similare semantic.  
  - Îți oferă un răspuns direct + fragmente relevante din documente.  

- **Mod selectabil**  
  - Poți comuta între 📁 *Căutare Google Drive* și 🧠 *Căutare Semantică*.  

---

## ⚙️ Instalare și rulare

### 1. Backend
1. Asigură-te că ai Python 3.10+ și un cont Google Drive cu service account (`service.json`).
2. Creează un `.env` cu cheia ta OpenAI:
   ```env
   OPENAI_API_KEY=sk-xxxxx

### 📂 Embeddings (pentru căutarea semantică)

Pentru a folosi căutarea semantică, trebuie să creezi fișierul embeddings.json.
Acesta se generează cu scriptul pdf_extractor, care:
- citește PDF-urile din Google Drive (folosind service account),
- extrage textul din fiecare document,
- generează vectori semantici (embeddings) cu OpenAI,
- salvează rezultatul într-un fișier JSON.

Exemplu de rulare:
-------------------------------------------
        python pdf_extractor.py           
-------------------------------------------


### 🚀 Rulare Backend și Frontend

#### 1. Backend
Rulează serverul FastAPI:
-------------------------------------------
  uvicorn main:app --reload --port 8000  
-------------------------------------------


Backend-ul va fi disponibil pe:
http://localhost:8000

#### 2. Frontend
Asigură-te că ai instalat Node.js și npm/yarn.

Instalează dependențele:

npm install

Rulează aplicația React:
-----------------------
       npm run dev    
-----------------------

#### Deschide aplicația în browser pe:
#### 👉 http://localhost:5173