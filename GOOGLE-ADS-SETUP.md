# Google Ads — Setup e Operação

> Guia técnico para deixar o site da Dra. Ana Laura 100% rastreável e operável no Google Ads, **respeitando o CFM (Resolução 1.974/2011) e a LGPD**.

## 0. O que já está pronto no código

- ✅ **Google Tag (gtag.js)** carregado com placeholders `G-XXXXXXXXXX` e `AW-XXXXXXXXXX`
- ✅ **Consent Mode v2** ativo — site fica cookieless até o usuário consentir
- ✅ **Banner de consentimento** LGPD com 3 opções (essenciais / medição / tudo)
- ✅ **Eventos rastreados** disparam para `dataLayer` E `gtag('event', ...)`
- ✅ **Conversion helper** pronto: `conversion('LABEL', value)` envia `gtag('event', 'conversion', ...)` com `send_to: AW-XXXXXXXXXX/LABEL`
- ✅ **JSON-LD `Physician`** no `<head>` ajuda o Google a entender a entidade
- ✅ **Performance**: 332 KB total, FCP ~750ms — Quality Score do landing tende a ser alto
- ✅ **Mobile-friendly** validado

### Contas Google Ads ativas

| Conta | ID | Status | Uso |
|---|---|---|---|
| Primária | `AW-18126057890` | ✅ Em produção | Conversões com Enhanced Conversions (hash SHA-256 de email/telefone) via helper `conversion()` |
| Secundária | `AW-18068581578` | ✅ Em produção (paralelo) | Conversões inline `gtag('event', 'conversion', ...)` — sem Enhanced Conversions |

> As duas contas rodam **em paralelo**. Cada conversão (WhatsApp Click, Email Click, Qualified Lead) dispara para as duas contas simultaneamente. A conta primária permanece a fonte canônica para Enhanced Conversions; a secundária recebe tracking duplo para relatórios separados.

---

## 1. IDs que você precisa colocar (3 lugares)

### 1.1. GA4 Measurement ID
1. Crie/abra a propriedade GA4 em <https://analytics.google.com>
2. Admin → Streams de dados → Web → copie o **Measurement ID** (formato `G-XXXXXXXXXX`)
3. **Substituir em [index.html](index.html)** — `G-XXXXXXXXXX` aparece **3 vezes** (todas no `<head>`).

### 1.2. Google Ads Conversion ID
1. Em <https://ads.google.com> → Ferramentas → Medição → Conversões
2. Criar conversões (ver §2). O **ID** é o mesmo para todas (`AW-XXXXXXXXXX`)
3. **Substituir em [index.html](index.html)** — `AW-XXXXXXXXXX` aparece em **2 lugares**: no `<head>` (`gtag('config', ...)`) e no helper `conversion()` no JS.

### 1.3. Conversion Labels (um por evento)
Cada conversão criada no Google Ads gera um **label** (string curta, ~11 chars). Substituir os placeholders no JS:

| Placeholder no código | Evento | Use o label da conversão chamada |
|---|---|---|
| `WHATSAPP_CLICK_LABEL` | clique em qualquer link `wa.me` | "WhatsApp Click" |
| `EMAIL_CLICK_LABEL` | clique em `mailto:` | "Email Click" |
| `QUALIFIED_LEAD_LABEL` | submit do pré-form modal | "Qualified Lead" |

Procurar por `XXXXXXXXX_LABEL` no [index.html](index.html).

---

## 2. Conversões a criar no Google Ads

### 2.1. Conta primária `AW-18126057890`

| Nome | Categoria | Valor | Label | Contagem | Janela | Ação |
|---|---|---:|---|---|---|---|
| **Qualified Lead** | Submit lead form | R$ 50,00 | `bSbqCOTHnaQcEKLjlsND` | Uma | 30 dias | Primary |
| **WhatsApp Click** | Contact | R$ 15,00 | `tANcCOfHnaQcEKLjlsND` | Uma | 30 dias | Primary |
| **Email Click** | Contact | R$ 5,00 | `pwkGCOrHnaQcEKLjlsND` | Uma | 30 dias | Secondary |

### 2.2. Conta secundária `AW-18068581578` (em paralelo)

| Nome | Categoria | Valor | Label | Pontos de integração no código |
|---|---|---:|---|---|
| **Qualified Lead** | Submit lead form | R$ 35,00 | `2J12CJD2hKUcEMrZ4qdD` | `assets/js/lead-capture.js` — após cada `track('preform_qualified_lead', ...)` (modal principal + exit-intent) |
| **WhatsApp Click** | Contact | R$ 15,00 | `se8dCOzk66QcEMrZ4qdD` | `assets/js/lead-capture.js` — handler `a[href*="wa.me"]`, após `track('whatsapp_click', ...)` |
| **Email Click** | Contact | R$ 5,00 | `VG8oCMOe7KQcEMrZ4qdD` | `assets/js/lead-capture.js` — handler `a[href^="mailto:"]`, após `track('email_click', ...)` |

> **Tracking duplo intencional**: cada uma das 3 conversões acima dispara para **ambas as contas**. Não há deduplicação — cada conta gera seus próprios relatórios. A conta primária `AW-18126057890` mantém o status canônico e é a única com Enhanced Conversions.

