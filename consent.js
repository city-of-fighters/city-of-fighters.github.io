// First visit: explain what the app keeps on this device and let the visitor choose, like Iron Fist Academy.
// The choice itself is always remembered (see canSave() in api.js), so it is asked only once.
(() => {
  if (consentChoice()) return;
  const box = document.createElement('div');
  box.id = 'consent';
  box.innerHTML = `<div class="consent-in" role="dialog" aria-modal="true" aria-labelledby="consentTitle">
    <img src="logo-clear.png" alt="" style="width:180px;display:block;margin:0 auto 6px">
    <h2 id="consentTitle" style="text-align:center">Welcome to City of Fighters</h2>
    <p>No accounts, no cookies, no ads and no tracking. Anyone can watch the leaderboard.</p>
    <ul>
      <li><b>If you register</b> for a tournament, your gamer tag is shown publicly and your email is seen only by the organizers.
        It is used to contact you about the tournament and to email you a winner banner if you win.</li>
      <li><b>On this device</b> the app can remember a few things: an organizer's login, and small settings like hidden tips.</li>
    </ul>
    <p class="dim" style="font-size:13px">Read the <a href="privacy.html">privacy policy</a> and <a href="terms.html">terms</a>.</p>
    <div class="row" style="justify-content:center">
      <button class="primary" data-c="all">Allow saving</button>
      <button data-c="none">Don't save anything</button>
    </div>
    <p class="dim" style="font-size:12px;text-align:center;margin-bottom:0">With “Don't save anything” the app still works; organizers just log in again each visit. Change it any time on the privacy page.</p>
  </div>`;
  box.addEventListener('click', e => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (!c) return;
    try { localStorage.setItem('cofConsent', c); } catch {}
    box.remove();
  });
  const show = () => document.body.appendChild(box);
  document.body ? show() : addEventListener('DOMContentLoaded', show);
})();
