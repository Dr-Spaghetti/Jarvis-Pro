chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-panel") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "toggle" }, () => {
      // Suppress "no receiver" errors on chrome:// pages where content scripts can't inject
      void chrome.runtime.lastError;
    });
  });
});
