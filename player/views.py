from django.shortcuts import render, redirect, get_object_or_404 # Add get_object_or_404
from django.http import HttpResponse, HttpResponseServerError, HttpResponseRedirect # Add HttpResponseRedirect
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.csrf import csrf_exempt, csrf_protect # Import csrf_protect
from django.views.decorators.http import require_POST # Add require_POST
from django.conf import settings
from django.utils.text import slugify
from datetime import timedelta, date # Added date
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import subprocess # For running spotdl
import os
import requests # For downloading images
from django.core.files.base import ContentFile
import re # For parsing URLs
import unicodedata # Import for slugify improvement


from .forms import LoginForm, SpotifyUrlForm # Import the new form
from .models import Artist, Album, Song, EP, Single, Playlist, Library # Import models

# Spotify Client Setup
try:
    # Ensure your credentials in settings.py are correct
    if settings.SPOTIPY_CLIENT_ID == 'YOUR_SPOTIFY_CLIENT_ID' or not settings.SPOTIPY_CLIENT_ID:
        print("WARNING: Spotify Client ID not configured in settings.py")
        sp = None
    else:
        client_credentials_manager = SpotifyClientCredentials(client_id=settings.SPOTIPY_CLIENT_ID, client_secret=settings.SPOTIPY_CLIENT_SECRET)
        sp = spotipy.Spotify(client_credentials_manager=client_credentials_manager)
except Exception as e:
    print(f"Error initializing Spotify client: {e}")
    sp = None # Set sp to None if initialization fails

# Helper function to download image - MODIFIED
def download_image(url, obj, field_name, save_name):
    """Downloads image, assigns ContentFile to obj.field_name, returns True on success."""
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()

        # Create a ContentFile from the response content
        img_content = ContentFile(response.content)

        # Assign the ContentFile to the object's field attribute directly
        # The actual saving to storage happens when obj.save() is called later
        setattr(obj, field_name, img_content)
        # Store the intended save name separately if needed, though Django handles naming
        # obj._image_save_name = save_name # Example if needed elsewhere

        print(f"Image content prepared for {field_name} on object {obj.pk or '(unsaved)'}")
        return True # Indicate success in preparing the image content

    except requests.exceptions.RequestException as e:
        print(f"Error downloading image {url}: {e}")
        return False
    except Exception as e:
        print(f"Error preparing image content for {url}: {e}")
        return False

# Helper function to parse release date
def parse_release_date(release_date_str):
    if not release_date_str:
        return None
    try:
        parts = release_date_str.split('-')
        if len(parts) == 1: # YYYY
            return date(int(parts[0]), 1, 1)
        elif len(parts) == 2: # YYYY-MM
            return date(int(parts[0]), int(parts[1]), 1)
        else: # YYYY-MM-DD
            return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except (ValueError, TypeError):
        print(f"Could not parse date: {release_date_str}")
        return None # Invalid date format or type

# Slightly improved slugify function (handles Unicode better)
def better_slugify(value):
    """
    Convert spaces or repeated dashes to single dashes. Remove characters that
    aren't alphanumerics, underscores, or hyphens. Convert to lowercase. Also strip leading/trailing whitespace.
    Handles Unicode characters.
    """
    value = str(value)
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s-]', '', value).strip().lower()
    return re.sub(r'[-\s]+', '-', value)


