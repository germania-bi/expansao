// Proxy serverless: busca campanhas + métricas do Meta Ads (Graph API) e devolve
// no formato que o dashboard já espera. Token nunca sai do backend.

const GRAPH_VERSION = 'v21.0';

async function fetchAllPages(firstUrl) {
  let all = [];
  let url = firstUrl;
  let guard = 0;
  while (url && guard < 20) {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'Erro na API do Meta');
    all = all.concat(json.data || []);
    url = json.paging && json.paging.next ? json.paging.next : null;
    guard++;
  }
  return all;
}

async function fetchInsights(token, account, since, until) {
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${account}/insights?level=campaign&fields=campaign_id,campaign_name,spend,clicks,reach,cpc,ctr,cpm&time_range=${timeRange}&limit=200&access_token=${token}`;
  return fetchAllPages(url);
}

async function fetchCampaignStatus(token, account) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${account}/campaigns?fields=id,name,effective_status&limit=200&access_token=${token}`;
  return fetchAllPages(url);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID;

  if (!token || !account) {
    res.status(500).json({ error: 'Credenciais do Meta Ads não configuradas.' });
    return;
  }

  const since = req.query.since;
  const until = req.query.until;
  if (!since || !until) {
    res.status(400).json({ error: 'Parâmetros since e until são obrigatórios (YYYY-MM-DD).' });
    return;
  }

  try {
    const [insights, campaigns] = await Promise.all([
      fetchInsights(token, account, since, until),
      fetchCampaignStatus(token, account),
    ]);

    const statusPorId = {};
    campaigns.forEach((c) => { statusPorId[c.id] = c.effective_status; });

    const data = insights.map((i) => ({
      name: i.campaign_name,
      spend: Number(i.spend) || 0,
      clicks: Number(i.clicks) || 0,
      reach: Number(i.reach) || 0,
      cpc: Number(i.cpc) || 0,
      ctr: Number(i.ctr) || 0,
      cpm: Number(i.cpm) || 0,
      status: statusPorId[i.campaign_id] || 'UNKNOWN',
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Falha ao buscar dados do Meta Ads.', detail: err.message });
  }
};
