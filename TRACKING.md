# Tracking — Site Dra. Ana Laura

Mapa completo de eventos, payload da planilha e checklist para Google Ads / GA4 / Meta Ads.

---

## IDs reais já plugados

| Plataforma | ID | Onde fica |
|---|---|---|
| Google Analytics 4 | `G-V80CXY51QP` | `index.html` (head) |
| Google Ads (conta primária) | `AW-18126057890` | `index.html` (head) + `assets/js/lead-capture.js` (`conversion()`) |
| Google Ads (conta secundária) | `AW-18068581578` | `index.html` (head) + chamadas inline `gtag('event', 'conversion', ...)` em `assets/js/lead-capture.js` |
| Apps Script Web App (Sheets) | `https://script.google.com/macros/s/AKfycbwQeotC.../exec` | `assets/js/lead-capture.js` → `LEAD_CONFIG.WEBHOOK_URL` |

> As duas contas Google Ads rodam **em paralelo**: cada evento de conversão dispara para ambas. Não há failover nem deduplicação — é tracking duplo intencional (contas separadas, relatórios separados).

### Conversion labels do Google Ads

#### Conta primária — `AW-18126057890`

Definidos em [`assets/js/lead-capture.js`](assets/js/lead-capture.js) via helper `conversion(label, value, userData)`:

| Conversão | Label | Valor proxy | Onde dispara |
|---|---|---|---|
| WhatsApp Click | `tANcCOfHnaQcEKLjlsND` | R$ 15 | Todo clique em link `wa.me/...` |
| Email Click | `pwkGCOrHnaQcEKLjlsND` | R$ 5 | Todo clique em link `mailto:` (apenas em `index.html` — páginas legais não carregam `lead-capture.js`) |
| Qualified Lead | `bSbqCOTHnaQcEKLjlsND` | R$ 50 | Submit do modal principal **e** do exit-intent |

A conversão "Qualified Lead" usa **Enhanced Conversions**: e-mail e telefone são hashados em SHA-256 antes do envio.

#### Conta secundária — `AW-18068581578`

Disparadas via `gtag('event', 'conversion', { send_to: ... })` inline, logo após o `track()` correspondente. **Sem Enhanced Conversions** (chamada direta, sem hash de PII).

| Conversão | Label | Valor proxy | Onde dispara | Ponto de integração |
|---|---|---|---|---|
| WhatsApp Click | `se8dCOzk66QcEMrZ4qdD` | R$ 15 | Todo clique em link `wa.me/...` | Handler `a[href*="wa.me"]` — após `track('whatsapp_click', ...)` |
| Email Click | `VG8oCMOe7KQcEMrZ4qdD` | R$ 5 | Todo clique em link `mailto:` (apenas em `index.html`) | Handler `a[href^="mailto:"]` — após `track('email_click', ...)` |
| Qualified Lead | `2J12CJD2hKUcEMrZ4qdD` | R$ 35 | Submit do modal principal **e** do exit-intent | Após cada `track('preform_qualified_lead', ...)` (2 ocorrências) |

> Cada bloco está envolto em `if (typeof gtag === 'function')` para não quebrar quando o Consent Mode bloqueia o gtag.

---

## Eventos disparados no `dataLayer`

Todos também passam por `gtag('event', name, params)` quando o GA4 está autorizado pelo Consent Mode.

### Eventos preservados (NÃO renomear — já mapeados em conversões do Ads)

| Evento | Quando dispara | Parâmetros |
|---|---|---|
| `whatsapp_click` | Em todo clique de link WhatsApp (independente de modal abrir) | `source`, `label`, `button_location`, `timestamp` |
| `email_click` | Em todo clique de link `mailto:` | `source`, `timestamp` |
| `preform_open` | Quando o modal principal abre | `from`, `button_location`, `timestamp` |
| `preform_submit` | Submit completo do modal **OU** clique em "Prefiro escrever direto" | `message_length`, `persisted`, `submission_type` (`form` \| `skipped`), `button_location`, `tema`, `timestamp` |
| `preform_qualified_lead` | Submit válido do modal **e** submit do exit-intent | `has_name`, `has_email`, `has_phone`, `reason`, `note_len`, `button_location`, `timestamp` |
| `exit_intent_shown` | Quando o exit-intent é exibido | `timestamp` |
| `scroll_depth` | Aos 25/50/75/100% de profundidade de rolagem | `percent`, `timestamp` |
| `engaged_30s` | Após 30s na página | `timestamp` |
| `cookie_consent` | Clique em qualquer botão do banner de cookies | `choice` (`all` \| `analytics` \| `essential`), `timestamp` |

