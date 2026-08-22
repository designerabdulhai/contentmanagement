<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;
use App\Console\Commands\FlagOverdue;

class Kernel extends ConsoleKernel
{
    protected $commands = [
        FlagOverdue::class,
    ];

    protected function schedule(Schedule $schedule): void
    {
        $schedule->command('posts:flag-overdue')->hourly();
    }

    protected function commands(): void
    {
        $this->load(__DIR__.'/Commands');
    }
}
