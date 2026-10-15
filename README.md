# OpportunityRadar 📡

> **Autonomous Opportunity Intelligence for Students**  
> Powered by **TinyFish Web Agents** & **Docker Multi-Container Orchestration**

OpportunityRadar solves a critical problem for university students: **silent disqualifications and missed deadlines**. Existing student job boards aggregate listings blindly without telling you whether *you* qualify or when something important changes. 

OpportunityRadar continuously monitors official portals and hackathons, extracts structured opportunity schemas and textual ground-truth evidence using **TinyFish Web Agents**, classifies critical silent changes (extended deadlines, altered eligibility, stealth closures), and calculates personalized qualification fit scores based on your academic profile.

---

## 🌟 Key Features

- **Autonomous Web Extraction**: Uses **TinyFish Web Agents** (`agentRun` with structured JSON schema) to navigate and extract opportunity cards with sentence-level evidence quotes.
- **Silent Change Detection Engine**: Continuously diffs portal snapshots to catch deadline extensions, tightened eligibility criteria, and closed listings before you waste hours applying.
- **Personalized Student Match Radar**: Compares your academic year, discipline, technical skills, and interests against complex eligibility wording to deliver plain-language qualification reasons.
- **Watchlist & Instant Alerts**: Watch high-priority listings to receive real-time notifications via in-app notification center, email (SMTP), or Telegram.
- **1-Click Calendar Export**: Download RFC 5545 compliant `.ics` calendar events directly into Google Calendar, Apple Calendar, or Outlook.
- **Interactive Hackathon Sandbox**: Test deadline extensions and eligibility shocks in real-time with simulated live portals.

---

## 🐳 Docker Architecture

OpportunityRadar is fully containerized across 5 interconnected services orchestrated via **Docker Compose**:

| Container | Image / Tech | Port | Role |
|---|---|---|---|
| **`or_db`** | PostgreSQL 16 Alpine | `5432` | Relational store for users, snapshots, changes, and alerts |
| **`or_mock_portal`** | Node 20 Express Alpine | `4000` | Realistic opportunity portal with mutable admin endpoints for live demos |
| **`or_api`** | Node 20 Express Alpine | `3001` | Core REST API, matching engine, snapshot diffing, and calendar service |
| **`or_worker`** | Node 20 Alpine | – | Autonomous background polling daemon |
| **`or_frontend`** | Nginx 1.25 + Vite Alpine | `5173` | Responsive glassmorphic web dashboard with real-time feedback |

---

## 🚀 Quick Start (Running Locally with Docker)

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Docker Engine & Docker Compose)
- A [TinyFish API Key](https://agent.tinyfish.ai/api-keys) (stored in `.env`)

### 2. Configure Environment
Copy `.env.example` to `.env` (already pre-configured for local testing):
```bash
cp .env.example .env
```

Ensure your `TINYFISH_API_KEY` is set in `.env`:
```env
TINYFISH_API_KEY=your_tinyfish_api_key_here
```

### 3. Launch All Services
```bash
docker compose up --build -d
```

### 4. Open the App
- **Dashboard**: [http://localhost:5173](http://localhost:5173)
- **API Health**: [http://localhost:3001/health](http://localhost:3001/health)
- **Mock Opportunity Portal**: [http://localhost:4000/opportunities](http://localhost:4000/opportunities)

---

## 🔐 Authentication & OAuth Setup (Optional)

OpportunityRadar features full JWT access + refresh authentication stored in secure `httpOnly` `SameSite=Lax` cookies, bcrypt password hashing, and instant **"Continue as demo user"** access for judges.

Social login buttons ("Continue with Google", "Continue with GitHub", "Continue with LinkedIn") automatically appear only if their client ID and secret are set in `.env`. If left empty, they remain hidden.

### 1. Google OAuth
1. Go to the [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Create **OAuth 2.0 Client ID** (Web application).
3. Set **Authorized redirect URIs**: `http://localhost:3001/api/auth/oauth/google/callback`.
4. Copy Client ID and Secret to `.env`:
   ```env
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```

### 2. GitHub OAuth
1. Go to GitHub **Settings** → **Developer Settings** → **OAuth Apps** → **New OAuth App**.
2. Set **Homepage URL**: `http://localhost:5173`.
3. Set **Authorization callback URL**: `http://localhost:3001/api/auth/oauth/github/callback`.
4. Copy Client ID and Secret to `.env`:
   ```env
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   ```

### 3. LinkedIn (Sign In with LinkedIn using OpenID Connect)
1. Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) and create/select your app.
2. Under the **Products** tab, request access to **"Sign In with LinkedIn using OpenID Connect"**.
3. Under the **Auth** tab, add **Authorized redirect URLs**: `http://localhost:3001/api/auth/oauth/linkedin/callback`.
4. Copy Client ID and Secret to `.env`:
   ```env
   LINKEDIN_CLIENT_ID=your_linkedin_client_id
   LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
   ```

---

## 📖 Documentation
- [Architecture & Technical Specification](docs/ARCHITECTURE.md)
- [3-Minute Hackathon Demo Script](docs/DEMO_GUIDE.md)

---

## 🏆 Hackathon Sponsor Highlights

### TinyFish Web Agents
All web extraction is routed through a thin, decoupled adapter (`api/src/tinyfish_client.js`) leveraging the official TinyFish Agent API (`https://agent.tinyfish.ai/v1/automation/run`) with auth via `X-API-Key`. The agent autonomously extracts structured listing schemas, confidence metrics, and textual proof quotes.

### Docker Multi-Stage Builds & Isolation
Every service utilizes multi-stage Docker builds based on lightweight Alpine images, least-privilege non-root execution (`appuser`), explicit container health checks, and internal Docker bridge networking.
