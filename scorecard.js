// Player Profile scorecard (Joseph's design, 1920×1080, shown scaled to fit). Needs api.js (esc) and titles.js (cofTitle).
// Its fonts load the first time a card is drawn: Montserrat 600/800 and Permanent Marker (a free stand-in for the Brushlie rank font).
const CHARACTERS = ['Alisa', 'Anna', 'Armor King', 'Asuka', 'Azucena', 'Bob', 'Bryan', 'Claudio', 'Clive', 'Devil Jin', 'Dragunov', 'Eddy',
  'Fahkumram', 'Feng', 'Heihachi', 'Hwoarang', 'Jack-8', 'Jin', 'Jun', 'Kazuya', 'King', 'Kuma', 'Kunimitsu', 'Lars', 'Law', 'Lee', 'Leo', 'Leroy',
  'Lili', 'Lidia', 'Miary Zo', 'Nina', 'Panda', 'Paul', 'Raven', 'Reina', 'Roger Jr.', 'Shaheen', 'Steve Fox', 'Victor', 'Xiaoyu', 'Yoshimitsu', 'Zafina']
  .map(name => ({ name, id: name === 'Steve Fox' ? 'steve' : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }));
const SC_PINK = '#bf016d'; // the card's colour for players without a team
const COACHING_URL = 'https://gaberpet.github.io/iron-fist-academy/'; // Fighters Academy, the coaching app (the stamp opens it)

const scRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
function scHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function scFromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

// The background is pink (#bf016d): every pink pixel takes the team colour, keeping how light or dark it was; greys stay grey.
const scBgCache = new Map();
function scBackground(color) {
  if (!scBgCache.has(color)) scBgCache.set(color, new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      if (color !== SC_PINK) {
        const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
        const [th, ts, tl] = scHsl(scRgb(color)), [ph, ps, pl] = scHsl(scRgb(SC_PINK));
        for (let i = 0; i < px.length; i += 4) {
          const [h, s, l] = scHsl([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]);
          if (s < 0.08 || l < 0.12 || Math.min(Math.abs(h - ph), 360 - Math.abs(h - ph)) > 45) continue; // only the pink: the dark bars stay
          const k = Math.min(1, s / ps), [r, gg, b] = scFromHsl(th, Math.min(1, s * ts / ps), Math.min(1, Math.max(0, l + (tl - pl) * k)));
          px[i] = r * 255; px[i + 1] = gg * 255; px[i + 2] = b * 255;
        }
        g.putImageData(d, 0, 0);
      }
      ok(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = fail; img.src = 'hud/scorecard-bg.webp';
  }));
  return scBgCache.get(color);
}

// A team logo's most common strong colour (Settings → Teams fills it in by itself; it can be changed by hand).
function dominantColor(img) {
  const c = document.createElement('canvas'), k = Math.min(1, 160 / Math.max(img.width, img.height));
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
  const px = g.getImageData(0, 0, c.width, c.height).data, bins = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 160) continue;
    const [h, s, l] = scHsl([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]);
    if (s < 0.35 || l < 0.18 || l > 0.85) continue; // skip white, black and grey
    const b = Math.round(h / 20) % 18, e = bins.get(b) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += px[i]; e.g += px[i + 1]; e.b += px[i + 2]; bins.set(b, e);
  }
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  return top ? '#' + [top.r, top.g, top.b].map(v => Math.round(v / top.n).toString(16).padStart(2, '0')).join('') : SC_PINK;
}

const scOrd = n => n + ((n % 100 > 10 && n % 100 < 14) ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
// The numbers on the left, from the season's stats (worked out from start.gg in Settings → Season) and the season's entry fees.
function scStats(p) {
  const st = p.stats ?? {}, fees = p.season?.fees ?? {}, i = p.member ? 0 : 1;
  const euros = ['qualifier', 'lcq', 'main'].reduce((sum, k) => sum + (st.went?.[k] ?? 0) * (fees[k]?.[i] ?? 0), 0);
  return [['Win Rate', st.games?.[1] ? Math.round(100 * st.games[0] / st.games[1]) + '%' : '–'], ['Best Rank', st.best ? scOrd(st.best) : '–'],
    ['Seed', st.seed ?? '–'], ['Points', st.points ?? 0], ['Attendance', st.att?.[1] ? Math.round(100 * st.att[0] / st.att[1]) + '%' : '–'],
    ['Contribution', '€' + euros]];
}

// Draws the card into box (any width; it keeps 16:9). p: what cof_profile_me / cof_admin_profile return.
async function renderScorecard(box, p) {
  const color = p.team?.color ?? SC_PINK, ch = CHARACTERS.find(c => c.id === p.character), seed = p.stats?.seed;
  const ys = [316, 402, 486, 572, 660, 752], xs = [362, 362, 362, 362, 384, 384];
  if (!document.getElementById('scFonts')) document.head.insertAdjacentHTML('beforeend', '<link id="scFonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;800&family=Permanent+Marker&display=swap">');
  box.classList.add('sc');
  box.innerHTML = `<div class="sc-in" style="--c:${color}">
    <img class="sc-bg" alt="">
    ${ch ? `<div class="sc-ch"><img src="hud/characters/${ch.id}.webp" alt="${esc(ch.name)}"><i style="-webkit-mask-image:url(hud/characters/${ch.id}.webp);mask-image:url(hud/characters/${ch.id}.webp)"></i></div>` : ''}
    ${p.team ? `<img class="sc-team" src="${esc(p.team.logo)}" alt="${esc(p.team.prefix)}">` : ''}
    <div class="sc-name">${esc(p.name ?? '')}</div>
    ${seed ? `<div class="sc-rank">${seed}<sup>${scOrd(seed).slice(String(seed).length).toUpperCase()}</sup></div>` : ''}
    ${p.season?.logo ? `<img class="sc-season" src="${esc(p.season.logo)}" alt="">` : ''}
    <a class="sc-stamp" href="${COACHING_URL}" target="_blank" rel="noopener" title="Fighters Academy: the coaching app" aria-label="Open Fighters Academy, the coaching app"></a>
    ${scStats(p).map(([, v], i) => `<div class="sc-v" style="left:${xs[i]}px;top:${ys[i]}px">${esc(String(v))}</div>`).join('')}
    ${(p.titles ?? []).slice(0, 5).map((id, i) => { const t = cofTitle(id); return t ? `<img class="sc-badge" style="left:${46 + i * 92}px" src="hud/titles/${esc(t.id)}.webp" alt="${esc(t.name)}" title="${esc(t.name)}">` : ''; }).join('')}
    <div class="sc-quote">${p.quote ? `“${esc(p.quote)}”` : '“…”'}</div></div>`;
  const fit = () => box.firstElementChild && (box.firstElementChild.style.transform = `scale(${box.clientWidth / 1920})`);
  fit(); (box.scObs ??= new ResizeObserver(fit)).observe(box);
  box.querySelector('.sc-bg').src = await scBackground(color);
}
