const ctx = document.getElementById('digitChart');
const logTable = document.getElementById('logTable');
const profitTotal = document.getElementById('profitTotal');
const operations = document.getElementById('operations');

let lucro = 0;
let ganhos = 0;
let perdas = 0;
let operando = false;

const chart = new Chart(ctx, {
  type: 'bar',
  data: {
    labels: ['0','1','2','3','4','5','6','7','8','9'],
    datasets: [{
      label: 'Frequência',
      data: Array(10).fill(0),
      backgroundColor: Array(10).fill('#3b82f6'),
    }]
  },
  options: {
    responsive: true,
    scales: {
      y: { beginAtZero: true, ticks: { color: '#fff' }},
      x: { ticks: { color: '#fff' }}
    }
  }
});

function atualizarGrafico(digito) {
  chart.data.datasets[0].data[digito]++;
  chart.update();
}

function registrarOperacao(tipo, tick, preco, resultado) {
  const tr = document.createElement('tr');
  const hora = new Date().toLocaleTimeString();
  tr.innerHTML = `
    <td>${hora}</td>
    <td>${tipo}</td>
    <td>${tick}</td>
    <td>${preco}</td>
    <td style="color:${resultado >= 0 ? '#22c55e' : '#ef4444'}">${resultado.toFixed(2)}</td>
  `;
  logTable.prepend(tr);
}

document.getElementById('start').addEventListener('click', () => {
  operando = true;
  executarBot();
});

document.getElementById('stopBot').addEventListener('click', () => {
  operando = false;
});

function executarBot() {
  if (!operando) return;

  const estrategia = document.getElementById('estrategia').value;
  const stake = parseFloat(document.getElementById('stake').value);
  const meta = parseFloat(document.getElementById('meta').value);
  const stop = parseFloat(document.getElementById('stop').value);

  const digito = Math.floor(Math.random() * 10);
  atualizarGrafico(digito);

  let resultado = 0;

  // Estratégias
  if (estrategia === 'par' && digito % 2 === 0) resultado = stake * 0.9;
  else if (estrategia === 'impar' && digito % 2 !== 0) resultado = stake * 0.9;
  else if (estrategia === 'superior5' && digito > 5) resultado = stake * 0.9;
  else if (estrategia === 'inferior5' && digito < 5) resultado = stake * 0.9;
  else resultado = -stake;

  lucro += resultado;
  if (resultado >= 0) ganhos++;
  else perdas++;

  registrarOperacao(estrategia, digito, stake, resultado);

  profitTotal.textContent = `$${lucro.toFixed(2)}`;
  operations.textContent = `${ganhos + perdas} / ${ganhos}`;

  if (lucro >= meta) {
    alert("🎯 Meta atingida! Bot encerrado.");
    operando = false;
    return;
  }

  if (Math.abs(lucro) >= stop) {
    alert("⚠️ Stop Loss atingido! Bot encerrado.");
    operando = false;
    return;
  }

  setTimeout(executarBot, 1500);
}
