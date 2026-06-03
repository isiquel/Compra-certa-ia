export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    const { q, maxPrice, limit = 12, priority = "beneficio" } = req.query;

    if (!q || !String(q).trim()) {
      return res.status(400).json({
        ok: false,
        message: "Digite o produto para buscar."
      });
    }

    const termo = String(q).trim();
    const quantidade = Math.min(Number(limit) || 12, 50);

    const params = new URLSearchParams();
    params.set("q", termo);
    params.set("limit", String(quantidade));

    const url = `https://api.mercadolibre.com/sites/MLB/search?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let resposta;
    let textoResposta = "";

    try {
      resposta = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json"
        },
        signal: controller.signal
      });

      textoResposta = await resposta.text();
    } finally {
      clearTimeout(timeout);
    }

    if (!resposta.ok) {
      return res.status(502).json({
        ok: false,
        message: "O Mercado Livre recusou ou falhou na consulta.",
        statusMercadoLivre: resposta.status,
        detalhe: textoResposta.slice(0, 500),
        urlConsultada: url
      });
    }

    let data;

    try {
      data = JSON.parse(textoResposta);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        message: "O Mercado Livre respondeu, mas não retornou JSON válido.",
        detalhe: textoResposta.slice(0, 500)
      });
    }

    let products = Array.isArray(data.results) ? data.results : [];

    products = products
      .filter(item => item && item.id && item.title && item.price && item.permalink)
      .map(item => {
        return {
          id: item.id,
          title: item.title,
          price: Number(item.price || 0),
          thumbnail: trocarImagemParaHttps(item.thumbnail || ""),
          permalink: item.permalink,
          condition: item.condition || "",
          sold_quantity: Number(item.sold_quantity || 0),
          free_shipping: !!(item.shipping && item.shipping.free_shipping),
          installments: item.installments
            ? {
                quantity: item.installments.quantity,
                amount: item.installments.amount
              }
            : null,
          state_name:
            item.address && item.address.state_name
              ? item.address.state_name
              : "Brasil"
        };
      });

    if (maxPrice && Number(maxPrice) > 0) {
      products = products.filter(p => p.price <= Number(maxPrice));
    }

    if (priority === "novo") {
      products = products.filter(p => p.condition === "new");
    }

    products = calcularNotas(products);

    if (priority === "barato") {
      products.sort((a, b) => a.price - b.price);
    } else if (priority === "popular") {
      products.sort((a, b) => b.sold_quantity - a.sold_quantity);
    } else {
      products.sort((a, b) => b.score - a.score);
    }

    return res.status(200).json({
      ok: true,
      total: products.length,
      termo,
      products
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro interno ao buscar produtos.",
      detail: error.message
    });
  }
}

function calcularNotas(products) {
  if (!products.length) return [];

  const precos = products.map(p => p.price).filter(p => p > 0);
  const menorPreco = precos.length ? Math.min(...precos) : 0;
  const maiorVendido = Math.max(...products.map(p => p.sold_quantity || 0), 1);

  return products.map(p => {
    const precoScore =
      menorPreco > 0 && p.price > 0
        ? Math.min(100, (menorPreco / p.price) * 100)
        : 40;

    const vendidoScore =
      maiorVendido > 0
        ? Math.min(100, (p.sold_quantity / maiorVendido) * 100)
        : 20;

    const freteScore = p.free_shipping ? 12 : 0;
    const novoScore = p.condition === "new" ? 8 : 0;

    const score = Math.round(
      precoScore * 0.55 +
      vendidoScore * 0.30 +
      freteScore +
      novoScore
    );

    return {
      ...p,
      score: Math.min(score, 100)
    };
  });
}

function trocarImagemParaHttps(url) {
  if (!url) return "";
  return String(url).replace("http://", "https://");
}
