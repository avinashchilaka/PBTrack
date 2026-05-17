// ═══════════════════════════════════════════════════════
// SMART DAILY TARGET — exact formula from original PBTrack
// ═══════════════════════════════════════════════════════
function calcDailyTarget() {
  refreshDate(); // always use fresh local date
  const today   = _todayStr;
  const todayDay= _todayDay;
  const daysLeft= getDaysLeft();

  // Today's earnings (manual only) and spending (Plaid only)
  const todayEarned = S.earnings.filter(e=>e.date===today).reduce((s,e)=>s+e.amount,0);
  const todaySpent  = S.expenses.filter(e=>e.date===today&&!e.is_income&&e.category!=='transfers').reduce((s,e)=>s+e.amount,0);

  // 1. Overdue bills — past due date, unpaid, not skipped
  const overdueBills = S.bills
    .filter(b=>!b.paid&&!b.skipped&&b.due_day<todayDay)
    .reduce((s,b)=>s+b.amount,0);

  // 2. Upcoming bills — each spread by days until due
  let upcomingPerDay = 0;
  S.bills.filter(b=>!b.paid&&!b.skipped&&b.due_day>=todayDay).forEach(b=>{
    const daysUntilDue = Math.max(1, b.due_day - todayDay);
    upcomingPerDay += b.amount / daysUntilDue;
  });

  // 3. One-time payments
  let oneTimePerDay = 0;
  S.onetime.filter(p=>!p.paid).forEach(p=>{
    const dueDate = new Date(p.due_date+'T12:00:00'); // noon local avoids DST issues
    const daysUntil = Math.max(1, Math.ceil((dueDate - _now) / 86400000));
    oneTimePerDay += p.amount / daysUntil;
  });

  // 4. Next month rent ($2,084) — only if rent not already in bills
  // Prevents double-counting when rent is added as a bill
  const hasRentInBills = S.bills.some(b => b.name.toLowerCase().includes('rent'));
  const NEXT_RENT = hasRentInBills ? 0 : 2084;
  const rentPerDay = NEXT_RENT / daysLeft;

  // 5. Splitwise — use monthly contribution setting (default $0)
  // We do NOT auto-spread Splitwise total — these are long-term personal loans
  // User sets a monthly Splitwise contribution in settings
  const swMonthly = S.settings.sw_monthly || 0;
  const swPerDay = swMonthly / 30;

  // 6. Daily ops — (1191 + 400 + 1000) / 30 = $86.37/day
  const dailyOps = (1191 + 400 + 1000) / 30;

  // Urgent: overdue spread across remaining days
  const urgentPerDay = overdueBills / daysLeft;
  const totalPerDay  = urgentPerDay + upcomingPerDay + oneTimePerDay + rentPerDay + swPerDay + dailyOps;

  // Subtract today's progress
  return Math.max(S.settings.daily_quota||400, totalPerDay - todayEarned + todaySpent);
}

function getBreakdown() {
  refreshDate();
  const day = _todayDay;
  const daysLeft = getDaysLeft();
  const overdue   = S.bills.filter(b=>!b.paid&&!b.skipped&&b.due_day<day).reduce((s,b)=>s+b.amount,0);
  const upcoming  = S.bills.filter(b=>!b.paid&&!b.skipped&&b.due_day>=day).reduce((s,b)=>s+b.amount,0);
  const onetime   = S.onetime.filter(p=>!p.paid).reduce((s,p)=>s+p.amount,0);
  return { overdue, upcoming, onetime, daysLeft };
}

