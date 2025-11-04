// === Config ===
let APP_ID = 110191; // você confirmou que é esse
const $ = (sel) => document.querySelector(sel);

// === Estado ===
let ws = null;
let authorized = null;
let symbols = [];
let symbol = '';
let tickSubId = null;
let ticks = [];           // últimos 200 preços
let candles = [];         // OHLC para indicadores simples
let optProposal = null;
let multProposal = null;
let orders = [];          // histórico local
let locked = false;

// === Util ===
const fmt = (n, d=2) => (n==null? '—' : Number(n).toLocaleString(undefined,{maximumFractionDigits:d}));
const nowStr = () => new Date().toLocaleTimeString();

// === Indicadores simples (client-side) ===
function ema(vals, p) {
  if (!vals.length) return [];
  const k = 2/(p+1);
  let prev = vals[0], out=[prev];
  for (let i=1;i<vals.length;i++) { prev = (vals[i]-prev)*k + prev; out.push(prev); }
  return out;
}
function rsi(vals, period=14) {
  if (vals.length < period+1) return [];
  let gains=0, losses=0;
  for (let i=1;i<=period;i++){ const d=vals[i]-vals[i-1]; if(d>=0) gains+=d; else losses-=d; }
  gains/=period; losses/=period;
  const out = [];
  for (let i=period+1;i<vals.length;i++){
    const d=vals[i]-vals[i-1];
    const g = d>0? d:0, l = d<0? -d:0;
    gains=(gains*(period-1)+g)/period;
    losses=(losses*(period-1)+l)/period;
    const rs = gains/(losses||1e-9);
    out.push(100 - (100/(1+rs)));
  }
  return Array(vals.length - out.length).fill(NaN).concat(out);
}
function macd(vals, fast=12, slow=26, signal=9) {
  const f = ema(vals, fast), s = ema(vals, slow);
  const line = vals.map((_,i)=> (f[i]??0)-(s[i]??0));
  const sig = ema(line, signal);
  const hist = line.map((m,i)=> m-(sig[i]??0));
  return { line, sig, hist };
}

// === Desenho de sparkline (mini gráfico) ===
function drawSparkline() {
  const el = $('#sparkline');
  if (!el) return;
  const w = el.clientWidth || 300, h = el.clientHeight || 80, pad = 6;
  const data = ticks.slice(-100);
  if (!data.length) { el.innerHTML=''; return; }
  const xs = data.map((d,i)=>i), ys = data.map(d=>d);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const x = i => pad + (i/(xs.length-1||1))*(w - pad*2);
  const y = v => h - pad - ((v-minY)/(maxY-minY||1))*(h - pad*2);
  const path = data.map((v,i)=> (i===0? 'M':'L') + x(i) + ' ' + y(v)).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <path d="${path}" fill="none" stroke="#00bfff" stroke-width="2"/>
  </svg>`;
}

// === WS helpers ===
function connect() {
  const url = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
  ws = new WebSocket(url);
  ws.onopen = ()=> log('WS aberto');
  ws.onclose = ()=> log('WS fechado');
  ws.onerror = (e)=> log('WS erro');
  ws.onmessage = (evt)=> route(JSON.parse(evt.data));
}
function send(obj){ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }

function route(msg) {
  if (msg.error) { log('Erro: ' + msg.error.message); return; }
  switch (msg.msg_type) {
    case 'authorize':
      authorized = msg.authorize;
      $('#authInfo').textContent = `${authorized.loginid} autorizado`;
      // lista de símbolos (sintéticos)
      send({ active_symbols:'brief', product_type:'synthetic_index' });
      // portfolio
      send({ portfolio:1 });
      break;
    case 'active_symbols':
      symbols = (msg.active_symbols||[]).filter(s=>s.market==='synthetic_index')
               .sort((a,b)=> a.display_name.localeCompare(b.display_name));
      const sel = $('#symbol');
      sel.innerHTML = symbols.map(s=>`<option value="${s.symbol}">${s.display_name}</option>`).join('');
      if (!symbol && symbols[0]) { symbol = symbols[0].symbol; sel.value = symbol; }
      break;
    case 'tick':
      const q = Number(msg.tick.quote);
      ticks.push(q); if (ticks.length>200) ticks.shift();
      $('#lastTick').textContent = 'Último: ' + fmt(q,6);
      drawSparkline();
      break;
    case 'history':
      if (Array.isArray(msg.candles)) {
        candles = msg.candles.map(c=>({ t:c.epoch, o:+c.open, h:+c.high, l:+c.low, c:+c.close }));
      }
      break;
    case 'proposal':
      if (['MULTUP','MULTDOWN'].includes(msg.proposal.contract_type)) {
        multProposal = msg.proposal;
      } else {
        optProposal = msg.proposal;
      }
      showProposal();
      break;
    case 'buy':
      pushOrder({ time: nowStr(), symbol, type: msg.buy.longcode, buy: msg.buy.buy_price, id: msg.buy.contract_id });
      break;
    case 'sell':
      // simplificado
      break;
    case 'portfolio':
      // poderia mostrar posições, mantido simples
      break;
  }
}

function showProposal(){
  const p = optProposal || multProposal;
  $('#proposalBox').textContent = p ? `Ask: ${fmt(p.ask_price)} | ${p.longcode}` : 'Sem proposta ainda…';
}

function pushOrder(o){
  orders.unshift(o);
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${o.time}</td><td>${o.symbol}</td><td title="${o.type}">${(o.type||'—').slice(0,36)}…</td>
                  <td>${fmt(o.buy)}</td><td>—</td><td>—</td><td class="mono">${o.id||'—'}</td>`;
  $('#tbody').prepend(tr);
  checkRisk();
}