> Os valores são proxies (não é valor de consulta — é **valor estimado por lead** baseado em CPL desejado / taxa de conversão de lead em paciente). Ajuste conforme dados reais aparecerem.

**Configuração na criação:**
- Tipo: **Site**
- Optimized: pode deixar "Use a different value for each conversion" se quiser personalizar por origem
- Enhanced Conversions: **ativar** (envia hash de e-mail/telefone quando disponível — melhora atribuição em ~10-30%)

---

## 3. Eventos GA4 que o código já dispara

| Evento | Trigger | Parâmetros |
|---|---|---|
| `whatsapp_click` | qualquer link `wa.me` clicado | `source`, `label` |
| `email_click` | qualquer `mailto:` clicado | `source` |
| `preform_open` | modal de qualificação aberto | `from` (URL destino) |
| `preform_submit` | modal pulado / enviado | `message_length` |
| `preform_qualified_lead` | form submetido com dados | `has_name`, `reason`, `note_len` |
| `cookie_consent` | escolha no banner | `choice` (essential/analytics/all) |
| `exit_intent_shown` | mouseout para topo após 8s | — |
| `scroll_depth` | 25/50/75/100% do scroll | `percent` |
| `engaged_30s` | 30s na página | — |

No GA4: **Admin → Eventos → Marcar como conversão**: `whatsapp_click` e `preform_qualified_lead`.

---

## 4. Estrutura de campanha proposta (CFM-compliant)

> ⚠️ **Importante**: Resolução CFM 1.974/2011 proíbe na publicidade médica:
> - promessa de resultado / cura
> - comparação com outros profissionais
> - "antes e depois", testemunhos não literais ou induzidos
> - sensacionalismo (ex.: "fim da depressão!")
> - divulgação de técnica não reconhecida
> - omissão do CRM e da especialidade

**Foco estratégico**: orçamento e atenção concentrados em **Saúde da Mulher** e **Insônia** (decisão da Dra. — abr/2026). Demais grupos rodam com budget reduzido para prospecção.

```
Conta: Dra. Ana Laura Valadares
│
├── Campanha 1: Marca (Search · Exact + Phrase) — budget baixo, ROI alto
│   └── Ad Group: Brand
│       ├── Keywords: [dra ana laura valadares], "ana laura valadares psiquiatra",
│       │             [ana laura crm 89888]
│       └── 3 RSAs com headlines focadas no nome + CRM
│
├── Campanha 2: Saúde da Mulher (Search · Phrase) ★ PRIORIDADE
│   ├── Ad Group: Saúde Mental Feminina
│   │   └── Keywords: "psiquiatra saúde da mulher", "psiquiatra mulher online",
│   │                 "psiquiatra feminina"
│   ├── Ad Group: TPM e TDPM
│   │   └── Keywords: "tpm psiquiatra", "tdpm tratamento", "transtorno disfórico pré-menstrual"
│   ├── Ad Group: Puerpério e pós-parto
│   │   └── Keywords: "depressão pós-parto psiquiatra", "psiquiatra puerpério",
│   │                 "ansiedade pós-parto online"
│   └── Ad Group: Climatério
│       └── Keywords: "climatério psiquiatra", "menopausa ansiedade depressão",
│                     "saúde mental menopausa"
│
├── Campanha 3: Insônia (Search · Phrase) ★ PRIORIDADE
│   └── Ad Group: Insônia
│       └── Keywords: "tratamento insônia psiquiatra", "psiquiatra insônia online",
│                     "remédio para dormir psiquiatra", "insônia crônica tratamento"
│
├── Campanha 4: Saúde Mental — Genéricas (Search · Phrase) — secundária
│   ├── Ad Group: Psiquiatria Online
│   │   └── Keywords: "psiquiatra online", "consulta psiquiatra online",
│   │                 "psiquiatra teleconsulta"
│   ├── Ad Group: Ansiedade
│   │   └── Keywords: "tratamento ansiedade online", "psiquiatra ansiedade"
│   ├── Ad Group: Depressão
│   │   └── Keywords: "psiquiatra depressão online" (sem promessas)
│   └── Ad Group: TDAH adulto
│       └── Keywords: "tdah adulto psiquiatra", "diagnóstico tdah online"
│
└── Campanha 5: Performance Max (com cautela na saúde mental)
    └── Asset Group: portrait, logo, headlines genéricas, sinal de marca
```

**Estratégia de lance**: começar com **Maximize Conversions** sem tCPA por 2-3 semanas (até ter 30+ conversões), depois migrar para **Target CPA**. Para Saúde da Mulher e Insônia, considerar também **bid adjustment** positivo +20-30% para o segmento mobile (busca em horário noturno, especialmente para insônia).

**Localização**: Brasil inteiro (telemedicina). Excluir locais sem sinal (testes em RJ, MG, SP, PR primeiro).

