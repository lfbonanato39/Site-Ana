/* =========================================================================
 *  Site Dra. Ana Laura — Mini-landing modal (Entrega 2)
 *
 *  Intercepta cliques em [data-wa-direct] no index.html e captura o WhatsApp
 *  do usuário ANTES de redirecionar pro wa.me. Insere 1 registro em
 *  public.whatsapp_intents (anon RLS OK) e dispara GA4 + conversão Ads.
 *
 *  Comportamento:
 *  - Modal criado dinamicamente no DOMContentLoaded
 *  - Dedupe por sessão: se 'wa_phone_submitted' existe, abre wa.me direto
 *  - Insert fire-and-forget via fetch keepalive (mesma estratégia do
 *    sendBeacon usado pelo Google Sheets em lead-capture.js)
 *  - GA4 event 'whatsapp_intent' + Ads conversion(15) disparam NO SUBMIT
 *    (a conversion no click foi desativada em lead-capture.js para
 *    [data-wa-direct] — evita contagem dupla)
 *
 *  Falha silenciosa em qualquer erro. Nunca quebra a navegação.
 *
 *  Dependências:
 *  - assets/js/tracking.js (Entrega 1) — popula sessionStorage com
 *    'tracking_session_id' e 'tracking_params' (gclid/utms)
 *  - assets/js/lead-capture.js — expõe window.track() e window.conversion()
 *    via funções top-level (fallback gtag direto se indisponível)
 * ========================================================================= */
