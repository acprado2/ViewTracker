window.browser = (function () {
    return window.msBrowser ||
        window.browser ||
        window.chrome;
})();

function updateElement(node, text) {
	while(node.firstChild) {
		node.removeChild(node.firstChild);
	}
	node.appendChild(document.createTextNode(text));	
}

browser.tabs.query({active: true, currentWindow:true}, function(tabs) {
	let url = tabs[0].url;
	let urlPos = url.search('youtube.com/watch\\?v=');
	if (urlPos > 0) {
		let div = document.getElementById('videoNotOnPage');
		div.style.display = 'none';
		
		// Adding 20 here to account for length of 'youtube.com/watch?v='
		let ampersandPos = url.indexOf('&');
		if (ampersandPos >= 0) {
			url = url.substring(urlPos + 20, ampersandPos);
		}
		else {
			url = url.substring(urlPos + 20);
		}
		
		// Communicate with content script
		let port = browser.tabs.connect(tabs[0].id,{name: "extension_request"});
		port.postMessage({db: "viewtracker", url: url}); // send database name
		port.onMessage.addListener(function(msg) {
		  if (msg.result) {
				let minutes = (msg.result.totalTime / 1000) / 60;
					
				// Show the data we found
				updateElement(document.getElementById('views'), msg.result.views);
				updateElement(document.getElementById('to completion'), msg.result.toCompletion);
				updateElement(document.getElementById('total watch time'), Math.floor(minutes));
				updateElement(document.getElementById('average watch time'), Math.floor(minutes / msg.result.views));
		  }
		});
	} 
	else {
		let div = document.getElementById('videoOnPage');
		div.style.display = 'none';
	}
});