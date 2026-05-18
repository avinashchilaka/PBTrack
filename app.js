'use strict';
// ═══════════════════════════════════════════════════════
// THEME — local time based, refreshes every minute
// ═══════════════════════════════════════════════════════
function applyTheme() {
  const h = new Date().getHours();
  const isDay = h >= 6 && h < 18;
  document.documentElement.classList.toggle('day', isDay);
}
applyTheme();
setInterval(applyTheme, 60000);

// ═══════════════════════════════════════════════════════
// DATE HELPERS — LOCAL time, same as original PBTrack
// This fixes the PST timezone bug where UTC date was used
// ═══════════════════════════════════════════════════════
let _now, _todayStr, _todayDay, _monthStr;

function refreshDate() {
  _now      = new Date();
  _todayStr = _now.getFullYear() + '-' +
              String(_now.getMonth()+1).padStart(2,'0') + '-' +
              String(_now.getDate()).padStart(2,'0');
  _todayDay = _now.getDate();
  _monthStr = _todayStr.slice(0,7);
}
refreshDate();
// Refresh date on every render to catch midnight rollovers
setInterval(refreshDate, 60000);

function getDaysInMonth() { return new Date(_now.getFullYear(), _now.getMonth()+1, 0).getDate(); }
function getDaysLeft()    { return Math.max(1, getDaysInMonth() - _todayDay); }
const tdStr = () => { refreshDate(); return _todayStr; };
const moStr = () => _monthStr;

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════
const API = window.location.origin;
const tok = () => localStorage.getItem('pb_token');
const usr = () => { try { return JSON.parse(localStorage.getItem('pb_user')||'{}'); } catch { return {}; } };
if (!tok()) window.location.href = '/';

// ═══════════════════════════════════════════════════════
// STATE — strict separation
// earnings = manual only | expenses = Plaid only
// ═══════════════════════════════════════════════════════
const S = {
  earnings:  [],
  expenses:  [],
  bills:     [],
  onetime:   [],
  debts:     [],
  splitwise: [],
  accounts:  [],
  rules:     {},
  budgets:   { food:400, transportation:600, shopping:150, entertainment:50, utilities:600, health:100, other:300 },
  settings:  { monthly_goal:9500, daily_quota:400 },
  shifts:    [],
};

