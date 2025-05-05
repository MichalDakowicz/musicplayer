document.addEventListener('DOMContentLoaded', function() {
    const audioPlayer = document.getElementById('audio-player');
    const playPauseButton = document.getElementById('play-pause-button');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const seekBar = document.getElementById('seek-bar');
    const currentTimeDisplay = document.getElementById('current-time');
    const durationDisplay = document.getElementById('duration');
    const volumeBar = document.getElementById('volume-bar');
    const currentTrackTitle = document.getElementById('current-track-title');
    const currentTrackArtist = document.getElementById('current-track-artist');
    const playerCoverArt = document.getElementById('player-cover-art');
    const placeholderCoverSrc = playerCoverArt ? playerCoverArt.src : '';
    const mainContent = document.getElementById('main-content');
    // Volume Icon References
    const volumeMuteIcon = document.getElementById('volume-mute-icon');
    const volumeLowIcon = document.getElementById('volume-low-icon');
    const volumeHighIcon = document.getElementById('volume-high-icon');
    const volumeIcons = [volumeMuteIcon, volumeLowIcon, volumeHighIcon];
    const previousButton = document.getElementById('previous-button');
    const nextButton = document.getElementById('next-button');
    const showQueueButton = document.getElementById('show-queue-button');
    const queueModal = document.getElementById('queue-modal');
    const closeQueueButton = document.getElementById('close-queue-button');
    const queueList = document.getElementById('queue-list');
    // --- Lyrics Elements ---
    const lyricsToggleButton = document.getElementById('lyrics-toggle-button');
    const lyricsModal = document.getElementById('lyrics-modal');
    const closeLyricsButton = document.getElementById('close-lyrics-button');
    const lyricsDisplay = document.getElementById('lyrics-display');
    // --- Lyrics Edit/Sync Elements ---
    const lyricsEditArea = document.getElementById('lyrics-edit-area');
    const lyricsActionsDiv = document.querySelector('.lyrics-actions');
    const addLyricsButton = document.getElementById('add-lyrics-button');
    const editLyricsButton = document.getElementById('edit-lyrics-button');
    const syncLyricsButton = document.getElementById('sync-lyrics-button');
    const saveLyricsButton = document.getElementById('save-lyrics-button');
    const cancelEditButton = document.getElementById('cancel-edit-button');
    const startSyncButton = document.getElementById('start-sync-button'); // Note: HTML uses sync-lyrics-button ID for initial sync trigger
    const markSyncLineButton = document.getElementById('mark-sync-line-button');
    const saveSyncButton = document.getElementById('save-sync-button');
    const cancelSyncButton = document.getElementById('cancel-sync-button');

    let isSeeking = false;
    let currentQueueItemId = null;
    let currentSongIdForLyrics = null;
    let currentLrcData = null;
    let currentPlainLyrics = null;
    let isInstrumentalSong = false;
    // --- Sync State ---
    let isSyncing = false;
    let syncData = []; // Stores { index: number, time: number, text: string }
    let currentSyncIndex = -1; // --- MODIFICATION: Start index at -1 for "..." ---

    // Function to get CSRF token
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }
    const csrftoken = getCookie('csrftoken');

    // Function to format time
    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) seconds = 0;
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // Function to update volume icon
    function updateVolumeIcon(volume) {
        volumeIcons.forEach(icon => { if (icon) icon.style.display = 'none'; }); // Hide all first
        if (volume <= 0) { if (volumeMuteIcon) volumeMuteIcon.style.display = 'inline-block'; }
        else if (volume <= 0.5) { if (volumeLowIcon) volumeLowIcon.style.display = 'inline-block'; }
        else { if (volumeHighIcon) volumeHighIcon.style.display = 'inline-block'; }
    }

    // --- Helper Function to Reset Player UI ---
    function resetPlayerUI() {
        console.log("Resetting player UI to default state.");
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.src = '';
            delete audioPlayer.dataset.currentSongId;
        }
        if (playIcon) playIcon.style.display = 'inline-block';
        if (pauseIcon) pauseIcon.style.display = 'none';
        if (seekBar) seekBar.value = 0;
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(0);
        if (durationDisplay) durationDisplay.textContent = formatTime(0);
        if (playerCoverArt) playerCoverArt.src = placeholderCoverSrc;
        if (currentTrackTitle) currentTrackTitle.textContent = 'No track selected';
        if (currentTrackArtist) currentTrackArtist.textContent = '';
        resetLyrics(); // Reset lyrics state and UI
        if (lyricsModal && lyricsModal.classList.contains('visible')) {
            hideLyrics(); // Hide lyrics modal if open
        }
    }

    // --- Function to Remove Song from Queue ---
    async function removeSongFromQueue(itemId) {
        console.log(`Attempting to remove queue item ID: ${itemId}`);
        try {
            const response = await fetch(`/queue/remove/${itemId}/`, {
                method: 'DELETE',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken'),
                    'Content-Type': 'application/json' // Optional, but good practice
                },
            });
            const data = await response.json();
            if (response.ok && data.status === 'success') {
                console.log('Successfully removed item, refreshing queue view...');
                // Refresh the queue view - This call should now work
                fetchQueue();
            } else {
                console.error('Failed to remove item:', data.message);
                // Optionally show an error message to the user
            }
        } catch (error) {
            // --- MODIFICATION START: Log the specific error ---
            console.error('Error removing item from queue:', error);
            // --- MODIFICATION END ---
            // Optionally show an error message to the user
        }
    }

    // --- Helper Function to Create a Single Queue List Item ---
    function createQueueListItem(item) {
        const li = document.createElement('li');
        li.dataset.itemId = item.id; // Use item.id (QueueItem ID)
        li.dataset.songId = item.song_id; // Keep song ID if needed elsewhere

        // Add classes based on state
        if (item.is_playing) {
            li.classList.add('is-playing');
        }
        // Note: 'is-next' class might be less useful now, but keep if needed
        if (item.is_next) {
            // li.classList.add('is-next');
        }

        // Item Info (Title, Artist)
        const itemInfo = document.createElement('span');
        itemInfo.classList.add('item-info');

        const titleSpan = document.createElement('span');
        titleSpan.classList.add('item-title');
        titleSpan.textContent = item.title;
        itemInfo.appendChild(titleSpan);

        const artistSpan = document.createElement('span');
        artistSpan.classList.add('item-artist');
        artistSpan.textContent = item.artist;
        itemInfo.appendChild(artistSpan);

        li.appendChild(itemInfo);

        // Actions (Remove Button)
        const actionsDiv = document.createElement('div');
        actionsDiv.classList.add('actions');

        // --- MODIFICATION START: Style remove button like action-button ---
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        // Inherit general action button styles, add specific class
        removeButton.classList.add('action-button', 'remove-queue-button');
        removeButton.dataset.itemId = item.id; // ID for removal target
        removeButton.title = "Remove from Queue";

        // Use Font Awesome icon
        const removeIcon = document.createElement('i');
        removeIcon.classList.add('fa-solid', 'fa-trash-can'); // Trash can icon
        removeButton.appendChild(removeIcon);

        removeButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent potential parent clicks
            const itemIdToRemove = e.currentTarget.dataset.itemId;
            removeSongFromQueue(itemIdToRemove);
        });
        // --- MODIFICATION END ---

        // --- MODIFICATION START: Disable button if item is playing ---
        if (item.is_playing) {
            removeButton.disabled = true;
            removeButton.title = "Cannot remove currently playing song"; // Update title
        }
        // --- MODIFICATION END ---

        actionsDiv.appendChild(removeButton);
        li.appendChild(actionsDiv);

        // Add file missing indicator if needed
        if (!item.has_file) {
            const missingSpan = document.createElement('span');
            missingSpan.classList.add('file-missing');
            missingSpan.textContent = '(File missing)';
            // Insert before actions for better layout
            li.insertBefore(missingSpan, actionsDiv);
        }

        return li;
    }

    // --- Helper Function to Populate Queue List with Sections ---
    function populateQueueList(queueItems, currentlyPlayingOrder) {
        queueList.innerHTML = ''; // Clear previous items

        if (!queueItems || queueItems.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.classList.add('empty-queue');
            emptyLi.textContent = 'Queue is empty.';
            queueList.appendChild(emptyLi);
            return;
        }

        let playingItemIndex = -1;
        for (let i = 0; i < queueItems.length; i++) {
            if (queueItems[i].order === currentlyPlayingOrder) {
                playingItemIndex = i;
                break;
            }
        }

        // Add "Currently Playing" section if applicable
        if (playingItemIndex !== -1) {
            // --- REVIEW START: Ensure header has no actions ---
            const playingHeader = document.createElement('li');
            playingHeader.classList.add('queue-section-header');
            playingHeader.textContent = 'Now Playing';
            // DO NOT add actions or call createQueueListItem here for the header itself
            queueList.appendChild(playingHeader);
            // Add the actual song item using createQueueListItem
            queueList.appendChild(createQueueListItem(queueItems[playingItemIndex]));
            // --- REVIEW END ---
        }

        // Add "Next Up" section
        const nextUpItems = queueItems.filter(item => item.order > currentlyPlayingOrder);
        if (nextUpItems.length > 0) {
            // --- REVIEW START: Ensure header has no actions ---
            const nextUpHeader = document.createElement('li');
            nextUpHeader.classList.add('queue-section-header');
            nextUpHeader.textContent = 'Next Up';
            // DO NOT add actions or call createQueueListItem here for the header itself
            queueList.appendChild(nextUpHeader);
            // Add the actual song items using createQueueListItem
            nextUpItems.forEach(item => {
                queueList.appendChild(createQueueListItem(item));
            });
            // --- REVIEW END ---
        }

        // Optional: Add "Previously Played" section
        const previouslyPlayedItems = queueItems.filter(item => item.order < currentlyPlayingOrder).reverse(); // Show most recent first
        if (previouslyPlayedItems.length > 0) {
             // --- REVIEW START: Ensure header has no actions ---
            const prevHeader = document.createElement('li');
            prevHeader.classList.add('queue-section-header');
            prevHeader.textContent = 'Previously Played';
             // DO NOT add actions or call createQueueListItem here for the header itself
            queueList.appendChild(prevHeader);
            // Add the actual song items using createQueueListItem
            previouslyPlayedItems.forEach(item => {
                queueList.appendChild(createQueueListItem(item));
            });
             // --- REVIEW END ---
        }
    }

    // --- Helper Function to Refresh Queue Modal if Visible ---
    async function refreshQueueModal() {
        if (queueModal && queueModal.classList.contains('visible')) {
            console.log("Refreshing queue modal content.");
            if (queueList) queueList.innerHTML = '<li class="loading-placeholder">Refreshing queue...</li>';
            try {
                const response = await fetch('/queue/view/');
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                if (data.status === 'success') {
                    populateQueueList(data.queue, data.currently_playing_order);
                } else {
                    throw new Error(data.message || 'Failed to fetch queue data');
                }
            } catch (error) {
                console.error("Error refreshing queue modal:", error);
                if (queueList) queueList.innerHTML = `<li class="empty-queue">Error loading queue: ${error.message}</li>`;
            }
        } else {
             console.log("Queue modal not visible, skipping refresh.");
        }
    }

    // Function to play a specific song
    function playSong(url, title, artist, coverUrl, songId = null) {
        if (!audioPlayer) return;
        console.log(`Playing: ${title} - ${artist} (ID: ${songId})`);
        // Set songId dataset BEFORE fetching lyrics
        if (songId) {
            audioPlayer.dataset.currentSongId = songId; // Store current song ID
        } else {
            delete audioPlayer.dataset.currentSongId; // Remove if no ID
        }
        audioPlayer.src = url;
        audioPlayer.play().catch(e => console.error("Error playing audio:", e));
        // Update UI elements
        if (currentTrackTitle) currentTrackTitle.textContent = title || 'Unknown Title';
        if (currentTrackArtist) currentTrackArtist.textContent = artist || 'Unknown Artist';
        if (playerCoverArt) {
            playerCoverArt.src = coverUrl || placeholderCoverSrc;
        }
        // Icons are updated by 'play' event listener

        // Fetch lyrics for the new song AFTER setting the dataset
        fetchAndDisplayLyrics(songId);
        // Refresh queue after starting playback (to update 'is-playing' status)
        refreshQueueModal();
    }

    // Function to add song to queue via API
    async function addToQueue(songId) {
        console.log(`Adding song ${songId} to queue...`);
        try {
            const response = await fetch(`/queue/add/${songId}/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken }
            });
            if (!response.ok) throw new Error('Failed to add song to queue');
            const data = await response.json();
            console.log('Add to queue response:', data);
            // Optionally show a success message to the user
            // Refresh queue modal if it's open
            refreshQueueModal();
        } catch (error) {
            console.error("Error adding song to queue:", error);
            // Optionally show an error message
        }
    }

    // Function to get and play the next song from the queue
    async function playNextFromQueue() {
        console.log("Attempting to play next song from queue...");
        try {
            const response = await fetch('/queue/next/');
            if (!response.ok) throw new Error('Failed to get next song');
            const data = await response.json();
            console.log('Get next song response:', data);
            if (data.status === 'success' && data.song) {
                playSong(data.song.url, data.song.title, data.song.artist, data.song.cover, data.song.id);
            } else if (data.status === 'end_of_queue') {
                console.log("Reached end of queue.");
                resetPlayerUI(); // Reset player when queue ends
            } else if (data.status === 'no_file') {
                 console.log("Next song has no file, skipping...");
                 playNextFromQueue(); // Try the next one
            } else {
                console.error("Failed to get next song:", data.message);
                // Optionally reset player or show error
            }
        } catch (error) {
            console.error("Error playing next song from queue:", error);
        }
    }

    // --- New function playPreviousFromQueue ---
    async function playPreviousFromQueue() {
        console.log("Attempting to play previous song from queue...");
        try {
            const response = await fetch('/queue/previous/');
            if (!response.ok) throw new Error('Failed to get previous song');
            const data = await response.json();
            console.log('Get previous song response:', data);
            if (data.status === 'success' && data.song) {
                playSong(data.song.url, data.song.title, data.song.artist, data.song.cover, data.song.id);
            } else if (data.status === 'start_of_queue') {
                console.log("Reached start of queue history.");
                // Optionally restart current song or do nothing
                if (audioPlayer && audioPlayer.src) {
                    audioPlayer.currentTime = 0; // Restart current song
                }
            } else if (data.status === 'no_file') {
                 console.log("Previous song has no file, skipping...");
                 playPreviousFromQueue(); // Try the one before that
            } else {
                console.error("Failed to get previous song:", data.message);
            }
        } catch (error) {
            console.error("Error playing previous song from queue:", error);
        }
    }

    // --- Function to remove song from queue via API ---
    async function removeFromQueue(itemId) {
        console.log(`Removing item ${itemId} from queue...`);
        try {
            const response = await fetch(`/queue/remove/${itemId}/`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': csrftoken }
            });
            if (!response.ok) throw new Error('Failed to remove item from queue');
            const data = await response.json();
            console.log('Remove from queue response:', data);
            // Refresh queue modal if it's open
            refreshQueueModal();
        } catch (error) {
            console.error("Error removing item from queue:", error);
        }
    }

    // --- Event Handler for Remove Button Click ---
    function handleRemoveFromQueueClick(event) {
        const itemId = event.target.dataset.itemId;
        if (itemId) {
            removeFromQueue(itemId);
        }
    }

    // --- New function showQueue ---
    async function showQueue() {
        if (!queueModal) return;
        console.log("Showing queue modal.");
        queueModal.style.display = 'flex'; // Use flex as per CSS
        // Fetch fresh queue data when opening
        await refreshQueueModal();
        // Delay adding 'visible' class for transition effect
        setTimeout(() => {
            queueModal.classList.add('visible');
        }, 10);
    }

    // --- New function hideQueue ---
    function hideQueue() {
        if (!queueModal) return;
        console.log("Hiding queue modal.");
        queueModal.classList.remove('visible');
        queueModal.addEventListener('transitionend', function handler() {
            queueModal.style.display = 'none';
            queueModal.removeEventListener('transitionend', handler);
        }, { once: true });
    }

    // --- Function to Load Content via AJAX ---
    async function loadContent(url, pushState = true) {
        console.log(`Loading content from: ${url}`);
        if (!mainContent) {
            console.error("Main content container not found!");
            return;
        }
        // Optional: Add a loading indicator
        mainContent.style.opacity = '0.5';

        try {
            const response = await fetch(url, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' } // Identify AJAX request
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();
            mainContent.innerHTML = html;

            // Re-initialize event listeners for the new content
            initializeEventListeners(mainContent);

            // Update browser history and URL
            if (pushState) {
                history.pushState({ url: url }, '', url);
                console.log("History state pushed:", { url: url });
            }
            // Scroll to top
            window.scrollTo(0, 0);

        } catch (error) {
            console.error("Failed to load content:", error);
            mainContent.innerHTML = `<p>Error loading content: ${error.message}. Please try again.</p>`;
        } finally {
            // Remove loading indicator
            mainContent.style.opacity = '1';
        }
    }


    // --- Function to Initialize Event Listeners on Content ---
    function initializeEventListeners(container) {
        console.log("Initializing listeners within container:", container);
        // Play buttons
        container.querySelectorAll('.play-button').forEach(button => {
            button.removeEventListener('click', handlePlayButtonClick); // Remove previous listener if any
            button.addEventListener('click', handlePlayButtonClick);
        });
        // Add to Queue buttons
        container.querySelectorAll('.add-queue-button').forEach(button => {
            button.removeEventListener('click', handleAddToQueueClick); // Remove previous listener
            button.addEventListener('click', handleAddToQueueClick);
        });
        // AJAX links
        container.querySelectorAll('a.ajax-link').forEach(link => {
            link.removeEventListener('click', handleAjaxLinkClick); // Remove previous listener
            link.addEventListener('click', handleAjaxLinkClick);
        });
        // Add other listeners as needed (e.g., for forms if submitting via AJAX)
    }

    // --- Event Handlers (extracted for re-use) ---
    async function handlePlayButtonClick() {
        const songUrl = this.dataset.songUrl;
        const songTitle = this.dataset.songTitle;
        const songArtist = this.dataset.songArtist;
        const songCover = this.dataset.songCover;
        const songId = this.dataset.songId;

        if (songUrl && songId) {
            console.log(`Play button clicked: ${songTitle} (ID: ${songId})`);
            // Set this song as the currently playing in the backend queue (clears existing queue)
            try {
                const response = await fetch(`/queue/set_playing/${songId}/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrftoken, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clear_queue: true }) // Clear queue when playing directly
                });
                if (!response.ok) throw new Error('Failed to set playing state');
                const data = await response.json();
                console.log('Set playing response:', data);
                // Now play the song
                playSong(songUrl, songTitle, songArtist, songCover, songId);
            } catch (error) {
                console.error("Error setting playing state and playing song:", error);
            }
        } else {
            console.error("Play button clicked, but missing data attributes (URL or ID).");
        }
    }

    function handleAddToQueueClick() {
        const songId = this.dataset.songId;
        if (songId) {
            addToQueue(songId);
            // Optional: Visual feedback (e.g., disable button briefly)
            this.disabled = true;
            setTimeout(() => { this.disabled = false; }, 1000);
        }
    }

    async function handleAjaxLinkClick(event) {
        event.preventDefault(); // Prevent default link navigation
        const targetUrl = this.dataset.targetUrl || this.getAttribute('href');
        if (targetUrl) {
            loadContent(targetUrl);
        } else {
            console.error("AJAX link clicked, but no target URL found.");
        }
    }

    // --- Function to Load Initial Player State ---
    async function loadInitialPlayerState() {
        console.log("Loading initial player state...");
        try {
            const response = await fetch('/queue/view/'); // Use the queue view endpoint
            if (!response.ok) throw new Error('Failed to fetch initial state');
            const data = await response.json();
            console.log("Initial state data:", data);
            if (data.status === 'success' && data.currently_playing_song) {
                const currentSong = data.currently_playing_song;
                // Update UI but DON'T auto-play, just show what was playing
                if (currentTrackTitle) currentTrackTitle.textContent = currentSong.title || 'Unknown Title';
                if (currentTrackArtist) currentTrackArtist.textContent = currentSong.artist || 'Unknown Artist';
                if (playerCoverArt) playerCoverArt.src = currentSong.cover || placeholderCoverSrc;
                if (audioPlayer) {
                    // Set src but don't play. Allow user to press play.
                    audioPlayer.src = currentSong.url || '';
                    audioPlayer.dataset.currentSongId = currentSong.id; // Set current song ID
                    // Fetch lyrics for the initially loaded song
                    fetchAndDisplayLyrics(currentSong.id);
                }
                console.log(`Initial state loaded: ${currentSong.title}`);
            } else if (data.status === 'success' && data.queue.length > 0) {
                 console.log("Initial state: Queue has items, but nothing marked as playing.");
                 // Optionally load the first item? Or leave player empty?
            } else {
                console.log("Initial state: No song currently playing or queue is empty.");
                resetPlayerUI(); // Ensure player is in default state
            }
        } catch (error) {
            console.error("Error loading initial player state:", error);
            resetPlayerUI(); // Reset on error
        }
    }

    // --- Initial Event Listener Setup ---
    // Initialize listeners for the initially loaded content
    if (mainContent) {
        initializeEventListeners(mainContent);
    } else {
        console.error("Main content container not found!");
    }

    // --- Player Controls Event Listeners (Attach ONCE) ---
    // Play/Pause button functionality
    if (playPauseButton && audioPlayer) {
        playPauseButton.addEventListener('click', function() {
            if (audioPlayer.paused || audioPlayer.ended) {
                if (audioPlayer.src && audioPlayer.src !== window.location.href) {
                    audioPlayer.play().catch(e => console.error("Error resuming playback:", e));
                } else {
                    console.log("Play button clicked, but no valid audio source.");
                    // Try playing next from queue if player is empty
                    playNextFromQueue();
                }
            } else {
                audioPlayer.pause();
            }
        });
    }

    // Previous Button
    if (previousButton) {
        previousButton.addEventListener('click', playPreviousFromQueue);
    }

    // Next Button
    if (nextButton) {
        nextButton.addEventListener('click', playNextFromQueue);
    }

    // Show Queue Button
    if (showQueueButton) {
        showQueueButton.addEventListener('click', () => {
            console.log("Showing queue modal.");
            // --- MODIFICATION START: Make visible before fetching ---
            queueModal.style.display = 'flex'; // Or 'block' depending on your CSS
            // Use setTimeout to allow the display change to render before adding class
            setTimeout(() => {
                queueModal.classList.add('visible');
                // Now fetch the queue data
                refreshQueueModal();
            }, 10); // Small delay (10ms)
            // --- MODIFICATION END ---
            // Hide lyrics modal if open
            hideLyrics();
        });
    } else {
        console.error("Show Queue button not found!");
    }

    // Close Queue Button
    if (closeQueueButton) {
        closeQueueButton.addEventListener('click', hideQueue);
    } else {
        console.error("Close Queue button not found!");
    }

    // Close queue modal if clicking outside the content area
    if (queueModal) {
        queueModal.addEventListener('click', function(event) {
            if (event.target === queueModal) {
                hideQueue();
            }
        });
    } else {
        console.error("Queue modal container not found!");
    }

    // --- Lyrics Functions ---
    // Function to parse LRC format
    function parseLRC(lrcContent) {
        // ... (implementation from previous step) ...
        if (!lrcContent) return null;
        const lines = lrcContent.split('\n');
        const data = [];
        const lineRegex = /\[(\d{2,}):(\d{2})(?:[.,](\d{1,3}))?\](.*)/;
        lines.forEach(line => {
            const match = line.match(lineRegex);
            if (match) {
                const minutes = parseInt(match[1], 10);
                const seconds = parseInt(match[2], 10);
                const milliseconds = parseInt(match[3]?.padEnd(3, '0') || '000', 10);
                const time = minutes * 60 + seconds + milliseconds / 1000;
                const text = match[4].trim();
                if (text || text === '') { // Keep lines even if text is empty after timestamp
                    data.push({ time, text });
                }
            }
        });
        data.sort((a, b) => a.time - b.time);
        return data.length > 0 ? data : null;
    }

    // Function to fetch and prepare lyrics
    async function fetchAndDisplayLyrics(songId) {
        console.log(`fetchAndDisplayLyrics called with songId: ${songId}`);
        if (!songId || !lyricsDisplay) {
            console.log("fetchAndDisplayLyrics: No songId or lyricsDisplay element. Resetting.");
            resetLyrics();
            return;
        }
        console.log(`Fetching lyrics for song ID: ${songId}`);
        resetLyrics(); // Clear previous lyrics first
        currentSongIdForLyrics = songId;
        lyricsDisplay.innerHTML = '<p class="lyrics-loading">Loading lyrics...</p>';
        showViewMode(); // Show loading state in view mode

        try {
            const lyricsUrl = `/lyrics/${songId}/`;
            console.log(`Fetching from URL: ${lyricsUrl}`);
            const response = await fetch(lyricsUrl);
            console.log(`Lyrics fetch response status: ${response.status}`);

            if (!response.ok) {
                let errorMsg = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.message || errorMsg;
                } catch (e) { /* Ignore */ }
                if (response.status === 404) {
                    errorMsg = "No lyrics available for this song.";
                    throw new Error(errorMsg, { cause: 'not_found' });
                }
                throw new Error(errorMsg);
            }
            const data = await response.json();
            console.log("Lyrics fetch response data:", data);

            if (data.status === 'success' && data.song_id == currentSongIdForLyrics) {
                currentPlainLyrics = data.lyrics;
                // --- MODIFICATION START: Detect instrumental song ---
                isInstrumentalSong = currentPlainLyrics && currentPlainLyrics.trim() === '[instrumental]';
                console.log(`Instrumental song detected: ${isInstrumentalSong}`);
                // --- MODIFICATION END ---

                if (data.is_synced && !isInstrumentalSong) { // Don't parse if instrumental
                    currentLrcData = parseLRC(data.lyrics);
                    console.log("Parsed LRC data:", currentLrcData);
                } else {
                    currentLrcData = null;
                    console.log(isInstrumentalSong ? "Instrumental song, not parsing LRC." : "Received plain lyrics.");
                }
                renderLyrics(); // Render based on new state
                showViewMode(); // Update button visibility etc.
            } else if (data.song_id != currentSongIdForLyrics) {
                console.log(`Ignoring fetched lyrics for song ${data.song_id} as current song is ${currentSongIdForLyrics}`);
            } else {
                 throw new Error(data.message || 'Failed to process lyrics data');
            }
        } catch (error) {
            console.error("Error fetching lyrics:", error);
            if (lyricsDisplay && currentSongIdForLyrics === songId) {
                const displayMsg = error.cause === 'not_found' ? error.message : `Could not load lyrics. (${error.message})`;
                lyricsDisplay.innerHTML = `<p class="lyrics-unavailable">${displayMsg}</p>`;
                currentPlainLyrics = null;
                currentLrcData = null;
                isInstrumentalSong = false; // Reset on error
                showViewMode(); // Show view mode with 'Add' button if applicable
            }
        }
    }

    // Function to render lyrics
    function renderLyrics() {
        if (!lyricsDisplay) return;
        lyricsDisplay.innerHTML = ''; // Clear previous lyrics

        if (isInstrumentalSong) {
            lyricsDisplay.innerHTML = '<p class="lyrics-instrumental-message">Instrumental</p>';
            return;
        }

        if (currentLrcData && currentLrcData.length > 0) {
            const fragment = document.createDocumentFragment();
            currentLrcData.forEach((line, index) => {
                const p = document.createElement('p');
                if (line.text.trim() === '[instrumental]') {
                    p.textContent = '♫';
                    p.classList.add('lyrics-instrumental');
                } else {
                    p.textContent = line.text || '\u00A0'; // Use non-breaking space for empty lines
                }
                // --- MODIFICATION: Ensure data-lrc-index is added ---
                p.dataset.lrcIndex = index; // Add index for highlighting lookup
                // --- MODIFICATION END ---
                fragment.appendChild(p);
            });
            lyricsDisplay.appendChild(fragment);
        } else if (currentPlainLyrics) {
            // Display plain lyrics if LRC is not available
            const lines = currentPlainLyrics.split('\n');
            const fragment = document.createDocumentFragment();
            lines.forEach((textLine) => {
                const p = document.createElement('p');
                 if (textLine.trim() === '[instrumental]') {
                    p.textContent = '♫';
                    p.classList.add('lyrics-instrumental');
                } else {
                    p.textContent = textLine || '\u00A0';
                }
                // Note: No data-lrc-index for plain lyrics as highlighting isn't time-based
                fragment.appendChild(p);
            });
             lyricsDisplay.appendChild(fragment);
        } else {
            lyricsDisplay.innerHTML = '<p class="lyrics-unavailable">Lyrics not available for this song.</p>';
        }
    }

    // Function to update lyrics highlight based on time
    function updateLyricsHighlight(currentTime) {
        if (!lyricsDisplay || !currentLrcData || currentLrcData.length === 0 || isSyncing) {
            return; // Exit if no display, no data, or if syncing
        }

        let currentActiveLineIndex = -1;

        // Find the index of the line that *will* start after the current time
        let nextLineIndex = currentLrcData.findIndex(line => line.time > currentTime);

        // If no line starts after the current time, the last line is active or passed
        if (nextLineIndex === -1) {
            currentActiveLineIndex = currentLrcData.length - 1;
        } else {
            // The line *before* the next line is the one currently playing or just finished
            currentActiveLineIndex = nextLineIndex - 1;
        }

        // --- MODIFICATION START: Revert to highlighting the CURRENT active line ---
        let highlightIndex = currentActiveLineIndex; // Target the current line
        // --- MODIFICATION END ---

        // Remove active class from all lines first
        const allLines = lyricsDisplay.querySelectorAll('p');
        allLines.forEach(line => line.classList.remove('active'));

        // Add active class to the target current line if it exists
        if (highlightIndex >= 0 && highlightIndex < currentLrcData.length) {
            // Find the corresponding p element using the index stored during rendering
            const targetLineElement = lyricsDisplay.querySelector(`p[data-lrc-index="${highlightIndex}"]`);
            if (targetLineElement) {
                targetLineElement.classList.add('active');
                // Scroll the highlighted line into view if needed
                targetLineElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            }
        } else {
             // Scroll to top if even the first line isn't active yet (highlightIndex < 0)
             lyricsDisplay.scrollTop = 0;
        }
    }

    // --- Restore show/hide lyrics functions ---
    function showLyrics() {
        if (!lyricsModal) return;
        console.log("Showing lyrics modal.");
        const currentSongId = audioPlayer ? audioPlayer.dataset.currentSongId : null;
        if (currentSongId && currentSongId !== currentSongIdForLyrics) {
            fetchAndDisplayLyrics(currentSongId); // Fetch if different song
        } else if (!currentSongId) {
            resetLyrics(); // Reset if no song is loaded
            lyricsDisplay.innerHTML = '<p class="lyrics-unavailable">No song is currently playing.</p>';
            showViewMode(); // Ensure correct buttons are shown
        } else {
            showViewMode(); // Ensure view mode if lyrics already loaded/loading
        }
        lyricsModal.style.display = 'flex';
        setTimeout(() => { lyricsModal.classList.add('visible'); }, 10);
    }

    function hideLyrics() {
        if (!lyricsModal) return;
        console.log("Hiding lyrics modal.");
        lyricsModal.classList.remove('visible');
        lyricsModal.addEventListener('transitionend', function handler() {
            lyricsModal.style.display = 'none';
            showViewMode(); // Reset to view mode on close
            lyricsModal.removeEventListener('transitionend', handler);
        }, { once: true });
    }

    // --- Lyrics Edit/Sync Functions ---
    function showViewMode() {
        if (!lyricsModal) return;
        lyricsModal.classList.remove('edit-mode', 'sync-mode');
        lyricsModal.classList.add('view-mode');
        isSyncing = false;
        currentSyncIndex = -1; // Reset index
        syncData = [];
        if (lyricsDisplay) {
            // Remove sync classes and timestamps
            lyricsDisplay.querySelectorAll('p.sync-current, p.sync-upcoming, p.synced').forEach(el => {
                el.classList.remove('sync-current', 'sync-upcoming', 'synced');
                const timestampSpan = el.querySelector('.lyrics-timestamp');
                if (timestampSpan) timestampSpan.remove();
            });
        }
        if (markSyncLineButton) markSyncLineButton.disabled = false;

        // --- MODIFICATION START: Handle instrumental song view ---
        if (isInstrumentalSong) {
            if (lyricsDisplay) lyricsDisplay.innerHTML = '<p class="lyrics-instrumental-message">Instrumental</p>';
            // Hide all action buttons
            document.querySelectorAll('.lyrics-action-button').forEach(btn => { if (btn) btn.style.display = 'none'; });
            if (lyricsEditArea) lyricsEditArea.style.display = 'none';
            if (lyricsDisplay) lyricsDisplay.style.display = 'block';
            return; // Stop further processing for instrumental songs
        }
        // --- MODIFICATION END ---

        // --- Existing button visibility logic ---
        const hasPlainLyrics = !!currentPlainLyrics && currentPlainLyrics.trim() !== '';
        const hasSyncedLyrics = !!currentLrcData; // Check if LRC data was successfully parsed

        if (addLyricsButton) addLyricsButton.style.display = hasPlainLyrics ? 'none' : 'inline-block';
        if (editLyricsButton) editLyricsButton.style.display = hasPlainLyrics ? 'inline-block' : 'none';
        // Show Sync button only if plain lyrics exist
        if (syncLyricsButton) syncLyricsButton.style.display = hasPlainLyrics ? 'inline-block' : 'none';

        // Hide edit/sync mode specific buttons
        document.querySelectorAll('.edit-mode-button, .sync-mode-button').forEach(btn => { if (btn) btn.style.display = 'none'; });
        if (lyricsEditArea) lyricsEditArea.style.display = 'none';
        if (lyricsDisplay) lyricsDisplay.style.display = 'block';

        // Re-render to ensure correct version (synced or plain) is shown
        renderLyrics();
        // updateLyricsHighlight is called within renderLyrics if needed
    }

    function showEditMode() {
        console.log("showEditMode called"); // --- MODIFICATION: Add log ---
        if (!lyricsModal || !lyricsEditArea) return;
        lyricsModal.classList.remove('view-mode', 'sync-mode');
        lyricsModal.classList.add('edit-mode');
        isSyncing = false;

        // --- MODIFICATION START: Load plain lyrics for editing ---
        lyricsEditArea.value = currentPlainLyrics || ''; // Load current plain lyrics
        // --- MODIFICATION END ---
        lyricsEditArea.style.display = 'block';
        if (lyricsDisplay) lyricsDisplay.style.display = 'none';

        document.querySelectorAll('.lyrics-action-button').forEach(btn => { if (btn) btn.style.display = 'none'; });
        if (saveLyricsButton) saveLyricsButton.style.display = 'inline-block';
        if (cancelEditButton) cancelEditButton.style.display = 'inline-block';
        console.log("showEditMode finished"); // --- MODIFICATION: Add log ---
    }

    function showSyncMode() {
        console.log("showSyncMode called"); // --- MODIFICATION: Add log ---
        if (!lyricsModal || !currentPlainLyrics || currentPlainLyrics.trim() === '' || isInstrumentalSong) {
            console.warn("Cannot enter sync mode without plain lyrics or if song is instrumental.");
            alert("Add or edit plain lyrics before syncing. Cannot sync instrumental songs.");
            return;
        }
        lyricsModal.classList.remove('view-mode', 'edit-mode');
        lyricsModal.classList.add('sync-mode');
        isSyncing = true;
        syncData = [];
        currentSyncIndex = -1; // --- MODIFICATION: Start at -1 for "..." ---

        if (lyricsDisplay) {
            lyricsDisplay.innerHTML = ''; // Clear display first
            const fragment = document.createDocumentFragment();

            // 1. Add "..." marker with index -1
            const startMarker = document.createElement('p');
            startMarker.textContent = '...';
            startMarker.classList.add('lyrics-sync-marker', 'lyrics-line'); // Add lyrics-line for selection logic
            startMarker.dataset.index = -1; // --- MODIFICATION: Assign index -1 ---
            startMarker.addEventListener('click', handleLyricLineClick); // Add listener
            fragment.appendChild(startMarker);

            // 2. Add actual lyric lines
            const lines = currentPlainLyrics.split('\n');
            lines.forEach((textLine, index) => {
                const p = document.createElement('p');
                const trimmedText = textLine.trim();
                if (trimmedText === '[instrumental]') {
                    p.textContent = '♫';
                    p.classList.add('lyrics-instrumental');
                } else {
                    p.textContent = textLine || '\u00A0';
                }
                p.dataset.index = index; // Index of the original line (0, 1, 2...)
                p.classList.add('lyrics-line'); // Mark as an actual lyric line
                p.addEventListener('click', handleLyricLineClick); // Add listener
                fragment.appendChild(p);
            });

            // 3. Add "End of Lyrics" marker (no index needed)
            const endMarker = document.createElement('p');
            endMarker.textContent = 'End of Lyrics';
            endMarker.classList.add('lyrics-sync-marker');
            fragment.appendChild(endMarker);

            lyricsDisplay.appendChild(fragment);
            lyricsDisplay.style.display = 'block';
        }

        if (lyricsEditArea) lyricsEditArea.style.display = 'none';

        document.querySelectorAll('.lyrics-action-button').forEach(btn => { if (btn) btn.style.display = 'none'; });
        if (markSyncLineButton) { markSyncLineButton.style.display = 'inline-block'; markSyncLineButton.disabled = false; }
        if (saveSyncButton) saveSyncButton.style.display = 'inline-block';
        if (cancelSyncButton) cancelSyncButton.style.display = 'inline-block';

        highlightNextSyncLine(); // Highlight the initial line ("...")
        if (audioPlayer && audioPlayer.paused) {
            console.log("Sync mode started. Press play and use 'Mark Line Time'.");
        }
        console.log("showSyncMode finished"); // --- MODIFICATION: Add log ---
    }

    function highlightNextSyncLine() {
        if (!isSyncing || !lyricsDisplay) return;
        // Remove previous highlights
        lyricsDisplay.querySelectorAll('p.sync-current, p.sync-upcoming').forEach(el => el.classList.remove('sync-current', 'sync-upcoming'));

        // Highlight the current line (using currentSyncIndex, which can be -1)
        const currentLine = lyricsDisplay.querySelector(`p.lyrics-line[data-index="${currentSyncIndex}"]`);
        if (currentLine) {
            currentLine.classList.add('sync-current');
            currentLine.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            if (markSyncLineButton) markSyncLineButton.disabled = false;
        } else {
            // If currentSyncIndex is beyond the last line, disable button
            console.log("Sync: Reached end of lyrics or invalid index.");
            if (markSyncLineButton) markSyncLineButton.disabled = true;
        }

        // Dim the upcoming line (index + 1)
        const upcomingLine = lyricsDisplay.querySelector(`p.lyrics-line[data-index="${currentSyncIndex + 1}"]`);
        if (upcomingLine) {
            upcomingLine.classList.add('sync-upcoming');
        }
    }

    function handleLyricLineClick(event) {
        // Ensure it only works in sync mode and on actual lyric lines (including "...")
        if (!isSyncing || !event.currentTarget.classList.contains('lyrics-line') || (event.currentTarget.classList.contains('lyrics-sync-marker') && event.currentTarget.dataset.index === undefined)) return;

        const clickedLine = event.currentTarget;
        const clickedIndex = parseInt(clickedLine.dataset.index, 10);

        if (!isNaN(clickedIndex)) {
            // --- MODIFICATION: Set currentSyncIndex to the CLICKED line's index ---
            currentSyncIndex = clickedIndex;
            console.log(`Line ${clickedIndex} clicked, setting index ${currentSyncIndex} as current.`);
            // --- MODIFICATION END ---
            highlightNextSyncLine(); // Update highlights based on the new currentSyncIndex
        }
    }

    function markSyncLine() {
        if (!isSyncing || !audioPlayer || !lyricsDisplay) return;
        // Select the line based on currentSyncIndex
        const lineElement = lyricsDisplay.querySelector(`p.lyrics-line[data-index="${currentSyncIndex}"]`);

        if (lineElement) {
            const currentTime = (currentSyncIndex === -1) ? 0.0 : audioPlayer.currentTime;

            let lineText = '';
            if (currentSyncIndex === -1) {
                lineText = ''; // LRC format usually doesn't include text for time 0 unless it's the first lyric
            } else {
                const originalLines = currentPlainLyrics.split('\n');
                // Ensure index is within bounds for originalLines
                if (currentSyncIndex >= 0 && currentSyncIndex < originalLines.length) {
                    lineText = originalLines[currentSyncIndex] || '';
                } else {
                    console.warn(`Sync: currentSyncIndex ${currentSyncIndex} is out of bounds for original lyrics.`);
                    lineText = lineElement.textContent.replace(/\[.*\]$/, '').trim(); // Fallback to element text minus timestamp
                }
            }

            // Add or update sync data
            const existingIndexInSyncData = syncData.findIndex(item => item.index === currentSyncIndex);
            const syncEntry = { index: currentSyncIndex, time: currentTime, text: lineText };
            if (existingIndexInSyncData > -1) {
                syncData[existingIndexInSyncData] = syncEntry;
            } else {
                syncData.push(syncEntry);
            }
            syncData.sort((a, b) => a.time - b.time);

            console.log(`Sync: Marked line index ${currentSyncIndex} ('${lineText}') at ${formatTime(currentTime)}`);

            // Display timestamp
            const existingTimestampSpan = lineElement.querySelector('.lyrics-timestamp');
            if (existingTimestampSpan) existingTimestampSpan.remove();
            const timestampSpan = document.createElement('span');
            timestampSpan.classList.add('lyrics-timestamp');
            timestampSpan.textContent = `[${formatTime(currentTime)}]`;
            lineElement.appendChild(timestampSpan);

            // Update classes: Make current line 'synced'
            lineElement.classList.remove('sync-current');
            lineElement.classList.add('synced');

            // Find next logical index to mark
            let nextLineElement = lineElement.nextElementSibling;
            let nextIndex = currentSyncIndex + 1; // Start searching from the next theoretical index

            // Find the next DOM element that is a .lyrics-line with a data-index >= nextIndex
            while (nextLineElement) {
                if (nextLineElement.classList.contains('lyrics-line') && nextLineElement.dataset.index !== undefined) {
                    const elementIndex = parseInt(nextLineElement.dataset.index, 10);
                    if (!isNaN(elementIndex) && elementIndex >= nextIndex) {
                        nextIndex = elementIndex; // Found the next line's index
                        break;
                    }
                }
                nextLineElement = nextLineElement.nextElementSibling;
            }

            // If no next line element was found, set index beyond the last line
            if (!nextLineElement) {
                 const lastLine = lyricsDisplay.querySelector('p.lyrics-line[data-index]:last-of-type');
                 nextIndex = lastLine ? parseInt(lastLine.dataset.index, 10) + 1 : currentSyncIndex + 1;
            }

            currentSyncIndex = nextIndex; // Move to the next index

            highlightNextSyncLine(); // Highlight the new current and upcoming lines
        } else {
            console.log("Sync: Could not find line element for current index.");
            if (markSyncLineButton) markSyncLineButton.disabled = true;
        }
    }

    // Function to format sync data into LRC format
    function formatLRC(syncData) {
        // Ensure syncData is sorted by time
        syncData.sort((a, b) => a.time - b.time);

        return syncData.map(item => {
            const time = item.time;
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            const milliseconds = Math.floor((time % 1) * 100); // Use 2 digits for milliseconds
            // Format: [mm:ss.xx]Text
            // Handle index -1 (the "..." marker) - usually just add [00:00.00]
            const text = (item.index === -1) ? '' : item.text;
            return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(2, '0')}]${text}`;
        }).join('\n');
    }

    // --- MODIFICATION START: Re-add saveLyrics function definition ---
    async function saveLyrics(lyricsContent, isSynced = false) {
        if (!currentSongIdForLyrics) {
            console.error("Cannot save lyrics, no current song ID.");
            alert("Error: No song selected to save lyrics for.");
            return;
        }
        console.log(`Saving ${isSynced ? 'synced' : 'plain'} lyrics for song ${currentSongIdForLyrics}`);
        try {
            const response = await fetch(`/lyrics/update/${currentSongIdForLyrics}/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
                body: JSON.stringify({ lyrics: lyricsContent, is_synced: isSynced }) // Pass isSynced flag
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log("Save lyrics response:", data);
            if (data.status === 'success') {
                alert("Lyrics saved successfully!");
                // Fetching again ensures both plain and potentially synced versions are updated in the frontend state
                await fetchAndDisplayLyrics(currentSongIdForLyrics);
                // fetchAndDisplayLyrics calls showViewMode internally
            } else {
                alert(`Error saving lyrics: ${data.message}`);
            }
        } catch (error) {
            console.error("Error saving lyrics:", error);
            alert(`Failed to save lyrics: ${error.message}`);
        }
    }
    // --- MODIFICATION END ---

    // Function to reset lyrics state
    function resetLyrics() {
        currentSongIdForLyrics = null;
        currentLrcData = null;
        currentPlainLyrics = null;
        isInstrumentalSong = false; // --- MODIFICATION: Reset instrumental flag ---
        if (lyricsDisplay) {
            lyricsDisplay.innerHTML = ''; // Clear display
        }
        // Don't call showViewMode here directly, let callers handle it
    }

    // --- Restore Lyrics Button Listeners ---
    if (lyricsToggleButton) {
        lyricsToggleButton.addEventListener('click', showLyrics);
    }
    if (closeLyricsButton) {
        closeLyricsButton.addEventListener('click', hideLyrics);
    }
    // Edit/Sync Buttons
    if (addLyricsButton) {
        addLyricsButton.addEventListener('click', () => { // --- MODIFICATION: Add log ---
            console.log("Add Lyrics button clicked");
            showEditMode();
        });
    }
    if (editLyricsButton) {
        editLyricsButton.addEventListener('click', () => { // --- MODIFICATION: Add log ---
            console.log("Edit Lyrics button clicked");
            showEditMode();
        });
    }
    if (cancelEditButton) {
        cancelEditButton.addEventListener('click', showViewMode);
    }
    if (saveLyricsButton) {
        saveLyricsButton.addEventListener('click', () => {
            if (lyricsEditArea) {
                // --- MODIFICATION START: Explicitly save as plain text ---
                saveLyrics(lyricsEditArea.value, false);
                // --- MODIFICATION END ---
            }
        });
    }
    if (syncLyricsButton) { // This button starts the sync process
        syncLyricsButton.addEventListener('click', () => { // --- MODIFICATION: Add log ---
            console.log("Sync Lyrics button clicked");
            showSyncMode();
        });
    }
    if (markSyncLineButton) {
        markSyncLineButton.addEventListener('click', markSyncLine);
    }
    if (saveSyncButton) {
        saveSyncButton.addEventListener('click', () => {
            if (syncData.length > 0) {
                saveLyrics(formatLRC(syncData), true);
            } else {
                alert("No sync points marked. Mark lines before saving.");
            }
        });
    }
    if (cancelSyncButton) {
        cancelSyncButton.addEventListener('click', showViewMode);
    }

    // --- Restore Audio Player Event Listeners ---
    if (audioPlayer) {
        audioPlayer.addEventListener('play', function() {
            if (playIcon) playIcon.style.display = 'none';
            if (pauseIcon) pauseIcon.style.display = 'inline-block';
        });

        audioPlayer.addEventListener('pause', function() {
            if (playIcon) playIcon.style.display = 'inline-block';
            if (pauseIcon) pauseIcon.style.display = 'none';
        });

        audioPlayer.addEventListener('timeupdate', function() {
            const currentTime = audioPlayer.currentTime;
            updateLyricsHighlight(currentTime); // Call highlight function
            if (!isSeeking) {
                const duration = audioPlayer.duration;
                if (duration && isFinite(duration)) {
                    seekBar.value = (currentTime / duration) * 100;
                    currentTimeDisplay.textContent = formatTime(currentTime);
                } else {
                    seekBar.value = 0;
                    currentTimeDisplay.textContent = formatTime(currentTime);
                }
            }
        });

        audioPlayer.addEventListener('loadedmetadata', function() {
            const duration = audioPlayer.duration;
            if (duration && isFinite(duration)) {
                durationDisplay.textContent = formatTime(duration);
                seekBar.value = 0;
                currentTimeDisplay.textContent = formatTime(0);
            } else {
                 durationDisplay.textContent = formatTime(0);
                 seekBar.value = 0;
                 currentTimeDisplay.textContent = formatTime(0);
            }
        });

        audioPlayer.addEventListener('ended', function() {
            console.log("Audio ended, attempting to play next from queue.");
            playNextFromQueue();
        });

        // Seeking
        if (seekBar) {
            seekBar.addEventListener('input', function() {
                isSeeking = true;
                const duration = audioPlayer.duration;
                if (duration && isFinite(duration)) {
                    const seekTime = (seekBar.value / 100) * duration;
                    currentTimeDisplay.textContent = formatTime(seekTime);
                }
            });
            seekBar.addEventListener('change', function() {
                const duration = audioPlayer.duration;
                if (duration && isFinite(duration)) {
                    const seekTime = (seekBar.value / 100) * duration;
                    audioPlayer.currentTime = seekTime;
                }
                isSeeking = false;
            });
        }

    } else {
        console.error("Audio player element not found!");
    }

    // --- Restore Volume Control Listener ---
    if (volumeBar) {
        volumeBar.addEventListener('input', function() {
            if (audioPlayer) {
                const newVolume = parseFloat(volumeBar.value);
                audioPlayer.volume = newVolume;
                updateVolumeIcon(newVolume);
            }
        });
        if (audioPlayer) { // Set initial icon
            updateVolumeIcon(audioPlayer.volume);
        }
    }

    // --- Restore Initial Load and History Handling ---
    loadInitialPlayerState();

    window.addEventListener('popstate', function(event) {
        console.log("Popstate event:", event.state);
        if (event.state && event.state.url) {
            loadContent(event.state.url, false); // Load without pushing state again
        } else {
            // Fallback for initial state or null state
            loadContent('/', false); // Load home content
        }
    });

    if (history.state === null) {
        history.replaceState({ url: window.location.pathname + window.location.search }, '', window.location.pathname + window.location.search);
        console.log("Initial history state replaced:", history.state);
    }

    // --- MODIFICATION START: Function to update slider background ---
    function updateSliderBackground(slider) {
        if (!slider) return;
        const percentage = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
        // Get the progress color from the CSS variable defined on the slider itself
        const progressColor = getComputedStyle(slider).getPropertyValue('--progress-color').trim();
        const trackColor = getComputedStyle(slider).getPropertyValue('background-color'); // Get the default track color

        slider.style.background = `linear-gradient(to right, ${progressColor} ${percentage}%, ${trackColor} ${percentage}%)`;
    }
    // --- MODIFICATION END ---

    // Update seek bar and time display as audio plays
    audioPlayer.addEventListener('timeupdate', function() {
        if (!isSeeking) {
            const currentTime = audioPlayer.currentTime;
            const duration = audioPlayer.duration;
            if (duration) {
                const progress = (currentTime / duration) * 100;
                seekBar.value = progress;
                currentTimeDisplay.textContent = formatTime(currentTime);
                // --- MODIFICATION: Call slider update ---
                updateSliderBackground(seekBar);
                // --- MODIFICATION END ---
                // Call highlight update on timeupdate
                updateLyricsHighlight(currentTime);
            }
        }
    });

    // Seek bar functionality
    if (seekBar && audioPlayer) {
        seekBar.addEventListener('input', function() {
            isSeeking = true;
            // --- MODIFICATION: Call slider update during input ---
            updateSliderBackground(seekBar);
            // --- MODIFICATION END ---
            // Optional: Update time display while dragging
            const duration = audioPlayer.duration;
            if (duration) {
                const seekTime = (seekBar.value / 100) * duration;
                currentTimeDisplay.textContent = formatTime(seekTime);
            }
        });
        seekBar.addEventListener('change', function() {
            const duration = audioPlayer.duration;
            if (duration) {
                audioPlayer.currentTime = (seekBar.value / 100) * duration;
            }
            isSeeking = false;
            // --- MODIFICATION: Ensure final update after change ---
            updateSliderBackground(seekBar);
            // --- MODIFICATION END ---
        });
         // --- MODIFICATION START: Initial background update ---
         updateSliderBackground(seekBar);
         // --- MODIFICATION END ---
    }

    // Volume bar functionality
    if (volumeBar && audioPlayer) {
        volumeBar.addEventListener('input', function() {
            audioPlayer.volume = volumeBar.value;
            updateVolumeIcon(audioPlayer.volume);
            // --- MODIFICATION: Call slider update ---
            updateSliderBackground(volumeBar);
            // --- MODIFICATION END ---
        });
        // Set initial volume and icon
        audioPlayer.volume = volumeBar.value;
        updateVolumeIcon(audioPlayer.volume);
        // --- MODIFICATION START: Initial background update ---
        updateSliderBackground(volumeBar);
        // --- MODIFICATION END ---
    }

    // --- MODIFICATION START: Move fetchQueue function definition earlier ---
    async function fetchQueue() {
        // Check visibility *after* ensuring modal is displayed
        if (!queueModal || !queueModal.classList.contains('visible')) {
             console.log("Queue modal not visible, skipping refresh.");
             return; // Don't fetch if modal isn't visible
        }

        console.log("Fetching queue data...");
        queueList.innerHTML = '<li class="loading-placeholder">Loading queue...</li>'; // Show loading state

        try {
            const response = await fetch('/queue/view/', {
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            if (data.status === 'success') {
                console.log("Queue data received:", data);
                currentQueue = data.queue || [];
                currentlyPlayingOrder = data.currently_playing_order || 0;
                populateQueueList(currentQueue, currentlyPlayingOrder);
            } else {
                console.error("Failed to fetch queue:", data.message);
                queueList.innerHTML = '<li class="empty-queue">Error loading queue.</li>';
            }
        } catch (error) {
            console.error('Error fetching queue:', error);
            queueList.innerHTML = '<li class="empty-queue">Error loading queue.</li>';
        }
    }
    // --- MODIFICATION END ---

    // --- Lyrics Functions ---

    function displayLyrics(lyrics, isSynced) {
        lyricsDisplay.innerHTML = ''; // Clear previous lyrics
        console.log("Displaying lyrics. Synced:", isSynced); // Log sync status

        if (!lyrics || lyrics.trim() === '') {
            lyricsDisplay.innerHTML = '<p class="lyrics-unavailable">Lyrics not available for this track.</p>';
            // Hide all action buttons if no lyrics
            lyricsActionsDiv.querySelectorAll('button').forEach(btn => btn.style.display = 'none');
            addLyricsButton.style.display = 'inline-block'; // Show only Add button
            return;
        }

        // Show relevant action buttons based on lyrics availability
        editLyricsButton.style.display = 'inline-block';
        syncLyricsButton.style.display = isSynced ? 'none' : 'inline-block'; // Show sync only if not already synced
        addLyricsButton.style.display = 'none'; // Hide Add button

        if (isSynced) {
            lyricsData.lines = parseLRC(lyrics);
            if (!lyricsData.lines || lyricsData.lines.length === 0) {
                 lyricsDisplay.innerHTML = '<p class="lyrics-unavailable">Could not parse synced lyrics.</p>';
                 return;
            }

            // --- MODIFICATION START: Add console log for marker creation ---
            console.log("Creating bouncing dots marker...");
            const marker = document.createElement('div');
            marker.classList.add('lyrics-sync-marker');
            marker.innerHTML = '<span></span><span></span><span></span>';
            lyricsDisplay.appendChild(marker);
            console.log("Bouncing dots marker appended:", marker);
            // --- MODIFICATION END ---

            lyricsData.lines.forEach((line, index) => {
                const p = document.createElement('p');
                p.textContent = line.text || '...'; // Use '...' for instrumental/empty lines
                p.dataset.time = line.time;
                p.dataset.index = index; // Store index for sync mode
                if (!line.text) {
                    p.classList.add('lyrics-instrumental'); // Style instrumental lines differently if needed
                }
                lyricsDisplay.appendChild(p);
            });
        } else {
            // Display plain lyrics
            lyrics.split('\n').forEach(lineText => {
                const p = document.createElement('p');
                p.textContent = lineText || '\u00A0'; // Use non-breaking space for empty lines
                lyricsDisplay.appendChild(p);
            });
            lyricsData.lines = null; // No parsed lines for plain text
        }
    }

    function updateActiveLyricLine(currentTime) {
        if (!lyricsData || !lyricsData.is_synced || !lyricsData.lines || isSyncModeActive) {
            // Ensure marker is hidden if lyrics are not synced or not available
            const marker = lyricsDisplay.querySelector('.lyrics-sync-marker');
            if (marker) marker.style.display = 'none';
            return; // Only run for synced lyrics in view mode
        }

        let activeLineIndex = -1;
        // Find the last line whose time is less than or equal to the current time
        for (let i = lyricsData.lines.length - 1; i >= 0; i--) {
            if (lyricsData.lines[i].time <= currentTime) {
                activeLineIndex = i;
                break;
            }
        }

        // Clear previous timeout if exists
        if (activeLyricTimeout) {
            clearTimeout(activeLyricTimeout);
            activeLyricTimeout = null;
        }

        // Remove 'active' class from all lines and update opacity
        const allLines = lyricsDisplay.querySelectorAll('p[data-time]');
        allLines.forEach((line, index) => {
            line.classList.remove('active');
            // Dim lines that are not the active one
            line.style.opacity = (index === activeLineIndex) ? '1' : '0.7';
        });

        // --- MODIFICATION START: Handle marker visibility explicitly ---
        const marker = lyricsDisplay.querySelector('.lyrics-sync-marker');

        if (activeLineIndex !== -1) {
            // Hide marker if a line is active
            if (marker) marker.style.display = 'none';

            const activeLineElement = lyricsDisplay.querySelector(`p[data-index="${activeLineIndex}"]`);
            if (activeLineElement) {
                activeLineElement.classList.add('active');
                activeLineElement.style.opacity = '1'; // Ensure active line is fully opaque

                // Scroll the active line into view smoothly
                activeLineElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center', // Center the active line vertically
                    inline: 'nearest'
                });

                // Schedule the next update based on the next line's time
                const nextLineIndex = activeLineIndex + 1;
                if (nextLineIndex < lyricsData.lines.length) {
                    const nextTime = lyricsData.lines[nextLineIndex].time;
                    const delay = (nextTime - currentTime) * 1000;
                    if (delay > 0) {
                        activeLyricTimeout = setTimeout(() => {
                            // Re-check current time before updating, in case of seeking
                            if (!isSeeking) updateActiveLyricLine(audioPlayer.currentTime);
                        }, delay);
                    }
                }
            }
        } else {
             // If no line is active (e.g., before the first line), ensure marker is visible
             if (marker) {
                 marker.style.display = 'flex'; // Explicitly show marker
                 // Optionally scroll marker into view if desired
                 // marker.scrollIntoView({ behavior: 'smooth', block: 'start' });
             }
        }
        // --- MODIFICATION END ---
    }

    async function fetchLyrics(songId) {
        if (!songId) {
            lyricsData = null;
            displayLyrics(null, false); // Display unavailable message
            return;
        }
        // Show loading state
        lyricsDisplay.innerHTML = '<p class="lyrics-loading">Loading lyrics...</p>';
        lyricsActionsDiv.querySelectorAll('button').forEach(btn => btn.style.display = 'none'); // Hide actions while loading

        try {
            const response = await fetch(`/lyrics/${songId}/`);
            if (!response.ok) {
                if (response.status === 404) {
                    lyricsData = { lyrics: '', is_synced: false, lines: null }; // Store empty state
                    displayLyrics(null, false); // Display unavailable message
                } else {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            } else {
                const data = await response.json();
                if (data.status === 'success') {
                    lyricsData = {
                        lyrics: data.lyrics,
                        is_synced: data.is_synced,
                        lines: null // Will be parsed in displayLyrics if synced
                    };
                    displayLyrics(data.lyrics, data.is_synced);
                    // --- MODIFICATION START: Initial call to updateActiveLyricLine ---
                    // Call immediately after displaying lyrics to set initial state (marker or first line)
                    updateActiveLyricLine(audioPlayer.currentTime);
                    // --- MODIFICATION END ---
                } else {
                    lyricsData = { lyrics: '', is_synced: false, lines: null }; // Store empty state on error
                    displayLyrics(null, false); // Display unavailable message
                }
            }
        } catch (error) {
            console.error('Error fetching lyrics:', error);
            lyricsData = null; // Reset on error
            lyricsDisplay.innerHTML = '<p class="lyrics-unavailable">Error loading lyrics.</p>';
            lyricsActionsDiv.querySelectorAll('button').forEach(btn => btn.style.display = 'none');
            addLyricsButton.style.display = 'inline-block'; // Show Add button on error
        } finally {
            // Ensure edit/sync modes are reset if lyrics fetch fails or completes
            exitEditMode(true); // Force exit edit mode
            exitSyncMode(true); // Force exit sync mode
        }
    }

    // --- Button Click Handlers (using event delegation) ---
    mainContent.addEventListener('click', function(event) {
        const target = event.target;
        const button = target.closest('button'); // Find the closest button element

        if (!button) return; // Exit if the click wasn't on or inside a button

        // Play Button
        if (button.classList.contains('play-button')) {
            // ... existing play button logic ...
        }
        // Add to Queue Button
        else if (button.classList.contains('add-queue-button')) {
            // ... existing add queue button logic ...
        }
        // --- MODIFICATION START: Add Library Button ---
        else if (button.classList.contains('add-library-button')) {
            const mediaType = button.dataset.mediaType;
            const mediaId = button.dataset.mediaId;
            if (mediaType && mediaId) {
                addMediaToLibrary(mediaType, mediaId, button);
            } else {
                console.error("Missing data-media-type or data-media-id on button:", button);
            }
        }
        // --- MODIFICATION END ---
        // Add other button handlers here if needed
    });

    // --- MODIFICATION START: Add Library Management Function ---
    async function addMediaToLibrary(mediaType, mediaId, buttonElement) {
        console.log(`Adding ${mediaType} with ID ${mediaId} to library...`);
        buttonElement.disabled = true; // Disable button immediately

        try {
            const response = await fetch('/library/add/', { // Use the new URL
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken') // Ensure CSRF token is sent
                },
                body: JSON.stringify({
                    media_type: mediaType,
                    media_id: mediaId
                })
            });

            const data = await response.json();

            if (response.ok && (data.status === 'success' || data.status === 'info')) {
                console.log(data.message);
                // Update button appearance to show it's added (e.g., checkmark icon)
                buttonElement.innerHTML = '<i class="fa-solid fa-check"></i>';
                buttonElement.title = "Added to Library"; // Update title
                // Optionally show a success notification to the user
            } else {
                console.error('Error adding to library:', data.message || 'Unknown error');
                buttonElement.disabled = false; // Re-enable button on error
                // Optionally show an error notification
            }
        } catch (error) {
            console.error('Network error adding to library:', error);
            buttonElement.disabled = false; // Re-enable button on network error
            // Optionally show an error notification
        }
    }
    // --- MODIFICATION END ---

    // --- Initialization ---
    loadInitialPlayerState();
    // ... rest of initialization ...

}); // End DOMContentLoaded
