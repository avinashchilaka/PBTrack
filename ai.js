// ═══════════════════════════════════════════════════════
// AI BUDGET
// ═══════════════════════════════════════════════════════
async function requestAIBudget() {
  const card=document.getElementById('aiBudCard'); card.style.display='block';
  document.getElementById('aiBudRows').innerHTML='<div class="lrow"><div class="spinner"></div> Analyzing your transactions...</div>';
  const mFreq={};
  S.expenses.filter(e=>!e.is_income&&e.category!=='transfers').forEach(e=>{const m=(e.description||'').toLowerCase().trim().substring(0,25);if(!mFreq[m]){mFreq[m]={count:0,total:0,cat:e.category||'other'};}mFreq[m].count++;mFreq[m].total+=e.amount;});
  const topM=Object.entries(mFreq).sort((a,b)=>b[1].total-a[1].total).slice(0,10).map(([name,{count,total,cat}])=>({name,count,total:Math.round(total),cat}));
  const cTotals={};const threeM=new Date();threeM.setMonth(threeM.getMonth()-3);
  S.expenses.filter(e=>new Date(e.date+'T12:00:00')>=threeM&&!e.is_income&&e.category!=='transfers').forEach(e=>{const c=e.category||'other';cTotals[c]=(cTotals[c]||0)+e.amount;});
  const cMonthly=Object.fromEntries(Object.entries(cTotals).map(([c,t])=>[c,Math.round(t/3)]));
  const context=`Gig driver San Diego. 3-month category averages: ${JSON.stringify(cMonthly)}. Top merchants: ${JSON.stringify(topM)}. Monthly goal: $${S.settings.monthly_goal||9500}. Suggest smart monthly budget limits and flag high-spend merchants. Return ONLY JSON: {"budgets":{"food":N,"transportation":N,"shopping":N,"entertainment":N,"utilities":N,"health":N,"other":N},"flags":[{"merchant":"name","avg_monthly":N,"insight":"why this matters"}]}`;
  try {
    const r=await req('/api/ai/budget',{method:'POST',body:{context}});
    if(!r?.budgets) throw new Error('No response');
    window._aiBuds=r.budgets;
    document.getElementById('aiBudRows').innerHTML=
      Object.entries(r.budgets).map(([cat,sug])=>`<div class="acct-row" id="aibr-${cat}" style="flex-wrap:wrap;gap:5px">
        <div style="flex:1"><div style="font-size:.83rem;font-weight:600">${ttc(cat)}</div><div class="meta-xs">Current ${fmt(S.budgets[cat]||0)} · Avg ${fmt(cMonthly[cat]||0)}/mo</div></div>
        <div style="display:flex;gap:5px;align-items:center">
          <input type="number" value="${sug}" id="aib-${cat}" style="width:65px;background:var(--s1);border:1.5px solid var(--border2);border-radius:8px;color:var(--text);font-family:'Inter',sans-serif;font-size:.75rem;padding:4px 7px;outline:none;text-align:right">
          <button class="bicon" id="aibck-${cat}" onclick="toggleBudApproval('${cat}')">✓</button>
        </div>
      </div>`).join('')
      +((r.flags||[]).length?`<div style="margin-top:11px;padding-top:9px;border-top:1px solid var(--border)"><div class="clbl">⚠️ High-Spend Merchants</div>${(r.flags||[]).map(f=>`<div style="background:var(--gold-bg);border-radius:8px;padding:7px 9px;margin-bottom:5px"><div class="label-sm-bold">${f.merchant} · ${fmt(f.avg_monthly)}/mo</div><div style="font-size:.67rem;color:var(--text2);margin-top:2px">${f.insight}</div></div>`).join('')}</div>`:'');
  } catch(e) { document.getElementById('aiBudRows').innerHTML='<div class="empty">Could not generate suggestions.</div>'; }
}
function toggleBudApproval(cat) {
  const btn=document.getElementById('aibck-'+cat),row=document.getElementById('aibr-'+cat);
  if(_approvedBudgets.has(cat)){_approvedBudgets.delete(cat);if(btn){btn.style.background='';btn.style.color='';}if(row)row.style.background='';}
  else{_approvedBudgets.add(cat);if(btn){btn.style.background='var(--green)';btn.style.color='#fff';}if(row)row.style.background='var(--green-bg)';}
}
async function applyApprovedBudgets() {
  if(!_approvedBudgets.size) return alert('Tap ✓ on categories you want to approve first.');
  _approvedBudgets.forEach(cat=>{const val=parseFloat(document.getElementById('aib-'+cat)?.value);if(val>0)S.budgets[cat]=val;});
  await req('/api/settings',{method:'PUT',body:{...S.settings,budgets:S.budgets}});
  saveLocal();document.getElementById('aiBudCard').style.display='none';renderBudBars();
  alert(`✅ ${_approvedBudgets.size} budget limits saved!`);_approvedBudgets.clear();
}

