# Compatibility Notes

- PHP: Locked to 8.2.x (tested with 8.2.33). Do not upgrade PHP on hosting without validating Laravel compatibility.
- Laravel: 11.x — ensure Composer installs "laravel/laravel": "^11.0".
- Livewire: Use Livewire 3 compatible with Laravel 11 and PHP 8.2.
- Node/Tailwind: Use node tooling locally to compile CSS. The built assets are static and safe to deploy to cPanel.

If hosting environment only supports PHP 8.2, avoid packages that require 8.3 or newer.
