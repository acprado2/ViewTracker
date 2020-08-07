window.browser = (function () {
    return window.msBrowser ||
        window.browser ||
        window.chrome;
})();


let video = document.querySelector('video');
let url = '';
let isFirstPlay = false;
let isLoaded = false;
let watchTime = 0.0;
let playStart = 0.0;
let pauseStart = 0.0;
let duration = 0.0;

// Make sure we only add video event listeners one time
let isListening = false;

function connected(port) {
	if(port.name == "extension_request" ) {
		port.onMessage.addListener(function(msg) {
			if (msg.db) {
				let db
				let request = indexedDB.open(msg.db, 1);
				
				// Create database
				request.onupgradeneeded = function(event) {
					db = event.target.result;
					
					let objectStore = db.createObjectStore('videoData', {keyPath: 'url'});
					objectStore.createIndex('views', 'views', {unique:false});
					objectStore.createIndex('toCompletion', 'toCompletion', {unique:false});
					objectStore.createIndex('totalTime', 'totalTime', {unique:false});
				};

				// Open database
				request.onsuccess = function(event) {
					db = event.target.result;
					
					let tx = db.transaction(['videoData'], 'readwrite');
					let store = tx.objectStore('videoData');
					let query = store.get(msg.url);
					
					query.onsuccess = function(event) {
						if (query.result) {
							// Send the db result to the extension script
							port.postMessage({result: query.result});
						}
						else {
							// Send a blank message if this query somehow doesn't exist
							port.postMessage({result: {url: msg.url, views: 0, toCompletion: 0, totalTime: 0}});
						} 
					};
				};
			}
		});
	}
}

function didWatchToCompletion() {
	// Floor this to account for roundings inaccuracies
	if (Math.floor(watchTime / 1000) >= Math.floor(duration)) {
		// Video was watched to completion
		return true;
	}
	return false;
}

function onLoad() {
	// Store the old url in case this is a new video loading
	let prevUrl = url;
	
	// Get unique url for video
	url = window.location.href;
	let urlPos = url.search('youtube.com/watch\\?v=');
	let ampersandPos = url.indexOf('&');

	// Adding 20 here to account for length of 'youtube.com/watch?v='
	if (urlPos > 0) {
		if (ampersandPos >= 0) {
			url = url.substring(urlPos + 20, ampersandPos);
		}
		else {
			url = url.substring(urlPos + 20);
		}
	}
	
	// Check if we're coming from a different video
	if (url !== prevUrl && prevUrl !== '') {
		let isToCompletion = onUnload();
		
		// Store current info to db
		updateVideoData(prevUrl, 0, isToCompletion ? 1: 0, watchTime);
	}
	
	// Don't load twice
	if (isLoaded) {
		return;
	}

	// First play has to be tracked manually
	isFirstPlay = true;

	// Timer to track video runtime
	watchTime = 0.0;
	playStart = 0.0;
	pauseStart = 0.0;
	
	isLoaded = true;
}

// Handler for when video or page gets unloaded
function onUnload() {
	// If video is still playing figure out the watch time
	if (pauseStart < playStart) {
		watchTime += Date.now() - playStart;
	}
	isLoaded = false;
	
	// Shouldn't really return this in onUnload but it'll save some more awful bloat
	return didWatchToCompletion();
}

// Create or update video data for a url
function updateVideoData(url, views, toCompletion, totalTime) {
	// IndexedDB
	let db
	let request = indexedDB.open('viewtracker', 1);
	
	// Create database
	request.onupgradeneeded = function(event) {
		db = event.target.result;
		
		let objectStore = db.createObjectStore('videoData', {keyPath: 'url'});
		objectStore.createIndex('views', 'views', {unique:false});
		objectStore.createIndex('toCompletion', 'toCompletion', {unique:false});
		objectStore.createIndex('totalTime', 'totalTime', {unique:false});
	};

	// Open database
	request.onsuccess = function(event) {
		db = event.target.result;
		
		let tx = db.transaction(['videoData'], 'readwrite');
		let store = tx.objectStore('videoData');
		let query = store.get(url);
		
		query.onsuccess = function(event) {
			// Update existing entry
			if (query.result) {
				store.put({url: query.result.url, 
						   views: query.result.views + views, 
						   toCompletion: query.result.toCompletion + toCompletion, 
						   totalTime: query.result.totalTime + totalTime});
			}
			else {
				// New entry
				store.add({url: url, views: views, toCompletion: toCompletion, totalTime: totalTime});
			} 
		};
	};
}

// Video event listeners
function onVideoElementLoad() {
	if (!video || isListening) {
		return;
	}
	
	video.addEventListener('durationchange', function(event) {
		// Update the duration
		duration = video.duration;
	});

	// Video player has unloaded
	video.addEventListener('abort', function(event) {
		let isToCompletion = onUnload();
		// Store current info to db
		updateVideoData(url, 0, isToCompletion ? 1: 0, watchTime);
		url = '';
		duration = 0.0;
	});

	video.addEventListener('pause', function(event) {
		// Math how long the video was watched for
		watchTime += Date.now() - playStart;
		pauseStart = Date.now();
		
		// Often users won't loop the video so we can catch that here
		if (video.currentTime === video.duration) {
			updateVideoData(url, 0, didWatchToCompletion() ? 1 : 0, watchTime);
			
			watchTime = 0.0;
		}
	});

	video.addEventListener('play', function(event) {
		// YouTube apparently will sometimes autoplay before the video has even loaded(!) so
		// we have to do some dumb hacky shit to work around this
		if (video.currentTime === 0) {
			onLoad();
		}
		
		// Store time video starts playing
		playStart = Date.now();
		
		if (isFirstPlay) {
			updateVideoData(url, 1, 0, 0.0);
			isFirstPlay = false;
		}
	});

	video.addEventListener('seeked', function(event) {
		if (video.currentTime === 0) {
			// Video has looped
			let isToCompletion = false;
			
			// Check in case the video ended normally before looping	
			if (pauseStart < playStart) {
				watchTime += Date.now() - playStart;
				
				// Floor this to account for roundings inaccuracies
				if (didWatchToCompletion()) {
					isToCompletion = true;
				}
			}

			updateVideoData(url, 1, isToCompletion ? 1 : 0, watchTime);
			watchTime = 0.0;
			playStart = Date.now(); 
		}
	});
	
	isListening = true;
}


// Check if there's something in localStorage to input into the db
let item = window.localStorage.getItem('data');
if (item) {
	let data = JSON.parse(item);
	updateVideoData(data.url, data.views, data.toCompletion, data.totalTime);
	
	// Remove data from localStorage
	window.localStorage.removeItem('data');
}

onVideoElementLoad();

// Check for page state changes in case we haven't gotten the video element yet
document.addEventListener('transitionend', function(event) {
    if (event.target.id === 'progress') {
        if (!video) {
			video = document.querySelector('video');
			onVideoElementLoad();
		}
	}
});

// Save data when closing window 
window.addEventListener('unload', function(event) {
	// Check that there's actually something to store
	if (url.length > 0 && video ) {
		let isToCompletion = onUnload();
		
		// Hacky hack: We're gonna save this localStorage and put it into the db later
		// since async calls aren't gonna work 
		let data = {url: url, views: 0, toCompletion: isToCompletion ? 1: 0, totalTime: Math.max(watchTime, 0.0)}
		let str = JSON.stringify(data);
		window.localStorage.setItem('data', JSON.stringify(data));
	}
});

// Allow communication between popup and content script
browser.runtime.onConnect.addListener(connected);