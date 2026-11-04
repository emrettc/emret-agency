<p><img src="img/logo-yazi.svg" alt="Emret Agency" width="368"></p>

# Local AI Engine Setup Guide with Ollama

Emret Agency is engineered to run its specialist worker agents (Developer, Designer, Copywriter, Researcher, etc.) **directly on your computer's local graphics card (GPU)**.

Benefits:
- **Zero Token Fees:** Generate tens of thousands of lines of code with a $0 cloud bill.
- **No API Keys Required:** Start working without signing up for third-party billing accounts.
- **Complete Privacy:** Code and context data remain strictly within your local drive.
- **Intelligent Spillover:** Overflow gracefully to cloud APIs only when context windows exceed local thresholds.

---

## 1. Hardware Matrix & Model Recommendations

| NVIDIA VRAM | Model | Base Model | Size | Target Workload |
|---|---|---|---|---|
| **Under 6 GB** | — | — | — | Local execution not advised; use cloud APIs. |
| **8 GB** | `emrettc-hafif` | `qwen3.5:4b` | ~3 GB | Fast responses, simple edits, quick summaries. |
| **10 – 16 GB** | `emrettc-genel` | `gemma4:12b` | ~8 GB | **(Recommended)** All daily coding, testing & refactoring. |
| **24 GB & Above** | `emrettc-kod` <br> `emrettc-analiz` | `qwen3-coder:30b` <br> `qwen3.5:27b` | ~18 GB <br> ~17 GB | Complex architecture analysis, deep reasoning. |

---

## 2. Installing Ollama

### Windows:
Run in PowerShell:
```bash
winget install Ollama.Ollama
```
Or download from [ollama.com/download/windows](https://ollama.com/download/windows).

### macOS:
```bash
brew install ollama
```

### Linux:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Verify it is running by visiting `http://127.0.0.1:11434` in your browser ("Ollama is running").

---

## 3. Essential Single-GPU Performance Flags

Set these environment variables to maximize throughput on single-GPU systems:

### Windows PowerShell:
```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_KEEP_ALIVE', '-1', 'User')
```

*(These are configured automatically when running `kurulum.cmd -Yerel`.)*

Restart Ollama from the system tray for flags to take effect.

---

## 4. Pulling and Building Models

### Automated Setup (Recommended):
Run in the repository root:
- For recommended model (`emrettc-genel`, ~8 GB):
  ```bash
  kurulum.cmd -Yerel
  ```
- For all 4 models (~40 GB):
  ```bash
  kurulum.cmd -Yerel -TumModeller
  ```

### Manual Setup:
```bash
ollama pull gemma4:12b
ollama create emrettc-genel -f resources/ollama/emrettc-genel.Modelfile
```

---

## 5. Connecting to Emret Agency

1. Launch the application: `baslat.cmd` (or `npm run dev`).
2. Go to **Settings › AI Engines**.
3. Locate the **Ollama** card (`http://127.0.0.1:11434/v1`).
4. Click **Test Connection** to confirm connectivity and populate the model list.
5. Set **Default Worker Engine** to **General Tasks** (`emrettc-genel`).
6. Run the built-in **Speed Test (Benchmark)** to measure tokens/sec throughput on your machine.

