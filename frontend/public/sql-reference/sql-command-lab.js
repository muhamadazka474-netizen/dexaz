const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const toast = $('#toast');
function showToast(message){
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>toast.classList.remove('show'), 1600);
}

$$('.copy').forEach(btn=>btn.addEventListener('click', async ()=>{
  const pre = btn.closest('.query-card')?.querySelector('pre');
  if(!pre) return;
  try { await navigator.clipboard.writeText(pre.innerText.trim()); }
  catch { const r=document.createRange(); r.selectNodeContents(pre); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy'); sel.removeAllRanges(); }
  showToast('COPIED TO CLIPBOARD');
}));

const search = $('#search');
const searchSuggestions = $('#searchSuggestions');
const cards = $$('.query-card');

function buildSearchIndex(){
  return cards.map((card, i) => {
    const title = card.querySelector('.qhead b')?.textContent.trim() || `Query ${i+1}`;
    const code = card.querySelector('pre')?.innerText.trim().replace(/\s+/g,' ') || '';
    const keywords = card.dataset.keywords || '';
    return {card, title, code, keywords, index:i};
  });
}
const searchIndex = buildSearchIndex();

function renderSuggestions(q=''){
  if(!searchSuggestions) return;
  const needle=q.trim().toLowerCase();
  if(!needle){ searchSuggestions.classList.remove('open'); searchSuggestions.innerHTML=''; return; }
  const matches=searchIndex.filter(x => `${x.title} ${x.keywords} ${x.code}`.toLowerCase().includes(needle)).slice(0,7);
  searchSuggestions.innerHTML = matches.length
    ? matches.map((x,i)=>`<a class="search-suggestion${i===0?' active':''}" role="option" href="#${x.card.id||''}" data-search-index="${x.index}"><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.code.slice(0,90))}${x.code.length>90?'…':''}</small></a>`).join('')
    : '<div class="search-suggestion"><strong>NO MATCH</strong><small>Coba SELECT, JOIN, WHERE, GROUP BY, INSERT, UPDATE...</small></div>';
  searchSuggestions.classList.add('open');
}
function escapeHtml(v){return v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

search?.addEventListener('input', e=>{
  const q=e.target.value.trim().toLowerCase();
  cards.forEach(card=>{
    const text=(card.dataset.keywords+' '+card.innerText).toLowerCase();
    card.classList.toggle('hidden', q && !text.includes(q));
  });
  renderSuggestions(q);
});
search?.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ search.value=''; search.dispatchEvent(new Event('input')); search.blur(); return; }
  if(e.key==='Enter'){
    const first=searchSuggestions?.querySelector('.search-suggestion[href]');
    if(first){ first.click(); e.preventDefault(); }
  }
});
searchSuggestions?.addEventListener('click', e=>{
  const item=e.target.closest('[data-search-index]');
  if(!item) return;
  const x=searchIndex[Number(item.dataset.searchIndex)];
  if(x){ cards.forEach(c=>c.classList.remove('hidden')); x.card.scrollIntoView({behavior:'smooth',block:'start'}); }
  searchSuggestions.classList.remove('open');
  search?.blur();
});
const sidebar=$('#sidebar');
const sidebarHide=$('#sidebarHide');
const sidebarShow=$('#sidebarShow');
const menuToggle=$('#menuToggle');

function setSidebarCollapsed(collapsed){
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  if(sidebarHide){
    sidebarHide.setAttribute('aria-label', collapsed ? 'Tampilkan navigasi' : 'Sembunyikan navigasi');
    sidebarHide.setAttribute('title', collapsed ? 'Tampilkan navigasi' : 'Sembunyikan navigasi');
    sidebarHide.textContent=collapsed ? '‹' : '×';
  }
  sidebarShow?.classList.toggle('visible', collapsed);
}

menuToggle?.addEventListener('click',()=>sidebar?.classList.toggle('open'));
sidebarHide?.addEventListener('click',()=>setSidebarCollapsed(true));
sidebarShow?.addEventListener('click',()=>setSidebarCollapsed(false));
const navLinksAll=$$('.sidebar nav a');
navLinksAll.forEach(a=>{
  a.dataset.nav='true';
  a.addEventListener('click',()=>sidebar?.classList.remove('open'));
});

const themeInfo=$('#themeInfo'), dialectPanel=$('#dialectPanel');
themeInfo?.addEventListener('click', e=>{
  e.stopPropagation();
  const open=dialectPanel.classList.toggle('open');
  themeInfo.setAttribute('aria-expanded', String(open));
  dialectPanel.setAttribute('aria-hidden', String(!open));
});
document.addEventListener('click', e=>{
  if(dialectPanel && !dialectPanel.contains(e.target) && e.target!==themeInfo){
    dialectPanel.classList.remove('open');
    themeInfo?.setAttribute('aria-expanded','false');
    dialectPanel.setAttribute('aria-hidden','true');
  }
});

const sections=$$('.doc-section');
const navLinks=$$('[data-nav]');
const hudIndex=$('#hud-index'), hudBar=$('#hud-bar'), hudPct=$('#hud-pct');
const observer=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
    if(!entry.isIntersecting) return;
    const idx=sections.indexOf(entry.target);
    if(idx>=0){
      navLinks.forEach(a=>a.classList.toggle('active', a.getAttribute('href')===`#${entry.target.id}`));
      const n=String(idx).padStart(2,'0'); if(hudIndex) hudIndex.textContent=n;
      const pct=Math.round(((idx+1)/sections.length)*100);
      if(hudPct) hudPct.textContent=String(pct).padStart(3,'0')+'%';
      if(hudBar) hudBar.style.width=pct+'%';
    }
  });
},{threshold:.35});
sections.forEach(s=>observer.observe(s));

// Reveal animation, while respecting reduced-motion preferences.
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  const revealObserver=new IntersectionObserver(entries=>entries.forEach(e=>{
    if(e.isIntersecting){ e.target.classList.add('reveal-in'); revealObserver.unobserve(e.target); }
  }),{threshold:.08});
  $$('.query-card,.wide-card,.security-grid>div,.join-map,.transaction-flow,.cheat-grid>div').forEach((el,i)=>{
    el.style.setProperty('--reveal-delay', Math.min(i*45,360)+'ms');
    revealObserver.observe(el);
  });
}