const fmt = n => '$' + Math.abs(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const ttc = s => (s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

let _earnFilter = 'week';
let _catFilter  = null;
let _isMode     = 'spending';
let _sortMode   = 'newest';
let _homeTxnMode = 'spending'; // home shows spending by default
let _pendingSort= 'newest';
let _pendingTxn = null;
let _pendingRule= null;
let _editBillId = null, _editBillType = null;
let _shiftInterval = null;
let _chatHistory = [];
let _flowDays = [];
let _approvedBudgets = new Set();

// ═══════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════
async function req(path, opts={}) {
  try {
    const r = await fetch(API+path, {
      ...opts,
      headers:{ 'Content-Type':'application/json','Authorization':'Bearer '+tok(),...(opts.headers||{}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status===401) { logout(); return null; }
    return r.json();
  } catch(e) { console.error(path,e); return null; }
}


// ═══════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════
function showPage(id) {
  refreshDate();
  localStorage.setItem('pb_page',id);
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('page-'+id);
  const nb=document.getElementById('nav-'+id);
  if(pg) pg.classList.add('active');
  if(nb) nb.classList.add('active');
  if(id==='home')     renderHome();
  if(id==='earnings') renderEarnings();
  if(id==='spend')    renderSpend();
  if(id==='bills')    renderBills();
  if(id==='more')     renderMore();
  window.scrollTo(0,0);
}

function openAI() {
  showPage('more');
  setTimeout(()=>{ const el=document.getElementById('chatIn'); if(el) el.focus(); },300);
}

// ═══════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════
function renderAlerts() {
  refreshDate();
  const day = _todayDay;
  const dis  = JSON.parse(localStorage.getItem('pb_dis')||'{}');
  if(dis.date!==_todayStr) localStorage.setItem('pb_dis',JSON.stringify({date:_todayStr}));
  const alerts=[];
  const overdue=S.bills.filter(b=>!b.paid&&!b.skipped&&b.due_day<day);
  if(overdue.length&&!dis.ov) alerts.push({id:'ov',type:'red',t:`🔴 ${overdue.length} Overdue Bill${overdue.length>1?'s':''}`,b:overdue.map(b=>`${b.name} ${fmt(b.amount)}`).join(' · ')});
  const soon=S.bills.filter(b=>!b.paid&&!b.skipped&&b.due_day>=day&&b.due_day<=day+3);
  if(soon.length&&!dis.sn) alerts.push({id:'sn',type:'gold',t:'📅 Bills Due Soon',b:soon.map(b=>`${b.name} — ${b.due_day}th`).join(' · ')});
  const otDue=S.onetime.filter(p=>!p.paid).filter(p=>{ const d=Math.ceil((new Date(p.due_date+'T12:00:00')-_now)/86400000); return d<=3&&d>=0; });
  if(otDue.length&&!dis.ot) alerts.push({id:'ot',type:'gold',t:'⏰ One-Time Payment Due',b:otDue.map(p=>`${p.name} ${fmt(p.amount)}`).join(' · ')});
  const earned=todayEarnings(), target=calcDailyTarget();
  if(earned>=target&&target>0&&!dis.gl) alerts.push({id:'gl',type:'green',t:'🎉 Daily Target Hit!',b:`Earned ${fmt(earned)} — ${fmt(earned-target)} over your ${fmt(target)} target!`});
  document.getElementById('alertsBox').innerHTML=alerts.filter(a=>!dis[a.id]).map(a=>`
    <div class="alert ${a.type}" id="al-${a.id}">
      <div class="alert-t">${a.t}</div><div class="alert-b">${a.b}</div>
      <button class="alert-x" onclick="dismissAlert('${a.id}',event)">×</button>
    </div>`).join('');
}

function dismissAlert(id,e) {
  e&&e.stopPropagation();
  const el=document.getElementById('al-'+id);
  if(el){el.style.opacity='0';el.style.transform='translateX(8px)';el.style.transition='all .2s';setTimeout(()=>el.remove(),200);}
  const d=JSON.parse(localStorage.getItem('pb_dis')||'{}');
  d[id]=true;d.date=_todayStr;localStorage.setItem('pb_dis',JSON.stringify(d));
}

// ═══════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════
function renderHome() {
  refreshDate();
  renderAlerts();
  const earned=todayEarnings(), target=calcDailyTarget(), spent=todaySpending();
  const pct=Math.min(100,(earned/target)*100);

  // Ring — circumference = 2πr = 2×π×42 ≈ 264
  const circ=264;
  const fg=document.getElementById('ringFg');
  fg.style.strokeDashoffset=circ-(circ*pct/100);
  fg.style.stroke=pct>=100?'#4ade80':pct>=60?'#fbbf24':'currentColor';
  if(pct>=100) celebrate();
  document.getElementById('ringPct').textContent=Math.round(pct)+'%';
  document.getElementById('earnedBig').textContent=fmt(earned);
  document.getElementById('targetSub').textContent=pct>=100
    ?`🎉 Crushed! +${fmt(earned-target)} over target`
    :`${fmt(Math.max(0,target-earned))} more to hit ${fmt(target)} target`;

  // Platform breakdown — local date only
  const t=_todayStr;
  document.getElementById('pUber').textContent =fmt(S.earnings.filter(e=>e.date===t&&e.platform==='Uber').reduce((s,e)=>s+e.amount,0));
  document.getElementById('pLyft').textContent =fmt(S.earnings.filter(e=>e.date===t&&e.platform==='Lyft').reduce((s,e)=>s+e.amount,0));
  document.getElementById('pCash').textContent =fmt(S.earnings.filter(e=>e.date===t&&e.platform==='Cash').reduce((s,e)=>s+e.amount,0));
  document.getElementById('pOther').textContent=fmt(S.earnings.filter(e=>e.date===t&&!['Uber','Lyft','Cash'].includes(e.platform)).reduce((s,e)=>s+e.amount,0));

  // Available funds from Plaid accounts
  const debit = S.accounts.filter(a=>a.type==='depository').reduce((s,a)=>s+(a.balances?.available||a.balances?.current||0),0);
  const credit= S.accounts.filter(a=>a.type==='credit').reduce((s,a)=>s+(a.balances?.current||0),0);
  const dEl=document.getElementById('fundDebit'), cEl=document.getElementById('fundCredit');
  dEl.textContent=fmt(debit); dEl.style.color='var(--green)';
  cEl.textContent=fmt(credit);
  // Credit: if balance is high (close to limit) = red, if low = green
  cEl.style.color=credit>500?'var(--red)':'var(--green)';

  // Stats
  document.getElementById('hWeek').textContent =fmt(weekEarnings());
  document.getElementById('hMonth').textContent=fmt(monthEarnings());

  // Breakdown
  const bd=getBreakdown();
  document.getElementById('bdTarget').textContent=fmt(target);
  const _hasRent=S.bills.some(b=>b.name.toLowerCase().includes('rent'));
  document.getElementById('bdBody').innerHTML=`
    ${bd.overdue>0?`<div class="bdrow"><span class="bdlbl">📋 Overdue bills (unpaid)</span><span class="text-red">${fmt(bd.overdue)} ÷ ${bd.daysLeft}d = ${fmt(bd.overdue/bd.daysLeft)}/day</span></div>`:'<div class="bdrow"><span class="bdlbl">📋 Overdue bills</span><span class="text-green">None ✓</span></div>'}
    ${bd.upcoming>0?`<div class="bdrow"><span class="bdlbl">📅 Upcoming bills</span><span>${fmt(bd.upcoming)} total this month</span></div>`:''}
    ${bd.onetime>0?`<div class="bdrow"><span class="bdlbl">⚡ One-time payments</span><span>${fmt(bd.onetime)}</span></div>`:''}
    ${!_hasRent?`<div class="bdrow"><span class="bdlbl">🏠 Next month rent</span><span>${fmt(2084/bd.daysLeft)}/day</span></div>`:''}
    ${(S.settings.sw_monthly||0)>0?`<div class="bdrow"><span class="bdlbl">💸 Splitwise contribution</span><span>${fmt((S.settings.sw_monthly||0)/30)}/day</span></div>`:''}
    <div class="bdrow"><span class="bdlbl">⛽ Daily ops</span><span>$86.37/day</span></div>
    <div class="bdrow" style="font-weight:800;padding-top:8px"><span class="bdlbl" style="color:var(--text)">🎯 Your target today</span><span style="color:var(--gold)">${fmt(target)}</span></div>`;

  // Break-even
  const bePct=spent>0?Math.min(100,(earned/spent)*100):100;
  const net=earned-spent;
  const fill=document.getElementById('beFill');
  fill.style.width=bePct+'%'; fill.style.background=net>=0?'var(--green)':'var(--gold)';
  document.getElementById('bePct').textContent=Math.round(bePct)+'%';
  const beMsg = earned===0 && spent===0 ? 'Start driving to track today' : `Earned ${fmt(earned)}`;
  document.getElementById('beEarned').textContent=beMsg;
  document.getElementById('beSpent').textContent=earned===0&&spent===0 ? '' : `Spent ${fmt(spent)}`;

  // Upcoming bills
  const combined=[
    ...S.bills.map(b=>({...b,_ot:false,_days:b.due_day-_todayDay})),
    ...S.onetime.map(p=>({...p,_ot:true,_days:Math.ceil((new Date(p.due_date+'T12:00:00')-_now)/86400000)}))
  ].filter(b=>!b.paid&&!b.skipped).sort((a,b)=>a._days-b._days).slice(0,4);

  document.getElementById('upcomingHome').innerHTML=combined.length
    ?combined.map(b=>{
        const chip=b._days<0?'chip-ov':b._days<=3?'chip-sn':b._ot?'chip-ot':'chip-up';
        const lbl=b._days<0?'Overdue':b._days===0?'Today!':b._ot
          ?new Date(b.due_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})
          :b.due_day+'th';
        return `<div class="brow">
          <div class="bbody"><div class="bname">${b.name}</div><div class="bsub">${b._ot?'One-time':'Monthly'}</div></div>
          <span class="chip ${chip}">${lbl}</span>
          <div class="bamt">${fmt(b.amount)}</div>
        </div>`;
      }).join('')
    :'<div class="empty">No upcoming bills</div>';

  // Latest transactions — filtered by home mode
  let txns=[...S.expenses];
  if(_homeTxnMode==='spending') txns=txns.filter(t=>!t.is_income&&t.category!=='income'&&t.amount>=0);
  else if(_homeTxnMode==='income') txns=txns.filter(t=>t.is_income||t.category==='income'||t.amount<0);
  // 'all' shows everything
  txns=txns.sort((a,b)=>sortTxns(a,b)).slice(0,10);
  document.getElementById('latestTxns').innerHTML=txns.length
    ?txns.map(t=>txnRow(t,S.expenses.indexOf(t))).join('')
    :'<div class="empty">Transactions from your bank appear here</div>';
}

function toggleBD() {
  const body=document.getElementById('bdBody'), lbl=document.getElementById('bdLbl');
  body.classList.toggle('open');
  lbl.textContent=body.classList.contains('open')?'Hide breakdown ▴':'Show target breakdown ▾';
}

// Funds detail modal
function openFundsDetail(type) {
  const title=type==='debit'?'Available Debit Accounts':'Credit Balances';
  document.getElementById('fundsModTitle').textContent=title;
  let html='';
  if(type==='debit') {
    const accts=S.accounts.filter(a=>a.type==='depository');
    const total=accts.reduce((s,a)=>s+(a.balances?.available||a.balances?.current||0),0);
    html=accts.length
      ?accts.map(a=>`<div class="acct-row">
          <div class="acct-icon">🏦</div>
          <div class="acct-body"><div class="acct-name">${a.name}</div><div class="acct-sub">${a.institution||''} · ${ttc(a.subtype||a.type)}</div></div>
          <div class="acct-bal text-green">${fmt(a.balances?.available||a.balances?.current||0)}</div>
        </div>`).join('')
        +`<div class="acct-total-row"><span>Total Available</span><span class="text-green">${fmt(total)}</span></div>`
      :'<div class="empty">No debit accounts connected</div>';
  } else {
    const accts=S.accounts.filter(a=>a.type==='credit');
    const total=accts.reduce((s,a)=>s+(a.balances?.current||0),0);
    html=accts.length
      ?accts.map(a=>`<div class="acct-row">
          <div class="acct-icon">💳</div>
          <div class="acct-body"><div class="acct-name">${a.name}</div><div class="acct-sub">${a.institution||''} · Credit</div></div>
          <div class="acct-bal" style="color:${(a.balances?.current||0)>500?'var(--red)':'var(--green)'}">${fmt(a.balances?.current||0)} owed</div>
        </div>`).join('')
        +`<div class="acct-total-row"><span>Total Credit Owed</span><span class="text-red">${fmt(total)}</span></div>`
      :'<div class="empty">No credit accounts connected</div>';
  }
  document.getElementById('fundsModBody').innerHTML=html;
  openModal('fundsMod');
}

// ═══════════════════════════════════════════════════════
// SORT
// ═══════════════════════════════════════════════════════
function setHomeTxnMode(mode) {
  _homeTxnMode=mode;
  ['homeTxnSpend','homeTxnIncome','homeTxnAll'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const isActive=(id==='homeTxnSpend'&&mode==='spending')||(id==='homeTxnIncome'&&mode==='income')||(id==='homeTxnAll'&&mode==='all');
    el.style.background=isActive?'var(--text)':'transparent';
    el.style.color=isActive?'var(--bg)':'var(--text3)';
    el.style.fontWeight=isActive?'700':'600';
  });
  renderHome();
}

function toggleSort() { const m=document.getElementById('sortMenu'); m.style.display=m.style.display==='none'?'block':'none'; }
function pickSort(mode,el) {
  _pendingSort=mode;
  document.querySelectorAll('.sort-opt').forEach(o=>{
    o.classList.remove('active');
    o.textContent=o.textContent.replace(' ✓','');
  });
  el.classList.add('active'); el.textContent+=' ✓';
}
function applySort() { _sortMode=_pendingSort; document.getElementById('sortMenu').style.display='none'; renderHome(); }
function sortTxns(a,b) {
  if(_sortMode==='newest') return b.date.localeCompare(a.date);
  if(_sortMode==='oldest') return a.date.localeCompare(b.date);
  if(_sortMode==='high')   return b.amount-a.amount;
  if(_sortMode==='low')    return a.amount-b.amount;
  return 0;
}
document.addEventListener('click',e=>{ const m=document.getElementById('sortMenu'); if(m&&!m.contains(e.target)&&!e.target.closest('#sortBtn')) m.style.display='none'; });


// ═══════════════════════════════════════════════════════
// EARNINGS
// ═══════════════════════════════════════════════════════
function renderEarnings() {
  refreshDate();
  const target=calcDailyTarget();
  document.getElementById('eToday').textContent =fmt(todayEarnings());
  document.getElementById('eWeek').textContent  =fmt(weekEarnings());
  document.getElementById('eMonth').textContent =fmt(monthEarnings());
  document.getElementById('eTarget').textContent=fmt(target);
  const goal=S.settings.monthly_goal||9500, mE=monthEarnings();
  const mPct=Math.min(100,(mE/goal)*100);
  document.getElementById('mFill').style.width=mPct+'%';
  document.getElementById('mPct').textContent=Math.round(mPct)+'%';
  document.getElementById('mEarned').textContent=fmt(mE)+' earned';
  document.getElementById('mGoal').textContent='Goal '+fmt(goal);
  document.getElementById('logDate').value=_todayStr;
  renderBestDays(); renderProjection(); renderEarnHist();
}

function renderBestDays() {
  const totals=[0,0,0,0,0,0,0], counts=[0,0,0,0,0,0,0], daily={};
  S.earnings.forEach(e=>{daily[e.date]=(daily[e.date]||0)+e.amount;});
  Object.entries(daily).forEach(([d,v])=>{
    const dow=(new Date(d+'T12:00:00').getDay()+6)%7;
    totals[dow]+=v; counts[dow]++;
  });
  const avgs=totals.map((t,i)=>counts[i]>0?t/counts[i]:0);
  const maxA=Math.max(...avgs,1), top=avgs.indexOf(Math.max(...avgs));
  document.getElementById('bestDays').innerHTML=['Mo','Tu','We','Th','Fr','Sa','Su'].map((d,i)=>`
    <div class="dcol">
      <div class="dbar-w"><div class="dbar" style="height:${Math.max(2,Math.round(avgs[i]/maxA*37))}px;background:${i===top?'var(--green)':'var(--border2)'}"></div></div>
      <div class="dday">${d}</div>
      <div class="damt" style="color:${i===top?'var(--green)':'var(--text3)'}">${avgs[i]>0?'$'+Math.round(avgs[i]):'-'}</div>
    </div>`).join('');
}

function renderProjection() {
  const now=new Date(), dIn=Math.max(1,(now.getDay()+6)%7+1);
  const wE=weekEarnings(), avg=wE/dIn, proj=avg*7, target=calcDailyTarget();
  document.getElementById('projVal').textContent=fmt(proj);
  document.getElementById('projVal').style.color=avg>=target?'var(--blue)':'var(--gold)';
  document.getElementById('projSub').textContent=avg>=target
    ?`On track · ${fmt(avg)}/day avg · ${7-dIn} days left`
    :`Need ${fmt(Math.max(0,target*7-wE))} more this week`;
}

function renderEarnHist() {
  refreshDate();
  const now=new Date(), mon=new Date(now);
  mon.setDate(now.getDate()-((now.getDay()+6)%7)); mon.setHours(0,0,0,0);
  let list=[...S.earnings];
  if(_earnFilter==='today') list=list.filter(e=>e.date===_todayStr);
  else if(_earnFilter==='week') list=list.filter(e=>new Date(e.date+'T12:00:00')>=mon);
  else if(_earnFilter==='month') list=list.filter(e=>e.date.startsWith(_monthStr));
  list=list.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,60);
  const pI={Uber:'🚗',Lyft:'💜',Cash:'💵',Other:'💰'};
  document.getElementById('earnHist').innerHTML=list.length
    ?list.map(e=>`<div class="txn">
        <div class="tlogo icon-md">${pI[e.platform]||'💰'}</div>
        <div class="tbody"><div class="tname">${e.platform}${e.note?' · '+e.note:''}</div><div class="tmeta">${e.date}</div></div>
        <div style="display:flex;align-items:center;gap:5px">
          <div class="tamt text-green">+${fmt(e.amount)}</div>
          <button class="bicon" onclick="openEditEarn('${e.id}')">✏️</button>
          <button class="bicon" onclick="deleteEarning('${e.id}')">×</button>
        </div>
      </div>`).join('')
    :'<div class="empty">No earnings for this period</div>';
}

function filterEarn(p,btn) {
  _earnFilter=p;
  document.querySelectorAll('.ttab').forEach(t=>t.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderEarnHist();
}

// ═══════════════════════════════════════════════════════
// SPEND
// ═══════════════════════════════════════════════════════
let _isModeCur='spending';
function setIsMode(mode,btn) {
  _isModeCur=mode;
  document.querySelectorAll('.istab').forEach(t=>t.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderTxnList();
  // Update today/month stats to reflect current mode
  refreshDate();
  const isInc=mode==='income';
  const isAll=mode==='all';
  if(isInc) {
    // Show income totals
    const incToday=S.expenses.filter(e=>e.date===_todayStr&&(e.is_income||e.amount<0)).reduce((s,e)=>s+Math.abs(e.amount),0);
    const incMonth=S.expenses.filter(e=>e.date.startsWith(_monthStr)&&(e.is_income||e.amount<0)).reduce((s,e)=>s+Math.abs(e.amount),0);
    document.getElementById('sToday').textContent=fmt(incToday);
    document.getElementById('sToday').style.color='var(--green)';
    document.getElementById('sMonth').textContent=fmt(incMonth);
    document.getElementById('sMonth').style.color='var(--green)';
  } else if(isAll) {
    // Net: income minus spending
    const allToday=S.expenses.filter(e=>e.date===_todayStr);
    const netToday=allToday.filter(e=>e.is_income||e.amount<0).reduce((s,e)=>s+Math.abs(e.amount),0)
                  -allToday.filter(e=>!e.is_income&&e.amount>=0).reduce((s,e)=>s+e.amount,0);
    document.getElementById('sToday').textContent=(netToday>=0?'+':'')+fmt(netToday);
    document.getElementById('sToday').style.color=netToday>=0?'var(--green)':'var(--red)';
    document.getElementById('sMonth').textContent=fmt(monthSpending());
    document.getElementById('sMonth').style.color='var(--red)';
  } else {
    document.getElementById('sToday').textContent=fmt(todaySpending());
    document.getElementById('sToday').style.color='var(--red)';
    document.getElementById('sMonth').textContent=fmt(monthSpending());
    document.getElementById('sMonth').style.color='var(--red)';
  }
}

function renderSpend() {
  refreshDate();
  document.getElementById('sToday').textContent=fmt(todaySpending());
  document.getElementById('sMonth').textContent=fmt(monthSpending());
  if(S.accounts.length) {
    document.getElementById('plaidStatus').textContent='🏦 Bank Connected';
    document.getElementById('plaidBtn').textContent='Sync';
    document.getElementById('plaidBtn').onclick=syncPlaid;
    const rb=document.getElementById('plaidResetBtn');
    if(rb) rb.style.display='block';
  }
  drawDonut(); drawFlow(); renderBudBars(); renderCatChips(); renderTxnList();
}

function drawDonut() {
  const canvas=document.getElementById('donutC'); if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const cats={};
  S.expenses.filter(e=>e.date.startsWith(_monthStr)&&!e.is_income).forEach(e=>{
    const c=e.category||'other'; cats[c]=(cats[c]||0)+e.amount;
  });
  const entries=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const total=entries.reduce((s,[,v])=>s+v,0);
  if(!total){document.getElementById('donutTotal').textContent='$0';return;}
  document.getElementById('donutTotal').textContent='$'+Math.round(total).toLocaleString();
  const colors=['#4ade80','#60a5fa','#fbbf24','#f87171','#a78bfa','#fb923c'];
  const W=canvas.width,H=canvas.height,cx=W/2,cy=H/2,r=W*.44,inn=W*.28;
  ctx.clearRect(0,0,W,H);
  let angle=-Math.PI/2;
  entries.forEach(([,amt],i)=>{
    const slice=(amt/total)*Math.PI*2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,angle,angle+slice);ctx.closePath();
    ctx.fillStyle=colors[i%colors.length];ctx.fill();angle+=slice;
  });
  ctx.beginPath();ctx.arc(cx,cy,inn,0,Math.PI*2);
  ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--card').trim()||'#161616';
  ctx.fill();
  document.getElementById('donutLeg').innerHTML=entries.map(([cat,amt],i)=>`
    <div class="dleg-row" onclick="filterByCat('${cat}')">
      <div class="dleg-dot" style="background:${colors[i%colors.length]}"></div>
      <span class="dleg-lbl">${ttc(cat)}</span>
      <span class="dleg-pct">${Math.round(amt/total*100)}%›</span>
    </div>`).join('');
}

function drawFlow() {
  const canvas=document.getElementById('flowC'); if(!canvas) return;
  canvas.width=canvas.offsetWidth||320; canvas.height=120;
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
  _flowDays=[];
  for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);
    _flowDays.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));}
  const earned=_flowDays.map(d=>S.earnings.filter(e=>e.date===d).reduce((s,e)=>s+e.amount,0));
  const spent =_flowDays.map(d=>S.expenses.filter(e=>e.date===d&&!e.is_income).reduce((s,e)=>s+e.amount,0));
  const maxV=Math.max(...earned,...spent,1);
  const pL=8,pR=8,pT=7,pB=20,cW=W-pL-pR,cH=H-pT-pB;
  const bW=(cW/_flowDays.length)*.33,gap=cW/_flowDays.length;
  ctx.clearRect(0,0,W,H);
  const isDay=document.documentElement.classList.contains('day');
  ctx.strokeStyle=isDay?'rgba(0,0,0,0.05)':'rgba(255,255,255,0.05)';ctx.lineWidth=1;
  [.25,.5,.75,1].forEach(p=>{const y=pT+cH*(1-p);ctx.beginPath();ctx.moveTo(pL,y);ctx.lineTo(W-pR,y);ctx.stroke();});
  _flowDays.forEach((d,i)=>{
    const x=pL+i*gap+gap/2;
    if(earned[i]>0){ctx.fillStyle='#4ade80';const eH=(earned[i]/maxV)*cH;ctx.fillRect(x-bW-1,pT+cH-eH,bW,eH);}
    if(spent[i]>0) {ctx.fillStyle='#f87171';const sH=(spent[i]/maxV)*cH;ctx.fillRect(x+1,pT+cH-sH,bW,sH);}
    ctx.fillStyle=isDay?'rgba(0,0,0,0.3)':'rgba(255,255,255,0.3)';
    ctx.font='9px Inter,sans-serif';ctx.textAlign='center';
    ctx.fillText(new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'}).slice(0,2),x,H-4);
  });
}