**Negative keywords** essenciais (em todas as campanhas):
- Custo: `gratis`, `gratuito`, `sus`, `unimed`, `bradesco saude`, `amil`
- Recrutamento: `vagas`, `concurso`, `emprego`, `salário`, `currículo`
- Off-target: `clinica`, `psicologo` (somos psiquiatras), `pediatria`, `infantil`,
  `adolescente` (até a Dra. definir faixa etária mínima)
- Para campanha de Insônia, adicionar: `chá`, `caseiro`, `natural`, `meditação`,
  `youtube`, `dicas` (intenção informativa, não comercial)
- Para campanha de Saúde da Mulher: `ginecologista`, `obstetra` (especialidade diferente),
  `dieta`, `emagrecer` (escopo errado)

---

## 5. Exemplo de RSA (compatível com CFM)

> Headlines (até 15, escolher 8-10) — máx 30 caracteres cada:

```
Dra. Ana Laura · Psiquiatria
Atendimento Online · CRM-MG 89888
Consulta de até 1h30
Escuta sem pressa
Ansiedade · Depressão · TDAH
Sigilo absoluto · LGPD
Telemedicina regulamentada
Particular · Recibo p/ reembolso
Agende pelo WhatsApp
Cuidado individualizado
Resposta no mesmo dia
```

> Descriptions (até 4, escolher 3-4) — máx 90 caracteres cada:

```
Médica psiquiatra · Atendimento online em todo o Brasil · CRM-MG 89888.
Consultas de até 1h30, com escuta atenta e plano terapêutico individualizado.
Ansiedade, depressão, TDAH adulto, burnout, sono. Agende hoje pelo WhatsApp.
Telemedicina regulamentada (CFM 2.314/2022). Sigilo, ética e profundidade clínica.
```

**Display path**: `/psiquiatria-online` (sugerido — Google permite 2 paths).

**Ad extensions** (assets):
- **Sitelinks**: Sobre · Princípios · Áreas de cuidado · Dúvidas
- **Callouts**: 100% online · Sigilo absoluto · Atendimento particular · CRM-MG 89888
- **Structured snippets** (Services): Ansiedade, Depressão, TDAH adulto, Burnout, Insônia, TOC
- **Phone**: cuidado — em saúde mental Google pode pedir verificação. Pode-se omitir e usar só o site.

> ❌ **Não usar**: "cura ansiedade", "fim da depressão", "melhor psiquiatra", "100% de sucesso", testemunhos, antes/depois, qualquer headline emocional sensacional.

---

## 6. Pré-certificação Google (categoria "saúde mental")

Algumas keywords/categorias podem cair em **Pharmaceuticals & Healthcare** ou em verticais sensíveis. O fluxo:
1. Subir as campanhas em modo "Aprendizado".
2. Se algum anúncio for reprovado por **Healthcare and medicines**, abrir o pedido de certificação em <https://support.google.com/adspolicy/troubleshooter/4569018>
3. Documentação a anexar: cópia do **CRM ativo** + comprovante de prática (currículo, especialização em andamento UFF).

---

## 7. Validação após plugar os IDs

Quando substituir os 3 placeholders:

1. **Tag Assistant** (extensão Chrome) — abrir o site, conferir se `G-XXXXXXXXXX` e `AW-XXXXXXXXXX` aparecem como "Healthy".
2. **GA4 → DebugView** — clicar nos botões de WhatsApp e ver os eventos chegarem em tempo real.
3. **Google Ads → Conversões → Status** — esperar até 24h para mudar de "Não verificado" → "Recebendo conversões".
4. **Lighthouse** — rodar de novo: nada deve mudar significativamente (gtag é `async`, não bloqueia o LCP).
5. **PageSpeed Insights** — para o domínio em produção.

---

## 8. Métricas que você deve acompanhar

| Métrica | Onde | Alvo (psiquiatria/saúde mental) |
|---|---|---|
| CPL (custo por lead WhatsApp) | Google Ads | R$ 25–60 |
| CPA (custo por paciente) | Google Ads (com Enhanced Conversions) | R$ 100–250 |
| Taxa de conversão (visita → WhatsApp) | GA4 | 3-7% |
| Quality Score | Google Ads → Keywords | ≥ 7 |
| Impression Share | Google Ads | > 60% (depois do warm-up) |
| Bounce / Engagement Rate | GA4 | engagement > 70% |

---

## 9. Checklist final antes de publicar campanhas

- [ ] Substituir `G-XXXXXXXXXX` (3×) e `AW-XXXXXXXXXX` (2×) no `index.html`
- [ ] Substituir os 3 `*_LABEL` no JS pelos labels reais
- [ ] Criar as 3 conversões no Google Ads + ativar Enhanced Conversions
- [ ] No GA4, marcar `whatsapp_click` e `preform_qualified_lead` como conversão
- [ ] Domínio com HTTPS e canonical correto
- [ ] Política de Privacidade e Termos publicados (já estão)
- [ ] Banner de consentimento testado em Chrome, Firefox e Safari
- [ ] Validar no DevTools que **nenhum cookie do `_ga` ou `_gcl` é gravado antes do consentimento**
- [ ] Cadastrar o site como propriedade no Google Search Console + enviar `sitemap.xml`
- [ ] Conectar Search Console ao Google Ads (gera relatórios cruzados)
