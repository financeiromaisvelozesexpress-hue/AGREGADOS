/* ============================================================================
   Módulos extras: Frequência (faltas diárias) e Notas fiscais (NFS) dos agregados.
   Arquivo separado do index.html para não mexer na estrutura do fechamento.
   Dados: tabela docs, coleções "faltas", "freqconf" e "nfs" (permissões por
   módulo "frequencia" e "nfs" na tabela permissoes, aplicadas por RLS).
   ========================================================================== */
window.__ext = (function(){
  const sb = () => window.__sb;
  const app = () => window.__app;
  const rb = () => window.__rbac;
  const pode = (m,a) => !!(rb() && rb().pode(m,a));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = v => (Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const pad = n => String(n).padStart(2,'0');
  const br = s => { const m=String(s||'').match(/(\d{4})-(\d{2})-(\d{2})/); return m?`${m[3]}/${m[2]}/${m[1]}`:''; };
  const dig = s => String(s||'').replace(/\D/g,'');
  const DOWL = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const hojeIso = () => { const x=new Date(); return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate()); };
  const addDias = (d,n) => { const [y,m,dd]=d.split('-').map(Number); const x=new Date(Date.UTC(y,m-1,dd+n)); return x.getUTCFullYear()+'-'+pad(x.getUTCMonth()+1)+'-'+pad(x.getUTCDate()); };
  const dowDe = d => { const [y,m,dd]=d.split('-').map(Number); return new Date(Date.UTC(y,m-1,dd)).getUTCDay(); };
  const uDate = s => { const [y,m,d]=s.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); };
  function quinzena(mes,q){ const [y,m]=mes.split('-').map(Number); const ult=new Date(Date.UTC(y,m,0)).getUTCDate(); return q==='1'?[mes+'-01',mes+'-15']:[mes+'-16',mes+'-'+pad(ult)]; }
  const refLabel = (m,q) => m&&q ? `${q}ª quinzena · ${m.slice(5)}/${m.slice(0,4)}` : '';
  const refKey = (m,q) => m&&q ? `${m}|${q}` : '';
  const diasEntre = (a,b) => { const r=[]; for(let d=a; d<=b; d=addDias(d,1)) r.push(d); return r; };
  function toast(t){ const el=document.getElementById('toast'); if(!el) return; el.textContent=t; el.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>el.hidden=true,2600); }
  const quem = () => { const ac=rb()&&rb().ac&&rb().ac(); return ac?{por:ac.email||'',porNome:ac.nome||ac.email||''}:{por:'',porNome:''}; };

  /* ---------------- dados (docs: faltas, freqconf, nfs) ---------------- */
  const COLS = ['faltas','freqconf','nfs'];
  const D = {faltas:new Map(), freqconf:new Map(), nfs:new Map()};
  const loaded = {faltas:false, freqconf:false, nfs:false};
  let conectado=false;
  async function carrega(c){
    const m=new Map();
    for(let de=0;;de+=1000){ const {data,error}=await sb().from('docs').select('id,data').eq('colecao',c).range(de,de+999); if(error) break; data.forEach(r=>m.set(r.id,r.data)); if(data.length<1000) break; }
    D[c]=m; loaded[c]=true; redesenhar();
  }
  function conectar(){
    if(conectado||!sb()) return; conectado=true;
    COLS.forEach(c=>{ if(pode(c==='nfs'?'nfs':'frequencia','ver')) carrega(c); else loaded[c]=true; });
    sb().channel('docs-ext').on('postgres_changes',{event:'*',schema:'public',table:'docs'},p=>{
      const r=p.new&&p.new.colecao?p.new:p.old; if(!r||!COLS.includes(r.colecao)) return;
      if(p.eventType==='DELETE') D[r.colecao].delete(p.old.id); else D[r.colecao].set(p.new.id,p.new.data);
      clearTimeout(conectar._t); conectar._t=setTimeout(redesenhar,60);
    }).subscribe();
  }
  async function gravar(c,id,body){
    const existia=D[c].has(id); const antes=D[c].get(id); D[c].set(id,body); redesenhar();
    const upd=()=>sb().from('docs').update({data:body}).eq('colecao',c).eq('id',id).select('id');
    let r = existia ? await upd() : await sb().from('docs').insert({colecao:c,id,data:body}).select('id');
    if(!existia && r.error && r.error.code==='23505') r=await upd();
    if(r.error||!r.data||!r.data.length){ if(existia) D[c].set(id,antes); else D[c].delete(id); redesenhar(); toast('Sem permissão ou falha ao gravar. Nada foi alterado.'); return false; }
    return true;
  }
  async function apagar(c,id){
    const antes=D[c].get(id); D[c].delete(id); redesenhar();
    const r=await sb().from('docs').delete().eq('colecao',c).eq('id',id).select('id');
    if(r.error||!r.data||!r.data.length){ D[c].set(id,antes); redesenhar(); toast('Sem permissão para excluir. Só o MASTER exclui.'); return false; }
    return true;
  }

  /* ---------------- agregados / regra de diária (mesma do fechamento) ---------------- */
  const AGS = () => (app()&&app().S.agregados)||[];
  const agPorId = id => AGS().find(a=>a.id===id);
  function ativoNoPeriodo(a,ini,fim){ return app().noPeriodo(a,uDate(ini),uDate(fim)); }
  // situação-base do dia pelo cálculo do fechamento: T trabalhado, D dispensado, N não trabalhado (feriado)
  function diaBase(a,d){ const h=+d.slice(8)<=15?1:2; const r=app().calcAg(a,uDate(d),uDate(d),h,{}); return r.dias[0]||null; }
  const descontoDe = (a,d,p) => { const b=diaBase(a,d); return b&&b.sit==='T' ? b.taxa*(p==='M'?.5:1) : 0; };

  /* ---------------- ordenação ---------------- */
  const toggleSort = (st,k) => st.col===k?{col:k,dir:-st.dir}:{col:k,dir:1};
  const thHtml = (cols,st,grp) => cols.map(([k,t,n])=>k==='_'?`<th>${t}</th>`:`<th class="sort${n?' n':''}" data-xsort="${grp}|${k}" title="Clique para ordenar">${t}${st.col===k?(st.dir>0?' ↑':' ↓'):' ⇅'}</th>`).join('');
  function ordenar(arr,st,val){ return arr.slice().sort((a,b)=>{ const x=val(a,st.col), y=val(b,st.col); if(typeof x==='number'||typeof y==='number') return ((x||0)-(y||0))*st.dir; return String(x??'').localeCompare(String(y??''),'pt-BR',{numeric:true})*st.dir; }); }

  /* ---------------- PDF com pré-visualização ---------------- */
  let _prev=null;
  function montarPdf({titulo,subtitulo,filtros,head,body,foot,colStyles,kpis,celula}){
    const {jsPDF}=window.jspdf; const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
    const W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight();
    const MAG=[230,0,126], MAR=[31,42,92], MARE=[26,31,61], SEC=[107,107,107];
    let y=40;
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...MARE); doc.text(titulo,40,y);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...SEC); doc.text('Pagamento de Agregados · gerado em '+new Date().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}),W-40,y,{align:'right'});
    y+=16; if(subtitulo){ doc.setFontSize(10); doc.text(subtitulo,40,y); y+=14; }
    if(filtros&&filtros.length){ doc.setFontSize(8.5); doc.text('Filtros: '+filtros.join(' · '),40,y,{maxWidth:W-80}); y+=14; }
    doc.setDrawColor(...MAG); doc.setLineWidth(1.5); doc.line(40,y,W-40,y); y+=12;
    if(kpis&&kpis.length){ const bw=(W-80-(kpis.length-1)*10)/kpis.length;
      kpis.forEach(([l,v],i)=>{ const x=40+i*(bw+10); doc.setDrawColor(230,230,230); doc.setLineWidth(.8); doc.roundedRect(x,y,bw,42,4,4);
        doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(...MAG); doc.text(String(v),x+bw/2,y+20,{align:'center'});
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...SEC); doc.text(l,x+bw/2,y+34,{align:'center'}); });
      y+=54; }
    doc.autoTable({startY:y,head:[head],body,foot:foot?[foot]:undefined,margin:{left:40,right:40,bottom:36},
      styles:{font:'helvetica',fontSize:8,cellPadding:4,textColor:[59,59,59],lineColor:[230,230,230],lineWidth:.5},
      headStyles:{fillColor:MAR,textColor:255,fontStyle:'bold'}, footStyles:{fillColor:[243,243,243],textColor:MARE,fontStyle:'bold'},
      alternateRowStyles:{fillColor:[248,248,250]}, columnStyles:colStyles||{}, showFoot:'lastPage', didParseCell:celula});
    const n=doc.getNumberOfPages();
    for(let i=1;i<=n;i++){ doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...SEC); doc.text(`Página ${i} de ${n}`,W-40,H-18,{align:'right'}); doc.text(titulo,40,H-18); }
    return doc;
  }
  async function previsualizar(doc,nome,titulo){
    _prev={doc,nome};
    let bg=document.getElementById('xPrev');
    if(!bg){ bg=document.createElement('div'); bg.id='xPrev'; bg.className='xprev'; document.body.appendChild(bg);
      bg.addEventListener('click',e=>{ if(e.target.closest('[data-xprev="fechar"]')){ bg.hidden=true; bg.innerHTML=''; }
        if(e.target.closest('[data-xprev="baixar"]')&&_prev){ const u=URL.createObjectURL(_prev.doc.output('blob')); const a=document.createElement('a'); a.href=u; a.download=_prev.nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),3000); toast('PDF baixado.'); } }); }
    bg.hidden=false;
    bg.innerHTML=`<div class="xprev-bar"><b>${esc(titulo)}</b><span class="dim" id="xPrevInfo">Gerando pré-visualização…</span><span style="flex:1"></span><button type="button" data-xprev="fechar">Fechar</button><button type="button" class="primary" data-xprev="baixar">Baixar PDF</button></div><div class="xprev-pages" id="xPrevPages"></div>`;
    try{
      if(!window.pdfjsLib) throw new Error('visualizador não carregou');
      const pdf=await pdfjsLib.getDocument({data:doc.output('arraybuffer')}).promise;
      document.getElementById('xPrevInfo').textContent=`${pdf.numPages} página(s) · ${nome}`;
      for(let i=1;i<=pdf.numPages;i++){ const pg=await pdf.getPage(i); const vp=pg.getViewport({scale:1.6}); const c=document.createElement('canvas'); c.width=vp.width; c.height=vp.height; c.style.width=Math.min(vp.width/1.6*1.25,1100)+'px'; document.getElementById('xPrevPages').appendChild(c); await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise; }
    }catch(e){ const el=document.getElementById('xPrevInfo'); if(el) el.textContent='Não foi possível mostrar a prévia ('+(e.message||e)+'). O botão Baixar PDF continua funcionando.'; }
  }
  const nomeArq = b => `${b}_${hojeIso()}.pdf`;
  function semPdf(){ if(!window.jspdf||!window.jspdf.jsPDF||!window.jspdf.jsPDF.API.autoTable){ toast('Gerador de PDF não carregou. Recarregue a página.'); return true; } return false; }

  /* =====================================================================
     FREQUÊNCIA
     ===================================================================== */
  const F = { sub:'lancar', data:addDias(hojeIso(),-1), cli:'', loc:'', busca:'', so:'', sortD:{col:'nome',dir:1},
    fMes:addDias(hojeIso(),-1).slice(0,7), fQz:+addDias(hojeIso(),-1).slice(8)<=15?'1':'2', fCli:'', fAg:'', fMost:'faltas', sortF:{col:'desc',dir:-1},
    rDe:'', rAte:'', rPer:'', rBusca:'', sortR:{col:'data',dir:-1} };
  const idFalta = (d,agId) => `${d}_${agId}`;
  const faltaDe = (agId,d) => { const f=D.faltas.get(idFalta(d,agId)); return f&&f.periodo?f:null; };
  const podeMarcar = () => pode('frequencia','criar')||pode('frequencia','editar');

  function linhasDia(){
    const d=F.data; const m=d.slice(0,7); const [ini]=quinzena(m,'1'); const [,fim]=quinzena(m,'2');
    return AGS().filter(a=>ativoNoPeriodo(a,ini,fim)).map(a=>{
      const b=diaBase(a,d); const f=faltaDe(a.id,d);
      let obs='', marcavel=!!b&&b.sit==='T';
      if(!b) obs=a.inicio>d?'Contrato começa em '+br(a.inicio):'Contrato encerrado em '+br(a.fim);
      else if(b.sit==='N') obs='Feriado'+(b.feriado?': '+b.feriado:'')+' (não trabalhado)';
      else if(b.sit==='D') obs=b.w===0?'Domingo (dispensado)':'Sábado: não trabalha aos sábados';
      return {a,id:a.id,nome:a.nome,cliente:a.empresa||'',locacao:a.locacao||'',f,marcavel,obs,
        situacao:f?(f.periodo==='I'?'Ausente — dia inteiro':'Ausente — meio período'):(marcavel?'Presente':'—'),
        diaria:b&&b.sit==='T'?b.taxa:0, desc:f?descontoDe(a,d,f.periodo):0};
    });
  }
  async function marcar(agId,p){
    const d=F.data, id=idFalta(d,agId), a=agPorId(agId); if(!a) return;
    const atual=D.faltas.get(id); if((atual&&atual.periodo||'')===p) return;
    if(!atual&&!p) return;
    const body={data:d,agregadoId:agId,agregado:a.nome,periodo:p,...quem(),em:new Date().toISOString()};
    if(atual?!pode('frequencia','editar'):!pode('frequencia','criar')){ toast('Seu perfil não pode '+(atual?'alterar':'lançar')+' faltas.'); return; }
    await gravar('faltas',id,body);
  }
  async function conferir(){
    const d=F.data, c=D.freqconf.get(d), on=!(c&&c.conferido);
    if(c?!pode('frequencia','editar'):!pode('frequencia','criar')){ toast('Seu perfil não pode marcar dias como conferidos.'); return; }
    await gravar('freqconf',d,{conferido:on,...quem(),em:new Date().toISOString()});
    toast(on?'Dia marcado como conferido.':'Conferência desfeita.');
  }
  const confDe = d => { const c=D.freqconf.get(d); return c&&c.conferido?c:null; };

  function vLancar(){
    const d=F.data, w=dowDe(d); const todas=linhasDia();
    const clis=[...new Set(todas.map(r=>r.cliente))].filter(Boolean).sort();
    const locs=[...new Set(todas.filter(r=>!F.cli||r.cliente===F.cli).map(r=>r.locacao))].filter(Boolean).sort();
    const b=F.busca.trim().toLowerCase();
    const rows=ordenar(todas.filter(r=>(!F.cli||r.cliente===F.cli)&&(!F.loc||r.locacao===F.loc)&&(!b||r.nome.toLowerCase().includes(b))&&(!F.so||(F.so==='aus'?r.f:r.marcavel))),F.sortD,(r,k)=>r[k]);
    const at=todas.filter(r=>r.marcavel); const c=confDe(d); const pm=podeMarcar();
    const avisos=[]; if(d>=hojeIso()) avisos.push('Data de hoje ou futura: o lançamento deve ser feito no dia seguinte.');
    if(w===0) avisos.push('Domingo: ninguém está escalado pela regra do fechamento.'); if(w===6) avisos.push('Sábado: só aparecem para marcação os agregados que trabalham aos sábados.');
    const COLSD=[['_','Marcação'],['situacao','Situação'],['nome','Agregado'],['cliente','Cliente'],['locacao','Locação'],['diaria','Diária do dia',1],['desc','Desconto',1],['obs','Observação']];
    return `<section class="panel step">
      <div class="bar">
        <label class="lbl">Data<input type="date" id="xf_data" value="${d}" style="width:auto"></label>
        <div class="row" style="align-self:flex-end"><button data-xf="prev">‹ Dia anterior</button><button data-xf="next">Próximo dia ›</button><button data-xf="ontem">Ontem</button></div>
        <label class="lbl">Cliente<select id="xf_cli" style="width:auto"><option value="">Todos</option>${clis.map(x=>`<option ${x===F.cli?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="lbl">Locação<select id="xf_loc" style="width:auto"><option value="">Todas</option>${locs.map(x=>`<option ${x===F.loc?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="lbl">Mostrar<select id="xf_so" style="width:auto"><option value="">Todos</option><option value="esc" ${F.so==='esc'?'selected':''}>Só escalados no dia</option><option value="aus" ${F.so==='aus'?'selected':''}>Só ausentes</option></select></label>
        <label class="lbl grow">Pesquisar agregado<input id="xf_busca" value="${esc(F.busca)}" placeholder="Nome"></label>
      </div>
      <div class="notice"><b style="color:var(--title)">${DOWL[w][0].toUpperCase()+DOWL[w].slice(1)}, ${br(d)}</b> · marque só quem faltou; quem não for marcado conta como presente.</div>
      ${avisos.map(t=>`<div class="notice warn">${esc(t)}</div>`).join('')}
      ${pm?'':'<div class="notice">Seu perfil só pode consultar a frequência.</div>'}
    </section>
    <div class="tiles">
      <div class="tile"><div class="k">Escalados no dia</div><div class="v">${at.length}</div></div>
      <div class="tile"><div class="k">Ausentes — dia inteiro</div><div class="v">${todas.filter(r=>r.f&&r.f.periodo==='I').length}</div></div>
      <div class="tile"><div class="k">Ausentes — meio período</div><div class="v">${todas.filter(r=>r.f&&r.f.periodo==='M').length}</div></div>
      <div class="tile"><div class="k">Desconto do dia</div><div class="v">${fmt(todas.reduce((s,r)=>s+r.desc,0))}</div></div>
    </div>
    <section class="panel">
      <div class="ph"><div>${c?`<span class="pill ok">Dia conferido</span> <span class="dim">por ${esc(c.porNome||c.por||'—')} · ${new Date(c.em).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</span>`:'<span class="pill warn">Dia ainda não conferido</span> <span class="dim">Depois de marcar as faltas, clique em “Marcar dia como conferido”.</span>'}</div>
        <div class="row"><button data-xf="pdfDia">Gerar PDF do dia</button>${pm?`<button data-xf="conf" class="${c?'':'primary'}">${c?'Desfazer conferência':'Marcar dia como conferido'}</button>`:''}</div></div>
      ${!loaded.faltas?'<div class="empty">Carregando…</div>':`<div class="scroll"><table style="min-width:980px"><thead><tr>${thHtml(COLSD,F.sortD,'d')}</tr></thead><tbody>
      ${rows.length?rows.map(r=>{ const p=r.f?r.f.periodo:''; return `<tr${r.f?' class="xaus"':''}${!r.marcavel&&!r.f?' class="xoff"':''}>
        <td style="white-space:nowrap">${r.marcavel||r.f?`<span class="xseg">${['','I','M'].map(v=>`<button type="button" data-xmark="${esc(r.id)}|${v}" class="${p===v?'on '+(v==='I'?'int':v==='M'?'meio':''):''}" ${pm?'':'disabled'}>${v===''?'Presente':v==='I'?'Ausente · dia inteiro':'Ausente · meio período'}</button>`).join('')}</span>`:'<span class="dim">não escalado</span>'}</td>
        <td style="white-space:nowrap">${r.f?`<span class="pill ${p==='I'?'bad':'warn'}">${esc(r.situacao)}</span><div class="dim">por ${esc(r.f.porNome||r.f.por||'—')}</div>`:r.marcavel?'<span class="pill ok">Presente</span>':'<span class="pill off">—</span>'}</td>
        <td style="font-weight:600;min-width:220px">${esc(r.nome)}</td><td>${esc(r.cliente)}</td><td>${esc(r.locacao)}</td>
        <td class="n">${r.diaria?fmt(r.diaria):'—'}</td><td class="n" style="${r.desc?'color:var(--magenta);font-weight:600':''}">${r.desc?fmt(r.desc):'—'}</td><td class="dim">${esc(r.obs)}</td></tr>`; }).join('')
        :`<tr><td colspan="8" class="empty">Nenhum agregado neste filtro.</td></tr>`}</tbody></table></div>`}
    </section>`;
  }

  function dadosFech(){
    const [ini,fim]=quinzena(F.fMes,F.fQz); const ds=diasEntre(ini,fim);
    const base=AGS().filter(a=>ativoNoPeriodo(a,ini,fim)&&(!F.fCli||(a.empresa||'')===F.fCli)&&(!F.fAg||a.id===F.fAg));
    const rows=base.map(a=>{ const fs=ds.map(d=>({d,f:faltaDe(a.id,d)})).filter(x=>x.f);
      const inteiro=fs.filter(x=>x.f.periodo==='I').length, meio=fs.filter(x=>x.f.periodo==='M').length;
      return {a,id:a.id,nome:a.nome,cliente:a.empresa||'',locacao:a.locacao||'',inteiro,meio,equiv:inteiro+meio/2,
        desc:fs.reduce((s,x)=>s+descontoDe(a,x.d,x.f.periodo),0), datas:fs.map(x=>br(x.d).slice(0,5)+(x.f.periodo==='M'?' (½)':'')).join(', ')}; });
    return {ini,fim,ds,rows};
  }
  function vFech(){
    const {ini,fim,ds,rows}=dadosFech(); const hj=hojeIso();
    const clis=[...new Set(AGS().filter(a=>ativoNoPeriodo(a,ini,fim)).map(a=>a.empresa||''))].filter(Boolean).sort();
    const ags=AGS().filter(a=>ativoNoPeriodo(a,ini,fim)&&(!F.fCli||(a.empresa||'')===F.fCli)).sort((x,y)=>x.nome.localeCompare(y.nome,'pt-BR'));
    const vis=ordenar(rows.filter(r=>!F.fMost||r.inteiro||r.meio),F.sortF,(r,k)=>r[k]);
    const COLSF=[['nome','Agregado'],['cliente','Cliente'],['locacao','Locação'],['inteiro','Dias inteiros',1],['meio','Meios períodos',1],['equiv','Dias a descontar',1],['desc','Valor a descontar',1],['datas','Datas das faltas']];
    const nFaltasDia=d=>[...D.faltas.values()].filter(f=>f.periodo&&f.data===d&&(!F.fAg||f.agregadoId===F.fAg)&&(!F.fCli||((agPorId(f.agregadoId)||{}).empresa||'')===F.fCli)).length;
    return `<section class="panel step">
      <div class="bar">
        <label class="lbl">Mês<input type="month" id="xg_mes" value="${F.fMes}" style="width:auto"></label>
        <label class="lbl">Quinzena<select id="xg_qz" style="width:auto"><option value="1" ${F.fQz==='1'?'selected':''}>1ª quinzena (1 a 15)</option><option value="2" ${F.fQz==='2'?'selected':''}>2ª quinzena (16 ao fim)</option></select></label>
        <label class="lbl">Cliente<select id="xg_cli" style="width:auto"><option value="">Todos</option>${clis.map(x=>`<option ${x===F.fCli?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="lbl grow">Agregado (individual)<select id="xg_ag"><option value="">Todos (lote)</option>${ags.map(a=>`<option value="${esc(a.id)}" ${a.id===F.fAg?'selected':''}>${esc(a.nome)}</option>`).join('')}</select></label>
        <label class="lbl">Mostrar<select id="xg_most" style="width:auto"><option value="faltas" ${F.fMost?'selected':''}>Só com faltas</option><option value="" ${!F.fMost?'selected':''}>Todos</option></select></label>
        <button class="primary" data-xf="pdfFech" style="align-self:flex-end">Gerar PDF</button>
      </div>
      <div class="dim">Dias da quinzena (clique para abrir o dia): verde = conferido · rosa = ainda não conferido · número = faltas no dia.</div>
      <div class="xcal">${ds.map(d=>{ const n=nFaltasDia(d), w=dowDe(d), c=confDe(d); return `<button type="button" class="xd ${c?'conf':d<hj?'pend':''} ${w===0||w===6?'fds':''}" data-xdia="${d}" title="${c?'Conferido':'Não conferido'}">${DOWL[w].slice(0,3)}<b>${d.slice(8)}</b><span class="xn">${n?n+' falta'+(n>1?'s':''):'&nbsp;'}</span></button>`; }).join('')}</div>
    </section>
    <div class="tiles">
      <div class="tile"><div class="k">Agregados com falta</div><div class="v">${rows.filter(r=>r.inteiro||r.meio).length}</div></div>
      <div class="tile"><div class="k">Faltas dia inteiro</div><div class="v">${rows.reduce((s,r)=>s+r.inteiro,0)}</div></div>
      <div class="tile"><div class="k">Faltas meio período</div><div class="v">${rows.reduce((s,r)=>s+r.meio,0)}</div></div>
      <div class="tile"><div class="k">Total a descontar</div><div class="v">${fmt(rows.reduce((s,r)=>s+r.desc,0))}</div></div>
      <div class="tile"><div class="k">Dias não conferidos</div><div class="v">${ds.filter(d=>d<hj&&!confDe(d)).length}</div></div>
    </div>
    <section class="panel"><div class="ph"><h2>Faltas da ${F.fQz}ª quinzena de ${MESES[+F.fMes.slice(5)-1]} ${F.fMes.slice(0,4)}</h2><span class="dim">No fechamento, marque estes dias como “Não trabalhado” (ou ajuste o valor do dia para meio período), no formato atual.</span></div>
      <div class="scroll"><table style="min-width:900px"><thead><tr>${thHtml(COLSF,F.sortF,'f')}</tr></thead><tbody>
      ${vis.length?vis.map(r=>`<tr><td style="font-weight:600">${esc(r.nome)}</td><td>${esc(r.cliente)}</td><td>${esc(r.locacao)}</td><td class="n">${r.inteiro}</td><td class="n">${r.meio}</td><td class="n">${r.equiv.toLocaleString('pt-BR')}</td><td class="n" style="${r.desc?'color:var(--magenta);font-weight:600':''}">${r.desc?fmt(r.desc):'—'}</td><td class="dim">${esc(r.datas||'—')}</td></tr>`).join('')
        :`<tr><td colspan="8" class="empty">Nenhuma falta registrada nesta quinzena${F.fAg?' para este agregado':''}.</td></tr>`}</tbody>
      ${vis.length>1?`<tfoot><tr><td colspan="3">Total</td><td class="n">${vis.reduce((s,r)=>s+r.inteiro,0)}</td><td class="n">${vis.reduce((s,r)=>s+r.meio,0)}</td><td class="n">${vis.reduce((s,r)=>s+r.equiv,0).toLocaleString('pt-BR')}</td><td class="n">${fmt(vis.reduce((s,r)=>s+r.desc,0))}</td><td></td></tr></tfoot>`:''}</table></div></section>`;
  }

  function linhasReg(){
    const b=F.rBusca.trim().toLowerCase();
    return [...D.faltas.entries()].filter(([,f])=>f.periodo).map(([id,f])=>{ const a=agPorId(f.agregadoId);
      return {id,f,data:f.data,dia:DOWL[dowDe(f.data)],nome:a?a.nome:f.agregado,cliente:a?a.empresa||'':'',locacao:a?a.locacao||'':'',periodo:f.periodo==='I'?'Dia inteiro':'Meio período',desc:a?descontoDe(a,f.data,f.periodo):0,por:f.porNome||f.por||'',em:f.em||''}; })
      .filter(r=>(!F.rDe||r.data>=F.rDe)&&(!F.rAte||r.data<=F.rAte)&&(!F.rPer||r.f.periodo===F.rPer)&&(!b||(r.nome+' '+r.cliente+' '+r.locacao).toLowerCase().includes(b)));
  }
  function vReg(){
    const rows=ordenar(linhasReg(),F.sortR,(r,k)=>r[k]); const pe=pode('frequencia','editar');
    const COLSR=[['_',''],['data','Data'],['dia','Dia'],['nome','Agregado'],['cliente','Cliente'],['locacao','Locação'],['periodo','Período'],['desc','Desconto',1],['por','Marcado por'],['em','Marcado em']];
    return `<section class="panel step"><div class="bar">
        <label class="lbl">De<input type="date" id="xr_de" value="${F.rDe}" style="width:auto"></label>
        <label class="lbl">Até<input type="date" id="xr_ate" value="${F.rAte}" style="width:auto"></label>
        <label class="lbl">Período<select id="xr_per" style="width:auto"><option value="">Todos</option><option value="I" ${F.rPer==='I'?'selected':''}>Dia inteiro</option><option value="M" ${F.rPer==='M'?'selected':''}>Meio período</option></select></label>
        <label class="lbl grow">Pesquisar (agregado, cliente, locação)<input id="xr_busca" value="${esc(F.rBusca)}"></label>
        <button class="primary" data-xf="pdfReg" style="align-self:flex-end">Gerar PDF</button></div></section>
      <section class="panel"><div class="scroll"><table style="min-width:980px"><thead><tr>${thHtml(COLSR,F.sortR,'r')}</tr></thead><tbody>
      ${rows.length?rows.map(r=>`<tr><td>${pe?`<button class="danger" data-xrm="${esc(r.id)}">Remover</button>`:''}</td><td class="mono">${br(r.data)}</td><td class="dim">${esc(r.dia)}</td><td style="font-weight:600">${esc(r.nome)}</td><td>${esc(r.cliente)}</td><td>${esc(r.locacao)}</td>
        <td><span class="pill ${r.f.periodo==='I'?'bad':'warn'}">${esc(r.periodo)}</span></td><td class="n">${fmt(r.desc)}</td><td>${esc(r.por)}</td><td class="dim">${r.em?new Date(r.em).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):''}</td></tr>`).join('')
        :`<tr><td colspan="10" class="empty">Nenhuma falta registrada${D.faltas.size?' neste filtro':''}.</td></tr>`}</tbody></table></div></section>`;
  }

  function vFrequencia(){
    return `<div class="xwrap">
      <div class="row" style="justify-content:space-between"><span class="dim">Controle diário de faltas dos agregados, feito pelo operador no dia seguinte.</span>
        <div class="seg"><button data-xfsub="lancar" aria-pressed="${F.sub==='lancar'}">Lançar faltas</button><button data-xfsub="fech" aria-pressed="${F.sub==='fech'}">Faltas da quinzena</button><button data-xfsub="reg" aria-pressed="${F.sub==='reg'}">Faltas registradas</button></div></div>
      ${F.sub==='lancar'?vLancar():F.sub==='fech'?vFech():vReg()}</div>`;
  }

  function pdfDia(){
    if(semPdf()) return; const d=F.data, todas=linhasDia(), aus=ordenar(todas.filter(r=>r.f),F.sortD,(r,k)=>r[k]); const tot=aus.reduce((s,r)=>s+r.desc,0);
    const doc=montarPdf({titulo:'Frequência diária — Agregados',subtitulo:`${DOWL[dowDe(d)]}, ${br(d)} · ${confDe(d)?'dia conferido':'dia NÃO conferido'}`,
      filtros:['Lista só os ausentes; os demais escalados contam como presentes'],
      kpis:[['Escalados no dia',todas.filter(r=>r.marcavel).length],['Dia inteiro',aus.filter(r=>r.f.periodo==='I').length],['Meio período',aus.filter(r=>r.f.periodo==='M').length],['Desconto do dia',fmt(tot)]],
      head:['Agregado','Cliente','Locação','Situação','Diária do dia','Desconto','Marcado por'],
      body:aus.length?aus.map(r=>[r.nome,r.cliente,r.locacao,r.situacao,fmt(r.diaria),fmt(r.desc),r.f.porNome||r.f.por||'']):[['Nenhuma ausência registrada nesta data','','','','','','']],
      foot:['Total','','','','',fmt(tot),''],colStyles:{4:{halign:'right'},5:{halign:'right'}}});
    previsualizar(doc,nomeArq('frequencia-'+d),'Pré-visualização · Frequência do dia');
  }
  function pdfFech(){
    if(semPdf()) return; const {ini,fim,ds,rows}=dadosFech(); const vis=ordenar(rows.filter(r=>!F.fMost||r.inteiro||r.meio),F.sortF,(r,k)=>r[k]);
    const ag=F.fAg?agPorId(F.fAg):null; const pend=ds.filter(d=>d<hojeIso()&&!confDe(d)); const tot=rows.reduce((s,r)=>s+r.desc,0);
    const f=[ag?'Individual: '+ag.nome:'Lote'+(F.fCli?' · Cliente: '+F.fCli:'')]; if(pend.length) f.push('Dias NÃO conferidos: '+pend.map(d=>d.slice(8)).join(', '));
    const doc=montarPdf({titulo:'Faltas para o fechamento — Agregados',subtitulo:`${F.fQz}ª quinzena · ${br(ini)} a ${br(fim)}`,filtros:f,
      kpis:[['Agregados com falta',rows.filter(r=>r.inteiro||r.meio).length],['Faltas dia inteiro',rows.reduce((s,r)=>s+r.inteiro,0)],['Faltas meio período',rows.reduce((s,r)=>s+r.meio,0)],['Total a descontar',fmt(tot)]],
      head:['Agregado','Cliente','Locação','Dias inteiros','Meios períodos','Dias a descontar','Valor a descontar','Datas'],
      body:vis.length?vis.map(r=>[r.nome,r.cliente,r.locacao,r.inteiro,r.meio,r.equiv.toLocaleString('pt-BR'),fmt(r.desc),r.datas||'—']):[['Nenhuma falta registrada','','','','','','','']],
      foot:['Total','','',rows.reduce((s,r)=>s+r.inteiro,0),rows.reduce((s,r)=>s+r.meio,0),rows.reduce((s,r)=>s+r.equiv,0).toLocaleString('pt-BR'),fmt(tot),''],
      colStyles:{3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{cellWidth:150}}});
    previsualizar(doc,nomeArq(`faltas-${F.fMes}-q${F.fQz}${ag?'-'+ag.id:''}`),'Pré-visualização · Faltas da quinzena');
  }
  function pdfReg(){
    if(semPdf()) return; const rows=ordenar(linhasReg(),F.sortR,(r,k)=>r[k]); if(!rows.length){ toast('Nada para gerar no filtro atual.'); return; }
    const f=[]; if(F.rDe) f.push('De '+br(F.rDe)); if(F.rAte) f.push('até '+br(F.rAte)); if(F.rPer) f.push(F.rPer==='I'?'Dia inteiro':'Meio período'); if(F.rBusca) f.push('Pesquisa: '+F.rBusca);
    const doc=montarPdf({titulo:'Faltas registradas — Agregados',filtros:f.length?f:['Nenhum'],head:['Data','Dia','Agregado','Cliente','Locação','Período','Desconto','Marcado por'],
      body:rows.map(r=>[br(r.data),r.dia,r.nome,r.cliente,r.locacao,r.periodo,fmt(r.desc),r.por]),foot:['Total','','','','','',fmt(rows.reduce((s,r)=>s+r.desc,0)),''],colStyles:{6:{halign:'right'}}});
    previsualizar(doc,nomeArq('faltas-registradas'),'Pré-visualização · Faltas registradas');
  }

  /* =====================================================================
     NOTAS FISCAIS (NFS)
     ===================================================================== */
  const N = { sub:'importar', refMes:hojeIso().slice(0,7), refQz:'', fila:[], colar:'', mostraColar:false,
    lBusca:'', lDe:'', lAte:'', lRef:'', lReg:'', lEmp:'', sortL:{col:'emissao',dir:-1},
    cMes:hojeIso().slice(0,7), cQz:+hojeIso().slice(8)<=15?'1':'2', cSit:'', cCli:'', cBusca:'', sortC:{col:'sit',dir:1},
    sortE:{col:'nome',dir:1}, ed:null, edOrig:null, empEd:null };
  const EMP_PADRAO=['MV LOG Matriz','MV LOG Filial','Mais Velozes','Pediutai','Busca Entrega','AMJ','MHC'].map(nome=>({nome,cnpj:''}));
  const empresas = () => { const e=D.nfs.get('__empresas'); return e&&Array.isArray(e.lista)&&e.lista.length?e.lista:EMP_PADRAO; };
  const lanc = () => [...D.nfs.entries()].filter(([id])=>!id.startsWith('__')).map(([id,d])=>({...d,id}));
  const fmtDoc = d => { d=dig(d); if(d.length===14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5'); if(d.length===11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'); return d; };
  function parseMoney(s){ if(s==null||s==='') return null; if(typeof s==='number') return s; s=String(s).replace(/[^\d,.-]/g,''); if(!s) return null; if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.'); const n=parseFloat(s); return isNaN(n)?null:n; }
  const brToIso = d => { const m=String(d||'').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m?`${m[3]}-${m[2]}-${m[1]}`:''; };
  const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  const empresaPorCnpj = d => { d=dig(d); if(!d) return ''; const e=empresas().find(e=>dig(e.cnpj)&&dig(e.cnpj)===d); return e?e.nome:''; };

  // ---- leitura do PDF ----
  async function lerPdf(file){
    const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise; const linhas=[];
    for(let p=1;p<=pdf.numPages;p++){
      const tc=await (await pdf.getPage(p)).getTextContent();
      const itens=tc.items.filter(i=>i.str&&i.str.trim()).map(i=>({t:i.str,x:i.transform[4],y:i.transform[5],w:i.width||0})).sort((a,b)=>b.y-a.y||a.x-b.x);
      const grupos=[]; for(const it of itens){ const g=grupos.find(g=>Math.abs(g.y-it.y)<=2.5); if(g) g.itens.push(it); else grupos.push({y:it.y,itens:[it]}); }
      grupos.sort((a,b)=>b.y-a.y);
      for(const g of grupos){ g.itens.sort((a,b)=>a.x-b.x); const segs=[];
        for(const it of g.itens){ const last=segs[segs.length-1]; if(last&&it.x-(last.x+last.w)<4){ last.t+=(it.x-(last.x+last.w)>.8?' ':'')+it.t; last.w=it.x+it.w-last.x; } else segs.push({t:it.t,x:it.x,w:it.w}); }
        segs.forEach(s=>s.t=s.t.replace(/\s+/g,' ').trim()); linhas.push({segs,texto:segs.map(s=>s.t).join('  ')}); }
    }
    return linhas;
  }
  const linhasDeTexto = txt => txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>({segs:[{t:l,x:0,w:0}],texto:l}));
  const RE_DATA=/\b(\d{2}\/\d{2}\/\d{4})\b/, RE_MOEDA=/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})\b/, RE_NUM=/\b(\d{1,15})\b/;
  const RE_DOC=/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})\b/g, RE_NOME=/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9&.,'\- ]{2,})/;
  const ROTULO=/^(Munic[íi]pio|Endere[çc]o|Inscri[çc][ãa]o|Telefone|E-?mail|CEP|UF|Bairro|Pa[íi]s|Nome|CNPJ|CPF|NIF|Simples|Regime|Data|N[úu]mero|Compet[êe]ncia|C[óo]digo)\b/i;
  function campo(L,labels,valRe,ini=0,fim=L.length){
    for(const lab of labels){ for(let i=ini;i<fim;i++){ const ln=L[i]; const m=ln.texto.match(lab); if(!m) continue;
      const depois=ln.texto.slice(m.index+m[0].length).replace(/^[\s:=\-–]+/,''); const v1=depois.slice(0,80).match(valRe);
      if(v1&&depois.indexOf(v1[0])<25&&!ROTULO.test(v1[1])) return v1[1];
      const seg=ln.segs.find(s=>lab.test(s.t));
      if(seg&&seg.w){ for(let j=i+1;j<Math.min(i+4,fim);j++){ const cand=L[j].segs.filter(s=>s.x<seg.x+Math.max(seg.w,60)&&s.x+s.w>seg.x-15).sort((a,b)=>Math.abs(a.x-seg.x)-Math.abs(b.x-seg.x));
        for(const c of cand){ if(ROTULO.test(c.t)) continue; const v=c.t.match(valRe); if(v) return v[1]; } } }
      const v3=[depois,...L.slice(i+1,i+3).map(x=>x.texto)].join(' ').slice(0,160).match(valRe); if(v3&&!ROTULO.test(v3[1])) return v3[1]; } }
    return '';
  }
  const acharLinha = (L,re,de=0) => { for(let i=de;i<L.length;i++) if(re.test(L[i].texto)) return i; return -1; };
  function regime(t){ if(!t) return '';
    if(/Microempreendedor\s+Individual|\bMEI\b|SIMEI/i.test(t)) return 'MEI';
    if(/N[ãa]o\s+Optante/i.test(t)||/Simples\s+Nacional\s*[:\-]?\s*N[ãa]o\b/i.test(t)) return 'Outro';
    if(/Optante\s*[-–]\s*Micro(?:empresa)?|ME\s*\/\s*EPP|Simples\s+Nacional\s*[:\-]?\s*Sim|Optante\s+pelo\s+Simples|Regime\s+de\s+Apura[çc][ãa]o.*SN/i.test(t)) return 'Simples Nacional';
    if(/Lucro\s+Presumido|Lucro\s+Real|Regime\s+Normal|Tributa[çc][ãa]o\s+Normal/i.test(t)) return 'Outro'; return ''; }
  function extrair(L){
    const plano=L.map(l=>l.texto).join('\n'), r={};
    r.numero=campo(L,[/N[úu]mero\s+da\s+NFS-?e/i,/N[úu]mero\s+da\s+Nota/i,/NFS-?e\s*N[º°o.]*/i,/N[º°]\s*(?:da\s+)?Nota/i,/Nota\s+Fiscal\s+N[º°o.]*/i,/N[úu]mero\s+NFS/i],RE_NUM);
    r.emissao=brToIso(campo(L,[/Data\s+e\s+Hora\s+da\s+Emiss[ãa]o/i,/Data\s*(?:e\s*)?Hora\s+(?:de\s+)?Emiss[ãa]o/i,/Data\s+(?:de\s+|da\s+)?Emiss[ãa]o/i,/Emitida\s+em/i,/Emiss[ãa]o\s+(?:da\s+NFS-?e|da\s+Nota)/i],RE_DATA));
    if(!r.emissao){ const d=plano.match(RE_DATA); if(d) r.emissao=brToIso(d[1]); }
    const comp=campo(L,[/Compet[êe]ncia/i],/\b(\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4})\b/); r.competencia=comp.length===7?comp:(comp?comp.slice(3):'');
    r.valor=parseMoney(campo(L,[/Valor\s+(?:do|dos)\s+Servi[çc]os?/i,/Valor\s+Total\s+da\s+(?:Nota|NFS-?e)/i,/Valor\s+Total\s+(?:do|dos)\s+Servi/i,/Valor\s+Bruto/i,/Total\s+da\s+Nota/i,/Valor\s+da\s+Nota/i],RE_MOEDA));
    r.liquido=parseMoney(campo(L,[/Valor\s+L[íi]quido/i],RE_MOEDA));
    if(r.valor==null){ const t=[...plano.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)].map(m=>parseMoney(m[0])); if(t.length) r.valor=Math.max(...t); }
    if(r.liquido==null) r.liquido=r.valor;
    let iP=acharLinha(L,/PRESTADOR|EMITENTE/i), iT=acharLinha(L,/TOMADOR/i,iP<0?0:iP+1), iS=acharLinha(L,/INTERMEDI|DISCRIMINA|SERVI[ÇC]O\s+PRESTADO|DESCRI[ÇC][ÃA]O\s+DO\s+SERVI/i,iT<0?0:iT+1);
    if(iP<0) iP=0; if(iT<0) iT=Math.min(L.length,iP+12); if(iS<0) iS=Math.min(L.length,iT+12);
    const secP=L.slice(iP,iT).map(l=>l.texto).join('\n'), secT=L.slice(iT,iS).map(l=>l.texto).join('\n');
    const dP=[...secP.matchAll(RE_DOC)].map(m=>dig(m[1])), dT=[...secT.matchAll(RE_DOC)].map(m=>dig(m[1])), dA=[...plano.matchAll(RE_DOC)].map(m=>dig(m[1]));
    r.prestDoc=dP[0]||dA[0]||''; r.tomDoc=dT[0]||dA.find(d=>d!==r.prestDoc)||'';
    const labNome=[/Nome\s*\/\s*Nome\s+Empresarial/i,/Nome\s*\/\s*Raz[ãa]o\s+Social/i,/Raz[ãa]o\s+Social/i,/Nome\s+Empresarial/i,/^\s*Nome\b/i];
    const limpa=s=>String(s||'').replace(/\s{2,}.*/,'').replace(/\b(CPF|CNPJ|Inscri|E-?mail|Telefone).*$/i,'').trim();
    r.prestNome=limpa(campo(L,labNome,RE_NOME,iP,iT)); r.tomNome=limpa(campo(L,labNome,RE_NOME,iT,iS));
    r.regime=regime(secP)||regime(plano)||'Não identificado'; r.empresa=empresaPorCnpj(r.tomDoc); r.textoBruto=plano;
    const sg=sugerirAgregado(r.prestNome,r.prestDoc); r.agregadoId=sg?sg.id:''; r.vinculoComo=sg?sg.como:'';
    return r;
  }
  const STOP=new Set(['DA','DE','DO','DOS','DAS','E','LTDA','ME','EPP','MEI','EIRELI','SA','S','A','TRANSP','TRANSPORTES','TRANSPORTE','SERVICOS']);
  const norm = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\(.*?\)/g,' ').replace(/[^A-Z/ ]/g,' ');
  const toks = s => norm(s).split(/[\s/]+/).filter(t=>t.length>1&&!STOP.has(t));
  function sugerirAgregado(nome,doc){
    const d=dig(doc); if(d){ const ant=lanc().filter(l=>dig(l.prestDoc)===d&&l.agregadoId&&agPorId(l.agregadoId)).sort((a,b)=>String(b.lancadoEm||'').localeCompare(String(a.lancadoEm||'')))[0]; if(ant) return {id:ant.agregadoId,como:'documento já vinculado'}; }
    const tp=new Set(toks(nome)); if(!tp.size) return null; let best=null;
    for(const a of AGS()){ if(a.ativo===false) continue; for(const alt of norm(a.nome).split('/')){ const ta=toks(alt); if(!ta.length) continue; const hit=ta.filter(t=>tp.has(t)).length, sc=hit/ta.length;
      if((hit>=2||(ta.length===1&&hit===1))&&sc>=.6&&(!best||sc>best.sc||(sc===best.sc&&hit>best.hit))) best={id:a.id,sc,hit}; } }
    return best?{id:best.id,como:best.sc===1?'nome idêntico':'nome parecido'}:null;
  }
  const vazio = () => ({numero:'',emissao:'',competencia:'',valor:null,liquido:null,prestDoc:'',prestNome:'',tomDoc:'',tomNome:'',regime:'Não identificado',empresa:'',agregadoId:'',vinculoComo:'',textoBruto:''});
  const OBRIG=['refMes','quinzena','numero','emissao','valor','prestDoc','prestNome','agregadoId'];
  const faltando = it => OBRIG.filter(k=>it[k]==null||it[k]==='');
  const semZero = n => String(n||'').replace(/^0+/,'');
  function duplicada(it,ignorar){ const n=semZero(it.numero), d=dig(it.prestDoc); if(!n||!d) return null;
    return lanc().find(l=>l.id!==ignorar&&semZero(l.numero)===n&&dig(l.prestDoc)===d) || N.fila.find(f=>f!==it&&f.key!==it.key&&!f.lendo&&semZero(f.numero)===n&&dig(f.prestDoc)===d&&N.fila.indexOf(f)<N.fila.indexOf(it)); }
  const mesmaQz = (it,ignorar) => it.agregadoId&&it.refMes&&it.quinzena ? lanc().find(l=>l.id!==ignorar&&l.agregadoId===it.agregadoId&&l.refMes===it.refMes&&l.quinzena===it.quinzena) : null;
  function avisoComp(it){ const c=it.competencia; if(!it.refMes||!/^\d{2}\/\d{4}$/.test(c||'')) return ''; const mc=`${c.slice(3)}-${c.slice(0,2)}`; return mc!==it.refMes?`A competência da nota (${c}) é diferente do mês de referência.`:''; }
  const chipReg = r => `<span class="pill ${r==='MEI'?'warn':r==='Simples Nacional'?'ok':'off'}">${esc(r||'Não identificado')}</span>`;
  const optsEmp = sel => `<option value="">— não identificada —</option>`+empresas().map(e=>`<option ${e.nome===sel?'selected':''}>${esc(e.nome)}</option>`).join('');
  const optsAg = sel => `<option value="">— selecione o agregado —</option>`+AGS().slice().sort((a,b)=>(b.ativo!==false)-(a.ativo!==false)||a.nome.localeCompare(b.nome,'pt-BR')).map(a=>`<option value="${esc(a.id)}" ${a.id===sel?'selected':''}>${esc(a.nome)}${a.ativo===false?' (inativo)':''}</option>`).join('');
  const nMoney = v => v!=null&&v!==''?Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2}):'';

  function formNf(it,pref){
    const miss=faltando(it), mc=k=>miss.includes(k)?' xmiss':'', a=agPorId(it.agregadoId);
    return `<div class="xgrid">
      <label class="lbl">Mês de referência<input type="month" data-${pref}="refMes" class="${mc('refMes')}" value="${esc(it.refMes||'')}"></label>
      <label class="lbl">Quinzena<select data-${pref}="quinzena" class="${mc('quinzena')}"><option value="">—</option><option value="1" ${it.quinzena==='1'?'selected':''}>1ª quinzena</option><option value="2" ${it.quinzena==='2'?'selected':''}>2ª quinzena</option></select></label>
      <label class="lbl">Nº da NFS<input data-${pref}="numero" class="${mc('numero')}" value="${esc(it.numero||'')}"></label>
      <label class="lbl">Data de emissão<input type="date" data-${pref}="emissao" class="${mc('emissao')}" value="${esc(it.emissao||'')}"></label>
      <label class="lbl">Competência (mm/aaaa)<input data-${pref}="competencia" value="${esc(it.competencia||'')}" placeholder="11/2026"></label>
      <label class="lbl">Valor do serviço<input data-${pref}="valor" class="${mc('valor')}" inputmode="decimal" value="${esc(nMoney(it.valor))}" placeholder="0,00"></label>
      <label class="lbl">Valor líquido<input data-${pref}="liquido" inputmode="decimal" value="${esc(nMoney(it.liquido))}" placeholder="0,00"></label>
      <label class="lbl">Regime do prestador<select data-${pref}="regime">${['MEI','Simples Nacional','Outro','Não identificado'].map(o=>`<option ${o===it.regime?'selected':''}>${o}</option>`).join('')}</select></label>
      <label class="lbl x2">Agregado vinculado (cadastro)<select data-${pref}="agregadoId" class="${mc('agregadoId')}">${optsAg(it.agregadoId)}</select></label>
      <label class="lbl x2">Prestador (nome na nota)<input data-${pref}="prestNome" class="${mc('prestNome')}" value="${esc(it.prestNome||'')}"></label>
      <label class="lbl">CPF/CNPJ prestador<input data-${pref}="prestDoc" class="${mc('prestDoc')}" value="${esc(fmtDoc(it.prestDoc))}"></label>
      <label class="lbl">CNPJ tomador<input data-${pref}="tomDoc" value="${esc(fmtDoc(it.tomDoc))}"></label>
      <label class="lbl">Empresa (tomador)<select data-${pref}="empresa">${optsEmp(it.empresa)}</select></label>
      <div class="dim" style="align-self:end;padding-bottom:8px">${a?`Cliente: <b>${esc(a.empresa||'—')}</b> · Locação: <b>${esc(a.locacao||'—')}</b>${it.vinculoComo?` · <span class="pill ${it.vinculoComo==='nome parecido'?'warn':'ok'}">${esc(it.vinculoComo)}</span>`:''}`:'<span style="color:var(--warn)">Selecione o agregado.</span>'}</div>
    </div>`;
  }
  function aplicaCampo(it,k,v){
    if(k==='valor'||k==='liquido') v=parseMoney(v); if(k==='prestDoc'||k==='tomDoc') v=dig(v);
    it[k]=v;
    if(k==='valor'&&(it.liquido==null||it.liquido==='')) it.liquido=v;
    if(k==='tomDoc'){ const e=empresaPorCnpj(v); if(e) it.empresa=e; }
    if(k==='agregadoId') it.vinculoComo=v?'escolhido manualmente':'';
    if((k==='prestNome'||k==='prestDoc')&&it.vinculoComo!=='escolhido manualmente'){ const sg=sugerirAgregado(it.prestNome,it.prestDoc); it.agregadoId=sg?sg.id:''; it.vinculoComo=sg?sg.como:''; }
  }
  function registroDe(it){ const a=agPorId(it.agregadoId); const {lendo,textoBruto,aviso,vinculoComo,key,arquivo,...r}=it;
    return {...r,agregado:a?a.nome:'',cliente:a?a.empresa||'':'',locacao:a?a.locacao||'':''}; }

  async function processarArquivos(files){
    const lista=[...files].filter(f=>/pdf$/i.test(f.name)||f.type==='application/pdf');
    if(!lista.length){ toast('Envie arquivos em PDF.'); return; }
    if(!window.pdfjsLib){ toast('Leitor de PDF não carregou. Recarregue a página.'); return; }
    if(!N.refMes||!N.refQz){ toast('Informe o mês e a quinzena antes de enviar as notas.'); return; }
    for(const f of lista){ const it={key:uid(),arquivo:f.name,lendo:true,refMes:N.refMes,quinzena:N.refQz}; N.fila.push(it); redesenhar();
      try{ const L=await lerPdf(f); Object.assign(it, L.length?extrair(L):{...vazio(),aviso:'PDF sem texto (provavelmente imagem/escaneado). Preencha manualmente.'}); }
      catch(e){ Object.assign(it,vazio(),{aviso:'Não foi possível ler este PDF: '+(e.message||e)}); }
      it.refMes=N.refMes; it.quinzena=N.refQz; it.lendo=false; redesenhar(); }
  }
  async function lancarFila(itens){
    if(!pode('nfs','criar')){ toast('Seu perfil não pode lançar NFS.'); return; }
    let n=0; for(const it of itens){ if(it.lendo||duplicada(it)||faltando(it).length) continue;
      const id=uid(); const ok=await gravar('nfs',id,{...registroDe(it),origem:'Importação de PDF',...quem(),lancadoEm:new Date().toISOString()});
      if(ok){ N.fila=N.fila.filter(f=>f!==it); n++; } }
    redesenhar(); toast(n?`${n} NFS lançada(s).`:'Nenhuma nota pronta para lançar.');
  }

  function vImportar(){
    const pc=pode('nfs','criar'); const refOk=N.refMes&&N.refQz;
    return `<section class="panel step"><h2>1 · Referência e envio das NFS em PDF</h2>
      ${pc?'':'<div class="notice">Seu perfil só pode consultar as NFS.</div>'}
      <div class="bar"><label class="lbl">Mês de referência<input type="month" id="xn_refmes" value="${esc(N.refMes)}" style="width:auto"></label>
        <label class="lbl">Quinzena<select id="xn_refqz" style="width:auto"><option value="">— selecione —</option><option value="1" ${N.refQz==='1'?'selected':''}>1ª quinzena (1 a 15)</option><option value="2" ${N.refQz==='2'?'selected':''}>2ª quinzena (16 ao fim)</option></select></label>
        <span style="align-self:flex-end;padding-bottom:9px;color:${refOk?'var(--ok)':'var(--warn)'}">${refOk?'As notas serão lançadas na '+refLabel(N.refMes,N.refQz)+'.':'Selecione o mês e a quinzena antes de enviar as notas.'}</span></div>
      <div class="xdrop${refOk&&pc?'':' xdis'}" id="xn_drop"><div>Arraste os PDFs aqui ou <b>clique para escolher</b></div><div class="dim">Pode enviar várias notas de uma vez. A leitura é feita no seu navegador.</div><input type="file" id="xn_file" accept="application/pdf,.pdf" multiple hidden></div>
      <div class="row"><button data-xn="colar" ${pc?'':'disabled'}>Colar texto de uma nota</button><button data-xn="novaNf" ${pc?'':'disabled'}>+ Incluir NFS manual</button></div>
      ${N.mostraColar?`<textarea id="xn_colar" rows="7" placeholder="Cole aqui o texto copiado da NFS">${esc(N.colar)}</textarea><div><button class="primary" data-xn="lerColado">Ler texto</button></div>`:''}
    </section>
    <section class="panel step"><div class="row" style="justify-content:space-between"><h2>2 · Conferir e lançar</h2>
      <div class="row"><button class="danger" data-xn="descTodos" ${N.fila.length?'':'disabled'}>Descartar todas</button><button class="primary" data-xn="lancTodos" ${N.fila.length&&pc?'':'disabled'}>Lançar todas as válidas</button></div></div>
      <div class="dim">Campos destacados não foram encontrados na nota. NFS com o mesmo número do mesmo prestador é bloqueada.</div>
      ${N.fila.length?N.fila.map(it=>{ if(it.lendo) return `<div class="xnf"><b>${esc(it.arquivo)}</b> <span class="pill off">lendo…</span></div>`;
        const falt=faltando(it), dup=duplicada(it), mq=mesmaQz(it), avc=avisoComp(it);
        return `<div class="xnf${dup?' xdup':''}" data-xkey="${it.key}"><div class="row" style="justify-content:space-between"><div class="row"><b>📄 ${esc(it.arquivo)}</b>${dup?'<span class="pill bad">Já lançada</span>':falt.length?`<span class="pill warn">${falt.length} campo(s) a preencher</span>`:'<span class="pill ok">Pronta</span>'}${chipReg(it.regime)}<span class="pill off">${esc(refLabel(it.refMes,it.quinzena))}</span></div>
          <div class="row"><button class="danger" data-xn="desc">Descartar</button><button class="primary" data-xn="lanc" ${dup||falt.length||!pc?'disabled':''}>Lançar</button></div></div>
          ${it.aviso?`<div class="notice warn">${esc(it.aviso)}</div>`:''}${dup?`<div class="notice warn">NFS nº ${esc(it.numero)} deste prestador já existe.</div>`:''}
          ${mq&&!dup?`<div class="notice warn">Já existe a NFS nº ${esc(mq.numero)} deste agregado na ${esc(refLabel(mq.refMes,mq.quinzena))}. Confira antes de lançar.</div>`:''}${avc?`<div class="notice warn">${esc(avc)}</div>`:''}
          ${formNf(it,'xq')}
          ${it.textoBruto?`<details><summary class="dim">Ver texto lido da nota</summary><pre class="xraw">${esc(it.textoBruto)}</pre></details>`:''}</div>`; }).join(''):'<div class="empty">Nenhuma nota aguardando conferência.</div>'}
    </section>`;
  }

  function filtLanc(){
    const b=N.lBusca.trim().toLowerCase(), bd=dig(b);
    return lanc().filter(l=>{ const a=agPorId(l.agregadoId);
      if(b&&!([a?a.nome:l.agregado,l.prestNome,l.numero,a?a.empresa:l.cliente,a?a.locacao:l.locacao].join(' ').toLowerCase().includes(b)||(bd&&dig(l.prestDoc).includes(bd)))) return false;
      if(N.lDe&&(l.emissao||'')<N.lDe) return false; if(N.lAte&&(l.emissao||'')>N.lAte) return false;
      if(N.lRef&&refKey(l.refMes,l.quinzena)!==N.lRef) return false; if(N.lReg&&l.regime!==N.lReg) return false; if(N.lEmp&&l.empresa!==N.lEmp) return false; return true;
    }).map(l=>{ const a=agPorId(l.agregadoId); return {...l,agNome:a?a.nome:l.agregado||'',cli:a?a.empresa||'':l.cliente||'',loc:a?a.locacao||'':l.locacao||'',refKey:refKey(l.refMes,l.quinzena)}; });
  }
  const LCOLS=[['_',''],['valor','Valor',1],['liquido','Líquido',1],['refKey','Referência'],['emissao','Emissão'],['numero','Nº NFS'],['agNome','Agregado'],['cli','Cliente'],['loc','Locação'],['prestNome','Prestador (nota)'],['prestDoc','CPF/CNPJ'],['regime','Regime'],['empresa','Empresa'],['competencia','Compet.']];
  function vLanc(){
    const rows=ordenar(filtLanc(),N.sortL,(r,k)=>k==='numero'?+r.numero||0:r[k]); const todos=lanc();
    const refs=[...new Set(todos.map(l=>refKey(l.refMes,l.quinzena)).filter(Boolean))].sort().reverse();
    const pe=pode('nfs','editar'), px=pode('nfs','excluir'), pc=pode('nfs','criar');
    return `<div class="tiles">
      <div class="tile"><div class="k">NFS no filtro</div><div class="v">${rows.length}</div></div>
      <div class="tile"><div class="k">Valor total</div><div class="v">${fmt(rows.reduce((s,l)=>s+(l.valor||0),0))}</div></div>
      <div class="tile"><div class="k">MEI</div><div class="v">${rows.filter(l=>l.regime==='MEI').length}</div></div>
      <div class="tile"><div class="k">Simples Nacional</div><div class="v">${rows.filter(l=>l.regime==='Simples Nacional').length}</div></div>
      <div class="tile"><div class="k">Outros / não ident.</div><div class="v">${rows.filter(l=>l.regime!=='MEI'&&l.regime!=='Simples Nacional').length}</div></div></div>
    <section class="panel step"><div class="bar">
      <label class="lbl grow">Pesquisar (agregado, cliente, locação, documento ou nº)<input id="xl_busca" value="${esc(N.lBusca)}"></label>
      <label class="lbl">Emissão de<input type="date" id="xl_de" value="${N.lDe}" style="width:auto"></label>
      <label class="lbl">até<input type="date" id="xl_ate" value="${N.lAte}" style="width:auto"></label>
      <label class="lbl">Referência<select id="xl_ref" style="width:auto"><option value="">Todas</option>${refs.map(r=>{const [m,q]=r.split('|'); return `<option value="${r}" ${r===N.lRef?'selected':''}>${refLabel(m,q)}</option>`;}).join('')}</select></label>
      <label class="lbl">Regime<select id="xl_reg" style="width:auto"><option value="">Todos</option>${['MEI','Simples Nacional','Outro','Não identificado'].map(o=>`<option ${o===N.lReg?'selected':''}>${o}</option>`).join('')}</select></label>
      <label class="lbl">Empresa<select id="xl_emp" style="width:auto"><option value="">Todas</option>${empresas().map(e=>`<option ${e.nome===N.lEmp?'selected':''}>${esc(e.nome)}</option>`).join('')}</select></label>
      <div class="row" style="align-self:flex-end"><button data-xn="limpar">Limpar filtros</button>${pc?'<button data-xn="novaNf">+ Incluir NFS manual</button>':''}<button class="primary" data-xn="pdfLanc">Gerar PDF</button></div></div></section>
    <section class="panel"><div class="scroll"><table style="min-width:1400px"><thead><tr>${thHtml(LCOLS,N.sortL,'l')}</tr></thead><tbody>
      ${rows.length?rows.map(l=>`<tr><td style="white-space:nowrap"><button data-xedit="${esc(l.id)}">${pe?'Editar':'Ver'}</button>${px?` <button class="danger" data-xdel="${esc(l.id)}">Excluir</button>`:''}</td>
        <td class="n" style="color:var(--magenta);font-weight:600">${fmt(l.valor)}</td><td class="n">${fmt(l.liquido)}</td><td style="white-space:nowrap">${esc(refLabel(l.refMes,l.quinzena))}</td><td class="mono">${br(l.emissao)}</td><td class="mono">${esc(l.numero)}</td>
        <td style="font-weight:600">${esc(l.agNome)}</td><td>${esc(l.cli)}</td><td>${esc(l.loc)}</td><td>${esc(l.prestNome)}</td><td class="mono">${esc(fmtDoc(l.prestDoc))}</td><td>${chipReg(l.regime)}</td><td>${esc(l.empresa||'—')}</td><td class="mono">${esc(l.competencia||'')}</td></tr>`).join('')
        :`<tr><td colspan="${LCOLS.length}" class="empty">Nenhuma NFS ${todos.length?'no filtro atual':'lançada ainda'}.</td></tr>`}</tbody></table></div></section>`;
  }

  function linhasCtrl(){
    const [ini,fim]=quinzena(N.cMes,N.cQz); const L=lanc();
    return AGS().filter(a=>ativoNoPeriodo(a,ini,fim)&&(!N.cCli||(a.empresa||'')===N.cCli)).map(a=>{ const notas=L.filter(l=>l.agregadoId===a.id&&l.refMes===N.cMes&&l.quinzena===N.cQz);
      return {a,nome:a.nome,cliente:a.empresa||'',locacao:a.locacao||'',notas,ok:notas.length>0,sit:notas.length?1:0,nf:notas.map(n=>n.numero).join(', '),emissao:notas[0]?notas[0].emissao:'',regime:notas[0]?notas[0].regime:'',valor:notas.reduce((s,n)=>s+(n.valor||0),0)}; });
  }
  const CCOLS=[['sit','Situação'],['nome','Agregado'],['cliente','Cliente'],['locacao','Locação'],['nf','Nº NFS'],['emissao','Emissão'],['regime','Regime'],['valor','Valor',1]];
  function vCtrl(){
    const todas=linhasCtrl(), b=norm(N.cBusca).trim();
    const rows=ordenar(todas.filter(r=>(!N.cSit||(N.cSit==='ok')===r.ok)&&(!b||norm(r.nome+' '+r.locacao).includes(b))),N.sortC,(r,k)=>r[k]);
    const [ini,fim]=quinzena(N.cMes,N.cQz); const clis=[...new Set(AGS().filter(a=>ativoNoPeriodo(a,ini,fim)).map(a=>a.empresa||''))].filter(Boolean).sort();
    return `<section class="panel step"><div class="bar">
      <label class="lbl">Mês<input type="month" id="xc_mes" value="${N.cMes}" style="width:auto"></label>
      <label class="lbl">Quinzena<select id="xc_qz" style="width:auto"><option value="1" ${N.cQz==='1'?'selected':''}>1ª quinzena</option><option value="2" ${N.cQz==='2'?'selected':''}>2ª quinzena</option></select></label>
      <label class="lbl">Situação<select id="xc_sit" style="width:auto"><option value="">Todas</option><option value="ok" ${N.cSit==='ok'?'selected':''}>NFS recebida</option><option value="pend" ${N.cSit==='pend'?'selected':''}>Pendente</option></select></label>
      <label class="lbl">Cliente<select id="xc_cli" style="width:auto"><option value="">Todos</option>${clis.map(c=>`<option ${c===N.cCli?'selected':''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="lbl grow">Pesquisar agregado<input id="xc_busca" value="${esc(N.cBusca)}" placeholder="Nome ou locação"></label>
      <button class="primary" data-xn="pdfCtrl" style="align-self:flex-end">Gerar PDF</button></div></section>
    <div class="tiles">
      <div class="tile"><div class="k">Agregados no período</div><div class="v">${todas.length}</div></div>
      <div class="tile"><div class="k">NFS recebidas</div><div class="v">${todas.filter(r=>r.ok).length}</div></div>
      <div class="tile"><div class="k">Pendentes (sem NFS = sem pagamento)</div><div class="v">${todas.filter(r=>!r.ok).length}</div></div>
      <div class="tile"><div class="k">Valor das NFS recebidas</div><div class="v">${fmt(todas.reduce((s,r)=>s+r.valor,0))}</div></div></div>
    <section class="panel"><div class="scroll"><table style="min-width:960px"><thead><tr>${thHtml(CCOLS,N.sortC,'c')}</tr></thead><tbody>
      ${rows.length?rows.map(r=>`<tr><td>${r.ok?`<span class="pill ok">NFS recebida</span>${r.notas.length>1?` <span class="pill warn">${r.notas.length} notas</span>`:''}`:'<span class="pill bad">Pendente</span>'}</td>
        <td style="font-weight:600">${esc(r.nome)}</td><td>${esc(r.cliente)}</td><td>${esc(r.locacao)}</td><td class="mono">${esc(r.nf||'—')}</td><td class="mono">${r.emissao?br(r.emissao):'—'}</td><td>${r.ok?chipReg(r.regime):''}</td><td class="n" style="${r.ok?'color:var(--magenta);font-weight:600':''}">${r.ok?fmt(r.valor):'—'}</td></tr>`).join('')
        :'<tr><td colspan="8" class="empty">Nenhum agregado neste filtro.</td></tr>'}</tbody></table></div></section>`;
  }

  const ECOLS=[['nome','Empresa'],['cnpj','CNPJ'],['_','']];
  function vEmp(){
    const pe=pode('nfs','editar')||pode('nfs','criar'); const lista=N.empEd||empresas().map(e=>({...e}));
    const idx=ordenar(lista.map((e,i)=>({...e,i})),N.sortE,(r,k)=>k==='cnpj'?dig(r.cnpj):r[k]);
    return `<section class="panel"><div class="ph"><div><h2>Empresas do grupo (tomadores)</h2><span class="dim">O CNPJ do tomador lido na nota é comparado com esta lista para identificar a empresa automaticamente.</span></div>
      ${pe?`<div class="row"><button data-xn="empAdd">+ Adicionar empresa</button><button class="primary" data-xn="empSalvar">Salvar</button></div>`:''}</div>
      <div class="scroll"><table style="min-width:560px"><thead><tr>${thHtml(ECOLS,N.sortE,'e')}</tr></thead><tbody>
      ${idx.map(e=>`<tr><td><input data-xemp="${e.i}|nome" value="${esc(e.nome)}" ${pe?'':'disabled'}></td><td><input data-xemp="${e.i}|cnpj" value="${esc(fmtDoc(e.cnpj))}" placeholder="00.000.000/0000-00" ${pe?'':'disabled'}></td><td>${pe?`<button class="danger" data-xemprm="${e.i}">Remover</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function vNfs(){
    return `<div class="xwrap">
      <div class="row" style="justify-content:space-between"><span class="dim">Notas fiscais de serviço dos agregados: o pagamento só é feito depois que a NFS da quinzena chega.</span>
        <div class="seg">${[['importar','Importar'],['lanc','Lançamentos'],['ctrl','Controle da quinzena'],['emp','Empresas do grupo']].map(([k,t])=>`<button data-xnsub="${k}" aria-pressed="${N.sub===k}">${t}${k==='lanc'&&lanc().length?' ('+lanc().length+')':''}</button>`).join('')}</div></div>
      ${!loaded.nfs?'<div class="empty">Carregando…</div>':N.sub==='importar'?vImportar():N.sub==='lanc'?vLanc():N.sub==='ctrl'?vCtrl():vEmp()}</div>`;
  }

  // ---- modal de edição / inclusão manual ----
  function abrirNf(l){
    if(l){ N.edOrig=l; N.ed={...l}; } else { N.edOrig=null; N.ed={...vazio(),refMes:N.refMes||hojeIso().slice(0,7),quinzena:N.refQz||''}; }
    desenhaModal();
  }
  function desenhaModal(){
    let r=document.getElementById('xModal'); if(!N.ed){ if(r) r.remove(); return; }
    if(!r){ r=document.createElement('div'); r.id='xModal'; r.className='modal'; document.body.appendChild(r); ligarModal(r); }
    const it=N.ed, miss=faltando(it), dup=duplicada(it,it.id), mq=mesmaQz(it,it.id), avc=avisoComp(it);
    const podeSalvar=N.edOrig?pode('nfs','editar'):pode('nfs','criar');
    const foco=document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.xm;
    r.innerHTML=`<div class="dialog" style="max-width:980px"><div class="row" style="justify-content:space-between"><h3>${N.edOrig?'NFS nº '+esc(N.edOrig.numero):'Incluir NFS manualmente'}</h3>
      ${dup?'<span class="pill bad">Nº já lançado para este prestador</span>':miss.length?`<span class="pill warn">${miss.length} campo(s) obrigatório(s)</span>`:'<span class="pill ok">Pronta para salvar</span>'}</div>
      ${podeSalvar?'':'<div class="notice">Somente leitura: seu perfil não pode editar NFS.</div>'}
      ${mq?`<div class="notice warn">Já existe a NFS nº ${esc(mq.numero)} deste agregado na ${esc(refLabel(mq.refMes,mq.quinzena))}.</div>`:''}${avc?`<div class="notice warn">${esc(avc)}</div>`:''}
      ${formNf(it,'xm')}
      ${N.edOrig&&N.edOrig.porNome?`<div class="dim">Lançada por ${esc(N.edOrig.porNome)}${N.edOrig.lancadoEm?' em '+new Date(N.edOrig.lancadoEm).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):''}${N.edOrig.origem?' · '+esc(N.edOrig.origem):''}</div>`:''}
      <div class="actions">${N.edOrig&&pode('nfs','excluir')?'<button class="danger left" data-xm-act="excluir">Excluir NFS</button>':''}<button data-xm-act="fechar">${podeSalvar?'Cancelar':'Fechar'}</button>${podeSalvar?`<button class="primary" data-xm-act="salvar" ${dup||miss.length?'disabled':''}>Salvar</button>`:''}</div></div>`;
    if(!podeSalvar) r.querySelectorAll('input,select').forEach(e=>e.disabled=true);
    if(foco){ const el=r.querySelector(`[data-xm="${foco}"]`); if(el) el.focus(); }
  }
  function ligarModal(r){
    r.addEventListener('change',e=>{ const k=e.target.dataset.xm; if(!k||!N.ed) return; aplicaCampo(N.ed,k,e.target.value); setTimeout(desenhaModal,0); });
    r.addEventListener('click',async e=>{ const b=e.target.closest('[data-xm-act]'); if(!b) return; const act=b.dataset.xmAct;
      if(act==='fechar'){ N.ed=null; desenhaModal(); return; }
      if(act==='salvar'){ const it=N.ed; if(faltando(it).length||duplicada(it,it.id)) return;
        let ok; if(N.edOrig){ ok=await gravar('nfs',N.edOrig.id,{...registroDe(it),editadoPor:quem().porNome,editadoEm:new Date().toISOString()}); }
        else ok=await gravar('nfs',uid(),{...registroDe(it),origem:'Inclusão manual',...quem(),lancadoEm:new Date().toISOString()});
        if(ok){ toast(N.edOrig?'NFS atualizada.':'NFS incluída.'); N.ed=null; desenhaModal(); } return; }
      if(act==='excluir'){ const l=N.edOrig; if(!confirm(`Excluir a NFS nº ${l.numero}? Esta ação não pode ser desfeita.`)) return; if(await apagar('nfs',l.id)){ toast('NFS excluída.'); N.ed=null; desenhaModal(); } }
    });
  }

  // ---- PDFs NFS ----
  function pdfLanc(){
    if(semPdf()) return; const rows=ordenar(filtLanc(),N.sortL,(r,k)=>k==='numero'?+r.numero||0:r[k]); if(!rows.length){ toast('Nada para gerar no filtro atual.'); return; }
    const tot=rows.reduce((s,l)=>s+(l.valor||0),0), liq=rows.reduce((s,l)=>s+(l.liquido||0),0); const f=[];
    if(N.lBusca) f.push('Pesquisa: '+N.lBusca); if(N.lDe) f.push('Emissão de '+br(N.lDe)); if(N.lAte) f.push('até '+br(N.lAte)); if(N.lRef){ const [m,q]=N.lRef.split('|'); f.push('Referência: '+refLabel(m,q)); } if(N.lReg) f.push('Regime: '+N.lReg); if(N.lEmp) f.push('Empresa: '+N.lEmp);
    const doc=montarPdf({titulo:'Lançamentos de NFS — Agregados',filtros:f.length?f:['Nenhum'],
      kpis:[['NFS',rows.length],['Valor total',fmt(tot)],['MEI',rows.filter(l=>l.regime==='MEI').length],['Simples Nacional',rows.filter(l=>l.regime==='Simples Nacional').length]],
      head:['Valor','Líquido','Referência','Emissão','Nº NFS','Agregado','Cliente','Locação','CPF/CNPJ','Regime','Empresa'],
      body:rows.map(l=>[fmt(l.valor),fmt(l.liquido),refLabel(l.refMes,l.quinzena),br(l.emissao),l.numero,l.agNome,l.cli,l.loc,fmtDoc(l.prestDoc),l.regime,l.empresa||'—']),
      foot:[fmt(tot),fmt(liq),'Total','','','','','','','',''],colStyles:{0:{halign:'right'},1:{halign:'right'}}});
    previsualizar(doc,nomeArq('lancamentos-nfs'),'Pré-visualização · Lançamentos de NFS');
  }
  function pdfCtrl(){
    if(semPdf()) return; const todas=linhasCtrl(), b=norm(N.cBusca).trim();
    const rows=ordenar(todas.filter(r=>(!N.cSit||(N.cSit==='ok')===r.ok)&&(!b||norm(r.nome+' '+r.locacao).includes(b))),N.sortC,(r,k)=>r[k]); if(!rows.length){ toast('Nada para gerar no filtro atual.'); return; }
    const f=['Referência: '+refLabel(N.cMes,N.cQz)]; if(N.cSit) f.push(N.cSit==='ok'?'NFS recebida':'Pendente'); if(N.cCli) f.push('Cliente: '+N.cCli);
    const doc=montarPdf({titulo:'Controle de NFS por quinzena — Agregados',subtitulo:refLabel(N.cMes,N.cQz),filtros:f,
      kpis:[['Agregados no período',todas.length],['NFS recebidas',todas.filter(r=>r.ok).length],['Pendentes',todas.filter(r=>!r.ok).length],['Valor das NFS',fmt(todas.reduce((s,r)=>s+r.valor,0))]],
      head:['Situação','Agregado','Cliente','Locação','Nº NFS','Emissão','Regime','Valor'],
      body:rows.map(r=>[r.ok?'NFS recebida':'PENDENTE',r.nome,r.cliente,r.locacao,r.nf||'—',r.emissao?br(r.emissao):'—',r.regime||'—',r.ok?fmt(r.valor):'—']),
      foot:['Total','','','','','','',fmt(rows.reduce((s,r)=>s+r.valor,0))],colStyles:{7:{halign:'right'}},
      celula:d=>{ if(d.section==='body'&&d.column.index===0){ d.cell.styles.fontStyle='bold'; d.cell.styles.textColor=d.cell.raw==='PENDENTE'?[209,52,56]:[46,158,91]; } }});
    previsualizar(doc,nomeArq(`controle-nfs-${N.cMes}-q${N.cQz}`),'Pré-visualização · Controle de NFS');
  }
  function pdfEmp(){ if(semPdf()) return; const rows=ordenar(empresas(),N.sortE,(r,k)=>k==='cnpj'?dig(r.cnpj):r[k]);
    previsualizar(montarPdf({titulo:'Empresas do grupo',head:['Empresa','CNPJ'],body:rows.map(e=>[e.nome,fmtDoc(e.cnpj)||'—'])}),nomeArq('empresas-do-grupo'),'Pré-visualização · Empresas do grupo'); }

  /* =====================================================================
     montagem, eventos e redesenho
     ===================================================================== */
  let root=null, tabAtual=null;
  function redesenhar(){
    if(!root||!document.body.contains(root)) return;
    const ae=document.activeElement; const foco=ae&&root.contains(ae)?(ae.id||(ae.dataset&&(ae.dataset.xq&&ae.closest('[data-xkey]')?'q:'+ae.closest('[data-xkey]').dataset.xkey+':'+ae.dataset.xq:ae.dataset.xemp?'e:'+ae.dataset.xemp:''))):'';
    const sel=ae&&ae.selectionStart;
    root.innerHTML = tabAtual==='frequencia'?vFrequencia():vNfs();
    if(foco){ let el=null; if(foco.startsWith('q:')){ const [,k,f]=foco.split(':'); el=root.querySelector(`[data-xkey="${k}"] [data-xq="${f}"]`); } else if(foco.startsWith('e:')) el=root.querySelector(`[data-xemp="${foco.slice(2)}"]`); else el=document.getElementById(foco);
      if(el){ el.focus(); try{ if(sel!=null) el.setSelectionRange(sel,sel); }catch(e){} } }
  }
  function montar(tab,v){
    tabAtual=tab; root=document.createElement('div'); root.id='extRoot'; root.dataset.tab=tab; v.appendChild(root); ligar(root); conectar(); redesenhar();
  }
  function ligar(r){
    r.addEventListener('click',async e=>{
      const t=e.target;
      const so=t.closest('[data-xsort]'); if(so){ const [g,k]=so.dataset.xsort.split('|'); const key={d:'sortD',f:'sortF',r:'sortR'}[g]; if(key) F[key]=toggleSort(F[key],k); else { const nk={l:'sortL',c:'sortC',e:'sortE'}[g]; N[nk]=toggleSort(N[nk],k); } redesenhar(); return; }
      const fs=t.closest('[data-xfsub]'); if(fs){ F.sub=fs.dataset.xfsub; redesenhar(); return; }
      const ns=t.closest('[data-xnsub]'); if(ns){ N.sub=ns.dataset.xnsub; N.empEd=null; redesenhar(); return; }
      const mk=t.closest('[data-xmark]'); if(mk){ const [id,p]=mk.dataset.xmark.split('|'); marcar(id,p); return; }
      const dd=t.closest('[data-xdia]'); if(dd){ F.data=dd.dataset.xdia; F.sub='lancar'; redesenhar(); return; }
      const rm=t.closest('[data-xrm]'); if(rm){ const f=D.faltas.get(rm.dataset.xrm); if(!f) return; if(!confirm(`Remover a falta de ${f.agregado} em ${br(f.data)}? O agregado volta a contar como presente nesse dia.`)) return; await gravar('faltas',rm.dataset.xrm,{...f,periodo:'',...quem(),em:new Date().toISOString()}); return; }
      const xf=t.closest('[data-xf]'); if(xf){ const a=xf.dataset.xf;
        if(a==='prev') F.data=addDias(F.data,-1); else if(a==='next') F.data=addDias(F.data,1); else if(a==='ontem') F.data=addDias(hojeIso(),-1);
        else if(a==='conf') return conferir(); else if(a==='pdfDia') return pdfDia(); else if(a==='pdfFech') return pdfFech(); else if(a==='pdfReg') return pdfReg();
        redesenhar(); return; }
      const ed=t.closest('[data-xedit]'); if(ed){ const l=lanc().find(x=>x.id===ed.dataset.xedit); if(l) abrirNf(l); return; }
      const dl=t.closest('[data-xdel]'); if(dl){ const l=lanc().find(x=>x.id===dl.dataset.xdel); if(!l) return; if(!confirm(`Excluir a NFS nº ${l.numero}? Esta ação não pode ser desfeita.`)) return; if(await apagar('nfs',l.id)) toast('NFS excluída.'); return; }
      const er=t.closest('[data-xemprm]'); if(er){ N.empEd=N.empEd||empresas().map(e=>({...e})); N.empEd.splice(+er.dataset.xemprm,1); redesenhar(); return; }
      if(t.closest('#xn_drop')){ if(!N.refMes||!N.refQz){ toast('Informe o mês e a quinzena antes de enviar as notas.'); return; } if(!pode('nfs','criar')) return; document.getElementById('xn_file').click(); return; }
      const xn=t.closest('[data-xn]'); if(xn){ const a=xn.dataset.xn, card=xn.closest('[data-xkey]'), it=card&&N.fila.find(f=>f.key===card.dataset.xkey);
        if(a==='desc'&&it){ N.fila=N.fila.filter(f=>f!==it); redesenhar(); }
        else if(a==='lanc'&&it) lancarFila([it]);
        else if(a==='lancTodos') lancarFila(N.fila.slice());
        else if(a==='descTodos'){ if(confirm(`Descartar as ${N.fila.length} nota(s) da fila?`)){ N.fila=[]; redesenhar(); } }
        else if(a==='colar'){ N.mostraColar=!N.mostraColar; redesenhar(); }
        else if(a==='lerColado'){ if(!N.colar.trim()) return; if(!N.refMes||!N.refQz){ toast('Informe o mês e a quinzena.'); return; } N.fila.push({key:uid(),arquivo:'Texto colado',lendo:false,...extrair(linhasDeTexto(N.colar)),refMes:N.refMes,quinzena:N.refQz}); N.colar=''; N.mostraColar=false; redesenhar(); }
        else if(a==='novaNf') abrirNf(null);
        else if(a==='limpar'){ Object.assign(N,{lBusca:'',lDe:'',lAte:'',lRef:'',lReg:'',lEmp:''}); redesenhar(); }
        else if(a==='pdfLanc') pdfLanc(); else if(a==='pdfCtrl') pdfCtrl();
        else if(a==='empAdd'){ N.empEd=N.empEd||empresas().map(e=>({...e})); N.empEd.push({nome:'',cnpj:''}); redesenhar(); }
        else if(a==='empSalvar'){ const lista=(N.empEd||empresas()).filter(e=>e.nome.trim()).map(e=>({nome:e.nome.trim(),cnpj:dig(e.cnpj)})); if(await gravar('nfs','__empresas',{lista})){ N.empEd=null; toast('Empresas salvas.'); N.fila.forEach(f=>{ if(!f.empresa) f.empresa=empresaPorCnpj(f.tomDoc); }); redesenhar(); } }
        return; }
    });
    const onVal=e=>{ const el=e.target, id=el.id;
      const map={xf_data:['F','data'],xf_cli:['F','cli'],xf_loc:['F','loc'],xf_so:['F','so'],xf_busca:['F','busca'],xg_mes:['F','fMes'],xg_qz:['F','fQz'],xg_cli:['F','fCli'],xg_ag:['F','fAg'],xg_most:['F','fMost'],
        xr_de:['F','rDe'],xr_ate:['F','rAte'],xr_per:['F','rPer'],xr_busca:['F','rBusca'],xn_refmes:['N','refMes'],xn_refqz:['N','refQz'],xn_colar:['N','colar'],
        xl_busca:['N','lBusca'],xl_de:['N','lDe'],xl_ate:['N','lAte'],xl_ref:['N','lRef'],xl_reg:['N','lReg'],xl_emp:['N','lEmp'],xc_mes:['N','cMes'],xc_qz:['N','cQz'],xc_sit:['N','cSit'],xc_cli:['N','cCli'],xc_busca:['N','cBusca']};
      if(map[id]){ const [o,k]=map[id]; (o==='F'?F:N)[k]=el.value; if(id==='xf_data'&&!el.value) return; if(id==='xg_cli') F.fAg=''; if(id==='xf_cli') F.loc=''; if(id==='xn_colar') return; clearTimeout(onVal._t); onVal._t=setTimeout(redesenhar, (e.type==='input'&&(el.type==='text'||el.type==='search'))?150:0); return; }
      if(el.dataset.xemp){ const [i,k]=el.dataset.xemp.split('|'); N.empEd=N.empEd||empresas().map(x=>({...x})); N.empEd[+i][k]=k==='cnpj'?dig(el.value):el.value; return; }
      if(el.dataset.xq&&e.type==='change'){ const card=el.closest('[data-xkey]'); const it=card&&N.fila.find(f=>f.key===card.dataset.xkey); if(!it) return; aplicaCampo(it,el.dataset.xq,el.value); setTimeout(redesenhar,0); }
    };
    r.addEventListener('input',onVal); r.addEventListener('change',e=>{ if(e.target.id==='xn_file'){ processarArquivos(e.target.files); e.target.value=''; return; } onVal(e); });
    r.addEventListener('dragover',e=>{ const d=e.target.closest('#xn_drop'); if(d){ e.preventDefault(); d.classList.add('xover'); } });
    r.addEventListener('dragleave',e=>{ const d=e.target.closest('#xn_drop'); if(d) d.classList.remove('xover'); });
    r.addEventListener('drop',e=>{ const d=e.target.closest('#xn_drop'); if(!d) return; e.preventDefault(); d.classList.remove('xover'); if(!pode('nfs','criar')) return; processarArquivos(e.dataTransfer.files); });
  }

  // chamado pelo render() do sistema
  function mostrar(tab,v){
    const r=v.querySelector('#extRoot');
    if(r&&r.dataset.tab===tab){ redesenhar(); return; }
    v.innerHTML=''; montar(tab,v);
  }

  /* estilos dos módulos extras (seguem a paleta do sistema) */
  (function(){ const st=document.createElement('style'); st.textContent=`
    .xwrap{display:flex;flex-direction:column;gap:14px}
    .xseg{display:inline-flex;border:1px solid var(--accent);border-radius:4px;overflow:hidden}
    .xseg button{border:0;border-radius:0;border-right:1px solid var(--accent);background:var(--surface);color:var(--accent);padding:5px 10px;font-size:12px}
    .xseg button:last-child{border-right:0}
    .xseg button.on{background:var(--accent);color:var(--accent-ink)}
    .xseg button.on.int{background:var(--bad);color:#fff}
    .xseg button.on.meio{background:var(--magenta);color:#fff}
    tr.xaus td{background:var(--bad-soft)}
    tr.xoff td{opacity:.55}
    .xcal{display:flex;flex-wrap:wrap;gap:6px}
    .xd{display:flex;flex-direction:column;align-items:center;min-width:58px;padding:6px 4px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font-size:11px;color:var(--muted)}
    .xd b{font-size:16px;color:var(--title)}
    .xd.conf{background:var(--ok-soft);border-color:var(--ok)}
    .xd.pend{background:var(--warn-soft);border-color:var(--magenta-claro)}
    .xd.fds{opacity:.6}
    .xd .xn{color:var(--bad);font-weight:600}
    .xdrop{border:2px dashed var(--marinho-claro);border-radius:6px;padding:26px;text-align:center;cursor:pointer;background:var(--field)}
    .xdrop b{color:var(--magenta)}
    .xdrop.xover{border-color:var(--magenta);background:var(--accent-soft)}
    .xdrop.xdis{opacity:.5}
    .xnf{border:1px solid var(--line);border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--surface)}
    .xnf.xdup{border-color:var(--bad);background:var(--bad-soft)}
    .xgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
    .xgrid .x2{grid-column:span 2}
    .xmiss{box-shadow:inset 0 0 0 1.5px var(--magenta)!important;background:var(--warn-soft)!important}
    .xraw{white-space:pre-wrap;font:11px var(--f-mono);background:var(--field);border-radius:6px;padding:10px;max-height:260px;overflow:auto}
    #extRoot .dim{color:var(--muted);font-size:12px}
    .xprev{position:fixed;inset:0;background:rgba(10,16,30,.7);z-index:60;display:flex;flex-direction:column}
    .xprev[hidden]{display:none}
    .xprev-bar{background:var(--surface);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .xprev-bar b{color:var(--title)} .xprev-bar .dim{color:var(--muted);font-size:12px}
    .xprev-pages{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;align-items:center;gap:16px}
    .xprev-pages canvas{background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.4);max-width:100%;height:auto}
    #xModal .dim{color:var(--muted);font-size:12px}
    @media (max-width:700px){.xgrid .x2{grid-column:auto}}
  `; document.head.appendChild(st); })();
  if(window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return {mostrar, conectar};
})();