function onFlowClick(e,canvas) {
  const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left;
  const W=canvas.width,pL=8,cW=W-pL-8,gap=cW/_flowDays.length;
  const idx=Math.floor((x-pL)/gap);
  if(idx<0||idx>=_flowDays.length) return;
  const day=_flowDays[idx];
  const dayT=S.expenses.filter(t=>t.date===day&&!t.is_income);
  const dayE=S.earnings.filter(t=>t.date===day);
  const box=document.getElementById('flowDetail');
  box.style.display='block';
  const label=new Date(day+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  box.innerHTML=`<div style="font-size:.7rem;font-weight:700;margin-bottom:5px">${label}</div>
    ${dayE.map(t=>`<div class="txn txn-compact"><div class="tlogo" style="font-size:.85rem;width:28px;height:28px">${t.platform==='Uber'?'🚗':t.platform==='Lyft'?'💜':'💰'}</div><div class="tbody"><div class="tname text-xs">${t.platform}</div></div><div class="tamt" style="color:var(--green);font-size:.76rem">+${fmt(t.amount)}</div></div>`).join('')}
    ${dayT.map(t=>`<div class="txn txn-compact">${logoEl(t.description,t.category)}<div class="tbody"><div class="tname text-xs">${t.label||t.description||'Transaction'}</div></div><div class="tamt" style="color:var(--red);font-size:.76rem">-${fmt(t.amount)}</div></div>`).join('')}
    ${!dayE.length&&!dayT.length?'<div style="font-size:.7rem;color:var(--text3)">No activity this day</div>':''}
    <button onclick="document.getElementById('flowDetail').style.display='none'" style="font-size:.65rem;background:none;border:none;color:var(--text3);cursor:pointer;margin-top:4px">Collapse ▴</button>`;
}

function renderBudBars() {
  const cats={};
  S.expenses.filter(e=>e.date.startsWith(_monthStr)&&!e.is_income).forEach(e=>{const c=e.category||'other';cats[c]=(cats[c]||0)+e.amount;});
  document.getElementById('budBars').innerHTML=Object.entries(S.budgets).map(([cat,limit])=>{
    const sp=cats[cat]||0,pct=Math.min(100,(sp/limit)*100);
    const color=pct>=90?'var(--red)':pct>=70?'var(--gold)':'var(--green)';
    return `<div class="budrow"><div class="budhdr"><span class="budname">${ttc(cat)}</span><span class="budnums">${fmt(sp)} / ${fmt(limit)}</span></div><div class="budbar"><div class="budfill" style="width:${pct}%;background:${color}"></div></div></div>`;
  }).join('');
}

function renderCatChips() {
  const cats=[...new Set(S.expenses.filter(e=>e.date.startsWith(_monthStr)).map(e=>e.category||'other'))];
  document.getElementById('catChips').innerHTML=
    `<button class="cchip${_catFilter===null?' active':''}" onclick="filterByCat(null,this)">All</button>`+
    cats.map(c=>`<button class="cchip${_catFilter===c?' active':''}" onclick="filterByCat('${c}',this)">${ttc(c)}</button>`).join('');
}

function filterByCat(cat,btn) {
  _catFilter=_catFilter===cat?null:cat;
  document.querySelectorAll('.cchip').forEach(c=>c.classList.remove('active'));
  if(btn) btn.classList.add('active');
  else { const a=document.querySelector('.cchip'); if(a) a.classList.add('active'); }
  renderTxnList();
}

function renderTxnList() {
  let list=[...S.expenses];
  // Income = transactions marked is_income OR category 'income' OR deposits (negative amounts from Plaid)
  if(_isModeCur==='income') list=list.filter(t=>t.is_income||t.category==='income'||t.amount<0);
  else if(_isModeCur==='spending') list=list.filter(t=>!t.is_income&&t.category!=='income'&&t.amount>=0);
  if(_catFilter) list=list.filter(t=>(t.category||'other')===_catFilter);
  list=list.sort((a,b)=>sortTxns(a,b));
  document.getElementById('allTxns').innerHTML=list.length
    ?list.map(t=>txnRow(t,S.expenses.indexOf(t))).join('')
    :'<div class="empty">No transactions match your filter</div>';
}

// ═══════════════════════════════════════════════════════
// TRANSACTION DETAIL + MERCHANT RULES
// ═══════════════════════════════════════════════════════
function getMKey(desc) { return (desc||'').toLowerCase().trim().replace(/\s+/g,' ').substring(0,30); }

function openTxnDetail(idx) {
  const t=S.expenses[idx]; if(!t) return;
  _pendingTxn=idx; _pendingRule=null;
  const cats=['food','transportation','shopping','entertainment','utilities','health','housing','subscription','debt','transfers','income','other'];
  document.getElementById('txnModName').textContent=t.label||t.description||'Transaction';
  document.getElementById('txnModBody').innerHTML=`
    <div class="detail-row"><span class="text-muted">Amount</span><span style="font-weight:700;color:${t.is_income?'var(--green)':'var(--red)'}">${t.is_income?'+':'-'}${fmt(t.amount)}</span></div>
    <div class="detail-row"><span class="text-muted">Date</span><span style="font-weight:600">${t.date}</span></div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:.78rem"><span class="text-muted">Category</span>
      <select id="txnCatSel" onchange="onCatChange()" style="background:var(--s1);border:1.5px solid var(--border2);border-radius:8px;color:var(--text);font-family:'Inter',sans-serif;font-size:.76rem;padding:4px 8px;outline:none">
        ${cats.map(c=>`<option value="${c}"${(t.category||'other')===c?' selected':''}>${ttc(c)}</option>`).join('')}
      </select>
    </div>
    ${t.institution?`<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:.78rem"><span class="text-muted">Account</span><span>🏦 ${t.institution}</span></div>`:''}`;
  document.getElementById('txnRuleBox').style.display='none';
  openModal('txnMod');
}

function onCatChange() {
  const t=S.expenses[_pendingTxn]; if(!t) return;
  const cat=document.getElementById('txnCatSel').value;
  _pendingRule={key:getMKey(t.description),cat,merchant:t.description};
  document.getElementById('txnRuleText').textContent=`Apply "${ttc(cat)}" to ALL past, present & future transactions from "${t.description}"?`;
  document.getElementById('txnRuleBox').style.display='block';
}

function applyRule(applyAll) {
  const t=S.expenses[_pendingTxn]; if(!t||!_pendingRule) return;
  const{key,cat}=_pendingRule;
  S.expenses[_pendingTxn].category=cat;
  if(applyAll) {
    S.rules[key]=cat;
    S.expenses.forEach((e,i)=>{if(getMKey(e.description)===key)S.expenses[i].category=cat;});
    req('/api/rules',{method:'POST',body:S.rules});
  } else {
    req(`/api/transactions/${t.plaid_id||t.id}/category`,{method:'PATCH',body:{category:cat}});
  }
  saveLocal(); closeModal('txnMod'); renderSpend(); renderHome();
}

// ═══════════════════════════════════════════════════════
// BILLS
// ═══════════════════════════════════════════════════════
function renderBills() {
  refreshDate();
  const total=[...S.bills,...S.onetime].reduce((s,b)=>s+b.amount,0);
  const unpaid=[...S.bills,...S.onetime].filter(b=>!b.paid).reduce((s,b)=>s+b.amount,0);
  document.getElementById('billTotal').textContent=fmt(total);
  document.getElementById('billUnpaid').textContent=fmt(unpaid);

  const catIcons={housing:'🏠',vehicle:'🚗',insurance:'🛡️',utilities:'💡',subscription:'📱',debt:'💳',other:'📦'};
  const combined=[
    ...S.bills.map(b=>({...b,_ot:false,_days:b.due_day-_todayDay})),
    ...S.onetime.map(p=>({...p,_ot:true,_days:Math.ceil((new Date(p.due_date+'T12:00:00')-_now)/86400000)}))
  ].sort((a,b)=>{
    const aO=!a.paid&&a._days<0,bO=!b.paid&&b._days<0;
    if(aO&&!bO) return -1; if(!aO&&bO) return 1;
    return a._days-b._days;
  });

  document.getElementById('billsList').innerHTML=combined.length
    ?combined.map(b=>{
        const chip=b.paid?'chip-pd':b.skipped?'chip-sk':b._days<0?'chip-ov':b._days<=3?'chip-sn':b._ot?'chip-ot':'chip-up';
        const lbl=b.paid?'✓ Paid':b.skipped?'Skipped':b._days<0?'🚨 Overdue':b._days===0?'Today!':
          b._ot?new Date(b.due_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):b.due_day+'th';
        const dueLabel = b._days<0
          ? (b._days<-7?'Carried Over':'Overdue')
          : b._days===0?'Due Today'
          : b._ot ? new Date(b.due_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})
          : `Due ${b.due_day}${[,'st','nd','rd'][b.due_day%10]||'th'}`;
        const amtColor = b.paid?'var(--green)':b._days<0&&!b.paid?'var(--red)':'var(--text)';
        return `<div class="brow">
          <div class="brow-top">
            <div class="bicon">${catIcons[b.category||'other']||'📦'}</div>
            <div class="bbody">
              <div class="bname">${b.name}</div>
              <div class="bsub">${b._ot?'One-time':'Monthly'} · ${ttc(b.category||'Other')}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div class="bamt" style="color:${amtColor}">${fmt(b.amount)}</div>
              <span class="chip ${chip}" style="margin-top:3px;display:inline-block">${lbl}</span>
            </div>
          </div>
          <div class="brow-bot">
            <div style="font-size:.63rem;color:${b._days<0&&!b.paid?'var(--red)':b._days<=3&&!b.paid?'var(--gold)':'var(--text3)'};font-weight:600">${dueLabel}</div>
            <div class="bactions">
              ${b.skipped
                ?`<button class="bact-btn undo" onclick="unskipBill('${b.id}','${b._ot?'ot':'bill'}')">Undo Skip</button>`
                :!b.paid
                  ?`<button class="bact-btn pay" onclick="payBill('${b.id}','${b._ot?'ot':'bill'}')">✓ Mark Paid</button>
                    <button class="bact-btn" onclick="skipBill('${b.id}','${b._ot?'ot':'bill'}')">Skip</button>`
                  :`<button class="bact-btn undo" onclick="unpayBill('${b.id}','${b._ot?'ot':'bill'}')">Undo Paid</button>`
              }
              <button class="bact-btn" style="padding:5px 9px" onclick="openEditBillMod('${b.id}','${b._ot?'ot':'bill'}')">✎</button>
            </div>
          </div>
        </div>`;
      }).join('')
    :'<div class="empty">No bills yet. Add above.</div>';

  showBillSuggestions();
}

