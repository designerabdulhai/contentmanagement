<!doctype html>
<html lang="en" class="h-full" x-data="{ dark: false }" x-bind:class="{ 'dark': dark }">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Content Schedule Manager</title>
    @vite(['resources/css/app.css'])
    @livewireStyles
</head>
<body class="min-h-screen bg-gray-100 text-gray-800">
    <div class="flex h-screen">
        {{-- Sidebar placeholder --}}
        <div class="w-60 bg-white border-r p-4">@yield('sidebar')</div>
        <div class="flex-1 p-6 overflow-auto">
            @yield('content')
        </div>
    </div>

    @livewireScripts
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.5/index.global.min.js"></script>
    @vite(['resources/js/app.js'])
</body>
</html>
