<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function(){ return redirect()->route('dashboard'); });

Route::middleware(['auth'])->group(function(){
    Route::get('/dashboard', App\Http\Livewire\Dashboard::class)->name('dashboard');
    Route::get('/posts', App\Http\Livewire\PostsIndex::class)->name('posts.index');
    Route::get('/posts/create', App\Http\Livewire\PostForm::class)->name('posts.create');
    Route::get('/settings', App\Http\Livewire\SettingsComponent::class)->name('settings');
});

require __DIR__.'/auth.php';
