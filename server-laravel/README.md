# Content Schedule Manager (Laravel)

This folder contains the Laravel 11 application scaffold for Content Schedule Manager (backend + frontend in one app using Blade + Livewire).

Environment notes
- PHP: 8.2.33 (locked)
- Laravel: 11.x (compatible with PHP 8.2)

Quick setup (on host with Composer and npm available):

```bash
# create project (if not already created)
composer create-project laravel/laravel content-manager "11.*"
cd content-manager

# or if this scaffold is already placed, install dependencies
composer install
php artisan key:generate

# install Breeze with Livewire stack
composer require laravel/breeze --dev
php artisan breeze:install livewire

# install NPM deps and build assets
npm install
npm run build

# set up database (MySQL) credentials in .env, then run migrations and seeders
php artisan migrate --seed

# start dev server (local)
php artisan serve
```

Deployment notes (cPanel)
- Deploy Laravel app outside `public_html`, point subdomain document root to `your-app/public`.
- Set `APP_ENV=production` and `APP_DEBUG=false` in `.env`.
- Run `npm run build` locally or on the server to generate Tailwind assets and place them in `public/build`.
- Add cPanel cron entry to run `php /home/yourcpaneluser/path-to-app/artisan schedule:run` every minute.

Compatibility
- See COMPATIBILITY.md for constraints and version lock details.
