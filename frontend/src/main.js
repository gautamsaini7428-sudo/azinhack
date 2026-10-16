/**
 * OpportunityRadar – Main Application Controller
 * Warm editorial light theme, real health checks, no hardcoded user data.
 */

// ── Environment & Config ──────────────────────────────────────────────────
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const MOCK_PORTAL_URL = 'http://localhost:4000';

console.log(`[OpportunityRadar] Connected to API: ${API_URL}`);

// ── System Health Polling ─────────────────────────────────────────────────
async function checkSystemHealth() {
  // API health
  const dotApi = document.getElementById('dot-api');
  const valApi = document.getElementById('val-api');
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    const data = await res.json();
    if (data.status === 'ok') {
      if (dotApi) { dotApi.className = 'status-dot dot-active'; }
      if (valApi) valApi.textContent = 'Online';
    } else {
      throw new Error('non-ok');
    }
  } catch {
    if (dotApi) { dotApi.className = 'status-dot dot-warning'; }
    if (valApi) valApi.textContent = 'Offline';
  }

  // Portal health
  const dotPortal = document.getElementById('dot-portal');
  const valPortal = document.getElementById('val-portal');
  try {
    const res = await fetch(`${MOCK_PORTAL_URL}/health`, { cache: 'no-store' });
    const data = await res.json();
    if (data.status === 'ok') {
      if (dotPortal) { dotPortal.className = 'status-dot dot-active'; }
      if (valPortal) valPortal.textContent = `${data.listings ?? '?'} listings`;
    } else {
      throw new Error('non-ok');
    }
  } catch {
    if (dotPortal) { dotPortal.className = 'status-dot dot-warning'; }
    if (valPortal) valPortal.textContent = 'Offline';
  }
}

// ── Application State ──────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('or_token') || null,
  user: null,
  profile: null,
  opportunities: [],
  filteredOpportunities: [],
  changes: [],
  sources: [],
  alerts: [],
  unreadAlertsCount: 0,
  activeTab: 'radar',
  searchTerm: '',
  selectedType: 'all',
  selectedMatch: 'all',
  activeDetailOpp: null,
  authMode: 'login',
  providers: { google: false, github: false, linkedin: false },
  dataLoaded: false,
};

// ── Toast & Accessibility Announcer ─────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ'}</span>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function announceStatus(message) {
  const el = document.getElementById('a11y-announcer');
  if (el) {
    el.textContent = '';
    setTimeout(() => { el.textContent = message; }, 50);
  }
}

