require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { createClient }  = require('@supabase/supabase-js');
const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');
const Anthropic = require('@anthropic-ai/sdk');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Clients ──────────────────────────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV||'sandbox'],
  baseOptions: { headers: {
    'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
    'PLAID-SECRET':    process.env.PLAID_SECRET,
  }},
}));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Auth middleware ───────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(h.replace('Bearer ',''), process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, monthly_goal } = req.body;
    if (!name||!email||!password) return res.status(400).json({ error: 'Missing fields' });
    const { data: ex } = await supabase.from('users').select('id').eq('email',email).single();
    if (ex) return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase.from('users')
      .insert({ name, email, password_hash:hash, monthly_goal:monthly_goal||9500, daily_quota:400 })
      .select().single();
    if (error) throw error;
    const token = jwt.sign({ id:user.id, email }, process.env.JWT_SECRET, { expiresIn:'90d' });
    res.json({ token, user:{ id:user.id, name, email, monthly_goal:user.monthly_goal } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('email',email).single();
    if (!user) return res.status(401).json({ error:'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error:'Invalid email or password' });
    const token = jwt.sign({ id:user.id, email }, process.env.JWT_SECRET, { expiresIn:'90d' });
    res.json({ token, user:{ id:user.id, name:user.name, email, monthly_goal:user.monthly_goal } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ════════════════════════════════════════════════════════
// EARNINGS (manual only — never Plaid)
// ════════════════════════════════════════════════════════
app.get('/api/earnings', auth, async (req, res) => {
  const { data, error } = await supabase.from('earnings')
    .select('*').eq('user_id',req.user.id).eq('is_manual',true)
    .order('date',{ ascending:false }).limit(300);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ data });
});

app.post('/api/earnings', auth, async (req, res) => {
  const { amount, platform, date, note } = req.body;
  const { data, error } = await supabase.from('earnings')
    .insert({ user_id:req.user.id, amount, platform, date, note, is_manual:true })
    .select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

app.patch('/api/earnings/:id', auth, async (req, res) => {
  const { data, error } = await supabase.from('earnings')
    .update(req.body).eq('id',req.params.id).eq('user_id',req.user.id).select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

app.delete('/api/earnings/:id', auth, async (req, res) => {
  await supabase.from('earnings').delete().eq('id',req.params.id).eq('user_id',req.user.id);
  res.json({ ok:true });
});

// ════════════════════════════════════════════════════════
// BILLS (recurring)
// ════════════════════════════════════════════════════════
app.get('/api/bills', auth, async (req, res) => {
  const { data, error } = await supabase.from('bills')
    .select('*').eq('user_id',req.user.id).order('due_day');
  if (error) return res.status(500).json({ error:error.message });
  res.json({ data });
});

app.post('/api/bills', auth, async (req, res) => {
  const { name, amount, due_day, category } = req.body;
  const { data, error } = await supabase.from('bills')
    .insert({ user_id:req.user.id, name, amount, due_day, category, paid:false, skipped:false })
    .select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

app.patch('/api/bills/:id', auth, async (req, res) => {
  const { data, error } = await supabase.from('bills')
    .update(req.body).eq('id',req.params.id).eq('user_id',req.user.id).select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

app.delete('/api/bills/:id', auth, async (req, res) => {
  await supabase.from('bills').delete().eq('id',req.params.id).eq('user_id',req.user.id);
  res.json({ ok:true });
});

// ════════════════════════════════════════════════════════
// ONE-TIME PAYMENTS
// ════════════════════════════════════════════════════════
app.get('/api/onetime', auth, async (req, res) => {
  const { data, error } = await supabase.from('onetime_payments')
    .select('*').eq('user_id',req.user.id).order('due_date');
  if (error) return res.status(500).json({ error:error.message });
  res.json({ data: data||[] });
});

app.post('/api/onetime', auth, async (req, res) => {
  const { name, amount, due_date, notes } = req.body;
  const { data, error } = await supabase.from('onetime_payments')
    .insert({ user_id:req.user.id, name, amount, due_date, notes, paid:false })
    .select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

app.patch('/api/onetime/:id', auth, async (req, res) => {
  const { data, error } = await supabase.from('onetime_payments')
    .update(req.body).eq('id',req.params.id).eq('user_id',req.user.id).select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

app.delete('/api/onetime/:id', auth, async (req, res) => {
  await supabase.from('onetime_payments').delete().eq('id',req.params.id).eq('user_id',req.user.id);
  res.json({ ok:true });
});

// ════════════════════════════════════════════════════════
// DEBTS
// ════════════════════════════════════════════════════════
app.get('/api/debts', auth, async (req, res) => {
  const { data, error } = await supabase.from('debts')
    .select('*').eq('user_id',req.user.id);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ data });
});

app.post('/api/debts', auth, async (req, res) => {
  const { name, amount, original, monthly_payment, notes } = req.body;
  const { data, error } = await supabase.from('debts')
    .insert({ user_id:req.user.id, name, amount, original:original||amount, monthly_payment, notes })
    .select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

app.patch('/api/debts/:id', auth, async (req, res) => {
  const { data, error } = await supabase.from('debts')
    .update(req.body).eq('id',req.params.id).eq('user_id',req.user.id).select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

// ════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════
app.get('/api/settings', auth, async (req, res) => {
  const { data } = await supabase.from('users')
    .select('monthly_goal,daily_quota,budgets,rules').eq('id',req.user.id).single();
  res.json(data||{});
});

app.put('/api/settings', auth, async (req, res) => {
  const { monthly_goal, daily_quota, budgets } = req.body;
  await supabase.from('users')
    .update({ monthly_goal, daily_quota, budgets: budgets||null }).eq('id',req.user.id);
  res.json({ ok:true });
});

// ════════════════════════════════════════════════════════
// MERCHANT RULES
// ════════════════════════════════════════════════════════
app.get('/api/rules', auth, async (req, res) => {
  const { data } = await supabase.from('users').select('rules').eq('id',req.user.id).single();
  res.json(data?.rules||{});
});

app.post('/api/rules', auth, async (req, res) => {
  await supabase.from('users').update({ rules: req.body }).eq('id',req.user.id);
  res.json({ ok:true });
});

// ════════════════════════════════════════════════════════
// SHIFTS
// ════════════════════════════════════════════════════════
app.post('/api/shifts', auth, async (req, res) => {
  const { date, start, end, hours, earned, perHour, notes } = req.body;
  const { data, error } = await supabase.from('shifts')
    .insert({ user_id:req.user.id, date, start_time:start, end_time:end, hours, earned, per_hour:perHour, notes })
    .select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json(data);
});

// ════════════════════════════════════════════════════════
// PLAID
// ════════════════════════════════════════════════════════
app.post('/api/plaid/link-token', auth, async (req, res) => {
  try {
    const r = await plaid.linkTokenCreate({
      user: { client_user_id: req.user.id },
      client_name: 'PBTrack',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.json({ link_token: r.data.link_token });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/plaid/exchange-token', auth, async (req, res) => {
  try {
    const { public_token, institution_name } = req.body;
    const r = await plaid.itemPublicTokenExchange({ public_token });
    await supabase.from('plaid_tokens').upsert({
      user_id:     req.user.id,
      institution: institution_name,
      access_token:r.data.access_token,
      item_id:     r.data.item_id,
    });
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── PLAID TRANSACTIONS — maps to expenses ONLY, never earnings ──
app.get('/api/plaid/transactions', auth, async (req, res) => {
  try {
    const { data: tokens } = await supabase.from('plaid_tokens')
      .select('*').eq('user_id',req.user.id);
    if (!tokens?.length) return res.json({ transactions:[] });

    const all = [];
    for (const t of tokens) {
      let cursor = t.cursor||null, hasMore = true;
      while (hasMore) {
        const r = await plaid.transactionsSync({
          access_token: t.access_token,
          ...(cursor?{cursor}:{}),
        });
        r.data.added.forEach(tx => {
          // Save ALL transactions — spending AND income (deposits/credits)
          // is_income flag on each record distinguishes them in the frontend
          const mapped = mapTransaction(tx, t.institution);
          all.push(mapped);
        });
        cursor  = r.data.next_cursor;
        hasMore = r.data.has_more;
      }
      await supabase.from('plaid_tokens').update({ cursor }).eq('id',t.id);
    }

    // Upsert expenses into transactions table
    if (all.length) {
      await supabase.from('transactions').upsert(
        all.map(t=>({ ...t, user_id:req.user.id })),
        { onConflict:'plaid_id' }
      );
    }

    // Apply user's merchant rules
    const { data: rules } = await supabase.from('users').select('rules').eq('id',req.user.id).single();
    const userRules = rules?.rules||{};

    const { data: txns } = await supabase.from('transactions')
      .select('*').eq('user_id',req.user.id).eq('is_plaid',true)
      .order('date',{ ascending:false }).limit(400);

    // Apply rules server-side too + fix is_income for old records
    const withRules = (txns||[]).map(t => {
      const key = (t.description||'').toLowerCase().trim().substring(0,30);
      let tx = { ...t };
      // Fix legacy records: if amount was stored as negative, it's income
      // (shouldn't happen but safety net)
      if (userRules[key]) tx = { ...tx, category: userRules[key] };
      return tx;
    });

    res.json({ transactions: withRules });
  } catch(e) { console.error(e); res.status(500).json({ error:e.message }); }
});

// Reset Plaid cursor — forces full re-sync on next GET /api/plaid/transactions
app.post('/api/plaid/reset-sync', auth, async (req, res) => {
  try {
    await supabase.from('plaid_tokens').update({ cursor: null }).eq('user_id', req.user.id);
    // Also clear all stored transactions so fresh ones (including income) get saved
    await supabase.from('transactions').delete().eq('user_id', req.user.id).eq('is_plaid', true);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Category patch for a single transaction
app.patch('/api/transactions/:id/category', auth, async (req, res) => {
  const { category } = req.body;
  await supabase.from('transactions').update({ category })
    .eq('plaid_id',req.params.id).eq('user_id',req.user.id);
  res.json({ ok:true });
});

app.get('/api/plaid/accounts', auth, async (req, res) => {
  try {
    const { data: tokens } = await supabase.from('plaid_tokens')
      .select('access_token,institution').eq('user_id',req.user.id);
    if (!tokens?.length) return res.json({ accounts:[] });
    const accounts = [];
    for (const t of tokens) {
      const r = await plaid.accountsGet({ access_token: t.access_token });
      r.data.accounts.forEach(a => accounts.push({ ...a, institution: t.institution }));
    }
    res.json({ accounts });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

function mapTransaction(t, source) {
  const CAT_MAP = {
    'TRANSPORTATION':'transportation','AUTO':'transportation',
    'FOOD_AND_DRINK':'food','GENERAL_MERCHANDISE':'shopping',
    'HOME_IMPROVEMENT':'housing','MEDICAL':'health',
    'ENTERTAINMENT':'entertainment','UTILITIES':'utilities',
    'RENT_AND_UTILITIES':'utilities','LOAN_PAYMENTS':'debt',
    'INCOME':'income','TRANSFER_IN':'transfers','TRANSFER_OUT':'transfers',
    'TRAVEL':'transportation','PERSONAL_CARE':'health',
  };
  const primary = t.personal_finance_category?.primary?.toUpperCase()||'';
  const isIncome = t.amount < 0; // Plaid: negative = money coming in
  return {
    plaid_id:    t.transaction_id,
    date:        t.date,
    amount:      Math.abs(t.amount),
    description: t.name,
    category:    CAT_MAP[primary]||'other',
    account_id:  t.account_id,
    institution: source,
    is_plaid:    true,
    is_income:   isIncome,
  };
}

// ════════════════════════════════════════════════════════
// SPLITWISE
// ════════════════════════════════════════════════════════
app.get('/api/splitwise/auth-url', auth, (req, res) => {
  const cb = `${process.env.APP_URL}/api/splitwise/callback`;
  const url = `https://secure.splitwise.com/oauth/authorize?response_type=code`
    + `&client_id=${process.env.SPLITWISE_CONSUMER_KEY}`
    + `&redirect_uri=${encodeURIComponent(cb)}&state=${req.user.id}`;
  res.json({ url });
});

app.get('/api/splitwise/callback', async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    const cb = `${process.env.APP_URL}/api/splitwise/callback`;
    const r = await fetch('https://secure.splitwise.com/oauth/token', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        grant_type:'authorization_code', code,
        client_id:process.env.SPLITWISE_CONSUMER_KEY,
        client_secret:process.env.SPLITWISE_CONSUMER_SECRET,
        redirect_uri:cb,
      }),
    });
    const data = await r.json();
    await supabase.from('splitwise_tokens').upsert({ user_id:userId, access_token:data.access_token });
    res.redirect('/app.html?splitwise=connected');
  } catch(e) { res.redirect('/app.html?splitwise=error'); }
});

app.get('/api/splitwise/balances', auth, async (req, res) => {
  try {
    const { data: row } = await supabase.from('splitwise_tokens')
      .select('access_token').eq('user_id',req.user.id).single();
    if (!row) return res.json({ balances:[] });
    const r = await fetch('https://secure.splitwise.com/api/v3.0/get_friends', {
      headers:{ Authorization:`Bearer ${row.access_token}` }
    });
    const { friends } = await r.json();
    const balances = [];
    (friends||[]).forEach(f => {
      (f.balance||[]).forEach(b => {
        const amt = parseFloat(b.amount);
        if (amt < 0) balances.push({
          name:`${f.first_name} ${f.last_name||''}`.trim(),
          amount:Math.abs(amt),
          currency:b.currency_code,
        });
      });
    });
    res.json({ balances });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ════════════════════════════════════════════════════════
// AI — BRIEFING
// ════════════════════════════════════════════════════════
app.get('/api/ai/briefing', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const month = today.slice(0,7);

    const { data: earnings } = await supabase.from('earnings')
      .select('amount,date,platform').eq('user_id',req.user.id)
      .eq('is_manual',true).gte('date',month+'-01');
    const { data: bills } = await supabase.from('bills')
      .select('name,amount,due_day,paid').eq('user_id',req.user.id);
    const { data: user } = await supabase.from('users')
      .select('monthly_goal,daily_quota').eq('id',req.user.id).single();

    const todayEarned = (earnings||[]).filter(e=>e.date===today).reduce((s,e)=>s+e.amount,0);
    const monthEarned = (earnings||[]).reduce((s,e)=>s+e.amount,0);
    const unpaidBills = (bills||[]).filter(b=>!b.paid);
    const todayDay   = new Date().getDate();
    const overdueBills = unpaidBills.filter(b=>b.due_day<todayDay);
    const daysLeft   = new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate()-todayDay;

    const prompt = `You are a personal finance coach for Avinash, a gig driver in San Diego.
Today ${today}:
- Earned today: $${todayEarned.toFixed(2)}
- Month earned: $${monthEarned.toFixed(2)} of $${user?.monthly_goal||9500} goal
- Overdue bills: ${overdueBills.map(b=>`${b.name} $${b.amount}`).join(', ')||'none'}
- Unpaid this month: $${unpaidBills.reduce((s,b)=>s+b.amount,0).toFixed(2)}
- Days left in month: ${daysLeft}
- Daily quota: $${user?.daily_quota||400}

Generate a sharp, motivating daily briefing. Return ONLY valid JSON:
{"headline":"short punchy headline","briefing":"2-3 sentence briefing with specific numbers","tip":"one actionable tip","mood":"positive|warning|neutral"}`;

    const msg = await anthropic.messages.create({
      model:'claude-sonnet-4-5', max_tokens:400,
      messages:[{role:'user',content:prompt}],
    });
    const text = msg.content[0].text.trim().replace(/```json|```/g,'').trim();
    res.json(JSON.parse(text));
  } catch(e) { console.error(e); res.status(500).json({ error:e.message }); }
});

// ════════════════════════════════════════════════════════
// AI — CHAT
// ════════════════════════════════════════════════════════
app.post('/api/ai/chat', auth, async (req, res) => {
  try {
    const { question, context } = req.body;
    const msg = await anthropic.messages.create({
      model:'claude-sonnet-4-5', max_tokens:200,
      messages:[
        { role:'user', content: context + '\n\nQuestion: ' + question }
      ],
    });
    res.json({ answer: msg.content[0].text.trim() });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ════════════════════════════════════════════════════════
// AI — BUDGET SUGGESTIONS
// ════════════════════════════════════════════════════════
app.post('/api/ai/budget', auth, async (req, res) => {
  try {
    const { context } = req.body;
    const prompt = context + `\n\nReturn ONLY valid JSON with no markdown or preamble. Example format: {"budgets":{"food":350,"transportation":500,"shopping":100,"entertainment":40,"utilities":580,"health":80,"other":250},"flags":[{"merchant":"Starbucks","avg_monthly":120,"insight":"$120/mo on coffee — that's $4/day from your gig earnings"}]}`;
    const msg = await anthropic.messages.create({
      model:'claude-sonnet-4-5', max_tokens:600,
      messages:[{role:'user',content:prompt}],
    });
    const text = msg.content[0].text.trim().replace(/```json|```/g,'').trim();
    res.json(JSON.parse(text));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ════════════════════════════════════════════════════════
// SERVE FRONTEND
// ════════════════════════════════════════════════════════
app.get('/', (_,res) => res.sendFile(path.join(__dirname,'index.html')));
app.get('/app', (_,res) => res.sendFile(path.join(__dirname,'app.html')));
app.get('/app.html', (_,res) => res.sendFile(path.join(__dirname,'app.html')));

app.listen(PORT, () => console.log(`✅ PBTrack v3 running at http://localhost:${PORT}`));