// Bill suggestions from Plaid
function normDesc(s){
  return (s||'').toLowerCase().replace(/[*./\-]/g,' ').replace(/\s+/g,' ').trim();
}
function getBillDismissed(){
  try{return new Set(JSON.parse(localStorage.getItem('pb_bill_dismissed')||'[]'));}
  catch{return new Set();}
}
function dismissBillCard(){
  const keys=(window._sugBills||[]).map(b=>b.m);
  if(keys.length){
    const d=getBillDismissed();
    keys.forEach(k=>d.add(k));
    localStorage.setItem('pb_bill_dismissed',JSON.stringify([...d]));
  }
  const card=document.getElementById('billSugCard');
  if(card) card.style.display='none';
}
function showBillSuggestions() {
  const PATS=[
    {m:'at&t',name:'AT&T',amount:541,due_day:5,category:'utilities'},
    {m:'tesla subscription',name:'Tesla Subscription',amount:106.67,due_day:12,category:'vehicle'},
    {m:'crunchyroll',name:'Crunchyroll',amount:2.99,due_day:13,category:'subscription'},
    {m:'smartcredit',name:'SmartCredit',amount:24.95,due_day:13,category:'subscription'},
    {m:'uber *one',name:'Uber One',amount:9.99,due_day:12,category:'subscription'},
    {m:'apple.com/bill',name:'Apple Services',amount:9.99,due_day:7,category:'subscription'},
    {m:'google one',name:'Google One',amount:19.99,due_day:21,category:'subscription'},
    {m:'wells fargo auto',name:'Wells Fargo Auto',amount:728.86,due_day:21,category:'vehicle'},
    {m:'tesla insurance',name:'Tesla Insurance',amount:212.96,due_day:5,category:'insurance'},
    {m:'mystro',name:'Mystro Driver',amount:18.99,due_day:12,category:'subscription'},
  ];
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-90);
  const dismissed=getBillDismissed();
  const suggested=PATS.filter(p=>{
    if(dismissed.has(p.m)) return false;
    const normPat=normDesc(p.m);
    const recentMatches=S.expenses.filter(e=>
      new Date((e.date||'')+'T12:00:00')>=cutoff&&
      normDesc(e.description).includes(normPat)
    );
    return recentMatches.length>=2&&
      !S.bills.some(b=>b.name.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]));
  });
  const card=document.getElementById('billSugCard');
  if(!card||!suggested.length){if(card)card.style.display='none';return;}
  window._sugBills=suggested;
  card.style.display='block';
  card.style.cssText='display:block;background:var(--s1);border:1px solid var(--border2);border-radius:var(--r);padding:13px;margin-bottom:10px';
  card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px"><div class="label-sm-bold">🔍 Recurring charges detected</div><button class="bicon" onclick="dismissBillCard()">✕</button></div>
    ${suggested.map((b,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <div><div style="font-size:.8rem;font-weight:600">${b.name}</div><div class="meta-xs">${fmt(b.amount)}/mo · due ${b.due_day}th</div></div>
      <button class="bicon" onclick="addSugBill(${i})">+ Add</button>
    </div>`).join('')}
    <button class="btn btn-p" style="margin-top:9px" onclick="addAllSug()">Add All (${suggested.length})</button>`;
}
async function addSugBill(i) {
  const b=window._sugBills[i]; if(!b) return;
  const res=await req('/api/bills',{method:'POST',body:{name:b.name,amount:b.amount,due_day:b.due_day,category:b.category}});
  if(res){S.bills.push({...b,id:res.id,paid:false});saveLocal();renderBills();}
}
async function addAllSug() {
  for(const b of(window._sugBills||[])){
    if(S.bills.some(x=>x.name.toLowerCase()===b.name.toLowerCase())) continue;
    const res=await req('/api/bills',{method:'POST',body:{name:b.name,amount:b.amount,due_day:b.due_day,category:b.category}});
    if(res?.id) S.bills.push({...b,id:res.id,paid:false});
  }
  saveLocal();renderBills();document.getElementById('billSugCard').style.display='none';
}

// ═══════════════════════════════════════════════════════
// MORE
// ═══════════════════════════════════════════════════════
function renderMore() {
  const u=usr();
  const ini=(u.name||'?').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)||'?';
  ['moreAv','avatarBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=ini;});
  document.getElementById('moreName').textContent=u.name||'Unknown';
  document.getElementById('moreEmail').textContent=u.email||'';
  document.getElementById('setGoal').value=S.settings.monthly_goal||9500;
  document.getElementById('setQuota').value=S.settings.daily_quota||400;
  document.getElementById('setSwMonthly').value=S.settings.sw_monthly||0;

  document.getElementById('acctsList').innerHTML=S.accounts.length
    ?S.accounts.map(a=>`<div class="acct-row">
        <div class="acct-icon">${a.type==='credit'?'💳':'🏦'}</div>
        <div class="acct-body"><div class="acct-name">${a.name}</div><div class="acct-sub">${a.institution||''} · ${ttc(a.subtype||a.type)}</div></div>
        <div class="acct-bal" style="color:${a.type==='credit'?'var(--red)':'var(--green)'}">${a.type==='credit'?'-':'+'}${fmt(a.balances?.current||0)}</div>
      </div>`).join('')
    :'<div class="empty">No accounts connected</div>';

  document.getElementById('swList').innerHTML=S.splitwise.length
    ?S.splitwise.map(d=>`<div class="acct-row"><div class="acct-icon">👤</div><div class="acct-body"><div class="acct-name">${d.name}</div><div class="acct-sub">Personal · Splitwise</div></div><div class="acct-bal text-red">-${fmt(d.amount)}</div></div>`).join('')
    :'<div class="empty">Connect Splitwise to see balances</div>';

  document.getElementById('debtsList').innerHTML=S.debts.length
    ?S.debts.map(d=>`<div class="acct-row"><div class="acct-icon">💸</div><div class="acct-body"><div class="acct-name">${d.name}</div><div class="acct-sub">${d.monthly_payment?fmt(d.monthly_payment)+'/mo · ':''}${d.notes||''}</div></div><div class="acct-bal text-red">-${fmt(d.amount)}</div></div>`).join('')
    :'<div class="empty">No manual debts</div>';
}

// ═══════════════════════════════════════════════════════
// EARNINGS ACTIONS
// ═══════════════════════════════════════════════════════
async function logEarning() {
  const amt=parseFloat(document.getElementById('logAmt').value);
  const plat=document.getElementById('logPlat').value;
  const date=document.getElementById('logDate').value||_todayStr;
  const note=document.getElementById('logNote').value.trim();
  if(!amt||amt<=0) return flash('logMsg','Enter a valid amount','var(--red)');
  const res=await req('/api/earnings',{method:'POST',body:{amount:amt,platform:plat,date,note,is_manual:true}});
  if(!res) return;
  S.earnings.push({...res,amount:amt,platform:plat,date,note,is_manual:true});
  document.getElementById('logAmt').value='';document.getElementById('logNote').value='';
  flash('logMsg','✅ '+fmt(amt)+' logged!','var(--green)');
  saveLocal();renderEarnings();renderHome();
}

async function quickLog() {
  const amt=parseFloat(document.getElementById('qAmt').value);
  const plat=document.getElementById('qPlat').value;
  const note=document.getElementById('qNote').value.trim();
  if(!amt||amt<=0) return;
  const res=await req('/api/earnings',{method:'POST',body:{amount:amt,platform:plat,date:_todayStr,note,is_manual:true}});
  if(res){S.earnings.push({...res,amount:amt,platform:plat,date:_todayStr,note,is_manual:true});closeModal('quickMod');document.getElementById('qAmt').value='';document.getElementById('qNote').value='';saveLocal();renderHome();renderEarnings();}
}

async function deleteEarning(id) {
  await req(`/api/earnings/${id}`,{method:'DELETE'});
  S.earnings=S.earnings.filter(e=>e.id!==id);
  saveLocal();renderEarnHist();renderHome();
}

function openEditEarn(id) {
  const e=S.earnings.find(x=>x.id===id); if(!e) return;
  document.getElementById('editEarnId').value=id;
  document.getElementById('editEarnAmt').value=e.amount;
  document.getElementById('editEarnPlat').value=e.platform;
  document.getElementById('editEarnDate').value=e.date;
  document.getElementById('editEarnNote').value=e.note||'';
  openModal('editEarnMod');
}

async function saveEditEarn() {
  const id=document.getElementById('editEarnId').value;
  const amt=parseFloat(document.getElementById('editEarnAmt').value);
  const plat=document.getElementById('editEarnPlat').value;
  const date=document.getElementById('editEarnDate').value;
  const note=document.getElementById('editEarnNote').value.trim();
  if(!amt||amt<=0) return;
  await req(`/api/earnings/${id}`,{method:'PATCH',body:{amount:amt,platform:plat,date,note}});
  const idx=S.earnings.findIndex(e=>e.id===id);
  if(idx>=0) Object.assign(S.earnings[idx],{amount:amt,platform:plat,date,note});
  closeModal('editEarnMod');saveLocal();renderEarnings();renderHome();
}

// ═══════════════════════════════════════════════════════
// BILLS ACTIONS
// ═══════════════════════════════════════════════════════
async function addBill() {
  const name=document.getElementById('bName').value.trim();
  const amt=parseFloat(document.getElementById('bAmt').value);
  const day=parseInt(document.getElementById('bDay').value);
  const cat=document.getElementById('bCat').value;
  if(!name||!amt||!day) return;
  const res=await req('/api/bills',{method:'POST',body:{name,amount:amt,due_day:day,category:cat}});
  if(res){S.bills.push({...res,name,amount:amt,due_day:day,category:cat,paid:false});closeModal('addBillMod');document.getElementById('bName').value='';document.getElementById('bAmt').value='';document.getElementById('bDay').value='';saveLocal();renderBills();renderHome();}
}
async function addOneTime() {
  const name=document.getElementById('otName').value.trim();
  const amt=parseFloat(document.getElementById('otAmt').value);
  const due=document.getElementById('otDue').value;
  const notes=document.getElementById('otNotes').value.trim();
  if(!name||!amt||!due) return;
  const res=await req('/api/onetime',{method:'POST',body:{name,amount:amt,due_date:due,notes}});
  if(res){S.onetime.push({...res,name,amount:amt,due_date:due,notes,paid:false,_ot:true});closeModal('addOTMod');document.getElementById('otName').value='';document.getElementById('otAmt').value='';document.getElementById('otDue').value='';document.getElementById('otNotes').value='';saveLocal();renderBills();renderHome();}
}
async function payBill(id,type) {
  const arr=type==='ot'?S.onetime:S.bills;
  await req((type==='ot'?'/api/onetime/':'/api/bills/')+id,{method:'PATCH',body:{paid:true}});
  const b=arr.find(x=>x.id===id);if(b)b.paid=true;
  saveLocal();renderBills();renderHome(); // immediately recalculates target
}
async function unpayBill(id,type) {
  const arr=type==='ot'?S.onetime:S.bills;
  await req((type==='ot'?'/api/onetime/':'/api/bills/')+id,{method:'PATCH',body:{paid:false}});
  const b=arr.find(x=>x.id===id);if(b)b.paid=false;
  saveLocal();renderBills();renderHome();
}
async function skipBill(id,type) {
  const arr=type==='ot'?S.onetime:S.bills;
  await req((type==='ot'?'/api/onetime/':'/api/bills/')+id,{method:'PATCH',body:{skipped:true}});
  const b=arr.find(x=>x.id===id);if(b)b.skipped=true;
  saveLocal();renderBills();renderHome();
}
async function unskipBill(id,type) {
  const arr=type==='ot'?S.onetime:S.bills;
  await req((type==='ot'?'/api/onetime/':'/api/bills/')+id,{method:'PATCH',body:{skipped:false}});
  const b=arr.find(x=>x.id===id);if(b)b.skipped=false;
  saveLocal();renderBills();renderHome();
}
function openEditBillMod(id,type) {
  _editBillId=id;_editBillType=type;
  const arr=type==='ot'?S.onetime:S.bills;
  const b=arr.find(x=>x.id===id);if(!b)return;
  document.getElementById('ebName').value=b.name;
  document.getElementById('ebAmt').value=b.amount;
  document.getElementById('ebDay').value=type==='ot'?b.due_date:b.due_day;
  document.getElementById('ebCat').value=b.category||'other';
  document.getElementById('ebDayLbl').textContent=type==='ot'?'Due Date':'Due Day';
  openModal('editBillMod');
}
async function saveEditBill() {
  const name=document.getElementById('ebName').value.trim();
  const amt=parseFloat(document.getElementById('ebAmt').value);
  const day=document.getElementById('ebDay').value;
  const cat=document.getElementById('ebCat').value;
  if(!name||!amt) return;
  const arr=_editBillType==='ot'?S.onetime:S.bills;
  const route=(_editBillType==='ot'?'/api/onetime/':'/api/bills/')+_editBillId;
  const updates=_editBillType==='ot'?{name,amount:amt,due_date:day,category:cat}:{name,amount:amt,due_day:parseInt(day),category:cat};
  await req(route,{method:'PATCH',body:updates});
  const b=arr.find(x=>x.id===_editBillId);if(b)Object.assign(b,updates);
  closeModal('editBillMod');saveLocal();renderBills();renderHome();
}
async function deleteBill() {
  if(!_editBillId||!confirm('Delete this bill?')) return;
  const arr=_editBillType==='ot'?S.onetime:S.bills;
  await req((_editBillType==='ot'?'/api/onetime/':'/api/bills/')+_editBillId,{method:'DELETE'});
  if(_editBillType==='ot') S.onetime=S.onetime.filter(x=>x.id!==_editBillId);
  else S.bills=S.bills.filter(x=>x.id!==_editBillId);
  closeModal('editBillMod');saveLocal();renderBills();renderHome();
}

// ═══════════════════════════════════════════════════════
// DEBTS
// ═══════════════════════════════════════════════════════
async function addDebt() {
  const name=document.getElementById('dName').value.trim();
  const amt=parseFloat(document.getElementById('dAmt').value);
  const mo=parseFloat(document.getElementById('dMonthly').value)||0;
  const notes=document.getElementById('dNotes').value.trim();
  if(!name||!amt) return;
  const res=await req('/api/debts',{method:'POST',body:{name,amount:amt,original:amt,monthly_payment:mo,notes}});
  if(res){S.debts.push({...res,name,amount:amt,original:amt,monthly_payment:mo,notes});closeModal('addDebtMod');['dName','dAmt','dMonthly','dNotes'].forEach(id=>document.getElementById(id).value='');saveLocal();renderMore();}
}

// ═══════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════
async function saveSettings() {
  const goal=parseFloat(document.getElementById('setGoal').value)||9500;
  const quota=parseFloat(document.getElementById('setQuota').value)||400;
  const swM=parseFloat(document.getElementById('setSwMonthly').value)||0;
  S.settings={monthly_goal:goal,daily_quota:quota,sw_monthly:swM};
  await req('/api/settings',{method:'PUT',body:S.settings});
  saveLocal();renderHome();alert('✅ Settings saved');
}

async function saveBudget() {
  S.budgets={food:parseFloat(document.getElementById('budFood').value)||400,transportation:parseFloat(document.getElementById('budTrans').value)||600,shopping:parseFloat(document.getElementById('budShop').value)||150,entertainment:parseFloat(document.getElementById('budEnt').value)||50,utilities:parseFloat(document.getElementById('budUtil').value)||600,health:parseFloat(document.getElementById('budHealth').value)||100,other:parseFloat(document.getElementById('budOther').value)||300};
  await req('/api/settings',{method:'PUT',body:{...S.settings,budgets:S.budgets}});
  saveLocal();closeModal('editBudMod');renderBudBars();
}


// ═══════════════════════════════════════════════════════
// SPLITWISE
// ═══════════════════════════════════════════════════════
async function connectSplitwise() { const r=await req('/api/splitwise/auth-url');if(r?.url)window.location.href=r.url; }
async function loadSplitwise()    { const r=await req('/api/splitwise/balances');if(r?.balances){S.splitwise=r.balances;saveLocal();} }

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// DRILL DOWN
// ═══════════════════════════════════════════════════════
function drillEarn(period) {
  refreshDate();
  const now=new Date(),mon=new Date(now);
  mon.setDate(now.getDate()-((now.getDay()+6)%7));mon.setHours(0,0,0,0);
  let list=[...S.earnings],title='',icon='⚡';
  if(period==='today'){list=list.filter(e=>e.date===_todayStr);title='Today';}
  else if(period==='week'){list=list.filter(e=>new Date(e.date+'T12:00:00')>=mon);title='This Week';}
  else if(period==='month'){list=list.filter(e=>e.date.startsWith(_monthStr));title='This Month';}
  list=list.sort((a,b)=>b.date.localeCompare(a.date));
  const total=list.reduce((s,e)=>s+e.amount,0);
  const pI={Uber:'🚗',Lyft:'💜',Cash:'💵',Other:'💰'};
  document.getElementById('drillIcon').textContent=icon;
  document.getElementById('drillTotal').textContent=fmt(total);
  document.getElementById('drillSub').textContent=`${list.length} entries · ${title}`;
  document.getElementById('drillList').innerHTML=list.length
    ?list.map(e=>`<div class="txn"><div class="tlogo" style="font-size:.9rem">${pI[e.platform]||'💰'}</div><div class="tbody"><div class="tname">${e.platform}${e.note?' · '+e.note:''}</div><div class="tmeta">${e.date}</div></div><div class="tamt text-green">+${fmt(e.amount)}</div></div>`).join('')
    :'<div class="empty">No earnings this period</div>';
  openModal('drillMod');
}

// ═══════════════════════════════════════════════════════
// CELEBRATE
// ═══════════════════════════════════════════════════════
let _lastCel=null;
function celebrate() {
  if(_lastCel===_todayStr) return; _lastCel=_todayStr;
  const card=document.getElementById('targetCard');
  if(card){card.classList.add('celebrating');setTimeout(()=>card.classList.remove('celebrating'),500);}
  const colors=['#4ade80','#fbbf24','#60a5fa','#a78bfa','#f87171'];
  for(let i=0;i<10;i++) setTimeout(()=>{
    const c=document.createElement('div');c.className='confetti';
    c.style.cssText=`left:${15+Math.random()*70}%;top:15%;background:${colors[i%5]};animation-duration:${.7+Math.random()*.4}s`;
    document.body.appendChild(c);setTimeout(()=>c.remove(),1300);
  },i*50);
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
  refreshDate();

  // Splitwise callback
  const params=new URLSearchParams(window.location.search);
  if(params.get('splitwise')==='connected'){
    window.history.replaceState({},'','/app.html');
    setTimeout(async()=>{await loadSplitwise();renderMore();},800);
  }

  loadLocal();loadRules();

  // Avatar
  const u=usr();
  const ini=(u.name||'?').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)||'?';
  document.getElementById('avatarBtn').textContent=ini;

  // Restore shift
  restoreShift();

  // Render from cache immediately
  renderHome();

  // Restore last page
  const lastPage=localStorage.getItem('pb_page')||'home';
  if(lastPage!=='home') showPage(lastPage);

  // Fetch from server
  setSyncing(true);
  try {
    const [earnings,bills,debts,settings,onetime]=await Promise.all([
      req('/api/earnings'),req('/api/bills'),req('/api/debts'),req('/api/settings'),req('/api/onetime'),
    ]);
    // STRICT: only manual earnings go to S.earnings
    if(earnings?.data) S.earnings=earnings.data.filter(e=>e.is_manual!==false);
    if(bills?.data)    S.bills=bills.data;
    if(debts?.data)    S.debts=debts.data;
    if(settings)       S.settings={...S.settings,...settings};
    if(onetime?.data)  S.onetime=onetime.data;
    if(settings?.budgets) S.budgets={...S.budgets,...settings.budgets};

    // Load merchant rules from server
    const rulesRes=await req('/api/rules');
    if(rulesRes) Object.assign(S.rules,rulesRes);

    // Parallel: Plaid + Splitwise + Accounts
    await Promise.allSettled([syncPlaid(),loadSplitwise(),loadAccounts()]);

    saveLocal();
    refreshDate(); // refresh date after all data loaded
    renderHome();
    if(lastPage==='bills')    renderBills();
    if(lastPage==='spend')    renderSpend();
    if(lastPage==='more')     renderMore();
    if(lastPage==='earnings') renderEarnings();

    // AI briefing last
    loadBriefing();
  } catch(e){console.error('Init:',e);}
  setSyncing(false);
}

init();