// ═══════════════════════════════════════════════════════
// AI BRIEFING
// ═══════════════════════════════════════════════════════
async function loadBriefing() {
  const cached=JSON.parse(localStorage.getItem('pb_brief')||'{}');
  if(cached.headline&&Date.now()-cached.ts<30*60*1000){showBriefing(cached);return;}
  try {
    const r=await req('/api/ai/briefing');
    if(r?.headline){localStorage.setItem('pb_brief',JSON.stringify({...r,ts:Date.now()}));showBriefing(r);}
  } catch{}
}
function showBriefing(r) {
  const card=document.getElementById('briefCard');if(!card)return;
  card.style.display='block';
  document.getElementById('briefEmoji').textContent=r.mood==='positive'?'🚀':r.mood==='warning'?'⚠️':'📊';
  document.getElementById('briefHead').textContent=r.headline||'Daily Briefing';
  document.getElementById('briefBody').textContent=r.briefing||'';
  document.getElementById('briefTip').textContent=r.tip||'';
}

// ═══════════════════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════════════════
async function sendChat() {
  const inp=document.getElementById('chatIn');
  const msg=inp.value.trim();if(!msg)return;
  inp.value='';addBubble(msg,'user');
  document.getElementById('chatSug').style.display='none';
  const loading=addBubble('','ai',true);
  try {
    const now=new Date();
    const context=`Avinash is a gig driver (Uber/Lyft) in San Diego. App: Livvy.
Today ${_todayStr}: earned $${todayEarnings().toFixed(2)}, spent $${todaySpending().toFixed(2)}
Week: $${weekEarnings().toFixed(2)} | Month: $${monthEarnings().toFixed(2)} | Goal: $${S.settings.monthly_goal}
Daily target: $${calcDailyTarget().toFixed(2)}
Unpaid bills: $${S.bills.filter(b=>!b.paid).reduce((s,b)=>s+b.amount,0).toFixed(2)}
Splitwise owed: $${S.splitwise.reduce((s,d)=>s+d.amount,0).toFixed(2)}
Days left this month: ${getDaysLeft()}
History: ${_chatHistory.slice(-3).map(m=>m.r+': '+m.c).join(' | ')}
Be concise, specific with numbers, like a sharp financial coach. Max 2-3 sentences.`;
    _chatHistory.push({r:'user',c:msg});
    const r=await req('/api/ai/chat',{method:'POST',body:{question:msg,context}});
    const answer=r?.answer||'Server may be waking up — try again.';
    _chatHistory.push({r:'ai',c:answer});
    loading.remove();addBubble(answer,'ai');
  } catch(e){loading.remove();addBubble('Connection error.','ai');}
}
function sendSug(btn){document.getElementById('chatIn').value=btn.textContent;sendChat();}
function addBubble(text,role,isLoading=false) {
  const msgs=document.getElementById('chatMsgs');
  const div=document.createElement('div');div.className='bubble '+role;
  if(isLoading)div.innerHTML='<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  else div.textContent=text;
  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;return div;
}
