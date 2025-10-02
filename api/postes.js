// api/postes.js  (Vercel Serverless Function; ESM)
// Lista os postes a partir de public.dados_poste (sem empresa_poste)

import pkg from "pg";
const { Pool } = pkg;

// singleton do pool entre invocações
const pool =
  globalThis.__pg_pool ||
  (globalThis.__pg_pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  }));

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        d.id,
        d.nome_municipio,
        d.nome_bairro,
        d.nome_logradouro,
        d.material,
        d.altura,
        d.tensao_mecanica,
        d.coordenadas,
        NULL::text AS empresa   -- compatível com o front
      FROM public.dados_poste d
      WHERE d.coordenadas IS NOT NULL AND TRIM(d.coordenadas) <> ''
    `);

    res.status(200).json(rows);
  } catch (err) {
    console.error("ERRO /api/postes:", err);
    res.status(500).json({ error: "Erro no servidor" });
  }
}