function appendConsoleLog(message, level = 'info') {
  const consoleEl = document.getElementById('sandbox-logs');
  if (!consoleEl) return;
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ── Authenticated API Client with Cookie Support & Token Refresh ────────────
let isRefreshing = false;
let refreshSubscribers = [];

function onTokenRefreshed(newToken) {
  refreshSubscribers.forEach((cb) => cb(newToken));
  refreshSubscribers = [];
}

async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers,
    });

    if (res.status === 401 && !endpoint.startsWith('/api/auth/')) {
      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const refRes = await fetch(`${API_URL}/api/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });

          if (refRes.ok) {
            const refData = await refRes.json();
            state.token = refData.token;
            if (refData.token) localStorage.setItem('or_token', refData.token);
            isRefreshing = false;
            onTokenRefreshed(refData.token);
            return apiRequest(endpoint, options);
          }
        } catch {}
        isRefreshing = false;
      } else {
        return new Promise((resolve) => {
          refreshSubscribers.push((newToken) => {
            if (newToken) resolve(apiRequest(endpoint, options));
            else resolve(null);
          });
        });
      }

      // Session expired -> clear and navigate to /login
      state.user = null;
      state.token = null;
      state.profile = null;
      state.dataLoaded = false;
      localStorage.removeItem('or_token');
      localStorage.removeItem('or_refresh_token');
      navigate('/login');
      throw new Error('Session expired. Please sign in again.');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err.message);
    throw err;
  }
}

// ── Check Current Authentication State ─────────────────────────────────────
async function checkAuth() {
  try {
    const data = await apiRequest('/api/auth/me');
    if (data && data.user) {
      state.user = data.user;
      state.profile = data.profile;
      return true;
    }
  } catch {
    // If access token failed, try refresh token cookie once
    try {
      const refRes = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (refRes.ok) {
        const refData = await refRes.json();
        state.token = refData.token;
        if (refData.token) localStorage.setItem('or_token', refData.token);
        const meData = await apiRequest('/api/auth/me');
        if (meData && meData.user) {
          state.user = meData.user;
          state.profile = meData.profile;
          return true;
        }
      }
    } catch {}
  }

  state.user = null;
  state.token = null;
  state.profile = null;
  state.dataLoaded = false;
  localStorage.removeItem('or_token');
  localStorage.removeItem('or_refresh_token');
  return false;
}

// ── Client-Side Router ─────────────────────────────────────────────────────
function navigate(path, replace = false) {
  if (replace) {
    window.history.replaceState(null, '', path);
  } else {
    window.history.pushState(null, '', path);
  }
  renderRoute();
}

async function renderRoute() {
  const path = window.location.pathname;
  const viewAuth = document.getElementById('view-auth');
  const viewOnboard = document.getElementById('view-onboarding');
  const viewDash = document.getElementById('view-dashboard');

  if (!state.user) {
    // Unauthenticated: protect every route except login, signup, forgot-password
    if (path !== '/login' && path !== '/signup' && path !== '/forgot-password') {
      return navigate('/login', true);
    }

    if (viewDash) viewDash.style.display = 'none';
    if (viewOnboard) viewOnboard.style.display = 'none';
    if (viewAuth) viewAuth.style.display = 'flex';

    if (path === '/signup') {
      setAuthMode('signup');
    } else if (path === '/forgot-password') {
      setAuthMode('forgot');
    } else {
      setAuthMode('login');
    }

    await loadProviders();
  } else {
    // Authenticated user
    if (path === '/login' || path === '/signup' || path === '/forgot-password') {
      if (!state.user.onboarding_completed) {
        return navigate('/onboarding', true);
      }
      return navigate('/', true);
    }

    if (path === '/onboarding') {
      if (viewAuth) viewAuth.style.display = 'none';
      if (viewDash) viewDash.style.display = 'none';
      if (viewOnboard) viewOnboard.style.display = 'flex';
      renderOnboardingPreFill();
    } else {
      // Main Dashboard View
      if (viewAuth) viewAuth.style.display = 'none';
      if (viewOnboard) viewOnboard.style.display = 'none';
      if (viewDash) viewDash.style.display = 'block';

      renderProfileHeader();
      if (!state.dataLoaded) {
        state.dataLoaded = true;
        await loadAllData();
      }
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const fieldNameGroup = document.getElementById('field-name-group');
  const authForm = document.getElementById('auth-form');
  const forgotForm = document.getElementById('forgot-form');
  const submitBtn = document.getElementById('auth-submit-btn');
  const switchPrompt = document.getElementById('auth-switch-prompt');
  const subtitle = document.getElementById('auth-subtitle');
  const errorGen = document.getElementById('auth-general-error');
  const demoBox = document.querySelector('.demo-user-box');
  const socialList = document.getElementById('social-buttons-container');
  const divider = document.getElementById('auth-divider-section');

  if (errorGen) errorGen.textContent = '';

  if (mode === 'signup') {
    if (fieldNameGroup) fieldNameGroup.style.display = 'flex';
    if (authForm) authForm.style.display = 'flex';
    if (forgotForm) forgotForm.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Create Account';
    if (subtitle) subtitle.textContent = 'Join OpportunityRadar to match student opportunities';
    if (demoBox) demoBox.style.display = 'block';
    if (socialList) socialList.style.display = 'flex';
    if (divider) divider.style.display = 'flex';
    if (switchPrompt) {
      switchPrompt.style.display = 'block';
      switchPrompt.innerHTML = 'Already have an account? <a class="auth-link" id="auth-switch-link">Sign in</a>';
      document.getElementById('auth-switch-link')?.addEventListener('click', () => navigate('/login'));
    }
  } else if (mode === 'forgot') {
    if (authForm) authForm.style.display = 'none';
    if (forgotForm) forgotForm.style.display = 'flex';
    if (subtitle) subtitle.textContent = 'Recover your OpportunityRadar password';
    if (demoBox) demoBox.style.display = 'none';
    if (socialList) socialList.style.display = 'none';
    if (divider) divider.style.display = 'none';
    if (switchPrompt) switchPrompt.style.display = 'none';
  } else {
    // Login mode
    if (fieldNameGroup) fieldNameGroup.style.display = 'none';
    if (authForm) authForm.style.display = 'flex';
    if (forgotForm) forgotForm.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Sign In';
    if (subtitle) subtitle.textContent = 'Sign in to access your personalized Opportunity Radar';
    if (demoBox) demoBox.style.display = 'block';
    if (socialList) socialList.style.display = 'flex';
    if (divider) divider.style.display = 'flex';
    if (switchPrompt) {
      switchPrompt.style.display = 'block';
      switchPrompt.innerHTML = 'Don\'t have an account? <a class="auth-link" id="auth-switch-link">Sign up</a>';
      document.getElementById('auth-switch-link')?.addEventListener('click', () => navigate('/signup'));
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

async function loadProviders() {
  try {
    const res = await fetch(`${API_URL}/api/auth/providers`);
    if (res.ok) {
      const data = await res.json();
      state.providers = data;
      const btnG = document.getElementById('btn-oauth-google');
      const btnGh = document.getElementById('btn-oauth-github');
      const btnLi = document.getElementById('btn-oauth-linkedin');
      const divider = document.getElementById('auth-divider-section');
      const container = document.getElementById('social-buttons-container');

      if (btnG) btnG.style.display = data.google ? 'flex' : 'none';
      if (btnGh) btnGh.style.display = data.github ? 'flex' : 'none';
      if (btnLi) btnLi.style.display = data.linkedin ? 'flex' : 'none';

      const anySocial = data.google || data.github || data.linkedin;
      if (divider) divider.style.display = anySocial ? 'flex' : 'none';
      if (container) container.style.display = anySocial ? 'flex' : 'none';
    }
  } catch {}
}

function renderOnboardingPreFill() {
  if (!state.user) return;
  const nameEl = document.getElementById('onboard-name');
  const collegeEl = document.getElementById('onboard-college');
  if (nameEl && !nameEl.value) nameEl.value = state.user.name || '';
  if (collegeEl && !collegeEl.value) collegeEl.value = state.user.college || '';
}

function addSkillToInput(skill) {
  const input = document.getElementById('onboard-skills');
  if (!input) return;
  const current = input.value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!current.some((c) => c.toLowerCase() === skill.toLowerCase())) {
    current.push(skill);
    input.value = current.join(', ');
  }
}

// ── Data Fetching ──────────────────────────────────────────────────────────
async function loadAllData() {
  await Promise.allSettled([
    loadProfile(),
    loadOpportunities(),
    loadChanges(),
    loadSources(),
    loadAlerts(),
  ]);
  updateMetrics();
}

async function loadProfile() {
  try {
    const profile = await apiRequest('/api/profile');
    state.profile = profile;
    renderProfileHeader();
    renderProfileForm();
  } catch (err) {
    console.warn('[profile] Could not load profile:', err.message);
  }
}

async function loadOpportunities() {
  try {
    const data = await apiRequest('/api/opportunities');
    const rawList = Array.isArray(data) ? data : (data?.opportunities || []);
    state.opportunities = rawList.map((opp) => {
      const rawScore = opp.match?.score ?? opp.match_score ?? null;
      const score = (rawScore !== null && rawScore !== undefined)
        ? (typeof rawScore === 'number' && rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore))
        : null;
      const matchStatus = opp.match?.status || opp.match_status || (score === null ? 'NOT_EVALUATED' : 'MATCH');
      const fitLabel = opp.match?.fitLabel || (score !== null ? (score >= 80 ? 'Strong Fit' : score >= 50 ? 'Moderate Fit' : 'Low Fit') : null);
      const reasons = opp.match?.reasons || (opp.match_reason ? [opp.match_reason] : []);
      const breakdown = opp.match?.breakdown || null;
      return {
        ...opp,
        is_watched: Boolean(opp.is_watched || opp.is_watching),
        match: {
          status: matchStatus,
          score,
          fitLabel,
          reasons,
          breakdown,
        },
      };
    });
    applyFilters();
  } catch (err) {
    console.error('[opps] Failed to load opportunities:', err);
    const container = document.getElementById('opp-cards-container');
    if (container) {
      container.innerHTML = `
        <div class="loading-state">
          <p style="color: #f87171">⚠ Error loading opportunities: ${escapeHtml(err.message || 'Server error')}</p>
          <button class="btn btn-secondary" id="retry-opps-btn">Retry Connection</button>
        </div>
      `;
      document.getElementById('retry-opps-btn')?.addEventListener('click', () => loadOpportunities());
    }
  }
}

async function loadChanges() {
  try {
    const data = await apiRequest('/api/changes');
    const serverChanges = Array.isArray(data) ? data : (data?.changes || []);
    if (serverChanges.length > 0) {
      state.changes = serverChanges;
      renderChangesTimeline();
      return;
    }
  } catch (err) {
    console.warn('[changes] Could not load /api/changes, falling back to local snapshot extract:', err.message);
  }
  extractChangesFromOpportunities();
}

async function loadSources() {
  try {
    const sources = await apiRequest('/api/sources');
    state.sources = Array.isArray(sources) ? sources : (sources?.sources || []);
    renderSources();
  } catch (err) {
    console.warn('[sources] Could not load sources:', err.message);
  }
}

async function loadAlerts() {
  try {
    const data = await apiRequest('/api/alerts');
    state.alerts = Array.isArray(data) ? data : (data?.alerts || []);
    state.unreadAlertsCount = data?.unread_count ?? data?.unreadCount ?? 0;
    renderAlerts();
  } catch (err) {
    console.warn('[alerts] Could not load alerts:', err.message);
  }
}

function extractChangesFromOpportunities() {
  const allChanges = [];
  const opps = Array.isArray(state.opportunities) ? state.opportunities : [];
  opps.forEach((opp) => {
    if (opp.recent_changes && opp.recent_changes.length > 0) {
      opp.recent_changes.forEach((c) => {
        allChanges.push({
          ...c,
          opp_title: opp.title,
          opp_organizer: opp.organizer,
          opp_type: opp.opp_type,
          apply_link: opp.apply_link,
        });
      });
    }
  });

  // Sort newest first
  allChanges.sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at));
  state.changes = allChanges;
  renderChangesTimeline();
}

// ── Rendering Functions ────────────────────────────────────────────────────
function renderProfileHeader() {
  const profile = state.profile || (state.user ? { name: state.user.name, college: state.user.college } : null);
  if (!profile) return;
  const nameEl = document.getElementById('header-user-name');
  const metaEl = document.getElementById('header-user-meta');
  const avatarEl = document.getElementById('header-avatar');
  const dropName = document.getElementById('dropdown-name');
  const dropEmail = document.getElementById('dropdown-email');

  const displayName = profile.name || state.user?.name || 'Student';
  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) {
    const college = profile.college || state.user?.college || '';
    const yr = profile.year_of_study || '';
    const branch = profile.branch || '';
    metaEl.textContent = [college, yr && branch ? `${yr} Yr ${branch}` : yr || branch].filter(Boolean).join(' · ') || 'Student Profile';
  }
  if (avatarEl) {
    const initials = displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
    avatarEl.textContent = initials || 'SU';
  }
  if (dropName) dropName.textContent = displayName;
  if (dropEmail) dropEmail.textContent = state.user?.email || '';
}

function renderProfileForm() {
  if (!state.profile) return;
  const p = state.profile;
  const get = (id) => document.getElementById(id);

  if (get('prof-name')) get('prof-name').value = p.name || '';
  if (get('prof-year')) get('prof-year').value = p.year_of_study || '3rd';
  if (get('prof-branch')) get('prof-branch').value = p.branch || '';
  if (get('prof-college')) get('prof-college').value = p.college || '';
  const gpa = p.gpa || (p.imported_data && typeof p.imported_data === 'object' ? p.imported_data.gpa : null) || '';
  if (get('prof-gpa')) get('prof-gpa').value = gpa;
  if (get('prof-skills')) get('prof-skills').value = (p.skills || []).join(', ');
  if (get('prof-interests')) get('prof-interests').value = (p.interests || []).join(', ');
  if (get('prof-locations')) get('prof-locations').value = (p.location_pref || []).join(', ');

  // Opportunity types checkboxes
  const types = p.opportunity_types || ['internship', 'hackathon', 'scholarship'];
  document.querySelectorAll('input[name="opp_type"]').forEach((cb) => {
    cb.checked = types.includes(cb.value);
  });

  // Preview card
  const prevName = get('preview-name');
  const prevInst = get('preview-inst');
  const prevAvatar = get('preview-avatar');
  const skillsContainer = get('preview-skills-chips');
  const interestsContainer = get('preview-interests-chips');

  if (prevName) prevName.textContent = p.name || 'Student User';
  if (prevInst) prevInst.textContent = [p.college, p.year_of_study && p.branch ? `${p.year_of_study} Year ${p.branch}` : p.year_of_study || p.branch].filter(Boolean).join(' · ');
  if (prevAvatar) prevAvatar.textContent = (p.name || 'SU').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  if (skillsContainer) {
    skillsContainer.innerHTML = (p.skills || ['Python', 'ML', 'React'])
      .map((s) => `<span class="chip">${escapeHtml(s)}</span>`)
      .join('');
  }

  if (interestsContainer) {
    interestsContainer.innerHTML = (p.interests || ['AI/ML', 'Climate Tech'])
      .map((i) => `<span class="chip">${escapeHtml(i)}</span>`)
      .join('');
  }
}

function renderOpportunities() {
  const container = document.getElementById('opp-cards-container');
  if (!container) return;

  const countBadge = document.getElementById('radar-count-badge');
  if (countBadge) countBadge.textContent = state.filteredOpportunities.length;

  if (state.filteredOpportunities.length === 0) {
    container.innerHTML = `
      <div class="loading-state">
        <p>No opportunities match the current radar filters.</p>
        <button class="btn btn-secondary btn-sm" id="reset-filters-btn">Reset All Filters</button>
      </div>
    `;
    const resetBtn = document.getElementById('reset-filters-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        document.getElementById('opp-search').value = '';
        document.getElementById('type-filter').value = 'all';
        document.getElementById('match-filter').value = 'all';
        state.searchTerm = '';
        state.selectedType = 'all';
        state.selectedMatch = 'all';
        applyFilters();
      });
    }
    return;
  }

  container.innerHTML = state.filteredOpportunities
    .map((opp) => {
      const match = opp.match || { status: 'NOT_EVALUATED', score: null, reasons: [] };
      const matchClass = match.score !== null
        ? (match.score >= 80 ? 'status-match' : match.score >= 50 ? 'status-partial' : 'status-no_match')
        : 'status-unevaluated';
      const deadlineInfo = formatDeadline(opp.deadline);
      const isWatched = Boolean(opp.is_watched);
      const hasRecentChange = opp.recent_changes && opp.recent_changes.length > 0;
      const isClosedByOrganizer = opp.status === 'closed';
      const isExpiredDeadline = !isClosedByOrganizer && opp.deadline && (new Date(opp.deadline) < new Date());
      const isDemoLink = opp.apply_link && (opp.apply_link.includes('.example') || opp.apply_link.includes('example.org') || opp.apply_link.includes('example.com') || opp.apply_link.includes('mock-portal'));

      return `
        <article class="opp-card" data-id="${escapeHtml(opp.id)}">
          <div class="opp-card-header">
            <div class="opp-meta-top">
              <span class="opp-badge badge-${escapeHtml(opp.opp_type || 'internship')}">${escapeHtml(opp.opp_type || 'Opportunity')}</span>
              ${hasRecentChange ? '<span class="opp-badge badge-changed">Changed</span>' : ''}
              ${isClosedByOrganizer ? '<span class="opp-badge status-badge-closed">Closed by Organizer</span>' : (isExpiredDeadline ? '<span class="opp-badge status-badge-expired">Deadline Passed</span>' : '')}
              ${isDemoLink ? '<span class="status-badge-demo" title="Simulated demonstration listing">Demo Data</span>' : ''}
            </div>
            <button class="watch-btn ${isWatched ? 'active' : ''}" data-id="${escapeHtml(opp.id)}" title="${isWatched ? 'Unwatch' : 'Watch for changes'}" aria-label="${isWatched ? 'Unwatch ' + escapeHtml(opp.title) : 'Watch ' + escapeHtml(opp.title)}">
              ${isWatched ? '★' : '☆'}
            </button>
          </div>

          <div>
            <h3 class="opp-title">${escapeHtml(opp.title)}</h3>
            <p class="opp-organizer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              </svg>
              ${escapeHtml(opp.organizer || 'Official Sponsor')}
            </p>
          </div>

          <!-- Radar Match Reason Banner -->
          <div class="match-banner ${matchClass}">
            ${match.score !== null
              ? `<span class="match-score-pill">${match.score}% Fit ${match.fitLabel ? `(${escapeHtml(match.fitLabel)})` : ''}</span>
                 <span>${escapeHtml(match.reasons?.[0] || 'Meets key academic and skill criteria')}</span>`
              : `<span class="match-score-pill status-unevaluated">Not evaluated</span>
                 <span>${escapeHtml(match.reasons?.[0] || 'Complete your student profile to evaluate eligibility')}</span>`
            }
          </div>

          <div class="opp-details-list">
            <div class="detail-row">
              <span class="detail-label">Deadline</span>
              <span class="detail-value ${deadlineInfo.isSoon ? 'deadline-highlight' : ''}">
                ${escapeHtml(deadlineInfo.text)}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Stipend/Reward</span>
              <span class="detail-value">${escapeHtml(opp.reward || 'Specified upon selection')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Eligibility Snapshot</span>
              <span class="detail-value" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${escapeHtml(opp.eligibility || 'Check official guidelines')}
              </span>
            </div>
          </div>

          <div class="opp-card-actions">
            <button class="btn btn-secondary btn-sm view-detail-btn" data-id="${escapeHtml(opp.id)}">
              Why You Fit
            </button>
            <a href="${API_URL}/api/opportunities/${encodeURIComponent(opp.id)}/ics" class="btn btn-secondary btn-sm" title="Add deadline to Calendar" download aria-label="Export calendar event for ${escapeHtml(opp.title)}">
              Export .ics
            </a>
            ${isDemoLink ? `
              <a href="${escapeHtml(opp.apply_link || '#')}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="margin-left: auto;" title="Simulated demonstration listing">
                Demo Portal ↗
              </a>
            ` : `
              <a href="${escapeHtml(opp.apply_link || '#')}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="margin-left: auto;">
                Apply ↗
              </a>
            `}
          </div>
        </article>
      `;
    })
    .join('');

  // Attach watch button handlers
  document.querySelectorAll('.watch-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const oppId = btn.getAttribute('data-id');
      await toggleWatch(oppId);
    });
  });

  // Attach detail handlers
  document.querySelectorAll('.view-detail-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const oppId = btn.getAttribute('data-id');
      openDetailModal(oppId);
    });
  });
}

function renderChangesTimeline() {
  const container = document.getElementById('changes-timeline-container');
  const countBadge = document.getElementById('changes-count-badge');
  if (!container) return;

  if (state.changes.length > 0 && countBadge) {
    countBadge.textContent = state.changes.length;
    countBadge.classList.remove('hidden');
  }

  if (state.changes.length === 0) {
    container.innerHTML = `
      <div class="empty-state-panel">
        <h3>No recent changes detected</h3>
        <p>OpportunityRadar continuously snapshots monitored portals. When an organiser extends a deadline or alters eligibility, the diff appears here.</p>
        <button class="btn btn-primary btn-sm" id="jump-to-sandbox-btn">
          Go to Sandbox &amp; Simulate a Change
        </button>
      </div>
    `;
    const jumpBtn = document.getElementById('jump-to-sandbox-btn');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => switchTab('sandbox'));
    }
    return;
  }

  container.innerHTML = state.changes
    .map((c) => {
      const icon = c.change_type === 'DEADLINE_CHANGED' ? 'D' : c.change_type === 'ELIGIBILITY_CHANGED' ? 'E' : c.change_type === 'REWARD_CHANGED' ? 'R' : 'N';
      const markerClass = c.change_type === 'DEADLINE_CHANGED' ? 'marker-deadline' : c.change_type === 'ELIGIBILITY_CHANGED' ? 'marker-eligibility' : c.change_type === 'REWARD_CHANGED' ? 'marker-reward' : 'marker-new';
      const detectedDate = c.detected_at ? new Date(c.detected_at) : new Date();
      const timeStr = detectedDate.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const sourceUrl = c.source_url || c.source_link || '';

      return `
        <article class="timeline-item">
          <div class="timeline-marker">
            <div class="marker-icon ${markerClass}">
              ${icon}
            </div>
          </div>
          <div class="timeline-content">
            <div class="timeline-header-row">
              <div>
                <span class="opp-badge badge-${escapeHtml(c.change_type?.toLowerCase() || 'changed')}">${escapeHtml(c.change_type)}</span>
                <h3 class="timeline-opp-title">${escapeHtml(c.opp_title || 'Opportunity Update')}</h3>
                ${c.opp_organizer ? `<span style="font-size: 0.8rem; color: var(--ink-muted);">${escapeHtml(c.opp_organizer)}</span>` : ''}
              </div>
              <time class="timeline-time" datetime="${detectedDate.toISOString()}">Detected: ${escapeHtml(timeStr)}</time>
            </div>

            <p class="timeline-explanation">${escapeHtml(c.explanation || 'Change verified by automated web snapshot inspection.')}</p>

            ${renderDiffSnippet(c)}

            <div style="display: flex; gap: 0.75rem; align-items: center; margin-top: 0.5rem; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm view-detail-btn" data-id="${escapeHtml(c.opportunity_id)}">
                View Full Opportunity Radar
              </button>
              ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="source-url" style="font-size: 0.75rem;">Source Portal ↗</a>` : ''}
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  document.querySelectorAll('.view-detail-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const oppId = btn.getAttribute('data-id');
      openDetailModal(oppId);
    });
  });
}

function renderDiffSnippet(change) {
  if (!change.before_data && !change.after_data) return '';

  let beforeVal = '';
  let afterVal = '';

  if (change.change_type === 'DEADLINE_CHANGED') {
    beforeVal = change.before_data?.deadline || JSON.stringify(change.before_data);
    afterVal = change.after_data?.deadline || JSON.stringify(change.after_data);
  } else if (change.change_type === 'ELIGIBILITY_CHANGED') {
    beforeVal = change.before_data?.eligibility || JSON.stringify(change.before_data);
    afterVal = change.after_data?.eligibility || JSON.stringify(change.after_data);
  } else {
    beforeVal = JSON.stringify(change.before_data);
    afterVal = JSON.stringify(change.after_data);
  }

  return `
    <div class="diff-box">
      ${beforeVal ? `<div class="diff-line diff-removed"><span>- Previous:</span> <span>${escapeHtml(String(beforeVal))}</span></div>` : ''}
      ${afterVal ? `<div class="diff-line diff-added"><span>+ Updated:</span> <span>${escapeHtml(String(afterVal))}</span></div>` : ''}
    </div>
  `;
}

function renderSources() {
  const container = document.getElementById('sources-list-container');
  if (!container) return;

  container.innerHTML = state.sources
    .map((s) => {
      const lastCheck = s.last_checked_at ? new Date(s.last_checked_at).toLocaleTimeString() : 'Pending check';
      return `
        <div class="source-card">
          <div class="source-card-header">
            <h3 class="source-title">${escapeHtml(s.label || s.url)}</h3>
            <span class="opp-badge badge-internship">
              Every ${escapeHtml(String(s.poll_interval))}m
            </span>
          </div>
          <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="source-url">${escapeHtml(s.url)}</a>

          <div class="source-meta-row">
            <span>Last check: ${escapeHtml(lastCheck)}</span>
            <span>Robots: ${s.robots_allowed ? 'Allowed' : 'Strict'}</span>
          </div>

          <div style="display: flex; gap: 0.5rem; margin-top: auto; padding-top: 0.5rem;">
            <button class="btn btn-secondary btn-sm check-source-now-btn" data-id="${escapeHtml(s.id)}" style="width: 100%;">
              Check Now
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('.check-source-now-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      btn.disabled = true;
      btn.textContent = 'Crawling...';
      try {
        await apiRequest(`/api/sources/${id}/check-now`, { method: 'POST' });
        showToast('Agent extraction started for source.', 'info');
        setTimeout(() => {
          loadAllData();
          btn.disabled = false;
          btn.textContent = 'Check Now';
        }, 3000);
      } catch (e) {
        showToast(`Failed to trigger check: ${e.message}`, 'error');
        btn.disabled = false;
        btn.textContent = 'Check Now';
      }
    });
  });
}

