// Offscreen worker for heavy operations
// This runs in a separate context to avoid blocking the service worker

let commandQueue = [];
let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'offscreen') {
    handleOffscreenCommand(message).then(sendResponse);
    return true; // async response
  }
});

async function handleOffscreenCommand(message) {
  const { type, data } = message;
  
  try {
    switch (type) {
      case 'batchProcess':
        return await batchProcess(data);
      case 'heavyComputation':
        return await heavyComputation(data);
      case 'domParsing':
        return await domParsing(data);
      default:
        return { error: 'Unknown command type' };
    }
  } catch (error) {
    return { error: error.message };
  }
}

async function batchProcess(items) {
  // Process items in batches to avoid blocking
  const batchSize = 50;
  const results = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => processItem(item))
    );
    results.push(...batchResults);
    
    // Yield to prevent blocking
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return { results };
}

async function processItem(item) {
  // Simulate processing - replace with actual logic
  return { processed: true, item };
}

async function heavyComputation(data) {
  // Handle heavy computations here
  return { result: data };
}

async function domParsing(data) {
  // Use DOMParser for parsing operations
  const parser = new DOMParser();
  const doc = parser.parseFromString(data.html, 'text/html');
  return { title: doc.title, content: doc.body.textContent };
}
