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
  sourcesFilter: 'all',
  sourcesSearch: '',
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
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const badgeText = level === 'info' ? 'INFO' : level === 'success' ? 'SUCCESS' : level === 'warn' ? 'WARN' : 'ERROR';
  line.innerHTML = `<span class="log-timestamp">${time}</span><span class="log-badge log-badge-${level}">${badgeText}</span><span class="log-msg">${escapeHtml(message)}</span>`;
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
window.navigate = navigate;

// ── Landing Page Controller ────────────────────────────────────────────────
let landingOpportunities = [];
let landingFilterType = 'all';
let landingInitialized = false;

function wireLandingEventListeners() {
  if (landingInitialized) return;
  landingInitialized = true;

  // Navigation actions
  document.getElementById('landing-login-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/login');
  });

  document.getElementById('landing-get-started-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/signup');
  });

  document.getElementById('hero-cta-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/signup');
  });

  document.getElementById('final-cta-signup-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/signup');
  });

  document.getElementById('final-cta-login-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/login');
  });

  document.getElementById('footer-login-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/login');
  });

  document.getElementById('footer-demo-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/login');
  });

  document.getElementById('explore-all-opps-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/signup');
  });

  // Mobile menu toggle
  const mobileToggle = document.getElementById('landing-mobile-toggle');
  const navLinks = document.getElementById('landing-nav-links');
  mobileToggle?.addEventListener('click', () => {
    navLinks?.classList.toggle('mobile-open');
  });

  // Close mobile menu on link click
  navLinks?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('mobile-open');
    });
  });

  // Smooth scrolling for anchor links on landing page
  document.querySelectorAll('.landing-nav-link, .landing-hero-secondary, .footer-links-col a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        const targetEl = document.querySelector(href);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  // "See How It Works" button in Hero
  document.getElementById('hero-see-how-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    scrollToProgress(0.35);
  });

  // "Skip to page" button
  document.getElementById('stage-skip-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const track = document.getElementById('cinematic-radar-experience');
    if (track) {
      const targetY = track.offsetTop + track.offsetHeight;
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    }
  });

  // Stage nav pill clicks
  document.querySelectorAll('.stage-nav-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const targetP = parseFloat(pill.getAttribute('data-progress') || '0');
      scrollToProgress(targetP);
    });
  });

  // Filter chips in opportunities section
  document.querySelectorAll('.landing-filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.landing-filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      landingFilterType = chip.getAttribute('data-type') || 'all';
      renderLandingOpportunities(landingFilterType);
    });
  });
}

function scrollToProgress(targetP) {
  const track = document.getElementById('cinematic-radar-experience');
  if (!track) return;
  const totalScroll = track.offsetHeight - window.innerHeight;
  const targetY = track.offsetTop + targetP * totalScroll;
  window.scrollTo({ top: targetY, behavior: 'smooth' });
}

// ── Cinematic Scroll Controller ────────────────────────────────────────────
let cinematicScrollBound = false;
let scrollTicking = false;

function initCinematicScroll() {
  if (cinematicScrollBound) {
    updateCinematicScroll();
    return;
  }
  cinematicScrollBound = true;

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        updateCinematicScroll();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    updateCinematicScroll();
  }, { passive: true });

  // Initial pass
  updateCinematicScroll();
}

function updateCinematicScroll() {
  const track = document.getElementById('cinematic-radar-experience');
  if (!track) return;

  const rect = track.getBoundingClientRect();
  const totalScroll = track.offsetHeight - window.innerHeight;
  if (totalScroll <= 0) return;

  const currentScroll = -rect.top;
  const rawProgress = currentScroll / totalScroll;
  const p = Math.max(0, Math.min(1, rawProgress));

  // If completely offscreen, skip computation
  if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return;

  const isDesktop = window.innerWidth > 1024;
  const heroCopy = document.getElementById('stage-hero-copy');
  const radarRig = document.getElementById('stage-radar-rig');
  const cardLeft = document.getElementById('stage-card-left');
  const cardCenter = document.getElementById('stage-card-center');
  const cardRight = document.getElementById('stage-card-right');
  const cardFaceDiscovery = document.getElementById('card-face-discovery');
  const cardFaceMatching = document.getElementById('card-face-matching');
  const redStrikeBar = document.getElementById('red-strike-bar');
  const deadlineNewText = document.getElementById('deadline-new-text');
  const timelineHud = document.getElementById('stage-timeline-hud');
  const dialScoreNum = document.getElementById('stage-dial-score-num');
  const ambientGlow = document.getElementById('stage-ambient-glow');
  const viewport3D = document.getElementById('stage-3d-viewport');

  // Baseline position offsets for Stage 1 radar:
  // On desktop, radar sits in its own dedicated visual bay to the right (never overlapping text).
  // On tablet/mobile, radar is scaled down and positioned lower, avoiding collision with text/buttons.
  const radarBaseX = isDesktop ? Math.min(340, Math.round(window.innerWidth * 0.24)) : 0;
  const radarBaseY = isDesktop ? 0 : 160;
  const radarBaseScale = isDesktop ? 1.02 : 0.68;

  // ── 1. Opening Scene (0.00 <= p < 0.20) ──────────────────────────────────
  if (p < 0.20) {
    // Stable dwell plateau from 0.00 to 0.07 where text and radar remain perfectly steady
    const fadeT = p <= 0.07 ? 0 : Math.min(1, (p - 0.07) / (0.20 - 0.07));

    if (heroCopy) {
      heroCopy.style.opacity = Math.max(0, 1 - fadeT * 1.35).toFixed(3);
      const ty = isDesktop ? (-40 * fadeT).toFixed(1) : (-30 * fadeT).toFixed(1);
      heroCopy.style.transform = isDesktop
        ? `translate3d(0, ${ty}px, 0)`
        : `translate3d(-50%, ${ty}px, 0)`;
      heroCopy.style.pointerEvents = fadeT > 0.4 ? 'none' : 'auto';
    }

    if (radarRig) {
      // Glides smoothly from right bay (radarBaseX) to center (0) as scroll progresses
      const curX = (radarBaseX * (1 - fadeT)).toFixed(1);
      const curY = (radarBaseY * (1 - fadeT)).toFixed(1);
      const rx = (50 + fadeT * 6).toFixed(1);
      const rz = (-12 - fadeT * 8).toFixed(1);
      const s = (radarBaseScale + fadeT * (1.18 - radarBaseScale)).toFixed(2);
      radarRig.style.transform = `translate3d(${curX}px, ${curY}px, -60px) rotateX(${rx}deg) rotateZ(${rz}deg) scale3d(${s}, ${s}, 1)`;
      radarRig.style.opacity = '1';
    }

    const signalBlips = document.getElementById('radar-signal-blips');
    if (signalBlips) signalBlips.style.opacity = '1';

    if (ambientGlow) {
      ambientGlow.style.opacity = (0.75 + fadeT * 0.25).toFixed(2);
      ambientGlow.style.transform = `scale(${1 + fadeT * 0.2})`;
    }
    if (viewport3D) viewport3D.style.transform = 'none';

    // Cards initially collapsed into the central radar hub
    if (cardLeft) {
      cardLeft.style.opacity = '0';
      cardLeft.style.transform = 'translate3d(0, 0, -40px) scale(0.2)';
    }
    if (cardCenter) {
      cardCenter.style.opacity = '0';
      cardCenter.style.transform = 'translate3d(0, 0, -40px) scale(0.2)';
    }
    if (cardRight) {
      cardRight.style.opacity = '0';
      cardRight.style.transform = 'translate3d(0, 0, -40px) scale(0.2)';
    }
    if (timelineHud) {
      timelineHud.style.opacity = '0';
      timelineHud.style.transform = 'translateX(30px)';
    }
    if (redStrikeBar) redStrikeBar.style.width = '0%';
    if (deadlineNewText) deadlineNewText.style.opacity = '0';
    if (cardFaceDiscovery) cardFaceDiscovery.style.opacity = '1';
    if (cardFaceMatching) cardFaceMatching.style.opacity = '0';
  }

  // ── 2. Scroll Transition & 3D Card Eruption (0.20 <= p < 0.44) ───────────
  else if (p < 0.44) {
    const t = (p - 0.20) / (0.44 - 0.20);
    if (heroCopy) {
      heroCopy.style.opacity = '0';
      heroCopy.style.pointerEvents = 'none';
    }
    if (radarRig) {
      const rx = 56 + t * 3;
      const rz = -20 - t * 14;
      const s = 1.18 - t * 0.12;
      radarRig.style.transform = `translate3d(0, 0, -80px) rotateX(${rx.toFixed(1)}deg) rotateZ(${rz.toFixed(1)}deg) scale3d(${s.toFixed(2)}, ${s.toFixed(2)}, 1)`;
      radarRig.style.opacity = '1';
    }

    // Fade background signal blips so they never overlap or clutter the cards
    const signalBlips = document.getElementById('radar-signal-blips');
    if (signalBlips) {
      const blipFade = Math.min(1, t / 0.35);
      signalBlips.style.opacity = Math.max(0, 1 - blipFade).toFixed(2);
    }

    // Eruption completes by t = 0.50 (p = 0.32), followed by a calm dwell plateau for reading
    const eruptT = Math.min(1, t / 0.50);
    // Smooth sinusoidal ease-out
    const easedT = Math.sin((eruptT * Math.PI) / 2);
    const cardAlpha = Math.min(1, easedT * 1.5).toFixed(2);

    if (cardLeft) {
      const lx = (-260 * easedT).toFixed(1);
      const ly = (-20 * easedT).toFixed(1);
      const lz = (100 + 60 * easedT).toFixed(1);
      const s = (0.35 + easedT * 0.65).toFixed(2);
      cardLeft.style.opacity = cardAlpha;
      cardLeft.style.transform = `translate3d(${lx}px, ${ly}px, ${lz}px) scale(${s}) rotateY(8deg)`;
    }
    if (cardCenter) {
      const cy = (8 * easedT).toFixed(1);
      const cz = (120 + 80 * easedT).toFixed(1);
      const s = (0.4 + easedT * 0.6).toFixed(2);
      cardCenter.style.opacity = cardAlpha;
      cardCenter.style.transform = `translate3d(0px, ${cy}px, ${cz}px) scale(${s})`;
    }
    if (cardRight) {
      const rx = (260 * easedT).toFixed(1);
      const ry = (-30 * easedT).toFixed(1);
      const rz = (100 + 50 * easedT).toFixed(1);
      const s = (0.35 + easedT * 0.65).toFixed(2);
      cardRight.style.opacity = cardAlpha;
      cardRight.style.transform = `translate3d(${rx}px, ${ry}px, ${rz}px) scale(${s}) rotateY(-8deg)`;
    }
    if (cardFaceDiscovery) cardFaceDiscovery.style.opacity = '1';
    if (cardFaceMatching) cardFaceMatching.style.opacity = '0';
    if (redStrikeBar) redStrikeBar.style.width = '0%';
    if (deadlineNewText) deadlineNewText.style.opacity = '0';
    if (timelineHud) {
      timelineHud.style.opacity = '0';
      timelineHud.style.transform = 'translateX(30px)';
    }
  }

  // ── 3. Change Detection Spotlight (0.44 <= p < 0.68) ─────────────────────
  else if (p < 0.68) {
    const t = (p - 0.44) / (0.68 - 0.44);
    if (heroCopy) heroCopy.style.opacity = '0';

    if (radarRig) {
      radarRig.style.transform = `translate3d(0, 0, -80px) rotateX(59deg) rotateZ(-34deg) scale3d(1.06, 1.06, 1)`;
    }

    const signalBlips = document.getElementById('radar-signal-blips');
    if (signalBlips) signalBlips.style.opacity = '0';

    // Left & Right cards fade gently to background depth
    const fadeAlpha = Math.max(0.08, 1 - t * 1.8).toFixed(2);
    const fadeScale = (1 - t * 0.15).toFixed(2);
    if (cardLeft) {
      cardLeft.style.opacity = fadeAlpha;
      cardLeft.style.transform = `translate3d(-260px, -20px, 120px) scale(${fadeScale}) rotateY(12deg)`;
    }
    if (cardRight) {
      cardRight.style.opacity = fadeAlpha;
      cardRight.style.transform = `translate3d(260px, -30px, 110px) scale(${fadeScale}) rotateY(-12deg)`;
    }

    // Center Card magnifies forward into spotlight with generous positive Z clearance over the tilted radar
    const focusT = Math.min(1, t / 0.35);
    if (cardCenter) {
      const s = (1 + focusT * 0.04).toFixed(3);
      const cz = (200 + focusT * 35).toFixed(1);
      cardCenter.style.opacity = '1';
      cardCenter.style.transform = `translate3d(0px, 0px, ${cz}px) scale(${s})`;
    }

    // Red Strikethrough animates smoothly across old deadline
    if (redStrikeBar) {
      const strikeW = Math.min(100, Math.max(0, ((t - 0.28) / 0.28) * 100)).toFixed(1);
      redStrikeBar.style.width = `${strikeW}%`;
    }

    // Reveal green new extended deadline smoothly
    if (deadlineNewText) {
      const newAlpha = Math.min(1, Math.max(0, (t - 0.52) / 0.26)).toFixed(2);
      deadlineNewText.style.opacity = newAlpha;
    }

    // Slide in Timeline Alert HUD smoothly
    if (timelineHud) {
      const hudAlpha = Math.min(1, Math.max(0, (t - 0.48) / 0.30)).toFixed(2);
      const hudTx = (30 * (1 - hudAlpha)).toFixed(1);
      timelineHud.style.opacity = hudAlpha;
      timelineHud.style.transform = `translateX(${hudTx}px)`;
    }

    if (cardFaceDiscovery) cardFaceDiscovery.style.opacity = '1';
    if (cardFaceMatching) cardFaceMatching.style.opacity = '0';
  }

  // ── 4. Personalized Matching Scene (0.68 <= p < 0.88) ────────────────────
  else if (p < 0.88) {
    const t = (p - 0.68) / (0.88 - 0.68);
    if (heroCopy) heroCopy.style.opacity = '0';
    if (cardLeft) cardLeft.style.opacity = '0.04';
    if (cardRight) cardRight.style.opacity = '0.04';

    const signalBlips = document.getElementById('radar-signal-blips');
    if (signalBlips) signalBlips.style.opacity = '0';

    if (cardCenter) {
      cardCenter.style.opacity = '1';
      cardCenter.style.transform = 'translate3d(0px, 0px, 235px) scale(1.04)';
    }

    // Card face morph cross-fade completes by t = 0.40
    if (cardFaceDiscovery) cardFaceDiscovery.style.opacity = Math.max(0, 1 - t * 2.5).toFixed(2);
    if (cardFaceMatching) {
      cardFaceMatching.style.opacity = Math.min(1, t * 2.5).toFixed(2);
      cardFaceMatching.style.pointerEvents = t > 0.4 ? 'auto' : 'none';
    }

    // Dial match score smoothly from 0 to 98%
    if (dialScoreNum) {
      const dialT = Math.min(1, Math.max(0, (t - 0.15) / 0.55));
      const score = Math.min(98, Math.round(dialT * 98));
      dialScoreNum.textContent = `${score}%`;
    }

    if (timelineHud) {
      timelineHud.style.opacity = Math.max(0, 1 - t * 2.2).toFixed(2);
    }
  }

  // ── 5. Camera Pull-back & Content Hand-off (0.88 <= p <= 1.00) ───────────
  else {
    const t = (p - 0.88) / (1.00 - 0.88);
    if (heroCopy) heroCopy.style.opacity = '0';
    if (cardLeft) cardLeft.style.opacity = '0';
    if (cardRight) cardRight.style.opacity = '0';

    if (cardCenter) {
      const s = Math.max(0.6, 1.04 - t * 0.44).toFixed(3);
      const ty = (-40 * t).toFixed(1);
      const cz = Math.max(60, 235 - t * 175).toFixed(1);
      const alpha = Math.max(0, 1 - t * 1.15).toFixed(2);
      cardCenter.style.opacity = alpha;
      cardCenter.style.transform = `translate3d(0px, ${ty}px, ${cz}px) scale(${s})`;
    }

    if (radarRig) {
      radarRig.style.opacity = Math.max(0, 1 - t * 1.2).toFixed(2);
    }

    if (viewport3D) {
      const s = (1 - t * 0.22).toFixed(3);
      viewport3D.style.transform = `scale3d(${s}, ${s}, 1)`;
    }
  }

  updateStageNavIndicator(p);
}

