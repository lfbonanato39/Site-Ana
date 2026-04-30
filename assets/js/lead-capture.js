// ============================================================
// Lead Capture & Tracking — Site Dra. Ana Laura
// IDs reais já plugados — não substituir por placeholders.
// GA4: G-V80CXY51QP   ·   Google Ads: AW-18126057890
// Conversions: WhatsApp Click (tANcCOfHnaQcEKLjlsND),
//              Email Click  (pwkGCOrHnaQcEKLjlsND),
//              Qualified Lead (bSbqCOTHnaQcEKLjlsND).
// Webhook do Apps Script: ver SHEETS-SETUP.md
// ============================================================

const LEAD_CONFIG = {
  WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbwQeotC4w_CEfpCsBgnH1-jx0VXJjzOg10vQh3wg8PIT6tsWBVsV3WdDN5aTKsUHvcz/exec',
  WHATSAPP_NUMBER: '5531971546161',
  WHATSAPP_MESSAGE_MAIN: 'Olá Dra. Ana Laura, acabei de preencher o formulário no site e gostaria de agendar uma consulta.',
  WHATSAPP_MESSAGE_EXIT: 'Olá Dra. Ana Laura, deixei meu contato no site e gostaria de conversar sobre uma consulta.',
  EXIT_INTENT_MOBILE_TIMEOUT_MS: 45000,
  EXIT_INTENT_DESKTOP_ARM_MS: 8000
};

// Limpeza retroativa do skip antigo (remover este bloco após 2026-05-28)
try { localStorage.removeItem('preform_skip_until'); } catch(e) {}

window.dataLayer = window.dataLayer || [];

// ----- Tracking helpers -----------------------------------------

function track(event, params = {}) {
  const payload = { event, ...params, timestamp: Date.now() };
  window.dataLayer.push(payload);
  if (typeof gtag === 'function') gtag('event', event, params);
}

async function sha256(input) {
  if (!input || !crypto?.subtle) return undefined;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.trim().toLowerCase()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Google Ads conversion + Enhanced Conversions (hashed PII)
async function conversion(label, value = 0, userData) {
  if (typeof gtag !== 'function') return;
  const payload = { send_to: 'AW-18126057890/' + label, value: value, currency: 'BRL' };
  if (userData && (userData.email || userData.phone)) {
    const ud = {};
    if (userData.email) ud.sha256_email_address = await sha256(userData.email);
    if (userData.phone) ud.sha256_phone_number = await sha256(userData.phone.replace(/\D/g, ''));
    payload.user_data = ud;
  }
  gtag('event', 'conversion', payload);
}

function getButtonLocation(el) {
  if (!el) return 'unknown';
  const target = el.closest('[data-button-location]');
  return target ? target.getAttribute('data-button-location') : 'unknown';
}

// ----- UTM persistence ------------------------------------------

function getUTMs() {
  const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid'];
  const STORAGE_KEY = 'lead_attribution';
  const params = new URLSearchParams(window.location.search);
  const fromUrl = {};
  let hasNewData = false;
  KEYS.forEach(k => {
    const v = params.get(k);
    if (v) { fromUrl[k] = v; hasNewData = true; }
  });
  if (hasNewData) {
    const merged = KEYS.reduce((acc, k) => ({ ...acc, [k]: fromUrl[k] || '' }), {});
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch(e) {}
    return merged;
  }
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return KEYS.reduce((acc, k) => ({ ...acc, [k]: parsed[k] || '' }), {});
    }
  } catch(e) {}
  return KEYS.reduce((acc, k) => ({ ...acc, [k]: '' }), {});
}

// First-touch attribution: lock UTMs into sessionStorage on landing
getUTMs();

// ----- Phone mask -----------------------------------------------

function applyPhoneMask(value) {
  const digits = (value || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
}

function attachPhoneMask(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const cursorAtEnd = input.selectionStart === input.value.length;
    input.value = applyPhoneMask(input.value);
    if (cursorAtEnd) {
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch(e) {}
    }
  });
}

function phoneDigits(value) { return (value || '').replace(/\D/g, ''); }
function phoneRaw(value) {
  const d = phoneDigits(value);
  if (!d) return '';
  return d.startsWith('55') ? d : '55' + d;
}
function isValidPhone(value) { return phoneDigits(value).length >= 10; }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || ''); }

// ----- Inline error helpers -------------------------------------

