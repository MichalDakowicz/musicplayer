from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('register/', views.register, name='register'),
    path('login/', views.login, name='login'),
    path('logout/', views.logout, name='logout'),
    path('add-spotify/', views.add_spotify_content, name='add_spotify_content'),
    path('browse/', views.browse_media, name='browse_media'), # Renamed from browse_songs
    # Remove URLs for adding/removing songs from library
    # path('library/add/<int:song_id>/', views.add_song_to_library, name='add_song_to_library'), # Removed
    # path('library/remove/<int:song_id>/', views.remove_song_from_library, name='remove_song_from_library'), # Removed
    # Add URL for album detail view
    path('album/<int:album_id>/', views.album_detail, name='album_detail'),
    # --- MODIFICATION START: Add EP and Single detail URLs ---
    path('ep/<int:ep_id>/', views.ep_detail, name='ep_detail'),
    path('single/<int:single_id>/', views.single_detail, name='single_detail'),
    # --- MODIFICATION END ---

    # Queue URLs
    path('queue/add/<int:song_id>/', views.add_to_queue, name='add_to_queue'),
    # --- MODIFICATION START: Add URL for adding multiple songs ---
    path('queue/add_multiple/', views.add_multiple_to_queue, name='add_multiple_to_queue'),
    # --- MODIFICATION END ---
    path('queue/next/', views.get_next_in_queue, name='get_next_in_queue'),
    path('queue/previous/', views.get_previous_in_queue, name='get_previous_in_queue'), # Added
    path('queue/view/', views.view_queue, name='view_queue'), # Added
    path('queue/remove/<int:item_id>/', views.remove_from_queue, name='remove_from_queue'), # Added remove URL
    path('queue/set_playing/<int:song_id>/', views.set_currently_playing, name='set_currently_playing'), # New endpoint
    # path('queue/clear/', views.clear_queue, name='clear_queue'), # Optional: Clear entire queue
    path('lyrics/<int:song_id>/', views.get_lyrics, name='get_lyrics'),
    path('lyrics/update/<int:song_id>/', views.update_lyrics, name='update_lyrics'),
    path('library/add/', views.add_to_library, name='add_to_library'),
]