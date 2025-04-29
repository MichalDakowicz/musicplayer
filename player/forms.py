from django import forms
from django.contrib.auth.forms import AuthenticationForm

class LoginForm(AuthenticationForm):
    username = forms.CharField(widget=forms.TextInput(attrs={'class': 'form-control', 'placeholder': 'Username'}))
    password = forms.CharField(widget=forms.PasswordInput(attrs={'class': 'form-control', 'placeholder': 'Password'}))

# Add the new form
class SpotifyUrlForm(forms.Form):
    spotify_url = forms.URLField(
        label='Spotify Track/Album/Playlist URL', # Updated label
        required=True,
        widget=forms.URLInput(attrs={'class': 'form-control', 'placeholder': 'https://open.spotify.com/...', 'type': 'url'}) # Ensure type="url" for better browser handling
    )
