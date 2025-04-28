from django.shortcuts import render, redirect
from django.http import HttpResponse
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.csrf import csrf_exempt
from .forms import LoginForm # Import the LoginForm

# Create your views here.
@login_required
def home(request):
    return render(request, 'index.html')

@csrf_exempt
def register(request):
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        email = request.POST.get('email')
        # Add validation here (e.g., check if username/email exists)
        try:
            user = User.objects.create_user(username=username, password=password, email=email)
            user.save()
            # Redirect to login page after successful registration
            return redirect('login') # Assuming 'login' is the name of your login view URL
        except Exception as e:
             # Handle potential errors during user creation (e.g., duplicate username)
             # You might want to render the registration page again with an error message
             return render(request, 'register.html', {'error': 'Registration failed. Please try again.'}) # Example error handling
    return render(request, 'register.html')

@csrf_exempt # Consider using standard CSRF protection for production
def login(request):
    if request.method == 'POST':
        form = LoginForm(request, data=request.POST)
        if form.is_valid():
            username = form.cleaned_data.get('username')
            password = form.cleaned_data.get('password')
            user = authenticate(request, username=username, password=password)
            if user is not None:
                auth_login(request, user)
                # Redirect to a success page, e.g., home
                return redirect('home') # Assuming 'home' is the name of your home view URL
            else:
                # Return error message or re-render form with errors
                return render(request, 'login.html', {'form': form, 'error': 'Invalid credentials'})
        else:
            # Form is invalid, re-render with errors
            return render(request, 'login.html', {'form': form})
    else:
        form = LoginForm()
    return render(request, 'login.html', {'form': form})

@csrf_exempt # Consider removing csrf_exempt if using POST requests via forms
def logout(request):
    auth_logout(request)
    # Redirect to login page after logout
    return redirect('login') # Assuming 'login' is the name of your login view URL