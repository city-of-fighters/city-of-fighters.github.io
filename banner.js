// Winner banner (1200×630) and the email that sends it to the champion when a tournament is decided.
// The email itself goes out from the server (supabase/functions/cof-winner-email); emails never reach this page.
const MAIL_URL = 'https://glqxyghdcindimggnwml.supabase.co/functions/v1/cof-winner-email';
const bannerLogo = new Image();
bannerLogo.src = 'logo-clear.png';

const champPhoto = async r => {
  const src = r.id && await rpc('cof_photo', { p_id: r.id }).catch(() => null);
  if (!src) return null;
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img, () => null);
};

async function drawBanner(canvas, s, champs) {
  await bannerLogo.decode().catch(() => {});
  const photos = (await Promise.all(champs.map(champPhoto))).filter(Boolean);
  const c = canvas.getContext('2d'), W = 1200, H = 630, F = 'Arial Black, Impact, sans-serif', X = 830;
  c.fillStyle = '#0e0e10'; c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(X, 300, 0, X, 300, 520);
  glow.addColorStop(0, '#ffd24a33'); glow.addColorStop(1, '#ffd24a00');
  c.fillStyle = glow; c.fillRect(0, 0, W, H);
  c.save(); c.translate(X, 300); // light rays behind the name
  for (let i = 0; i < 24; i++) { c.rotate(Math.PI / 12); c.fillStyle = i % 2 ? '#ffd24a0d' : '#ff0a6c0a'; c.beginPath(); c.moveTo(0, 0); c.lineTo(900, -70); c.lineTo(900, 70); c.fill(); }
  c.restore();
  const logoBox = photos.length ? [180, 28, 170, 112] : [30, 150, 470, 310];
  if (bannerLogo.naturalWidth) { c.shadowColor = '#ff0a6c'; c.shadowBlur = 30; c.drawImage(bannerLogo, ...logoBox); c.shadowBlur = 0; }
  const size = Math.min(420, 450 / photos.length - 10); // tied champions share the space
  photos.forEach((img, i) => {
    const x = 265 - (photos.length * (size + 10) - 10) / 2 + i * (size + 10), y = 370 - size / 2, crop = Math.min(img.naturalWidth, img.naturalHeight);
    c.drawImage(img, (img.naturalWidth - crop) / 2, 0, crop, crop, x, y, size, size); // from the top, so tall portraits keep the head
    c.strokeStyle = '#ffd24a'; c.lineWidth = 5; c.strokeRect(x, y, size, size);
  });
  c.strokeStyle = '#ffd24a'; c.lineWidth = 6; c.strokeRect(14, 14, W - 28, H - 28);
  const text = (t, y, font, color, blur = 0) => {
    c.font = font; c.fillStyle = color; c.textAlign = 'center'; c.shadowColor = color; c.shadowBlur = blur;
    c.fillText(t, X, y, 680); c.shadowBlur = 0;
  };
  const r = champs[0], pts = s.format === 'robin' || s.format === 'swiss';
  text('🏆 TOURNAMENT CHAMPION', 150, `30px ${F}`, '#3cc9d4', 10);
  text(champs.map(x => x.name).join(' & ').toUpperCase(), 280, `italic 96px ${F}`, '#ffd24a', 30);
  text(`${s.name} · ${s.game}`, 360, 'bold 34px system-ui, sans-serif', '#ffffff');
  text(new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }), 410, '28px system-ui, sans-serif', '#c9c9d1');
  text(pts ? `${r.pts} points · games ${r.gw}–${r.gl}` : `${r.w}–${r.l} in matches · games ${r.gw}–${r.gl}`, 470, '28px system-ui, sans-serif', '#c9c9d1');
  text(`${s.players.length} players · City of Fighters`, 560, '24px system-ui, sans-serif', '#9d9daa');
}

// Control panel "Send test email": a sample banner to any address, to prove Gmail is connected.
async function mailTest(to) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 630;
  await drawBanner(canvas, { format: 'double', name: 'Test Tournament', game: 'Tekken 8', players: new Array(16) }, [{ name: 'Champion', w: 5, l: 0, gw: 10, gl: 2 }]);
  const r = await fetch(MAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: JSON.stringify({ token, test: to, image: canvas.toDataURL('image/jpeg', 0.9) }) }).catch(() => null);
  if (!r || r.status === 404) throw new Error('Winner email is not set up yet');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Email failed (${r.status})`);
}

// Sends the banner to the champion(s). force = send again even if it was already sent for this tournament.
async function mailWinner(force = false) {
  const champs = S.standings.filter(r => r.place === 1);
  if (!S.finished || !champs.length) throw new Error('The tournament is not finished yet');
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 630;
  await drawBanner(canvas, S, champs);
  const r = await fetch(MAIL_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: JSON.stringify({ token, players: champs.map(x => x.id), image: canvas.toDataURL('image/jpeg', 0.9), force }),
  }).catch(() => null);
  if (!r || r.status === 404) throw new Error('Winner email is not set up yet (see the README)');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Email failed (${r.status})`);
  return d.sent;
}
