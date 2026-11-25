// Player Profile scorecard (Joseph's design, 1920×1080, shown scaled to fit). Needs api.js (esc) and titles.js (cofTitle).
// Its fonts load the first time a card is drawn: Montserrat 600/800, and Brushline (Lettersiro) for the rank, cut down to digits and st/nd/rd/th.
const CHARACTERS = ['Alisa', 'Anna', 'Armor King', 'Asuka', 'Azucena', 'Bob', 'Bryan', 'Claudio', 'Clive', 'Devil Jin', 'Dragunov', 'Eddy',
  'Fahkumram', 'Feng', 'Heihachi', 'Hwoarang', 'Jack-8', 'Jin', 'Jun', 'Kazuya', 'King', 'Kuma', 'Kunimitsu', 'Lars', 'Law', 'Lee', 'Leo', 'Leroy',
  'Lili', 'Lidia', 'Miary Zo', 'Nina', 'Panda', 'Paul', 'Raven', 'Reina', 'Roger Jr.', 'Shaheen', 'Steve Fox', 'Victor', 'Xiaoyu', 'Yoshimitsu', 'Zafina']
  .map(name => ({ name, id: name === 'Steve Fox' ? 'steve' : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }));
// Each character picture's outline: [picture width, x, y, width, height of the drawn part] in the 1000-px-tall picture.
// Every character is placed the same way from it: forehead behind SCORECARD, belly button at the bottom edge.
const CHAR_BOX = {
  'alisa': [750, 93, 17, 557, 918], 'anna': [541, 20, 6, 501, 983], 'armor-king': [1023, 207, 5, 810, 983], 'asuka': [750, 205, 23, 383, 969], 'azucena': [750, 203, 24, 378, 958], 'bob': [983, 359, 0, 624, 987], 'bryan': [750, 191, 19, 415, 968], 'claudio': [750, 94, 13, 562, 967], 'clive': [750, 111, 0, 527, 982], 'devil-jin': [1474, 1, 5, 1470, 995], 'dragunov': [750, 166, 18, 489, 966], 'eddy': [750, 161, 14, 440, 973], 'fahkumram': [750, 177, 17, 485, 969], 'feng': [750, 93, 115, 565, 864], 'heihachi': [733, 36, 2, 697, 992], 'hwoarang': [750, 94, 13, 471, 975], 'jack-8': [750, 93, 26, 564, 948], 'jin': [750, 199, 15, 401, 966], 'jun': [750, 219, 12, 438, 971], 'kazuya': [750, 150, 16, 454, 969], 'king': [750, 92, 33, 565, 933], 'kuma': [750, 132, 62, 522, 924], 'kunimitsu': [750, 96, 7, 558, 981], 'lars': [750, 93, 26, 565, 963], 'law': [750, 158, 35, 500, 865], 'lee': [750, 93, 31, 563, 868], 'leo': [750, 128, 6, 459, 988], 'leroy': [750, 147, 26, 509, 961], 'lidia': [875, 27, 5, 842, 991], 'lili': [750, 171, 19, 412, 958], 'miary-zo': [750, 137, 17, 490, 970], 'nina': [518, 0, 0, 518, 1000], 'panda': [750, 94, 74, 561, 909], 'paul': [750, 108, 14, 473, 973], 'raven': [750, 94, 43, 562, 791], 'reina': [498, 0, 3, 498, 997], 'roger-jr': [983, 351, 0, 632, 987], 'shaheen': [750, 93, 23, 544, 947], 'steve': [750, 94, 16, 562, 954], 'victor': [750, 111, 23, 532, 964], 'xiaoyu': [750, 211, 24, 404, 962], 'yoshimitsu': [750, 94, 21, 563, 810], 'zafina': [750, 165, 20, 492, 832],
};
// Where each character's forehead and belly button are, as a share of the outline's height (measured on the pictures:
// raised arms, horns, wings and crouches put them in different places).
const CHAR_FIX = { 'alisa': [0.08, 0.38], 'anna': [0.05, 0.36], 'armor-king': [0.06, 0.4], 'asuka': [0.06, 0.36], 'azucena': [0.04, 0.33], 'bob': [0.07, 0.4], 'bryan': [0.03, 0.37], 'claudio': [0.04, 0.4], 'clive': [0.05, 0.4], 'devil-jin': [0.12, 0.4], 'dragunov': [0.04, 0.38], 'eddy': [0.04, 0.4], 'fahkumram': [0.06, 0.4], 'feng': [0.12, 0.45], 'heihachi': [0.15, 0.45], 'hwoarang': [0.16, 0.38], 'jack-8': [0.07, 0.42], 'jin': [0.03, 0.38], 'jun': [0.04, 0.37], 'kazuya': [0.03, 0.37], 'king': [0.03, 0.42], 'kuma': [0.07, 0.45], 'kunimitsu': [0.05, 0.33], 'lars': [0.04, 0.45], 'law': [0.05, 0.45], 'lee': [0.05, 0.45], 'leo': [0.04, 0.36], 'leroy': [0.04, 0.4], 'lidia': [0.06, 0.45], 'lili': [0.03, 0.33], 'miary-zo': [0.04, 0.38], 'nina': [0.03, 0.36], 'panda': [0.06, 0.5], 'paul': [0.04, 0.38], 'raven': [0.04, 0.45], 'reina': [0.04, 0.37], 'roger-jr': [0.14, 0.48], 'shaheen': [0.05, 0.45], 'steve': [0.05, 0.4], 'victor': [0.03, 0.37], 'xiaoyu': [0.04, 0.38], 'yoshimitsu': [0.08, 0.45], 'zafina': [0.05, 0.4] };
function charFit(id) {
  const [iw, x, y, w, h] = CHAR_BOX[id] ?? [750, 0, 0, 750, 1000], [ft, fn] = CHAR_FIX[id] ?? [0.03, 0.42];
  const s = (1080 - 300) / ((fn - ft) * h); // forehead at y 300 (behind the word), belly button at 1080
  return `left:${Math.round(1010 - (x + w / 2) * s)}px;top:${Math.round(300 - (y + ft * h) * s)}px;width:${Math.round(iw * s)}px;height:${Math.round(1000 * s)}px`;
}
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

