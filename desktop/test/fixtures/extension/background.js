// Extension d'essai : badge et entrée de menu contextuel, posés dès le démarrage du service worker.
function setup() {
  chrome.action.setBadgeText({ text: '3' });
  chrome.action.setBadgeBackgroundColor({ color: '#E06A1B' });
  if (chrome.contextMenus) chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: "qafila-test", title: "Essai Qafila", contexts: ["page"] }));
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
setup();