(function () {
  'use strict';

  // ============================== CONFIG ==================================
  // Anon key duplicada (não importa de tracking.js — IIFE privada).
  // É pública por design — RLS protege os dados. Mesma chave da Entrega 1.
  var SUPABASE_URL      = 'https://ywvqzogdxhnrcdnflfff.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3dnF6b2dkeGhucmNkbmZsZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Njk2MTMsImV4cCI6MjA5NDM0NTYxM30.RVTJi47PdqjMO5rh38_dyDkcP3IblTgNJLjBjBRWO7I';

  var INTENTS_ENDPOINT = SUPABASE_URL + '/rest/v1/whatsapp_intents';

  // Identificadores Ads/GA4 — mesmos usados em lead-capture.js
  var ADS_CONVERSION_LABEL = 'tANcCOfHnaQcEKLjlsND'; // WhatsApp Click
  var ADS_CONVERSION_VALUE = 15;                     // R$ 15 proxy value

  // Número de fallback se o botão clicado não tiver href (extremo improvável)
  var WA_FALLBACK = 'https://wa.me/5531971546161';

  // ============================== HELPERS =================================
  function safeGetSession(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSetSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) {}
  }

  function getTrackingParams() {
    try {
      return JSON.parse(safeGetSession('tracking_params') || '{}') || {};
    } catch (e) {
      return {};
    }
  }
  function getSessionId() {
    return safeGetSession('tracking_session_id') || null;
  }

  // Mesma máscara do lead-capture.js — duplicada para evitar ordering dep.
  function applyPhoneMask(value) {
    var d = (value || '').replace(/\D/g, '').slice(0, 11);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function phoneDigits(value) { return (value || '').replace(/\D/g, ''); }

  // 10 a 13 dígitos (DDD+8, DDD+9, com 55, com +55)
  function isValidPhone(value) {
    var d = phoneDigits(value);
    return d.length >= 10 && d.length <= 13;
  }

  function getButtonLocation(el) {
    if (!el) return 'unknown';
    var target = el.closest('[data-button-location]');
    return target ? target.getAttribute('data-button-location') : 'unknown';
  }

  // ============================== TRACKING ================================
  function fireGA4(eventName, params) {
    try {
      if (typeof window.track === 'function') {
        window.track(eventName, params || {});
        return;
      }
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, params || {});
      }
    } catch (e) {}
  }

  function fireAdsConversion(phoneFormatted) {
    try {
      // Preferência 1: usar conversion() do lead-capture.js (faz Enhanced
      // Conversions com phone hashed via SHA-256).
      if (typeof window.conversion === 'function') {
        window.conversion(ADS_CONVERSION_LABEL, ADS_CONVERSION_VALUE, { phone: phoneFormatted });
        return;
      }
      // Fallback: gtag direto, sem Enhanced Conversions.
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'conversion', {
          send_to: 'AW-18126057890/' + ADS_CONVERSION_LABEL,
          value: ADS_CONVERSION_VALUE,
          currency: 'BRL'
        });
      }
    } catch (e) {}
  }

  // ============================== SUPABASE INSERT =========================
  function insertWhatsappIntent(row) {
    try {
      fetch(INTENTS_ENDPOINT, {
        method: 'POST',
        keepalive: true,
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(row)
      }).catch(function () { /* fail silent */ });
    } catch (e) { /* fail silent */ }
  }

  // ============================== MODAL DOM ===============================
  function buildModalElement() {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = [
      '<div class="mini-wa" id="miniWaModal" role="dialog" aria-modal="true" aria-labelledby="miniWaTitle" aria-describedby="miniWaSubtitle" hidden>',
      '  <div class="mini-wa__overlay" data-mini-wa-close></div>',
      '  <div class="mini-wa__dialog" role="document">',
      '    <button type="button" class="mini-wa__close" data-mini-wa-close aria-label="Fechar">×</button>',
      '    <h2 class="mini-wa__title" id="miniWaTitle">Uma palavra antes de começar a conversa.</h2>',
      '    <p class="mini-wa__subtitle" id="miniWaSubtitle">Deixe seu WhatsApp e a Dra. retornará em breve.</p>',
      '    <form class="mini-wa__form" data-mini-wa-form novalidate>',
      '      <label class="mini-wa__field">',
      '        <span class="mini-wa__label">WHATSAPP</span>',
      '        <input type="tel" name="miniWaPhone" inputmode="tel" autocomplete="tel"',
      '               placeholder="(11) 98765-4321" aria-required="true" aria-describedby="miniWaError" />',
      '        <span class="mini-wa__error" id="miniWaError" role="alert"></span>',
      '      </label>',
      '      <button type="submit" class="mini-wa__submit">Continuar para WhatsApp <span class="arrow">→</span></button>',
      '    </form>',
      '  </div>',
      '</div>'
    ].join('');
    return wrapper.firstElementChild;
  }

  // ============================== BOOT ====================================
  function boot() {
    // Se já existe (defensivo contra duplo-boot), aborta
    if (document.getElementById('miniWaModal')) return;

    var modal = buildModalElement();
    document.body.appendChild(modal);

    var dialog       = modal.querySelector('.mini-wa__dialog');
    var form         = modal.querySelector('[data-mini-wa-form]');
    var phoneInput   = form.querySelector('input[name="miniWaPhone"]');
    var errorEl      = modal.querySelector('.mini-wa__error');
    var fieldEl      = modal.querySelector('.mini-wa__field');
    var closeButtons = modal.querySelectorAll('[data-mini-wa-close]');

    var pendingHref = null;
    var lastTrigger = null;
    var lastButtonLocation = 'unknown';

    // ---------- Máscara visual ----------
    phoneInput.addEventListener('input', function () {
      var cursorAtEnd = phoneInput.selectionStart === phoneInput.value.length;
      phoneInput.value = applyPhoneMask(phoneInput.value);
      if (cursorAtEnd) {
        var len = phoneInput.value.length;
        try { phoneInput.setSelectionRange(len, len); } catch (e) {}
      }
      clearError();
    });

    function setError(msg) {
      errorEl.textContent = msg;
      fieldEl.classList.add('has-error');
      phoneInput.setAttribute('aria-invalid', 'true');
    }
    function clearError() {
      errorEl.textContent = '';
      fieldEl.classList.remove('has-error');
      phoneInput.removeAttribute('aria-invalid');
    }

    // ---------- Open / Close ----------
    function open(href, trigger, location) {
      pendingHref = href || WA_FALLBACK;
      lastTrigger = trigger || null;
      lastButtonLocation = location || 'unknown';
      modal.hidden = false;
      modal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      // GA4: evento de abertura do mini-landing (paralelo ao preform_open
      // do pre-form atual — mantém consistência de telemetria)
      fireGA4('mini_landing_open', { button_location: lastButtonLocation });
      setTimeout(function () {
        try { phoneInput.focus({ preventScroll: true }); } catch (e) { phoneInput.focus(); }
      }, 50);
    }
    function close() {
      modal.classList.remove('is-open');
      modal.hidden = true;
      document.body.style.overflow = '';
      clearError();
      phoneInput.value = '';
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        try { lastTrigger.focus(); } catch (e) {}
      }
      lastTrigger = null;
    }

    // ---------- ESC + focus trap ----------
    document.addEventListener('keydown', function (e) {
      if (!modal.classList.contains('is-open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab') {
        var focusable = dialog.querySelectorAll(
          'input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // Botão X + clique no overlay
    closeButtons.forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); close(); });
    });

    // ---------- Listeners nos [data-wa-direct] ----------
    function interceptDirectButtons() {
      var buttons = document.querySelectorAll('a[href*="wa.me"][data-wa-direct]');
      buttons.forEach(function (a) {
        a.addEventListener('click', function (e) {
          // Dedupe: já capturou telefone nessa sessão? Abre wa.me direto.
          // (whatsapp_click já é disparado pelo handler em lead-capture.js.
          //  Ads conversion NÃO redispara — já foi contabilizada no 1º submit.)
          if (safeGetSession('wa_phone_submitted')) {
            return; // sem preventDefault → link abre normalmente
          }
          e.preventDefault();
          var loc = getButtonLocation(a);
          open(a.href, a, loc);
        });
      });
    }
    interceptDirectButtons();

    // ---------- Submit ----------
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = phoneInput.value;
      if (!isValidPhone(raw)) {
        setError('Informe um WhatsApp válido com DDD');
        try { phoneInput.focus(); } catch (err) {}
        return;
      }

      var phoneFormatted = applyPhoneMask(raw);
      var trackingParams = getTrackingParams();
      var sessionId = getSessionId();

      // 1. Insert no Supabase (fire-and-forget keepalive)
      insertWhatsappIntent({
        phone:           phoneFormatted,
        gclid:           trackingParams.gclid || null,
        session_id:      sessionId,
        flow_type:       'mini_landing',
        button_location: lastButtonLocation,
        notes:           null,
        click_id:        null
      });

      // 2. GA4 event
      fireGA4('whatsapp_intent', {
        button_location: lastButtonLocation,
        flow_type:       'mini_landing',
        has_gclid:       !!trackingParams.gclid
      });

      // 3. Ads conversion (Enhanced Conversions via lead-capture.js se disponível)
      fireAdsConversion(phoneFormatted);

      // 4. Marca sessão (dedupe + supressão de exit-intent)
      safeSetSession('wa_phone_submitted', phoneDigits(phoneFormatted));
      safeSetSession('lead_submitted', 'true');

      // 5. Redireciona para o href original do botão clicado (preserva
      //    a mensagem encoded no ?text=...). 60ms de buffer pra gtag
      //    flush — mesmo padrão do pre-form.
      var target = pendingHref || WA_FALLBACK;
      setTimeout(function () {
        try { window.open(target, '_blank', 'noopener'); } catch (err) {}
        close();
      }, 60);
    });

    // Expõe para debug/inspection (opcional, mesmo padrão do __leadCapture)
    window.__miniWa = {
      open: open,
      close: close,
      hasSubmitted: function () { return !!safeGetSession('wa_phone_submitted'); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
