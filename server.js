// api/server.js
// ====================================================================
// App Express + sessão em PostgreSQL + autenticação simples (sem hash)
// Compatível com ESM ("type": "module") e Functions do Vercel
// ====================================================================

import express from "express";
import cors from "cors";
import path from "path";
import session from "express-session";
import pgPkg from "pg";
import ExcelJS from "exceljs"; // (mantido caso você use em rotas futuras)
import connectPgSimple from "connect-pg-simple";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------
// ESM __dirname
// ---------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------
// Config base
// ---------------------------------------------------------------
const app = express();
const port = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_VERCEL = !!process.env.VERCEL;

// ---------------------------------------------------------------
// Banco (Neon) — exige DATABASE_URL
// ---------------------------------------------------------------
const { Pool } = pgPkg;

const PG_CONN = process.env.DATABASE_URL;
if (!PG_CONN) {
  console.error("Faltou DATABASE_URL no ambiente. Configure e rode de novo.");
  throw new Error("DATABASE_URL ausente");
}

const pool = new Pool({
  connectionString: PG_CONN,
  ssl: { rejectUnauthorized: false }, // Neon/Cloud exige SSL
});

// Cria tabela users se não existir
async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id            bigserial PRIMARY KEY,
      username      text UNIQUE NOT NULL,
      password_hash text NOT NULL,  -- senha em TEXTO PURO (uso interno)
      is_active     boolean NOT NULL DEFAULT true,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
  `);
}
ensureUsersTable().catch((e) =>
  console.error("Falha ao garantir tabela users:", e)
);

// ---------------------------------------------------------------
// App base
// ---------------------------------------------------------------
app.set("trust proxy", 1);

app.use(express.json({ limit: "1gb" }));
app.use(express.urlencoded({ limit: "1gb", extended: true }));

// CORS: ajuste FRONT_ORIGIN para seu domínio do Vercel, ex: https://seu-app.vercel.app
// Se não setar, usa 'true' (reflete o Origin e permite credenciais).
const FRONT_ORIGIN = process.env.FRONT_ORIGIN || true;
app.use(
  cors({
    origin: FRONT_ORIGIN,
    credentials: true,
  })
);

// Sessão persistida no Postgres
const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      conObject: {
        connectionString: PG_CONN,
        ssl: { rejectUnauthorized: false },
      },
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.COOKIE_SECRET || "uma-chave-secreta",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: NODE_ENV === "production", // exige HTTPS em produção
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
    name: "connect.sid",
  })
);

// ---------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------
async function getUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT id, username, password_hash AS password, is_active
     FROM public.users
     WHERE username = $1`,
    [username]
  );
  return rows[0] || null;
}

async function handleLogin(req, res) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Dados obrigatórios" });
    }

    const user = await getUserByUsername(username);
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Comparação direta (sem hash) — uso interno
    if (String(user.password) !== String(password)) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    req.session.user = { id: user.id, username: user.username };
    req.session.justLoggedIn = true;
    return res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Erro no login:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
}

async function handleRegister(req, res) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Dados obrigatórios" });
    }

    await pool.query(
      `INSERT INTO public.users (username, password_hash, is_active)
       VALUES ($1, $2, true)`,
      [username, password]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Usuário já existe" });
    }
    console.error("Erro no register:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
}

function handleLogout(req, res) {
  req.session.destroy(() => {
    res.clearCookie("connect.sid", { path: "/" });
    res.json({ ok: true });
  });
}

function handleMe(req, res) {
  if (!req.session.user) return res.status(401).json({ error: "Não autorizado" });
  res.json({ ok: true, user: req.session.user });
}

// Rotas auth
app.post(["/login", "/api/auth/login"], handleLogin);
app.post(["/register", "/api/auth/register"], handleRegister);
app.post(["/logout", "/api/auth/logout"], handleLogout);
app.get(["/me", "/api/auth/me"], handleMe);

// ---------------------------------------------------------------
// Proteção de rotas (API-first, sem redirecionar para login.html)
// ---------------------------------------------------------------
app.use((req, res, next) => {
  const openPaths = new Set([
    "/login",
    "/register",
    "/logout",
    "/healthz",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/logout",
    "/api/auth/me",
  ]);

  const isStatic =
    /\.(html|css|js|png|ico|avif|webp|jpg|jpeg|svg|map|json|txt|csv|wasm)$/i.test(
      req.path
    );

  // Arquivos estáticos e caminhos abertos passam direto
  if (isStatic || [...openPaths].some((p) => req.path.startsWith(p))) {
    return next();
  }

  // Protege apenas /api/*
  if (req.path.startsWith("/api/")) {
    if (!req.session.user) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    return next();
  }

  // Qualquer outra rota (front SPA) deixamos seguir — o front decide o que mostrar
  return next();
});

// ---------------------------------------------------------------
// Static (útil para rodar localmente: serve /public)
// Em produção no Vercel, a parte estática vem do build do front.
// ---------------------------------------------------------------
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------------------------------------------------------------
// APIs do app (postes)
// ---------------------------------------------------------------
let cachePostes = null;
let cacheTs = 0;
const CACHE_TTL = 10 * 60 * 1000;

app.get("/api/postes", async (req, res) => {
  const now = Date.now();
  if (cachePostes && now - cacheTs < CACHE_TTL) {
    return res.json(cachePostes);
  }

  const sql = `
    SELECT d.id, d.nome_municipio, d.nome_bairro, d.nome_logradouro,
           d.material, d.altura, d.tensao_mecanica, d.coordenadas,
           ep.empresa
    FROM dados_poste d
    LEFT JOIN empresa_poste ep ON d.id::text = ep.id_poste
    WHERE d.coordenadas IS NOT NULL AND TRIM(d.coordenadas) <> ''
  `;

  try {
    const { rows } = await pool.query(sql);
    cachePostes = rows;
    cacheTs = now;
    res.json(rows);
  } catch (err) {
    console.error("Erro em /api/postes:", err);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.get("/api/censo", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT poste, cidade, coordenadas
      FROM censo_municipio
      WHERE coordenadas IS NOT NULL AND TRIM(coordenadas) <> ''
    `);
    res.json(rows);
  } catch (err) {
    console.error("Erro em /api/censo:", err);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

// ---------------------------------------------------------------
// Healthcheck & debug
// ---------------------------------------------------------------
app.get("/healthz", (req, res) => res.json({ ok: true }));

if (NODE_ENV !== "production") {
  app.get("/api/auth/debug-db", async (req, res) => {
    try {
      const ping = await pool.query("SELECT 1 as ok");
      const count = await pool.query("SELECT count(*)::int AS users FROM public.users");
      res.json({ ok: true, ping: ping.rows[0].ok === 1, users: count.rows[0].users });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// ---------------------------------------------------------------
// Start local / Export Vercel
// ---------------------------------------------------------------
if (!IS_VERCEL) {
  app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port} (${NODE_ENV})`);
  });
}

export default app;
