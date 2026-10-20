import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname, join, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from './config.js';

const scrypt = promisify(scryptCallback);
const root = dirname(fileURLToPath(import.meta.url));
const hashToken = value => createHash('sha256').update(value).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), {status});
const tables = new Set(['attempts','study_sessions']);

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL, PRIMARY KEY(kind,id));`);
  return db;
}

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(await scrypt(password,salt,64),Buffer.from(hash,'hex'));
}

// Only the signed-in user's rows are exported. No administrator secret is used.
export async function migrateAccount(email, password, fetcher = fetch) {
  if (!config.supabaseUrl || !config.supabaseKey || process.env.DISABLE_SUPABASE_MIGRATION === '1') return null;
  const headers = {apikey:config.supabaseKey,'Content-Type':'application/json'};
  let response;
  try {
    response = await fetcher(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method:'POST',headers,body:JSON.stringify({email,password}),signal:AbortSignal.timeout(15000)
    });
  } catch { throw httpError(503,'Não foi possível acessar a origem da migração. Tente novamente.'); }
  if ([400,401,422].includes(response.status)) return null;
  if (!response.ok) throw httpError(503,'O Supabase não permitiu a migração agora. Tente novamente.');
  const session = await response.json();
  if (!session.user?.id || !session.access_token) throw httpError(502,'Resposta inválida da origem.');
  const records = {};
  try {
    for (const table of tables) {
      records[table] = [];
      for (let offset=0;;offset+=500) {
        const query = new URLSearchParams({select:'*',user_id:`eq.${session.user.id}`,order:'id.asc',limit:'500',offset:String(offset)});
        const result = await fetcher(`${config.supabaseUrl}/rest/v1/${table}?${query}`, {
          headers:{...headers,Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(15000)
        });
        // Older installations might not have the study table yet.
        if (table === 'study_sessions' && result.status === 404 && (await result.json()).code === 'PGRST205') break;
        if (!result.ok) throw new Error('Falha ao copiar histórico.');
        const rows = await result.json();
        if (!Array.isArray(rows) || rows.some(row=>row.user_id!==session.user.id || typeof row.id!=='string' || !row.state)) throw new Error('Dados inválidos na origem.');
        records[table].push(...rows);
        if (rows.length < 500) break;
      }
    }
    return {id:session.user.id,email:session.user.email.toLowerCase(),records};
  } catch { throw httpError(503,'A cópia do histórico falhou. Nenhuma conta foi migrada; tente novamente.'); }
  finally {
    // Close only the temporary session used for the copy.
    try { await fetcher(`${config.supabaseUrl}/auth/v1/logout?scope=local`,{method:'POST',headers:{...headers,Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(5000)}); } catch {}
  }
}

async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text)>1024*1024) throw httpError(413,'Dados muito grandes.');
  }
  try { return JSON.parse(text); } catch { throw httpError(400,'JSON inválido.'); }
}

export function createApp({db, migrate=migrateAccount} = {}) {
  const rate = new Map();
  const server = createServer(async(req,res)=>{
    const send = (status,data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const path = new URL(req.url,'http://localhost').pathname;
      if (!path.startsWith('/api/')) {
        // Explicit allowlist: database, source server, backups and credentials are never served.
        const name = decodeURIComponent(path === '/' ? 'index.html' : path.slice(1));
        const allowed = new Set(['index.html','styles.css','app.js','local-client.js','quiz.js','study.js','study-view.js','questoes-1-corrigida (1).json','questoes-2-corrigida-v2 (1).json','questoes-3-corrigida-v2 (1).json']);
        if (!allowed.has(name) || !['GET','HEAD'].includes(req.method)) throw httpError(404,'Arquivo não encontrado.');
        const content = await readFile(join(root,name));
        res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'})[extname(name)],'X-Content-Type-Options':'nosniff'});
        res.end(req.method==='HEAD'?undefined:content);return;
      }
      if (req.method === 'POST') {
        const origin = process.env.PUBLIC_ORIGIN || `${req.socket.encrypted?'https':'http'}://${req.headers.host}`;
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) throw httpError(403,'Origem não permitida.');
        if (!req.headers['content-type']?.startsWith('application/json')) throw httpError(415,'Use application/json.');
      }
      const token = /(?:^|;\s*)cis_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];
      const current = token ? db.prepare('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(hashToken(token),Date.now()) : null;
      if (path === '/api/session' && req.method === 'GET') {send(200,{session:current?{user:current}:null});return;}
      if (['/api/signup','/api/login'].includes(path) && req.method === 'POST') {
        const address = req.socket.remoteAddress;
        const now=Date.now();
        for (const [key,value] of rate) if(value.until<now) rate.delete(key);
        const limit = rate.get(address)||{count:0,until:now+60000};
        if (++limit.count>20) throw httpError(429,'Muitas tentativas. Aguarde um minuto.');
        rate.set(address,limit);
        const body = await readBody(req);
        const email = typeof body.email==='string'?body.email.trim().toLowerCase():'';
        const password = body.password;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || typeof password!=='string' || password.length<8 || password.length>256) throw httpError(400,'Informe um e-mail válido e uma senha de 8 a 256 caracteres.');
        let account = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (account) {
          if(path==='/api/signup') throw httpError(409,'Esta conta já existe. Entre com sua senha.');
          if(!await verifyPassword(password,account.password)) throw httpError(401,'E-mail ou senha inválidos.');
        } else {
          const imported = await migrate(email,password);
          if(!imported && path==='/api/login') throw httpError(401,'E-mail ou senha inválidos.');
          // Until all old accounts are migrated, never create a duplicate identity for an old email.
          if(!imported && path==='/api/signup' && config.supabaseUrl && process.env.DISABLE_SUPABASE_MIGRATION !== '1') {
            throw httpError(409,'Durante a migração, entre com sua conta existente. Para liberar novos cadastros, o administrador deve concluir a migração e desativar a origem.');
          }
          const hash = await passwordHash(password);
          account = {id:imported?.id||randomUUID(),email:imported?.email||email,password:hash};
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('INSERT INTO users(id,email,password) VALUES(?,?,?)').run(account.id,account.email,hash);
            for (const [kind,rows] of Object.entries(imported?.records||{})) for(const row of rows) {
              db.prepare('INSERT INTO records(kind,id,user_id,payload) VALUES(?,?,?,?)').run(kind,row.id,account.id,JSON.stringify(row));
            }
            db.exec('COMMIT');
          } catch(error) {db.exec('ROLLBACK');throw error;}
        }
        const sessionToken = randomBytes(32).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(sessionToken),account.id,Date.now()+7*86400000);
        res.setHeader('Set-Cookie',`cis_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
        send(200,{session:{user:{id:account.id,email:account.email}}});return;
      }
      if (!current) throw httpError(401,'Entre na sua conta para continuar.');
      if (path==='/api/logout' && req.method==='POST') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token));
        res.setHeader('Set-Cookie','cis_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');send(200,{});return;
      }
      const kind = path.slice(5);
      if (!tables.has(kind)) throw httpError(404,'Rota não encontrada.');
      if (req.method==='GET') {
        const rows = db.prepare('SELECT payload FROM records WHERE kind=? AND user_id=?').all(kind,current.id).map(row=>JSON.parse(row.payload));
        rows.sort((a,b)=>b.started_at.localeCompare(a.started_at));send(200,rows);return;
      }
      if (req.method==='POST') {
        const row = await readBody(req);
        if(!row || typeof row.id!=='string' || row.id.length>100 || row.user_id!==current.id || !row.state || typeof row.state!=='object' || !Array.isArray(row.state.ids) || typeof row.started_at!=='string' || !Number.isInteger(row.total) || row.total<1 || row.total>1000) throw httpError(400,'Progresso inválido.');
        const existing = db.prepare('SELECT user_id FROM records WHERE kind=? AND id=?').get(kind,row.id);
        if(existing && existing.user_id!==current.id) throw httpError(403,'Registro de outra conta.');
        db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind,row.id,current.id,JSON.stringify(row));
        send(200,{});return;
      }
      throw httpError(405,'Método não permitido.');
    } catch(error) { if(!error.status) console.error('Falha interna:',error.code||error.name);send(error.status||500,{error:error.status?error.message:'Não foi possível salvar. Tente novamente.'}); }
  });
  return server;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const db = openDatabase(process.env.DB_PATH || join(root,'data','database.sqlite'));
  const server = createApp({db});
  const port = Number(process.env.PORT||3000);
  server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Sala de estudos: http://localhost:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
