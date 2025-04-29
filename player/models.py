from django.db import models
from django.contrib.auth.models import User
import os # Add os import

# Create your models here.
class Artist(models.Model):
    name = models.CharField(max_length=100)
    spotify_id = models.CharField(max_length=50, unique=True, null=True, blank=True) # Added
    genre = models.CharField(max_length=50, blank=True, null=True)
    bio = models.TextField(blank=True, null=True)
    image = models.ImageField(upload_to='artists/', blank=True, null=True)

    def __str__(self):
        return self.name

    class Meta:
        verbose_name_plural = "Artists"

class Album(models.Model):
    title = models.CharField(max_length=100)
    spotify_id = models.CharField(max_length=50, unique=True, null=True, blank=True) # Added
    artists = models.ManyToManyField(Artist, related_name='albums')
    release_date = models.DateField(null=True, blank=True) # Allow null
    cover_image = models.ImageField(upload_to='albums/', blank=True, null=True)
    cover_image_url = models.URLField(max_length=500, blank=True, null=True) # Added

    def __str__(self):
        artist_names = ", ".join([a.name for a in self.artists.all()])
        return f"{self.title} - {artist_names}" # Updated for multiple artists

    class Meta:
        verbose_name_plural = "Albums"

class EP(models.Model):
    title = models.CharField(max_length=100)
    spotify_id = models.CharField(max_length=50, unique=True, null=True, blank=True) # Added
    artists = models.ManyToManyField(Artist, related_name='eps')
    release_date = models.DateField(null=True, blank=True) # Allow null
    cover_image = models.ImageField(upload_to='eps/', blank=True, null=True)
    cover_image_url = models.URLField(max_length=500, blank=True, null=True) # Added

    def __str__(self):
        artist_names = ", ".join([a.name for a in self.artists.all()])
        return f"{self.title} - {artist_names}" # Updated

    class Meta:
        verbose_name_plural = "EPs"

class Single(models.Model):
    title = models.CharField(max_length=100)
    spotify_id = models.CharField(max_length=50, unique=True, null=True, blank=True) # Added
    artists = models.ManyToManyField(Artist, related_name='singles')
    release_date = models.DateField(null=True, blank=True) # Allow null
    cover_image = models.ImageField(upload_to='singles/', blank=True, null=True)
    cover_image_url = models.URLField(max_length=500, blank=True, null=True) # Added

    def __str__(self):
        artist_names = ", ".join([a.name for a in self.artists.all()])
        return f"{self.title} - {artist_names}" # Updated

    class Meta:
        verbose_name_plural = "Singles"


class Song(models.Model):
    title = models.CharField(max_length=100)
    spotify_id = models.CharField(max_length=50, unique=True, null=True, blank=True) # Added
    artists = models.ManyToManyField(Artist, related_name='songs')
    # *** IMPORTANT: This structure assumes a song belongs to ONE Album OR EP OR Single.
    # If a song can belong to multiple (unlikely for official releases), this needs rethinking.
    # Consider using a GenericForeignKey or separate FKs and choosing one.
    # For simplicity now, linking only to Album, allowing null.
    album = models.ForeignKey(Album, related_name='songs', on_delete=models.SET_NULL, null=True, blank=True) # Changed to SET_NULL, allow null
    ep = models.ForeignKey(EP, related_name='songs', on_delete=models.SET_NULL, null=True, blank=True) # Optional: Added FK to EP
    single = models.ForeignKey(Single, related_name='songs', on_delete=models.SET_NULL, null=True, blank=True) # Optional: Added FK to Single

    duration = models.DurationField(null=True, blank=True) # Allow null
    file = models.FileField(upload_to='songs/', max_length=500) # Increased max_length
    lyrics = models.TextField(blank=True, null=True)
    release_date = models.DateField(null=True, blank=True) # Allow null
    synced_lyrics = models.TextField(blank=True, null=True)

    def get_release(self):
        # Helper to get the associated Album, EP, or Single
        return self.album or self.ep or self.single

    def __str__(self):
        artist_names = ", ".join([a.name for a in self.artists.all()])
        release = self.get_release()
        release_title = release.title if release else "Unknown Release"
        return f"{self.title} - {artist_names} ({release_title})" # Updated

    class Meta:
        verbose_name_plural = "Songs"

class Playlist(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='playlists')
    public = models.BooleanField(default=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    cover_image = models.ImageField(upload_to='playlists/', blank=True, null=True)
    songs = models.ManyToManyField('Song', related_name='playlists', blank=True) # Allow blank
    spotify_id = models.CharField(max_length=50, unique=True, null=True, blank=True) # Optional: Added

    def __str__(self):
        return self.name

    class Meta:
        verbose_name_plural = "Playlists"

class Library(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='library')
    artists = models.ManyToManyField(Artist, related_name='libraries', blank=True)
    albums = models.ManyToManyField(Album, related_name='libraries', blank=True)
    eps = models.ManyToManyField(EP, related_name='libraries', blank=True)
    singles = models.ManyToManyField(Single, related_name='libraries', blank=True)
    playlists = models.ManyToManyField(Playlist, related_name='libraries', blank=True)
    songs = models.ManyToManyField(Song, related_name='libraries', blank=True) # Added songs relationship

    def __str__(self):
        return f"{self.user.username}'s Library"

    class Meta:
        verbose_name_plural = "Libraries"

# Signal to create Library for new User
from django.db.models.signals import post_save
from django.dispatch import receiver

@receiver(post_save, sender=User)
def create_user_library(sender, instance, created, **kwargs):
    if created:
        Library.objects.create(user=instance)

@receiver(post_save, sender=User)
def save_user_library(sender, instance, **kwargs):
    try:
        instance.library.save()
    except Library.DoesNotExist:
        # Handle case where library might not exist yet (though create_user_library should handle it)
        Library.objects.create(user=instance)