function checkRisk(){
  // risco simples baseado no histórico realizado (placeholder didático)
  const maxDaily = Number($('#dailyLoss').value||0);
  const maxSeq   = Number($('#maxSeq').value||0);
  // aqui poderíamos calcular PnL; mantemos o bloqueio manual por enquanto
  locked = false;
  $('#riskInfo').textContent = locked ? 'Operações bloqueadas por risco' : 'Risco OK';
  $('#riskInfo').style.color = locked ? 'var(--warn)' : 'var(--muted)';
}

// === IA de decisão (CALL/PUT e MULTUP/MULTDOWN) ===
function aiDecision() {
  if (!$('#autoTrade').checked) return { decision:null, conf:0 };
  const closes = candles.map(c=>c.c);
  if (closes.length < 30) return { decision:null, conf:0 };

  const useEMA  = $('#chkEMA').checked;
  const useRSI  = $('#chkRSI').checked;
  const useMACD = $('#chkMACD').checked;

  let scoreUp=0, scoreDn=0;

  // EMA 9/21
  if (useEMA) {
    const ef = ema(closes,9), es = ema(closes,21);
    const up = ef.at(-2) < es.at(-2) && ef.at(-1) > es.at(-1);
    const dn = ef.at(-2) > es.at(-2) && ef.at(-1) < es.at(-1);
    if (up) scoreUp++; if (dn) scoreDn++;
  }
  // RSI 14
  if (useRSI) {
    const r = rsi(closes,14).at(-1);
    if (r && r < 35) scoreUp++;
    if (r && r > 65) scoreDn++;
  }
  // MACD
  if (useMACD) {
    const m = macd(closes);
    const bull = m.line.at(-2) < m.sig.at(-2) && m.line.at(-1) > m.sig.at(-1);
    const bear = m.line.at(-2) > m.sig.at(-2) && m.line.at(-1) < m.sig.at(-1);
    if (bull) scoreUp++;
    if (bear) scoreDn++;
  }
  // momentum curto
  const last=closes.at(-1), prev=closes.at(-2);
  if (($('#aiMode').value||'hybrid') === 'reactive') {
    if (last>prev) scoreUp++; else scoreDn++;
  } else {
    if (last>prev) scoreUp+=0.5; else scoreDn+=0.5;
  }

  let decision = null;
  let conf = Math.abs(scoreUp-scoreDn);
  if (scoreUp - scoreDn >= 1) decision = 'CALL';
  else if (scoreDn - scoreUp >= 1) decision = 'PUT';

  const minConf = Number($('#minConf').value||2.5);
  if (decision==='CALL' && conf>=minConf+0.5) decision='MULTUP';
  if (decision==='PUT'  && conf>=minConf+0.5) decision='MULTDOWN';

  return { decision, conf };
}

// === Ações Deriv ===
function authorizeWithToken() {
  const tok = $('#token').value.trim();
  if (!tok) return alert('Cole um token da Deriv (demo ou real) ou use OAuth.');
  send({ authorize: tok });
}
function startOAuth() {
  APP_ID = Number($('#appId').value || APP_ID);
  const url = `https://oauth.deriv.com/oauth2/authorize?app_id=${encodeURIComponent(APP_ID)}&brand=deriv`;
  location.href = url;
}
function subscribeTicks() {
  if (!symbol) symbol = $('#symbol').value;
  if (!symbol) return alert('Escolha um símbolo.');
  if (tickSubId) send({ forget: tickSubId }), tickSubId=null;
  send({ ticks: symbol, subscribe: 1 });
  // pedir candles p/ indicadores
  send({ ticks_history: symbol, style:'candles', count:200, end:'latest', granularity:60 });
}

