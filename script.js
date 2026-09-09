/* ===== vCard (.vcf) parser ===== */
function unfoldVCard(text){
  return text.replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'');
}
function decodeVCardValue(value, params){
  let v = value;
  if(/QUOTED-PRINTABLE/i.test(params)){
    v = v.replace(/=\r?\n/g,'').replace(/=([0-9A-Fa-f]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    try{ v = decodeURIComponent(escape(v)); }catch(e){}
  }
  return v.replace(/\\n/gi,' ').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\').trim();
}
function parseVCF(text){
  const lines = unfoldVCard(text).split('\n');
  const results = [];
  const seen = new Set();
  let cur = null;

  lines.forEach(line=>{
    const trimmed = line.trim();
    if(!trimmed) return;
    if(/^BEGIN:VCARD/i.test(trimmed)){ cur = {name:'', nName:'', phones:[], photo:'', fav:false}; return; }
    if(/^END:VCARD/i.test(trimmed)){
      if(cur){
        const finalName = cur.name || cur.nName;
        if(finalName && cur.phones.length){
          cur.phones.forEach(phone=>{
            const digits = phone.replace(/\D/g,'').slice(-10);
            const key = finalName.toLowerCase()+'|'+digits;
            if(seen.has(key)) return;
            seen.add(key);
            results.push({name:finalName, phone, photo:cur.photo, fav:cur.fav});
          });
        }
      }
      cur = null;
      return;
    }
    if(!cur) return;
    const colonIdx = trimmed.indexOf(':');
    if(colonIdx === -1) return;
    const rawKey = trimmed.slice(0, colonIdx);
    const rawValue = trimmed.slice(colonIdx+1);
    const [key, ...paramParts] = rawKey.split(';');
    const params = paramParts.join(';');
    const keyUpper = key.toUpperCase();

    if(keyUpper === 'FN'){
      cur.name = decodeVCardValue(rawValue, params);
    }else if(keyUpper === 'N' && !cur.nName){
      const parts = decodeVCardValue(rawValue, params).split(';').filter(Boolean);
      cur.nName = parts.reverse().join(' ').trim();
    }else if(keyUpper === 'TEL'){
      const num = decodeVCardValue(rawValue, params);
      if(num) cur.phones.push(num);
    }else if(keyUpper === 'PHOTO'){
      if(/^https?:\/\//i.test(rawValue)) cur.photo = rawValue.trim();
    }else if(keyUpper === 'CATEGORIES'){
      if(/starred/i.test(rawValue)) cur.fav = true;
    }
  });

  return results.sort((a,b)=>a.name.localeCompare(b.name));
}

/* ===== App state & render ===== */
let CONTACTS = [];
const state = { query: '' };

function initials(name){
  return name.trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
}
function cleanPhone(p){ return p.replace(/\s+/g,''); }
function telHref(p){
  const c = cleanPhone(p);
  return c.startsWith('+') ? c : ('+91' + c.replace(/^91/,''));
}
function escapeHtml(v){
  return String(v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function avatarHtml(c){
  if(c.photo){
    return `<img src="${escapeHtml(c.photo)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${initials(c.name)}'">`;
  }
  return initials(c.name);
}

async function copyPhone(phone, btn){
  try{
    await navigator.clipboard.writeText(cleanPhone(phone));
  }catch(e){
    window.prompt('नंबर कॉपी करें:', cleanPhone(phone));
    return;
  }
  const original = btn.innerHTML;
  btn.classList.add('copied');
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`;
  setTimeout(()=>{ btn.classList.remove('copied'); btn.innerHTML = original; }, 1200);
}

function makeEntry(c){
  const el = document.createElement('div');
  el.className = 'entry';
  el.innerHTML = `
    <div class="avatar">${avatarHtml(c)}</div>
    <div class="info">
      <div class="name">${escapeHtml(c.name)}${c.fav ? '<span class="star-mark">★</span>' : ''}</div>
      <div class="phone">${escapeHtml(c.phone)}</div>
    </div>
    <div class="entry-actions">
      <a class="icon-btn" href="tel:${escapeHtml(telHref(c.phone))}" title="Call" onclick="event.stopPropagation()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      </a>
      <button class="icon-btn copy" title="Copy" onclick="event.stopPropagation();copyPhone('${escapeHtml(c.phone)}', this)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>
  `;
  return el;
}

function render(){
  const q = state.query.trim().toLowerCase();
  const list = document.getElementById('list');
  const favSection = document.getElementById('fav-section');
  list.innerHTML = '';

  const filtered = CONTACTS.filter(c =>
    c.name.toLowerCase().includes(q) || c.phone.includes(q)
  );

  document.getElementById('visible-count').textContent = filtered.length;
  document.getElementById('total-count').textContent = CONTACTS.length;
  favSection.style.display = q ? 'none' : '';

  if(!filtered.length){
    list.innerHTML = `<div class="empty-state">कोई contact नहीं मिला।</div>`;
    return;
  }

  const groups = {};
  filtered.forEach(c=>{
    const l = (initials(c.name)[0] || '#').toUpperCase();
    (groups[l] = groups[l] || []).push(c);
  });

  Object.keys(groups).sort().forEach(letter=>{
    const g = document.createElement('div');
    g.className = 'group';
    const head = document.createElement('div');
    head.className = 'letter-head';
    head.id = 'letter-' + letter;
    head.innerHTML = `${letter}<span class="letter-count">${groups[letter].length}</span>`;
    g.appendChild(head);
    groups[letter].forEach(c=> g.appendChild(makeEntry(c)));
    list.appendChild(g);
  });
}

function renderFavorites(){
  const strip = document.getElementById('fav-strip');
  const favs = CONTACTS.filter(c=>c.fav);
  if(!favs.length){
    document.getElementById('fav-section').style.display = 'none';
    return;
  }
  strip.innerHTML = '';
  favs.forEach(c=>{
    const chip = document.createElement('div');
    chip.className = 'fav-chip';
    chip.innerHTML = `<div class="fav-avatar">${avatarHtml(c)}</div><div class="fname">${escapeHtml(c.name.split(' ')[0])}</div>`;
    chip.addEventListener('click', ()=>{ window.location.href = 'tel:' + telHref(c.phone); });
    strip.appendChild(chip);
  });
}

function buildRail(){
  const rail = document.getElementById('rail');
  const available = new Set(CONTACTS.map(c => (initials(c.name)[0]||'#').toUpperCase()));
  rail.innerHTML = '';
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(l=>{
    const b = document.createElement('button');
    b.textContent = l;
    b.dataset.letter = l;
    if(!available.has(l)) b.classList.add('dim');
    b.addEventListener('click', ()=> jumpTo(l));
    rail.appendChild(b);
  });
  const fromPoint = (e)=>{
    const t = e.touches && e.touches[0] ? e.touches[0] : e;
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const btn = el && el.closest ? el.closest('.rail button') : null;
    if(btn) jumpTo(btn.dataset.letter);
  };
  rail.addEventListener('touchstart', e=>{ e.preventDefault(); fromPoint(e); }, {passive:false});
  rail.addEventListener('touchmove', e=>{ e.preventDefault(); fromPoint(e); }, {passive:false});
  rail.addEventListener('mousemove', e=>{ if(e.buttons===1) fromPoint(e); });
}

let flashTimer = null;
function jumpTo(letter){
  document.querySelectorAll('.rail button').forEach(b=> b.classList.toggle('active', b.dataset.letter===letter));
  const flash = document.getElementById('letter-flash');
  flash.textContent = letter;
  flash.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(()=> flash.classList.remove('show'), 260);
  const head = document.getElementById('letter-' + letter);
  if(head) head.scrollIntoView({behavior:'auto', block:'start'});
}

document.getElementById('search').addEventListener('input', e=>{
  state.query = e.target.value;
  document.getElementById('clear-btn').classList.toggle('show', !!state.query);
  render();
});
document.getElementById('clear-btn').addEventListener('click', ()=>{
  document.getElementById('search').value = '';
  state.query = '';
  document.getElementById('clear-btn').classList.remove('show');
  render();
});

/* ===== Load contacts.vcf from same folder ===== */
const statusEl = document.getElementById('status');
statusEl.textContent = 'Contacts लोड हो रहे हैं…';

fetch('contacts.vcf')
  .then(r=>{
    if(!r.ok) throw new Error('contacts.vcf नहीं मिली');
    return r.text();
  })
  .then(text=>{
    CONTACTS = parseVCF(text);
    if(!CONTACTS.length) throw new Error('contacts.vcf में कोई valid contact नहीं मिला');
    statusEl.classList.add('hidden');
    renderFavorites();
    buildRail();
    render();
  })
  .catch(err=>{
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'contacts.vcf load नहीं हुई। इसी folder में contacts.vcf रखें और page को local server से खोलें (सीधे double-click से fetch काम नहीं करता)।';
    console.error(err);
  });