function populateTargetBreak() {
  refreshDate();
  const dL=getDaysLeft();
  const day=_todayDay;
  const todayE=todayEarnings(), todayS=todaySpending();
  const hasRent=S.bills.some(b=>b.name.toLowerCase().includes('rent'));

  // Calculate each component as /day contribution
  const overdueBills=S.bills.filter(b=>!b.paid&&!b.skipped&&b.due_day<day).reduce((s,b)=>s+b.amount,0);
  const urgentPerDay=overdueBills/Math.max(1,dL);

  let upcomingPerDay=0;
  const upcomingDetails=[];
  S.bills.filter(b=>!b.paid&&!b.skipped&&b.due_day>=day).forEach(b=>{
    const d=Math.max(1,b.due_day-day);
    upcomingPerDay+=b.amount/d;
    upcomingDetails.push(`${b.name}: ${fmt(b.amount)} ÷ ${d}d = ${fmt(b.amount/d)}/day`);
  });

  let otPerDay=0;
  S.onetime.filter(p=>!p.paid).forEach(p=>{
    const d=Math.max(1,Math.ceil((new Date(p.due_date+'T12:00:00')-_now)/86400000));
    otPerDay+=p.amount/d;
  });

  const rentPerDay=hasRent?0:2084/dL;
  const swPerDay=(S.settings.sw_monthly||0)/30;
  const dailyOps=(1191+400+1000)/30;
  const totalPerDay=urgentPerDay+upcomingPerDay+otPerDay+rentPerDay+swPerDay+dailyOps;
  const target=Math.max(S.settings.daily_quota||400, totalPerDay-todayE+todayS);

  document.getElementById('targetBreakDate').textContent=
    _now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})
    +' · '+dL+' days left';

  const row=(icon,label,val,color,note)=>`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0"><div style="font-size:.78rem;font-weight:600">${icon} ${label}</div>${note?`<div style="font-size:.6rem;color:var(--text3);margin-top:1px">${note}</div>`:''}</div>
      <div style="font-size:.82rem;font-weight:800;color:${color||'var(--text)'};flex-shrink:0;margin-left:8px;font-variant-numeric:tabular-nums">${val}</div>
    </div>`;

  document.getElementById('targetBreakBody').innerHTML=
    row('📋','Overdue bills',fmt(urgentPerDay)+'/day',urgentPerDay>0?'var(--red)':'var(--green)',
        overdueBills>0?`${fmt(overdueBills)} total ÷ ${dL} days`:'No overdue bills ✓')
   +row('📅','Upcoming bills',fmt(upcomingPerDay)+'/day',null,
        upcomingDetails.length?upcomingDetails.join(' · '):'No upcoming bills')
   +(otPerDay>0?row('⚡','One-time payments',fmt(otPerDay)+'/day',null,'Each payment ÷ days until due'):'')
   +(!hasRent?row('🏠','Next month rent',fmt(rentPerDay)+'/day',null,`$2,084 ÷ ${dL} days`):
              row('🏠','Rent','In bills ✓','var(--green)','Counted in upcoming bills above'))
   +(swPerDay>0?row('💸','Splitwise contribution',fmt(swPerDay)+'/day',null,`${fmt(S.settings.sw_monthly)}/mo ÷ 30`):'')
   +row('⛽','Daily ops',fmt(dailyOps)+'/day',null,'Charging + road + living')
   +(todayE>0?row('✅','Already earned today','-'+fmt(todayE),'var(--green)','Subtracted from target'):'')
   +(todayS>0?row('💸','Spent today','+'+fmt(todayS),null,'Added back to target'):'')
   +`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;margin-top:2px">
      <div style="font-size:.9rem;font-weight:800">🎯 Your target today</div>
      <div style="font-size:1.15rem;font-weight:800;color:var(--gold)">${fmt(target)}</div>
    </div>`;
}

function hasRentInBillsCheck() {
  return S.bills.some(b=>b.name.toLowerCase().includes('rent'));
}

// ═══════════════════════════════════════════════════════
// CALCULATIONS
// ═══════════════════════════════════════════════════════
function todayEarnings() { refreshDate(); return S.earnings.filter(e=>e.date===_todayStr).reduce((s,e)=>s+e.amount,0); }
function todaySpending()  { refreshDate(); return S.expenses.filter(e=>e.date===_todayStr&&!e.is_income&&e.category!=='transfers').reduce((s,e)=>s+e.amount,0); }
function weekEarnings() {
  const now=new Date(), mon=new Date(now);
  mon.setDate(now.getDate()-((now.getDay()+6)%7)); mon.setHours(0,0,0,0);
  return S.earnings.filter(e=>new Date(e.date+'T12:00:00')>=mon).reduce((s,e)=>s+e.amount,0);
}
function monthEarnings() { return S.earnings.filter(e=>e.date.startsWith(_monthStr)).reduce((s,e)=>s+e.amount,0); }
function monthSpending()  { return S.expenses.filter(e=>e.date.startsWith(_monthStr)&&!e.is_income&&e.category!=='transfers').reduce((s,e)=>s+e.amount,0); }