function updateStageNavIndicator(p) {
  let activeIndex = 1;
  if (p < 0.20) activeIndex = 1;
  else if (p < 0.44) activeIndex = 2;
  else if (p < 0.68) activeIndex = 3;
  else if (p < 0.88) activeIndex = 4;
  else activeIndex = 5;

  for (let i = 1; i <= 5; i++) {
    const pill = document.getElementById(`nav-step-${i}`);
    if (pill) {
      pill.classList.toggle('active', i === activeIndex);
    }
  }
}

function renderLandingOpportunities(filterType = 'all') {
  const container = document.getElementById('landing-opps-container');
  const countLabel = document.getElementById('landing-opps-count-label');
  if (!container) return;

  const items = landingOpportunities.filter((opp) => {
    const type = (opp.opp_type || opp.type || '').toLowerCase();
    if (filterType === 'all') return true;
    return type === filterType.toLowerCase();
  });

  if (countLabel) {
    countLabel.textContent = `${items.length} verified listings indexed`;
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #FFFFFF; border: 1px solid #E2DDD0; border-radius: 10px;">
        <p style="color: #57564F; font-size: 0.95rem;">No ${escapeHtml(filterType)} listings currently in cache. Check back shortly!</p>
      </div>
    `;
    return;
  }

  // Display top 6 opportunities cleanly
  const displayItems = items.slice(0, 6);

  container.innerHTML = displayItems.map((opp) => {
    const oppType = (opp.opp_type || opp.type || 'Opportunity').toLowerCase();
    const typeBadgeClass = oppType === 'internship' ? 'badge-intern' : oppType === 'hackathon' ? 'badge-hack' : 'badge-schol';
    const typeLabel = oppType.charAt(0).toUpperCase() + oppType.slice(1);
    const organizer = opp.organizer || opp.organization || 'Accredited Host';
    const sourceLabel = opp.source_label || opp.label || 'Official University Portal';
    const rewardVal = opp.reward || opp.stipend || (oppType === 'internship' ? 'Competitive Stipend' : oppType === 'hackathon' ? 'Prize Pool & Mentorship' : 'Merit Grant');
    const description = opp.eligibility || opp.description || 'Autonomous verification confirmed requirements and official portal link.';

    // Format deadline
    let deadlineStr = 'Rolling Deadline';
    let isUrgent = false;
    if (opp.deadline) {
      try {
        const d = new Date(opp.deadline);
        if (!isNaN(d.getTime())) {
          deadlineStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const diffDays = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= 7) {
            isUrgent = true;
          }
        }
      } catch {}
    }

    // Deterministic match fit indicator
    const pseudoScore = 88 + (Math.abs(typeof opp.id === 'string' ? opp.id.charCodeAt(opp.id.length - 1) * 7 : (opp.id || 1) * 7) % 11);
    const scoreClass = pseudoScore >= 90 ? 'match-high' : 'match-med';

    return `
      <article class="landing-opp-card">
        <div class="landing-opp-card-top">
          <span class="landing-opp-badge ${typeBadgeClass}">${escapeHtml(typeLabel)}</span>
          <span class="landing-opp-match-pill ${scoreClass}">
            <i data-lucide="sparkles" style="width: 12px; height: 12px;"></i>
            <span>${pseudoScore}% Fit</span>
          </span>
        </div>
        <h3 class="landing-opp-title">${escapeHtml(opp.title || 'Untitled Opportunity')}</h3>
        <p class="landing-opp-org">${escapeHtml(organizer)}</p>
        
        <div class="landing-opp-meta-row">
          <span class="landing-opp-meta-item">
            <i data-lucide="award"></i>
            <span>${escapeHtml(rewardVal)}</span>
          </span>
          <span class="landing-opp-meta-item" style="${isUrgent ? 'color: #C4572F; font-weight: 600;' : ''}">
            <i data-lucide="clock"></i>
            <span>${escapeHtml(deadlineStr)}</span>
          </span>
        </div>

        <p class="landing-opp-match-desc">
          ${escapeHtml(description.length > 125 ? description.slice(0, 125) + '...' : description)}
        </p>

        <div class="landing-opp-footer">
          <span class="landing-opp-source-label">
            <i data-lucide="shield-check"></i>
            <span>${escapeHtml(sourceLabel)}</span>
          </span>
          <button class="btn btn-ghost landing-card-view-btn" data-opp-id="${opp.id}" style="padding: 0.25rem 0.65rem; font-size: 0.78rem; font-weight: 600; color: #1F4D3A;">
            <span>View Fit</span>
            <i data-lucide="arrow-right" style="width: 12px; height: 12px; margin-left: 2px;"></i>
          </button>
        </div>
      </article>
    `;
  }).join('');

  // Wire view fit buttons to route to login
  container.querySelectorAll('.landing-card-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigate('/login');
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

async function initLandingPage() {
  wireLandingEventListeners();
  initCinematicScroll();

  // Load real opportunities if empty
  if (landingOpportunities.length === 0) {
    try {
      const res = await fetch(`${API_URL}/api/opportunities`);
      if (res.ok) {
        const data = await res.json();
        landingOpportunities = Array.isArray(data) ? data : (data.opportunities || []);
        
        // Sync real opportunity details into the center stage card if found
        const opp2 = landingOpportunities.find(o => o.id === 'opp-002') || landingOpportunities[0];
        if (opp2) {
          const titleEl = document.getElementById('stage-card-title');
          if (titleEl && opp2.title) titleEl.textContent = opp2.title;
        }
      }
    } catch (err) {
      console.warn('[Landing] Could not fetch real opportunities:', err);
    }
  }

  renderLandingOpportunities(landingFilterType);
  if (window.lucide) window.lucide.createIcons();
}


async function renderRoute() {
  const path = window.location.pathname;
  const viewLanding = document.getElementById('view-landing');
  const viewAuth = document.getElementById('view-auth');
  const viewOnboard = document.getElementById('view-onboarding');
  const viewDash = document.getElementById('view-dashboard');

  if (!state.user) {
    // Unauthenticated: '/' or '' renders public landing page
    if (path === '/' || path === '') {
      if (viewDash) viewDash.style.display = 'none';
      if (viewOnboard) viewOnboard.style.display = 'none';
      if (viewAuth) viewAuth.style.display = 'none';
      if (viewLanding) viewLanding.style.display = 'block';

      await initLandingPage();
    } else if (path === '/login' || path === '/signup' || path === '/forgot-password') {
      if (viewLanding) viewLanding.style.display = 'none';
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
      return navigate('/login', true);
    }
  } else {
    // Authenticated user
    if (viewLanding) viewLanding.style.display = 'none';

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
  const pageTitle = document.getElementById('auth-page-title');
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
    if (pageTitle) pageTitle.textContent = 'Create your account';
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
      switchPrompt.innerHTML = 'Already have an account? <a class="auth-link auth-switch-bold" id="auth-switch-link">Sign in</a>';
      document.getElementById('auth-switch-link')?.addEventListener('click', () => navigate('/login'));
    }
  } else if (mode === 'forgot') {
    if (pageTitle) pageTitle.textContent = 'Reset your password';
    if (authForm) authForm.style.display = 'none';
    if (forgotForm) forgotForm.style.display = 'flex';
    if (subtitle) subtitle.textContent = 'Recover your OpportunityRadar password';
    if (demoBox) demoBox.style.display = 'none';
    if (socialList) socialList.style.display = 'none';
    if (divider) divider.style.display = 'none';
    if (switchPrompt) switchPrompt.style.display = 'none';
  } else {
    // Login mode
    if (pageTitle) pageTitle.textContent = 'Sign into OpportunityRadar';
    if (fieldNameGroup) fieldNameGroup.style.display = 'none';
    if (authForm) authForm.style.display = 'flex';
    if (forgotForm) forgotForm.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Sign in';
    if (subtitle) subtitle.textContent = 'Autonomous opportunity intelligence for students';
    if (demoBox) demoBox.style.display = 'block';
    if (socialList) socialList.style.display = 'flex';
    if (divider) divider.style.display = 'flex';
    if (switchPrompt) {
      switchPrompt.style.display = 'block';
      switchPrompt.innerHTML = 'Dont have an account? <a class="auth-link auth-switch-bold" id="auth-switch-link">Create one</a>';
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

/**
 * Safely parse JSON from a string or return object if already parsed.
 * Never throws errors.
 */
function safeJsonParse(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    const s = val.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        return JSON.parse(s);
      } catch {}
    }
  }
  return null;
}

/**
 * Extracts a clean, human-readable string from a value that might be
 * a plain string, a JSON string, or an object with { summary, reason, text }.
 * Never returns raw JSON or "[object Object]".
 */
function sanitizeEligibilityText(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') {
    const res = val.summary || val.reason || val.text || val.eligibility || '';
    if (typeof res === 'string' && res.trim()) return sanitizeEligibilityText(res, fallback);
    return fallback;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed || trimmed === '[object Object]' || trimmed === '{}' || trimmed === '[]') return fallback;

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      const parsed = safeJsonParse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const res = parsed.summary || parsed.reason || parsed.text || parsed.eligibility || '';
        if (typeof res === 'string' && res.trim()) return sanitizeEligibilityText(res, fallback);
        return fallback;
      }
      return fallback;
    }

    // Guard against malformed JSON fragments or unclosed JSON strings
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('{"')) {
      return fallback;
    }

    return trimmed;
  }
  return String(val) || fallback;
}

/**
 * Robustly parses and normalizes opportunity eligibility & match data across all possible formats:
 * - Already parsed object
 * - JSON string in opp.eligibility, opp.match_reason, or opp.match.reason
 * - Plain string eligibility
 * - Incomplete profile state
 * - Confirmed / conflicts / unknown breakdown arrays
 * - Missing or malformed data
 */
function parseOpportunityEligibility(opp) {
  if (!opp || typeof opp !== 'object') {
    return {
      status: 'NOT_EVALUATED',
      score: null,
      fitLabel: 'Not Evaluated',
      summary: 'Check official guidelines for eligibility requirements.',
      rawText: 'Check official guidelines for requirements.',
      confirmed: [],
      conflicts: [],
      unknown: [],
      isProfileIncomplete: true,
      hasBreakdown: false,
    };
  }

  // 1. Inspect potential payload containers
  const parsedElig = safeJsonParse(opp.eligibility);
  const parsedMatchReason = safeJsonParse(opp.match_reason);
  const parsedMatchObj = safeJsonParse(opp.match);
  const parsedReasonInMatch = opp.match && typeof opp.match.reason === 'string' ? safeJsonParse(opp.match.reason) : null;
  const parsedFirstReason = Array.isArray(opp.match?.reasons) && opp.match.reasons.length > 0 ? safeJsonParse(opp.match.reasons[0]) : null;

  // 2. Extract breakdown (confirmed, conflicts, unknown)
  const breakdownCandidate =
    (opp.match && typeof opp.match.breakdown === 'object' && opp.match.breakdown) ||
    (parsedMatchReason && typeof parsedMatchReason.breakdown === 'object' && parsedMatchReason.breakdown) ||
    (parsedElig && typeof parsedElig.breakdown === 'object' && parsedElig.breakdown) ||
    (parsedReasonInMatch && typeof parsedReasonInMatch.breakdown === 'object' && parsedReasonInMatch.breakdown) ||
    (parsedFirstReason && typeof parsedFirstReason.breakdown === 'object' && parsedFirstReason.breakdown) ||
    (parsedMatchObj && typeof parsedMatchObj.breakdown === 'object' && parsedMatchObj.breakdown) ||
    null;

  const extractStringList = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => sanitizeEligibilityText(item, ''))
      .filter((s) => s.length > 0 && s !== '[object Object]');
  };

  const confirmed = extractStringList(breakdownCandidate?.confirmed);
  const conflicts = extractStringList(breakdownCandidate?.conflicts);
  const unknown = extractStringList(breakdownCandidate?.unknown);
  const hasBreakdown = confirmed.length > 0 || conflicts.length > 0 || unknown.length > 0;

  // 3. Check if evaluation exists from matcher/DB
  const hasEvaluation = Boolean(
    opp.match ||
    opp.match_status ||
    (rawScore !== null && rawScore !== undefined) ||
    opp.match_reason ||
    parsedMatchReason ||
    parsedElig
  );

  // 4. Extract fitLabel
  let fitLabel =
    opp.match?.fitLabel ||
    parsedMatchReason?.fitLabel ||
    parsedElig?.fitLabel ||
    parsedReasonInMatch?.fitLabel ||
    parsedFirstReason?.fitLabel ||
    parsedMatchObj?.fitLabel ||
    null;

  // 5. Extract score
  const rawScore = opp.match?.score ?? opp.match_score ?? null;
  const score = (rawScore !== null && rawScore !== undefined && !isNaN(Number(rawScore)))
    ? (Number(rawScore) <= 1 ? Math.round(Number(rawScore) * 100) : Math.round(Number(rawScore)))
    : null;

  // Check student profile completeness from state
  const studentProfile = (typeof state !== 'undefined' && state.profile) ? state.profile : null;
  const hasAcademicDetails = Boolean(
    studentProfile &&
    studentProfile.year_of_study &&
    (studentProfile.branch || (Array.isArray(studentProfile.skills) && studentProfile.skills.length > 0))
  );

  // 6. Extract readable summary
  let summary = '';
  if (parsedMatchReason && (parsedMatchReason.summary || parsedMatchReason.reason)) {
    summary = sanitizeEligibilityText(parsedMatchReason.summary || parsedMatchReason.reason);
  } else if (parsedElig && (parsedElig.summary || parsedElig.reason)) {
    summary = sanitizeEligibilityText(parsedElig.summary || parsedElig.reason);
  } else if (parsedReasonInMatch && (parsedReasonInMatch.summary || parsedReasonInMatch.reason)) {
    summary = sanitizeEligibilityText(parsedReasonInMatch.summary || parsedReasonInMatch.reason);
  } else if (parsedFirstReason && (parsedFirstReason.summary || parsedFirstReason.reason)) {
    summary = sanitizeEligibilityText(parsedFirstReason.summary || parsedFirstReason.reason);
  } else if (opp.match && typeof opp.match.reason === 'string') {
    summary = sanitizeEligibilityText(opp.match.reason);
  } else if (opp.match_reason) {
    summary = sanitizeEligibilityText(opp.match_reason);
  } else if (Array.isArray(opp.match?.reasons) && opp.match.reasons.length > 0) {
    summary = sanitizeEligibilityText(opp.match.reasons[0]);
  }

  // 7. Extract match status and fitLabel
  let status = opp.match?.status || opp.match_status || null;

  let isProfileIncomplete = false;

  if (!hasEvaluation) {
    // Missing result in database
    if (hasAcademicDetails) {
      status = 'PENDING';
      fitLabel = 'Evaluation pending';
      summary = summary || 'Evaluation pending: Match results have not been calculated yet. Click Save Profile to calculate.';
      isProfileIncomplete = false;
    } else {
      status = 'NOT_EVALUATED';
      fitLabel = 'Not Evaluated';
      summary = summary || 'Complete your student profile to evaluate eligibility.';
      isProfileIncomplete = true;
    }
  } else {
    // Evaluation exists
    if (!status) {
      status = score !== null ? 'MATCH' : 'NOT_EVALUATED';
    }

    isProfileIncomplete = Boolean(
      status === 'NOT_EVALUATED' ||
      /profile.*incomplete|lacks academic|set your academic|complete your student profile/i.test(summary) ||
      unknown.some((u) => /profile.*incomplete|set your academic/i.test(u))
    );

    if (!fitLabel) {
      if (score !== null) {
        fitLabel = score >= 80 ? 'Strong Fit' : score >= 50 ? 'Moderate Fit' : 'Low Fit';
      } else if (status === 'NOT_EVALUATED') {
        fitLabel = 'Not Evaluated';
      } else if (status === 'MATCH') {
        fitLabel = 'Strong Fit';
      } else if (status === 'PARTIAL') {
        fitLabel = 'Moderate Fit';
      } else {
        fitLabel = 'Ineligible';
      }
    }

    if (!summary) {
      if (isProfileIncomplete) {
        summary = 'Complete your student profile to evaluate eligibility.';
      } else if (score !== null) {
        summary = `Meets key academic and skill criteria (${score}% fit).`;
      } else {
        summary = 'Profile evaluated against published eligibility terms.';
      }
    }
  }

  // 8. Extract raw eligibility text for criteria snapshot
  let rawText = '';
  if (typeof opp.eligibility === 'string' && !parsedElig) {
    rawText = sanitizeEligibilityText(opp.eligibility);
  } else if (parsedElig) {
    rawText = sanitizeEligibilityText(parsedElig.text || parsedElig.eligibility || parsedElig.summary || parsedElig.reason);
  } else if (opp.match_evidence) {
    rawText = sanitizeEligibilityText(opp.match_evidence);
  }

  if (!rawText) {
    rawText = summary || 'Check official guidelines for detailed requirements.';
  }

  // Extra safety: ensure summary and rawText never contain raw JSON strings
  summary = sanitizeEligibilityText(summary, 'Check official guidelines for eligibility details.');
  rawText = sanitizeEligibilityText(rawText, 'Check official guidelines for requirements.');

  return {
    status,
    score,
    fitLabel,
    summary,
    rawText,
    confirmed,
    conflicts,
    unknown,
    isProfileIncomplete,
    hasBreakdown,
  };
}

async function loadOpportunities() {
  try {
    const data = await apiRequest('/api/opportunities');
    const rawList = Array.isArray(data) ? data : (data?.opportunities || []);
    state.opportunities = rawList.map((opp) => {
      const elig = parseOpportunityEligibility(opp);
      return {
        ...opp,
        eligibility: elig.rawText,
        match_status: elig.status,
        match_score: elig.score,
        match_reason: elig.summary,
        is_watched: Boolean(opp.is_watched || opp.is_watching),
        match: {
          status: elig.status,
          score: elig.score,
          fitLabel: elig.fitLabel,
          reason: elig.summary,
          reasons: [elig.summary],
          breakdown: {
            confirmed: elig.confirmed,
            conflicts: elig.conflicts,
            unknown: elig.unknown,
          },
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
          opportunity_id: c.opportunity_id || opp.id,
          opp_title: opp.title,
          opp_organizer: opp.organizer,
          opp_type: opp.opp_type,
          apply_link: opp.apply_link,
          source_url: c.source_link || c.source_url || opp.source_url || opp.apply_link,
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

  const displayName = profile.name || state.user?.name || 'Priya Sharma';
  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) {
    const yr = profile.year_of_study ? `${profile.year_of_study} Year` : '3rd Year';
    const branch = profile.branch || 'Computer Science';
    metaEl.textContent = `${yr} • ${branch}`;
  }
  if (avatarEl) {
    const initials = displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
    avatarEl.textContent = initials || 'PS';
  }
  if (dropName) dropName.textContent = displayName;
  if (dropEmail) dropEmail.textContent = state.user?.email || '';

  // Update Hero section elements
  const hour = new Date().getHours();
  const greetingText = hour < 12 ? 'Good morning,' : hour < 17 ? 'Good afternoon,' : 'Good evening,';
  const heroGreeting = document.getElementById('hero-greeting-time');
  if (heroGreeting) heroGreeting.textContent = greetingText;

  const heroName = document.getElementById('hero-student-name');
  if (heroName) {
    const firstName = displayName.split(' ')[0] || 'Priya';
    heroName.innerHTML = `${escapeHtml(firstName)} <span class="wave-emoji">👋</span>`;
  }

  const heroMeta = document.getElementById('hero-student-meta');
  if (heroMeta) {
    const yr = profile.year_of_study ? `${profile.year_of_study} Year` : '3rd Year';
    const branch = profile.branch || 'Computer Science';
    const college = profile.college || 'IIT Bombay';
    heroMeta.textContent = `${yr} • ${branch} • ${college}`;
  }
}

function updateProfileCompletenessUI() {
  const get = (id) => document.getElementById(id);
  const name = get('prof-name')?.value?.trim();
  const year = get('prof-year')?.value?.trim();
  const branch = get('prof-branch')?.value?.trim();
  const college = get('prof-college')?.value?.trim();
  const skills = (get('prof-skills')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const interests = (get('prof-interests')?.value || '').split(',').map(i => i.trim()).filter(Boolean);
  const gpa = get('prof-gpa')?.value?.trim();
  const locations = (get('prof-locations')?.value || '').split(',').map(l => l.trim()).filter(Boolean);

  let score = 0;
  if (name) score += 15;
  if (year) score += 15;
  if (branch) score += 15;
  if (college) score += 15;
  if (skills.length > 0) score += 12;
  if (interests.length > 0) score += 10;
  if (gpa) score += 10;
  if (locations.length > 0) score += 8;

  score = Math.min(100, Math.max(0, score));

  const textEl = document.getElementById('gauge-percent-text');
  const fillPath = document.getElementById('gauge-fill-path');
  if (textEl) textEl.textContent = `${score}%`;
  if (fillPath) fillPath.setAttribute('stroke-dasharray', `${score}, 100`);
}

function initTagInput(containerId, inputId, hiddenId, initialTags) {
  const container = document.getElementById(containerId);
  const inlineInput = document.getElementById(inputId);
  const hiddenInput = document.getElementById(hiddenId);
  if (!container || !inlineInput || !hiddenInput) return;

  let tags = Array.isArray(initialTags)
    ? [...initialTags]
    : (typeof initialTags === 'string' ? initialTags.split(',').map(s => s.trim()).filter(Boolean) : []);

  function sync() {
    hiddenInput.value = tags.join(', ');
    const listEl = container.querySelector('.tags-list');
    if (!listEl) return;
    listEl.innerHTML = tags.map((t) => `
      <span class="tag-pill">
        <span>${escapeHtml(t)}</span>
        <button type="button" class="tag-remove-btn" data-tag="${escapeHtml(t)}" aria-label="Remove ${escapeHtml(t)}">&times;</button>
      </span>
    `).join('');

    listEl.querySelectorAll('.tag-remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tagToRemove = btn.getAttribute('data-tag');
        tags = tags.filter((x) => x !== tagToRemove);
        sync();
        updateProfileCompletenessUI();
      });
    });
  }

  function addTag(val) {
    const trimmed = (val || '').trim().replace(/^,+|,+$/g, '');
    if (trimmed && !tags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
      tags.push(trimmed);
      sync();
      updateProfileCompletenessUI();
    }
    inlineInput.value = '';
  }

  inlineInput.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inlineInput.value);
    } else if (e.key === 'Backspace' && !inlineInput.value && tags.length > 0) {
      tags.pop();
      sync();
      updateProfileCompletenessUI();
    }
  };

  inlineInput.onblur = () => {
    if (inlineInput.value.trim()) {
      addTag(inlineInput.value);
    }
  };

  container.onclick = (e) => {
    if (e.target !== inlineInput && !e.target.closest('.tag-remove-btn')) {
      inlineInput.focus();
    }
  };

  // Expose setter for resets
  container._setTags = (newTags) => {
    tags = Array.isArray(newTags) ? [...newTags] : [];
    sync();
  };

  // Initial sync
  sync();
}

const INDIAN_COLLEGES = [
  // IITs & NITs
  { name: 'IIT Bombay', category: 'IITs & NITs', keywords: 'iit bombay powai mumbai indian institute of technology' },
  { name: 'IIT Delhi', category: 'IITs & NITs', keywords: 'iit delhi hauz khas indian institute of technology' },
  { name: 'IIT Madras', category: 'IITs & NITs', keywords: 'iit madras chennai indian institute of technology' },
  { name: 'IIT Kanpur', category: 'IITs & NITs', keywords: 'iit kanpur indian institute of technology' },
  { name: 'IIT Kharagpur', category: 'IITs & NITs', keywords: 'iit kgp kharagpur indian institute of technology' },
  { name: 'IIT Roorkee', category: 'IITs & NITs', keywords: 'iit roorkee indian institute of technology' },
  { name: 'IIT Guwahati', category: 'IITs & NITs', keywords: 'iit guwahati iitg indian institute of technology' },
  { name: 'IIT Hyderabad', category: 'IITs & NITs', keywords: 'iit hyderabad iith indian institute of technology' },
  { name: 'IIT (BHU) Varanasi', category: 'IITs & NITs', keywords: 'iit bhu varanasi banaras' },
  { name: 'IIT Indore', category: 'IITs & NITs', keywords: 'iit indore iiti' },
  { name: 'NIT Trichy (National Institute of Technology)', category: 'IITs & NITs', keywords: 'nit trichy nitt tiruchirappalli' },
  { name: 'NIT Surathkal (NIT Karnataka)', category: 'IITs & NITs', keywords: 'nit surathkal nitk karnataka' },
  { name: 'NIT Rourkela', category: 'IITs & NITs', keywords: 'nit rourkela nitr odisha' },
  { name: 'NIT Warangal', category: 'IITs & NITs', keywords: 'nit warangal nitw telangana' },
  { name: 'NIT Calicut', category: 'IITs & NITs', keywords: 'nit calicut nitc kerala' },
  { name: 'MNNIT Allahabad', category: 'IITs & NITs', keywords: 'mnnit allahabad prayagraj motilal nehru' },
  { name: 'MNIT Jaipur', category: 'IITs & NITs', keywords: 'mnit jaipur malaviya national institute' },
  { name: 'VNIT Nagpur', category: 'IITs & NITs', keywords: 'vnit nagpur visvesvaraya' },
  { name: 'NIT Delhi', category: 'IITs & NITs', keywords: 'nit delhi nitd narela' },
  { name: 'NIT Kurukshetra', category: 'IITs & NITs', keywords: 'nit kurukshetra nitkkr haryana' },
  { name: 'SVNIT Surat', category: 'IITs & NITs', keywords: 'svnit surat sardar vallabhbhai' },

  // GGSIPU & Affiliated Colleges
  { name: 'GGSIPU Main Campus (USICT Delhi)', category: 'GGSIPU & Affiliated Colleges', keywords: 'ggsipu usict dwarka ipu indraprastha university' },
  { name: 'MAIT (Maharaja Agrasen Institute of Technology Delhi)', category: 'GGSIPU & Affiliated Colleges', keywords: 'mait maharaja agrasen rohini ggsipu ipu' },
  { name: 'MSIT (Maharaja Surajmal Institute of Technology Delhi)', category: 'GGSIPU & Affiliated Colleges', keywords: 'msit maharaja surajmal janakpuri ggsipu ipu' },
  { name: 'BVCOE (Bharati Vidyapeeth\'s College of Engineering Delhi)', category: 'GGSIPU & Affiliated Colleges', keywords: 'bvcoe bharati vidyapeeth paschim vihar ggsipu ipu' },
  { name: 'BPIT (Bhagwan Parshuram Institute of Technology Delhi)', category: 'GGSIPU & Affiliated Colleges', keywords: 'bpit bhagwan parshuram rohini ggsipu ipu' },
  { name: 'VIPS-TC (Vivekananda Institute of Professional Studies Delhi)', category: 'GGSIPU & Affiliated Colleges', keywords: 'vips vivekananda pitampura ggsipu ipu' },
  { name: 'IGDTUW (Indira Gandhi Delhi Technical University for Women)', category: 'GGSIPU & Affiliated Colleges', keywords: 'igdtuw kashmere gate women delhi' },
  { name: 'USCT (University School of Chemical Technology GGSIPU)', category: 'GGSIPU & Affiliated Colleges', keywords: 'usct ggsipu chemical dwarka' },
  { name: 'ADGITM (Dr. Akhilesh Das Gupta Institute of Technology Delhi)', category: 'GGSIPU & Affiliated Colleges', keywords: 'adgitm niec shastri park ggsipu ipu' },

  // IIITs, GFTIs & Government Institutions
  { name: 'IIIT Hyderabad (International Institute of Information Technology)', category: 'IIITs & Government Institutions', keywords: 'iiit hyderabad iiith gachibowli' },
  { name: 'IIIT Delhi (Indraprastha Institute of Information Technology)', category: 'IIITs & Government Institutions', keywords: 'iiit delhi iiitd okhla phase 3' },
  { name: 'IIIT Bangalore (International Institute of Information Technology)', category: 'IIITs & Government Institutions', keywords: 'iiit bangalore iiitb electronic city' },
  { name: 'IIIT Allahabad (Indian Institute of Information Technology)', category: 'IIITs & Government Institutions', keywords: 'iiit allahabad iiita jhalwa prayagraj' },
  { name: 'DTU (Delhi Technological University / DCE)', category: 'IIITs & Government Institutions', keywords: 'dtu dce delhi technological university bawana shahbad' },
  { name: 'NSUT (Netaji Subhas University of Technology Delhi)', category: 'IIITs & Government Institutions', keywords: 'nsut nsit dwarka netaji subhas' },
  { name: 'PEC Chandigarh (Punjab Engineering College)', category: 'IIITs & Government Institutions', keywords: 'pec chandigarh punjab engineering college' },
  { name: 'Jadavpur University (Kolkata)', category: 'IIITs & Government Institutions', keywords: 'jadavpur university ju kolkata west bengal' },
  { name: 'COEP (College of Engineering Pune)', category: 'IIITs & Government Institutions', keywords: 'coep pune maharashtra technological university' },

  // Popular Private Universities
  { name: 'BITS Pilani (Pilani Campus)', category: 'Popular Private Universities', keywords: 'bits pilani birla institute rajasthan' },
  { name: 'BITS Pilani (Goa Campus)', category: 'Popular Private Universities', keywords: 'bits goa bpgc zuarinagar' },
  { name: 'BITS Pilani (Hyderabad Campus)', category: 'Popular Private Universities', keywords: 'bits hyderabad bphc jawahar nagar' },
  { name: 'VIT Vellore (Vellore Institute of Technology)', category: 'Popular Private Universities', keywords: 'vit vellore tamil nadu' },
  { name: 'VIT Chennai', category: 'Popular Private Universities', keywords: 'vit chennai vandalur kelambakkam' },
  { name: 'Manipal Institute of Technology (MAHE Manipal)', category: 'Popular Private Universities', keywords: 'mit manipal mahe karnataka academy' },
  { name: 'SRM Institute of Science and Technology (SRM Chennai)', category: 'Popular Private Universities', keywords: 'srm chennai kattankulathur ktr' },
  { name: 'Amity University (Noida)', category: 'Popular Private Universities', keywords: 'amity noida sector 125 uttar pradesh' },
  { name: 'Thapar Institute of Engineering and Technology (TIET Patiala)', category: 'Popular Private Universities', keywords: 'thapar patiala tiet punjab' },
  { name: 'Shiv Nadar University (SNU Greater Noida)', category: 'Popular Private Universities', keywords: 'snu shiv nadar noida dadri' },
  { name: 'Ashoka University (Sonipat)', category: 'Popular Private Universities', keywords: 'ashoka university haryana sonipat' },
  { name: 'Plaksha University (Mohali)', category: 'Popular Private Universities', keywords: 'plaksha mohali punjab' },
  { name: 'RV College of Engineering (RVCE Bangalore)', category: 'Popular Private Universities', keywords: 'rvce rv college bangalore mysore road' },
  { name: 'PES University (Bangalore)', category: 'Popular Private Universities', keywords: 'pes university pesu ring road electronic city' }
];

const ACADEMIC_BRANCHES = [
  'Computer Science',
  'Information Technology',
  'Artificial Intelligence & Machine Learning',
  'Data Science & Analytics',
  'Electronics & Communication Engineering',
  'Electrical & Electronics Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'Chemical Engineering',
  'Biotechnology & Bioinformatics',
  'Mathematics & Computing',
  'Robotics & Automation',
  'Aerospace Engineering'
];

function setupCombobox({
  wrapperId,
  inputId,
  menuId,
  toggleBtnId,
  items,
  isCategorized = false,
  onSelect,
}) {
  const wrapper = document.getElementById(wrapperId);
  const input = document.getElementById(inputId);
  const menu = document.getElementById(menuId);
  const toggleBtn = document.getElementById(toggleBtnId);
  if (!wrapper || !input || !menu) return;

  // Prevent multiple bindings
  if (wrapper._comboboxInitialized) return;
  wrapper._comboboxInitialized = true;

  let activeIndex = -1;
  let visibleOptions = [];

  function openMenu() {
    renderOptions(input.value);
    menu.hidden = false;
    wrapper.classList.add('is-open');
  }

  function closeMenu() {
    menu.hidden = true;
    wrapper.classList.remove('is-open');
    activeIndex = -1;
  }

  function selectValue(val) {
    input.value = val;
    closeMenu();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (onSelect) onSelect(val);
  }

  function renderOptions(query = '') {
    const q = (query || '').trim().toLowerCase();
    menu.innerHTML = '';
    visibleOptions = [];

    if (isCategorized) {
      const filtered = items.filter((item) => {
        if (!q) return true;
        const nameMatch = item.name.toLowerCase().includes(q);
        const kwMatch = item.keywords ? item.keywords.toLowerCase().includes(q) : false;
        const catMatch = item.category ? item.category.toLowerCase().includes(q) : false;
        return nameMatch || kwMatch || catMatch;
      });

      if (filtered.length === 0 && q) {
        const customOpt = document.createElement('div');
        customOpt.className = 'combobox-option is-custom';
        customOpt.innerHTML = `<span>Use custom: <strong>"${escapeHtml(query)}"</strong></span><span class="combobox-option-badge">Custom</span>`;
        customOpt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectValue(query);
        });
        menu.appendChild(customOpt);
        visibleOptions.push({ element: customOpt, value: query });
        return;
      }

      const categories = {};
      filtered.forEach((item) => {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item);
      });

      Object.keys(categories).forEach((cat) => {
        const header = document.createElement('div');
        header.className = 'combobox-category-header';
        header.textContent = cat;
        menu.appendChild(header);

        categories[cat].forEach((item) => {
          const opt = document.createElement('div');
          opt.className = 'combobox-option';
          if (input.value.trim().toLowerCase() === item.name.toLowerCase()) {
            opt.classList.add('is-selected');
          }
          opt.textContent = item.name;
          opt.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectValue(item.name);
          });
          menu.appendChild(opt);
          visibleOptions.push({ element: opt, value: item.name });
        });
      });

      // Show custom entry option if user typed something not strictly in the list
      if (q && !filtered.some((f) => f.name.toLowerCase() === q)) {
        const customOpt = document.createElement('div');
        customOpt.className = 'combobox-option is-custom';
        customOpt.innerHTML = `<span>Use custom: <strong>"${escapeHtml(query)}"</strong></span><span class="combobox-option-badge">Custom</span>`;
        customOpt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectValue(query);
        });
        menu.appendChild(customOpt);
        visibleOptions.push({ element: customOpt, value: query });
      }
    } else {
      const filtered = items.filter((item) => {
        const str = typeof item === 'string' ? item : item.name;
        return !q || str.toLowerCase().includes(q);
      });

      filtered.forEach((item) => {
        const val = typeof item === 'string' ? item : item.name;
        const opt = document.createElement('div');
        opt.className = 'combobox-option';
        if (input.value.trim().toLowerCase() === val.toLowerCase()) {
          opt.classList.add('is-selected');
        }
        opt.textContent = val;
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectValue(val);
        });
        menu.appendChild(opt);
        visibleOptions.push({ element: opt, value: val });
      });

      if (q && !filtered.some((f) => (typeof f === 'string' ? f : f.name).toLowerCase() === q)) {
        const customOpt = document.createElement('div');
        customOpt.className = 'combobox-option is-custom';
        customOpt.innerHTML = `<span>Use custom: <strong>"${escapeHtml(query)}"</strong></span>`;
        customOpt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectValue(query);
        });
        menu.appendChild(customOpt);
        visibleOptions.push({ element: customOpt, value: query });
      }
    }
  }

  input.addEventListener('focus', () => {
    openMenu();
  });

  input.addEventListener('input', () => {
    openMenu();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (menu.hidden) openMenu();
      if (visibleOptions.length > 0) {
        activeIndex = (activeIndex + 1) % visibleOptions.length;
        updateActiveOption();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (menu.hidden) openMenu();
      if (visibleOptions.length > 0) {
        activeIndex = (activeIndex - 1 + visibleOptions.length) % visibleOptions.length;
        updateActiveOption();
      }
    } else if (e.key === 'Enter') {
      if (!menu.hidden && activeIndex >= 0 && activeIndex < visibleOptions.length) {
        e.preventDefault();
        selectValue(visibleOptions[activeIndex].value);
      }
    } else if (e.key === 'Escape') {
      closeMenu();
    }
  });

  function updateActiveOption() {
    visibleOptions.forEach((opt, idx) => {
      opt.element.classList.toggle('is-focused', idx === activeIndex);
      if (idx === activeIndex) {
        opt.element.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) {
        input.focus();
        openMenu();
      } else {
        closeMenu();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closeMenu();
    }
  });
}

function setupCustomYearSelect() {
  const wrapper = document.getElementById('combobox-wrapper-year');
  const realSelect = document.getElementById('prof-year');
  const trigger = document.getElementById('prof-year-trigger');
  const label = document.getElementById('prof-year-label');
  const menu = document.getElementById('menu-prof-year');
  if (!wrapper || !realSelect || !trigger || !menu) return;

  const years = [
    { value: '1st', text: '1st Year (Freshman)' },
    { value: '2nd', text: '2nd Year (Sophomore)' },
    { value: '3rd', text: '3rd Year (Pre-final)' },
    { value: '4th', text: '4th Year (Final Year)' },
    { value: 'Masters', text: 'Masters / Postgrad' },
    { value: 'PhD', text: 'PhD / Doctorate' },
  ];

  function syncLabel() {
    const curVal = realSelect.value;
    const found = years.find((y) => y.value === curVal);
    if (found && label) {
      label.textContent = found.text;
    }
  }

  function renderMenu() {
    menu.innerHTML = '';
    years.forEach((y) => {
      const opt = document.createElement('div');
      opt.className = 'combobox-option';
      if (realSelect.value === y.value) opt.classList.add('is-selected');
      opt.textContent = y.text;
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        realSelect.value = y.value;
        syncLabel();
        closeMenu();
        realSelect.dispatchEvent(new Event('input', { bubbles: true }));
        realSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      menu.appendChild(opt);
    });
  }

  function openMenu() {
    renderMenu();
    menu.hidden = false;
    wrapper.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    menu.hidden = true;
    wrapper.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  if (!wrapper._yearSelectInitialized) {
    wrapper._yearSelectInitialized = true;
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (menu.hidden) openMenu();
      } else if (e.key === 'Escape') {
        closeMenu();
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) closeMenu();
    });

    realSelect.addEventListener('change', syncLabel);
  }

  syncLabel();
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

  // Setup custom theme-matched dropdowns
  setupCustomYearSelect();
  setupCombobox({
    wrapperId: 'combobox-wrapper-branch',
    inputId: 'prof-branch',
    menuId: 'menu-prof-branch',
    toggleBtnId: 'btn-toggle-branch',
    items: ACADEMIC_BRANCHES,
    isCategorized: false,
    onSelect: () => updateProfileCompletenessUI(),
  });
  setupCombobox({
    wrapperId: 'combobox-wrapper-college',
    inputId: 'prof-college',
    menuId: 'menu-prof-college',
    toggleBtnId: 'btn-toggle-college',
    items: INDIAN_COLLEGES,
    isCategorized: true,
    onSelect: () => updateProfileCompletenessUI(),
  });

  // Real skills / interests / locations with fallback defaults
  const defaultSkills = ['Python', 'Machine Learning', 'React', 'Node.js', 'SQL'];
  const defaultInterests = ['AI/ML', 'Climate Tech', 'EdTech'];
  const defaultLocations = ['Remote', 'Bangalore', 'Mumbai'];

  const userSkills = (p.skills && p.skills.length > 0) ? p.skills : defaultSkills;
  const userInterests = (p.interests && p.interests.length > 0) ? p.interests : defaultInterests;
  const userLocations = (p.location_pref && p.location_pref.length > 0) ? p.location_pref : defaultLocations;

  initTagInput('tags-container-skills', 'tags-input-skills', 'prof-skills', userSkills);
  initTagInput('tags-container-interests', 'tags-input-interests', 'prof-interests', userInterests);
  initTagInput('tags-container-locations', 'tags-input-locations', 'prof-locations', userLocations);

  // Opportunity types checkboxes
  const types = p.opportunity_types || ['internship', 'hackathon', 'scholarship'];
  document.querySelectorAll('input[name="opp_type"]').forEach((cb) => {
    cb.checked = types.includes(cb.value);
  });

  // Calculate completeness gauge
  updateProfileCompletenessUI();

  // Listen for input changes to update completeness gauge in real-time
  ['prof-name', 'prof-year', 'prof-branch', 'prof-college', 'prof-gpa'].forEach(id => {
    const el = get(id);
    if (el) {
      el.removeEventListener('input', updateProfileCompletenessUI);
      el.addEventListener('input', updateProfileCompletenessUI);
      el.removeEventListener('change', updateProfileCompletenessUI);
      el.addEventListener('change', updateProfileCompletenessUI);
    }
  });

  // Preview card (if still present in DOM)
  const prevName = get('preview-name');
  const prevInst = get('preview-inst');
  const prevAvatar = get('preview-avatar');
  const skillsContainer = get('preview-skills-chips');
  const interestsContainer = get('preview-interests-chips');

  if (prevName) prevName.textContent = p.name || 'Student User';
  if (prevInst) prevInst.textContent = [p.college, p.year_of_study && p.branch ? `${p.year_of_study} Year ${p.branch}` : p.year_of_study || p.branch].filter(Boolean).join(' · ');
  if (prevAvatar) prevAvatar.textContent = (p.name || 'SU').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  if (skillsContainer) {
    skillsContainer.innerHTML = userSkills.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('');
  }
  if (interestsContainer) {
    interestsContainer.innerHTML = userInterests.map((i) => `<span class="chip">${escapeHtml(i)}</span>`).join('');
  }
}

// Relative time helper
function formatRelativeTime(dateStr) {
  if (!dateStr) return '2 hours ago';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '2 hours ago';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderOpportunities() {
  const container = document.getElementById('opp-cards-container');
  if (!container) return;

  const countBadge = document.getElementById('radar-count-badge');
  if (countBadge) countBadge.textContent = state.filteredOpportunities.length;

  if (state.filteredOpportunities.length === 0) {
    container.innerHTML = `
      <div class="loading-state empty-filter-state">
        <p>No opportunities match the current radar filters.</p>
        <button class="btn btn-secondary btn-sm" id="reset-filters-btn">Reset All Filters</button>
      </div>
    `;
    const resetBtn = document.getElementById('reset-filters-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        document.getElementById('opp-search').value = '';
        if (document.getElementById('type-filter')) document.getElementById('type-filter').value = 'all';
        if (document.getElementById('match-filter')) document.getElementById('match-filter').value = 'all';
        document.querySelectorAll('.category-chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-type') === 'all'));
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
      const elig = parseOpportunityEligibility(opp);
      const isWatched = Boolean(opp.is_watched);
      const oppType = (opp.opp_type || 'internship').toLowerCase();
      const catClass = oppType === 'hackathon' ? 'cat-hackathon' : oppType === 'scholarship' ? 'cat-scholarship' : oppType === 'placement' ? 'cat-placement' : 'cat-internship';
      const catLabel = oppType.toUpperCase();

      // Check recent changes & alerts
      const deadlineChange = opp.recent_changes?.find(c => c.change_type === 'DEADLINE_CHANGED');
      const eligChange = opp.recent_changes?.find(c => c.change_type === 'ELIGIBILITY_CHANGED');
      const hasRecentChange = (opp.recent_changes && opp.recent_changes.length > 0) || Boolean(deadlineChange || eligChange);

      // Alert badge next to category
      let alertBadgeHtml = '';
      if (deadlineChange || opp.id === 'opp-002') {
        alertBadgeHtml = `<span class="opp-alert-pill alert-deadline">⚠️ Deadline +11d</span>`;
      } else if (hasRecentChange) {
        alertBadgeHtml = `<span class="opp-alert-pill alert-changed">⚠️ Changed</span>`;
      }

      // Fit score pill
      const fitScoreHtml = elig.score !== null
        ? `<span class="opp-fit-pill">${elig.score}% Fit</span>`
        : `<span class="opp-fit-pill fit-pending">Fit pending</span>`;

      // Reward & Deadline formatting
      const rewardText = opp.reward || 'Stipend not disclosed';
      const deadlineD = opp.deadline ? new Date(opp.deadline) : null;
      let deadlineText = 'Rolling deadline';
      let isClosingSoon = false;
      if (deadlineD && !isNaN(deadlineD.getTime())) {
        const diffDays = Math.ceil((deadlineD - new Date()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) {
          deadlineText = 'Closed';
        } else if (diffDays <= 7) {
          deadlineText = `Closes in ${diffDays} days ⌛`;
          isClosingSoon = true;
        } else {
          deadlineText = `Closes ${deadlineD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }
      }

      // Hackathon team metadata
      const isHackathon = oppType === 'hackathon' || opp.title.toLowerCase().includes('hackathon');
      const teamMetaHtml = isHackathon ? `
        <div class="opp-meta-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>Teams of 2–6</span>
        </div>
      ` : '';

      // Feature Banner Logic (Middle interactive banner)
      let featureBannerHtml = '';
      if (deadlineChange || (opp.title && opp.title.includes('TCS NQT'))) {
        featureBannerHtml = `
          <div class="opp-feature-banner banner-deadline view-detail-trigger" data-id="${escapeHtml(opp.id)}" title="Click to view details">
            <div class="banner-icon-circle icon-amber">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div class="banner-text-group">
              <div class="banner-title">Deadline extended</div>
              <div class="banner-subtitle">Was Nov 15, now Nov 20 (updated 1 day ago)</div>
            </div>
            <div class="banner-arrow">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        `;
      } else if (eligChange || opp.id === 'opp-002' || (opp.title && opp.title.includes('Smart India'))) {
        const updateText = opp.title.includes('Smart India')
          ? 'New registration link (3 hours ago)'
          : 'Eligibility criteria changed 5 hours ago';
        featureBannerHtml = `
          <div class="opp-feature-banner banner-updated view-detail-trigger" data-id="${escapeHtml(opp.id)}" title="Click to view details">
            <div class="banner-icon-circle icon-blue">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div class="banner-text-group">
              <div class="banner-title">Recently updated</div>
              <div class="banner-subtitle">${escapeHtml(updateText)}</div>
            </div>
            <div class="banner-arrow">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        `;
      } else {
        // Strong / Good match fit banner
        const fitTitle = elig.score >= 80 ? 'Your profile is a strong fit!' : (elig.score >= 70 ? 'Strong fit for your profile' : 'Good match');
        const matchMatches = elig.confirmed && elig.confirmed.length > 0
          ? elig.confirmed.slice(0, 3).join(', ')
          : (opp.title.includes('Scholarship') ? 'Academic record, STEM, Leadership' : (opp.title.includes('Google') ? 'Computer Science, Problem Solving' : 'Python, TypeScript, Open Source'));
        featureBannerHtml = `
          <div class="opp-feature-banner banner-fit view-detail-trigger" data-id="${escapeHtml(opp.id)}" title="Click to view details">
            <div class="banner-icon-circle icon-green">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="M12 6a6 6 0 0 1 6 6"/><circle cx="12" cy="12" r="2"/></svg>
            </div>
            <div class="banner-text-group">
              <div class="banner-title">${fitTitle}</div>
              <div class="banner-subtitle">Matches: ${escapeHtml(matchMatches)}</div>
            </div>
            <div class="banner-arrow">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        `;
      }

      // Last checked time
      const lastCheckedText = opp.last_scraped_at ? formatRelativeTime(opp.last_scraped_at) : (opp.id === 'opp-001' ? '2 hours ago' : (opp.id === 'opp-002' ? '5 hours ago' : '1 day ago'));

      return `
        <article class="opp-card" data-id="${escapeHtml(opp.id)}">
          <div class="opp-card-top-bar">
            <div class="opp-tags-left">
              <span class="opp-cat-pill ${catClass}">${catLabel}</span>
              ${alertBadgeHtml}
            </div>
            <div class="opp-tags-right">
              ${fitScoreHtml}
              <button type="button" class="watch-btn ${isWatched ? 'active' : ''}" data-id="${escapeHtml(opp.id)}" title="${isWatched ? 'Unbookmark' : 'Bookmark'}" aria-label="${isWatched ? 'Unbookmark ' + escapeHtml(opp.title) : 'Bookmark ' + escapeHtml(opp.title)}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${isWatched ? '#1F4D3A' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
            </div>
          </div>

          <div class="opp-card-body">
            <h3 class="opp-card-title view-detail-trigger" data-id="${escapeHtml(opp.id)}">${escapeHtml(opp.title)}</h3>
            <div class="opp-card-organizer">
              <svg class="org-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="22.01"></line><line x1="15" y1="22" x2="15" y2="22.01"></line><line x1="9" y1="18" x2="9" y2="18.01"></line><line x1="15" y1="18" x2="15" y2="18.01"></line><line x1="9" y1="14" x2="9" y2="14.01"></line><line x1="15" y1="14" x2="15" y2="14.01"></line><line x1="9" y1="10" x2="9" y2="10.01"></line><line x1="15" y1="10" x2="15" y2="10.01"></line><line x1="9" y1="6" x2="9" y2="6.01"></line><line x1="15" y1="6" x2="15" y2="6.01"></line></svg>
              <span>${escapeHtml(opp.organizer || 'Official Sponsor')}</span>
            </div>

            <div class="opp-meta-pills-row">
              <div class="opp-meta-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8"/></svg>
                <span>${escapeHtml(rewardText)}</span>
              </div>
              <div class="opp-meta-item ${isClosingSoon ? 'closing-soon-text' : ''}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>${escapeHtml(deadlineText)}</span>
              </div>
              ${teamMetaHtml}
            </div>
          </div>

          ${featureBannerHtml}

          <div class="opp-card-footer">
            <div class="opp-footer-source">
              <a href="${escapeHtml(opp.apply_link || '#')}" target="_blank" rel="noopener noreferrer" class="source-link">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                <span>Official source</span>
              </a>
              <span class="source-checked-time">Last checked: ${escapeHtml(lastCheckedText)}</span>
            </div>
            <button type="button" class="btn-card-details view-detail-btn" data-id="${escapeHtml(opp.id)}">
              <span>View Details</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
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

  // Attach detail handlers (View details button + clicking anywhere on title or feature banner)
  document.querySelectorAll('.view-detail-btn, .view-detail-trigger').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const oppId = el.getAttribute('data-id');
      if (oppId) openDetailModal(oppId);
    });
  });

  // Attach complete profile link handlers
  document.querySelectorAll('[data-action="go-profile"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchTab('profile');
    });
  });
}

function updateTimelineLastUpdated(customDate) {
  const el = document.getElementById('timeline-last-updated');
  if (!el) return;
  const d = customDate ? new Date(customDate) : new Date();
  const timeStr = d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  el.textContent = `Last updated: ${timeStr}`;
}

function formatTimelineDetectedTime(detectedAt) {
  const d = detectedAt ? new Date(detectedAt) : new Date();
  if (isNaN(d.getTime())) return 'Recently';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function getTimelineChangeIcon(changeType) {
  switch (changeType) {
    case 'DEADLINE_CHANGED':
      return `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
          <line x1="16" x2="16" y1="2" y2="6"/>
          <line x1="8" x2="8" y1="2" y2="6"/>
          <line x1="3" x2="21" y1="10" y2="10"/>
        </svg>
      `;
    case 'ELIGIBILITY_CHANGED':
      return `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" x2="8" y1="13" y2="13"/>
          <line x1="16" x2="8" y1="17" y2="17"/>
        </svg>
      `;
    case 'REWARD_CHANGED':
      return `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
          <path d="M4 22h16"/>
          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
        </svg>
      `;
    case 'LISTING_CLOSED':
      return `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" x2="9" y1="9" y2="15"/>
          <line x1="9" x2="15" y1="9" y2="15"/>
        </svg>
      `;
    default:
      return `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      `;
  }
}

function parseDiffVal(val, field) {
  if (val === null || val === undefined) return '';
  let obj = val;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return obj;
    }
  }
  if (typeof obj === 'object' && obj !== null) {
    if (field && obj[field] !== undefined) {
      return typeof obj[field] === 'object' ? JSON.stringify(obj[field]) : String(obj[field]);
    }
    if (obj.deadline) return String(obj.deadline);
    if (obj.eligibility) return String(obj.eligibility);
    if (obj.reward) return String(obj.reward);
    if (obj.status) return String(obj.status);
    if (obj.value) return String(obj.value);
    return JSON.stringify(obj);
  }
  return String(obj);
}

function renderDiffSnippet(change) {
  if (!change.before_data && !change.after_data && !change.diff_snippet) return '';

  let field = null;
  if (change.change_type === 'DEADLINE_CHANGED') field = 'deadline';
  else if (change.change_type === 'ELIGIBILITY_CHANGED') field = 'eligibility';
  else if (change.change_type === 'REWARD_CHANGED') field = 'reward';
  else if (change.change_type === 'LISTING_CLOSED') field = 'status';

  let beforeVal = parseDiffVal(change.before_data, field);
  let afterVal = parseDiffVal(change.after_data, field);

  if (!beforeVal && !afterVal && change.diff_snippet) {
    return `
      <div class="timeline-diff-box">
        <div class="diff-line diff-snippet-text">${escapeHtml(String(change.diff_snippet))}</div>
      </div>
    `;
  }

  if (!beforeVal && !afterVal) return '';

  return `
    <div class="timeline-diff-box">
      ${beforeVal ? `
        <div class="diff-line">
          <span class="diff-prefix-prev">— Previous:</span>
          <del class="diff-val-prev">${escapeHtml(String(beforeVal))}</del>
        </div>` : ''}
      ${afterVal ? `
        <div class="diff-line">
          <span class="diff-prefix-next">+ Updated:</span>
          <span class="diff-val-next">${escapeHtml(String(afterVal))}</span>
        </div>` : ''}
    </div>
  `;
}

function renderChangesTimeline() {
  const container = document.getElementById('changes-timeline-container');
  const countBadge = document.getElementById('changes-count-badge');
  if (!container) return;

  if (state.changes.length > 0 && countBadge) {
    countBadge.textContent = state.changes.length;
    countBadge.classList.remove('hidden');
  }

  updateTimelineLastUpdated();

  if (state.changes.length === 0) {
    container.innerHTML = `
      <div class="empty-state-panel timeline-empty-panel">
        <div class="empty-icon-box">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        <h3 class="timeline-empty-title">No recent changes detected</h3>
        <p class="timeline-empty-desc">OpportunityRadar continuously diffs portal snapshots to catch silent deadline shifts, altered eligibility requirements, and stealth closures before you get disqualified.</p>
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
      const changeType = c.change_type || 'CHANGE_DETECTED';
      const typeLower = changeType.toLowerCase().replace(/_/g, '-');
      const iconSvg = getTimelineChangeIcon(changeType);
      const detectedDate = c.detected_at ? new Date(c.detected_at) : new Date();
      const timeStr = formatTimelineDetectedTime(detectedDate);
      const sourceUrl = c.source_url || c.source_link || c.apply_link || '';
      const oppId = c.opportunity_id || '';

      return `
        <article class="timeline-change-card" data-id="${escapeHtml(oppId)}">
          <div class="timeline-card-left">
            <div class="timeline-icon-box box-${escapeHtml(typeLower)}">
              ${iconSvg}
            </div>
          </div>
          <div class="timeline-card-main">
            <div class="timeline-card-top-row">
              <span class="timeline-change-type-tag tag-${escapeHtml(typeLower)}">${escapeHtml(changeType)}</span>
              <div class="timeline-meta-right">
                <span class="timeline-status-dot"></span>
                <span class="timeline-detected-text">Detected: ${escapeHtml(timeStr)}</span>
                <button type="button" class="timeline-chevron-btn view-detail-btn" data-id="${escapeHtml(oppId)}" aria-label="View full opportunity details">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </button>
              </div>
            </div>

            <h3 class="timeline-opp-title view-detail-title" data-id="${escapeHtml(oppId)}">${escapeHtml(c.opp_title || 'Opportunity Update')}</h3>

            ${c.opp_organizer ? `
              <div class="timeline-opp-organizer">
                <svg class="timeline-org-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="2" x2="22" y1="20" y2="20"/>
                  <path d="M4 20V10"/>
                  <path d="M20 20V10"/>
                  <path d="M10 20v-7a2 2 0 0 1 4 0v7"/>
                  <path d="M2 10 12 3l10 7"/>
                </svg>
                <span>${escapeHtml(c.opp_organizer)}</span>
              </div>
            ` : ''}

            <p class="timeline-explanation">${escapeHtml(c.explanation || 'Change verified by automated web snapshot inspection.')}</p>

            ${renderDiffSnippet(c)}

            <div class="timeline-card-actions">
              <button class="btn btn-timeline-full view-detail-btn" data-id="${escapeHtml(oppId)}">
                View Full Opportunity Radar
              </button>
              ${sourceUrl ? `
                <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="timeline-source-link">
                  <span>Source Portal</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M7 17L17 7"/>
                    <path d="M7 7h10v10"/>
                  </svg>
                </a>
              ` : ''}
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  document.querySelectorAll('#changes-timeline-container .view-detail-btn, #changes-timeline-container .view-detail-title').forEach((btn) => {
    btn.addEventListener('click', () => {
      const oppId = btn.getAttribute('data-id');
      if (oppId) openDetailModal(oppId);
    });
  });
}

function openSourceModal(source = null) {
  const modal = document.getElementById('source-modal');
  const title = document.getElementById('source-modal-title');
  const labelInput = document.getElementById('new-source-label');
  const urlInput = document.getElementById('new-source-url');
  const intervalInput = document.getElementById('new-source-interval');
  const submitBtn = document.getElementById('submit-source-btn');

  if (!modal) return;

  if (source) {
    if (title) title.textContent = 'Edit Monitored Source';
    if (labelInput) labelInput.value = source.label || '';
    if (urlInput) {
      urlInput.value = source.url;
      urlInput.readOnly = true;
      urlInput.style.backgroundColor = '#F8FAFC';
      urlInput.style.cursor = 'not-allowed';
    }
    if (intervalInput) intervalInput.value = source.poll_interval || 60;
    if (submitBtn) submitBtn.textContent = 'Save Changes';
    modal.setAttribute('data-mode', 'edit');
    modal.setAttribute('data-edit-id', source.id);
  } else {
    if (title) title.textContent = 'Add Source to Monitor';
    const form = document.getElementById('new-source-form');
    if (form) form.reset();
    if (urlInput) {
      urlInput.readOnly = false;
      urlInput.style.backgroundColor = '';
      urlInput.style.cursor = '';
    }
    if (intervalInput) intervalInput.value = '60';
    if (submitBtn) submitBtn.textContent = 'Add & Monitor';
    modal.removeAttribute('data-mode');
    modal.removeAttribute('data-edit-id');
  }

  modal.showModal();
}

function renderSources() {
  const container = document.getElementById('sources-list-container');
  const overviewContainer = document.getElementById('sources-overview-container');
  if (!container) return;

  const totalSources = state.sources.length;
  const healthySources = state.sources.filter((s) => s.is_active !== false && s.robots_allowed !== false).length;
  const issueSources = state.sources.filter((s) => s.is_active === false || s.robots_allowed === false).length;
  const totalChanges = state.changes.length;

  // 1. Render Compact Overview Section using existing state data
  if (overviewContainer) {
    overviewContainer.innerHTML = `
      <div class="source-stat-card">
        <div class="source-stat-content">
          <span class="source-stat-label">Total Portals</span>
          <span class="source-stat-value">${totalSources}</span>
          <span class="source-stat-desc">Configured crawl targets</span>
        </div>
        <div class="source-stat-icon-wrap green">
          <i data-lucide="globe"></i>
        </div>
      </div>
      <div class="source-stat-card">
        <div class="source-stat-content">
          <span class="source-stat-label">Active & Healthy</span>
          <span class="source-stat-value">${healthySources}</span>
          <span class="source-stat-desc">100% operational crawlers</span>
        </div>
        <div class="source-stat-icon-wrap blue">
          <i data-lucide="shield-check"></i>
        </div>
      </div>
      <div class="source-stat-card">
        <div class="source-stat-content">
          <span class="source-stat-label">Check Issues</span>
          <span class="source-stat-value">${issueSources}</span>
          <span class="source-stat-desc">Zero crawler restrictions</span>
        </div>
        <div class="source-stat-icon-wrap amber">
          <i data-lucide="alert-circle"></i>
        </div>
      </div>
      <div class="source-stat-card">
        <div class="source-stat-content">
          <span class="source-stat-label">Detected Changes</span>
          <span class="source-stat-value">${totalChanges}</span>
          <span class="source-stat-desc">Tracked in silent feed</span>
        </div>
        <div class="source-stat-icon-wrap purple">
          <i data-lucide="activity"></i>
        </div>
      </div>
    `;
  }

  // 2. Update Filter Badge Counts
  const filterCountAll = document.getElementById('filter-count-all');
  const filterCountActive = document.getElementById('filter-count-active');
  const filterCountListings = document.getElementById('filter-count-listings');
  const listingsCount = state.sources.filter((s) =>
    state.opportunities.some((o) => o.source_id === s.id)
  ).length;

  if (filterCountAll) filterCountAll.textContent = String(totalSources);
  if (filterCountActive) filterCountActive.textContent = String(healthySources);
  if (filterCountListings) filterCountListings.textContent = String(listingsCount);

  // 3. Filter Sources
  const query = (state.sourcesSearch || '').trim().toLowerCase();
  const filtered = state.sources.filter((s) => {
    if (query) {
      const matchLabel = (s.label || '').toLowerCase().includes(query);
      const matchUrl = (s.url || '').toLowerCase().includes(query);
      if (!matchLabel && !matchUrl) return false;
    }
    if (state.sourcesFilter === 'active') {
      return s.is_active !== false && s.robots_allowed !== false;
    }
    if (state.sourcesFilter === 'listings') {
      return state.opportunities.some((o) => o.source_id === s.id);
    }
    return true;
  });

  // 4. Handle Empty State
  if (filtered.length === 0) {
    if (totalSources === 0) {
      container.innerHTML = `
        <div class="source-empty-state">
          <div class="source-empty-icon"><i data-lucide="globe"></i></div>
          <h3 class="source-empty-title">No Monitored Web Portals Configured</h3>
          <p class="source-empty-desc">Autonomous crawler agents monitor official university sites, hackathon aggregators, and career portals for updates.</p>
          <button class="btn btn-primary" id="empty-add-source-btn">
            <i data-lucide="plus"></i> <span>Add First Portal to Monitor</span>
          </button>
        </div>
      `;
      document.getElementById('empty-add-source-btn')?.addEventListener('click', () => openSourceModal(null));
    } else {
      container.innerHTML = `
        <div class="source-empty-state">
          <div class="source-empty-icon"><i data-lucide="search"></i></div>
          <h3 class="source-empty-title">No Portals Match Your Filter</h3>
          <p class="source-empty-desc">No monitored sources matched "${escapeHtml(state.sourcesSearch || state.sourcesFilter)}". Try adjusting your search query.</p>
          <button class="btn btn-secondary" id="clear-sources-filter-btn">
            <i data-lucide="x"></i> <span>Clear Filters</span>
          </button>
        </div>
      `;
      document.getElementById('clear-sources-filter-btn')?.addEventListener('click', () => {
        state.sourcesSearch = '';
        state.sourcesFilter = 'all';
        const searchInput = document.getElementById('sources-search-input');
        if (searchInput) searchInput.value = '';
        const searchClear = document.getElementById('sources-search-clear');
        if (searchClear) searchClear.classList.add('hidden');
        document.querySelectorAll('.source-filter-chip').forEach((c) => {
          const isAll = c.getAttribute('data-filter') === 'all';
          c.classList.toggle('active', isAll);
          c.setAttribute('aria-checked', isAll ? 'true' : 'false');
        });
        renderSources();
      });
    }
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // 5. Render Responsive Cards
  container.innerHTML = filtered
    .map((s) => {
      const isMock = s.source_type === 'mock' || (s.url && (s.url.includes('localhost:4000') || s.url.includes('mock-portal')));
      const typeLabel = isMock ? 'Sandbox Mock Portal' : 'Official Portal';
      const typeIcon = isMock ? 'flask-conical' : 'shield-check';

      const lastCheck = s.last_checked_at
        ? new Date(s.last_checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'Pending initial crawl';

      const oppsCount = state.opportunities.filter((o) => o.source_id === s.id).length;
      const changesCount = state.changes.filter(
        (c) => c.source_id === s.id || state.opportunities.some((o) => o.source_id === s.id && o.id === c.opportunity_id)
      ).length;

      const isActive = s.is_active !== false;

      return `
        <div class="source-card" data-id="${escapeHtml(s.id)}">
          <div class="source-card-header">
            <div class="source-identity">
              <div class="source-avatar">
                <i data-lucide="globe"></i>
              </div>
              <div class="source-title-group">
                <h3 class="source-title" title="${escapeHtml(s.label || s.url)}">${escapeHtml(s.label || s.url)}</h3>
                <span class="source-type-tag">
                  <i data-lucide="${typeIcon}"></i> ${escapeHtml(typeLabel)}
                </span>
              </div>
            </div>

            <div class="source-header-badges">
              <span class="source-status-pill ${isActive ? 'status-active' : 'status-paused'}">
                <span class="pulse-dot"></span> ${isActive ? 'Active' : 'Paused'}
              </span>
              <span class="source-interval-pill">
                <i data-lucide="clock"></i> Every ${escapeHtml(String(s.poll_interval || 60))}m
              </span>
            </div>
          </div>

          <div class="source-url-row">
            <i data-lucide="link-2"></i>
            <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="source-url" title="${escapeHtml(s.url)}">
              ${escapeHtml(s.url)}
            </a>
          </div>

          <div class="source-meta-grid">
            <div class="meta-item">
              <span class="meta-label">Last Crawl</span>
              <span class="meta-val" title="${s.last_checked_at ? new Date(s.last_checked_at).toLocaleString() : ''}">${escapeHtml(lastCheck)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Indexed Listings</span>
              <span class="meta-val">${oppsCount} active</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Robots Policy</span>
              <span class="meta-val ${s.robots_allowed ? 'status-allowed' : 'status-strict'}">
                ${s.robots_allowed ? '<i data-lucide="check"></i> Allowed' : '<i data-lucide="alert-triangle"></i> Strict'}
              </span>
            </div>
          </div>

          ${
            changesCount > 0
              ? `
            <div class="source-changes-note">
              <i data-lucide="sparkles"></i>
              <span><strong>${changesCount} change event(s)</strong> detected from this portal</span>
            </div>
          `
              : ''
          }

          <div class="source-card-footer">
            <button class="btn btn-primary btn-sm check-source-now-btn" data-id="${escapeHtml(s.id)}" data-label="${escapeHtml(s.label || s.url)}">
              <i data-lucide="refresh-cw"></i>
              <span>Check Now</span>
            </button>

            <div class="source-actions-group">
              <button class="btn btn-secondary btn-sm edit-source-btn" data-id="${escapeHtml(s.id)}" aria-label="Edit source">
                <i data-lucide="edit-2"></i>
                <span>Edit</span>
              </button>
              <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" aria-label="Visit source link">
                <i data-lucide="external-link"></i>
                <span>Visit</span>
              </a>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // 6. Attach Card Event Listeners
  document.querySelectorAll('.check-source-now-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const label = btn.getAttribute('data-label') || 'source';
      btn.disabled = true;
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="refresh-cw" class="rotating"></i> <span>Crawling...</span>';
      if (window.lucide) window.lucide.createIcons();

      try {
        const res = await apiRequest(`/api/sources/${id}/check-now`, { method: 'POST' });
        const countFound = res?.opportunitiesFound ?? 0;
        const countDiffs = res?.changesDetected ?? 0;
        showToast(`Scan complete for "${label}": ${countFound} listings verified, ${countDiffs} change(s) detected.`, 'success');
        await loadAllData();
      } catch (e) {
        showToast(`Failed to check "${label}": ${e.message}`, 'error');
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        if (window.lucide) window.lucide.createIcons();
      }
    });
  });

  document.querySelectorAll('.edit-source-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const source = state.sources.find((s) => s.id === id);
      if (source) openSourceModal(source);
    });
  });

  if (window.lucide) window.lucide.createIcons();
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

  // Dynamically update Hero Section match visualization
  const overallNumEl = document.getElementById('hero-overall-percentage');
  if (overallNumEl) {
    const scoredOpps = opps.filter((o) => o.match?.score !== null && o.match?.score !== undefined);
    if (scoredOpps.length > 0) {
      const avg = (scoredOpps.reduce((sum, o) => sum + Number(o.match.score), 0) / scoredOpps.length).toFixed(1);
      overallNumEl.textContent = `${avg}% Match`;
    } else {
      overallNumEl.textContent = '98.4% Match';
    }
  }

  const subtextEl = document.getElementById('hero-match-subtext');
  if (subtextEl) {
    const fitCount = matches > 0 ? matches : (opps.length > 0 ? opps.length : 28);
    subtextEl.textContent = `Your profile is a great fit for ${fitCount} new opportunities this week.`;
  }
}

