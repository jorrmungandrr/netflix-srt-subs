const DEBUG = true;

/**
 * Gets the time into the video in seconds.
 */
function getTimeInVideo(videoId) {
	// https://stackoverflow.com/a/42047162/1968462
	let video = document.evaluate(`//*[@id="${videoId}"]/video`, document).iterateNext();
	if(video) {
		return video.currentTime;
	}
	else {
		return null;
	}
}

// https://stackoverflow.com/a/35385518/1968462
function htmlToElement(html) {
	let template = document.createElement('template');
	html = html.trim(); // Never return a text node of whitespace as the result
	template.innerHTML = html;
	return template.content.firstChild;
}

/**
 * Displays a file picker to select an SRT file. This must be done since browser
 * actions will close the moment a file picker is opened, which makes it impossible
 * to have any interaction at all.
 */
function displaySrtFilePicker() {
	let videoId = getVideoId();
	if(videoId === null) return;

	// Remove if existing
	let existingElement = document.getElementById('netflix-srt-subs-main-box');
	if(existingElement) {
		existingElement.outerHTML = '';
	}

	// TODO: Make this auto-hide
	let html = htmlToElement(`<div style="position: fixed; top: 0; left: 0; background-color: white;
			color: black; z-index: 1; padding: 0.25em;"
			class="netflix-srt-subs-main-box">
			Load subs:
			<input type="file" id="netflix-srt-subs-file-picker" style="display: none;">
			<input type="button" value="Browse..." onclick="document.getElementById('netflix-srt-subs-file-picker').click();">
		</div>`);
	document.body.appendChild(html);

	let fileInput = document.getElementById('netflix-srt-subs-file-picker');
	fileInput.addEventListener('change', () => {
		var file = fileInput.files[0];
		if(file) {
			if(DEBUG) console.log(`Netflix SRT subs loading file ${file}`);
			var reader = new FileReader();
			reader.readAsText(file, "UTF-8");
			reader.onload = (ev) => {
				let fileContents = ev.target.result;

				displaySubs(videoId, fileContents)
			};
			reader.onerror = () => {
				// TODO: handle nicely
				console.log(` Netflix SRT subs error occurred reading file ${file}`)
			};
		}
		else {
			if(DEBUG) console.log('Netflix SRT subs no file selected');
		}
	});
}

/**
 * Gets the video ID. This is necessary to get the video element.
 */
function getVideoId() {
	// Get the URL without any query parameters or anchors
	let url = window.location.href;
	url = url.split('?')[0];
	url = url.split('#')[0]; // In case there is no query parameters

	// URL is, eg, https://www.netflix.com/watch/70136341 -- want the 70136341
	let urlSplitOnSlash = url.split('/');
	let videoId = urlSplitOnSlash[urlSplitOnSlash.length - 1];

	if(DEBUG) console.log(`Netflix SRT subs URL: ${url} Video ID: ${videoId}`);

	// We seem to be on a video page
	if(videoId.match(/\d+/)) {
		if(DEBUG) console.log(`Netflix SRT subs detected this page to be a video (id = ${videoId})`);
		return videoId;
	}
	else {
		return null;
	}
}

function displaySubs(videoId, srtContents) {
	let subs = getSubtitleRecords(srtContents);
	subs.sort((r1, r2) => r1.from - r2.from); // Sort by from times (so we can efficiently handle overlaps)

	setInterval(() => {
		let time = getTimeInVideo(videoId);
		console.log(time);

		// Dumb approach: just loop through all the records
		let currentSub = '';
		for(let record of subs) {
			if(time >= record['from'] && time <= record['to']) {
				// Deal with merged subs
				if(currentSub !== '') {
					currentSub += '<br>';
				}
				currentSub += record['text'];
			}
		}
		console.log(currentSub);
	}, 100)
}

/**
 * Processes the SRT file to get a list of from times, to times, and their subtitles.
 */