function renderAlerts() {
  const listEl = document.getElementById('alerts-list');
  const countBadge = document.getElementById('unread-count');
  const drawerBadge = document.getElementById('drawer-unread-badge');

  if (countBadge) {
    if (state.unreadAlertsCount > 0) {
      countBadge.textContent = state.unreadAlertsCount;
      countBadge.classList.remove('hidden');
    } else {
      countBadge.classList.add('hidden');
    }
  }

  if (drawerBadge) {
    drawerBadge.textContent = `${state.unreadAlertsCount} unread`;
  }

  if (!listEl) return;

  if (state.alerts.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--ink-muted); font-size: 0.85rem;">
        No alerts yet. When opportunities change, real-time alerts appear here.
      </div>
    `;
    return;
  }

  listEl.innerHTML = state.alerts
    .map((a) => {
      const timeStr = new Date(a.created_at).toLocaleTimeString();
      return `
        <div class="alert-item ${!a.read ? 'unread' : ''}" data-id="${escapeHtml(a.id)}" data-opp="${escapeHtml(a.opportunity_id || '')}">
          <div class="alert-meta">
            <span class="alert-channel">${escapeHtml(a.channel?.toUpperCase() || 'IN-APP')}</span>
            <span>${escapeHtml(timeStr)}</span>
          </div>
          <h4 class="alert-title">${escapeHtml(a.title || 'Opportunity Alert')}</h4>
          <p class="alert-text">${escapeHtml(a.message || '')}</p>
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('.alert-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const alertId = item.getAttribute('data-id');
      const oppId = item.getAttribute('data-opp');
      try {
        await apiRequest(`/api/alerts/${alertId}/read`, { method: 'POST' });
        item.classList.remove('unread');
        if (state.unreadAlertsCount > 0) {
          state.unreadAlertsCount--;
          renderAlerts();
        }
      } catch {}

      if (oppId) {
        openDetailModal(oppId);
      }
    });
  });
}