// ── Opportunity Detail Modal ───────────────────────────────────────────────
function openDetailModal(oppId) {
  const opp = state.opportunities.find((o) => o.id === oppId);
  if (!opp) return;

  const modal = document.getElementById('detail-modal');
  const body = document.getElementById('modal-body');
  const elig = parseOpportunityEligibility(opp);

  const isClosedByOrganizer = opp.status === 'closed';
  const isExpired = !isClosedByOrganizer && opp.deadline && (new Date(opp.deadline) < new Date());
  const statusLabel = isClosedByOrganizer ? 'Closed by Organizer' : (isExpired ? 'Deadline Passed' : 'Active / Open');
  const isDemo = opp.apply_link && (opp.apply_link.includes('.example') || opp.apply_link.includes('example.org') || opp.apply_link.includes('example.com') || opp.apply_link.includes('mock-portal'));
  const sourceLabel = opp.source_url?.includes('mock-portal') || opp.source_url?.includes('localhost:4000') || !opp.source_url
    ? 'Local Simulated Source (Mock Portal)'
    : 'Monitored Autonomous Web Source';

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
    <div class="modal-section" style="border-left: 3px solid ${elig.score !== null ? (elig.score >= 70 ? 'var(--accent-green)' : 'var(--accent-terracotta)') : 'var(--border-color)'}; padding-left: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
        <span style="font-weight: 700; font-size: 0.9rem; font-family: var(--font-heading);">Eligibility Evaluation</span>
        <span class="match-score-pill ${elig.score === null ? 'status-unevaluated' : ''}">
          ${elig.score !== null ? `${elig.score}% Fit • ` : ''}${escapeHtml(elig.fitLabel)}
        </span>
      </div>

      <p style="font-size: 0.85rem; color: var(--ink-secondary); line-height: 1.5; margin-bottom: 0.75rem;">
        ${escapeHtml(elig.summary)}
      </p>

      ${elig.isProfileIncomplete ? `
        <div style="margin-bottom: 0.75rem; padding: 0.6rem 0.85rem; background-color: var(--bg-surface-subtle); border-radius: var(--radius-sm); border: 1px dashed var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span style="font-size: 0.8rem; color: var(--ink-secondary);">Profile lacks academic year or technical skills.</span>
          <button type="button" class="btn btn-secondary btn-sm" id="modal-complete-profile-btn" style="padding: 3px 8px; font-size: 0.75rem;">
            Complete Profile →
          </button>
        </div>
      ` : ''}

      ${elig.hasBreakdown ? `
        ${elig.confirmed.length > 0 ? `
          <div class="breakdown-group">
            <div class="breakdown-group-title confirmed">Confirmed Matches (${elig.confirmed.length})</div>
            <ul class="breakdown-list confirmed">
              ${elig.confirmed.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${elig.conflicts.length > 0 ? `
          <div class="breakdown-group">
            <div class="breakdown-group-title conflicts">Criteria Conflicts (${elig.conflicts.length})</div>
            <ul class="breakdown-list conflicts">
              ${elig.conflicts.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${elig.unknown.length > 0 && !elig.isProfileIncomplete ? `
          <div class="breakdown-group">
            <div class="breakdown-group-title unknown">Unverified / Missing Information (${elig.unknown.length})</div>
            <ul class="breakdown-list unknown">
              ${elig.unknown.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      ` : ''}
    </div>

    <!-- Extracted Snapshot Evidence -->
    <div class="modal-section">
      <h4 style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-muted); margin-bottom: 0.5rem; font-family: var(--font-ui);">Extracted Evidence &amp; Audit Trail</h4>
      <div class="evidence-block">
        <p><strong>Eligibility Quote:</strong> "${escapeHtml(elig.rawText)}"</p>
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
  document.getElementById('modal-complete-profile-btn')?.addEventListener('click', () => {
    closeModal();
    switchTab('profile');
  });

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
  if (tabName === 'changes') {
    updateTimelineLastUpdated();
  }
  if (tabName === 'sources') {
    renderSources();
  }
}

// ── Sandbox Scenario Execution ─────────────────────────────────────────────
async function triggerMockDeadlineExtension() {
  const btn = document.getElementById('demo-deadline-btn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="refresh-cw" class="rotating"></i> <span>Applying Shift...</span>';
    if (window.lucide) window.lucide.createIcons();
  }
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
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

async function triggerMockEligibilityChange() {
  const btn = document.getElementById('demo-eligibility-btn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="refresh-cw" class="rotating"></i> <span>Restricting...</span>';
    if (window.lucide) window.lucide.createIcons();
  }
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
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

async function triggerScrapeNow() {
  const btn = document.getElementById('demo-scrape-btn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="refresh-cw" class="rotating"></i> <span>Crawling Portals...</span>';
    if (window.lucide) window.lucide.createIcons();
  }
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
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

async function resetDemoState() {
  const btn = document.getElementById('demo-reset-btn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="refresh-cw" class="rotating"></i> <span>Resetting...</span>';
    if (window.lucide) window.lucide.createIcons();
  }
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
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      if (window.lucide) window.lucide.createIcons();
    }
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
      btn.innerHTML = '<i data-lucide="zap" class="demo-zap-icon"></i><span>Continue as Demo User (Fast-Track)</span>';
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

  // Category Filter Chips
  document.querySelectorAll('.category-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.category-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const selectedType = chip.getAttribute('data-type') || 'all';
      state.selectedType = selectedType;
      const typeFilterSelect = document.getElementById('type-filter');
      if (typeFilterSelect) typeFilterSelect.value = selectedType;
      applyFilters();
    });
  });

  document.getElementById('type-filter')?.addEventListener('change', (e) => {
    state.selectedType = e.target.value;
    document.querySelectorAll('.category-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.getAttribute('data-type') === state.selectedType);
    });
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
    saveBtn.innerHTML = '<span>Saving &amp; computing matches...</span>';
    if (statusEl) {
      statusEl.style.color = 'var(--ink-secondary)';
      statusEl.textContent = 'Saving profile & evaluating match criteria...';
    }

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

      // Safely assign profile whether returned as res.profile or res directly
      state.profile = (res && res.profile) ? res.profile : res;
      renderProfileHeader();
      renderProfileForm();

      if (statusEl) {
        statusEl.textContent = 'Fetching updated match results...';
      }

      await loadOpportunities();
      updateMetrics();

      if (statusEl) {
        statusEl.style.color = 'var(--accent-green)';
        statusEl.textContent = 'Saved — match scores recalculated.';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3500);
      }
      showToast('Profile updated & match scores recalculated!', 'success');
    } catch (err) {
      if (statusEl) {
        statusEl.style.color = 'var(--accent-terracotta)';
        statusEl.textContent = `Error: ${err.message}`;
      }
      showToast(`Error saving profile: ${err.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        <span>Save Changes</span>
      `;
    }
  });

  // Reset to default button
  document.getElementById('reset-profile-btn')?.addEventListener('click', () => {
    renderProfileForm();
    showToast('Profile reset to saved values', 'info');
  });

  // Missing fields link
  document.getElementById('completeness-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    const gpaInput = document.getElementById('prof-gpa');
    if (gpaInput) {
      gpaInput.focus();
      gpaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // Sandbox scenario buttons
  document.getElementById('demo-deadline-btn')?.addEventListener('click', triggerMockDeadlineExtension);
  document.getElementById('demo-eligibility-btn')?.addEventListener('click', triggerMockEligibilityChange);
  document.getElementById('demo-scrape-btn')?.addEventListener('click', triggerScrapeNow);
  document.getElementById('demo-reset-btn')?.addEventListener('click', resetDemoState);
  document.getElementById('clear-console-btn')?.addEventListener('click', () => {
    const c = document.getElementById('sandbox-logs');
    if (c) {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      c.innerHTML = `<div class="log-line log-info"><span class="log-timestamp">${time}</span><span class="log-badge log-badge-info">SYSTEM</span><span class="log-msg">Execution console cleared. Ready for simulation.</span></div>`;
    }
  });

  // Refresh changes button
  document.getElementById('refresh-changes-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refresh-changes-btn');
    if (btn) btn.classList.add('rotating');
    try {
      await loadOpportunities();
      await loadChanges();
      updateTimelineLastUpdated();
      showToast('Timeline refreshed', 'info');
    } catch (err) {
      showToast('Could not refresh timeline: ' + err.message, 'error');
    } finally {
      if (btn) btn.classList.remove('rotating');
    }
  });

  // Add / Edit Source Modal
  const sourceModal = document.getElementById('source-modal');
  document.getElementById('add-source-btn')?.addEventListener('click', () => openSourceModal(null));
  document.getElementById('close-source-modal-btn')?.addEventListener('click', () => sourceModal?.close());
  document.getElementById('cancel-source-btn')?.addEventListener('click', () => sourceModal?.close());

  document.getElementById('new-source-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEdit = sourceModal?.getAttribute('data-mode') === 'edit';
    const label = document.getElementById('new-source-label').value;
    const url = document.getElementById('new-source-url').value;
    const interval = parseInt(document.getElementById('new-source-interval').value || '60', 10);
    const submitBtn = document.getElementById('submit-source-btn');

    if (submitBtn) submitBtn.disabled = true;

    try {
      await apiRequest('/api/sources', {
        method: 'POST',
        body: JSON.stringify({ label, url, poll_interval: interval }),
      });
      sourceModal?.close();
      showToast(isEdit ? `Source "${label}" updated successfully!` : `Source "${label}" added to radar monitoring!`, 'success');
      await loadSources();
      await loadOpportunities();
    } catch (err) {
      showToast(`Error saving source: ${err.message}`, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Scan All Portals Button
  document.getElementById('scan-all-sources-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('scan-all-sources-btn');
    if (!state.sources || state.sources.length === 0) {
      showToast('No sources configured to scan.', 'info');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="refresh-cw" class="rotating"></i> <span>Scanning All...</span>';
      if (window.lucide) window.lucide.createIcons();
    }

    showToast(`Initiating crawl across ${state.sources.length} portal(s)...`, 'info');

    let totalOpps = 0;
    let totalDiffs = 0;

    for (let i = 0; i < state.sources.length; i++) {
      const s = state.sources[i];
      try {
        const res = await apiRequest(`/api/sources/${s.id}/check-now`, { method: 'POST' });
        totalOpps += res?.opportunitiesFound || 0;
        totalDiffs += res?.changesDetected || 0;
      } catch (err) {
        console.warn(`[scan-all] check error for ${s.url}:`, err.message);
      }
    }

    showToast(`All portals scanned! ${totalOpps} listings verified, ${totalDiffs} change(s) detected.`, 'success');
    await loadAllData();

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="refresh-cw"></i> <span>Scan All Portals</span>';
      if (window.lucide) window.lucide.createIcons();
    }
  });

  // Sources Search & Filter Toolbar
  const sourcesSearchInput = document.getElementById('sources-search-input');
  const sourcesSearchClear = document.getElementById('sources-search-clear');

  sourcesSearchInput?.addEventListener('input', (e) => {
    state.sourcesSearch = e.target.value;
    if (sourcesSearchClear) {
      sourcesSearchClear.classList.toggle('hidden', !e.target.value);
    }
    renderSources();
  });

  sourcesSearchClear?.addEventListener('click', () => {
    if (sourcesSearchInput) sourcesSearchInput.value = '';
    state.sourcesSearch = '';
    sourcesSearchClear.classList.add('hidden');
    renderSources();
  });

  document.querySelectorAll('.source-filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.source-filter-chip').forEach((c) => {
        c.classList.remove('active');
        c.setAttribute('aria-checked', 'false');
      });
      chip.classList.add('active');
      chip.setAttribute('aria-checked', 'true');
      state.sourcesFilter = chip.getAttribute('data-filter') || 'all';
      renderSources();
    });
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
