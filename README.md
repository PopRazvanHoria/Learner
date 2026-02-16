# Learner

## Local LLM Setup (Ollama)

This project can extract facts from text/PDF using a local LLM via Ollama.

### 1) Store models on D drive

Use this once in PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path "D:\OllamaModels" | Out-Null
[Environment]::SetEnvironmentVariable("OLLAMA_MODELS", "D:\OllamaModels", "User")
```

Then restart Ollama (or sign out/in) so it picks up the new environment variable.

### 2) Pull a model

```powershell
ollama pull llama3.2:3b
```

### 3) Run app with Ollama provider

```powershell
$env:LLM_PROVIDER="ollama"
$env:OLLAMA_MODEL="llama3.2:3b"
node app.js
```

### 4) Use in UI

- Open `http://localhost:3000/create-card.html`
- Upload a PDF/TXT/MD file
- Click **Extract Facts From File**
- Click **Use this fact** on a candidate, then generate/save the card

## Notes

- Endpoint used for file extraction: `POST /extract-facts-file`
- If local LLM is unavailable, the app falls back to simple sentence-based extraction.
