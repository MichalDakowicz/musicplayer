from django.contrib import admin
from .models import Artist, Album, EP, Single, Song, Playlist, Library # Import models

# Register your models here.
admin.site.register(Artist)
admin.site.register(Album)
admin.site.register(EP)
admin.site.register(Single)
admin.site.register(Song)
admin.site.register(Playlist)
admin.site.register(Library)