### Eventos novos (Fase 2)

| Evento | Quando dispara | Parâmetros | Notas |
|---|---|---|---|
| `page_view_custom` | No carregamento da página, complementa o `page_view` automático do GA4 | `page_path`, `has_gclid`, `utm_source`, `utm_campaign`, `timestamp` | Útil para criar audiências por origem de campanha |
| `whatsapp_intent` | Antes do modal principal abrir (após o clique no botão de WhatsApp) | `button_location`, `timestamp` | Permite separar "intenção" de "lead qualificado" |
| `exit_intent_submit` | Submit válido do formulário do exit-intent | `button_location` (sempre `exit_intent`), `timestamp` | Distingue leads vindos do exit-intent |

---

## `button_location` — mapa de origem do clique

Cada elemento que dispara o modal tem o atributo `data-button-location`:

| Local | `button_location` |
|---|---|
| Header desktop "Agendar consulta →" | `header_desktop` |
| Header mobile (menu hamburguer) "Agendar consulta →" | `header_mobile` |
| Hero principal "Agendar consulta →" | `hero_primary` |
| Hero secundário "Falar no WhatsApp →" | `hero_secondary` |
| Bloco Sobre "Falar com a Dra. Ana Laura" | `about_block` |
| Manifesto "Primeiro contato" | `manifesto` |
| Áreas de cuidado "Quero conversar →" | `care_areas_end` |
| FAQ "Tirar dúvidas no WhatsApp →" | `faq` |
| CTA final "Agendar pelo WhatsApp →" | `final_cta` |
| Footer "WhatsApp" | `footer` |
| Seção "Informações de contato" | `contact_section` |
| Botão flutuante (FAB) | `floating` |
| Submit do exit-intent | `exit_intent` |
| Qualquer outro link `wa.me` sem o atributo | `unknown` |

---

## Payload enviado ao Apps Script (Google Sheets)

Método: `navigator.sendBeacon` com `application/x-www-form-urlencoded`.
Fallback: `fetch` com `keepalive: true` quando `sendBeacon` indisponível.

| Campo | Tipo | Origem |
|---|---|---|
| `timestamp` | ISO string (UTC) | `new Date().toISOString()` |
| `timezone` | string | constante `America/Sao_Paulo` |
| `form_type` | `main` \| `exit_intent` | identifica o formulário |
| `submission_type` | `form` \| `skipped` | `skipped` quando "Prefiro escrever direto" |
| `button_location` | string | tabela acima |
| `name` | string | campo Nome |
| `whatsapp` | string mascarada | `(11) 98765-4321` — fácil de ler na planilha |
| `whatsapp_raw` | string só dígitos | `5511987654321` — pronto para discagem |
| `email` | string | só preenchido no form principal |
| `reason` | string | tema do contato (form principal) |
| `note` | string | observação opcional, máx. 500 chars |
| `source_url` | string | `location.href` (com query) |
| `referrer` | string | `document.referrer` |
| `target` | string | URL final do WhatsApp para o qual o usuário foi |
| `utm_source` | string | UTM persistido em `sessionStorage.lead_attribution` |
| `utm_medium` | string | idem |
| `utm_campaign` | string | idem |
| `utm_content` | string | idem |
| `utm_term` | string | idem |
| `gclid` | string | identificador do clique do Google Ads |
| `user_agent` | string | `navigator.userAgent` |

> ⚠️ Se você adicionar novas colunas no Apps Script, precisa atualizar o array `headers` no script do lado servidor (ver [SHEETS-SETUP.md](SHEETS-SETUP.md)).