function updateMetrics() {
  const opps = Array.isArray(state.opportunities) ? state.opportunities : [];
  const totalEl = document.getElementById('metric-total');
  const matchEl = document.getElementById('metric-matches');
  const closingEl = document.getElementById('metric-closing');
  const watchedEl = document.getElementById('metric-watched');

  if (totalEl) totalEl.textContent = opps.length;

  const matches = opps.filter((o) => o.match?.status === 'MATCH').length;
  if (matchEl) matchEl.textContent = matches;

  const closing = opps.filter((o) => {
    if (!o.deadline) return false;
    const diffDays = (new Date(o.deadline) - new Date()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 14;
  }).length;
  if (closingEl) closingEl.textContent = closing;

  const watched = opps.filter((o) => o.is_watched).length;
  if (watchedEl) watchedEl.textContent = watched;
}

// ── Opportunity Detail Modal ───────────────────────────────────────────────
function openDetailModal(oppId) {
  const opp = state.opportunities.find((o) => o.id === oppId);
  if (!opp) return;

  const modal = document.getElementById('detail-modal');
  const body = document.getElementById('modal-body');
  const match = opp.match || { status: 'NOT_EVALUATED', score: null, reasons: [] };

  const isClosedByOrganizer = opp.status === 'closed';
  const isExpired = !isClosedByOrganizer && opp.deadline && (new Date(opp.deadline) < new Date());
  const statusLabel = isClosedByOrganizer ? 'Closed by Organizer' : (isExpired ? 'Deadline Passed' : 'Active / Open');
  const isDemo = opp.apply_link && (opp.apply_link.includes('.example') || opp.apply_link.includes('example.org') || opp.apply_link.includes('example.com') || opp.apply_link.includes('mock-portal'));
  const sourceLabel = opp.source_url?.includes('mock-portal') || opp.source_url?.includes('localhost:4000') || !opp.source_url
    ? 'Local Simulated Source (Mock Portal)'
    : 'Monitored Autonomous Web Source';

  const breakdown = match.breakdown || null;
  const confirmedList = breakdown?.confirmed || [];
  const conflictsList = breakdown?.conflicts || [];
  const unknownList = breakdown?.unknown || [];

  const lastCheckedStr = opp.last_scraped_at
    ? new Date(opp.last_scraped_at).toLocaleString()
    : 'Recently indexed';

  body.innerHTML = `
    <div class="modal-header">
      <div>
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.25rem; flex-wrap: wrap;">
          <span class="opp-badge badge-${opp.opp_type || 'internship'}">${opp.opp_type || 'Opportunity'}</span>
          <span class="opp-badge ${isClosedByOrganizer ? 'status-badge-closed' : (isExpired ? 'status-badge-expired' : 'badge-internship')}">${statusLabel}</span>
          ${isDemo ? '<span class="status-badge-demo" title="Simulated demo data">Demo Data</span>' : ''}
        </div>
        <h3 id="modal-title" style="margin-top: 0.35rem;">${escapeHtml(opp.title)}</h3>
        <p style="color: var(--ink-secondary); font-size: 0.85rem;">Organised by: ${escapeHtml(opp.organizer || 'Official Sponsor')}</p>
      </div>
      <button id="close-modal-x-btn" class="icon-button" aria-label="Close dialog">&times;</button>
    </div>

    <!-- Match Breakdown -->
    <div class="modal-section" style="border-left: 3px solid ${match.score !== null ? (match.score >= 70 ? 'var(--accent-green)' : 'var(--accent-terracotta)') : 'var(--border-color)'}; padding-left: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <span style="font-weight: 700; font-size: 0.9rem; font-family: var(--font-heading);">Eligibility Evaluation</span>
        ${match.score !== null
          ? `<span class="match-score-pill">${match.score}% Fit ${match.fitLabel ? `(${escapeHtml(match.fitLabel)})` : ''}</span>`
          : '<span class="match-score-pill status-unevaluated">Not evaluated</span>'
        }
      </div>

      ${(match.reasons && match.reasons.length > 0) ? `
        <ul style="padding-left: 1.25rem; font-size: 0.82rem; color: var(--ink-secondary); line-height: 1.6; margin-bottom: 0.5rem;">
          ${match.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
        </ul>
      ` : '<p style="font-size: 0.82rem; color: var(--ink-muted);">Complete your student profile to evaluate specific requirements.</p>'}

      ${breakdown ? `
        ${confirmedList.length > 0 ? `
          <div class="breakdown-group">
            <div class="breakdown-group-title confirmed">Confirmed Matches (${confirmedList.length})</div>
            <ul class="breakdown-list confirmed">
              ${confirmedList.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${conflictsList.length > 0 ? `
          <div class="breakdown-group">
            <div class="breakdown-group-title conflicts">Criteria Conflicts (${conflictsList.length})</div>
            <ul class="breakdown-list conflicts">
              ${conflictsList.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${unknownList.length > 0 ? `
          <div class="breakdown-group">
            <div class="breakdown-group-title unknown">Unverified / Missing Information (${unknownList.length})</div>
            <ul class="breakdown-list unknown">
              ${unknownList.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      ` : ''}
    </div>

    <!-- Extracted Snapshot Evidence -->
    <div class="modal-section">
      <h4 style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-muted); margin-bottom: 0.5rem; font-family: var(--font-ui);">Extracted Evidence &amp; Audit Trail</h4>
      <div class="evidence-block">
        <p><strong>Eligibility Quote:</strong> "${escapeHtml(opp.eligibility || 'None specified in source')}"</p>
        <p style="margin-top: 0.35rem;"><strong>Reward/Stipend:</strong> ${escapeHtml(opp.reward || 'None specified')}</p>
        <p style="margin-top: 0.35rem;"><strong>Deadline:</strong> ${formatDeadline(opp.deadline).text} ${opp.deadline ? `(${new Date(opp.deadline).toUTCString()})` : ''}</p>
        <p style="margin-top: 0.35rem;"><strong>Last Checked:</strong> ${lastCheckedStr}</p>
        <p style="margin-top: 0.35rem;"><strong>Source Verification:</strong> ${sourceLabel}</p>
        ${opp.source_url ? `<p style="margin-top: 0.35rem;"><strong>Official Source:</strong> <a href="${opp.source_url}" target="_blank" rel="noopener noreferrer" class="source-url">${escapeHtml(opp.source_url)} ↗</a></p>` : ''}
      </div>
    </div>

    ${opp.recent_changes && opp.recent_changes.length > 0 ? `
      <div class="modal-section">
        <h4 style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent-terracotta); margin-bottom: 0.5rem; font-family: var(--font-ui);">Detected Change Diff</h4>
        ${opp.recent_changes.map((c) => renderDiffSnippet(c)).join('')}
      </div>
    ` : ''}

    <div class="modal-actions">
      <a href="${API_URL}/api/opportunities/${opp.id}/ics" class="btn btn-secondary btn-sm" download aria-label="Export calendar event for ${escapeHtml(opp.title)}">
        Export .ics
      </a>
      <button class="btn btn-secondary btn-sm" id="modal-watch-toggle-btn" data-id="${opp.id}">
        ${opp.is_watched ? '★ Watchlisted' : 'Add to Watchlist'}
      </button>
      ${isDemo ? `
        <a href="${opp.apply_link || '#'}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Simulated demo listing">
          Open Demo Portal ↗
        </a>
      ` : `
        <a href="${opp.apply_link || '#'}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">
          Visit Official Portal ↗
        </a>
      `}
    </div>
  `;

  const previouslyFocused = document.activeElement;
  const closeModal = () => {
    modal.removeEventListener('keydown', handleKeydown);
    modal.close();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  };

  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  };
  modal.addEventListener('keydown', handleKeydown);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  }, { once: true });

  document.getElementById('close-modal-x-btn')?.addEventListener('click', closeModal);

  document.getElementById('modal-watch-toggle-btn')?.addEventListener('click', async () => {
    await toggleWatch(opp.id);
    closeModal();
  });

  modal.showModal();
}

// ── Filter & Search Logic ──────────────────────────────────────────────────
function applyFilters() {
  const search = state.searchTerm.toLowerCase();
  const type = state.selectedType;
  const match = state.selectedMatch;
  const opps = Array.isArray(state.opportunities) ? state.opportunities : [];

  state.filteredOpportunities = opps.filter((opp) => {
    // Search
    if (search) {
      const text = `${opp.title} ${opp.organizer} ${opp.eligibility} ${opp.reward} ${opp.opp_type}`.toLowerCase();
      if (!text.includes(search)) return false;
    }

    // Type filter
    if (type !== 'all' && opp.opp_type !== type) return false;

    // Match filter
    if (match === 'MATCH' && opp.match?.status !== 'MATCH') return false;
    if (match === 'PARTIAL' && opp.match?.status !== 'PARTIAL') return false;
    if (match === 'watched' && !opp.is_watched) return false;
    if (match === 'closing') {
      if (!opp.deadline) return false;
      const diffDays = (new Date(opp.deadline) - new Date()) / (1000 * 60 * 60 * 24);
      if (diffDays < 0 || diffDays > 14) return false;
    }

    return true;
  });

  renderOpportunities();
}

// ── Watchlist Toggle ───────────────────────────────────────────────────────
async function toggleWatch(oppId) {
  try {
    const opp = state.opportunities.find((o) => o.id === oppId);
    const isCurrentlyWatched = opp ? Boolean(opp.is_watched) : false;
    const method = isCurrentlyWatched ? 'DELETE' : 'POST';
    const res = await apiRequest(`/api/opportunities/${oppId}/watch`, { method });
    const nowWatched = res && typeof res.watched === 'boolean' ? res.watched : !isCurrentlyWatched;
    if (opp) opp.is_watched = nowWatched;
    applyFilters();
    updateMetrics();
    const msg = nowWatched ? 'Opportunity added to Watchlist ⭐' : 'Removed from Watchlist';
    showToast(msg, 'success');
    announceStatus(`${nowWatched ? 'Added to' : 'Removed from'} watchlist: ${opp?.title || 'opportunity'}`);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ── Navigation & Tab Switching ─────────────────────────────────────────────
function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
  });
  document.querySelectorAll('.tab-view').forEach((v) => {
    v.classList.toggle('active', v.id === `view-${tabName}`);
  });
}

// ── Sandbox Scenario Execution ─────────────────────────────────────────────
async function triggerMockDeadlineExtension() {
  appendConsoleLog('Triggering Scenario A: Apex National Innovation Hackathon deadline extension (+30 days)...', 'info');
  try {
    const newDeadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${MOCK_PORTAL_URL}/admin/update/opp-002`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deadline: newDeadline }),
    }).catch(() => null);

    appendConsoleLog(`✓ Mock portal listing opp-002 modified (deadline shifted to ${newDeadline.slice(0, 10)})`, 'success');
    appendConsoleLog('Executing web extraction and classification on mock source...', 'info');

    const mockSource = state.sources.find((s) => s.url.includes('mock-portal') || s.url.includes('localhost:4000')) || state.sources[0];

    if (mockSource) {
      const checkRes = await apiRequest(`/api/sources/${mockSource.id}/check-now`, { method: 'POST' });
      appendConsoleLog(`✓ Scrape complete: ${checkRes.opportunitiesFound || 0} checked, ${checkRes.changesDetected || 0} change(s) detected.`, 'success');
      await loadAllData();
      if (checkRes.changesDetected > 0) {
        showToast('Deadline change detected! Check Change Timeline.', 'success');
        announceStatus('Deadline change detected and recorded.');
        switchTab('changes');
      } else {
        showToast('Source checked. Baseline up to date.', 'info');
      }
    }
  } catch (err) {
    appendConsoleLog(`Error in demo simulation: ${err.message}`, 'error');
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function triggerMockEligibilityChange() {
  appendConsoleLog('Triggering Scenario B: Apex National Innovation Hackathon eligibility restriction ("Final Year students only")...', 'warn');
  try {
    const newEligibility = 'Open strictly to Final Year (4th year) engineering students. All team members must be graduating class.';
    await fetch(`${MOCK_PORTAL_URL}/admin/update/opp-002`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eligibility: newEligibility }),
    }).catch(() => null);

    appendConsoleLog('✓ Mock portal listing opp-002 modified (eligibility restricted to final year)', 'success');
    appendConsoleLog('Executing extraction and eligibility re-scoring...', 'info');

    const mockSource = state.sources.find((s) => s.url.includes('mock-portal') || s.url.includes('localhost:4000')) || state.sources[0];
    if (mockSource) {
      const checkRes = await apiRequest(`/api/sources/${mockSource.id}/check-now`, { method: 'POST' });
      appendConsoleLog(`✓ Scrape complete: ${checkRes.opportunitiesFound || 0} checked, ${checkRes.changesDetected || 0} change(s) detected.`, 'success');
      await loadAllData();
      if (checkRes.changesDetected > 0) {
        showToast('Eligibility change detected! Fit scores recalculated.', 'warning');
        announceStatus('Eligibility change detected and fit scores recalculated.');
        switchTab('changes');
      } else {
        showToast('Source checked. Baseline up to date.', 'info');
      }
    }
  } catch (err) {
    appendConsoleLog(`Error: ${err.message}`, 'error');
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function triggerScrapeNow() {
  appendConsoleLog('Executing full crawl on all monitored portals...', 'info');
  try {
    let totalChanges = 0;
    for (const source of state.sources) {
      appendConsoleLog(`Crawling ${source.label} (${source.url})...`, 'info');
      const res = await apiRequest(`/api/sources/${source.id}/check-now`, { method: 'POST' }).catch(() => null);
      if (res && res.changesDetected) totalChanges += res.changesDetected;
    }
    await loadAllData();
    appendConsoleLog(`✓ All sources snapshot diffing complete (${totalChanges} changes detected).`, 'success');
    showToast(`Crawl complete across all sources. ${totalChanges} change(s) found.`, 'info');
    announceStatus('Crawl complete across all sources.');
  } catch (err) {
    appendConsoleLog(`Scrape error: ${err.message}`, 'error');
  }
}

async function resetDemoState() {
  appendConsoleLog('Resetting mock portal to baseline configuration...', 'info');
  try {
    await fetch(`${MOCK_PORTAL_URL}/admin/reset`, { method: 'POST' }).catch(() => null);
    appendConsoleLog('✓ Mock portal reset. Re-syncing database snapshot...', 'success');
    const mockSource = state.sources.find((s) => s.url.includes('mock-portal') || s.url.includes('localhost:4000')) || state.sources[0];
    if (mockSource) {
      await apiRequest(`/api/sources/${mockSource.id}/check-now`, { method: 'POST' });
    }
    await loadAllData();
    appendConsoleLog('✓ Reset complete. Baseline restored.', 'success');
    showToast('Demo portal reset to original state.', 'success');
    announceStatus('Demo portal reset to baseline state.');
  } catch (err) {
    appendConsoleLog(`Reset error: ${err.message}`, 'error');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatDeadline(deadlineStr) {
  if (!deadlineStr) return { text: 'Rolling / Not specified', isSoon: false };
  const d = new Date(deadlineStr);
  if (isNaN(d.getTime())) return { text: deadlineStr, isSoon: false };

  const now = new Date();
  const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { text: 'Closed', isSoon: false };
  if (diffDays === 0) return { text: 'Closing Today! ⏳', isSoon: true };
  if (diffDays <= 7) return { text: `${diffDays} days left ⏳`, isSoon: true };
  return { text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), isSoon: diffDays <= 14 };
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

// ── Event Listeners Setup ──────────────────────────────────────────────────
function initEventListeners() {
  // Tabs
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchTab(tab.getAttribute('data-tab'));
    });
  });

  // Profile chip in header toggles user menu
  const profileChip = document.getElementById('header-profile-btn');
  const userMenu = document.getElementById('user-dropdown-menu');
  profileChip?.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenu?.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!profileChip?.contains(e.target) && !userMenu?.contains(e.target)) {
      userMenu?.classList.remove('show');
    }
  });

  document.getElementById('dropdown-profile-btn')?.addEventListener('click', () => {
    userMenu?.classList.remove('show');
    switchTab('profile');
  });

  document.getElementById('dropdown-logout-btn')?.addEventListener('click', async () => {
    userMenu?.classList.remove('show');
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {}
    state.user = null;
    state.token = null;
    state.profile = null;
    state.dataLoaded = false;
    localStorage.removeItem('or_token');
    localStorage.removeItem('or_refresh_token');
    showToast('You have been signed out.', 'info');
    navigate('/login');
  });

  // Demo User Instant Login Button
  document.getElementById('auth-demo-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('auth-demo-btn');
    btn.disabled = true;
    btn.innerHTML = '<span>Entering Demo Mode...</span>';
    try {
      const res = await fetch(`${API_URL}/api/auth/demo-login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Demo login failed');
      const data = await res.json();
      state.token = data.token;
      state.user = data.user;
      if (data.token) localStorage.setItem('or_token', data.token);
      showToast(`Welcome, ${data.user.name || 'Priya Sharma'}! (IIT Bombay)`, 'success');
      navigate('/');
    } catch (err) {
      showToast(`Demo login error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="play-circle"></i><span>Continue as Demo User</span>';
      if (window.lucide) window.lucide.createIcons();
    }
  });

  // Password Visibility Toggle
  document.getElementById('toggle-password-btn')?.addEventListener('click', () => {
    const passInput = document.getElementById('auth-password');
    const icon = document.getElementById('toggle-password-icon');
    if (!passInput) return;
    if (passInput.type === 'password') {
      passInput.type = 'text';
      icon?.setAttribute('data-lucide', 'eye-off');
    } else {
      passInput.type = 'password';
      icon?.setAttribute('data-lucide', 'eye');
    }
    if (window.lucide) window.lucide.createIcons();
  });

  // Auth Form Submit (Login / Register)
  document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isSignup = state.authMode === 'signup';
    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-password');
    const nameInput = document.getElementById('auth-name');
    const emailErr = document.getElementById('auth-email-error');
    const passErr = document.getElementById('auth-password-error');
    const genErr = document.getElementById('auth-general-error');
    const submitBtn = document.getElementById('auth-submit-btn');

    if (emailErr) emailErr.textContent = '';
    if (passErr) passErr.textContent = '';
    if (genErr) genErr.textContent = '';

    const email = emailInput?.value?.trim() || '';
    const password = passInput?.value || '';
    const name = nameInput?.value?.trim() || '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (emailErr) emailErr.textContent = 'Please enter a valid email address';
      return;
    }

    if (!password || password.length < 8) {
      if (passErr) passErr.textContent = 'Password must be at least 8 characters long';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = isSignup ? 'Creating account...' : 'Signing in...';

    try {
      const endpoint = isSignup ? '/api/auth/register' : '/api/auth/login';
      const body = isSignup ? { name, email, password } : { email, password };
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      state.token = data.token;
      state.user = data.user;
      if (data.token) localStorage.setItem('or_token', data.token);

      if (isSignup) {
        showToast('Account created! Let\'s tailor your profile.', 'success');
        navigate('/onboarding');
      } else {
        showToast(`Welcome back, ${data.user.name || email}!`, 'success');
        if (!data.user.onboarding_completed) {
          navigate('/onboarding');
        } else {
          navigate('/');
        }
      }
    } catch (err) {
      if (genErr) genErr.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isSignup ? 'Create Account' : 'Sign In';
    }
  });

  // Forgot Password Links & Submit
  document.getElementById('auth-forgot-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/forgot-password');
  });

  document.getElementById('forgot-back-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/login');
  });

  document.getElementById('forgot-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email')?.value?.trim();
    const errEl = document.getElementById('forgot-email-error');
    const submitBtn = document.getElementById('forgot-submit-btn');
    if (errEl) errEl.textContent = '';
    if (!email) {
      if (errEl) errEl.textContent = 'Email is required';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      showToast(data.message || 'If that email exists, a reset link was sent.', 'info');
      navigate('/login');
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Reset Link';
    }
  });

  // Onboarding: Skip Button
  document.getElementById('onboard-skip-btn')?.addEventListener('click', async () => {
    try {
      await apiRequest('/api/profile/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          name: state.user?.name || 'Student User',
          college: 'University',
          year_of_study: '3rd',
          branch: 'Computer Science',
          skills: ['Python', 'SQL', 'React'],
          interests: ['AI/ML'],
          opportunity_types: ['internship', 'hackathon'],
        }),
      });
      if (state.user) state.user.onboarding_completed = true;
    } catch {}
    showToast('Onboarding skipped. You can update your profile anytime in Student Fit Profile.', 'info');
    navigate('/');
  });

  // Onboarding: Connect GitHub
  document.getElementById('onboard-gh-fetch-btn')?.addEventListener('click', async () => {
    const username = document.getElementById('onboard-gh-user')?.value?.trim();
    const tagsContainer = document.getElementById('onboard-gh-tags');
    const btn = document.getElementById('onboard-gh-fetch-btn');
    if (!username) {
      showToast('Please enter your GitHub username', 'warning');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Scanning...';
    if (tagsContainer) tagsContainer.innerHTML = '<span style="font-size: 0.75rem; color: var(--ink-muted);">Scanning public repos...</span>';
    try {
      const res = await apiRequest('/api/profile/import/github', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      if (tagsContainer) {
        tagsContainer.innerHTML = '';
        if (res.suggestedSkills && res.suggestedSkills.length > 0) {
          res.suggestedSkills.forEach((skill) => {
            const chip = document.createElement('span');
            chip.className = 'chip-tag selectable';
            chip.innerHTML = `+ ${escapeHtml(skill)}`;
            chip.title = 'Click to add to skills';
            chip.addEventListener('click', () => {
              addSkillToInput(skill);
              chip.remove();
            });
            tagsContainer.appendChild(chip);
          });
          showToast(`Suggested ${res.suggestedSkills.length} skills from @${username}! Click chips to add.`, 'success');
        } else {
          tagsContainer.innerHTML = '<span style="font-size: 0.75rem; color: var(--ink-muted);">No language tags detected.</span>';
        }
      }
    } catch (err) {
      if (tagsContainer) tagsContainer.innerHTML = `<span style="font-size: 0.75rem; color: var(--accent-terracotta);">${escapeHtml(err.message)}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Scan';
    }
  });

  // Onboarding: Resume Upload
  document.getElementById('onboard-resume-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const tagsContainer = document.getElementById('onboard-resume-tags');
    if (tagsContainer) tagsContainer.innerHTML = '<span style="font-size: 0.75rem; color: var(--ink-muted);">Extracting skills from resume...</span>';

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = (reader.result || '').split(',')[1] || '';
      try {
        const res = await apiRequest('/api/profile/import/resume', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, file_base64: base64Data }),
        });
        if (tagsContainer) {
          tagsContainer.innerHTML = '';
          if (res.skills && res.skills.length > 0) {
            res.skills.forEach((skill) => {
              const chip = document.createElement('span');
              chip.className = 'chip-tag selectable';
              chip.innerHTML = `+ ${escapeHtml(skill)}`;
              chip.title = 'Click to add to skills';
              chip.addEventListener('click', () => {
                addSkillToInput(skill);
                chip.remove();
              });
              tagsContainer.appendChild(chip);
            });
            showToast(`Extracted ${res.skills.length} skills from resume! Click to add.`, 'success');
          } else {
            tagsContainer.innerHTML = '<span style="font-size: 0.75rem; color: var(--ink-muted);">No skills extracted.</span>';
          }
        }
      } catch (err) {
        if (tagsContainer) tagsContainer.innerHTML = `<span style="font-size: 0.75rem; color: var(--accent-terracotta);">${escapeHtml(err.message)}</span>`;
      }
    };
    reader.readAsDataURL(file);
  });

  // Onboarding: Form Submit
  document.getElementById('onboarding-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('onboard-submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Calibrating Radar...</span>';

    const name = document.getElementById('onboard-name')?.value?.trim();
    const college = document.getElementById('onboard-college')?.value?.trim();
    const year_of_study = document.getElementById('onboard-year')?.value;
    const branch = document.getElementById('onboard-branch')?.value?.trim();
    const gpa = document.getElementById('onboard-gpa')?.value ? parseFloat(document.getElementById('onboard-gpa').value) : null;
    const skills = (document.getElementById('onboard-skills')?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
    const interests = (document.getElementById('onboard-interests')?.value || '').split(',').map((i) => i.trim()).filter(Boolean);
    const linkedin_url = document.getElementById('onboard-linkedin')?.value?.trim() || null;

    try {
      const res = await apiRequest('/api/profile/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          name,
          college,
          year_of_study,
          branch,
          gpa,
          skills,
          interests,
          linkedin_url,
          opportunity_types: ['internship', 'hackathon', 'scholarship'],
        }),
      });

      if (state.user) {
        state.user.name = name;
        state.user.college = college;
        state.user.onboarding_completed = true;
      }
      state.profile = res.profile;

      showToast('Profile saved! Radar calibrated to your skills.', 'success');
      navigate('/');
    } catch (err) {
      showToast(`Error saving profile: ${err.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Save Profile &amp; Launch Radar Feed</span><i data-lucide="arrow-right"></i>';
      if (window.lucide) window.lucide.createIcons();
    }
  });

  // Alerts drawer toggle
  const drawer = document.getElementById('alerts-drawer');
  document.getElementById('alerts-toggle-btn')?.addEventListener('click', () => {
    drawer.classList.toggle('open');
  });
  document.getElementById('close-drawer-btn')?.addEventListener('click', () => {
    drawer.classList.remove('open');
  });

  // Mark all read
  document.getElementById('mark-all-read-btn')?.addEventListener('click', async () => {
    try {
      await apiRequest('/api/alerts/read-all', { method: 'POST' });
      state.unreadAlertsCount = 0;
      state.alerts.forEach((a) => (a.read = true));
      renderAlerts();
      showToast('All notifications marked as read', 'info');
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
    }
  });

  // Search & Filter
  const searchInput = document.getElementById('opp-search');
  searchInput?.addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    applyFilters();
  });

  document.getElementById('type-filter')?.addEventListener('change', (e) => {
    state.selectedType = e.target.value;
    applyFilters();
  });

  document.getElementById('match-filter')?.addEventListener('change', (e) => {
    state.selectedMatch = e.target.value;
    applyFilters();
  });

  // Profile Form Submit
  const profileForm = document.getElementById('profile-form');
  profileForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('save-profile-btn');
    const statusEl = document.getElementById('profile-save-status');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Computing matches...';

    const selectedTypes = Array.from(document.querySelectorAll('input[name="opp_type"]:checked')).map((c) => c.value);

    const updated = {
      name: document.getElementById('prof-name').value,
      year_of_study: document.getElementById('prof-year').value,
      branch: document.getElementById('prof-branch').value,
      college: document.getElementById('prof-college').value,
      gpa: document.getElementById('prof-gpa')?.value ? parseFloat(document.getElementById('prof-gpa').value) : null,
      skills: document.getElementById('prof-skills').value.split(',').map((s) => s.trim()).filter(Boolean),
      interests: document.getElementById('prof-interests').value.split(',').map((i) => i.trim()).filter(Boolean),
      location_pref: document.getElementById('prof-locations').value.split(',').map((l) => l.trim()).filter(Boolean),
      opportunity_types: selectedTypes,
    };

    try {
      const res = await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(updated),
      });

      state.profile = res.profile;
      renderProfileHeader();
      renderProfileForm();
      await loadOpportunities();
      updateMetrics();

      statusEl.style.color = 'var(--accent-green)';
      statusEl.textContent = 'Saved — scores recalculated.';
      showToast('Profile updated & match scores recalculated!', 'success');
      setTimeout(() => (statusEl.textContent = ''), 3500);
    } catch (err) {
      statusEl.style.color = 'var(--accent-terracotta)';
      statusEl.textContent = err.message;
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="check"></i><span>Save Profile &amp; Recalculate Radar Scores</span>';
      if (window.lucide) window.lucide.createIcons();
    }
  });

  // Sandbox scenario buttons
  document.getElementById('demo-deadline-btn')?.addEventListener('click', triggerMockDeadlineExtension);
  document.getElementById('demo-eligibility-btn')?.addEventListener('click', triggerMockEligibilityChange);
  document.getElementById('demo-scrape-btn')?.addEventListener('click', triggerScrapeNow);
  document.getElementById('demo-reset-btn')?.addEventListener('click', resetDemoState);
  document.getElementById('clear-console-btn')?.addEventListener('click', () => {
    const c = document.getElementById('sandbox-logs');
    if (c) c.innerHTML = '<div class="log-line log-info">[System] Console cleared.</div>';
  });

  // Refresh changes button
  document.getElementById('refresh-changes-btn')?.addEventListener('click', async () => {
    await loadOpportunities();
    extractChangesFromOpportunities();
    showToast('Timeline refreshed', 'info');
  });

  // Add Source Modal
  const sourceModal = document.getElementById('source-modal');
  document.getElementById('add-source-btn')?.addEventListener('click', () => sourceModal?.showModal());
  document.getElementById('close-source-modal-btn')?.addEventListener('click', () => sourceModal?.close());
  document.getElementById('cancel-source-btn')?.addEventListener('click', () => sourceModal?.close());

  document.getElementById('new-source-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = document.getElementById('new-source-label').value;
    const url = document.getElementById('new-source-url').value;
    const interval = parseInt(document.getElementById('new-source-interval').value || '60', 10);

    try {
      await apiRequest('/api/sources', {
        method: 'POST',
        body: JSON.stringify({ label, url, poll_interval: interval }),
      });
      sourceModal?.close();
      showToast(`Source "${label}" added to radar monitoring!`, 'success');
      await loadSources();
    } catch (err) {
      showToast(`Error adding source: ${err.message}`, 'error');
    }
  });
}

// ── Application Bootstrap ──────────────────────────────────────────────────
async function initApp() {
  if (window.lucide) window.lucide.createIcons();

  initEventListeners();

  window.addEventListener('popstate', () => {
    renderRoute();
  });

  // Initial health check + periodic polling (non-blocking)
  checkSystemHealth();
  setInterval(checkSystemHealth, 30_000);

  // Check auth state & render appropriate route
  await checkAuth();
  await renderRoute();

  if (window.lucide) window.lucide.createIcons();
  console.log('[OpportunityRadar] Application ready.');
}

// Start
initApp();
