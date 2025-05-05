from django.shortcuts import render, redirect, get_object_or_404 # Add get_object_or_404
from django.http import HttpResponse, HttpResponseServerError, HttpResponseRedirect, JsonResponse # Add JsonResponse
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.csrf import csrf_exempt, csrf_protect # Import csrf_protect
from django.views.decorators.http import require_POST, require_http_methods # Add require_POST, require_http_methods
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
from django.db import transaction # Import transaction
from django.db.models import Max # Import Max
import json # Add json import
import traceback # Ensure traceback is imported if not already
import syncedlyrics # Import the syncedlyrics library
# --- MODIFICATION START: Import lyrics providers ---
# Note: Direct import and use of providers might be complex.
# Relying on spotdl command line with --lyrics is simpler.
# from spotdl.providers.lyrics import Genius, MusixMatch, AzLyrics, Synced
# --- MODIFICATION END ---
from django.core.exceptions import ObjectDoesNotExist # Import ObjectDoesNotExist


from .forms import LoginForm, SpotifyUrlForm # Import the new form
from .models import Artist, Album, Song, EP, Single, Playlist, Library, Queue, QueueItem # Add Queue, QueueItem
from itertools import chain # Import chain

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

        # --- MODIFICATION START: Set the name attribute on the ContentFile ---
        img_content.name = save_name
        # --- MODIFICATION END ---

        # Assign the ContentFile to the object's field attribute directly
        # The actual saving to storage happens when obj.save() is called later
        setattr(obj, field_name, img_content)
        # Store the intended save name separately if needed, though Django handles naming
        # obj._image_save_name = save_name # Example if needed elsewhere

        print(f"Image content prepared for {field_name} on object {obj.pk or '(unsaved)'} with name '{save_name}'")
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
        # --- REMOVED: '--lyrics', 'musixmatch', ---
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
    user_library_playlists = []
    user_library_eps = []
    user_library_singles = []

    try:
        library = request.user.library
        # Fetch releases and artists directly
        user_library_albums = library.albums.all().order_by('title')
        user_library_eps = library.eps.all().order_by('title')
        user_library_singles = library.singles.all().order_by('title')
        user_library_artists = library.artists.all().order_by('name')

        # Aggregate songs from all releases in the library
        album_songs = Song.objects.filter(album__in=user_library_albums)
        ep_songs = Song.objects.filter(ep__in=user_library_eps)
        single_songs = Song.objects.filter(single__in=user_library_singles)
        # Combine song querysets and order them
        user_library_songs = sorted(
            list(chain(album_songs, ep_songs, single_songs)),
            key=lambda song: song.title.lower() # Sort by title case-insensitively
        )

        # Fetch playlists created by the user
        user_library_playlists = Playlist.objects.filter(user=request.user).order_by('name')

    except Library.DoesNotExist:
        Library.objects.create(user=request.user)
    except AttributeError:
        pass

    context = {
        'user_library_songs': user_library_songs, # Now aggregated songs
        'user_library_albums': user_library_albums,
        'user_library_eps': user_library_eps, # Pass EPs to context
        'user_library_singles': user_library_singles, # Pass Singles to context
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
# --- MODIFICATION START: Rename view and update logic ---
def browse_media(request):
    """Displays all albums, EPs, and singles available in the database."""
    all_albums = Album.objects.all().order_by('title')
    all_eps = EP.objects.all().order_by('title')
    all_singles = Single.objects.all().order_by('title')
    # Optionally add Artists and Playlists if desired

    user_library_album_ids = []
    user_library_ep_ids = []
    user_library_single_ids = []
    try:
        library = request.user.library
        user_library_album_ids = list(library.albums.values_list('id', flat=True))
        user_library_ep_ids = list(library.eps.values_list('id', flat=True))
        user_library_single_ids = list(library.singles.values_list('id', flat=True))
    except (Library.DoesNotExist, AttributeError):
        pass # User might not have a library yet or library relation failed

    context = {
        'all_albums': all_albums,
        'all_eps': all_eps,
        'all_singles': all_singles,
        'user_library_album_ids': user_library_album_ids,
        'user_library_ep_ids': user_library_ep_ids,
        'user_library_single_ids': user_library_single_ids,
    }
    return render(request, 'browse_media.html', context) # Use new template name
# --- MODIFICATION END ---

# New view for album details
@login_required
def album_detail(request, album_id):
    """Displays details for a specific album and its songs."""
    album = get_object_or_404(Album, id=album_id)
    album_songs = album.songs.all().order_by('title') # Or by track number if you add it

    # --- MODIFICATION START: Fetch user library info ---
    user_library_album_ids = []
    try:
        library = request.user.library
        user_library_album_ids = list(library.albums.values_list('id', flat=True))
    except (Library.DoesNotExist, AttributeError):
        pass # User might not have a library yet
    # --- MODIFICATION END ---

    context = {
        'album': album,
        'album_songs': album_songs,
        # --- MODIFICATION START: Add library info to context ---
        'user_library_album_ids': user_library_album_ids,
        # --- MODIFICATION END ---
    }
    return render(request, 'album_detail.html', context)

# --- MODIFICATION START: Add EP Detail View ---
@login_required
def ep_detail(request, ep_id):
    """Displays details for a specific EP and its songs."""
    ep = get_object_or_404(EP, id=ep_id)
    ep_songs = ep.songs.all().order_by('title')

    user_library_ep_ids = []
    try:
        library = request.user.library
        user_library_ep_ids = list(library.eps.values_list('id', flat=True))
    except (Library.DoesNotExist, AttributeError):
        pass

    context = {
        'ep': ep,
        'ep_songs': ep_songs,
        'user_library_ep_ids': user_library_ep_ids,
    }
    return render(request, 'ep_detail.html', context)
# --- MODIFICATION END ---

# --- MODIFICATION START: Add Single Detail View ---
@login_required
def single_detail(request, single_id):
    """Displays details for a specific single and its songs."""
    single = get_object_or_404(Single, id=single_id)
    single_songs = single.songs.all().order_by('title')

    user_library_single_ids = []
    try:
        library = request.user.library
        user_library_single_ids = list(library.singles.values_list('id', flat=True))
    except (Library.DoesNotExist, AttributeError):
        pass

    context = {
        'single': single,
        'single_songs': single_songs,
        'user_library_single_ids': user_library_single_ids,
    }
    return render(request, 'single_detail.html', context)
# --- MODIFICATION END ---

# --- MODIFICATION START: Add add_to_library view ---
@login_required
@require_POST # Expect POST request
@csrf_protect
def add_to_library(request):
    """Adds an item (Album, EP, Single, etc.) to the user's library."""
    try:
        data = json.loads(request.body)
        media_type = data.get('media_type')
        media_id = data.get('media_id')

        if not media_type or not media_id:
            return JsonResponse({'status': 'error', 'message': 'Missing media_type or media_id.'}, status=400)

        try:
            media_id = int(media_id) # Ensure ID is an integer
        except ValueError:
            return JsonResponse({'status': 'error', 'message': 'Invalid media_id.'}, status=400)

        library, _ = Library.objects.get_or_create(user=request.user)
        item_added = False
        item_name = ""

        with transaction.atomic():
            if media_type == 'album':
                item = get_object_or_404(Album, id=media_id)
                item_name = item.title
                if not library.albums.filter(id=media_id).exists():
                    library.albums.add(item)
                    item_added = True
            elif media_type == 'ep':
                item = get_object_or_404(EP, id=media_id)
                item_name = item.title
                if not library.eps.filter(id=media_id).exists():
                    library.eps.add(item)
                    item_added = True
            elif media_type == 'single':
                item = get_object_or_404(Single, id=media_id)
                item_name = item.title
                if not library.singles.filter(id=media_id).exists():
                    library.singles.add(item)
                    item_added = True
            # Add elif blocks for 'artist', 'playlist' if implementing later
            else:
                return JsonResponse({'status': 'error', 'message': f'Unsupported media_type: {media_type}'}, status=400)

        if item_added:
            return JsonResponse({'status': 'success', 'message': f"'{item_name}' added to your library."})
        else:
            return JsonResponse({'status': 'info', 'message': f"'{item_name}' is already in your library."})

    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid request format.'}, status=400)
    except ObjectDoesNotExist:
         return JsonResponse({'status': 'error', 'message': f'{media_type.capitalize()} not found.'}, status=404)
    except Exception as e:
        print(f"Error adding item to library (user {request.user.id}, type {media_type}, id {media_id}): {e}")
        print(traceback.format_exc())
        return JsonResponse({'status': 'error', 'message': 'Could not add item to library.'}, status=500)
# --- MODIFICATION END ---


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
            # Correct the key used to access cleaned_data
            spotify_url = form.cleaned_data['spotify_url']
            # Extract the type and ID from the URL
            # Use regex to capture type and ID more robustly
            match = re.match(r'https?://open\.spotify\.com/(track|album|playlist|artist)/([^?&]+)', spotify_url)
            if match:
                content_type = match.group(1)
                content_id = match.group(2)
                logs.append(f"Detected type: {content_type}, ID: {content_id}") # Log detection

                if content_type == 'track':
                    # Wrap processing in try-except to catch potential errors
                    try:
                        song, track_logs = process_spotify_track(content_id, request.user)
                        logs.extend(track_logs) # Add track processing logs
                        if song:
                            logs.append(f"Successfully processed track: {song.title}")
                            # Optionally redirect or just show success on the same page
                            # return redirect('browse_songs')
                        else:
                            logs.append("Track processing finished, but no song object returned.")
                    except Exception as e:
                        logs.append(f"Error during track processing: {e}")
                        import traceback
                        logs.append(traceback.format_exc()) # Add full traceback to logs for debugging

                elif content_type == 'album':
                    # Wrap processing in try-except
                    try:
                        songs, release_obj, album_logs = process_spotify_album(content_id, request.user)
                        logs.extend(album_logs) # Add album processing logs
                        if release_obj:
                            logs.append(f"Successfully processed album: {release_obj.title} ({len(songs)} tracks)")
                            # return redirect('browse_songs')
                        else:
                            logs.append("Album processing finished, but no release object returned.")
                    except Exception as e:
                        logs.append(f"Error during album processing: {e}")
                        import traceback
                        logs.append(traceback.format_exc())

                elif content_type == 'playlist':
                     # Wrap processing in try-except
                    try:
                        songs, playlist_obj, playlist_logs = process_spotify_playlist(content_id, request.user)
                        logs.extend(playlist_logs) # Add playlist processing logs
                        if playlist_obj:
                            logs.append(f"Successfully processed playlist: {playlist_obj.name} ({len(songs)} tracks)")
                            # return redirect('browse_songs')
                        else:
                            logs.append("Playlist processing finished, but no playlist object returned.")
                    except Exception as e:
                        logs.append(f"Error during playlist processing: {e}")
                        import traceback
                        logs.append(traceback.format_exc())

                # Handle Artist type if needed (currently not processed)
                elif content_type == 'artist':
                    logs.append("Artist URL detected, but processing not implemented yet.")
                else:
                    # This case should ideally not be reached with the regex used
                    logs.append(f"Unsupported Spotify URL type: {content_type}")
            else:
                logs.append("Invalid or unrecognized Spotify URL format.")
                # Add form error if desired
                form.add_error('spotify_url', 'Invalid Spotify URL format.')

        # If form is not valid, logs will be empty unless added above
        # The invalid form will be re-rendered with errors automatically
        else:
             logs.append("Form is invalid. Please check the URL.")


    # Always render the template, showing the form and any logs/errors
    return render(request, 'add_spotify_content.html', {'form': form, 'logs': logs})


# --- Queue Management Views ---

@login_required
@require_POST # Expect POST, could also use PUT
@csrf_protect
def add_to_queue(request, song_id):
    """Adds a song to the end of the user's queue."""
    song = get_object_or_404(Song, id=song_id)
    queue, _ = Queue.objects.get_or_create(user=request.user)

    try:
        with transaction.atomic(): # Ensure atomicity
            # Find the current highest order number
            last_item = queue.items.aggregate(Max('order'))
            next_order = (last_item['order__max'] or 0) + 1

            # Create the new queue item
            QueueItem.objects.create(queue=queue, song=song, order=next_order)

        return JsonResponse({'status': 'success', 'message': f"'{song.title}' added to queue."})
    except Exception as e:
        print(f"Error adding song {song_id} to queue for user {request.user.id}: {e}")
        return JsonResponse({'status': 'error', 'message': 'Could not add song to queue.'}, status=500)


@login_required
def get_next_in_queue(request):
    """Gets the next song in the queue based on the current index and advances the index."""
    queue, _ = Queue.objects.get_or_create(user=request.user)

    next_song_data = None
    status = 'error' # Default status
    message = 'An unexpected error occurred.' # Default message

    try:
        with transaction.atomic():
            # Get the item with order greater than the currently playing one
            next_item = queue.items.filter(order__gt=queue.currently_playing_order).order_by('order').first()

            if next_item:
                song = next_item.song
                release = song.get_release()
                cover_url = ''
                if release:
                    cover_url = release.cover_image.url if release.cover_image else release.cover_image_url

                next_song_data = {
                    'id': song.id,
                    'title': song.title,
                    'artist': ", ".join([a.name for a in song.artists.all()]),
                    'url': song.file.url if song.file else None,
                    'cover': cover_url or settings.STATIC_URL + 'placeholder-cover.png', # Fallback
                }
                # Update currently playing and the next index
                queue.currently_playing_order = next_item.order
                # Find the item after this one to set the next index correctly
                next_next_item = queue.items.filter(order__gt=next_item.order).order_by('order').first()
                queue.current_track_index = next_next_item.order if next_next_item else next_item.order # Point to next or stay if last
                queue.save(update_fields=['currently_playing_order', 'current_track_index', 'updated_at'])

                if next_song_data['url']:
                    status = 'success'
                    message = 'Next song retrieved.'
                else:
                    status = 'no_file'
                    message = 'Next song found but has no playable file.'

            else:
                # --- MODIFICATION START ---
                # Reached end of queue, reset currently playing order
                print(f"End of queue reached for user {request.user.id}. Resetting currently_playing_order.")
                queue.currently_playing_order = 0
                # Optionally reset current_track_index as well, or leave it pointing past the end
                # queue.current_track_index = 0
                queue.save(update_fields=['currently_playing_order', 'updated_at']) # Removed current_track_index reset for now
                status = 'end_of_queue'
                message = 'No more songs in the queue.'
                # --- MODIFICATION END ---

    except Exception as e:
        print(f"Error getting next song in queue for user {request.user.id}: {e}")
        # Keep default status/message
        return JsonResponse({'status': status, 'message': message}, status=500)

    # Construct response based on status
    response_data = {'status': status, 'message': message}
    if status == 'success':
        response_data['song'] = next_song_data

    return JsonResponse(response_data)


@login_required
def get_previous_in_queue(request):
    """Gets the previous song played from the queue and updates the index."""
    queue, _ = Queue.objects.get_or_create(user=request.user)
    previous_song_data = None
    # --- DIAGNOSTIC LOGGING START ---
    print(f"--- get_previous_in_queue called for user {request.user.id} ---")
    print(f"Current queue.currently_playing_order before query: {queue.currently_playing_order}")
    # --- DIAGNOSTIC LOGGING END ---

    try:
        with transaction.atomic():
            # --- MODIFICATION START ---
            # Handle the case where the queue just ended (order is 0)
            if queue.currently_playing_order == 0:
                # If order is 0, "previous" means the last item in the queue
                print("currently_playing_order is 0. Querying for the item with the highest order.")
                previous_item = queue.items.order_by('-order').first() # Get the item with the max order
            else:
                # Normal case: Find the item with the highest order strictly less than the currently playing one
                print(f"currently_playing_order is {queue.currently_playing_order}. Querying for order__lt={queue.currently_playing_order}.")
                previous_item = queue.items.filter(order__lt=queue.currently_playing_order).order_by('-order').first()
            # --- MODIFICATION END ---


            # --- DIAGNOSTIC LOGGING START ---
            if previous_item:
                print(f"Found previous_item: Order {previous_item.order}, Song ID {previous_item.song.id}")
            else:
                # Log the items in the queue to see their orders
                all_items_orders = list(queue.items.values_list('order', flat=True).order_by('order'))
                print(f"Query for previous item found NO item.") # Simplified log message
                print(f"Current items in queue (orders): {all_items_orders}")
            # --- DIAGNOSTIC LOGGING END ---


            if previous_item:
                song = previous_item.song
                release = song.get_release()
                cover_url = ''
                if release:
                    cover_url = release.cover_image.url if release.cover_image else release.cover_image_url

                previous_song_data = {
                    'id': song.id,
                    'title': song.title,
                    'artist': ", ".join([a.name for a in song.artists.all()]),
                    'url': song.file.url if song.file else None,
                    'cover': cover_url or settings.STATIC_URL + 'placeholder-cover.png',
                }
                # Update currently playing to this previous item's order
                # --- MODIFICATION START ---
                # If we came from order 0, the 'next' index doesn't make sense as the old order 0.
                # Set both currently_playing and next index to the previous_item's order.
                if queue.currently_playing_order == 0:
                     queue.current_track_index = previous_item.order # Nothing comes after the last item when going back from end
                else:
                     queue.current_track_index = queue.currently_playing_order # Store the order of the song we are navigating away from

                queue.currently_playing_order = previous_item.order # Set current order to the previous song
                # --- MODIFICATION END ---

                # --- DIAGNOSTIC LOGGING START ---
                print(f"Updating queue state: currently_playing_order={queue.currently_playing_order}, current_track_index={queue.current_track_index}")
                # --- DIAGNOSTIC LOGGING END ---
                queue.save(update_fields=['currently_playing_order', 'current_track_index', 'updated_at'])
            else:
                # At the beginning of the queue or no history (or empty queue)
                # --- DIAGNOSTIC LOGGING START ---
                print("No previous item found. Returning 'start_of_queue'.")
                # --- DIAGNOSTIC LOGGING END ---
                pass # No previous song found

    except Exception as e:
        print(f"Error getting previous song in queue for user {request.user.id}: {e}")
        return JsonResponse({'status': 'error', 'message': 'Could not retrieve previous song.'}, status=500)

    # --- DIAGNOSTIC LOGGING START ---
    if previous_song_data and previous_song_data['url']:
        print("--- Returning status: success ---")
        return JsonResponse({'status': 'success', 'song': previous_song_data})
    elif previous_song_data:
        print("--- Returning status: no_file ---")
        return JsonResponse({'status': 'no_file', 'message': 'Previous song found but has no playable file.'})
    else:
        # This path is taken if previous_item was None
        print("--- Returning status: start_of_queue ---")
        return JsonResponse({'status': 'start_of_queue', 'message': 'No previous songs in the queue history.'})
    # --- DIAGNOSTIC LOGGING END ---


@login_required
@require_http_methods(["DELETE"]) # Use DELETE method for removal
@csrf_protect # Ensure CSRF protection
def remove_from_queue(request, item_id):
    """Removes a specific item from the user's queue."""
    queue, _ = Queue.objects.get_or_create(user=request.user)
    item_to_remove = get_object_or_404(QueueItem, id=item_id, queue=queue)

    try:
        with transaction.atomic():
            removed_order = item_to_remove.order
            item_to_remove.delete()

            # Optional: Re-index subsequent items if desired, but not strictly necessary
            # for item in queue.items.filter(order__gt=removed_order).order_by('order'):
            #     item.order -= 1
            #     item.save(update_fields=['order'])

            # Check if the removed item was the currently playing one
            if queue.currently_playing_order == removed_order:
                # Find the item that *was* before the removed one to set as 'last played'
                previous_item = queue.items.filter(order__lt=removed_order).order_by('-order').first()
                queue.currently_playing_order = previous_item.order if previous_item else 0
                # Optionally, update current_track_index if the removed item was next
                if queue.current_track_index == removed_order:
                     next_item = queue.items.filter(order__gt=queue.currently_playing_order).order_by('order').first()
                     queue.current_track_index = next_item.order if next_item else queue.currently_playing_order
                queue.save(update_fields=['currently_playing_order', 'current_track_index', 'updated_at'])


        return JsonResponse({'status': 'success', 'message': 'Item removed from queue.'})
    except Exception as e:
        print(f"Error removing item {item_id} from queue for user {request.user.id}: {e}")
        return JsonResponse({'status': 'error', 'message': 'Could not remove item from queue.'}, status=500)


@login_required
def view_queue(request):
    """Returns the current queue items and the currently playing song as JSON."""
    queue, _ = Queue.objects.get_or_create(user=request.user)
    queue_items_data = []
    currently_playing_song_data = None # Initialize

    try:
        # Get all items
        items = queue.items.select_related('song').prefetch_related('song__artists').order_by('order')

        # Find the currently playing item
        current_item = None
        if queue.currently_playing_order > 0:
            try:
                # Use filter().first() instead of get() to avoid errors if order is invalid
                current_item = items.filter(order=queue.currently_playing_order).first()
                if current_item:
                    song = current_item.song
                    release = song.get_release()
                    cover_url = ''
                    if release:
                        cover_url = release.cover_image.url if release.cover_image else release.cover_image_url

                    currently_playing_song_data = {
                        'id': song.id,
                        'title': song.title,
                        'artist': ", ".join([a.name for a in song.artists.all()]),
                        'url': song.file.url if song.file else None,
                        'cover': cover_url or settings.STATIC_URL + 'placeholder-cover.png',
                        'order': current_item.order, # Include order
                    }
            except QueueItem.DoesNotExist:
                 print(f"Warning: currently_playing_order {queue.currently_playing_order} not found in queue items for user {request.user.id}")
                 # Reset currently_playing_order if it's invalid?
                 # queue.currently_playing_order = 0
                 # queue.save(update_fields=['currently_playing_order'])


        # Populate the list of all items
        for item in items:
            is_playing = (item.order == queue.currently_playing_order)
            # is_next calculation remains the same
            is_next = (item.order == queue.current_track_index and item.order > queue.currently_playing_order)

            queue_items_data.append({
                'id': item.id, # Keep item ID for removal
                'song_id': item.song.id,
                'title': item.song.title,
                'artist': ", ".join([a.name for a in item.song.artists.all()]),
                'order': item.order,
                'is_playing': is_playing,
                'is_next': is_next,
                'has_file': bool(item.song.file)
            })

        return JsonResponse({
            'status': 'success',
            'queue': queue_items_data,
            'currently_playing_order': queue.currently_playing_order,
            'currently_playing_song': currently_playing_song_data # Add current song details
        })
    except Exception as e:
        print(f"Error fetching queue for user {request.user.id}: {e}")
        return JsonResponse({'status': 'error', 'message': 'Could not retrieve queue.'}, status=500)


# --- MODIFICATION START ---
@login_required
@require_POST # Expect POST request
@csrf_protect
def set_currently_playing(request, song_id):
    """Updates the queue's currently playing order based on a song ID.
    Optionally clears the queue and adds this song if 'clear_queue' is true in the request body.
    """
    queue, _ = Queue.objects.get_or_create(user=request.user)
    song = get_object_or_404(Song, id=song_id) # Ensure song exists

    clear_queue_flag = False
    request_body_content = "N/A" # For logging
    try:
        # --- MODIFICATION START: Enhanced logging for request body parsing ---
        if request.body:
            request_body_content = request.body.decode('utf-8') # Decode for logging
            print(f"DEBUG set_currently_playing: Received request body: {request_body_content}") # Log raw body
            data = json.loads(request.body)
            clear_queue_flag = data.get('clear_queue', False)
            print(f"DEBUG set_currently_playing: Parsed clear_queue flag: {clear_queue_flag}") # Log parsed flag
        else:
            print("DEBUG set_currently_playing: Request body is empty.")
        # --- MODIFICATION END ---
    except json.JSONDecodeError as e:
        print(f"ERROR set_currently_playing: Could not decode JSON body. Body was: '{request_body_content}'. Error: {e}")
        pass # Ignore if body is not valid JSON or empty
    except Exception as e:
        print(f"ERROR set_currently_playing: Unexpected error reading request body. Body was: '{request_body_content}'. Error: {e}")
        pass

    try:
        with transaction.atomic():
            # --- MODIFICATION START: Log flag value before conditional ---
            print(f"DEBUG set_currently_playing: Inside transaction. clear_queue_flag is {clear_queue_flag}")
            # --- MODIFICATION END ---
            if clear_queue_flag:
                # --- MODIFICATION START: Detailed logging for clear queue logic ---
                print(f"DEBUG set_currently_playing: Executing clear_queue logic for user {request.user.id}")
                deleted_count, deleted_details = queue.items.all().delete() # Get deletion count and details
                print(f"DEBUG set_currently_playing: Deleted {deleted_count} items from queue. Details: {deleted_details}")
                # Add the current song as the first item (order 1)
                new_item = QueueItem.objects.create(queue=queue, song=song, order=1)
                new_order = new_item.order
                print(f"DEBUG set_currently_playing: Created new QueueItem with order {new_order} for song '{song.title}' (ID: {song_id}).")
                # Set playing and next index to this new item
                queue.currently_playing_order = new_order
                queue.current_track_index = new_order # It's the only item, so it's also the 'next'
                queue.save(update_fields=['currently_playing_order', 'current_track_index', 'updated_at'])
                print(f"DEBUG set_currently_playing: Saved queue state. currently_playing_order={queue.currently_playing_order}, current_track_index={queue.current_track_index}")
                message = f"Queue cleared. Now playing '{song.title}'."
                # --- MODIFICATION END ---

            else:
                # --- MODIFICATION START: Log execution of standard logic ---
                print(f"DEBUG set_currently_playing: Executing standard set_playing logic (clear_queue=False) for user {request.user.id}")
                # --- MODIFICATION END ---
                # Original logic: Find the song in the existing queue and set order
                item_in_queue = queue.items.filter(song=song).first()
                if item_in_queue:
                    new_order = item_in_queue.order
                    # --- MODIFICATION START: Log standard update ---
                    print(f"DEBUG set_currently_playing: Found song in queue. Setting currently_playing_order to {new_order} for song '{song.title}' (ID: {song_id}).")
                    # --- MODIFICATION END ---
                    queue.currently_playing_order = new_order
                    next_item = queue.items.filter(order__gt=new_order).order_by('order').first()
                    queue.current_track_index = next_item.order if next_item else new_order
                    queue.save(update_fields=['currently_playing_order', 'current_track_index', 'updated_at'])
                    # --- MODIFICATION START: Log saved state ---
                    print(f"DEBUG set_currently_playing: Saved queue state. currently_playing_order={queue.currently_playing_order}, current_track_index={queue.current_track_index}")
                    # --- MODIFICATION END ---
                    message = f"Queue state updated: Now playing '{song.title}' (Order: {new_order})."
                else:
                    # Song not found in queue, and clear_queue was false. Reset order.
                    # --- MODIFICATION START: Log song not found ---
                    print(f"DEBUG set_currently_playing: Song '{song.title}' (ID: {song_id}) not found in queue (and clear_queue=False). Setting currently_playing_order to 0.")
                    # --- MODIFICATION END ---
                    queue.currently_playing_order = 0
                    queue.current_track_index = 0
                    queue.save(update_fields=['currently_playing_order', 'current_track_index', 'updated_at'])
                    message = f"Song '{song.title}' not in queue. Playback started outside queue context."

        # --- MODIFICATION START: Log successful commit ---
        print(f"DEBUG set_currently_playing: Transaction committed successfully for song {song_id}, user {request.user.id}. Returning success.")
        # --- MODIFICATION END ---
        return JsonResponse({'status': 'success', 'message': message})

    except Exception as e:
        # --- MODIFICATION START: Log exception during transaction ---
        print(f"ERROR set_currently_playing: Exception during queue update transaction for song {song_id}, user {request.user.id}: {e}")
        print(traceback.format_exc()) # Print full traceback to console
        # --- MODIFICATION END ---
        return JsonResponse({'status': 'error', 'message': 'Could not update queue state.'}, status=500)

# --- MODIFICATION END ---


# --- Processing Functions (Called by add_spotify_content) ---

def process_spotify_track(track_id, user):
    """Gets track info, fetches lyrics, downloads audio, saves to DB, returns Song object or None."""
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
    artist_names_for_lyrics = [] # Store names for syncedlyrics search
    for artist_data in track_info['artists']:
        artist, created = Artist.objects.update_or_create(
            spotify_id=artist_data['id'],
            defaults={'name': artist_data['name']}
        )
        artists.append(artist)
        artist_names_for_path.append(artist.name)
        artist_names_for_lyrics.append(artist.name) # Add for lyrics search

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
            # Decide if this is critical - maybe proceed without cover image?


    # --- Get/Create Song ---
    song_defaults = {
        'title': track_info['name'],
        'duration': timedelta(milliseconds=track_info['duration_ms']),
        'release_date': release_obj.release_date, # Use release's date
        'album': release_obj if isinstance(release_obj, Album) else None,
        'ep': release_obj if isinstance(release_obj, EP) else None,
        'single': release_obj if isinstance(release_obj, Single) else None,
        # Initialize lyrics fields as empty, they will be fetched next
        'lyrics': None,
        'synced_lyrics': None,
    }
    # Use update_or_create for the song as well
    song, song_created = Song.objects.update_or_create(
        spotify_id=track_id,
        defaults=song_defaults
    )
    song.artists.set(artists) # Associate artists

    # --- MODIFICATION START: Fetch Lyrics using syncedlyrics ---
    lyrics_fetched = False
    synced_lyrics_fetched = False
    update_fields_lyrics = [] # Track which lyrics fields need saving

    # Only fetch if lyrics fields are currently empty
    if not song.lyrics and not song.synced_lyrics:
        try:
            search_term = f"{song.title} {' '.join(artist_names_for_lyrics)}"
            track_logs.append(f"Searching lyrics for: '{search_term}'")
            # --- MODIFICATION: Remove allow_plain=True ---
            lrc_result = syncedlyrics.search(search_term, save_path=None) # Don't save to file here
            # --- MODIFICATION END ---

            if lrc_result:
                # Check if the result is a string (likely plain lyrics)
                if isinstance(lrc_result, str):
                    # Check if it looks like LRC format - if so, treat as synced
                    if re.match(r'\[\d{2}:\d{2}\.\d{2,3}\]', lrc_result.strip()):
                        song.synced_lyrics = lrc_result
                        synced_lyrics_fetched = True
                        update_fields_lyrics.append('synced_lyrics')
                        track_logs.append(f"Found synced lyrics (returned as string) for '{song.title}'.")
                    else: # Otherwise, assume it's plain text
                        song.lyrics = lrc_result
                        lyrics_fetched = True
                        update_fields_lyrics.append('lyrics')
                        track_logs.append(f"Found plain lyrics for '{song.title}'.")
                # If it's not a string, assume it's synced (or handle object if library changes)
                # This part might need adjustment based on how syncedlyrics returns synced results
                # For now, let's assume if it's not a string and not None, it's synced.
                elif lrc_result is not None: # Check explicitly for not None
                    # Assuming the result itself is the synced lyrics string if not plain text
                    # This might need refinement based on library's actual return type for synced.
                    song.synced_lyrics = str(lrc_result) # Convert just in case it's an object
                    synced_lyrics_fetched = True
                    update_fields_lyrics.append('synced_lyrics')
                    track_logs.append(f"Found synced lyrics (returned as non-string) for '{song.title}'.")
                else: # lrc_result was None or empty
                     track_logs.append(f"No lyrics found for '{song.title}'.")

            else: # lrc_result was None or empty
                track_logs.append(f"No lyrics found for '{song.title}'.")

        except Exception as lyr_e:
            track_logs.append(f"Error fetching lyrics for '{song.title}': {lyr_e}")
            track_logs.append(traceback.format_exc()) # Add traceback for lyrics error

        # Save lyrics if fetched
        if update_fields_lyrics:
            try:
                song.save(update_fields=update_fields_lyrics)
                track_logs.append(f"Saved fetched lyrics fields: {', '.join(update_fields_lyrics)}")
            except Exception as save_lyr_e:
                 track_logs.append(f"Error saving fetched lyrics for '{song.title}': {save_lyr_e}")
    else:
        track_logs.append(f"Lyrics already exist for '{song.title}'. Skipping fetch.")
    # --- MODIFICATION END ---


    # --- Download File (if needed) ---
    # ... (keep existing download check logic) ...
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

            # --- REMOVED: Lyrics File Checking Logic ---
            # The logic to find and read .lrc/.synced.lrc files is removed
            # as lyrics are now fetched directly via syncedlyrics library.

            # Save song with file path
            update_fields = ['file']
            track_logs.append(f"DEBUG: Saving song with update_fields: {update_fields}")
            song.save(update_fields=update_fields)
            track_logs.append(f"Successfully linked downloaded file for '{song.title}': {song.file.name}")

        except Exception as e:
            track_logs.append(f"Failed to download or link file for song '{song.title}' (ID: {track_id}): {e}")
            # File field remains empty/unchanged
            # Save song object even if download failed (artists/album/lyrics links might be useful)
            # Check if lyrics were fetched and need saving even if download failed
            if update_fields_lyrics and not all(field in ['lyrics', 'synced_lyrics'] for field in song._meta.fields):
                 try:
                     song.save(update_fields=update_fields_lyrics)
                     track_logs.append(f"Saved fetched lyrics fields after download failure: {', '.join(update_fields_lyrics)}")
                 except Exception as save_lyr_e:
                     track_logs.append(f"Error saving fetched lyrics after download failure for '{song.title}': {save_lyr_e}")
            elif song_created and not update_fields_lyrics: # Save if newly created but no lyrics fetched
                 song.save()

            return song, track_logs # Return song even if download failed

    # If download wasn't needed, but song was created OR lyrics were fetched, save it.
    elif song_created or update_fields_lyrics:
        fields_to_save = []
        if song_created: fields_to_save = None # Save all fields if new
        elif update_fields_lyrics: fields_to_save = update_fields_lyrics # Only save lyrics fields if existing

        if fields_to_save is None or fields_to_save: # Check if there's anything to save
            try:
                song.save(update_fields=fields_to_save)
                log_msg = "Saved new song metadata" if song_created else f"Saved updated lyrics fields: {', '.join(fields_to_save)}"
                track_logs.append(f"{log_msg} for '{song.title}' (file already existed).")
            except Exception as save_e:
                 track_logs.append(f"Error saving song metadata/lyrics for '{song.title}': {save_e}")


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


# --- MODIFICATION START: Add get_lyrics view ---
@login_required
def get_lyrics(request, song_id):
    """Returns the lyrics for a given song ID."""
    song = get_object_or_404(Song, id=song_id)
    # Prioritize synced lyrics if available and not empty
    has_synced = bool(song.synced_lyrics and song.synced_lyrics.strip())
    lyrics_content = song.synced_lyrics if has_synced else song.lyrics

    # Check if the chosen lyrics content is actually present and not empty
    if not lyrics_content or not lyrics_content.strip():
        return JsonResponse({'status': 'not_found', 'message': 'No lyrics available for this song.'}, status=404)

    return JsonResponse({
        'status': 'success',
        'lyrics': lyrics_content,
        'is_synced': has_synced,
        'song_id': song_id
    })
# --- MODIFICATION END ---

# --- MODIFICATION START: Add update_lyrics view ---
@login_required
@require_POST # Expect POST request
@csrf_protect
def update_lyrics(request, song_id):
    """Updates the lyrics (plain or synced) for a given song ID."""
    song = get_object_or_404(Song, id=song_id)

    try:
        data = json.loads(request.body)
        lyrics_content = data.get('lyrics', '') # Default to empty string if not provided
        is_synced = data.get('is_synced', False)

        if is_synced:
            # Update only synced_lyrics
            song.synced_lyrics = lyrics_content
            # Ensure plain lyrics are also updated if synced lyrics are provided,
            # assuming the synced version is based on some plain text.
            # If you want to keep them totally separate, remove the next line.
            # song.lyrics = lyrics_content # Optional: Update plain lyrics too?
            update_fields = ['synced_lyrics'] # Add 'lyrics' if updating both
            print(f"Updating synced lyrics for song ID {song_id}")
        else:
            # Update plain lyrics AND clear synced lyrics
            song.lyrics = lyrics_content
            song.synced_lyrics = None # Clear synced lyrics
            update_fields = ['lyrics', 'synced_lyrics'] # Update both fields
            print(f"Updating plain lyrics and clearing synced lyrics for song ID {song_id}")

        song.save(update_fields=update_fields)

        return JsonResponse({'status': 'success', 'message': 'Lyrics updated successfully.'})

    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid request format.'}, status=400)
    except Exception as e:
        print(f"Error updating lyrics for song {song_id}: {e}")
        print(traceback.format_exc())
        return JsonResponse({'status': 'error', 'message': 'Could not update lyrics.'}, status=500)
# --- MODIFICATION END ---
