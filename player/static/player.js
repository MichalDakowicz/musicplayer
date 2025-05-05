// --- Global Variables & Constants ---
const audioPlayer = document.getElementById('audio-player');
const playPauseButton = document.getElementById('play-pause-button');
// ... (other global variable definitions: seekBar, volumeBar, time displays, cover art, etc.) ...
const mainContent = document.getElementById('main-content'); // Define mainContent globally
const csrfToken = getCsrfToken(); // Get CSRF token once

// --- Utility Functions ---
function getCsrfToken() {
    // Function to get CSRF token from cookies
    // ... (implementation as before) ...
    return null; // Placeholder
}

function formatTime(seconds) {
    // Function to format time
    // ... (implementation as before) ...
    return '0:00'; // Placeholder
}

// --- AJAX Content Loading ---
async function loadContent(url, pushState = true) {
    console.log(`Attempting to load content from: ${url}`);
    // const mainContent = document.getElementById('main-content'); // Use global mainContent
    if (!mainContent) {
        console.error("Main content container #main-content not found.");
        return;
    }
    mainContent.innerHTML = '<p style="text-align: center; padding: 40px;">Loading...</p>';

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        mainContent.innerHTML = html;

        if (pushState) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            // Attempt to find title within the loaded fragment
            const titleTag = tempDiv.querySelector('title'); // More specific query
            const pageTitle = titleTag ? titleTag.textContent.trim() : document.title; // Fallback to current title

            document.title = pageTitle;
            history.pushState({ path: url }, pageTitle, url);
            console.log(`Pushed state: ${url}, Title: ${pageTitle}`);
        }

        // Re-initialize dynamic listeners if necessary (e.g., if loadContent replaces part of the page with new buttons)
        // setupDynamicEventListeners(); // Example call if needed

    } catch (error) {
        console.error('Failed to load content:', error);
        mainContent.innerHTML = `<p style="text-align: center; padding: 40px; color: var(--spotify-green);">Sorry, couldn't load this page (${error.message}). Please try again later.</p>`;
    }
}

// Function to handle AJAX link clicks
function handleAjaxLinkClick(event, ajaxLink) {
    event.preventDefault();
    const url = ajaxLink.dataset.targetUrl || ajaxLink.href;
    console.log(`AJAX link clicked: ${url}`); // Add log
    loadContent(url); // Call the globally defined loadContent
}

// Handle back/forward navigation
window.addEventListener('popstate', (event) => {
    console.log("Popstate event:", event.state); // Log popstate event
    if (event.state && event.state.path) {
        loadContent(event.state.path, false); // Load content without pushing state again
    } else {
        // Fallback for initial page load or states without path
        // Consider reloading the initial path or home page
        // Example: loadContent(window.location.pathname, false);
        console.log("Popstate event without state path, potentially initial load or manual URL change.");
    }
});


// --- Audio Playback Functions ---
function playSong(songData) {
    // ... (implementation as before) ...
}

function pauseSong() {
    // ... (implementation as before) ...
}

function updatePlayerUI(songData) {
    // ... (implementation as before) ...
}

function updateSeekTime() {
    // ... (implementation as before) ...
}

function updateVolumeIcon(volume) {
    // ... (implementation as before) ...
}

// --- Queue Management Functions ---
async function fetchQueue() {
    // ... (implementation as before) ...
}

function renderQueue(queueData) {
    // ... (implementation as before) ...
}

async function addToQueue(songId) {
    // ... (implementation as before) ...
}

async function removeFromQueue(itemId, listItemElement) {
    // ... (implementation as before) ...
}

async function getNextSong() {
    // ... (implementation as before) ...
}

async function getPreviousSong() {
    // ... (implementation as before) ...
}

async function setCurrentlyPlaying(songId, clearQueue = false) {
    // ... (implementation as before) ...
}

async function addMultipleToQueue(songIds) {
    // ... (implementation as before) ...
}