// The background, and the SCORECARD word and the stamp drawn again over the character, are pink (#bf016d): every pink pixel takes the team colour,
// keeping how light or dark it was; greys stay grey.
const scBgCache = new Map();
function scBackground(color, src = 'hud/scorecard-bg.webp') {
  const key = color + src;
  if (!scBgCache.has(key)) scBgCache.set(key, new Promise((ok, fail) => {
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
      ok(src.endsWith('-bg.webp') ? c.toDataURL('image/jpeg', 0.88) : c.toDataURL('image/png')); // the word and the stamp keep their see-through background
    };
    img.onerror = fail; img.src = src;
  }));
  return scBgCache.get(key);
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
  if (!document.getElementById('scFonts')) document.head.insertAdjacentHTML('beforeend', '<link id="scFonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;800&display=swap">');
  box.classList.add('sc');
  box.innerHTML = `<div class="sc-in" style="--c:${color}">
    <img class="sc-bg" alt="">
    ${ch ? `<div class="sc-clip"><div class="sc-ch" style="${charFit(ch.id)}"><img src="hud/characters/${ch.id}.webp" alt="${esc(ch.name)}"><i style="-webkit-mask-image:url(hud/characters/${ch.id}.webp);mask-image:url(hud/characters/${ch.id}.webp)"></i></div></div>` : ''}
    <img class="sc-word" alt=""><img class="sc-stampimg" alt="">
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
  const [bg, word, stamp] = await Promise.all(['hud/scorecard-bg.webp', 'hud/scorecard-word.webp', 'hud/scorecard-stamp.webp'].map(src => scBackground(color, src)));
  box.querySelector('.sc-bg').src = bg; box.querySelector('.sc-word').src = word; box.querySelector('.sc-stampimg').src = stamp;
}
