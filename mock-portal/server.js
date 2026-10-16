'use strict';
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── Seed Data Generator (Dynamic relative dates) ─────────────────────────────
function generateSeedListings() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const makeDate = (days) => {
    const d = new Date(now + days * dayMs);
    d.setUTCHours(23, 59, 0, 0);
    return d.toISOString();
  };

  return [
    {
      id: 'opp-001',
      title: 'Northwind Labs Software Engineering Fellowship',
      organizer: 'Northwind Labs',
      type: 'internship',
      eligibility: 'Open to undergraduate and graduate students enrolled in an accredited university. Strong Python, TypeScript, or Go skills required.',
      deadline: makeDate(4),
      reward: '$3,500 – $6,000 monthly stipend',
      apply_link: 'https://northwindlabs.example.com/fellowship',
      status: 'open',
      description: 'Collaborate on cutting-edge distributed computing and AI infrastructure with dedicated 1:1 mentorship from senior industry staff.',
      last_modified: new Date().toISOString(),
    },
    {
      id: 'opp-002',
      title: 'Apex National Innovation Hackathon',
      organizer: 'Apex Technology Foundation',
      type: 'hackathon',
      eligibility: 'Indian and international students currently enrolled in UG/PG programs. Teams of 2 to 6. Any engineering or computing branch eligible.',
      deadline: makeDate(9),
      reward: '$15,000 Total Prize Pool + Fast-Track Interviews',
      apply_link: 'https://apextechfoundation.example.org/hackathon',
      status: 'open',
      description: '36-hour national engineering sprint tackling high-impact problem statements in smart mobility, clean infrastructure, and public health.',
      last_modified: new Date().toISOString(),
    },
    {
      id: 'opp-003',
      title: 'Meridian Future Leaders STEM Scholarship',
      organizer: 'Meridian Global Trust',
      type: 'scholarship',
      eligibility: 'Open to undergraduate students in 2nd or 3rd year pursuing Computer Science, Data Science, or Electrical Engineering. Minimum GPA 3.2 or equivalent.',
      deadline: makeDate(13),
      reward: '$5,000 educational grant + executive mentorship',
      apply_link: 'https://meridiantrust.example.org/scholarship',
      status: 'open',
      description: 'Merit-and-need scholarship supporting outstanding university students pursuing technical degrees with strong academic promise.',
      last_modified: new Date().toISOString(),
    },
    {
      id: 'opp-004',
      title: 'Hyperion Autonomous Systems Challenge',
      organizer: 'Hyperion Robotics Institute',
      type: 'hackathon',
      eligibility: 'Pre-final and final year university students. Knowledge of robotics, AI/ML, computer vision, or embedded systems. Teams of 2-4.',
      deadline: makeDate(21),
      reward: '$10,000 Grand Prize + Lab Incubation Grant',
      apply_link: 'https://hyperionrobotics.example.io/challenge',
      status: 'open',
      description: 'Multi-stage autonomous navigation and robotics simulation hackathon for university researchers, student teams, and builders.',
      last_modified: new Date().toISOString(),
    },
    {
      id: 'opp-005',
      title: 'Aether Cloud Solutions Research Residency',
      organizer: 'Aether Cloud Computing',
      type: 'internship',
      eligibility: '3rd year or penultimate year students in Computer Science, Software Engineering, or related fields. Experience with distributed systems and cloud backends.',
      deadline: makeDate(35),
      reward: '$4,500/month stipend + hardware grant',
      apply_link: 'https://aethercloud.example.net/residency',
      status: 'open',
      description: '10-week intensive research residency building next-generation serverless edge compute and real-time streaming primitives.',
      last_modified: new Date().toISOString(),
    },
    {
      id: 'opp-006',
      title: 'Helios Sustainable Energy Tech Grant',
      organizer: 'Helios CleanTech Institute',
      type: 'scholarship',
      eligibility: 'Enrolled university students conducting verified capstone research in renewable microgrids, battery chemistry, or solar optimization.',
      deadline: makeDate(-5), // Closed on purpose to test dead-listing detection
      reward: '$8,000 research award',
      apply_link: 'https://helioscleantech.example.org/grants',
      status: 'closed',
      description: 'Annual research grant advancing clean energy innovations. Applications for the current cycle are now officially closed.',
      last_modified: new Date().toISOString(),
    },
  ];
}

