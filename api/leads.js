// ============================================================
// SECURITY: SERVICE_ROLE KEY HANDLING
//
// This function uses SUPABASE_SERVICE_ROLE_KEY which bypasses
// RLS and has admin access to the database.
//
// NEVER:
// - console.log(process.env) — exposes all env vars
// - console.log the service_role key
// - return env vars or key in any response body
// - commit hardcoded keys
//
// The key MUST stay server-side only.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Origins permitidos: produção apex + Vercel Previews do mesmo projeto.
// Strings → comparação por origin (após new URL().origin), regex → .test()
const ALLOWED_ORIGINS = [
  'https://psqdraanalaura.com.br',
  'https://www.psqdraanalaura.com.br'
];
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/site-ana(-git-[a-z0-9-]+)?-luizfelipebonanato.*\.vercel\.app$/
];

// ----- Helpers -----------------------------------------------------------

// Normaliza um header (Origin ou Referer) para a forma "https://host:port"
function originOf(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return '';
  try {
    return new URL(headerValue).origin;
  } catch (e) {
    return '';
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return true;
  return ALLOWED_ORIGIN_PATTERNS.some(function (p) { return p.test(origin); });
}

function clean(value, maxLen) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  return maxLen ? t.slice(0, maxLen) : t;
}

function digitsOf(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\D/g, '');
}

function isValidPhone(value) {
  const d = digitsOf(value);
  return d.length >= 10 && d.length <= 13;
}

async function insertRow(table, row, prefer) {
  return fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': prefer || 'return=minimal'
    },
    body: JSON.stringify(row)
  });
}

// Lookup do click que originou o lead. Estratégia last-click:
//   1) por session_id (mesma aba/jornada) — preferencial
//   2) por gclid (fallback se session_id não disponível ou query vazia)
// Retorna { id, utm_campaign } ou null. Nunca lança.
async function findClickForLead(sessionId, gclid) {
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
    'Accept': 'application/json'
  };

  async function queryBy(column, value) {
    if (!value) return null;
    try {
      const url = SUPABASE_URL + '/rest/v1/clicks'
        + '?' + column + '=eq.' + encodeURIComponent(value)
        + '&order=created_at.desc&limit=1&select=id,utm_campaign';
      const resp = await fetch(url, { headers: headers });
      if (!resp.ok) {
        const errBody = await resp.text().catch(function () { return ''; });
        console.error('[api/leads] click lookup by ' + column + ' failed', resp.status, errBody);
        return null;
      }
      const rows = await resp.json().catch(function () { return null; });
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (e) {
      console.error('[api/leads] click lookup by ' + column + ' threw', e && e.message);
      return null;
    }
  }

  // 1) session_id (preferencial)
  let hit = await queryBy('session_id', sessionId);
  if (hit) return hit;
  // 2) gclid (fallback)
  hit = await queryBy('gclid', gclid);
  return hit;
}

// PATCH em leads com campos de atribuição. Omite chaves NULL — assim,
// click_id=NULL no banco mantém o significado "click não encontrado", e
// click_id NOT NULL + campaign_attributed=NULL significa "click encontrado
// mas era organic/direct (sem utm_campaign)".
async function updateLeadAttribution(leadId, click, intentId) {
  const patch = {};
  if (click && click.id) {
    patch.click_id = click.id;
    if (click.utm_campaign) {
      patch.campaign_attributed = click.utm_campaign;
    }
  }
  if (intentId) {
    patch.whatsapp_intent_id = intentId;
  }
  if (Object.keys(patch).length === 0) return false;

  try {
    const url = SUPABASE_URL + '/rest/v1/leads?id=eq.' + encodeURIComponent(leadId);
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(patch)
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(function () { return ''; });
      console.error('[api/leads] lead attribution PATCH failed', resp.status, errBody);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[api/leads] lead attribution PATCH threw', e && e.message);
    return false;
  }
}

// ----- Handler -----------------------------------------------------------