function setFieldError(input, message) {
  if (!input) return;
  const wrapper = input.closest('label, .preform__field, .preform__fieldset, .exit-intent__field') || input.parentElement;
  if (!wrapper) return;
  let err = wrapper.querySelector('.field-error');
  if (!err) {
    err = document.createElement('span');
    err.className = 'field-error';
    err.setAttribute('role', 'alert');
    wrapper.appendChild(err);
  }
  err.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  wrapper.classList.add('has-error');
}

function clearFieldError(input) {
  if (!input) return;
  const wrapper = input.closest('label, .preform__field, .preform__fieldset, .exit-intent__field') || input.parentElement;
  if (!wrapper) return;
  const err = wrapper.querySelector('.field-error');
  if (err) err.remove();
  input.removeAttribute('aria-invalid');
  wrapper.classList.remove('has-error');
}

// ----- Sheets webhook -------------------------------------------
// Apps Script aceita application/x-www-form-urlencoded via sendBeacon.
// Não bloqueia o usuário — fire-and-forget com fallback fetch keepalive.

function sendToSheets(data) {
  if (!LEAD_CONFIG.WEBHOOK_URL) return false;
  try {
    const payload = new URLSearchParams({
      timestamp: new Date().toISOString(),
      timezone: 'America/Sao_Paulo',
      form_type: data.form_type || '',
      submission_type: data.submission_type || '',
      button_location: data.button_location || '',
      name: data.name || '',
      whatsapp: data.whatsapp || '',
      whatsapp_raw: data.whatsapp_raw || '',
      email: data.email || '',
      reason: data.reason || '',
      note: data.note || '',
      source_url: location.href,
      referrer: document.referrer || '',
      target: data.target || '',
      utm_source: data.utm_source || '',
      utm_medium: data.utm_medium || '',
      utm_campaign: data.utm_campaign || '',
      utm_content: data.utm_content || '',
      utm_term: data.utm_term || '',
      gclid: data.gclid || '',
      user_agent: navigator.userAgent
    });
    const blob = new Blob([payload.toString()], { type: 'application/x-www-form-urlencoded;charset=UTF-8' });
    if (navigator.sendBeacon && navigator.sendBeacon(LEAD_CONFIG.WEBHOOK_URL, blob)) return true;
    fetch(LEAD_CONFIG.WEBHOOK_URL, {
      method: 'POST',
      body: payload,
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
    }).catch(() => {});
    return true;
  } catch(e) {
    console.error('[Lead capture] sendBeacon failed', e);
    return false;
  }
}

// ============================================================
// Page-level UI handlers (extracted from old inline script)
// ============================================================

(function setupHeaderState() {
  const header = document.getElementById('siteHeader');
  if (!header) return;
  const onScroll = () => {
    if (window.scrollY > 20) header.classList.add('is-scrolled');
    else header.classList.remove('is-scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

(function setupRevealOnScroll() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  els.forEach((el) => io.observe(el));
})();

(function setupFaqAccordion() {
  document.querySelectorAll('.faq__item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const wasOpen = item.classList.contains('is-open');
      document.querySelectorAll('.faq__item').forEach((i) => {
        i.classList.remove('is-open');
        i.querySelector('.faq__q')?.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        item.classList.add('is-open');
        item.querySelector('.faq__q')?.setAttribute('aria-expanded', 'true');
      }
    });
  });
})();

(function setupMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  const navToggle = document.getElementById('navToggle');
  if (!menu || !navToggle) return;
  const openMenu = () => {
    menu.classList.add('is-open');
    navToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    setTimeout(() => menu.querySelector('a, button')?.focus(), 50);
  };
  const closeMenu = () => {
    menu.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };
  navToggle.addEventListener('click', openMenu);
  document.getElementById('mobileClose')?.addEventListener('click', () => { closeMenu(); navToggle.focus(); });
  menu.querySelectorAll('[data-close]').forEach((a) => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) {
      closeMenu();
      navToggle.focus();
    }
  });
})();

