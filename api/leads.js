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

  // 6) Insert leads (primeiro, return=representation pra pegar o id)
  const leadRow = {
    phone:         phone,
    name:          name,
    email:         email,
    symptom_area:  symptom_area,
    gclid:         gclid,
    source:        'pre_form',
    flow_type:     'pre_form',
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
    flow_type:             'pre_form',
    button_location:       button_location,
    notes:                 'pre_form qualificado',
    converted_to_lead_id:  lead_id
  };

  try {
    const intentResp = await insertRow('whatsapp_intents', intentRow, 'return=minimal');
    if (!intentResp.ok) {
      const errBody = await intentResp.text().catch(function () { return ''; });
      console.error('[api/leads] whatsapp_intents insert failed', intentResp.status, errBody);
      return res.status(200).json({ ok: true, lead_id: lead_id, warning: 'intent_failed' });
    }
  } catch (e) {
    console.error('[api/leads] whatsapp_intents insert threw', e && e.message);
    return res.status(200).json({ ok: true, lead_id: lead_id, warning: 'intent_threw' });
  }

  return res.status(200).json({ ok: true, lead_id: lead_id });
};
