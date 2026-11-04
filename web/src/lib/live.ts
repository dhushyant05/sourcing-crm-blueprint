/** Bell sound + desktop notifications for real-time alerts. Browsers block audio until the user interacts, so we unlock on the first click/key. */
let audio: HTMLAudioElement | null = null, unlocked = false;
const PERM_KEY = 'se.notifPermAsked';
export function setupAlerts() {
  if (typeof window === 'undefined' || unlocked) return;
  const unlock = () => {
    if (unlocked) return; unlocked = true;
    audio = new Audio('/sounds/bell.wav'); audio.preload = 'auto'; audio.volume = 0;
    audio.play().then(() => { audio!.pause(); audio!.currentTime = 0; audio!.volume = 0.8; }).catch(() => { if (audio) audio.volume = 0.8; });
    // Ask for desktop-notification permission once, from a user gesture.
    if ('Notification' in window && Notification.permission === 'default' && !localStorage.getItem(PERM_KEY)) {
      localStorage.setItem(PERM_KEY, '1'); void Notification.requestPermission().catch(() => {});
    }
    removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true);
  };
  addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
}
export function playBell() {
  if (!audio) return;
  try { audio.currentTime = 0; void audio.play().catch(() => {}); } catch { /* ignore */ }
}
export function desktopNotify(title: string, body: string, tag: string, onClick: () => void) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/brand/mark.png', silent: true });
    n.onclick = () => { window.focus(); onClick(); n.close(); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}