---

## Atribuição (UTMs + gclid)

- Capturada na primeira visita da sessão e persistida em `sessionStorage` com a chave `lead_attribution`.
- Sobrescrita se o usuário voltar com novos parâmetros na URL (ex: clicar em outro anúncio).
- Expira ao fechar a aba — comportamento intencional para evitar atribuição errada de sessões antigas.

Parâmetros capturados: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`.

---

## Controle de exibição do exit-intent

| Chave | Storage | Função |
|---|---|---|
| `exit_intent_seen` | `localStorage` | Garante que o pop-up apareça **no máximo uma vez** por dispositivo |
| `lead_submitted` | `sessionStorage` | Bloqueia o exit-intent se o usuário já enviou o form principal **nesta sessão** |
| `cookie_consent_v1` | `localStorage` | Escolha do banner de cookies (Consent Mode v2) |

Triggers:
- **Desktop:** `mouseout` saindo pelo topo da viewport, após 8s de "armar".
- **Mobile (`max-width: 768px`):** 45 segundos sem `scroll`, `touchstart`, `click` ou `keydown`.

---

## Como mapear novos eventos como conversão no Google Ads

1. Em [Google Ads → Goals → Conversions → Summary](https://ads.google.com/aw/conversions), clicar **+ New conversion action**.
2. Escolher **Website**, depois **Set up manually**.
3. Categoria: **Submit lead form** para eventos de submit; **Page view** para `page_view_custom`.
4. Após criar, copiar o **Conversion label** (formato `xxxxxxxxxxxxx`).
5. Adicionar uma chamada `conversion('<label>', <valor>, { email, phone })` no ponto do `lead-capture.js` onde quiser disparar.
6. Em **Tag setup**, escolher **Use Google tag** (já está no site via `gtag/js?id=G-V80CXY51QP`).

> Os 3 conversion labels já em produção ficam em `assets/js/lead-capture.js` na função `conversion(label, value, userData)`.

---

## Como ativar Meta Pixel quando os IDs chegarem

Atualmente **não há Meta Pixel instalado** (nem placeholder). Quando subir Meta Ads:

1. Pegar o `pixel_id` no Meta Business Manager.
2. Adicionar no `<head>` do `index.html`, abaixo do bloco do Google Consent Mode:

```html
<!-- Meta Pixel — só dispara após consent='all' (Consent Mode-aware) -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'YOUR_PIXEL_ID');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=YOUR_PIXEL_ID&ev=PageView&noscript=1"/></noscript>
```

3. Em `assets/js/lead-capture.js`, no submit do modal e do exit-intent, adicionar:

```javascript
if (typeof fbq === 'function') {
  fbq('track', 'Lead', { value: 50, currency: 'BRL' });
}
```

---

## Como ativar GTM (se quiser unificar tudo via container)

Hoje o site usa **gtag direto** (sem GTM). Se quiser migrar:

1. Criar um container em [tagmanager.google.com](https://tagmanager.google.com).
2. Substituir os blocos do `<head>` (linhas 47-80 do `index.html`) pelo snippet do GTM.
3. Migrar GA4 e conversions do Google Ads para tags dentro do GTM, configurando-as para escutarem os eventos do `dataLayer` que já existem (todos os eventos da tabela acima).
4. Manter o Consent Mode v2 — GTM já tem suporte nativo via templates.

> Recomendação: **não migrar agora**. O setup atual está limpo, funciona, e GTM adicionaria complexidade sem ganho imediato. Migrar só se houver pressão de time de mídia.

---

## Verificação rápida no navegador

Abrir DevTools → Console e digitar:

```javascript
window.dataLayer.filter(e => e.event === 'preform_submit')   // últimos submits do modal
window.dataLayer.filter(e => e.event === 'exit_intent_submit') // últimos submits do exit-intent
JSON.parse(sessionStorage.getItem('lead_attribution'))       // UTMs + gclid persistidos
sessionStorage.getItem('lead_submitted')                     // 'true' se já submeteu nesta sessão
localStorage.getItem('exit_intent_seen')                     // '1' se exit-intent já apareceu
```
