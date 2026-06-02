export default async function handler(req, res) {
  try {
    const { q, maxPrice, limit = 12, priority = "beneficio" } = req.query;

    if (!q || !String(q).trim()) {
      return res.status(400).json({
        ok: false,
        message: "Digite o produto para buscar."
      });
    }

    const quantidade = Math.min(Number(limit) || 12, 50);

    const params = new URLSearchParams();
    params.set("q", String(q).trim());
    params.set("limit", String(quantidade));

    const url = `https://api.mercadolibre.com/sites/MLB/search?${params.toString()}`;

    const resposta = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "CompraCertaIA/1.0"
      }
    });

    if (!resposta.ok) {
      return res.status(500).json({
        ok: false,
        message: "Erro ao consultar Mercado Livre."
      });
    }

    const data = await resposta.json();

    let products = Array.isArray(data.results) ? data.results : [];

    products = products
      .filter(item => item && item.id && item.title && item.price && item.permalink)
      .map(item => {
        return {
          id: item.id,
          title: item.title,
          price: Number(item.price || 0),
          thumbnail: item.thumbnail || "",
          permalink: item.permalink,
          condition: item.condition || "",
          sold_quantity: Number(item.sold_quantity || 0),
          free_shipping: !!(item.shipping && item.shipping.free_shipping),
          installments: item.installments ? {
            quantity: item.installments.quantity,
            amount: item.installments.amount
          } : null,
          state_name: item.address && item.address.state_name ? item.address.state_name : "Brasil"
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
  const menorPreco = Math.min(...precos);
  const maiorVendido = Math.max(...products.map(p => p.sold_quantity || 0), 1);

  return products.map(p => {
    const precoScore = menorPreco > 0 ? Math.min(100, (menorPreco / p.price) * 100) : 40;
    const vendidoScore = maiorVendido > 0 ? Math.min(100, (p.sold_quantity / maiorVendido) * 100) : 20;
    const freteScore = p.free_shipping ? 12 : 0;
    const novoScore = p.condition === "new" ? 8 : 0;

    const score = Math.round(
      (precoScore * 0.55) +
      (vendidoScore * 0.30) +
      freteScore +
      novoScore
    );

    return {
      ...p,
      score: Math.min(score, 100)
    };
  });
}
