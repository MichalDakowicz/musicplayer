from django.db import models
from django.contrib.auth.models import User

# Create your models here.
class Artist(models.Model):
    name = models.CharField(max_length=100)
    genre = models.CharField(max_length=50, blank=True, null=True)
    bio = models.TextField(blank=True, null=True)
    image = models.ImageField(upload_to='artists/', blank=True, null=True)
    
    def __str__(self):
        return self.name
    
    class Meta:
        verbose_name_plural = "Artists"
    
class Album(models.Model):
    title = models.CharField(max_length=100)
    artists = models.ManyToManyField(Artist, related_name='albums')
    release_date = models.DateField()
    cover_image = models.ImageField(upload_to='albums/', blank=True, null=True) 
    
    def __str__(self):
        return f"{self.title} - {self.artist.name}"
    
    class Meta:
        verbose_name_plural = "Albums"

class EP(models.Model):
    title = models.CharField(max_length=100)
    artists = models.ManyToManyField(Artist, related_name='eps')
    release_date = models.DateField()
    cover_image = models.ImageField(upload_to='eps/', blank=True, null=True) 
    
    def __str__(self):
        return f"{self.title} - {self.artist.name}"
    
    class Meta:
        verbose_name_plural = "EPs"

class Single(models.Model):
    title = models.CharField(max_length=100)
    artists = models.ManyToManyField(Artist, related_name='singles')
    release_date = models.DateField()
    cover_image = models.ImageField(upload_to='singles/', blank=True, null=True) 
    
    def __str__(self):
        return f"{self.title} - {self.artist.name}"
    
    class Meta:
        verbose_name_plural = "Singles"
    
class Song(models.Model):
    title = models.CharField(max_length=100)
    artists = models.ManyToManyField(Artist, related_name='songs')
    album = models.ForeignKey(Album, related_name='songs', on_delete=models.CASCADE)
    duration = models.DurationField()
    file = models.FileField(upload_to='songs/')
    
    def __str__(self):
        return f"{self.title} - {self.album.title}"
    
    class Meta:
        verbose_name_plural = "Songs"
    
class Playlist(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='playlists')
    public = models.BooleanField(default=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    cover_image = models.ImageField(upload_to='playlists/', blank=True, null=True) 
    songs = models.ManyToManyField('Song', related_name='playlists')
    
    def __str__(self):
        return self.name
    
    class Meta:
        verbose_name_plural = "Playlists"
        
class Library(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='library')
    artists = models.ManyToManyField(Artist, related_name='libraries')
    albums = models.ManyToManyField(Album, related_name='libraries')
    eps = models.ManyToManyField(EP, related_name='libraries')
    singles = models.ManyToManyField(Single, related_name='libraries')
    playlists = models.ManyToManyField(Playlist, related_name='libraries')
    
    def __str__(self):
        return f"{self.user.username}'s Library"
    
    class Meta:
        verbose_name_plural = "Libraries"