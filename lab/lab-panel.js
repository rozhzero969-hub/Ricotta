/* Ricotta Lab panel: test tools on top of the real app (lab-mock.js answers the server).
   Pretend a date (holiday themes switch on by themselves), switch between Rozha and
   Yunis, show the sign-in page, break or set the kitchen streak, reset the sample data. */
(function(){
  const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(_){ return d; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} };
  const fake = lsGet('ricottaLab:today', null);   // set early by lab-mock.js
  const JUMPS = [['Halloween','2026-10-31'],['Autumn','2026-11-12'],['Flag Day','2026-12-17'],['Christmas','2026-12-24'],['Winter','2027-01-15'],
    ['Ramadan','2027-02-20'],['Eid','2027-03-11'],['Newroz','2027-03-21'],['Spring','2027-04-10'],['Summer','2027-08-01']];
  const fab = document.createElement('button');
  fab.className = 'lab-fab'; fab.type = 'button'; fab.innerHTML = '<i></i>LAB'; fab.setAttribute('aria-label', 'Open Ricotta Lab');
  document.body.appendChild(fab);
  let open = false;
  const reload = () => location.reload();
  function paint(){
    document.querySelector('.lab-scrim')?.remove(); document.querySelector('.lab-panel')?.remove();
    fab.hidden = open;
    if(!open) return;
    const who = state.account === 'yunis' ? 'Yunis' : state.account === 'rozha' ? 'Rozha' : null;
    const scrim = document.createElement('div'); scrim.className = 'lab-scrim';
    const p = document.createElement('aside'); p.className = 'lab-panel'; p.setAttribute('aria-label', 'Ricotta Lab');
    p.innerHTML = `<div class="lab-head"><b>Ricotta<i></i><span>Lab</span></b><button type="button" class="lab-x" data-a="close" aria-label="Close">×</button></div>
      <div class="lab-body">
        <div class="lab-sec"><p>The real app on sample data. Nothing here reaches the kitchen. ${who ? `Signed in as <b>${who}</b>.` : 'Any 6 digits sign in as Rozha, 222222 as Yunis.'}</p>
          <div class="lab-acts">${who ? `<button class="lab-btn" data-a="switch">Switch to ${who === 'Rozha' ? 'Yunis' : 'Rozha'}</button><button class="lab-btn" data-a="signout">Show the sign-in page</button>` : ''}<button class="lab-btn" data-a="reset">Reset sample data</button></div></div>
        <div class="lab-sec"><h3>Pretend today is…</h3><p>Holiday themes switch on by themselves on their dates.</p>
          <div class="lab-acts">${JUMPS.map(([l, d])=>`<button class="lab-btn" data-d="${d}" aria-pressed="${fake === d}">${l}</button>`).join('')}<button class="lab-btn" data-d="" aria-pressed="${!fake}">Real date</button></div></div>
        <div class="lab-sec"><h3>Kitchen streak</h3><div class="lab-acts"><button class="lab-btn" data-a="s6">6 days, not lit</button><button class="lab-btn" data-a="s29">29 days, not lit</button><button class="lab-btn" data-a="s99">99 days, lit</button><button class="lab-btn" data-a="break">Break it</button></div>
          <p>Send an order to light it. Breaking it lets you ask Rico to bring it back.</p></div>
        <div class="lab-sec"><h3>Weather</h3><div class="lab-acts"><button class="lab-btn" data-w="rain">Rain</button><button class="lab-btn" data-w="snow">Snow</button><button class="lab-btn" data-w="">Clear</button></div></div>
      </div>`;
    document.body.append(scrim, p);
    scrim.onclick = ()=>{ open = false; paint(); };
    p.onclick = e=>{
      const b = e.target.closest('button'); if(!b) return;
      const a = b.dataset.a;
      if(a === 'close'){ open = false; paint(); return; }
      if(a === 'reset'){ window.labResetData(); reload(); return; }
      if(a === 'switch'){
        const next = state.account === 'yunis' ? 'rozha' : 'yunis';
        lsSet('ricottaOrders:apiSession', {token:'lab-'+next, account:next, name:next==='yunis'?'Yunis':'Rozha', tabs:['order','assistant','history'], expiresAt:new Date(Date.now()+18*3600000).toISOString()});
        reload(); return;
      }
      if(a === 'signout'){ try{ localStorage.removeItem('ricottaOrders:apiSession'); }catch(_){} const d = window.labDb(); d.signedOut = true; lsSet('ricottaLab:db', d); reload(); return; }
      if(a === 'break'){ window.labStreakBreak(); reload(); return; }
      if(a && a[0] === 's'){ const n = +a.slice(1); window.labStreakSet(n, n === 99); reload(); return; }
      if(b.dataset.d !== undefined){ if(b.dataset.d) lsSet('ricottaLab:today', b.dataset.d); else { try{ localStorage.removeItem('ricottaLab:today'); }catch(_){} } reload(); return; }
      if(b.dataset.w !== undefined){ const d = window.labDb(); d.weather = {...d.weather, rain:b.dataset.w === 'rain', snow:b.dataset.w === 'snow', updatedAt:new Date().toISOString()}; lsSet('ricottaLab:db', d); reload(); }
    };
  }
  fab.onclick = ()=>{ open = true; paint(); };
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && open){ open = false; paint(); } });
})();
