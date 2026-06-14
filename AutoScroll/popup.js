document.getElementById("startScroll").addEventListener("click", () => {
  const scrollValue = document.getElementById("scrollValue").value;
  if (scrollValue) {
    chrome.storage.local.set({ scrollValue: parseInt(scrollValue, 10) });
    chrome.scripting.executeScript({
      target: {
        tabId: chrome.tabs.query(
          { active: true, currentWindow: true },
          (tabs) => tabs[0].id
        ),
      },
      function: startScrolling,
    });
  }
});

document.getElementById("stopScroll").addEventListener("click", () => {
  chrome.scripting.executeScript({
    target: {
      tabId: chrome.tabs.query(
        { active: true, currentWindow: true },
        (tabs) => tabs[0].id
      ),
    },
    function: stopScrolling,
  });
});

function startScrolling() {
  chrome.storage.local.get("scrollValue", ({ scrollValue }) => {
    if (scrollValue) {
      document.body.dataset.scrollInterval = setInterval(() => {
        window.scrollBy(0, scrollValue);
      }, 100);
    }
  });
}

function stopScrolling() {
  if (document.body.dataset.scrollInterval) {
    clearInterval(document.body.dataset.scrollInterval);
    delete document.body.dataset.scrollInterval;
  }
}
