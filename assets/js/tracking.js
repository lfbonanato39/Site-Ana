/* =========================================================================
 *  Site Dra. Ana Laura — captura de GCLID/UTMs em public.clicks (Supabase)
 *  Entrega 1 de 5 — feat/supabase-tracking
 *
 *  Características desta entrega:
 *  - Roda após DOMContentLoaded
 *  - Captura GCLID + UTMs da URL atual; persiste em sessionStorage para
 *    sobreviver à navegação interna dentro da sessão
 *  - 1 INSERT por sessionStorage session (não duplica por page view)
 *  - user_agent é gravado em forma truncada ("Mobile Chrome") para reduzir
 *    superfície de identificação (decisão LGPD/Consent Mode v2 do site)
 *  - IP NÃO é gravado pelo cliente (Supabase pode logar server-side em
 *    request logs, mas não fica em public.clicks)
 *  - Falha silenciosa em qualquer erro: nunca quebra a página, nunca mostra
 *    erro ao usuário, nunca interfere com tags do Google Ads ou GA4
 *  - Não usa window.dataLayer (isolado do tracking do Google)
 *  - Dependência: assets/js/vendor/supabase.min.js (UMD self-host,
 *    pinned a @supabase/supabase-js v2.105.4)
 * ========================================================================= */
(function () {
  'use strict';

  // ============================== CONFIG ==================================
  // ⚠️ PREENCHER antes do primeiro deploy do preview.
  // A anon key do Supabase é PÚBLICA por design — RLS protege os dados.
  // Padrão oficial Supabase para sites estáticos.
  var SUPABASE_URL      = 'https://ywvqzogdxhnrcdnflfff.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3dnF6b2dkeGhucmNkbmZsZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Njk2MTMsImV4cCI6MjA5NDM0NTYxM30.RVTJi47PdqjMO5rh38_dyDkcP3IblTgNJLjBjBRWO7I';

  // Chave da tabela no schema public
  var CLICKS_TABLE = 'clicks';

  // ============================== HELPERS =================================
  function isConfigured() {
    return (
      typeof SUPABASE_URL === 'string' &&
      typeof SUPABASE_ANON_KEY === 'string' &&
      SUPABASE_URL.indexOf('__SUPABASE_URL__') === -1 &&
      SUPABASE_ANON_KEY.indexOf('__SUPABASE_ANON_KEY__') === -1 &&
      SUPABASE_URL.length > 0 &&
      SUPABASE_ANON_KEY.length > 0
    );
  }

  function safeGetSession(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSetSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) {}
  }

  function generateUUID() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  function getOrCreateSessionId() {
    var existing = safeGetSession('tracking_session_id');
    if (existing) return existing;
    var fresh = generateUUID();
    safeSetSession('tracking_session_id', fresh);
    return fresh;
  }

  function getDeviceType() {
    try {
      return window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop';
    } catch (e) {
      return null;
    }
  }

  // Reduz o User-Agent a "<Device> <Browser>" (ex: "Mobile Chrome").
  // Sem versão de browser/SO — decisão de minimização de dado pessoal.
  function getTruncatedUA() {
    try {
      var ua = navigator.userAgent || '';
      var isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
      var deviceLabel = isMobile ? 'Mobile' : 'Desktop';
      var browser = 'Other';
      if (/Edg\//.test(ua))                                   browser = 'Edge';
      else if (/OPR\//.test(ua) || /Opera\//.test(ua))        browser = 'Opera';
      else if (/SamsungBrowser\//.test(ua))                   browser = 'Samsung';
      else if (/Chrome\//.test(ua))                           browser = 'Chrome';
      else if (/Firefox\//.test(ua))                          browser = 'Firefox';
      else if (/Safari\//.test(ua))                           browser = 'Safari';
      return deviceLabel + ' ' + browser;
    } catch (e) {
      return null;
    }
  }

  // Pega GCLID + UTMs da URL atual e mescla com o que foi persistido
  // anteriormente nesta sessão (primeiro clique vence, nova URL sobrescreve).
  function getTrackingParams() {
    var keys = ['gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    var fromUrl = {};
    try {
      var qs = new URLSearchParams(window.location.search);
      keys.forEach(function (k) {
        var v = qs.get(k);
        if (v) fromUrl[k] = v;
      });
    } catch (e) {}

    var persisted = {};
    try {
      persisted = JSON.parse(safeGetSession('tracking_params') || '{}') || {};
    } catch (e) {}

    var merged = {};
    keys.forEach(function (k) {
      merged[k] = fromUrl[k] || persisted[k] || null;
    });

    try {
      var hasAny = keys.some(function (k) { return merged[k]; });
      if (hasAny) {
        safeSetSession('tracking_params', JSON.stringify(merged));
      }
    } catch (e) {}

    return merged;
  }

  function alreadyInsertedThisSession() {
    return safeGetSession('tracking_click_inserted') === '1';
  }
  function markInserted() {
    safeSetSession('tracking_click_inserted', '1');
  }

  // =============================== INSERT =================================
  function insertClick() {
    if (!isConfigured()) {
      try { console.warn('[tracking] Supabase não configurado — preencha SUPABASE_URL e SUPABASE_ANON_KEY em assets/js/tracking.js'); } catch (e) {}
      return;
    }
    if (alreadyInsertedThisSession()) return;

    if (typeof window.supabase === 'undefined' ||
        typeof window.supabase.createClient !== 'function') {
      // vendor/supabase.min.js não carregou (CSP, adblocker, 404, etc.)
      return;
    }

    var params = getTrackingParams();

    var row = {
      gclid:        params.gclid,
      utm_source:   params.utm_source,
      utm_medium:   params.utm_medium,
      utm_campaign: params.utm_campaign,
      utm_term:     params.utm_term,
      utm_content:  params.utm_content,
      landing_page: (function () { try { return window.location.href; } catch (e) { return null; } })(),
      referrer:     (function () { try { return document.referrer || null; } catch (e) { return null; } })(),
      user_agent:   getTruncatedUA(),
      device_type:  getDeviceType(),
      session_id:   getOrCreateSessionId()
    };

    try {
      var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      var op = client.from(CLICKS_TABLE).insert(row);
      // .then resolve mesmo em erro de RLS — checamos res.error
      op.then(function (res) {
        if (res && !res.error) markInserted();
      }, function () {
        // engulir rejection
      });
    } catch (e) {
      // engulir
    }
  }

  // ================================ BOOT ==================================
  function boot() {
    try { insertClick(); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
