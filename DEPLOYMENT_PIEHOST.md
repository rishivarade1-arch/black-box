# Deploying RoadWatch AI to PieHost

RoadWatch AI is fully configured and production-ready for deployment on [PieHost](https://piehost.com).

PieHost supports three primary deployment methods depending on your plan:
1. **PieApp (Git Push-to-Deploy / PaaS)** — *Recommended & Easiest*
2. **PiePanel (Node.js App Hosting)**
3. **PieBox (Cloud VM / Docker / VPS)**

---

## Deployment Option 1: PieApp (Git Push-to-Deploy)

### 1. Push Code to Git
Initialize a Git repository (if not done already) and push your code to GitHub, GitLab, or Bitbucket:
```bash
git init
git add .
git commit -m "Prepare RoadWatch AI for PieHost deployment"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. Connect to PieApp
1. Log in to your [PieHost Dashboard](https://piehost.com).
2. Go to **PieApp** > **New Application**.
3. Select your Git provider (GitHub / GitLab / Bitbucket) and pick your repository.
4. PieApp will automatically detect `pie.json`:
   - **Runtime:** `Node.js` (Select version `20.x` or `22.x`)
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
   - **Port:** `3000` (or leave default assigned by PieHost)

### 3. Configure Environment Variables
Under the **Environment Variables** / **Config** tab in PieApp, add:
| Key | Value / Description | Required |
| --- | --- | --- |
| `GEMINI_API_KEY` | Your Gemini API Key from Google AI Studio | **Yes** |
| `NODE_ENV` | `production` | Recommended |
| `PORT` | `3000` (or PieApp assigned port) | Automatic |
| `ALLOWED_ORIGINS` | `*` or your custom domain URL | Optional |
| `VITE_FIREBASE_*` | Firebase config keys from `.env.example` | Optional |

### 4. Deploy
Click **Deploy**. PieApp will run `npm install`, execute `npm run build`, and start the app with `npm start`.
Your app will be live on your assigned `*.pie.host` domain or custom domain with automatic SSL!

---

## Deployment Option 2: CLI Deployment via `piectl`

If you prefer deploying directly from your local terminal:
```bash
# 1. Install PieHost CLI globally
npm install -g piectl

# 2. Login to your PieHost account
piectl login

# 3. Deploy the current directory
piectl deploy
```

---

## Deployment Option 3: PiePanel (cPanel-Style Node.js Hosting)

If your PieHost plan uses **PiePanel**:
1. Open **PiePanel** > **Node.js Selector** / **Setup Node.js App**.
2. Set:
   - **Node.js Version:** `20.x` or `22.x`
   - **Application Mode:** `Production`
   - **Application Root:** `/` (or path where code is uploaded)
   - **Application Startup File:** `server.js`
3. Upload the project files (or clone git repository).
4. Run `npm install` and `npm run build`.
5. Under **Environment variables**, set `GEMINI_API_KEY` and `NODE_ENV=production`.
6. Click **Start App**.

---

## Deployment Option 4: Docker / PieBox (VPS)

If you are running a PieBox VPS or custom container on PieHost:

### Using Docker Compose
```bash
docker compose up -d --build
```

### Or using Docker directly
```bash
docker build -t roadwatch-ai .
docker run -d -p 3000:3000 -e GEMINI_API_KEY="your-key" -e NODE_ENV="production" roadwatch-ai
```

---

## Health Check
Once deployed, verify the deployment by visiting:
```
https://<your-app-domain>/api/health
```
It should return:
```json
{
  "status": "ok",
  "geminiKeyConfigured": true
}
```
