# OpportunityRadar – Hackathon Demo & Jury Walkthrough Guide

This guide walks through demonstrating OpportunityRadar to hackathon judges in **under 3 minutes**, showcasing both mandatory sponsor technologies (**TinyFish** and **Docker**).

---

## 1. Quick Launch (One Command)

Open your terminal in the repository root and start all 5 containers:

```bash
docker compose up --build -d
```

Verify that all containers are healthy:
```bash
docker compose ps
```

You should see 5 running services:
- `or_db` (Postgres on `:5432`)
- `or_mock_portal` (Mock Opportunity Portal on `:4000`)
- `or_api` (API Engine on `:3001`)
- `or_worker` (Background Scheduler Daemon)
- `or_frontend` (Vite / Nginx UI on `:5173`)

Open the web application in your browser:
**`http://localhost:5173`**

---

## 2. The 3-Minute Demo Script

### Step 1: The Problem (30 Seconds)
- **Show the Radar Feed tab (`http://localhost:5173`)**:
  - Point out student profile: **Priya Sharma (IIT Bombay • 3rd Year CS)**.
  - Explain the core issue: Students miss opportunities not because they aren't qualified, but because deadlines change without notification, eligibility wording is ambiguous, and listings expire silently.
  - Notice the **Match Fit Badges**: Each card displays a personalized score (e.g., *94% Fit: Strong match for CS 3rd year with Python*).

### Step 2: The Core Differentiator – Deep Eligibility Breakdown (45 Seconds)
- Click **"Why You Fit & Diffs"** on any card (e.g. *Northwind Labs Fellowship* or *Apex National Innovation Hackathon*).
- Highlight the **TinyFish Evidence**: The system doesn't guess; it extracts direct sentence-level ground truth from the webpage.
- Click the **"📅 .ics"** button to show instant calendar event export.
- Click **"☆ Add to Watchlist"** to subscribe to real-time change alerts for this listing.

### Step 3: Live Silent Change Simulation (60 Seconds)
- Navigate to the **🧪 Live Demo Sandbox** tab.
- Click **"Trigger Deadline Extension"**:
  - Watch the live execution log in the sandbox console.
  - The mock portal listing (`Apex National Innovation Hackathon`) extends its deadline by 30 days.
  - TinyFish extracts the updated webpage snapshot.
  - The change detection engine compares the previous snapshot with the new one and classifies it as `DEADLINE_CHANGED`.
  - A notification toast triggers instantly, and the bell icon badge increments!
- Click over to the **⚡ Change Timeline** tab:
  - Show the side-by-side **Diff Box**: Green highlighting shows the new extended date, while red strikethrough shows the expired date.

### Step 4: Eligibility Shock Simulation (30 Seconds)
- Return to the **🧪 Sandbox** and click **"Trigger Eligibility Change"**:
  - The mock portal changes eligibility from *all UG/PG students* to *strictly Final Year students only*.
  - TinyFish re-crawls the portal.
  - Notice the instant re-scoring: Because Priya is a 3rd-year student, her fit score automatically drops, and she receives a red warning alert that she no longer qualifies!

---

## 3. Technology Highlights for Judges

| Sponsor Criteria | How OpportunityRadar Delivers |
|---|---|
| **TinyFish Web Agents** | Central to the entire pipeline. Autonomous browser navigation, schema-driven structured extraction (`POST /v1/automation/run`), and ground-truth text evidence quotes. |
| **Docker & Architecture** | 5 containerized microservices managed via Docker Compose with health checks, multi-stage Alpine builds, internal network isolation, and non-root execution. |
| **Student Impact** | Solves real pain: prevents wasted applications and missed deadlines through personalized eligibility intelligence and silent change diffing. |
