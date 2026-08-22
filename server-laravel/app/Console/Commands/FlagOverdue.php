<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\ScheduledPost;

class FlagOverdue extends Command
{
    protected $signature = 'posts:flag-overdue';
    protected $description = 'Flag scheduled posts that are overdue';

    public function handle()
    {
        $count = ScheduledPost::where('status','scheduled')->where('scheduled_at','<', now())->update(['is_overdue'=>true]);
        $this->info("Flagged {$count} posts as overdue");
        return 0;
    }
}
