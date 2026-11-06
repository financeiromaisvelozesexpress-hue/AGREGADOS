/* ---------- controle de acesso (perfis MASTER / Operacional / Consultor) ---------- */
window.__rbac = (function(){
  const MODS = [['painel','Painel'],['agregados','Agregados'],['locacoes','Locações'],['feriados','Feriados'],['fechamentos','Fechamentos'],['custos','Custos avulsos']];
  const PERFIS = {master:'MASTER', operacional:'Operacional', consultor:'Consultor'};
  const TAB_MOD = {fechamento:['fechamentos','criar'], historico:['fechamentos','ver'], custos:['custos','ver'], painel:['painel','ver'],
    agregados:['agregados','ver'], locacoes:['locacoes','ver'], feriados:['feriados','ver'], usuarios:['usuarios','ver']};
  const ORDEM = ['fechamento','historico','custos','painel','agregados','locacoes','feriados','usuarios'];
  // seletor -> [módulo, ação]. Sem a permissão: o elemento some e o clique é barrado.
  const REGRAS = [
    ['[data-tab="fechamento"],[data-act="fecharPend"],[data-act="irNovo"],[data-act="gravar"]','fechamentos','criar'],
    ['[data-act="askLote"],[data-act="askItem"],[data-act="delFech"],[data-act="delFechYes"],[data-act="delYes2"]','fechamentos','excluir'],
    ['[data-tab="historico"]','fechamentos','ver'],
    ['[data-tab="custos"]','custos','ver'],
    ['#cform,[data-act="abrirColar"],[data-act="importarColar"]','custos','criar'],
    ['[data-act="editCusto"]','custos','editar'],
    ['[data-act="delCusto"],[data-act="delCustoYes"]','custos','excluir'],
    ['[data-tab="painel"]','painel','ver'],
    ['[data-tab="agregados"]','agregados','ver'], ['[data-act="novoAg"]','agregados','criar'],
    ['[data-tab="locacoes"]','locacoes','ver'], ['[data-act="novaLoc"]','locacoes','criar'],
    ['[data-tab="feriados"]','feriados','ver'], ['[data-act="novoFer"]','feriados','criar'],
    ['[data-act="delAsk"],[data-act="delYes"]','usuarios','excluir'],
    ['[data-tab="usuarios"],[data-act="backupExp"],[data-act="backupImp"]','usuarios','ver']
  ];
  let AC = null;
  const pode = (m,a) => !!(AC && AC.perm && AC.perm[m] && AC.perm[m][a]);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function aviso(t){ const el=document.getElementById('toast'); if(!el) return; el.textContent=t; el.hidden=false; clearTimeout(aviso._t); aviso._t=setTimeout(()=>el.hidden=true,3200); }
  function bloqueia(e){ e.preventDefault(); e.stopImmediatePropagation(); aviso('Sem permissão para esta ação'); }

  function aplicar(ac){
    AC = ac;
    const off = REGRAS.filter(([,m,a]) => !pode(m,a)).map(r => r[0]);
    let st = document.getElementById('rbacCss'); if(!st){ st=document.createElement('style'); st.id='rbacCss'; document.head.appendChild(st); }
    st.textContent = (off.length ? off.join(',')+'{display:none!important}' : '')
      + '#modalRoot[data-rb-lock] button[type="submit"],#modalRoot[data-rb-lock] [data-edadd],#modalRoot[data-rb-lock] [data-eddel]{display:none!important}'
      + '#modalRoot[data-rb-lock] [data-edday]{pointer-events:none}'
      + '.rb-lock-note{font-size:12.5px;color:var(--muted);border:1px dashed var(--line);border-radius:6px;padding:6px 10px}';
    escutarMudancas();
  }

  // abre o cadastro só para leitura quando o perfil não pode editar
  function travarModal(){
    const mr=document.getElementById('modalRoot'); if(!mr||!mr.innerHTML) return;
    mr.dataset.rbLock='1';
    mr.querySelectorAll('input:not([type=hidden]),select,textarea').forEach(el=>el.disabled=true);
    const f=mr.querySelector('form'); if(f && !f.querySelector('.rb-lock-note')){ const n=document.createElement('div'); n.className='rb-lock-note'; n.textContent='Somente leitura: seu perfil não pode editar este cadastro.'; const h=f.querySelector('h3'); if(h) h.after(n); else f.prepend(n); }
  }
  new MutationObserver(()=>{ const mr=document.getElementById('modalRoot'); if(mr && !mr.innerHTML) delete mr.dataset.rbLock; })
    .observe(document.getElementById('modalRoot') || document.body, {childList:true});

  document.addEventListener('click', e=>{
    if(!AC) return;
    const mr=document.getElementById('modalRoot');
    if(mr && mr.dataset.rbLock && mr.contains(e.target) && e.target.closest('[data-edday],[data-edadd],[data-eddel],[data-act="delAsk"],[data-act="delYes"],button[type="submit"]')) return bloqueia(e);
    const t=e.target.closest && e.target.closest('[data-act],[data-tab]');
    if(t) for(const [sel,m,a] of REGRAS){ if(t.matches(sel) && !pode(m,a)) return bloqueia(e); }
    const ed=e.target.closest && e.target.closest('[data-edit-ag],[data-edit-loc],[data-edit-fer],[data-edfech]');
    if(ed){ const m = 'editAg' in ed.dataset ? 'agregados' : 'editLoc' in ed.dataset ? 'locacoes' : 'editFer' in ed.dataset ? 'feriados' : 'fechamentos';
      if(!pode(m,'editar')) setTimeout(travarModal,0); }
  }, true);
  document.addEventListener('submit', e=>{
    if(!AC) return; const f=e.target;
    if(f.id==='cform' && !pode('custos','criar')) return bloqueia(e);
    if(f.id==='dlg'){
      const mr=document.getElementById('modalRoot'); if(mr && mr.dataset.rbLock) return bloqueia(e);
      const k=(document.getElementById('m_kind')||{}).value, id=(document.getElementById('m_id')||{}).value;
      const m={ag:'agregados',loc:'locacoes',fer:'feriados',custo:'custos',edfech:'fechamentos'}[k];
      if(m && !pode(m, (k==='edfech'||id) ? 'editar' : 'criar')) return bloqueia(e);
    }
  }, true);

  function primeiraAba(cur){
    const ok = t => { const r=TAB_MOD[t]; return r && pode(r[0], r[1]); };
    if(ok(cur)) return cur; return ORDEM.find(ok) || 'semacesso';
  }
  const usaPainelRpc = () => pode('painel','ver') && !(pode('fechamentos','ver') && pode('custos','ver') && pode('locacoes','ver'));
  async function painelDados(){ const {data,error}=await sb.rpc('painel_dados'); if(error) throw error; return data; }

  // perfil ou grade alterados enquanto a pessoa está conectada
  let escutando=false, tRe=null;
  function escutarMudancas(){
    if(escutando) return; escutando=true;
    const re=()=>{ clearTimeout(tRe); tRe=setTimeout(async()=>{
      const {data}=await sb.rpc('meu_acesso');
      if(!data){ aviso('Seu acesso foi encerrado.'); setTimeout(async()=>{ await sb.auth.signOut(); location.reload(); },1500); return; }
      if(JSON.stringify(data.perm)!==JSON.stringify(AC.perm) || data.perfil!==AC.perfil){ aviso('Seu acesso foi atualizado. Recarregando…'); setTimeout(()=>location.reload(),1500); }
    },700); };
    sb.channel('acesso').on('postgres_changes',{event:'*',schema:'public',table:'membros'},re)
      .on('postgres_changes',{event:'*',schema:'public',table:'permissoes'},re).subscribe();
  }

  /* ---------- aba Usuários e acessos (só MASTER) ---------- */
  const U = {root:null, users:[], grade:[], audit:[], msg:'', erro:false, carregando:true, form:{nome:'',email:'',perfil:'operacional'}};
  const traduz = e => { const m=(e&&e.message)||String(e||''); if(/duplicate key|23505/i.test(m)||(e&&e.code==='23505')) return 'Este e-mail já está cadastrado.'; return m.replace(/^.*?: /,'')||'Não foi possível concluir.'; };
  function situacao(u){
    if(!u.ativo) return '<span class="pill off">Inativo</span>';
    if(!u.tem_senha) return '<span class="pill warn">Convidado</span><div class="dim">ainda não criou a senha</div>';
    if(!u.confirmado) return '<span class="pill warn">Aguardando confirmação</span><div class="dim">não confirmou o e-mail</div>';
    return '<span class="pill ok">Ativo</span><div class="dim">'+(u.ultimo_acesso?'último acesso '+new Date(u.ultimo_acesso).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'nunca entrou')+'</div>';
  }
  function convite(u){ return 'Olá, '+u.nome+'! Seu acesso ao Pagamento de Agregados foi liberado ('+(PERFIS[u.perfil]||u.perfil)+'). Abra '+location.origin+' , clique em "Primeiro acesso" e crie sua senha usando o e-mail '+u.email+'. Depois confirme pelo link que chegar no seu e-mail.'; }
  async function copiar(t){ try{ await navigator.clipboard.writeText(t); aviso('Convite copiado. Cole no WhatsApp ou e-mail da pessoa.'); }catch(e){ window.prompt('Copie o convite:', t); } }
  async function recarregar(){
    const [a,b,c]=await Promise.all([sb.rpc('usuarios_situacao'), sb.from('permissoes').select('perfil,modulo,ver,criar,editar'), sb.from('auditoria').select('quando,quem_email,tabela,chave,operacao').in('tabela',['membros','permissoes']).order('quando',{ascending:false}).limit(25)]);
    if(a.error) { U.msg=traduz(a.error); U.erro=true; }
    U.users=a.data||[]; U.grade=b.data||[]; U.audit=c.data||[]; U.carregando=false; desenhar();
  }
  const g = (perfil,mod) => U.grade.find(r=>r.perfil===perfil&&r.modulo===mod) || {perfil,modulo:mod,ver:false,criar:false,editar:false};
  function desenhar(){
    if(!U.root || !document.body.contains(U.root)) return;
    const masters=U.users.filter(u=>u.perfil==='master'&&u.ativo).length;
    const linhaU = u => `<tr>
      <td style="font-weight:600">${esc(u.nome)}</td><td class="mono">${esc(u.email)}</td>
      <td><select data-rb-perfil="${esc(u.email)}" style="width:auto">${Object.entries(PERFIS).map(([k,v])=>`<option value="${k}" ${k===u.perfil?'selected':''}>${v}</option>`).join('')}</select></td>
      <td>${situacao(u)}</td>
      <td style="white-space:nowrap;text-align:right">
        <button type="button" data-rb-convite="${esc(u.email)}">Copiar convite</button>
        <button type="button" data-rb-ativo="${esc(u.email)}">${u.ativo?'Inativar':'Reativar'}</button>
        ${!u.tem_senha?`<button type="button" class="danger" data-rb-excluir="${esc(u.email)}">Excluir</button>`:''}
      </td></tr>`;
    const cb = (perfil,mod,acao,dis) => { const r=g(perfil,mod); return `<td class="n" style="text-align:center"><input type="checkbox" data-rb-perm="${perfil}|${mod}|${acao}" ${r[acao]?'checked':''} ${dis?'disabled':''} aria-label="${PERFIS[perfil]} ${acao} ${mod}"></td>`; };
    U.root.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px">
      ${U.msg?`<div class="notice ${U.erro?'warn':''}" style="display:block">${esc(U.msg)}</div>`:''}
      <div class="panel"><div class="ph"><div><h2>Usuários</h2><span style="color:var(--muted);font-size:12px">Só quem está cadastrado e ativo aqui consegue entrar. ${masters} MASTER ativo${masters===1?'':'s'}.</span></div></div>
        <form id="rb_form" class="qform" novalidate style="padding:0 14px 14px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <label class="lbl" style="flex:1 1 200px">Nome<input id="rb_nome" value="${esc(U.form.nome)}" maxlength="80" autocomplete="off"></label>
          <label class="lbl" style="flex:1 1 240px">E-mail<input id="rb_email" type="email" value="${esc(U.form.email)}" autocomplete="off"></label>
          <label class="lbl" style="flex:0 0 170px">Perfil<select id="rb_perfil">${Object.entries(PERFIS).map(([k,v])=>`<option value="${k}" ${k===U.form.perfil?'selected':''}>${v}</option>`).join('')}</select></label>
          <button class="primary" type="submit">Cadastrar usuário</button>
        </form>
        <div class="scroll"><table style="min-width:820px"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th></th></tr></thead>
        <tbody>${U.carregando?'<tr><td colspan="5" class="empty">Carregando…</td></tr>':U.users.length?U.users.map(linhaU).join(''):'<tr><td colspan="5" class="empty">Nenhum usuário.</td></tr>'}</tbody></table></div>
        <p class="sub" style="font-size:12px;padding:0 14px 12px">Depois de cadastrar, use “Copiar convite” e envie para a pessoa. Ela cria a senha em “Primeiro acesso” e confirma pelo e-mail que receber.</p>
      </div>
      <div class="panel"><div class="ph"><div><h2>Permissões por perfil</h2><span style="color:var(--muted);font-size:12px">Vale para todos os usuários do perfil e passa a valer na hora. MASTER sempre tem acesso total; excluir, backup, configurações e esta aba são só do MASTER.</span></div></div>
        <div class="scroll"><table style="min-width:620px"><thead>
          <tr><th rowspan="2">Módulo</th><th colspan="3" style="text-align:center">Operacional</th><th style="text-align:center">Consultor</th></tr>
          <tr><th style="text-align:center">Ver</th><th style="text-align:center">Criar</th><th style="text-align:center">Editar</th><th style="text-align:center">Ver</th></tr></thead>
        <tbody>${MODS.map(([m,n])=>`<tr><td style="font-weight:600">${n}</td>${cb('operacional',m,'ver')}${cb('operacional',m,'criar',m==='painel')}${cb('operacional',m,'editar',m==='painel')}${cb('consultor',m,'ver')}</tr>`).join('')}</tbody></table></div>
        <p class="sub" style="font-size:12px;padding:0 14px 12px">Ao liberar Criar ou Editar em Fechamentos, Ver em Agregados, Locações e Feriados é ligado automaticamente (o cálculo precisa deles). O mesmo vale para Custos avulsos com Agregados e Locações.</p>
      </div>
      <div class="panel"><div class="ph"><h2>Últimas alterações de acesso</h2></div>
        <div class="scroll"><table style="min-width:620px"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Ação</th></tr></thead>
        <tbody>${U.audit.length?U.audit.map(a=>`<tr><td class="mono">${new Date(a.quando).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</td><td>${esc(a.quem_email||'sistema')}</td><td>${a.tabela==='membros'?'Usuário ':'Permissão '}<span class="mono">${esc(a.chave)}</span></td><td>${{INSERT:'incluído',UPDATE:'alterado',DELETE:'excluído'}[a.operacao]||esc(a.operacao)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Nenhuma alteração ainda.</td></tr>'}</tbody></table></div></div>
    </div>`;
  }
  const feito = (t) => { U.msg=t; U.erro=false; recarregar(); };
  const falhou = (e) => { U.msg=traduz(e); U.erro=true; recarregar(); };
  function montarUsuarios(v){
    const root=document.createElement('div'); root.id='rbacRoot'; v.appendChild(root); U.root=root; U.msg=''; U.carregando=true; desenhar();
    root.addEventListener('input', e=>{ const id=e.target.id; if(id==='rb_nome') U.form.nome=e.target.value; else if(id==='rb_email') U.form.email=e.target.value; });
    root.addEventListener('change', async e=>{
      const el=e.target;
      if(el.id==='rb_perfil'){ U.form.perfil=el.value; return; }
      if(el.dataset.rbPerfil){ const email=el.dataset.rbPerfil, p=el.value, u=U.users.find(x=>x.email===email);
        if(p==='master' && !confirm(u.nome+' terá acesso total, incluindo usuários e exclusões. Confirmar?')){ desenhar(); return; }
        const {error}=await sb.from('membros').update({perfil:p}).eq('email',email);
        return error?falhou(error):feito(u.nome+' agora é '+PERFIS[p]+'.'); }
      if(el.dataset.rbPerm){ const [perfil,mod,acao]=el.dataset.rbPerm.split('|'); const r={...g(perfil,mod)}; r[acao]=el.checked;
        if(acao==='ver'&&!el.checked){ r.criar=false; r.editar=false; } if(acao!=='ver'&&el.checked) r.ver=true;
        const {error}=await sb.from('permissoes').upsert({perfil,modulo:mod,ver:r.ver,criar:r.criar,editar:r.editar},{onConflict:'perfil,modulo'});
        return error?falhou(error):feito('Permissão de '+PERFIS[perfil]+' atualizada.'); }
    });
    root.addEventListener('click', async e=>{
      const b=e.target.closest('button'); if(!b) return;
      if(b.dataset.rbConvite){ const u=U.users.find(x=>x.email===b.dataset.rbConvite); if(u) copiar(convite(u)); return; }
      if(b.dataset.rbAtivo){ const u=U.users.find(x=>x.email===b.dataset.rbAtivo); const {error}=await sb.from('membros').update({ativo:!u.ativo}).eq('email',u.email); return error?falhou(error):feito(u.nome+(u.ativo?' foi inativado.':' foi reativado.')); }
      if(b.dataset.rbExcluir){ const u=U.users.find(x=>x.email===b.dataset.rbExcluir); if(!confirm('Excluir o cadastro de '+u.nome+'?')) return; const {error}=await sb.from('membros').delete().eq('email',u.email); return error?falhou(error):feito(u.nome+' foi excluído.'); }
    });
    root.addEventListener('submit', async e=>{
      if(e.target.id!=='rb_form') return; e.preventDefault(); e.stopPropagation();
      const nome=U.form.nome.trim(), email=U.form.email.trim().toLowerCase(), perfil=U.form.perfil;
      if(nome.length<2){ U.msg='Informe o nome (pelo menos 2 letras).'; U.erro=true; return desenhar(); }
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ U.msg='Informe um e-mail válido.'; U.erro=true; return desenhar(); }
      if(perfil==='master' && !confirm(nome+' terá acesso total, incluindo usuários e exclusões. Confirmar?')) return;
      const {error}=await sb.from('membros').insert({nome,email,perfil,ativo:true});
      if(error) return falhou(error);
      U.form={nome:'',email:'',perfil:'operacional'}; copiar(convite({nome,email,perfil})); feito(nome+' foi cadastrado como '+PERFIS[perfil]+'. O convite foi copiado.');
    });
    recarregar();
  }
  return {aplicar, aviso, primeiraAba, usaPainelRpc, painelDados, montarUsuarios, pode};
})();