// --- Release Playback/Queue Functions ---
function playRelease(songIds) {
    // ... (implementation as before) ...
}

function addReleaseToQueue(songIds) {
    // ... (implementation as before) ...
}

// --- Lyrics Functions ---
async function fetchLyrics(songId) {
    // ... (implementation as before) ...
}

function displayLyrics(lyricsData) {
    // ... (implementation as before) ...
}
// ... (other lyrics functions: toggleLyricsModal, setupLyricsEditing, saveLyrics, etc.) ...

// --- Library Functions ---
async function addToLibrary(mediaType, mediaId, buttonElement) {
    // ... (implementation as before) ...
}


// --- Event Listeners Setup ---
// This function now only *attaches* listeners. The handlers (like handleAjaxLinkClick) are defined above.
function setupEventListeners() {
    // Player Controls
    playPauseButton.addEventListener('click', () => {
        if (audioPlayer.paused) {
            audioPlayer.play();
        } else {
            audioPlayer.pause();
        }
    });

    // ... (listeners for seek bar, volume bar, next, previous buttons) ...

    // Audio Element Events
    audioPlayer.addEventListener('play', () => {
        // ... (update play/pause icon) ...
    });
    audioPlayer.addEventListener('pause', () => {
        // ... (update play/pause icon) ...
    });
    audioPlayer.addEventListener('timeupdate', updateSeekTime);
    audioPlayer.addEventListener('loadedmetadata', () => {
        // ... (update duration display) ...
    });
    audioPlayer.addEventListener('ended', getNextSong); // Play next song when current ends

    // Event Delegation for dynamically loaded content
    document.body.addEventListener('click', async (event) => {
        const target = event.target;
        const playButton = target.closest('.play-button');
        const addQueueButton = target.closest('.add-queue-button');
        const ajaxLink = target.closest('.ajax-link'); // Check for AJAX link
        const addLibraryButton = target.closest('.add-library-button');
        const removeQueueButton = target.closest('.remove-queue-button');
        const playAllButton = target.closest('.play-all-button');
        const addAllQueueButton = target.closest('.add-all-queue-button');
        // ... (other delegated targets like lyrics buttons) ...

        if (playButton) {
            // ... (logic to get song data and call playSong or setCurrentlyPlaying) ...
        } else if (addQueueButton) {
            // ... (logic to get song ID and call addToQueue) ...
        } else if (ajaxLink) {
            // Call the globally defined handler
            handleAjaxLinkClick(event, ajaxLink);
        } else if (addLibraryButton && !addLibraryButton.disabled) {
            // ... (logic to get media type/id and call addToLibrary) ...
        } else if (removeQueueButton && !removeQueueButton.disabled) {
             // ... (logic to get item ID and call removeFromQueue) ...
        } else if (playAllButton) {
            // ... (logic to get song IDs and call playRelease) ...
        } else if (addAllQueueButton) {
            // ... (logic to get song IDs and call addReleaseToQueue) ...
        }
        // ... (other delegated event handling) ...
    });

    // Modal Toggles & Closures
    // ... (listeners for queue toggle, lyrics toggle, close buttons) ...

    console.log("Core event listeners attached.");
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // Cache DOM elements (ensure all elements exist before caching)
    // Example: const seekBar = document.getElementById('seek-bar');
    // ... cache other necessary elements ...

    // Setup initial state
    updateVolumeIcon(audioPlayer.volume);
    // ... any other initial UI setup ...

    // Attach event listeners
    setupEventListeners(); // Call the setup function

    // Fetch initial data
    fetchQueue();

    // Store the initial path for popstate handling
    // Note: Ensure this runs *after* potential initial content load if using server-side rendering + AJAX
    // history.replaceState({ path: window.location.pathname }, document.title, window.location.pathname);
    // console.log(`Initial state set for path: ${window.location.pathname}`);


    console.log("Player Initialized");
});
