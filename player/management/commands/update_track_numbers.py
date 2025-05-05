import os
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings
from player.models import Song # Assuming your models are in the player app
import mutagen

class Command(BaseCommand):
    help = 'Updates the track_number field for existing Song objects using metadata from audio files.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE('Starting track number update process...'))

        # Get songs that have a file path and potentially need updating
        # You might want to filter further, e.g., only where track_number is NULL
        # songs_to_check = Song.objects.filter(file__isnull=False, file__gt='', track_number__isnull=True)
        songs_to_check = Song.objects.filter(file__isnull=False).exclude(file='') # Check all songs with files

        updated_count = 0
        skipped_count = 0
        error_count = 0

        if not songs_to_check.exists():
            self.stdout.write(self.style.WARNING('No songs with associated files found matching the criteria.'))
            return

        total_songs = songs_to_check.count()
        self.stdout.write(f'Found {total_songs} songs with files to check.')

        for i, song in enumerate(songs_to_check):
            # Construct the full path to the media file
            if not song.file or not song.file.name:
                self.stdout.write(self.style.WARNING(f'Skipping Song ID {song.id} ("{song.title}") - No file path.'))
                skipped_count += 1
                continue

            file_path = os.path.join(settings.MEDIA_ROOT, song.file.name)

            if not os.path.exists(file_path):
                self.stdout.write(self.style.ERROR(f'File not found for Song ID {song.id} ("{song.title}") at path: {file_path}'))
                error_count += 1
                continue

            try:
                audio = mutagen.File(file_path, easy=True) # Use easy=True for simpler tag access
                track_number_str = None
                track_number_int = None

                if audio:
                    # Try the common 'tracknumber' tag used by EasyID3, EasyMP4, etc.
                    if 'tracknumber' in audio:
                        track_number_str = audio['tracknumber'][0] # Easy tags usually return a list

                    # Add fallbacks for specific formats if 'easy' doesn't work reliably
                    # Example for ID3 (less common if easy=True works):
                    # elif isinstance(audio, mutagen.id3.ID3) and 'TRCK' in audio:
                    #     track_number_str = audio['TRCK'].text[0]
                    # Example for MP4 (less common if easy=True works):
                    # elif isinstance(audio, mutagen.mp4.MP4) and 'trkn' in audio:
                    #     # MP4 track number is often a tuple (track, total_tracks)
                    #     track_number_int = audio['trkn'][0][0]

                if track_number_str:
                    # Handle formats like '1/12' or just '1'
                    track_number_part = track_number_str.split('/')[0].strip()
                    try:
                        track_number_int = int(track_number_part)
                    except (ValueError, TypeError):
                        self.stdout.write(self.style.WARNING(f'Could not parse track number "{track_number_str}" for Song ID {song.id}'))

                if track_number_int is not None:
                    # Check if update is needed
                    if song.track_number is None or song.track_number != track_number_int:
                        old_value = song.track_number
                        song.track_number = track_number_int
                        song.save(update_fields=['track_number'])
                        self.stdout.write(self.style.SUCCESS(f'Updated Song ID {song.id} ("{song.title}"): track_number {old_value} -> {track_number_int}'))
                        updated_count += 1
                    else:
                        # self.stdout.write(f'Song ID {song.id} already has correct track number ({song.track_number}).')
                        skipped_count += 1 # Count as skipped if already correct
                else:
                    self.stdout.write(self.style.WARNING(f'No track number tag found for Song ID {song.id} ("{song.title}") in file {file_path}'))
                    skipped_count += 1

            except mutagen.MutagenError as e:
                self.stdout.write(self.style.ERROR(f'Mutagen error processing file for Song ID {song.id} ("{song.title}"): {e}'))
                error_count += 1
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'Unexpected error processing Song ID {song.id} ("{song.title}"): {e}'))
                error_count += 1

            # Progress indicator every 50 songs or on the last song
            if (i + 1) % 50 == 0 or (i + 1) == total_songs:
                 self.stdout.write(f'Processed {i + 1}/{total_songs} songs...')


        self.stdout.write(self.style.SUCCESS(f'\nTrack number update process finished.'))
        self.stdout.write(f' - Updated: {updated_count}')
        self.stdout.write(f' - Skipped/No Tag/Already Correct: {skipped_count}')
        self.stdout.write(f' - Errors (File not found or processing error): {error_count}')

