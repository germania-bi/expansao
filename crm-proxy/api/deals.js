// Proxy serverless: busca as negociações do pipeline "Expansão [V4]" no RD Station CRM
// e devolve um JSON achatado, pronto pro dashboard. O token nunca sai do backend.

const RD_BASE = 'https://crm.rdstation.com/api/v1';
const DEFAULT_PIPELINE_ID = '6a5e56c5cffef700346f56d5'; // Expansão [V4]

// label do custom field no RD -> chave no JSON de saída
const CUSTOM_FIELD_MAP = {
  'Capital disponível': 'capitalDisponivel',
  'Cidade do lead': 'cidadeDoLead',
  'Campanha (utm_campaign)': 'utmCampaign',
  'Anúncio (utm_content)': 'utmContent',
  'Conjunto / Palavra-chave (utm_term)': 'utmTerm',
  'Click ID (gclid/fbclid)': 'clickId',
  '_fbp': 'fbp',
};

async function fetchAllDeals(token, pipelineId) {
  let all = [];
  let nextPage = null;
  let guard = 0;

  do {
    const url = new URL(`${RD_BASE}/deals`);
    url.searchParams.set('token', token);
    url.searchParams.set('deal_pipeline_id', pipelineId);
    url.searchParams.set('limit', '200');
    if (nextPage) url.searchParams.set('next_page', nextPage);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`RD Station respondeu ${res.status} ao buscar deals`);
    }
    const json = await res.json();
    all = all.concat(json.deals || []);
    nextPage = json.has_more ? json.next_page : null;
    guard++;
  } while (nextPage && guard < 30); // trava de segurança contra loop infinito

  return all;
}

function flattenDeal(deal) {
  const customFields = {};
  (deal.deal_custom_fields || []).forEach((cf) => {
    const label = cf.custom_field && cf.custom_field.label;
    const key = CUSTOM_FIELD_MAP[label];
    if (key) customFields[key] = typeof cf.value === 'string' ? cf.value.trim() : cf.value ?? null;
  });

  const status = deal.win === null ? 'aberto' : deal.win ? 'ganho' : 'perdido';

  return {
    id: deal.id,
    name: deal.name || '',
    stage: deal.deal_stage ? deal.deal_stage.name : null,
    status,
    win: deal.win,
    createdAt: deal.created_at || null,
    updatedAt: deal.updated_at || null,
    closedAt: deal.closed_at || null,
    predictionDate: deal.prediction_date || null,
    amountTotal: deal.amount_total || 0,
    amountUnique: deal.amount_unique || 0,
    rating: deal.rating ?? null,
    source: deal.deal_source ? deal.deal_source.name : null,
    owner: deal.user ? deal.user.name : null,
    lostReason: deal.deal_lost_reason ? deal.deal_lost_reason.name : null,
    ...customFields,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const token = process.env.RD_CRM_TOKEN;
  const pipelineId = process.env.RD_PIPELINE_ID || DEFAULT_PIPELINE_ID;

  if (!token) {
    res.status(500).json({ error: 'RD_CRM_TOKEN não configurado no ambiente.' });
    return;
  }

  try {
    const rawDeals = await fetchAllDeals(token, pipelineId);
    const deals = rawDeals.map(flattenDeal);

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({ deals, total: deals.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: 'Falha ao buscar dados do RD Station CRM.', detail: err.message });
  }
};