// In-memory listings initialized with dynamic dates
let listings = generateSeedListings();

// ── Public Listing Routes ───────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mock-portal', listings: listings.length });
});

// All listings HTML page (rendered for crawlers and browser demo)
app.get('/opportunities', (req, res) => {
  const html = buildHtml(listings);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// JSON API (used by OpportunityRadar worker / snapshot client)
app.get('/api/opportunities', (req, res) => {
  res.json({
    opportunities: listings,
    fetched_at: new Date().toISOString(),
    total: listings.length,
  });
});

// Single listing
app.get('/api/opportunities/:id', (req, res) => {
  const listing = listings.find(l => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'Not found' });
  res.json(listing);
});

// ── Admin Authorization Middleware (Demo Simulation Controls) ──────────────
app.use('/admin', (req, res, next) => {
  // Disable in production unless explicitly permitted
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEMO_CONTROLS !== 'true') {
    return res.status(403).json({ error: 'Demo admin controls are disabled in production' });
  }

  // If ADMIN_API_KEY is configured, require matching key
  const configuredKey = process.env.ADMIN_API_KEY;
  if (configuredKey) {
    const providedKey = req.headers['x-admin-key'] || req.query.admin_key || (req.body && req.body.admin_key);
    if (providedKey !== configuredKey) {
      return res.status(401).json({ error: 'Unauthorized: invalid or missing admin key' });
    }
  }
  next();
});

// Update a listing's attributes (deadline, eligibility, reward, status, etc.)
app.post('/admin/update/:id', (req, res) => {
  const idx = listings.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const allowed = ['deadline', 'eligibility', 'reward', 'status', 'title'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) listings[idx][field] = req.body[field];
  });

  listings[idx].last_modified = new Date().toISOString();
  console.log(`[mock-portal] Listing ${req.params.id} updated at ${listings[idx].last_modified}`);
  res.json({ ok: true, listing: listings[idx] });
});

// 1-Click helper route to extend deadline by N days
app.post('/admin/extend-deadline/:id', (req, res) => {
  const idx = listings.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const days = parseInt(req.body.days || '30', 10);
  const currentDeadline = new Date(listings[idx].deadline);
  const baseTime = isNaN(currentDeadline.getTime()) || currentDeadline < new Date() ? new Date() : currentDeadline;
  const newDate = new Date(baseTime.getTime() + days * 24 * 60 * 60 * 1000);
  newDate.setUTCHours(23, 59, 0, 0);

  listings[idx].deadline = newDate.toISOString();
  listings[idx].status = 'open';
  listings[idx].last_modified = new Date().toISOString();

  console.log(`[mock-portal] Extended deadline for ${req.params.id} by +${days}d to ${listings[idx].deadline}`);
  res.json({ ok: true, listing: listings[idx], message: `Extended deadline by ${days} days` });
});

// 1-Click helper route to change eligibility
app.post('/admin/set-eligibility/:id', (req, res) => {
  const idx = listings.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const eligibility = req.body.eligibility;
  if (!eligibility) return res.status(400).json({ error: 'eligibility text required' });

  listings[idx].eligibility = eligibility;
  listings[idx].last_modified = new Date().toISOString();

  console.log(`[mock-portal] Updated eligibility for ${req.params.id}`);
  res.json({ ok: true, listing: listings[idx], message: 'Eligibility updated' });
});