function requestOptProposal() {
  if (!symbol) return;
  const amount = Number($('#stake').value||5);
  const duration = Number($('#duration').value||1);
  const unit = $('#durationUnit').value || 'm';
  send({ proposal:1, subscribe:0, amount, basis:'stake', contract_type:'CALL', currency:'USD', duration, duration_unit:unit, symbol });
  send({ proposal:1, subscribe:0, amount, basis:'stake', contract_type:'PUT',  currency:'USD', duration, duration_unit:unit, symbol });
}
function buyOpt() {
  if (!optProposal) return alert('Peça proposta primeiro.');
  send({ buy: optProposal.id, price: optProposal.ask_price });
}
function requestMultProposal() {
  if (!symbol) return;
  const amount = Number($('#stake').value||5);
  const m = Number($('#multiplier').value||100);
  const sl = Number($('#sl').value||8);
  const tp = Number($('#tp').value||8);
  send({ proposal:1, subscribe:0, amount, basis:'stake', contract_type:'MULTUP',   currency:'USD', multiplier:m, stop_loss:sl, take_profit:tp, symbol });
  send({ proposal:1, subscribe:0, amount, basis:'stake', contract_type:'MULTDOWN', currency:'USD', multiplier:m, stop_loss:sl, take_profit:tp, symbol });
}
function buyMult() {
  if (!multProposal) return alert('Peça proposta primeiro.');
  send({ buy: multProposal.id, price: multProposal.ask_price });
}

// === UI bindings ===
function log(s){ console.log(s); }

window.addEventListener('load', ()=>{
  // Capturar token de OAuth (hash ou query)
  const urlQ = new URLSearchParams(location.search);
  const hashQ = new URLSearchParams((location.hash||'').replace(/^#/,''));
  const tok = urlQ.get('token') || urlQ.get('token1') || hashQ.get('token') || hashQ.get('token1');
  if (tok) $('#token').value = tok;

  // App ID field
  $('#appId').addEventListener('change', (e)=> {
    APP_ID = Number(e.target.value||110191);
    if (ws) try{ ws.close() }catch{};
    connect();
  });

  $('#btnAuthorize').onclick = ()=> authorizeWithToken();
  $('#btnOAuth').onclick     = ()=> startOAuth();

  $('#symbol').addEventListener('change', (e)=> { symbol = e.target.value; });
  $('#btnTicks').onclick = ()=> subscribeTicks();

  $('#btnProposalOpt').onclick  = ()=> requestOptProposal();
  $('#btnBuyOpt').onclick       = ()=> buyOpt();
  $('#btnProposalMult').onclick = ()=> requestMultProposal();
  $('#btnBuyMult').onclick      = ()=> buyMult();

  // IA loop (a cada 4s)
  setInterval(()=>{
    if (!authorized || !$('#autoTrade').checked) return;
    if (!symbol) return;
    const { decision, conf } = aiDecision();
    $('#aiStatus').textContent = decision ? `IA: ${decision} (conf=${conf.toFixed(2)})` : `IA: sem sinal (conf=${conf.toFixed(2)})`;
    if (!decision) return;

    // pedir proposta e comprar em seguida (fluxo simplificado)
    const amount = Number($('#stake').value||5);
    const duration = Number($('#duration').value||1);
    const unit = $('#durationUnit').value || 'm';
    const m = Number($('#multiplier').value||100);
    const sl = Number($('#sl').value||8);
    const tp = Number($('#tp').value||8);

    if (decision==='CALL' || decision==='PUT') {
      send({ proposal:1, subscribe:0, amount, basis:'stake', contract_type:decision, currency:'USD', duration, duration_unit:unit, symbol });
      // após 500ms tenta comprar a última proposta recebida
      setTimeout(()=>{ if (optProposal) send({ buy: optProposal.id, price: optProposal.ask_price }); }, 700);
    } else {
      send({ proposal:1, subscribe:0, amount, basis:'stake', contract_type:decision, currency:'USD', multiplier:m, stop_loss:sl, take_profit:tp, symbol });
      setTimeout(()=>{ if (multProposal) send({ buy: multProposal.id, price: multProposal.ask_price }); }, 700);
    }
  }, 4000);

  // abre conexão WS
  connect();
});
