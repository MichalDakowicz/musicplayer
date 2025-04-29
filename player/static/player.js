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

    // Volume Icon References
    const volumeMuteIcon = document.getElementById('volume-mute-icon');
    const volumeLowIcon = document.getElementById('volume-low-icon');
    const volumeHighIcon = document.getElementById('volume-high-icon');
    const volumeIcons = [volumeMuteIcon, volumeLowIcon, volumeHighIcon]; // Array for easy iteration

    let isSeeking = false;

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


    // Function to play a specific song
    function playSong(url, title, artist, coverUrl) { // Added coverUrl parameter
        if (!audioPlayer) return;
        audioPlayer.src = url;
        audioPlayer.play();
        currentTrackTitle.textContent = title || 'Unknown Title';
        currentTrackArtist.textContent = artist || 'Unknown Artist';
        if (playerCoverArt) { // Update cover art
            playerCoverArt.src = coverUrl || placeholderCoverSrc; // Use provided cover or fallback to placeholder
        }
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'inline-block';
    }

    // Event listener for play buttons in lists
    document.querySelectorAll('.play-button').forEach(button => {
        button.addEventListener('click', function() {
            const songUrl = this.dataset.songUrl;
            const songTitle = this.dataset.songTitle;
            const songArtist = this.dataset.songArtist;
            const songCover = this.dataset.songCover; // Get cover URL
            if (songUrl) {
                playSong(songUrl, songTitle, songArtist, songCover); // Pass cover URL
            } else {
                console.error("Song URL not found for this button.");
            }
        });
    });

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

        // Handle song ending
        audioPlayer.addEventListener('ended', function() {
            playIcon.style.display = 'inline-block';
            pauseIcon.style.display = 'none';
            seekBar.value = 0;
            currentTimeDisplay.textContent = formatTime(0);
            if (playerCoverArt) { // Reset cover art to placeholder
                playerCoverArt.src = placeholderCoverSrc;
            }
            // Optionally: Reset title/artist display
            // currentTrackTitle.textContent = 'No track selected';
            // currentTrackArtist.textContent = '';
            // Optionally: Play next song in a queue here
        });
    } else {
        // If audio player doesn't exist, still set initial volume icon based on slider default
        if (volumeBar) {
            updateVolumeIcon(parseFloat(volumeBar.value));
        }
    }
});