module.exports = async function handler(req, res) {
  // Nunca cachear resposta de função que escreve em DB
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // 1) Origin validation
  const headerOrigin = originOf(req.headers.origin) || originOf(req.headers.referer);
  if (!isAllowedOrigin(headerOrigin)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  // 2) Method
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // 3) Env var check
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[api/leads] missing required env vars');
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  // 4) Body parse (Vercel parseia auto se Content-Type=application/json,
  //    mas defendemos contra string crua também)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid input' });
  }

  // 5) Whitelist + sanitize
  const phone = clean(body.phone, 60);
  if (!phone || !isValidPhone(phone)) {
    return res.status(400).json({ ok: false, error: 'Invalid input' });
  }
  const name            = clean(body.name, 120);
  const email           = clean(body.email, 200);
  const symptom_area    = clean(body.symptom_area, 200);
  const gclid           = clean(body.gclid, 500);
  const session_id      = clean(body.session_id, 100);
  const button_location = clean(body.button_location, 80);

  // Whitelist de flow_type: só aceita os valores documentados. Qualquer outro
  // (inclusive vazio/null/payload arbitrário) cai no default 'pre_form'.
  // - 'pre_form'    → submit do modal grande de qualificação
  // - 'exit_intent' → submit do popup de saída
  const rawFlowType = clean(body.flow_type, 40);
  const flow_type   = rawFlowType === 'exit_intent' ? 'exit_intent' : 'pre_form';
  const intentNotes = flow_type === 'exit_intent' ? 'exit_intent qualificado' : 'pre_form qualificado';

  // 6) Insert leads (primeiro, return=representation pra pegar o id)
  //    source='pre_form' independente do flow_type — enum lead_source não tem
  //    'exit_intent'. Diferenciação fica via coluna flow_type. Documentado no
  //    commit message (Entrega 2.3).
  const leadRow = {
    phone:         phone,
    name:          name,
    email:         email,
    symptom_area:  symptom_area,
    gclid:         gclid,
    source:        'pre_form',
    flow_type:     flow_type,
    is_qualified:  true
  };

  let lead_id = null;
  try {
    const leadResp = await insertRow('leads', leadRow, 'return=representation');
    if (!leadResp.ok) {
      const errBody = await leadResp.text().catch(function () { return ''; });
      console.error('[api/leads] leads insert failed', leadResp.status, errBody);
      return res.status(502).json({ ok: false, error: 'Lead insert failed' });
    }
    const leadData = await leadResp.json().catch(function () { return null; });
    lead_id = Array.isArray(leadData) && leadData[0] ? leadData[0].id : null;
  } catch (e) {
    console.error('[api/leads] leads insert threw', e && e.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }

  // 7) Insert whatsapp_intents (com converted_to_lead_id)
  //    Se falhar: lead já está gravado, retornamos ok com warning.
  const intentRow = {
    phone:                 phone,
    gclid:                 gclid,
    session_id:            session_id,
    flow_type:             flow_type,
    button_location:       button_location,
    notes:                 intentNotes,
    converted_to_lead_id:  lead_id
  };

  let intent_id = null;
  try {
    // return=representation pra capturar intent.id (necessário pro PATCH
    // de atribuição abaixo — linkagem bidirecional B2).
    const intentResp = await insertRow('whatsapp_intents', intentRow, 'return=representation');
    if (!intentResp.ok) {
      const errBody = await intentResp.text().catch(function () { return ''; });
      console.error('[api/leads] whatsapp_intents insert failed', intentResp.status, errBody);
      return res.status(200).json({ ok: true, lead_id: lead_id, warning: 'intent_failed' });
    }
    const intentData = await intentResp.json().catch(function () { return null; });
    intent_id = Array.isArray(intentData) && intentData[0] ? intentData[0].id : null;
  } catch (e) {
    console.error('[api/leads] whatsapp_intents insert threw', e && e.message);
    return res.status(200).json({ ok: true, lead_id: lead_id, warning: 'intent_threw' });
  }

  // 8) Atribuição: lookup do click + PATCH no lead (Problema B)
  //    Executado ANTES do return — Vercel cancela promises pós-res.json()
  //    sem waitUntil(), e atribuição precisa ser confiável. +50-100ms de
  //    latência server-side é invisível pro frontend (que dispara fetch
  //    fire-and-forget e abre wa.me via setTimeout 60ms).
  //    Best-effort: se qualquer parte falhar, lead já está persistido com
  //    seus dados core. Atribuição vira NULL nos campos relevantes.
  try {
    const click = await findClickForLead(session_id, gclid);
    if (!click && gclid) {
      console.warn('[api/leads] click not found for lead', lead_id, 'gclid_prefix:', gclid.slice(0, 12));
    }
    await updateLeadAttribution(lead_id, click, intent_id);
  } catch (e) {
    console.error('[api/leads] attribution step threw', e && e.message);
    // não bloqueia o sucesso do lead — atribuição é best-effort
  }

  return res.status(200).json({ ok: true, lead_id: lead_id });
};
