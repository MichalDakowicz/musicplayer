from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('register/', views.register, name='register'),
    path('login/', views.login, name='login'),
    path('logout/', views.logout, name='logout'),
    path('add-spotify/', views.add_spotify_content, name='add_spotify_content'), # Check this line
    path('browse/', views.browse_songs, name='browse_songs'),
    # Add URLs for adding/removing songs from library
    path('library/add/<int:song_id>/', views.add_song_to_library, name='add_song_to_library'), # Check this line
    path('library/remove/<int:song_id>/', views.remove_song_from_library, name='remove_song_from_library'), # Check this line
    # Add URL for album detail view
    path('album/<int:album_id>/', views.album_detail, name='album_detail'),
]