# Helper function to run SpotDL and find file - MODIFIED
def run_spotdl_and_get_path(spotify_url, track_id, expected_title=None, expected_artist=None):
    """Runs spotdl and attempts to find the downloaded file relative to MEDIA_ROOT."""
    os.makedirs(settings.SPOTDL_DOWNLOAD_PATH, exist_ok=True)
    # Try using {track-id} instead of {id}. If spotdl errors, remove it.
    # If removing, the finding logic will rely more heavily on title/artist matching.
    output_format = os.path.join(settings.SPOTDL_DOWNLOAD_PATH, "{artist}/{album}/{title} [{track-id}].{output-ext}")
    # Alternative if {track-id} causes errors:
    # output_format = os.path.join(settings.SPOTDL_DOWNLOAD_PATH, "{artist}/{album}/{title}.{output-ext}")

    cmd = [
        'spotdl',
        spotify_url,
        '--output', output_format,
        # '--log-level', 'DEBUG'
    ]
    print(f"Running command: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace')
        print(f"SpotDL Success Output:\n{result.stdout}") # Print full stdout
    except subprocess.CalledProcessError as e:
        print(f"SpotDL Error Output:\n{e.stderr}") # Print full stderr
        # Check if error is due to invalid output format placeholder
        if "ValueError: Invalid format specifier" in e.stderr or "unknown placeholder" in e.stderr.lower():
             print("WARNING: SpotDL output format might be invalid (e.g., {track-id} not supported). Consider simplifying the format string.")
        raise Exception(f"SpotDL failed (return code {e.returncode}). Check logs. Error hint: {e.stderr[:500]}...")
    except FileNotFoundError:
        raise Exception("SpotDL command not found. Is spotdl installed and in your system's PATH?")


    # --- File Finding Logic ---
    search_dir = settings.SPOTDL_DOWNLOAD_PATH
    found_file_relative_path = None
    print(f"\nSearching for file containing ID '{track_id}' in '{search_dir}' and subdirectories...")

    slug_title = better_slugify(expected_title) if expected_title else None
    slug_artist = better_slugify(expected_artist) if expected_artist else None

    possible_matches = []
    checked_files_count = 0

    for root, dirs, files in os.walk(search_dir):
        # print(f"Checking directory: {root}") # Verbose logging
        for file in files:
            checked_files_count += 1
            full_path = os.path.join(root, file)
            # Check if it's an audio file first
            if not file.lower().endswith(('.mp3', '.m4a', '.flac', '.ogg', '.opus')):
                continue

            # Primary check: Spotify ID in filename (if format included it)
            # If format didn't include {track-id}, this check might always fail.
            id_in_filename = track_id in file

            # Secondary check: Title/Artist slugs in path/filename
            relative_path_check = os.path.relpath(full_path, settings.MEDIA_ROOT)
            path_slug = better_slugify(relative_path_check)
            title_match = slug_title and slug_title in path_slug
            artist_match = slug_artist and slug_artist in path_slug

            # Decide if it's a potential match
            # Require ID match if {track-id} was expected, otherwise rely on title/artist
            is_potential_match = False
            match_score = 0
            # If you removed {track-id} from output_format, adjust this logic:
            if id_in_filename:
                is_potential_match = True
                match_score += 2 # Higher score for ID match
                if title_match: match_score += 1
                if artist_match: match_score += 1
            elif title_match and artist_match: # Fallback if ID not in name
                 is_potential_match = True
                 match_score += 1 # Lower score for non-ID match

            if is_potential_match:
                 possible_matches.append({'path': relative_path_check, 'score': match_score, 'fullpath': full_path})
                 print(f"  Potential match: {relative_path_check} (Score: {match_score}, ID in name: {id_in_filename}, Title Match: {title_match}, Artist Match: {artist_match})")


    print(f"Checked {checked_files_count} files total.")
    if not possible_matches:
         # Check spotdl stdout for clues if possible
         stdout_lines = result.stdout.splitlines()
         downloaded_line = next((line for line in stdout_lines if "Downloaded" in line), None)
         if downloaded_line:
             print(f"SpotDL reported: {downloaded_line}")
         else:
             print("Could not find 'Downloaded' line in spotdl output.")
         raise FileNotFoundError(f"SpotDL ran, but failed to find a matching audio file for ID '{track_id}' in '{search_dir}'. Searched {checked_files_count} files. Check SpotDL output format and logs.")

    # Select the best match (highest score)
    possible_matches.sort(key=lambda x: x['score'], reverse=True)
    found_file_relative_path = possible_matches[0]['path']
    print(f"Selected best match based on score: {found_file_relative_path}")

    # Extra check: Verify the selected file actually exists (sanity check)
    if not os.path.exists(os.path.join(settings.MEDIA_ROOT, found_file_relative_path)):
        print(f"ERROR: Selected file path does not exist: {os.path.join(settings.MEDIA_ROOT, found_file_relative_path)}")
        raise FileNotFoundError(f"Internal error: Selected file path '{found_file_relative_path}' does not seem to exist.")

    return found_file_relative_path


# Existing views (home, register, login, logout)
@login_required
def home(request):
    # Fetch various items from the user's library
    user_library_songs = []
    user_library_albums = []
    user_library_artists = []
    user_library_playlists = [] # Assuming playlists are user-specific via the Playlist model's user FK

    try:
        library = request.user.library
        user_library_songs = library.songs.all().order_by('title')
        user_library_albums = library.albums.all().order_by('title')
        user_library_artists = library.artists.all().order_by('name')
        # Fetch playlists created by the user directly, not necessarily through the library M2M
        user_library_playlists = Playlist.objects.filter(user=request.user).order_by('name')

    except Library.DoesNotExist:
        # Library might not exist if user was created before the signal was added
        # Or if the signal failed. We can create it here just in case.
        Library.objects.create(user=request.user)
        # No items will be fetched yet in this case.
        pass
    except AttributeError:
        # Handle case where request.user might not have a 'library' attribute yet
        # This might happen immediately after user creation if signals are delayed
        pass


    context = {
        'user_library_songs': user_library_songs,
        'user_library_albums': user_library_albums,
        'user_library_artists': user_library_artists,
        'user_library_playlists': user_library_playlists,
    }
    return render(request, 'index.html', context)

@csrf_exempt
def register(request):
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        email = request.POST.get('email')
        try:
            user = User.objects.create_user(username=username, password=password, email=email)
            user.save()
            return redirect('login')
        except Exception as e:
             return render(request, 'register.html', {'error': 'Registration failed. Please try again.'})
    return render(request, 'register.html')

@csrf_exempt
def login(request):
    if request.method == 'POST':
        form = LoginForm(request, data=request.POST)
        if form.is_valid():
            username = form.cleaned_data.get('username')
            password = form.cleaned_data.get('password')
            user = authenticate(request, username=username, password=password)
            if user is not None:
                auth_login(request, user)
                return redirect('home')
            else:
                return render(request, 'login.html', {'form': form, 'error': 'Invalid credentials'})
        else:
            return render(request, 'login.html', {'form': form})
    else:
        form = LoginForm()
    return render(request, 'login.html', {'form': form})

@csrf_exempt 
def logout(request):
    auth_logout(request)
    return redirect('login')

# Modify this view
@login_required
def browse_songs(request):
    """Displays all songs available in the database."""
    all_songs = Song.objects.all().order_by('title') # Get all songs, order by title

    # Get IDs of songs already in the user's library
    user_library_song_ids = set()
    try:
        user_library_song_ids = set(request.user.library.songs.values_list('id', flat=True))
    except Library.DoesNotExist:
        # Library might not exist yet, create it
        Library.objects.create(user=request.user)
    except AttributeError:
        # User might not have library attribute yet
        pass

    context = {
        'all_songs': all_songs,
        'user_library_song_ids': user_library_song_ids, # Pass the set of IDs
    }
    return render(request, 'browse_songs.html', context)

# Add these new views
@login_required
@require_POST # Ensure this view only accepts POST requests
@csrf_protect # Protect against CSRF
def add_song_to_library(request, song_id):
    """Adds a song to the current user's library."""
    song = get_object_or_404(Song, id=song_id)
    try:
        library = request.user.library
        library.songs.add(song)
        # Optionally add messages framework here for feedback
    except Library.DoesNotExist:
        # Should ideally not happen due to checks/creation elsewhere, but handle defensively
        library = Library.objects.create(user=request.user)
        library.songs.add(song)
    except Exception as e:
        # Log error or add message
        print(f"Error adding song {song_id} to library for user {request.user.id}: {e}")
        # Optionally add error message via Django messages framework

    # Redirect back to the browse page (or wherever is appropriate)
    return HttpResponseRedirect(request.META.get('HTTP_REFERER', redirect('browse_songs').url))


@login_required
@require_POST # Ensure this view only accepts POST requests
@csrf_protect # Protect against CSRF
def remove_song_from_library(request, song_id):
    """Removes a song from the current user's library."""
    song = get_object_or_404(Song, id=song_id)
    try:
        library = request.user.library
        library.songs.remove(song)
        # Optionally add messages framework here for feedback
    except Library.DoesNotExist:
        # User doesn't have a library, so nothing to remove
        pass
    except Exception as e:
        # Log error or add message
        print(f"Error removing song {song_id} from library for user {request.user.id}: {e}")
        # Optionally add error message via Django messages framework

    # Redirect back to the browse page (or wherever is appropriate)
    return HttpResponseRedirect(request.META.get('HTTP_REFERER', redirect('browse_songs').url))

# New view for album details
@login_required
def album_detail(request, album_id):
    """Displays details for a specific album and its songs."""
    album = get_object_or_404(Album, id=album_id)
    album_songs = album.songs.all().order_by('title') # Or by track number if you add it

    # Get IDs of songs already in the user's library for Add/Remove buttons
    user_library_song_ids = set()
    try:
        user_library_song_ids = set(request.user.library.songs.values_list('id', flat=True))
    except Library.DoesNotExist:
        Library.objects.create(user=request.user)
    except AttributeError:
        pass

    context = {
        'album': album,
        'album_songs': album_songs,
        'user_library_song_ids': user_library_song_ids,
    }
    return render(request, 'album_detail.html', context)


# New view for adding Spotify content - MODIFIED
@login_required
@csrf_protect # Use CSRF protection
def add_spotify_content(request):
    """View to add content from Spotify using a URL."""
    form = SpotifyUrlForm()
    logs = [] # Collect logs to display on the template
    if request.method == 'POST':
        form = SpotifyUrlForm(request.POST)
        if form.is_valid():
            spotify_url = form.cleaned_data['url']
            # Extract the type and ID from the URL
            match = re.match(r'https?://open\.spotify\.com/(?:album|artist|track|playlist)/([^?&]+)', spotify_url)
            if match:
                content_type = match.group(1)
                content_id = match.group(2)
                if content_type == 'track':
                    song, track_logs = process_spotify_track(content_id, request.user)
                    logs.extend(track_logs) # Add track processing logs
                    if song:
                        return redirect('browse_songs')
                elif content_type == 'album':
                    songs, release_obj, album_logs = process_spotify_album(content_id, request.user)
                    logs.extend(album_logs) # Add album processing logs
                    if release_obj:
                        return redirect('browse_songs')
                elif content_type == 'playlist':
                    songs, playlist_obj, playlist_logs = process_spotify_playlist(content_id, request.user)
                    logs.extend(playlist_logs) # Add playlist processing logs
                    if playlist_obj:
                        return redirect('browse_songs')
                else:
                    logs.append("Unsupported Spotify URL type.")
            else:
                logs.append("Invalid Spotify URL.")

    return render(request, 'add_spotify_content.html', {'form': form, 'logs': logs})


# --- Processing Functions (Called by add_spotify_content) ---

def process_spotify_track(track_id, user):
    """Gets track info, downloads, saves to DB, returns Song object or None."""
    track_logs = [] # Collect logs specific to track processing
    try:
        track_info = sp.track(track_id)
        if not track_info:
            track_logs.append(f"Could not fetch track info for ID: {track_id}")
            return None, track_logs
    except spotipy.SpotifyException as e:
        track_logs.append(f"Spotify API error fetching track {track_id}: {e}")
        return None, track_logs

    # --- Get/Create Artists ---
    artists = []
    artist_names_for_path = [] # Store names for spotdl path finding
    for artist_data in track_info['artists']:
        artist, created = Artist.objects.update_or_create(
            spotify_id=artist_data['id'],
            defaults={'name': artist_data['name']}
        )
        artists.append(artist)
        artist_names_for_path.append(artist.name)


    # --- Get/Create Album/EP/Single (Release) ---
    # ... (keep existing release object creation logic) ...
    album_info = track_info['album']
    release_spotify_id = album_info['id']
    release_date_val = parse_release_date(album_info.get('release_date')) # Renamed variable
    cover_url = album_info['images'][0]['url'] if album_info['images'] else None
    album_type = album_info.get('album_type', 'album')

    release_model = Album
    if album_type == 'ep': release_model = EP
    elif album_type == 'single': release_model = Single

    release_defaults = {
        'title': album_info['name'],
        'release_date': release_date_val,
        'cover_image_url': cover_url,
    }

    release_obj, created = release_model.objects.update_or_create(
        spotify_id=release_spotify_id,
        defaults=release_defaults
    )
    release_obj.artists.set(artists) # Associate artists

    # Download cover image if URL exists and image not already set
    image_updated = False
    if release_obj.cover_image_url and not release_obj.cover_image:
        img_name = f"{better_slugify(release_obj.title)}_{release_obj.spotify_id}.jpg"
        # Call download_image - it now returns True/False
        if download_image(release_obj.cover_image_url, release_obj, 'cover_image', img_name):
             image_updated = True # Mark that image content is ready to be saved

    # Save the release object *if* it was newly created OR if the image was updated
    if created or image_updated:
        try:
            release_obj.save()
            track_logs.append(f"Saved {release_obj._meta.verbose_name} '{release_obj.title}' (Created: {created}, Image Updated: {image_updated})")
        except Exception as e:
            track_logs.append(f"Error saving release object {release_obj.title}: {e}")
            # Decide if this is critical - maybe proceed without cover image??


    # --- Get/Create Song ---
    song_defaults = {
        'title': track_info['name'],
        'duration': timedelta(milliseconds=track_info['duration_ms']),
        'release_date': release_obj.release_date, # Use release's date
        'album': release_obj if isinstance(release_obj, Album) else None,
        'ep': release_obj if isinstance(release_obj, EP) else None,
        'single': release_obj if isinstance(release_obj, Single) else None,
    }
    # Use update_or_create for the song as well
    song, song_created = Song.objects.update_or_create(
        spotify_id=track_id,
        defaults=song_defaults
    )
    song.artists.set(artists) # Associate artists

    # --- Download File (if needed) ---
    # Check if song.file is None/empty OR if the file doesn't exist in storage
    needs_download = False
    if not song.file:
        needs_download = True
        track_logs.append(f"Song '{song.title}' has no file assigned.")
    # Use try-except for storage.exists as it might fail if song.file.name is invalid
    else:
        try:
            if not song.file.storage.exists(song.file.name):
                needs_download = True
                track_logs.append(f"File '{song.file.name}' for song '{song.title}' not found in storage.")
            else:
                 track_logs.append(f"File '{song.file.name}' already exists for song '{song.title}'. Skipping download.")
        except Exception as e:
            track_logs.append(f"Error checking storage for '{song.file.name}': {e}. Assuming download needed.")
            needs_download = True


    if needs_download:
        track_logs.append(f"Attempting download for song '{song.title}'...")
        spotify_track_url = f"https://open.spotify.com/track/{track_id}"
        try:
            # Pass expected title/artist to help finding function
            relative_file_path = run_spotdl_and_get_path(
                spotify_track_url,
                track_id,
                expected_title=song.title,
                expected_artist=artist_names_for_path[0] if artist_names_for_path else None # Use first artist name
            )
            song.file.name = relative_file_path # Assign relative path from MEDIA_ROOT
            song.save(update_fields=['file']) # Save only the file field update
            track_logs.append(f"Successfully linked downloaded file for '{song.title}': {song.file.name}")
        except Exception as e:
            track_logs.append(f"Failed to download or link file for song '{song.title}' (ID: {track_id}): {e}")
            # File field remains empty/unchanged
            return song, track_logs # Return song even if download failed
    # else: # Already printed skip message above
        # print(f"File already exists for song '{song.title}' (ID: {track_id}). Skipping download.")  


    return song, track_logs


def process_spotify_album(album_id, user):
    """Gets album info, processes each track. Returns list of processed Song objects and the release object."""
    processed_songs = []
    release_obj = None
    album_logs = [] # Collect logs specific to album processing
    try:
        album_info = sp.album(album_id)
        if not album_info:
             album_logs.append(f"Could not fetch album info for ID: {album_id}")
             return [], None, album_logs

        # --- Create the Album/EP/Single object ---
        # ... (keep existing release object creation logic) ...
        release_spotify_id = album_info['id']
        release_date_val = parse_release_date(album_info.get('release_date')) # Renamed
        cover_url = album_info['images'][0]['url'] if album_info['images'] else None
        album_type = album_info.get('album_type', 'album')
        artist_info_list = album_info['artists']

        release_model = Album
        if album_type == 'ep': release_model = EP
        elif album_type == 'single': release_model = Single

        release_defaults = {
            'title': album_info['name'],
            'release_date': release_date_val,
            'cover_image_url': cover_url,
        }
        release_obj, created = release_model.objects.update_or_create(
            spotify_id=release_spotify_id,
            defaults=release_defaults
        )

        release_artists = []
        for artist_data in artist_info_list:
            artist, _ = Artist.objects.update_or_create(
                spotify_id=artist_data['id'],
                defaults={'name': artist_data['name']}
            )
            release_artists.append(artist)
        release_obj.artists.set(release_artists)

        # Download cover image if needed
        image_updated = False
        if release_obj.cover_image_url and not release_obj.cover_image:
             img_name = f"{better_slugify(release_obj.title)}_{release_obj.spotify_id}.jpg"
             if download_image(release_obj.cover_image_url, release_obj, 'cover_image', img_name):
                 image_updated = True

        # Save the release object if created or image updated
        if created or image_updated:
            try:
                release_obj.save()
                album_logs.append(f"Saved {release_obj._meta.verbose_name} '{release_obj.title}' (Created: {created}, Image Updated: {image_updated})")
            except Exception as e:
                album_logs.append(f"Error saving release object {release_obj.title}: {e}")


        # --- Process Tracks ---
        # ... (keep existing track processing loop using process_spotify_track) ...
        album_tracks = sp.album_tracks(album_id) # Fetch tracks again (or pass from album_info if available)
        if not album_tracks:
            album_logs.append(f"Could not fetch tracks for album ID: {album_id}")
            return [], release_obj, album_logs

        print(f"Processing {len(album_tracks['items'])} tracks for {album_type} '{release_obj.title}'")
        for track_item in album_tracks['items']:
            if track_item and track_item.get('id'):
                try:
                    song, track_logs = process_spotify_track(track_item['id'], user)
                    if song:
                        processed_songs.append(song)
                        album_logs.extend(track_logs) # Add logs from processing each track
                except Exception as e:
                    album_logs.append(f"Error processing track {track_item.get('id')} from album {album_id}: {e}")
                    # Continue processing other tracks

    except spotipy.SpotifyException as e:
         album_logs.append(f"Spotify API error fetching album {album_id}: {e}")
         return [], None, album_logs
    except Exception as e:
        album_logs.append(f"Unexpected error processing album {album_id}: {e}")
        import traceback
        traceback.print_exc()
        return [], release_obj, album_logs

    return processed_songs, release_obj, album_logs


def process_spotify_playlist(playlist_id, user):
    """Gets playlist info, processes each track. Returns list of processed Song objects and the Playlist object."""
    processed_songs = []
    playlist_obj = None
    playlist_logs = [] # Collect logs specific to playlist processing
    try:
        playlist_info = sp.playlist(playlist_id)
        if not playlist_info:
            playlist_logs.append(f"Could not fetch playlist info for ID: {playlist_id}")
            return [], None, playlist_logs

        # --- Get/Create Playlist object in DB ---
        playlist_defaults = {
            'name': playlist_info['name'],
            'description': playlist_info['description'],
            'user': user, # Assign to the current user
            'public': playlist_info['public'],
            # TODO: Handle playlist cover image download using download_image logic
        }
        playlist_obj, created = Playlist.objects.update_or_create(
            spotify_id=playlist_id,
            defaults=playlist_defaults
        )
        # TODO: Save playlist_obj if cover image was updated

        # --- Process Tracks ---
        offset = 0
        limit = 100
        total = playlist_info['tracks']['total']
        print(f"Processing {total} tracks for playlist '{playlist_obj.name}'")

        while offset < total:
            try:
                playlist_items = sp.playlist_items(playlist_id, limit=limit, offset=offset)
            except spotipy.SpotifyException as e:
                playlist_logs.append(f"Spotify API error fetching playlist items (offset {offset}) for {playlist_id}: {e}")
                break

            if not playlist_items or not playlist_items['items']:
                break

            for item in playlist_items['items']:
                track = item.get('track')
                if track and track.get('id') and not track.get('is_local'):
                    try:
                        song, track_logs = process_spotify_track(track['id'], user)
                        if song:
                            processed_songs.append(song)
                            playlist_obj.songs.add(song) # Add song to the playlist M2M
                            playlist_logs.extend(track_logs) # Add logs from processing each track
                    except Exception as e:
                        playlist_logs.append(f"Error processing track {track.get('id')} from playlist {playlist_id}: {e}")
                        # Continue processing other tracks
                elif track and track.get('is_local'):
                    playlist_logs.append(f"Skipping local track '{track.get('name')}' in playlist {playlist_id}")

            offset += limit # Move to the next page

    except spotipy.SpotifyException as e:
         playlist_logs.append(f"Spotify API error fetching playlist {playlist_id}: {e}")
         return [], None, playlist_logs
    except Exception as e:
        playlist_logs.append(f"Unexpected error processing playlist {playlist_id}: {e}")
        import traceback
        traceback.print_exc()
        return [], playlist_obj, playlist_logs # Return potentially partial list and the playlist obj if created

    print(f"Finished processing playlist '{playlist_obj.name}'. Processed {len(processed_songs)} tracks.")
    return processed_songs, playlist_obj, playlist_logs