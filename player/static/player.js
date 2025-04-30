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
    const playerCoverArt = document.getElementById('player-cover-art'); // Get cover art element
    const placeholderCoverSrc = playerCoverArt ? playerCoverArt.src : ''; // Store initial placeholder src
    const mainContent = document.getElementById('main-content'); // Get main content container

    // Volume Icon References
    const volumeMuteIcon = document.getElementById('volume-mute-icon');
    const volumeLowIcon = document.getElementById('volume-low-icon');
    const volumeHighIcon = document.getElementById('volume-high-icon');
    const volumeIcons = [volumeMuteIcon, volumeLowIcon, volumeHighIcon]; // Array for easy iteration

    const previousButton = document.getElementById('previous-button'); // Added
    const nextButton = document.getElementById('next-button'); // Added
    const showQueueButton = document.getElementById('show-queue-button'); // Added
    const queueModal = document.getElementById('queue-modal'); // Added
    const closeQueueButton = document.getElementById('close-queue-button'); // Added
    const queueList = document.getElementById('queue-list'); // Added

    let isSeeking = false;
    let currentQueueItemId = null; // Store the ID of the item being removed

    // Function to get CSRF token (needed for POST requests)
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                // Does this cookie string begin with the name we want?
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }
    const csrftoken = getCookie('csrftoken');

    // Function to format time (MM:SS)
    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // Function to update volume icon based on level
    function updateVolumeIcon(volume) {
        // Hide all icons first
        volumeIcons.forEach(icon => {
            if (icon) icon.classList.remove('active');
        });

        // Show the correct icon
        if (volume <= 0) {
            if (volumeMuteIcon) volumeMuteIcon.classList.add('active');
        } else if (volume <= 0.5) { // Threshold for low volume
            if (volumeLowIcon) volumeLowIcon.classList.add('active');
        } else {
            if (volumeHighIcon) volumeHighIcon.classList.add('active');
        }
    }

    // --- New Helper Function to Reset Player UI ---
    function resetPlayerUI() {
        console.log("Resetting player UI to default state.");
        if (audioPlayer) {
            audioPlayer.pause(); // Stop playback
            audioPlayer.src = ''; // Clear the source
        }
        if (playIcon) playIcon.style.display = 'inline-block';
        if (pauseIcon) pauseIcon.style.display = 'none';
        if (seekBar) seekBar.value = 0;
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(0);
        if (durationDisplay) durationDisplay.textContent = formatTime(0); // Reset duration too
        if (playerCoverArt) playerCoverArt.src = placeholderCoverSrc;
        if (currentTrackTitle) currentTrackTitle.textContent = 'No track selected';
        if (currentTrackArtist) currentTrackArtist.textContent = '';
    }

    // --- Helper Function to Create a Single Queue List Item ---
    function createQueueListItem(item) {
        const li = document.createElement('li');
        li.dataset.songId = item.song_id;
        li.dataset.order = item.order;
        li.dataset.itemId = item.id; // For removal

        let classes = [];
        // is_playing comes directly from the backend data for this item
        if (item.is_playing) {
            classes.push('is-playing');
        }
        // is_next might be less relevant now, but keep if needed
        // if (item.is_next) classes.push('is-next');
        if (classes.length > 0) {
            li.className = classes.join(' ');
        }

        li.innerHTML = `
            <span class="item-info">
                <span class="item-title">${item.title || 'Unknown Title'}</span>
                <span class="item-artist">${item.artist || 'Unknown Artist'}</span>
            </span>
            <div class="actions">
                ${item.has_file ? '' : '<span class="file-missing">(No File)</span>'}
                <button type="button" class="remove-queue-button" data-item-id="${item.id}" title="Remove from queue">×</button>
            </div>
        `;

        // Attach remove listener
        const removeButton = li.querySelector('.remove-queue-button');
        if (removeButton) {
            removeButton.addEventListener('click', handleRemoveFromQueueClick);
        }

        // Optional: Add click listener to play song from queue list
        if (item.has_file) {
            li.addEventListener('click', async (event) => { // Make listener async
                if (!event.target.closest('.remove-queue-button')) {
                    // --- Play from queue item click ---
                    // DO NOT send clear_queue: true here
                    console.log(`Queue item clicked: Song ID ${item.song_id}. Calling set_playing (NO clear)...`);
                    try {
                        const response = await fetch(`/queue/set_playing/${item.song_id}/`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json', // Ensure header is set
                                'X-CSRFToken': csrftoken
                            },
                            // NO body: JSON.stringify({ clear_queue: true }) here
                        });
                        const data = await response.json();
                        if (response.ok && data.status === 'success') {
                            console.log("Backend queue state updated successfully via queue item click.");
                            // Now play the song - Ensure item has necessary details or fetch them
                            // Assuming 'item' has url, title, artist, cover, song_id
                            const coverUrl = item.cover || (playerCoverArt ? playerCoverArt.src : placeholderCoverSrc); // Get cover from item or fallback
                            playSong(item.url, item.title, item.artist, coverUrl, item.song_id);
                        } else {
                            console.error("Failed to update backend queue state via queue item click:", data.message);
                            // Play anyway?
                            const coverUrl = item.cover || (playerCoverArt ? playerCoverArt.src : placeholderCoverSrc);
                            playSong(item.url, item.title, item.artist, coverUrl, item.song_id);
                        }
                    } catch (error) {
                        console.error("Error calling set_playing endpoint from queue item click:", error);
                        // Play anyway?
                        const coverUrl = item.cover || (playerCoverArt ? playerCoverArt.src : placeholderCoverSrc);
                        playSong(item.url, item.title, item.artist, coverUrl, item.song_id);
                    }
                    hideQueue(); // Close modal for now
                }
            });
            li.style.cursor = 'pointer';
        }
        return li;
    }

    // --- Helper Function to Populate Queue List with Sections ---
    function populateQueueList(queueItems, currentlyPlayingOrder) {
        if (!queueList) return;
        queueList.innerHTML = ''; // Clear previous items

        if (!queueItems || queueItems.length === 0) {
            console.log("Queue is empty.");
            queueList.innerHTML = '<li class="empty-queue">Queue is empty.</li>';
            return;
        }

        // --- DIAGNOSTIC LOGGING START ---
        const playerSrc = audioPlayer ? audioPlayer.src : 'N/A';
        const hasValidSrc = audioPlayer && playerSrc && playerSrc !== window.location.href; // Check if src is valid and not just the base URL
        console.log(`Populating queue list. Player valid src: ${hasValidSrc} (Actual src: '${playerSrc}'). Current Order from backend: ${currentlyPlayingOrder}`);
        // --- DIAGNOSTIC LOGGING END ---

        // --- MODIFICATION START ---
        // Adjust filtering based on whether the queue just ended (currentlyPlayingOrder is 0 but player is stopped)
        let previousItems = [];
        let nowPlayingItem = null;
        let nextItems = [];

        if (currentlyPlayingOrder === 0 && !hasValidSrc && queueItems.length > 0) {
            // Special case: Queue just ended, player stopped. Treat all items as previous.
            console.log("Queue ended state detected (order 0, no valid src). Treating all items as previous.");
            previousItems = [...queueItems].sort((a, b) => a.order - b.order); // Copy and sort all items
            nowPlayingItem = null; // Explicitly null
            nextItems = []; // Explicitly empty
        } else {
            // Normal filtering based on currentlyPlayingOrder
            previousItems = queueItems.filter(item => item.order < currentlyPlayingOrder).sort((a, b) => a.order - b.order);
            nowPlayingItem = queueItems.find(item => item.order === currentlyPlayingOrder);
            nextItems = queueItems.filter(item => item.order > currentlyPlayingOrder).sort((a, b) => a.order - b.order);
        }
        // --- MODIFICATION END ---


        // --- DIAGNOSTIC LOGGING START ---
        console.log(`Found ${previousItems.length} previous, ${nowPlayingItem ? `1 now playing (Order ${currentlyPlayingOrder}, Title: ${nowPlayingItem.title})` : '0 now playing'}, ${nextItems.length} next items.`);
        // --- DIAGNOSTIC LOGGING END ---

        let contentAdded = false;

        // 1. Now Playing Section
        if (hasValidSrc && nowPlayingItem) {
            // --- Render 'Now Playing' section (Player is active and item exists) ---
            console.log("Condition met: Render 'Now Playing' section.");
            const header = document.createElement('li');
            header.className = 'queue-section-header';
            header.textContent = 'Now Playing';
            queueList.appendChild(header);
            const li = createQueueListItem(nowPlayingItem);
            queueList.appendChild(li);
            contentAdded = true;
        // } else if (!hasValidSrc && currentlyPlayingOrder > 0) { // Original condition - REMOVED
        // } else if (!nowPlayingItem && currentlyPlayingOrder === 0) { // Original condition - REMOVED
        // --- MODIFICATION START ---
        // Simplified condition: If not actively playing, show placeholder
        } else if (!hasValidSrc) {
            // --- Render 'No track playing' placeholder (Player stopped or initial state) ---
             console.log("Condition met: No valid player source. Render 'No track playing'.");
             const header = document.createElement('li');
             header.className = 'queue-section-header';
             header.textContent = 'Now Playing';
             queueList.appendChild(header);
             const placeholder = document.createElement('li');
             placeholder.className = 'empty-queue';
             placeholder.textContent = 'No track playing';
             placeholder.style.fontStyle = 'normal';
             queueList.appendChild(placeholder);
             contentAdded = true;
        // --- MODIFICATION END ---
        } else {
             console.log("Condition not met for 'Now Playing' or 'No track playing' placeholder.");
        }


        // 2. Next Up Section
        if (nextItems.length > 0) {
            // --- DIAGNOSTIC LOGGING START ---
            console.log(`Rendering 'Next Up' section with ${nextItems.length} items.`);
            // --- DIAGNOSTIC LOGGING END ---
            const header = document.createElement('li');
            header.className = 'queue-section-header';
            header.textContent = 'Next Up';
            queueList.appendChild(header);

            nextItems.forEach(item => {
                const li = createQueueListItem(item);
                queueList.appendChild(li);
            });
            contentAdded = true;
        } else {
             // --- DIAGNOSTIC LOGGING START ---
             console.log("No items to render in 'Next Up' section.");
             // --- DIAGNOSTIC LOGGING END ---
        }

        // 3. Previously Played Section
        // This section now correctly includes all items when the queue has just ended
        if (previousItems.length > 0) {
             // --- DIAGNOSTIC LOGGING START ---
            console.log(`Rendering 'Previously Played' section with ${previousItems.length} items.`);
             // --- DIAGNOSTIC LOGGING END ---
            const header = document.createElement('li');
            header.className = 'queue-section-header';
            header.textContent = 'Previously Played';
            queueList.appendChild(header);

            // Display previously played items (including the one that was just playing if player stopped)
            previousItems.forEach(item => {
                const li = createQueueListItem(item);
                // Ensure 'is-playing' class is NOT added here, even if backend flag is somehow stuck
                li.classList.remove('is-playing');
                queueList.appendChild(li);
            });
            contentAdded = true;
        } else {
             // --- DIAGNOSTIC LOGGING START ---
            console.log("No items to render in 'Previously Played' section.");
             // --- DIAGNOSTIC LOGGING END ---
        }

        // Fallback if filtering somehow resulted in no content
        if (!contentAdded && queueItems.length > 0) { // Check queueItems length again
             // --- DIAGNOSTIC LOGGING START ---
             console.log("Fallback: Displaying all items generically.");
             // --- DIAGNOSTIC LOGGING END ---
             const header = document.createElement('li');
             header.className = 'queue-section-header';
             header.textContent = 'Queue';
             queueList.appendChild(header);
             queueItems.sort((a,b) => a.order - b.order).forEach(item => {
                 const li = createQueueListItem(item);
                 queueList.appendChild(li);
             });
        } else if (!contentAdded) {
             // --- DIAGNOSTIC LOGGING START ---
             console.log("No content added and queueItems is empty or fallback failed.");
             // --- DIAGNOSTIC LOGGING END ---
             queueList.innerHTML = '<li class="empty-queue">Queue is empty or state is inconsistent.</li>';
        }
    }

    // --- Helper Function to Refresh Queue Modal if Visible ---
    async function refreshQueueModal() {
        // Only refresh if the modal exists and is currently visible
        if (queueModal && queueModal.classList.contains('visible')) {
            console.log("Refreshing queue modal content...");
            try {
                const response = await fetch('/queue/view/', {
                    method: 'GET',
                    headers: { 'Accept': 'application/json', 'X-CSRFToken': csrftoken }
                });
                const data = await response.json();
                if (response.ok && data.status === 'success') {
                    // Pass both queue items and the current order
                    populateQueueList(data.queue, data.currently_playing_order);
                } else {
                    console.error("Failed to refresh queue:", data.message);
                    if (queueList) queueList.innerHTML = '<li class="empty-queue">Error refreshing queue.</li>';
                }
            } catch (error) {
                console.error("Error fetching queue for refresh:", error);
                if (queueList) queueList.innerHTML = '<li class="empty-queue">Error refreshing queue.</li>';
            }
        } else {
            console.log("Queue modal not visible, skipping refresh.");
        }
    }

    // Function to play a specific song
    function playSong(url, title, artist, coverUrl, songId = null) { // Added songId
        if (!audioPlayer) return;
        console.log(`Playing: ${title} - ${artist} (ID: ${songId})`); // Log playing song
        audioPlayer.src = url;
        audioPlayer.play().catch(e => console.error("Error playing audio:", e)); // Catch potential play errors
        currentTrackTitle.textContent = title || 'Unknown Title';
        currentTrackArtist.textContent = artist || 'Unknown Artist';
        if (playerCoverArt) { // Update cover art
            playerCoverArt.src = coverUrl || placeholderCoverSrc; // Use provided cover or fallback to placeholder
        }
        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'inline-block';
        // Refresh queue after starting playback (to update 'is-playing' status)
        refreshQueueModal(); // Add this call
    }

    // Function to add song to queue via API
    async function addToQueue(songId) {
        if (!songId) return;
        console.log(`Adding song ${songId} to queue...`);
        try {
            const response = await fetch(`/queue/add/${songId}/`, { // Use correct URL
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                // body: JSON.stringify({}) // No body needed for this simple add
            });
            const data = await response.json();
            if (response.ok && data.status === 'success') {
                console.log(data.message);
                refreshQueueModal(); // Refresh modal on success
                // Optionally: Show a success notification to the user
            } else {
                console.error("Failed to add to queue:", data.message);
                // Optionally: Show an error notification
            }
        } catch (error) {
            console.error("Error calling add to queue API:", error);
            // Optionally: Show an error notification
        }
    }

    // Function to get and play the next song from the queue
    async function playNextFromQueue() {
        console.log("Attempting to play next song from queue...");
        try {
            const response = await fetch('/queue/next/', { // Use correct URL
                method: 'GET', // Or POST if you prefer
                headers: {
                    'Accept': 'application/json',
                    'X-CSRFToken': csrftoken // May not be needed for GET, but doesn't hurt
                }
            });
            const data = await response.json();

            if (response.ok && data.status === 'success' && data.song && data.song.url) {
                console.log("Next song data:", data.song);
                playSong(data.song.url, data.song.title, data.song.artist, data.song.cover, data.song.id); // Pass ID
                // playSong already calls refreshQueueModal
            } else if (data.status === 'end_of_queue') {
                console.log("End of queue reached.");
                // Reset player UI to default state
                resetPlayerUI();
                // Refresh the modal - it will show the last played song in "Previously Played"
                // based on the backend state fetched by refreshQueueModal.
                refreshQueueModal();
            } else {
                 console.warn("Could not get next song:", data.message || "Unknown reason");
                 // Handle 'no_file' or other errors if needed
                 if (data.status === 'no_file') {
                     resetPlayerUI();
                     refreshQueueModal(); // Refresh to show state after reset
                 }
            }
        } catch (error) {
            console.error("Error fetching next song from queue:", error);
            // Optionally reset UI on error too
            resetPlayerUI();
            refreshQueueModal(); // Refresh after reset on error
        }
    }

    // --- New function playPreviousFromQueue ---
    async function playPreviousFromQueue() {
        console.log("Attempting to play previous song from queue...");
        try {
            const response = await fetch('/queue/previous/', { // Use correct URL
                method: 'GET', // Or POST if you prefer
                headers: { 'Accept': 'application/json', 'X-CSRFToken': csrftoken }
            });
            const data = await response.json();

            if (response.ok && data.status === 'success' && data.song && data.song.url) {
                console.log("Previous song data:", data.song);
                playSong(data.song.url, data.song.title, data.song.artist, data.song.cover, data.song.id); // Pass ID
                // playSong already calls refreshQueueModal
            } else if (data.status === 'start_of_queue') {
                // --- MODIFICATION START ---
                // Don't reset the player, just log it. Restart current song if playing > 3s.
                console.log("Start of queue reached.");
                if (audioPlayer && !audioPlayer.paused && audioPlayer.currentTime > 3) { // Check if playing and past 3 seconds
                     console.log("Restarting current track.");
                     audioPlayer.currentTime = 0; // Seek to beginning
                } else {
                     // Otherwise (paused, stopped, or very beginning of song), do nothing
                     console.log("Already at start or paused/stopped, doing nothing.");
                }
                // resetPlayerUI(); // REMOVED reset on start_of_queue
                // refreshQueueModal(); // No state change that requires modal refresh
                // --- MODIFICATION END ---
            } else {
                // Handle other non-success statuses like 'no_file' or potential future ones
                console.error("Failed to get previous song:", data.message || 'Unknown error');
                // Optionally reset UI on specific errors, but not 'start_of_queue'
                // resetPlayerUI(); // Consider if reset is needed for 'no_file' etc.
                // refreshQueueModal(); // Refresh if UI might need updating due to error
            }
        } catch (error) {
            console.error("Error fetching previous song from queue:", error);
            // Optionally reset UI on fetch error too
            resetPlayerUI(); // Keep reset on fetch error
            refreshQueueModal(); // Refresh after reset on error
        }
    }

    // --- Function to remove song from queue via API ---
    async function removeFromQueue(itemId) {
        if (!itemId) return;
        console.log(`Removing queue item ${itemId}...`);
        try {
            const response = await fetch(`/queue/remove/${itemId}/`, {
                method: 'DELETE', // Use DELETE method
                headers: {
                    'Content-Type': 'application/json', // Optional, but good practice
                    'X-CSRFToken': csrftoken
                }
            });
            const data = await response.json();
            if (response.ok && data.status === 'success') {
                console.log(data.message);
                // --- MODIFICATION START ---
                // Refresh the modal instead of manually removing the item
                refreshQueueModal();
                // --- MODIFICATION END ---
            } else {
                console.error("Failed to remove from queue:", data.message);
                // Optionally: Show an error notification
            }
        } catch (error) {
            console.error("Error calling remove from queue API:", error);
            // Optionally: Show an error notification
        }
    }

    // --- Event Handler for Remove Button Click ---
    function handleRemoveFromQueueClick(event) {
        // Prevent click from bubbling up to the li's play listener
        event.stopPropagation();
        const button = event.currentTarget;
        const itemId = button.dataset.itemId;
        button.disabled = true; // Prevent double clicks
        removeFromQueue(itemId).finally(() => {
             // Re-enable button slightly later in case of error display
             setTimeout(() => { button.disabled = false; }, 500);
        });
    }

    // --- New function showQueue ---
    async function showQueue() {
        console.log("showQueue function called."); // Log function entry
        if (!queueModal || !queueList) {
            console.error("Queue modal or list element not found!"); // Log if elements are missing
            return;
        }
        console.log("Queue modal element:", queueModal); // Log the modal element

        queueList.innerHTML = '<li class="loading-placeholder">Loading queue...</li>'; // Show loading state

        // --- MODIFICATION START ---
        // Explicitly set display style to override potential inline styles
        queueModal.style.display = 'flex'; // Or 'block' if flex isn't needed for the container itself
        // Force repaint/reflow before adding class for transition
        void queueModal.offsetWidth;
        // --- MODIFICATION END ---

        queueModal.classList.add('visible'); // Add class for opacity transition
        console.log("Set display to flex/block and added 'visible' class. Opacity:", window.getComputedStyle(queueModal).opacity, "Display:", window.getComputedStyle(queueModal).display); // Log class addition and computed styles

        try {
            console.log("Fetching queue from /queue/view/"); // Log before fetch
            const response = await fetch('/queue/view/', {
                method: 'GET',
                headers: { 'Accept': 'application/json', 'X-CSRFToken': csrftoken }
            });
            console.log("Fetch response status:", response.status); // Log response status
            const data = await response.json();
            console.log("Queue data received:", data); // Log received data

            if (response.ok && data.status === 'success') {
                // --- MODIFICATION START ---
                // Use the helper function to populate
                populateQueueList(data.queue, data.currently_playing_order);
                // --- MODIFICATION END ---
            } else {
                console.error("Failed to load queue:", data.message); // Log failure
                queueList.innerHTML = '<li class="empty-queue">Error loading queue.</li>';
            }
        } catch (error) {
            console.error("Error fetching or processing queue:", error); // Log fetch/processing error
            queueList.innerHTML = '<li class="empty-queue">Error loading queue.</li>';
        }
    }

    // --- New function hideQueue ---
    function hideQueue() {
        console.log("hideQueue function called."); // Log hide function
        if (queueModal) {
            queueModal.classList.remove('visible'); // Remove class for opacity transition
            // --- MODIFICATION START ---
            // Use a timeout to allow the opacity transition to finish before setting display: none
            // The timeout duration should match the CSS transition duration (0.3s = 300ms)
            setTimeout(() => {
                queueModal.style.display = 'none';
                console.log("Set display to none after transition."); // Log style change
            }, 300); // Match CSS transition duration
            // --- MODIFICATION END ---
            console.log("Removed 'visible' class from queue modal."); // Log class removal
        }
    }

    // --- Function to Initialize Event Listeners on Content ---
    function initializeEventListeners(container) {
        console.log("Initializing listeners within container:", container); // Log container

        // Event listener for play buttons
        const playButtons = container.querySelectorAll('.play-button'); // Get the NodeList
        console.log(`Found ${playButtons.length} elements with class 'play-button'`); // Log count

        playButtons.forEach((button, index) => {
            // --- MODIFICATION START: Log button details during listener attachment ---
            const songId = button.dataset.songId;
            console.log(`Attaching listener to play button ${index + 1}:`, button);
            if (songId) {
                console.log(`  - Found data-song-id: ${songId}`);
            } else {
                console.warn(`  - WARNING: data-song-id NOT FOUND for this play button at attachment time.`);
                console.log(`  - Button HTML: ${button.outerHTML}`); // Log outer HTML for context
            }
            // --- MODIFICATION END ---

            // Remove existing listener first to prevent duplicates if re-initializing
            button.removeEventListener('click', handlePlayButtonClick);
            button.addEventListener('click', handlePlayButtonClick);
        });

        // Event listener for Add to Queue buttons
        container.querySelectorAll('.add-queue-button').forEach(button => {
            // ... (no changes needed here) ...
            button.removeEventListener('click', handleAddToQueueClick);
            button.addEventListener('click', handleAddToQueueClick);
        });

        // Event listener for AJAX navigation links
        container.querySelectorAll('a.ajax-link').forEach(link => {
            // ... (no changes needed here) ...
            link.removeEventListener('click', handleAjaxLinkClick);
            link.addEventListener('click', handleAjaxLinkClick);
        });

        // Add listeners for other interactive elements within the container if needed

        // Note: Player control buttons (prev, play/pause, next, queue toggle) are outside
        // the main content, so they don't need to be re-initialized here.
    }

    // --- Event Handlers (extracted for re-use) ---
    async function handlePlayButtonClick() { // Make handler async
        const button = this; // Reference the button
        const songUrl = button.dataset.songUrl;
        const songTitle = button.dataset.songTitle;
        const songArtist = button.dataset.songArtist;
        const songCover = button.dataset.songCover;
        const songId = button.dataset.songId; // Make sure buttons have data-song-id

        if (!songId) {
            console.error("Play button clicked, but data-song-id is missing!");
            return;
        }

        if (songUrl) {
            // Disable button temporarily
            button.disabled = true;
            console.log(`Play button clicked: Song ID ${songId}. Calling set_playing endpoint...`); // Keep this log

            // --- MODIFICATION START: Log the data being sent ---
            const requestData = { clear_queue: true };
            console.log("Fetch body data:", JSON.stringify(requestData));
            // --- MODIFICATION END ---

            try {
                const response = await fetch(`/queue/set_playing/${songId}/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json', // Set Content-Type for JSON body
                        'X-CSRFToken': csrftoken
                    },
                    // This line ensures the queue is cleared by the backend
                    body: JSON.stringify(requestData) // Send clear_queue flag
                });
                const data = await response.json();
                if (response.ok && data.status === 'success') {
                    console.log("Backend queue state updated successfully:", data.message); // Log success message
                    // Now play the song
                    playSong(songUrl, songTitle, songArtist, songCover, songId);
                } else {
                    console.error("Failed to update backend queue state:", data.message);
                    // Play anyway? Consider if this is desired on failure.
                    playSong(songUrl, songTitle, songArtist, songCover, songId);
                }
            } catch (error) {
                console.error("Error calling set_playing endpoint:", error);
                 // Play anyway? Consider if this is desired on failure.
                 playSong(songUrl, songTitle, songArtist, songCover, songId);
            } finally {
                 // Re-enable button after a short delay
                 setTimeout(() => { button.disabled = false; }, 500);
            }
        } else {
            console.error("Song URL not found for this button.");
        }
    }

    function handleAddToQueueClick() {
        const songId = this.dataset.songId;
        addToQueue(songId);
        this.disabled = true;
        setTimeout(() => { this.disabled = false; }, 1000);
    }

    async function handleAjaxLinkClick(event) {
        event.preventDefault(); // Prevent default link navigation
        const url = this.dataset.targetUrl || this.href; // Get URL from data attribute or href
        if (!url) return;

        console.log(`AJAX Navigation to: ${url}`);
        // Optional: Add a loading indicator
        if (mainContent) mainContent.style.opacity = '0.5';


        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest' // Identify as AJAX request (optional for server)
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Extract new content and title
            const newContent = doc.getElementById('main-content');
            const newTitle = doc.querySelector('title');

            if (mainContent && newContent) {
                mainContent.innerHTML = newContent.innerHTML; // Replace content
                // Update page title
                document.title = newTitle ? newTitle.textContent : 'Music Player';
                // Update browser history
                history.pushState({path: url}, '', url);
                // Re-initialize event listeners for the new content
                initializeEventListeners(mainContent);
                // Scroll to top after loading new content
                window.scrollTo(0, 0);
            } else {
                console.error("Could not find #main-content in fetched HTML or current page.");
                // Fallback to full page load?
                // window.location.href = url;
            }

        } catch (error) {
            console.error('Error fetching page content via AJAX:', error);
            // Fallback to full page load on error
            window.location.href = url;
        } finally {
            // Optional: Remove loading indicator
             if (mainContent) mainContent.style.opacity = '1';
        }
    }

    // --- Function to Load Initial Player State ---
    async function loadInitialPlayerState() {
        console.log("Loading initial player state...");
        try {
            const response = await fetch('/queue/view/', {
                method: 'GET',
                headers: { 'Accept': 'application/json', 'X-CSRFToken': csrftoken }
            });
            const data = await response.json();

            if (response.ok && data.status === 'success' && data.currently_playing_song) {
                const song = data.currently_playing_song;
                console.log("Found previously playing song:", song);
                if (song.url) {
                    // Load the song details into the player UI *without* auto-playing yet
                    currentTrackTitle.textContent = song.title || 'Unknown Title';
                    currentTrackArtist.textContent = song.artist || 'Unknown Artist';
                    if (playerCoverArt) {
                        playerCoverArt.src = song.cover || placeholderCoverSrc;
                    }
                    audioPlayer.src = song.url; // Set the source

                    // Wait for metadata to load to set duration and potentially seek bar
                    audioPlayer.addEventListener('loadedmetadata', () => {
                        console.log("Metadata loaded for initial song.");
                        durationDisplay.textContent = formatTime(audioPlayer.duration);
                        // TODO: If we stored currentTime, we could set it here
                        // audioPlayer.currentTime = storedTime;
                        // seekBar.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
                        currentTimeDisplay.textContent = formatTime(audioPlayer.currentTime); // Show 0:00 initially

                        // Now attempt to play
                        console.log("Attempting to play initial song...");
                        audioPlayer.play().then(() => {
                            // Play started successfully
                            console.log("Initial song playback started.");
                            if (playIcon) playIcon.style.display = 'none';
                            if (pauseIcon) pauseIcon.style.display = 'inline-block';
                        }).catch(e => {
                            // Play failed (likely autoplay policy)
                            console.warn("Could not auto-play initial song (Browser policy likely). User interaction required.", e.name, e.message);
                            // Ensure UI shows the play button, indicating it's ready but paused
                            if (playIcon) playIcon.style.display = 'inline-block';
                            if (pauseIcon) pauseIcon.style.display = 'none';
                            // Optional: Display a subtle message to the user near the player?
                            // e.g., currentTrackArtist.textContent += " (Click play to start)";
                        });

                    }, { once: true });

                } else {
                    console.log("Previously playing song has no file URL.");
                    // Ensure default state if no URL
                    if (playIcon) playIcon.style.display = 'inline-block';
                    if (pauseIcon) pauseIcon.style.display = 'none';
                }
            } else {
                console.log("No previously playing song found or error loading queue state.");
                // Ensure default state is shown using the helper function
                resetPlayerUI();
            }
        } catch (error) {
            console.error("Error fetching initial queue state:", error);
            // Ensure default state on error using the helper function
            resetPlayerUI();
        }
    }

    // --- Initial Event Listener Setup ---
    // Initialize listeners for the initially loaded content
    if (mainContent) {
        initializeEventListeners(mainContent);
    } else {
        // If mainContent isn't found, maybe initialize on document body?
        // Be careful with this as it might attach listeners to the player itself.
        console.warn("#main-content container not found on initial load.");
        initializeEventListeners(document.body); // Less ideal, but might catch some links
    }

    // --- Player Controls Event Listeners (Attach ONCE) ---
    // Play/Pause button functionality
    if (playPauseButton && audioPlayer) {
        playPauseButton.addEventListener('click', function() {
            if (audioPlayer.paused || audioPlayer.ended) {
                if (audioPlayer.src) { // Only play if there's a source
                    audioPlayer.play();
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
        console.log("Attaching listener to Show Queue button."); // Log listener attachment
        showQueueButton.addEventListener('click', showQueue);
    } else {
        console.error("Show Queue button not found!"); // Log if button missing
    }

    // Close Queue Button
    if (closeQueueButton) {
        console.log("Attaching listener to Close Queue button."); // Log listener attachment
        closeQueueButton.addEventListener('click', hideQueue);
    } else {
        console.error("Close Queue button not found!"); // Log if button missing
    }

    // Close modal if clicking outside the content area
    if (queueModal) {
        console.log("Attaching backdrop click listener to Queue modal."); // Log listener attachment
        queueModal.addEventListener('click', function(event) {
            if (event.target === queueModal) { // Check if click is on the backdrop
                console.log("Backdrop clicked."); // Log backdrop click
                hideQueue();
            }
        });
    } else {
        console.error("Queue modal not found for backdrop listener!"); // Log if modal missing
    }

    // Update UI on play/pause events
    if (audioPlayer) {
        audioPlayer.addEventListener('play', function() {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'inline-block';
        });

        audioPlayer.addEventListener('pause', function() {
            playIcon.style.display = 'inline-block';
            pauseIcon.style.display = 'none';
            // Optional: Reset cover if paused and source is cleared? For now, only on 'ended'.
        });

        // Update seek bar and time displays
        audioPlayer.addEventListener('timeupdate', function() {
            if (!isSeeking && audioPlayer.duration) {
                const percentage = (audioPlayer.currentTime / audioPlayer.duration) * 100;
                seekBar.value = percentage;
                currentTimeDisplay.textContent = formatTime(audioPlayer.currentTime);
            }
        });

        // Update duration display when metadata loads
        audioPlayer.addEventListener('loadedmetadata', function() {
            durationDisplay.textContent = formatTime(audioPlayer.duration);
            seekBar.value = 0; // Reset seek bar
            currentTimeDisplay.textContent = formatTime(0); // Reset current time
        });

        // Handle seek bar interaction
        if (seekBar) {
            seekBar.addEventListener('input', function() {
                isSeeking = true; // Indicate user is actively seeking
                // Optional: Update current time display while seeking
                // const seekTime = (seekBar.value / 100) * audioPlayer.duration;
                // currentTimeDisplay.textContent = formatTime(seekTime || 0);
            });

            seekBar.addEventListener('change', function() {
                if (audioPlayer.duration) {
                    const seekTime = (seekBar.value / 100) * audioPlayer.duration;
                    audioPlayer.currentTime = seekTime;
                }
                isSeeking = false; // Seeking finished
            });
        }

        // Handle volume control
        if (volumeBar) {
            // Set initial volume based on slider value and update icon
            const initialVolume = parseFloat(volumeBar.value);
            audioPlayer.volume = initialVolume;
            updateVolumeIcon(initialVolume); // Set initial icon

            volumeBar.addEventListener('input', function() {
                const newVolume = parseFloat(this.value);
                audioPlayer.volume = newVolume;
                updateVolumeIcon(newVolume); // Update icon on change
            });
        }

        // Handle song ending - MODIFIED to play next from queue AND refresh modal
        audioPlayer.addEventListener('ended', function() {
            console.log("Song ended.");
            playNextFromQueue().then(() => {
                // Refresh the modal after attempting to play the next song
                // Note: playNextFromQueue itself calls refreshQueueModal on success/failure,
                // so this might be redundant, but ensures refresh even if playNextFromQueue had an early exit.
                // Consider if this extra call is needed based on playNextFromQueue's robustness.
                // For now, let's keep it simple and rely on the calls within playNextFromQueue.
                // refreshQueueModal(); // Potentially redundant, removed for now.
            });
        });
    } else {
        // If audio player doesn't exist, still set initial volume icon based on slider default
        if (volumeBar) {
            updateVolumeIcon(parseFloat(volumeBar.value));
        }
    }

    // --- Initial Player Setup ---
    if (volumeBar) {
        updateVolumeIcon(parseFloat(volumeBar.value));
    }
    // Load the initial state (check for currently playing song)
    loadInitialPlayerState(); // Call the new function

    // Handle browser back/forward buttons
    window.addEventListener('popstate', function(event) {
        // When the user navigates back/forward, the 'popstate' event fires.
        // We need to reload the content for the state's path.
        console.log('Popstate event:', event.state);
        if (event.state && event.state.path) {
            // Re-trigger the AJAX load for the path stored in the state
            // Fake a click event object for handleAjaxLinkClick
             handleAjaxLinkClick({
                 preventDefault: () => {}, // Mock preventDefault
                 currentTarget: { // Mock the link element
                     dataset: { targetUrl: event.state.path },
                     href: event.state.path
                 }
             });
        } else {
            // If no state, maybe reload the current window location?
            // This might happen if the initial page load wasn't pushed to history.
            // window.location.reload();
        }
    });

    // Push the initial state when the page first loads
    if (history.state === null) {
        history.replaceState({ path: window.location.href }, '', window.location.href);
    }

});
