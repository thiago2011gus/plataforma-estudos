/* Study cloud sync — Supabase */
(() => {
  const SUPABASE_URL = 'https://eplfwhesuqdhlrkwfarl.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_JS9P242moE37xp_1uD22XQ_yYacxqek';
  const META_KEY = '__study_cloud_sync_meta_v1';
  const INTERNAL_PREFIXES = ['sb-', 'supabase.auth.'];
  /* Preferências visuais ficam neste navegador: a nuvem não deve trocar o tema no recarregamento. */
  const LOCAL_ONLY_KEYS = new Set(['study_theme','study_darkness','study_appearance']);
  let client, user, busy = false, timer = null, lastLocal = {}, lastRemote = {}, firstSync = true;

  const $ = (tag, attrs = {}, text = '') => {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => k === 'style' ? Object.assign(el.style,v) : el.setAttribute(k,v));
    if (text) el.textContent = text;
    return el;
  };
  const btn = (label, fn, cls='') => { const b=$('button',{type:'button',class:cls},label); b.addEventListener('click',fn); return b; };
  function eligibleKeys(){
    const out=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(!k || k===META_KEY || LOCAL_ONLY_KEYS.has(k) || INTERNAL_PREFIXES.some(p=>k.startsWith(p))) continue;
      out.push(k);
    }
    return out;
  }
  function readLocal(){
    const o={}; eligibleKeys().forEach(k=>{ try{o[k]=JSON.parse(localStorage.getItem(k));}catch{o[k]=localStorage.getItem(k);} }); return o;
  }
  function writeLocal(o){
    Object.entries(o||{}).forEach(([k,v])=>{
      if(k===META_KEY || LOCAL_ONLY_KEYS.has(k) || INTERNAL_PREFIXES.some(p=>k.startsWith(p))) return;
      try{localStorage.setItem(k,JSON.stringify(v));}catch(e){console.warn('Study sync: não foi possível gravar',k,e);}
    });
  }
  function equal(a,b){ try{return JSON.stringify(a)===JSON.stringify(b)}catch{return a===b} }
  function mergeValue(local, cloud){
    if(local===undefined) return cloud;
    if(cloud===undefined) return local;
    if(Array.isArray(local)&&Array.isArray(cloud)){
      const out=[...cloud], seen=new Set(cloud.map(x=>stableId(x)));
      local.forEach(x=>{const id=stableId(x);if(!seen.has(id)){out.push(x);seen.add(id)}else if(id.startsWith('json:')&&!out.some(y=>equal(y,x)))out.push(x);});
      return out;
    }
    if(local&&cloud&&typeof local==='object'&&typeof cloud==='object'&&!Array.isArray(local)&&!Array.isArray(cloud)){
      const out={...cloud}; Object.keys(local).forEach(k=>out[k]=mergeValue(local[k],cloud[k])); return out;
    }
    return local;
  }
  function stableId(x){ if(x&&typeof x==='object'){const id=x.id??x.uuid??x.key; if(id!==undefined)return 'id:'+String(id);} return 'json:'+JSON.stringify(x); }
  function mergeMaps(a,b){const out={...b};Object.keys(a).forEach(k=>out[k]=mergeValue(a[k],b[k]));return out;}
  function setStatus(s){const el=document.getElementById('studySyncStatus');if(el)el.textContent=s;}
  function ensureUI(){
    if(document.getElementById('studySyncButton'))return;
    const style=$('style'); style.textContent=`
#studySyncButton{position:fixed;right:18px;bottom:18px;top:auto;z-index:99990;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line,#ddd);border-radius:50%;padding:0;background:var(--surface,#fff);color:var(--text,#202825);font:600 20px system-ui;box-shadow:0 4px 18px #0002;cursor:pointer} #studySyncButton:hover{border-color:var(--accent,#2f6254)}
#studySyncPanel{position:fixed;right:18px;bottom:72px;top:auto;z-index:99991;width:min(360px,calc(100vw - 28px));background:var(--surface,#fff);color:var(--text,#202825);border:1px solid var(--line,#ddd);border-radius:16px;padding:18px;box-shadow:0 10px 35px #0003;font:14px system-ui;display:none}
#studySyncPanel h3{margin:0 0 8px;font-size:17px}#studySyncPanel p{line-height:1.45;color:var(--muted,#777)}
#studySyncPanel input{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border:1px solid var(--line,#ccc);border-radius:8px;background:var(--surface2,#fff);color:var(--text,#222)}
#studySyncPanel button{border:0;border-radius:8px;padding:9px 12px;margin:4px 4px 4px 0;cursor:pointer;background:var(--accent,#2f6254);color:white}
#studySyncPanel button.secondary{background:var(--surface2,#eee);color:var(--text,#222);border:1px solid var(--line,#ddd)}
#studySyncStatus{font-size:12px;margin-top:8px;overflow-wrap:anywhere}`;
    document.head.appendChild(style);
    const toggle=btn('♙',()=>{const p=document.getElementById('studySyncPanel');p.style.display=p.style.display==='block'?'none':'block';});
    toggle.title='Conta e sincronização';toggle.setAttribute('aria-label','Abrir conta e sincronização');
    toggle.id='studySyncButton';document.body.appendChild(toggle);
    const panel=$('section',{id:'studySyncPanel','aria-label':'Sincronização do Study'});
    panel.appendChild($('h3',{},'Study na nuvem'));
    panel.appendChild($('p',{},'Entre com o mesmo e-mail no celular e no computador para compartilhar seus dados.'));
    const email=$('input',{type:'email',id:'studySyncEmail',placeholder:'Seu e-mail',autocomplete:'email'});
    const pass=$('input',{type:'password',id:'studySyncPassword',placeholder:'Senha',autocomplete:'current-password'});
    panel.append(email,pass);
    panel.appendChild(btn('Entrar',()=>auth('signin',email.value,pass.value)));
    panel.appendChild(btn('Criar conta',()=>auth('signup',email.value,pass.value),'secondary'));
    panel.appendChild(btn('Sair',async()=>{if(client)await client.auth.signOut();user=null;stopSync();renderLoggedOut();document.getElementById('studySyncButton').textContent='♙';setStatus('Sessão encerrada. Os dados locais permanecem neste dispositivo.');},'secondary'));
    const status=$('div',{id:'studySyncStatus'},'Não conectado. Os dados ainda ficam neste dispositivo até entrar na conta.');
    panel.appendChild(status);
    const note=$('p');note.style.fontSize='11px';note.textContent='Na primeira conexão, os registros serão combinados; em conflitos simples, os valores deste dispositivo prevalecem. Faça uma cópia de segurança antes de usar em vários dispositivos.';panel.appendChild(note);
    document.body.appendChild(panel);
  }
  function renderLoggedOut(){const p=document.getElementById('studySyncPanel');if(!p)return;const inputs=p.querySelectorAll('input');inputs.forEach(i=>i.style.display='');}
  async function auth(mode,email,password){
    if(!client){setStatus('A biblioteca de sincronização ainda está carregando. Atualize a página e tente novamente.');return;}
    if(!email||!password){setStatus('Informe e-mail e senha.');return;}
    setStatus(mode==='signup'?'Criando conta…':'Entrando…');
    try{
      const res=mode==='signup'?await client.auth.signUp({email,password,options:{emailRedirectTo:'https://thiago2011gus.github.io/plataforma-estudos/'}}):await client.auth.signInWithPassword({email,password});
      if(res.error)throw res.error;
      if(mode==='signup'&&!res.data.session){setStatus('Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre.');return;}
      user=res.data.user;
      if(user){document.getElementById('studySyncEmail').style.display='none';document.getElementById('studySyncPassword').style.display='none';setStatus('Conectado como '+user.email+' — preparando sincronização…');document.getElementById('studySyncButton').textContent='♙';await syncOnce(true);startSync();}
    }catch(e){setStatus('Erro de autenticação: '+(e.message||'verifique e-mail e senha.'));}
  }
  async function fetchCloud(){
    const {data,error}=await client.from('study_sync').select('payload,updated_at').eq('user_id',user.id).maybeSingle();
    if(error)throw error;return data;
  }
  async function pushCloud(payload){
    const {error}=await client.from('study_sync').upsert({user_id:user.id,payload,updated_at:new Date().toISOString()},{onConflict:'user_id'});
    if(error)throw error;
  }
  async function syncOnce(isFirst=false){
    if(!user||busy)return;busy=true;
    try{
      const local=readLocal(), row=await fetchCloud(), cloud=row?.payload||{};
      let merged;
      if(!row){merged=local;await pushCloud(merged);setStatus('Primeira cópia enviada à nuvem.');}
      else if(isFirst||firstSync){merged=mergeMaps(local,cloud);writeLocal(merged);await pushCloud(merged);setStatus('Dados locais e da nuvem combinados. Sincronização ativa.');}
      else {
        const localNow=readLocal(), localChanged={}, remoteChanged={};
        Object.keys({...lastLocal,...localNow}).forEach(k=>{if(!equal(localNow[k],lastLocal[k]))localChanged[k]=localNow[k];});
        Object.keys({...lastRemote,...cloud}).forEach(k=>{if(!equal(cloud[k],lastRemote[k]))remoteChanged[k]=cloud[k];});
        merged={...cloud,...localNow};
        Object.keys(remoteChanged).forEach(k=>{if(!(k in localChanged))merged[k]=cloud[k];else merged[k]=mergeValue(localChanged[k],cloud[k]);});
        writeLocal(merged);
        if(!equal(merged,cloud))await pushCloud(merged);
        setStatus('Sincronizado · '+new Date().toLocaleTimeString());
      }
      lastLocal=readLocal();lastRemote=merged;firstSync=false;
    }catch(e){setStatus('Falha na sincronização: '+(e.message||'tente novamente em instantes.'));console.error('Study sync',e);}
    finally{busy=false;}
  }
  function startSync(){stopSync();syncOnce(true);timer=setInterval(()=>syncOnce(false),7000);if(client&&user){client.channel('study-sync-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'study_sync',filter:'user_id=eq.'+user.id},()=>syncOnce(false)).subscribe();}}
  function stopSync(){if(timer)clearInterval(timer);timer=null;if(client&&user)client.removeAllChannels();}
  async function init(){
    ensureUI();
    const tag=document.createElement('script');tag.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';tag.onload=async()=>{
      try{
        client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
        const {data}=await client.auth.getSession();
        if(data.session){user=data.session.user;document.getElementById('studySyncEmail').style.display='none';document.getElementById('studySyncPassword').style.display='none';setStatus('Conectado como '+user.email+' — sincronizando…');document.getElementById('studySyncButton').textContent='♙ '+user.email;startSync();}
      }catch(e){setStatus('Não foi possível iniciar a sincronização.');}
    };tag.onerror=()=>setStatus('Não foi possível carregar a biblioteca Supabase. Verifique a conexão e recarregue a página.');
    document.head.appendChild(tag);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();