(function setupTestimonialsCarousel() {
  const grid = document.querySelector('.praise__grid');
  if (!grid) return;
  let timer = null;
  let paused = false;
  const cards = () => grid.querySelectorAll('.testimonial');
  const advance = () => {
    if (paused) return;
    const cs = cards();
    if (!cs.length) return;
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.columnGap || style.gap || 16);
    const cardW = cs[0].getBoundingClientRect().width + gap;
    const maxScroll = grid.scrollWidth - grid.clientWidth - 4;
    let next = grid.scrollLeft + cardW;
    if (next > maxScroll) next = 0;
    grid.scrollTo({ left: next, behavior: 'smooth' });
  };
  const start = () => { stop(); timer = setInterval(advance, 4200); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  grid.addEventListener('pointerdown', () => { paused = true; });
  grid.addEventListener('pointerup',   () => { setTimeout(() => paused = false, 3000); });
  grid.addEventListener('mouseenter',  () => { paused = true; });
  grid.addEventListener('mouseleave',  () => { paused = false; });
  grid.addEventListener('touchstart',  () => { paused = true; },                    { passive: true });
  grid.addEventListener('touchend',    () => { setTimeout(() => paused = false, 3000); }, { passive: true });
  start();
})();

// ============================================================
// Tracking — clicks, scroll depth, engagement
// ============================================================

// WhatsApp clicks — primary lead intent (existing event, preserved)
document.querySelectorAll('a[href*="wa.me"]').forEach((a) => {
  a.addEventListener('click', () => {
    const section = a.closest('section, header, footer, .preform, .exit-intent');
    const sectionId = section ? (section.id || section.className.split(' ')[0]) : 'unknown';
    const label = (a.textContent || '').trim().slice(0, 60);
    const buttonLocation = getButtonLocation(a);
    track('whatsapp_click', { source: sectionId, label, button_location: buttonLocation });
    if (typeof gtag === 'function') {
      gtag('event', 'conversion', {
        'send_to': 'AW-18068581578/se8dCOzk66QcEMrZ4qdD',
        'value': 15.00,
        'currency': 'BRL'
      });
    }
    conversion('tANcCOfHnaQcEKLjlsND', 15); // WhatsApp Click — R$ 15 proxy value
  });
});

// Email clicks — secondary lead (existing event, preserved)
document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
  a.addEventListener('click', () => {
    track('email_click', { source: a.closest('section, footer')?.id || 'unknown' });
    if (typeof gtag === 'function') {
      gtag('event', 'conversion', {
        'send_to': 'AW-18068581578/VG8oCMOe7KQcEMrZ4qdD',
        'value': 5.00,
        'currency': 'BRL'
      });
    }
    conversion('pwkGCOrHnaQcEKLjlsND', 5); // Email Click — R$ 5 proxy value
  });
});

