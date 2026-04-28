# Captura de leads no Google Sheets

> Toda vez que alguém clica em qualquer botão de WhatsApp do site, o fluxo é:
>
> **clique → modal de qualificação → envia dados para a planilha → abre o WhatsApp**
>
> Este guia explica como criar a planilha + Apps Script Web App em 10 minutos.

---

## 0. O que o site já faz hoje

Todo `<a href="wa.me/...">` (incluindo o botão flutuante de WhatsApp e os CTAs de cada seção) intercepta o clique, abre o modal `Antes de seguir ao WhatsApp` e — quando o paciente envia (ou pula) — dispara um `navigator.sendBeacon()` para a URL configurada em **`SHEETS_WEBHOOK_URL_PLACEHOLDER`**.

Esse beacon sobrevive à navegação (não é cancelado quando o WhatsApp abre numa nova aba), funciona em todos os navegadores modernos, e tem fallback `fetch` com `keepalive`.

Enquanto a URL não for substituída, o site funciona normalmente — só que sem registrar nada na planilha.

---

## 1. Criar a planilha

1. Abra <https://sheets.new> (cria uma planilha nova rápido).
2. Renomeie para algo como **"Leads — Site Dra. Ana Laura"**.
3. Renomeie a aba 1 (canto inferior esquerdo) para **`Leads`**.
4. Pode deixar vazia — o script cria os cabeçalhos automaticamente na primeira execução. Caso queira já criar manualmente, use a primeira linha:

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| Timestamp | Nome | Motivo | Observação | Origem (URL) | Referrer | Destino (WhatsApp) | Tipo |

> Tipo = `form` (paciente preencheu) ou `skipped` (paciente pulou o formulário).

---

## 2. Criar o Apps Script Web App

1. Na planilha, vá em **Extensões → Apps Script**.
2. Apague o `function myFunction() {}` que vem por padrão.
3. Cole o código abaixo:

```javascript
// Web App receiver — escreve cada lead em uma nova linha da aba "Leads".
// Suporta POST como application/x-www-form-urlencoded (sendBeacon nativo).

const SHEET_NAME = 'Leads';

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    // Cabeçalho na primeira execução
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Timestamp', 'Nome', 'Motivo', 'Observação',
        'Origem (URL)', 'Referrer', 'Destino (WhatsApp)', 'Tipo'
      ]);
      sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    const params = (e && e.parameter) ? e.parameter : {};
    sheet.appendRow([
      new Date(),                          // Timestamp do servidor
      String(params.name || ''),
      String(params.reason || ''),
      String(params.note || ''),
      String(params.source_url || ''),
      String(params.referrer || ''),
      String(params.target || ''),
      String(params.submission_type || 'form')
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Endpoint de teste no navegador (opcional)
function doGet() {
  return ContentService
    .createTextOutput('Lead capture endpoint ativo. Use POST.')
    .setMimeType(ContentService.MimeType.TEXT);
}
```

4. Salvar (Ctrl+S) — dê um nome ao projeto, ex: **"Lead Capture - Dra. Ana Laura"**.

---

## 3. Publicar como Web App

1. No Apps Script, clique em **"Implantar" → "Nova implantação"**.
2. Em **"Selecionar tipo"**, escolha **"App da Web"**.
3. Configure:
   - **Descrição**: `Lead capture v1`
   - **Executar como**: **Eu (seu e-mail)**
   - **Quem pode acessar**: **Qualquer pessoa** (necessário para o site enviar)
4. Clique **"Implantar"**.
5. O Google pedirá autorização — clique em **"Autorizar acesso"**, escolha sua conta, clique em **"Avançado" → "Acessar Lead Capture (não seguro)"** e em **"Permitir"**. (Esse aviso aparece porque é um script privado seu — é seguro no contexto.)
6. Copie a **URL do Web App** que aparece (formato: `https://script.google.com/macros/s/AKfy.../exec`).

---

## 4. Plugar a URL no site

Em [Landing Page.html](Landing%20Page.html), procure por:

```js
const SHEETS_WEBHOOK_URL = 'SHEETS_WEBHOOK_URL_PLACEHOLDER';
```

Troque pela URL que você copiou:

```js
const SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfy.../exec';
```

Salve. Suba para o servidor (push para o repo, redeploy se já estiver na Vercel).

---

## 5. Validar

1. Abra o site numa **aba anônima** (não dispara o skip de 30 dias).
2. Clique em qualquer botão de WhatsApp.
3. No modal, preencha nome → escolha motivo → clique em **"Continuar para o WhatsApp"**.
4. O WhatsApp deve abrir numa nova aba.
5. Em <2 segundos, atualize a planilha — uma nova linha deve aparecer com os dados.
6. Faça o mesmo teste clicando em **"Prefiro escrever direto"** — também deve aparecer uma linha com `Tipo = skipped`.

### Se não aparecer nada

- **DevTools (F12) → Network**: filtre por `script.google.com`. Deve haver uma requisição POST para a sua URL. Status `200 OK` ou `0` (no-cors) é normal. Status `4xx`/`5xx` indica problema no script.
- **Apps Script → Execuções**: lá você vê cada execução do `doPost` e qualquer erro.
- **Permissão**: se você redeployar o script ou trocar de conta, confira se a opção "Quem pode acessar" continua **"Qualquer pessoa"**.
- **Quota**: o Apps Script tem limite de ~6 minutos/execução e quotas diárias generosas para uso normal. Para o volume de uma landing de psiquiatria (dezenas de leads/dia), está bem dentro.

---

## 6. Privacidade & LGPD

- A planilha contém **dados pessoais** (nome) e potencialmente **dados sensíveis de saúde** (motivo informado pode ser "ansiedade", "saúde da mulher" etc.). Trate-a com o mesmo cuidado que o prontuário.
- **Não compartilhe** a planilha com pessoas fora da prática clínica.
- A Política de Privacidade já cita o uso de planilha de leads no item 5.
- Recomendado configurar **lixeira automática**: criar um trigger no Apps Script que apaga linhas com mais de 90 dias (se o lead virou paciente, os dados clínicos vão para o prontuário; se não virou, não há motivo para reter).

```javascript
// Opcional: chamar manualmente ou em trigger semanal
function pruneOldLeads() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads');
  const data = sheet.getDataRange().getValues();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 dias atrás
  for (let i = data.length - 1; i >= 1; i--) { // pula header
    if (data[i][0] instanceof Date && data[i][0] < cutoff) sheet.deleteRow(i + 1);
  }
}
```

Para agendar: Apps Script → Acionadores → "Adicionar acionador" → função `pruneOldLeads`, baseado em tempo, semanal.

---

## 7. Próximos passos opcionais

- **Notificação por e-mail** a cada novo lead (adicionar `MailApp.sendEmail(...)` no `doPost`)
- **Dashboard simples** numa segunda aba com `=COUNTIF`, `=COUNTUNIQUE`, gráfico de leads/dia
- **Integração com WhatsApp Business API** para enviar mensagem automática de confirmação (mais complexo, requer Meta Business)