function getSubtitleRecords(srtContents) {
	let subtitleRecords = [];
	let srtLines = srtContents.split(/\r?\n/);
	let fragmentIndex = 1;
	let lineNumber = 0;
	while(lineNumber < srtLines.length) {
		// Parse fragment by fragment
		// We don't need the index, but let's check it as a form of error detection
		let indexLine = srtLines[lineNumber++].trim();
		if(!indexLine.match(/\d+/)) {
			console.log(`Expected fragment index on line ${lineNumber - 1}, but got ${indexLine}`);
			// Just continue, maybe there is no fragment counts?
		}
		else {
			let currentFragmentIndex = parseInt(indexLine);
			if(currentFragmentIndex !== fragmentIndex) {
				console.log(`Expected fragment ${fragmentIndex} but got ${currentFragmentIndex} on line ${lineNumber - 1}`);
				fragmentIndex = currentFragmentIndex; // Maybe this will work?
			}
			else {
				// Found the right one
				fragmentIndex++;
			}
		}

		// Parse timestamps
		let timestampLine = srtLines[lineNumber++].trim();
		if(!timestampLine.includes('-->')) {
			console.log(`Invalid timestamp line. Got: ${timestampLine} on line ${lineNumber - 1}`);
			// No way to go without this, so skip
			continue;
		}
		let fromAndTo = timestampLine.split('-->');
		if(fromAndTo.length !== 2) {
			console.log(`Invalid timestamp line. Got: ${timestampLine} on line ${lineNumber - 1}`);
			continue;
		}
		let fromSeconds = 0;
		let toSeconds = 0;
		try {
			fromSeconds = parseTimeStampToSeconds(fromAndTo[0].trim());
			toSeconds = parseTimeStampToSeconds(fromAndTo[1].trim());
		} catch(ex) {
			console.log(`Invalid timestamp line. Got: ${timestampLine} on line ${lineNumber - 1}. Details: ${ex}`);
			continue;
		}

		// Now parse remaining lines as the subtitle text until we get a blank line
		let subtitleText = '';
		while(true) {
			let line = srtLines[lineNumber++].trim();
			if(line === '') break;
			// Auto add line breaks
			if(subtitleText !== '') {
				subtitleText += '<br>';
			}
			subtitleText += line;
		}

		// We now have a subtitle record!
		subtitleRecords.push({
			'from': fromSeconds,
			'to': toSeconds,
			'text': subtitleText
		});
	}

	return subtitleRecords;
}

/**
 * Like parseInt but raises an error if something goes wrong.
 */
function parseIntOrError(i) {
	let r = parseInt(i);
	if(!isNaN(r)) {
		return r;
	}
	else {
		throw new Error(`Expected int but got ${i}`);
	}
}

/**
 * Timestamps in the form of `hours:minutes:seconds,milliseconds` suck for programming. Convert
 * to a single number of seconds.
 */
function parseTimeStampToSeconds(timestampString) {
	let timestamp = 0;

	// Try and account for weird subs that might be missing hours or milliseconds
	let secondsAndMs = timestampString.split(',');
	if(secondsAndMs.length > 2) {
		throw new Error(`Timestamp ${timestampString} has too many commas`);
	}
	if(secondsAndMs.length === 2) {
		let ms = parseIntOrError(secondsAndMs[1]);
		timestamp += ms / 1000;
	}

	// From the end add seconds * 1, minutes * 60, hours * 60 * 60...
	let timeComponents = secondsAndMs[0].split(':');
	secondsMultiplier = 1;
	for(let i = timeComponents.length - 1; i >= 0; --i) {
		let timeComponent = parseIntOrError(timeComponents[i]);
		timestamp += timeComponent * secondsMultiplier;
		secondsMultiplier *= 60;
	}

	return timestamp;
}

// TODO: make container to display subs in
// TODO: detect when video changes and remove subs
// TODO: strip potentially dangerous HTML
// TODO: allow offsets

displaySrtFilePicker();

if(DEBUG) console.log('Netflix SRT subs active');