// Engagement: scroll depth (25/50/75/100)
(function setupScrollDepth() {
  const marks = [25, 50, 75, 100];
  const fired = new Set();
  const onScroll = () => {
    const h = document.documentElement;
    const pct = Math.round(((h.scrollTop + window.innerHeight) / h.scrollHeight) * 100);
    marks.forEach((m) => {
      if (pct >= m && !fired.has(m)) {
        fired.add(m);
        track('scroll_depth', { percent: m });
      }
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// Engagement: meaningful time-on-page (30s)
setTimeout(() => track('engaged_30s'), 30000);

// page_view_custom — complementa o page_view automático do GA4
(function pushPageViewCustom() {
  const utms = getUTMs();
  window.dataLayer.push({
    event: 'page_view_custom',
    page_path: window.location.pathname,
    has_gclid: !!utms.gclid,
    utm_source: utms.utm_source || '',
    utm_campaign: utms.utm_campaign || '',
    timestamp: Date.now()
  });
})();

// ============================================================
// Pre-form modal — every WhatsApp click goes through this:
//   click → modal → POST to Google Sheets → redirect to WhatsApp
// ============================================================

(function setupPreformModal() {
  const modal = document.getElementById('preformModal');
  if (!modal) return;
  const form = modal.querySelector('[data-preform-form]');
  if (!form) return;

  const nameInput = form.querySelector('[name="preformName"]');
  const phoneInput = form.querySelector('[name="preformPhone"]');
  const emailInput = form.querySelector('[name="preformEmail"]');
  const noteInput = form.querySelector('[name="preformNote"]');
  const consentInput = form.querySelector('[name="preformConsent"]');
  const submitBtn = form.querySelector('[data-preform-submit]') || form.querySelector('[type="submit"]');
  const skipBtn = modal.querySelector('[data-preform-skip]');
  const closeBtn = modal.querySelector('[data-preform-close]');

  attachPhoneMask(phoneInput);

  let pendingHref = null;
  let lastTrigger = null;
  let lastButtonLocation = 'unknown';

  // Submit button gated by LGPD consent
  const updateSubmitState = () => {
    if (!submitBtn || !consentInput) return;
    submitBtn.disabled = !consentInput.checked;
  };
  if (consentInput) {
    consentInput.addEventListener('change', updateSubmitState);
    updateSubmitState();
  }

  // Live validation: clear errors as user types, validate format on blur
  if (nameInput) nameInput.addEventListener('input', () => clearFieldError(nameInput));
  if (phoneInput) {
    phoneInput.addEventListener('input', () => clearFieldError(phoneInput));
    phoneInput.addEventListener('blur', () => {
      if (phoneInput.value && !isValidPhone(phoneInput.value)) {
        setFieldError(phoneInput, 'Informe um número de WhatsApp válido com DDD');
      }
    });
  }
  if (emailInput) {
    emailInput.addEventListener('input', () => clearFieldError(emailInput));
    emailInput.addEventListener('blur', () => {
      if (emailInput.value && !isValidEmail(emailInput.value)) {
        setFieldError(emailInput, 'Informe um e-mail válido');
      }
    });
  }
  form.querySelectorAll('[name="preformReason"]').forEach((r) => {
    r.addEventListener('change', () => {
      const fs = form.querySelector('.preform__fieldset');
      if (fs) {
        const err = fs.querySelector('.field-error');
        if (err) err.remove();
        fs.classList.remove('has-error');
      }
    });
  });

  function open(href, trigger, location) {
    pendingHref = href;
    lastTrigger = trigger || null;
    lastButtonLocation = location || 'unknown';
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    track('preform_open', { from: href, button_location: lastButtonLocation });
    setTimeout(() => nameInput?.focus(), 50);
  }

  function close() {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
    lastTrigger = null;
  }

  // ESC + focus trap
  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('is-open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = modal.querySelectorAll('input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  closeBtn?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // "Prefiro escrever direto" — sem persistência. Abre WhatsApp nesta sessão e fecha.
  // Ainda registra o clique no Sheets (submission_type: skipped).
  skipBtn?.addEventListener('click', () => {
    const base = pendingHref || `https://wa.me/${LEAD_CONFIG.WHATSAPP_NUMBER}`;
    sendToSheets({
      form_type: 'main',
      submission_type: 'skipped',
      button_location: lastButtonLocation,
      target: base,
      ...getUTMs()
    });
    track('preform_submit', {
      message_length: 0, persisted: true,
      submission_type: 'skipped',
      button_location: lastButtonLocation
    });
    setTimeout(() => { window.open(base, '_blank', 'noopener'); close(); }, 60);
  });

  function validate() {
    let firstInvalid = null;
    [nameInput, phoneInput, emailInput].forEach((inp) => clearFieldError(inp));

    if (!nameInput.value.trim()) {
      setFieldError(nameInput, 'Informe seu nome completo');
      firstInvalid = firstInvalid || nameInput;
    }
    if (!phoneInput.value.trim() || !isValidPhone(phoneInput.value)) {
      setFieldError(phoneInput, 'Informe um número de WhatsApp válido com DDD');
      firstInvalid = firstInvalid || phoneInput;
    }
    const emailVal = emailInput.value.trim();
    if (!emailVal) {
      setFieldError(emailInput, 'Informe seu e-mail');
      firstInvalid = firstInvalid || emailInput;
    } else if (!isValidEmail(emailVal)) {
      setFieldError(emailInput, 'Informe um e-mail válido');
      firstInvalid = firstInvalid || emailInput;
    }
    if (!form.querySelector('[name="preformReason"]:checked')) {
      const fs = form.querySelector('.preform__fieldset');
      if (fs) {
        let err = fs.querySelector('.field-error');
        if (!err) {
          err = document.createElement('span');
          err.className = 'field-error';
          err.setAttribute('role', 'alert');
          fs.appendChild(err);
        }
        err.textContent = 'Selecione um tema para o contato';
        fs.classList.add('has-error');
      }
      firstInvalid = firstInvalid || form.querySelector('[name="preformReason"]');
    }
    if (firstInvalid && typeof firstInvalid.focus === 'function') firstInvalid.focus();
    return !firstInvalid;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (consentInput && !consentInput.checked) return;
    if (!validate()) return;

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const email = emailInput.value.trim();
    const reason = form.querySelector('[name="preformReason"]:checked')?.value || '';
    const note = (noteInput?.value || '').trim().slice(0, 500);

    sessionStorage.setItem('lead_submitted', 'true');

    const utms = getUTMs();
    const base = pendingHref || `https://wa.me/${LEAD_CONFIG.WHATSAPP_NUMBER}`;
    const data = {
      form_type: 'main',
      submission_type: 'form',
      button_location: lastButtonLocation,
      name,
      whatsapp: phone,
      whatsapp_raw: phoneRaw(phone),
      email,
      reason,
      note,
      target: base,
      ...utms
    };
    const persisted = sendToSheets(data);

    track('preform_qualified_lead', {
      has_name: !!name, has_email: !!email, has_phone: !!phone,
      reason: reason || 'unspecified',
      note_len: note.length,
      button_location: lastButtonLocation
    });
    if (typeof gtag === 'function') {
      gtag('event', 'conversion', {
        'send_to': 'AW-18068581578/2J12CJD2hKUcEMrZ4qdD',
        'value': 35.00,
        'currency': 'BRL'
      });
    }
    conversion('bSbqCOTHnaQcEKLjlsND', 50, { email, phone });

    const sections = [
      'Olá, Dra. Ana Laura.',
      `Meu nome é *${name}*.`,
      `WhatsApp: ${phone}`,
      `E-mail: ${email}`,
      `Gostaria de conversar sobre:\n*${reason}*`,
      note ? `Observação:\n${note}` : ''
    ].filter(Boolean);
    const message = sections.join('\n\n');

    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}text=${encodeURIComponent(message)}`;

    track('preform_submit', {
      message_length: message.length,
      persisted,
      submission_type: 'form',
      button_location: lastButtonLocation,
      tema: reason
    });

    setTimeout(() => { window.open(url, '_blank', 'noopener'); close(); }, 60);
  });

  // Intercept ALL wa.me clicks, but skip any link inside the exit-intent
  // (the exit-intent now has its own form, no direct wa.me link)
  document.querySelectorAll('a[href*="wa.me"]').forEach((a) => {
    if (a.closest('.exit-intent')) return;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const location = getButtonLocation(a);
      track('whatsapp_intent', { button_location: location });
      open(a.href, a, location);
    });
  });

  window.__leadCapture = window.__leadCapture || {};
  window.__leadCapture.isMainModalOpen = () => modal.classList.contains('is-open');
})();

// ============================================================
// Exit-intent — short capture form (Name + WhatsApp)
// Triggers: desktop mouseout (top edge) OR mobile 45s inactivity.
// Suppressed if user already saw it OR already submitted main form.
// ============================================================

(function setupExitIntent() {
  const ex = document.getElementById('exitIntent');
  if (!ex) return;

  const SEEN_KEY = 'exit_intent_seen';
  const SUBMITTED_KEY = 'lead_submitted';

  const alreadyShown = () => {
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch(e) { return false; }
  };
  const alreadySubmitted = () => {
    try { return sessionStorage.getItem(SUBMITTED_KEY) === 'true'; } catch(e) { return false; }
  };
  const markShown = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch(e) {} };

  if (alreadyShown() || alreadySubmitted()) return;

  const form = ex.querySelector('[data-exit-form]');
  const nameInput = form?.querySelector('[name="exitName"]');
  const phoneInput = form?.querySelector('[name="exitPhone"]');
  const continueBtn = ex.querySelector('[data-exit-continue]');
  const formPanel = ex.querySelector('[data-exit-form-panel]');
  const successPanel = ex.querySelector('[data-exit-success]');

  attachPhoneMask(phoneInput);

  let armed = false;
  let fired = false;
  let mobileTimer = null;
  setTimeout(() => { armed = true; }, LEAD_CONFIG.EXIT_INTENT_DESKTOP_ARM_MS);

  function trigger() {
    if (!armed || fired) return;
    if (alreadyShown() || alreadySubmitted()) return;
    if (window.__leadCapture && window.__leadCapture.isMainModalOpen?.()) return;
    fired = true;
    markShown();
    ex.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    track('exit_intent_shown');
    setTimeout(() => nameInput?.focus(), 50);
  }

  function close() {
    ex.classList.remove('is-open');
    document.body.style.overflow = '';
    if (mobileTimer) clearTimeout(mobileTimer);
  }

  // Desktop: cursor leaves through the top edge
  document.addEventListener('mouseout', (e) => {
    if (e.relatedTarget === null && e.clientY < 10) trigger();
  });

  // Mobile: 45s of total inactivity (no scroll/click/touch/keyboard)
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) {
    const reset = () => {
      if (mobileTimer) clearTimeout(mobileTimer);
      mobileTimer = setTimeout(trigger, LEAD_CONFIG.EXIT_INTENT_MOBILE_TIMEOUT_MS);
    };
    ['scroll', 'touchstart', 'click', 'keydown'].forEach((ev) => {
      window.addEventListener(ev, reset, { passive: true });
    });
    reset();
  }

  ex.querySelectorAll('[data-exit-close]').forEach(b => b.addEventListener('click', close));
  continueBtn?.addEventListener('click', close);
  ex.addEventListener('click', (e) => { if (e.target === ex) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ex.classList.contains('is-open')) close();
  });

  if (nameInput) nameInput.addEventListener('input', () => clearFieldError(nameInput));
  if (phoneInput) {
    phoneInput.addEventListener('input', () => clearFieldError(phoneInput));
    phoneInput.addEventListener('blur', () => {
      if (phoneInput.value && !isValidPhone(phoneInput.value)) {
        setFieldError(phoneInput, 'Informe um número válido com DDD');
      }
    });
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    let firstInvalid = null;
    if (!nameInput.value.trim()) {
      setFieldError(nameInput, 'Informe seu nome');
      firstInvalid = firstInvalid || nameInput;
    }
    if (!phoneInput.value.trim() || !isValidPhone(phoneInput.value)) {
      setFieldError(phoneInput, 'Informe um número válido com DDD');
      firstInvalid = firstInvalid || phoneInput;
    }
    if (firstInvalid) { firstInvalid.focus(); return; }

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    sessionStorage.setItem('lead_submitted', 'true');

    const utms = getUTMs();
    const target = `https://wa.me/${LEAD_CONFIG.WHATSAPP_NUMBER}`;
    sendToSheets({
      form_type: 'exit_intent',
      submission_type: 'form',
      button_location: 'exit_intent',
      name,
      whatsapp: phone,
      whatsapp_raw: phoneRaw(phone),
      email: '',
      reason: '',
      note: '',
      target,
      ...utms
    });

    track('exit_intent_submit', { button_location: 'exit_intent' });
    track('preform_qualified_lead', {
      has_name: !!name, has_email: false, has_phone: true,
      reason: 'exit_intent', note_len: 0,
      button_location: 'exit_intent'
    });
    if (typeof gtag === 'function') {
      gtag('event', 'conversion', {
        'send_to': 'AW-18068581578/2J12CJD2hKUcEMrZ4qdD',
        'value': 35.00,
        'currency': 'BRL'
      });
    }
    conversion('bSbqCOTHnaQcEKLjlsND', 50, { phone });

    if (formPanel) formPanel.hidden = true;
    if (successPanel) successPanel.hidden = false;

    const url = `${target}?text=${encodeURIComponent(LEAD_CONFIG.WHATSAPP_MESSAGE_EXIT)}`;
    setTimeout(() => { window.open(url, '_blank', 'noopener'); }, 60);
    setTimeout(close, 3000);
  });
})();

// ============================================================
// Cookie banner — LGPD; drives Google Consent Mode v2
// ============================================================

(function setupCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  if (!banner) return;
  const KEY = 'cookie_consent_v1';
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e) {}
  if (!saved) setTimeout(() => banner.removeAttribute('hidden'), 800);
  const apply = (choice) => {
    const update = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
    if (choice === 'analytics') update.analytics_storage = 'granted';
    if (choice === 'all') {
      update.ad_storage = 'granted';
      update.ad_user_data = 'granted';
      update.ad_personalization = 'granted';
      update.analytics_storage = 'granted';
    }
    if (typeof gtag === 'function') gtag('consent', 'update', update);
    localStorage.setItem(KEY, JSON.stringify({ choice, ts: Date.now() }));
    track('cookie_consent', { choice });
    banner.setAttribute('hidden', '');
  };
  banner.querySelectorAll('[data-cookie]').forEach((b) => {
    b.addEventListener('click', () => apply(b.getAttribute('data-cookie')));
  });
})();
