// api/postes/report.js  (gera Excel dos IDs enviados)

import pkg from "pg";
import ExcelJS from "exceljs";
const { Pool } = pkg;

const pool =
  globalThis.__pg_pool ||
  (globalThis.__pg_pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  }));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const ids = (req.body?.ids || []).map(String).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "Envie ids[]" });

    const { rows } = await pool.query(
      `
      SELECT
        d.id,
        d.nome_municipio,
        d.nome_bairro,
        d.nome_logradouro,
        d.material,
        d.altura,
        d.tensao_mecanica,
        d.coordenadas
      FROM public.dados_poste d
      WHERE d.id = ANY($1::text[])
      `,
      [ids]
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Postes");
    ws.columns = [
      { header: "ID POSTE", key: "id", width: 15 },
      { header: "Município", key: "nome_municipio", width: 24 },
      { header: "Bairro", key: "nome_bairro", width: 24 },
      { header: "Logradouro", key: "nome_logradouro", width: 36 },
      { header: "Material", key: "material", width: 14 },
      { header: "Altura", key: "altura", width: 10 },
      { header: "Tensão Mecânica", key: "tensao_mecanica", width: 16 },
      { header: "Coordenadas", key: "coordenadas", width: 26 }
    ];
    rows.forEach(r => ws.addRow(r));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="relatorio_postes.xlsx"'
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("ERRO /api/postes/report:", err);
    res.status(500).json({ error: "Erro ao gerar relatório" });
  }
}
