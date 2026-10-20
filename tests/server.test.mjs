import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,openDatabase,migrateAccount} from '../server.js';

test('migration copies only authenticated records, paginates, tolerates missing study table',async()=>{
  const calls=[];
  const result=await migrateAccount('old@example.com','password123',async(url,options)=>{
    calls.push(url);
    if(url.includes('/token?')) return Response.json({user:{id:'old',email:'old@example.com'},access_token:'test'});
    if(url.includes('/logout?')) return Response.json({});
    assert.equal(options.headers.Authorization,'Bearer test');
    assert.ok(url.includes('user_id=eq.old'));
    if(url.includes('study_sessions')) return Response.json({code:'PGRST205'},{status:404});
    if(url.includes('offset=0')) return Response.json(Array.from({length:500},(_,i)=>({id:`attempt-${i}`,user_id:'old',state:{},total:75})));
    return Response.json([{id:'last-attempt',user_id:'old',state:{},total:75}]);
  });
  assert.equal(result.id,'old');assert.equal(result.records.attempts.length,501);assert.deepEqual(result.records.study_sessions,[]);
  assert.ok(calls.some(url=>url.includes('offset=500')));
  await assert.rejects(migrateAccount('old@example.com','password123',async(url)=>url.includes('/token?')?Response.json({user:{id:'old',email:'old@example.com'},access_token:'test'}):Response.json({},{status:500})),/Nenhuma conta foi migrada/);
});

test('new local registrations work after disabling the migration source',async t=>{
  process.env.DISABLE_SUPABASE_MIGRATION='1';
  const db=openDatabase(':memory:');
  const server=createApp({db});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{delete process.env.DISABLE_SUPABASE_MIGRATION;await new Promise(resolve=>server.close(resolve));db.close();});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/signup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'new@example.com',password:'password123'})});
  assert.equal(response.status,200);
  assert.equal((await response.json()).session.user.email,'new@example.com');
});

test('SQLite authentication, migration, isolation, sessions and restart persistence',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cis-db-'));
  const filename=join(dir,'db.sqlite');
  let db=openDatabase(filename);
  const migrations=[];
  const server=createApp({db,migrate:async(email,password)=>{
    migrations.push(email);
    if(password!=='password123') return null;
    const id=email.split('@')[0];
    return {id,email,records:{attempts:[{id:`initial-${id}`,user_id:id,started_at:'2026-01-01',total:75,state:{ids:[]}}],study_sessions:[]}};
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function call(path,body,cookie,headers={}) {
    return fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();await rm(dir,{recursive:true,force:true});});
  assert.equal((await call('/api/attempts')).status,401);
  assert.equal((await call('/api/login',{email:'alice@example.com',password:'wrongpass'})).status,401);
  const login=await call('/api/login',{email:'alice@example.com',password:'password123'});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await login.json()).session.user.id,'alice');
  assert.equal((await (await call('/api/attempts',undefined,cookie)).json()).length,1);
  assert.equal((await (await call('/api/session',undefined,cookie)).json()).session.user.email,'alice@example.com');
  const row={id:'new',user_id:'alice',started_at:'2026-10-20',total:75,state:{ids:['1'],answers:{'1':[0]}}};
  assert.equal((await call('/api/attempts',row,cookie)).status,200);
  assert.equal((await call('/api/study_sessions',{...row,id:'study',total:205},cookie)).status,200);
  const bob=await call('/api/login',{email:'bob@example.com',password:'password123'});
  const bobCookie=bob.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await call('/api/attempts',undefined,bobCookie)).json()).length,1);
  assert.equal((await call('/api/attempts',row,bobCookie)).status,400);
  assert.equal((await call('/api/attempts',{...row,user_id:'bob'},bobCookie)).status,403);
  assert.equal((await call('/api/attempts',row,cookie,{Origin:'https://evil.test'})).status,403);
  for(const path of ['/data/database.sqlite','/server.js','/config.js','/.git/config']) assert.equal((await call(path)).status,404);
  assert.equal((await call('/')).status,200);
  assert.equal((await call('/api/logout',{},cookie)).status,200);
  assert.equal((await call('/api/attempts',undefined,cookie)).status,401);
  const before=migrations.length;
  const relogin=await call('/api/login',{email:'alice@example.com',password:'password123'});
  assert.equal(relogin.status,200);assert.equal(migrations.length,before);
  assert.notEqual(db.prepare('SELECT password FROM users WHERE id=?').get('alice').password,'password123');
  // Reopen file separately to prove records and credentials survive process restarts.
  const reopened=openDatabase(filename);
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM records WHERE user_id=?').get('alice').n,3);
  reopened.close();
});