// Reset demo data endpoint (POST and GET for browser address bar ease)
app.post('/admin/reset', (req, res) => {
  listings = generateSeedListings();
  console.log('[mock-portal] Reset all listings with fresh relative dates');
  res.json({ ok: true, message: 'All demo listings reset with fresh relative dates', count: listings.length });
});

app.get('/admin/reset', (req, res) => {
  listings = generateSeedListings();
  console.log('[mock-portal] Reset all listings via GET /admin/reset');
  res.redirect('/opportunities?msg=reset_ok');
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', listings: listings.length }));

// ── HTML Builder for Plain Third-Party Portal ────────────────────────────────
function buildHtml(opps) {
  const cards = opps.map(o => {
    const isClosed = o.status === 'closed' || new Date(o.deadline) < new Date();
    const deadlineFormatted = new Date(o.deadline).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    return `
    <article class="opportunity-card ${isClosed ? 'is-closed' : ''}" id="${o.id}" data-type="${o.type}" data-status="${o.status}">
      <div class="card-top-bar">
        <span class="badge badge-type">${o.type.toUpperCase()}</span>
        <span class="badge ${isClosed ? 'badge-closed' : 'badge-open'}">
          ${isClosed ? '● CLOSED' : '● ACCEPTING APPLICATIONS'}
        </span>
      </div>

      <h2 class="opp-title">${escapeHtml(o.title)}</h2>
      <p class="opp-organizer"><strong>Presented by:</strong> ${escapeHtml(o.organizer)}</p>

      <div class="opp-info-grid">
        <div class="info-block">
          <span class="info-label">Application Deadline</span>
          <span class="info-value ${isClosed ? 'val-expired' : 'val-active'}">
            <time datetime="${o.deadline}">${deadlineFormatted}</time>
          </span>
          <small class="raw-date">${o.deadline.slice(0, 10)}</small>
        </div>

        <div class="info-block">
          <span class="info-label">Funding / Compensation</span>
          <span class="info-value">${escapeHtml(o.reward)}</span>
        </div>
      </div>

      <div class="opp-eligibility-section">
        <span class="info-label">Official Eligibility Requirements:</span>
        <p class="opp-eligibility-text">${escapeHtml(o.eligibility)}</p>
      </div>

      <p class="opp-description">${escapeHtml(o.description)}</p>

      <div class="card-footer">
        ${isClosed
          ? `<span class="btn-disabled">Applications Closed</span>`
          : `<a class="btn-apply" href="${escapeHtml(o.apply_link)}" target="_blank" rel="noopener">Visit Official Portal & Apply →</a>`
        }
        <div class="opp-modified">
          <small>Source last updated: <span class="mod-time">${o.last_modified}</span></small>
        </div>
      </div>

      <!-- Quick 1-Click Simulator Actions on Card -->
      <div class="card-quick-actions">
        <span class="quick-label">⚡ 1-Click Admin Controls for Demo:</span>
        <button class="btn-sm btn-extend" onclick="quickExtend('${o.id}', 30)">+30 Days Deadline</button>
        <button class="btn-sm btn-extend" onclick="quickExtend('${o.id}', 14)">+14 Days Deadline</button>
        <button class="btn-sm btn-restrict" onclick="quickRestrict('${o.id}')">Restrict: Final Year Only</button>
        <button class="btn-sm btn-broaden" onclick="quickBroaden('${o.id}')">Broaden: All UG Students</button>
        <button class="btn-sm btn-toggle" onclick="quickToggleStatus('${o.id}', '${o.status === 'open' ? 'closed' : 'open'}')">
          ${o.status === 'open' ? 'Mark as Closed' : 'Reopen Listing'}
        </button>
      </div>
    </article>
  `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CampusCareerHub | University Student Opportunities & Fellowships</title>
  <meta name="description" content="Independent student fellowship and career opportunities bulletin.">
  <style>
    /* Plain, ordinary third-party site theme (Clean light mode, no dark purple) */
    * { box-sizing: border-box; }
    body {
      background-color: #f8fafc;
      color: #1e293b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.5;
      margin: 0;
      padding: 0;
    }

    /* Top Utility Bar */
    .utility-bar {
      background-color: #0f172a;
      color: #94a3b8;
      font-size: 12px;
      padding: 6px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .utility-badge {
      background: #1e293b;
      color: #cbd5e1;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: monospace;
    }

    /* Site Header */
    header.site-header {
      background-color: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      padding: 16px 24px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    .header-inner {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-sub {
      font-size: 13px;
      color: #64748b;
      margin: 2px 0 0 0;
    }

    /* Layout Container */
    .page-container {
      max-width: 960px;
      margin: 28px auto;
      padding: 0 16px;
    }

    /* Info Notice */
    .portal-banner {
      background-color: #ffffff;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #2563eb;
      border-radius: 6px;
      padding: 14px 18px;
      margin-bottom: 24px;
      font-size: 14px;
      color: #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    /* Cards */
    .opportunity-card {
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      transition: border-color 0.15s ease;
    }
    .opportunity-card:hover {
      border-color: #cbd5e1;
    }
    .opportunity-card.is-closed {
      background-color: #fafaf9;
      border-color: #e7e5e4;
      opacity: 0.88;
    }

    .card-top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 3px 10px;
      border-radius: 9999px;
    }
    .badge-type {
      background-color: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
    }
    .badge-open {
      background-color: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
    }
    .badge-closed {
      background-color: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }

    .opp-title {
      font-size: 20px;
      font-weight: 600;
      color: #0f172a;
      margin: 0 0 6px 0;
    }
    .opp-organizer {
      font-size: 14px;
      color: #475569;
      margin: 0 0 16px 0;
    }

    .opp-info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      background-color: #f8fafc;
      border: 1px solid #f1f5f9;
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 16px;
    }
    .info-block {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      margin-bottom: 2px;
    }
    .info-value {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
    }
    .val-active { color: #0f766e; }
    .val-expired { color: #b91c1c; }
    .raw-date {
      font-size: 12px;
      color: #94a3b8;
      font-family: monospace;
    }

    .opp-eligibility-section {
      background-color: #fdfefe;
      border-left: 3px solid #0284c7;
      padding: 10px 14px;
      margin-bottom: 14px;
      border-radius: 0 4px 4px 0;
    }
    .opp-eligibility-text {
      font-size: 14px;
      color: #334155;
      margin: 4px 0 0 0;
      line-height: 1.45;
    }

    .opp-description {
      font-size: 14px;
      color: #475569;
      margin: 0 0 16px 0;
      line-height: 1.5;
    }

    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 14px;
      border-top: 1px solid #f1f5f9;
      flex-wrap: wrap;
      gap: 12px;
    }
    .btn-apply {
      background-color: #2563eb;
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: background-color 0.15s;
    }
    .btn-apply:hover {
      background-color: #1d4ed8;
    }
    .btn-disabled {
      background-color: #e2e8f0;
      color: #94a3b8;
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: not-allowed;
    }
    .opp-modified {
      font-size: 12px;
      color: #64748b;
    }
    .mod-time {
      font-family: monospace;
      color: #475569;
    }

    /* 1-Click Quick Actions Toolbar per Card */
    .card-quick-actions {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px dashed #cbd5e1;
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .quick-label {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
      width: 100%;
      margin-bottom: 4px;
    }
    .btn-sm {
      font-size: 12px;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 4px;
      border: 1px solid #cbd5e1;
      cursor: pointer;
      background: #ffffff;
      color: #334155;
      transition: all 0.15s;
    }
    .btn-sm:hover {
      background: #f1f5f9;
      border-color: #94a3b8;
    }
    .btn-extend { background: #f0fdf4; border-color: #86efac; color: #166534; }
    .btn-extend:hover { background: #dcfce7; }
    .btn-restrict { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
    .btn-restrict:hover { background: #fef3c7; }
    .btn-broaden { background: #eff6ff; border-color: #93c5fd; color: #1e40af; }
    .btn-broaden:hover { background: #dbeafe; }
    .btn-toggle { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
    .btn-toggle:hover { background: #fee2e2; }

    /* Admin Control Panel */
    .admin-panel {
      background-color: #ffffff;
      border: 1px solid #cbd5e1;
      border-top: 4px solid #0284c7;
      border-radius: 8px;
      padding: 24px;
      margin: 40px 0;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    .admin-panel h2 {
      margin-top: 0;
      font-size: 18px;
      color: #0f172a;
    }
    .admin-panel p {
      font-size: 14px;
      color: #64748b;
      margin-top: 0;
    }
    .admin-form-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
      align-items: flex-end;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-group label {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }
    input, select {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #1e293b;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #0284c7;
      box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.2);
    }
    .btn-primary-action {
      background-color: #0284c7;
      color: #ffffff;
      border: none;
      padding: 9px 18px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
    }
    .btn-primary-action:hover {
      background-color: #0369a1;
    }
    .btn-reset-danger {
      background-color: #dc2626;
      color: #ffffff;
      border: none;
      padding: 9px 18px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-reset-danger:hover {
      background-color: #b91c1c;
    }

    /* Toast Notification */
    #notification-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.2);
      font-size: 14px;
      font-weight: 500;
      display: none;
      z-index: 1000;
      border-left: 4px solid #22c55e;
    }
  </style>
</head>
<body>

  <!-- External Host Indicator -->
  <div class="utility-bar">
    <span>🌐 Third-Party Web Portal • Simulated External Organization</span>
    <span class="utility-badge">PORT 4000 • mock-portal</span>
  </div>

  <header class="site-header">
    <div class="header-inner">
      <div>
        <h1 class="brand-title">🏛️ CampusCareerHub</h1>
        <p class="brand-sub">National Collegiate Opportunities, Fellowships & Engineering Challenges</p>
      </div>
      <div>
        <button class="btn-reset-danger" onclick="resetAllDemoData()">
          🔄 Reset Demo Data
        </button>
      </div>
    </div>
  </header>

  <main class="page-container">
    <div class="portal-banner">
      <div>
        <strong>📌 Public Notice:</strong> Showing ${opps.length} curated opportunities with active verification. All deadlines are dynamically generated for October 2026.
      </div>
      <div>
        <a href="#admin-controls" style="color:#0284c7; text-decoration:none; font-weight:600; font-size:13px;">Jump to Admin Controls ↓</a>
      </div>
    </div>

    <!-- Opportunity Listings -->
    <div id="opportunities-list">
      ${cards}
    </div>

    <!-- Admin Panel -->
    <section class="admin-panel" id="admin-controls">
      <h2>🛠️ Portal Webmaster & Demo Simulation Controls</h2>
      <p>Modify listings with 1 click to test OpportunityRadar's autonomous change detection, diffing engine, and instant alerts.</p>
      
      <div class="admin-form-row">
        <div class="form-group" style="flex: 2; min-width: 220px;">
          <label for="admin-select-id">Select Listing to Modify:</label>
          <select id="admin-select-id" onchange="syncAdminForm()">
            ${opps.map(o => `<option value="${o.id}">${o.id} – ${escapeHtml(o.title)}</option>`).join('')}
          </select>
        </div>

        <div class="form-group" style="flex: 2; min-width: 220px;">
          <label for="admin-deadline-input">Set Specific Deadline:</label>
          <input type="datetime-local" id="admin-deadline-input">
        </div>

        <div class="form-group" style="flex: 1; min-width: 140px;">
          <label for="admin-status-input">Listing Status:</label>
          <select id="admin-status-input">
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
        </div>
      </div>

      <div class="admin-form-row">
        <div class="form-group" style="flex: 4; min-width: 300px;">
          <label for="admin-eligibility-input">Update Eligibility Text:</label>
          <input type="text" id="admin-eligibility-input" placeholder="Type new eligibility phrasing...">
        </div>

        <div class="form-group" style="flex: 2; min-width: 180px;">
          <label for="admin-reward-input">Update Compensation:</label>
          <input type="text" id="admin-reward-input" placeholder="e.g. $10,000 stipend">
        </div>

        <button class="btn-primary-action" onclick="saveCustomAdminChanges()">
          Save Changes
        </button>
      </div>

      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:13px; color:#64748b;">
          💡 Tip: Use the 1-click action buttons on any card above to trigger instant deadline or eligibility changes.
        </span>
        <button class="btn-reset-danger" onclick="resetAllDemoData()">
          🔄 Reset All Demo Data
        </button>
      </div>
    </section>
  </main>

  <!-- Floating Toast -->
  <div id="notification-toast"></div>

  <script>
    function showToast(msg) {
      const toast = document.getElementById('notification-toast');
      toast.textContent = msg;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }

    // 1-Click: Extend deadline by N days
    async function quickExtend(id, days) {
      try {
        const res = await fetch('/admin/extend-deadline/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days })
        });
        const data = await res.json();
        showToast('✓ Deadline extended by +' + days + ' days! Last modified updated.');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        alert('Error updating: ' + e.message);
      }
    }

    // 1-Click: Restrict eligibility to Final Year only
    async function quickRestrict(id) {
      try {
        const res = await fetch('/admin/set-eligibility/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eligibility: 'Strictly restricted to Final Year (graduating class) university students only. Pre-final students no longer eligible.'
          })
        });
        const data = await res.json();
        showToast('✓ Eligibility restricted to Final Year only! Last modified updated.');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        alert('Error updating: ' + e.message);
      }
    }

    // 1-Click: Broaden eligibility
    async function quickBroaden(id) {
      try {
        const res = await fetch('/admin/set-eligibility/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eligibility: 'Open to all enrolled undergraduate students (1st, 2nd, 3rd, and 4th year) in any engineering or technology field.'
          })
        });
        const data = await res.json();
        showToast('✓ Eligibility broadened to all undergrad students! Last modified updated.');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        alert('Error updating: ' + e.message);
      }
    }

    // 1-Click: Toggle open/closed
    async function quickToggleStatus(id, newStatus) {
      try {
        const res = await fetch('/admin/update/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        showToast('✓ Status changed to ' + newStatus + '! Last modified updated.');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        alert('Error updating: ' + e.message);
      }
    }

    // Save custom form values
    async function saveCustomAdminChanges() {
      const id = document.getElementById('admin-select-id').value;
      const deadline = document.getElementById('admin-deadline-input').value;
      const eligibility = document.getElementById('admin-eligibility-input').value;
      const reward = document.getElementById('admin-reward-input').value;
      const status = document.getElementById('admin-status-input').value;

      const body = {};
      if (deadline) body.deadline = new Date(deadline).toISOString();
      if (eligibility) body.eligibility = eligibility;
      if (reward) body.reward = reward;
      if (status) body.status = status;

      try {
        const res = await fetch('/admin/update/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        showToast('✓ Listing ' + id + ' updated! Reloading...');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        alert('Error saving changes: ' + e.message);
      }
    }

    // Reset all demo listings
    async function resetAllDemoData() {
      if (!confirm('Reset all demo listings to baseline configuration with fresh relative dates?')) return;
      try {
        const res = await fetch('/admin/reset', { method: 'POST' });
        const data = await res.json();
        showToast('✓ All demo listings reset to baseline state!');
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        alert('Error resetting demo: ' + e.message);
      }
    }

    function syncAdminForm() {
      // Clear inputs for clean entry
      document.getElementById('admin-deadline-input').value = '';
      document.getElementById('admin-eligibility-input').value = '';
      document.getElementById('admin-reward-input').value = '';
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, '0.0.0.0', () => console.log(`Mock portal running on :${PORT}`));
